// iOS Safari で、ゲーム中のピンチやダブルタップで画面が拡大されてしまうのを止める
// （viewport の user-scalable=no は iOS では効かない）。設定画面のつまみなどは普通に動く。
export function preventZoom() {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    if (now - last < 320 && !e.target.closest?.('input, select, textarea, button')) e.preventDefault();
    last = now;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}
