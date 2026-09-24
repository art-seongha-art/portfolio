// Moon — real-time moon for a three-wall CAVE.
import { FULLSCREEN_VS, mainFS, STAR_VS, STAR_FS, COMPOSITE_FS } from './shaders.js';
import { LOOP, SCENES, stateAt, sceneAt } from './timeline.js';
import { deriveUniforms, SITE_LAT } from './scene.js';
import { DEFAULT_ROOM, buildLayout } from './cave.js';
import { initUI } from './ui.js';

const A = new URL('../assets/', import.meta.url).href;
const params = new URLSearchParams(location.search);
const STORE = 'moon.config.v1';

// ------------------------------------------------------------------ config
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}
const saved = loadSaved();
const num = (k, d) => (params.has(k) ? parseFloat(params.get(k)) : d);
export const cfg = {
  mode: params.get('mode') || (params.has('cave') ? 'span' : saved.mode || (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || innerWidth < innerHeight * 1.3 ? 'single' : 'preview')),
  wall: params.get('wall') || 'front',
  quality: params.get('q') || saved.quality || 'auto',
  room: { ...DEFAULT_ROOM, ...(saved.room || {}) },
  order: saved.order || ['left', 'front', 'right'],
  grade: saved.grade || {},
  grid: params.has('grid'),
  ui: params.get('ui') !== '0',
  yaw: num('yaw', 0), pitch: num('pitch', 4), fov: num('fov', 100),
  speed: num('speed', 1),
  // installations run on the wall clock so every window/PC agrees on the moment
  clock: params.get('clock') || saved.clock || null,
};
for (const [k, key] of [['w', 'width'], ['d', 'depth'], ['h', 'height'], ['eye', 'eye'], ['bottom', 'bottom'], ['vx', 'vx'], ['vz', 'vz']]) {
  if (params.has(k)) cfg.room[key] = parseFloat(params.get(k));
}
if (!cfg.clock) cfg.clock = cfg.mode === 'span' || cfg.mode === 'wall' ? 'wall' : 'free';

export function saveConfig() {
  const { mode, quality, room, order, grade, clock } = cfg;
  try { localStorage.setItem(STORE, JSON.stringify({ mode, quality, room, order, grade, clock })); } catch {}
}

// ------------------------------------------------------------------ clock
// wall: t = seconds since a fixed epoch (+ operator offset), shared by all windows
// free: t starts where the page opened
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('moon-cave') : null;
export const clock = {
  speed: cfg.speed,
  offset: 0,
  paused: false,
  pausedAt: 0,
  origin: 0,
  init() {
    if (cfg.clock === 'wall') {
      // fixed epoch: windows opened on different days (or PCs with synced clocks) agree
      this.origin = Date.UTC(2026, 0, 1) / 1000;
      try { this.offset = parseFloat(localStorage.getItem('moon.offset') || '0') || 0; } catch {}
    } else {
      const start = params.has('t') ? parseFloat(params.get('t')) : 36;
      this.origin = Date.now() / 1000 - start / this.speed;
    }
    if (params.has('pause')) { this.paused = true; this.pausedAt = params.has('t') ? parseFloat(params.get('t')) : this.raw(); }
  },
  raw() { return (Date.now() / 1000 - this.origin) * this.speed + this.offset; },
  now() { const t = this.paused ? this.pausedAt : this.raw(); return ((t % LOOP) + LOOP) % LOOP; },
  seek(t, remote) {
    const cur = this.paused ? this.pausedAt : this.raw();
    const delta = t - (((cur % LOOP) + LOOP) % LOOP);
    this.offset += delta;
    if (this.paused) this.pausedAt = t;
    this.persist(remote);
  },
  togglePause(remote) {
    if (this.paused) { this.paused = false; this.offset += this.pausedAt - this.raw(); } else { this.pausedAt = this.raw(); this.paused = true; }
    this.persist(remote);
  },
  setSpeed(s, remote) {
    const t = this.raw();
    this.speed = s;
    this.offset += t - this.raw();
    this.persist(remote);
  },
  persist(remote) {
    if (cfg.clock === 'wall') { try { localStorage.setItem('moon.offset', String(this.offset)); } catch {} }
    if (!remote && bc) bc.postMessage({ type: 'clock', offset: this.offset, paused: this.paused, pausedAt: this.pausedAt, speed: this.speed, origin: this.origin });
  },
};
if (bc) {
  bc.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'clock') Object.assign(clock, { offset: m.offset, paused: m.paused, pausedAt: m.pausedAt, speed: m.speed, origin: m.origin });
    if (m.type === 'config') { Object.assign(cfg.room, m.room || {}); if (m.grade) cfg.grade = m.grade; if (m.order) cfg.order = m.order; layoutDirty = true; }
    if (m.type === 'grid') cfg.grid = m.on;
  };
}
export function broadcast(msg) { if (bc) bc.postMessage(msg); }

// ------------------------------------------------------------------ GL setup
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', {
  antialias: false, alpha: false, depth: false, stencil: false,
  premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!params.get('capture'),
});
export const status = { msg: '', error: null, loaded: 0, total: 1, hires: false };
if (!gl) {
  status.error = '이 브라우저는 WebGL2를 지원하지 않습니다. (Chrome/Edge 최신 버전을 권장합니다)';
}
const extCBF = gl && gl.getExtension('EXT_color_buffer_float');
const extAniso = gl && gl.getExtension('EXT_texture_filter_anisotropic');
const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log || '');
    const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
    throw new Error(`shader compile failed\n${log}\n${ctx}`);
  }
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link failed: ' + gl.getProgramInfoLog(p));
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    loc[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, loc };
}
function setU(prog, name, v) {
  const l = prog.loc[name];
  if (l == null) return;
  if (typeof v === 'number') gl.uniform1f(l, v);
  else if (v instanceof Float32Array && v.length === 9) gl.uniformMatrix3fv(l, false, v);
  else if (v.length === 2) gl.uniform2fv(l, v);
  else if (v.length === 3) gl.uniform3fv(l, v);
  else if (v.length === 4) gl.uniform4fv(l, v);
}
function setI(prog, name, v) { const l = prog.loc[name]; if (l != null) gl.uniform1i(l, v); }

let progMain, progStar, progComp;
const emptyVAO = gl && gl.createVertexArray();

// ------------------------------------------------------------------ textures
const T = {};
function solidTex(rgba, internal = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE, data = new Uint8Array(rgba)) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => res(img)) : res(img));
    img.onerror = () => rej(new Error('failed: ' + url));
    img.src = url;
  });
}
function mipLevels(w, h) { return Math.floor(Math.log2(Math.max(w, h))) + 1; }
function colorTexture(img, { srgb = true, wrapS = gl.REPEAT, aniso = 8 } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texStorage2D(gl.TEXTURE_2D, mipLevels(img.width, img.height), srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, img.width, img.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t;
}
// 16-bit heights are packed as (hi, lo) bytes in R,G of a lossless WebP.
// Decode on the GPU side (exact bytes via readPixels), then upload as R16F
// with box-filtered mips built here, since hardware mips of split bytes are wrong.
async function heightTexture(url, wrapS) {
  const img = await loadImage(url);
  const w = img.width, h = img.height;
  const tmp = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tmp);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tmp, 0);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tmp);
  let cur = new Float32Array(w * h);
  for (let i = 0, j = 0; i < cur.length; i++, j += 4) cur[i] = (px[j] * 256 + px[j + 1]) * 2 - 10000;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = mipLevels(w, h);
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.R16F, w, h);
  let lw = w, lh = h;
  for (let lvl = 0; lvl < levels; lvl++) {
    gl.texSubImage2D(gl.TEXTURE_2D, lvl, 0, 0, lw, lh, gl.RED, gl.FLOAT, cur);
    if (lvl === levels - 1) break;
    const nw = Math.max(1, lw >> 1), nh = Math.max(1, lh >> 1);
    const nx = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(2 * y, lh - 1) * lw, y1 = Math.min(2 * y + 1, lh - 1) * lw;
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(2 * x, lw - 1), x1 = Math.min(2 * x + 1, lw - 1);
        nx[y * nw + x] = 0.25 * (cur[y0 + x0] + cur[y0 + x1] + cur[y1 + x0] + cur[y1 + x1]);
      }
    }
    cur = nx; lw = nw; lh = nh;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { tex: t, w, h };
}

const patches = {};
let stars = null;

async function loadAssets() {
  const q = pickQuality();
  const jobs = [];
  const step = (p) => p.then((v) => { status.loaded++; return v; });
  status.total = 9;
  status.msg = '달 표면 데이터를 불러오는 중…';
  // fast first light
  const [c2, h2] = await Promise.all([
    step(loadImage(A + 'moon_color_2k.jpg')),
    step(heightTexture(A + 'moon_height_2k.webp', gl.REPEAT)),
  ]);
  T.color = colorTexture(c2);
  T.height = h2.tex; T.heightSize = [h2.w, h2.h];
  status.ready = true;
  jobs.push(step(fetch(A + 'stars_hyg_m65.f32').then((r) => r.arrayBuffer())).then((buf) => {
    const arr = new Float32Array(buf);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);
    stars = { vao, n: arr.length / 4 };
  }));
  jobs.push(step(loadImage(A + 'earth_day_2k.jpg')).then((img) => { T.earthDay = colorTexture(img); }));
  jobs.push(step(loadImage(A + 'earth_clouds_night_2k.jpg')).then((img) => { T.earthCN = colorTexture(img, { srgb: false }); }));
  const meta = await fetch(A + 'patches.json').then((r) => r.json());
  jobs.push(step(heightTexture(A + 'patch_copernicus_h.webp', gl.CLAMP_TO_EDGE)).then((h) => {
    const m = meta.copernicus, r = Math.PI / 180;
    patches.copernicus = { type: 1, h: h.tex, bounds: [m.lon0 * r, m.lon1 * r, m.lat0 * r, m.lat1 * r], texel: ((m.lat1 - m.lat0) * r) / m.h };
  }));
  jobs.push(step(loadImage(A + 'patch_copernicus_c.jpg')).then((img) => { T.patchC = colorTexture(img, { wrapS: gl.CLAMP_TO_EDGE }); }));
  jobs.push(step(heightTexture(A + 'patch_southpole_h.webp', gl.CLAMP_TO_EDGE)).then((h) => {
    const m = meta.southpole;
    patches.southpole = { type: 2, h: h.tex, bounds: [m.rho, 0, 0, 0], texel: (4 * m.rho) / m.w };
  }));
  await Promise.all(jobs);
  // high resolution surface
  status.msg = '고해상도 지형을 올리는 중…';
  const hiColor = q.color === 8 ? 'moon_color_8k.webp' : q.color === 4 ? 'moon_color_4k.webp' : null;
  if (hiColor) {
    const img = await loadImage(A + hiColor);
    const old = T.color; T.color = colorTexture(img, { aniso: 16 }); gl.deleteTexture(old);
  }
  if (q.height === 4) {
    const h4 = await heightTexture(A + 'moon_height_4k.webp', gl.REPEAT);
    const old = T.height; T.height = h4.tex; T.heightSize = [h4.w, h4.h]; gl.deleteTexture(old);
  }
  status.loaded = status.total;
  status.hires = true;
  status.msg = '';
}

function pickQuality() {
  let q = cfg.quality;
  if (q === 'auto') q = isMobile || maxTex < 8192 ? 'low' : 'high';
  const presets = {
    high: { color: 8, height: 4, scale: 1.0, min: 0.5 },
    med: { color: 4, height: 4, scale: 0.8, min: 0.45 },
    low: { color: 4, height: 2, scale: 0.6, min: 0.35 },
  };
  const p = presets[q] || presets.high;
  if (maxTex < 8192 && p.color === 8) p.color = 4;
  return { name: q, ...p };
}

// ------------------------------------------------------------------ render targets
let fbo = null;
function makeTargets(w, h) {
  if (fbo) {
    gl.deleteFramebuffer(fbo.fb); gl.deleteTexture(fbo.col); gl.deleteTexture(fbo.aux);
  }
  const col = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, col);
  const levels = Math.min(8, mipLevels(w, h));
  gl.texStorage2D(gl.TEXTURE_2D, levels, extCBF ? gl.RGBA16F : gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
  const aux = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, aux);
  gl.texStorage2D(gl.TEXTURE_2D, 1, extCBF ? gl.R16F : gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, col, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, aux, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (ok !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete: ' + ok);
  fbo = { fb, col, aux, w, h };
}

// ------------------------------------------------------------------ layout & sizing
let layout = null, layoutDirty = true;
export function markLayoutDirty() { layoutDirty = true; }
let renderScale = 1, quality = null;
function resize() {
  const dprCap = cfg.mode === 'preview' || cfg.mode === 'single' ? 1.5 : 2;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h || layoutDirty) {
    canvas.width = w; canvas.height = h;
    layout = buildLayout(cfg.mode, cfg, w, h);
    layoutDirty = false;
    allocTargets();
    ui && ui.onLayout(layout, dpr);
  }
}
function allocTargets() {
  const w = Math.max(8, Math.round(layout.srcW * renderScale));
  const h = Math.max(8, Math.round(layout.srcH * renderScale));
  if (!fbo || fbo.w !== w || fbo.h !== h) makeTargets(w, h);
}

// ------------------------------------------------------------------ artistic constants
export const ART = {
  alb: [1.5, 1.05, 1.0, 1.0],
  bump: 1.12,
  crater: 1.0,
  rough: 1.0,
  sunI: 1.3,
  skyZen: [0.0026, 0.0042, 0.0098],
  skyHor: [0.0100, 0.0108, 0.0135],
  atmScale: 1.45,
  extMix: 0.55,
  fog: 0.85,
  earthAngR: 2.2,
  bloom: 0.55,
  halation: 0.6,
  grain: 0.012,
  starLim: 3.6,
  starGain: 0.42,
};

// tuning hook: ?a.bump=1.3&a.alb=1.4,1.1,1,1
for (const [k, v] of params) {
  if (!k.startsWith('a.')) continue;
  const key = k.slice(2);
  if (!(key in ART)) continue;
  ART[key] = Array.isArray(ART[key]) ? v.split(',').map(Number) : parseFloat(v);
}

// ------------------------------------------------------------------ frame
let ui = null;
let frameNo = 0, lastNow = 0, ema = 16.7, lastAdjust = 0;
const perf = { fps: 0, scale: 1, ms: 0 };
export function getPerf() { return perf; }

const lockScale = params.has('scale');
const stopAfter = params.has('frames') ? parseInt(params.get('frames'), 10) : 0;
let hiresFrames = 0;
function drawFrame(now) {
  if (stopAfter && status.hires && hiresFrames >= stopAfter) { window.__moon.done = true; return; }
  requestAnimationFrame(drawFrame);
  if (!status.ready || !progMain) return;
  if (status.hires) hiresFrames++;
  resize();
  const t = clock.now();
  const S = stateAt(t);
  const U = deriveUniforms(S);
  frameNo++;

  // ---- dynamic resolution (keeps motion smooth: judder is worse than softness)
  const dt = lastNow ? now - lastNow : 16.7;
  lastNow = now;
  if (dt < 250) ema = ema * 0.94 + dt * 0.06;
  if (lockScale) { /* fixed scale requested (?scale=) */ }
  else if (now - lastAdjust > 2000 && frameNo > 90) {
    if (ema > 19.0 && renderScale > quality.min) { renderScale = Math.max(quality.min, renderScale * 0.88); lastAdjust = now; allocTargets(); }
    else if (ema < 17.4 && renderScale < quality.scale && now - lastAdjust > 9000) { renderScale = Math.min(quality.scale, renderScale * 1.05); lastAdjust = now; allocTargets(); }
  }
  perf.fps = 1000 / ema; perf.scale = renderScale; perf.ms = ema;

  const patch = patches[S.patch];

  // ---- main pass
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.disable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);
  gl.useProgram(progMain.p);
  gl.bindVertexArray(emptyVAO);
  const P = progMain;
  const texUnits = [['tColor', T.color], ['tHeight', T.height], ['tPatchH', patch ? patch.h : T.flatH], ['tPatchC', T.patchC || T.gray], ['tEarthDay', T.earthDay || T.gray], ['tEarthCN', T.earthCN || T.black]];
  texUnits.forEach(([n, tex], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); setI(P, n, i); });
  setU(P, 'uTexH', T.heightSize);
  setI(P, 'uPatchType', patch ? patch.type : 0);
  setU(P, 'uPatchB', patch ? patch.bounds : [0, 0, 0, 0]);
  setU(P, 'uPatchTexel', patch ? patch.texel : 1);
  setU(P, 'uPatchColor', patch && patch.type === 1 && T.patchC ? 1 : 0);
  setU(P, 'uTime', t);
  setU(P, 'uExposure', U.exposure);
  setU(P, 'uGrid', cfg.grid ? 1 : 0);
  setU(P, 'uJitter', [0, 0]);
  for (const k of ['uM', 'uCamB', 'uSunB', 'uEarthB', 'uEarthshine', 'uRelief', 'uLimbSoft', 'uLodBias', 'uMoonDirW', 'uMoonAngR', 'uMoonLum', 'uMoonTint', 'uAtmo', 'uExt', 'uHaze', 'uGlow', 'uClouds', 'uLand', 'uLandSink', 'uRefr', 'uShimmer', 'uStars', 'uPreGlow', 'uEarthVis', 'uEarthDirW', 'uEarthRot', 'uSunW', 'uSunVis']) setU(P, k, U[k]);
  setU(P, 'uMoonVis', 1);
  setU(P, 'uAlb', ART.alb);
  setU(P, 'uBump', ART.bump);
  setU(P, 'uCrater', ART.crater);
  setU(P, 'uRough', ART.rough);
  setU(P, 'uSunI', ART.sunI);
  setU(P, 'uSkyZen', ART.skyZen);
  setU(P, 'uSkyHor', ART.skyHor);
  setU(P, 'uAtmScale', ART.atmScale);
  setU(P, 'uExtMix', ART.extMix);
  setU(P, 'uFog', ART.fog);
  setU(P, 'uCloudOff', [t * 0.0042, t * 0.0011]);
  setU(P, 'uEarthAngR', (ART.earthAngR * Math.PI) / 180);
  setU(P, 'uFocus', 0);
  setU(P, 'uDof', 0);
  const rects = layout.views.map((v) => v.src.map((x) => Math.round(x * renderScale)));
  layout.views.forEach((v, i) => {
    const r = rects[i];
    gl.viewport(r[0], r[1], r[2], r[3]);
    gl.scissor(r[0], r[1], r[2], r[3]);
    setU(P, 'uView', r);
    setU(P, 'uPA', v.geo.pa); setU(P, 'uDU', v.geo.du); setU(P, 'uDV', v.geo.dv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  // ---- stars (real catalogue, additive, masked by the sky visibility in alpha)
  if (stars && U.uStars > 0.005 && U.exposure > 0.001) {
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
    gl.useProgram(progStar.p);
    gl.bindVertexArray(stars.vao);
    const SP = progStar;
    setU(SP, 'uLat', SITE_LAT);
    setU(SP, 'uLST', U.lst);
    setU(SP, 'uLimMag', ART.starLim);
    setU(SP, 'uGain', ART.starGain);
    setU(SP, 'uTime', t);
    setU(SP, 'uExposure', U.exposure);
    setU(SP, 'uExt', U.uExt);
    layout.views.forEach((v, i) => {
      const r = rects[i];
      gl.viewport(r[0], r[1], r[2], r[3]);
      gl.scissor(r[0], r[1], r[2], r[3]);
      setU(SP, 'uPA', v.geo.pa); setU(SP, 'uDU', v.geo.du); setU(SP, 'uDV', v.geo.dv);
      setU(SP, 'uPx', Math.max(0.6, r[3] / 1080));
      gl.drawArrays(gl.POINTS, 0, stars.n);
    });
    gl.disable(gl.BLEND);
  }

  // ---- lens: blur / bloom need mips of the HDR image
  const blurPx = U.blur;
  gl.bindTexture(gl.TEXTURE_2D, fbo.col);
  gl.generateMipmap(gl.TEXTURE_2D);

  // ---- composite to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.drawBuffers([gl.BACK]);
  gl.disable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  gl.useProgram(progComp.p);
  gl.bindVertexArray(emptyVAO);
  const C = progComp;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbo.col); setI(C, 'tHDR', 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbo.aux); setI(C, 'tAux', 1);
  setU(C, 'uSrcSize', [fbo.w, fbo.h]);
  setU(C, 'uBloom', U.bloom);
  setU(C, 'uHalation', U.halation);
  setU(C, 'uVigDir', [0, 0.1, -1]);
  setU(C, 'uVig', U.vig);
  setU(C, 'uGrain', ART.grain);
  setU(C, 'uFrame', frameNo % 65536);
  setU(C, 'uFade', 1);
  layout.views.forEach((v, i) => {
    const r = rects[i];
    const d = v.dst;
    gl.viewport(d[0], d[1], d[2], d[3]);
    gl.scissor(d[0], d[1], d[2], d[3]);
    setU(C, 'uSrcRect', r);
    setU(C, 'uDstRect', d);
    setU(C, 'uBlur', blurPx * (r[3] / 1080));
    setU(C, 'uPA', v.geo.pa); setU(C, 'uDU', v.geo.du); setU(C, 'uDV', v.geo.dv);
    const g = cfg.grade[v.name] || {};
    setU(C, 'uGain', [g.r ?? g.gain ?? 1, g.g ?? g.gain ?? 1, g.b ?? g.gain ?? 1]);
    setU(C, 'uGamma', g.gamma ?? 1);
    setU(C, 'uLift', g.lift ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });
  gl.disable(gl.SCISSOR_TEST);
  if (ui) ui.onFrame(t, S);
}

// ------------------------------------------------------------------ boot
async function boot() {
  ui = initUI({ cfg, clock, status, SCENES, LOOP, sceneAt, saveConfig, broadcast, markLayoutDirty, getPerf, ART, setQuality });
  if (!gl) { ui.fatal(status.error); return; }
  try {
    progMain = program(FULLSCREEN_VS, mainFS());
    progStar = program(STAR_VS, STAR_FS);
    progComp = program(FULLSCREEN_VS, COMPOSITE_FS);
  } catch (e) {
    console.error(e);
    ui.fatal('셰이더 오류: ' + e.message);
    return;
  }
  T.gray = solidTex([128, 128, 128, 255]);
  T.black = solidTex([0, 0, 0, 255]);
  T.flatH = solidTex(null, gl.R16F, gl.RED, gl.FLOAT, new Float32Array([0]));
  quality = pickQuality();
  renderScale = params.has('scale') ? parseFloat(params.get('scale')) : quality.scale;
  clock.init();
  requestAnimationFrame(drawFrame);
  loadAssets().catch((e) => { console.error(e); status.error = String(e.message || e); ui.fatal(status.error); });
}

function setQuality(q) {
  cfg.quality = q;
  quality = pickQuality();
  renderScale = quality.scale;
  allocTargets();
  saveConfig();
}

window.addEventListener('resize', () => { layoutDirty = true; });
window.__moon = { status, clock, cfg, ART, frames: () => frameNo };
boot();
