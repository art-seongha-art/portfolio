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

export const SEA_GLSL = `
uniform float uSea;          // 1 = by the sea
uniform float uSeaH;         // eye height over the water (m)
uniform float uSeaGain;      // brightness of the moon's path (1 = a mirror image of the disc as shown)
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
  vec3 col = sky * Fv + glint;
  // the air between: extinction, and the haze it lights
  vec3 Ta = exp(-extinctionAt(0.0) * t);
  vec3 skyH = texture(tSkyView, skyUV(normalize(vec3(d.x, 0.002, d.z)))).rgb;
  return vec4(col * Ta + skyH * (1.0 - Ta), cov);
}
`;
