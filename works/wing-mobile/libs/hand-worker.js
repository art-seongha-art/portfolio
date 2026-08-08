// 손 인식과 몸 실루엣을 화면 스레드 밖으로 뺀다.
//
// detectForVideo 는 동기 호출이라 부르는 스레드를 통째로 막는다. 폰에서 CPU 로 돌면
// 한 번에 수십 밀리초라, 화면 스레드에서 부르면 손이 들어온 순간 60fps 가 10대로 떨어진다.
// 간격을 띄워 막으면 이번엔 초당 예닐곱 번만 보게 되어 **빠른 손짓의 속도를 못 잰다** —
// 후려치기가 안 먹는 이유가 그것이다.
//
// 여기서 돌리면 인식이 아무리 오래 걸려도 화면은 멈추지 않으므로, 간격을 띄울 이유가 없다.
// 쉬지 않고 돌려 잴 수 있는 만큼 촘촘히 잰다.

// **고전 워커**여야 한다. 모듈 워커로 만들면 미디어파이프가 wasm 접착 코드를 불러올 때
// 쓰는 importScripts 가 막혀 "Module scripts don't support importScripts()" 로 죽는다.
// 고전 워커에서도 동적 import 는 되므로 번들은 이렇게 불러온다.
let 인식 = null, 몸인식 = null;
let HandLandmarker = null, ImageSegmenter = null, FilesetResolver = null;
let 파일셋 = null;

// 몸 실루엣은 **잘게 줄여서** 보낸다. 원본 마스크는 256×256(65 KB)이지만 우리가 쓰는 건
// "이 높이에서 몸이 가로로 어디부터 어디까지인가" 뿐이라 이 정도면 남는다.
// 5 KB 라 옮기는 값이 사실상 공짜다.
const 격자W = 96, 격자H = 54;
const 격자 = new Uint8Array(격자W * 격자H);

async function 번들불러오기() {
  if (HandLandmarker) return;
  const m = await import('./mediapipe/vision_bundle.mjs');
  HandLandmarker = m.HandLandmarker;
  ImageSegmenter = m.ImageSegmenter;
  FilesetResolver = m.FilesetResolver;
}

async function 파일셋얻기(wasm) {
  if (!파일셋) 파일셋 = await FilesetResolver.forVisionTasks(wasm);
  return 파일셋;
}

// 마스크(W×H, 0=배경 1=사람) 를 격자로 줄인다.
// 칸마다 4×4 만 찍어 본다 — 원본 크기와 무관하게 비용이 고정되고,
// 0~16 단계의 **덮인 정도**가 나와 가장자리가 부드러워진다(이진값이면 밀기가 톡톡 끊긴다).
function 격자로줄이기(마스크, W, H) {
  for (let gy = 0; gy < 격자H; gy++) {
    const y0 = (gy * H / 격자H) | 0, y1 = (((gy + 1) * H / 격자H) | 0) || y0 + 1;
    const dy = Math.max(1, (y1 - y0) >> 2);
    for (let gx = 0; gx < 격자W; gx++) {
      const x0 = (gx * W / 격자W) | 0, x1 = (((gx + 1) * W / 격자W) | 0) || x0 + 1;
      const dx = Math.max(1, (x1 - x0) >> 2);
      let 셈 = 0, 전부 = 0;
      for (let y = y0; y < y1; y += dy) {
        const 줄 = y * W;
        for (let x = x0; x < x1; x += dx) { 전부++; if (마스크[줄 + x]) 셈++; }
      }
      격자[gy * 격자W + gx] = 전부 ? ((셈 * 255 / 전부) | 0) : 0;
    }
  }
}

self.onmessage = async (e) => {
  const m = e.data;

  if (m.종류 === '준비') {
    try {
      await 번들불러오기();
      const fs = await 파일셋얻기(m.wasm);
      인식 = await HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: m.모델, delegate: m.델리게이트 },
        numHands: m.손수, runningMode: 'VIDEO',
      });
      self.postMessage({ 종류: '준비됨', 델리게이트: m.델리게이트 });
    } catch (err) {
      self.postMessage({ 종류: '실패', 왜: String(err?.message || err?.name || err) });
    }
    return;
  }

  // 몸은 따로 세운다. 손 모드에서는 아예 만들지 않아야 그만큼 가볍다
  if (m.종류 === '몸준비') {
    try {
      await 번들불러오기();
      const fs = await 파일셋얻기(m.wasm);
      몸인식 = await ImageSegmenter.createFromOptions(fs, {
        baseOptions: { modelAssetPath: m.모델, delegate: m.델리게이트 },
        runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
      });
      self.postMessage({ 종류: '몸준비됨', 델리게이트: m.델리게이트 });
    } catch (err) {
      self.postMessage({ 종류: '몸실패', 왜: String(err?.message || err?.name || err) });
    }
    return;
  }

  if (m.종류 === '프레임') {
    const 손볼까 = m.손 && !!인식, 몸볼까 = m.몸 && !!몸인식;
    if (!손볼까 && !몸볼까) { m.그림?.close?.(); return; }
    const t0 = performance.now();
    let 결과 = null, 오류 = '', 몸잡힘 = false;

    if (손볼까) {
      try { 결과 = 인식.detectForVideo(m.그림, m.시각); }
      catch (err) { 오류 = String(err?.message || err?.name || err).slice(0, 90); }
    }
    if (몸볼까) {
      try {
        // 결과는 콜백 안에서만 살아 있다. 여기서 다 베껴 놓아야 한다
        몸인식.segmentForVideo(m.그림, m.시각, r => {
          const 마스크 = r?.categoryMask;
          if (!마스크) return;
          const 값 = 마스크.getAsUint8Array();
          격자로줄이기(값, 마스크.width, 마스크.height);
          몸잡힘 = true;
          마스크.close?.();
        });
      } catch (err) { if (!오류) 오류 = '몸 ' + String(err?.message || err?.name || err).slice(0, 80); }
    }

    m.그림?.close?.();                       // 넘겨받은 그림은 여기서 반드시 놓아준다

    // 미디어파이프가 주는 객체를 그대로 보내면 구조화 복제에서 걸린다. 숫자만 옮긴다
    const 손들 = [];
    for (const lm of (결과?.landmarks || [])) {
      const 점들 = new Float32Array(lm.length * 2);
      for (let i = 0; i < lm.length; i++) { 점들[i*2] = lm[i].x; 점들[i*2+1] = lm[i].y; }
      손들.push(점들);
    }
    const 몸격자 = 몸잡힘 ? 격자.slice() : null;
    const 옮길것 = 손들.map(a => a.buffer);
    if (몸격자) 옮길것.push(몸격자.buffer);
    self.postMessage(
      { 종류: '결과', 손들, 몸격자, 격자W, 격자H,
        걸림: performance.now() - t0, 오류, 시각: m.시각, 손봄: 손볼까 },
      옮길것,
    );
  }
};
