// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { videoChain } = require('../src/server.js');

// today's 11AM order around the videos
const rows = [
  { title: 'Welcome 1st Time Guests & Offering', type: 'item', length: 240 },
  { title: 'Church News', type: 'item', length: 240, video_len: 97 },
  { title: 'At the Movies Promo', type: 'item', length: 0, video_len: 61 },
  { title: 'Bumper Video', type: 'item', length: 30, video_len: 38 },
  { title: 'Message', type: 'header', length: 0 },
  { title: 'Message: P. Jay Miller', type: 'item', length: 2400 },
];

test('Church News playing with 1:23 left: stacks At the Movies and the Bumper, ends at the message', () => {
  const c = videoChain(rows, 1, 83);
  assert.strictEqual(c.left, 83 + 61 + 38);
  assert.deepStrictEqual(c.names, ['Church News', 'At the Movies Promo', 'Bumper Video']);
  assert.strictEqual(c.next, 'Message: P. Jay Miller');
});
test('on the last video it is just that video', () => {
  const c = videoChain(rows, 3, 20);
  assert.strictEqual(c.left, 20);
  assert.deepStrictEqual(c.names, ['Bumper Video']);
});
test('a following video item with no known length ends the chain (no guessing)', () => {
  const r = rows.map((x, i) => i === 2 ? { ...x, video_len: undefined } : x);
  const c = videoChain(r, 1, 83);
  assert.strictEqual(c.left, 83);
  assert.strictEqual(c.next, 'At the Movies Promo');
});
test('no current row: nothing to chain', () => {
  assert.strictEqual(videoChain(rows, null, 30), null);
});
