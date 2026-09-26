// Moon — before dawn, the ranges of Jirisan over valleys full of fog, as in an ink landscape.
// The viewer stands on the spur below Samsinbong with the main ridge (Banyabong to
// Cheonwangbong) across the view; ridge after ridge rises out of the fog, paler with distance.
//
// The skylines are real: tools/build_ridges.py finds, round the horizon, the highest point of
// the terrain in each band of distance (assets/mist_ridges.bin, rows 0-5 of the data texture:
// its elevation angle and distance). Each band is drawn as a silhouette at that distance,
// nearest first: exact from the sweet spot, the same on every wall, continuous across the
// corners. The valley fog is dense below its top and thins softly above it; along a straight
// ray its optical depth comes in closed form. A thin haze over the fog scatters the moonlight
// into a halo round the moon.

export const LAND_GLSL = `
uniform float uLand;          // 1 = above the misty valleys before dawn
uniform vec4  uRidge;         // the ranges: x the eye's height above sea level (m), y the azimuth of the
                              // room's front from north (rad), z azimuths round the horizon, w bands
uniform float uMist;          // thin haze over the fog (1/m at its top); it thins with height
uniform float uMistH;         // its scale height (m)
uniform vec4  uVFog;          // the valley fog: x its top (m above sea level), y how softly it thins
                              // there (m), z density (1/m), w from how far out (m)

// Henyey-Greenstein, normalised to 1 at g = 0
float hgPhase(float c, float g) { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5); }

// optical depth of the haze from the eye along d to distance t (inf allowed when d.y > 0)
float mistTau(vec3 d, float t) {
  if (uMist <= 0.0) return 0.0;
  float e0 = exp(-max(uRidge.x - uVFog.x, 0.0) / uMistH);
  float k = d.y / uMistH;
  if (abs(k) < 1e-5) return uMist * e0 * t;
  float tt = min(t, 1e6);
  return uMist * e0 * (1.0 - exp(-k * tt)) / k;
}
float softplus(float x) { return x > 15.0 ? x : log(1.0 + exp(x)); }
// the fog in the valleys: dense below its top F, thinning over a height uVFog.y above it (a
// logistic profile), from uVFog.w out. Along a straight ray the height changes linearly, so
// the optical depth from t0 to t1 comes in closed form (a softplus). (The Earth's curve is left
// out here: over the few kilometres where a ray is near the fog it is a few metres.)
float vfogTau(vec3 d, float t0, float t1, float F) {
  if (uVFog.z <= 0.0) return 0.0;
  t0 = max(t0, uVFog.w / max(length(d.xz), 1e-4));
  t1 = min(t1, 2e5);
  if (t1 <= t0) return 0.0;
  float h0 = uRidge.x, s = uVFog.y;
  if (abs(d.y) < 1e-5) return uVFog.z * (t1 - t0) / (1.0 + exp((h0 - F) / s));
  float ha = h0 + d.y * t0, hb = h0 + d.y * t1;
  return max(uVFog.z * s * (softplus((F - ha) / s) - softplus((F - hb) / s)) / d.y, 0.0);
}
// value noise with a quintic fade and a lattice turned off the room's axes: no creases
// along the lattice lines (below a range the fog is read at the foot of its crest, the same
// point all the way down a column, so a crease there showed as a thin upright streak)
float vnoise2q(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = h12(i), b = h12(i + vec2(1, 0)), c = h12(i + vec2(0, 1)), d = h12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fogNoise(vec2 p, float fw) {
  float s = 0.0, a = 0.5, f = 1.0;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  p = mat2(0.93, 0.37, -0.37, 0.93) * p;
  for (int i = 0; i < 3; i++) {
    s += a * mix(0.5, vnoise2q(p), clamp(1.6 - fw * f * 2.2, 0.0, 1.0));
    p = r * p * 2.03 + 11.7;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
// the fog's top rises and falls in slow billows that drift: its height at p (m above sea
// level), and how much brighter it is there (the tops catch more of the moon)
float vfogTop(vec3 p, float fp, out float lift) {
  float b = fogNoise(p.xz / 380.0 + uTime * vec2(0.0024, 0.0009), fp / 380.0);
  lift = b;
  return uVFog.x + 110.0 * (b - 0.5);
}

// band k of the ranges at u (0..1 round the horizon from north): the crest's elevation angle
// (rad) and its distance (m), between the stored azimuths
vec2 ridgeAt(int k, float u) {
  int n = int(uRidge.z);
  float x = u * uRidge.z - 0.5;
  float fx = floor(x);
  int i0 = (int(fx) + n) % n, i1 = (int(fx) + 1) % n;
  return mix(texelFetch(tData, ivec2(i0, k), 0).rg, texelFetch(tData, ivec2(i1, k), 0).rg, x - fx);
}
// the forest along a crest, seen against the sky: rounded crowns (x in crown widths), 0..1
float treeline(float x) {
  float i = floor(x), h = 0.0;
  for (int j = -1; j <= 1; j++) {
    float c = i + float(j);
    float r = h12(vec2(c, 7.7));
    float q = (x - (c + 0.5 + (r - 0.5) * 0.6)) / (0.55 + 0.35 * h12(vec2(c, 3.1)));
    h = max(h, (0.55 + 0.45 * r) * sqrt(max(1.0 - q * q, 0.0)));
  }
  return h;
}

// ---------------- the ranges and the fog along d, in front of the sky
// returns premultiplied colour and coverage; vis = what still shows of the sky behind,
// nearD = the distance of what the pixel shows, occT = what shows past everything that
// stands up into the moonlight (the ranges; not the fog lying below them), for the light shafts
vec4 landShade(vec3 d, float angPix, vec3 moonLight, out float vis, out float nearD, out float occT) {
  vec3 ambUp = textureLod(tSkyView, vec2(0.5, 0.97), 6.0).rgb;
  vec3 ambH = textureLod(tSkyView, vec2(0.5, 0.56), 6.0).rgb;
  vec3 amb = mix(ambH, ambUp, 0.4) * 1.3;
  // haze and fog: sky light and moonlight scattered forward round the moon
  vec3 mistC = ambH * 1.15 + moonLight * (0.04 + 0.06 * hgPhase(dot(d, uMoonDirW), 0.72));
  vec3 hazeC = mix(ambH, mistC, 0.4);
  float hazeD = 5000.0 / (1.0 + 400.0 * uMist);
  float hl = max(length(d.xz), 1e-4);
  float az = atan(d.x, -d.z);
  float u = fract((az + uRidge.y) / 6.2831853 + 1.0);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float h0 = uRidge.x;
  // where the ray would come down to the fog's top
  float tc = d.y < -1e-5 ? max(h0 - uVFog.x, 0.0) / -d.y : 1e9;
  vec3 acc = vec3(0.0);
  float T = 1.0, lift;
  nearD = 1e9;
  occT = 1.0;
  int nb = int(uRidge.w);
  for (int k = 0; k < 8; k++) {
    if (k >= nb) break;
    vec2 R = ridgeAt(k, u);
    if (k == 0) {
      // grass and low scrub along the brow of the ground close by: a fine, uneven edge
      float x = az * R.y;
      R.x += (0.45 * fbm2l(vec2(x / 0.9, 3.1), 4, angPix * R.y / 0.9) - 0.1) / R.y;
    } else if (k <= 2) {
      // the forest along the crest: crowns some 7 m across, gone once smaller than a pixel
      float w = clamp(4.0 - R.y * angPix * 0.8, 0.0, 1.0);
      if (w > 0.0) R.x += w * treeline(az * R.y / 7.0 + float(k) * 37.0) * 9.0 / R.y;
    }
    float a = clamp((R.x - el) / angPix + 0.5, 0.0, 1.0);
    if (a <= 0.0) continue;
    float tk = R.y / hl;
    // forested slopes, dark against the moon; paler with distance
    vec3 c = vec3(0.012, 0.016, 0.016) * (amb + moonLight * 0.15);
    c = mix(c, hazeC, 1.0 - exp(-R.y / hazeD));
    // the fog's top where the ray comes down to it, or at the slope if it never does
    float ts = min(tc, tk);
    float F = vfogTop(d * ts, angPix * ts / max(abs(d.y), 0.05), lift);
    float Tm = exp(-mistTau(d, tk) - vfogTau(d, 0.0, tk, F));
    acc += T * a * (c * Tm + mistC * (0.85 + 0.3 * lift) * (1.0 - Tm));
    if (nearD > 1e8 && a > 0.5) nearD = tk;
    T *= 1.0 - a;
    occT *= 1.0 - a;
    if (T < 0.01) break;
  }
  if (T <= 0.0) { vis = 0.0; return vec4(acc, 1.0); }
  // past every range: the fog below (down to the sea), or the sky
  float t1 = d.y < -1e-5 ? h0 / -d.y : 1e6;
  float F = vfogTop(d * min(tc, t1), angPix * min(tc, t1) / max(abs(d.y), 0.05), lift);
  float Tm = exp(-mistTau(d, t1) - vfogTau(d, 0.0, t1, F));
  acc += T * mistC * (0.85 + 0.3 * lift) * (1.0 - Tm);
  if (d.y < -1e-5) {
    acc += T * Tm * vec3(0.012, 0.016, 0.016) * amb;
    if (nearD > 1e8) nearD = min(tc, t1);
    vis = 0.0;
    return vec4(acc, 1.0);
  }
  vis = T * Tm;
  return vec4(acc, 1.0 - T);
}
`;
