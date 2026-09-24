// Moon — physically based atmosphere (Rayleigh, Mie, ozone; spherical Earth).
// Small look-up textures:
//   transmittance(r, mu)   – light surviving from a point to space (Bruneton mapping)
//   multiple scattering    – Hillaire 2020: all higher scattering orders as a function
//                            of altitude and sun angle; this is what keeps the sky
//                            blue after sunset and makes twilight fade the way it does
//   sky-view(az, el)       – per frame: sun + moon light scattered toward the camera,
//                            which gives the twilight colours, the Earth's shadow and
//                            the Belt of Venus, plus the natural night-sky glow
// Units: metres. Frame: world (x = west/right, y = up, z = north/back), Earth centre below.

export const TRANS_W = 256, TRANS_H = 64, MS_N = 32;

export const ATMO_COMMON = `
const float Rg = 6360000.0;
const float Rt = 6460000.0;
// red at ~630 nm rather than 680: ozone's Chappuis band then keeps twilight zenith blue
const vec3  BR = vec3(7.6e-6, 13.558e-6, 33.1e-6);
const float HR = 8000.0;
const float BM_S = 3.996e-6;
const float BM_E = 4.40e-6;
const float HM = 1200.0;
const vec3  BO = vec3(2.4e-6, 1.881e-6, 0.085e-6);
const vec2  TRANS_SIZE = vec2(${TRANS_W}.0, ${TRANS_H}.0);
uniform float uMie;          // aerosol amount (1 = clear mountain air)

float ozoneD(float h) { return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }
vec3 extinctionAt(float h) {
  return BR * exp(-h / HR) + vec3(BM_E * uMie * exp(-h / HM)) + BO * ozoneD(h);
}
vec2 transUV(float r, float mu) {
  float H = sqrt(Rt * Rt - Rg * Rg);
  float rho = sqrt(max(r * r - Rg * Rg, 0.0));
  float disc = r * r * (mu * mu - 1.0) + Rt * Rt;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dmin = Rt - r, dmax = rho + H;
  vec2 uv = vec2((d - dmin) / max(dmax - dmin, 1.0), rho / H);
  return (uv * (TRANS_SIZE - 1.0) + 0.5) / TRANS_SIZE;
}
// light from direction mu (cosine of zenith angle) reaching radius r; the planet
// blocks it smoothly across a half-degree disc
vec3 transmittance(sampler2D tT, float r, float mu) {
  float muH = -sqrt(max(1.0 - (Rg * Rg) / (r * r), 0.0));
  float vis = smoothstep(muH - 0.0045, muH + 0.0045, mu);
  if (vis <= 0.0) return vec3(0.0);
  return texture(tT, transUV(r, max(mu, muH))).rgb * vis;
}
float phaseR(float nu) { return 0.0596831 * (1.0 + nu * nu); }
float phaseM(float nu, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + nu * nu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * nu, 1e-4), 1.5));
}
// exit distance from inside a sphere of radius R (centre at origin)
float sphereExit(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R;
  return -b + sqrt(max(b * b - c, 0.0));
}
// first positive hit of a sphere from outside, -1 if none
float sphereHit(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float t = -b - sqrt(disc);
  return t > 0.0 ? t : -1.0;
}
// sky-view LUT mapping: more rows near the horizon
vec2 skyUV(vec3 d) {
  float az = atan(d.x, -d.z);
  float l = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(l) * sqrt(abs(l) / 1.5707963);
  return vec2(az / 6.2831853 + 0.5, v);
}
`;

export const TRANSMITTANCE_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uSize;
${ATMO_COMMON}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (uSize - 1.0);
  float H = sqrt(Rt * Rt - Rg * Rg);
  float rho = H * uv.y;
  float r = sqrt(rho * rho + Rg * Rg);
  float dmin = Rt - r, dmax = rho + H;
  float d = dmin + uv.x * (dmax - dmin);
  float mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  const int N = 48;
  vec3 od = vec3(0.0);
  float dt = d / float(N);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * dt;
    float h = sqrt(r * r + t * t + 2.0 * r * mu * t) - Rg;
    od += extinctionAt(max(h, 0.0)) * dt;
  }
  o = vec4(exp(-od), 1.0);
}`;

// Multiple scattering (Hillaire, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique", 2020): second order with an isotropic phase, gathered over the
// sphere of directions, then summed to infinite order as a geometric series.
export const MULTISCAT_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uSize;
uniform sampler2D tTrans;
${ATMO_COMMON}
const float GROUND_ALBEDO = 0.1;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (uSize - 1.0);
  float muS = uv.x * 2.0 - 1.0;
  float r = Rg + 1.0 + uv.y * (Rt - Rg - 2.0);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 sunD = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  vec3 L2 = vec3(0.0), F = vec3(0.0);
  const int NA = 8, NB = 8, NS = 20;
  for (int a = 0; a < NA; a++)
  for (int b = 0; b < NB; b++) {
    float ct = 1.0 - 2.0 * (float(a) + 0.5) / float(NA);
    float st = sqrt(max(0.0, 1.0 - ct * ct));
    float ph = 6.2831853 * (float(b) + 0.5) / float(NB);
    vec3 d = vec3(st * cos(ph), ct, st * sin(ph));
    float tG = sphereHit(ro, d, Rg);
    float tMax = tG > 0.0 ? tG : sphereExit(ro, d, Rt);
    vec3 T = vec3(1.0), Ls = vec3(0.0), Fs = vec3(0.0);
    float t0 = 0.0;
    for (int i = 0; i < NS; i++) {
      float t1 = tMax * (float(i) + 1.0) / float(NS);
      float dt = t1 - t0;
      vec3 p = ro + d * (0.5 * (t0 + t1));
      t0 = t1;
      float rp = length(p);
      float hp = max(rp - Rg, 0.0);
      vec3 sigS = BR * exp(-hp / HR) + vec3(BM_S * uMie * exp(-hp / HM));
      vec3 ext = max(extinctionAt(hp), vec3(1e-12));
      vec3 Tsun = transmittance(tTrans, rp, dot(p / rp, sunD));
      vec3 Ts = exp(-ext * dt);
      Ls += T * (sigS * Tsun * 0.0795775) * (1.0 - Ts) / ext;
      Fs += T * sigS * (1.0 - Ts) / ext;
      T *= Ts;
    }
    if (tG > 0.0) {
      vec3 pg = ro + d * tG;
      vec3 ug = normalize(pg);
      float c = max(dot(ug, sunD), 0.0);
      Ls += T * transmittance(tTrans, Rg, dot(ug, sunD)) * c * (GROUND_ALBEDO / 3.14159265);
    }
    L2 += Ls;
    F += Fs * 0.0795775;
  }
  float n = float(NA * NB);
  // uniform directions: the integral against the isotropic phase is the mean (times 4pi/4pi)
  L2 /= n;
  F *= 12.5663706 / n;
  o = vec4(L2 / max(1.0 - F, vec3(0.05)), 1.0);
}`;

export const SKYVIEW_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uSize;
uniform float uCamAlt;
uniform vec3 uSunDir, uMoonDir;
uniform vec3 uSunE, uMoonE;     // irradiance at the top of the atmosphere, already exposed
uniform float uMS;              // multiple-scattering strength (1 = physical)
uniform vec3 uAirglow;          // natural night-sky radiance at the zenith, already exposed
uniform sampler2D tTrans;
uniform sampler2D tMS;
${ATMO_COMMON}
vec3 msAt(float r, float mu) {
  vec2 uv = vec2(0.5 + 0.5 * mu, (r - Rg) / (Rt - Rg));
  return texture(tMS, (clamp(uv, 0.0, 1.0) * ${MS_N - 1}.0 + 0.5) / ${MS_N}.0).rgb;
}
vec3 lightScatter(vec3 L, vec3 E, vec3 up, float r, vec3 d, vec3 sigR, float sigM) {
  float mu = dot(up, L);
  vec3 Tl = transmittance(tTrans, r, mu);
  float nu = dot(d, L);
  return E * (Tl * (sigR * phaseR(nu) + sigM * phaseM(nu, 0.8)) + msAt(r, mu) * (sigR + sigM) * uMS);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float az = (uv.x - 0.5) * 6.2831853;
  float c = uv.y < 0.5 ? 1.0 - 2.0 * uv.y : 2.0 * uv.y - 1.0;
  float l = sign(uv.y - 0.5) * c * c * 1.5707963;
  vec3 d = vec3(sin(az) * cos(l), sin(l), -cos(az) * cos(l));
  vec3 ro = vec3(0.0, Rg + uCamAlt, 0.0);
  float tG = sphereHit(ro, d, Rg);
  float tMax = tG > 0.0 ? tG : sphereExit(ro, d, Rt);
  const int N = 40;
  vec3 L = vec3(0.0), T = vec3(1.0);
  float t0 = 0.0;
  for (int i = 0; i < N; i++) {
    float s1 = (float(i) + 1.0) / float(N);
    float t1 = tMax * s1 * s1;
    float dt = t1 - t0;
    vec3 p = ro + d * (0.5 * (t0 + t1));
    t0 = t1;
    float r = length(p);
    float h = max(r - Rg, 0.0);
    vec3 up = p / r;
    vec3 sigR = BR * exp(-h / HR);
    float sigM = BM_S * uMie * exp(-h / HM);
    vec3 ext = max(extinctionAt(h), vec3(1e-12));
    vec3 S = lightScatter(uSunDir, uSunE, up, r, d, sigR, sigM)
           + lightScatter(uMoonDir, uMoonE, up, r, d, sigR, sigM);
    vec3 Ts = exp(-ext * dt);
    L += T * (S - S * Ts) / ext;
    T *= Ts;
  }
  // airglow (~90 km) and integrated starlight: brighter toward the horizon (van Rhijn),
  // dimmed by the air in front of it
  if (tG < 0.0) {
    float k = Rg / (Rg + 90000.0);
    float vr = 1.0 / sqrt(max(1.0 - k * k * (1.0 - d.y * d.y), 0.03));
    L += T * uAirglow * (0.3 + 0.7 * vr);
  }
  o = vec4(L, 1.0);
}`;
