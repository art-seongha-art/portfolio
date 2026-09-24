// Moon — volumetric clouds for the Earth scenes.
// Tileable Perlin-Worley / Worley noise is generated once into 3D textures
// (after Schneider, "The Real-Time Volumetric Cloudscapes of Horizon Zero Dawn").
// Two cloud bodies share one ray march:
//   · valley fog (운해) filling the valleys up to ~1.2 km, with billowed tops
//   · a stratocumulus / altocumulus deck at ~2.6–4.0 km with dark bases and lit tops
// The pass runs at half resolution and accumulates over frames with a jittered start.

import { ATMO_COMMON } from './atmo.js';
import { TERRAIN_COMMON } from './terrain.js';

const NOISE_COMMON = `
uint hash3u(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
vec3 hash33(ivec3 c) {
  uvec3 u = uvec3(c);
  return vec3(hash3u(u), hash3u(u + 17u), hash3u(u + 131u)) * (1.0 / 4294967295.0);
}
ivec3 wrap3(ivec3 c, int p) { return ((c % p) + p) % p; }
// tileable Worley: 1 - distance to nearest feature point, period p cells
float worley(vec3 x, int p) {
  vec3 q = x * float(p);
  ivec3 b = ivec3(floor(q));
  vec3 f = fract(q);
  float md = 1e9;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec3 o = ivec3(i, j, k);
    vec3 fp = vec3(o) + hash33(wrap3(b + o, p));
    vec3 dv = fp - f;
    md = min(md, dot(dv, dv));
  }
  return 1.0 - clamp(sqrt(md), 0.0, 1.0);
}
float worleyFbm(vec3 x, int p) {
  return worley(x, p) * 0.625 + worley(x, p * 2) * 0.25 + worley(x, p * 4) * 0.125;
}
// tileable gradient noise, period p
float gnoise(vec3 x, int p) {
  vec3 q = x * float(p);
  ivec3 b = ivec3(floor(q));
  vec3 f = fract(q);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n[8];
  for (int c = 0; c < 8; c++) {
    ivec3 o = ivec3(c & 1, (c >> 1) & 1, (c >> 2) & 1);
    vec3 g = hash33(wrap3(b + o, p)) * 2.0 - 1.0;
    n[c] = dot(normalize(g + 1e-5), f - vec3(o));
  }
  return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
             mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z) * 0.9 + 0.5;
}
float gfbm(vec3 x, int p) {
  float s = 0.0, a = 0.5;
  for (int o = 0; o < 5; o++) { s += a * gnoise(x, p); p *= 2; a *= 0.5; }
  return s / 0.96875;
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

// 3D noise: one layer (z slice) per draw
export const NOISE3D_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform float uZ;
uniform float uSize;
uniform int uKind;   // 0 = shape (Perlin-Worley + Worley fbm), 1 = detail (Worley fbm)
${NOISE_COMMON}
void main() {
  vec3 x = vec3(gl_FragCoord.xy / uSize, uZ);
  if (uKind == 0) {
    float pf = gfbm(x, 4);
    float wf = worleyFbm(x, 4);
    float pw = clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    o = vec4(pw, worleyFbm(x, 4), worleyFbm(x, 8), worleyFbm(x, 16));
  } else {
    o = vec4(worleyFbm(x, 2), worleyFbm(x, 4), worleyFbm(x, 8), 1.0);
  }
}`;

// 2D weather map: R coverage, G cloud type, B fog-top variation
export const WEATHER_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform float uSize;
${NOISE_COMMON}
void main() {
  vec3 x = vec3(gl_FragCoord.xy / uSize, 0.37);
  float cov = gfbm(x, 3);
  cov = clamp(remap(cov, 0.35, 0.75, 0.0, 1.0), 0.0, 1.0);
  float w = worleyFbm(x, 5);
  cov = clamp(cov * 0.75 + w * 0.45 - 0.15, 0.0, 1.0);
  float type = gfbm(x + 0.31, 2);
  float fog = gfbm(x + 0.63, 4);
  o = vec4(cov, type, fog, 1.0);
}`;

// Volumetric pass (half resolution, temporally accumulated).
// Cloud deck shared by the volumetric pass and the cloud-shadow map: bases, thickness
// and cover vary across the sky; tops billow, bases are flat and sharp.
const CLOUD_COMMON = `
uniform sampler3D tShape;
uniform sampler3D tDetail;
uniform sampler2D tWeather;
uniform float uCloudBase, uCloudTop, uCloudCov, uCloudDens;
uniform vec2  uWind;          // metres of drift (x, z)
uniform float uTime;
uniform float uColumn;        // the cloud the viewer rises through (0..1)
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
float cloudDensity(vec3 p, float alt, float lod, bool cheap, float near, float colW, out float hf) {
  vec2 xz = p.xz + uWind;
  // during the ascent a tall cloud stands round the viewer's column (x = z = 0); it only
  // has to hide the climb, so it shades itself lightly and casts no shadow (colW)
  float colD = 0.0;
  if (uColumn > 0.0 && colW > 0.0) {
    colD = colW * uColumn * smoothstep(2800.0, 900.0, length(p.xz)) * smoothstep(1700.0, 2000.0, alt) * smoothstep(4600.0, 4150.0, alt);
  }
  vec4 wz = textureLod(tWeather, xz / 42000.0, 0.0);
  vec4 wz2 = textureLod(tWeather, xz / 11000.0 + vec2(0.31, 0.77), 0.0);
  float base = uCloudBase + (wz2.b - 0.5) * 500.0;
  float thick = mix(320.0, uCloudTop - uCloudBase + 400.0, wz.g * wz.g);
  hf = (alt - base) / thick;
  if (colD > 0.0) hf = clamp((alt - 1700.0) / 2900.0, 0.01, 0.99);
  else if (hf <= 0.0 || hf >= 1.0) return 0.0;
  float cov = clamp(mix(wz.r, wz2.r, 0.4) * 1.3 + uCloudCov - 0.62, 0.0, 1.0);
  cov = max(cov, colD);
  if (cov <= 0.0) return 0.0;
  vec4 s = textureLod(tShape, vec3(xz.x, alt * 1.6, xz.y) / 9000.0, lod);
  float b = remap(s.r, (s.g * 0.625 + s.b * 0.25 + s.a * 0.125) - 1.0, 1.0, 0.0, 1.0);
  // the noise also lifts and lowers the tops, so even an overcast deck is lumpy
  float prof = smoothstep(0.0, 0.07, hf) * smoothstep(1.0, 0.55, hf + (1.0 - clamp(b, 0.0, 1.0)) * 0.45);
  prof = max(prof, colD);
  float c = clamp(remap(b * prof, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
  c = max(c, colD * (0.55 + 0.45 * b));
  if (c <= 0.0) return 0.0;
  c *= mix(0.5, 1.25, hf);
  if (cheap) return c * uCloudDens;
  vec4 dn = textureLod(tDetail, vec3(xz.x, alt, xz.y) / 1300.0 + vec3(uTime * 0.0012, 0.0, 0.0), lod);
  float dfbm = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
  if (near > 0.0) {
    // close to the camera (flying through): a finer octave of wisps
    float dn2 = textureLod(tDetail, vec3(xz.x, alt * 1.3, xz.y) / 240.0 + vec3(0.0, uTime * 0.004, 0.0), 0.0).g;
    dfbm = mix(dfbm, dfbm * 0.6 + dn2 * 0.4, near);
  }
  // wispy underneath, billowed on top
  float dmod = mix(dfbm, 1.0 - dfbm, clamp(hf * 5.0, 0.0, 1.0));
  c = clamp(remap(c, dmod * 0.38, 1.0, 0.0, 1.0), 0.0, 1.0);
  return c * uCloudDens;
}
// transmittance of the cloud deck along a light ray leaving p (flat-earth, fine for ~50 km)
float cloudShadowT(vec3 p, float alt, vec3 L) {
  float ly = max(L.y, 0.035);
  float h0 = uCloudBase - 260.0, h1 = uCloudTop + 660.0;
  float s0 = max((h0 - alt) / ly, 0.0), s1 = (h1 - alt) / ly;
  if (s1 <= 0.0) return 1.0;
  const int N = 10;
  float ds = (s1 - s0) / float(N);
  float tau = 0.0;
  for (int i = 0; i < N; i++) {
    float s = s0 + (float(i) + 0.5) * ds;
    vec3 q = p + L * s;
    float hq;
    tau += cloudDensity(q, alt + s * L.y, 1.5, true, 0.0, 0.0, hq) * ds;
  }
  // direct light, plus what diffuses through a thick cloud
  float Td = exp(-tau * 0.7);
  return Td + (1.0 - Td) * 0.3 / (1.0 + 0.11 * tau);
}
`;

// Cloud shadow map for the terrain: transmittance toward the key light at SH_REF metres,
// over a square SH_HALF metres around the viewer (x = west, y = north).
export const SH_N = 256, SH_HALF = 45000, SH_REF = 2000;
export const CLOUDSHADOW_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
out vec4 o;
uniform vec3 uKeyDir;
${CLOUD_COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / ${SH_N}.0;
  vec2 xz = (uv - 0.5) * ${2 * SH_HALF}.0;
  o = vec4(cloudShadowT(vec3(xz.x, 0.0, xz.y), ${SH_REF}.0, uKeyDir), 0.0, 0.0, 1.0);
}`;

// Volumetric pass (half resolution, temporally accumulated).
export function cloudsFS() {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
out vec4 o;
uniform vec4  uView;          // this wall's rect in the cloud buffer
uniform vec3  uPA, uDU, uDV;
uniform vec4  uCacheRect;     // this wall's rect in the terrain cache (px)
uniform vec2  uCacheSize;
uniform sampler2D tCacheA;    // xyz normal, w distance (m); w < 0 = sky
uniform sampler2D tCacheB;    // x coverage
uniform sampler2D tHist;
uniform vec2  uHistSize;
uniform float uTAA;
uniform float uFrame;
uniform float uCamAlt;
uniform sampler2D tTrans;
uniform sampler2D tSkyView;
uniform vec3  uSunDir, uMoonDir, uSunE, uMoonE;
uniform vec3  uKeyDir;        // light used for self-shadowing
uniform float uFogTop, uFogVar, uFogDens;
uniform float uTerrain;       // 1 when the terrain cache is valid for this camera
uniform float uAurMax;        // display ceiling of the moon's diffraction glow
${ATMO_COMMON}
${TERRAIN_COMMON}
${CLOUD_COMMON}

float hgP(float c, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5); }

// 2 J1(x) / x  (Abramowitz & Stegun 9.4.4 and 9.4.6)
float airy(float x) {
  x = abs(x);
  if (x < 3.0) {
    float y = x * x / 9.0;
    return 2.0 * (0.5 + y * (-0.56249985 + y * (0.21093573 + y * (-0.03954289 + y * (0.00443319 + y * (-0.00031761 + y * 0.00001109))))));
  }
  float y = 3.0 / x;
  float f1 = 0.79788456 + y * (0.00000156 + y * (0.01659667 + y * (0.00017105 + y * (-0.00249511 + y * (0.00113653 - y * 0.00020033)))));
  float t1 = x - 2.35619449 + y * (0.12499612 + y * (0.00005650 + y * (-0.00637879 + y * (0.00074348 + y * (0.00079824 - y * 0.00029166)))));
  return 2.0 * f1 * cos(t1) / (x * sqrt(x));
}
// Fraunhofer diffraction by water droplets of diameter dMu (micrometres), normalised over
// the sphere. About 40 % of the light a droplet scatters goes into this narrow cone: the
// bright aureole round the moon and, because the sizes vary only a little, the faint
// coloured ring of a corona (blue inside, red outside).
vec3 diffraction(float cosT, float dMu) {
  float th = acos(clamp(cosT, -1.0, 1.0));
  if (th > 0.5) return vec3(0.0);
  const vec3 LAM = vec3(0.612, 0.549, 0.464);
  vec3 s = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float dd = dMu * (0.82 + 0.18 * float(i));
    float w = i == 1 ? 0.5 : 0.25;
    vec3 ka = 3.14159265 * dd / LAM;
    vec3 a = vec3(airy(ka.r * th), airy(ka.g * th), airy(ka.b * th));
    s += w * ka * ka * a * a;
  }
  return s * 0.0795775;
}
// the rest of the droplet phase function: refraction lobe plus a little back scatter
float broadP(float nu) { return 0.9 * hgP(nu, 0.86) + 0.1 * hgP(nu, -0.3); }
// light reaching a point inside fog or cloud from a source of irradiance E (already
// shadowed): single scattering and one broader order through the phase function, plus
// the diffuse glow that builds up inside a thick medium (why clouds are white inside
// and fog glows all round you); tauV = optical depth down from the lit top
vec3 inscatter(vec3 E, float tau, float tauV, float muL, float p0, float p1, float build) {
  float diff = max(muL, 0.05) * 0.3183 * 0.85 * build / (1.0 + 0.07 * tauV);
  return E * (0.6 * p0 * exp(-tau) + 0.45 * p1 * exp(-tau * 0.25) + diff);
}

vec3 CENTER;
float altOf(vec3 p) { return length(p - CENTER) - Rg; }

// ---------------- valley fog (운해): a height field of billows over the valleys
float fogTopAt(vec2 xz) {
  vec2 q = xz + uWind * 0.35;
  float w1 = textureLod(tWeather, q / 60000.0, 0.0).b;
  float w2 = textureLod(tWeather, q / 17000.0 + vec2(0.5, 0.21), 0.0).b;
  float b1 = textureLod(tShape, vec3(q.x, 900.0, q.y) / 4200.0 + vec3(0.0, uTime * 0.0004, 0.0), 0.0).r;
  float b2 = textureLod(tShape, vec3(q.x, 300.0, q.y) / 1100.0 + vec3(uTime * 0.0009, 0.0, 0.0), 0.0).g;
  return uFogTop + uFogVar * (w1 - 0.5) + 0.55 * uFogVar * (w2 - 0.5) + (b1 - 0.5) * 190.0 + (b2 - 0.5) * 70.0;
}
float fogDensity(vec3 p, float alt, float top, float lod, float near) {
  float edge = smoothstep(top + 15.0, top - 60.0, alt);
  if (edge <= 0.0) return 0.0;
  vec2 q = p.xz + uWind * 0.35;
  float n = textureLod(tShape, vec3(q.x, alt * 2.5, q.y) / 2400.0, lod).g;
  float dns = uFogDens * edge * (0.35 + 1.2 * n * n);
  if (near > 0.0) {
    // drifting wisps round the viewer when the fog climbs over the summit
    float w = textureLod(tDetail, vec3(q.x - uTime * 3.0, alt - uTime * 1.5, q.y) / 110.0, 0.0).r;
    dns *= mix(1.0, 0.15 + 1.7 * w * w, near);
  }
  return dns;
}

vec3 lightAt(vec3 p, vec3 L, vec3 E) {
  vec3 q = p - CENTER;
  float r = length(q);
  return E * transmittance(tTrans, r, dot(q / r, L));
}

float hash1(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

// per-pixel state shared by the two marches
vec3 D, RO;
float JIT, NUM, NUS, BM0, BM1, BS0, BS1, TEND;
vec3 AMBH, AMBT, BOUNCE;
bool KEYMOON;

// valley fog from its entry distance tIn; returns in-scattered light (rgb) and transmittance (a)
vec4 marchFog(float tIn, out vec3 aur, out float tHit) {
  vec3 L = vec3(0.0);
  float T = 1.0;
  aur = vec3(0.0);
  tHit = -1.0;
  float topMax = uFogTop + uFogVar * 0.8 + 180.0;
  float tMaxF = min(TEND, tIn + 60000.0);
  // find the billowed surface with growing steps, then march finely below it
  float t = tIn;
  bool found = uCamAlt <= topMax;
  for (int i = 0; i < 48 && !found; i++) {
    vec3 p = D * t;
    float alt = altOf(p);
    float top = fogTopAt(p.xz);
    if (alt < top + 20.0) { found = true; break; }
    t += max((alt - top) * 0.7 / max(-D.y, 0.012), 25.0 + t * 0.004);
    if (t > tMaxF) break;
  }
  if (!found || t >= tMaxF) return vec4(L, T);
  float t0 = max(t - 60.0 - t * 0.004, tIn);
  vec3 pS = D * max(t, t0);
  float altS = altOf(pS);
  // surface slope of the billows, for light and shade across them
  float e = 40.0 + t0 * 0.004;
  float h0 = fogTopAt(pS.xz);
  vec3 nF = normalize(vec3(h0 - fogTopAt(pS.xz + vec2(e, 0.0)), e, h0 - fogTopAt(pS.xz + vec2(0.0, e))));
  float relief = clamp(0.55 + 0.9 * dot(nF, uKeyDir), 0.25, 1.6);
  // the key light reaching the sea of cloud: shadows of the ridges and of the clouds above
  float vis = cloudShadowT(pS, altS, uKeyDir);
  if (uTerrain > 0.5) vis *= terrainShadowE(uCamEN + vec2(-pS.x, pS.z), altS + 30.0, uKeyDir, 20.0 + t * 0.002);
  float visM = KEYMOON ? vis * relief : 1.0, visS = KEYMOON ? 1.0 : vis * relief;
  vec3 aF = mix(AMBH, AMBT, 0.6);
  float step0 = 18.0 + t0 * 0.0035;
  float tt = t0 + step0 * JIT;
  for (int i = 0; i < 28; i++) {
    if (tt > tMaxF) break;
    float dt = step0 * (1.0 + float(i) * 0.12);
    vec3 p = D * tt;
    float alt = altOf(p);
    float lod = clamp(log2(tt / 5000.0), 0.0, 4.0);
    float topH = fogTopAt(p.xz);
    float sig = fogDensity(p, alt, topH, lod, exp(-tt / 450.0));
    if (sig > 1e-6) {
      if (tHit < 0.0) tHit = tt;
      float depthIn = max(topH - alt, 0.0);
      vec3 lm = lightAt(p, uMoonDir, uMoonE);
      vec3 ls = lightAt(p, uSunDir, uSunE);
      float tauM = uFogDens * 0.8 * depthIn / max(uMoonDir.y, 0.04);
      float tauS = uFogDens * 0.8 * depthIn / max(uSunDir.y, 0.04);
      float tauV = uFogDens * depthIn;
      float build = 1.0 - exp(-sig * 250.0);
      vec3 inM = inscatter(lm * visM, tauM, tauV, uMoonDir.y, BM0, BM1, build);
      vec3 inS = inscatter(ls * visS, tauS, tauV, uSunDir.y, BS0, BS1, build);
      float occ = exp(-uFogDens * 0.35 * depthIn);
      vec3 S = sig * (inM + inS + aF * (0.25 + 0.75 * occ));
      float Ts = exp(-sig * dt);
      L += T * (S - S * Ts) / sig;
      aur += T * (1.0 - Ts) * lm * visM * (0.4 * exp(-tauM));
      T *= Ts;
      if (T < 0.01) break;
    }
    tt += dt;
  }
  return vec4(L, T);
}

// cloud deck between t0 and t1
vec4 marchClouds(float t0, float t1, out vec3 aur, out float tHit) {
  vec3 L = vec3(0.0);
  float T = 1.0;
  aur = vec3(0.0);
  tHit = -1.0;
  const int NC = 34;
  float span = t1 - t0;
  // inside the deck: short steps near the eye, so the wisps flying past are resolved
  bool inside = t0 == 0.0;
  for (int i = 0; i < NC; i++) {
    float s0 = (float(i) + JIT) / float(NC);
    float tt = inside ? t0 + span * s0 * s0 : t0 + span * s0;
    float dt = inside ? span * (2.0 * s0 + 1.0 / float(NC)) / float(NC) : span / float(NC);
    vec3 p = D * tt;
    float alt = altOf(p);
    float lod = clamp(log2(tt / 9000.0), 0.0, 3.0);
    float hf;
    float sig = cloudDensity(p, alt, lod, false, exp(-tt / 700.0), 1.0, hf);
    if (sig > 1e-6) {
      if (tHit < 0.0) tHit = tt;
      // self-shadow toward the key light
      float tau = 0.0;
      float ls = 60.0;
      vec3 q = p;
      for (int k = 0; k < 5; k++) {
        q += uKeyDir * ls;
        float hq;
        tau += cloudDensity(q, altOf(q), lod + 1.0, true, 0.0, 0.3, hq) * ls;
        ls *= 1.9;
      }
      float tauM = KEYMOON ? tau : tau * 0.6, tauS = KEYMOON ? tau * 0.6 : tau;
      float powder = 1.0 - exp(-sig * 150.0);
      float pvM = mix(1.0, 0.45 + 0.55 * powder, 0.5 - 0.5 * NUM);
      float pvS = mix(1.0, 0.45 + 0.55 * powder, 0.5 - 0.5 * NUS);
      vec3 lm = lightAt(p, uMoonDir, uMoonE);
      vec3 lsn = lightAt(p, uSunDir, uSunE);
      float build = 1.0 - exp(-sig * 250.0);
      vec3 inM = inscatter(lm * pvM, tauM, tauM * max(uMoonDir.y, 0.3), uMoonDir.y, BM0, BM1, build);
      vec3 inS = inscatter(lsn * pvS, tauS, tauS * max(uSunDir.y, 0.3), uSunDir.y, BS0, BS1, build);
      float hc = clamp(hf, 0.0, 1.0);
      vec3 amb = mix(AMBH, AMBT, 0.3 + 0.7 * hc) * (0.3 + 0.7 * sqrt(hc)) * 0.9
               + BOUNCE * (0.25 / 3.14159) * 0.5 * (1.0 - hc) * (1.0 - hc);
      vec3 S = sig * (inM + inS + amb);
      float Ts = exp(-sig * dt);
      L += T * (S - S * Ts) / sig;
      aur += T * (1.0 - Ts) * lm * (0.4 * exp(-tauM));
      T *= Ts;
      if (T < 0.01) break;
    }
  }
  return vec4(L, T);
}

void main() {
  vec2 f = (gl_FragCoord.xy - uView.xy) / uView.zw;
  vec3 d = normalize(uPA + f.x * uDU + f.y * uDV);
  CENTER = vec3(0.0, -(Rg + uCamAlt), 0.0);
  D = d;

  // terrain depth from the cache (metres), sky = far
  vec2 cuv = (uCacheRect.xy + f * uCacheRect.zw) / uCacheSize;
  vec4 ca = texture(tCacheA, cuv);
  float cov = texture(tCacheB, cuv).x;
  float tTer = (uTerrain > 0.5 && ca.w > 0.0 && cov > 0.5) ? ca.w : 1e9;

  vec3 ro = -CENTER;               // camera, Earth-centred
  RO = ro;
  float tGround = sphereHit(ro, d, Rg);
  TEND = min(tTer, tGround > 0.0 ? tGround : 1e9);

  JIT = fract(hash1(gl_FragCoord.xy) + uFrame * 0.618034);
  NUS = dot(d, uSunDir); NUM = dot(d, uMoonDir);
  KEYMOON = dot(uKeyDir, uMoonDir) > 0.999;
  // sky light: zenith, and the horizon averaged round the compass
  AMBT = textureLod(tSkyView, vec2(0.5, 0.985), 5.0).rgb;
  AMBH = 0.25 * (textureLod(tSkyView, vec2(0.125, 0.63), 5.0).rgb + textureLod(tSkyView, vec2(0.375, 0.63), 5.0).rgb
               + textureLod(tSkyView, vec2(0.625, 0.63), 5.0).rgb + textureLod(tSkyView, vec2(0.875, 0.63), 5.0).rgb);
  // phase functions, per pixel: single scattering and a broader order
  BM0 = broadP(NUM); BS0 = broadP(NUS);
  BM1 = hgP(NUM, 0.45); BS1 = hgP(NUS, 0.45);
  // light bounced up from the fog and forests below
  BOUNCE = uMoonE * max(uMoonDir.y, 0.0) + uSunE * max(uSunDir.y, 0.0);
  float nuM = NUM;

  // the two media along this ray, marched front to back
  float topMax = uFogTop + uFogVar * 0.8 + 180.0;
  float fIn = uCamAlt > topMax ? sphereHit(ro, d, Rg + topMax) : 0.0;
  bool fogOn = uFogDens > 0.0 && fIn >= 0.0 && fIn < TEND;
  float rB = Rg + uCloudBase - 260.0, rT = Rg + uCloudTop + 660.0;
  float r0 = length(ro);
  float ct0, ct1;
  if (r0 < rB) { ct0 = sphereExit(ro, d, rB); ct1 = sphereExit(ro, d, rT); }
  else if (r0 < rT) { ct0 = 0.0; float hb = sphereHit(ro, d, rB); ct1 = hb > 0.0 ? hb : sphereExit(ro, d, rT); }
  else {
    float ht = sphereHit(ro, d, rT);
    ct0 = ht;
    float hb = sphereHit(ro, d, rB);
    float bb = dot(ro, d), cc = dot(ro, ro) - rT * rT;
    ct1 = hb > 0.0 ? hb : (ht > 0.0 ? -bb + sqrt(max(bb * bb - cc, 0.0)) : -1.0);
  }
  ct1 = min(min(ct1, TEND), ct0 + 90000.0);
  bool cloudOn = uCloudCov > 0.0 && ct0 >= 0.0 && ct1 > ct0;
  bool cloudFirst = cloudOn && (!fogOn || ct0 < fIn);

  vec4 F = vec4(0.0, 0.0, 0.0, 1.0), C = vec4(0.0, 0.0, 0.0, 1.0);
  vec3 aurF = vec3(0.0), aurC = vec3(0.0);
  float hF = -1.0, hC = -1.0;
  if (cloudFirst) {
    C = marchClouds(ct0, ct1, aurC, hC);
    if (fogOn && C.a > 0.01) F = marchFog(fIn, aurF, hF);
  } else {
    if (fogOn) F = marchFog(fIn, aurF, hF);
    if (cloudOn && F.a > 0.01) C = marchClouds(ct0, ct1, aurC, hC);
  }
  vec3 L;
  float T = F.a * C.a;
  if (cloudFirst) { L = C.rgb + C.a * F.rgb; aurF *= C.a; }
  else { L = F.rgb + F.a * C.rgb; aurC *= F.a; }
  float tFirst = hF < 0.0 ? hC : (hC < 0.0 ? hF : min(hF, hC));

  // the moon's diffraction glow, held below the brightness of the disc itself
  if (nuM > 0.88) {
    vec3 aur = aurC * diffraction(nuM, 16.0) + aurF * diffraction(nuM, 9.0);
    float al = dot(aur, vec3(0.2126, 0.7152, 0.0722));
    L += aur / (1.0 + al / max(uAurMax, 1e-6));
  }

  // aerial perspective between the camera and the clouds
  if (tFirst > 0.0) {
    float haze = exp(-tFirst / 70000.0);
    vec3 skyD = texture(tSkyView, skyUV(d)).rgb;
    L = L * haze + skyD * (1.0 - T) * (1.0 - haze);
  }

  vec4 cur = vec4(L, T);
  vec2 hp = gl_FragCoord.xy / uHistSize;
  vec4 hist = texture(tHist, hp);
  o = mix(cur, hist, uTAA);
}`;
}
