// Moon — real-time moon for a three-wall CAVE.
import { FULLSCREEN_VS, mainFS, STAR_VS, STAR_FS, COMPOSITE_FS } from './shaders.js';
import { TRANSMITTANCE_FS, MULTISCAT_FS, SKYVIEW_FS, TRANS_W, TRANS_H, MS_N } from './atmo.js';
import { NOISE3D_FS, WEATHER_FS, CLOUDSHADOW_FS, SH_N, cloudsFS } from './clouds.js';
import { terrainCacheFS } from './terrain.js';
import { surfCacheFS, surfaceState, SURF_EARTH, SURF_LIGHT } from './surface.js';
import { meteorsAt } from './meteors.js';
import { LOOP, SCENES, stateAt, sceneAt, EYE_ALT, CAM_EN, SURF_T0, SEA_EYE } from './timeline.js';
import { deriveUniforms, SITE_LAT, setMS, warmAtmosphere } from './scene.js';
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
// the screen this window was set to show in the operator panel (kept per window, not shared)
const screen = (() => { try { return sessionStorage.getItem('moon.screen'); } catch { return null; } })();
export const cfg = {
  mode: params.get('mode') || (screen ? (screen === 'all' ? 'span' : 'wall')
    : params.has('cave') ? 'span' : saved.mode || (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || innerWidth < innerHeight * 1.3 ? 'single' : 'preview')),
  wall: params.get('wall') || (screen && screen !== 'all' ? screen : 'front'),
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
  else if (v.length === 9) gl.uniformMatrix3fv(l, false, v);
  else if (v.length === 2) gl.uniform2fv(l, v);
  else if (v.length === 3) gl.uniform3fv(l, v);
  else if (v.length === 4) gl.uniform4fv(l, v);
}
function setI(prog, name, v) { const l = prog.loc[name]; if (l != null) gl.uniform1i(l, v); }
// uniform arrays: kind = 'f', 'v3', 'v4' or 'm3'
function setUA(prog, name, kind, v) {
  const l = prog.loc[name];
  if (l == null) return;
  if (kind === 'f') gl.uniform1fv(l, v);
  else if (kind === 'v3') gl.uniform3fv(l, v);
  else if (kind === 'v4') gl.uniform4fv(l, v);
  else gl.uniformMatrix3fv(l, false, v);
}

let progMain, progStar, progComp, progTrans, progMS, progSky, progNoise, progWeather, progCache, progClouds, progCSh, progSurf;
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
    // CORS request, so textures still load when a host redirects assets to another
    // origin (preview CDNs do); same-origin loads are unaffected
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => res(img)) : res(img));
    img.onerror = () => rej(new Error('failed: ' + url));
    img.src = url;
  });
}
function mipLevels(w, h) { return Math.floor(Math.log2(Math.max(w, h))) + 1; }
function texParams(target, min, wrapS, wrapT) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrapT);
}
function colorTexture(img, { srgb = true, wrapS = gl.REPEAT, aniso = 8 } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texStorage2D(gl.TEXTURE_2D, mipLevels(img.width, img.height), srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, img.width, img.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  texParams(gl.TEXTURE_2D, gl.LINEAR_MIPMAP_LINEAR, wrapS, gl.CLAMP_TO_EDGE);
  if (extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t;
}
// 16-bit heights are packed as (hi, lo) bytes in R,G of a lossless WebP.
// Decode on the GPU side (exact bytes via readPixels), then upload as R16F
// with box-filtered mips built here, since hardware mips of split bytes are wrong.
async function heightTexture(url, wrapS, decode = (v) => v * 2 - 10000) {
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
  for (let i = 0, j = 0; i < cur.length; i++, j += 4) cur[i] = decode(px[j] * 256 + px[j + 1]);
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
  texParams(gl.TEXTURE_2D, gl.LINEAR_MIPMAP_LINEAR, wrapS, gl.CLAMP_TO_EDGE);
  return { tex: t, w, h };
}

// ------------------------------------------------------------------ generated data (GPU)
function target2D(w, h, internal, levels = 1, min = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
  texParams(gl.TEXTURE_2D, min, wrap, wrap === gl.REPEAT ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}
function drawTo(t, prog, setup) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, t.w, t.h);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(prog.p);
  gl.bindVertexArray(emptyVAO);
  setup && setup(prog);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function make3DNoise(size, kind) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texStorage3D(gl.TEXTURE_3D, mipLevels(size, size), gl.RGBA8, size, size, size);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, size, size);
  gl.useProgram(progNoise.p);
  gl.bindVertexArray(emptyVAO);
  setU(progNoise, 'uSize', size);
  setI(progNoise, 'uKind', kind);
  for (let z = 0; z < size; z++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
    setU(progNoise, 'uZ', (z + 0.5) / size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.generateMipmap(gl.TEXTURE_3D);
  return tex;
}

const patches = {};
let stars = null;
let terrainMeta = null;

async function loadAssets() {
  const q = pickQuality();
  const jobs = [];
  const step = (p) => p.then((v) => { status.loaded++; return v; });
  status.total = 13;
  status.msg = '달 표면과 지리산 지형 데이터를 불러오는 중…';
  const terDecode = (v) => v * 0.0625;
  const [c2, h2, tm, tn, tf, mw] = await Promise.all([
    step(loadImage(A + 'moon_color_2k.jpg')),
    step(heightTexture(A + 'moon_height_2k.webp', gl.REPEAT)),
    fetch(A + 'terrain.json').then((r) => r.json()),
    step(heightTexture(A + 'terrain_near.webp', gl.CLAMP_TO_EDGE, terDecode)),
    step(heightTexture(A + 'terrain_far.webp', gl.CLAMP_TO_EDGE, terDecode)),
    step(loadImage(A + 'milkyway_4k.jpg')),
  ]);
  T.color = colorTexture(c2);
  T.height = h2.tex; T.heightSize = [h2.w, h2.h];
  T.terNear = tn.tex; T.terFar = tf.tex;
  terrainMeta = tm;
  T.mw = colorTexture(mw, { srgb: false, aniso: 4 });
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
  status.msg = '고해상도 달 표면을 올리는 중…';
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
    high: { color: 8, height: 4, scale: 1.0, min: 0.5, cache: 1.0 },
    med: { color: 4, height: 4, scale: 0.8, min: 0.45, cache: 0.8 },
    low: { color: 4, height: 2, scale: 0.6, min: 0.35, cache: 0.6 },
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
  texParams(gl.TEXTURE_2D, gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
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
  // half-resolution volumetric buffers (ping-pong for temporal accumulation)
  if (vol) { for (const v of vol.t) { gl.deleteFramebuffer(v.fb); gl.deleteTexture(v.tex); } }
  const vw = Math.max(4, Math.ceil(w / 2)), vh = Math.max(4, Math.ceil(h / 2));
  vol = { t: [target2D(vw, vh, extCBF ? gl.RGBA16F : gl.RGBA8), target2D(vw, vh, extCBF ? gl.RGBA16F : gl.RGBA8)], i: 0, w: vw, h: vh, fresh: true };
}
let vol = null;

// terrain cache: per-wall G-buffer at the layout's native resolution, filled in bands
let cache = null;
function makeCache() {
  if (cache) { gl.deleteFramebuffer(cache.fb); gl.deleteTexture(cache.a); gl.deleteTexture(cache.b); }
  const s = quality.cache;
  const w = Math.max(8, Math.round(layout.srcW * s)), h = Math.max(8, Math.round(layout.srcH * s));
  const a = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, a);
  gl.texStorage2D(gl.TEXTURE_2D, 1, extCBF ? gl.RGBA16F : gl.RGBA8, w, h);
  texParams(gl.TEXTURE_2D, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const b = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, b);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  texParams(gl.TEXTURE_2D, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.clearBufferfv(gl.COLOR, 0, [0, 1, 0, -1]);
  gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const rects = layout.views.map((v) => v.src.map((x) => Math.round(x * s)));
  cache = { fb, a, b, w, h, rects, row: 0, done: false, scale: s };
  makeSurfCache();
}
// the lunar ground seen standing on the moon: same size and layout as the terrain cache
let surf = null;
function makeSurfCache() {
  if (surf) { gl.deleteFramebuffer(surf.fb); gl.deleteTexture(surf.a); gl.deleteTexture(surf.b); }
  const { w, h } = cache;
  const mk = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, extCBF ? gl.RGBA16F : gl.RGBA8, w, h);
    texParams(gl.TEXTURE_2D, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };
  const a = mk(), b = mk();
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, -1]);
  gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  surf = { fb, a, b, row: 0, done: false, eye: null };
}
function stepSurfCache(SS) {
  if (!surf || !cache) return;
  if (surf.eye !== cfg.room.eye) { surf.row = 0; surf.done = false; surf.eye = cfg.room.eye; }
  if (surf.done) return;
  const band = params.has('band') ? parseInt(params.get('band'), 10) : 40;
  gl.bindFramebuffer(gl.FRAMEBUFFER, surf.fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.disable(gl.BLEND);
  gl.useProgram(progSurf.p);
  gl.bindVertexArray(emptyVAO);
  setU(progSurf, 'uSurfLight', SS.light);
  setU(progSurf, 'uSurfBase', SS.base);
  let maxH = 0;
  layout.views.forEach((v, i) => {
    const r = cache.rects[i];
    maxH = Math.max(maxH, r[3]);
    if (surf.row >= r[3]) return;
    gl.viewport(r[0], r[1], r[2], r[3]);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(r[0], r[1] + surf.row, r[2], Math.min(band, r[3] - surf.row));
    setU(progSurf, 'uView', r);
    setU(progSurf, 'uPA', v.geo.pa); setU(progSurf, 'uDU', v.geo.du); setU(progSurf, 'uDV', v.geo.dv);
    setU(progSurf, 'uBand', [surf.row, surf.row + band]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });
  gl.disable(gl.SCISSOR_TEST);
  surf.row += band;
  if (surf.row >= maxH) surf.done = true;
}
function stepCache(S) {
  if (!cache || cache.done || !terrainMeta || !T.terNear) return;
  const band = params.has('band') ? parseInt(params.get('band'), 10) : 40;
  gl.bindFramebuffer(gl.FRAMEBUFFER, cache.fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.disable(gl.BLEND);
  gl.useProgram(progCache.p);
  gl.bindVertexArray(emptyVAO);
  bindTerrain(progCache, 0);
  setU(progCache, 'uCamAlt', S.camAltEye);
  let maxH = 0;
  layout.views.forEach((v, i) => {
    const r = cache.rects[i];
    maxH = Math.max(maxH, r[3]);
    if (cache.row >= r[3]) return;
    gl.viewport(r[0], r[1], r[2], r[3]);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(r[0], r[1] + cache.row, r[2], Math.min(band, r[3] - cache.row));
    setU(progCache, 'uView', r);
    setU(progCache, 'uPA', v.geo.pa); setU(progCache, 'uDU', v.geo.du); setU(progCache, 'uDV', v.geo.dv);
    setU(progCache, 'uBand', [cache.row, cache.row + band]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });
  gl.disable(gl.SCISSOR_TEST);
  cache.row += band;
  if (cache.row >= maxH) cache.done = true;
  status.cache = Math.min(1, cache.row / maxH);
}
function bindTerrain(P, unit0) {
  gl.activeTexture(gl.TEXTURE0 + unit0); gl.bindTexture(gl.TEXTURE_2D, T.terNear); setI(P, 'tTerNear', unit0);
  gl.activeTexture(gl.TEXTURE0 + unit0 + 1); gl.bindTexture(gl.TEXTURE_2D, T.terFar); setI(P, 'tTerFar', unit0 + 1);
  const n = terrainMeta.near, f = terrainMeta.far;
  setU(P, 'uNearB', [n.x0, n.x1, n.y0, n.y1]);
  setU(P, 'uFarB', [f.x0, f.x1, f.y0, f.y1]);
  setU(P, 'uTerTex', [n.n, f.n]);
  setU(P, 'uCamEN', CAM_EN);
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
    makeCache();
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
  extMix: 0.55,
  earthAngR: 2.2,
  grain: 0.012,
  ms: 1.0,
  fogVar: 260,
  cloudBase: 2600,
  cloudTop: 3900,
  earthGain: 0.59,   // the Earth seen from the moon, on the walls (independent of exposure)
  earthLight: 1.0,   // the light it throws on the ground there
  seaGain: 5.0,      // the moon's path on the sea (1 = a mirror image of the disc as shown; more reads as a photograph exposed for the water)
};

// tuning hook: ?a.bump=1.3&a.alb=1.4,1.1,1,1
for (const [k, v] of params) {
  if (!k.startsWith('a.')) continue;
  const key = k.slice(2);
  if (!(key in ART)) continue;
  ART[key] = Array.isArray(ART[key]) ? v.split(',').map(Number) : parseFloat(v);
}
setMS(ART.ms);

// ------------------------------------------------------------------ frame
let ui = null;
let frameNo = 0, lastNow = 0, ema = 16.7, lastAdjust = 0, lastMie = -1, lastEarth = -1, lastCamAlt = -1;
const perf = { fps: 0, scale: 1, ms: 0 };
export function getPerf() { return perf; }

const lockScale = params.has('scale');
// chance of a shooting star starting in second k: [sporadic, shower] (cached per second)
const metCache = new Map();
function metRates(k) {
  let v = metCache.get(k);
  if (!v) {
    const Sk = stateAt(k);
    v = [Sk.meteors, Sk.shower];
    metCache.set(k, v);
    if (metCache.size > 64) metCache.delete(metCache.keys().next().value);
  }
  return v;
}
const stopAfter = params.has('frames') ? parseInt(params.get('frames'), 10) : 0;
let hiresFrames = 0, wantTerrain = true, wantSurf = false;
function drawFrame(now) {
  if (stopAfter && status.hires && hiresFrames >= stopAfter && (!cache || cache.done || !wantTerrain) && (!surf || surf.done || !wantSurf)) { window.__moon.done = true; return; }
  requestAnimationFrame(drawFrame);
  if (!status.ready || !progMain) return;
  if (status.hires) hiresFrames++;
  resize();
  const t = clock.now();
  const S = stateAt(t);
  S.camAltEye = EYE_ALT;
  const U = deriveUniforms(S, stateAt);
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

  const rects = layout.views.map((v) => v.src.map((x) => Math.round(x * renderScale)));
  const earth = U.earthMode;

  // ---- atmosphere LUTs (only on the Earth)
  if (earth) {
    if (Math.abs(S.mie - lastMie) > 0.01) {
      drawTo(T.trans, progTrans, (P) => { setU(P, 'uSize', [T.trans.w, T.trans.h]); setU(P, 'uMie', S.mie); });
      drawTo(T.ms, progMS, (P) => {
        setU(P, 'uSize', [T.ms.w, T.ms.h]); setU(P, 'uMie', S.mie);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.trans.tex); setI(P, 'tTrans', 0);
      });
      lastMie = S.mie;
    }
    drawTo(T.sky, progSky, (P) => {
      setU(P, 'uSize', [T.sky.w, T.sky.h]);
      setU(P, 'uCamAlt', S.camAlt);
      setU(P, 'uSunDir', U.uSunDirW); setU(P, 'uMoonDir', U.uMoonDirW);
      setU(P, 'uSunE', U.uSunE); setU(P, 'uMoonE', U.uMoonE);
      setU(P, 'uMS', ART.ms); setU(P, 'uMie', S.mie);
      setU(P, 'uAirglow', U.uAirglow);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.trans.tex); setI(P, 'tTrans', 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.ms.tex); setI(P, 'tMS', 1);
    });
    gl.bindTexture(gl.TEXTURE_2D, T.sky.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (U.terrainValid) stepCache(S);
  }
  const terrainReady = earth && U.terrainValid && cache && cache.done && !params.has('noterrain');
  wantTerrain = earth && U.terrainValid;
  // standing on the moon: the rabbits, and the ground (built once, while the screen is dark,
  // and lit every frame for the Earth's height)
  const onMoon = !earth && S.surfaceMode;
  wantSurf = onMoon;
  const SS = onMoon ? { ...surfaceState(S.t - SURF_T0, cfg.room.eye, S.earthEl), light: U.surfLight } : null;
  if (onMoon) stepSurfCache(SS);

  // ---- volumetric fog and clouds (half resolution, accumulated over frames)
  const volOn = earth && (S.fogDens > 1e-5 || S.cloudCov > 0.01) && !params.has('nocloud');
  const setCloudU = (C) => {
    gl.activeTexture(gl.TEXTURE0 + 6); gl.bindTexture(gl.TEXTURE_3D, T.shape); setI(C, 'tShape', 6);
    gl.activeTexture(gl.TEXTURE0 + 7); gl.bindTexture(gl.TEXTURE_3D, T.detail); setI(C, 'tDetail', 7);
    gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, T.weather.tex); setI(C, 'tWeather', 2);
    setU(C, 'uTime', t);
    setU(C, 'uKeyDir', U.keyLight);
    setU(C, 'uCloudBase', ART.cloudBase); setU(C, 'uCloudTop', ART.cloudTop);
    setU(C, 'uCloudCov', S.cloudCov); setU(C, 'uCloudDens', S.cloudDens);
    setU(C, 'uWind', [S.windX, S.windX * 0.35]);
    setU(C, 'uColumn', S.column);
  };
  // ---- shadow of the cloud deck toward the key light (for the mountains)
  if (volOn && S.cloudCov > 0.01) {
    drawTo(T.csh, progCSh, (P) => setCloudU(P));
  } else if (earth && !T.cshClear) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.csh.fb);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  T.cshClear = !(volOn && S.cloudCov > 0.01);
  if (volOn) {
    const cur = vol.t[vol.i], hist = vol.t[1 - vol.i];
    let taa = 0.86;
    if (vol.fresh || lastEarth !== 1 || Math.abs(S.camAlt - lastCamAlt) > 400) taa = 0;
    else if (Math.abs(S.camAlt - lastCamAlt) > 1) taa = 0.55;
    vol.fresh = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.useProgram(progClouds.p);
    gl.bindVertexArray(emptyVAO);
    const C = progClouds;
    const units = [['tTrans', T.trans.tex], ['tSkyView', T.sky.tex], ['tWeather', T.weather.tex], ['tHist', hist.tex], ['tCacheA', cache.a], ['tCacheB', cache.b]];
    units.forEach(([n, tex], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); setI(C, n, i); });
    setCloudU(C);
    bindTerrain(C, 8);
    setU(C, 'uHistSize', [vol.w, vol.h]);
    setU(C, 'uTAA', taa);
    setU(C, 'uFrame', frameNo % 4096);
    setU(C, 'uCamAlt', S.camAlt);
    setU(C, 'uMie', S.mie);
    setU(C, 'uSunDir', U.uSunDirW); setU(C, 'uMoonDir', U.uMoonDirW);
    setU(C, 'uSunE', U.uSunE); setU(C, 'uMoonE', U.uMoonE);
    setU(C, 'uFogTop', S.fogTop); setU(C, 'uFogVar', ART.fogVar); setU(C, 'uFogDens', S.fogDens);
    setU(C, 'uTerrain', terrainReady ? 1 : 0);
    setU(C, 'uCacheSize', [cache.w, cache.h]);
    setU(C, 'uAurMax', U.aurMax);
    layout.views.forEach((v, i) => {
      const r = rects[i].map((x) => Math.round(x / 2));
      gl.viewport(r[0], r[1], r[2], r[3]);
      gl.scissor(r[0], r[1], r[2], r[3]);
      setU(C, 'uView', r);
      setU(C, 'uCacheRect', cache.rects[i]);
      setU(C, 'uPA', v.geo.pa); setU(C, 'uDU', v.geo.du); setU(C, 'uDV', v.geo.dv);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.disable(gl.SCISSOR_TEST);
  }
  lastEarth = earth ? 1 : 0;
  lastCamAlt = S.camAlt;

  // ---- main pass
  const patch = patches[S.patch];
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.disable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);
  gl.useProgram(progMain.p);
  gl.bindVertexArray(emptyVAO);
  const P = progMain;
  const volTex = volOn ? vol.t[vol.i].tex : T.black;
  const texUnits = [
    ['tColor', T.color], ['tHeight', T.height], ['tPatchH', patch ? patch.h : T.flatH], ['tPatchC', T.patchC || T.gray],
    ['tEarthDay', T.earthDay || T.gray], ['tEarthCN', T.earthCN || T.black], ['tTrans', T.trans.tex], ['tSkyView', T.sky.tex],
    ['tMW', T.mw || T.black], ['tCacheA', onMoon ? surf.a : cache.a], ['tCacheB', onMoon ? surf.b : cache.b], ['tVol', volTex], ['tCloudSh', T.csh.tex],
  ];
  texUnits.forEach(([n, tex], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); setI(P, n, i); });
  bindTerrain(P, texUnits.length);
  setU(P, 'uTexH', T.heightSize);
  setI(P, 'uPatchType', patch ? patch.type : 0);
  setU(P, 'uPatchB', patch ? patch.bounds : [0, 0, 0, 0]);
  setU(P, 'uPatchTexel', patch ? patch.texel : 1);
  setU(P, 'uPatchColor', patch && patch.type === 1 && T.patchC ? 1 : 0);
  setU(P, 'uTime', t);
  setU(P, 'uExposure', U.exposure);
  setU(P, 'uGrid', cfg.grid ? 1 : 0);
  setU(P, 'uJitter', [0, 0]);
  for (const k of ['uM', 'uCamB', 'uSunB', 'uEarthB', 'uEarthshine', 'uRelief', 'uLimbSoft', 'uLodBias', 'uMoonDirW', 'uMoonAngR', 'uMoonLum', 'uMoonTint',
    'uGlow', 'uRefr', 'uShimmer', 'uStars', 'uEarthVis', 'uEarthDirW', 'uEarthRot', 'uSunW', 'uSunVis', 'uEclC', 'uEcl', 'uEarth', 'uCamAlt', 'uMie',
    'uSunDirW', 'uSunE', 'uMoonE', 'uMoonScale', 'uMWGain', 'uAbsScale']) setU(P, k, U[k]);
  setU(P, 'uLST', U.lst);
  setU(P, 'uKeyDirW', U.keyLight);
  setU(P, 'uKeyMoon', U.keyLight === U.uMoonDirW ? 1 : 0);
  setU(P, 'uLat', SITE_LAT);
  setU(P, 'uTerrain', terrainReady ? 1 : 0);
  setU(P, 'uCacheSize', [cache.w, cache.h]);
  setU(P, 'uSurface', onMoon ? 1 : 0);
  // shooting stars (worked out from the clock, so every window has the same ones)
  const MET = earth ? meteorsAt(t, metRates) : null;
  setI(P, 'uMetN', MET ? MET.n : 0);
  if (MET && MET.n > 0) { setUA(P, 'uMetH', 'v4', MET.H); setUA(P, 'uMetT', 'v4', MET.T); }
  setU(P, 'uMetGain', S.fade);
  setU(P, 'uSea', earth && S.seaMode ? 1 : 0);
  setU(P, 'uSeaH', SEA_EYE);
  setU(P, 'uSeaGain', ART.seaGain);
  setU(P, 'uEarthGain', onMoon ? ART.earthGain / Math.pow(2, S.ev) : 1);
  if (onMoon) {
    setU(P, 'uSurfLight', SS.light);
    setU(P, 'uSurfLightC', SURF_LIGHT.map((c) => c * ART.earthLight));
    setU(P, 'uSurfLightR', (SURF_EARTH.radius * Math.PI) / 180);
    setU(P, 'uSurfAmb', SS.amb);
    setI(P, 'uRabN', params.has('norabbits') ? 0 : SS.n);
    setUA(P, 'uRabP', 'v4', SS.P);
    setUA(P, 'uRabQ', 'v4', SS.Q);
    setUA(P, 'uRabR', 'v4', SS.R);
  }
  setU(P, 'uVolOn', volOn ? 1 : 0);
  setU(P, 'uVolSize', [vol.w, vol.h]);
  setU(P, 'uMoonVis', 1);
  setU(P, 'uAlb', ART.alb);
  setU(P, 'uBump', ART.bump);
  setU(P, 'uCrater', ART.crater);
  setU(P, 'uRough', ART.rough);
  setU(P, 'uSunI', ART.sunI);
  setU(P, 'uExtMix', ART.extMix);
  setU(P, 'uEarthAngR', ((onMoon ? SURF_EARTH.radius : ART.earthAngR) * Math.PI) / 180);
  const G = U.ghosts;
  setI(P, 'uGhostN', earth ? 0 : G.n);
  if (!earth && G.n > 0) {
    setUA(P, 'uGhost', 'v4', G.dir);
    setUA(P, 'uGhostM', 'm3', G.M);
    setUA(P, 'uGhostSun', 'v3', G.sun);
    setUA(P, 'uGhostES', 'f', G.es);
  }
  setU(P, 'uFocus', 0);
  setU(P, 'uDof', 0);
  layout.views.forEach((v, i) => {
    const r = rects[i];
    gl.viewport(r[0], r[1], r[2], r[3]);
    gl.scissor(r[0], r[1], r[2], r[3]);
    setU(P, 'uView', r);
    setU(P, 'uCacheRect', cache.rects[i]);
    setU(P, 'uVolRect', r.map((x) => Math.round(x / 2)));
    setU(P, 'uPA', v.geo.pa); setU(P, 'uDU', v.geo.du); setU(P, 'uDV', v.geo.dv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });
  if (volOn) vol.i = 1 - vol.i;

  // ---- stars (real catalogue, additive, masked by the sky visibility in alpha)
  if (stars && U.starGain > 0) {
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
    gl.useProgram(progStar.p);
    gl.bindVertexArray(stars.vao);
    const SP = progStar;
    setU(SP, 'uLat', SITE_LAT);
    setU(SP, 'uLST', U.lst);
    setU(SP, 'uGain', U.starGain);
    setU(SP, 'uTime', t);
    setU(SP, 'uExt', earth ? S.mie : 0);
    setU(SP, 'uTwinkle', earth ? S.twinkle : 0);
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
  const CP = progComp;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbo.col); setI(CP, 'tHDR', 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbo.aux); setI(CP, 'tAux', 1);
  setU(CP, 'uSrcSize', [fbo.w, fbo.h]);
  setU(CP, 'uBloom', U.bloom);
  setU(CP, 'uHalation', U.halation);
  setU(CP, 'uVigDir', [0, 0.1, -1]);
  setU(CP, 'uVig', U.vig);
  setU(CP, 'uGrain', ART.grain);
  setU(CP, 'uFrame', frameNo % 65536);
  setU(CP, 'uFade', 1);
  layout.views.forEach((v, i) => {
    const r = rects[i];
    const d = v.dst;
    gl.viewport(d[0], d[1], d[2], d[3]);
    gl.scissor(d[0], d[1], d[2], d[3]);
    setU(CP, 'uSrcRect', r);
    setU(CP, 'uDstRect', d);
    setU(CP, 'uBlur', U.blur * (r[3] / 1080));
    setU(CP, 'uPA', v.geo.pa); setU(CP, 'uDU', v.geo.du); setU(CP, 'uDV', v.geo.dv);
    const g = cfg.grade[v.name] || {};
    setU(CP, 'uGain', [g.r ?? g.gain ?? 1, g.g ?? g.gain ?? 1, g.b ?? g.gain ?? 1]);
    setU(CP, 'uGamma', g.gamma ?? 1);
    setU(CP, 'uLift', g.lift ?? 0);
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
    progTrans = program(FULLSCREEN_VS, TRANSMITTANCE_FS);
    progMS = program(FULLSCREEN_VS, MULTISCAT_FS);
    progSky = program(FULLSCREEN_VS, SKYVIEW_FS);
    progNoise = program(FULLSCREEN_VS, NOISE3D_FS);
    progWeather = program(FULLSCREEN_VS, WEATHER_FS);
    progCache = program(FULLSCREEN_VS, terrainCacheFS());
    progClouds = program(FULLSCREEN_VS, cloudsFS());
    progCSh = program(FULLSCREEN_VS, CLOUDSHADOW_FS);
    progSurf = program(FULLSCREEN_VS, surfCacheFS());
  } catch (e) {
    console.error(e);
    ui.fatal('셰이더 오류: ' + e.message);
    return;
  }
  T.gray = solidTex([128, 128, 128, 255]);
  T.black = solidTex([0, 0, 0, 255]);
  T.flatH = solidTex(null, gl.R16F, gl.RED, gl.FLOAT, new Float32Array([0]));
  const hdr = extCBF ? gl.RGBA16F : gl.RGBA8;
  T.trans = target2D(TRANS_W, TRANS_H, hdr);
  T.ms = target2D(MS_N, MS_N, hdr);
  T.csh = target2D(SH_N, SH_N, hdr, 1, gl.LINEAR, gl.CLAMP_TO_EDGE);
  T.sky = target2D(384, 192, hdr, 8, gl.LINEAR_MIPMAP_LINEAR, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, T.sky.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  T.weather = target2D(512, 512, gl.RGBA8, mipLevels(512, 512), gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
  drawTo(T.weather, progWeather, (P) => setU(P, 'uSize', 512));
  gl.bindTexture(gl.TEXTURE_2D, T.weather.tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  T.shape = make3DNoise(params.has('small3d') ? 32 : 128, 0);
  T.detail = make3DNoise(32, 1);
  quality = pickQuality();
  renderScale = params.has('scale') ? parseFloat(params.get('scale')) : quality.scale;
  clock.init();
  warmAtmosphere();
  requestAnimationFrame(drawFrame);
  loadAssets().catch((e) => { console.error(e); status.error = String(e.message || e); ui.fatal(status.error); });
}

function setQuality(q) {
  cfg.quality = q;
  quality = pickQuality();
  renderScale = quality.scale;
  allocTargets();
  makeCache();
  saveConfig();
}

window.addEventListener('resize', () => { layoutDirty = true; });
window.__moon = { status, clock, cfg, ART, frames: () => frameNo, cache: () => cache, surf: () => surf };
boot();
