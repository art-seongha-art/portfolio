// Moon — shooting stars. Now and then one on the Earth nights, and a shower during totality,
// every meteor of it running away from one point in the sky (the radiant). A window works
// them out from the clock alone, so separate windows agree: in each second of the loop a
// meteor may start (the chance comes from the timeline), and everything about it comes
// from a hash of that second. The walls reach only 23-30 degrees up, so meteors end below
// that and fall into view from above; the shower's radiant stands above the front wall.

import { dirAzEl } from './scene.js';

export const MET_MAX = 12;
const D2R = Math.PI / 180;
const RADIANT = dirAzEl(35, 58);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function slerp(a, b, u) {
  const w = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (w < 1e-6) return a;
  const s = Math.sin(w), p = Math.sin((1 - u) * w) / s, q = Math.sin(u * w) / s;
  return norm([a[0] * p + b[0] * q, a[1] * p + b[1] * q, a[2] * p + b[2] * q]);
}
// move from direction a by angle L (rad) along the great circle toward (or away from) b
function along(a, b, L) {
  const c = dot(a, b);
  const t = norm([b[0] - a[0] * c, b[1] - a[1] * c, b[2] - a[2] * c]);
  return norm([a[0] * Math.cos(L) + t[0] * Math.sin(L), a[1] * Math.cos(L) + t[1] * Math.sin(L), a[2] * Math.cos(L) + t[2] * Math.sin(L)]);
}
function hash(k, s) {
  let h = (Math.imul(k + 0x6d2b79f5, 0x9e3779b1) ^ Math.imul(s + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// the meteor of stream s in second k, or null
function meteor(k, s, rate) {
  const r = (i) => hash(k, s * 16 + i);
  if (r(0) >= rate) return null;
  const shower = s > 0;
  // where it ends: somewhere on the walls, 3-22 degrees up
  const end = dirAzEl(-128 + 256 * r(1), 3 + 19 * Math.sqrt(r(2)));
  let start;
  if (shower) {
    // it comes from the direction of the radiant, longer the farther from it
    const rho = Math.acos(Math.max(-1, Math.min(1, dot(end, RADIANT))));
    start = along(end, RADIANT, Math.min(rho - 3 * D2R, rho * (0.18 + 0.3 * r(3))));
  } else {
    // falling, mostly: it comes from above, up to 70 degrees off the vertical
    const a = (r(3) - 0.5) * 140 * D2R;
    const up = norm([-end[0] * end[1], 1 - end[1] * end[1], -end[2] * end[1]]);
    const side = norm([-end[2], 0, end[0]]);
    const toward = norm([up[0] * Math.cos(a) + side[0] * Math.sin(a), up[1] * Math.cos(a) + side[1] * Math.sin(a), up[2] * Math.cos(a) + side[2] * Math.sin(a)]);
    start = along(end, [end[0] + toward[0], end[1] + toward[1], end[2] + toward[2]], (5 + 14 * r(4)) * D2R);
  }
  const b = 0.3 + 1.8 * Math.pow(r(5), 3);
  return { t0: k + r(6), T: 0.35 + 0.9 * r(7) * r(7), start, end, b, train: b > 1.2 ? 2.5 : 0 };
}

// the meteors to draw at loop time t: head and tail directions, brightness, and how the
// trail fades toward the tail. rateAt(k) gives [sporadic, shower] rates (per second).
export function meteorsAt(t, rateAt) {
  const H = new Float32Array(4 * MET_MAX), Tl = new Float32Array(4 * MET_MAX);
  let n = 0;
  for (let k = Math.floor(t) - 4; k <= Math.floor(t) && n < MET_MAX; k++) {
    const [sp, sh] = rateAt(k);
    for (let s = 0; s < 4 && n < MET_MAX; s++) {
      const m = meteor(k, s, s === 0 ? sp : sh / 3);
      if (!m || t < m.t0) continue;
      const u = (t - m.t0) / m.T;
      let head, tail, b, g;
      if (u <= 1) {
        // it flares up, then burns out; the trail behind it about half the way it has come
        head = slerp(m.start, m.end, u);
        tail = slerp(m.start, m.end, Math.max(0, u - 0.45));
        b = m.b * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * u)), 0.5);
        g = 1.6;
      } else if (t - m.t0 - m.T < m.train) {
        // a bright one leaves a glowing train along the last part of its path
        head = m.end;
        tail = slerp(m.start, m.end, 0.35);
        b = 0.08 * m.b * Math.exp(-(t - m.t0 - m.T) / 0.9);
        g = 0.3;
      } else continue;
      H.set([head[0], head[1], head[2], b], n * 4);
      Tl.set([tail[0], tail[1], tail[2], g], n * 4);
      n++;
    }
  }
  return { n, H, T: Tl };
}

export const METEOR_GLSL = `
uniform int   uMetN;
uniform vec4  uMetH[${MET_MAX}];   // head direction, brightness
uniform vec4  uMetT[${MET_MAX}];   // tail direction, how the trail fades toward the tail
uniform float uMetGain;

// shooting stars seen along d: a thin line from tail to head, brightest at the head
vec3 meteors(vec3 d, float angPix) {
  float acc = 0.0;
  float w = 1.1 * angPix + 0.00025;
  for (int i = 0; i < ${MET_MAX}; i++) {
    if (i >= uMetN) break;
    vec3 H = uMetH[i].xyz, T = uMetT[i].xyz;
    float L = acos(clamp(dot(T, H), -1.0, 1.0));
    if (dot(d, normalize(T + H)) < cos(0.5 * L + 8.0 * w)) continue;
    vec3 n = cross(T, H);
    float ln = length(n), off, s;
    if (ln < 1e-7) { off = acos(clamp(dot(d, H), -1.0, 1.0)); s = 1.0; }
    else {
      n /= ln;
      off = dot(d, n);
      vec3 dp = normalize(d - n * off);
      s = atan(dot(cross(T, dp), n), dot(T, dp)) / L;
    }
    float beyond = (s < 0.0 ? -s : max(s - 1.0, 0.0)) * L;
    float r2 = off * off + beyond * beyond;
    // a thin core with a faint glow round it, and the head brighter still
    float line = exp(-r2 / (w * w)) + 0.18 * exp(-r2 / (9.0 * w * w));
    float head = exp(-dot(d - H, d - H) / (6.0 * w * w));
    acc += (line * pow(clamp(s, 0.0, 1.0), uMetT[i].w) + 0.7 * head) * uMetH[i].w;
  }
  return acc * vec3(0.92, 0.97, 1.0) * uMetGain;
}
`;
