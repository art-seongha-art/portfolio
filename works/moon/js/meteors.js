// Moon — shooting stars. Now and then one on the Earth nights, and a shower during totality,
// every meteor of it running away from one point in the sky (the radiant). A window works
// them out from the clock alone, so separate windows agree: in each second of the loop a
// meteor may start (the chance comes from the timeline), and everything about it comes
// from a hash of that second. The walls reach only 23-30 degrees up, so meteors end below
// that and fall into view from above; the shower's radiant stands above the front wall.
//
// What a meteor looks like to the eye: a point, not a line. The head moves 10-40 degrees a
// second for a fraction of a second; the air it has just passed through glows for about a
// tenth of a second, so it drags a short fading wake. It brightens quickly, flickers as it
// breaks up, often flares at the end and then is gone. Most are faint and white; the bright
// ones show colour (the head green from magnesium and oxygen, or yellow from sodium, the
// wake orange), and the brightest leave a faint train that hangs for a few seconds. Low
// down they are farther away: shorter, and dimmed by the air.

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
// move from direction a by angle L (rad) along the great circle toward b
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
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the meteor of stream s in second k, or null
function meteor(k, s, rate) {
  const r = (i) => hash(k, s * 16 + i);
  if (r(0) >= rate) return null;
  const shower = s > 0;
  // where it ends: somewhere on the walls, 3-22 degrees up
  const elEnd = 3 + 19 * Math.sqrt(r(1));
  const end = dirAzEl(-128 + 256 * r(2), elEnd);
  // how fast it crosses the sky (deg/s) and for how long: low down it is farther away, so it
  // looks slower and its path shorter
  const near = 0.45 + 0.55 * smooth(3, 20, elEnd);
  const T = shower ? 0.3 + 0.45 * r(7) : 0.35 + 0.6 * r(7);
  const L = (shower ? 14 + 20 * r(4) : 8 + 22 * r(4)) * near * T * D2R;
  let start;
  if (shower) {
    // it comes from the direction of the radiant
    const rho = Math.acos(Math.max(-1, Math.min(1, dot(end, RADIANT))));
    start = along(end, RADIANT, Math.min(L, rho - 3 * D2R));
  } else {
    // falling, mostly: it comes from above, up to 70 degrees off the vertical
    const a = (r(3) - 0.5) * 140 * D2R;
    const up = norm([-end[0] * end[1], 1 - end[1] * end[1], -end[2] * end[1]]);
    const side = norm([-end[2], 0, end[0]]);
    const toward = [up[0] * Math.cos(a) + side[0] * Math.sin(a), up[1] * Math.cos(a) + side[1] * Math.sin(a), up[2] * Math.cos(a) + side[2] * Math.sin(a)];
    start = along(end, [end[0] + toward[0], end[1] + toward[1], end[2] + toward[2]], L);
  }
  // most are faint; one in a few dozen is bright enough to show colour
  const b = 0.35 + 3.2 * Math.pow(r(5), 6);
  const c = r(8);
  const colour = b < 1.2 ? [0.95, 0.97, 1.0] : c < 0.55 ? [0.72, 1.0, 0.78] : c < 0.85 ? [1.0, 0.9, 0.66] : [0.82, 0.9, 1.0];
  return {
    t0: k + r(6), T, start, end, b, colour,
    // where it flickers as it breaks up, and whether it flares at the end
    f1: 0.35 + 0.4 * r(9), f2: 0.55 + 0.35 * r(10), flare: r(11) < 0.6 ? 0.6 + 0.8 * r(12) : 0,
    train: b > 2.0 ? 3.0 : 0,
  };
}
// how bright the head is through its flight (u = 0..1)
function lightCurve(m, u) {
  const bump = (c, w) => Math.exp(-((u - c) * (u - c)) / (w * w));
  const rise = smooth(0, 0.18, u);
  const body = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.1));
  const flick = 1 + 0.35 * bump(m.f1, 0.05) + 0.25 * bump(m.f2, 0.04);
  const end = 1 + m.flare * bump(0.9, 0.05);
  return rise * body * flick * end * (1 - smooth(0.94, 1.0, u));
}

// the meteors to draw at loop time t: head and wake-end directions, brightness, how fast
// the wake fades, and colour. rateAt(k) gives [sporadic, shower] rates (per second).
export function meteorsAt(t, rateAt) {
  const H = new Float32Array(4 * MET_MAX), Tl = new Float32Array(4 * MET_MAX), C = new Float32Array(4 * MET_MAX);
  let n = 0;
  for (let k = Math.floor(t) - 5; k <= Math.floor(t) && n < MET_MAX; k++) {
    const [sp, sh] = rateAt(k);
    for (let s = 0; s < 4 && n < MET_MAX; s++) {
      const m = meteor(k, s, s === 0 ? sp : sh / 3);
      if (!m || t < m.t0) continue;
      const u = (t - m.t0) / m.T;
      if (u <= 1) {
        // the head, and the air behind it that glowed in the last ~0.15 s
        const head = slerp(m.start, m.end, u);
        const tail = slerp(m.start, m.end, Math.max(0, u - 0.15 / m.T));
        H.set([head[0], head[1], head[2], m.b * lightCurve(m, u)], n * 4);
        Tl.set([tail[0], tail[1], tail[2], 3.5], n * 4);
        C.set([m.colour[0], m.colour[1], m.colour[2], 1], n * 4);
      } else if (t - m.t0 - m.T < m.train) {
        // a faint train where the brightest one burned, fading over a few seconds
        const tt = t - m.t0 - m.T;
        const a = slerp(m.start, m.end, 0.4), e = slerp(m.start, m.end, 0.97);
        H.set([e[0], e[1], e[2], 0.05 * m.b * Math.exp(-tt / 1.1) * smooth(0, 0.3, tt + 0.1)], n * 4);
        Tl.set([a[0], a[1], a[2], 0], n * 4);
        C.set([0.62, 0.95, 0.72, 0], n * 4);
      } else continue;
      n++;
    }
  }
  return { n, H, T: Tl, C };
}

export const METEOR_GLSL = `
uniform int   uMetN;
uniform vec4  uMetH[${MET_MAX}];   // head direction, brightness
uniform vec4  uMetT[${MET_MAX}];   // end of the wake, how fast the wake fades from the head
uniform vec4  uMetC[${MET_MAX}];   // colour of the head; w = 1 flying, 0 a train (no head)
uniform float uMetGain;

// shooting stars seen along d: a point of light (the head) dragging a short fading wake
vec3 meteors(vec3 d, float angPix) {
  vec3 acc = vec3(0.0);
  float w = 0.75 * angPix + 0.00008;
  for (int i = 0; i < ${MET_MAX}; i++) {
    if (i >= uMetN) break;
    vec3 H = uMetH[i].xyz, T = uMetT[i].xyz;
    float L = acos(clamp(dot(T, H), -1.0, 1.0));
    if (dot(d, normalize(T + H)) < cos(0.5 * L + 10.0 * w)) continue;
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
    float wakeW = w * (uMetC[i].w > 0.5 ? 0.8 : 1.6);
    float wake = exp(-(off * off + beyond * beyond) / (wakeW * wakeW)) * exp(-uMetT[i].w * (1.0 - clamp(s, 0.0, 1.0)));
    float r2 = dot(d - H, d - H);
    float head = (exp(-r2 / (w * w)) + 0.05 * exp(-r2 / (25.0 * w * w))) * uMetC[i].w;
    vec3 c = uMetC[i].rgb;
    acc += (head * 1.8 * c + wake * 0.5 * mix(c, vec3(1.0, 0.6, 0.36), 0.55 * uMetC[i].w)) * uMetH[i].w;
  }
  return acc * uMetGain;
}
`;
