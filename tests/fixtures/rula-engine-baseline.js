// ===== RULA engine (McAtamney & Corlett, 1993) =====
const RULA_A = [ // [upperArm-1][lowerArm-1][(wrist-1)*2 + (twist-1)]
  [[1,2,2,2,2,3,3,3],[2,2,2,2,3,3,3,3],[2,3,3,3,3,3,4,4]],
  [[2,3,3,3,3,4,4,4],[3,3,3,3,3,4,4,4],[3,4,4,4,4,4,5,5]],
  [[3,3,4,4,4,4,5,5],[3,4,4,4,4,4,5,5],[4,4,4,4,4,5,5,5]],
  [[4,4,4,4,4,5,5,5],[4,4,4,4,4,5,5,5],[4,4,4,5,5,5,6,6]],
  [[5,5,5,5,5,6,6,7],[5,6,6,6,6,7,7,7],[6,6,6,7,7,7,7,8]],
  [[7,7,7,7,7,8,8,9],[8,8,8,8,8,9,9,9],[9,9,9,9,9,9,9,9]]
];
const RULA_B = [ // [neck-1][(trunk-1)*2 + (legs-1)]
  [1,3,2,3,3,4,5,5,6,6,7,7],
  [2,3,2,3,4,5,5,5,6,7,7,7],
  [3,3,3,4,4,5,5,6,6,7,7,7],
  [5,5,5,6,6,7,7,7,7,7,8,8],
  [7,7,7,7,7,8,8,8,8,8,8,8],
  [8,8,8,8,8,8,8,9,9,9,9,9]
];
const RULA_C = [ // [min(A,8)-1][min(B,7)-1]
  [1,2,3,3,4,5,5],[2,2,3,4,4,5,5],[3,3,3,4,4,5,6],[3,3,3,4,5,6,6],
  [4,4,4,5,6,7,7],[4,4,5,6,6,7,7],[5,5,6,6,7,7,7],[5,5,6,7,7,7,7]
];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- vector helpers (3D) ----
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = a => Math.sqrt(dot(a, a)) || 1e-9;
const unit = a => { const l = len(a); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const angle = (a, b) => Math.acos(clamp(dot(unit(a), unit(b)), -1, 1)) * 180 / Math.PI;
// remove component of v along axis n (n unit)
const reject = (v, n) => sub(v, scale(n, dot(v, n)));

/**
 * Compute RULA from MediaPipe world landmarks (y points DOWN, metres, hip-centred).
 * opts: { side:'auto'|'left'|'right', legsSupported, muscle, load(0..3), armSupported,
 *         shoulderRaised, offsets:{neck,trunk,wrist} }
 */
function computeRULA(lm, opts = {}) {
  const o = Object.assign({ side: 'auto', legsSupported: true, muscle: false, load: 0,
    armSupported: false, shoulderRaised: false, offsets: { neck: 0, trunk: 0, wrist: 0 } }, opts);
  const P = i => lm[i];
  const vis = i => (lm[i].visibility == null ? 1 : lm[i].visibility);

  const lSh = P(11), rSh = P(12), lHip = P(23), rHip = P(24);
  const midSh = mid(lSh, rSh), midHip = mid(lHip, rHip);
  const midEar = mid(P(7), P(8));
  const up = { x: 0, y: -1, z: 0 };
  const trunkVec = sub(midSh, midHip);
  const trunkU = unit(trunkVec);
  const rightAxis = unit(sub(rSh, lSh)); // body's left->right (subject's right)
  // body forward = direction the face points, made perpendicular to trunk & shoulder line
  let fwdRaw = sub(P(0), midEar);
  fwdRaw = reject(reject(fwdRaw, trunkU), rightAxis);
  const fwd = unit(fwdRaw);

  // ---- Trunk ----
  const trunkAng = Math.max(0, angle(trunkVec, up) - o.offsets.trunk);
  const trunkSign = dot(trunkU, fwd) >= 0 ? 1 : -1; // + flexion
  let trunk = trunkAng < 5 ? 1 : trunkAng <= 20 ? 2 : trunkAng <= 60 ? 3 : 4;
  if (trunkSign < 0 && trunkAng >= 5) trunk = Math.max(trunk, 2); // extension
  const sideBend = Math.abs(Math.asin(clamp(dot(trunkU, unit({ x: rightAxis.x, y: 0, z: rightAxis.z })), -1, 1)) * 180 / Math.PI);
  const shLineH = { x: rSh.x - lSh.x, y: 0, z: rSh.z - lSh.z };
  const hipLineH = { x: rHip.x - lHip.x, y: 0, z: rHip.z - lHip.z };
  const twist = angle(shLineH, hipLineH);
  const trunkAdj = (sideBend > 10 ? 1 : 0) + (twist > 20 ? 1 : 0) > 0 ? 1 : 0;
  trunk = clamp(trunk + trunkAdj, 1, 6);

  // ---- Neck ----
  const neckVec = sub(midEar, midSh);
  let neckAng = angle(neckVec, trunkVec) - o.offsets.neck;
  const neckFwd = dot(reject(neckVec, trunkU), fwd);
  const neckExt = neckFwd < 0 && neckAng > 10;
  neckAng = Math.max(0, neckAng);
  let neck = neckExt ? 4 : neckAng <= 10 ? 1 : neckAng <= 20 ? 2 : 3;
  const headTilt = Math.abs(90 - angle(sub(P(8), P(7)), trunkVec)); // ear line vs trunk
  if (headTilt > 15) neck += 1;
  neck = clamp(neck, 1, 6);

  const legs = o.legsSupported ? 1 : 2;

  // ---- Arm (per side) ----
  function arm(s) {
    const [sh, el, wr, ix, other] = s === 'left' ? [11, 13, 15, 19, 12] : [12, 14, 16, 20, 11];
    const ua = sub(P(el), P(sh));
    const down = scale(trunkU, -1);
    const uaAng = angle(ua, down);
    const uaFwd = dot(ua, fwd);
    let upper = (uaFwd < 0 && uaAng > 20) ? 2 : uaAng <= 20 ? 1 : uaAng <= 45 ? 2 : uaAng <= 90 ? 3 : 4;
    const outward = unit(sub(P(sh), P(other)));
    const abducted = dot(unit(ua), outward) > 0.5; // > ~30° to the side
    if (abducted) upper += 1;
    if (o.shoulderRaised) upper += 1;
    if (o.armSupported) upper -= 1;
    upper = clamp(upper, 1, 6);

    const fa = sub(P(wr), P(el));
    const elbowFlex = angle(ua, fa); // 0 = straight
    let lower = (elbowFlex >= 60 && elbowFlex <= 100) ? 1 : 2;
    // working across midline or out to side
    const wrLat = dot(sub(P(wr), midSh), rightAxis) * (s === 'left' ? -1 : 1);
    if (wrLat < -0.05 || wrLat > 0.45) lower += 1;
    lower = clamp(lower, 1, 3);

    const hand = sub(P(ix), P(wr));
    const wristAng = Math.max(0, angle(fa, hand) - o.offsets.wrist);
    let wrist = wristAng <= 5 ? 1 : wristAng <= 15 ? 2 : 3;
    wrist = clamp(wrist, 1, 4);
    const wTwist = 1;
    const visScore = vis(sh) + vis(el) + vis(wr);
    return { side: s, upper, lower, wrist, wTwist, uaAng, elbowFlex, wristAng, abducted, visScore };
  }
  const L = arm('left'), R = arm('right');
  const tableA = a => RULA_A[a.upper - 1][a.lower - 1][(a.wrist - 1) * 2 + (a.wTwist - 1)];
  let chosen;
  if (o.side === 'left') chosen = L;
  else if (o.side === 'right') chosen = R;
  else {
    // pick the visible side; if both visible, the worse one
    if (Math.abs(L.visScore - R.visScore) > 0.6) chosen = L.visScore > R.visScore ? L : R;
    else chosen = tableA(L) >= tableA(R) ? L : R;
  }
  const add2 = (o.muscle ? 1 : 0) + clamp(o.load | 0, 0, 3);
  const postureA = tableA(chosen);
  const postureB = RULA_B[neck - 1][(trunk - 1) * 2 + (legs - 1)];
  const scoreC = postureA + add2;
  const scoreD = postureB + add2;
  const final = RULA_C[clamp(scoreC, 1, 8) - 1][clamp(scoreD, 1, 7) - 1];
  const level = final <= 2 ? 1 : final <= 4 ? 2 : final <= 6 ? 3 : 4;
  return {
    final, level, postureA, postureB, scoreC, scoreD,
    arm: chosen, arms: { left: L, right: R },
    parts: {
      upper: { score: chosen.upper, max: 6, angle: chosen.uaAng },
      lower: { score: chosen.lower, max: 3, angle: chosen.elbowFlex },
      wrist: { score: chosen.wrist, max: 4, angle: chosen.wristAng },
      neck: { score: neck, max: 6, angle: neckAng, ext: neckExt },
      trunk: { score: trunk, max: 6, angle: trunkAng, sideBend, twist },
      legs: { score: legs, max: 2 }
    },
    raw: { neckAng: angle(neckVec, trunkVec), trunkAng: angle(trunkVec, up), wristAng: angle(sub(P(chosen.side === 'left' ? 15 : 16), P(chosen.side === 'left' ? 13 : 14)), sub(P(chosen.side === 'left' ? 19 : 20), P(chosen.side === 'left' ? 15 : 16))) }
  };
}


