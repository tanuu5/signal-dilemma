// 道路網：碁盤の目の道路から、交差点（X）・端（T）・車線（Lane）・交差点の中の進路（Conn）を作る。
// 地図の定義（maps.js）：{ cols: [x…], rows: [z…], ext, skip: ['X0_0-X1_0', 'N0'], names: { X0_0: 'key' }, scramble: ['X0_0'] }
//   cols：南北の道路の x、rows：東西の道路の z、ext：いちばん外の交差点から地図の端までの長さ
//   skip：つながない道（隣り合う 2 つの点の id を - でつなぐ。端の点だけを書くと、その端への道がなくなる）
import { HEADINGS, OPP, LEFT_OF, RIGHT_OF, AXIS, left, add, mul, sub, bezier, Path, dist } from './geom.js';
import { LANE_W, STOP, EXIT, BOX, CW_W, ROAD_HALF, WALK_C, TURN_V } from './constants.js';

const CONFLICT_D = 2.25; // 進路の中心線がこれより近いところは、同時に通れない

export class Lane {
  constructor(id, from, to, heading, p0, p1) {
    this.kind = 'lane';
    this.id = id;
    this.from = from;
    this.to = to;
    this.heading = heading;
    this.h = HEADINGS[heading];
    this.path = new Path([p0, p1]);
    this.len = this.path.len;
    this.cars = [];       // 前（s が大きい）から順
    this.next = [];       // この車線の先の Conn（交差点に着く車線だけ）
    this.closed = false;  // 通行止め（行事など）
    this.speedLimit = 12.5;
  }
  get isEntry() { return this.from.kind === 'T'; }
  get isExit() { return this.to.kind === 'T'; }
}

export class Conn {
  constructor(node, from, to, turn, pts) {
    this.kind = 'conn';
    this.node = node;
    this.fromLane = from;
    this.toLane = to;
    this.heading = from.heading;       // 入ってくる向き
    this.exitHeading = to.heading;
    this.turn = turn;                  // 'L' | 'S' | 'R'
    this.id = `${node.id}:${this.heading}${turn}`;
    this.path = new Path(pts);
    this.len = this.path.len;
    this.cars = [];
    this.vmax = TURN_V[turn];
    this.conf = new Map();             // 相手の Conn → { a0, a1（この進路の区間）, b0, b1（相手の区間） }
    this.waitS = null;                 // 右折：対向車を待つ位置（車の前の端）
    this.cw = [];                      // 通る横断歩道：{ cw, s0, s1, u }
  }
}

const key2 = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function buildNetwork(def) {
  const cols = def.cols, rows = def.rows;
  const ext = def.ext ?? 64;
  const skip = new Set();
  for (const k of def.skip || []) {
    const [a, b] = k.split('-');
    if (b) skip.add(key2(a, b));
    else skip.add('T:' + a);
  }
  const nodes = new Map();
  const inter = [];
  const terms = [];
  const addNode = (n) => { nodes.set(n.id, n); (n.kind === 'X' ? inter : terms).push(n); return n; };

  cols.forEach((x, i) => rows.forEach((z, j) => {
    const id = `X${i}_${j}`;
    addNode({
      kind: 'X', id, i, j, pos: { x, z }, name: def.names?.[id] || null, scramble: !!def.scramble?.includes(id),
      approach: { N: null, E: null, S: null, W: null }, exit: { N: null, E: null, S: null, W: null },
      conns: [], connBy: { N: {}, E: {}, S: {}, W: {} }, crosswalks: [], cwBy: {}, box: new Set(),
    });
  }));
  // 端（地図の外とつながる点）。side はその点が地図のどちら側にあるか
  cols.forEach((x, i) => {
    if (!skip.has('T:N' + i)) addNode({ kind: 'T', id: 'N' + i, side: 'N', pos: { x, z: rows[0] - ext }, entry: null, exit: null });
    if (!skip.has('T:S' + i)) addNode({ kind: 'T', id: 'S' + i, side: 'S', pos: { x, z: rows[rows.length - 1] + ext }, entry: null, exit: null });
  });
  rows.forEach((z, j) => {
    if (!skip.has('T:W' + j)) addNode({ kind: 'T', id: 'W' + j, side: 'W', pos: { x: cols[0] - ext, z }, entry: null, exit: null });
    if (!skip.has('T:E' + j)) addNode({ kind: 'T', id: 'E' + j, side: 'E', pos: { x: cols[cols.length - 1] + ext, z }, entry: null, exit: null });
  });

  // 道（となり合う 2 点）と、その上の 2 本の車線
  const links = [];
  const lanes = new Map();
  const chain = (ids) => {
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = nodes.get(ids[k]), b = nodes.get(ids[k + 1]);
      if (!a || !b || skip.has(key2(a.id, b.id))) continue;
      links.push({ a, b, id: key2(a.id, b.id) });
    }
  };
  cols.forEach((x, i) => chain(['N' + i, ...rows.map((_, j) => `X${i}_${j}`), 'S' + i]));
  rows.forEach((z, j) => chain(['W' + j, ...cols.map((_, i) => `X${i}_${j}`), 'E' + j]));

  const headingOf = (a, b) => {
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
  };
  const makeLane = (a, b, link) => {
    const hd = headingOf(a, b);
    const h = HEADINGS[hd];
    const off = mul(left(h), LANE_W / 2);
    const p0 = add(add(a.pos, mul(h, a.kind === 'X' ? EXIT : 0)), off);
    const p1 = add(sub(b.pos, mul(h, b.kind === 'X' ? STOP : 0)), off);
    const lane = new Lane(`${a.id}>${b.id}`, a, b, hd, p0, p1);
    lane.link = link;
    lanes.set(lane.id, lane);
    if (a.kind === 'X') a.exit[hd] = lane;
    else a.entry = lane;
    if (b.kind === 'X') b.approach[hd] = lane;
    else b.exit = lane;
    return lane;
  };
  for (const L of links) { L.ab = makeLane(L.a, L.b, L); L.ba = makeLane(L.b, L.a, L); }

  // 交差点の中の進路
  const conns = new Map();
  for (const X of inter) {
    for (const hd of ['N', 'E', 'S', 'W']) {
      const ap = X.approach[hd];
      if (!ap) continue;
      for (const turn of ['L', 'S', 'R']) {
        const eh = turn === 'L' ? LEFT_OF[hd] : turn === 'R' ? RIGHT_OF[hd] : hd;
        const ex = X.exit[eh];
        if (!ex) continue;
        const P0 = ap.path.pts[1], P3 = ex.path.pts[0];
        let pts;
        if (turn === 'S') pts = [P0, P3];
        else {
          const h = HEADINGS[hd], e = HEADINGS[eh];
          // 2 本の直線の交わる点（角）までの距離から、円に近い曲線を作る。
          // 右折は交差点の中ほどまでまっすぐ進んでから曲がる（対向車を待つ位置を交差点の中に取るため）
          const d0 = Math.abs(h.x ? P3.x - P0.x : P3.z - P0.z);
          const d1 = Math.abs(e.x ? P3.x - P0.x : P3.z - P0.z);
          const k0 = turn === 'R' ? 0.78 : 0.56, k1 = turn === 'R' ? 0.42 : 0.56;
          pts = bezier(P0, add(P0, mul(h, d0 * k0)), sub(P3, mul(e, d1 * k1)), P3, 32);
        }
        const c = new Conn(X, ap, ex, turn, pts);
        conns.set(c.id, c);
        X.conns.push(c);
        X.connBy[hd][turn] = c;
        ap.next.push(c);
      }
    }
    buildCrosswalks(X);
    buildConflicts(X);
  }

  return {
    def, nodes, inter, terms, links, lanes, conns,
    laneList: [...lanes.values()], connList: [...conns.values()],
    entries: terms.filter((t) => t.entry).map((t) => t.entry),
    bounds: {
      x0: cols[0] - ext, x1: cols[cols.length - 1] + ext,
      z0: rows[0] - ext, z1: rows[rows.length - 1] + ext,
    },
  };
}

/** 横断歩道：交差点のまわりの道ごとに 1 本（道のない向きには無い）。 */
function buildCrosswalks(X) {
  const c = X.pos;
  const mid = BOX + CW_W / 2;
  for (const side of ['N', 'E', 'S', 'W']) {
    const has = X.approach[OPP[side]] || X.exit[side];
    if (!has) continue;
    const d = HEADINGS[side];      // 交差点から見たその道の向き
    const across = { x: Math.abs(d.z), z: Math.abs(d.x) }; // 道を横切る向き（x か z の正の向き）
    const center = add(c, mul(d, mid));
    const a = sub(center, mul(across, WALK_C)), b = add(center, mul(across, WALK_C));
    const cw = { id: `${X.id}:${side}`, node: X, side, a, b, center, across, peds: new Set() };
    X.crosswalks.push(cw);
    X.cwBy[side] = cw;
  }
  // 進路が横断歩道を通る区間
  for (const conn of X.conns) {
    for (const cw of X.crosswalks) {
      let s0 = Infinity, s1 = -Infinity, u = 0;
      for (const { s, p } of conn.path.samples(0.25)) {
        const rel = sub(p, cw.center);
        const along = rel.x * cw.across.x + rel.z * cw.across.z;            // 横断歩道に沿った位置
        const off = Math.abs(rel.x * cw.across.z + rel.z * cw.across.x);    // 横断歩道からのずれ
        if (off < CW_W / 2 + 1.0 && Math.abs(along) < ROAD_HALF + 0.5) {
          if (s < s0) { s0 = s; u = along; }
          s1 = Math.max(s1, s);
        }
      }
      if (s0 < Infinity) conn.cw.push({ cw, s0, s1, u });
    }
  }
}

/** 交差点の中の進路どうしの、同時に通れない区間。 */
function buildConflicts(X) {
  const S = X.conns.map((c) => ({ c, pts: c.path.samples(0.25) }));
  for (let i = 0; i < S.length; i++) {
    for (let j = i + 1; j < S.length; j++) {
      const A = S[i], B = S[j];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const pa of A.pts) {
        for (const pb of B.pts) {
          if (Math.abs(pa.p.x - pb.p.x) > CONFLICT_D || Math.abs(pa.p.z - pb.p.z) > CONFLICT_D) continue;
          if (dist(pa.p, pb.p) < CONFLICT_D) {
            if (pa.s < a0) a0 = pa.s;
            if (pa.s > a1) a1 = pa.s;
            if (pb.s < b0) b0 = pb.s;
            if (pb.s > b1) b1 = pb.s;
          }
        }
      }
      if (a0 === Infinity) continue;
      A.c.conf.set(B.c, { a0, a1, b0, b1 });
      B.c.conf.set(A.c, { a0: b0, a1: b1, b0: a0, b1: a1 });
    }
  }
  // 右折の待つ位置：対向の直進・左折とぶつかる区間の手前
  for (const c of X.conns) {
    if (c.turn !== 'R') continue;
    let w = c.len;
    for (const [d, cf] of c.conf) if (d.heading === OPP[c.heading] && d.turn !== 'R') w = Math.min(w, cf.a0);
    c.waitS = Math.max(2, w - 0.4);
  }
}

/** 経路：入口の車線から、出口の端までの車線と進路の列。jitter で少し揺らして、同じ道ばかり選ばないようにする。 */
export function findRoute(net, fromLane, destTerm, rng, jitter = 0.25, laneCost = null) {
  const PEN = { L: 8, S: 0, R: 34 }; // 右折は対向車を待つので避けられがち
  const distTo = new Map([[fromLane, 0]]);
  const prev = new Map();
  const open = [fromLane];
  const done = new Set();
  const goal = destTerm.exit;
  if (!goal) return null;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (distTo.get(open[i]) < distTo.get(open[bi])) bi = i;
    const lane = open.splice(bi, 1)[0];
    if (done.has(lane)) continue;
    done.add(lane);
    if (lane === goal) break;
    for (const c of lane.next) {
      const nl = c.toLane;
      if (nl.closed || done.has(nl)) continue;
      const w = (c.len + nl.len + PEN[c.turn] + (laneCost ? laneCost(nl) : 0)) * (1 + (rng ? rng.next() * jitter : 0));
      const nd = distTo.get(lane) + w;
      if (nd < (distTo.get(nl) ?? Infinity)) { distTo.set(nl, nd); prev.set(nl, { lane, c }); open.push(nl); }
    }
  }
  if (!distTo.has(goal)) return null;
  const segs = [goal];
  let cur = goal;
  while (cur !== fromLane) {
    const p = prev.get(cur);
    segs.unshift(p.c);
    segs.unshift(p.lane);
    cur = p.lane;
  }
  return segs;
}
