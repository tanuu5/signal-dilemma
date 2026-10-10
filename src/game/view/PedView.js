// 歩行者の描画：体・頭・脚（左右）・帽子（子ども：黄色い帽子）・ランドセル・傘を、それぞれまとめて描く。
// 歩くときは脚を振り、体を少し上下させる。
import * as THREE from 'three';
import { CURB_H } from './CityView.js';
import { ROAD_HALF } from '../sim/constants.js';

const MAX = 220;
const CLOTH = [0x2b3346, 0x1d1f24, 0x6b6f78, 0xd8d2c4, 0xf2f2ee, 0x7a4a3a, 0x3f6b8f, 0xb84a4a, 0x5d7a4f, 0xc9a24a, 0x8c6fae, 0x2f4f6f];
const HAIR = [0x1a1512, 0x2a211c, 0x3b2c22, 0x8a8a8a, 0xbdbdbd];
const UMBRELLA = [0x5aa9ff, 0xff7a8a, 0xffd34d, 0x7ad18a, 0xf2f2f2, 0x30343c, 0xb08cff];

export class PedView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'peds';
    scene.add(this.group);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const mk = (geo, name, color) => {
      const im = new THREE.InstancedMesh(geo, color ? new THREE.MeshStandardMaterial({ color, roughness: 0.6 }) : mat, MAX);
      im.name = name;
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      return im;
    };
    const body = new THREE.CapsuleGeometry(0.2, 0.5, 3, 8);
    body.translate(0, 0.98, 0);
    const head = new THREE.SphereGeometry(0.13, 10, 8);
    head.translate(0, 1.5, 0);
    const leg = new THREE.BoxGeometry(0.11, 0.62, 0.12);
    leg.translate(0, -0.31, 0); // 付け根で回す
    const hat = new THREE.CylinderGeometry(0.12, 0.17, 0.12, 10);
    hat.translate(0, 1.6, 0);
    const bag = new THREE.BoxGeometry(0.28, 0.32, 0.16);
    bag.translate(0, 1.05, -0.22);
    const umb = new THREE.ConeGeometry(0.62, 0.32, 10, 1, true);
    umb.translate(0, 2.0, 0);
    const stick = new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4);
    stick.translate(0.12, 1.62, 0.08);
    this.body = mk(body, 'pedBody');
    this.head = mk(head, 'pedHead');
    this.legL = mk(leg, 'pedLegL', 0x2a2c33);
    this.legR = mk(leg, 'pedLegR', 0x2a2c33);
    this.hat = mk(hat, 'pedHat', 0xffd400);
    this.bag = mk(bag, 'pedBag');
    this.umb = mk(umb, 'pedUmbrella');
    this.umb.material = new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide });
    this.stick = mk(stick, 'pedStick', 0x333333);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  update(peds, dt, rain) {
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s, c = this._c;
    let n = 0, nk = 0, nu = 0;
    for (const pd of peds) {
      if (n >= MAX) break;
      const kid = pd.kind === 'kid', elder = pd.kind === 'elder';
      const sc = kid ? 0.68 : elder ? 0.92 : 1;
      // 歩道の上は縁石の高さ、車道（横断中）は 0
      const onRoad = pd.stage === 'cross';
      const y = onRoad ? 0 : CURB_H;
      const walk = pd.moving ? Math.sin(pd.phase) : 0;
      const bob = pd.moving ? Math.abs(Math.cos(pd.phase)) * 0.04 : 0;
      e.set(0, pd.dir, pd.moving ? walk * 0.03 : 0);
      q.setFromEuler(e);
      m.compose(p.set(pd.x, y + bob, pd.z), q, s.set(sc, sc * (elder ? 0.96 : 1), sc));
      this.body.setMatrixAt(n, m);
      this.head.setMatrixAt(n, m);
      this.body.setColorAt(n, c.set(CLOTH[pd.color % CLOTH.length]));
      this.head.setColorAt(n, c.set(elder ? HAIR[3 + (pd.color % 2)] : HAIR[pd.color % 3]));
      // 脚
      for (const [im, sgn] of [[this.legL, 1], [this.legR, -1]]) {
        e.set(walk * 0.55 * sgn, pd.dir, 0, 'YXZ');
        q.setFromEuler(e);
        const lx = Math.cos(pd.dir) * 0.09 * sgn, lz = -Math.sin(pd.dir) * 0.09 * sgn;
        m.compose(p.set(pd.x + lx * sc, y + 0.66 * sc + bob, pd.z + lz * sc), q, s.set(sc, sc, sc));
        im.setMatrixAt(n, m);
      }
      e.set(0, pd.dir, 0);
      q.setFromEuler(e);
      m.compose(p.set(pd.x, y + bob, pd.z), q, s.set(sc, sc, sc));
      if (kid) {
        this.hat.setMatrixAt(nk, m);
        this.bag.setMatrixAt(nk, m);
        this.bag.setColorAt(nk, c.set(pd.color % 2 ? 0xb3262c : 0x1d1f24));
        nk++;
      }
      if (pd.umbrella && rain > 0.2) {
        this.umb.setMatrixAt(nu, m);
        this.stick.setMatrixAt(nu, m);
        this.umb.setColorAt(nu, c.set(UMBRELLA[pd.color % UMBRELLA.length]));
        nu++;
      }
      n++;
    }
    for (const im of [this.body, this.head, this.legL, this.legR]) im.count = n;
    this.hat.count = this.bag.count = nk;
    this.umb.count = this.stick.count = nu;
    for (const im of [this.body, this.head, this.legL, this.legR, this.hat, this.bag, this.umb, this.stick]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

void ROAD_HALF;
