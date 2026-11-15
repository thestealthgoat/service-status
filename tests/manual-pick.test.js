// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { manualActive, manualTimes } = require('../src/server.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = d => d.toISOString();
const NOW = at(2026, 11, 15, 10, 30);
const pick = (extra = {}) => ({ st: '1', plan_id: '42', plan_label: 'Nov 8 · The Comeback', time: '', day: '2026-11-15', ...extra });

test('manualActive: on the day it was picked', () => {
  assert.strictEqual(manualActive(pick(), NOW), true);
});
test('manualActive: not after midnight (picked yesterday)', () => {
  assert.strictEqual(manualActive(pick({ day: '2026-11-14' }), NOW), false);
  assert.strictEqual(manualActive(pick(), at(2026, 11, 16, 0, 0)), false);
});
test('manualActive: nothing picked, or no plan', () => {
  assert.strictEqual(manualActive(null, NOW), false);
  assert.strictEqual(manualActive(pick({ plan_id: '' }), NOW), false);
});

const lastWeek = [{ name: '9AM', starts_at: iso(at(2026, 11, 8, 9, 0)) }, { name: '11AM', starts_at: iso(at(2026, 11, 8, 11, 0)) }];

test('manualTimes: another day\'s plan moves onto today at the same clock times', () => {
  const t = manualTimes(lastWeek, pick(), NOW);
  assert.deepStrictEqual(t.map(x => [x.name, new Date(x.starts_at).getDate(), new Date(x.starts_at).getHours()]),
    [['9AM', 15, 9], ['11AM', 15, 11]]);
});
test('manualTimes: a chosen time keeps only that time', () => {
  const t = manualTimes(lastWeek, pick({ time: lastWeek[1].starts_at, time_name: '11AM' }), NOW);
  assert.deepStrictEqual(t.map(x => [x.name, new Date(x.starts_at).getHours()]), [['11AM', 11]]);
});
test('manualTimes: a chosen time that is gone from Planning Center falls back to all times', () => {
  const t = manualTimes(lastWeek, pick({ time: iso(at(2026, 11, 8, 18, 0)) }), NOW);
  assert.strictEqual(t.length, 2);
});
test('manualTimes: a plan with no service times', () => {
  assert.deepStrictEqual(manualTimes([], pick(), NOW), []);
  assert.deepStrictEqual(manualTimes(undefined, pick(), NOW), []);
});
