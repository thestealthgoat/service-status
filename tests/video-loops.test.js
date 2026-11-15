// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { videoState, videoCounts, RunStore } = require('../src/server.js');

// one ProPresenter poll: a video on the presentation layer at playhead t (seconds) of a dur-second file
const snap = (name, t, dur, uuid = name + '-uuid') => ({ tp_time: t, tp_cur: { is_playing: true, uuid, name, duration: dur } });
// feed polls one second apart, return the last result
function run(store, frames, start = 1e12) {
  let out = null;
  frames.forEach(([name, t, dur], i) => { out = videoState(snap(name, t, dur), start + i * 1000, store); });
  return out;
}

test('a video whose playhead jumps from the end back to the start is a loop, and is remembered', () => {
  const store = new RunStore(null);
  const v = run(store, [['PreService Loop.mp4', 124.5, 127], ['PreService Loop.mp4', 125.5, 127], ['PreService Loop.mp4', 126.6, 127], ['PreService Loop.mp4', 0.6, 127], ['PreService Loop.mp4', 1.6, 127]]);
  assert.strictEqual(v.loop, true);
  assert.strictEqual(store.isLoop('PreService Loop.mp4-uuid'), true);
});

test('dragging the playhead back mid-video is not a loop', () => {
  const store = new RunStore(null);
  const v = run(store, [['Bumper.mp4', 10, 30], ['Bumper.mp4', 11, 30], ['Bumper.mp4', 3, 30], ['Bumper.mp4', 4, 30]]);
  assert.strictEqual(v.loop, false);
  assert.strictEqual(store.isLoop('Bumper.mp4-uuid'), false);
});

test('a loop learned on an earlier Sunday is known from its first frames', () => {
  const store = new RunStore(null); store.markLoop('Worship Motion BG.mov-uuid');
  const v = run(store, [['Worship Motion BG.mov', 2, 30], ['Worship Motion BG.mov', 3, 30]]);
  assert.strictEqual(v.loop, true);
});

test('videoCounts: only a real video item decides when the item ends', () => {
  assert.strictEqual(videoCounts({ total: 30, loop: false }, 420), false, '30 s background under a 7 min song');
  assert.strictEqual(videoCounts({ total: 127, loop: false }, 1800), false, '2 min loop inside a 30 min pre-service');
  assert.strictEqual(videoCounts({ total: 30, loop: false }, 30), true, '30 s bumper in a 30 s slot');
  assert.strictEqual(videoCounts({ total: 279, loop: false }, 279), true, 'pre-roll countdown');
  assert.strictEqual(videoCounts({ total: 200, loop: false }, 240), true, 'a bit shorter than planned still counts');
  assert.strictEqual(videoCounts({ total: 279, loop: true }, 279), false, 'a known loop never counts');
  assert.strictEqual(videoCounts({ total: 30, loop: false }, 0), true, 'no planned length: nothing to compare with');
  assert.strictEqual(videoCounts(null, 30), false);
});
