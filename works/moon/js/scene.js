// Moon — turns a timeline state into shader uniforms (all the geometry lives here).

const D2R = Math.PI / 180;
export const SITE_LAT = 37.57 * D2R; // Seoul; the front wall faces south
export const MOON_RA = 214 * D2R;    // in Virgo/Libra, Spica and Antares on either side
export const MOON_DEC = -15 * D2R;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
export { add, sub, mul, dot, cross, norm };

export function sph(latDeg, lonDeg) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}
export function dirAzEl(azDeg, elDeg) {
  const az = azDeg * D2R, el = elDeg * D2R;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
// equatorial (hour angle, dec) -> world (x = west/right, y = up, z = north/back)
export function hadecToWorld(H, dec, lat) {
  return [
    Math.cos(dec) * Math.sin(H),
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(H) * Math.cos(lat),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(H) * Math.sin(lat),
  ];
}
export function parallactic(H, dec, lat) {
  return Math.atan2(Math.sin(H), Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(H));
}
function slerp(a, b, t) {
  const c = Math.min(1, Math.max(-1, dot(a, b)));
  const w = Math.acos(c);
  if (w < 1e-5) return norm(add(mul(a, 1 - t), mul(b, t)));
  const s = Math.sin(w);
  return norm(add(mul(a, Math.sin((1 - t) * w) / s), mul(b, Math.sin(t * w) / s)));
}

// Rotation (column-major mat3) taking world vectors into a body frame so that
// world direction `wf` maps to body point `fb` and the rolled world `up` maps to
// the local north tangent at `fb`.
function bodyMatrix(dirToBody, rollRad, fb) {
  const wf = mul(dirToBody, -1);
  const el = Math.asin(Math.max(-1, Math.min(1, dirToBody[1])));
  const az = Math.atan2(dirToBody[0], -dirToBody[2]);
  const up0 = [-Math.sin(el) * Math.sin(az), Math.cos(el), Math.sin(el) * Math.cos(az)];
  const up = norm(add(mul(up0, Math.cos(rollRad)), mul(cross(wf, up0), Math.sin(rollRad))));
  const right = cross(up, wf);
  let nb = sub([0, 1, 0], mul(fb, fb[1]));
  if (len(nb) < 1e-6) nb = sub([0, 0, -1], mul(fb, fb[2]));
  nb = norm(nb);
  const eb = cross(nb, fb);
  // M = fb*wf^T + nb*up^T + eb*right^T ; stored column-major: m[c*3+r]
  const m = new Float32Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      m[c * 3 + r] = fb[r] * wf[c] + nb[r] * up[c] + eb[r] * right[c];
    }
  }
  return m;
}
// body -> world for a vector (transpose multiply)
function toWorld(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function airmass(hdeg) {
  hdeg = Math.max(hdeg, -0.6);
  return 1 / (Math.sin(hdeg * D2R) + 0.50572 * Math.pow(hdeg + 6.07995, -1.6364));
}

export function deriveUniforms(S) {
  const Hr = S.H * D2R;
  const skyDir = hadecToWorld(Hr, MOON_DEC, SITE_LAT);
  const tgt = dirAzEl(S.tgtAz, S.tgtEl);
  const dir = slerp(skyDir, tgt, S.pathMix);
  const q = parallactic(Hr, MOON_DEC, SITE_LAT);
  const roll = S.roll * D2R + (1 - S.pathMix) * (-q + 6 * D2R);
  const D = 1 + Math.exp(S.logAlt);
  const fb = sph(S.faceLat, S.faceLon);
  const M = bodyMatrix(dir, roll, fb);
  const sunB = sph(S.sunLat, S.sunLon);
  const earthB = sph(S.earthLat, S.earthLon);
  const angR = Math.asin(1 / D);

  // average brightness of the visible disc (drives sky glow and aureole)
  const cosA = dot(sunB, fb);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const litFrac = (1 + cosA) / 2;
  const lum = 0.42 * litFrac * Math.exp(-0.55 * alpha) * Math.min(1, (angR / (8 * D2R)) ** 0.5 * 1.2);

  // colour of moonlight after the atmosphere, seen at the moon's centre
  const elC = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / D2R;
  const X = airmass(elC * 1.8);
  const k = [0.075, 0.135, 0.27];
  const tint = k.map((kk) => Math.exp(-kk * S.ext * X));
  const tintMax = Math.max(...tint, 1e-4);
  const atmoLum = lum * tintMax;
  const tintN = tint.map((v) => v / tintMax);
  const moonLum = atmoLum * S.atmo + lum * (1 - S.atmo);
  const moonTint = tintN.map((v) => v * S.atmo + (1 - S.atmo));

  // Earth globe orientation: East Asia turned toward the moon, axis tilted
  const earthDirW = toWorld(M, earthB);
  const sunW = toWorld(M, sunB);
  const earthRot = bodyMatrix(earthDirW, 22 * D2R, sph(12, 126));

  const U = {
    uM: M,
    uCamB: mul(fb, D),
    uSunB: sunB,
    uEarthB: earthB,
    uEarthshine: S.earthshine,
    uRelief: S.relief,
    uLimbSoft: S.limbSoft * D2R,
    uLodBias: S.lodBias,
    uMoonDirW: dir,
    uMoonAngR: angR,
    uMoonLum: moonLum,
    uMoonTint: moonTint,
    uAtmo: S.atmo,
    uExt: S.ext,
    uHaze: S.haze,
    uGlow: S.glow,
    uClouds: S.clouds,
    uLand: S.land,
    uLandSink: S.landSink * D2R,
    uRefr: S.refr,
    uShimmer: S.shimmer,
    uStars: S.stars,
    uPreGlow: S.preGlow,
    uEarthVis: S.earthVis,
    uEarthDirW: earthDirW,
    uEarthRot: earthRot,
    uSunW: sunW,
    uSunVis: S.sunVis,
    exposure: Math.pow(2, S.ev) * S.fade,
    fade: 1,
    blur: S.blur,
    bloom: S.bloom,
    halation: S.halation,
    vig: S.vig,
    lst: Hr + MOON_RA,
    dist: D,
  };
  return U;
}
