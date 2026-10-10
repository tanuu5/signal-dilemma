// マウスとタッチ：
//   クリック・タップ：交差点を選んで切り替える（近くの交差点を画面上の距離で探す）
//   ドラッグ（左／1 本指）：街を動かす　右ドラッグ・2 本指のひねり：回す　ホイール・ピンチ：寄る・離れる
// キーボードとゲームパッドの操作は Game が input から読む。
import * as THREE from 'three';

const TAP_MOVE = 9;      // これより動いたらドラッグ
const TAP_TIME = 0.45;   // これより長く押したらタップではない

export class Controls {
  constructor(dom, { camera, rig, getWorld, onTap, onHover, enabled }) {
    this.dom = dom;
    this.camera = camera;
    this.rig = rig;
    this.getWorld = getWorld;
    this.onTap = onTap;
    this.onHover = onHover;
    this.enabled = enabled || (() => true);
    this.ptrs = new Map();
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this.lastMouse = null;
    this.hoverX = null;

    dom.addEventListener('pointerdown', (e) => this._down(e));
    addEventListener('pointermove', (e) => this._move(e));
    addEventListener('pointerup', (e) => this._up(e));
    addEventListener('pointercancel', (e) => this._up(e, true));
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled()) return;
      e.preventDefault();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100) * 0.16);
      this._zoomAt(e.clientX, e.clientY, k);
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 画面の点から地面（y=0）の点。 */
  ground(x, y, out = new THREE.Vector3()) {
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  /** 画面の点のいちばん近くの交差点（画面上で r px 以内）。 */
  pick(x, y, r = null) {
    const W = this.getWorld();
    if (!W) return null;
    let best = null, bd = Infinity;
    const rad = r ?? Math.max(46, Math.min(innerWidth, innerHeight) * 0.09);
    for (const X of W.net.inter) {
      this._v.set(X.pos.x, 0, X.pos.z).project(this.camera);
      const sx = (this._v.x + 1) / 2 * innerWidth, sy = (1 - this._v.y) / 2 * innerHeight;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = X; }
    }
    return bd <= rad ? best : null;
  }

  _down(e) {
    if (!this.enabled()) return;
    try { this.dom.setPointerCapture?.(e.pointerId); } catch { /* 合成したイベントなど、捕まえられない指でも続ける */ }
    this.ptrs.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: false, button: e.button, type: e.pointerType });
    if (this.ptrs.size === 2) this._startPinch();
  }

  _move(e) {
    if (e.pointerType === 'mouse') {
      this.lastMouse = { x: e.clientX, y: e.clientY };
      if (!this.ptrs.size && this.enabled()) { this.hoverX = this.pick(e.clientX, e.clientY); this.onHover?.(this.hoverX); }
    }
    const P = this.ptrs.get(e.pointerId);
    if (!P || !this.enabled()) return;
    const dx = e.clientX - P.x, dy = e.clientY - P.y;
    if (Math.hypot(e.clientX - P.sx, e.clientY - P.sy) > TAP_MOVE) P.moved = true;
    if (this.ptrs.size >= 2) { P.x = e.clientX; P.y = e.clientY; this._pinch(); return; }
    if (!P.moved) return;
    if (P.type === 'mouse' && P.button === 2) {
      // 右ドラッグ：回す・傾ける
      this.rig.rotate(-dx * 0.006);
      this.rig.tilt(dy * 0.004);
      this.rig.cur.yaw = this.rig.goal.yaw;
    } else {
      // 地面をつかんで動かす
      const a = this.ground(P.x, P.y, new THREE.Vector3()), b = this.ground(e.clientX, e.clientY, new THREE.Vector3());
      if (a && b) {
        this.rig.goal.x -= b.x - a.x;
        this.rig.goal.z -= b.z - a.z;
        this.rig._clampGoal();
        this.rig.cur.x = this.rig.goal.x;
        this.rig.cur.z = this.rig.goal.z;
      }
    }
    P.x = e.clientX;
    P.y = e.clientY;
  }

  _up(e, cancel = false) {
    const P = this.ptrs.get(e.pointerId);
    if (!P) return;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (cancel || !this.enabled()) return;
    const quick = (performance.now() - P.t0) / 1000 < TAP_TIME;
    if (!P.moved && quick && P.button !== 2 && !this.pinchedRecently) {
      const X = this.pick(P.sx, P.sy);
      this.onTap?.(X, { x: P.sx, y: P.sy, type: P.type });
    }
    if (!this.ptrs.size) this.pinchedRecently = false;
  }

  _startPinch() {
    const [a, b] = [...this.ptrs.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    this.pinchedRecently = true;
    for (const p of this.ptrs.values()) p.moved = true;
  }

  _pinch() {
    if (!this.pinch) return this._startPinch();
    const [a, b] = [...this.ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (this.pinch.d > 10 && d > 10) this._zoomAt(mx, my, this.pinch.d / d);
    // 指をひねった向きに街も回す（画面は下向きが y 正なので、da が正なら時計回り）
    let da = ang - this.pinch.ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this._rotateAt(mx, my, da);
    // 2 本指で動かす
    const g0 = this.ground(this.pinch.mx, this.pinch.my, new THREE.Vector3()), g1 = this.ground(mx, my, new THREE.Vector3());
    if (g0 && g1) { this.rig.goal.x -= g1.x - g0.x; this.rig.goal.z -= g1.z - g0.z; this.rig._clampGoal(); }
    this.pinch = { d, ang, mx, my };
  }

  /** 画面の点の下の地面を中心に回す（指のあいだの街が、指についてくるように）。a が正なら、画面の上で時計回り。 */
  _rotateAt(x, y, a) {
    const r = this.rig;
    const p = this.ground(x, y, new THREE.Vector3());
    r.rotate(a);
    r.cur.yaw = r.goal.yaw;
    if (!p) return;
    // 方位が a 増えると、カメラは注視点のまわりを回る。注視点も同じだけ p のまわりで回せば、p は画面の同じ所に残る
    const c = Math.cos(a), s = Math.sin(a);
    for (const t of [r.goal, r.cur]) {
      const vx = t.x - p.x, vz = t.z - p.z;
      t.x = p.x + vx * c + vz * s;
      t.z = p.z + vz * c - vx * s;
    }
    r._clampGoal();
  }

  /** 画面の点に向かって寄る（その点が指の下に残るように）。 */
  _zoomAt(x, y, k) {
    const before = this.ground(x, y, new THREE.Vector3());
    const r = this.rig;
    const d0 = r.goal.dist;
    r.zoom(k);
    const ratio = r.goal.dist / d0;
    if (before) {
      r.goal.x = before.x + (r.goal.x - before.x) * ratio;
      r.goal.z = before.z + (r.goal.z - before.z) * ratio;
      r._clampGoal();
    }
  }
}
