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
// the back), and it leaves an afterimage at each stop, like a multiple exposure. Then
// the morning terminator over Copernicus, seen low and at an angle; the lunar south
// pole where the Earth rises; and back to the summit at dawn as the moon sets in the
// west. The moon only stops near the middle of a wall, where the image stays round
// for viewers away from the sweet spot.

export const LOOP = 945; // seconds (15:45)

export const SCENES = [
  { id: 'dusk',   t: 0,   ko: '황혼 · 월출',            en: 'Dusk · Moonrise' },
  { id: 'night',  t: 175, ko: '밤 · 개기월식',          en: 'Night · Total lunar eclipse' },
  { id: 'ascent', t: 385, ko: '상승',                  en: 'Ascent' },
  { id: 'phases', t: 474, ko: '한 달',                  en: 'A month' },
  { id: 'gaze',   t: 666, ko: '코페르니쿠스',            en: 'Copernicus' },
  { id: 'dwell',  t: 742, ko: '남극 · 지구돋이',         en: 'South Pole · Earthrise' },
  { id: 'dawn',   t: 800, ko: '새벽 · 월몰',            en: 'Dawn · Moonset' },
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
};

const TRACKS = {
  // 1 = on the Earth at Nogodan (physical sky, terrain, clouds), 0 = in space
  earth: [[0, 1], [469, 1], [471, 0], [797, 0], [799, 1], [945, 1]],
  // 1 = the month round the room
  orbit: [[0, 0], [470, 0], [470.5, 1], [663, 1], [663.5, 0], [945, 0]],
  terrainOn: [[0, 1], [392, 1], [393.5, 0], [797, 0], [799, 1], [945, 1]],
  camAlt: [[0, EYE_ALT], [392, EYE_ALT], [394.5, 3300], [430, 5600], [468, 23000], [472, 23000], [797, 23000], [799, EYE_ALT], [945, EYE_ALT]],

  // the moon on the sky: hour angle (deg); a full moon at dec +3 rises and sets near due
  // east and west, so it stays close to the middle of the side walls
  // (the disc is drawn 11 degrees wide, so it starts well below the horizon and is gone
  // before the loop ends)
  H: [[0, -102.6], [30, -98.8], [60, -93.6], [120, -86.9], [175, -82.3], [250, -76.8], [300, -74.0], [380, -70.2], [470, -68.7], [797, -68.7], [799, 74.4], [850, 82.3], [900, 89.9], [925, 94.8], [940, 100.0], [945, 101.1]],
  // the sun, below the horizon, opposite the moon
  sunAz: [[0, 86], [470, 86], [797, 86], [799, -86], [945, -86]],
  sunEl: [[0, -2.6], [55, -4.4], [120, -8.0], [175, -12.4], [235, -17.5], [300, -20], [470, -21], [797, -21], [800, -15], [880, -10], [930, -6.6], [945, -6.0]],

  // moon size / distance (log altitude above the surface, lunar radii)
  // (in space the disc grows only until it fills the middle of the front wall; it never
  // spills round a corner, where it would look bent to anyone off the sweet spot)
  logAlt: [
    [0, ang(11)], [470, ang(11)], [474, ang(11)], [484, ang(14)], [663, ang(14)],
    [664, km(22)], [734, km(20)], [740, km(20)], [748, km(5.5)], [752, km(5.5)],
    [788, km(40)], [792, km(40)], [800, ang(11)], [945, ang(11)],
  ],
  // sub-viewer point on the moon (deg). During the phases the familiar near side, with a
  // little libration. Over Copernicus the camera is 20 km up, 90 km south-east of the
  // crater, looking north: the crater lies low on the left, seen at a slant with the
  // horizon above it. At the south pole the crater at the pole sits to the left of the
  // rising Earth.
  faceLat: [[0, -4], [663, -4], [664, 6.78], [734, 6.9], [740, 6.9], [748, -87.4], [792, -87.4], [800, -4], [945, -4]],
  faceLon: [[0, 5], [663, 5], [664, -18.75], [734, -18.8], [740, -18.8], [748, 136], [792, 136], [800, 5], [945, 5]],
  roll: [[0, 0], [740, 0], [748, 218], [792, 218], [800, 0], [945, 0]],
  // where the moon is steered when it leaves the sky (deg); -90 = the moon is the ground
  // (during the month it is the unwrapped azimuth round the room, stopping at ORBIT.stops;
  // the elevation then follows ORBIT.el)
  tgtAz: [[0, 0], [484, 0], [496, -22], [502, -22], [514, -64], [520, -64], [530, -90], [536, -90],
    [546, -118], [552, -118], [578, -242], [584, -242], [594, -270], [600, -270], [610, -296], [616, -296],
    [628, -338], [634, -338], [646, -360], [663, -360], [663.5, 0], [945, 0]],
  tgtEl: [[0, 9], [470, 9], [663, 9], [664, -90], [792, -90], [800, 9], [945, 9]],
  // (it moves toward the front wall while hidden in the cloud, so it clears the corner)
  pathMix: [[0, 0], [391, 0], [408, 0.55], [455, 1], [797, 1], [799, 0], [945, 0]],
  // sub-solar point on the moon (deg). Full moon on the Earth nights; in space the sun
  // goes once round the moon: waning, new moon (lingering), waxing crescent, first
  // quarter, gibbous. Then sunrise sweeping over Copernicus (the terminator from lon -16
  // to -26), and raking light at the south pole.
  // (during the month the sun is fixed in the room instead, see ORBIT)
  sunLat: [[0, -4], [663, -4], [664, 0.5], [734, 1.2], [742, -0.9], [785, -1.4], [792, -1.4], [800, -4], [945, -4]],
  sunLon: [[0, 5], [663, 5], [664, -286], [734, -296], [742, -223], [785, -219], [792, -219], [800, 5], [945, 5]],
  earthLat: [[0, -4], [740, -4], [748, 0], [792, 0], [800, -4], [945, -4]],
  earthLon: [[0, 5], [740, 5], [748, 0], [792, 0], [800, 5], [945, 5]],

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
  blur: [[0, 10], [14, 10], [40, 0], [656, 0], [662, 22], [668, 22], [680, 0], [734, 0], [740, 22], [748, 22], [758, 0], [786, 0], [792, 24], [800, 24], [826, 0], [928, 0], [945, 14]],
  fade: [[0, 0], [14, 1], [464, 1], [469, 0.2], [474, 1], [656, 1], [662, 0], [667, 0], [680, 1], [734, 1], [739, 0], [748, 0], [758, 1], [786, 1], [792, 0], [800, 0], [814, 1], [930, 1], [945, 0]],
  // exposure: Earth scenes = automatic (sky model) + this bias, space scenes = absolute EV
  ev: [[0, -0.3], [110, -0.1], [160, 0.3], [200, 0.0], [300, 0.1], [380, 0.0], [386, 0.0], [390, 0.0], [396, -0.1], [404, -0.3], [416, -0.5], [470, -0.5], [475, 0.3], [663, 0.3], [664, 1.2], [734, 1.2], [742, -1.2], [792, -1.2], [800, 0.1], [850, 0.2], [900, 0.1], [945, 0.0]],
  vig: [[0, 0.72], [466, 0.72], [474, 0.55], [797, 0.55], [800, 0.72], [945, 0.72]],
  bloom: [[0, 0.5], [470, 0.5], [475, 0.2], [656, 0.2], [664, 0.1], [792, 0.1], [800, 0.5], [945, 0.5]],
  halation: [[0, 0.55], [470, 0.55], [475, 0.2], [656, 0.2], [664, 0.0], [792, 0.0], [800, 0.55], [945, 0.55]],
  glow: [[0, 0.6], [470, 0.6], [475, 0.1], [797, 0.1], [800, 0.6], [945, 0.6]],
  refr: [[0, 0.9], [945, 0.9]],
  shimmer: [[0, 0.5], [120, 0.15], [200, 0.0], [800, 0.0], [880, 0.2], [945, 0.5]],
  limbSoft: [[0, 0.12], [60, 0.12], [120, 0], [900, 0], [945, 0.1]],
  lodBias: [[0, 1.2], [50, 1.2], [110, 0], [900, 0], [945, 1.0]],

  // space
  earthVis: [[0, 0], [745, 0], [749, 1], [788, 1], [792, 0], [945, 0]],
  sunVis: [[0, 0], [745, 0], [749, 1], [788, 1], [792, 0], [945, 0]],
  // (surface relief is ray-marched only where it shows: at the lunar landscapes)
  relief: [[0, 0], [663, 0], [664, 1], [792, 1], [798, 0], [945, 0]],
  // light from the Earth on the moon's night side (during the month it follows the
  // Earth's phase instead: full Earth when the moon is new)
  earthshine: [[0, 0.006], [663, 0.006], [664, 0.004], [740, 0.004], [748, 0.05], [792, 0.05], [800, 0.006], [945, 0.006]],
};

// discrete: which high-resolution lunar terrain patch is active
export function patchAt(t) {
  if (t >= 745 && t < 797) return 'southpole';
  if (t >= 470 && t < 745) return 'copernicus';
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
  return S;
}

export function sceneAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  let cur = SCENES[0];
  for (const s of SCENES) if (t >= s.t) cur = s;
  return cur;
}
