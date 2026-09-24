// Moon — real terrain of Jirisan seen from Cheonwangbong (SRTM-class DEM via Terrain Tiles).
// The viewer stands still on the summit, so the expensive part (marching rays
// over 250 km of mountains, with tree crowns on the near ridges) is done once
// into a per-wall cache: normal, distance, coverage and material. Every frame
// only re-lights that cache with the moving moon, sun and sky.

export const TERRAIN_COMMON = `
uniform sampler2D tTerNear;
uniform sampler2D tTerFar;
uniform vec4  uNearB;         // east min, east max, north min, north max (m)
uniform vec4  uFarB;
uniform vec2  uTerTex;        // texels across near, far
uniform vec2  uCamEN;         // viewer position in the DEM frame (east, north metres)
const float REFF = 7310000.0; // Earth radius stretched for standard refraction (k = 0.13)

float demH(vec2 en, float fp) {
  vec2 uvF = vec2((en.x - uFarB.x) / (uFarB.y - uFarB.x), (uFarB.w - en.y) / (uFarB.w - uFarB.z));
  float texF = (uFarB.y - uFarB.x) / uTerTex.y;
  float h = textureLod(tTerFar, uvF, log2(max(fp / texF, 1.0))).r;
  vec2 ef = min(uvF, 1.0 - uvF);
  h *= smoothstep(0.0, 0.04, min(ef.x, ef.y));
  vec2 uvN = vec2((en.x - uNearB.x) / (uNearB.y - uNearB.x), (uNearB.w - en.y) / (uNearB.w - uNearB.z));
  vec2 e = min(uvN, 1.0 - uvN);
  float w = smoothstep(0.0, 0.06, min(e.x, e.y));
  if (w > 0.0) {
    float texN = (uNearB.y - uNearB.x) / uTerTex.x;
    h = mix(h, textureLod(tTerNear, uvN, log2(max(fp / texN, 1.0))).r, w);
  }
  return h;
}

uint thash(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1013904223u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1013904223u;
  return v.x ^ (v.y >> 11u);
}
vec3 thash3(ivec2 c) {
  uint h = thash(uvec2(c));
  return vec3(float(h & 1023u), float((h >> 10u) & 1023u), float((h >> 20u) & 1023u)) / 1023.0;
}
// where trees grow: below a ragged tree line (smoothly varying), not on the sea,
// and not on the alpine meadow around the viewer on Nogodan's summit
float vn2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = thash3(ivec2(i)).x, b = thash3(ivec2(i) + ivec2(1, 0)).x;
  float c = thash3(ivec2(i) + ivec2(0, 1)).x, d = thash3(ivec2(i) + ivec2(1, 1)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float forestMask(vec2 en, float h) {
  // Jirisan is wooded almost to the top (Korean fir, oak): only the highest knolls
  // and the rocky summit round the viewer are open
  float n = vn2(en / 420.0) * 0.65 + vn2(en / 130.0 + 17.0) * 0.35;
  float line = 1720.0 + 220.0 * n;
  float meadow = smoothstep(260.0, 620.0, length(en - uCamEN) + 160.0 * vn2(en / 90.0));
  return smoothstep(line, line - 90.0, h) * smoothstep(2.0, 8.0, h) * meadow;
}
// crown surface of a conifer/broadleaf forest, ~7 m cells
float canopy(vec2 en, float h, float fp) {
  float fm = forestMask(en, h);
  if (fm <= 0.0) return 0.0;
  float avg = 11.0 * fm;
  float w = smoothstep(4.5, 1.8, fp);
  if (w <= 0.0) return avg;
  const float C = 6.5;
  vec2 q = en / C;
  ivec2 b = ivec2(floor(q));
  float top = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = b + ivec2(i, j);
    vec3 r = thash3(c);
    vec2 ctr = vec2(c) + 0.2 + 0.6 * r.xy;
    float dd = length(q - ctr) * C;
    float rad = 2.4 + 2.4 * r.z;
    float hh = 8.0 + 11.0 * r.x;
    // conical crown with a rounded tip
    float prof = hh * (1.0 - smoothstep(0.0, rad, dd) * (0.7 + 0.3 * r.y));
    top = max(top, prof);
  }
  return mix(avg, top * fm, w);
}
// the rocky summit round the viewer: outcrops, boulders and tussocks, only where they
// are resolved (near field) and only above the trees
float rocks(vec2 en, float h, float fp) {
  float dist = length(en - uCamEN);
  float w = smoothstep(460.0, 160.0, dist) * smoothstep(2.5, 0.7, fp) * smoothstep(1500.0, 1650.0, h);
  if (w <= 0.0) return 0.0;
  float o = 1.0 - abs(vn2(en / 23.0 + 5.3) * 2.0 - 1.0);
  o = o * o * o * 3.2 + (vn2(en / 9.0 + 1.7) - 0.5) * 1.2;
  const float C = 7.0;
  vec2 q = en / C;
  ivec2 b = ivec2(floor(q));
  float bo = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 c = b + ivec2(i, j) + ivec2(4096);
    vec3 r = thash3(c);
    if (r.z < 0.8) continue;
    vec2 ctr = vec2(b + ivec2(i, j)) + 0.2 + 0.6 * r.xy;
    vec2 dv = (q - ctr) * C;
    // irregular, half-buried blocks rather than domes
    float a = atan(dv.y, dv.x);
    float rad = (1.2 + 2.2 * r.x) * (0.78 + 0.22 * sin(a * 3.0 + r.y * 6.28) + 0.1 * sin(a * 5.0 + r.z * 9.0));
    float hh = (1.2 + 2.2 * r.x) * (0.25 + 0.3 * r.y);
    float e = clamp(1.0 - dot(dv, dv) / (rad * rad), 0.0, 1.0);
    bo = max(bo, hh * min(sqrt(e) * 1.6, 1.0));
  }
  float g = (vn2(en / 1.6) - 0.5) * 0.3;
  return w * (max(o, 0.0) + bo + g);
}
float terrainH(vec2 en, float fp) {
  float h = demH(en, fp);
  return h + canopy(en, h, fp) + rocks(en, h, fp);
}
// soft horizon test across the DEM toward a light (moon or low sun); L in world frame
float terrainShadowE(vec2 en, float alt, vec3 L, float fp0) {
  vec2 hd = normalize(vec2(-L.x, L.z) + vec2(1e-6));
  float tanE = L.y / max(length(L.xz), 1e-4);
  if (tanE > 1.2) return 1.0;
  float occ = -1.0;
  float s = max(fp0 * 2.0, 30.0);
  for (int i = 0; i < 18; i++) {
    vec2 q = en + hd * s;
    float hq = demH(q, s * 0.06);
    float rayH = alt + s * tanE - s * s / (2.0 * REFF);
    occ = max(occ, (hq - rayH) / s);
    s *= 1.42;
    if (s > 70000.0) break;
  }
  return smoothstep(0.010, -0.010, occ);
}
`;

export function terrainCacheFS() {
  return `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
uniform vec4  uView;          // this wall's rect in the cache
uniform vec3  uPA, uDU, uDV;
uniform float uCamAlt;        // metres above sea level
uniform vec2  uBand;          // rows [y0, y1) rendered this frame
${TERRAIN_COMMON}

// march one ray; returns distance (m) or -1
float march(vec3 d, float angPix, out vec2 enHit) {
  vec3 C = vec3(0.0, -(REFF + uCamAlt), 0.0);
  float t = 0.4, tPrev = 0.4;
  enHit = vec2(0.0);
  for (int i = 0; i < 420; i++) {
    vec3 p = d * t;
    float alt = length(p - C) - REFF;
    vec2 en = uCamEN + vec2(-p.x, p.z);
    float fp = max(t * angPix, 0.05);
    float dz = alt - terrainH(en, fp);
    if (dz < 0.0) {
      float a = tPrev, b = t;
      for (int k = 0; k < 8; k++) {
        float m = 0.5 * (a + b);
        vec3 pm = d * m;
        float am = length(pm - C) - REFF;
        vec2 em = uCamEN + vec2(-pm.x, pm.z);
        if (am - terrainH(em, max(m * angPix, 0.05)) < 0.0) b = m; else a = m;
      }
      vec3 ph = d * b;
      enHit = uCamEN + vec2(-ph.x, ph.z);
      return b;
    }
    if (alt > 2300.0 && d.y > 0.0) return -1.0;
    tPrev = t;
    t += max(dz * 0.5, t * 0.0022 + 0.25);
    if (t > 260000.0) return -1.0;
  }
  return -1.0;
}

void main() {
  vec2 pix = gl_FragCoord.xy - uView.xy;
  if (pix.y < uBand.x || pix.y >= uBand.y) discard;
  vec3 dC = normalize(uPA + (pix.x / uView.z) * uDU + (pix.y / uView.w) * uDV);
  vec3 dX = normalize(uPA + ((pix.x + 1.0) / uView.z) * uDU + (pix.y / uView.w) * uDV);
  float angPix = length(dX - dC);
  float hits = 0.0, tSum = 0.0;
  vec3 nSum = vec3(0.0);
  float forest = 0.0, rock = 0.0, water = 0.0;
  for (int s = 0; s < 4; s++) {
    vec2 o = vec2(float(s & 1), float(s >> 1)) * 0.5 - 0.25;
    vec2 f = (pix + o) / uView.zw;
    vec3 d = normalize(uPA + f.x * uDU + f.y * uDV);
    vec2 en;
    float t = march(d, angPix, en);
    if (t > 0.0) {
      hits += 1.0;
      tSum += t;
      float fp = max(t * angPix, 0.05);
      float dl = t < 600.0 ? max(fp, 0.3) : max(fp, 3.0);
      float h0 = demH(en, fp);
      float hx = terrainH(en + vec2(dl, 0.0), fp) - terrainH(en - vec2(dl, 0.0), fp);
      float hy = terrainH(en + vec2(0.0, dl), fp) - terrainH(en - vec2(0.0, dl), fp);
      nSum += normalize(vec3(hx / (2.0 * dl), 1.0, -hy / (2.0 * dl)));
      float fm = forestMask(en, h0);
      forest += fm;
      float slope = length(vec2(hx, hy)) / (2.0 * dl);
      float rh = rocks(en, h0, fp);
      rock += (1.0 - fm) * max(smoothstep(0.35, 0.9, slope), smoothstep(0.25, 0.9, rh));
      water += step(h0, 1.0);
    }
  }
  if (hits == 0.0) { oA = vec4(0.0, 1.0, 0.0, -1.0); oB = vec4(0.0); return; }
  oA = vec4(normalize(nSum), tSum / hits);
  oB = vec4(hits * 0.25, forest / hits, rock / hits, water / hits);
}`;
}
