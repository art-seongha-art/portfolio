// Moon — standing on the moon at night, near the south pole, as the Earth comes up over
// the rim ahead. The sun is below the horizon behind the viewer; the nearly full Earth is
// the only light, so it lights the ground from behind: the edges of rocks, crater rims and
// the rabbits catch it and the shadows run toward the room, and the light spreads down the
// slope toward the viewer as the Earth rises.
// Human scale: the ground at the foot of the walls continues the floor of the room. The
// ground is procedural regolith (gentle swells, a crater rim ahead, small craters and
// rocks) with the same height function in GLSL and JS, so the rabbits land on it. The
// camera does not move and the Earth only moves up and down, so the ground is ray-marched
// once into a per-wall cache (albedo, normal, distance, and how high the skyline stands
// toward the Earth); each frame lights it for the Earth's height and adds the rabbits.
//
// An easter egg for Chuseok: a few small moon rabbits hop about.

export const SURF_SUN = { az: 196, el: -5 };   // below the horizon, behind: only for the Earth's phase
export const SURF_EARTH = { az: 3, lat: 25, lon: 100, radius: 3.2 }; // East Asia on the sunlit side; drawn large
export const SURF_LIGHT = [0.8, 0.88, 1.0];     // earthlight: sunlight off clouds and ocean
export const RAB_MAX = 6;
const R_MOON = 1737400;
const D2R = Math.PI / 180;
const EARTH_DIR = [Math.sin(SURF_EARTH.az * D2R), -Math.cos(SURF_EARTH.az * D2R)]; // toward the Earth (x, z)

// ------------------------------------------------------------------ ground (GLSL and JS)
// integer hash and value noise; the JS copies below give the same numbers
export const SURF_COMMON = `
uniform vec3  uSurfLight;     // unit vector toward the Earth (world): the only light
uniform float uSurfBase;      // ground height at the viewer + eye height (m): world y = height - this
const float R_MOON = 1737400.0;

uint shs(ivec2 c, uint s) {
  uvec2 u = uvec2(c + 32768);
  uint h = (u.x * 0x8da6b343u) ^ (u.y * 0xd8163841u) ^ (s * 0xcb1ab31fu);
  h ^= h >> 15u; h *= 0x2c1b3c6du; h ^= h >> 12u; h *= 0x297a2d39u; h ^= h >> 15u;
  return h;
}
float sh1(ivec2 c, uint s) { return float(shs(c, s) >> 8u) / 16777215.0; }
float vns(vec2 p, uint s) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(sh1(c, s), sh1(c + ivec2(1, 0), s), u.x), mix(sh1(c + ivec2(0, 1), s), sh1(c + ivec2(1, 1), s), u.x), u.y);
}
// a crater (bowl and raised rim) at x = distance / radius
float craterP(float x, float D) {
  float bowl = x < 1.0 ? D * (x * x - 1.0) : 0.0;
  float e = x - 1.0;
  return bowl + D * 0.3 * exp(-e * e / 0.08);
}
float craterF(vec2 p, float C, uint s, float pr, float r0, float r1) {
  vec2 q = p / C;
  ivec2 b = ivec2(floor(q));
  float h = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = b + ivec2(i, j);
    if (sh1(c, s) > pr) continue;
    vec2 ctr = (vec2(c) + 0.15 + 0.7 * vec2(sh1(c, s + 1u), sh1(c, s + 2u))) * C;
    float z = sh1(c, s + 3u);
    float R = C * (r0 + (r1 - r0) * z * z);
    float x = length(p - ctr) / R;
    if (x < 2.0) h += craterP(x, R * (0.16 + 0.24 * sh1(c, s + 4u)));
  }
  return h;
}
// half-buried rocks: the highest one here (m)
float rockF(vec2 p, float C, uint s, float pr, float a0, float a1) {
  vec2 q = p / C;
  ivec2 b = ivec2(floor(q));
  float h = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = b + ivec2(i, j);
    if (sh1(c, s) > pr) continue;
    vec2 ctr = (vec2(c) + 0.2 + 0.6 * vec2(sh1(c, s + 1u), sh1(c, s + 2u))) * C;
    float z = sh1(c, s + 3u);
    float a = a0 + (a1 - a0) * z * z;
    vec2 dv = p - ctr;
    float d2 = dot(dv, dv);
    if (d2 >= a * a * 1.7) continue;
    float th = atan(dv.y, dv.x);
    float ph = 6.2831853 * sh1(c, s + 4u);
    float ra = a * (1.0 + 0.2 * sin(3.0 * th + ph) + 0.09 * sin(5.0 * th + 2.0 * ph));
    float e = 1.0 - d2 / (ra * ra);
    if (e > 0.0) h = max(h, a * (0.45 + 0.4 * sh1(c, s + 5u)) * pow(e, 0.6));
  }
  return h;
}
// gentle swells, and the crater rim ahead (-z) with the crater falling away beyond it
float surfBase(vec2 p) {
  float h = 1.6 * (vns(p / 70.0, 11u) - 0.5) + 0.7 * (vns(p / 26.0, 12u) - 0.5) + 0.25 * (vns(p / 8.0, 13u) - 0.5);
  float zc = 19.0 + 3.0 * (vns(vec2(p.x / 22.0, 0.5), 14u) - 0.5);
  float hc = 2.2 + 0.8 * (vns(vec2(p.x / 15.0, 3.5), 15u) - 0.5);
  float v = -p.y;
  float x = clamp((v - 1.0) / (zc - 1.0), 0.0, 1.0);
  float u = v - zc;
  float rim = v <= zc ? hc * x * x * (3.0 - 2.0 * x) : hc - 0.25 * u - 0.05 * u * u;
  // behind the viewer the outer flank keeps falling gently away from the rim
  float w = max(1.0 - v, 0.0);
  rim -= 0.09 * (sqrt(w * w + 16.0) - 4.0);
  return h + rim - dot(p, p) / (2.0 * R_MOON);
}
// + craters and rocks, with the small ones only where they can be seen
float surfH(vec2 p, out float rock) {
  float r = length(p);
  float h = surfBase(p) + craterF(p, 18.0, 21u, 0.35, 0.12, 0.35);
  if (r < 160.0) h += smoothstep(160.0, 110.0, r) * craterF(p, 5.5, 22u, 0.45, 0.07, 0.3);
  if (r < 48.0) h += smoothstep(48.0, 32.0, r) * craterF(p, 1.7, 23u, 0.4, 0.06, 0.28);
  float rk = 0.0;
  if (r < 210.0) rk = smoothstep(210.0, 150.0, r) * rockF(p, 9.0, 32u, 0.2, 0.18, 0.65);
  if (r < 48.0) rk = max(rk, smoothstep(48.0, 32.0, r) * rockF(p, 2.4, 31u, 0.28, 0.04, 0.2));
  rock = step(0.004, rk);
  return h + rk;
}
`;

function shs(cx, cy, s) {
  const ux = (cx + 32768) >>> 0, uy = (cy + 32768) >>> 0;
  let h = (Math.imul(ux, 0x8da6b343) ^ Math.imul(uy, 0xd8163841) ^ Math.imul(s >>> 0, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const sh1 = (cx, cy, s) => (shs(cx, cy, s) >>> 8) / 16777215;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vns(px, py, s) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = sh1(ix, iy, s), b = sh1(ix + 1, iy, s), c = sh1(ix, iy + 1, s), d = sh1(ix + 1, iy + 1, s);
  const m0 = a + (b - a) * ux, m1 = c + (d - c) * ux;
  return m0 + (m1 - m0) * uy;
}
function craterP(x, D) {
  const bowl = x < 1 ? D * (x * x - 1) : 0;
  const e = x - 1;
  return bowl + D * 0.3 * Math.exp((-e * e) / 0.08);
}
function craterF(px, py, C, s, pr, r0, r1) {
  const bx = Math.floor(px / C), by = Math.floor(py / C);
  let h = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = bx + i, cy = by + j;
      if (sh1(cx, cy, s) > pr) continue;
      const ox = (cx + 0.15 + 0.7 * sh1(cx, cy, s + 1)) * C, oy = (cy + 0.15 + 0.7 * sh1(cx, cy, s + 2)) * C;
      const z = sh1(cx, cy, s + 3);
      const R = C * (r0 + (r1 - r0) * z * z);
      const x = Math.hypot(px - ox, py - oy) / R;
      if (x < 2) h += craterP(x, R * (0.16 + 0.24 * sh1(cx, cy, s + 4)));
    }
  }
  return h;
}
function rockF(px, py, C, s, pr, a0, a1) {
  const bx = Math.floor(px / C), by = Math.floor(py / C);
  let h = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = bx + i, cy = by + j;
      if (sh1(cx, cy, s) > pr) continue;
      const ox = (cx + 0.2 + 0.6 * sh1(cx, cy, s + 1)) * C, oy = (cy + 0.2 + 0.6 * sh1(cx, cy, s + 2)) * C;
      const z = sh1(cx, cy, s + 3);
      const a = a0 + (a1 - a0) * z * z;
      const dx = px - ox, dy = py - oy, d2 = dx * dx + dy * dy;
      if (d2 >= a * a * 1.7) continue;
      const th = Math.atan2(dy, dx), ph = 2 * Math.PI * sh1(cx, cy, s + 4);
      const ra = a * (1 + 0.2 * Math.sin(3 * th + ph) + 0.09 * Math.sin(5 * th + 2 * ph));
      const e = 1 - d2 / (ra * ra);
      if (e > 0) h = Math.max(h, a * (0.45 + 0.4 * sh1(cx, cy, s + 5)) * Math.pow(e, 0.6));
    }
  }
  return h;
}
function surfBase(px, py) {
  let h = 1.6 * (vns(px / 70, py / 70, 11) - 0.5) + 0.7 * (vns(px / 26, py / 26, 12) - 0.5) + 0.25 * (vns(px / 8, py / 8, 13) - 0.5);
  const zc = 19 + 3 * (vns(px / 22, 0.5, 14) - 0.5);
  const hc = 2.2 + 0.8 * (vns(px / 15, 3.5, 15) - 0.5);
  const v = -py;
  const x = Math.min(1, Math.max(0, (v - 1) / (zc - 1)));
  const u = v - zc;
  let rim = v <= zc ? hc * x * x * (3 - 2 * x) : hc - 0.25 * u - 0.05 * u * u;
  const w = Math.max(1 - v, 0);
  rim -= 0.09 * (Math.sqrt(w * w + 16) - 4);
  return h + rim - (px * px + py * py) / (2 * R_MOON);
}
export function surfH(px, py) {
  const r = Math.hypot(px, py);
  let h = surfBase(px, py) + craterF(px, py, 18, 21, 0.35, 0.12, 0.35);
  if (r < 160) h += sstep(160, 110, r) * craterF(px, py, 5.5, 22, 0.45, 0.07, 0.3);
  if (r < 48) h += sstep(48, 32, r) * craterF(px, py, 1.7, 23, 0.4, 0.06, 0.28);
  let rk = 0;
  if (r < 210) rk = sstep(210, 150, r) * rockF(px, py, 9, 32, 0.2, 0.18, 0.65);
  if (r < 48) rk = Math.max(rk, sstep(48, 32, r) * rockF(px, py, 2.4, 31, 0.28, 0.04, 0.2));
  return h + rk;
}
// how high the skyline stands toward the Earth's azimuth, seen from (x, y, z): elevation
// (rad). The Earth only moves up and down here, so this is all the shadows need.
export function horizonEl(x, y, z) {
  let s = 0.05, best = -1e3;
  for (let i = 0; i < 90; i++) {
    const qx = x + EARTH_DIR[0] * s, qz = z + EARTH_DIR[1] * s;
    // craters and rocks stand at most ~1.6 m above the swells
    if ((surfBase(qx, qz) + 1.6 - y) / s > best) best = Math.max(best, (surfH(qx, qz) - y) / s);
    s += 0.04 + s * 0.09;
    if (s > 400) break;
  }
  return Math.atan(best);
}
// how much of a disc of angular radius r, its centre at elevation e, stands above a
// skyline at elevation h (rad): 0..1
export function discAbove(e, h, r) {
  const x = Math.min(1, Math.max(-1, (e - h) / r));
  return 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
}

// ------------------------------------------------------------------ the cached ground
export function surfCacheFS() {
  return `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 oA;   // albedo, normal x and z, distance (m; < 0 = sky)
layout(location = 1) out vec4 oB;   // skyline elevation toward the Earth (rad), openness, -, coverage
uniform vec4  uView;
uniform vec3  uPA, uDU, uDV;
uniform vec2  uBand;
${SURF_COMMON}

float gY(vec2 p) { float r; return surfH(p, r) - uSurfBase; }
float gYb(vec2 p) { return surfBase(p) - uSurfBase; }

// regolith roughness below the height field (shading only): tiny craters and clods
float fineH(vec2 p, float fp) {
  float w1 = smoothstep(0.35, 0.08, fp), w2 = smoothstep(0.09, 0.02, fp), w3 = smoothstep(0.03, 0.006, fp);
  float h = 0.0;
  if (w1 > 0.0) h += w1 * (0.014 * (vns(p / 0.3, 41u) - 0.5) + craterF(p, 0.45, 24u, 0.3, 0.08, 0.3));
  if (w2 > 0.0) h += w2 * 0.006 * (vns(p / 0.09, 42u) - 0.5);
  if (w3 > 0.0) h += w3 * 0.0025 * (vns(p / 0.028, 43u) - 0.5);
  return h;
}
// the skyline toward the Earth's azimuth seen from p: tan of its elevation
float horizonTan(vec3 p, vec2 dir) {
  float s = 0.05, best = -1e3;
  for (int i = 0; i < 96; i++) {
    vec2 q = p.xz + dir * s;
    // craters and rocks stand at most ~1.6 m above the swells
    if ((gYb(q) + 1.6 - p.y) / s > best) best = max(best, (gY(q) - p.y) / s);
    s += 0.03 + s * 0.08;
    if (s > 400.0) break;
  }
  return best;
}
// the same for the fine bumps beside p, on top of the slope of the ground along dir
float microTan(vec2 p, vec2 dir, float fp, float slope) {
  float h0 = fineH(p, fp);
  float occ = -1e3;
  float dl = max(fp, 0.004);
  for (int i = 0; i < 5; i++) {
    occ = max(occ, (fineH(p + dir * dl, fp) - h0) / dl);
    dl *= 2.3;
  }
  return slope + occ;
}
// how open the ground is round p (1 = flat, less in hollows and crater bowls)
float openness(vec3 p, float fp) {
  float r = max(0.5, fp * 3.0), occ = 0.0;
  for (int k = 0; k < 8; k++) {
    vec2 u = vec2(cos(0.7854 * float(k)), sin(0.7854 * float(k)));
    occ += max(gY(p.xz + u * r) - p.y, 0.0) / r + max(gY(p.xz + u * r * 3.5) - p.y, 0.0) / (r * 3.5);
  }
  return 1.0 / (1.0 + 0.35 * occ);
}
// what the ground is at p: albedo, normal (with the fine bumps), its skyline toward the
// Earth and how open it is
void gbuf(vec3 p, float t, float angPix, out vec4 A, out vec4 B) {
  float fp = t * angPix;
  float e = max(fp, 0.003);
  float hx = gY(p.xz + vec2(e, 0.0)) - gY(p.xz - vec2(e, 0.0));
  float hz = gY(p.xz + vec2(0.0, e)) - gY(p.xz - vec2(0.0, e));
  float fx = fineH(p.xz + vec2(e, 0.0), fp) - fineH(p.xz - vec2(e, 0.0), fp);
  float fz = fineH(p.xz + vec2(0.0, e), fp) - fineH(p.xz - vec2(0.0, e), fp);
  vec3 N = normalize(vec3(-(hx + fx) / (2.0 * e), 1.0, -(hz + fz) / (2.0 * e)));
  float rock;
  surfH(p.xz, rock);
  float alb = 0.155 * (0.84 + 0.32 * vns(p.xz / 4.0, 51u)) * (0.92 + 0.16 * vns(p.xz / 0.55, 52u));
  alb = mix(alb, 0.2 * (0.75 + 0.5 * vns(p.xz / 0.2, 53u)), rock);
  vec2 dir = normalize(uSurfLight.xz);
  float slope = (hx * dir.x + hz * dir.y) / (2.0 * e);
  float ht = max(horizonTan(p + vec3(0.0, 0.003, 0.0), dir), microTan(p.xz, dir, fp, slope));
  A = vec4(alb, N.x, N.z, t);
  B = vec4(atan(ht), openness(p, fp), 0.0, 1.0);
}

void main() {
  vec2 pix = gl_FragCoord.xy - uView.xy;
  if (pix.y < uBand.x || pix.y >= uBand.y) discard;
  vec2 f = pix / uView.zw;
  vec3 d = normalize(uPA + f.x * uDU + f.y * uDV);
  vec3 dX = normalize(uPA + ((pix.x + 1.0) / uView.z) * uDU + (pix.y / uView.w) * uDV);
  float angPix = length(dX - d);
  // march the height field; small features are only looked up close to the ground
  float t = 0.05, tPrev = t, minClr = 1e9, tMin = -1.0;
  float hit = -1.0;
  for (int i = 0; i < 360; i++) {
    vec3 p = d * t;
    float c0 = p.y - gYb(p.xz);
    float clr = c0 > 1.2 ? c0 - 1.0 : p.y - gY(p.xz);
    if (clr < 0.0) {
      float a = tPrev, b = t;
      for (int k = 0; k < 10; k++) {
        float m = 0.5 * (a + b);
        vec3 pm = d * m;
        if (pm.y - gY(pm.xz) < 0.0) b = m; else a = m;
      }
      hit = b;
      break;
    }
    float cp = clr / max(t * angPix, 1e-5);
    if (cp < minClr) { minClr = cp; tMin = t; }
    tPrev = t;
    t += max(clr * (c0 > 1.2 ? 1.2 : 0.45), 0.004 + t * 0.0015);
    if (t > 3000.0 || (d.y > 0.0 && p.y > 40.0)) break;
  }
  if (hit > 0.0) {
    gbuf(d * hit, hit, angPix, oA, oB);
  } else if (minClr < 1.0 && tMin > 0.0) {
    // a ray that just clears the skyline: part ground, for smooth edges
    vec3 p = d * tMin;
    p.y = gY(p.xz);
    gbuf(p, tMin, angPix, oA, oB);
    oA.w = -1.0;
    oB.w = clamp(1.0 - minClr, 0.0, 1.0);
  } else {
    oA = vec4(0.0, 0.0, 0.0, -1.0);
    oB = vec4(0.0);
  }
}`;
}

// ------------------------------------------------------------------ lighting the cached ground (GLSL)
// with the rabbits below: both are drawn in the main pass
const GROUND_LIGHT_GLSL = `
uniform vec3  uSurfLight;    // unit vector toward the Earth
uniform vec3  uSurfLightC;   // earthlight (rgb)
uniform float uSurfLightR;   // the Earth's angular radius (rad)
uniform float uSurfAmb;      // light thrown back by the lit ground, relative to the earthlight

// how much of a disc of radius r, its centre at elevation e, stands above a skyline at h
float discAbove(float e, float h, float r) {
  float x = clamp((e - h) / r, -1.0, 1.0);
  return 0.5 + (x * sqrt(1.0 - x * x) + asin(x)) / 3.14159265;
}
// the cached ground (GA: albedo, normal x and z, distance; GB: skyline elevation toward
// the Earth, openness) lit by the Earth at its present height, seen along d: direct
// light, and the light from the surroundings in amb
vec3 groundLight(vec4 GA, vec4 GB, vec3 d, out vec3 amb) {
  vec3 N = vec3(GA.y, sqrt(max(1.0 - GA.y * GA.y - GA.z * GA.z, 0.0)), GA.z);
  vec3 L = uSurfLight, V = -d;
  float vis = discAbove(asin(clamp(L.y, -1.0, 1.0)), GB.x, uSurfLightR);
  // a wide light: a surface turned just past it still sees part of the disc
  float sr = sin(uSurfLightR), nl = dot(N, L);
  float mu0 = nl > sr ? nl : (nl > -sr ? (nl + sr) * (nl + sr) / (4.0 * sr) : 0.0);
  float mu = max(dot(N, V), 0.0);
  float alpha = acos(clamp(dot(L, V), -1.0, 1.0));
  // Lambert, without regolith's pull back toward the light, so that the ground looking
  // away from the Earth (at the back of the side walls) stays dim ...
  float back = 0.3;
  // ... and single scattering, forward, by the finest dust: seen against the light at a
  // grazing angle the path through the top layer is long, so edges glow - the crest of
  // the rim, the lips of craters, the tops of rocks
  float fwd = 0.2 * exp((alpha - 3.14159265) / 0.35) / (mu0 + mu + 0.02);
  vec3 alb = GA.x * vec3(1.0, 0.968, 0.916) * uSurfLightC;
  // the surroundings: light off the lit ground ahead, less in hollows
  vec3 Lh = normalize(vec3(L.x, 0.35, L.z));
  amb = alb * uSurfAmb * GB.y * (0.6 + 0.4 * dot(N, Lh));
  return alb * mu0 * (back + fwd) * vis;
}
`;

// ------------------------------------------------------------------ rabbits (GLSL)
export const SURF_GLSL = GROUND_LIGHT_GLSL + `
const float RIM = 0.1;
uniform int   uRabN;
uniform vec4  uRabP[${RAB_MAX}];   // root on the ground between the hind feet (world, m), yaw (rad)
uniform vec4  uRabQ[${RAB_MAX}];   // pose: stretch in a leap, sitting up, ears laid back (rad), head bowed (rad)
uniform vec4  uRabR[${RAB_MAX}];   // pitch (rad), size, lit by the Earth (0..1)

float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdCap(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// a rabbit in its own frame: origin on the ground between the hind feet, +y up, +z the
// way it faces, metres. mat: 0 fur, 1 eye, 2 nose
float sdRabbit(vec3 p, vec4 pose, out float mat) {
  float s = pose.x;
  p.x = abs(p.x);
  // the upper body rises round the haunches when it sits up
  vec3 pv = vec3(0.0, 0.07, -0.07);
  vec3 q = p;
  q.yz = rot2(pose.y * 1.05) * (q.yz - pv.yz) + pv.yz;
  // body and chest: longer and flatter in a leap
  float d = sdEll(q - vec3(0.0, 0.125 + 0.01 * s, -0.025 - 0.02 * s), vec3(0.082, 0.098 - 0.014 * s, 0.135 + 0.045 * s));
  d = smin(d, sdEll(q - vec3(0.0, 0.13 + 0.012 * s, 0.07 + 0.035 * s), vec3(0.066, 0.076, 0.074)), 0.05);
  // haunches, hind feet under the body (or trailing behind in a leap)
  d = smin(d, sdEll(p - vec3(0.047, 0.078 + 0.03 * s, -0.06 - 0.05 * s), vec3(0.046, 0.07, 0.085)), 0.04);
  vec3 heel = mix(vec3(0.047, 0.014, -0.085), vec3(0.047, 0.1, -0.14), s);
  vec3 toe = mix(vec3(0.047, 0.012, 0.055), vec3(0.047, 0.07, -0.27), s);
  d = smin(d, sdCap(p, heel, toe, 0.019), 0.03);
  // front legs: under the chest, reaching forward in a leap
  vec3 sh = vec3(0.03, 0.1, 0.09 + 0.04 * s);
  vec3 paw = mix(vec3(0.03, 0.012, 0.12), vec3(0.03, 0.06, 0.24), s);
  d = smin(d, sdCap(q, sh, paw, 0.014), 0.025);
  // head, bowed or not, with a snout
  vec3 hq = q - vec3(0.0, 0.205 + 0.012 * s, 0.135 + 0.04 * s);
  // (the head stays level when it sits up, so the ears stand straight)
  hq.yz = rot2(-pose.w - 0.9 * pose.y) * hq.yz;
  float head = sdEll(hq, vec3(0.052, 0.055, 0.07));
  head = smin(head, sdEll(hq - vec3(0.0, -0.013, 0.052), vec3(0.03, 0.03, 0.034)), 0.03);
  d = smin(d, head, 0.035);
  // ears from the crown, splayed a little and laid back by pose.z
  vec3 eq = hq - vec3(0.02, 0.04, -0.02);
  eq.yz = rot2(pose.z) * eq.yz;
  eq.xy = rot2(0.14) * eq.xy;
  d = smin(d, sdEll(eq - vec3(0.0, 0.072, 0.0), vec3(0.017, 0.074, 0.027)), 0.012);
  // tail
  d = smin(d, length(p - vec3(0.0, 0.12 + 0.03 * s, -0.165 - 0.04 * s)) - 0.029, 0.02);
  mat = 0.0;
  float eye = length(hq - vec3(0.039, 0.012, 0.03)) - 0.0105;
  if (eye < d) { d = eye; mat = 1.0; }
  float nose = length(hq - vec3(0.0, -0.004, 0.086)) - 0.0075;
  if (nose < d) { d = nose; mat = 2.0; }
  return d;
}
vec3 rabLocal(vec3 w, int i) {
  vec4 P = uRabP[i];
  vec3 v = w - P.xyz;
  float cy = cos(P.w), sy = sin(P.w);
  vec3 l = vec3(dot(v, vec3(cy, 0.0, sy)), v.y, dot(v, vec3(sy, 0.0, -cy))) / uRabR[i].y;
  vec2 pv = vec2(0.12, -0.02);
  l.yz = rot2(uRabR[i].x) * (l.yz - pv) + pv;
  return l;
}
float rabSD(vec3 w, int i, out float mat) { return sdRabbit(rabLocal(w, i), uRabQ[i], mat) * uRabR[i].y; }

// shadows of the rabbits on the ground point pg (the Earth is low: they are long, and soft
// because it is wide)
float rabbitShadow(vec3 pg) {
  float res = 1.0, m;
  vec3 L = uSurfLight;
  for (int i = 0; i < ${RAB_MAX}; i++) {
    if (i >= uRabN) break;
    float sc = uRabR[i].y;
    vec3 c = uRabP[i].xyz + vec3(0.0, 0.2 * sc, 0.0);
    vec3 oc = c - pg;
    float sp = dot(oc, L);
    float rr = 0.42 * sc;
    if (sp < 0.0) continue;
    vec3 cl = oc - L * sp;
    if (dot(cl, cl) > rr * rr) continue;
    float s = max(sp - rr, 0.01);
    for (int k = 0; k < 20; k++) {
      float dd = rabSD(pg + L * s, i, m);
      res = min(res, dd / (s * 0.012 + 0.004));
      if (res < 0.0) break;
      s += max(dd, 0.008);
      if (s > sp + rr) break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

// the rabbits in front of whatever is at distance tMax: colour (premultiplied) and coverage
vec4 rabbits(vec3 d, float angPix, float tMax) {
  vec4 outc = vec4(0.0);
  float best = tMax;
  vec3 L = uSurfLight;
  for (int i = 0; i < ${RAB_MAX}; i++) {
    if (i >= uRabN) break;
    float sc = uRabR[i].y;
    vec3 c = uRabP[i].xyz + vec3(0.0, 0.2 * sc, 0.0);
    float rr = 0.42 * sc;
    float b = dot(c, d);
    float disc = b * b - (dot(c, c) - rr * rr);
    if (disc <= 0.0) continue;
    float sq = sqrt(disc);
    float t = max(b - sq, 0.0), t1 = min(b + sq, best);
    if (t >= t1) continue;
    float m, minC = 1e9, tMin = t;
    bool hit = false;
    for (int k = 0; k < 64; k++) {
      float dd = rabSD(d * t, i, m);
      float px = max(t * angPix, 1e-5);
      if (dd < px * 0.3) { hit = true; break; }
      if (dd / px < minC) { minC = dd / px; tMin = t; }
      t += dd * 0.9;
      if (t > t1) break;
    }
    float cov = hit ? 1.0 : clamp(1.0 - minC, 0.0, 1.0);
    if (cov <= 0.0) continue;
    if (!hit) t = tMin;
    vec3 p = d * t;
    // normal (tetrahedral differences)
    const vec2 k2 = vec2(1.0, -1.0);
    float e = max(t * angPix * 0.5, 0.0015);
    vec3 n = normalize(k2.xyy * rabSD(p + k2.xyy * e, i, m) + k2.yyx * rabSD(p + k2.yyx * e, i, m)
                     + k2.yxy * rabSD(p + k2.yxy * e, i, m) + k2.xxx * rabSD(p + k2.xxx * e, i, m));
    rabSD(p, i, m);
    // self shadow toward the Earth
    float self = 1.0, s = 0.02;
    for (int k = 0; k < 12; k++) {
      float dd = rabSD(p + L * s, i, m);
      self = min(self, 12.0 * dd / s);
      s += max(dd, 0.01);
      if (s > 0.6) break;
    }
    rabSD(p, i, m);
    float lit = uRabR[i].z * clamp(self, 0.0, 1.0);
    vec3 v = -d;
    vec3 alb = m < 0.5 ? vec3(0.62, 0.6, 0.57) : (m < 1.5 ? vec3(0.02) : vec3(0.3, 0.16, 0.16));
    float wrap = max((dot(n, L) + 0.35) / 1.35, 0.0);
    vec3 col = alb * wrap * lit;
    // soft fur glows at the edge when the light is behind it
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * (0.35 + 0.65 * max(dot(-v, L), 0.0)) * lit;
    col += vec3(0.9, 0.88, 0.85) * rim * (m < 0.5 ? RIM : 0.1);
    // light from the ground round about
    col += alb * uSurfAmb * 1.6 * (0.6 - 0.4 * n.y);
    if (m > 0.5 && m < 1.5) col += vec3(1.0) * pow(max(dot(reflect(-L, n), v), 0.0), 60.0) * 2.0 * lit;
    col *= 0.32 * uSurfLightC;
    // premultiplied: nearer rabbits were drawn later only if in front (best)
    outc = vec4(outc.rgb * (1.0 - cov) + col * cov, outc.a + cov * (1.0 - outc.a));
    if (hit) best = t;
  }
  return outc;
}
`;

// ------------------------------------------------------------------ the rabbits' moves (JS)
// Each rabbit sits, turns and hops; a hop is a parabola in lunar gravity, so a 2 s leap
// goes about 0.8 m high. Times are seconds into the scene; the Earth's centre clears the
// rim at about 20 s, and the light reaches the ground near the room from about 80 s.
const G = 1.62;
const RABBITS = [
  { // on the rim, in front of the Earth as it comes up; leaps across it and back, comes
    // down the slope into the light and goes back over the rim
    size: 0.95, from: [1.3, -18.25], yaw: -90, moves: [
      ['sit', 44, { up: [20, 37], groom: [39, 43] }],
      ['hop', -0.8, -18.2, 1.9], ['wait', 0.5], ['hop', -2.9, -18.05, 1.9],
      ['sit', 8, {}], ['turn', 1.0, 90], ['sit', 3, {}],
      ['hop', -0.6, -18.2, 2.0], ['wait', 0.6], ['hop', 1.6, -18.3, 2.0], ['wait', 0.5], ['hop', 3.8, -18.1, 2.0],
      ['sit', 12, { groom: [3, 8] }],
      ['hop', 5.0, -16.0, 2.1], ['wait', 0.5], ['hop', 6.0, -13.6, 2.2],
      ['sit', 22, { up: [4, 10], groom: [14, 19] }],
      ['hop', 5.0, -16.2, 2.1], ['wait', 0.5], ['hop', 4.3, -18.05, 2.0],
      ['sit', 10, { up: [2, 7] }], ['turn', 0.8, 10], ['hop', 3.9, -20.6, 2.2],
      ['gone'],
    ] },
  { // a pair along the rim from the left, down the slope and off toward the left wall
    size: 0.8, from: [-15.0, -18.5], yaw: 85, moves: [
      ['sit', 16, { groom: [4, 10] }],
      ['hop', -13.0, -18.4, 1.9], ['wait', 0.4], ['hop', -11.0, -18.1, 1.9], ['wait', 0.5], ['hop', -9.0, -17.8, 1.9],
      ['sit', 10, { groom: [2, 6] }],
      ['hop', -7.2, -17.9, 1.8], ['wait', 0.4], ['hop', -5.4, -17.9, 1.9],
      ['sit', 20, { up: [3, 8], groom: [12, 16] }],
      ['hop', -6.5, -15.5, 2.1], ['wait', 0.5], ['hop', -7.8, -13.0, 2.2],
      ['sit', 18, { groom: [5, 11] }],
      ['hop', -9.4, -10.0, 2.3], ['wait', 0.4], ['hop', -11.0, -7.0, 2.3], ['wait', 0.4], ['hop', -12.6, -4.0, 2.3],
      ['sit', 22, { up: [4, 9], groom: [13, 18] }],
      ['hop', -15.0, -1.2, 2.4], ['wait', 0.5], ['hop', -17.8, 1.4, 2.4],
      ['sit', 24, { groom: [6, 12] }],
      ['hop', -16.2, -1.2, 2.3], ['wait', 0.5], ['hop', -14.6, -3.8, 2.3],
      ['sit', 60, { up: [4, 9] }],
    ] },
  {
    size: 0.72, from: [-16.8, -18.5], yaw: 80, moves: [
      ['sit', 19, {}],
      ['hop', -14.8, -18.5, 1.8], ['wait', 0.5], ['hop', -12.6, -18.3, 1.9], ['wait', 0.4], ['hop', -10.5, -17.9, 1.8],
      ['sit', 11, {}],
      ['hop', -8.4, -17.7, 1.8], ['wait', 0.5], ['hop', -6.8, -17.4, 1.8],
      ['sit', 19, { groom: [4, 9] }],
      ['hop', -7.9, -15.2, 2.0], ['wait', 0.5], ['hop', -9.0, -12.6, 2.1],
      ['sit', 18, {}],
      ['hop', -10.6, -9.6, 2.2], ['wait', 0.5], ['hop', -12.0, -6.6, 2.3], ['wait', 0.4], ['hop', -13.8, -3.4, 2.3],
      ['sit', 20, { up: [5, 10] }],
      ['hop', -16.2, -0.4, 2.4], ['wait', 0.5], ['hop', -19.2, 2.0, 2.4],
      ['sit', 27, {}],
      ['hop', -17.6, -0.8, 2.3], ['wait', 0.5], ['hop', -15.8, -3.2, 2.2],
      ['sit', 60, {}],
    ] },
  { // from the dark by the right wall, up the slope into the light, and back down
    size: 0.85, from: [12.0, 2.0], yaw: -30, moves: [
      ['sit', 34, {}],
      ['hop', 10.5, -1.5, 2.3], ['wait', 0.5], ['hop', 9.0, -5.0, 2.3], ['wait', 0.6], ['hop', 8.0, -8.5, 2.3],
      ['sit', 6, {}],
      ['hop', 7.0, -11.5, 2.2], ['wait', 0.5], ['hop', 6.4, -14.4, 2.1],
      ['sit', 16, { groom: [3, 9] }],
      ['hop', 8.4, -15.6, 2.0], ['wait', 0.5], ['hop', 10.4, -16.6, 2.0],
      ['sit', 20, { up: [4, 10] }],
      ['hop', 9.6, -13.8, 2.2], ['wait', 0.5], ['hop', 8.8, -10.8, 2.2],
      ['sit', 14, { groom: [4, 9] }],
      ['hop', 10.6, -8.0, 2.2], ['wait', 0.5], ['hop', 12.4, -5.2, 2.3],
      ['sit', 18, { up: [5, 10] }],
      ['hop', 10.4, -7.8, 2.2], ['wait', 0.5], ['hop', 8.6, -10.6, 2.2],
      ['sit', 8, {}], ['hop', 7.2, -13.2, 2.1],
      ['sit', 60, { groom: [4, 10] }],
    ] },
  { // near the room on the left, in the dark: it catches the light at the top of each hop
    size: 0.85, from: [-5.0, -7.0], yaw: 40, moves: [
      ['sit', 52, { groom: [20, 30] }],
      ['hop', -3.0, -8.6, 2.2], ['wait', 0.4], ['hop', -1.0, -10.2, 2.2],
      ['sit', 8, {}],
      ['hop', 1.4, -9.0, 2.2], ['wait', 0.5], ['hop', 2.2, -6.6, 2.2],
      ['sit', 16, { up: [4, 9] }],
      ['hop', 0.4, -5.4, 2.1],
      ['sit', 14, { groom: [3, 8] }],
      ['hop', -2.2, -6.0, 2.2], ['wait', 0.5], ['hop', -4.6, -4.8, 2.2],
      ['sit', 16, {}],
      ['hop', -7.2, -3.0, 2.3], ['wait', 0.5], ['hop', -9.8, -1.0, 2.3],
      ['sit', 16, { groom: [4, 10] }],
      ['hop', -8.0, -3.4, 2.2], ['wait', 0.5], ['hop', -6.0, -5.8, 2.2],
      ['sit', 10, {}], ['hop', -3.6, -7.2, 2.2],
      ['sit', 60, { up: [3, 8] }],
    ] },
  { // far along the rim on the right: small
    size: 0.72, from: [15.0, -17.1], yaw: -95, moves: [
      ['sit', 30, {}],
      ['hop', 13.0, -17.3, 1.8], ['wait', 0.5], ['hop', 11.4, -17.4, 1.8],
      ['sit', 26, { up: [5, 12] }],
      ['turn', 0.8, 95],
      ['hop', 13.4, -17.2, 1.8], ['wait', 0.4], ['hop', 15.6, -17.0, 1.9], ['wait', 0.5], ['hop', 17.8, -16.6, 1.9],
      ['sit', 20, { groom: [3, 8] }],
      ['hop', 19.8, -16.8, 1.9], ['wait', 0.5], ['hop', 21.8, -17.0, 1.9],
      ['sit', 16, {}], ['turn', 0.8, -95],
      ['hop', 19.6, -16.9, 1.9], ['wait', 0.5], ['hop', 17.4, -16.9, 1.9],
      ['sit', 22, {}],
      ['hop', 15.4, -17.1, 1.9], ['wait', 0.5], ['hop', 13.4, -17.3, 1.9],
      ['sit', 60, { groom: [3, 8] }],
    ] },
];

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const window01 = (t, a, b, ramp = 0.9) => smooth((t - a) / ramp) * smooth((b - t) / ramp);
function yawTo(dx, dz) { return Math.atan2(dx, -dz) / D2R; }
function lerpAngle(a, b, u) { let d = ((b - a + 540) % 360) - 180; return a + d * u; }

// build each rabbit's segments once
const RABBIT_SEGS = RABBITS.map((r) => {
  const segs = [];
  let t = 0, x = r.from[0], z = r.from[1], yaw = r.yaw;
  for (const m of r.moves) {
    if (m[0] === 'sit' || m[0] === 'wait') {
      segs.push({ type: 'sit', t0: t, t1: t + m[1], x, z, yaw, opt: m[2] || {} });
      t += m[1];
    } else if (m[0] === 'turn') {
      segs.push({ type: 'turn', t0: t, t1: t + m[1], x, z, yaw0: yaw, yaw1: m[2] });
      yaw = m[2]; t += m[1];
    } else if (m[0] === 'hop') {
      const [, x1, z1, T] = m;
      const yaw1 = yawTo(x1 - x, z1 - z);
      segs.push({ type: 'hop', t0: t, t1: t + T, x0: x, z0: z, x1, z1, yaw0: yaw, yaw1, y0: surfH(x, z), y1: surfH(x1, z1) });
      x = x1; z = z1; yaw = yaw1; t += T;
    } else if (m[0] === 'gone') {
      segs.push({ type: 'gone', t0: t, t1: 1e9 });
    }
  }
  segs.push({ type: 'sit', t0: t, t1: 1e9, x, z, yaw, opt: {} });
  return { size: r.size, segs, seed: segs.length * 7.31 };
});

// a small memo for the skyline test: most of the time the rabbits sit still
const horMemo = new Map();
function horizonAt(x, y, z) {
  const k = `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)}`;
  let v = horMemo.get(k);
  if (v === undefined) {
    v = horizonEl(x, y, z);
    horMemo.set(k, v);
    if (horMemo.size > 6000) horMemo.delete(horMemo.keys().next().value);
  }
  return v;
}

// uniforms for the rabbits at time ts (seconds into the scene), for an eye `eye` metres
// up, with the Earth's centre `earthEl` degrees over the horizon
export function surfaceState(ts, eye, earthEl) {
  const base = surfH(0, 0) + eye;
  const P = new Float32Array(4 * RAB_MAX), Q = new Float32Array(4 * RAB_MAX), R = new Float32Array(4 * RAB_MAX);
  const e = earthEl * D2R, er = SURF_EARTH.radius * D2R;
  let n = 0;
  RABBIT_SEGS.forEach((rb, ri) => {
    if (n >= RAB_MAX) return;
    const seg = rb.segs.find((s) => ts >= s.t0 && ts < s.t1) || rb.segs[rb.segs.length - 1];
    if (seg.type === 'gone' || seg.type === 'away') return;
    let x, z, y, yaw, pitch = 0, stretch = 0, up = 0, ears = 0.12, bow = 0;
    // ear twitches, now and then
    const tw = Math.max(0, Math.sin(ts * 2.1 + ri * 1.7)) ** 18;
    if (seg.type === 'hop') {
      const T = seg.t1 - seg.t0, u = (ts - seg.t0) / T;
      x = seg.x0 + (seg.x1 - seg.x0) * u;
      z = seg.z0 + (seg.z1 - seg.z0) * u;
      const h = (G * T * T) / 8;
      y = seg.y0 + (seg.y1 - seg.y0) * u + 4 * h * u * (1 - u);
      yaw = lerpAngle(seg.yaw0, seg.yaw1, smooth(u / 0.25));
      stretch = Math.pow(Math.sin(Math.PI * u), 0.7);
      pitch = 0.35 * (1 - 2 * u);
      ears = 0.55 * Math.exp(-6 * u) + 0.25 * smooth((u - 0.85) / 0.15) + 0.05;
    } else {
      x = seg.x; z = seg.z; y = surfH(x, z);
      if (seg.type === 'turn') {
        const u = (ts - seg.t0) / (seg.t1 - seg.t0);
        yaw = lerpAngle(seg.yaw0, seg.yaw1, smooth(u));
        y += 0.06 * Math.abs(Math.sin(Math.PI * u * 3)); // small hops on the spot
      } else {
        yaw = seg.yaw;
        const lt = ts - seg.t0, o = seg.opt;
        if (o.up) up = window01(lt, o.up[0], o.up[1], 1.0);
        if (o.groom) bow = window01(lt, o.groom[0], o.groom[1], 0.6) * (0.55 + 0.18 * Math.sin(lt * 7.0));
        ears = 0.1 + 0.25 * tw - 0.08 * up;
      }
    }
    const sc = rb.size;
    const lit = discAbove(e, horizonAt(x, y + 0.18 * sc, z), er);
    P.set([x, y - base, z, yaw * D2R], n * 4);
    Q.set([stretch, up, ears, bow], n * 4);
    R.set([pitch, sc, lit, 0], n * 4);
    n++;
  });
  // light thrown back by the ground grows as more of it is lit
  const amb = 0.004 + 0.008 * smooth((earthEl + 2) / 12);
  return { n, P, Q, R, base, amb };
}
