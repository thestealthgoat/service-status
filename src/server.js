// Service Status — core: polls ProPresenter (+ optional Planning Center) and serves the page.
// Used by the Electron app (main.js). Also runs on its own for testing:  node server.js --demo
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  pp_host: '127.0.0.1',            // ProPresenter computer (this Mac = 127.0.0.1)
  pp_port: 51476,                  // ProPresenter > Settings > Network > Port
  page_port: 8787,                 // phones open http://<this Mac>:8787
  pco_app_id: '',                  // Planning Center personal access token (optional)
  pco_secret: '',
  pco_service_type_id: null,       // null = automatic: whichever service type has a plan today
  message_name_pattern: '',        // optional: regex for message deck names (e.g. ^\\d\\d\\.\\d\\d\\.\\d\\d); blank = detect from the order
  message_timer_name: '',          // blank = automatic: a timer named like "message"/"sermon", else the running countdown
  demo: false,
};

// ------------------------------------------------------------------ helpers
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function fmtSecs(s) {
  s = Math.round(s); const sign = s < 0 ? '-' : ''; s = Math.abs(s);
  if (s < 3600) return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${sign}${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
const clock = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const clockSec = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
function parseClock(t) {           // '00:12:34' / '-00:01:05' / '12:34' -> seconds (signed)
  if (t == null) return null;
  const m = String(t).match(/^\s*(-)?(\d+):(\d+)(?::(\d+))?/);
  if (!m) return null;
  const secs = m[4] !== undefined ? (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]) : (+m[2]) * 60 + (+m[3]);
  return m[1] ? -secs : secs;
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function getJSON(url, headers = {}, timeoutMs = 2000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(t); }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ------------------------------------------------------------------ ProPresenter (read-only)
class ProPresenter {
  constructor(cfg) { this.base = `http://${cfg.pp_host}:${cfg.pp_port}`; this.cache = new Map(); }
  get(p) { return getJSON(this.base + p); }
  async presentation(uuid) {
    const hit = this.cache.get(uuid);
    if (hit && Date.now() - hit.at < 30000) return hit.data;
    const data = await this.get(`/v1/presentation/${encodeURIComponent(uuid)}`);
    this.cache.set(uuid, { at: Date.now(), data });
    return data;
  }
  async snapshot() {
    const out = { ok: false };
    try { out.version = await this.get('/version'); out.ok = true; }
    catch (e) { out.error = `Can't reach ProPresenter at ${this.base} — is ProPresenter open with Network turned on?`; return out; }
    const tries = [['slide_index', '/v1/presentation/slide_index'], ['active_playlist', '/v1/playlist/active'],
                   ['timers', '/v1/timers/current'], ['status_slide', '/v1/status/slide']];
    await Promise.all(tries.map(async ([k, p]) => { try { out[k] = await this.get(p); } catch { out[k] = null; } }));
    try {
      const pl = out.active_playlist?.presentation?.playlist;
      if (pl?.uuid) out.playlist = await this.get(`/v1/playlist/${encodeURIComponent(pl.uuid)}`);
    } catch { out.playlist = null; }
    try {
      const pid = out.slide_index?.presentation_index?.presentation_id;
      if (pid?.uuid) out.presentation = await this.presentation(pid.uuid);
    } catch { out.presentation = null; }
    return out;
  }
}

// ------------------------------------------------------------------ Planning Center (read-only, optional)
class PCO {
  constructor(cfg) {
    this.enabled = !!(cfg.pco_app_id && cfg.pco_secret);
    this.auth = this.enabled ? 'Basic ' + Buffer.from(`${cfg.pco_app_id}:${cfg.pco_secret}`).toString('base64') : '';
    this.st = cfg.pco_service_type_id || null; this.auto = !this.st; this.cache = null; this.at = 0; this.types = null; this.pickAt = 0;
  }
  get(p) { return getJSON('https://api.planningcenteronline.com/services/v2' + p, { Authorization: this.auth }, 8000); }
  async serviceTypes() {
    if (this.types && Date.now() - this.types.at < 3600000) return this.types.list;
    const d = await this.get('/service_types?per_page=100&order=sequence');
    const list = (d.data || []).map(t => ({ id: t.id, name: t.attributes.name }));
    this.types = { at: Date.now(), list };
    return list;
  }
  // Plans dated today (±1 day) in every service type, or only the chosen type. Refreshed every 15 min.
  async candidates() {
    if (this.cand && Date.now() - this.cand.at < 900000) return this.cand.list;
    const types = this.auto ? await this.serviceTypes() : [{ id: this.st, name: (this.types?.list || []).find(t => String(t.id) === String(this.st))?.name || null }];
    const now = new Date(), days = new Set([-1, 0, 1].map(k => isoDay(new Date(now.getTime() + k * 86400000))));
    const list = [], jobs = [];
    for (const t of types) for (const [flt, order] of [['future', 'sort_date'], ['past', '-sort_date']]) jobs.push([t, flt, order]);
    let authErr = null;
    const worker = async () => {          // 8 at a time instead of one by one (was ~30 s at startup)
      while (jobs.length) {
        const [t, flt, order] = jobs.shift();
        let d; try { d = await this.get(`/service_types/${t.id}/plans?filter=${flt}&order=${order}&per_page=3`); }
        catch (e) { if (/401|403/.test(e.message)) authErr = e; continue; }
        for (const p of d.data || []) {
          const day = (p.attributes.sort_date || '').slice(0, 10);
          if (days.has(day) && !list.some(x => x.id === p.id))
            list.push({ id: p.id, st: t.id, service_type: t.name, title: p.attributes.title, series: p.attributes.series_title,
              dates: p.attributes.dates, day, today: day === isoDay(now), seq: types.indexOf(t) });
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (authErr && !list.length) throw authErr;
    list.sort((a, b) => a.seq - b.seq);
    this.cand = { at: Date.now(), list };
    return list;
  }
  async items(c) {          // a plan's items, cached 2 min
    this.itemCache ||= new Map();
    const hit = this.itemCache.get(c.id);
    if (hit && Date.now() - hit.at < 120000) return hit.items;
    const d = await this.get(`/service_types/${c.st}/plans/${c.id}/items?per_page=100&order=sequence`);
    const items = (d.data || []).map(it => ({ id: it.id, title: it.attributes.title, type: it.attributes.item_type,
      length: it.attributes.length || 0, position: it.attributes.service_position, desc: (it.attributes.description || '').trim() }));
    this.itemCache.set(c.id, { at: Date.now(), items });
    return items;
  }
  // Which plan goes with what's open in ProPresenter: the playlist name (PCO-linked playlists are named
  // "<series or title> - <date>"), then how many playlist items match the plan's items. No match -> null.
  async pick(pp) {
    if (!this.enabled) return null;
    let list;
    try { list = await this.candidates(); }
    catch (e) { return { error: 'Planning Center: ' + e.message + (/401|403/.test(e.message) ? ' — check the Application ID and Secret in Settings' : '') }; }
    if (!list.length) return { error: 'No Planning Center plan today' };
    const plName = norm(pp?.active_playlist?.presentation?.playlist?.name || '');
    const ppItems = (pp?.playlist?.items || []).filter(i => i.type !== 'header').map(i => i.id?.name).filter(Boolean);
    let best = null, bestScore = 0;
    for (const c of list) {
      let sc = 0;
      if (plName) {
        if (c.title && plName.includes(norm(c.title))) sc += 4;
        if (c.series && plName.includes(norm(c.series))) sc += 3;
        if (c.dates && plName.includes(norm(c.dates))) sc += 2;
        if (c.service_type && plName.includes(norm(c.service_type))) sc += 1;
      }
      if (ppItems.length) {
        try {
          const its = (await this.items(c)).filter(i => i.type !== 'header').map(i => i.title);
          const hits = ppItems.filter(n => its.some(t => simName(n, t) >= 0.9)).length;
          sc += 6 * hits / ppItems.length;
        } catch { /* keep name score */ }
      }
      if (c.today) sc += 0.5;
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    // nothing open in ProPresenter yet -> today's plan (if there's exactly one, or the next one up)
    if (!plName && !ppItems.length) best = list.filter(c => c.today)[0] || null, bestScore = best ? 1 : 0;
    if (!best || bestScore < 1.5 && plName) {
      return { error: null, unmatched: true, note: plName ? `“${pp.active_playlist.presentation.playlist.name}” isn't a Planning Center plan today — showing the ProPresenter order` : 'No Planning Center plan today' };
    }
    return this.detail(best);
  }
  // Never hold up the screen for Planning Center: return the last answer right away and refresh in the background.
  pickNow(pp) {
    if (!this.enabled) return null;
    const pl = pp?.active_playlist?.presentation?.playlist?.name || '', items = (pp?.playlist?.items || []).map(i => i.id?.name).join('|');
    const key = pl + '#' + items;
    if (!this.busy && (key !== this.lastKey || Date.now() - (this.lastAt || 0) > 5000)) {
      this.busy = true;
      this.pick(pp).then(r => { this.last = r; this.lastKey = key; this.lastAt = Date.now(); })
        .catch(e => { this.last = { error: 'Planning Center: ' + e.message }; this.lastAt = Date.now(); })
        .finally(() => { this.busy = false; });
    }
    return this.last || { error: null, unmatched: true, note: 'Loading Planning Center…' };
  }
  async detail(c) {
    if (this.cache && this.cache.id === c.id && Date.now() - this.at < 120000) return this.cache;
    const out = { id: c.id, series: c.series, title: c.title, dates: c.dates, service_type: c.service_type, items: [], times: [], live_item_id: null };
    try { out.items = await this.items(c); } catch (e) { out.error = 'Planning Center items: ' + e.message; }
    try {
      const d = await this.get(`/service_types/${c.st}/plans/${c.id}/plan_times`);
      out.times = (d.data || []).filter(t => t.attributes.time_type === 'service' && t.attributes.starts_at)
        .map(t => ({ name: t.attributes.name, starts_at: t.attributes.starts_at })).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    } catch (e) { out.error = out.error || 'Planning Center times: ' + e.message; }
    try { // Services LIVE, only if someone runs it
      const d = await this.get(`/service_types/${c.st}/plans/${c.id}/live?include=current_item_time`);
      const cur = d?.data?.relationships?.current_item_time?.data;
      const inc = (d?.included || []).find(x => x.type === 'ItemTime' && x.id === cur?.id);
      out.live_item_id = inc?.relationships?.item?.data?.id || null;
    } catch { /* LIVE not in use */ }
    this.cache = out; this.at = Date.now();
    return out;
  }
}

// ------------------------------------------------------------------ state
const TRACK = { msgPct: {}, msgUuid: null, msgStarted: null, msgStarts: {}, svcKey: null, cur: null, curStart: null, pend: null, pendSince: null, lastSeen: null, done: false };

// Remembers when each Planning Center item actually started/ended, so "vs plan" keeps counting while an
// item runs long, and projections use real lengths (earlier service today, else the median of past Sundays).
class RunStore {
  constructor(file) {
    this.file = file; this.data = { days: {}, avg: {} }; this.dirty = false;
    if (file) { try { this.data = { days: {}, avg: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ } }
    const ds = Object.keys(this.data.days).sort(); while (ds.length > 21) delete this.data.days[ds.shift()];
  }
  day(d) { return (this.data.days[d] ||= {}); }
  svc(d, s) { const x = this.day(d); return (x[s] ||= { rows: {} }); }
  begin(runs, key, ts) { const r = (runs.rows[key] ||= {}); if (!r.start || r.end) { if (!r.start) r.start = ts; delete r.end; } this.dirty = true; }
  finish(runs, key, ts, row, demo) {
    const r = runs.rows[key]; if (!r || !r.start) return;
    r.end = ts; this.dirty = true;
    const secs = (r.end - r.start) / 1000, k = avgKeyOf(row);
    if (!demo && k && !r.learned && secs >= 5 && secs <= 3 * (row.length || 600) + 600) { r.learned = 1; this.addAvg(k, secs); }
  }
  addAvg(k, secs) { const a = (this.data.avg[k] ||= []); a.push(Math.round(secs)); while (a.length > 8) a.shift(); this.dirty = true; }
  median(k) { const a = (this.data.avg[k] || []).slice().sort((x, y) => x - y); if (a.length < 2) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  save() {
    if (!this.file || !this.dirty) return; this.dirty = false;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) { console.error('runs', e); }
  }
}
function abbrSection(g) {      // 'Verse 1' -> 'V1', 'Pre-Chorus' -> 'PC', 'Chorus 2' -> 'C2', 'Bridge' -> 'B'
  const n = norm(g), num = (n.match(/\d+$/) || [''])[0];
  const map = [['pre chorus', 'PC'], ['prechorus', 'PC'], ['chorus', 'C'], ['verse', 'V'], ['bridge', 'B'], ['tag', 'T'], ['intro', 'In'], ['outro', 'Out'], ['ending', 'E'], ['interlude', 'It'], ['instrumental', 'Ins'], ['turnaround', 'TA'], ['vamp', 'Vp'], ['refrain', 'R']];
  for (const [k, a] of map) if (n.startsWith(k)) return a + num;
  return g.length > 6 ? g.slice(0, 5) + '…' : g;
}
// ---- fuzzy names: ProPresenter and Planning Center rarely spell things the same way
// ("Build My Life (Live) v2" vs "Build My Life", "Welcome & Offering" vs "Welcome 1st Time Guests & Offering: P. Jay").
const SYN = { sermon: 'message', teaching: 'message', preaching: 'message', homily: 'message', word: 'message',
  tithe: 'offering', tithes: 'offering', giving: 'offering', announcement: 'announcements', notices: 'announcements' };
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'live', 'version', 'final', 'copy', 'edit', 'new', 'updated', 'key', 'slides', 'pres', 'presentation']);
function nameForms(t) {
  const raw = String(t || '');
  const noParen = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const forms = new Set([noParen, noParen.replace(/:.*$/, ''), noParen.replace(/\s[-–—]\s.*$/, ''), noParen.replace(/^.*?:\s*/, '')]);
  return [...forms].map(f => norm(f).replace(/\b(v\d+|\d{1,2} \d{1,2} \d{2,4}|\d+(st|nd|rd|th)?)\b/g, ' ')
    .split(' ').filter(w => w && !STOP.has(w)).map(w => SYN[w] || w)).filter(w => w.length);
}
function grams(s) { const t = ' ' + s + ' ', g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; }
function dice(a, b) { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return 2 * n / (a.size + b.size); }
function simName(a, b) {          // 0..1, best over each name's variants
  let best = 0;
  for (const A of nameForms(a)) for (const B of nameForms(b)) {
    const as = A.join(' '), bs = B.join(' ');
    if (as === bs) return 1;
    const ta = new Set(A), tb = new Set(B);
    const tok = dice(ta, tb);
    const sub = [...ta].every(w => tb.has(w)) || [...tb].every(w => ta.has(w)) ? 0.85 : 0;   // one name is part of the other
    const chr = dice(grams(as), grams(bs));                                                  // typos, plurals, run-together words
    best = Math.max(best, tok, Math.min(sub, 0.4 + 0.6 * Math.min(ta.size, tb.size) / Math.max(ta.size, tb.size) + 0.25), chr >= 0.7 ? chr * 0.95 : 0);
  }
  return Math.min(1, best);
}
// Line the ProPresenter playlist up against the Planning Center order (both are in service order), so
// items whose names don't match at all still land in the right place between the ones that do.
const ALIGN = { key: null, map: null };
function alignOrder(ppItems, rows) {
  const P = ppItems.map((it, i) => ({ i, name: it.id?.name || '', uuid: it.id?.uuid })).filter(x => x.name);
  const C = rows.map((r, i) => ({ i, r })).filter(x => x.r.type !== 'header');
  const key = P.map(x => x.uuid + x.name).join('|') + '#' + C.map(x => x.r.title).join('|');
  if (ALIGN.key === key) return ALIGN.map;
  const n = P.length, m = C.length, S = [...Array(n)].map((_, a) => C.map((_, b) => simName(P[a].name, C[b].r.title)));
  const D = [...Array(n + 1)].map(() => new Float64Array(m + 1)), B = [...Array(n + 1)].map(() => new Int8Array(m + 1));
  for (let a = 1; a <= n; a++) for (let b = 1; b <= m; b++) {
    const s = S[a - 1][b - 1], diag = D[a - 1][b - 1] + (s >= 0.55 ? s : -0.35);
    const up = D[a - 1][b] - 0.05, left = D[a][b - 1] - 0.05;
    if (diag >= up && diag >= left) { D[a][b] = diag; B[a][b] = 1; } else if (up >= left) { D[a][b] = up; B[a][b] = 2; } else { D[a][b] = left; B[a][b] = 3; }
  }
  const pairs = []; let a = n, b = m;
  while (a > 0 && b > 0) { if (B[a][b] === 1) { if (S[a - 1][b - 1] >= 0.55) pairs.push([a - 1, b - 1]); a--; b--; } else if (B[a][b] === 2) a--; else b--; }
  pairs.reverse();
  const map = new Map();                                  // playlist uuid -> { row, guess }
  for (const [x, y] of pairs) map.set(P[x].uuid, { row: C[y].i, guess: false });
  // fill gaps: same number of unmatched items between two matches on both sides -> pair them in order
  const anchors = [[-1, -1], ...pairs, [n, m]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [p0, c0] = anchors[k], [p1, c1] = anchors[k + 1];
    if (p1 - p0 === c1 - c0 && p1 - p0 > 1) for (let d = 1; d < p1 - p0; d++) map.set(P[p0 + d].uuid, { row: C[c0 + d].i, guess: true });
  }
  ALIGN.key = key; ALIGN.map = map;
  return map;
}
const rowKeyOf = (rows, i) => { const n = norm(rows[i].title); let k = 0; for (let j = 0; j < i; j++) if (norm(rows[j].title) === n) k++; return n + '#' + k; };
const avgKeyOf = r => (r.type === 'song' || r.type === 'header') ? null : norm(String(r.title).replace(/:.*$/, ''));

function serviceStart(pco) {
  if (!pco?.times?.length) return [null, null];
  const now = Date.now();
  let best = null;
  for (const t of pco.times) { const st = new Date(t.starts_at); if (st.getTime() <= now + 15 * 60000) best = st; }
  if (!best) best = new Date(pco.times[0].starts_at);
  const h = best.getHours();
  return [best, `${((h + 11) % 12) + 1}${h < 12 ? 'AM' : 'PM'}`];
}

function buildState(cfg, pp, pco, store) {
  const now = Date.now();
  const state = { now: clockSec(new Date()), pp: { ok: !!pp.ok, error: pp.error || null },
    pco: { enabled: !!pco, error: pco?.error || null, series: pco?.series, dates: pco?.dates, service_type: pco?.service_type || null, title: pco?.title || null, note: pco?.note || null }, demo: !!cfg.demo };

  const si = pp.slide_index?.presentation_index || {};
  const pid = si.presentation_id || {};
  const cur = typeof si.index === 'number' ? si.index : null;
  const pres = pp.presentation?.presentation || {};
  const slides = [];
  for (const g of pres.groups || []) for (const s of g.slides || [])
    slides.push({ group: g.name || '', label: s.label || '', text: (s.text || '').trim() });

  // message
  // Is the deck that's up the message? Any of: the deck name matches the optional pattern, the playlist item is called
  // message/sermon/teaching, or Planning Center's current item is the message (from the last second's tracking).
  const MSG_WORDS = /\b(message|sermon|teaching|preaching|homily)\b/i;
  let byPattern = false;
  try { byPattern = !!(cfg.message_name_pattern && pid.name && new RegExp(cfg.message_name_pattern).test(pid.name)); } catch { /* bad pattern */ }
  const plName = pp.active_playlist?.presentation?.item?.name || '';
  const byRow = TRACK.curTitle && MSG_WORDS.test(TRACK.curTitle) && TRACK.curDeck === pid.uuid;
  const isMsg = !!pid.uuid && (byPattern || MSG_WORDS.test(plName) || MSG_WORDS.test(pid.name || '') || byRow);
  let msg = null;
  if (isMsg && slides.length) {
    const mk = isoDay(new Date()) + ' ' + (serviceStart(pco)[1] || '') + ' ' + pid.uuid;
    if (TRACK.msgUuid !== mk) { TRACK.msgUuid = mk; TRACK.msgStarted = (TRACK.msgStarts[mk] ||= now); }
    let points = slides.map((s, i) => [i, s.label]).filter(([, l]) => /^Point\s*\d+/i.test(l));
    if (!points.length) { let prevG = null; points = slides.map((s, i) => { const g = s.group; const hit = g !== prevG && /^Point\s*\d+/i.test(g || ''); prevG = g; return hit ? [i, g] : null; }).filter(Boolean); }
    if (!points.length) points = slides.map((s, i) => { const m = s.text.match(/^(\d+)\.\s/); return m ? [i, 'Point ' + m[1]] : null; }).filter(Boolean);
    let pointNow = null;
    for (const [i, l] of points) if (cur !== null && i <= cur) pointNow = l;
    const labOf = i => { const s = slides[i]; return !s ? '' : (s.label || s.group || s.text.split('\n')[0].slice(0, 60)); };
    const last = Math.max(1, slides.length - 1);
    msg = { name: pid.name, index: cur, count: slides.length, pct: cur === null ? 0 : 100 * cur / last,
      points: points.map(([i, l]) => ({ at: 100 * i / last, label: l })), point_now: pointNow, point_count: points.length,
      current_label: labOf(cur), current_text: cur !== null && slides[cur] ? slides[cur].text : '',
      next_label: labOf((cur || 0) + 1), elapsed: TRACK.msgStarted ? fmtSecs((now - TRACK.msgStarted) / 1000) : null };
  }
  // timers
  state.timers = (pp.timers || []).map(t => ({ name: t.id?.name || t.name, time: t.time, state: t.state }));
  state.message_timer = (cfg.message_timer_name ? state.timers.find(t => t.name === cfg.message_timer_name)
    : (state.timers.find(t => MSG_WORDS.test(t.name || '')) || state.timers.find(t => t.state === 'running' && parseClock(t.time) !== null))) || null;
  if (state.message_timer) state.message_timer_label = state.message_timer.name || 'Timer';
  { const l = parseClock(state.message_timer?.time); if (l !== null && state.message_timer.state !== 'stopped') state.timer_target = clock(new Date(now + l * 1000)); }

  // pace: how far through the deck vs how long he's been going -> projected finish, vs the Message Timer target
  if (msg) {
    const elapsed = TRACK.msgStarted ? (now - TRACK.msgStarted) / 1000 : 0;
    const frac = msg.pct / 100;
    if (elapsed > 90 && frac > 0.08) {
      const remaining = elapsed / frac - elapsed;
      msg.remaining = fmtSecs(remaining);
      msg.projected_finish = clock(new Date(now + remaining * 1000));
      msg.projected_ts = now + remaining * 1000;
    }
    const left = parseClock(state.message_timer?.time);
    if (left !== null) {
      msg.target = clock(new Date(now + left * 1000));
      if (msg.projected_ts) { const d = (msg.projected_ts - (now + left * 1000)) / 1000; msg.pace = (d >= 0 ? '+' : '') + fmtSecs(d); msg.pace_secs = d; }
    }
  }
  state.message = msg;

  // any other deck that's up (songs etc.): progress through its slides, sections as marks
  if (!isMsg && slides.length > 1 && cur !== null) {
    const last = slides.length - 1, marks = []; let prev = null, sec = '';
    slides.forEach((sl, i) => { const g = sl.group || sl.label || ''; if (g && g !== prev) marks.push({ at: 100 * i / last, label: abbrSection(g) }); if (i <= cur && g) sec = g; prev = g; });
    state.deck = { name: pid.name || '', index: cur, count: slides.length, pct: 100 * cur / last, marks: marks.length > 1 ? marks : [], section: sec };
  }
  // message % stays on screen after the message ends (per service)
  const mpk = isoDay(new Date()) + ' ' + (serviceStart(pco)[1] || '');
  if (msg) TRACK.msgPct[mpk] = msg.pct;
  state.message_pct = TRACK.msgPct[mpk] ?? null;

  // rundown
  const ap = pp.active_playlist?.presentation || {};
  const plItem = ap.item || {};
  const items = pp.playlist?.items || [];
  const rundown = items.map(it => ({ name: it.id?.name || '', type: it.type || '', current: !!(plItem.uuid && it.id?.uuid === plItem.uuid) }));
  state.playlist = ap.playlist?.name || null;

  const pcoItems = [];
  for (const it of pco?.items || []) {          // stop at "Resources" (warm-ups etc. aren't part of the service)
    if (it.type === 'header' && /^resources\b/.test(norm(it.title))) break;
    pcoItems.push(it);
  }
  const [start, svc] = serviceStart(pco);
  state.service = svc;
  const rows = [];
  const hm = ts => clock(new Date(ts)).replace(/\s?[AP]M$/i, '');
  if (pcoItems.length) {
    let t = start ? start.getTime() : null;
    for (const it of pcoItems) {
      const r = { title: it.title, type: it.type, length: it.length, position: it.position, desc: it.desc || '', planned: null };
      if (t !== null && it.position !== 'pre' && it.position !== 'post') { r.planned = hm(t); r.planned_ts = t; t += (it.length || 0) * 1000; }
      rows.push(r);
    }
    if (t !== null) { state.service_end_planned = clock(new Date(t)); state.service_end_planned_ts = t; }
  }

  // ---- which Planning Center item is on now (sticky, forward-biased, debounced)
  const dayKey = isoDay(new Date());
  const svcName = svc || 'service';
  if (TRACK.svcKey !== dayKey + ' ' + svcName)
    Object.assign(TRACK, { svcKey: dayKey + ' ' + svcName, cur: null, curStart: null, pend: null, pendSince: null, lastSeen: null, done: false });
  const runs = store.svc(dayKey, svcName);
  const keys = rows.map((r, i) => rowKeyOf(rows, i));
  const isMsgRow = i => i !== null && i >= 0 && rows[i] && MSG_WORDS.test(rows[i].title) && rows[i].type !== 'header';

  let seen = null;
  if (pco?.live_item_id) { const i = pcoItems.findIndex(it => it.id === pco.live_item_id); if (i >= 0) seen = i; }
  state.match = null;
  if (seen === null && rows.length && plItem.name) {
    // 1) where this playlist item lines up in the Planning Center order
    const ppList = (pp.playlist?.items || []).filter(it => it.type !== 'header');
    const m = ppList.length ? alignOrder(ppList, rows).get(plItem.uuid) : null;
    if (m) { seen = m.row; state.match = m.guess ? 'guess' : 'name'; }
    // 2) otherwise the closest name, preferring items at or after where we are
    if (seen === null) {
      const from = TRACK.cur ?? 0;
      let best = null, bestS = 0;
      rows.forEach((r, i) => { if (r.type === 'header') return;
        const sc = simName(plItem.name, r.title) - (i < from ? 0.15 : 0) - (i > from + 4 ? 0.05 : 0);
        if (sc > bestS) { bestS = sc; best = i; } });
      if (best !== null && bestS >= 0.55) { seen = best; state.match = 'name'; }
    }
  }
  if (seen === null && isMsg) { const j = rows.findIndex((r, i) => isMsgRow(i)); if (j >= 0) seen = j; }
  // a deck we can't match by name, right when the order says the message is next -> that's the message
  if (seen === null && pid.uuid && TRACK.cur !== null && slides.length >= 6) {
    let nx = TRACK.cur + 1; while (nx < rows.length && (rows[nx].type === 'header' || !rows[nx].planned_ts)) nx++;
    if (isMsgRow(nx)) seen = nx;
  }

  if (seen !== null && seen !== TRACK.cur) {
    if (TRACK.pend !== seen) { TRACK.pend = seen; TRACK.pendSince = now; }
    const hold = (TRACK.cur === null || isMsgRow(seen)) ? 0 : 4000;   // ignore quick clicks through the playlist
    if (now - TRACK.pendSince >= hold) {
      if (TRACK.cur !== null) store.finish(runs, keys[TRACK.cur], TRACK.pendSince, rows[TRACK.cur], cfg.demo);
      const rec = runs.rows[keys[seen]];
      TRACK.cur = seen; TRACK.curStart = rec && rec.start && !rec.end ? rec.start : TRACK.pendSince;
      store.begin(runs, keys[seen], TRACK.curStart); TRACK.pend = null; TRACK.done = false;
    }
  } else if (seen !== null) TRACK.pend = null;
  if (seen !== null && seen === TRACK.cur) TRACK.lastSeen = now;

  // last item of the service and ProPresenter has moved off it for 30 s -> service is over, freeze
  const timeline = rows.map((r, i) => i).filter(i => rows[i].planned_ts && rows[i].type !== 'header');
  const lastRow = timeline.length ? timeline[timeline.length - 1] : null;
  if (TRACK.cur !== null && TRACK.cur === lastRow && seen !== TRACK.cur && TRACK.lastSeen && now - TRACK.lastSeen > 30000 && !TRACK.done) {
    store.finish(runs, keys[TRACK.cur], TRACK.lastSeen, rows[TRACK.cur], cfg.demo); TRACK.done = true;
  }
  const curRow = TRACK.cur;
  rows.forEach((r, i) => { r.current = i === curRow && !TRACK.done; });
  if (curRow !== null && rows[curRow]) { if (TRACK.curTitle !== rows[curRow].title) TRACK.curDeck = pid.uuid; TRACK.curTitle = rows[curRow].title; }

  // ---- expected length of each item: the earlier service today, else the median of past Sundays, else PCO
  const otherSvcs = Object.entries(store.day(dayKey)).filter(([n]) => n !== svcName).map(([, v]) => v.rows || {});
  const expected = i => {
    const r = rows[i]; if (r.type === 'header') return 0;
    for (const o of otherSvcs) { const x = o[keys[i]]; if (x && x.start && x.end) return (x.end - x.start) / 1000; }
    const k = avgKeyOf(r); const m = k ? store.median(k) : null;
    return m != null ? m : (r.length || 0);
  };

  let drift = null;
  if (curRow !== null) {
    const r = rows[curRow], A = TRACK.curStart, endT = TRACK.done ? TRACK.lastSeen : now, el = (endT - A) / 1000;
    if (r.planned_ts) drift = (A - r.planned_ts) / 1000 + Math.max(0, el - (r.length || 0));   // late start + running long
    state.current_item = r.title; state.current_item_desc = r.desc || ''; state.current_item_type = r.type || '';
    state.current_item_length = fmtSecs(r.length || 0);
    state.current_item_elapsed = fmtSecs(el);
    state.current_item_el_s = Math.round(el); state.current_item_len_s = r.length || 0;
    state.current_item_started = clock(new Date(A));
    // projected times for what's left
    let t = TRACK.done ? TRACK.lastSeen : A + Math.max(expected(curRow), el) * 1000;
    if (!TRACK.done && isMsgRow(curRow) && msg?.projected_ts) t = Math.max(now, msg.projected_ts);
    for (let j = curRow + 1; j < rows.length; j++) {
      if (!rows[j].planned_ts) continue;
      rows[j].proj = hm(t); rows[j].proj_late = Math.round((t - rows[j].planned_ts) / 1000); t += expected(j) * 1000;
    }
    if (state.service_end_planned_ts) {
      state.service_end_projected = clock(new Date(t));
      state.service_end_vs = Math.round((t - state.service_end_planned_ts) / 1000);
    }
  } else {
    state.current_item = plItem.name || pid.name || null;
  }
  rows.forEach((r, i) => { const x = runs.rows[keys[i]]; if (x && x.start && (i < (curRow ?? -1) || (i === curRow))) r.actual = hm(x.start); });
  if (TRACK.done) state.service_done = true;
  state.drift = drift === null ? null : (drift >= 0 ? '+' : '') + fmtSecs(drift);
  state.drift_secs = drift;
  state.rundown = rows.length ? rows : rundown.map(r => ({ title: r.name, type: r.type, current: r.current, planned: null, length: null }));
  return state;
}

// ------------------------------------------------------------------ demo data
const DEMO_T0 = Date.now();
function demoPP() {
  const k = Math.floor((Date.now() - DEMO_T0) / 3000) % 34;
  if (process.env.TFC_DEMO_SONG) {   // song phase for testing the song timeline
    const gs = [['Intro', 1], ['Verse 1', 4], ['Chorus', 4], ['Verse 2', 4], ['Chorus', 4], ['Bridge', 4], ['Chorus', 4], ['Tag', 2]];
    const groups = gs.map(([name, n]) => ({ name, slides: Array.from({ length: n }, (_, i) => ({ label: '', text: name + ' line ' + (i + 1) })) }));
    const j = 12 + Math.floor((Date.now() - DEMO_T0) / 4000) % 15;
    return { ok: true, slide_index: { presentation_index: { index: j, presentation_id: { uuid: 'demo-song', name: 'The Joy' } } },
      presentation: { presentation: { groups } }, timers: [{ id: { name: 'Message Timer' }, time: '00:40:00', state: 'stopped' }],
      active_playlist: { presentation: { playlist: { uuid: 'demo-pl', name: 'The Comeback' }, item: { uuid: 'i5', name: 'The Joy' } } }, playlist: { items: [] } };
  }
  const labels = ['', '9AM', '11AM', 'Title', 'Big Idea', 'Micah 7:8', 'Matthew 26:35', 'Statement', 'Matthew 26:35', 'Big Idea',
    'Point 1', 'Luke 22:61', 'Luke 22:62', 'Luke 22:31-32', 'Point 2', 'Mark 16:7', 'John 21:3', 'John 21:4-6', 'John 21:6-7',
    'John 21:8-10', 'John 21:11-12', 'John 21:13-14', 'John 18:18', 'Statement', 'Point 3', 'John 21:15', 'John 21:16', 'John 21:17',
    'John 21:18-19', 'Matthew 4:19', 'Acts 2:14', 'Acts 2:36-38', 'Acts 2:41', 'Statement'];
  const texts = labels.map((_, i) => i < 3 ? '' : `Slide ${i} text`);
  texts[3] = 'SERMON SERIES — WEEK 1\n“Failure Isn’t Final”';
  texts[10] = '1. Your failure doesn’t have to define you';
  texts[14] = '2. Jesus doesn’t give up on you when you fall short';
  texts[24] = '3. God can still use what you thought you ruined';
  const items = ['Pre-Service', 'Pre-Roll', 'Welcome', 'Open Service', 'Worship Set', 'The Joy', 'Build My Life', 'More Than Able',
    'Close Worship/Transition', 'Close Worship', 'Welcome & Offering', 'Church News', 'Bumper Video', 'Message', '11.01.26',
    'Next Steps & Closing', 'Next Steps & Reminders', 'Close Service'];
  const heads = new Set(['Pre-Service', 'Welcome', 'Worship Set', 'Close Worship/Transition', 'Message', 'Next Steps & Closing']);
  const mm = 31 - Math.floor(k / 2), ss = 59 - (k * 7) % 60;
  return { ok: true,
    slide_index: { presentation_index: { index: k, presentation_id: { uuid: 'demo-msg', name: '11.01.26' } } },
    presentation: { presentation: { groups: [{ name: '', slides: labels.map((l, i) => ({ label: l, text: texts[i] })) }] } },
    status_slide: { current: { text: texts[k] }, next: { text: texts[Math.min(k + 1, 33)] } },
    timers: [{ id: { name: 'Message Timer' }, time: `00:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, state: 'running' }],
    active_playlist: { presentation: { playlist: { uuid: 'demo-pl', name: 'Sunday Playlist' }, item: { uuid: 'i14', name: '11.01.26' } } },
    playlist: { items: items.map((n, i) => ({ id: { uuid: 'i' + i, name: n }, type: heads.has(n) ? 'header' : 'presentation' })) } };
}
function demoPCO() {
  const d = new Date(); const s9 = new Date(d); s9.setHours(9, 0, 0, 0); const s11 = new Date(d); s11.setHours(11, 0, 0, 0);
  const rows = [['Pre-Service', 'header', 0, 'during'], ['Pre-Roll', 'item', 279, 'pre'], ['Welcome', 'header', 0, 'during'],
    ['Open Service: Maya', 'item', 15, 'during'], ['Worship Set', 'header', 0, 'during'], ['The Joy', 'song', 445, 'during'],
    ['Build My Life', 'song', 310, 'during'], ['More Than Able', 'song', 300, 'during'], ['Close Worship/Transition', 'header', 0, 'during'],
    ['Close Worship: Pastor Sam Lee', 'item', 240, 'during'], ['Welcome 1st Time Guests & Offering: Pastor Sam Lee', 'item', 240, 'during'],
    ['Church News', 'item', 135, 'during'], ['Bumper Video', 'item', 30, 'during'], ['Message', 'header', 0, 'during'],
    ['Message: Pastor Sam Lee', 'item', 2400, 'during'], ['Next Steps & Closing', 'header', 0, 'during'],
    ['Next Steps & Reminders: Jordan Price', 'item', 120, 'during'], ['Close Service: Jordan Price', 'item', 30, 'during']];
  return { id: 'demo', series: 'Sermon Series', dates: 'November 1, 2026',
    items: rows.map(([title, type, length, position], i) => ({ id: String(i), title, type, length, position,
      desc: ({ 'The Joy': 'Maya', 'Build My Life': 'Chris', 'More Than Able': 'Ana', 'Close Worship: Pastor Sam Lee': 'Communion' })[title] || '' })),
    times: [{ name: '9AM', starts_at: s9.toISOString() }, { name: '11AM', starts_at: s11.toISOString() }], live_item_id: process.env.TFC_DEMO_SONG ? null : '14' };
}

// ------------------------------------------------------------------ service
class StatusService {
  constructor(configPath, htmlPath) {
    this.configPath = configPath; this.htmlPath = htmlPath;
    this.cfg = this.loadConfig(); this.state = {}; this.timer = null; this.server = null;
    this.rebuildClients();
  }
  loadConfig() {
    let c = { ...DEFAULTS };
    try { if (fs.existsSync(this.configPath)) c = { ...c, setup_done: true, ...JSON.parse(fs.readFileSync(this.configPath, 'utf8')) }; }
    catch (e) { console.error('config', e); }
    return c;
  }
  saveConfig(patch) {
    const allowed = ['pp_host', 'pp_port', 'page_port', 'pco_app_id', 'pco_secret', 'pco_service_type_id', 'message_timer_name', 'demo'];
    for (const k of allowed) if (k in patch) this.cfg[k] = patch[k];
    this.cfg.pp_port = parseInt(this.cfg.pp_port, 10) || DEFAULTS.pp_port;
    this.cfg.pco_service_type_id = parseInt(this.cfg.pco_service_type_id, 10) || null;
    this.cfg.setup_done = true;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.cfg, null, 2));
    this.rebuildClients();
  }
  rebuildClients() { this.pp = new ProPresenter(this.cfg); this.pco = new PCO(this.cfg); }
  runsFor() {   // demo mode never touches the real history
    const want = this.cfg.demo ? 'demo' : 'live';
    if (this._runsKind !== want) { this._runsKind = want; this._runs = new RunStore(this.cfg.demo ? null : path.join(path.dirname(this.configPath), 'runs.json')); }
    return this._runs;
  }
  async poll() {
    try {
      let ppSnap, pcoPlan;
      if (this.cfg.demo) { ppSnap = demoPP(); pcoPlan = demoPCO(); }
      else { ppSnap = await this.pp.snapshot(); pcoPlan = this.pco.pickNow(ppSnap); }
      this.state = buildState(this.cfg, ppSnap, pcoPlan, this.runsFor());
      this.runsFor().save();
    } catch (e) { this.state = { fatal: String(e), now: clockSec(new Date()) }; }
    this.state.urls = lanAddresses().map(a => `http://${a}:${this.cfg.page_port}`);
  }
  publicSettings() {
    const c = this.cfg;
    return { pp_host: c.pp_host, pp_port: c.pp_port, page_port: c.page_port, pco_app_id: c.pco_app_id,
      pco_secret_set: !!c.pco_secret, pco_service_type_id: c.pco_service_type_id, message_timer_name: c.message_timer_name || '', demo: !!c.demo };
  }
  start() {
    const loop = async () => { await this.poll(); this.timer = setTimeout(loop, 1000); };
    loop();
    this.server = http.createServer((req, res) => this.handle(req, res));
    // Use the saved port (8787 the first time). If something else has it, take the next free one
    // (8788, 8789…) and save it, so phones keep the same address on every launch until it has to change.
    const listen = port => new Promise((resolve, reject) => {
      const onErr = e => { this.server.off('listening', onOk); reject(e); };
      const onOk = () => { this.server.off('error', onErr); resolve(port); };
      this.server.once('error', onErr); this.server.once('listening', onOk);
      this.server.listen(port, '0.0.0.0');
    });
    const first = parseInt(this.cfg.page_port, 10) || DEFAULTS.page_port;
    return (async () => {
      let err;
      for (let p = first; p < first + 40; p++) {
        try {
          const port = await listen(p);
          if (port !== this.cfg.page_port) {
            this.cfg.page_port = port;
            try {   // remember it (without marking setup as done)
              fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
              fs.writeFileSync(this.configPath, JSON.stringify({ ...this.cfg, setup_done: !!this.cfg.setup_done }, null, 2));
            } catch (e) { console.error('save port', e); }
          }
          return port;
        } catch (e) { err = e; if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') break; }
      }
      throw err;
    })();
  }
  handle(req, res) {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (req.url.startsWith('/api/state')) return send(200, 'application/json', JSON.stringify({ ...this.state, can_edit: local, setup_needed: local && !this.cfg.setup_done, update: local ? (this.update || null) : null }));
    if (req.url.startsWith('/api/update') && req.method === 'POST') {     // restart / check now (booth computer only)
      if (!local) return send(403, 'application/json', '{}');
      let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
        let a = ''; try { a = JSON.parse(body || '{}').action; } catch {}
        send(200, 'application/json', '{"ok":true}');
        if (this.onUpdateAction && ['restart', 'check', 'installer'].includes(a)) setTimeout(() => this.onUpdateAction(a), 200);
      });
      return;
    }
    if (req.url.startsWith('/api/options')) {          // choices for Settings: their PCO service types + their ProPresenter timers
      if (!local) return send(403, 'application/json', '{}');
      (async () => {
        const out = { service_types: [], timers: [], pco_error: null, pp_error: null };
        try { out.service_types = this.pco.enabled ? await this.pco.serviceTypes() : []; } catch (e) { out.pco_error = e.message; }
        try { const t = await this.pp.get('/v1/timers'); out.timers = (t || []).map(x => x.id?.name || x.name).filter(Boolean); } catch (e) { out.pp_error = e.message; }
        send(200, 'application/json', JSON.stringify(out));
      })();
      return;
    }
    if (req.url.startsWith('/api/settings')) {
      if (!local) return send(403, 'application/json', '{"error":"settings can only be changed on the booth computer"}');
      if (req.method === 'GET') return send(200, 'application/json', JSON.stringify(this.publicSettings()));
      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try {
            const p = JSON.parse(body || '{}');
            if (p.pco_secret === '') delete p.pco_secret;   // blank = keep the saved secret
            if (p.clear_pco) { p.pco_app_id = ''; p.pco_secret = ''; }
            this.saveConfig(p);
            send(200, 'application/json', JSON.stringify(this.publicSettings()));
          } catch (e) { send(400, 'application/json', JSON.stringify({ error: String(e) })); }
        });
        return;
      }
    }
    if (req.url.startsWith('/icon.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
      return res.end(fs.readFileSync(path.join(path.dirname(this.htmlPath), 'icon.png')));
    }
    if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?'))
      return send(200, 'text/html; charset=utf-8', fs.readFileSync(this.htmlPath));
    send(404, 'text/plain', 'not found');
  }
  stop() { clearTimeout(this.timer); this.server?.close(); }
}

module.exports = { StatusService, DEFAULTS, buildState, RunStore, TRACK, PCO, simName, alignOrder };

if (require.main === module) {   // node server.js [--demo]
  const svc = new StatusService(path.join(__dirname, 'dev-config.json'), path.join(__dirname, 'index.html'));
  if (process.argv.includes('--demo')) svc.cfg.demo = true;
  svc.start().then(p => console.log(`Service Status on :${p} ${svc.cfg.demo ? '(demo)' : ''}`));
}
