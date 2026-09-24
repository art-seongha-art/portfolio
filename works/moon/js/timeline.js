// Moon — choreography.
// Every parameter is a keyframe track interpolated with a monotone cubic
// (PCHIP): no overshoot, zero velocity at held keys, so nothing ever lurches.
// Camera distance is keyed as log(altitude) so a zoom reads as a constant rate
// of expansion instead of speeding up as the surface approaches.

export const LOOP = 750; // seconds (12:30)

export const SCENES = [
  { id: 'prelude', t: 0,   ko: '밤',                  en: 'Night' },
  { id: 'rise',    t: 30,  ko: '월출',                en: 'Moonrise' },
  { id: 'fill',    t: 170, ko: '접근',                en: 'Approach' },
  { id: 'gaze',    t: 320, ko: '클로즈업 · 코페르니쿠스', en: 'Close-up · Copernicus' },
  { id: 'dwell',   t: 446, ko: '남극 · 지구돋이',       en: 'South Pole · Earthrise' },
  { id: 'set',     t: 606, ko: '월몰',                en: 'Moonset' },
  { id: 'coda',    t: 720, ko: '밤',                  en: 'Night' },
];

const RM_KM = 1737.4;
// helpers to key the moon's size either by apparent diameter or altitude
const ang = (deg) => Math.log(1 / Math.sin((deg * Math.PI) / 360) - 1);
const km = (alt) => Math.log(alt / RM_KM);

const TRACKS = {
  // hour angle of the moon (deg): drives the diurnal arc and the stars
  H: [[0, -90], [30, -86], [170, -57], [180, -57], [600, 57], [612, 57], [705, 86], [750, 90]],
  logAlt: [
    [0, ang(15.5)], [30, ang(16)], [170, ang(18)], [232, ang(36)], [292, ang(110)],
    [320, km(235)], [430, km(150)], [436, km(150)], [446, km(5.5)], [452, km(5.5)],
    [590, km(46)], [596, km(46)], [606, ang(15)], [750, ang(15.5)],
  ],
  // sub-viewer point on the moon (deg)
  faceLat: [[0, -4], [170, -4], [236, 10], [320, 10], [430, 10.2], [436, 10.2], [446, -87.4], [596, -87.4], [606, -4], [750, -4]],
  faceLon: [[0, 5], [170, 5], [236, -16.5], [320, -17.5], [430, -19.8], [436, -19.8], [446, 180], [596, 180], [606, 5], [750, 5]],
  roll: [[0, 0], [436, 0], [446, 180], [596, 180], [606, 0], [750, 0]],
  // where the moon is steered when it leaves the sky (deg)
  tgtAz: [[0, 0], [750, 0]],
  tgtEl: [[0, 2], [236, 2], [292, 0], [436, 0], [446, -90], [596, -90], [606, 2], [750, 2]],
  pathMix: [[0, 0], [170, 0], [236, 1], [600, 1], [606, 0], [750, 0]],
  // sub-solar point (deg): waxing gibbous. The morning terminator sits at sunLon-90 and moves
  // west as sunLon falls, so in III the dawn slowly fills Copernicus (lon -20.1)
  sunLat: [[0, 0.5], [436, 0.5], [446, -0.9], [590, -1.4], [596, -1.4], [606, 0.5], [750, 0.5]],
  sunLon: [[0, 72.5], [236, 72.5], [320, 71.0], [430, 64.5], [436, 64.5], [446, 137], [590, 141], [596, 141], [606, 72.5], [750, 72.5]],
  // where the Earth is, seen from the moon (sub-Earth point, deg)
  earthLat: [[0, -4], [436, -4], [446, 0], [596, 0], [606, -4], [750, -4]],
  earthLon: [[0, 5], [436, 5], [446, 0], [596, 0], [606, 5], [750, 5]],

  atmo: [[0, 1], [192, 1], [262, 0], [600, 0], [606, 1], [750, 1]],
  land: [[0, 1], [186, 1], [252, 0], [600, 0], [606, 1], [750, 1]],
  landSink: [[0, 0], [182, 0], [252, 26], [600, 26], [606, 0], [750, 0]],
  clouds: [[0, 0.16], [60, 0.12], [120, 0.08], [170, 0.1], [215, 0], [600, 0], [606, 0.12], [690, 0.34], [750, 0.16]],
  haze: [[0, 0.85], [45, 0.85], [150, 0.22], [215, 0], [600, 0], [606, 0.3], [690, 0.8], [750, 0.85]],
  ext: [[0, 1.8], [90, 1.6], [170, 1.2], [606, 1.2], [680, 1.7], [712, 1.9], [750, 1.8]],
  shimmer: [[0, 0.7], [45, 0.7], [130, 0.15], [200, 0], [600, 0], [606, 0.1], [700, 0.6], [750, 0.7]],
  refr: [[0, 0.9], [200, 0.9], [262, 0], [600, 0], [606, 0.9], [750, 0.9]],
  preGlow: [[0, 0.4], [40, 1], [80, 0], [640, 0], [715, 1], [750, 0.4]],
  glow: [[0, 1], [200, 1], [262, 0.1], [600, 0.1], [606, 1], [750, 1]],
  stars: [[0, 1], [110, 0.45], [195, 0], [600, 0], [606, 0.35], [700, 1], [750, 1]],

  // optics
  blur: [[0, 22], [34, 22], [85, 0], [426, 0], [438, 26], [452, 26], [482, 0], [586, 0], [598, 24], [612, 24], [640, 0], [704, 0], [738, 20], [750, 22]],
  limbSoft: [[0, 0.25], [50, 0.25], [115, 0], [690, 0], [735, 0.2], [750, 0.25]],
  lodBias: [[0, 2.5], [40, 2.5], [110, 0], [690, 0], [735, 2.0], [750, 2.5]],
  fade: [[0, 0], [16, 1], [428, 1], [440, 0], [452, 0], [472, 1], [587, 1], [600, 0], [612, 0], [630, 1], [736, 1], [750, 0]],
  ev: [[0, 1.9], [100, 1.1], [170, 0.35], [240, 0.5], [300, 1.3], [330, 1.9], [430, 2.0], [436, 2.0], [452, -0.3], [520, 0.0], [590, 0.0], [606, 0.6], [720, 1.8], [750, 1.9]],
  vig: [[0, 0.55], [750, 0.55]],
  bloom: [[0, 0.55], [200, 0.55], [262, 0.2], [436, 0.2], [446, 0.1], [596, 0.1], [606, 0.55], [750, 0.55]],
  halation: [[0, 0.6], [200, 0.6], [262, 0.2], [436, 0.2], [446, 0.0], [596, 0.0], [606, 0.6], [750, 0.6]],

  // space
  earthVis: [[0, 0], [444, 0], [448, 1], [592, 1], [598, 0], [750, 0]],
  sunVis: [[0, 0], [444, 0], [448, 1], [592, 1], [598, 0], [750, 0]],
  relief: [[0, 0], [255, 0], [292, 1], [596, 1], [604, 0], [750, 0]],
  earthshine: [[0, 0.006], [180, 0.006], [260, 0.009], [436, 0.009], [446, 0.05], [596, 0.05], [606, 0.006], [750, 0.006]],
};

// discrete: which high-resolution terrain patch is active
export function patchAt(t) {
  if (t >= 440 && t < 600) return 'southpole';
  if (t >= 150 && t < 440) return 'copernicus';
  return 'none';
}

function pchip(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  if (n === 1) return () => ys[0];
  const h = [], del = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    del.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const hh = h[i], s = (x - xs[i]) / hh;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * hh * m[i]
      + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * hh * m[i + 1];
  };
}

const CURVES = Object.fromEntries(Object.entries(TRACKS).map(([k, v]) => [k, pchip(v)]));

export function stateAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  const S = { t };
  for (const k in CURVES) S[k] = CURVES[k](t);
  S.patch = patchAt(t);
  return S;
}

export function sceneAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  let cur = SCENES[0];
  for (const s of SCENES) if (t >= s.t) cur = s;
  return cur;
}
