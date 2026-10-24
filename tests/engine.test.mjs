// Run: node --test tests/engine.test.mjs tests/app-smoke.test.mjs tests/appscript.test.mjs
// Checks computeREBA against hand-worked REBA sheets and checks that computeRULA
// still returns exactly what the original engine (tests/fixtures/rula-engine-baseline.js) returned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pose, both } from './helpers/pose.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const s = html.indexOf('// @engine-start'), e = html.indexOf('// @engine-end');
assert.ok(s > 0 && e > s, 'engine markers not found in index.html');
const E = new Function(html.slice(s, e) + '\nreturn { computeRULA, computeREBA, rebaRisk, rulaLevel, wristScore, REBA_A, REBA_B, REBA_C };')();
const OLD = new Function(read('./fixtures/rula-engine-baseline.js') + '\nreturn { computeRULA };')();

const pick = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k]]));
const scores = r => Object.fromEntries(Object.entries(r.parts).map(([k, p]) => [k, p.score]));

// ---------- tables against the published REBA sheet ----------
test('REBA tables have the published shape and spot values', () => {
  assert.equal(E.REBA_A.length, 5); E.REBA_A.forEach(t => { assert.equal(t.length, 3); t.forEach(r => assert.equal(r.length, 4)); });
  assert.equal(E.REBA_B.length, 6); E.REBA_B.forEach(t => { assert.equal(t.length, 2); t.forEach(r => assert.equal(r.length, 3)); });
  assert.equal(E.REBA_C.length, 12); E.REBA_C.forEach(r => assert.equal(r.length, 12));
  // spot values from Hignett & McAtamney (2000)
  assert.equal(E.REBA_A[0][2][0], 3); assert.equal(E.REBA_A[4][2][3], 9); assert.equal(E.REBA_A[2][1][1], 5);
  assert.equal(E.REBA_B[0][0][2], 2); assert.equal(E.REBA_B[5][1][2], 9); assert.equal(E.REBA_B[3][1][2], 7);
  assert.equal(E.REBA_C[0][0], 1); assert.equal(E.REBA_C[5][8], 10); assert.equal(E.REBA_C[11][0], 12); assert.equal(E.REBA_C[7][4], 10);
  // Table C never decreases along either axis
  for (const t of E.REBA_C) for (let j = 1; j < 12; j++) assert.ok(t[j] >= t[j - 1]);
  for (let i = 1; i < 12; i++) for (let j = 0; j < 12; j++) assert.ok(E.REBA_C[i][j] >= E.REBA_C[i - 1][j]);
});

test('REBA risk bands: 1 / 2-3 / 4-7 / 8-10 / 11-15', () => {
  const want = { 1: 1, 2: 2, 3: 2, 4: 3, 7: 3, 8: 4, 10: 4, 11: 5, 15: 5 };
  for (const [sc, r] of Object.entries(want)) assert.equal(E.rebaRisk(+sc), r, 'score ' + sc);
});

test('wrist: manual choices map to each method criteria', () => {
  assert.deepEqual(['straight', 'flex15', 'flexOver'].map(m => E.wristScore('RULA', m, 99, false)), [1, 2, 3]);
  assert.deepEqual(['straight', 'flex15', 'flexOver'].map(m => E.wristScore('RULA', m, 99, true)), [2, 3, 4]);
  assert.deepEqual(['straight', 'flex15', 'flexOver'].map(m => E.wristScore('REBA', m, 0, false)), [1, 1, 2]);
  assert.deepEqual(['straight', 'flex15', 'flexOver'].map(m => E.wristScore('REBA', m, 0, true)), [2, 2, 3]);
  assert.deepEqual([0, 15, 16].map(a => E.wristScore('REBA', 'ai', a, false)), [1, 1, 2]);
  assert.deepEqual([5, 15, 16].map(a => E.wristScore('RULA', 'ai', a, false)), [1, 2, 3]);
});

// ---------- REBA on simulated postures ----------
test('REBA pose 1: standing upright, arms relaxed at the sides -> 1 (very low)', () => {
  const r = E.computeREBA(pose());
  assert.deepEqual(scores(r), { trunk: 1, neck: 1, legs: 1, upper: 1, lower: 2, wrist: 1 });
  assert.deepEqual(pick(r, ['tableA', 'scoreA', 'tableB', 'scoreB', 'tableC', 'final', 'risk']),
    { tableA: 1, scoreA: 1, tableB: 1, scoreB: 1, tableC: 1, final: 1, risk: 1 });
  assert.ok(r.knee.angle < 1);
});

test('REBA pose 2: bending 70 deg to lift a >10 kg box, knees 50, neck 30, repeated -> 11 (very high)', () => {
  const lm = pose({ trunk: 70, neck: 30, arms: both({ flex: 70, elbow: 10 }), knees: both(50) });
  const r = E.computeREBA(lm, { load: 2, coupling: 1, activity: { repeat: true } });
  assert.ok(Math.abs(r.parts.trunk.angle - 70) < 0.5, 'trunk angle ' + r.parts.trunk.angle);
  assert.ok(Math.abs(r.knee.angle - 50) < 0.5, 'knee angle ' + r.knee.angle);
  assert.deepEqual(scores(r), { trunk: 4, neck: 2, legs: 2, upper: 3, lower: 2, wrist: 1 });
  // Table A[4][2][2] = 6, +2 load = 8 ; Table B[3][2][1] = 4, +1 coupling = 5 ; Table C[8][5] = 10, +1 activity
  assert.deepEqual(pick(r, ['tableA', 'scoreA', 'tableB', 'scoreB', 'tableC', 'final', 'risk']),
    { tableA: 6, scoreA: 8, tableB: 4, scoreB: 5, tableC: 10, final: 11, risk: 5 });
});

test('REBA pose 3: arms overhead 160 deg, looking up, wrist bent and twisted, 5-10 kg, held -> 7 (medium)', () => {
  const lm = pose({ neck: -25, arms: both({ flex: 160, elbow: 20 }) });
  const r = E.computeREBA(lm, { load: 1, coupling: 2, wristMode: 'flex15', wristDev: true, activity: { static: true } });
  assert.ok(r.parts.neck.ext, 'neck extension detected');
  assert.ok(Math.abs(r.parts.upper.angle - 160) < 0.5);
  assert.deepEqual(scores(r), { trunk: 1, neck: 2, legs: 1, upper: 4, lower: 2, wrist: 2 });
  // Table A[1][2][1] = 1, +1 = 2 ; Table B[4][2][2] = 6, +2 = 8 ; Table C[2][8] = 6, +1
  assert.deepEqual(pick(r, ['tableA', 'scoreA', 'tableB', 'scoreB', 'tableC', 'final', 'risk']),
    { tableA: 1, scoreA: 2, tableB: 6, scoreB: 8, tableC: 6, final: 7, risk: 3 });
});

test('REBA trunk: flexion vs extension vs side bend', () => {
  const t = o => E.computeREBA(pose(o)).parts.trunk;
  assert.equal(t({ trunk: 15 }).score, 2);
  assert.equal(t({ trunk: 40 }).score, 3);
  assert.equal(t({ trunk: -12 }).score, 2);
  const ext = t({ trunk: -25 }); assert.equal(ext.score, 3); assert.ok(ext.ext);
  const bend = t({ bend: 20 }); assert.equal(bend.score, 2); assert.equal(bend.adj, 1); assert.ok(bend.angle < 1);
  assert.equal(t({ trunk: 70, twist: 30 }).score, 5);
});

test('REBA legs: knee bands, unstable stance, sitting', () => {
  const legs = (k, o) => E.computeREBA(pose({ knees: both(k) }), o).parts.legs.score;
  assert.equal(legs(20), 1); assert.equal(legs(45), 2); assert.equal(legs(90), 3);
  assert.equal(legs(90, { unstable: true }), 4);
  assert.equal(legs(90, { sitting: true }), 1);
  assert.equal(legs(90, { sitting: true, unstable: true }), 2);
  // the worse knee counts when both are visible, the visible one when only one is
  assert.equal(Math.round(E.computeREBA(pose({ knees: { left: 10, right: 70 } })).knee.angle), 70);
  const lowVis = { 24: .1, 26: .1, 28: .1 };
  assert.equal(E.computeREBA(pose({ knees: { left: 10, right: 70 }, vis: lowVis })).knee.side, 'left');
});

test('REBA arms: abduction, raised shoulder, support, elbow band', () => {
  const up = (a, o) => E.computeREBA(pose({ arms: both(a) }), o).parts.upper.score;
  assert.equal(up({ flex: 30 }), 2); assert.equal(up({ flex: 60 }), 3);
  // abduction 35 deg: elevation 35 (20-45) = 2, abducted +1 = 3 ; abduction 15 deg is below the +1 threshold
  assert.equal(up({ flex: 0, abd: 35 }), 3);
  assert.equal(up({ flex: 0, abd: 15 }), 1);
  assert.equal(up({ flex: 60 }, { shoulderRaised: true }), 4);
  assert.equal(up({ flex: 60 }, { armSupported: true }), 2);
  assert.equal(E.computeREBA(pose({ arms: both({ flex: 0, elbow: 80 }) })).parts.lower.score, 1);
  assert.equal(E.computeREBA(pose({ arms: both({ flex: 0, elbow: 120 }) })).parts.lower.score, 2);
});

test('REBA caps at 15 for the worst case', () => {
  const lm = pose({ trunk: 80, twist: 30, neck: 40, tilt: 25, arms: both({ flex: 120, abd: 60, elbow: 150 }), knees: both(100) });
  const r = E.computeREBA(lm, {
    load: 2, shock: true, coupling: 3, unstable: true, shoulderRaised: true,
    wristMode: 'flexOver', wristDev: true, activity: { static: true, repeat: true, rapid: true }
  });
  assert.deepEqual(pick(r, ['scoreA', 'scoreB', 'tableC', 'final', 'risk']), { scoreA: 12, scoreB: 12, tableC: 12, final: 15, risk: 5 });
});

// ---------- RULA regression ----------
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// every key the old engine returned must come back with the identical value
function assertSubset(oldV, newV, path = 'r') {
  if (oldV && typeof oldV === 'object') {
    assert.ok(newV && typeof newV === 'object', path + ' missing');
    for (const k of Object.keys(oldV)) assertSubset(oldV[k], newV[k], path + '.' + k);
  } else assert.ok(Object.is(oldV, newV), `${path}: old ${oldV} new ${newV}`);
}

test('RULA: 3000 random postures give identical results to the original engine (wrist on AI)', () => {
  const rnd = mulberry32(20261024), u = (a, b) => a + (b - a) * rnd(), pickOne = a => a[Math.floor(rnd() * a.length)];
  const finals = new Set();
  for (let i = 0; i < 3000; i++) {
    const arm = () => ({ flex: u(-40, 170), abd: u(0, 70), elbow: u(0, 150), wrist: u(-40, 40) });
    const vis = {}; for (const j of [11, 12, 13, 14, 15, 16]) vis[j] = u(0.2, 1);
    const lm = pose({
      trunk: u(-30, 100), bend: u(-25, 25), twist: u(-35, 35), neck: u(-40, 50), tilt: u(-25, 25),
      arms: { left: arm(), right: arm() }, knees: { left: u(0, 110), right: u(0, 110) }, vis, jitter: 0.03, rnd
    });
    const o = {
      side: pickOne(['auto', 'left', 'right']), legsSupported: rnd() < .5, muscle: rnd() < .5, load: pickOne([0, 1, 2, 3]),
      armSupported: rnd() < .3, shoulderRaised: rnd() < .3, offsets: { neck: u(0, 25), trunk: u(0, 15), wrist: u(0, 25) }
    };
    const before = OLD.computeRULA(lm, o);
    const after = E.computeRULA(lm, { ...o, wristMode: 'ai', wristDev: false });
    assertSubset(before, after);
    finals.add(before.final);
  }
  assert.ok(finals.size >= 6, 'random set should cover most RULA scores, got ' + [...finals]);
});

test('RULA: manual wrist choice replaces the AI angle and feeds Table A', () => {
  const lm = pose({ arms: both({ flex: 30, elbow: 80, wrist: 35 }) });
  const ai = E.computeRULA(lm, { wristMode: 'ai' });
  assert.equal(ai.parts.wrist.score, 3); assert.equal(ai.parts.wrist.manual, false);
  const st = E.computeRULA(lm, { wristMode: 'straight' });
  assert.equal(st.parts.wrist.score, 1); assert.equal(st.parts.wrist.manual, true);
  assert.ok(st.postureA < ai.postureA, 'straight wrist lowers Table A');
  assert.equal(E.computeRULA(lm, { wristMode: 'flexOver', wristDev: true }).parts.wrist.score, 4);
});
