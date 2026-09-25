// Moon — choreography.
// Every parameter is a keyframe track interpolated with a monotone cubic
// (PCHIP): no overshoot, zero velocity at held keys, so nothing ever lurches.
// Camera distance to the moon is keyed as log(altitude) so a zoom reads as a
// constant rate of expansion instead of speeding up as the surface approaches.
//
// Story: one night on Cheonwangbong, the summit of Jirisan. A full moon rises at dusk in the
// east, is eclipsed, the valley fog climbs over the viewer and the camera rises out of the
// clouds into space. There the viewer stands where the Earth is, with the sun behind
// them, and the moon goes once round the room: a month in three minutes. Its phase
// follows from where it is (full in front, quarters on the side walls, crescents toward
// the back), and it leaves an afterimage at each stop, like a multiple exposure. Then the
// full moon comes close until it fills the walls, and the morning terminator reaches
// Copernicus (low on the left, not in the middle); the same crater seen low and at a
// slant; standing on the moon at night as the Earth comes up over the rim, the only
// light there, lighting the ground from behind; and back to the summit at dawn as the
// moon sets in the west. The moon only stops near the middle of a wall, where the image
// stays round for viewers away from the sweet spot.

// when each part begins (s)
const TM = 470;   // the month (space)
const TA = 660;   // approach and close-up
const TS = 836;   // Copernicus at a slant
const TU = 896;   // on the moon (Earthrise)
const TD = 1054;  // dawn, back on the summit
export const LOOP = TD + 146; // 20:00: on the wall clock it starts every hour at :00, :20 and :40
export const SURF_T0 = TU;    // the rabbits' clock starts here

export const SCENES = [
  { id: 'dusk',    t: 0,       ko: '황혼 · 월출',          en: 'Dusk · Moonrise' },
  { id: 'night',   t: 175,     ko: '밤 · 개기월식',        en: 'Night · Total lunar eclipse' },
  { id: 'ascent',  t: 385,     ko: '상승',                en: 'Ascent' },
  { id: 'month',   t: TM + 4,  ko: '한 달',               en: 'A month' },
  { id: 'close',   t: TA,      ko: '접근 · 클로즈업',      en: 'Approach · Close-up' },
  { id: 'slant',   t: TS + 5,  ko: '코페르니쿠스',         en: 'Copernicus' },
  { id: 'surface', t: TU + 7,  ko: '달 위에서 · 지구돋이',  en: 'On the moon · Earthrise' },
  { id: 'dawn',    t: TD,      ko: '새벽 · 월몰',          en: 'Dawn · Moonset' },
];

const RM_KM = 1737.4;
const ang = (deg) => Math.log(1 / Math.sin((deg * Math.PI) / 360) - 1);
const km = (alt) => Math.log(alt / RM_KM);
export const EYE_ALT = 1915; // metres: Cheonwangbong summit DEM (1895) + 20 m
export const CAM_EN = [18090, 4740]; // Cheonwangbong in the DEM frame (east, north metres from Nogodan)

// The month round the room. The moon's orbit is a circle round the viewer, tilted so it
// is highest in front; the sun is fixed behind the viewer, a little below the orbit.
export const ORBIT = {
  sunAz: 180, sunEl: -8,
  el: (azDeg) => 5 + 7 * Math.cos((azDeg * Math.PI) / 180),
  // where it stops (unwrapped azimuth, deg) and when it leaves each stop (s): the
  // afterimage appears as it moves on. -242 = +118 (after passing behind the viewer).
  stops: [[0, 484], [-22, 502], [-64, 520], [-90, 536], [-118, 552], [-242, 584], [-270, 600], [-296, 616], [-338, 634]],
  afterimage: 0.6,
  // the afterimages fade once the moon is back where it started
  fadeOut: [TA - 10, TA],
};

const TRACKS = {
  // 1 = on the Earth at Cheonwangbong (physical sky, terrain, clouds), 0 = in space
  earth: [[0, 1], [469, 1], [471, 0], [TD - 2, 0], [TD, 1], [LOOP, 1]],
  // 1 = the month round the room
  orbit: [[0, 0], [TM, 0], [TM + 0.5, 1], [TA, 1], [TA + 0.5, 0], [LOOP, 0]],
  // 1 = standing on the moon (the ground is built while the screen is dark)
  surface: [[0, 0], [TU, 0], [TU + 0.5, 1], [TD - 4, 1], [TD - 3.5, 0], [LOOP, 0]],
  terrainOn: [[0, 1], [392, 1], [393.5, 0], [TD - 2, 0], [TD, 1], [LOOP, 1]],
  camAlt: [[0, EYE_ALT], [392, EYE_ALT], [394.5, 3300], [430, 5600], [468, 23000], [472, 23000], [TD - 2, 23000], [TD, EYE_ALT], [LOOP, EYE_ALT]],

  // the moon on the sky: hour angle (deg); a full moon at dec +3 rises and sets near due
  // east and west, so it stays close to the middle of the side walls
  // (the disc is drawn 11 degrees wide, so it starts well below the horizon and is gone
  // before the loop ends)
  H: [[0, -102.6], [30, -98.8], [60, -93.6], [120, -86.9], [175, -82.3], [250, -76.8], [300, -74.0], [380, -70.2], [TM, -68.7],
    [TD - 2, -68.7], [TD, 74.4], [TD + 51, 82.3], [TD + 101, 89.9], [TD + 126, 94.8], [TD + 141, 100.0], [LOOP, 101.1]],
  // the sun, below the horizon, opposite the moon
  sunAz: [[0, 86], [TM, 86], [TD - 2, 86], [TD, -86], [LOOP, -86]],
  sunEl: [[0, -2.6], [55, -4.4], [120, -8.0], [175, -12.4], [235, -17.5], [300, -20], [TM, -21], [TD - 2, -21], [TD + 1, -15], [TD + 81, -10], [TD + 131, -6.6], [LOOP, -6.0]],

  // moon size / distance (log altitude above the surface, lunar radii). After the month
  // the full moon comes close: it fills the front wall, then all three, then the view
  // goes down to the surface near the terminator.
  logAlt: [
    [0, ang(11)], [TM, ang(11)], [TM + 4, ang(11)], [484, ang(14)], [TA, ang(14)],
    [TA + 40, ang(28)], [TA + 78, ang(108)], [TA + 110, km(235)], [TS - 6, km(150)], [TS, km(150)],
    [TS + 1, km(22)], [TU, km(19)], [TD - 1, km(19)], [TD, ang(11)], [LOOP, ang(11)],
  ],
  // sub-viewer point on the moon (deg). The near side during the month; on the approach
  // it drifts north-west so that Copernicus ends up low on the left of the front wall,
  // with the morning terminator crossing it. At the slant the camera is 20 km up, 90 km
  // south-east of the crater, looking north.
  faceLat: [[0, -4], [TA, -4], [TA + 40, 2], [TA + 60, 10.6], [TA + 78, 10.6], [TA + 110, 10.5], [TS, 10.5], [TS + 1, 6.78], [TU, 6.9], [TD - 1, 6.9], [TD, -4], [LOOP, -4]],
  faceLon: [[0, 5], [TA, 5], [TA + 40, -6], [TA + 60, -16.0], [TA + 78, -16.8], [TA + 110, -17.35], [TS - 6, -17.6], [TS, -17.6], [TS + 1, -18.75], [TU, -18.8], [TD - 1, -18.8], [TD, 5], [LOOP, 5]],
  roll: [[0, 0], [LOOP, 0]],
  // where the moon is steered when it leaves the sky (deg); -90 = the moon is the ground
  // (during the month it is the unwrapped azimuth round the room, stopping at ORBIT.stops;
  // the elevation then follows ORBIT.el)
  tgtAz: [[0, 0], [484, 0], [496, -22], [502, -22], [514, -64], [520, -64], [530, -90], [536, -90],
    [546, -118], [552, -118], [578, -242], [584, -242], [594, -270], [600, -270], [610, -296], [616, -296],
    [628, -338], [634, -338], [646, -360], [TD - 1, -360], [TD, 0], [LOOP, 0]],
  tgtEl: [[0, 9], [455, 9], [469, 12], [TA, 12], [TA + 40, 6], [TA + 62, 2], [TA + 82, 0], [TS, 0], [TS + 1, -90], [TD - 1, -90], [TD, 9], [LOOP, 9]],
  // (it moves toward the front wall while hidden in the cloud, so it clears the corner)
  pathMix: [[0, 0], [391, 0], [408, 0.55], [455, 1], [TD - 2, 1], [TD, 0], [LOOP, 0]],
  // sub-solar point on the moon (deg). Full moon on the Earth nights (during the month the
  // sun is fixed in the room instead, see ORBIT). On the approach the phase turns to a
  // half moon, the terminator reaching Copernicus (lon -20) at lunar sunrise; at the slant
  // the morning sun is a little higher.
  sunLat: [[0, -4], [TM, -4], [TA, 0], [TA + 40, 0], [TA + 65, 0.5], [TS, 0.5], [TS + 1, 0.5], [TU, 1.0], [TD - 1, 1.0], [TD, -4], [LOOP, -4]],
  sunLon: [[0, 5], [TM, 5], [TA, 5], [TA + 65, 71.0], [TA + 80, 71.0], [TS - 6, 64.5], [TS, 64.5], [TS + 1, 66], [TU, 58], [TD - 1, 58], [TD, 5], [LOOP, 5]],
  earthLat: [[0, -4], [LOOP, -4]],
  earthLon: [[0, 5], [LOOP, 5]],
  // standing on the moon: how high the Earth's centre stands over the horizon (deg). It is
  // the only light there: the rim ahead glows first, and the light reaches the ground by
  // the room as it climbs.
  earthEl: [[0, -1.4], [TU + 7, -1.4], [TU + 30, 0.6], [TU + 60, 3.4], [TU + 95, 6.6], [TU + 130, 9.6], [TU + 152, 11.2], [LOOP, 11.2]],

  // Earth's shadow across the moon (lunar radii along the eclipse path)
  eclX: [[0, -9], [222, -9], [240, -5.3], [255, -3.4], [270, -1.6], [318, 1.6], [333, 3.4], [348, 5.3], [365, 9], [LOOP, 9]],

  // atmosphere and weather
  mie: [[0, 1.6], [120, 1.35], [220, 1.1], [TM, 1.0], [TD - 2, 1.0], [TD + 1, 1.5], [LOOP, 1.8]],
  fogTop: [[0, 1060], [300, 1150], [372, 1200], [390, 2400], [398, 2400], [400, 1100], [TD - 2, 1100], [TD + 1, 1120], [LOOP, 1080]],
  fogDens: [[0, 0.0055], [378, 0.0055], [390, 0.035], [397, 0.035], [399, 0.0], [TD - 2, 0.0], [TD, 0.0055], [LOOP, 0.0055]],
  cloudCov: [[0, 0.32], [150, 0.44], [215, 0.24], [370, 0.3], [386, 0.28], [393, 0.35], [398, 0.8], [406, 0.9], [440, 0.82], [TM, 0.82], [TD - 2, 0.82], [TD + 1, 0.22], [LOOP, 0.2]],
  cloudDens: [[0, 0.0075], [388, 0.0075], [393, 0.02], [402, 0.02], [415, 0.009], [TD - 2, 0.009], [TD + 1, 0.0065], [LOOP, 0.0065]],
  windX: [[0, 0], [LOOP, (7000 * LOOP) / 945]],
  // the cloud the viewer rises through
  column: [[0, 0], [392.4, 0], [393, 1], [408, 1], [430, 0], [LOOP, 0]],

  // optics
  blur: [[0, 10], [14, 10], [40, 0], [TS - 6, 0], [TS, 22], [TS + 5, 22], [TS + 17, 0], [TU - 6, 0], [TU, 22], [TU + 7, 22], [TU + 19, 0],
    [TD - 14, 0], [TD - 7, 24], [TD + 1, 24], [TD + 27, 0], [LOOP - 17, 0], [LOOP, 14]],
  fade: [[0, 0], [14, 1], [464, 1], [469, 0.2], [474, 1], [TS - 6, 1], [TS, 0], [TS + 5, 0], [TS + 17, 1], [TU - 6, 1], [TU, 0], [TU + 7, 0], [TU + 19, 1],
    [TD - 16, 1], [TD - 8, 0], [TD + 1, 0], [TD + 15, 1], [LOOP - 15, 1], [LOOP, 0]],
  // exposure: Earth scenes = automatic (sky model) + this bias, space scenes = absolute EV
  ev: [[0, -0.3], [110, -0.1], [160, 0.3], [200, 0.0], [300, 0.1], [380, 0.0], [386, 0.0], [390, 0.0], [396, -0.1], [404, -0.3], [416, -0.5], [TM, -0.5],
    [475, 0.3], [TA, 0.3], [TA + 40, 0.4], [TA + 78, 0.7], [TA + 110, 1.2], [TS, 1.3], [TS + 1, 0.8], [TU - 1, 0.8], [TU, 4.8], [TU + 70, 4.8], [TU + 140, 3.8], [TD - 2, 3.8],
    [TD + 1, 0.1], [TD + 51, 0.2], [TD + 101, 0.1], [LOOP, 0.0]],
  vig: [[0, 0.72], [466, 0.72], [474, 0.55], [TD - 2, 0.55], [TD + 1, 0.72], [LOOP, 0.72]],
  bloom: [[0, 0.5], [TM, 0.5], [475, 0.2], [TS, 0.2], [TS + 1, 0.1], [TD - 2, 0.1], [TD + 1, 0.5], [LOOP, 0.5]],
  halation: [[0, 0.55], [TM, 0.55], [475, 0.2], [TS, 0.2], [TS + 1, 0.0], [TD - 2, 0.0], [TD + 1, 0.55], [LOOP, 0.55]],
  glow: [[0, 0.6], [TM, 0.6], [475, 0.1], [TD - 2, 0.1], [TD + 1, 0.6], [LOOP, 0.6]],
  refr: [[0, 0.9], [LOOP, 0.9]],
  shimmer: [[0, 0.5], [120, 0.15], [200, 0.0], [TD + 1, 0.0], [TD + 81, 0.2], [LOOP, 0.5]],
  limbSoft: [[0, 0.12], [60, 0.12], [120, 0], [LOOP - 45, 0], [LOOP, 0.1]],
  lodBias: [[0, 1.2], [50, 1.2], [110, 0], [LOOP - 45, 0], [LOOP, 1.0]],

  // space
  earthVis: [[0, 0], [LOOP, 0]],
  sunVis: [[0, 0], [LOOP, 0]],
  // (surface relief is ray-marched only where it shows: close to the moon)
  relief: [[0, 0], [TA + 40, 0], [TA + 78, 1], [TU - 1, 1], [TU, 0], [LOOP, 0]],
  // light from the Earth on the moon's night side (during the month it follows the
  // Earth's phase instead: full Earth when the moon is new)
  earthshine: [[0, 0.006], [TA, 0.006], [TA + 40, 0.008], [TA + 78, 0.009], [TS, 0.009], [TS + 1, 0.004], [TD - 2, 0.004], [TD, 0.006], [LOOP, 0.006]],
};

// discrete: which high-resolution lunar terrain patch is active
export function patchAt(t) {
  if (t >= TM && t < TU) return 'copernicus';
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
  S.orbitMode = S.orbit > 0.5;
  S.surfaceMode = S.surface > 0.5;
  return S;
}

export function sceneAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  let cur = SCENES[0];
  for (const s of SCENES) if (t >= s.t) cur = s;
  return cur;
}
