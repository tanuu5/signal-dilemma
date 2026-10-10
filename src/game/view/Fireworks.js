// 花火：河原（台座の東の外）の上に、光の粒が開く。粒はまとめて Points で描き、加算で光らせる。
// flash：開いた瞬間の明るさ（画面を少し明るくするのに使う）。
import * as THREE from 'three';

const MAX = 2400;
const COLORS = [[1, 0.45, 0.3], [1, 0.85, 0.35], [0.45, 0.85, 1], [0.7, 0.5, 1], [0.4, 1, 0.6], [1, 0.5, 0.8], [1, 1, 1]];

export class Fireworks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.base = new Float32Array(MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size: 2.0, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(g, m);
    this.points.name = 'fireworks';
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = false;
    this.next = 0;
    this.flash = 0;
    this.i = 0;
    this.center = new THREE.Vector3(160, 70, 0);
    this.onBurst = null; // (x, y, z) => void（音）
    let s = 3;
    this.r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.points.visible = false;
  }

  /** 花火の上がる場所：カメラから見て街の向こう側（yaw はカメラの方位）の空。 */
  fit(b, yaw = -0.55) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const r = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2;
    // カメラは (sin yaw, cos yaw) の向きにいるので、その反対側
    this.center.set(cx - Math.sin(yaw) * r * 0.8, r * 0.3 + 16, cz - Math.cos(yaw) * r * 0.8);
    this.spread = r * 1.1;
    this.dir = { x: Math.cos(yaw), z: -Math.sin(yaw) }; // 横に散らす向き（画面の左右）
  }

  set(on) { this.active = on; if (on) this.points.visible = true; }

  _burst() {
    const r = this.r;
    const side = (r() - 0.5) * this.spread, d = this.dir || { x: 1, z: 0 };
    const cx = this.center.x + d.x * side + (r() - 0.5) * 12, cy = this.center.y + (r() - 0.5) * 18, cz = this.center.z + d.z * side + (r() - 0.5) * 12;
    const c = COLORS[Math.floor(r() * COLORS.length)];
    const n = 110 + Math.floor(r() * 90);
    const sp = 14 + r() * 10;
    for (let k = 0; k < n; k++) {
      const i = this.i++ % MAX;
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s2 = Math.sqrt(1 - u * u);
      const v = sp * (0.85 + r() * 0.15);
      this.pos[i * 3] = cx; this.pos[i * 3 + 1] = cy; this.pos[i * 3 + 2] = cz;
      this.vel[i * 3] = Math.cos(a) * s2 * v; this.vel[i * 3 + 1] = u * v; this.vel[i * 3 + 2] = Math.sin(a) * s2 * v;
      this.life[i] = 1.6 + r() * 0.9;
      this.base[i * 3] = c[0]; this.base[i * 3 + 1] = c[1]; this.base[i * 3 + 2] = c[2];
    }
    this.flash = 1;
    this.onBurst?.(cx, cy, cz);
  }

  update(dt) {
    if (this.active) {
      this.next -= dt;
      if (this.next <= 0) { this._burst(); this.next = 0.5 + this.r() * 1.1; }
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const drag = Math.exp(-dt * 1.4);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 9 * dt; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = Math.max(0, Math.min(1, this.life[i] / 1.2)) * 1.35;
      this.col[i * 3] = this.base[i * 3] * k; this.col[i * 3 + 1] = this.base[i * 3 + 1] * k; this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
    }
    if (!alive && !this.active) { this.points.visible = false; return; }
    this.points.visible = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
