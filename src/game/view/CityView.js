// 街の動かない部分：浮かぶ台座、道路と白線、歩道のブロック、建物、街路樹、電柱と電線、街灯、自販機、端のゲート。
// どれも手続きで作る（毎回同じ街になるよう、座標から乱数を決める）。同じ材質のものは 1 つにまとめて描く。
import * as THREE from 'three';
import { Builder, roundedSlab, flatQuad, hash2, paint, place } from './geo.js';
import { asphaltTexture, facadeTextures, signAtlas, shopAtlas, glowTexture, groundTexture, SIGN_TEXT, SHOP_TEXT } from './textures.js';
import { ROAD_HALF, STOP, BOX, CW_W, SIDEWALK, LANE_W } from '../sim/constants.js';

const RH = ROAD_HALF;
const SW = SIDEWALK;
const CURB_H = 0.16;
const GROUND_LIFT = 0.05; // 芝生・校庭を歩道の板から浮かせる高さ
const SLAB_DEPTH = 7;

export class CityView {
  constructor(scene, net, def) {
    this.net = net;
    this.def = def;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.mats = this._materials();
    this.night = 0;
    const b = net.bounds;
    this.b = b;
    this.cols = def.cols;
    this.rows = def.rows;
    this.lampPos = [];      // 街灯の頭（夜に地面を照らす光の位置）
    this.vendPos = [];
    this._base();
    this._roads();
    this._blocks();
    this._props();
    this._gates();
  }

  _materials() {
    const asphalt = asphaltTexture();
    const fac = { office: facadeTextures('office', 3), apartment: facadeTextures('apartment', 5), mixed: facadeTextures('mixed', 9) };
    const facade = (k) => new THREE.MeshStandardMaterial({ map: fac[k].map, emissiveMap: fac[k].emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.82, metalness: 0.0 });
    const signs = signAtlas(), shops = shopAtlas();
    return {
      road: new THREE.MeshStandardMaterial({ map: asphalt, color: 0x9a9da4, roughness: 0.92, metalness: 0 }),
      mark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
      shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }),
      office: facade('office'), apartment: facade('apartment'), mixed: facade('mixed'),
      sign: new THREE.MeshStandardMaterial({ map: signs, emissiveMap: signs, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.55, side: THREE.DoubleSide }),
      shop: new THREE.MeshStandardMaterial({ map: shops, emissiveMap: shops, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.6 }),
      glowFront: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.4 }),
      lampHead: new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe2a8, emissiveIntensity: 0, roughness: 0.4 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x9fefff, emissive: 0x39d8ff, emissiveIntensity: 1.6, roughness: 0.3 }),
      grass: new THREE.MeshStandardMaterial({ map: groundTexture('grass'), roughness: 1 }),
      dirt: new THREE.MeshStandardMaterial({ map: groundTexture('dirt'), roughness: 1 }),
      wire: new THREE.LineBasicMaterial({ color: 0x2a2d33, transparent: true, opacity: 0.55 }),
      glow: new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      grid: new THREE.MeshBasicMaterial({ color: 0x6fe7ff, transparent: true, opacity: 0.22, depthWrite: false }),
    };
  }

  // ---------------------------------------------------------------- 台座と下の格子
  _base() {
    const { x0, x1, z0, z1 } = this.b;
    const w = x1 - x0, d = z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const slab = new Builder();
    // 台座の側面：上は土、下へ行くほど岩・暗く
    const g = new THREE.BoxGeometry(w, SLAB_DEPTH, d, 1, 6, 1);
    g.translate(cx, -SLAB_DEPTH / 2 - 0.03, cz);
    paint(g, 0x8a6a4a);
    const pos = g.attributes.position, col = g.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const t = -(pos.getY(i) + 0.03) / SLAB_DEPTH; // 0（上）〜1（下）
      const c = new THREE.Color().lerpColors(new THREE.Color(0x9b7752), new THREE.Color(0x3b3a44), Math.min(1, t * 1.3));
      if (t < 0.06) c.set(0x6f8f4a); // 上の縁は草
      col.setXYZ(i, c.r, c.g, c.b);
    }
    slab.add(g);
    const m = slab.mesh(this.mats.solid, { cast: false, name: 'slab' });
    this.group.add(m);
    // 下に広がる格子（AI の見ている空間）。台座から離れるほど薄く
    const size = Math.max(w, d) * 7;
    const gg = new THREE.PlaneGeometry(size, size);
    gg.rotateX(-Math.PI / 2);
    this.gridU = { color: { value: new THREE.Color(0x6fe7ff) }, alpha: { value: 0.16 }, center: { value: new THREE.Vector2(cx, cz) }, radius: { value: Math.max(w, d) * 1.6 }, cell: { value: 12 } };
    const gm = new THREE.ShaderMaterial({
      uniforms: this.gridU, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 color; uniform float alpha, radius, cell; uniform vec2 center; varying vec3 vW;
        void main(){
          vec2 p = vW.xz / cell;
          vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4));
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float d = length(vW.xz - center) / max(radius, 1.0);
          float fade = clamp(1.0 - d, 0.0, 1.0);
          gl_FragColor = vec4(color, line * alpha * fade * fade);
        }`,
    });
    const grid = new THREE.Mesh(gg, gm);
    grid.position.set(cx, -SLAB_DEPTH - 5, cz);
    grid.name = 'grid';
    grid.renderOrder = -5;
    this.grid = grid;
    this.group.add(grid);
  }

  // ---------------------------------------------------------------- 道路と白線
  _roads() {
    const { x0, x1, z0, z1 } = this.b;
    const road = new Builder();
    const uvWorld = (geo) => {
      const p = geo.attributes.position;
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 8; uv[i * 2 + 1] = p.getZ(i) / 8; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return geo;
    };
    // 台座の上いっぱいにアスファルト（歩道の角の丸みのすき間も道路に見えるように）
    road.add(uvWorld(flatQuad((x0 + x1) / 2, (z0 + z1) / 2, z1 - z0, x1 - x0, 0, -0.012)));
    for (const x of this.cols) road.add(uvWorld(flatQuad(x, (z0 + z1) / 2, z1 - z0, RH * 2, 0, 0)));
    for (const z of this.rows) road.add(uvWorld(flatQuad((x0 + x1) / 2, z, x1 - x0, RH * 2, Math.PI / 2, 0.001)));
    const rm = road.mesh(this.mats.road, { cast: false, name: 'roads' });
    this.group.add(rm);
    this.roadMesh = rm;

    // 白線・黄線・停止線・横断歩道
    const mk = new Builder();
    const WHITE = 0xf2f2ee, YELLOW = 0xf2c230;
    const Y = 0.012;
    const inter = this.net.inter;
    // 交差点の近く（停止線より内側）は線を引かない区間
    const gaps = (pos, along) => inter.filter((X) => (along === 'z' ? X.pos.x : X.pos.z) === pos).map((X) => (along === 'z' ? X.pos.z : X.pos.x));
    const segs = (a, b, holes, pad) => {
      const out = [];
      let s = a;
      for (const h of [...holes].sort((p, q) => p - q)) { if (h - pad > s) out.push([s, h - pad]); s = Math.max(s, h + pad); }
      if (b > s) out.push([s, b]);
      return out;
    };
    for (const x of this.cols) {
      for (const [a, b] of segs(z0, z1, gaps(x, 'z'), STOP)) {
        mk.geo(flatQuad(x, (a + b) / 2, b - a, 0.16, 0, Y), YELLOW);                 // 中央線（はみ出し禁止の黄線）
        for (const s of [-1, 1]) mk.geo(flatQuad(x + s * (RH - 0.35), (a + b) / 2, b - a, 0.14, 0, Y), WHITE); // 外側線
      }
    }
    for (const z of this.rows) {
      for (const [a, b] of segs(x0, x1, gaps(z, 'x'), STOP)) {
        mk.geo(flatQuad((a + b) / 2, z, b - a, 0.16, Math.PI / 2, Y), YELLOW);
        for (const s of [-1, 1]) mk.geo(flatQuad((a + b) / 2, z + s * (RH - 0.35), b - a, 0.14, Math.PI / 2, Y), WHITE);
      }
    }
    for (const X of inter) {
      const { x, z } = X.pos;
      for (const side of ['N', 'E', 'S', 'W']) {
        const cw = X.cwBy[side];
        if (!cw) continue;
        const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[side];
        const vertical = side === 'N' || side === 'S';
        // 横断歩道：車の進む向きに長い白い帯を、道の幅いっぱいに並べる
        const mid = BOX + CW_W / 2;
        for (let u = -RH + 0.45; u <= RH - 0.2; u += 0.9) {
          const px = x + d[0] * mid + (vertical ? u : 0);
          const pz = z + d[1] * mid + (vertical ? 0 : u);
          mk.geo(flatQuad(px, pz, CW_W, 0.45, vertical ? 0 : Math.PI / 2, Y), WHITE);
        }
        // 停止線：その道から交差点に入ってくる車線の側だけ（左側通行）
        const sl = STOP + 0.25;
        const lx = vertical ? x + (side === 'N' ? 1 : -1) * RH / 2 : x + d[0] * sl;
        const lz = vertical ? z + d[1] * sl : z + (side === 'E' ? 1 : -1) * RH / 2;
        mk.geo(flatQuad(lx, lz, RH - 0.2, 0.45, vertical ? Math.PI / 2 : 0, Y), WHITE);
        // ◇（この先に横断歩道あり）
        for (const dd of [22, 32]) {
          const qx = vertical ? x + (side === 'N' ? 1 : -1) * RH / 2 : x + d[0] * (STOP + dd);
          const qz = vertical ? z + d[1] * (STOP + dd) : z + (side === 'E' ? 1 : -1) * RH / 2;
          const inside = qx > x0 + 4 && qx < x1 - 4 && qz > z0 + 4 && qz < z1 - 4;
          const tooClose = inter.some((o) => o !== X && Math.hypot(o.pos.x - qx, o.pos.z - qz) < STOP + 6);
          if (!inside || tooClose) continue;
          const dia = new THREE.RingGeometry(0.9, 1.15, 4, 1);
          dia.rotateX(-Math.PI / 2);
          dia.scale(vertical ? 0.55 : 1.6, 1, vertical ? 1.6 : 0.55);
          dia.translate(qx, Y, qz);
          mk.geo(dia, WHITE);
        }
      }
      // スクランブル交差点は斜めの横断歩道も
      if (X.scramble) {
        for (const s of [-1, 1]) {
          for (let u = -6; u <= 6; u += 0.9) {
            const g = flatQuad(0, 0, 2.6, 0.45, 0, Y);
            g.rotateY(s * Math.PI / 4);
            g.translate(x + u * Math.SQRT1_2 * s, 0, z + u * Math.SQRT1_2);
            mk.geo(g, WHITE);
          }
        }
      }
    }
    this.group.add(mk.mesh(this.mats.mark, { cast: false, name: 'markings' }));
  }

  // ---------------------------------------------------------------- 歩道のブロックと建物
  _blocks() {
    const { x0, x1, z0, z1 } = this.b;
    const xs = [x0, ...this.cols.flatMap((x) => [x - RH, x + RH]), x1];
    const zs = [z0, ...this.rows.flatMap((z) => [z - RH, z + RH]), z1];
    const curb = new Builder();
    const S = { solid: new Builder(), office: new Builder(), apartment: new Builder(), mixed: new Builder(), sign: new Builder(), shop: new Builder(), glow: new Builder(), shiny: new Builder(), grass: new Builder(), dirt: new Builder() };
    this.S = S;
    this.trees = [];
    this.poles = [];
    const nbx = this.cols.length + 1, nbz = this.rows.length + 1;
    for (let bi = 0; bi < nbx; bi++) {
      for (let bj = 0; bj < nbz; bj++) {
        const ax = xs[bi * 2], bx = xs[bi * 2 + 1], az = zs[bj * 2], bz = zs[bj * 2 + 1];
        // どの辺が道路に面しているか（台座の端の辺は面していない）
        const face = { W: bi > 0, E: bi < nbx - 1, N: bj > 0, S: bj < nbz - 1 };
        const R = 3.2;
        const g = roundedSlab(ax, az, bx, bz, CURB_H, [face.W && face.N ? R : 0, face.E && face.N ? R : 0, face.E && face.S ? R : 0, face.W && face.S ? R : 0]);
        curb.geo(g, 0xc9c3b6);
        const zone = this._zone(bi, bj, nbx, nbz);
        this._fillBlock({ ax, bx, az, bz, face, zone, bi, bj });
      }
    }
    // 歩道の縁石の線（少し暗く）は、ブロックの側面の色で出す
    this.group.add(curb.mesh(this.mats.solid, { cast: false, name: 'sidewalks' }));
    for (const [k, b] of Object.entries(S)) {
      if (b.empty) continue;
      const mat = k === 'glow' ? this.mats.glowFront : this.mats[k];
      const m = b.mesh(mat, { name: 'bld-' + k, cast: !['sign', 'shop', 'grass', 'dirt'].includes(k), receive: true });
      this.group.add(m);
    }
  }

  /** ブロックの用途：中心に近いほど店やビル、外ほど住宅。地図の定義で上書きできる（zones: { '1,0': 'park' }）。 */
  _zone(bi, bj, nbx, nbz) {
    const key = `${bi},${bj}`;
    if (this.def.zones?.[key]) return this.def.zones[key];
    const cx = (nbx - 1) / 2, cz = (nbz - 1) / 2;
    const dd = Math.hypot(bi - cx, bj - cz) / Math.max(1, Math.hypot(cx, cz));
    const r = hash2(bi * 7.1, bj * 3.3, 11);
    if (dd < 0.55) return r < 0.7 ? 'commercial' : 'mixed';
    return r < 0.5 ? 'residential' : r < 0.85 ? 'mixed' : 'commercial';
  }

  /** ブロックの中を敷地に分けて、建物を置く。 */
  _fillBlock(B) {
    const { ax, bx, az, bz, face, zone } = B;
    // 道路に面した辺は歩道ぶん下げる。台座の端は少しだけ
    const ix0 = ax + (face.W ? SW : 1.2), ix1 = bx - (face.E ? SW : 1.2);
    const iz0 = az + (face.N ? SW : 1.2), iz1 = bz - (face.S ? SW : 1.2);
    if (ix1 - ix0 < 4 || iz1 - iz0 < 4) return;
    // 歩道の木と電柱・街灯（道路に面した辺に沿って）
    this._streetside(B, ix0, ix1, iz0, iz1);
    if (zone === 'park') return this._park(ix0, ix1, iz0, iz1, B);
    if (zone === 'school') return this._school(ix0, ix1, iz0, iz1, B);
    // 敷地に分ける（長い辺を割っていく）
    const lots = [];
    const split = (x0, x1, z0, z1, depth) => {
      const w = x1 - x0, d = z1 - z0;
      const maxS = zone === 'residential' ? 13 : 17;
      if ((w <= maxS && d <= maxS) || depth > 6) { lots.push({ x0, x1, z0, z1 }); return; }
      const r = hash2(x0 + x1, z0 + z1, depth);
      if (w >= d) { const m = x0 + w * (0.35 + r * 0.3); split(x0, m, z0, z1, depth + 1); split(m, x1, z0, z1, depth + 1); }
      else { const m = z0 + d * (0.35 + r * 0.3); split(x0, x1, z0, m, depth + 1); split(x0, x1, m, z1, depth + 1); }
    };
    split(ix0, ix1, iz0, iz1, 0);
    for (const L of lots) {
      // その敷地が道路に面している向き
      const front = [];
      if (face.N && Math.abs(L.z0 - iz0) < 0.01) front.push('N');
      if (face.S && Math.abs(L.z1 - iz1) < 0.01) front.push('S');
      if (face.W && Math.abs(L.x0 - ix0) < 0.01) front.push('W');
      if (face.E && Math.abs(L.x1 - ix1) < 0.01) front.push('E');
      const r = hash2(L.x0 * 1.3 + L.x1, L.z0 * 0.7 + L.z1, 5);
      let type;
      if (!front.length) type = r < 0.3 ? 'parking' : zone === 'residential' ? 'house' : r < 0.65 ? 'apartment' : 'house';
      else if (zone === 'commercial') type = r < 0.42 ? 'office' : r < 0.85 ? 'mixed' : r < 0.93 ? 'shop' : 'apartment';
      else if (zone === 'mixed') type = r < 0.4 ? 'mixed' : r < 0.65 ? 'apartment' : r < 0.85 ? 'house' : r < 0.93 ? 'shop' : 'parking';
      else type = r < 0.55 ? 'house' : r < 0.85 ? 'apartment' : r < 0.93 ? 'mixed' : 'parking';
      this._building(type, L, front, r);
    }
  }

  // ---------------------------------------------------------------- 建物の種類
  _building(type, L, front, r) {
    const S = this.S;
    const gap = 0.5;
    const x0 = L.x0 + gap, x1 = L.x1 - gap, z0 = L.z0 + gap, z1 = L.z1 - gap;
    const w = x1 - x0, d = z1 - z0;
    if (w < 2.5 || d < 2.5) return;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const base = CURB_H;
    const r2 = hash2(cx, cz, 21), r3 = hash2(cx, cz, 33);
    if (type === 'parking') {
      S.solid.box(w, 0.04, d, 0x8b8e94, { x: cx, y: base, z: cz });
      const n = Math.max(1, Math.floor(w / 2.6));
      for (let i = 0; i <= n; i++) S.solid.box(0.12, 0.05, Math.min(5, d * 0.45), 0xe8e8e8, { x: x0 + (w / n) * i, y: base, z: z0 + Math.min(5, d * 0.45) / 2 + 0.3 });
      for (let i = 0; i < n; i++) {
        if (hash2(cx + i, cz, 4) < 0.45) continue;
        const col = [0xd8dde3, 0x2f3540, 0xb9312f, 0x3a5f9b, 0xe9e4d6, 0x6c7a89][Math.floor(hash2(cx, cz + i, 9) * 6)];
        const px = x0 + (w / n) * (i + 0.5), pz = z0 + 2.6;
        S.shiny.box(1.7, 0.8, 4.1, col, { x: px, y: base + 0.2, z: pz });
        S.shiny.box(1.5, 0.6, 2.2, 0x29303a, { x: px, y: base + 1.0, z: pz + 0.2 });
      }
      return;
    }
    if (type === 'house') {
      const floors = 2;
      const h = floors * 2.9;
      const wall = [0xf1ead8, 0xe9e3d3, 0xd9d2c3, 0xf5f2ea, 0xcfd6d9, 0xe7d3bd][Math.floor(r2 * 6)];
      const roof = [0x4a5260, 0x3c4a63, 0x6b4a3a, 0x8c4b3a, 0x59605a][Math.floor(r3 * 5)];
      const hw = Math.min(w, 9.5), hd = Math.min(d, 9.5);
      S.solid.box(hw, h, hd, wall, { x: cx, y: base, z: cz, shade: 0.8 });
      // 切妻屋根
      const ridgeAlongX = hw >= hd;
      const rw = (ridgeAlongX ? hd : hw) + 0.8, rl = (ridgeAlongX ? hw : hd) + 0.8;
      const shape = new THREE.Shape([new THREE.Vector2(-rw / 2, 0), new THREE.Vector2(rw / 2, 0), new THREE.Vector2(0, rw * 0.32)]);
      const rg = new THREE.ExtrudeGeometry(shape, { depth: rl, bevelEnabled: false });
      rg.translate(0, 0, -rl / 2);
      if (ridgeAlongX) rg.rotateY(Math.PI / 2);
      S.solid.geo(rg, roof, { x: cx, y: base + h, z: cz });
      // 窓（道路側に 2 つずつ）
      for (const f of front.length ? front : ['S']) this._houseWindows(f, cx, cz, hw, hd, base);
      // ブロック塀
      if (front.length) {
        const f = front[0];
        const along = f === 'N' || f === 'S';
        const off = (along ? d : w) / 2 + 0.05;
        const px = along ? cx : cx + (f === 'E' ? off : -off), pz = along ? cz + (f === 'S' ? off : -off) : cz;
        S.solid.box(along ? w * 0.42 : 0.18, 1.1, along ? 0.18 : d * 0.42, 0xb9b4aa, { x: px + (along ? -w * 0.29 : 0), y: base, z: pz + (along ? 0 : -d * 0.29) });
      }
      if (r3 < 0.5) this.trees.push({ x: x0 + 1.2, z: z1 - 1.2, s: 0.7 + r2 * 0.3, kind: 'garden' });
      return;
    }
    if (type === 'shop') {
      const h = 4.6;
      S.solid.box(w, h, d, 0xf3f1ec, { x: cx, y: base, z: cz, shade: 0.85 });
      S.solid.box(w + 0.2, 0.25, d + 0.2, 0xd8d6d0, { x: cx, y: base + h, z: cz });
      for (const f of front) {
        this._frontPanel(f, x0, x1, z0, z1, base + 0.2, base + 3.0, 0x223040, 'glow');   // ガラス（夜は明るい）
        this._shopSign(f, x0, x1, z0, z1, base + 3.2, Math.floor(hash2(cx, cz, 7) * SHOP_TEXT.length) || 3);
      }
      if (front.length) this._vending(front[0], x0, x1, z0, z1, base);
      return;
    }
    // ビル（office / mixed / apartment）
    const floorH = type === 'office' ? 3.8 : 3.1;
    const tall = type === 'office' ? 3 + Math.floor(r2 * 3) : type === 'apartment' ? 3 + Math.floor(r2 * 3) : 2 + Math.floor(r2 * 3);
    const ground = type === 'apartment' ? 0 : 4.2;
    const h = ground + tall * floorH;
    const tint = type === 'office' ? [0xdfe8f2, 0xcfdcea, 0xe9eef2, 0xc8d8e4, 0xd9e2dc][Math.floor(r3 * 5)]
      : type === 'apartment' ? [0xfbf3e4, 0xf3e6d3, 0xfaf7f0, 0xe4ebf0, 0xf2dccb, 0xdfe9df, 0xe9d2c0][Math.floor(r3 * 7)]
        : [0xf0d9c2, 0xe0dbd0, 0xcfe0d2, 0xf2d4cf, 0xe6dcb8, 0xd2dbe8, 0xe8c9a8, 0xc9d6c2][Math.floor(r3 * 8)];
    // 1 階（店）
    if (ground) {
      S.solid.box(w, ground, d, 0xd9d4ca, { x: cx, y: base, z: cz, shade: 0.8 });
      for (const f of front) {
        this._frontPanel(f, x0, x1, z0, z1, base + 0.15, base + 3.0, 0x1f2a36, 'glow');
        this._awning(f, x0, x1, z0, z1, base + 3.1, [0xc0392b, 0x2f6fb5, 0x2f9e62, 0xe08a2e, 0x6b4a3a][Math.floor(r2 * 5)]);
      }
    }
    // 上の階（窓の模様）
    const fg = facadeBox(x0, z0, x1, z1, base + ground, base + h, floorH, type === 'office' ? 3.2 : 3.0, hash2(cx, cz, 3) * 4, 0);
    S[type].geo(fg, tint);
    // 屋上
    S.solid.box(w, 0.12, d, [0xa4a8ad, 0x9aa79a, 0xb3aa9c, 0x8f979f, 0xb8bbbf][Math.floor(hash2(cx, cz, 13) * 5)], { x: cx, y: base + h, z: cz });
    S.solid.box(w, 0.6, 0.2, 0xbfc2c6, { x: cx, y: base + h, z: z0 + 0.1 });
    S.solid.box(w, 0.6, 0.2, 0xbfc2c6, { x: cx, y: base + h, z: z1 - 0.1 });
    S.solid.box(0.2, 0.6, d, 0xbfc2c6, { x: x0 + 0.1, y: base + h, z: cz });
    S.solid.box(0.2, 0.6, d, 0xbfc2c6, { x: x1 - 0.1, y: base + h, z: cz });
    if (w > 5 && d > 5) {
      S.solid.box(1.6, 1.2, 1.2, 0x9da3a8, { x: cx - w * 0.2, y: base + h, z: cz + d * 0.15 });
      if (r3 > 0.4) S.solid.cyl(1.0, 1.0, 1.8, 0xc9ccd0, { x: cx + w * 0.2, y: base + h + 0.4, z: cz - d * 0.15 }, 10);
      if (type === 'office' && tall > 5) S.solid.box(w * 0.5, 2.4, d * 0.4, 0xa9b2bc, { x: cx, y: base + h, z: cz });
    }
    // 雑居ビルの縦の看板と室外機
    if (type === 'mixed') {
      for (const f of front) {
        const n = 1 + Math.floor(hash2(cx, cz, 17 + f.charCodeAt(0)) * 2);
        for (let k = 0; k < n; k++) {
          const idx = Math.floor(hash2(cx + k * 3.1, cz, 23 + f.charCodeAt(0)) * SIGN_TEXT.length);
          this._vSign(f, x0, x1, z0, z1, base + ground + 0.6 + k * 0.2, Math.min(h - ground - 1.2, 3.6 + hash2(cx, cz, k) * 2.5), idx, (k - (n - 1) / 2) * 0.55);
        }
      }
      const side = front.includes('E') ? 'W' : 'E';
      for (let k = 0; k < Math.min(tall, 6); k++) {
        const y = base + ground + k * floorH + 0.6;
        const px = side === 'E' ? x1 + 0.35 : x0 - 0.35;
        if (hash2(cx, k, 41) < 0.6) S.solid.box(0.6, 0.6, 0.8, 0xdcdcd4, { x: px, y, z: cz + (hash2(cx, k, 43) - 0.5) * d * 0.6 });
      }
    }
    if (front.length && type !== 'apartment' && hash2(cx, cz, 51) < 0.35) this._vending(front[0], x0, x1, z0, z1, base);
  }

  _houseWindows(f, cx, cz, w, d, base) {
    const S = this.S;
    for (let fl = 0; fl < 2; fl++) {
      for (const s of [-0.25, 0.25]) {
        const y = base + 1.0 + fl * 2.9;
        if (f === 'N' || f === 'S') S.solid.box(1.4, 1.1, 0.06, 0x34404f, { x: cx + s * w, y, z: cz + (f === 'S' ? d / 2 + 0.02 : -d / 2 - 0.02) });
        else S.solid.box(0.06, 1.1, 1.4, 0x34404f, { x: cx + (f === 'E' ? w / 2 + 0.02 : -w / 2 - 0.02), y, z: cz + s * d });
      }
    }
  }

  /** 道路側の壁に貼る板（店のガラス）。 */
  _frontPanel(f, x0, x1, z0, z1, ya, yb, color, layer) {
    const S = this.S[layer];
    const h = yb - ya, t = 0.06;
    const w = (f === 'N' || f === 'S') ? x1 - x0 - 0.6 : z1 - z0 - 0.6;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (f === 'N') S.box(w, h, t, color, { x: cx, y: ya, z: z0 - t / 2 });
    if (f === 'S') S.box(w, h, t, color, { x: cx, y: ya, z: z1 + t / 2 });
    if (f === 'W') S.box(t, h, w, color, { x: x0 - t / 2, y: ya, z: cz });
    if (f === 'E') S.box(t, h, w, color, { x: x1 + t / 2, y: ya, z: cz });
  }

  _awning(f, x0, x1, z0, z1, y, color) {
    const S = this.S.solid;
    const w = (f === 'N' || f === 'S') ? x1 - x0 - 0.4 : z1 - z0 - 0.4;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const o = 0.55;
    if (f === 'N') S.box(w, 0.18, 1.1, color, { x: cx, y, z: z0 - o, rx: -0.25 });
    if (f === 'S') S.box(w, 0.18, 1.1, color, { x: cx, y, z: z1 + o, rx: 0.25 });
    if (f === 'W') S.box(1.1, 0.18, w, color, { x: x0 - o, y, z: cz, rz: 0.25 });
    if (f === 'E') S.box(1.1, 0.18, w, color, { x: x1 + o, y, z: cz, rz: -0.25 });
  }

  /** 店の横の看板（帯）。 */
  _shopSign(f, x0, x1, z0, z1, y, idx) {
    const w = (f === 'N' || f === 'S') ? x1 - x0 - 0.4 : z1 - z0 - 0.4;
    const h = 0.9;
    const g = new THREE.PlaneGeometry(w, h);
    // アトラスの 1 行（8 行）
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (idx + 1 - uv.getY(i)) / 8);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const o = 0.08;
    const ry = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[f];
    const px = f === 'E' ? x1 + o : f === 'W' ? x0 - o : cx;
    const pz = f === 'S' ? z1 + o : f === 'N' ? z0 - o : cz;
    g.rotateY(ry);
    g.translate(px, y + h / 2, pz);
    this.S.shop.geo(g, 0xffffff);
  }

  /** 縦の看板（壁から道路へ突き出す）。 */
  _vSign(f, x0, x1, z0, z1, y, h, idx, shift) {
    const wv = 0.9;
    const g = new THREE.PlaneGeometry(wv, h);
    const uv = g.attributes.uv;
    const col = idx % 8, row = Math.floor(idx / 8);
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, (col + uv.getX(i)) / 8);
      uv.setY(i, 1 - (row + 1 - uv.getY(i)) / 2);
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const out = 0.65;
    // 看板の面は道路と平行に進む人から見えるよう、壁に直角に立てる
    const ry = (f === 'N' || f === 'S') ? Math.PI / 2 : 0;
    g.rotateY(ry);
    const px = f === 'E' ? x1 + out : f === 'W' ? x0 - out : cx + shift * (x1 - x0) * 0.4;
    const pz = f === 'S' ? z1 + out : f === 'N' ? z0 - out : cz + shift * (z1 - z0) * 0.4;
    g.translate(px, y + h / 2, pz);
    this.S.sign.geo(g, 0xffffff);
    // 枠（金属）
    this.S.solid.box((f === 'N' || f === 'S') ? 0.12 : wv + 0.12, 0.12, (f === 'N' || f === 'S') ? wv + 0.12 : 0.12, 0x7b7f86, { x: px, y: y + h, z: pz });
  }

  /** 自販機（夜は前が光る）。 */
  _vending(f, x0, x1, z0, z1, base) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const o = 0.55;
    let px, pz, ry;
    if (f === 'S') { px = x0 + 1.3; pz = z1 + o; ry = 0; }
    else if (f === 'N') { px = x1 - 1.3; pz = z0 - o; ry = Math.PI; }
    else if (f === 'E') { px = x1 + o; pz = z0 + 1.3; ry = Math.PI / 2; }
    else { px = x0 - o; pz = z1 - 1.3; ry = -Math.PI / 2; }
    void cx; void cz;
    const color = [0xd8323a, 0x2a6fd6, 0xf2f2f2, 0x1f9d55][Math.floor(hash2(px, pz, 61) * 4)];
    this.S.solid.box(0.95, 1.85, 0.7, color, { x: px, y: base, z: pz, ry });
    const fx = px + Math.sin(ry) * 0.36, fz = pz + Math.cos(ry) * 0.36;
    this.S.glow.box(0.8, 1.2, 0.02, 0xdde8ff, { x: fx, y: base + 0.55, z: fz, ry });
    this.vendPos.push({ x: fx + Math.sin(ry) * 0.6, z: fz + Math.cos(ry) * 0.6 });
  }

  _park(x0, x1, z0, z1, B) {
    const S = this.S;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { uv.setX(i, uv.getX(i) * (x1 - x0) / 10); uv.setY(i, uv.getY(i) * (z1 - z0) / 10); }
    // 芝生は歩道の板から少し浮かせる（近すぎると、遠くから見たときに下の板が透けてちらつく）
    S.grass.geo(g, 0xffffff, { x: (x0 + x1) / 2, y: CURB_H + GROUND_LIFT, z: (z0 + z1) / 2 });
    // 小道
    S.solid.box(x1 - x0, 0.06, 1.6, 0xd9c8a8, { x: (x0 + x1) / 2, y: CURB_H + GROUND_LIFT, z: (z0 + z1) / 2 });
    S.solid.box(1.6, 0.06, z1 - z0, 0xd9c8a8, { x: (x0 + x1) / 2, y: CURB_H + GROUND_LIFT, z: (z0 + z1) / 2 });
    for (let i = 0; i < 14; i++) {
      const x = x0 + 2 + hash2(i, B.bi, 71) * (x1 - x0 - 4), z = z0 + 2 + hash2(B.bj, i, 73) * (z1 - z0 - 4);
      if (Math.abs(x - (x0 + x1) / 2) < 1.6 || Math.abs(z - (z0 + z1) / 2) < 1.6) continue;
      this.trees.push({ x, z, s: 0.9 + hash2(x, z, 1) * 0.6, kind: hash2(x, z, 2) < 0.3 ? 'sakura' : 'park' });
    }
    // ベンチ・すべり台
    S.solid.box(1.8, 0.45, 0.5, 0x8a5a3a, { x: (x0 + x1) / 2 + 3, y: CURB_H, z: (z0 + z1) / 2 + 1.6 });
    S.solid.box(0.8, 1.6, 3, 0xe85d5d, { x: x0 + 3, y: CURB_H, z: z0 + 4, rx: 0.4 });
  }

  _school(x0, x1, z0, z1, B) {
    const S = this.S;
    const w = x1 - x0, d = z1 - z0;
    // 校庭
    const g = new THREE.PlaneGeometry(w, d * 0.55);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { uv.setX(i, uv.getX(i) * w / 10); uv.setY(i, uv.getY(i) * d * 0.55 / 10); }
    S.dirt.geo(g, 0xffffff, { x: (x0 + x1) / 2, y: CURB_H + GROUND_LIFT, z: z0 + d * 0.275 });
    // 校舎（4 階）
    const bz0 = z0 + d * 0.6, bz1 = z1 - 1;
    const fg = facadeBox(x0 + 1, bz0, x1 - 1, bz1, CURB_H, CURB_H + 13.2, 3.3, 3.0, 0.3, 0);
    S.apartment.geo(fg, 0xf7f7f2);
    S.solid.box(w - 2, 0.3, bz1 - bz0, 0x9aa0a6, { x: (x0 + x1) / 2, y: CURB_H + 13.2, z: (bz0 + bz1) / 2 });
    // 時計
    S.solid.cyl(1.1, 1.1, 0.2, 0xffffff, { x: (x0 + x1) / 2, y: CURB_H + 11.5, z: bz0 - 0.1, rx: Math.PI / 2 }, 16);
    void B;
  }

  // ---------------------------------------------------------------- 道ばたのもの
  _streetside(B, ix0, ix1, iz0, iz1) {
    const { face } = B;
    // 歩道の、車道に近い側に木と街灯、建物に近い側に電柱
    const lines = [];
    if (face.N) lines.push({ a: [ix0 + 2, iz0 - SW + 0.7], b: [ix1 - 2, iz0 - SW + 0.7], out: [0, -1], pole: iz0 - 0.4 });
    if (face.S) lines.push({ a: [ix0 + 2, iz1 + SW - 0.7], b: [ix1 - 2, iz1 + SW - 0.7], out: [0, 1], pole: iz1 + 0.4 });
    if (face.W) lines.push({ a: [ix0 - SW + 0.7, iz0 + 2], b: [ix0 - SW + 0.7, iz1 - 2], out: [-1, 0], pole: ix0 - 0.4 });
    if (face.E) lines.push({ a: [ix1 + SW - 0.7, iz0 + 2], b: [ix1 + SW - 0.7, iz1 - 2], out: [1, 0], pole: ix1 + 0.4 });
    for (const L of lines) {
      const len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
      if (len < 6) continue;
      const n = Math.max(1, Math.floor(len / 11));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = L.a[0] + (L.b[0] - L.a[0]) * t, z = L.a[1] + (L.b[1] - L.a[1]) * t;
        const h = hash2(x, z, 81);
        if (i % 3 === 1) this._lamp(x, z, L.out);
        else if (h < 0.8) this.trees.push({ x, z, s: 0.8 + hash2(x, z, 83) * 0.35, kind: h < 0.18 ? 'ginkgo' : 'street' });
      }
      // 電柱（建物側の端に、25 m おき）
      const m = Math.max(1, Math.floor(len / 24));
      const row = [];
      for (let i = 0; i <= m; i++) {
        const t = i / m;
        const isZ = L.out[0] !== 0;
        const x = isZ ? L.pole : L.a[0] + (L.b[0] - L.a[0]) * t;
        const z = isZ ? L.a[1] + (L.b[1] - L.a[1]) * t : L.pole;
        row.push({ x, z });
      }
      this.poles.push(row);
    }
  }

  _lamp(x, z, out) {
    const S = this.S.solid;
    S.cyl(0.07, 0.09, 6.2, 0x6f747c, { x, y: CURB_H, z }, 6);
    const ax = x + out[0] * 0.9, az = z + out[1] * 0.9;
    S.box(Math.abs(out[0]) * 1.8 + 0.08, 0.08, Math.abs(out[1]) * 1.8 + 0.08, 0x6f747c, { x: (x + ax) / 2 + out[0] * 0.0, y: CURB_H + 6.1, z: (z + az) / 2 });
    this.lampPos.push({ x: ax + out[0] * 0.5, y: CURB_H + 6.0, z: az + out[1] * 0.5 });
  }

  _props() {
    // 街路樹（幹と葉を別々にまとめて描く）
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const trees = this.trees;
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9 }), trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), trees.length * 2);
    trunk.name = 'treeTrunks';
    leaves.name = 'treeLeaves';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      const th = (t.kind === 'park' || t.kind === 'sakura' ? 2.6 : 2.2) * t.s;
      m.compose(p.set(t.x, CURB_H, t.z), q.identity(), s.set(t.s, th, t.s));
      trunk.setMatrixAt(i, m);
      const base = { street: 0x5d9b4a, park: 0x4f8f45, garden: 0x6aa552, ginkgo: 0xe8c23a, sakura: 0x5a9a4c }[t.kind] || 0x5d9b4a;
      for (let k = 0; k < 2; k++) {
        const r = hash2(t.x, t.z, 90 + k);
        e.set(r * 3, r * 5, 0);
        q.setFromEuler(e);
        const sc = (k ? 1.05 : 1.4) * t.s * (t.kind === 'ginkgo' ? 0.85 : 1);
        m.compose(p.set(t.x + (k ? 0.5 : -0.2) * t.s, CURB_H + th + (k ? 1.2 : 0.4) * t.s, t.z + (k ? -0.3 : 0.2) * t.s), q, s.set(sc, sc * (t.kind === 'ginkgo' ? 1.5 : 1.05), sc));
        leaves.setMatrixAt(i * 2 + k, m);
        col.set(base).offsetHSL((r - 0.5) * 0.04, 0, (r - 0.5) * 0.12);
        leaves.setColorAt(i * 2 + k, col);
      }
    });
    trunk.castShadow = leaves.castShadow = true;
    trunk.receiveShadow = leaves.receiveShadow = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.group.add(trunk, leaves);

    // 電柱と電線
    const S = new Builder();
    const wire = [];
    for (const row of this.poles) {
      for (const pl of row) {
        S.cyl(0.13, 0.17, 8.6, 0x9a968c, { x: pl.x, y: CURB_H, z: pl.z }, 7);
        S.box(1.6, 0.1, 0.1, 0x6f6a62, { x: pl.x, y: CURB_H + 7.8, z: pl.z, ry: hash2(pl.x, pl.z, 3) < 0.5 ? 0 : Math.PI / 2 });
        if (hash2(pl.x, pl.z, 5) < 0.35) S.cyl(0.28, 0.28, 0.9, 0x8d9096, { x: pl.x + 0.35, y: CURB_H + 6.2, z: pl.z }, 8);
      }
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], b = row[i + 1];
        for (const [hy, off] of [[7.85, -0.6], [7.85, 0.6], [7.2, 0]]) {
          const dx = b.x - a.x, dz = b.z - a.z;
          const nx = -dz / (Math.hypot(dx, dz) || 1), nz = dx / (Math.hypot(dx, dz) || 1);
          const N = 8;
          for (let k = 0; k < N; k++) {
            const t0 = k / N, t1 = (k + 1) / N;
            const sag = (t) => 0.55 * 4 * t * (1 - t);
            wire.push(a.x + dx * t0 + nx * off, CURB_H + hy - sag(t0), a.z + dz * t0 + nz * off,
              a.x + dx * t1 + nx * off, CURB_H + hy - sag(t1), a.z + dz * t1 + nz * off);
          }
        }
      }
    }
    if (!S.empty) this.group.add(S.mesh(this.mats.solid, { name: 'poles' }));
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const wires = new THREE.LineSegments(wg, this.mats.wire);
    wires.name = 'wires';
    this.group.add(wires);

    // 街灯の頭（夜に光る）と、地面の光
    const lampG = new THREE.SphereGeometry(0.28, 10, 6);
    const lamps = new THREE.InstancedMesh(lampG, this.mats.lampHead, this.lampPos.length);
    lamps.name = 'lampHeads';
    this.lampPos.forEach((l, i) => { m.compose(p.set(l.x, l.y, l.z), q.identity(), s.set(1, 0.6, 1)); lamps.setMatrixAt(i, m); });
    this.group.add(lamps);
    const pools = [...this.lampPos.map((l) => ({ x: l.x, z: l.z, r: 6.5 })), ...this.vendPos.map((v) => ({ x: v.x, z: v.z, r: 2.6 }))];
    const poolG = new THREE.PlaneGeometry(1, 1);
    poolG.rotateX(-Math.PI / 2);
    const poolMesh = new THREE.InstancedMesh(poolG, this.mats.glow, pools.length);
    poolMesh.name = 'lightPools';
    pools.forEach((o, i) => { m.compose(p.set(o.x, CURB_H + 0.03, o.z), q.identity(), s.set(o.r * 2, 1, o.r * 2)); poolMesh.setMatrixAt(i, m); });
    poolMesh.renderOrder = 2;
    this.group.add(poolMesh);
  }

  // ---------------------------------------------------------------- 端のゲート（車の出入り口）
  _gates() {
    const S = new Builder();
    const G = new Builder();
    this.gatePos = [];
    for (const T of this.net.terms) {
      const { x, z } = T.pos;
      const vertical = T.side === 'N' || T.side === 'S';
      const w = RH * 2 + 1.6;
      const inset = T.side === 'N' || T.side === 'W' ? 1.0 : -1.0;
      const gx = vertical ? x : x + inset, gz = vertical ? z + inset : z;
      for (const s of [-1, 1]) {
        const px = vertical ? gx + s * w / 2 : gx, pz = vertical ? gz : gz + s * w / 2;
        S.box(0.5, 5.6, 0.5, 0x3a4250, { x: px, y: 0, z: pz });
        G.box(0.12, 5.0, 0.12, 0xffffff, { x: px + (vertical ? -s * 0.28 : 0), y: 0.3, z: pz + (vertical ? 0 : -s * 0.28) });
      }
      S.box(vertical ? w + 0.5 : 0.5, 0.6, vertical ? 0.5 : w + 0.5, 0x3a4250, { x: gx, y: 5.6, z: gz });
      G.box(vertical ? w : 0.14, 0.14, vertical ? 0.14 : w, 0xffffff, { x: gx + (vertical ? 0 : inset * 0.3), y: 5.45, z: gz + (vertical ? inset * 0.3 : 0) });
      this.gatePos.push({ id: T.id, x: gx, y: 6.4, z: gz, side: T.side });
    }
    this.group.add(S.mesh(this.mats.solid, { name: 'gates' }));
    const gm = G.mesh(this.mats.gate, { cast: false, name: 'gateGlow' });
    this.group.add(gm);
  }

  /** 夜の度合い（0 昼〜1 夜）で、窓・看板・街灯・光だまりを変える。 */
  setNight(n, rain = 0) {
    this.night = n;
    const M = this.mats;
    for (const k of ['office', 'apartment', 'mixed']) M[k].emissiveIntensity = n * (k === 'office' ? 1.1 : 0.95);
    M.sign.emissiveIntensity = 0.12 + n * 1.25;
    M.shop.emissiveIntensity = 0.1 + n * 1.0;
    M.glowFront.emissiveIntensity = 0.15 + n * 0.75;
    M.lampHead.emissiveIntensity = n * 3.2;
    M.glow.opacity = n * 0.62;
    // 雨：路面が濡れて暗く、つやが出る
    M.road.roughness = 0.92 - rain * 0.55;
    M.road.color.setRGB(0.6 - rain * 0.2, 0.62 - rain * 0.2, 0.65 - rain * 0.2);
    M.road.metalness = rain * 0.15;
  }
}

/** 窓の模様の 4 つの壁（屋根と床なし）。uv は「柱間 4 つ × 4 階」で 1 になる単位。 */
function facadeBox(x0, z0, x1, z1, y0, y1, floorH, bayW, uOff = 0, vOff = 0) {
  const pos = [], uv = [], nor = [];
  const faces = [
    { a: [x0, z1], b: [x1, z1], n: [0, 0, 1] },
    { a: [x1, z0], b: [x0, z0], n: [0, 0, -1] },
    { a: [x1, z1], b: [x1, z0], n: [1, 0, 0] },
    { a: [x0, z0], b: [x0, z1], n: [-1, 0, 0] },
  ];
  for (const f of faces) {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
    const bays = Math.max(1, Math.round(len / bayW));
    const u0 = uOff, u1 = uOff + bays / 4;
    const v0 = vOff, v1 = vOff + (y1 - y0) / floorH / 4;
    const A = [f.a[0], y0, f.a[1]], Bp = [f.b[0], y0, f.b[1]], C = [f.b[0], y1, f.b[1]], D = [f.a[0], y1, f.a[1]];
    pos.push(...A, ...Bp, ...C, ...A, ...C, ...D);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) nor.push(...f.n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export { CURB_H, SLAB_DEPTH };
