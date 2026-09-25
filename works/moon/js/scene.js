// Moon — turns a timeline state into shader uniforms (all the geometry lives here).

import { ORBIT } from './timeline.js';
import { SURF_SUN, SURF_EARTH } from './surface.js';

const D2R = Math.PI / 180;
export const SITE_LAT = 35.337 * D2R;  // Cheonwangbong, Jirisan; the front wall faces south
export const MOON_RA = 8 * D2R;        // an autumn full moon in Pisces, near the equator: it
export const MOON_DEC = 3 * D2R;       // rises and sets close to due east and west

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
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
  const m = new Float32Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      m[c * 3 + r] = fb[r] * wf[c] + nb[r] * up[c] + eb[r] * right[c];
    }
  }
  return m;
}
function toWorld(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}
function toBody(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

// ------------------------------------------------------------------ atmosphere (CPU copy)
// Same model and look-up tables as the shaders (atmo.js), at lower resolution; used only
// to meter exposure the way an eye adapts. Tables are cached per aerosol amount.
const RG = 6360e3, RT = 6460e3, HR = 8000, HM = 1200, BMS = 3.996e-6, BME = 4.4e-6;
const BR = [7.6e-6, 13.558e-6, 33.1e-6], BO = [2.4e-6, 1.881e-6, 0.085e-6];
const HT = Math.sqrt(RT * RT - RG * RG);
function extAt(h, mie) {
  const r = Math.exp(-h / HR), m = Math.exp(-h / HM) * mie, o = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  return [BR[0] * r + BME * m + BO[0] * o, BR[1] * r + BME * m + BO[1] * o, BR[2] * r + BME * m + BO[2] * o];
}
function bilerp(tab, W, H, u, v, out) {
  const x = Math.min(Math.max(u, 0), 1) * (W - 1), y = Math.min(Math.max(v, 0), 1) * (H - 1);
  const x0 = Math.min(Math.floor(x), W - 2), y0 = Math.min(Math.floor(y), H - 2);
  const fx = x - x0, fy = y - y0;
  for (let k = 0; k < 3; k++) {
    const a = tab[(y0 * W + x0) * 3 + k], b = tab[(y0 * W + x0 + 1) * 3 + k];
    const c = tab[((y0 + 1) * W + x0) * 3 + k], d = tab[((y0 + 1) * W + x0 + 1) * 3 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}
const TW = 48, TH = 24, MW = 16, MH = 12;
function transRaw(r, mu, mie) {
  const d = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT));
  const N = 24, dt = d / N;
  const od = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt;
    const h = Math.max(0, Math.sqrt(r * r + t * t + 2 * r * mu * t) - RG);
    const e = extAt(h, mie);
    od[0] += e[0] * dt; od[1] += e[1] * dt; od[2] += e[2] * dt;
  }
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];
}
function buildTables(mie) {
  const trans = new Float32Array(TW * TH * 3);
  for (let j = 0; j < TH; j++) {
    const rho = HT * (j / (TH - 1)), r = Math.sqrt(rho * rho + RG * RG);
    for (let i = 0; i < TW; i++) {
      const dmin = RT - r, dmax = rho + HT;
      const d = dmin + (i / (TW - 1)) * (dmax - dmin);
      const mu = d <= 0 ? 1 : Math.min(1, Math.max(-1, (HT * HT - rho * rho - d * d) / (2 * r * d)));
      trans.set(transRaw(r, mu, mie), (j * TW + i) * 3);
    }
  }
  const tb = { mie, trans, ms: null };
  const ms = new Float32Array(MW * MH * 3);
  const tmp = [0, 0, 0];
  for (let j = 0; j < MH; j++) {
    const r = RG + 1 + (j / (MH - 1)) * (RT - RG - 2);
    for (let i = 0; i < MW; i++) {
      const muS = (i / (MW - 1)) * 2 - 1;
      const sun = [Math.sqrt(Math.max(0, 1 - muS * muS)), muS, 0];
      const L2 = [0, 0, 0], F = [0, 0, 0];
      const NA = 6, NB = 6, NS = 12;
      for (let a = 0; a < NA; a++) {
        for (let b = 0; b < NB; b++) {
          const ct = 1 - (2 * (a + 0.5)) / NA, st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = (2 * Math.PI * (b + 0.5)) / NB;
          const d = [st * Math.cos(ph), ct, st * Math.sin(ph)];
          const bb = r * ct, discG = bb * bb - (r * r - RG * RG);
          let tG = -1;
          if (discG > 0) { const t = -bb - Math.sqrt(discG); if (t > 0) tG = t; }
          const tMax = tG > 0 ? tG : -bb + Math.sqrt(Math.max(0, bb * bb - (r * r - RT * RT)));
          const T = [1, 1, 1];
          let t0 = 0;
          for (let k = 0; k < NS; k++) {
            const t1 = (tMax * (k + 1)) / NS, dt = t1 - t0, tm = 0.5 * (t0 + t1);
            t0 = t1;
            const p = [d[0] * tm, r + d[1] * tm, d[2] * tm];
            const rp = len(p), hp = Math.max(rp - RG, 0);
            const rr = Math.exp(-hp / HR), sm = BMS * mie * Math.exp(-hp / HM);
            const ext = extAt(hp, mie);
            const Ts = transLookup(tb, rp, dot(p, sun) / rp, tmp);
            for (let c = 0; c < 3; c++) {
              const sig = BR[c] * rr + sm, e = Math.max(ext[c], 1e-12), a2 = Math.exp(-e * dt);
              L2[c] += T[c] * sig * Ts[c] * 0.0795775 * (1 - a2) / e;
              F[c] += T[c] * sig * (1 - a2) / e;
              T[c] *= a2;
            }
          }
          if (tG > 0) {
            const pg = [d[0] * tG, r + d[1] * tG, d[2] * tG];
            const ug = norm(pg), cs = dot(ug, sun);
            const Tg = transLookup(tb, RG, cs, tmp);
            for (let c = 0; c < 3; c++) L2[c] += T[c] * Tg[c] * Math.max(cs, 0) * (0.1 / Math.PI);
          }
        }
      }
      const n = 36;
      for (let c = 0; c < 3; c++) ms[(j * MW + i) * 3 + c] = (L2[c] / n) / Math.max(1 - F[c] / n, 0.05);
    }
  }
  tb.ms = ms;
  return tb;
}
function transLookup(tb, r, mu, out) {
  const muH = -Math.sqrt(Math.max(0, 1 - (RG * RG) / (r * r)));
  const vis = Math.min(1, Math.max(0, (mu - (muH - 0.0045)) / 0.009));
  if (vis <= 0) { out[0] = out[1] = out[2] = 0; return out; }
  mu = Math.max(mu, muH);
  const rho = Math.sqrt(Math.max(r * r - RG * RG, 0));
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT)));
  const dmin = RT - r, dmax = rho + HT;
  bilerp(tb.trans, TW, TH, (d - dmin) / Math.max(dmax - dmin, 1), rho / HT, out);
  const s = vis * vis * (3 - 2 * vis);
  out[0] *= s; out[1] *= s; out[2] *= s;
  return out;
}
function msLookup(tb, r, mu, out) {
  return bilerp(tb.ms, MW, MH, 0.5 + 0.5 * mu, (r - RG) / (RT - RG), out);
}
const cacheT = new Map();
function tablesFor(mie) {
  const key = Math.round(mie * 20);
  let tb = cacheT.get(key);
  if (!tb) { tb = buildTables(key / 20); cacheT.set(key, tb); }
  return tb;
}
// build the tables for the whole range of haze used by the timeline in small idle
// slices while the assets load, so none has to be built mid-show
export function warmAtmosphere(lo = 0.8, hi = 2.6) {
  const keys = [];
  for (let k = Math.round(lo * 20); k <= Math.round(hi * 20); k++) keys.push(k);
  const next = () => {
    const k = keys.shift();
    if (k === undefined) return;
    if (!cacheT.has(k)) cacheT.set(k, buildTables(k / 20));
    setTimeout(next, 16);
  };
  setTimeout(next, 0);
}
export function transTop(r, mu, mie) {
  return transLookup(tablesFor(mie), r, mu, [0, 0, 0]);
}
function phaseR(nu) { return 0.0596831 * (1 + nu * nu); }
function phaseM(nu) { const g = 0.8, g2 = g * g; return 0.1193662 * (1 - g2) * (1 + nu * nu) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * nu, 1e-4), 1.5)); }
function skyRadianceT(tb, camAlt, dir, lights, mie, ms, airglow) {
  const ro = [0, RG + camAlt, 0];
  const b = dot(ro, dir), c = dot(ro, ro);
  const discG = b * b - (c - RG * RG);
  let tMax = -b + Math.sqrt(Math.max(b * b - (c - RT * RT), 0));
  let ground = false;
  if (discG > 0) { const tg = -b - Math.sqrt(discG); if (tg > 0) { tMax = tg; ground = true; } }
  const N = 20;
  const L = [0, 0, 0], T = [1, 1, 1], tl = [0, 0, 0], tm2 = [0, 0, 0];
  let t0 = 0;
  for (let i = 0; i < N; i++) {
    const s1 = (i + 1) / N, t1 = tMax * s1 * s1, dt = t1 - t0;
    const tm = 0.5 * (t0 + t1); t0 = t1;
    const p = add(ro, mul(dir, tm));
    const r = len(p), h = Math.max(r - RG, 0), up = mul(p, 1 / r);
    const rr = Math.exp(-h / HR), sm = BMS * mie * Math.exp(-h / HM);
    const ext = extAt(h, mie);
    const S = [0, 0, 0];
    for (const l of lights) {
      const mu = dot(up, l.dir), nu = dot(dir, l.dir);
      const Tl = transLookup(tb, r, mu, tl);
      const M = msLookup(tb, r, mu, tm2);
      const pr = phaseR(nu), pm = phaseM(nu);
      for (let k = 0; k < 3; k++) S[k] += l.E[k] * (Tl[k] * (BR[k] * rr * pr + sm * pm) + M[k] * (BR[k] * rr + sm) * ms);
    }
    for (let k = 0; k < 3; k++) {
      const e = Math.max(ext[k], 1e-12), Ts = Math.exp(-e * dt);
      L[k] += T[k] * (S[k] - S[k] * Ts) / e;
      T[k] *= Ts;
    }
  }
  if (!ground && airglow) {
    const k = RG / (RG + 90000);
    const vr = 1 / Math.sqrt(Math.max(1 - k * k * (1 - dir[1] * dir[1]), 0.03));
    for (let c = 0; c < 3; c++) L[c] += T[c] * airglow[c] * (0.3 + 0.7 * vr);
  }
  return L;
}
export function skyRadiance(camAlt, dir, lights, mie, ms, airglow) {
  return skyRadianceT(tablesFor(mie), camAlt, dir, lights, mie, ms, airglow);
}

// ------------------------------------------------------------------ eclipse
const RU = 2.65, RP = 4.65;
// light reaching a point of the moon at distance q2 from the shadow axis (lunar radii):
// sunlight in the penumbra, then only the red light bent through Earth's atmosphere,
// with a turquoise band where it grazed the ozone layer (same as the shader)
function eclipseLight(q2) {
  let f = Math.min(1, Math.max(0, (q2 - RU) / (RP - RU)));
  f = 0.75 * f * f * (3 - 2 * f) + 0.25 * f;
  const x = Math.min(1, q2 / RU);
  const red = 0.0035 + 0.016 * Math.pow(x, 5);
  const tq = 0.022 * Math.exp(-(((1 - x) / 0.045) ** 2));
  return [f, (1.0 * red + 0.32 * tq) * (1 - f), (0.2 * red + 0.72 * tq) * (1 - f), (0.055 * red + 1.0 * tq) * (1 - f)];
}
// average light over the visible disc (the full moon faces the sun): what the disc
// shows, and what it throws on the landscape. The umbral light on the ground is far
// dimmer than the airglow (a totality night is as dark as a moonless one), while the
// disc is shown the way a long exposure records it.
function eclipseMean(ex, ey) {
  const s = [0, 0, 0, 0];
  let n = 0;
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const x = i / 4.5, y = j / 4.5;
      if (x * x + y * y > 1) continue;
      const c = eclipseLight(Math.hypot(x - ex, y - ey));
      for (let k = 0; k < 4; k++) s[k] += c[k];
      n++;
    }
  }
  const f = s[0] / n;
  return { disc: [f + s[1] / n, f + s[2] / n, f + s[3] / n], env: [f + 0.05 * s[1] / n, f + 0.05 * s[2] / n, f + 0.05 * s[3] / n] };
}

// ------------------------------------------------------------------ constants
const SUN_E = [1.0, 0.98, 0.95];
const MOON_K = 3.0e-6;       // full-moon irradiance relative to the sun (≈ 0.25 lx / 100 klx, a little generous)
const MOON_TEX_TO_PHYS = 0.065; // shader moon radiance units -> physical radiance (sun = 1)
const AIRGLOW = mul([0.87, 1.0, 1.33], 1.0e-9); // natural night sky at the zenith (airglow + starlight)
const MW_K = 6.0e-8;         // Milky Way surface brightness
const STAR_K = 4.0e-8;       // point stars
const MW_SPACE = 0.02, STAR_SPACE = 0.35; // the same in space, per unit of exposure
const KEY = 0.032;           // where the metered scene average lands (kept low: it is a night piece)

function earthLights(S, moonDir, ecl) {
  const sunDir = dirAzEl(S.sunAz, S.sunEl);
  const moonE = [1.0 * MOON_K * ecl[0], 0.95 * MOON_K * ecl[1], 0.88 * MOON_K * ecl[2]];
  return { sunDir, moonDir, sunE: SUN_E, moonE };
}

export let MS = 1.0;
export function setMS(v) { MS = v; }
// what the walls show, metered the way a camera's matrix meter would: log-average of
// the sky round the room and the lit ground/fog below it
const METER_DIRS = [[0, 1, 0], dirAzEl(0, 6), dirAzEl(0, 25), dirAzEl(-90, 6), dirAzEl(-90, 25), dirAzEl(90, 6),
  dirAzEl(90, 25), dirAzEl(-45, 14), dirAzEl(45, 14), dirAzEl(180, 20)];
function meterKey(S, L) {
  const lights = [{ dir: L.sunDir, E: L.sunE }, { dir: L.moonDir, E: L.moonE }];
  let ls = 0, lin = 0;
  for (const d of METER_DIRS) {
    const v = Math.max(lum(skyRadiance(S.camAlt, d, lights, S.mie, MS, AIRGLOW)), 1e-13);
    ls += Math.log(v); lin += v;
  }
  ls /= METER_DIRS.length; lin /= METER_DIRS.length;
  // moonlit / twilit ground and fog
  const r = RG + S.camAlt;
  const Tm = transTop(r, L.moonDir[1], S.mie), Ts = transTop(r, L.sunDir[1], S.mie);
  const ground = 0.08 * (lum(L.moonE) * lum(Tm) * Math.max(L.moonDir[1], 0.05) + lum(L.sunE) * lum(Ts) * Math.max(L.sunDir[1], 0))
    + 0.25 * lin;
  return Math.max(Math.exp(0.6 * ls + 0.4 * Math.log(ground)), 1e-12);
}
// the eye never fully adapts: dark scenes are kept darker than dusk
const ABS = 1.2e5; // radiance unit -> cd/m2 (the sun gives ~120 klx)
function nightKey(key) {
  const lcd = key * ABS;
  return Math.min(1, Math.max(0.22, 0.22 + 0.78 * (Math.log10(lcd) + 4) / 5.5));
}
const ECL_Y = 0.35;
const NO_ECL = { disc: [1, 1, 1], env: [1, 1, 1] };
const eclAt = (x) => (Math.abs(x) < RP + 1.2 ? eclipseMean(x, ECL_Y) : NO_ECL);
// metered log key on a 0.25 s grid, interpolated (the lagged samples reuse earlier work)
const meterCache = new Map();
function meterLogAt(t, stateAtFn) {
  const q = 0.25, i0 = Math.floor(t / q), f = t / q - i0;
  const at = (i) => {
    let v = meterCache.get(i);
    if (v === undefined) {
      const Sp = stateAtFn(i * q);
      if (!Sp.earthMode) v = Math.log(1e-3);
      else {
        const Hr = Sp.H * D2R;
        const md = slerp(hadecToWorld(Hr, MOON_DEC, SITE_LAT), dirAzEl(Sp.tgtAz, Sp.tgtEl), Sp.pathMix);
        v = Math.log(meterKey(Sp, earthLights(Sp, md, eclAt(Sp.eclX).env)));
      }
      meterCache.set(i, v);
      if (meterCache.size > 200) meterCache.delete(meterCache.keys().next().value);
    }
    return v;
  };
  return at(i0) * (1 - f) + at(i0 + 1) * f;
}

// The month round the room: where the moon is at a given unwrapped azimuth, how the fixed
// sun lights it from there, and how much light the Earth (the viewer) throws back on it.
const ORBIT_SUN = dirAzEl(ORBIT.sunAz, ORBIT.sunEl);
const ES_MAX = 0.02; // earthshine at full Earth (new moon)
function orbitPose(azDeg, fb) {
  const dir = dirAzEl(azDeg, ORBIT.el(azDeg));
  const M = bodyMatrix(dir, 0, fb);
  const cosE = dot(dir, ORBIT_SUN);
  return { dir, M, sunB: norm(toBody(M, ORBIT_SUN)), es: ES_MAX * (1 + cosE) / 2 };
}

export function deriveUniforms(S, stateAtFn) {
  const Hr = S.H * D2R;
  const skyDir = hadecToWorld(Hr, MOON_DEC, SITE_LAT);
  const fb = sph(S.faceLat, S.faceLon);
  const orbit = S.orbitMode ? orbitPose(S.tgtAz, fb) : null;
  const tgt = dirAzEl(S.tgtAz, S.tgtEl);
  const dir = orbit ? orbit.dir : slerp(skyDir, tgt, S.pathMix);
  const q = parallactic(Hr, MOON_DEC, SITE_LAT);
  const roll = S.roll * D2R + (1 - S.pathMix) * (-q);
  const D = 1 + Math.exp(S.logAlt);
  const M = orbit ? orbit.M : bodyMatrix(dir, roll, fb);
  const sunB = orbit ? orbit.sunB : sph(S.sunLat, S.sunLon);
  const earthB = orbit ? fb : sph(S.earthLat, S.earthLon);
  const angR = Math.asin(1 / D);

  // Earth's shadow on the moon: path across the disc, east tangent at the sub-viewer point
  let nb = norm(sub([0, 1, 0], mul(fb, fb[1])));
  const eb = cross(nb, fb);
  const eclC = add(mul(eb, S.eclX), mul(nb, ECL_Y));
  const eclOn = Math.abs(S.eclX) < RP + 1.2 ? 1 : 0;
  const eclM = eclAt(S.eclX);
  const eclFrac = lum(eclM.disc);

  const cosA = dot(sunB, fb);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const litFrac = (1 + cosA) / 2;
  const moonLumSpace = 0.42 * litFrac * Math.exp(-0.55 * alpha);

  const earthDirW = toWorld(M, earthB);
  const sunW = toWorld(M, sunB);
  const earthRot = bodyMatrix(earthDirW, 22 * D2R, sph(12, 126));

  const U = {
    uM: M,
    uCamB: mul(fb, D),
    uSunB: sunB,
    uEarthB: earthB,
    uEarthshine: orbit ? orbit.es : S.earthshine,
    uRelief: S.relief,
    uLimbSoft: S.limbSoft * D2R,
    uLodBias: S.lodBias,
    uMoonDirW: dir,
    uMoonAngR: angR,
    uMoonLum: moonLumSpace,
    uMoonTint: [1, 1, 1],
    uGlow: S.glow,
    uRefr: S.refr,
    uShimmer: S.shimmer,
    uStars: 1,
    uEarthVis: S.earthVis,
    uEarthDirW: earthDirW,
    uEarthRot: earthRot,
    uSunW: sunW,
    uSunVis: S.sunVis,
    uEclC: eclC,
    uEcl: eclOn,
    uEarth: S.earthMode ? 1 : 0,
    uCamAlt: S.camAlt,
    uMie: S.mie,
    blur: S.blur,
    bloom: S.bloom,
    halation: S.halation,
    vig: S.vig,
    lst: Hr + MOON_RA,
    dist: D,
    earthMode: S.earthMode,
    terrainValid: S.terrainValid,
  };

  if (S.earthMode) {
    const L = earthLights(S, dir, eclM.env);
    // exposure follows the scene like an adapting eye: metered now and a few seconds back
    let lk = 0, wsum = 0;
    const lags = stateAtFn ? [[0, 0.45], [1.5, 0.3], [3.5, 0.25]] : [[0, 1]];
    for (const [dtl, w] of lags) {
      const lkey = stateAtFn ? meterLogAt(S.t - dtl, stateAtFn) : Math.log(meterKey(S, L));
      lk += lkey * w; wsum += w;
    }
    const key = Math.exp(lk / wsum);
    const exposure = (KEY * nightKey(key) * Math.pow(2, S.ev)) / key;
    const fade = S.fade;
    const e = exposure * fade;
    U.exposure = 1;
    U.preExposure = e;
    U.uSunDirW = L.sunDir;
    U.uSunE = mul(L.sunE, e);
    U.uMoonE = mul(L.moonE, e);
    U.uAirglow = mul(AIRGLOW, e);
    // the moon disc: physical when that is already bright enough, otherwise held
    // like a photographer exposing for the moon (and opened up when it is eclipsed)
    const cap = 4.5 / Math.max(eclFrac, 1e-4) ** 0.35;
    U.uMoonScale = Math.min(exposure * MOON_TEX_TO_PHYS, cap) * fade;
    U.uMoonLum = litFrac * eclFrac * 0.35;
    U.aurMax = 0.1 * U.uMoonScale;
    U.uAbsScale = ABS / Math.max(e, 1e-9);
    U.uMWGain = MW_K * e;
    U.starGain = STAR_K * e;
    U.keyLight = L.sunDir[1] > -0.07 && S.sunEl > -5 ? L.sunDir : dir;
    U.eclFrac = eclFrac;
  } else {
    U.exposure = Math.pow(2, S.ev) * S.fade;
    U.preExposure = U.exposure;
    U.uSunDirW = [0, -1, 0];
    U.uSunE = [0, 0, 0];
    U.uMoonE = [0, 0, 0];
    U.uAirglow = [0, 0, 0];
    U.uMoonScale = 1;
    U.aurMax = 0.1;
    U.uAbsScale = 0;
    U.uMWGain = MW_SPACE * U.exposure;
    U.starGain = STAR_SPACE * U.exposure;
    if (S.surfaceMode) {
      // standing on the moon at night: the sun is below the horizon behind the viewer and
      // the nearly full Earth, coming up over the rim ahead, is the only light. The stars
      // and the Milky Way are kept as bright as during the month.
      U.uSunW = dirAzEl(SURF_SUN.az, SURF_SUN.el);
      U.uEarthDirW = dirAzEl(SURF_EARTH.az, S.earthEl);
      U.uEarthRot = bodyMatrix(U.uEarthDirW, 0, sph(SURF_EARTH.lat, SURF_EARTH.lon));
      U.surfLight = U.uEarthDirW;
      U.uMWGain = (MW_SPACE * 1.5 * S.fade) / Math.pow(2, S.ev);
      U.starGain = STAR_SPACE * 1.23 * S.fade;
    }
    U.keyLight = dir;
    U.eclFrac = 1;
  }
  // afterimages left at each stop of the month (same size and face as the moon)
  const G = { n: 0, dir: new Float32Array(36), M: new Float32Array(81), sun: new Float32Array(27), es: new Float32Array(9) };
  if (orbit) {
    for (const [az, tLeave] of ORBIT.stops) {
      let a = ORBIT.afterimage * Math.min(1, Math.max(0, (S.t - tLeave) / 5)) ** 2;
      // the first one merges back into the moon when it comes round again; then all fade
      if (az === 0) a *= Math.min(1, Math.max(0, (646 - S.t) / 8));
      a *= Math.min(1, Math.max(0, (ORBIT.fadeOut[1] - S.t) / (ORBIT.fadeOut[1] - ORBIT.fadeOut[0])));
      if (a <= 0 || G.n >= 9) continue;
      const g = orbitPose(az, fb);
      G.dir.set([...g.dir, a], G.n * 4);
      G.M.set(g.M, G.n * 9);
      G.sun.set(g.sunB, G.n * 3);
      G.es[G.n] = g.es;
      G.n++;
    }
  }
  U.ghosts = G;
  return U;
}
