// 歩行者：歩道を歩いて交差点の角へ → 歩行者の青を待つ → 横断歩道を渡る → 歩き去る。
// 渡るのは歩行者の青のときだけ（車はすべて赤）。待ちすぎた人は、車の切れ目に信号無視で渡りはじめる。
// スクランブル（node.scramble）の交差点では、斜めにも渡る。
import { Path, add, mul, dist } from './geom.js';
import { CURB, SIDEWALK, WALK_C, BOX, CW_W, ROAD_HALF } from './constants.js';

const MAX_PEDS = 180;
const SIDE_C = CURB + SIDEWALK / 2;   // 歩道の中心線（道路の中心から）
const MID = BOX + CW_W / 2;

// 角と、その角に端のある横断歩道（end：'a' か 'b'）
const CORNERS = {
  NW: { sx: -1, sz: -1, cws: [['N', 'a'], ['W', 'a']] },
  NE: { sx: 1, sz: -1, cws: [['N', 'b'], ['E', 'a']] },
  SE: { sx: 1, sz: 1, cws: [['E', 'b'], ['S', 'b']] },
  SW: { sx: -1, sz: 1, cws: [['S', 'a'], ['W', 'b']] },
};
const DIAG = { NW: 'SE', SE: 'NW', NE: 'SW', SW: 'NE' };

export class Peds {
  constructor(sim) {
    this.sim = sim;
    this.list = [];
    this.nextId = 1;
    this.timers = new Map();
  }

  step(dt) {
    const sim = this.sim;
    const D = sim.demand;
    for (const X of sim.net.inter) {
      // 頻度が時刻で変わっても正しく数える（頻度 × 時間を積み、指数分布の閾値を越えたら 1 人）
      const rate = Math.max(0, (D.ped?.[X.id] ?? D.pedAll ?? 0) * (D.pedScale ?? 1)) / 60 || 0;
      let t = this.timers.get(X) ?? -Math.log(1 - sim.rng.next() * 0.999);
      t -= rate * dt;
      while (t <= 0) {
        if (this.list.length < MAX_PEDS) this.spawn(X);
        t += -Math.log(1 - sim.rng.next() * 0.999);
      }
      this.timers.set(X, t);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      this._update(p, dt);
      if (p.done) {
        this._unregister(p);
        this.list.splice(i, 1);
      }
    }
  }

  /** 交差点 X のまわりに 1 人出す。opts.kind：'adult' | 'kid' | 'elder'。 */
  spawn(X, opts = {}) {
    const sim = this.sim, rng = sim.rng;
    const corners = Object.keys(CORNERS).filter((k) => CORNERS[k].cws.some(([s]) => X.cwBy[s]));
    if (!corners.length) return null;
    const from = rng.pick(corners);
    const C = CORNERS[from];
    let to, cw = null, endFrom, endTo;
    const opts2 = C.cws.filter(([s]) => X.cwBy[s]);
    if (X.scramble && rng.chance(0.35) && CORNERS[DIAG[from]]) {
      to = DIAG[from];
    } else {
      const [side, end] = rng.pick(opts2);
      cw = X.cwBy[side];
      endFrom = end;
      endTo = end === 'a' ? 'b' : 'a';
      to = Object.keys(CORNERS).find((k) => k !== from && CORNERS[k].cws.some(([s, e]) => s === side && e === endTo));
    }
    const kindRoll = rng.next();
    const kind = opts.kind || (kindRoll < (sim.demand.kids ?? 0.06) ? 'kid' : kindRoll > 0.9 ? 'elder' : 'adult');
    const speed = kind === 'kid' ? rng.range(1.05, 1.3) : kind === 'elder' ? rng.range(0.75, 0.95) : rng.range(1.2, 1.5);
    const c = X.pos;
    const corner = (k) => ({ x: c.x + CORNERS[k].sx * SIDE_C, z: c.z + CORNERS[k].sz * SIDE_C });
    // 待つ場所と、渡る線
    let wait, crossA, crossB;
    const jitAlong = rng.range(-CW_W / 2 + 0.4, CW_W / 2 - 0.4);
    if (cw) {
      const A = endFrom === 'a' ? cw.a : cw.b, B = endFrom === 'a' ? cw.b : cw.a;
      const out = endFrom === 'a' ? -1 : 1;
      const dir = { x: cw.center.x - c.x, z: cw.center.z - c.z };
      const dl = Math.hypot(dir.x, dir.z) || 1;
      const along = { x: dir.x / dl, z: dir.z / dl };
      wait = add(add(A, mul(cw.across, out * rng.range(0.4, 1.5))), mul(along, jitAlong * 0.8));
      crossA = add(A, mul(along, jitAlong));
      crossB = add(B, mul(along, jitAlong));
    } else {
      const k0 = corner(from), k1 = corner(to);
      wait = add(k0, { x: rng.range(-0.8, 0.8), z: rng.range(-0.8, 0.8) });
      crossA = { x: c.x + CORNERS[from].sx * (WALK_C - 0.3), z: c.z + CORNERS[from].sz * (WALK_C - 0.3) };
      crossB = { x: c.x + CORNERS[to].sx * (WALK_C - 0.3), z: c.z + CORNERS[to].sz * (WALK_C - 0.3) };
      void k1;
    }
    // 歩道をどちらから来て、どちらへ去るか
    const walkFrom = this._sidewalkPoint(X, from, rng);
    const walkTo = this._sidewalkPoint(X, to, rng);
    const p = {
      id: this.nextId++, node: X, kind, speed, stage: 'walk', wait: 0,
      patience: (kind === 'elder' ? rng.range(55, 90) : kind === 'kid' ? rng.range(35, 60) : rng.range(40, 75)) * (sim.demand.patience ?? 1),
      cw, diag: !cw, crossA, crossB, waitP: wait, leave: walkTo, x: walkFrom.x, z: walkFrom.z, dir: 0, u: 0,
      path: new Path([walkFrom, corner(from), wait]), s: 0, delay: rng.range(0, 0.9), react: 0,
      color: rng.int(0, 1023), umbrella: sim.weather.rain > 0.3, angry: false, jay: false, phase: rng.range(0, 6), moving: true,
    };
    // 角を回らずに済むときは、角を経由しない
    if (dist(walkFrom, wait) < dist(walkFrom, corner(from)) + 0.5) p.path = new Path([walkFrom, wait]);
    this.list.push(p);
    return p;
  }

  _sidewalkPoint(X, cornerKey, rng) {
    const C = CORNERS[cornerKey], c = X.pos;
    const d = rng.range(12, 34);
    // 角から、南北の歩道か東西の歩道のどちらかへ
    if (rng.chance(0.5)) return { x: c.x + C.sx * SIDE_C + rng.range(-0.6, 0.6), z: c.z + C.sz * (SIDE_C + d) };
    return { x: c.x + C.sx * (SIDE_C + d), z: c.z + C.sz * SIDE_C + rng.range(-0.6, 0.6) };
  }

  _update(p, dt) {
    const sim = this.sim;
    const X = p.node;
    const ped = X.signal.ped();
    p.moving = false;
    switch (p.stage) {
      case 'walk':
        if (this._walk(p, dt, 1)) { p.stage = 'wait'; p.wait = 0; }
        break;
      case 'wait': {
        p.wait += dt;
        if (ped === 'G') {
          p.react += dt;
          if (p.react > p.delay) this._startCross(p, false);
        } else {
          p.react = 0;
          if (!p.angry && p.wait > p.patience * 0.6) { p.angry = true; sim.emit({ type: 'pedAngry', ped: p }); }
          // 待ちすぎた人は、車の切れ目に渡ってしまう
          if (p.cw && p.wait > p.patience && ped === 'R' && X.signal.phase !== 'WALK' && sim.rng.next() < dt * (p.kind === 'adult' ? 0.35 : 0.12)) {
            if (this._safeToJay(p)) { this._startCross(p, true); sim.stats.jaywalk++; sim.emit({ type: 'jaywalk', ped: p }); }
          }
        }
        break;
      }
      case 'cross': {
        const hurry = p.jay ? 1.45 : ped === 'G' ? 1 : 1.5;
        if (this._carNear(p)) break; // 目の前に車がいたら止まる
        if (this._walk(p, dt, hurry)) {
          this._unregister(p);
          sim.stats.pedServed++;
          p.stage = 'leave';
          p.path = new Path([{ x: p.x, z: p.z }, p.leave]);
          p.s = 0;
        } else if (p.cw) {
          p.u = (p.x - p.cw.center.x) * p.cw.across.x + (p.z - p.cw.center.z) * p.cw.across.z;
        }
        break;
      }
      case 'leave':
        if (this._walk(p, dt, 1)) p.done = true;
        break;
    }
  }

  _startCross(p, jay) {
    p.stage = 'cross';
    p.jay = jay;
    p.path = new Path([{ x: p.x, z: p.z }, p.crossA, p.crossB]);
    p.s = 0;
    if (p.cw) {
      p.u = (p.x - p.cw.center.x) * p.cw.across.x + (p.z - p.cw.center.z) * p.cw.across.z;
      p.cw.peds.add(p);
    } else p.node.diag.add(p);
  }

  _unregister(p) {
    if (p.cw) p.cw.peds.delete(p);
    p.node.diag.delete(p);
  }

  /** 道のりに沿って歩く。着いたら true。 */
  _walk(p, dt, k) {
    const sp = p.speed * k;
    p.s += sp * dt;
    p.moving = true;
    const P = p.path.pointAt(Math.min(p.s, p.path.len));
    const dx = P.x - p.x, dz = P.z - p.z;
    if (dx * dx + dz * dz > 1e-6) p.dir = Math.atan2(dx, dz);
    p.x = P.x;
    p.z = P.z;
    p.phase += dt * sp * 5.5;
    return p.s >= p.path.len;
  }

  /** 横断歩道の上で、動いている車がすぐ前を通ろうとしているか（止まって待っている車の前は渡ってよい）。 */
  _carNear(p) {
    const X = p.node;
    for (const car of X.box) {
      if (car.v < 1.0) continue;
      const dx = car.x - p.x, dz = car.z - p.z;
      if (dx * dx + dz * dz < (car.len * 0.5 + 1.6) ** 2) return true;
    }
    return false;
  }

  /** 信号無視をしても、すぐには車が来ないか（来る人は来る。判断は甘い）。 */
  _safeToJay(p) {
    const X = p.node;
    if (X.box.size) return false;
    for (const hd of ['N', 'E', 'S', 'W']) {
      const lane = X.approach[hd];
      if (!lane) continue;
      const c = lane.cars[0];
      if (c && lane.len - c.s < 14 && c.v > 1) return false;
    }
    return true;
  }

  waitingAt(X) {
    let count = 0, maxWait = 0;
    for (const p of this.list) {
      if (p.node !== X || p.stage !== 'wait') continue;
      count++;
      if (p.wait > maxWait) maxWait = p.wait;
    }
    return { count, maxWait };
  }

  pain() {
    let s = 0;
    for (const p of this.list) if (p.stage === 'wait' && p.wait > 25) s += Math.min(1, (p.wait - 25) / 45) * 0.6;
    return s;
  }
}
