// カメラ：地面の一点（target）のまわりを、方位（yaw）・見下ろす角度（pitch）・距離（dist）で回る。
// frame(bounds) で、街全体が画面に収まる距離を求める（画面の縦横比が変わったら呼び直す）。
// 動かすときは goal を変え、update(dt) でなめらかに近づける。
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../../core/math.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.goal = { x: 0, z: 0, yaw: -0.5, pitch: 0.92, dist: 160 };
    this.cur = { ...this.goal };
    this.bounds = { x0: -60, x1: 60, z0: -60, z1: 60 };
    this.fitDist = 160;
    this.minDist = 30;
    this.shake = 0;
    this._v = new THREE.Vector3();
  }

  setBounds(b) { this.bounds = b; }

  /** 街全体（台座の四隅と、建物の高さ）が画面に入る距離を求めて、そこへ戻す。 */
  frame({ instant = false, yaw = this.goal.yaw, pitch = this.goal.pitch, margin = 0.9, tight = 0, bounds = null } = {}) {
    const b = bounds || this.bounds;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const inset = tight; // 端を少し切ってよいとき（m）
    const pts = [];
    for (const x of [b.x0 + inset, b.x1 - inset]) for (const z of [b.z0 + inset, b.z1 - inset]) { pts.push([x, 0, z], [x, -2, z]); }
    pts.push([cx, 14, cz]);
    const cam = this.cam;
    let lo = 10, hi = 2000;
    for (let it = 0; it < 26; it++) {
      const d = (lo + hi) / 2;
      this._place(cx, cz, yaw, pitch, d);
      cam.updateMatrixWorld(true);
      let ok = true;
      for (const p of pts) {
        this._v.set(p[0], p[1], p[2]).project(cam);
        if (Math.abs(this._v.x) > margin || Math.abs(this._v.y) > margin || this._v.z > 1) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    this.fitDist = hi;
    this.minDist = Math.max(26, hi * 0.25);
    this.frameBounds = b;
    Object.assign(this.goal, { x: cx, z: cz, yaw, pitch, dist: hi });
    if (instant) Object.assign(this.cur, this.goal);
    this._apply();
    return hi;
  }

  _place(x, z, yaw, pitch, dist) {
    const c = this.cam;
    c.position.set(x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, z + Math.cos(yaw) * Math.cos(pitch) * dist);
    c.lookAt(x, 0, z);
  }

  /** 画面の向きで動かす（dx：右、dy：上。単位は m）。 */
  pan(dx, dy) {
    const g = this.goal;
    const rx = Math.cos(g.yaw), rz = -Math.sin(g.yaw);   // 画面の右
    const fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw);  // 画面の上（奥）
    g.x += rx * dx + fx * dy;
    g.z += rz * dx + fz * dy;
    this._clampGoal();
  }

  rotate(d) { this.goal.yaw += d; }
  tilt(d) { this.goal.pitch = clamp(this.goal.pitch + d, 0.55, 1.35); }
  zoom(k) { this.goal.dist = clamp(this.goal.dist * k, this.minDist, this.fitDist * 1.25); this._clampGoal(); }

  /** 一点を見る（救急車へ寄るなど）。 */
  focus(x, z, dist = null) {
    this.goal.x = x;
    this.goal.z = z;
    if (dist) this.goal.dist = clamp(dist, this.minDist, this.fitDist * 1.25);
    this._clampGoal();
  }

  _clampGoal() {
    const b = this.bounds, g = this.goal;
    // 寄っているほど、端まで動かせる
    const zoomed = 1 - clamp((g.dist - this.minDist) / Math.max(1, this.fitDist - this.minDist), 0, 1);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const hx = (b.x1 - b.x0) / 2 * (0.15 + zoomed * 0.85), hz = (b.z1 - b.z0) / 2 * (0.15 + zoomed * 0.85);
    g.x = clamp(g.x, cx - hx, cx + hx);
    g.z = clamp(g.z, cz - hz, cz + hz);
  }

  update(dt) {
    const c = this.cur, g = this.goal;
    c.x = damp(c.x, g.x, 7, dt);
    c.z = damp(c.z, g.z, 7, dt);
    c.yaw = dampAngle(c.yaw, g.yaw, 7, dt);
    c.pitch = damp(c.pitch, g.pitch, 7, dt);
    c.dist = damp(c.dist, g.dist, 7, dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    this._apply();
  }

  _apply() {
    const c = this.cur;
    this._place(c.x, c.z, c.yaw, c.pitch, c.dist);
    if (this.shake > 0) {
      const s = this.shake * 0.25;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
    }
  }
}
