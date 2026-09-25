// Moon — the sea late at night. The moon hangs low over the water in front, and its light
// breaks up on the waves into a glittering path (윤슬). The viewer stands at the end of a
// breakwater, a few metres up; a few islands lie low on the horizon to either side.
// The water is a sphere of the Earth's radius. Its slopes are a sum of deep-water wave
// trains; the trains too fine for a pixel are left out of the normal and counted as
// roughness instead (Bruneton, Neyret & Holzschuch 2010), so the sparkles close by and the
// smooth path toward the horizon come from the same facets.

// wave trains, fixed: random lengths from 8 cm to 14 m and directions round the wind, which
// blows from the moon toward the viewer (+z); short waves spread wider and are steeper.
// Slope amplitude A·k, deep water ω = √(gk) (a little slowed).
const NW = 36;
function hash(i, s) {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(s + 7, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return h / 4294967296;
}
const WAVES = [];
for (let i = 0; i < NW; i++) {
  const lambda = 0.08 * Math.pow(14 / 0.08, (i + hash(i, 4)) / NW);
  const k = (2 * Math.PI) / lambda;
  const short = Math.min(1, Math.max(0, (4 - lambda) / 3.5));
  const a = (0.6 + 0.6 * short) * (hash(i, 1) + hash(i, 5) - 1);
  const steep = (0.022 + 0.034 * short) * (0.7 + 0.6 * hash(i, 2));
  WAVES.push([Math.sin(a), Math.cos(a), k, steep, 0.85 * Math.sqrt(9.81 * k), 2 * Math.PI * hash(i, 3)]);
}
// islands: azimuth and half-width (deg; 0 = front, + = right), distance and height (m)
const ISLES = [[-67, 8, 7500, 330], [-99, 15, 14000, 560], [-127, 6, 9000, 240], [53, 3, 12000, 140], [80, 11, 10000, 460], [113, 7, 6000, 210]];

const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(+v.toFixed(6)));
const D2R = Math.PI / 180;

// Paper boats with a small light in each (종이배 등): folded from white paper, about 45 cm
// long. Some were let go before the scene begins, the rest from the breakwater over its
// first minutes; each drifts out toward the moon, rocked by the same waves as the water
// (the ones longer than the boat), its light flickering a little. Worked out from the clock
// alone, like everything else, so every window shows the same boats. Written into two rows
// of buf (rowW floats each): position (eye frame, m) and light; heading, water slope, size.
// They go to rows BOAT_ROW and BOAT_ROW + 1 of the shared data texture (main.js).
export const BOAT_MAX = 36;
export const BOAT_ROW = 6;
export function boatsAt(t, ts, buf, rowW, eye) {
  let n = 0;
  for (let i = 0; i < BOAT_MAX; i++) {
    const r = (k) => hash(i + 100, k);
    const tr = -500 + 860 * r(1);                     // when it was let go (s, scene clock)
    const age = ts - tr;
    if (age < 0) continue;
    const az0 = (-36 + 72 * r(2)) * D2R;
    const v = 0.035 + 0.045 * r(4);                   // drifting out (m/s)
    const dist = 9 + 4 * r(3) + v * age;
    if (dist > 320) continue;
    // the bearing drifts slowly toward the moon's path (straight ahead) and wanders
    const az = az0 * Math.exp(-age / 700) + 0.05 * Math.sin(age * 0.004 + 6.28 * r(5));
    const x = Math.sin(az) * dist, z = -Math.cos(az) * dist;
    // the waves at the boat (only those longer than it rock it)
    let h = 0, gx = 0, gz = 0;
    for (const w of WAVES) {
      const k = w[2];
      if ((2 * Math.PI) / k < 0.9) continue;
      const ph = k * (w[0] * x + w[1] * z) - w[4] * t + w[5];
      h += (w[3] / k) * Math.sin(ph);
      gx += w[0] * w[3] * Math.cos(ph);
      gz += w[1] * w[3] * Math.cos(ph);
    }
    // the light: lit as it is let go, flickering a little like a candle
    const lit = Math.min(1, age / 3) * (0.8 + 0.4 * r(6)) * (1 + 0.05 * Math.sin(11.3 * t + 9 * r(7)) + 0.035 * Math.sin(23.1 * t + 5 * r(8)));
    const yaw = 6.283 * r(9) + 0.06 * Math.sin(age * 0.05 + r(10) * 6);
    buf.set([x, h - eye, z, lit], n * 4);
    buf.set([yaw, gx, gz, 1.5 + 0.4 * r(11)], rowW + n * 4);
    n++;
  }
  return n;
}

export const SEA_GLSL = `
uniform float uSea;          // 1 = by the sea
uniform float uSeaH;         // eye height over the water (m)
uniform float uSeaGain;      // brightness of the moon's path (1 = a mirror image of the disc as shown)
uniform int   uBoatN;        // paper boats on the water (their data: rows ${BOAT_ROW}-${BOAT_ROW + 1} of tData)
uniform float uBoatGain;     // how bright their lights are
const float SEA_RE = 6371000.0;
const int SEA_NW = ${NW};
const vec4 SEA_W[SEA_NW] = vec4[SEA_NW](${WAVES.map((w) => `vec4(${f(w[0])}, ${f(w[1])}, ${f(w[2])}, ${f(w[3])})`).join(', ')});
const vec2 SEA_P[SEA_NW] = vec2[SEA_NW](${WAVES.map((w) => `vec2(${f(w[4])}, ${f(w[5])})`).join(', ')});
const int SEA_NI = ${ISLES.length};
const vec4 SEA_I[SEA_NI] = vec4[SEA_NI](${ISLES.map((s) => `vec4(${f(s[0] * D2R)}, ${f(s[1] * D2R)}, ${f(s[2])}, ${f(s[3])})`).join(', ')});

// the islands' skyline at azimuth az (rad): its elevation (rad) and how far away it is
float isleTop(float az, out float dist) {
  float e = -1.0;
  dist = 1e4;
  for (int i = 0; i < SEA_NI; i++) {
    vec4 I = SEA_I[i];
    float x = (az - I.x) / I.y;
    if (abs(x) >= 1.0) continue;
    float n = 0.5 + 0.25 * sin(5.0 * x + float(i) * 2.3) + 0.15 * sin(11.0 * x + float(i) * 4.1) + 0.1 * sin(23.0 * x + float(i));
    float h = I.w * pow(1.0 - x * x, 1.3) * (0.5 + 0.6 * n);
    float el = (h - uSeaH) / I.z - I.z / (2.0 * SEA_RE);
    if (el > e) { e = el; dist = I.z; }
  }
  return e;
}
// an island seen along d (dist away): dark rock and trees, faintly moonlit, in the haze
vec3 isleColor(vec3 d, float dist, vec3 moonLight) {
  vec3 Ta = exp(-extinctionAt(0.0) * dist);
  vec3 skyH = texture(tSkyView, skyUV(normalize(vec3(d.x, 0.004, d.z)))).rgb;
  return moonLight * 0.004 * Ta + skyH * (1.0 - Ta);
}
float smithB(float c, float m2) {
  float tn = sqrt(max(1.0 - c * c, 0.0)) / max(c, 1e-4);
  float a = 1.0 / max(sqrt(m2) * tn, 1e-4);
  return a < 1.6 ? (3.535 * a + 2.181 * a * a) / (1.0 + 2.276 * a + 2.577 * a * a) : 1.0;
}
// ---------------- paper boats
// a boat's frame: heading, tilted with the water under it
mat3 boatFrame(vec4 O) {
  vec3 n = normalize(vec3(-O.y, 1.0, -O.z));
  vec3 f0 = vec3(cos(O.x), 0.0, sin(O.x));
  vec3 fw = normalize(f0 - n * dot(f0, n));
  return mat3(fw, n, cross(fw, n));
}
// ray against a triangle: distance (or -1) and the barycentric coordinates
float triHit(vec3 ro, vec3 rd, vec3 a, vec3 b, vec3 c, out vec2 bc) {
  vec3 e1 = b - a, e2 = c - a, p = cross(rd, e2);
  float det = dot(e1, p);
  bc = vec2(-1.0);
  if (abs(det) < 1e-9) return -1.0;
  float inv = 1.0 / det;
  vec3 s = ro - a;
  float u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) return -1.0;
  vec3 q = cross(s, e1);
  float v = dot(rd, q) * inv;
  if (v < 0.0 || u + v > 1.0) return -1.0;
  bc = vec2(u, v);
  return dot(e2, q) * inv;
}
// one ray against one boat (boat frame, metres): the nearest paper and its shade
// (x = along, y = up from the waterline, z = across)
vec4 boatRay(vec3 ro, vec3 rd, float I, vec3 moonB, vec3 moonLight, vec3 amb) {
  const float L = 0.44, W = 0.17, HH = 0.085, DR = 0.02, LK = 0.27, WK = 0.03, SL = 0.23, SH = 0.13;
  vec3 v[9];
  v[0] = vec3(-L * 0.5, HH,  W * 0.5); v[1] = vec3(L * 0.5, HH,  W * 0.5);
  v[2] = vec3(LK * 0.5, -DR, WK * 0.5); v[3] = vec3(-LK * 0.5, -DR, WK * 0.5);
  v[4] = vec3(-L * 0.5, HH, -W * 0.5); v[5] = vec3(L * 0.5, HH, -W * 0.5);
  v[6] = vec3(LK * 0.5, -DR, -WK * 0.5); v[7] = vec3(-LK * 0.5, -DR, -WK * 0.5);
  v[8] = vec3(0.0, HH + SH, 0.0);
  float tb = 1e9; int hit = -1; vec2 hb = vec2(0.0); vec3 hn = vec3(0.0);
  vec2 bc; float t;
  // sides (two triangles each), the pointed ends, and the sail standing in the middle
  t = triHit(ro, rd, v[0], v[1], v[2], bc); if (t > 0.0 && t < tb) { tb = t; hit = 0; hb = bc; hn = normalize(cross(v[1] - v[0], v[2] - v[0])); }
  t = triHit(ro, rd, v[0], v[2], v[3], bc); if (t > 0.0 && t < tb) { tb = t; hit = 0; hb = bc; hn = normalize(cross(v[2] - v[0], v[3] - v[0])); }
  t = triHit(ro, rd, v[4], v[6], v[5], bc); if (t > 0.0 && t < tb) { tb = t; hit = 1; hb = bc; hn = normalize(cross(v[6] - v[4], v[5] - v[4])); }
  t = triHit(ro, rd, v[4], v[7], v[6], bc); if (t > 0.0 && t < tb) { tb = t; hit = 1; hb = bc; hn = normalize(cross(v[7] - v[4], v[6] - v[4])); }
  t = triHit(ro, rd, v[1], v[5], v[2], bc); if (t > 0.0 && t < tb) { tb = t; hit = 2; hb = bc; hn = normalize(cross(v[5] - v[1], v[2] - v[1])); }
  t = triHit(ro, rd, v[4], v[0], v[7], bc); if (t > 0.0 && t < tb) { tb = t; hit = 2; hb = bc; hn = normalize(cross(v[0] - v[4], v[7] - v[4])); }
  vec3 s0 = vec3(-SL * 0.5, HH, 0.0), s1 = vec3(SL * 0.5, HH, 0.0);
  t = triHit(ro, rd, s0, s1, v[8], bc); if (t > 0.0 && t < tb) { tb = t; hit = 3; hb = bc; hn = vec3(0.0, 0.0, 1.0); }
  if (hit < 0) return vec4(0.0);
  vec3 p = ro + rd * tb;
  // which side faces the viewer: the outside of a side panel, or its inside seen over the rim
  if (dot(hn, rd) > 0.0) hn = -hn;
  bool inside = hit < 3 && dot(hn, vec3(0.0, 0.0, sign(p.z))) < 0.0;
  // the light: a small flame low in the hull; paper passes about half of it
  vec3 lp = vec3(0.0, 0.03, 0.0);
  float dl = length(p - lp);
  float E = I / (dl * dl + 0.004);
  float layers = hit == 3 ? 2.0 : 1.0;
  float fib = 0.9 + 0.2 * vnoise2(p.xy * 180.0 + p.z * 60.0);
  float crease = hit == 3 ? smoothstep(0.004, 0.0, abs(p.x)) : smoothstep(0.006, 0.0, abs(p.y - HH)) * 0.6;
  vec3 warm = vec3(1.0, 0.62, 0.3);
  vec3 glow = warm * E * (inside ? 0.3 : 0.16 / layers) * fib * (1.0 - 0.35 * crease);
  // outside, white paper in the moonlight (faint next to the flame)
  vec3 paper = vec3(0.9, 0.88, 0.84) * fib * (moonLight * max(dot(hn, moonB), 0.0) * 0.12 + amb * 0.6);
  return vec4(glow + paper, 1.0);
}
vec4 boatsShade(vec3 d, float angPix, vec3 moonLight) {
  if (uBoatN <= 0) return vec4(0.0);
  vec3 amb = textureLod(tSkyView, vec2(0.5, 0.9), 6.0).rgb;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${BOAT_MAX}; i++) {
    if (i >= uBoatN) break;
    vec4 P = texelFetch(tData, ivec2(i, ${BOAT_ROW}), 0);
    vec4 O = texelFetch(tData, ivec2(i, ${BOAT_ROW + 1}), 0);
    float dist = length(P.xyz);
    if (dot(d, P.xyz / dist) < cos(0.34 * O.w / dist + angPix * 2.0)) continue;
    mat3 F = boatFrame(O);
    mat3 Ft = transpose(F);
    vec3 ro = Ft * (-P.xyz) / O.w;
    vec3 moonB = Ft * uMoonDirW;
    // 2 x 2 samples in the pixel: the boats are small and they move
    vec4 s = vec4(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 o = (vec2(k & 1, k >> 1) - 0.5) * 0.5 * angPix;
      vec3 e1 = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
      vec3 e2 = cross(e1, d);
      vec3 rd = Ft * normalize(d + e1 * o.x + e2 * o.y);
      s += boatRay(ro, rd, P.w * uBoatGain, moonB, moonLight, amb);
    }
    s *= 0.25;
    // the air between (as for the water)
    vec3 Ta = exp(-extinctionAt(0.0) * dist);
    acc.rgb += (1.0 - acc.a) * s.rgb * Ta;
    acc.a += (1.0 - acc.a) * s.a;
  }
  return acc;
}
// the boats' lights in the water: each a small warm lamp just above it
vec3 boatGlints(vec3 pw, vec3 N, vec3 V, float nv, float m2) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${BOAT_MAX}; i++) {
    if (i >= uBoatN) break;
    vec4 P = texelFetch(tData, ivec2(i, ${BOAT_ROW}), 0);
    if (P.w <= 0.0) continue;
    vec3 lp = P.xyz + vec3(0.0, 0.08, 0.0);
    vec3 l = lp - pw;
    float dl2 = dot(l, l);
    l *= inversesqrt(dl2);
    float nl = dot(N, l);
    if (nl <= 0.0) continue;
    vec3 H = normalize(V + l);
    float mb = m2 + 0.02 / dl2;               // the lit hull is about 20 cm across
    float c2 = max(dot(N, H), 1e-3);
    c2 *= c2;
    float D = exp(-(1.0 - c2) / (c2 * mb)) / (3.14159265 * mb * c2 * c2);
    float Fh = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
    acc += P.w * uBoatGain * 0.5 / dl2 * Fh * D * smithB(nv, mb) * smithB(nl, mb) / (4.0 * nv);
  }
  return acc * vec3(1.0, 0.66, 0.34);
}

// the water seen along d: colour and coverage (0 above the sea horizon). moonE is the
// moon's light as the disc is shown, moonAng its angular radius.
vec4 seaShade(vec3 d, float angPix, vec3 moonDir, vec3 moonE, float moonAng, vec3 moonLight) {
  float dy = -d.y, dyH = sqrt(2.0 * uSeaH / SEA_RE);
  float cov = clamp((dy - dyH) / angPix + 0.5, 0.0, 1.0);
  if (cov <= 0.0) return vec4(0.0);
  dy = max(dy, dyH + 0.5 * angPix);
  float t = 2.0 * uSeaH / (dy + sqrt(max(dy * dy - dyH * dyH, 0.0)));
  vec2 x = d.xz * t;
  vec2 fd = normalize(d.xz + vec2(1e-6));
  float fpB = t * angPix, fpA = fpB / max(dy, 0.015);
  // the waves; those finer than the pixel become roughness
  vec2 g = vec2(0.0);
  float m2 = 0.0;
  for (int i = 0; i < SEA_NW; i++) {
    vec4 w = SEA_W[i];
    float r = w.z * mix(fpB, fpA, abs(dot(w.xy, fd)));
    float keep = 1.0 - smoothstep(1.0, 2.5, r);
    float ph = w.z * dot(w.xy, x) - SEA_P[i].x * uTime + SEA_P[i].y;
    g += w.xy * (w.w * keep * cos(ph));
    m2 += 0.5 * w.w * w.w * (1.0 - keep * keep);
  }
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = -d;
  // the sky in the water, blurred by the waves too fine to see, and the islands in it
  vec3 R = reflect(d, N);
  R.y = max(R.y, 0.002);
  R = normalize(R);
  float Fv = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  float spread = 2.0 * sqrt(m2 + 0.0002);
  vec3 sky = textureLod(tSkyView, skyUV(R), log2(1.0 + 90.0 * spread)).rgb;
  // (the share of the reflected cone between the sea horizon and an island's top)
  float di, it = isleTop(atan(R.x, -R.z), di);
  float w = spread + angPix, eR = asin(R.y);
  float share = clamp((it - eR) / w + 0.5, 0.0, 1.0) - clamp(-eR / w + 0.5, 0.0, 1.0);
  sky = mix(sky, isleColor(R, di, moonLight), max(share, 0.0));
  // (the moon is a disc: the facets that catch it spread by its size)
  m2 += 0.0005 + 0.25 * moonAng * moonAng;
  // the moon in the water: facets tilted to catch it (Beckmann); toward the horizon they
  // hide each other, which narrows and dims the far end of the path
  vec3 H = normalize(V + moonDir);
  float nh = max(dot(N, H), 1e-3), nv = max(dot(N, V), 1e-3), nl = dot(N, moonDir);
  float c2 = nh * nh;
  float D = exp(-(1.0 - c2) / (c2 * m2)) / (3.14159265 * m2 * c2 * c2);
  float Fh = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  vec3 glint = nl > 0.0 ? moonE * (uSeaGain * Fh * D * smithB(nv, m2) * smithB(nl, m2) / (4.0 * nv)) : vec3(0.0);
  // the paper boats' lights, broken up on the waves under each
  if (uBoatN > 0) glint += boatGlints(vec3(x.x, -uSeaH, x.y), N, V, nv, m2 - 0.25 * moonAng * moonAng);
  vec3 col = sky * Fv + glint;
  // the air between: extinction, and the haze it lights
  vec3 Ta = exp(-extinctionAt(0.0) * t);
  vec3 skyH = texture(tSkyView, skyUV(normalize(vec3(d.x, 0.002, d.z)))).rgb;
  return vec4(col * Ta + skyH * (1.0 - Ta), cov);
}
`;
