// Moon — CAVE geometry and screen layouts.
// A wall is described by its lower-left corner (pa) and edge vectors (du, dv)
// relative to the viewer's eye. Ray-tracing through that rectangle gives the
// exact off-axis perspective, so the image is continuous across the corners
// when seen from the sweet spot.

// Each wall carries one 16:9 image, all three the same height and meeting at the corners, so
// the side walls are as long as the front wall is wide and the height follows from the width.
export const SCREEN_ASPECT = 16 / 9;
export const DEFAULT_ROOM = {
  width: 6.0,   // width of each wall's image (m)
  depth: 6.0,   // side wall length (m): = width
  height: 3.375, // projected image height (m): = width × 9/16
  bottom: 0.0,  // image bottom edge above the floor (m)
  eye: 1.6,     // viewer eye height (m)
  vx: 0.0,      // viewer offset from room centre, + = right (m)
  vz: 0.0,      // viewer offset from room centre, + = toward the back (m)
};

// keep the three images 16:9: the side walls and the height follow from the width
export function fitRoom(r) {
  r.depth = r.width;
  r.height = r.width / SCREEN_ASPECT;
  return r;
}

export function roomWalls(r) {
  const y0 = r.bottom - r.eye;
  const W = r.width, D = r.depth, H = r.height;
  return {
    left: { pa: [-W / 2 - r.vx, y0, D / 2 - r.vz], du: [0, 0, -D], dv: [0, H, 0] },
    front: { pa: [-W / 2 - r.vx, y0, -D / 2 - r.vz], du: [W, 0, 0], dv: [0, H, 0] },
    right: { pa: [W / 2 - r.vx, y0, -D / 2 - r.vz], du: [0, 0, D], dv: [0, H, 0] },
  };
}

// Pinhole view for ordinary screens: yaw/pitch in degrees, horizontal FOV.
export function pinhole(yawDeg, pitchDeg, hfovDeg, aspect) {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const fwd = [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
  const right = [Math.cos(y), 0, Math.sin(y)];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const w = 2 * Math.tan((hfovDeg * Math.PI) / 360), h = w / aspect;
  return {
    pa: [fwd[0] - right[0] * w / 2 - up[0] * h / 2, fwd[1] - right[1] * w / 2 - up[1] * h / 2, fwd[2] - right[2] * w / 2 - up[2] * h / 2],
    du: right.map((v) => v * w),
    dv: up.map((v) => v * h),
  };
}

// the largest picture of the given shape that fits the canvas, centred: a window that is not
// the screens' shape (not yet full screen, or a 16:10 display) gets black bars, not a stretch
function fitRect(canvasW, canvasH, aspect) {
  let w = canvasW, h = Math.round(canvasW / aspect);
  if (h > canvasH) { h = canvasH; w = Math.round(canvasH * aspect); }
  return [Math.floor((canvasW - w) / 2), Math.floor((canvasH - h) / 2), w, h];
}

// Build the list of views for a mode.
// Each view: { name, geo:{pa,du,dv}, dst:[x,y,w,h] canvas px (GL origin bottom-left), src:[x,y,w,h] in unit render space }
export function buildLayout(mode, opts, canvasW, canvasH) {
  const walls = roomWalls(opts.room);
  const order = opts.order || ['left', 'front', 'right'];
  const views = [];
  const r = opts.room;
  if (mode === 'span') {
    // one canvas across all projectors, the three images side by side
    const [fx, fy, fw, fh] = fitRect(canvasW, canvasH, (r.width + 2 * r.depth) / r.height);
    let x = 0;
    order.forEach((n, i) => {
      const w = i < order.length - 1 ? Math.round((fw * (n === 'front' ? r.width : r.depth)) / (r.width + 2 * r.depth)) : fw - x;
      views.push({ name: n, geo: walls[n], dst: [fx + x, fy, w, fh], src: [x, 0, w, fh] });
      x += w;
    });
    return { views, srcW: fw, srcH: fh, gaps: fw < canvasW || fh < canvasH };
  }
  if (mode === 'wall') {
    const n = opts.wall || 'front';
    const [fx, fy, fw, fh] = fitRect(canvasW, canvasH, (n === 'front' ? r.width : r.depth) / r.height);
    views.push({ name: n, geo: walls[n], dst: [fx, fy, fw, fh], src: [0, 0, fw, fh] });
    return { views, srcW: fw, srcH: fh, gaps: fw < canvasW || fh < canvasH };
  }
  if (mode === 'single') {
    const g = pinhole(opts.yaw || 0, opts.pitch || 0, opts.fov || 100, canvasW / canvasH);
    views.push({ name: 'single', geo: g, dst: [0, 0, canvasW, canvasH], src: [0, 0, canvasW, canvasH] });
    return { views, srcW: canvasW, srcH: canvasH, gaps: false };
  }
  // preview: three walls unfolded, true proportions, centred with thin gaps
  const widths = order.map((n) => (n === 'front' ? r.width : r.depth));
  const totalM = widths.reduce((a, b) => a + b, 0);
  const gap = Math.max(2, Math.round(canvasW * 0.004));
  const margin = Math.round(Math.min(canvasW, canvasH) * 0.03);
  const availW = canvasW - margin * 2 - gap * 2;
  const availH = canvasH - margin * 2 - Math.round(canvasH * 0.12);
  const scale = Math.min(availW / totalM, availH / r.height);
  const hPx = Math.round(r.height * scale);
  const wPx = widths.map((w) => Math.round(w * scale));
  const total = wPx.reduce((a, b) => a + b, 0) + gap * 2;
  let x = Math.round((canvasW - total) / 2);
  const y = Math.round((canvasH - hPx) / 2 + canvasH * 0.02);
  let sx = 0;
  order.forEach((n, i) => {
    views.push({ name: n, geo: walls[n], dst: [x, y, wPx[i], hPx], src: [sx, 0, wPx[i], hPx] });
    x += wPx[i] + gap;
    sx += wPx[i];
  });
  return { views, srcW: sx, srcH: hPx, gaps: true };
}
