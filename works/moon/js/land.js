// Moon — before dawn, above a valley full of fog, in the manner of an ink landscape. The
// viewer stands at the end of a spur; past its edge the land falls to the valley floor, the
// fog lies in the valley, and ranges rise out of it layer on layer, each paler with distance,
// their feet lost in the fog.
//
// The ranges are silhouettes at fixed distances round the viewer (exact from the sweet spot,
// the same on every wall and continuous across the corners). The fog is dense below its top
// and thins softly above it; along a straight ray its optical depth comes in closed form. A
// thin mist in the air scatters the moonlight into a halo round the moon.

export const LAND_GLSL = `
uniform float uLand;          // 1 = above the misty valley
uniform float uLandEye;       // eye height over the ground (m)
uniform float uMist;          // thin mist in the air (1/m at the ground); it thins with height
uniform float uMistH;         // its scale height (m)
uniform float uRidge;         // height of the ranges
uniform float uRidgeD;        // how far off the nearest range stands (m)
uniform vec2  uCliff;         // x: where the ground ends straight ahead (m), y: how far the land
                              // falls from there to the valley floor (m)
uniform vec4  uVFog;          // fog lying in the valley: x its top over the valley floor (m),
                              // y how softly it thins there (m), z density (1/m), w from how far out (m)

// Henyey-Greenstein, normalised to 1 at g = 0
float hgPhase(float c, float g) { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5); }

// optical depth of the mist from the eye along d to distance t (inf allowed when d.y > 0)
float mistTau(vec3 d, float t) {
  if (uMist <= 0.0) return 0.0;
  float e0 = exp(-uLandEye / uMistH);
  float k = d.y / uMistH;
  if (abs(k) < 1e-5) return uMist * e0 * t;
  float tt = min(t, 1e6);
  return uMist * e0 * (1.0 - exp(-k * tt)) / k;
}

// the edge of the ground the viewer stands on: its distance along azimuth az. Nearest straight
// ahead, curving back toward the sides like the end of a spur; beyond it the land falls away
float edgeR(float az) {
  float c = cos(az);
  if (c < 0.05) return 1e9;
  float n = fbm2(vec2(az * 3.0 + 11.0, 2.5), 3);
  return uCliff.x * (0.8 + 0.5 * n) / c * (1.0 + 2.5 * pow(1.0 - c, 1.5));
}
float softplus(float x) { return x > 15.0 ? x : log(1.0 + exp(x)); }
// the fog in the valley: dense below its top F over the valley floor, thinning over a height
// uVFog.y above it (a logistic profile), from uVFog.w out. Along a straight ray the height
// changes linearly, so the optical depth from t0 to t1 comes in closed form (a softplus).
float vfogTau(vec3 d, float t0, float t1, float F) {
  if (uVFog.z <= 0.0) return 0.0;
  t0 = max(t0, uVFog.w / max(length(d.xz), 1e-4));
  t1 = min(t1, 2e5);
  if (t1 <= t0) return 0.0;
  float h0 = uLandEye + uCliff.y, s = uVFog.y;
  if (abs(d.y) < 1e-5) return uVFog.z * (t1 - t0) / (1.0 + exp((h0 - F) / s));
  float ha = h0 + d.y * t0, hb = h0 + d.y * t1;
  return max(uVFog.z * s * (softplus((F - ha) / s) - softplus((F - hb) / s)) / d.y, 0.0);
}
// the fog's top rises and falls in slow billows that drift: its height at p, and how
// much brighter it is there (the tops catch more of the moon)
float vfogTop(vec3 p, float fp, int oct, out float lift) {
  float b = fbm2l(p.xz / 240.0 + uTime * vec2(0.0035, 0.0012), oct, fp / 240.0);
  lift = b;
  return uVFog.x * (0.75 + 0.6 * b);
}

// the ranges, layer on layer (0 the nearest), rising from the valley floor: the elevation
// (rad) of the crest at azimuth az, its distance D and its height H over the floor. The near
// ranges are lower and broad; the far ones bigger, with more summits to the degree.
float ridgeEl(int k, float az, float angPix, out float D, out float H) {
  float fk = float(k);
  D = uRidgeD * pow(2.15, fk);
  float u = az * D / (700.0 * pow(1.6, fk)) + fk * 17.3;
  u += 0.45 * vnoise2(vec2(u * 0.33, fk * 5.1 + 2.0));              // summits unevenly spaced
  float m = clamp((fbm2(vec2(u * 0.55, fk * 3.7 + 0.5), 5) - 0.2) / 0.55, 0.0, 1.0);
  float r = 1.0 - abs(2.0 * vnoise2(vec2(u * 1.2, fk * 2.3 + 7.0)) - 1.0);
  H = uRidge * 55.0 * pow(2.05, fk) * (0.15 + 0.85 * m + 0.35 * r * r * m);
  // the forest along the nearer crests roughens them a little (gone once finer than a pixel)
  if (k < 2) H += uRidge * 3.0 * vnoise2(vec2(az * D / 7.0, fk * 3.0 + 0.5)) * clamp(1.5 - angPix * D / 7.0 * 2.5, 0.0, 1.0);
  return atan((H - uLandEye - uCliff.y) / D) - D / (2.0 * 6371000.0);
}

// ---------------- the ground, the ranges and the fog along d, in front of the sky
// returns premultiplied colour and coverage; vis = what still shows of the sky behind,
// nearD = the distance of what the pixel shows, occT = what shows past everything that
// stands up into the moonlight (the ranges; not the ground or the fog lying below it), for
// the light shafts
vec4 landShade(vec3 d, float angPix, vec3 moonLight, out float vis, out float nearD, out float occT) {
  vec3 ambUp = textureLod(tSkyView, vec2(0.5, 0.97), 6.0).rgb;
  vec3 ambH = textureLod(tSkyView, vec2(0.5, 0.56), 6.0).rgb;
  vec3 amb = mix(ambH, ambUp, 0.4) * 1.3;
  // mist and fog: sky light and moonlight scattered forward round the moon
  vec3 mistC = ambH * 1.15 + moonLight * (0.05 + 0.12 * hgPhase(dot(d, uMoonDirW), 0.72));
  float hl = max(length(d.xz), 1e-4);
  float az = atan(d.x, -d.z);
  occT = 1.0;

  // the ground the viewer stands on, dark, as far as its edge
  float tg = d.y < -1e-5 ? uLandEye / -d.y : 1e9;
  if (d.y < -1e-5 && tg * hl < edgeR(az)) {
    vec3 gp = d * tg;
    float n = fbm2l(gp.xz * 0.35, 4, angPix * tg * 0.35);
    vec3 alb = mix(vec3(0.03, 0.034, 0.026), vec3(0.05, 0.05, 0.04), n);
    vec3 c = alb * (moonLight * max(uMoonDirW.y, 0.0) + amb);
    float Tm = exp(-mistTau(d, tg));
    vis = 0.0;
    nearD = tg;
    return vec4(c * Tm + mistC * (1.0 - Tm), 1.0);
  }

  // past the edge: the ranges, nearest first, each paler in the haze, their feet lost in the
  // fog; then the fog itself down to the valley floor, or the sky
  vec3 acc = vec3(0.0);
  float T = 1.0;
  nearD = 1e9;
  float lift;
  float el = asin(clamp(d.y, -1.0, 1.0));
  float h0 = uLandEye + uCliff.y;
  float Dv = d.y < -1e-5 ? h0 / -d.y * hl : 1e9;       // where the ray meets the valley floor
  vec3 hazeC = mix(ambH, mistC, 0.4);
  float hazeD = 4200.0 / (1.0 + 400.0 * uMist);
  for (int k = 0; k < 5; k++) {
    float Dk, Hk;
    float e = ridgeEl(k, az, angPix, Dk, Hk);
    if (Dk > Dv) break;
    float a = clamp((e - el) / angPix + 0.5, 0.0, 1.0);
    if (a <= 0.0) continue;
    float tk = Dk / hl;
    vec3 c = vec3(0.012, 0.016, 0.016) * (amb + moonLight * 0.15);
    c = mix(c, hazeC, 1.0 - exp(-Dk / hazeD));
    // the fog's top along the foot of the range: it varies only along the range, so keep it
    // to broad swells (a fixed number to the degree, near or far), or the faces stripe
    lift = fbm2(vec2(az * 5.0 + uTime * 0.004, float(k) * 3.1 + 1.7), 3);
    float F = uVFog.x * (0.75 + 0.6 * lift);
    float Tm = exp(-mistTau(d, tk) - vfogTau(d, 0.0, tk, F));
    acc += T * a * (c * Tm + mistC * (0.85 + 0.3 * lift) * (1.0 - Tm));
    if (nearD > 1e8 && a > 0.5) nearD = tk;
    T *= 1.0 - a;
    occT *= 1.0 - a;
    if (T < 0.01) break;
  }
  float t1 = Dv < 1e8 ? Dv / hl : 1e6;
  float tc = d.y < -1e-5 ? max(h0 - uVFog.x, 0.0) / -d.y : t1;   // where it reaches the fog's top
  float F = vfogTop(d * min(tc, t1), angPix * min(tc, t1) / max(abs(d.y), 0.02), 4, lift);
  float Tm = exp(-mistTau(d, t1) - vfogTau(d, 0.0, t1, F));
  acc += T * mistC * (0.85 + 0.3 * lift) * (1.0 - Tm);
  if (Dv < 1e8) {
    // the valley floor, dark, under it all
    acc += T * Tm * vec3(0.02, 0.024, 0.02) * (amb + moonLight * 0.1);
    if (nearD > 1e8) nearD = min(tc, t1);
    T = 0.0;
    vis = 0.0;
  } else vis = T * Tm;
  return vec4(acc, 1.0 - T);
}
`;
