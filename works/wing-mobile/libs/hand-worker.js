// 손 인식을 화면 스레드 밖으로 뺀다.
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
let 인식 = null, HandLandmarker = null, FilesetResolver = null;

async function 번들불러오기() {
  if (HandLandmarker) return;
  const m = await import('./mediapipe/vision_bundle.mjs');
  HandLandmarker = m.HandLandmarker; FilesetResolver = m.FilesetResolver;
}

self.onmessage = async (e) => {
  const m = e.data;

  if (m.종류 === '준비') {
    try {
      await 번들불러오기();
      const fs = await FilesetResolver.forVisionTasks(m.wasm);
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

  if (m.종류 === '프레임') {
    if (!인식) { m.그림?.close?.(); return; }
    const t0 = performance.now();
    let 결과 = null, 오류 = '';
    try {
      결과 = 인식.detectForVideo(m.그림, m.시각);
    } catch (err) {
      오류 = String(err?.message || err?.name || err).slice(0, 90);
    }
    m.그림?.close?.();                       // 넘겨받은 그림은 여기서 반드시 놓아준다
    // 미디어파이프가 주는 객체를 그대로 보내면 구조화 복제에서 걸린다. 숫자만 옮긴다
    const 손들 = [];
    for (const lm of (결과?.landmarks || [])) {
      const 점들 = new Float32Array(lm.length * 2);
      for (let i = 0; i < lm.length; i++) { 점들[i*2] = lm[i].x; 점들[i*2+1] = lm[i].y; }
      손들.push(점들);
    }
    self.postMessage(
      { 종류: '결과', 손들, 걸림: performance.now() - t0, 오류, 시각: m.시각 },
      손들.map(a => a.buffer),
    );
  }
};
