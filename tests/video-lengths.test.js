// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { mp4Duration, videoFilesFromIndex, videoFilesFromPro, videoIsItem } = require('../src/server.js');

const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, 'ascii'); return Buffer.concat([h, body]); };
function mvhd(version, timescale, duration) {
  const b = Buffer.alloc(version ? 32 : 20);                 // version+flags, created, modified, timescale, duration
  b.writeUInt8(version, 0);
  if (version) { b.writeUInt32BE(timescale, 20); b.writeBigUInt64BE(BigInt(duration), 24); }
  else { b.writeUInt32BE(timescale, 12); b.writeUInt32BE(duration, 16); }
  return box('mvhd', b);
}
const tmp = (name, buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vl-')), name); fs.writeFileSync(f, buf); return f; };

test('mp4Duration: reads the length from the movie header (version 0)', () => {
  const f = tmp('a.mp4', Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', mvhd(0, 600, 58040))]));
  assert.ok(Math.abs(mp4Duration(f) - 96.733) < 0.01);
});
test('mp4Duration: movie header after a large media block, version 1', () => {
  const f = tmp('b.mov', Buffer.concat([box('ftyp', Buffer.from('qt  0000')), box('mdat', Buffer.alloc(200000)), box('moov', mvhd(1, 90000, 90000 * 30))]));
  assert.strictEqual(mp4Duration(f), 30);
});
test('mp4Duration: not a video, or missing', () => {
  assert.strictEqual(mp4Duration(tmp('c.mp4', Buffer.from('hello'))), null);
  assert.strictEqual(mp4Duration('/nonexistent/x.mp4'), null);
});

test('videoFilesFromIndex: ProPresenter cloud workspace media index', () => {
  const index = { documents: { 'b1228da7-1cde-4787-b31e-e1eac14874e2': { projection: { references: [
    { media_type: 'Video', source: { File: { local_url: { relative_file_path: { Local: { root: 10, path: 'Media/Assets/11.08.25 Church News.mp4' } } } } } },
    { media_type: 'Image', source: { File: { local_url: { relative_file_path: { Local: { root: 10, path: 'Media/Assets/bg.jpg' } } } } } },
  ] } } } };
  assert.deepStrictEqual(videoFilesFromIndex(index, 'B1228DA7-1CDE-4787-B31E-E1EAC14874E2', '/WS'), ['/WS/Media/Assets/11.08.25 Church News.mp4']);
  assert.deepStrictEqual(videoFilesFromIndex(index, 'unknown', '/WS'), []);
  assert.deepStrictEqual(videoFilesFromIndex(null, 'x', '/WS'), []);
});

test('videoFilesFromPro: video file links inside a .pro file', () => {
  const buf = Buffer.from('\x00\x12file:///Users/me/Media/Church%20News.mp4\x00junk file:///Users/me/Media/bg.jpg\x00file:///Users/me/Media/Bumper.MOV\x00');
  assert.deepStrictEqual(videoFilesFromPro(buf), ['/Users/me/Media/Church News.mp4', '/Users/me/Media/Bumper.MOV']);
});

test('videoIsItem: the item\'s own video is at least a quarter of its planned length (today\'s real cases)', () => {
  assert.strictEqual(videoIsItem(97, 240), true, 'Church News 1:37 in a 4:00 slot');
  assert.strictEqual(videoIsItem(191, 279), true, 'Pre-Roll 3:11 in 4:39');
  assert.strictEqual(videoIsItem(38, 30), true, 'Bumper 0:38 in 0:30');
  assert.strictEqual(videoIsItem(61, 0), true, 'At the Movies, no Planning Center length');
  assert.strictEqual(videoIsItem(12, 240), false, '12 s name video in Close Worship');
  assert.strictEqual(videoIsItem(12, 120), false, '12 s name video in Next Steps');
  assert.strictEqual(videoIsItem(127, 1200), false, 'pre-service loop in a 20 min block');
  assert.strictEqual(videoIsItem(30, 445), false, 'motion background on a song');
});
