// スマホの操作は、画面のドラッグ・ピンチ（game/Controls.js）と、ゲーム中の表示のボタン（ui/Hud.js）で行う。
// この作品では仮想スティックや動作ボタンは使わないので、雛形の TouchControls は形だけ残す
// （main.js と Game が setVisible / setLabel を呼んでも困らないように）。
export const BUTTONS = [];

export class TouchControls {
  constructor() { this.visible = false; this.enabled = false; }
  setVisible(v) { this.visible = v; }
  setLabel() {}
  refresh() {}
}
