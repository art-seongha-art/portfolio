// Moon — choreography.
// Every parameter is a keyframe track interpolated with a monotone cubic
// (PCHIP): no overshoot, zero velocity at held keys, so nothing ever lurches.
// Camera distance to the moon is keyed as log(altitude) so a zoom reads as a
// constant rate of expansion instead of speeding up as the surface approaches.
//
// Story: one night on Cheonwangbong, the summit of Jirisan. A full moon rises at dusk in the east,
// is eclipsed, the valley fog climbs over the viewer and the camera rises out of
// the clouds into space, down to Copernicus at lunar dawn, to the lunar south pole
// where the Earth rises, and back to Nogodan at dawn as the moon sets in the west.

export const LOOP = 945; // seconds (15:45)

export const SCENES = [
  { id: 'dusk',   t: 0,   ko: '황혼 · 월출',            en: 'Dusk · Moonrise' },
  { id: 'night',  t: 175, ko: '밤 · 개기월식',          en: 'Night · Total lunar eclipse' },
  { id: 'ascent', t: 385, ko: '상승',                  en: 'Ascent' },
  { id: 'fill',   t: 470, ko: '접근',                  en: 'Approach' },
  { id: 'gaze',   t: 560, ko: '클로즈업 · 코페르니쿠스', en: 'Close-up · Copernicus' },
  { id: 'dwell',  t: 675, ko: '남극 · 지구돋이',         en: 'South Pole · Earthrise' },
  { id: 'dawn',   t: 800, ko: '새벽 · 월몰',            en: 'Dawn · Moonset' },
];

const RM_KM = 1737.4;
const ang = (deg) => Math.log(1 / Math.sin((deg * Math.PI) / 360) - 1);
const km = (alt) => Math.log(alt / RM_KM);
export const EYE_ALT = 1915; // metres: Cheonwangbong summit DEM (1895) + 20 m
export const CAM_EN = [18090, 4740]; // Cheonwangbong in the DEM frame (east, north metres from Nogodan)

const TRACKS = {
  // 1 = on the Earth at Nogodan (physical sky, terrain, clouds), 0 = in space
  earth: [[0, 1], [469, 1], [471, 0], [797, 0], [799, 1], [945, 1]],
  terrainOn: [[0, 1], [392, 1], [393.5, 0], [797, 0], [799, 1], [945, 1]],
  camAlt: [[0, EYE_ALT], [392, EYE_ALT], [394.5, 3300], [430, 5600], [468, 23000], [472, 23000], [797, 23000], [799, EYE_ALT], [945, EYE_ALT]],

  // the moon on the sky: hour angle (deg); an August full moon at dec -12
  H: [[0, -88.5], [55, -82.5], [150, -72.5], [260, -63.5], [380, -56], [470, -53], [797, -53], [799, 62], [900, 79.5], [945, 86]],
  // the sun, below the horizon: dusk to the west-northwest, dawn to the east-northeast
  sunAz: [[0, 105], [470, 105], [797, 105], [799, -105], [945, -105]],
  sunEl: [[0, -2.6], [55, -4.4], [120, -8.0], [175, -12.4], [235, -17.5], [300, -20], [470, -21], [797, -21], [800, -15], [880, -10], [930, -6.6], [945, -6.0]],

  // moon size / distance (log altitude above the surface, lunar radii)
  logAlt: [
    [0, ang(11)], [470, ang(11)], [520, ang(28)], [558, ang(108)],
    [590, km(235)], [660, km(150)], [667, km(150)], [675, km(5.5)], [680, km(5.5)],
    [785, km(46)], [792, km(46)], [800, ang(11)], [945, ang(11)],
  ],
  // sub-viewer point on the moon (deg)
  // Copernicus sits low and to the left, with the lunar night on the left wall; at the
  // south pole the crater at the pole stays to the left of the rising Earth
  faceLat: [[0, -4], [470, -4], [540, 10.6], [560, 10.6], [590, 10.5], [660, 10.5], [667, 10.5], [675, -87.4], [792, -87.4], [800, -4], [945, -4]],
  faceLon: [[0, 5], [470, 5], [540, -16.0], [560, -16.8], [590, -17.35], [660, -17.6], [667, -17.6], [675, 136], [792, 136], [800, 5], [945, 5]],
  roll: [[0, 0], [667, 0], [675, 218], [792, 218], [800, 0], [945, 0]],
  // where the moon is steered when it leaves the sky (deg)
  tgtAz: [[0, 0], [945, 0]],
  tgtEl: [[0, 9], [470, 9], [540, 2], [562, 0], [667, 0], [675, -90], [792, -90], [800, 9], [945, 9]],
  // (it moves toward the front wall while hidden in the cloud, so it clears the corner)
  pathMix: [[0, 0], [391, 0], [408, 0.55], [455, 1], [797, 1], [799, 0], [945, 0]],
  // sub-solar point on the moon (deg): full moon on the Earth nights; as the camera
  // swings out toward the moon the phase turns to a half moon; Copernicus at dawn;
  // raking light at the south pole
  sunLat: [[0, -4], [475, -4], [545, 0.5], [667, 0.5], [675, -0.9], [785, -1.4], [792, -1.4], [800, -4], [945, -4]],
  sunLon: [[0, 5], [475, 5], [545, 71.0], [560, 71.0], [660, 64.5], [667, 64.5], [675, 137], [785, 141], [792, 141], [800, 5], [945, 5]],
  earthLat: [[0, -4], [667, -4], [675, 0], [792, 0], [800, -4], [945, -4]],
  earthLon: [[0, 5], [667, 5], [675, 0], [792, 0], [800, 5], [945, 5]],

  // Earth's shadow across the moon (lunar radii along the eclipse path)
  eclX: [[0, -9], [222, -9], [240, -5.3], [255, -3.4], [270, -1.6], [318, 1.6], [333, 3.4], [348, 5.3], [365, 9], [945, 9]],

  // atmosphere and weather
  mie: [[0, 1.6], [120, 1.35], [220, 1.1], [470, 1.0], [797, 1.0], [800, 1.5], [945, 1.8]],
  fogTop: [[0, 1060], [300, 1150], [372, 1200], [390, 2400], [398, 2400], [400, 1100], [797, 1100], [800, 1120], [945, 1080]],
  fogDens: [[0, 0.0055], [378, 0.0055], [390, 0.035], [397, 0.035], [399, 0.0], [797, 0.0], [799, 0.0055], [945, 0.0055]],
  cloudCov: [[0, 0.32], [150, 0.44], [215, 0.24], [370, 0.3], [386, 0.28], [393, 0.35], [398, 0.8], [406, 0.9], [440, 0.82], [470, 0.82], [797, 0.82], [800, 0.22], [945, 0.2]],
  cloudDens: [[0, 0.0075], [388, 0.0075], [393, 0.02], [402, 0.02], [415, 0.009], [797, 0.009], [800, 0.0065], [945, 0.0065]],
  windX: [[0, 0], [945, 7000]],
  // the cloud the viewer rises through
  column: [[0, 0], [392.4, 0], [393, 1], [408, 1], [430, 0], [945, 0]],

  // optics
  blur: [[0, 10], [14, 10], [40, 0], [650, 0], [664, 26], [675, 26], [700, 0], [780, 0], [790, 24], [800, 24], [826, 0], [928, 0], [945, 14]],
  fade: [[0, 0], [14, 1], [464, 1], [469, 0.2], [474, 1], [660, 1], [668, 0], [680, 0], [694, 1], [784, 1], [792, 0], [800, 0], [814, 1], [930, 1], [945, 0]],
  // exposure: Earth scenes = automatic (sky model) + this bias, space scenes = absolute EV
  ev: [[0, -0.3], [110, -0.1], [160, 0.3], [200, 0.0], [300, 0.1], [380, 0.0], [386, 0.0], [390, 0.0], [396, -0.1], [404, -0.3], [416, -0.5], [470, -0.5], [475, 0.0], [520, 0.2], [560, 0.6], [590, 1.2], [660, 1.3], [667, 1.3], [680, -1.4], [740, -1.2], [792, -1.2], [800, 0.1], [850, 0.2], [900, 0.1], [945, 0.0]],
  vig: [[0, 0.72], [466, 0.72], [474, 0.55], [797, 0.55], [800, 0.72], [945, 0.72]],
  bloom: [[0, 0.5], [470, 0.5], [475, 0.2], [667, 0.2], [675, 0.1], [792, 0.1], [800, 0.5], [945, 0.5]],
  halation: [[0, 0.55], [470, 0.55], [475, 0.2], [667, 0.2], [675, 0.0], [792, 0.0], [800, 0.55], [945, 0.55]],
  glow: [[0, 0.6], [470, 0.6], [475, 0.1], [797, 0.1], [800, 0.6], [945, 0.6]],
  refr: [[0, 0.9], [945, 0.9]],
  shimmer: [[0, 0.5], [120, 0.15], [200, 0.0], [800, 0.0], [880, 0.2], [945, 0.5]],
  limbSoft: [[0, 0.12], [60, 0.12], [120, 0], [900, 0], [945, 0.1]],
  lodBias: [[0, 1.2], [50, 1.2], [110, 0], [900, 0], [945, 1.0]],

  // space
  earthVis: [[0, 0], [672, 0], [676, 1], [788, 1], [792, 0], [945, 0]],
  sunVis: [[0, 0], [672, 0], [676, 1], [788, 1], [792, 0], [945, 0]],
  relief: [[0, 0], [520, 0], [558, 1], [792, 1], [798, 0], [945, 0]],
  earthshine: [[0, 0.006], [470, 0.006], [540, 0.009], [667, 0.009], [675, 0.05], [792, 0.05], [800, 0.006], [945, 0.006]],
};

// discrete: which high-resolution lunar terrain patch is active
export function patchAt(t) {
  if (t >= 670 && t < 797) return 'southpole';
  if (t >= 470 && t < 670) return 'copernicus';
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
  S.earthMode = S.earth > 0.5;
  S.terrainValid = S.terrainOn > 0.5;
  return S;
}

export function sceneAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  let cur = SCENES[0];
  for (const s of SCENES) if (t >= s.t) cur = s;
  return cur;
}
