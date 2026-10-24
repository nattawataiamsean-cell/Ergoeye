// Synthetic MediaPipe world landmarks for tests (y down, metres, hip-centred, subject faces -z).
const V = (x, y, z) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const scl = (a, k) => V(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const nrm = a => scl(a, 1 / Math.hypot(a.x, a.y, a.z));
const rad = d => d * Math.PI / 180;
// Rodrigues rotation of v about unit axis k by deg
const rot = (v, k, deg) => {
  const c = Math.cos(rad(deg)), si = Math.sin(rad(deg));
  return add(add(scl(v, c), scl(cross(k, v), si)), scl(k, dot(k, v) * (1 - c)));
};
const UP = V(0, -1, 0), FWD = V(0, 0, -1), RIGHT = V(-1, 0, 0), LEFT = V(1, 0, 0);

/**
 * trunk: forward flexion deg (negative = extension); bend: side bend; twist: shoulder rotation about the trunk
 * neck: flexion relative to trunk (negative = looking up); tilt: head side tilt
 * arms.{left,right}: { flex: upper-arm forward elevation from the trunk line, abd: abduction, elbow, wrist }
 * knees: { left, right } knee flexion deg; vis: { landmarkIndex: visibility }
 */
export function pose({ trunk = 0, bend = 0, twist = 0, neck = 0, tilt = 0, arms = {}, knees = {}, vis = {}, jitter = 0, rnd = Math.random } = {}) {
  const tb = q => rot(rot(q, LEFT, trunk), FWD, -bend); // body frame
  const t = tb(UP), ft = tb(FWD), rt = tb(RIGHT);
  const lat = rot(rt, t, twist);
  const midSh = scl(t, 0.5);
  const lm = Array.from({ length: 33 }, () => V(0, 0, 0));
  lm[11] = add(midSh, scl(lat, -0.19)); lm[12] = add(midSh, scl(lat, 0.19));
  const n = rot(t, scl(rt, -1), neck), h = rot(ft, scl(rt, -1), neck);
  const midEar = add(midSh, scl(n, 0.22));
  const earLat = rot(lat, h, tilt);
  lm[7] = add(midEar, scl(earLat, -0.075)); lm[8] = add(midEar, scl(earLat, 0.075));
  lm[0] = add(midEar, scl(h, 0.1));
  for (const side of ['left', 'right']) {
    const a = Object.assign({ flex: 0, abd: 0, elbow: 0, wrist: 0 }, arms[side]);
    const [sh, el, wr, ix] = side === 'left' ? [11, 13, 15, 19] : [12, 14, 16, 20];
    const out = side === 'right' ? lat : scl(lat, -1);
    let ua = rot(scl(t, -1), rt, a.flex);
    ua = nrm(add(scl(ua, Math.cos(rad(a.abd))), scl(out, Math.sin(rad(a.abd)))));
    const fa = rot(ua, rt, a.elbow), hd = rot(fa, rt, a.wrist);
    lm[el] = add(lm[sh], scl(ua, 0.3)); lm[wr] = add(lm[el], scl(fa, 0.26)); lm[ix] = add(lm[wr], scl(hd, 0.08));
  }
  for (const side of ['left', 'right']) {
    const k = knees[side] || 0;
    const [hp, kn, an] = side === 'left' ? [23, 25, 27] : [24, 26, 28];
    lm[hp] = scl(side === 'left' ? LEFT : RIGHT, 0.1);
    const thigh = rot(scl(UP, -1), RIGHT, k / 2), shank = rot(thigh, LEFT, k);
    lm[kn] = add(lm[hp], scl(thigh, 0.42)); lm[an] = add(lm[kn], scl(shank, 0.42));
  }
  return lm.map((p, i) => ({
    x: p.x + (rnd() - .5) * jitter, y: p.y + (rnd() - .5) * jitter, z: p.z + (rnd() - .5) * jitter,
    visibility: vis[i] ?? 1
  }));
}
export const both = a => ({ left: a, right: a });
