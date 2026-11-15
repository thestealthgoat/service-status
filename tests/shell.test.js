// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { quietToApply, feedUrl, feedFallback } = require('../src/shell.js');

const at = (h, m = 0, day = 15) => new Date(2026, 10, day, h, m);

test('quietToApply: only between 3:00 and 5:00 AM', () => {
  assert.strictEqual(quietToApply(at(3, 30), []), true);
  assert.strictEqual(quietToApply(at(2, 59), []), false);
  assert.strictEqual(quietToApply(at(5, 0), []), false);
  assert.strictEqual(quietToApply(at(14, 0), []), false);
});
test('quietToApply: not when a service starts within 2 hours', () => {
  assert.strictEqual(quietToApply(at(3, 30), [at(5, 0)]), false, 'a 5 AM event');
  assert.strictEqual(quietToApply(at(3, 30), [at(6, 0)]), true, '2 h 30 m away');
  assert.strictEqual(quietToApply(at(3, 30), [at(18, 0, 18)]), true, 'Wednesday night service days away');
  assert.strictEqual(quietToApply(at(3, 30), [at(2, 0)]), true, 'one that already started earlier');
});
test('feeds: Stable is latest.json; Beta is beta.json and falls back to Stable', () => {
  assert.match(feedUrl('stable'), /\/update\/latest\.json$/);
  assert.strictEqual(feedFallback('stable'), null);
  assert.match(feedUrl('beta'), /\/update\/beta\.json$/);
  assert.strictEqual(feedFallback('beta'), feedUrl('stable'));
  assert.strictEqual(feedUrl(undefined), feedUrl('stable'), 'no setting = Stable');
});

const fs = require('fs'), os = require('os'), path = require('path');
const { StatusService } = require('../src/server.js');
test('nextServiceStarts: the current plan\'s service times, as dates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  const svc = new StatusService(path.join(dir, 'config.json'), '/dev/null');
  assert.deepStrictEqual(svc.nextServiceStarts(), [], 'nothing loaded yet');
  svc.pcoPlan = { times: [{ name: '9AM', starts_at: '2026-11-15T15:00:00Z' }, { name: '11AM', starts_at: '2026-11-15T17:00:00Z' }] };
  assert.deepStrictEqual(svc.nextServiceStarts().map(d => d.toISOString()), ['2026-11-15T15:00:00.000Z', '2026-11-15T17:00:00.000Z']);
});
test('settings: Updates channel and Launch at login are saved and reported (with the shell version)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  const svc = new StatusService(path.join(dir, 'config.json'), '/dev/null');
  let told = null; svc.onConfigChange = c => { told = c; };
  assert.strictEqual(svc.publicSettings().update_channel, 'stable');
  assert.strictEqual(svc.publicSettings().launch_at_login, true);
  svc.saveConfig({ update_channel: 'beta', launch_at_login: false });
  assert.strictEqual(svc.publicSettings().update_channel, 'beta');
  assert.strictEqual(svc.publicSettings().launch_at_login, false);
  assert.strictEqual(told.update_channel, 'beta', 'the shell hears about the change');
  svc.update = { shell: '2.1.0' };
  assert.strictEqual(svc.publicSettings().shell, '2.1.0');
});
