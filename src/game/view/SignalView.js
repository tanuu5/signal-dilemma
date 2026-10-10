// 信号機：日本の横型（左から青・黄・赤）を、交差点の向こう側の左の角に立てた柱から腕で道路の上へ出す。
// 歩行者信号は横断歩道の両端に。灯火はまとめて描き（InstancedMesh）、色だけ毎フレーム変える。
import * as THREE from 'three';
import { Builder } from './geo.js';
import { pedSignalTexture } from './textures.js';
import { HEADINGS, left, OPP } from '../sim/geom.js';
import { ROAD_HALF, BOX, CW_W } from '../sim/constants.js';
import { CURB_H } from './CityView.js';

const RH = ROAD_HALF;
const C = RH + 1.25;            // 柱の位置（中心から）
const HEAD_Y = 5.4;             // 信号の高さ
const ON = {
  G: new THREE.Color(0.05, 1.0, 0.78).multiplyScalar(3.2),
  Y: new THREE.Color(1.0, 0.6, 0.0).multiplyScalar(3.4),
  R: new THREE.Color(1.0, 0.07, 0.04).multiplyScalar(3.4),
};
const OFF = new THREE.Color(0.045, 0.05, 0.055);
const PED_ON = { R: new THREE.Color(1.0, 0.12, 0.08).multiplyScalar(2.6), G: new THREE.Color(0.1, 1.0, 0.8).multiplyScalar(2.4) };

export class SignalView {
  constructor(scene, net) {
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'signals';
    scene.add(this.group);
    const S = new Builder();
    this.heads = [];   // { X, heading, lamps: [i, i, i] }
    this.peds = [];    // { X, panel index }
    const lampPos = [];
    const pedPos = [];
    for (const X of net.inter) {
      for (const hd of ['N', 'E', 'S', 'W']) {
        if (!X.approach[hd]) continue;
        const h = HEADINGS[hd], L = left(h);
        const cx = X.pos.x + h.x * C + L.x * C, cz = X.pos.z + h.z * C + L.z * C;
        // 柱と腕
        S.cyl(0.12, 0.15, HEAD_Y + 0.6, 0x9aa1a8, { x: cx, y: CURB_H, z: cz }, 8);
        const R = { x: -L.x, z: -L.z };           // 腕の向き（運転する人から見て右）
        const armLen = C - RH / 2 + 0.6;
        const ax = cx + R.x * armLen / 2, az = cz + R.z * armLen / 2;
        S.box(Math.abs(R.x) * armLen + 0.1, 0.12, Math.abs(R.z) * armLen + 0.1, 0x9aa1a8, { x: ax, y: CURB_H + HEAD_Y + 0.45, z: az });
        // 灯器（薄い箱）。運転する人のほうを向く
        const hx = cx + R.x * (armLen - 0.4), hz = cz + R.z * (armLen - 0.4);
        const ry = Math.atan2(-h.x, -h.z);
        S.box(1.42, 0.5, 0.22, 0xb4bac0, { x: hx, y: CURB_H + HEAD_Y - 0.25, z: hz, ry });
        S.box(1.32, 0.42, 0.04, 0x1d2126, { x: hx - h.x * 0.12, y: CURB_H + HEAD_Y - 0.21, z: hz - h.z * 0.12, ry });
        // 運転する人から見て左（L の向き）から 青・黄・赤
        const lamps = [0.44, 0, -0.44].map((o) => {
          lampPos.push({ x: hx + L.x * o - h.x * 0.15, y: CURB_H + HEAD_Y - 0.03, z: hz + L.z * o - h.z * 0.15, ry });
          return lampPos.length - 1;
        });
        this.heads.push({ X, heading: hd, lamps });
      }
      // 歩行者信号：横断歩道の両端に、向こう岸を向けて
      for (const cw of X.crosswalks) {
        for (const end of ['a', 'b']) {
          const P = cw[end], Q = cw[end === 'a' ? 'b' : 'a'];
          const dx = Q.x - P.x, dz = Q.z - P.z, dl = Math.hypot(dx, dz) || 1;
          // 柱は横断歩道の端から少し歩道側・交差点の外側へ
          const outx = cw.center.x - X.pos.x, outz = cw.center.z - X.pos.z, ol = Math.hypot(outx, outz) || 1;
          const px = P.x - dx / dl * 0.6 + outx / ol * (CW_W / 2 + 0.3), pz = P.z - dz / dl * 0.6 + outz / ol * (CW_W / 2 + 0.3);
          S.cyl(0.07, 0.08, 3.0, 0x9aa1a8, { x: px, y: CURB_H, z: pz }, 6);
          // 向こう岸（Q の側）から見えるよう、Q の方を向ける
          const ry = Math.atan2(dx, dz);
          S.box(0.42, 0.86, 0.22, 0xb4bac0, { x: px, y: CURB_H + 2.1, z: pz, ry });
          pedPos.push({ x: px + dx / dl * 0.12, y: CURB_H + 2.53, z: pz + dz / dl * 0.12, ry });
          this.peds.push({ X, i: pedPos.length - 1 });
        }
      }
    }
    const body = S.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }), { name: 'signalBodies' });
    if (body) this.group.add(body);

    // 灯火（丸）
    const lg = new THREE.CircleGeometry(0.16, 14);
    this.lamps = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff }), lampPos.length);
    this.lamps.name = 'signalLamps';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    lampPos.forEach((l, i) => {
      e.set(0, l.ry, 0);
      q.setFromEuler(e);
      m.compose(p.set(l.x, l.y, l.z), q, s);
      this.lamps.setMatrixAt(i, m);
      this.lamps.setColorAt(i, OFF);
    });
    this.group.add(this.lamps);
    // 歩行者信号の絵（上：赤い人、下：青い人）
    const tex = pedSignalTexture();
    const mk = (top) => {
      const g = new THREE.PlaneGeometry(0.3, 0.3);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, top ? 0.5 + uv.getY(i) * 0.5 : uv.getY(i) * 0.5);
      const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }), pedPos.length);
      pedPos.forEach((l, i) => {
        e.set(0, l.ry, 0);
        q.setFromEuler(e);
        m.compose(p.set(l.x, l.y + (top ? 0 : -0.36), l.z), q, s);
        im.setMatrixAt(i, m);
        im.setColorAt(i, OFF);
      });
      return im;
    };
    this.pedTop = mk(true);
    this.pedBot = mk(false);
    this.pedTop.name = 'pedRed';
    this.pedBot.name = 'pedGreen';
    if (pedPos.length) this.group.add(this.pedTop, this.pedBot);
    this.blink = 0;
  }

  update(dt) {
    this.blink += dt;
    const flashOn = Math.floor(this.blink * 2.4) % 2 === 0;
    for (const H of this.heads) {
      const st = H.X.signal.car(H.heading);
      this.lamps.setColorAt(H.lamps[0], st === 'G' ? ON.G : OFF);
      this.lamps.setColorAt(H.lamps[1], st === 'Y' ? ON.Y : OFF);
      this.lamps.setColorAt(H.lamps[2], st === 'R' ? ON.R : OFF);
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    for (const P of this.peds) {
      const st = P.X.signal.ped();
      const green = st === 'G' || (st === 'F' && flashOn);
      this.pedTop.setColorAt(P.i, st === 'R' ? PED_ON.R : OFF);
      this.pedBot.setColorAt(P.i, green ? PED_ON.G : OFF);
    }
    if (this.peds.length) {
      this.pedTop.instanceColor.needsUpdate = true;
      this.pedBot.instanceColor.needsUpdate = true;
    }
  }
}

void OPP; void BOX;
