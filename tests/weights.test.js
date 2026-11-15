// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { slideKinds, slideWeights, weightedPos } = require('../src/server.js');

// today's 11.15.26 message deck, as ProPresenter reports it (group, label, first bit of text)
const S = (group, label, text) => ({ group, label, text });
const today = [
  S('', 'The Comeback_Screens-01.jpg', ''), S('', '9AM', ''), S('', '11AM', ''), S('', '', 'THE COMEBACK — WEEK 3\r“God Can Redeem What You Lost”'),
  S('', 'Recap', 'Week 1 — How to come back'), S('', 'Quote', '“There is great value in disaster.'), S('', 'Big Idea', 'Just because you’ve lost something'),
  S('Ruth 1:1-5', 'Ruth 1:1-2', 'Ruth 1:1-5\r1In the days'), S('Ruth 1:1-5', 'Ruth 1:2-4', 'Ruth 1:1-5\rTheir two sons'), S('Ruth 1:1-5', 'Ruth 1:4-5', 'Ruth 1:1-5\rwoman named Orpah'),
  S('Ruth 1:16', 'Ruth 1:16', 'Ruth 1:16\r16But Ruth replied'), S('Ruth 1:16', 'Statement', 'Just because'), S('Ruth 1:16', 'Point 1', '1. Don’t let what you’ve lost'),
];

test('slide kinds from your labels and groups', () => {
  assert.deepStrictEqual(slideKinds(today), ['other', 'other', 'other', 'other', 'other', 'emphasis', 'emphasis',
    'scripture', 'more', 'more', 'scripture', 'emphasis', 'point']);
});
test('the smoothed weights: point 2, Big Idea/Statement/Quote 1.5, passage 1 then 0.75, everything else 1', () => {
  assert.deepStrictEqual(slideWeights(today), [1, 1, 1, 1, 1, 1.5, 1.5, 1, 0.75, 0.75, 1, 1.5, 2]);
});
test('unlabeled slides fall back to the text: "1. ..." is a point, a verse number starts scripture', () => {
  assert.deepStrictEqual(slideKinds([S('', '', 'Welcome'), S('', '', '16But Ruth replied'), S('', '', '17Wherever you die'), S('', '', '2. God is working')]),
    ['other', 'scripture', 'more', 'point']);
});
test('weightedPos: first slide 0 %, last slide 100 %, positions follow the weights', () => {
  const p = weightedPos([1, 2, 1]);           // slide starts at 0, 1, 3 of 3
  assert.deepStrictEqual(p.map(x => Math.round(x * 10) / 10), [0, 33.3, 100]);
});
test('a deck with no labels at all behaves exactly as before (equal weights)', () => {
  const plain = Array.from({ length: 5 }, () => S('', '', 'words'));
  assert.deepStrictEqual(weightedPos(slideWeights(plain)), [0, 25, 50, 75, 100]);
});
test('one slide, or none, does not divide by zero', () => {
  assert.deepStrictEqual(weightedPos([1]), [0]);
  assert.deepStrictEqual(weightedPos([]), []);
});
