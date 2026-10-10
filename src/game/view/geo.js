// 形を組み立てる小道具。色は頂点色で持たせ、同じ材質のものは 1 つにまとめて描く（描画の回数を減らす）。
//   const b = new Builder();  b.box(w, h, d, color, { x, y, z, ry });  const mesh = b.mesh(material)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** ジオメトリに一色の頂点色をつける（既にあれば掛け合わせない・上書き）。 */
export function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** 上ほど明るく、下ほど暗く（建物の足もとを少し暗くして、地面に置いた感じを出す）。 */
export function shadeY(geo, y0, y1, dark = 0.72) {
  const pos = geo.attributes.position, col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / Math.max(0.01, y1 - y0)));
    const k = dark + (1 - dark) * Math.min(1, t * 3);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

export function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

/** 頂点色つきのジオメトリを集めて、1 つにまとめる。 */
export class Builder {
  constructor() { this.parts = []; }
  add(geo) {
    // まとめるときに属性をそろえる（uv が無いものには 0 を入れる）
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (geo.index) geo = geo.toNonIndexed();
    this.parts.push(geo);
    return geo;
  }
  /** 底面の中心が (x, y, z) の箱。 */
  box(w, h, d, color, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    paint(g, color);
    if (o.shade) shadeY(g, 0, h, o.shade);
    return this.add(place(g, o));
  }
  cyl(rt, rb, h, color, o = {}, seg = 8) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(0, h / 2, 0);
    paint(g, color);
    return this.add(place(g, o));
  }
  geo(g, color, o = {}) {
    if (color !== undefined && color !== null) paint(g, color);
    return this.add(place(g, o));
  }
  get empty() { return !this.parts.length; }
  geometry() {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    return g;
  }
  mesh(material, { cast = true, receive = true, name } = {}) {
    const g = this.geometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    if (name) m.name = name;
    return m;
  }
}

/** 角の丸い長方形の板（歩道のブロック）。r：角の丸み（角ごとに 0 にできる：[左上, 右上, 右下, 左下]）。 */
export function roundedSlab(x0, z0, x1, z1, h, r) {
  const rr = Array.isArray(r) ? r : [r, r, r, r];
  const s = new THREE.Shape();
  // Shape は (x, y) の平面。あとで x-z に倒す（y → -z）
  const P = (x, z) => [x, -z];
  const [a, b, c, d] = rr.map((v) => Math.max(0, Math.min(v, (x1 - x0) / 2, (z1 - z0) / 2)));
  s.moveTo(...P(x0 + a, z0));
  s.lineTo(...P(x1 - b, z0));
  if (b) s.quadraticCurveTo(...P(x1, z0), ...P(x1, z0 + b));
  s.lineTo(...P(x1, z1 - c));
  if (c) s.quadraticCurveTo(...P(x1, z1), ...P(x1 - c, z1));
  s.lineTo(...P(x0 + d, z1));
  if (d) s.quadraticCurveTo(...P(x0, z1), ...P(x0, z1 - d));
  s.lineTo(...P(x0, z0 + a));
  if (a) s.quadraticCurveTo(...P(x0, z0), ...P(x0 + a, z0));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 地面に貼る平らな四角（道路の白線など）。中心 (x, z)、長さ l（向き ry に沿って）、幅 w。 */
export function flatQuad(x, z, l, w, ry = 0, y = 0.02) {
  const g = new THREE.PlaneGeometry(w, l);
  g.rotateX(-Math.PI / 2);
  g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** 0〜1 の擬似乱数（座標から決める。毎回同じ街になる）。 */
export function hash2(x, z, k = 0) {
  let h = Math.imul(Math.floor(x * 73.13) ^ Math.floor(z * 19.71) ^ (k * 2654435761), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
