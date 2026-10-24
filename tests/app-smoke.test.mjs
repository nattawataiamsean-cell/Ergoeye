// Runs the page script from index.html against a minimal fake DOM and drives the user flows:
// method switch, live frames + alarm, saving a posture, the Apps Script payload and CSV export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pose, both } from './helpers/pose.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));

// ---------- fake DOM ----------
const noopCtx = new Proxy({}, { get: (_, k) => k === 'measureText' ? () => ({ width: 10 }) : () => { }, set: () => true });
function makeEl(id, tag = 'DIV') {
  const listeners = {}, cls = new Set();
  const el = {
    id, tagName: tag, value: '', checked: false, hidden: false, disabled: false, innerHTML: '', textContent: '',
    selectedIndex: 0, width: 960, height: 720, clientWidth: 800, style: {}, dataset: {}, attrs: {}, children: [],
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on) => (on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)
    },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, removeAttribute() { },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t) { (listeners[t] || []).forEach(f => f({ target: el })); },
    appendChild(c) { this.children.push(c); }, getContext: () => noopCtx,
    click() { if (this.onclick) this.onclick(); this.fire('click'); }, remove() { },
    play: async () => { }, pause() { }, toDataURL: () => 'data:image/jpeg;base64,AA'
  };
  let inner = '';
  Object.defineProperty(el, 'innerHTML', { get: () => inner, set: v => { inner = v; if (v === '') el.children = []; } });
  return el;
}
const els = {};
for (const m of html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)) els[m[2]] = makeEl(m[2], m[1].toUpperCase());
// form defaults as in the HTML
Object.assign(els.fLoad, { value: '0' }); Object.assign(els.fSide, { value: 'auto' }); Object.assign(els.fWrist, { value: 'straight' });
Object.assign(els.fRebaLoad, { value: '0' }); Object.assign(els.fCoupling, { value: '0' }); Object.assign(els.fAlert, { value: '5' });
els.fLegs.checked = true;
const segButtons = ['RULA', 'REBA'].map(m => Object.assign(makeEl('seg' + m, 'BUTTON'), { dataset: { m } }));
const groups = ['RULA', 'REBA'].map(m => Object.assign(makeEl('grp' + m), { dataset: { method: m } }));

const storage = new Map(), fetched = [], blobs = [];
let clock = 0;
Object.assign(globalThis, {
  document: {
    getElementById: id => els[id] || (els[id] = makeEl(id)),
    createElement: t => makeEl('', t.toUpperCase()),
    querySelectorAll: sel => sel === '.rung' ? els.ladder.children : sel === '#methodSeg button' ? segButtons : sel === '[data-method]' ? groups : [],
    documentElement: {}, body: makeEl('body')
  },
  localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
  getComputedStyle: () => ({ getPropertyValue: k => k }),
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => { }, devicePixelRatio: 1,
  window: { addEventListener() { } }, confirm: () => true, Image: class { },
  fetch: async (url, o) => { fetched.push({ url, body: JSON.parse(o.body) }); return {}; }
});
Object.defineProperty(globalThis, 'navigator', { value: { vibrate() { } }, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
URL.createObjectURL = b => { blobs.push(b); return 'blob:x'; };
const realError = console.error; console.error = () => { }; // model download fails offline, that is expected

const App = new Function(script + `
  return { handleResult, setMethod, recompute,
    state: () => ({ method, lastResult, records, session, alarmOn }) };`)();

const frame = lm => ({ worldLandmarks: [lm], landmarks: [lm.map(p => ({ x: .5, y: .5, visibility: p.visibility }))] });
const STAND = frame(pose());
const LIFT = frame(pose({ trunk: 70, neck: 30, arms: both({ flex: 70, elbow: 10 }), knees: both(50) }));
const flush = () => new Promise(r => setTimeout(r, 0));
const live = (res, secs) => { for (let i = 0; i < secs * 4; i++) { clock += 250; App.handleResult(res, false); } };

test('starts on the stored method (RULA by default) with a 7-rung ladder', () => {
  assert.equal(App.state().method, 'RULA');
  assert.equal(els.ladder.children.length, 7);
  assert.equal(groups[0].hidden, false); assert.equal(groups[1].hidden, true);
  assert.equal(segButtons[0].attrs['aria-pressed'], 'true');
});

test('RULA still works on a still image, wrist card says entered manually', () => {
  App.handleResult(STAND, true);
  const r = App.state().lastResult;
  assert.equal(r.method, 'RULA');
  assert.match(els.parts.innerHTML, /ข้อมือ \(ซ้าย\)|ข้อมือ \(ขวา\)/);
  assert.match(els.parts.innerHTML, /ตรง \(กรอกเอง\)/);
  assert.match(els.vTitle.textContent, /^RULA \d/);
});

test('switching to REBA recomputes the same frame without restarting, shows 5 bands and a knee card', () => {
  segButtons[1].fire('click');
  const st = App.state();
  assert.equal(st.method, 'REBA'); assert.equal(storage.get('ergoeye:method'), '"REBA"');
  assert.equal(st.lastResult.method, 'REBA');
  assert.equal(groups[0].hidden, true); assert.equal(groups[1].hidden, false);
  assert.equal(els.ladder.children.length, 5);
  assert.equal(els.ladder.dataset.m, 'REBA');
  const cur = els.ladder.children.filter(r => r.classList.contains('current'));
  assert.equal(cur.length, 1); assert.match(cur[0].innerHTML, /<span>1<\/span>/);
  assert.match(els.parts.innerHTML, /เข่า/);
  assert.match(els.vTitle.textContent, /^REBA 1 — ความเสี่ยงต่ำมาก/);
  assert.match(els.legend.innerHTML, /สูงมาก \(11–15\)/);
});

test('REBA alarm fires after the score stays at 8+ longer than the alert time, and clears', () => {
  els.fRebaLoad.value = '2'; els.fRebaLoad.fire('change');
  els.fCoupling.value = '1'; els.fCoupling.fire('change');
  els.fActRepeat.checked = true; els.fActRepeat.fire('change');
  live(LIFT, 3);
  assert.equal(App.state().alarmOn, false, 'not before 5 s');
  live(LIFT, 4);
  assert.equal(App.state().alarmOn, true);
  assert.equal(App.state().session.max, 11);
  assert.ok(App.state().session.levelTime[5] > 0, 'time counted in risk level 5');
  assert.match(els.dist.innerHTML, /ระดับ 5/);
  live(STAND, 3);
  assert.equal(App.state().alarmOn, false);
});

test('saving a REBA posture stores and sends the REBA fields', async () => {
  els.fHook.value = 'https://script.google.com/macros/s/x/exec';
  els.fStation.value = 'คลัง B'; els.fTask.value = 'ยกกล่อง';
  live(LIFT, 3);
  els.btnSnap.onclick(); await flush();
  const rec = App.state().records.at(-1);
  assert.equal(rec.method, 'REBA'); assert.equal(rec.final, 11); assert.equal(rec.risk, 5);
  const sent = fetched.at(-1).body;
  for (const k of ['method', 'final', 'risk', 'scoreA', 'scoreB', 'tableC', 'parts', 'angles', 'load', 'shock', 'coupling', 'activity'])
    assert.ok(k in sent, 'payload has ' + k);
  assert.deepEqual(Object.keys(sent.parts).sort(), ['legs', 'lower', 'neck', 'trunk', 'upper', 'wrist']);
  assert.deepEqual(Object.keys(sent.angles).sort(), ['elbow', 'knee', 'neck', 'trunk', 'upperArm']);
  assert.deepEqual(sent.parts, { trunk: 4, neck: 2, legs: 2, upper: 3, lower: 2, wrist: 1 });
  assert.equal(sent.angles.knee, 50); assert.equal(sent.angles.trunk, 70);
  assert.deepEqual(sent.activity, { static: false, repeat: true, rapid: false });
  assert.equal(sent.load, 2); assert.equal(sent.coupling, 1); assert.equal(sent.shock, false);
  assert.ok(!('img' in sent));
  assert.match(els.records.innerHTML, /<span class="tag">REBA<\/span>/);
});

test('saving a RULA posture keeps the original field names and adds method', async () => {
  segButtons[0].fire('click');
  assert.equal(App.state().method, 'RULA'); assert.equal(els.ladder.children.length, 7);
  live(LIFT, 2);
  els.btnSnap.onclick(); await flush();
  const sent = fetched.at(-1).body;
  assert.deepEqual(Object.keys(sent).sort(),
    ['angles', 'assessor', 'final', 'level', 'load', 'method', 'muscle', 'parts', 'scoreC', 'scoreD', 'side', 'station', 'task', 'time']);
  assert.equal(sent.method, 'RULA');
  assert.deepEqual(Object.keys(sent.parts).sort(), ['legs', 'lower', 'neck', 'trunk', 'upper', 'wrist']);
  assert.deepEqual(Object.keys(sent.angles).sort(), ['elbow', 'neck', 'trunk', 'upperArm', 'wrist']);
  assert.equal(sent.angles.wrist, null, 'wrist angle blank when entered manually');
  assert.match(els.records.innerHTML, /<span class="tag">RULA<\/span>/);
});

test('RULA alarm still fires at action level 3+', () => {
  live(STAND, 2); assert.equal(App.state().alarmOn, false);
  live(LIFT, 7); assert.equal(App.state().alarmOn, false, 'lifting with no load is RULA 4 (level 2)');
  els.fLoad.value = '3'; els.fLoad.fire('change'); // > 10 kg: C 6, D 8 -> RULA 7
  live(LIFT, 7); assert.equal(App.state().alarmOn, true);
  assert.equal(App.state().lastResult.final, 7);
});

test('CSV has the method column and both kinds of rows', async () => {
  els.btnCsv.onclick();
  const text = await blobs.at(-1).text();
  const [head, ...rows] = text.replace(/^﻿/, '').split('\n');
  assert.match(head, /"วิธีประเมิน"/); assert.match(head, /"มุมเข่า"/); assert.match(head, /"การจับ \(REBA\)"/);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /"REBA","11","5"/);
  assert.match(rows[0], /"พอใช้","ทำซ้ำเกิน 4 ครั้งต่อนาที"$/);
  assert.match(rows[1], /"RULA"/);
  const cols = head.split('","').length;
  rows.forEach(r => assert.equal(r.split('","').length, cols, 'row width matches header'));
});

test('an old record without method is shown as RULA', () => {
  App.state().records.unshift({ time: new Date().toISOString(), task: 'เก่า', final: 5, level: 3, parts: { upper: 2, lower: 1, wrist: 2, neck: 1, trunk: 2, legs: 1 }, angles: {}, img: '' });
  els.btnClear.disabled = false;
  els.btnCsv.onclick();
  return blobs.at(-1).text().then(t => assert.match(t.split('\n')[1], /"RULA","5","3"/));
});

test.after(() => { console.error = realError; });
