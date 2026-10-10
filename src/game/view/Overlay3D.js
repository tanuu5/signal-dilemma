// AI の目に見えているもの（街に重ねて描く情報）：
//   停止線の光の幕（その向きの信号の色）、待っている列の長さの帯、歩行者の青のときの横断歩道、
//   選んでいる交差点の輪、救急車の通り道、車や人の頭の上の記号。
import * as THREE from 'three';
import { HEADINGS, left } from '../sim/geom.js';
import { LANE_W, STOP, BOX, CW_W, ROAD_HALF } from '../sim/constants.js';
import { iconAtlas } from './textures.js';

const COL = {
  G: new THREE.Color(0.1, 1.0, 0.72),
  Y: new THREE.Color(1.0, 0.68, 0.05),
  R: new THREE.Color(1.0, 0.12, 0.12),
};
const MAX_ICONS = 96;

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#000');
  grd.addColorStop(0.6, '#555');
  grd.addColorStop(1, '#fff');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const glowMat = (opts = {}) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...opts });

export class Overlay3D {
  constructor(scene, net) {
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'overlay';
    scene.add(this.group);
    this.time = 0;
    this.visible = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    // 停止線の光の幕（立てた板）
    this.curtains = [];
    for (const X of net.inter) {
      for (const hd of ['N', 'E', 'S', 'W']) {
        if (!X.approach[hd]) continue;
        const h = HEADINGS[hd], L = left(h);
        const cx = X.pos.x - h.x * (STOP + 0.15) + L.x * LANE_W / 2, cz = X.pos.z - h.z * (STOP + 0.15) + L.z * LANE_W / 2;
        this.curtains.push({ X, hd, x: cx, z: cz, ry: Math.atan2(h.x, h.z) });
      }
    }
    const cg = new THREE.PlaneGeometry(LANE_W - 0.4, 2.4);
    cg.translate(0, 1.2, 0);
    this.curtain = new THREE.InstancedMesh(cg, glowMat({ map: gradientTexture(), side: THREE.DoubleSide }), this.curtains.length);
    this.curtain.name = 'stopCurtains';
    this.curtains.forEach((c, i) => {
      e.set(0, c.ry, 0);
      q.setFromEuler(e);
      m.compose(p.set(c.x, 0.02, c.z), q, s.set(1, 1, 1));
      this.curtain.setMatrixAt(i, m);
      this.curtain.setColorAt(i, COL.R);
    });
    this.curtain.renderOrder = 5;
    this.group.add(this.curtain);
    // 停止線の上の光る線（上から見てもわかるように）
    const lg = new THREE.PlaneGeometry(LANE_W - 0.3, 1.1);
    lg.rotateX(-Math.PI / 2);
    this.lines = new THREE.InstancedMesh(lg, glowMat(), this.curtains.length);
    this.lines.name = 'stopLines';
    this.curtains.forEach((c, i) => {
      e.set(0, c.ry, 0);
      q.setFromEuler(e);
      m.compose(p.set(c.x, 0.05, c.z), q, s.set(1, 1, 1));
      this.lines.setMatrixAt(i, m);
      this.lines.setColorAt(i, COL.R);
    });
    this.lines.renderOrder = 5;
    this.group.add(this.lines);

    // 待っている列の長さ（車線に沿った帯）
    const qg = new THREE.PlaneGeometry(LANE_W - 0.7, 1);
    qg.rotateX(-Math.PI / 2);
    qg.translate(0, 0, 0.5); // 停止線から後ろへ伸ばす
    this.queue = new THREE.InstancedMesh(qg, glowMat({ opacity: 0.75 }), this.curtains.length);
    this.queue.name = 'queueBars';
    this.queue.renderOrder = 4;
    this.group.add(this.queue);

    // 交差点の真ん中の光の帯（青の向き）：南北の帯と東西の帯
    this.bars = [];
    const bg = new THREE.PlaneGeometry(1.5, (BOX + CW_W) * 2 - 1.2);
    bg.rotateX(-Math.PI / 2);
    this.bar = new THREE.InstancedMesh(bg, glowMat({ opacity: 0.85 }), net.inter.length * 2);
    this.bar.name = 'phaseBars';
    net.inter.forEach((X, i) => {
      for (const [k, ax] of [[0, 'NS'], [1, 'EW']]) {
        e.set(0, ax === 'NS' ? 0 : Math.PI / 2, 0);
        q.setFromEuler(e);
        m.compose(p.set(X.pos.x, 0.07 + k * 0.005, X.pos.z), q, s.set(1, 1, 1));
        this.bar.setMatrixAt(i * 2 + k, m);
        this.bar.setColorAt(i * 2 + k, COL.R);
        this.bars.push({ X, ax, idx: i * 2 + k });
      }
    });
    this.bar.renderOrder = 4;
    this.group.add(this.bar);

    // 横断歩道（歩行者の青）
    this.cws = [];
    for (const X of net.inter) for (const cw of X.crosswalks) this.cws.push(cw);
    const wg = new THREE.PlaneGeometry(1, 1);
    wg.rotateX(-Math.PI / 2);
    this.walk = new THREE.InstancedMesh(wg, glowMat({ opacity: 0.6 }), Math.max(1, this.cws.length));
    this.walk.name = 'walkGlow';
    this.cws.forEach((cw, i) => {
      const vertical = cw.side === 'N' || cw.side === 'S';
      m.compose(p.set(cw.center.x, 0.04, cw.center.z), q.identity(), s.set(vertical ? ROAD_HALF * 2 : CW_W, 1, vertical ? CW_W : ROAD_HALF * 2));
      this.walk.setMatrixAt(i, m);
      this.walk.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    this.walk.renderOrder = 4;
    this.group.add(this.walk);

    // 選んでいる交差点の輪・指している交差点の輪
    const ring = (r0, r1) => { const g = new THREE.RingGeometry(r0, r1, 48); g.rotateX(-Math.PI / 2); return g; };
    this.selRing = new THREE.Mesh(ring(BOX + CW_W + 1.6, BOX + CW_W + 2.3), glowMat({ color: 0x5ff0ff, opacity: 0.9 }));
    this.selRing.name = 'selectRing';
    this.selRing.renderOrder = 6;
    this.hoverRing = new THREE.Mesh(ring(BOX + CW_W + 1.6, BOX + CW_W + 2.0), glowMat({ color: 0xffffff, opacity: 0.35 }));
    this.hoverRing.renderOrder = 6;
    this.group.add(this.selRing, this.hoverRing);
    this.selRing.visible = this.hoverRing.visible = false;
    // 注目させる輪（チュートリアル）
    this.pulse = new THREE.Mesh(ring(BOX + CW_W + 3, BOX + CW_W + 3.8), glowMat({ color: 0xffe066, opacity: 0.9 }));
    this.pulse.visible = false;
    this.pulse.renderOrder = 6;
    this.group.add(this.pulse);
    // 補助AI「ツジ」が受け持っている交差点の輪（すみれ色の点線が、ゆっくり回る）
    this.helperMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0.55, 0.42, 1.0) } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // 輪の頂点は中心から離れているので、atan の引数が両方 0 になることはない
      fragmentShader: `uniform float time; uniform vec3 color; varying vec2 vP;
        void main(){ float a = atan(vP.y, vP.x) / 6.2831853; float d = step(0.45, fract(a * 24.0 - time * 0.4));
          gl_FragColor = vec4(color * (0.15 + 0.85 * d), 1.0); }`,
    });
    this.helperRings = net.inter.map((X) => {
      const mesh = new THREE.Mesh(ring(BOX + CW_W + 2.5, BOX + CW_W + 2.95), this.helperMat);
      mesh.position.set(X.pos.x, 0.075, X.pos.z);
      mesh.renderOrder = 6;
      mesh.visible = false;
      this.group.add(mesh);
      return { X, mesh };
    });

    // 救急車の通り道
    this.routes = new Map();
    this.routeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(1.0, 0.25, 0.3) } },
      vertexShader: 'attribute float along; varying float vA; void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; uniform vec3 color; varying float vA;
        void main(){ float dash = step(0.45, fract(vA * 0.25 - time * 1.4)); float fade = clamp(1.0 - vA / 160.0, 0.15, 1.0);
          gl_FragColor = vec4(color * (0.35 + 0.65 * dash) * fade, 1.0); }`,
    });

    // 頭の上の記号
    this.icons = [];
    const ig = new THREE.PlaneGeometry(1, 1);
    const atlas = iconAtlas();
    this.iconU = { atlas: { value: atlas }, uScale: { value: 1 } };
    const imat = new THREE.ShaderMaterial({
      uniforms: this.iconU, transparent: true, depthWrite: false, depthTest: false,
      vertexShader: `attribute float iCell; attribute float iAlpha; attribute float iSize; uniform float uScale;
        varying vec2 vUv; varying float vA;
        void main(){
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          c.xy += position.xy * iSize * uScale;
          gl_Position = projectionMatrix * c;
          float col = mod(iCell, 4.0), row = floor(iCell / 4.0);
          vUv = vec2((col + uv.x) / 4.0, 1.0 - (row + 1.0 - uv.y) / 4.0);
          vA = iAlpha;
        }`,
      fragmentShader: `uniform sampler2D atlas; varying vec2 vUv; varying float vA;
        void main(){ vec4 t = texture2D(atlas, vUv); gl_FragColor = vec4(t.rgb, t.a * vA); }`,
    });
    this.iconMesh = new THREE.InstancedMesh(ig, imat, MAX_ICONS);
    this.iconMesh.name = 'icons';
    this.iconMesh.frustumCulled = false;
    this.iconMesh.renderOrder = 20;
    this.iCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ICONS), 1);
    this.iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ICONS), 1);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ICONS), 1);
    ig.setAttribute('iCell', this.iCell);
    ig.setAttribute('iAlpha', this.iAlpha);
    ig.setAttribute('iSize', this.iSize);
    this.iconMesh.count = 0;
    this.group.add(this.iconMesh);
    this._m = m; this._q = q; this._e = e; this._s = s; this._p = p;
    this._c = new THREE.Color();
  }

  /** 記号を出す。follow：車や人（x, z を持つもの）。life：秒。 */
  icon(cell, { x = 0, y = 4, z = 0, follow = null, life = 1.6, size = 2.2, rise = 1.2 } = {}) {
    if (this.icons.length >= MAX_ICONS) this.icons.shift();
    this.icons.push({ cell, x, y, z, follow, life, t: 0, size, rise });
  }

  setSelected(X) {
    this.selRing.visible = !!X;
    if (X) this.selRing.position.set(X.pos.x, 0.07, X.pos.z);
  }

  setHover(X) {
    this.hoverRing.visible = !!X;
    if (X) this.hoverRing.position.set(X.pos.x, 0.06, X.pos.z);
  }

  setPulse(X) {
    this.pulse.visible = !!X;
    if (X) this.pulse.position.set(X.pos.x, 0.08, X.pos.z);
  }

  /** 救急車の通り道（これから通るところ）を描く。 */
  _routes(sim) {
    const alive = new Set();
    for (const car of sim.cars) {
      if (!car.em || !car.siren) continue;
      alive.add(car.id);
      let R = this.routes.get(car.id);
      if (!R) {
        const geo = new THREE.BufferGeometry();
        const mesh = new THREE.Mesh(geo, this.routeMat);
        mesh.renderOrder = 3;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        R = { mesh, geo };
        this.routes.set(car.id, R);
      }
      // 今の位置から先を、2 m おきに点を取って帯にする
      const pos = [], along = [];
      let dist = 0;
      const w = 0.9;
      let k = car.k, s = car.s;
      const pt = { x: 0, z: 0 }, dir = { x: 0, z: 1 };
      let prev = null;
      while (k < car.route.length && dist < 220) {
        const seg = car.route[k];
        seg.path.pointAt(Math.min(s, seg.len), pt);
        seg.path.dirAt(Math.min(s, seg.len - 0.01), dir);
        const nx = -dir.z * w, nz = dir.x * w;
        const cur = [pt.x + nx, pt.z + nz, pt.x - nx, pt.z - nz, dist];
        if (prev) {
          pos.push(prev[0], 0.09, prev[1], prev[2], 0.09, prev[3], cur[0], 0.09, cur[1]);
          pos.push(prev[2], 0.09, prev[3], cur[2], 0.09, cur[3], cur[0], 0.09, cur[1]);
          along.push(prev[4], prev[4], cur[4], prev[4], cur[4], cur[4]);
        }
        prev = cur;
        s += 2;
        dist += 2;
        if (s > seg.len) { s -= seg.len; k++; }
      }
      R.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      R.geo.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
      R.geo.computeBoundingSphere();
    }
    for (const [id, R] of this.routes) {
      if (alive.has(id)) continue;
      this.group.remove(R.mesh);
      R.geo.dispose();
      this.routes.delete(id);
    }
  }

  update(dt, sim, camDist) {
    this.time += dt;
    const flash = Math.floor(this.time * 2.4) % 2 === 0;
    const pulse = 0.75 + Math.sin(this.time * 5) * 0.25;
    const c = this._c;
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    this.curtains.forEach((C, i) => {
      const st = C.X.signal.car(C.hd);
      const k = st === 'R' ? 0.42 : st === 'Y' ? 1.1 : 1.0;
      c.copy(COL[st]).multiplyScalar(k);
      this.curtain.setColorAt(i, c);
      this.lines.setColorAt(i, c.multiplyScalar(st === 'R' ? 1.4 : 1.6));
      // 列の長さ
      const X = C.X, lane = X.approach[C.hd];
      let len = 0, wait = 0;
      for (const car of lane.cars) {
        if (car.v > 1.5 && len === 0) break;
        const d = lane.len - car.s + car.len;
        if (car.v < 2.0 && d < lane.len + 1) { len = d; wait = Math.max(wait, car.wait); } else break;
      }
      e.set(0, C.ry + Math.PI, 0);
      q.setFromEuler(e);
      const show = this.visible && len > 0.5;
      m.compose(p.set(C.x, 0.03, C.z), q, s.set(1, 1, show ? len : 0.001));
      this.queue.setMatrixAt(i, m);
      const heat = Math.min(1, wait / 30);
      c.setRGB(0.25 + heat * 0.75, 0.75 - heat * 0.6, 0.95 - heat * 0.85).multiplyScalar(0.5 + heat * 0.25);
      this.queue.setColorAt(i, c);
    });
    // 真ん中の帯：青の向きは明るい緑、黄は黄、赤の向きは消える。歩行者の青は両方とも消える
    for (const B of this.bars) {
      const sig = B.X.signal;
      let col = null, k = 0;
      if (sig.phase === B.ax && !sig.hold) {
        if (sig.stage === 'G') { col = COL.G; k = 0.7; }
        else if (sig.stage === 'Y') { col = COL.Y; k = 0.85; }
        else { col = COL.R; k = 0.25; }
      }
      if (col) c.copy(col).multiplyScalar(k); else c.setRGB(0, 0, 0);
      this.bar.setColorAt(B.idx, c);
    }
    this.bar.instanceColor.needsUpdate = true;
    this.curtain.instanceColor.needsUpdate = true;
    this.lines.instanceColor.needsUpdate = true;
    this.queue.instanceMatrix.needsUpdate = true;
    this.queue.instanceColor.needsUpdate = true;
    this.cws.forEach((cw, i) => {
      const st = cw.node.signal.ped();
      const on = st === 'G' || (st === 'F' && flash);
      c.setRGB(0, 0, 0);
      if (on) c.copy(COL.G).multiplyScalar(0.55);
      this.walk.setColorAt(i, c);
    });
    if (this.walk.instanceColor) this.walk.instanceColor.needsUpdate = true;
    this.selRing.material.opacity = 0.55 + pulse * 0.4;
    this.pulse.material.opacity = 0.4 + Math.sin(this.time * 7) * 0.4;
    this.pulse.scale.setScalar(1 + (Math.sin(this.time * 3.5) + 1) * 0.06);
    this.routeMat.uniforms.time.value = this.time;
    this.helperMat.uniforms.time.value = this.time;
    for (const H of this.helperRings) H.mesh.visible = H.X.signal.mode === 'helper';
    this._routes(sim);
    // 記号
    this.iconU.uScale.value = Math.max(0.7, Math.min(2.6, camDist / 110));
    let n = 0;
    for (let i = this.icons.length - 1; i >= 0; i--) {
      const I = this.icons[i];
      I.t += dt;
      if (I.t > I.life || (I.follow && I.follow.gone)) { this.icons.splice(i, 1); continue; }
    }
    for (const I of this.icons) {
      const x = I.follow ? I.follow.x : I.x, z = I.follow ? I.follow.z : I.z;
      const k = I.t / I.life;
      const y = I.y + I.rise * Math.min(1, k * 3);
      m.compose(p.set(x, y, z), q.identity(), s.set(1, 1, 1));
      this.iconMesh.setMatrixAt(n, m);
      this.iCell.array[n] = I.cell;
      this.iAlpha.array[n] = k < 0.12 ? k / 0.12 : k > 0.75 ? (1 - k) / 0.25 : 1;
      this.iSize.array[n] = I.size * (k < 0.12 ? 0.6 + (k / 0.12) * 0.4 : 1);
      n++;
    }
    this.iconMesh.count = n;
    this.iconMesh.instanceMatrix.needsUpdate = true;
    this.iCell.needsUpdate = this.iAlpha.needsUpdate = this.iSize.needsUpdate = true;
  }
}
