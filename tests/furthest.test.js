// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { advanceFar, backMoveAllowed } = require('../src/server.js');

// feed slide indexes one second apart (or with explicit gaps), return the tracker
function run(slides, t0 = 1e12) {
  const f = { far: null, slide: null, since: 0 };
  let t = t0;
  for (const s of slides) { const [cur, wait] = Array.isArray(s) ? s : [s, 1000]; t += wait; advanceFar(f, cur, t); }
  return f;
}

test('normal forward flips count right away', () => {
  assert.strictEqual(run([0, 1, 2, 3, 4, 5]).far, 5);
});
test('going back keeps the furthest slide', () => {
  assert.strictEqual(run([0, 1, 2, 3, [4, 60000], 5, 6, [7, 60000], [3, 30000]]).far, 7, 'back to slide 3 from 7');
  assert.strictEqual(run([0, 1, 2, 10, 10, 10, 10, 10, 10, 11, 12, 8, 8, 8]).far, 12, 'a jump to 10 that stuck (polled each second), on to 12, back to 8');
});
test('a big jump ahead only counts after 5 seconds on that slide', () => {
  assert.strictEqual(run([0, 1, 2, [30, 1000], [2, 1500]]).far, 2, 'clicked to the end by mistake and straight back');
  assert.strictEqual(run([0, 1, 2, [30, 1000], [30, 6000]]).far, 30, 'stayed there: it counts');
});
test('the first slide seen is where it starts', () => {
  assert.strictEqual(run([7]).far, 7);
});

test('backMoveAllowed: a jump back after a while on the later item is held', () => {
  const start = 1e12;
  assert.strictEqual(backMoveAllowed(start, start + 5 * 60000, false), false, '5 min into Close Worship, back to song 3');
  assert.strictEqual(backMoveAllowed(start, start + 40000, false), true, 'wrong item for 40 s: going back is a correction');
  assert.strictEqual(backMoveAllowed(start, start + 5 * 60000, true), true, 'Unlock pressed');
});
