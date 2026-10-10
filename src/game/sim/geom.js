// 平面（x：東が正、z：南が正）の小さな幾何の道具。シミュレーションは y を使わない。
// 左側通行：進む向き h に対して、車線は道路の中心から左へ LANE_W / 2 ずれる。

export const HEADINGS = { N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 } };
export const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
// 左折・右折したあとの向き（北へ進む車が左折すると西へ向かう）
export const LEFT_OF = { N: 'W', W: 'S', S: 'E', E: 'N' };
export const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };
export const AXIS = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };

export const left = (h) => ({ x: h.z, z: -h.x });
export const right = (h) => ({ x: -h.z, z: h.x });
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const mul = (a, k) => ({ x: a.x * k, z: a.z * k });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

/** 3 次ベジェ曲線を n 個に分けた点列。 */
export function bezier(p0, p1, p2, p3, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z });
  }
  return pts;
}

/** 折れ線の道のり。pointAt(s) / dirAt(s) で、始点からの距離 s の位置と向きを返す。 */
export class Path {
  constructor(points) {
    this.pts = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + dist(points[i - 1], points[i]));
    this.len = this.cum[this.cum.length - 1];
  }

  _locate(s) {
    const c = this.cum;
    if (s <= 0) return [0, 0];
    if (s >= this.len) return [c.length - 2, 1];
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const seg = c[lo + 1] - c[lo];
    return [lo, seg > 1e-9 ? (s - c[lo]) / seg : 0];
  }

  pointAt(s, out = { x: 0, z: 0 }) {
    const [i, t] = this._locate(s);
    const a = this.pts[i], b = this.pts[i + 1];
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  dirAt(s, out = { x: 0, z: 1 }) {
    const [i] = this._locate(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    return out;
  }

  /** 等間隔（step m）に取った点と、その距離。 */
  samples(step = 0.25) {
    const n = Math.max(2, Math.ceil(this.len / step) + 1);
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = (this.len * i) / (n - 1);
      out.push({ s, p: this.pointAt(s) });
    }
    return out;
  }
}
