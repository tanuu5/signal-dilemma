// 車の描画：車種ごとに 1 つの InstancedMesh。塗装の部分（paint = 1）だけ一台ごとの色にし、
// ガラス・タイヤ・救急車の白など決まった色はそのまま（材質のシェーダーを少し書き換える）。
// ライト（前照灯・尾灯・ブレーキ・ウインカー・赤色灯）は全部の車でまとめて 1 つの InstancedMesh。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_TYPES } from '../sim/constants.js';
import { place } from './geo.js';

const MAX = 260;           // 車種ごとの上限
const LAMPS_PER_CAR = 10;
const P = -1;              // 塗装色（一台ごとの色）の印

// 一台ごとの色（日本の街らしく白・黒・銀が多め）
const PALETTE = [0xf4f4f2, 0xf4f4f2, 0xeef0f0, 0x1b1d22, 0x1b1d22, 0xb9bec4, 0x8d949c, 0x23345a, 0x9b1f24, 0x7fa7c9, 0xd9cdb4, 0x4e5f52, 0xc7b8a0, 0xe7e2d6];
const TAXI = [0xf2c230, 0x2e7d4f, 0x1a1c20, 0xe8742a, 0x3f6db3];
const BUS_STRIPE = [0x2f6fb5, 0x2f9e62, 0xe08a2e, 0xc0392b];

function partGeo(geo, color, paint) {
  if (geo.index) geo = geo.toNonIndexed();
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color === P ? 0xffffff : color);
  const col = new Float32Array(n * 3), pm = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; pm[i] = paint ? 1 : 0; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('paint', new THREE.BufferAttribute(pm, 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

class Model {
  constructor() { this.parts = []; }
  box(w, h, d, color, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    this.parts.push(partGeo(place(g, o), color, color === P || o.paint));
  }
  cyl(r, h, color, o = {}, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    this.parts.push(partGeo(place(g, o), color, color === P));
  }
  /** 横から見た形（[z, y] の点の列）を、幅 w に押し出した屋根・窓の形。 */
  profile(pts, w, color, o = {}) {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(-Math.PI / 2); // Shape の x（前後）を z に
    this.parts.push(partGeo(place(g, o), color, color === P));
  }
  wheels(wid, len, r = 0.31, front = null, rear = null) {
    const zf = front ?? len / 2 - 0.85, zr = rear ?? -len / 2 + 0.85;
    for (const x of [-wid / 2 + 0.12, wid / 2 - 0.12]) {
      for (const z of [zf, zr]) this.cyl(r, 0.24, 0x16181c, { x, y: r, z, rz: Math.PI / 2 }, 12);
    }
  }
  geometry() { const g = mergeGeometries(this.parts, false); g.computeBoundingSphere(); return g; }
}

const GLASS = 0x26313d, TRIM = 0x2a2e35, CHROME = 0xb8bec6, WHITE = 0xf5f5f2;

// 車種ごとの形。前は +z、左は +x。ライトの位置も返す
function buildModel(type) {
  const T = CAR_TYPES[type];
  const L = T.len, W = T.wid;
  const m = new Model();
  let roof = 1.45, lamp = { headY: 0.66, tailY: 0.78, beaconY: 0, beaconZ: 0 };
  const lowerBody = (h = 0.6, color = P) => {
    m.box(W, h, L - 0.1, color, { y: 0.3 });
    m.box(W + 0.02, 0.14, L - 0.05, TRIM, { y: 0.24 });
    m.box(W - 0.1, 0.18, 0.12, CHROME, { y: 0.34, z: L / 2 - 0.06 });
    m.box(W - 0.1, 0.18, 0.12, CHROME, { y: 0.34, z: -L / 2 + 0.06 });
  };
  switch (type) {
    case 'sedan': case 'taxi': case 'police': case 'vip': {
      const body = type === 'police' ? 0x16181d : type === 'vip' ? 0x0d0f13 : P;
      m.wheels(W, L);
      lowerBody(0.6, body);
      // 屋根と窓（横から見て台形）
      m.profile([[-1.55, 0.9], [1.05, 0.9], [0.45, 1.42], [-1.05, 1.42]], W - 0.18, GLASS);
      const top = type === 'police' ? WHITE : type === 'vip' ? 0x0d0f13 : P;
      m.box(W - 0.3, 0.06, 1.42, top, { y: 1.42, z: -0.3 });
      if (type === 'police') {
        m.box(W - 0.02, 0.32, 2.4, WHITE, { y: 0.62, z: 0.1 });       // ドアの白
        m.box(1.2, 0.14, 0.32, 0x2a2a30, { y: 1.48, z: -0.3 });         // 赤色灯の台
        lamp.beaconY = 1.66; lamp.beaconZ = -0.3;
      }
      if (type === 'taxi') m.box(0.5, 0.22, 0.2, 0xf6efe0, { y: 1.48, z: -0.2 }); // 行灯
      roof = 1.48;
      break;
    }
    case 'kei': {
      m.wheels(W, L, 0.27, L / 2 - 0.6, -L / 2 + 0.55);
      lowerBody(0.55);
      m.profile([[-1.62, 0.85], [1.2, 0.85], [0.75, 1.7], [-1.62, 1.7]], W - 0.1, GLASS);
      m.box(W - 0.14, 0.07, 2.3, P, { y: 1.7, z: -0.45 });
      m.box(0.08, 0.7, 1.0, P, { x: W / 2 - 0.08, y: 0.95, z: -0.4 }); // 柱
      m.box(0.08, 0.7, 1.0, P, { x: -W / 2 + 0.08, y: 0.95, z: -0.4 });
      roof = 1.77;
      lamp.headY = 0.72; lamp.tailY = 0.95;
      break;
    }
    case 'van': {
      m.wheels(W, L);
      lowerBody(0.62);
      m.profile([[-2.25, 0.92], [1.45, 0.92], [0.85, 1.78], [-2.25, 1.78]], W - 0.12, GLASS);
      m.box(W - 0.16, 0.07, 3.0, P, { y: 1.78, z: -0.65 });
      m.box(0.08, 0.8, 2.2, P, { x: W / 2 - 0.08, y: 0.98, z: -0.8 });
      m.box(0.08, 0.8, 2.2, P, { x: -W / 2 + 0.08, y: 0.98, z: -0.8 });
      roof = 1.85;
      lamp.tailY = 1.0;
      break;
    }
    case 'truck': case 'delivery': {
      m.wheels(W, L, 0.36, L / 2 - 0.9, -L / 2 + 1.3);
      const cabL = 1.7;
      const cab = type === 'delivery' ? 0xf5f5f2 : P;
      m.box(W, 1.55, cabL, cab, { y: 0.35, z: L / 2 - cabL / 2 });
      m.box(W - 0.1, 0.65, 0.06, GLASS, { y: 1.1, z: L / 2 + 0.01 });
      m.box(W + 0.04, 0.2, L - 0.2, TRIM, { y: 0.32 });
      const cargo = type === 'delivery' ? 0x2e8b57 : 0xd7dbe0;
      m.box(W + 0.1, 2.15, L - cabL - 0.15, cargo, { y: 0.55, z: -cabL / 2 - 0.05 });
      if (type === 'delivery') m.box(W + 0.14, 0.5, L - cabL - 0.4, 0xf5f5f2, { y: 1.5, z: -cabL / 2 - 0.05 });
      roof = 2.75;
      lamp.headY = 0.6; lamp.tailY = 0.55;
      break;
    }
    case 'bus': {
      m.wheels(W, L, 0.45, L / 2 - 2.2, -L / 2 + 2.4);
      m.box(W, 2.6, L, 0xf2efe6, { y: 0.32 });
      m.box(W + 0.02, 0.9, L - 1.6, GLASS, { y: 1.52, z: -0.3 });
      m.box(W + 0.03, 0.22, L - 0.2, P, { y: 1.05 });                    // 帯（会社の色）
      m.box(W - 0.2, 1.5, 0.05, GLASS, { y: 1.1, z: L / 2 + 0.01 });     // 前の大きな窓
      m.box(W - 0.4, 0.3, 2.6, 0xc9ccd0, { y: 2.92, z: -1.5 });           // 屋根の上の冷房
      m.box(W - 0.6, 0.32, 0.06, 0x111111, { y: 2.48, z: L / 2 + 0.02 }); // 行き先の表示
      roof = 3.2;
      lamp.headY = 0.62; lamp.tailY = 0.75;
      break;
    }
    case 'ambulance': {
      m.wheels(W, L, 0.34, L / 2 - 0.95, -L / 2 + 1.1);
      m.box(W, 2.0, L - 0.1, WHITE, { y: 0.32 });
      m.box(W + 0.02, 0.6, 1.0, GLASS, { y: 1.25, z: L / 2 - 0.7 });
      m.box(W - 0.15, 0.62, 0.06, GLASS, { y: 1.22, z: L / 2 - 0.02 });
      m.box(W + 0.03, 0.18, L - 0.2, 0xd6262a, { y: 0.95 });             // 赤い帯
      m.box(W + 0.03, 0.08, L - 0.2, 0xd6262a, { y: 1.95 });
      m.box(1.5, 0.16, 0.36, 0x30333a, { y: 2.32, z: L / 2 - 1.0 });      // 赤色灯の台
      roof = 2.4;
      lamp.headY = 0.62; lamp.tailY = 0.9; lamp.beaconY = 2.5; lamp.beaconZ = L / 2 - 1.0;
      break;
    }
    case 'fire': {
      m.wheels(W, L, 0.42, L / 2 - 1.1, -L / 2 + 1.6);
      m.box(W, 2.2, L, 0xc8211b, { y: 0.4 });
      m.box(W + 0.02, 0.7, 1.6, GLASS, { y: 1.5, z: L / 2 - 0.9 });
      m.box(W + 0.03, 0.12, L - 0.3, WHITE, { y: 1.1 });
      m.box(0.5, 0.25, L - 2.4, 0xc8ccd2, { y: 2.65, z: -0.6 });          // はしご
      m.box(1.5, 0.16, 0.36, 0x30333a, { y: 2.6, z: L / 2 - 0.8 });
      roof = 2.7;
      lamp.headY = 0.7; lamp.tailY = 0.8; lamp.beaconY = 2.78; lamp.beaconZ = L / 2 - 0.8;
      break;
    }
  }
  return { geo: m.geometry(), L, W, roof, lamp };
}

function carMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.28 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float paint;\n#include <common>')
      .replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, paint );');
  };
  mat.customProgramCacheKey = () => 'car-paint-v1';
  return mat;
}

// ライトの色
const C = (r, g, b, k = 1) => new THREE.Color(r * k, g * k, b * k);
const LAMP = {
  headDay: C(0.75, 0.75, 0.7), headNight: C(1, 0.95, 0.82, 3.2),
  tailOff: C(0.35, 0.03, 0.03), tailNight: C(1, 0.05, 0.03, 1.4), brake: C(1, 0.08, 0.04, 3.6),
  blinkOn: C(1, 0.5, 0.05, 3.4), blinkOff: C(0.32, 0.18, 0.05),
  beaconOn: C(1, 0.06, 0.05, 4.5), beaconOff: C(0.25, 0.03, 0.03),
  hidden: C(0, 0, 0),
};

export class CarView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'cars';
    scene.add(this.group);
    this.mat = carMaterial();
    this.types = {};
    for (const type of Object.keys(CAR_TYPES)) {
      const md = buildModel(type);
      const im = new THREE.InstancedMesh(md.geo, this.mat, MAX);
      im.name = 'cars-' + type;
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = false;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      this.types[type] = { im, md };
    }
    // ライト（小さな板。光る）
    const lg = new THREE.BoxGeometry(1, 1, 1);
    this.lamps = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX * LAMPS_PER_CAR);
    this.lamps.name = 'carLamps';
    this.lamps.count = 0;
    this.lamps.frustumCulled = false;
    this.lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.lamps);
    this.night = 0;
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this.pose = new Map(); // 車ごとの車体の傾き（なめらかにする）
  }

  colorOf(car) {
    if (car.type === 'taxi') return TAXI[car.color % TAXI.length];
    if (car.type === 'bus') return BUS_STRIPE[car.color % BUS_STRIPE.length];
    if (car.type === 'truck') return [0xf4f4f2, 0x3a6fb5, 0x2f8f5a, 0xf4f4f2][car.color % 4];
    return PALETTE[car.color % PALETTE.length];
  }

  update(cars, dt, night) {
    this.time += dt;
    const counts = {};
    for (const k in this.types) counts[k] = 0;
    let li = 0;
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
    const blinkOn = Math.floor(this.time * 3) % 2 === 0;
    const seen = new Set();
    for (const car of cars) {
      const T = this.types[car.type];
      if (!T) continue;
      const i = counts[car.type]++;
      if (i >= MAX) continue;
      seen.add(car.id);
      const yaw = Math.atan2(car.dx, car.dz);
      // 車体の傾き：ブレーキで前に沈み、曲がると外へ傾く
      let st = this.pose.get(car.id);
      if (!st) { st = { yaw, pitch: 0, roll: 0 }; this.pose.set(car.id, st); }
      let dy = yaw - st.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const yawRate = dt > 0 ? dy / dt : 0;
      st.yaw = yaw;
      const k = 1 - Math.exp(-dt * 8);
      st.pitch += (Math.max(-0.05, Math.min(0.05, car.acc * 0.011)) - st.pitch) * k;
      st.roll += (Math.max(-0.06, Math.min(0.06, -yawRate * car.v * 0.012)) - st.roll) * k;
      e.set(-st.pitch, yaw, st.roll, 'YXZ');
      q.setFromEuler(e);
      m.compose(p.set(car.x, 0, car.z), q, s.set(1, 1, 1));
      T.im.setMatrixAt(i, m);
      T.im.setColorAt(i, this._c.set(this.colorOf(car)));
      // ライト
      const md = T.md;
      const hw = md.W / 2;
      const put = (x, y, z, sx, sy, sz, color) => {
        if (li >= MAX * LAMPS_PER_CAR) return;
        this._m2.compose(this._p.set(x, y, z), this._q.identity(), this._s.set(sx, sy, sz));
        this._m2.premultiply(m);
        this.lamps.setMatrixAt(li, this._m2);
        this.lamps.setColorAt(li, color);
        li++;
        this._q.setFromEuler(e); // put の中で q を使い回したので戻す
      };
      const head = night > 0.35 ? LAMP.headNight : LAMP.headDay;
      const tail = car.brake ? LAMP.brake : night > 0.35 ? LAMP.tailNight : LAMP.tailOff;
      const L2 = md.L / 2;
      put(hw - 0.28, md.lamp.headY, L2 + 0.01, 0.34, 0.14, 0.05, head);
      put(-hw + 0.28, md.lamp.headY, L2 + 0.01, 0.34, 0.14, 0.05, head);
      put(hw - 0.22, md.lamp.tailY, -L2 - 0.01, 0.3, 0.16, 0.05, tail);
      put(-hw + 0.22, md.lamp.tailY, -L2 - 0.01, 0.3, 0.16, 0.05, tail);
      // ウインカー（左折 L は左 = +x）
      const bl = (car.blink === 'L' || car.hazard) && blinkOn ? LAMP.blinkOn : LAMP.blinkOff;
      const br = (car.blink === 'R' || car.hazard) && blinkOn ? LAMP.blinkOn : LAMP.blinkOff;
      put(hw - 0.06, md.lamp.headY - 0.05, L2 - 0.02, 0.1, 0.1, 0.12, bl);
      put(-hw + 0.06, md.lamp.headY - 0.05, L2 - 0.02, 0.1, 0.1, 0.12, br);
      put(hw - 0.05, md.lamp.tailY - 0.14, -L2 + 0.02, 0.1, 0.1, 0.1, bl);
      put(-hw + 0.05, md.lamp.tailY - 0.14, -L2 + 0.02, 0.1, 0.1, 0.1, br);
      // 赤色灯（左右交互に）
      if (md.lamp.beaconY) {
        const a = car.siren && Math.floor(this.time * 4) % 2 === 0;
        put(0.42, md.lamp.beaconY, md.lamp.beaconZ, 0.4, 0.2, 0.26, a ? LAMP.beaconOn : LAMP.beaconOff);
        put(-0.42, md.lamp.beaconY, md.lamp.beaconZ, 0.4, 0.2, 0.26, !a && car.siren ? LAMP.beaconOn : LAMP.beaconOff);
      }
    }
    for (const k in this.types) {
      const im = this.types[k].im;
      im.count = Math.min(MAX, counts[k]);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.lamps.count = li;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    // 消えた車の傾きの記録を捨てる
    if (this.pose.size > seen.size + 50) for (const id of this.pose.keys()) if (!seen.has(id)) this.pose.delete(id);
  }
}
