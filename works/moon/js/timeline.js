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
// moon comes close in the corner between the left wall and the front, half on each; it
// hangs over the top of the walls, above the viewer's head; the full moon comes close
// until it fills the walls and the morning terminator reaches Copernicus (low on the left,
// not in the middle); standing on the moon at night as the Earth comes up over the rim, the only light there, lighting the ground
// from behind. Back on the Earth, the moon rises golden out of the sea, its light breaking
// up on the waves, and paper boats with a small light inside drift here and there on the
// water round the three walls; before dawn it stands pale over ranges rising out of a valley
// full of fog, layer on layer as in an ink landscape; and back on the summit at dawn it sets
// in the west. Away from those close-ups the moon only stops near the middle of a wall, where
// the image stays round for viewers away from the sweet spot.

// when each part begins (s)
const TM = 470;   // the month (space)
const TC = 660;   // close-up in the corner between the left wall and the front
const TO = 818;   // the moon overhead
const TA = 933;   // approach to Copernicus
const TU = 1061;  // on the moon at night (Earthrise)
const TW = 1249;  // by the sea, the moon rising out of it, its light on the water (8:30)
const TK = 1759;  // before dawn: ranges standing out of the valley fog, a pale moon (8:00)
const TD = 2239;  // dawn, back on the summit
export const LOOP = TD + 161; // 40:00: on the wall clock it starts every 40 minutes (:00, :40, :20)
export const SURF_T0 = TU;    // the rabbits' clock starts here
export const SEA_T0 = TW;     // the paper boats' clock starts here
export const SEA_EYE = 6;     // eye height over the water at the sea (m): the end of a breakwater
export const LAND_ALT = 1336; // the spur below Samsinbong before dawn: eye height above sea level (m)

export const SCENES = [
  { id: 'dusk',     t: 0,       ko: '황혼 · 월출',           en: 'Dusk · Moonrise' },
  { id: 'night',    t: 175,     ko: '밤 · 개기월식',         en: 'Night · Total lunar eclipse' },
  { id: 'ascent',   t: 385,     ko: '상승',                 en: 'Ascent' },
  { id: 'month',    t: TM + 4,  ko: '한 달',                en: 'A month' },
  { id: 'corner',   t: TC,      ko: '클로즈업 · 모서리',     en: 'Close-up · The corner' },
  { id: 'overhead', t: TO + 2,  ko: '머리 위',              en: 'Overhead' },
  { id: 'close',    t: TA + 2,  ko: '접근 · 코페르니쿠스',   en: 'Approach · Copernicus' },
  { id: 'surface',  t: TU + 2,  ko: '달 위에서 · 지구돋이',   en: 'On the moon · Earthrise' },
  { id: 'sea',      t: TW + 1,  ko: '바다 · 윤슬',           en: 'The sea · Moonlight on the water' },
  { id: 'mist',     t: TK + 1,  ko: '안개 · 능선',           en: 'Mist · Ranges' },
  { id: 'dawn',     t: TD + 1,  ko: '새벽 · 월몰',           en: 'Dawn · Moonset' },
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
  fadeOut: [TC - 10, TC],
};

const TRACKS = {
  // 1 = on the Earth (physical sky; the summit's terrain and clouds, or the sea), 0 = in space
  earth: [[0, 1], [469, 1], [471, 0], [TW - 2, 0], [TW, 1], [LOOP, 1]],
  // 1 = the month round the room
  orbit: [[0, 0], [TM, 0], [TM + 0.5, 1], [TC, 1], [TC + 0.5, 0], [LOOP, 0]],
  // 1 = standing on the moon (the ground is built while the screen is dark)
  surface: [[0, 0], [TU, 0], [TU + 0.5, 1], [TW - 2.5, 1], [TW - 2, 0], [LOOP, 0]],
  // 1 = by the sea
  sea: [[0, 0], [TW - 2, 0], [TW - 1.5, 1], [TK - 2, 1], [TK - 1.5, 0], [LOOP, 0]],
  // 1 = on the spur below Samsinbong before dawn, the main ridge of Jirisan across the view
  land: [[0, 0], [TK - 2, 0], [TK - 1.5, 1], [TD - 2, 1], [TD - 1.5, 0], [LOOP, 0]],
  // there (only read while it shows): where the room's front looks (deg from north)
  ridgeHead: [[0, -15], [LOOP, -15]],
  // the fog lying in the valleys: its top (m above sea level), how softly it thins (m), its
  // density (1/m), from how far out (m)
  vfTop: [[0, 780], [LOOP, 780]],
  vfSoft: [[0, 45], [LOOP, 45]],
  vfDens: [[0, 0.012], [LOOP, 0.012]],
  vfStart: [[0, 0], [LOOP, 0]],
  // a thin haze over the fog (1/m at its top) and how fast it thins with height (m)
  mist: [[0, 0.00025], [LOOP, 0.00025]],
  mistH: [[0, 450], [LOOP, 450]],
  // the moon's colour over what the air does to it: golden over the sea, blue-white in the
  // mist
  mtR: [[0, 1], [TW - 2, 1], [TW - 1.5, 1.0], [TK - 2, 1.0], [TK - 1.5, 0.9], [TD - 2, 0.9], [TD - 1.5, 1], [LOOP, 1]],
  mtG: [[0, 1], [TW - 2, 1], [TW - 1.5, 0.88], [TK - 2, 0.88], [TK - 1.5, 0.96], [TD - 2, 0.96], [TD - 1.5, 1], [LOOP, 1]],
  mtB: [[0, 1], [TW - 2, 1], [TW - 1.5, 0.66], [TK - 2, 0.66], [TK - 1.5, 1.05], [TD - 2, 1.05], [TD - 1.5, 1], [LOOP, 1]],
  // close up in space the moon's own colours, brought out a little (blue titanium-rich seas,
  // browner iron-rich ones), as in the enhanced-colour photographs
  mineral: [[0, 0], [TC, 0], [TC + 45, 0.45], [TO, 0.45], [TO + 1, 0.3], [TA, 0.3], [TA + 1, 0.4], [TU, 0.4], [TU + 0.5, 0], [LOOP, 0]],
  // light shafts toward the moon by the sea (the shadows of the clouds), and a wide aureole
  // round it in hazy air
  rays: [[0, 0], [TW - 2, 0], [TW - 1.5, 0.35], [TK - 2, 0.35], [TK - 1.5, 0], [LOOP, 0]],
  aureole: [[0, 0], [TW - 2, 0], [TW - 1.5, 0.7], [TK - 2, 0.7], [TK - 1.5, 0.65], [TD - 2, 0.65], [TD - 1.5, 0], [LOOP, 0]],
  // which look (LOOKS in main.js): 1 the sea, 2 the mist
  look: [[0, 0], [TW - 2, 0], [TW - 1.5, 1], [TK - 2, 1], [TK - 1.5, 2], [TD - 2, 2], [TD - 1.5, 0], [LOOP, 0]],
  // a night photograph's split toning by the sea and in the mist
  tone: [[0, 0], [TW - 2, 0], [TW - 1.5, 0.45], [TK - 2, 0.45], [TK - 1.5, 0.55], [TD - 2, 0.55], [TD - 1.5, 0], [LOOP, 0]],
  terrainOn: [[0, 1], [392, 1], [393.5, 0], [TD - 2, 0], [TD, 1], [LOOP, 1]],
  camAlt: [[0, EYE_ALT], [392, EYE_ALT], [394.5, 3300], [430, 5600], [468, 23000], [472, 23000],
    [TW - 2, 23000], [TW - 1.5, SEA_EYE], [TK - 2, SEA_EYE], [TK - 1.5, LAND_ALT], [TD - 2, LAND_ALT], [TD - 1.5, EYE_ALT], [LOOP, EYE_ALT]],

  // the moon on the sky: hour angle (deg); a full moon at dec +3 rises and sets near due
  // east and west, so it stays close to the middle of the side walls
  // (the disc is drawn 11 degrees wide, so it starts well below the horizon and is gone
  // before the loop ends)
  H: [[0, -102.6], [30, -98.8], [60, -93.6], [120, -86.9], [175, -82.3], [250, -76.8], [300, -74.0], [380, -70.2], [TM, -68.7],
    [TD - 2, -68.7], [TD, 74.4], [TD + 56, 82.3], [TD + 111, 89.9], [TD + 139, 94.8], [TD + 156, 100.0], [LOOP, 101.1]],
  // the sun, below the horizon, opposite the moon
  sunAz: [[0, 86], [TM, 86], [TK - 2, 86], [TK - 1.5, -86], [LOOP, -86]],
  sunEl: [[0, -2.6], [55, -4.4], [120, -8.0], [175, -12.4], [235, -17.5], [300, -20], [TM, -21], [TK - 2, -21],
    [TK - 1.5, -14], [TD - 2.5, -12.5], [TD - 2, -21], [TD + 1, -15], [TD + 89, -10], [TD + 144, -6.6], [LOOP, -6.0]],

  // moon size / distance (log altitude above the surface, lunar radii). After the month
  // the moon comes into the corner (58-64 degrees wide), then hangs overhead (94-98), then
  // the full moon comes close: it fills the front wall, then all three, then the view goes
  // down to the surface near the terminator. The cuts fall in the dark.
  logAlt: [
    [0, ang(11)], [TM, ang(11)], [TM + 4, ang(11)], [484, ang(14)], [TC, ang(14)],
    [TC + 45, ang(58)], [TO - 6, ang(64)], [TO, ang(64)],
    [TO + 1, ang(94)], [TA - 6, ang(98)], [TA, ang(98)],
    [TA + 1, ang(44)], [TA + 35, ang(108)], [TA + 67, km(235)], [TU - 6, km(150)], [TU, km(150)],
    [TU + 1, km(19)], [TW - 2, km(19)], [TW - 1.5, ang(11)], [LOOP, ang(11)],
  ],
  // sub-viewer point on the moon (deg). The near side during the month. In the corner the
  // eastern seas face the room, with the morning terminator over the central highlands on
  // the left wall; overhead, the southern highlands (Tycho, Clavius) are the lower edge
  // hanging over the walls; on the approach Copernicus ends up low on the left of the front
  // wall, with the morning terminator crossing it.
  faceLat: [[0, -4], [TC, -4], [TC + 45, 8], [TO - 6, 9], [TO, 9], [TO + 1, -28], [TA - 6, -27], [TA, -27],
    [TA + 1, 8], [TA + 20, 10.6], [TA + 35, 10.6], [TA + 67, 10.5], [TU, 10.5], [TU + 1, 6.9], [TW - 2, 6.9], [TW - 1.5, -4], [LOOP, -4]],
  faceLon: [[0, 5], [TC, 5], [TC + 45, 32], [TO - 6, 30], [TO, 30], [TO + 1, -6], [TA - 6, -8], [TA, -8],
    [TA + 1, -12], [TA + 20, -16.0], [TA + 35, -16.8], [TA + 67, -17.35], [TU - 6, -17.6], [TU, -17.6], [TU + 1, -18.8],
    [TW - 2, -18.8], [TW - 1.5, 5], [LOOP, 5]],
  roll: [[0, 0], [LOOP, 0]],
  // where the moon is steered when it leaves the sky (deg); -90 = the moon is the ground
  // (during the month it is the unwrapped azimuth round the room, stopping at ORBIT.stops;
  // the elevation then follows ORBIT.el). After the month it glides into the corner
  // between the left wall and the front (-405 = -45); overhead its centre is 60 degrees up
  // and its lower edge arches across the top of the front wall, sinking slowly; by the sea
  // it is low over the water in front.
  tgtAz: [[0, 0], [484, 0], [496, -22], [502, -22], [514, -64], [520, -64], [530, -90], [536, -90],
    [546, -118], [552, -118], [578, -242], [584, -242], [594, -270], [600, -270], [610, -296], [616, -296],
    [628, -338], [634, -338], [646, -360], [TC, -360], [TC + 45, -405], [TO, -405], [TO + 1, -360], [TK - 2, -360],
    [TK - 1.5, -354], [TD - 2, -350], [TD, 0], [LOOP, 0]],
  tgtEl: [[0, 9], [455, 9], [469, 12], [TC, 12], [TC + 45, 1], [TO, 1], [TO + 1, 60], [TA - 6, 56], [TA, 56],
    [TA + 1, 8], [TA + 20, 3], [TA + 37, 0], [TU, 0], [TU + 1, -90], [TW - 2, -90],
    [TW - 1.5, 1.8], [TW + 90, 5.5], [TK - 2, 14], [TK - 1.5, 21], [TD - 2, 17], [TD - 1.5, 9], [LOOP, 9]],
  // (it moves toward the front wall while hidden in the cloud, so it clears the corner)
  pathMix: [[0, 0], [391, 0], [408, 0.55], [455, 1], [TD - 2, 1], [TD, 0], [LOOP, 0]],
  // sub-solar point on the moon (deg). Full moon on the Earth nights (during the month the
  // sun is fixed in the room instead, see ORBIT). In the corner it turns gibbous as it
  // comes in, the terminator on its left; overhead the sun is low from the right over the
  // southern highlands, the terminator near the left end of the arc;
  // on the approach the phase turns to a half moon, the terminator reaching Copernicus
  // (lon -20) at lunar sunrise.
  sunLat: [[0, -4], [TM, -4], [TC, 0], [TC + 45, 1.5], [TO, 1.5], [TO + 1, -1.5], [TA, -1.5], [TA + 1, 0], [TA + 25, 0.5], [TU, 0.5],
    [TU + 1, 1.0], [TW - 2, 1.0], [TW - 1.5, -4], [LOOP, -4]],
  sunLon: [[0, 5], [TM, 5], [TC, 5], [TC + 45, 90], [TO - 6, 88], [TO, 88], [TO + 1, 48], [TA - 6, 46], [TA, 46],
    [TA + 1, 73], [TA + 25, 71.0], [TA + 40, 71.0], [TU - 6, 64.5], [TU, 64.5], [TU + 1, 58], [TW - 2, 58], [TW - 1.5, 5], [LOOP, 5]],
  earthLat: [[0, -4], [LOOP, -4]],
  earthLon: [[0, 5], [LOOP, 5]],
  // standing on the moon: how high the Earth's centre stands over the horizon (deg). It is
  // the only light there: its top is already over the rim as the scene comes up, the rim
  // glows first, and the light reaches the ground by the room as it climbs.
  earthEl: [[0, 0.2], [TU + 2, 0.2], [TU + 30, 1.6], [TU + 60, 3.8], [TU + 95, 6.6], [TU + 130, 9.6], [TU + 152, 11.2], [TU + 182, 13.0], [LOOP, 13.0]],

  // shooting stars on the Earth nights (chance of one starting, per second), and a shower
  // while the eclipse is total (the sky is darkest); stars twinkle most by the sea
  meteors: [[0, 0], [100, 0], [140, 0.03], [370, 0.03], [385, 0], [TW - 2, 0], [TW + 60, 0.03], [TK - 2, 0.03], [TK, 0], [TD - 2, 0], [TD, 0.02], [TD + 45, 0], [LOOP, 0]],
  shower: [[0, 0], [258, 0], [272, 1.2], [312, 1.2], [326, 0], [LOOP, 0]],
  twinkle: [[0, 0.3], [TW - 2, 0.3], [TW, 1.0], [TK - 2, 1.0], [TK, 0.3], [LOOP, 0.3]],
  // over the sea a few more stars than the eye would see in moonlight, as in a long exposure
  starBoost: [[0, 1], [TW - 2, 1], [TW - 1.5, 1.5], [TK - 2, 1.5], [TK - 1.5, 1], [LOOP, 1]],

  // Earth's shadow across the moon (lunar radii along the eclipse path)
  eclX: [[0, -9], [222, -9], [240, -5.3], [255, -3.4], [270, -1.6], [318, 1.6], [333, 3.4], [348, 5.3], [365, 9], [LOOP, 9]],

  // atmosphere and weather (by the sea: a little haze, a few high clouds)
  mie: [[0, 1.6], [120, 1.35], [220, 1.1], [TM, 1.0], [TW - 2, 1.0],
    [TW - 1.5, 1.7], [TK - 2, 1.7], [TK - 1.5, 1.8], [TD - 2.5, 1.8], [TD - 2, 1.7], [TD + 1, 1.5], [LOOP, 1.8]],
  fogTop: [[0, 1060], [300, 1150], [372, 1200], [390, 2400], [398, 2400], [400, 1100], [TD - 2, 1100], [TD + 1, 1120], [LOOP, 1080]],
  fogDens: [[0, 0.0055], [378, 0.0055], [390, 0.035], [397, 0.035], [399, 0.0], [TD - 2, 0.0], [TD, 0.0055], [LOOP, 0.0055]],
  cloudCov: [[0, 0.32], [150, 0.44], [215, 0.24], [370, 0.3], [386, 0.28], [393, 0.35], [398, 0.8], [406, 0.9], [440, 0.82], [TM, 0.82],
    [TW - 2, 0.82], [TW - 1.5, 0.2],
    [TK - 2, 0.2], [TK - 1.5, 0.3], [TD - 2.5, 0.3], [TD - 2, 0.2], [TD + 1, 0.22], [LOOP, 0.2]],
  cloudDens: [[0, 0.0075], [388, 0.0075], [393, 0.02], [402, 0.02], [415, 0.009], [TW - 2, 0.009], [TW - 1.5, 0.006], [TD - 2, 0.006], [TD + 1, 0.0065], [LOOP, 0.0065]],
  windX: [[0, 0], [LOOP, (7000 * LOOP) / 945]],
  // the cloud the viewer rises through
  column: [[0, 0], [392.4, 0], [393, 1], [408, 1], [430, 0], [LOOP, 0]],

  // optics. Cuts between scenes are short (2-4 s of black): longer, and the room looks as
  // if the piece has stopped. The ground caches are built ahead, so nothing waits for them.
  blur: [[0, 10], [14, 10], [40, 0],
    [TO - 6, 0], [TO, 22], [TO + 2, 22], [TO + 12, 0], [TA - 6, 0], [TA, 22], [TA + 2, 22], [TA + 12, 0],
    [TU - 6, 0], [TU, 22], [TU + 2, 22], [TU + 12, 0],
    [TW - 9, 0], [TW - 3, 24], [TW + 1, 24], [TW + 16, 0],
    [TK - 9, 0], [TK - 3, 24], [TK + 1, 24], [TK + 16, 0], [TD - 9, 0], [TD - 3, 24], [TD + 1, 24], [TD + 16, 0], [LOOP - 12, 0], [LOOP, 14]],
  fade: [[0, 0], [10, 1], [464, 1], [469, 0.2], [474, 1],
    [TO - 6, 1], [TO, 0], [TO + 2, 0], [TO + 10, 1], [TA - 6, 1], [TA, 0], [TA + 2, 0], [TA + 10, 1],
    [TU - 6, 1], [TU, 0], [TU + 2, 0], [TU + 10, 1],
    [TW - 10, 1], [TW - 3, 0], [TW + 1, 0], [TW + 10, 1],
    [TK - 10, 1], [TK - 3, 0], [TK + 1, 0], [TK + 10, 1], [TD - 10, 1], [TD - 3, 0], [TD + 1, 0], [TD + 10, 1], [LOOP - 10, 1], [LOOP, 0]],
  // exposure: Earth scenes = automatic (sky model) + this bias, space scenes = absolute EV
  // (shaped from the rendered frames so the brightness changes gradually: at the end of
  // dusk the eye keeps the landscape as the twilight goes and the moonlight takes over; in
  // the fog and the cloud the viewer rises through it stays even; at dawn the twilight
  // comes in without the moonlit ground first going dark)
  ev: [[0, -0.3], [54, -0.246], [71, -0.074], [83, 0.338], [97, 0.621], [122, 1.393], [133, 2.087], [139, 2.663], [152, 3.138], [160, 2.799], [163, 2.253], [165, 1.392], [166, 0.99], [169, 0.268], [172, 0.123], [185, 0.122], [200, 0], [300, 0.1],
    [372, 0.003], [375, 0.026], [378, -0.066], [380, 0.021], [383, -0.432], [387, 0.295], [392, 0.607], [393, -0.761], [394, -0.944], [397, -0.844], [400, -0.897], [403, -1.148], [405, -1.43], [406, -1.431], [408, -0.935], [410, -0.657], [426, -0.5], [TM, -0.5],
    [475, 0.3], [TC, 0.3], [TC + 45, 0.35], [TO, 0.35], [TO + 1, 0.5], [TA, 0.5], [TA + 1, 0.6], [TA + 35, 0.8], [TA + 67, 1.2], [TU - 1, 1.3],
    [TU, 5.0], [TU + 40, 4.8], [TU + 70, 4.8], [TU + 170, 3.6], [TW - 2, 3.6],
    [TW - 1.5, 0.0], [TK - 2, 0.0], [TK - 1.5, -0.2], [TD - 2.5, -0.2], [TD - 2, 0.0],
    [TD + 1, 0.1], [TD + 14, 0.159], [TD + 28, 0.047], [TD + 41, 0.319], [TD + 45, 1.106], [TD + 47, 1.503], [TD + 51, 2.006], [TD + 58, 2.374], [TD + 81, 2.756], [TD + 100, 2.281], [TD + 105, 1.857], [TD + 114, 1.291], [TD + 131, 0.663], [TD + 140, 0.399], [TD + 147, 0.01], [TD + 152, -0.369], [TD + 155, -0.195], [TD + 156, 0.002], [LOOP, 0.0]],
  vig: [[0, 0.72], [466, 0.72], [474, 0.55], [TW - 2, 0.55], [TW + 1, 0.72], [LOOP, 0.72]],
  // (less over the sea and in the mist, where it would spread the glitter and the moon's
  // light over the dark round them)
  bloom: [[0, 0.5], [TM, 0.5], [475, 0.2], [TU, 0.2], [TU + 1, 0.1], [TW - 2, 0.1], [TW + 1, 0.3], [TK - 2, 0.3], [TK - 1.5, 0.35],
    [TD - 2, 0.35], [TD - 1.5, 0.5], [LOOP, 0.5]],
  halation: [[0, 0.55], [TM, 0.55], [475, 0.2], [TU, 0.2], [TU + 1, 0.0], [TW - 2, 0.0], [TW + 1, 0.55], [LOOP, 0.55]],
  glow: [[0, 0.6], [TM, 0.6], [475, 0.1], [TW - 2, 0.1], [TW + 1, 0.6], [TK - 2, 0.6], [TK - 1.5, 0.7], [TD - 2, 0.7], [TD - 1.5, 0.6], [LOOP, 0.6]],
  refr: [[0, 0.9], [LOOP, 0.9]],
  shimmer: [[0, 0.5], [120, 0.15], [200, 0.0], [TW - 2, 0.0], [TW - 1.5, 0.4], [TW + 150, 0.1], [TK - 2, 0.0],
    [TD + 1, 0.0], [TD + 89, 0.2], [LOOP, 0.5]],
  limbSoft: [[0, 0.12], [60, 0.12], [120, 0], [LOOP - 45, 0], [LOOP, 0.1]],
  lodBias: [[0, 1.2], [50, 1.2], [110, 0], [LOOP - 45, 0], [LOOP, 1.0]],

  // space
  earthVis: [[0, 0], [LOOP, 0]],
  sunVis: [[0, 0], [LOOP, 0]],
  // (surface relief is ray-marched only where it shows: close to the moon)
  relief: [[0, 0], [TC + 20, 0], [TC + 42, 1], [TU - 1, 1], [TU, 0], [LOOP, 0]],
  // light from the Earth on the moon's night side (during the month it follows the
  // Earth's phase instead: full Earth when the moon is new)
  earthshine: [[0, 0.006], [TC, 0.006], [TC + 45, 0.008], [TA + 35, 0.009], [TU, 0.009], [TU + 1, 0.004], [TW - 2, 0.004], [TW, 0.006], [LOOP, 0.006]],
};

// discrete: which high-resolution lunar terrain patch is active
export function patchAt(t) {
  if (t >= TO && t < TA) return 'southpole';
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
  S.seaMode = S.sea > 0.5;
  return S;
}

export function sceneAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  let cur = SCENES[0];
  for (const s of SCENES) if (t >= s.t) cur = s;
  return cur;
}
