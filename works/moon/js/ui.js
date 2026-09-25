// Moon — overlay, HUD and operator panel.

const $ = (s) => document.querySelector(s);
const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function initUI(ctx) {
  const { cfg, clock, status, SCENES, LOOP, sceneAt, saveConfig, broadcast, markLayoutDirty, getPerf, setQuality } = ctx;
  const body = document.body;
  body.dataset.mode = cfg.mode;
  const overlay = $('#overlay');
  const hud = $('#hud');
  const panel = $('#panel');
  const loading = $('#loading');
  const labels = $('#labels');
  let idleTimer = 0;
  let lastSceneId = '';

  // ---------------------------------------------------------- title card
  let installMode = cfg.mode === 'span' || cfg.mode === 'wall';
  if (installMode || !cfg.ui) overlay.hidden = true;
  else body.classList.add('titled');
  if (!cfg.ui) body.classList.add('clean');
  $('#btn-start')?.addEventListener('click', () => {
    overlay.classList.add('gone');
    body.classList.remove('titled');
    setTimeout(() => (overlay.hidden = true), 1400);
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  });
  const dismiss = () => { overlay.classList.add('gone'); body.classList.remove('titled'); setTimeout(() => (overlay.hidden = true), 1400); };
  $('#btn-single')?.addEventListener('click', () => { setMode('single'); dismiss(); });
  $('#btn-preview')?.addEventListener('click', () => { setMode('preview'); dismiss(); });

  function setMode(m) {
    cfg.mode = m;
    body.dataset.mode = m;
    markLayoutDirty();
    saveConfig();
    syncPanel();
  }

  // ---------------------------------------------------------- wall labels (preview)
  function onLayout(layout, dpr) {
    labels.innerHTML = '';
    if (cfg.mode !== 'preview') return;
    const names = { left: '왼쪽 벽 · LEFT', front: '정면 · FRONT', right: '오른쪽 벽 · RIGHT' };
    const H = document.getElementById('c').height;
    for (const v of layout.views) {
      const [x, y, w] = v.dst;
      const d = document.createElement('div');
      d.className = 'wall-label';
      d.textContent = names[v.name] || v.name;
      d.style.left = `${x / dpr}px`;
      d.style.width = `${w / dpr}px`;
      d.style.top = `${(H - y) / dpr + 8}px`;
      labels.appendChild(d);
    }
  }

  // ---------------------------------------------------------- HUD & loading
  function onFrame(t, S) {
    const sc = sceneAt(t);
    if (sc.id !== lastSceneId) {
      lastSceneId = sc.id;
      $('#hud-scene').textContent = sc.ko;
      $('#hud-scene-en').textContent = sc.en;
      if (!installMode) { hud.classList.add('show'); clearTimeout(hud._t); hud._t = setTimeout(() => hud.classList.remove('show'), 6000); }
    }
    $('#hud-time').textContent = `${fmt(t)} / ${fmt(LOOP)}`;
    if (!panel.hidden) {
      const p = getPerf();
      $('#pf').textContent = `${p.fps.toFixed(0)} fps · 해상도 ${(p.scale * 100).toFixed(0)}% · ${clock.paused ? '일시정지' : '×' + clock.speed}`;
      const sl = $('#p-time');
      if (document.activeElement !== sl) sl.value = String(t);
      $('#p-time-v').textContent = fmt(t);
    }
    if (status.ready && loading && !status.error) {
      if (status.hires) loading.classList.add('done');
      const pct = Math.round((status.loaded / status.total) * 100);
      $('#loading-bar').style.width = `${pct}%`;
      $('#loading-msg').textContent = status.msg || '';
    }
  }

  function fatal(msg) {
    loading.classList.remove('done');
    loading.classList.add('error');
    $('#loading-msg').textContent = msg;
  }

  // ---------------------------------------------------------- operator panel
  const sceneBox = $('#p-scenes');
  SCENES.forEach((s) => {
    const b = document.createElement('button');
    b.textContent = s.ko;
    b.title = s.en;
    b.onclick = () => clock.seek(s.t + 0.01);
    sceneBox.appendChild(b);
  });
  const slider = $('#p-time');
  slider.max = String(LOOP);
  slider.addEventListener('input', () => clock.seek(parseFloat(slider.value)));
  $('#p-play').onclick = () => clock.togglePause();
  $('#p-speed').onchange = (e) => clock.setSpeed(parseFloat(e.target.value));
  $('#p-mode').onchange = (e) => setMode(e.target.value);
  $('#p-quality').onchange = (e) => setQuality(e.target.value);
  $('#p-grid').onchange = (e) => { cfg.grid = e.target.checked; broadcast({ type: 'grid', on: cfg.grid }); };
  $('#p-order').onchange = (e) => { cfg.order = e.target.value.split(','); markLayoutDirty(); saveConfig(); broadcast({ type: 'config', order: cfg.order }); };
  const roomKeys = ['width', 'depth', 'height', 'bottom', 'eye', 'vx', 'vz'];
  roomKeys.forEach((k) => {
    const el = $(`#r-${k}`);
    el.addEventListener('change', () => {
      cfg.room[k] = parseFloat(el.value);
      markLayoutDirty(); saveConfig(); broadcast({ type: 'config', room: cfg.room });
    });
  });
  ['left', 'front', 'right'].forEach((w) => {
    ['gain', 'gamma', 'lift'].forEach((k) => {
      const el = $(`#g-${w}-${k}`);
      el.addEventListener('input', () => {
        cfg.grade[w] = cfg.grade[w] || {};
        cfg.grade[w][k] = parseFloat(el.value);
        saveConfig(); broadcast({ type: 'config', grade: cfg.grade });
      });
    });
  });
  // which screen this window shows: 1 = left wall, 2 = front, 3 = right, each filling the
  // window, or all three side by side. One window per monitor (projector): pick its number
  // in that window. Kept per window (and in the address), shared clock.
  $('#p-screen').querySelectorAll('button').forEach((b) => { b.onclick = () => showScreen(b.dataset.w); });
  function showScreen(w) {
    const url = new URL(location.href);
    if (w === 'all') { cfg.mode = 'span'; url.searchParams.delete('wall'); }
    else { cfg.mode = 'wall'; cfg.wall = w; url.searchParams.set('wall', w); }
    url.searchParams.set('mode', cfg.mode);
    ['t', 'pause'].forEach((k) => url.searchParams.delete(k));
    history.replaceState(null, '', url);
    try { sessionStorage.setItem('moon.screen', w); } catch {}
    body.dataset.mode = cfg.mode;
    installMode = true;
    // installation windows run on the wall clock, so separate windows show the same moment
    if (cfg.clock !== 'wall') { cfg.clock = 'wall'; clock.init(); }
    overlay.hidden = true;
    body.classList.remove('titled');
    hud.classList.remove('show');
    markLayoutDirty();
    togglePanel(false);
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  }
  $('#p-open-walls').onclick = () => {
    const base = location.pathname;
    ['left', 'front', 'right'].forEach((w, i) => window.open(`${base}?mode=wall&wall=${w}`, `moon-${w}`, `popup,left=${i * 60},top=${i * 40},width=960,height=540`));
  };
  $('#p-close').onclick = () => togglePanel(false);
  $('#gear').onclick = () => togglePanel();

  function syncPanel() {
    $('#p-mode').value = cfg.mode;
    $('#p-screen').querySelectorAll('button').forEach((b) => b.classList.toggle('on',
      cfg.mode === 'wall' ? b.dataset.w === cfg.wall : cfg.mode === 'span' && b.dataset.w === 'all'));
    $('#p-quality').value = cfg.quality;
    $('#p-grid').checked = cfg.grid;
    $('#p-order').value = cfg.order.join(',');
    roomKeys.forEach((k) => ($(`#r-${k}`).value = cfg.room[k]));
    ['left', 'front', 'right'].forEach((w) => ['gain', 'gamma', 'lift'].forEach((k) => {
      const g = cfg.grade[w] || {};
      $(`#g-${w}-${k}`).value = g[k] ?? (k === 'lift' ? 0 : 1);
    }));
    $('#p-speed').value = String(clock.speed);
  }
  function togglePanel(on) {
    panel.hidden = on === undefined ? !panel.hidden : !on;
    if (!panel.hidden) syncPanel();
  }

  // ---------------------------------------------------------- keyboard & idle cursor
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key;
    if (k === ' ') { clock.togglePause(); e.preventDefault(); }
    else if (k === 'ArrowRight') clock.seek(clock.now() + (e.shiftKey ? 60 : 10));
    else if (k === 'ArrowLeft') clock.seek(clock.now() - (e.shiftKey ? 60 : 10));
    else if (k === 'p' || k === 'P') togglePanel();
    else if (k === 'g' || k === 'G') { cfg.grid = !cfg.grid; broadcast({ type: 'grid', on: cfg.grid }); syncPanel(); }
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
    } else if (k === 'h' || k === 'H') body.classList.toggle('clean');
    else if (/^[0-9-]$/.test(k)) {
      // scenes: 1-9, then 0 and - for the tenth and eleventh
      const i = k === '0' ? 9 : k === '-' ? 10 : +k - 1;
      if (SCENES[i]) clock.seek(SCENES[i].t + 0.01);
    }
    else if (k === ']') clock.setSpeed(Math.min(32, clock.speed * 2));
    else if (k === '[') clock.setSpeed(Math.max(0.25, clock.speed / 2));
    else if (k === '=') clock.setSpeed(1);
  });
  const wake = () => {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => body.classList.add('idle'), 2500);
  };
  window.addEventListener('mousemove', wake);
  window.addEventListener('touchstart', wake, { passive: true });
  wake();

  // single view: drag to look around
  if (true) {
    let drag = null;
    const cv = document.getElementById('c');
    cv.addEventListener('pointerdown', (e) => { if (cfg.mode === 'single') { drag = { x: e.clientX, y: e.clientY, yaw: cfg.yaw, pitch: cfg.pitch }; cv.setPointerCapture(e.pointerId); } });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const s = cfg.fov / cv.clientWidth;
      cfg.yaw = Math.max(-135, Math.min(135, drag.yaw - (e.clientX - drag.x) * s));
      cfg.pitch = Math.max(-60, Math.min(60, drag.pitch + (e.clientY - drag.y) * s));
      markLayoutDirty();
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      if (cfg.mode !== 'single') return;
      cfg.fov = Math.max(40, Math.min(150, cfg.fov * (e.deltaY > 0 ? 1.05 : 0.95)));
      markLayoutDirty();
      e.preventDefault();
    }, { passive: false });
  }

  syncPanel();
  if (new URLSearchParams(location.search).has('panel')) togglePanel(true);
  return { onLayout, onFrame, fatal };
}
