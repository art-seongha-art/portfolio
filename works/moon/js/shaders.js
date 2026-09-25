// Moon — GLSL sources.
// Everything is ray-traced per pixel from the viewer's eye, so the same shader
// serves a CAVE wall (off-axis frustum), a single wall, or a normal screen.
// World frame: x right, y up, -z = front wall. Moon body frame: +z = lon 0
// (near-side centre), +x = lon 90°E, +y = north pole. Distances in lunar radii.

import { ATMO_COMMON } from './atmo.js';
import { TERRAIN_COMMON } from './terrain.js';
import { SH_HALF, SH_REF } from './clouds.js';
import { SURF_GLSL } from './surface.js';
import { SEA_GLSL } from './sea.js';

// Random rotations that decorrelate the crater grids of each octave.
function octaveRotations(n, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < n; i++) {
    // uniform random quaternion
    const u1 = rnd(), u2 = rnd(), u3 = rnd();
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    const x = a * Math.sin(2 * Math.PI * u2), y = a * Math.cos(2 * Math.PI * u2);
    const z = b * Math.sin(2 * Math.PI * u3), w = b * Math.cos(2 * Math.PI * u3);
    // column-major mat3
    const m = [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ];
    out.push(`mat3(${m.map((v) => v.toFixed(7)).join(',')})`);
  }
  return out;
}

const OCTAVES = 7;

export const FULLSCREEN_VS = `#version 300 es
void main() {
  // one big triangle
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function mainFS() {
  const rots = octaveRotations(OCTAVES, 20260924);
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) out vec4 oCol;
layout(location = 1) out vec4 oAux;

// ---------------- view
uniform vec4  uView;
uniform vec3  uPA, uDU, uDV;
uniform float uTime;
uniform float uExposure;
uniform float uGrid;
uniform vec2  uJitter;

// ---------------- moon
uniform mat3  uM;
uniform vec3  uCamB;
uniform vec3  uSunB;
uniform vec3  uEarthB;
uniform float uEarthshine;
// light on the moon being shaded (the live moon, or one of the afterimages)
vec3 SUNB, EARTHB;
float ESHINE;
uniform vec4  uAlb;          // gamma, saturation, gain, fresh-crater brightening
uniform float uRelief;
uniform float uBump;
uniform float uCrater;
uniform float uLimbSoft;
uniform float uMoonVis;
uniform float uLodBias;
uniform float uRough;
uniform float uSunI;

uniform sampler2D tColor;
uniform sampler2D tHeight;
uniform vec2  uTexH;
uniform sampler2D tPatchH;
uniform sampler2D tPatchC;
uniform int   uPatchType;
uniform vec4  uPatchB;
uniform float uPatchTexel;
uniform float uPatchColor;

// ---------------- earth scenes (physical sky, real terrain, volumetrics)
uniform float uEarth;          // 1 = viewer on the Earth (sky LUT + terrain), 0 = space
uniform float uCamAlt;
uniform sampler2D tTrans;
uniform sampler2D tSkyView;
uniform sampler2D tMW;
uniform float uLST, uLat;
uniform float uMWGain;
uniform vec3  uSunDirW;
uniform vec3  uMoonE, uSunE;   // pre-exposed irradiance (rgb)
uniform float uMoonScale;      // moon disc brightness on Earth (display-referred)
uniform float uAbsScale;       // HDR value -> cd/m2, for night vision (0 = off)
uniform sampler2D tCloudSh;    // transmittance of the cloud deck toward the key light
uniform vec3  uKeyDirW;
uniform float uKeyMoon;        // 1 when the key light is the moon
uniform sampler2D tCacheA;
uniform sampler2D tCacheB;
uniform vec4  uCacheRect;
uniform vec2  uCacheSize;
uniform float uTerrain;
uniform sampler2D tVol;
uniform vec4  uVolRect;
uniform vec2  uVolSize;
uniform float uVolOn;
uniform vec3  uEclC;           // Earth-shadow axis offset in the moon frame (lunar radii)
uniform float uEcl;
uniform vec3  uMoonDirW;
uniform float uMoonAngR;
uniform float uMoonLum;
uniform vec3  uMoonTint;
uniform float uExtMix;
uniform float uGlow;
uniform float uRefr;
uniform float uShimmer;
uniform float uStars;

// ---------------- space extras
uniform float uEarthVis;
uniform vec3  uEarthDirW;
uniform float uEarthAngR;
uniform mat3  uEarthRot;
uniform vec3  uSunW;
uniform float uSunVis;
uniform sampler2D tEarthDay;
uniform sampler2D tEarthCN;
// afterimages of the moon during the month round the room: xyz direction, w strength;
// world-to-body matrix, sun in the body frame and earthshine for each
uniform int   uGhostN;
uniform vec4  uGhost[9];
uniform mat3  uGhostM[9];
uniform vec3  uGhostSun[9];
uniform float uGhostES[9];
// standing on the moon (the ground comes from the cache, bound to tCacheA/B)
uniform float uSurface;
uniform float uEarthGain;
${SURF_GLSL}

// ---------------- focus
uniform float uFocus;        // focus distance (lunar radii), 0 = infinity
uniform float uDof;          // circle of confusion scale (px)

const float PI  = 3.14159265358979;
const float TAU = 6.28318530717959;
const float RM  = 1737400.0;
const float SUN_R = 0.00465;
const vec3  LUMA = vec3(0.2126, 0.7152, 0.0722);

const mat3 OROT[${OCTAVES}] = mat3[${OCTAVES}](${rots.join(',\n  ')});

// ------------------------------------------------------------ hashing / noise
uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 rnd4(ivec4 p) { return vec4(pcg4d(uvec4(p))) * (1.0 / 4294967295.0); }
float h12(vec2 p) {
  uvec4 h = pcg4d(uvec4(uvec2(ivec2(floor(p))), 17u, 3u));
  return float(h.x) * (1.0 / 4294967295.0);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h12(i), b = h12(i + vec2(1, 0)), c = h12(i + vec2(0, 1)), d = h12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise2(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
// fbm whose octaves fall back to their mean once smaller than ~2 px (fw = pixel footprint in p units)
float fbm2l(vec2 p, int oct, float fw) {
  float s = 0.0, a = 0.5, f = 1.0;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = clamp(1.6 - fw * f * 2.2, 0.0, 1.0);
    s += a * mix(0.5, vnoise2(p), w);
    p = r * p * 2.03 + 11.7;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 b = ivec3(i);
  float n000 = rnd4(ivec4(b, 5)).x, n100 = rnd4(ivec4(b + ivec3(1,0,0), 5)).x;
  float n010 = rnd4(ivec4(b + ivec3(0,1,0), 5)).x, n110 = rnd4(ivec4(b + ivec3(1,1,0), 5)).x;
  float n001 = rnd4(ivec4(b + ivec3(0,0,1), 5)).x, n101 = rnd4(ivec4(b + ivec3(1,0,1), 5)).x;
  float n011 = rnd4(ivec4(b + ivec3(0,1,1), 5)).x, n111 = rnd4(ivec4(b + ivec3(1,1,1), 5)).x;
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// ------------------------------------------------------------ moon textures
vec2 eqUV(vec3 n) {
  return vec2(atan(n.x, n.z) / TAU + 0.5, acos(clamp(n.y, -1.0, 1.0)) / PI);
}

float patchUV(vec3 n, out vec2 puv) {
  puv = vec2(-1.0);
  if (uPatchType == 1) {
    float lon = atan(n.x, n.z), lat = asin(clamp(n.y, -1.0, 1.0));
    puv = vec2((lon - uPatchB.x) / (uPatchB.y - uPatchB.x), (uPatchB.w - lat) / (uPatchB.w - uPatchB.z));
  } else if (uPatchType == 2) {
    float k = 1.0 / max(1.0 - n.y, 1e-4);
    puv = vec2(n.x * k, n.z * k) / (2.0 * uPatchB.x) + 0.5;
  } else {
    return 0.0;
  }
  vec2 e = min(puv, 1.0 - puv);
  return smoothstep(0.0, 0.07, min(e.x, e.y));
}

// height above the 1737.4 km reference sphere, in lunar radii.
// fp = footprint in radians of arc (selects the mip level).
float heightAt(vec3 n, float fp) {
  float lg = log2(max(fp * uTexH.x / TAU, 1.0));
  float h = textureLod(tHeight, eqUV(n), lg).r;
  if (uPatchType > 0) {
    vec2 puv;
    float w = patchUV(n, puv);
    if (w > 0.0) {
      float lp = log2(max(fp / uPatchTexel, 1.0));
      h = mix(h, textureLod(tPatchH, puv, lp).r, w);
    }
  }
  return h / RM;
}

// McEwen (1991) lunar-Lambert limb parameter
float lunarL(float a) {
  float d = degrees(a);
  return clamp(1.0 - 0.019 * d + 0.000242 * d * d - 1.46e-6 * d * d * d, 0.0, 1.0);
}

vec3 surfDiff(vec3 rd, vec3 drd, float t, vec3 n) {
  float dn = min(dot(rd, n), -0.035);
  return t * (drd - rd * (dot(drd, n) / dn));
}

vec3 albedoAt(vec3 n0, vec3 dpx, vec3 dpy, float pw, vec2 puv) {
  float cx = max(n0.x * n0.x + n0.z * n0.z, 1e-6);
  float sx = sqrt(cx);
  vec2 gx = vec2((n0.z * dpx.x - n0.x * dpx.z) / (cx * TAU), -dpx.y / (PI * sx));
  vec2 gy = vec2((n0.z * dpy.x - n0.x * dpy.z) / (cx * TAU), -dpy.y / (PI * sx));
  float lb = exp2(uLodBias);
  gx *= lb; gy *= lb;
  vec3 a = textureGrad(tColor, eqUV(n0), gx, gy).rgb;
  if (pw > 0.0 && uPatchColor > 0.5 && uPatchType == 1) {
    vec2 sc = vec2(TAU / (uPatchB.y - uPatchB.x), PI / (uPatchB.w - uPatchB.z));
    vec3 ap = textureGrad(tPatchC, puv, gx * sc, gy * sc).rgb;
    a = mix(a, ap, pw);
  }
  a = pow(max(a, vec3(1e-4)), vec3(uAlb.x));
  float l = dot(a, LUMA);
  a = max(mix(vec3(l), a, uAlb.y), vec3(0.0));
  return a * uAlb.z;
}

// ------------------------------------------------------------ terrain shadow
// Horizon march along the great circle toward the sun; returns 0..1 visibility
// of the solar disc (soft penumbra from the sun's 0.53° diameter).
float terrainShadow(vec3 n0, float h0, vec3 L, float fp, float texel) {
  float sinE = dot(n0, L);
  if (sinE > 0.42) return 1.0;
  if (sinE < -0.11) return 0.0;
  float cosE = sqrt(max(1.0 - sinE * sinE, 1e-6));
  vec3 T = (L - n0 * sinE) / cosE;
  float tanE = sinE / cosE;
  float d = max(fp, texel) * 1.6;
  float occ = -1.0;
  for (int i = 0; i < 28; i++) {
    vec3 q = n0 * cos(d) + T * sin(d);
    float hq = heightAt(q, d * 0.16);
    float rayH = h0 + d * tanE + 0.5 * d * d;
    occ = max(occ, (hq - rayH) / d);
    d *= 1.27;
    if (d > 0.17 || occ > SUN_R * 2.0) break;
  }
  float v = smoothstep(SUN_R, -SUN_R, occ);
  return mix(v, 1.0, smoothstep(0.30, 0.42, sinE));
}

// ------------------------------------------------------------ procedural craters
// Sub-texel craters on a jittered 3D grid (2x2x2 search is exact because each
// crater's ball of influence has radius <= half a cell). Adds slope, albedo and
// an analytic cast shadow for a parabolic bowl lit by a low sun.
void craterField(vec3 n0, vec3 Nm, vec3 L, float fp, float lum,
                 inout vec3 grad, inout float alb, inout float shade, inout float unres) {
  float sinE = dot(Nm, L);
  vec3 Ts = L - Nm * sinE;
  float cl = length(Ts);
  Ts = cl > 1e-5 ? Ts / cl : vec3(0.0);
  vec3 Tp = cross(Nm, Ts);
  float tanE = sinE / max(cl, 1e-4);
  float dens = mix(0.26, 0.62, smoothstep(0.18, 0.48, lum));
  float cell0 = 7.0 / 1737.4;
  for (int o = 0; o < ${OCTAVES}; o++) {
    float s = cell0 * exp2(-float(o));
    float aT = 0.2 * s;
    float wl = smoothstep(0.9, 3.2, aT / fp) * uCrater;
    // statistical darkening from craters too small to resolve (low sun only)
    float kT = max(tanE, 0.0) / 0.55;
    float un1 = dens * 0.07 * max(0.0, 1.0 - kT * 0.5) * step(0.0, sinE);
    if (wl < 0.004) {
      // this and every finer octave are unresolved: account for them and stop
      unres += un1 * float(${OCTAVES} - o);
      break;
    }
    unres += (1.0 - wl) * un1;
    vec3 nq = OROT[o] * n0;
    vec3 q = nq / s + vec3(float(o) * 17.13, float(o) * 5.71, float(o) * 11.37);
    vec3 b = floor(q - 0.5);
    for (int c = 0; c < 8; c++) {
      vec3 cell = b + vec3(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1));
      ivec3 ic = ivec3(cell);
      vec4 r = rnd4(ivec4(ic, o * 2 + 1));
      if (r.w > dens) continue;
      vec3 dv = q - (cell + r.xyz);
      vec4 r2 = rnd4(ivec4(ic, o * 2 + 2));
      float rb = mix(0.14, 0.5, r2.x * r2.x);
      float d2 = dot(dv, dv);
      if (d2 >= rb * rb) continue;
      float dn = dot(dv, nq);
      vec3 tv = dv - nq * dn;
      float rc2 = rb * rb - dn * dn;
      if (rc2 <= 1e-6) continue;
      float A = 0.5 * sqrt(rc2);
      float rr = length(tv);
      float x = rr / A;
      float fresh = r2.y * r2.y * r2.y;
      float depth = mix(0.09, 0.40, fresh) * A;
      float rim = mix(0.012, 0.075, fresh) * A;
      float taper = smoothstep(2.0, 1.5, x);
      float dhdr = x < 1.0 ? 2.0 * depth * x / A : -3.0 * rim / (A * x * x * x * x) * taper;
      vec3 gdir = rr > 1e-6 ? tv / rr : vec3(0.0);
      vec3 gw = transpose(OROT[o]) * gdir;
      grad += gw * dhdr * wl;
      float br = fresh * fresh * (x < 1.0 ? mix(0.10, 0.34, x * x) : 0.34 * exp(-(x - 1.0) * 2.6) * taper);
      alb *= 1.0 + br * wl * uAlb.w;
      if (x < 1.0 && sinE > -0.05) {
        float k = max(tanE, 0.0) * A / depth;
        if (k < 2.0) {
          vec3 tw = transpose(OROT[o]) * tv;
          vec2 uc = vec2(dot(tw, Ts), dot(tw, Tp)) / A;
          float dd = length(uc - vec2(k, 0.0));
          float pen = SUN_R * (1.0 + tanE * tanE) * A / depth + fp / (A * s) + 0.015;
          float sh = smoothstep(1.0 + pen, 1.0 - pen, dd) * smoothstep(1.0, 0.93, x);
          shade *= 1.0 - sh * wl;
        }
      }
    }
  }
}

// ------------------------------------------------------------ lunar eclipse
// Earth's shadow at the moon: penumbra (part of the solar disc hidden) and umbra
// (only sunlight bent through Earth's atmosphere: red, with a turquoise rim where
// it grazed the ozone layer). Radii in lunar radii at the moon's distance.
vec3 eclipseLight(vec3 p) {
  vec3 q = p - SUNB * dot(p, SUNB) - uEclC;
  float r = length(q);
  const float RU = 2.65, RP = 4.65;
  float f = clamp((r - RU) / (RP - RU), 0.0, 1.0);
  f = mix(f * f * (3.0 - 2.0 * f), f, 0.25);
  float x = clamp(r / RU, 0.0, 1.0);
  vec3 red = vec3(1.0, 0.2, 0.055) * (0.0035 + 0.016 * pow(x, 5.0));
  vec3 turq = vec3(0.32, 0.72, 1.0) * 0.022 * exp(-pow((1.0 - x) / 0.045, 2.0));
  return vec3(f) + (red + turq) * (1.0 - f);
}

// ------------------------------------------------------------ moon trace
struct MoonHit { float cov; float t; vec3 n0; };

MoonHit traceMoon(vec3 ro, vec3 rd, float angPix) {
  MoonHit m;
  m.cov = 0.0; m.t = 0.0; m.n0 = vec3(0.0, 0.0, 1.0);
  if (uMoonVis <= 0.0) return m;
  float b = dot(ro, rd);
  float r2 = dot(ro, ro);
  if (uRelief > 0.001) {
    float hmax = 10800.0 / RM * uRelief + 3e-5;
    float hmin = -9300.0 / RM * uRelief;
    float Ro = 1.0 + hmax, Ri = 1.0 + hmin;
    float disc = b * b - (r2 - Ro * Ro);
    if (disc <= 0.0) return m;
    float sq = sqrt(disc);
    float t0 = max(-b - sq, 0.0), t1 = -b + sq;
    if (t1 <= 0.0) return m;
    float di = b * b - (r2 - Ri * Ri);
    if (di > 0.0) { float ti = -b - sqrt(di); if (ti > 0.0) t1 = min(t1, ti + 1e-5); }
    float t = t0, tPrev = t0;
    bool hit = false;
    float minClr = 1e9, tMin = t0;
    for (int i = 0; i < 128; i++) {
      vec3 p = ro + rd * t;
      float r = length(p);
      vec3 n = p / r;
      float fpx = max(angPix * t, 1e-7);
      float fz = r - 1.0 - uRelief * heightAt(n, fpx);
      if (fz < 0.0) { hit = true; break; }
      float clr = fz / fpx;
      if (clr < minClr) { minClr = clr; tMin = t; }
      tPrev = t;
      float cosv = abs(dot(rd, n));
      t += max(fz / (cosv + 0.55), t * 0.0025 + 2e-6);
      if (t > t1) break;
    }
    if (hit) {
      float ta = tPrev, tb = t;
      for (int j = 0; j < 7; j++) {
        float tm = 0.5 * (ta + tb);
        vec3 pm = ro + rd * tm;
        float rm = length(pm);
        float fm = rm - 1.0 - uRelief * heightAt(pm / rm, max(angPix * tm, 1e-7));
        if (fm < 0.0) tb = tm; else ta = tm;
      }
      m.t = 0.5 * (ta + tb);
      m.cov = 1.0;
    } else {
      float soft = 1.0 + uLimbSoft / max(angPix, 1e-6);
      if (minClr >= soft) return m;
      m.t = tMin;
      m.cov = smoothstep(soft, 0.0, minClr);
    }
    m.n0 = normalize(ro + rd * m.t);
  } else {
    float tc = -b;
    if (tc <= 0.0) return m;
    float rc = sqrt(max(r2 - b * b, 0.0));
    float eps = max(angPix * tc * 0.7, uLimbSoft * tc) + 1e-7;
    m.cov = smoothstep(1.0 + eps, 1.0 - eps, rc);
    if (m.cov <= 0.0) return m;
    m.t = rc < 1.0 ? tc - sqrt(1.0 - rc * rc) : tc;
    m.n0 = normalize(ro + rd * m.t);
  }
  m.cov *= uMoonVis;
  return m;
}

vec3 shadeMoon(MoonHit mh, vec3 ro, vec3 rd, vec3 rdx, vec3 rdy, float angPix) {
  vec3 n0 = mh.n0;
  float t = mh.t;
  float fp = max(angPix * t, 1e-8);
  float fpB = fp * exp2(uLodBias);
  vec2 puv;
  float pw = patchUV(n0, puv);
  float texG = TAU / uTexH.x;
  float texel = uPatchType > 0 ? mix(texG, uPatchTexel, pw) : texG;
  float dl = max(fpB, texel * 0.8);

  vec3 ref = abs(n0.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, n0));
  vec3 t2 = cross(n0, t1);
  float hx1 = heightAt(normalize(n0 + t1 * dl), dl);
  float hx0 = heightAt(normalize(n0 - t1 * dl), dl);
  float hy1 = heightAt(normalize(n0 + t2 * dl), dl);
  float hy0 = heightAt(normalize(n0 - t2 * dl), dl);
  float h0 = heightAt(n0, dl);
  vec3 gDem = ((hx1 - hx0) * t1 + (hy1 - hy0) * t2) / (2.0 * dl);
  vec3 Nm = normalize(n0 - gDem * uBump);

  vec3 dpx = surfDiff(rd, rdx, t, n0);
  vec3 dpy = surfDiff(rd, rdy, t, n0);
  vec3 alb = albedoAt(n0, dpx, dpy, pw, puv);
  float lum = dot(alb, LUMA) / max(uAlb.z, 1e-3);

  vec3 L = SUNB;
  vec3 gCr = vec3(0.0);
  float albMul = 1.0, crSh = 1.0, unres = 0.0;
  if (uCrater > 0.0) craterField(n0, Nm, L, fpB, lum, gCr, albMul, crSh, unres);
  vec3 N = normalize(Nm - gCr * uBump);
  alb *= albMul;
  // fine albedo mottling below the map resolution, faded in only once resolved
  {
    float s1 = 2.6 / 1737.4, s2 = 0.55 / 1737.4;
    float w1 = smoothstep(1.5, 5.0, s1 / fpB), w2 = smoothstep(1.5, 5.0, s2 / fpB);
    if (w1 > 0.0) alb *= 1.0 + 0.12 * w1 * (vnoise3(n0 / s1) - 0.5) + 0.09 * w2 * (vnoise3(n0 / s2 + 17.0) - 0.5);
  }

  vec3 V = -rd;
  float mu0 = dot(N, L);
  float mu = max(dot(N, V), 0.0);
  float alpha = acos(clamp(dot(L, V), -1.0, 1.0));
  float Lw = lunarL(alpha);
  float m0 = max(mu0, 0.0) * smoothstep(-0.006, 0.006, mu0);
  float lit = 2.0 * Lw * m0 / (m0 + mu + 1e-3) + (1.0 - Lw) * m0;
  float sh = 1.0;
  if (lit > 0.0) sh = terrainShadow(n0, h0, L, dl, texel) * crSh;
  float phaseF = exp(-0.55 * alpha) * (1.0 + 0.3 * exp(-alpha / 0.06));
  float rough = 1.0 - clamp(unres * uRough, 0.0, 0.6);
  vec3 ecl = uEcl > 0.0 ? eclipseLight(n0) : vec3(1.0);
  vec3 rad = alb * (lit * sh * phaseF * rough * uSunI) * ecl;
  // soft bounce from nearby sunlit ground keeps shadows from going digital-black
  float sinEm = dot(Nm, L);
  rad += alb * uSunI * 0.02 * smoothstep(-0.02, 0.25, sinEm) * (1.0 - sh * min(lit, 1.0)) * ecl;
  // earthshine: diffuse light from the Earth (blue-white)
  float es = max(dot(N, EARTHB), 0.0);
  rad += alb * es * ESHINE * vec3(0.78, 0.86, 1.0);
  return rad;
}

// ------------------------------------------------------------ earth: sky, stars, terrain
${ATMO_COMMON}
${TERRAIN_COMMON}
${SEA_GLSL}

// magnified atmospheric refraction: the low moon is flattened and shimmers
vec3 atmoBend(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, -d.z);
  const float M = 2.5;
  float e0 = max(degrees(el), -0.3) / M;
  float R  = 1.0 / tan(radians(e0 + 7.31 / (e0 + 4.4)));
  float R0 = 1.0 / tan(radians(7.31 / 4.4));
  float dEl = radians((R0 - R) / 60.0) * M * uRefr;
  float sN = uShimmer * exp(-max(el, 0.0) / 0.07);
  if (sN > 0.001) {
    vec3 sp = vec3(az * 90.0, el * 260.0, uTime * 0.45);
    dEl += sN * (vnoise3(sp) - 0.5) * 0.0045;
    az += sN * (vnoise3(sp + 31.7) - 0.5) * 0.0018;
  }
  float e2 = el + dEl;
  return vec3(sin(az) * cos(e2), sin(e2), -cos(az) * cos(e2));
}

// NASA Deep Star Maps 2020 (Gaia DR2 etc.): diffuse Milky Way, RA/Dec plate carree
vec3 milkyWay(vec3 d) {
  float sp = sin(uLat), cp = cos(uLat);
  float dec = asin(clamp(d.y * sp + d.z * cp, -1.0, 1.0));
  float H = atan(d.x, d.y * cp - d.z * sp);
  float ra = uLST - H;
  vec2 uv = vec2(fract(0.5 - ra / TAU), 0.5 - dec / PI);
  vec3 c = textureLod(tMW, uv, 0.4).rgb;
  return c * c * 0.14;
}

vec3 shadeTerrain(vec3 d, vec4 ca, vec4 cb, float angPix) {
  vec3 N = ca.xyz;
  float t = ca.w;
  vec3 p = d * t;
  vec3 Ce = vec3(0.0, -(Rg + uCamAlt), 0.0);
  vec3 q = p - Ce;
  float r = length(q);
  vec3 up = q / r;
  float alt = r - Rg;
  vec2 en = uCamEN + vec2(-p.x, p.z);
  float forest = cb.y, rock = cb.z, water = cb.w;
  // night-dark materials: fir and oak canopy, bamboo grass and heath, weathered granite
  vec3 aForest = vec3(0.020, 0.028, 0.021);
  vec3 aMeadow = vec3(0.062, 0.060, 0.047);
  vec3 aRock = vec3(0.085, 0.084, 0.080);
  vec3 alb = aForest * forest + aRock * rock + aMeadow * max(1.0 - forest - rock, 0.0);
  alb *= 0.8 + 0.4 * vnoise2(en / 85.0);
  if (t < 1500.0) {
    // near the summit: broad patches of grass, bamboo grass and bare ground
    alb *= mix(1.0, 0.7 + 0.6 * vnoise2(en / 17.0), smoothstep(1500.0, 300.0, t));
  }
  alb = mix(alb, vec3(0.015, 0.022, 0.03), water);
  vec3 Em = uMoonE * transmittance(tTrans, r, dot(up, uMoonDirW));
  vec3 Es = uSunE * transmittance(tTrans, r, dot(up, uSunDirW));
  // patches of light and shadow from the cloud deck, drifting over the ranges
  {
    vec2 xz = p.xz + uKeyDirW.xz * (${SH_REF}.0 - alt) / max(uKeyDirW.y, 0.035);
    vec2 suv = xz / ${2 * SH_HALF}.0 + 0.5;
    float inMap = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
    float csh = mix(1.0, texture(tCloudSh, suv).r, inMap);
    if (uKeyMoon > 0.5) Em *= csh; else Es *= csh;
  }
  float fp = t * angPix;
  // direct light uses a gentler normal: the ranges read as soft masses, not as relief maps
  vec3 Nl = normalize(mix(N, up, 0.35));
  float nm = max(dot(Nl, uMoonDirW), 0.0), ns = max(dot(Nl, uSunDirW), 0.0);
  float shm = (nm > 0.0 && dot(Em, vec3(1.0)) > 1e-9) ? terrainShadowE(en, alt, uMoonDirW, fp) : 0.0;
  float shs = (ns > 0.0 && dot(Es, vec3(1.0)) > 1e-9) ? terrainShadowE(en, alt, uSunDirW, fp) : 0.0;
  vec3 ambUp = textureLod(tSkyView, vec2(0.5, 0.97), 6.0).rgb;
  vec3 ambH = textureLod(tSkyView, vec2(0.5, 0.56), 6.0).rgb;
  vec3 amb = mix(ambH, ambUp, 0.5 + 0.5 * N.y);
  vec3 col = alb / PI * (Em * nm * shm + Es * ns * shs) + alb * amb;
  if (water > 0.0) {
    vec3 hv = normalize(uMoonDirW - d);
    col += water * Em * pow(max(hv.y, 0.0), 600.0) * 2.5;
  }
  // aerial perspective: the far ranges fade into the colour of the horizon sky
  float hA = 0.5 * (uCamAlt + alt);
  // plus the moist valley haze of a Korean summer night, thickest low down
  float valleyHaze = 8.0e-5 * uMie * exp(-max(min(alt, uCamAlt) - 350.0, 0.0) / 750.0);
  vec3 sig = BR * exp(-hA / HR) + vec3(BM_E * uMie * exp(-hA / HM) + valleyHaze);
  vec3 Ta = exp(-sig * t);
  vec3 skyH = texture(tSkyView, skyUV(normalize(vec3(d.x, min(d.y, -0.003), d.z)))).rgb;
  return col * Ta + skyH * (1.0 - Ta);
}

// Night vision. Below a few cd/m2 the rods take over from the cones: colour drains
// away and blues read brighter than reds (Purkinje). The moon itself stays photopic.
vec3 mesopic(vec3 c) {
  if (uAbsScale <= 0.0) return c;
  float Y = dot(c, LUMA);
  float lcd = max(Y * uAbsScale, 1e-7);
  float s = smoothstep(0.3, -2.3, log(lcd) / 2.302585) * 0.7;
  float V = dot(c, vec3(0.033, 0.765, 0.2));
  return mix(c, V * vec3(0.74, 0.9, 1.24), s);
}

// depth of the terrain the volume pass saw at wall position f (1e9 = open sky)
float terrainDepth(vec2 f) {
  if (uTerrain < 0.5) return 1e9;
  vec2 cuv = (uCacheRect.xy + f * uCacheRect.zw) / uCacheSize;
  vec4 ca = texture(tCacheA, cuv);
  float cov = texture(tCacheB, cuv).x;
  return (ca.w > 0.0 && cov > 0.5) ? ca.w : 1e9;
}
// the fog and cloud buffer is half resolution: upsample it depth-aware, so fog behind a
// ridge does not bleed over the ridge line (and the ridge does not punch holes in it)
vec4 volUpsample(vec2 f, float myDepth) {
  vec2 vp = uVolRect.xy + f * uVolRect.zw - 0.5;
  vec2 b = floor(vp), fr = vp - b;
  vec4 acc = vec4(0.0), plain = vec4(0.0);
  float ws = 0.0;
  float lz = log(myDepth);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 tp = b + o + 0.5;
    vec4 v = texture(tVol, tp / uVolSize);
    float wb = mix(1.0 - fr.x, fr.x, o.x) * mix(1.0 - fr.y, fr.y, o.y);
    float dz = terrainDepth((tp - uVolRect.xy) / uVolRect.zw);
    float dl = lz - log(dz);
    float w = wb * exp(-dl * dl * 6.0) + 1e-5 * wb;
    acc += v * w;
    ws += w;
    plain += v * wb;
  }
  return ws > 1e-4 ? acc / ws : plain;
}

// ------------------------------------------------------------ earth globe
vec4 earthShade(vec3 d, float angPix) {
  float R = uEarthAngR;
  float cg = dot(d, uEarthDirW);
  float gam = acos(clamp(cg, -1.0, 1.0));
  float halo = exp(-max(gam - R, 0.0) / (R * 0.03)) * smoothstep(R * 1.25, R, gam);
  if (gam > R * 1.25) return vec4(0.0);
  float Dc = 1.0 / sin(R);
  vec3 C = uEarthDirW * Dc;
  float b = dot(d, C);
  float disc = max(b * b - (Dc * Dc - 1.0), 0.0);
  float t = b - sqrt(disc);
  vec3 n = normalize(d * t - C);
  vec3 ne = uEarthRot * n;
  vec2 uv = eqUV(ne);
  vec3 day = texture(tEarthDay, uv).rgb;
  vec2 cn = texture(tEarthCN, uv).rg;
  float cloud = smoothstep(0.03, 0.62, cn.r);
  float ndl = dot(n, uSunW);
  float dayW = smoothstep(-0.12, 0.2, ndl);
  float lamb = max(ndl, 0.0);
  float ocean = smoothstep(0.1, 0.02, day.r + day.g * 0.4) * (1.0 - cloud);
  vec3 V = -d;
  float spec = pow(max(dot(reflect(-uSunW, n), V), 0.0), 70.0) * ocean * 0.55;
  vec3 surf = day * lamb * 1.15 + vec3(1.0, 0.95, 0.85) * spec * lamb;
  vec3 cl = vec3(0.95) * (lamb * 1.05 + 0.02 * dayW);
  vec3 col = mix(surf, cl, cloud);
  float mu = max(dot(n, V), 0.0);
  vec3 atm = vec3(0.32, 0.55, 1.0) * (pow(1.0 - mu, 2.6) * 0.9 + 0.08) * smoothstep(-0.25, 0.35, ndl);
  col = col * (1.0 - 0.18 * dayW) + atm * 0.9;
  vec3 lights = vec3(1.0, 0.72, 0.38) * pow(cn.g, 1.6) * 0.05 * (1.0 - smoothstep(-0.2, 0.02, ndl)) * (1.0 - cloud * 0.8);
  col += lights;
  float cov = smoothstep(R + angPix, R - angPix, gam);
  // thin blue limb glow on the lit side
  vec3 hn = normalize(d - uEarthDirW * cg);
  float hl = smoothstep(-0.3, 0.5, dot(hn, uSunW));
  col = col * cov + vec3(0.28, 0.5, 1.0) * halo * hl * 0.35 * (1.0 - cov);
  return vec4(col, cov);
}

// ------------------------------------------------------------ main
void main() {
  vec2 f = (gl_FragCoord.xy + uJitter - uView.xy) / uView.zw;
  vec3 P = uPA + f.x * uDU + f.y * uDV;
  vec3 d = normalize(P);
  vec3 ddx = dFdx(d), ddy = dFdy(d);
  float angPix = max(max(length(ddx), length(ddy)), 1e-6);

  vec3 col = vec3(0.0);
  float starVis = 1.0;
  float depth = 1e9;
  float expo = uExposure;
  SUNB = uSunB; EARTHB = uEarthB; ESHINE = uEarthshine;

  if (uEarth > 0.5) {
    // ---------------- on the Earth: everything below is already exposed
    expo = 1.0;
    col = texture(tSkyView, skyUV(d)).rgb;
    vec3 Tv = transmittance(tTrans, Rg + uCamAlt, d.y);
    col += milkyWay(d) * uMWGain * Tv;
    starVis *= dot(Tv, vec3(0.3, 0.5, 0.2)) * smoothstep(-0.01, 0.03, d.y);
    if (uSea > 0.5) {
      // by the sea: islands low on the horizon, the water, and the moon's path on it
      vec3 Tmo = transmittance(tTrans, Rg + uCamAlt, uMoonDirW.y);
      vec3 moonLight = uMoonE * Tmo;
      vec3 moonDisp = uMoonTint * (uMoonLum * uMoonScale * 3.14159265 * uMoonAngR * uMoonAngR) * Tmo;
      float di;
      float ci = clamp((isleTop(atan(d.x, -d.z), di) - asin(clamp(d.y, -1.0, 1.0))) / angPix + 0.5, 0.0, 1.0);
      if (ci > 0.0) { col = mix(col, isleColor(d, di, moonLight), ci); starVis *= 1.0 - ci; }
      vec4 sw = seaShade(d, angPix, uMoonDirW, moonDisp, uMoonAngR, moonLight);
      col = mix(col, sw.rgb, sw.a);
      starVis *= 1.0 - sw.a;
    }

    vec3 dm = normalize(mix(d, atmoBend(d), 1.0));
    vec3 ro = uCamB;
    vec3 rd = uM * dm;
    // the moon and its glow are kept apart so they can pass through terrain and cloud
    // and stay in colour when the rest of the night goes grey
    vec3 moonC = vec3(0.0);
    MoonHit mh = traceMoon(ro, rd, angPix);
    if (mh.cov > 0.0) {
      vec3 mc = shadeMoon(mh, ro, rd, uM * ddx, uM * ddy, angPix) * uMoonScale;
      float muM = mix(dm.y, uMoonDirW.y, uExtMix);
      vec3 Tm = transmittance(tTrans, Rg + uCamAlt, muM);
      moonC = mc * Tm * mh.cov;
      starVis *= 1.0 - mh.cov;
    }
    if (uGlow > 0.001) {
      float gam = acos(clamp(dot(dm, uMoonDirW), -1.0, 1.0));
      float x = max(gam - uMoonAngR, 0.0) / max(uMoonAngR, 1e-4);
      float g = 0.07 * exp(-x * 5.0) + 0.02 * exp(-x * 1.2);
      vec3 Tg = transmittance(tTrans, Rg + uCamAlt, uMoonDirW.y);
      moonC += uGlow * uMoonLum * uMoonScale * g * Tg;
    }
    float myDepth = terrainDepth(f);
    if (uTerrain > 0.5) {
      vec2 cuv = (uCacheRect.xy + f * uCacheRect.zw) / uCacheSize;
      vec4 cb = texture(tCacheB, cuv);
      if (cb.x > 0.002) {
        vec4 ca = texelFetch(tCacheA, ivec2(cuv * uCacheSize), 0);
        if (ca.w < 0.0) {
          // coverage came from a neighbouring texel: take the nearest hit
          for (int k = 0; k < 4; k++) {
            ivec2 o = ivec2(k & 1, k >> 1) * 2 - 1;
            vec4 c2 = texelFetch(tCacheA, ivec2(cuv * uCacheSize) + o, 0);
            if (c2.w > 0.0) { ca = c2; break; }
          }
        }
        if (ca.w > 0.0) {
          vec3 tc = shadeTerrain(d, ca, cb, angPix);
          col = mix(col, tc, cb.x);
          moonC *= 1.0 - cb.x;
          starVis *= 1.0 - cb.x;
        }
      }
    }
    if (uVolOn > 0.5) {
      vec4 v = volUpsample(f, myDepth);
      col = col * v.a + v.rgb;
      moonC *= v.a;
      starVis *= v.a;
    }
    col = mesopic(col) + moonC;
  } else if (uSurface > 0.5) {
    // ---------------- standing on the moon at night: the stars, the Earth, the ground it
    // lights from behind, the rabbits
    col = milkyWay(d) * uMWGain;
    vec4 e = earthShade(d, angPix);
    col = col * (1.0 - e.a) + e.rgb * uEarthGain;
    starVis *= 1.0 - e.a;
    vec2 cuv = (uCacheRect.xy + f * uCacheRect.zw) / uCacheSize;
    ivec2 cp = ivec2(cuv * uCacheSize);
    vec4 GA = texelFetch(tCacheA, cp, 0);
    vec4 GB = texelFetch(tCacheB, cp, 0);
    float tG = GA.a > 0.0 ? GA.a : 1e9;
    if (GB.a > 0.0) {
      vec3 amb;
      vec3 g = groundLight(GA, GB, d, amb) * (GA.a > 0.0 ? rabbitShadow(d * tG) : 1.0) + amb;
      col = mix(col, g, GB.a);
      starVis *= 1.0 - GB.a;
    }
    vec4 rb = rabbits(d, angPix, tG);
    col = col * (1.0 - rb.a) + rb.rgb;
    starVis *= 1.0 - rb.a;
  } else {
    // ---------------- in space
    col += milkyWay(d) * uMWGain;
    if (uEarthVis > 0.001) {
      vec4 e = earthShade(d, angPix);
      col = col * (1.0 - e.a * uEarthVis) + e.rgb * uEarthVis;
      starVis *= 1.0 - e.a * uEarthVis;
    }
    if (uSunVis > 0.001) {
      float gs = acos(clamp(dot(d, uSunW), -1.0, 1.0));
      float disc = smoothstep(SUN_R + angPix, SUN_R - angPix, gs);
      col += uSunVis * vec3(1.0, 0.975, 0.93) * (disc * 900.0);
    }
    vec3 ro = uCamB;
    vec3 rd = uM * d;
    MoonHit mh = traceMoon(ro, rd, angPix);
    if (mh.cov > 0.0) {
      vec3 mc = shadeMoon(mh, ro, rd, uM * ddx, uM * ddy, angPix);
      col = mix(col, mc, mh.cov);
      starVis *= 1.0 - mh.cov;
      if (mh.cov > 0.5) depth = mh.t;
    }
    // afterimages: the same moon where it stopped earlier in the month, added on top like
    // a multiple exposure (at most one covers a pixel)
    if (uGhostN > 0) {
      float cosR = cos(uMoonAngR * 1.03 + angPix);
      for (int i = 0; i < 9; i++) {
        if (i >= uGhostN) break;
        if (dot(d, uGhost[i].xyz) < cosR) continue;
        vec3 rdG = uGhostM[i] * d;
        MoonHit gh = traceMoon(ro, rdG, angPix);
        if (gh.cov > 0.0) {
          SUNB = uGhostSun[i]; ESHINE = uGhostES[i];
          vec3 gc = shadeMoon(gh, ro, rdG, uGhostM[i] * ddx, uGhostM[i] * ddy, angPix);
          SUNB = uSunB; ESHINE = uEarthshine;
          float a = gh.cov * uGhost[i].w;
          col += gc * a;
          starVis *= 1.0 - a;
        }
        break;
      }
    }
    if (uSunVis > 0.001) {
      float gs = acos(clamp(dot(d, uSunW), -1.0, 1.0));
      float vis = 1.0 - (mh.cov > 0.0 ? mh.cov : 0.0) * 0.85;
      col += uSunVis * vis * vec3(1.0, 0.96, 0.9) * (0.25 / (1.0 + pow(gs / 0.004, 2.0)) + 0.006 * exp(-gs / 0.06));
    }
    if (uGlow > 0.001) {
      float gam = acos(clamp(dot(d, uMoonDirW), -1.0, 1.0));
      float x = max(gam - uMoonAngR, 0.0) / max(uMoonAngR, 1e-4);
      col += uGlow * uMoonLum * (0.05 * exp(-x * 5.0) + 0.015 * exp(-x * 1.2));
    }
  }

  if (uGrid > 0.5) {
    float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float az = degrees(atan(d.x, -d.z));
    float le = abs(fract(el / 10.0 + 0.5) - 0.5) * 10.0;
    float la = abs(fract(az / 10.0 + 0.5) - 0.5) * 10.0 * cos(radians(el));
    float w = degrees(angPix) * 1.3;
    float line = max(smoothstep(w, 0.0, le), smoothstep(w, 0.0, la));
    float hz = smoothstep(w * 1.5, 0.0, abs(el));
    col = mix(col, vec3(0.55, 0.7, 0.9) / max(expo, 1e-6), line * 0.7);
    col = mix(col, vec3(1.0, 0.35, 0.3) / max(expo, 1e-6), hz);
  }

  float coc = 0.0;
  if (uDof > 0.0) {
    coc = uFocus > 0.0 ? uDof * abs(1.0 - uFocus / depth) : 0.0;
    coc = min(coc, 40.0);
  }
  oCol = vec4(max(col, vec3(0.0)) * expo, clamp(starVis * uStars, 0.0, 1.0));
  oAux = vec4(coc, 0.0, 0.0, 1.0);
}`;
}

export const STAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aStar;   // ra(deg) dec(deg) mag bv
uniform vec3  uPA, uDU, uDV;
uniform float uLat, uLST;             // radians
uniform float uGain, uTime, uPx, uExt;
out vec3 vCol;
out float vI;
out float vR;

vec3 bvColor(float bv) {
  bv = clamp(bv, -0.4, 2.0);
  float t = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
  float x = clamp((t - 2000.0) / 10000.0, 0.0, 1.0);
  vec3 warm = vec3(1.0, 0.62, 0.34), white = vec3(1.0, 0.96, 0.92), blue = vec3(0.66, 0.78, 1.0);
  vec3 c = x < 0.35 ? mix(warm, white, x / 0.35) : mix(white, blue, (x - 0.35) / 0.65);
  return mix(vec3(1.0), c, 0.6);
}

void main() {
  float ra = radians(aStar.x), dec = radians(aStar.y);
  float H = uLST - ra;
  vec3 d = vec3(cos(dec) * sin(H),
                sin(dec) * sin(uLat) + cos(dec) * cos(H) * cos(uLat),
                sin(dec) * cos(uLat) - cos(dec) * cos(H) * sin(uLat));
  vec3 n = cross(uDU, uDV);
  float dn = dot(d, n), pn = dot(uPA, n);
  // flux in display units: magnitude scale times the scene exposure
  float I0 = pow(10.0, -0.4 * aStar.z) * uGain;
  // (in space, uExt = 0: no horizon, no extinction, no twinkling)
  if (dn * pn <= 0.0 || I0 < 0.0015 || (uExt > 0.0 && d.y < -0.02)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 P = d * (pn / dn);
  vec3 q = P - uPA;
  float u = dot(q, uDU) / dot(uDU, uDU);
  float v = dot(q, uDV) / dot(uDV, uDV);
  gl_Position = vec4(u * 2.0 - 1.0, v * 2.0 - 1.0, 0.0, 1.0);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float X = 1.0 / (sin(max(el, 0.0)) + 0.50572 * pow(degrees(max(el, 0.0)) + 6.07995, -1.6364));
  vec3 T = exp(-vec3(0.075, 0.135, 0.27) * uExt * X);
  // slow, subtle scintillation near the horizon
  float tw = 1.0 + 0.35 * min(uExt, 1.0) * exp(-el / 0.25) * sin(uTime * (2.0 + fract(aStar.x * 7.1) * 3.0) + aStar.y * 11.0);
  vCol = bvColor(aStar.w) * T;
  float I = min(I0, 40.0) * tw;
  vR = uPx * (0.9 + 0.22 * log(1.0 + min(I0 * 8.0, 40.0)));
  gl_PointSize = ceil(vR * 3.0) * 2.0 + 1.0;
  vI = I;
}`;

export const STAR_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vI;
in float vR;
out vec4 o;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * (ceil(vR * 3.0) * 2.0 + 1.0);
  float r2 = dot(p, p);
  float s = vR * 0.55;
  float g = exp(-r2 / (2.0 * s * s)) / (6.2831853 * s * s);
  o = vec4(vCol * vI * g, 0.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D tHDR;
uniform sampler2D tAux;
uniform vec2  uSrcSize;
uniform vec4  uSrcRect;
uniform vec4  uDstRect;
uniform float uBlur;
uniform float uBloom;
uniform vec3  uPA, uDU, uDV;
uniform vec3  uVigDir;
uniform float uVig;
uniform vec3  uGain;
uniform float uGamma, uLift, uGrain, uFrame, uFade, uHalation;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 f = (gl_FragCoord.xy - uDstRect.xy) / uDstRect.zw;
  vec2 st = (uSrcRect.xy + f * uSrcRect.zw) / uSrcSize;
  vec2 px = 1.0 / uSrcSize;
  float coc = max(uBlur, texture(tAux, st).r);
  vec3 sharp = texture(tHDR, st).rgb;
  vec3 c = sharp;
  if (coc > 0.6) {
    float lod = max(log2(coc / 3.5), 0.0);
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    float rot = hash(floor(gl_FragCoord.xy)) * 6.2831853;
    for (int i = 0; i < 24; i++) {
      float r = sqrt((float(i) + 0.5) / 24.0);
      float a = float(i) * 2.39996323 + rot;
      vec2 o2 = vec2(cos(a), sin(a)) * r * coc;
      vec3 s = min(textureLod(tHDR, st + o2 * px, lod).rgb, vec3(24.0));
      float w = 1.0 + 0.6 * smoothstep(1.0, 8.0, dot(s, vec3(0.2126, 0.7152, 0.0722)));
      acc += s * w;
      ws += w;
    }
    c = mix(sharp, acc / ws, smoothstep(0.6, 2.5, coc));
  }
  if (uBloom > 0.0) {
    vec3 b1 = vec3(0.0), b2 = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854 + 0.39;
      vec2 o2 = vec2(cos(a), sin(a));
      b1 += min(textureLod(tHDR, st + o2 * px * 10.0, 3.0).rgb, vec3(16.0));
      b2 += min(textureLod(tHDR, st + o2 * px * 34.0, 5.0).rgb, vec3(16.0));
    }
    b1 += min(textureLod(tHDR, st, 3.0).rgb, vec3(16.0)) * 2.0;
    b2 += min(textureLod(tHDR, st, 5.0).rgb, vec3(16.0)) * 2.0;
    vec3 bl = b1 * 0.05 + b2 * 0.035;
    // warm halation, like light scattering back through film
    c += bl * uBloom * mix(vec3(1.0), vec3(1.25, 0.85, 0.7), uHalation);
  }
  vec3 d = normalize(uPA + f.x * uDU + f.y * uDV);
  float cv = dot(d, uVigDir);
  float vig = mix(1.0, 0.22 + 0.78 * smoothstep(-0.55, 0.92, cv), uVig);
  vig *= mix(1.0, smoothstep(-1.05, -0.25, d.y), uVig * 0.6);
  c *= vig * uFade;
  // filmic curve on luminance, blended with per-channel ACES: bright orange moons
  // stay orange instead of bleaching to white, highlights still roll off softly
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 lp = c * (aces(vec3(L)).x / max(L, 1e-6));
  c = clamp(mix(aces(c), lp, 0.6), 0.0, 1.0);
  c = pow(c, vec3(uGamma)) * uGain;
  c = uLift + (1.0 - uLift) * c;
  c = toSRGB(clamp(c, 0.0, 1.0));
  float n1 = hash(gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0);
  float n2 = hash(gl_FragCoord.yx + fract(uFrame * 0.414) * 57.0);
  float l = dot(c, vec3(0.333));
  float grain = (n1 + n2 - 1.0) * (1.0 / 255.0 + uGrain * 4.0 * l * (1.0 - l));
  o = vec4(c + grain, 1.0);
}`;
