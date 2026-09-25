// Moon — the moon watched from the ground: silver grass in the wind, a meadow of cosmos
// with fireflies, a plum branch against the moon, pines standing out of the mist.
//
// The plants stand on cylinders round the viewer (one ring of plants per band of distance,
// each plant at its own radius). A ray meets a plant's cylinder at one height, so every plant
// is a flat silhouette facing the viewer: exact from the sweet spot, the same on every wall and
// continuous across the corners. Blades, stems and petals are drawn with their pixel footprint
// (thin ones fade instead of flickering), the nearest first, until nothing shows behind.
// Plants are dark against the night; the moon comes through the thin parts (plumes, petals)
// when it is behind them, and edges facing it catch its light. Mist thickens toward the
// ground and toward the horizon, and scatters the moonlight into a halo round the moon.

export const FLY_MAX = 56;   // fireflies
export const BR_MAX = 72;    // plum branch segments
export const BL_MAX = 170;   // plum blossoms and buds
export const DATA_W = 192;   // data texture: rows of vec4

const D2R = Math.PI / 180;
function hash(i, s) {
  let h = (Math.imul(i + 0x3c6ef372, 0x9e3779b1) ^ Math.imul(s + 11, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const dir = (az, el) => [Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const at = (az, el, r) => mul(dir(az, el), r);

// The plum branch (in the eye frame, metres): an old limb comes in from above on the left,
// under two metres away, and bends its way across toward the moon; long straight shoots
// grow up and out of it, as plum shoots do, with blossoms close along them and buds at
// the tips. Built once; the wind sways it a little (swayed).
function buildBranch() {
  const segs = [], blos = [];
  let seed = 11;
  const rnd = () => hash(seed++, 91);
  // the limb: a zigzag of straight pieces, thick at the top left
  const limb = [at(-64, 44, 1.3), at(-52, 35, 1.24), at(-43, 31, 1.2), at(-33, 24.5, 1.17), at(-25, 22.5, 1.15), at(-16, 17.5, 1.13), at(-10, 16, 1.12), at(-4, 12.5, 1.11), at(1, 11.5, 1.1)];
  const rOf = (u) => 0.036 * Math.pow(1 - u, 1.1) + 0.006;
  const pts = [];
  for (let i = 0; i < limb.length - 1; i++) {
    const a = limb[i], b = limb[i + 1];
    for (let k = 0; k < 2; k++) {
      const u = k / 2;
      const j = i === 0 && k === 0 ? [0, 0, 0] : [(rnd() - 0.5) * 0.015, (rnd() - 0.5) * 0.015, (rnd() - 0.5) * 0.015];
      pts.push(add(add(a, mul(sub(b, a), u)), j));
    }
  }
  pts.push(limb[limb.length - 1]);
  const N = pts.length - 1;
  for (let i = 0; i < N; i++) segs.push([pts[i], pts[i + 1], rOf(i / N), rOf((i + 1) / N)]);
  const blossom = (c, axis, ra) => {
    if (blos.length >= BL_MAX) return;
    // on a short stalk to one side of the shoot, facing out and toward the viewer
    const side = norm(cross(axis, norm(c)));
    const s = rnd() < 0.5 ? -1 : 1;
    const up = rnd() < 0.7 ? 1 : -1;
    const off = add(mul(side, s * (ra + 0.006 + rnd() * 0.006)), [0, up * (ra * 0.6 + 0.004), 0]);
    const p = add(c, off);
    const bud = rnd() < 0.2;
    const facing = norm(add(mul(norm(p), -1), add(mul(side, s * 0.6), [(rnd() - 0.5) * 0.5, up * (0.3 + rnd() * 0.4), (rnd() - 0.5) * 0.5])));
    blos.push([p, bud ? -(0.004 + rnd() * 0.002) : 0.0165 + rnd() * 0.005, facing, rnd() * 6.283, bud ? 0 : 0.8 + rnd() * 0.2]);
  };
  // long straight shoots
  const shoot = (p0, dv0, L, r0) => {
    const n = 3;
    let p = p0, dv = norm(dv0);
    for (let k = 0; k < n; k++) {
      const q = add(p, mul(dv, L / n));
      const ra = r0 * (1 - k / n * 0.6), rb = r0 * (1 - (k + 1) / n * 0.6);
      if (segs.length < BR_MAX) segs.push([p, q, ra, rb]);
      const nb = 1 + Math.floor(rnd() * 2.6);
      for (let m = 0; m < nb; m++) blossom(add(p, mul(sub(q, p), (m + 0.2 + rnd() * 0.6) / nb)), dv, ra);
      dv = norm(add(dv, [(rnd() - 0.5) * 0.12, (rnd() - 0.45) * 0.1, (rnd() - 0.5) * 0.12]));
      p = q;
    }
    // buds at the tip
    for (let m = 0; m < 2; m++) blossom(add(p, mul(dv, -0.01 * m)), dv, 0.002);
    return p;
  };
  for (let i = N - 1; i >= 2; i--) {
    const base = pts[i];
    const tang = norm(sub(pts[i + 1], pts[i]));
    const nsh = rnd() < 0.55 ? 2 : 1;
    for (let j = 0; j < nsh; j++) {
      const up = rnd() < 0.72;
      const dv = add(add(mul(tang, 0.35 + rnd() * 0.4), up ? [0, 0.85 + rnd() * 0.5, 0] : [0, -0.4 - rnd() * 0.4, 0]), [(rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35]);
      const L = (up ? 0.16 : 0.1) + rnd() * 0.22;
      const tip = shoot(base, dv, L, 0.0055 + rnd() * 0.0025);
      if (rnd() < 0.35) shoot(add(base, mul(sub(tip, base), 0.5)), add(dv, [0.35, 0.15, 0]), L * 0.45, 0.0035);
    }
  }
  // clusters on short spurs right on the limb, most toward its end
  for (let i = N; i >= 3; i--) {
    const axis = norm(sub(pts[Math.min(i + 1, N)], pts[i - 1]));
    const k = i > N - 7 ? 3 : 1;
    for (let m = 0; m < k; m++) blossom(add(pts[i], mul(axis, (rnd() - 0.5) * 0.04)), axis, rOf(i / N));
  }
  return { segs, blos };
}
const BRANCH = buildBranch();

// how the branch sways (a slow nod about its base on the left, and a flutter at the tips)
function swayed(p, t, wind) {
  const base = BRANCH.segs[0][0];
  const r = len(sub(p, base));
  const a = wind * (0.012 * Math.sin(0.61 * t) + 0.007 * Math.sin(1.37 * t + 0.8)) * r;
  const f = wind * 0.004 * r * r * Math.sin(3.1 * t + p[0] * 9.0);
  return [p[0], p[1] + a + f, p[2] + a * 0.4];
}

// fireflies over the meadow: each keeps to its own patch, drifts slowly on a smooth path,
// and glows in short pulses, a few seconds apart
function firefliesAt(t, out, eye) {
  let n = 0;
  for (let i = 0; i < FLY_MAX; i++) {
    const r = (k) => hash(i, k);
    const az = -115 + 230 * r(1), R = 2.5 + 16 * r(2) * r(2), h0 = 0.25 + 1.1 * r(3);
    const w = 0.07 + 0.08 * r(4);
    const a = az + (Math.sin(w * t + 6.3 * r(5)) * 1.6 + Math.sin(0.43 * w * t + 2 * r(6)) * 1.0) * (6 / R) / D2R * 0.1;
    const rr = R + 0.8 * Math.sin(0.8 * w * t + 4 * r(7));
    const h = h0 + 0.3 * Math.sin(1.3 * w * t + 3 * r(8));
    // pulses: period 2.5-6 s, a smooth flash of about half a second
    const T = 2.5 + 3.5 * r(9), ph = (t / T + r(10)) % 1;
    const flash = Math.exp(-Math.pow((ph - 0.5) / 0.1, 2)) + 0.3 * Math.exp(-Math.pow((ph - 0.66) / 0.06, 2));
    const b = (0.12 + flash) * (0.6 + 0.8 * r(11));
    if (b < 0.01) continue;
    const p = at(a, 0, rr);
    out.set([p[0], h - eye, p[2], b], n * 4);
    n++;
  }
  return n;
}

// fill the data texture: row 0 fireflies, rows 1-2 branch segments (end A + radius, end B +
// radius), rows 3-4 blossoms (centre + radius (< 0 = bud), facing + rotation), row 5 the
// blossoms' openness. Returns the counts.
export function landData(buf, t, eye, wind, withFlies, withBranch) {
  const W = DATA_W * 4;
  const fl = new Float32Array(FLY_MAX * 4);
  const nf = withFlies ? firefliesAt(t, fl, eye) : 0;
  buf.set(fl.subarray(0, nf * 4), 0);
  let ns = 0, nb = 0;
  if (withBranch) {
    ns = BRANCH.segs.length; nb = BRANCH.blos.length;
    BRANCH.segs.forEach(([a, b, ra, rb], i) => {
      const A = swayed(a, t, wind), B = swayed(b, t, wind);
      buf.set([A[0], A[1], A[2], ra], W + i * 4);
      buf.set([B[0], B[1], B[2], rb], 2 * W + i * 4);
    });
    BRANCH.blos.forEach(([c, r, f, rot, open], i) => {
      const C = swayed(c, t, wind);
      buf.set([C[0], C[1], C[2], r], 3 * W + i * 4);
      buf.set([f[0], f[1], f[2], rot], 4 * W + i * 4);
      buf.set([open, 0, 0, 0], 5 * W + i * 4);
    });
  }
  return { nf, ns, nb };
}
export const DATA_H = 8;   // rows 6-7: the paper boats (sea.js)

// where the branch is on the sky, for a quick test: centre direction and angular radius
const bc = (() => {
  let c = [0, 0, 0];
  BRANCH.segs.forEach(([a]) => { c = add(c, norm(a)); });
  c = norm(c);
  let m = 0;
  BRANCH.segs.forEach(([a, b]) => { m = Math.max(m, Math.acos(Math.min(1, norm(a)[0] * c[0] + norm(a)[1] * c[1] + norm(a)[2] * c[2])), Math.acos(Math.min(1, norm(b)[0] * c[0] + norm(b)[1] * c[1] + norm(b)[2] * c[2]))); });
  BRANCH.blos.forEach(([p]) => { m = Math.max(m, Math.acos(Math.min(1, norm(p)[0] * c[0] + norm(p)[1] * c[1] + norm(p)[2] * c[2]))); });
  return [c, m + 0.05];
})();

const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(+v.toFixed(6)));

export const LAND_GLSL = `
uniform float uLand;          // 1 = standing on the ground in one of the landscapes
uniform float uLandEye;       // eye height over the ground (m)
uniform vec4  uVeg;           // how much of: silver grass, flowers, the plum branch, pines
uniform float uMist;          // mist at the ground (1/m); it thins with height
uniform float uMistH;         // its scale height (m)
uniform float uWindS;         // wind strength (tip sway per metre of height)
uniform float uWindAz;        // the wind blows toward this azimuth (rad)
uniform float uFieldH;        // height of the grass (m)
uniform float uNear;          // the clearing round the viewer (m)
uniform float uMotes;         // specks drifting in the air (pollen, dust) that catch the moon
uniform int   uFlyN, uBrN, uBlN;
const vec3 BR_C = vec3(${f(bc[0][0])}, ${f(bc[0][1])}, ${f(bc[0][2])});
const float BR_R = ${f(bc[1])};

float hashL(vec2 p, float s) { return h12(p * 1.0 + vec2(s * 17.31, s * 3.17)); }
// Henyey-Greenstein, normalised to 1 at g = 0
float hgPhase(float c, float g) { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5); }
// coverage of a pixel (footprint fp) by a band of half-width w round a line at distance x
float lineCov(float x, float w, float fp) {
  float lo = max(x - 0.5 * fp, -w), hi = min(x + 0.5 * fp, w);
  return clamp((hi - lo) / fp, 0.0, 1.0);
}
// coverage of a shape whose signed distance (negative inside) is s, with footprint fp
float fillCov(float s, float fp) { return clamp(0.5 - s / fp, 0.0, 1.0); }
// a straight piece from a to b, half-width w
float segCov(vec2 p, vec2 a, vec2 b, float w, float fp) {
  vec2 ab = b - a;
  float u = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  return lineCov(length(p - a - ab * u), w, fp);
}

// optical depth of the mist from the eye along d to distance t (inf allowed when d.y > 0)
float mistTau(vec3 d, float t) {
  if (uMist <= 0.0) return 0.0;
  float e0 = exp(-uLandEye / uMistH);
  float k = d.y / uMistH;
  if (abs(k) < 1e-5) return uMist * e0 * t;
  float tt = min(t, 1e6);
  return uMist * e0 * (1.0 - exp(-k * tt)) / k;
}
// wind: sideways sway (as seen) per metre of height, for a plant at xz and azimuth az
float windAt(vec2 xz, float az, float ph) {
  vec2 w = vec2(sin(uWindAz), -cos(uWindAz));
  float along = dot(xz, w);
  float g = 0.55 + 0.22 * sin(0.31 * along - 1.7 * uTime) + 0.16 * sin(0.83 * along - 2.9 * uTime + 1.3)
    + 0.07 * sin(2.3 * uTime + ph * 6.28);
  return uWindS * g * sin(uWindAz - az);
}

struct LandLight { vec3 moon; vec3 amb; vec3 mist; float cm; };

// a thin plant part: albedo, how much light passes through it, how bright its edge is
vec3 plantShade(vec3 alb, float trans, float edge, vec3 d, LandLight L) {
  float c = dot(d, uMoonDirW);
  float front = 0.25 + 0.35 * max(-c, 0.0);                // the moon behind the viewer lights it
  float through = trans * hgPhase(c, 0.6) * 0.18;          // light through it, toward the viewer
  float rim = edge * pow(max(c, 0.0), 6.0) * 0.9;           // edges that catch a moon behind
  // in thick mist the glowing mist itself lights the plants from all sides
  vec3 fogLit = L.mist * clamp(uMist * 30.0, 0.0, 1.0) * 0.5;
  return alb * (L.moon * (front + through + rim) + L.amb + fogLit);
}

// ---------------- silver grass: clumps of five stems with plumes, bent by the wind.
// xl: across the clump from its base (m), y: height on its cylinder (m)
void grassClump(vec2 id, float xl, float y, vec2 xz, float az, vec3 d, float fp, inout vec3 acc, inout float T, LandLight L) {
  if (y < 0.0 || y > uFieldH * 1.45) return;
  for (int j = 0; j < 5; j++) {
    float hj = hashL(id, float(j) + 0.5), hk = hashL(id, float(j) + 7.5), hm = hashL(id, float(j) + 13.5);
    float h = uFieldH * (0.72 + 0.4 * hj);
    if (y > h) continue;
    float bx = (hk - 0.5) * 0.18;
    float s = y / h;
    float B = windAt(xz, az, hm) * (1.0 + 0.25 * sin(2.6 * uTime + hm * 30.0));
    float lean = (hm - 0.5) * 0.14;
    float xb = bx + lean * y + B * h * s * s;
    float slope = lean + 2.0 * B * s;
    float dx = (xl - xb) / sqrt(1.0 + slope * slope);
    float pl = 0.26 + 0.14 * hk;              // plume length (m)
    float ps = (y - (h - pl)) / pl;           // 0..1 along the plume
    float a, edge;
    vec3 c;
    if (ps > 0.0) {
      // the plume: a fan of fine threads, silky, drooping downwind; it glows when the moon
      // is behind it
      float xp = dx - B * 0.7 * pl * ps * ps - 0.012 * ps * ps;
      float w = 0.006 + 0.03 * pow(sin(3.14159 * pow(ps, 0.65)), 0.8);
      float u = xp / w;
      float fib = vnoise2(vec2(u * 3.5 + ps * 5.0 + hk * 17.0, ps * 26.0 - u * 2.0 + hj * 9.0));
      float soft = smoothstep(1.0, 0.55, abs(u)) * 0.5 + 0.5;
      a = lineCov(xp, w, fp) * (0.25 + 0.6 * smoothstep(0.25, 0.8, fib)) * soft;
      edge = smoothstep(0.3, 1.0, abs(u)) * 0.8 + 0.2;
      c = plantShade(vec3(0.62, 0.58, 0.5), 1.4, edge, d, L);
    } else {
      float w = 0.0036 * (1.0 - 0.45 * s);
      a = lineCov(dx, w, fp);
      edge = 0.4;
      c = plantShade(vec3(0.07, 0.068, 0.05), 0.35, edge, d, L);
    }
    if (a <= 0.0) continue;
    acc += T * a * c;
    T *= 1.0 - a;
  }
}

// ---------------- the meadow: cosmos bushes (a few flowers on branching stems, lacy
// leaves round the lower stems) and low daisies. Each flower is a disc facing the viewer,
// turned up a little; the petals are thin and light comes through them.
void flowerHead(vec2 q, float R, float rot, float tilt, bool cosmos, vec3 pc, vec3 d, float fp, inout vec3 acc, inout float T, LandLight L) {
  q.y /= cos(tilt);
  float rr = length(q) / R;
  if (rr > 1.15) return;
  float th = atan(q.y, q.x);
  float petals, inner;
  if (cosmos) {
    float lobe = pow(abs(cos(4.0 * th + rot)), 0.45);
    petals = 0.46 + 0.54 * lobe - 0.08 * abs(sin(12.0 * th + rot * 3.0)) * smoothstep(0.75, 1.0, lobe);
    inner = 0.2;
  } else {
    float lobe = pow(abs(cos(9.0 * th + rot)), 1.3);
    petals = 0.55 + 0.45 * lobe;
    inner = 0.3;
  }
  float a = fillCov((rr - petals) * R, fp);
  if (a <= 0.0) return;
  bool centre = rr < inner;
  // petals: a little darker toward the centre, with fine veins
  float vein = 0.9 + 0.1 * sin(th * 40.0 + rr * 6.0);
  vec3 alb = centre ? (cosmos ? vec3(0.72, 0.52, 0.1) : vec3(0.78, 0.62, 0.12)) : pc * vein * (0.75 + 0.25 * smoothstep(0.15, 0.9, rr));
  float edge = smoothstep(petals - 0.3, petals, rr);
  acc += T * a * plantShade(alb, centre ? 0.2 : 1.0, edge, d, L);
  T *= 1.0 - a;
}
void flowerPlant(vec2 id, float xl, float y, vec2 xz, float az, vec3 d, float fp, inout vec3 acc, inout float T, LandLight L) {
  float ha = hashL(id, 1.5), hb = hashL(id, 2.5), hd = hashL(id, 4.5), he = hashL(id, 5.5);
  bool cosmos = ha < 0.72;
  float h = cosmos ? 0.7 + 0.55 * hb : 0.3 + 0.25 * hb;
  if (y < 0.0 || y > h + 0.07) return;
  // 산들산들: each stem sways on its own, slowly, over the common breeze
  float sw = windAt(xz, az, he) * 0.45 + 0.05 * sin(1.05 * uTime + he * 40.0) + 0.03 * sin(1.9 * uTime + hd * 30.0);
  float k = hashL(id, 9.5);
  vec3 pc = !cosmos ? vec3(0.86, 0.86, 0.8)
    : k < 0.38 ? vec3(0.78, 0.32, 0.52) : k < 0.66 ? vec3(0.64, 0.12, 0.4) : k < 0.86 ? vec3(0.86, 0.84, 0.84) : vec3(0.88, 0.58, 0.68);
  int nfl = cosmos ? 3 : 1;
  for (int f = 0; f < 3; f++) {
    if (f >= nfl) break;
    float hf = hashL(id, 10.5 + float(f)), hg = hashL(id, 14.5 + float(f)), hh = hashL(id, 18.5 + float(f));
    float fh = f == 0 ? h : h * (0.7 + 0.22 * hf);
    float fx = f == 0 ? 0.0 : (hg - 0.5) * 0.34;
    float by = f == 0 ? 0.0 : h * (0.42 + 0.16 * hf);
    float fsw = sw * (1.0 + 0.3 * sin(1.3 * uTime + hh * 20.0));
    float R = cosmos ? 0.028 + 0.014 * hh : 0.019 + 0.006 * hh;
    vec2 head = vec2(fx + fsw * fh, fh);
    if (y > fh - R * 1.2) {
      flowerHead(vec2(xl, y) - head, R, he * 6.283 + float(f) * 1.7 + fsw * 3.0, 0.35 + 0.5 * hh, cosmos, pc, d, fp, acc, T, L);
    } else if (y > by) {
      // the stem: from the main stem (or the ground) curving up to the head
      float s = (y - by) / max(fh - by, 1e-3);
      float x0 = f == 0 ? 0.0 : sw * by * pow(by / h, 0.6);
      float xs = mix(x0, head.x, pow(s, f == 0 ? 1.6 : 0.7));
      float a = lineCov(xl - xs, f == 0 ? 0.0025 : 0.0017, fp);
      if (a > 0.0) { acc += T * a * plantShade(vec3(0.03, 0.05, 0.025), 0.4, 0.3, d, L); T *= 1.0 - a; }
    }
    if (T < 0.01) return;
  }
  // lacy leaves round the lower stems
  if (cosmos && y < h * 0.62) {
    float xs = sw * y * pow(y / h, 0.6);
    float dx = abs(xl - xs);
    float spread = 0.13 * smoothstep(0.0, h * 0.25, y) * smoothstep(h * 0.62, h * 0.3, y) + 0.02;
    if (dx < spread * 1.3) {
      float n = fbm2l(vec2(xl * 22.0, y * 16.0) + id * 13.0, 3, fp * 22.0);
      float a = clamp((n - 0.52 + 0.25 * (1.0 - dx / spread)) / max(fp * 22.0 * 0.5, 0.05), 0.0, 1.0) * 0.75;
      if (a > 0.0) { acc += T * a * plantShade(vec3(0.03, 0.055, 0.028), 0.6, 0.4, d, L); T *= 1.0 - a; }
    }
  }
}
// the fine leaves low down, a dark mass
void foliage(float r, float y, float xa, vec3 d, float fp, float top, inout vec3 acc, inout float T, LandLight L) {
  if (y < 0.0 || y > top) return;
  float n = fbm2l(vec2(xa * 5.0, y * 7.0) + r * 3.1, 4, fp * 7.0);
  float dens = smoothstep(top, 0.0, y) * 1.3;
  float a = clamp((n * dens - 0.42) / max(fp * 7.0, 0.08) + 0.5, 0.0, 1.0) * 0.8;
  if (a <= 0.0) return;
  acc += T * a * plantShade(vec3(0.022, 0.035, 0.02), 0.3, 0.2, d, L);
  T *= 1.0 - a;
}

// ---------------- trees in the mist. The crown is one soft mass: blobs of foliage summed
// and cut at a level, so they merge like clouds, with a ragged edge of needles or leaves
// and a few gaps. Three kinds: pines (an S-curved trunk, a broad umbrella crown and a lower
// tier, as in old ink paintings), round broadleaf trees, and willows whose twigs hang in
// long curtains that sway.
void pineTree(vec2 id, float xl, float y, vec3 d, float fp, inout vec3 acc, inout float T, LandLight L) {
  float ha = hashL(id, 21.5), hb = hashL(id, 22.5), hc = hashL(id, 23.5), ht = hashL(id, 24.5);
  int kind = ht < 0.42 ? 0 : ht < 0.75 ? 1 : 2;       // pine, broadleaf, willow
  float H = kind == 0 ? 10.0 + 6.0 * ha : kind == 1 ? 8.0 + 6.0 * ha : 7.0 + 4.0 * ha;
  if (y < 0.0 || y > H * 1.15) return;
  float lean = (hc - 0.5) * (kind == 0 ? 0.35 : 0.12);
  float bend = (hb - 0.5) * (kind == 0 ? 2.6 : 0.8);
  float yt = clamp(y / H, 0.0, 1.0);
  float tx = lean * y + bend * sin(yt * 3.0 + ha * 6.0) * yt;
  float crownW = kind == 0 ? H * (0.3 + 0.18 * hb) : kind == 1 ? H * (0.36 + 0.14 * hb) : H * 0.42;
  if (abs(xl - tx) > crownW * 1.8 + 2.0) return;
  float cov = 0.0;
  float trunkTop = kind == 0 ? 0.8 : 0.55;
  if (yt < trunkTop) cov = lineCov(xl - tx, mix(kind == 0 ? 0.26 : 0.3, 0.09, yt / trunkTop), fp);
  // the crown: summed blobs, packed so they merge
  float D = 0.0;
  for (int i = 0; i < 10; i++) {
    float hi = hashL(id, 30.5 + float(i)), hj = hashL(id, 40.5 + float(i)), hk = hashL(id, 50.5 + float(i));
    float cyt, dx, ca, cb;
    if (kind == 0) {
      if (i < 7) { cyt = 0.74 + 0.22 * hi; dx = (hj - 0.5) * 1.5 * crownW; ca = 1.4 + 1.2 * hk; cb = 0.9 + 0.6 * hi; }
      else { cyt = 0.52 + 0.14 * hi; dx = (hj < 0.5 ? -1.0 : 1.0) * crownW * (0.45 + 0.35 * hk); ca = 1.1 + 0.8 * hk; cb = 0.6 + 0.4 * hi; }
    } else if (kind == 1) {
      float a = hj * 6.2832, r = sqrt(hi);
      cyt = 0.68 + 0.2 * r * sin(a); dx = crownW * 0.75 * r * cos(a); ca = 1.5 + 1.3 * hk; cb = 1.4 + 1.1 * hk;
    } else {
      float a = hj * 6.2832, r = sqrt(hi);
      cyt = 0.72 + 0.16 * r * sin(a); dx = crownW * 0.8 * r * cos(a); ca = 1.5 + 1.2 * hk; cb = 1.2 + 0.8 * hk;
    }
    float cy = H * cyt;
    float ctx = lean * cy + bend * sin(cyt * 3.0 + ha * 6.0) * cyt;
    float cx = ctx + dx;
    // a short limb out to the lower tiers of a pine
    if (kind == 0 && i >= 7) cov = max(cov, segCov(vec2(xl, y), vec2(ctx, cy - cb * 0.5), vec2(cx - sign(dx) * ca * 0.5, cy - cb * 0.3), 0.06 + 0.03 * hk, fp));
    vec2 q = vec2((xl - cx) / ca, (y - cy) / cb);
    if (q.y < 0.0) q.y *= kind == 0 ? 1.35 : 1.1;
    D += exp(-dot(q, q) * 1.4);
  }
  // cut the mass at a level; a ragged edge of needles (pine) or leaves, and a few gaps
  float nC = fbm2l(vec2(xl, y) * 0.6 + id * 5.3, 3, fp * 0.6);
  float nF = fbm2l(vec2(xl * 3.2, y * (kind == 0 ? 5.5 : kind == 1 ? 3.5 : 2.0)) + id * 9.7, 4, fp * 5.0);
  float lvl = D - 0.36 - (nC - 0.5) * 0.4 - (nF - 0.5) * 0.28;
  float crown = clamp(lvl / max(fp * 0.5, 0.015) + 0.5, 0.0, 1.0);
  float gap = smoothstep(0.24, 0.38, fbm2l(vec2(xl * 1.6, y * 2.2) + id * 3.3, 3, fp * 2.2));
  crown *= mix(gap, 1.0, smoothstep(0.15, 0.6, lvl));
  cov = max(cov, crown);
  if (kind == 2) {
    // curtains: fine strands hanging from the crown, longer toward the middle, swaying
    float cx = lean * H * 0.72 + bend * sin(2.16 + ha * 6.0) * 0.72;
    float cy = H * 0.7;
    float sway = uWindS * 6.0 * sin(0.7 * uTime + ha * 9.0) * max(cy - y, 0.0) * 0.08;
    float xs = xl - cx - sway;
    float span = abs(xs) / (crownW * 1.15);
    float hang = (1.0 - span * span) * H * (0.45 + 0.25 * vnoise2(vec2(xs * 3.0, 1.0) + id));
    float strands = vnoise2(vec2(xs * 24.0 + id.x * 7.0, y * 0.35));
    float fpS = fp * 24.0;
    float inside = step(span, 1.0) * step(cy - hang, y) * step(y, cy);
    float cur = inside * mix(smoothstep(0.3, 0.6, strands), 0.55, clamp(fpS - 0.5, 0.0, 1.0)) * smoothstep(cy - hang, cy - hang + 1.0, y);
    cov = max(cov, cur * 0.85);
  }
  if (cov <= 0.0) return;
  acc += T * cov * plantShade(vec3(0.02, 0.026, 0.022), 0.15, 0.3, d, L);
  T *= 1.0 - cov;
}

// ---------------- the plum branch: capsules for the wood, flat five-petalled flowers, buds
vec4 branchHit(vec3 d, float angPix, LandLight L, out float depth) {
  depth = 1e9;
  if (dot(d, BR_C) < cos(BR_R)) return vec4(0.0);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  // the wood: one surface for all the pieces (the nearest piece that covers the pixel),
  // rough bark with knots, dark; its rim toward a moon behind it glows
  float best = 1e9, bs = 0.0, bu = 0.0, brad = 1.0, bdist = 0.0;
  vec3 bpc = vec3(0.0);
  int bi = -1;
  for (int i = 0; i < ${BR_MAX}; i++) {
    if (i >= uBrN) break;
    vec4 A = texelFetch(tLand, ivec2(i, 1), 0), B = texelFetch(tLand, ivec2(i, 2), 0);
    vec3 ba = B.xyz - A.xyz;
    float b = dot(d, ba), c = dot(ba, ba), d1 = -dot(d, A.xyz), e = -dot(ba, A.xyz);
    float den = c - b * b;
    float u = den > 1e-9 ? clamp((e - b * d1) / den, 0.0, 1.0) : 0.0;
    float s = max(b * u - d1, 0.0);
    vec3 pc = A.xyz + ba * u;
    float dist = length(d * s - pc);
    // bark: knots and ridges make the outline irregular
    float along = u * sqrt(c) + float(i) * 0.37;
    float rad = mix(A.w, B.w, u) * (1.0 + 0.12 * sin(along * 90.0 + float(i)) + 0.18 * (vnoise2(vec2(along * 40.0, float(i))) - 0.5));
    float fp = angPix * s;
    float sd = dist - rad;
    if (sd < fp && sd / max(rad, 1e-4) < best) { best = sd / max(rad, 1e-4); bs = s; bu = u; brad = rad; bdist = dist; bpc = pc; bi = i; }
  }
  if (bi >= 0) {
    float fp = angPix * bs;
    float a = lineCov(bdist, brad, fp);
    if (a > 0.0) {
      float ef = clamp(bdist / brad, 0.0, 1.0);
      vec3 N = normalize(d * bs - bpc);
      float rim = pow(ef, 3.0) * pow(max(dot(d, uMoonDirW), 0.0), 8.0) * max(dot(N, uMoonDirW) + 0.6, 0.0);
      float bark = 0.7 + 0.6 * vnoise2(vec2(bu * 60.0 + float(bi) * 3.0, ef * 6.0));
      vec3 col = vec3(0.032, 0.024, 0.02) * bark * (L.moon * (0.2 + 0.25 * max(dot(N, uMoonDirW), 0.0)) + L.amb) + L.moon * rim * 0.35 * vec3(1.0, 0.86, 0.72);
      acc += T * a * col;
      T *= 1.0 - a;
      depth = min(depth, bs);
    }
  }
  // blossoms and buds
  for (int i = 0; i < ${BL_MAX}; i++) {
    if (i >= uBlN) break;
    vec4 C = texelFetch(tLand, ivec2(i, 3), 0);
    vec4 F = texelFetch(tLand, ivec2(i, 4), 0);
    float open = texelFetch(tLand, ivec2(i, 5), 0).x;
    float R = abs(C.w);
    float dc = length(C.xyz);
    if (dot(d, C.xyz / dc) < cos(R * 1.4 / dc + angPix * 2.0)) continue;
    float a;
    vec3 col;
    if (C.w < 0.0) {
      // a bud: a small sphere, deep pink
      float s = dot(d, C.xyz);
      float dist = length(d * s - C.xyz);
      a = lineCov(dist, R, angPix * s);
      float ef = clamp(dist / R, 0.0, 1.0);
      col = plantShade(vec3(0.55, 0.12, 0.2), 0.5, pow(ef, 2.0), d, L);
    } else {
      vec3 n = F.xyz;
      float dn = dot(d, n);
      if (abs(dn) < 0.08) continue;
      float s = dot(C.xyz, n) / dn;
      vec3 p = d * s - C.xyz;
      vec3 e1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + 1e-4), e2 = cross(n, e1);
      vec2 q = vec2(dot(p, e1), dot(p, e2)) / R;
      float rr = length(q), th = atan(q.y, q.x) + F.w;
      float lobe = pow(abs(cos(2.5 * th)), 0.3);
      float pet = (0.5 + 0.5 * lobe) * open;
      float fp = angPix * s / max(abs(dn), 0.25);
      a = fillCov((rr - pet) * R, fp);
      if (a <= 0.0) continue;
      bool centre = rr < 0.26;
      vec3 alb = centre ? vec3(0.6, 0.5, 0.15) : mix(vec3(0.95, 0.9, 0.9), vec3(0.95, 0.72, 0.78), smoothstep(0.1, 0.6, rr) * 0.6);
      float edge = smoothstep(pet - 0.3, pet, rr);
      col = plantShade(alb, centre ? 0.3 : 1.0, edge, d, L);
      // stamens: fine dots round the centre
      if (rr < 0.45 && rr > 0.22) col += L.moon * 0.05 * vec3(1.0, 0.85, 0.4) * step(0.7, fract(th * 3.2)) * a;
      depth = min(depth, s);
    }
    if (a <= 0.0) continue;
    acc += T * a * col;
    T *= 1.0 - a;
  }
  return vec4(acc, 1.0 - T);
}

// specks in the air near the viewer: on three shells round the eye, each speck in its own
// cell of azimuth and height, drifting slowly up and with the breeze; they sparkle when
// the moon is behind them (forward scattering), dimmer elsewhere
vec3 motes(vec3 d, float angPix, LandLight L, float maxD) {
  if (uMotes <= 0.0) return vec3(0.0);
  vec3 acc = vec3(0.0);
  float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
  for (int k = 0; k < 3; k++) {
    float R = 1.3 * pow(2.1, float(k));
    if (R > maxD) break;
    float cs = 0.28 / R;                                 // about one speck per 28 cm
    vec2 q = vec2(az, el) / cs;
    q.x -= uTime * 0.05 / (R * cs) * sin(uWindAz);       // carried by the breeze
    q.y -= uTime * 0.012 / (R * cs);                     // rising slowly
    vec2 ci = floor(q);
    for (int m = 0; m < 4; m++) {
      vec2 c = ci + vec2(m & 1, m >> 1);
      float h = hashL(c + float(k) * 71.0, 90.5);
      if (h > 0.35) continue;
      vec2 p = c + vec2(hashL(c + float(k) * 71.0, 91.5), hashL(c + float(k) * 71.0, 92.5));
      p += 0.3 * vec2(sin(uTime * 0.4 + h * 40.0), cos(uTime * 0.33 + h * 30.0));
      float dAng = length((q - p) * cs * vec2(cos(el), 1.0));
      float core = max(angPix * 0.7, 0.0012 / R);
      float g = exp(-pow(dAng / core, 2.0));
      if (g < 1e-3) continue;
      float tw = 0.6 + 0.4 * sin(uTime * (2.0 + 3.0 * h) + h * 50.0);
      acc += g * tw * (L.moon * (0.02 + 0.5 * hgPhase(L.cm, 0.75) * 0.1) + L.amb * 0.3);
    }
  }
  return acc * uMotes;
}

// distant low hills along the horizon: elevation (rad) at azimuth az
float hillTop(float az) {
  float n = fbm2(vec2(az * 2.6 + 3.0, 1.7), 4);
  return (0.004 + 0.022 * n * n) * uLand;
}

// ---------------- everything on the ground along d, in front of the sky
// returns premultiplied colour and coverage; vis = what still shows of the sky behind
vec4 landShade(vec3 d, float angPix, vec3 moonLight, out float vis, out float nearD) {
  LandLight L;
  L.moon = moonLight;
  vec3 ambUp = textureLod(tSkyView, vec2(0.5, 0.97), 6.0).rgb;
  vec3 ambH = textureLod(tSkyView, vec2(0.5, 0.56), 6.0).rgb;
  L.amb = mix(ambH, ambUp, 0.4) * 1.3;
  L.cm = dot(d, uMoonDirW);
  // mist: sky light and moonlight scattered forward round the moon
  L.mist = ambH * 1.15 + moonLight * (0.05 + 0.12 * hgPhase(L.cm, 0.72));
  float hl = max(length(d.xz), 1e-4);
  float az = atan(d.x, -d.z);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  nearD = 1e9;
  float tg = d.y < -1e-5 ? uLandEye / -d.y : 1e9;
  float Dg = tg * hl;

  // the plum branch, nearest of all
  if (uVeg.z > 0.0 && uBrN > 0) {
    float bd;
    vec4 b = branchHit(d, angPix, L, bd);
    if (b.a > 0.0) {
      float Tm = exp(-mistTau(d, bd));
      acc += (b.rgb * Tm + L.mist * (1.0 - Tm) * b.a) * uVeg.z;
      T *= 1.0 - b.a * uVeg.z;
      nearD = bd;
    }
  }

  // rings of plants, nearest first (what still shows at the start of each ring is kept for
  // the fireflies, drawn afterwards)
  float Tring[27];
  for (int k = 0; k < 27; k++) Tring[k] = 0.0;
  float r0 = uNear;
  int kEnd = 0;
  for (int k = 0; k < 26; k++) {
    kEnd = k;
    Tring[k] = T;
    float r1 = r0 * 1.27;
    if (r0 > Dg || T < 0.01) break;
    float rm = 0.5 * (r0 + r1);
    float tm = rm / hl;
    float ym = uLandEye + d.y * tm;
    // the ray has climbed over everything that grows from here on
    float tall = uVeg.w > 0.0 ? 16.0 : max(uFieldH * 1.5, 1.6);
    if (uLandEye + d.y * r0 / hl > tall && d.y > 0.0) { kEnd = k; break; }
    vec2 xzm = vec2(sin(az), -cos(az)) * rm;
    float fpr = angPix * tm;
    if (uVeg.x > 0.0 && r0 < 90.0) {
      // look up the clumps where the wind has carried the stems at this height
      float off = windAt(xzm, az, 0.0) * uFieldH * pow(clamp(ym / uFieldH, 0.0, 1.0), 2.0);
      float cw = 0.24 / r0;
      float ci = floor((az - off / rm) / cw);
      for (int m = -1; m <= 1; m++) {
        vec2 id = vec2(ci + float(m), float(k));
        if (hashL(id, 60.5) > 0.92 * uVeg.x) continue;
        float r = mix(r0, r1, hashL(id, 61.5));
        float y = uLandEye + d.y * r / hl;
        float xl = (az - (ci + float(m) + hashL(id, 62.5)) * cw) * r;
        grassClump(id, xl, y, xzm, az, d, fpr * r / rm, acc, T, L);
      }
    }
    if (uVeg.y > 0.0 && r0 < 70.0) {
      foliage(rm, ym, az * rm, d, fpr, 0.45, acc, T, L);
      float cw = 0.17 / r0;
      float ci = floor(az / cw);
      for (int m = -1; m <= 1; m++) {
        vec2 id = vec2(ci + float(m), float(k));
        if (hashL(id, 70.5) > 0.88 * uVeg.y) continue;
        float r = mix(r0, r1, hashL(id, 71.5));
        float y = uLandEye + d.y * r / hl;
        float xl = (az - (ci + float(m) + hashL(id, 72.5)) * cw) * r;
        flowerPlant(id, xl, y, xzm, az, d, fpr * r / rm, acc, T, L);
      }
    }
    if (uVeg.w > 0.0 && r0 > 12.0) {
      float cw = 11.0 / r0;
      float ci = floor(az / cw);
      for (int m = -1; m <= 1; m++) {
        vec2 id = vec2(ci + float(m), float(k) + 100.0);
        // groves: trees stand where a slow noise says so
        float taz = (ci + float(m) + 0.5) * cw;
        float grove = smoothstep(0.35, 0.75, vnoise2(vec2(taz * 2.2 + 5.0, 0.5)));
        float mAz = atan(uMoonDirW.x, -uMoonDirW.z);
        float open = smoothstep(0.1, 0.45, abs(mod(taz - mAz + 3.14159, 6.28318) - 3.14159));
        if (hashL(id, 80.5) > uVeg.w * (0.15 + 0.85 * grove) * open) continue;
        float r = mix(r0, r1, hashL(id, 81.5));
        float y = uLandEye + d.y * r / hl;
        float xl = (az - (ci + float(m) + 0.2 + 0.6 * hashL(id, 82.5)) * cw) * r;
        vec3 before = acc;
        float Tb = T;
        pineTree(id, xl, y, d, fpr * r / rm, acc, T, L);
        // the mist in front of the tree
        float Tm = exp(-mistTau(d, r / hl));
        acc = before + (acc - before) * Tm + L.mist * (Tb - T) * (1.0 - Tm);
      }
    }
    if (nearD > 1e8 && T < 0.5) nearD = tm;
    r0 = r1;
    kEnd = k + 1;
  }
  for (int k = 0; k < 27; k++) if (k >= kEnd) Tring[k] = T;
  // fireflies, each seen through what grows in front of it
  for (int i = 0; i < ${FLY_MAX}; i++) {
    if (i >= uFlyN) break;
    vec4 F = texelFetch(tLand, ivec2(i, 0), 0);
    float rf = length(F.xz);
    if (rf > Dg) continue;
    float df = length(F.xyz);
    float ang = acos(clamp(dot(d, F.xyz / df), -1.0, 1.0));
    float core = max(angPix * 0.9, 0.006 / df);
    if (ang > core * 40.0) continue;
    int kf = int(clamp(floor(log(max(rf / uNear, 1.0)) / log(1.27)), 0.0, 26.0));
    float g = exp(-pow(ang / core, 2.0)) + 0.15 * exp(-ang / (core * 5.0));
    float Tm = exp(-mistTau(d, df));
    acc += Tring[kf] * Tm * F.w * g * vec3(1.0, 0.82, 0.38) * 0.6 * uVeg.y;
  }

  // the ground: grass or meadow, dark, fading into the mist and haze
  if (d.y < -1e-5 && T > 0.0) {
    vec3 gp = d * tg;
    float n = fbm2l(gp.xz * 0.35, 4, angPix * tg * 0.35);
    vec3 alb = mix(vec3(0.035, 0.04, 0.026), vec3(0.06, 0.055, 0.04), n);
    if (uVeg.y > 0.0) {
      // far flowers: specks of colour in the grass
      float sp = fbm2l(gp.xz * 3.0, 3, angPix * tg * 3.0);
      alb = mix(alb, vec3(0.5, 0.25, 0.4), smoothstep(0.55, 0.8, sp) * 0.35 * uVeg.y);
    }
    vec3 c = alb * (L.moon * max(uMoonDirW.y, 0.0) + L.amb);
    float Tm = exp(-mistTau(d, tg));
    // haze toward the horizon
    float hz = 1.0 - exp(-tg / 9000.0);
    c = mix(c, ambH, hz);
    acc += T * (c * Tm + L.mist * (1.0 - Tm));
    if (nearD > 1e8) nearD = tg;
    T = 0.0;
  }
  // the hills on the horizon
  if (T > 0.0) {
    float el = asin(clamp(d.y, -1.0, 1.0));
    float ht = hillTop(az);
    float a = clamp((ht - el) / angPix + 0.5, 0.0, 1.0);
    if (a > 0.0) {
      vec3 c = mix(vec3(0.02, 0.025, 0.03) * (L.amb + L.moon * 0.2), ambH, 0.55);
      float Tm = exp(-mistTau(d, 4000.0));
      acc += T * a * (c * Tm + L.mist * (1.0 - Tm));
      T *= 1.0 - a;
    }
    // mist over the sky itself
    float Tm = exp(-mistTau(d, 1e6));
    acc += T * L.mist * (1.0 - Tm);
    vis = T * Tm;
  } else vis = 0.0;
  // specks in the air, in front of whatever is there (roughly: not behind the nearest plants)
  acc += motes(d, angPix, L, nearD);
  return vec4(acc, 1.0 - T);
}
`;
