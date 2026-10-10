// 交通のシミュレーション（描画とは切り離す。Node でもそのまま動く）。
//   const sim = new Sim(mapDef, { seed });
//   sim.demand = { gen: { N0: 台/分 … }, attract: { N0: 重み … }, mix: { sedan: 0.5 … }, ped: { X0_0: 人/分 }, scale: 1 }
//   sim.step(dt)              dt 秒進める（1/60 前後の小さな刻みで呼ぶ）
//   sim.out                   その刻みで起きた出来事（クラクション・ヒヤリ・救急車の到着など）。読んだら空にする
//   X.signal.toggle() / walk() / mode
// 車は IDM（Intelligent Driver Model）で前の車・停止線・右折待ち・横断中の人に合わせて加減速する。
import { Rng } from '../../core/rng.js';
import { buildNetwork, findRoute } from './Network.js';
import { Signal } from './Signal.js';
import { CAR_TYPES, B_MAX, ROAD_HALF } from './constants.js';
import { OPP, AXIS, left } from './geom.js';
import { Peds } from './Peds.js';

const LOOK = 85;          // 先を見る距離

/** 経路の各区間の始まりまでの道のり。 */
function routeCum(route) {
  const cum = [0];
  for (let i = 0; i < route.length; i++) cum.push(cum[i] + route[i].len);
  return cum;
}
const HONK_AT = [20, 34, 50, 70];

export class Sim {
  constructor(mapDef, { seed = 1, phases = {}, modes = {} } = {}) {
    this.rng = new Rng(seed);
    this.net = buildNetwork(mapDef);
    this.time = 0;
    this.cars = [];
    this.out = [];
    this.nextId = 1;
    this.weather = { rain: 0 };
    this.demand = { gen: {}, attract: {}, mix: { sedan: 1 }, ped: {}, scale: 1 };
    this.stats = { spawned: 0, served: 0, delaySum: 0, travelSum: 0, honks: 0, nearMiss: 0, evServed: 0, evLate: 0, evDelay: 0, pedServed: 0, jaywalk: 0, maxQueue: 0, redRun: 0 };
    this.autoAssist = false; // 救急車の通り道を自動で青にする（強化）
    for (const X of this.net.inter) {
      X.signal = new Signal(X, this, { phase: phases[X.id] || 'NS', mode: modes[X.id] || 'manual' });
      X.evCrossing = null;
      X.diag = new Set();
      X.q = { N: 0, E: 0, S: 0, W: 0 };       // 待っている台数
      X.qWait = { N: 0, E: 0, S: 0, W: 0 };   // いちばん長く待っている時間
      X.qSoon = { N: 0, E: 0, S: 0, W: 0 };   // 近づいている台数
    }
    for (const T of this.net.terms) { T.queue = 0; T.queueT = 0; T.nextT = 0; T.wait = 0; }
    this.peds = new Peds(this);
  }

  emit(e) { this.out.push(e); }

  // ------------------------------------------------------------------ 車を出す
  setDemand(d) {
    this.demand = { gen: {}, attract: {}, mix: { sedan: 1 }, ped: {}, scale: 1, ...d };
  }

  _spawnStep(dt) {
    const D = this.demand;
    for (const T of this.net.terms) {
      if (!T.entry) continue;
      // 台/秒。頻度が時刻で変わっても正しく数える（頻度 × 時間を積み、指数分布の閾値を越えたら 1 台）
      const rate = Math.max(0, (D.gen[T.id] ?? D.genAll ?? 0) * (D.scale ?? 1)) / 60 || 0;
      if (!(T.nextT > 0)) T.nextT = -Math.log(1 - this.rng.next() * 0.999);
      T.nextT -= rate * dt;
      while (T.nextT <= 0) {
        T.queue++;
        T.nextT += -Math.log(1 - this.rng.next() * 0.999);
      }
      if (T.queue > 0) {
        T.wait += T.queue * dt;
        T.queueT += dt;
        if (this._trySpawn(T)) { T.queue--; if (!T.queue) T.queueT = 0; }
      }
    }
  }

  pickType() {
    const mix = this.demand.mix || { sedan: 1 };
    let tot = 0;
    for (const k in mix) tot += mix[k];
    let r = this.rng.next() * tot;
    for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
    return 'sedan';
  }

  pickDest(T) {
    const A = this.demand.attract || {};
    const cands = this.net.terms.filter((t) => t !== T && t.exit && (A[t.id] ?? 1) > 0);
    let tot = 0;
    for (const t of cands) tot += A[t.id] ?? 1;
    let r = this.rng.next() * tot;
    for (const t of cands) { r -= A[t.id] ?? 1; if (r <= 0) return t; }
    return cands[cands.length - 1];
  }

  /** 端 T から車を 1 台出す（入口の車線に空きがあれば）。opts で種類・行き先・印を決められる。 */
  _trySpawn(T, opts = {}) {
    const lane = T.entry;
    const type = opts.type || this.pickType();
    const P = CAR_TYPES[type];
    const last = lane.cars[lane.cars.length - 1];
    if (last && last.s - last.len < P.len + 3) return false;
    const dest = opts.dest || this.pickDest(T);
    if (!dest) return false;
    const route = findRoute(this.net, lane, dest, this.rng, 0.25, this.guide ? this._congestion : null);
    if (!route) return false;
    const car = this._makeCar(type, route, opts);
    car.v = Math.min(car.v0 * 0.8, last ? last.v + 1.5 : car.v0);
    car.origin = T.id;
    car.dest = dest.id;
    lane.cars.push(car);
    this.cars.push(car);
    this.stats.spawned++;
    this.emit({ type: 'spawn', car });
    return car;
  }

  /** 救急車・バス・特別な車を出す（出来事から）。入口が詰まっていれば、空くまで待つ予約にする。 */
  spawnSpecial(fromId, toId, type, opts = {}) {
    const T = this.net.nodes.get(fromId);
    const dest = this.net.nodes.get(toId);
    if (!T?.entry || !dest?.exit) return null;
    const car = this._trySpawn(T, { ...opts, type, dest });
    if (car) return car;
    (this.pending ||= []).push({ fromId, toId, type, opts });
    return null;
  }

  _makeCar(type, route, opts = {}) {
    const P = CAR_TYPES[type];
    const rng = this.rng;
    const jit = (k) => 1 + (rng.next() * 2 - 1) * k;
    const car = {
      id: this.nextId++, type, len: P.len, wid: P.wid,
      v0: P.v0 * jit(0.06), a: P.a * jit(0.1), b: P.b, Th: P.T * jit(0.1), s0: P.s0, pax: P.pax * (type === 'bus' ? jit(0.35) : 1),
      em: !!P.emergency, route, k: 0, seg: route[0], s: 0, v: 0, acc: 0, accCmd: 0, maxAdv: Infinity,
      lat: 0, latT: 0, wait: 0, delay: 0, honked: 0, born: this.time, dist: 0,
      yellowCommit: null, granted: null, turnGo: null, yieldTo: null, redWait: 0,
      brake: false, blink: null, x: 0, z: 0, dx: 0, dz: 1, tag: opts.tag || null,
      color: rng.int(0, 1023), siren: !!P.emergency, hard: 0,
    };
    car.ideal = route.reduce((t, s) => t + s.len, 0) / car.v0;
    return car;
  }

  // ------------------------------------------------------------------ 1 刻み
  step(dt) {
    this.time += dt;
    for (const X of this.net.inter) {
      X.signal.step(dt);
      // 赤で進むと決めた救急車が、しばらく入れずにいたら取り消す（ほかの車がずっと止められたままにならないように）
      const ev = X.evCrossing;
      if (ev && (ev.gone || (!X.box.has(ev) && this.time - X.evCrossingT > 3))) X.evCrossing = null;
    }
    if (this.pending?.length) {
      const list = this.pending;
      this.pending = [];
      for (const p of list) this.spawnSpecial(p.fromId, p.toId, p.type, p.opts); // 出られなければ、また予約に戻る
    }
    this._spawnStep(dt);
    const segs = this._segs || (this._segs = [...this.net.laneList, ...this.net.connList]);
    for (const seg of segs) {
      if (seg.cars.length > 1) seg.cars.sort((a, b) => b.s - a.s);
      for (let i = 0; i < seg.cars.length; i++) seg.cars[i].idx = i;
    }
    this._emergencyYield();
    for (const car of this.cars) this._plan(car, dt);
    for (const car of this.cars) this._move(car, dt);
    // 出口に着いた車を消す
    if (this._gone) {
      for (const car of this._gone) {
        const i = this.cars.indexOf(car);
        if (i >= 0) this.cars.splice(i, 1);
      }
      this._gone = null;
    }
    this.peds.step(dt);
    this._waits(dt);
    this._nodeStats();
  }

  // ------------------------------------------------------------------ 救急車に道をゆずる
  // 救急車の前 55 m にいる同じ道の車は、左に寄って止まる（交差点には入らない）。
  // 救急車の後ろの端が、その車の前を通り過ぎたら元に戻る。
  _emergencyYield() {
    for (const ev of this.cars) {
      ev.yielders = 0;
      if (!ev.em || !ev.siren) continue;
      const cum = ev.cum || (ev.cum = routeCum(ev.route));
      const evPos = cum[ev.k] + ev.s;
      // 今いる車線の前の車だけ（交差点の向こうの車は、救急車がそこへ来てから）
      const seg = ev.seg;
      if (seg.kind === 'lane') {
        for (const c of seg.cars) {
          if (c === ev || c.em || c.yieldTo) continue;
          const ahead = c.s - c.len - ev.s;   // 救急車の前の端から、その車の後ろの端まで
          if (c.s > ev.s + 0.5 && ahead < 40) { c.yieldTo = ev; c.yieldK = ev.k; c.yieldT = this.time; }
        }
      }
    }
    for (const c of this.cars) {
      const ev = c.yieldTo;
      if (!ev) continue;
      let release = ev.gone || c.seg !== ev.route[c.yieldK];
      if (!release) {
        const evRear = ev.cum[ev.k] + ev.s - ev.len;
        const cPos = ev.cum[c.yieldK] + c.s;
        release = evRear > cPos + 0.8;
        // 救急車がずっと動けないとき、前のほうで待っている車は先に行ってよい（横に並んでいる車はそのまま）
        if (!release && this.time - c.yieldT > 30 && cPos - c.len > ev.cum[ev.k] + ev.s + 8) release = true;
      }
      if (release) c.yieldTo = null;
      else ev.yielders++;
    }
  }

  // ------------------------------------------------------------------ 加減速を決める
  _free(car, v0) {
    if (car.yieldTo || car.hold) return -Math.min(car.b * 1.3, car.v * 3); // 寄って止まる・故障などで止まる
    const r = car.v / Math.max(0.1, v0);
    return Math.max(-car.b * 1.3, car.a * (1 - r * r * r * r));
  }

  _int(car, gap, vLead, s0) {
    const v = car.v;
    const sStar = s0 + Math.max(0, v * car.Th + (v * (v - vLead)) / (2 * Math.sqrt(car.a * car.b)));
    const g = Math.max(gap, 0.05);
    return -car.a * (sStar / g) * (sStar / g);
  }

  _plan(car, dt) {
    const rain = this.weather.rain;
    let v0 = car.v0 * (1 - 0.12 * rain);
    // 救急車に道をゆずる車：左に寄って止まる
    if (car.yieldTo) v0 = 0.01;
    car.latT = car.yieldTo ? 0.95 : 0;
    let inter = 0;        // 前のもの（車・停止線…）による減速（いちばん強いもの）
    let maxAdv = Infinity;
    let pedHard = false;
    const take = (gap, vLead, s0, hardStop, isPed) => {
      const a = this._int(car, gap, vLead, s0);
      if (a < inter) { inter = a; pedHard = !!isPed; }
      if (hardStop !== undefined) maxAdv = Math.min(maxAdv, Math.max(0, hardStop));
    };
    let d = -car.s;
    let passing = false;
    for (let k = car.k; k < car.route.length && d < LOOK; k++) {
      const seg = car.route[k];
      // 曲がり角の速さ
      if (seg.kind === 'conn' && seg.vmax < v0) {
        const allow = Math.sqrt(seg.vmax * seg.vmax + 2 * car.b * Math.max(0, d));
        if (allow < v0) v0 = allow;
      }
      if (seg.kind === 'conn') {
        // 右折：対向車が切れるまで交差点の中で待つ
        if (seg.turn === 'R' && car.turnGo !== seg) {
          const dw = d + seg.waitS;
          if (dw > -0.5 && dw < 30) {
            const near = k === car.k && dw < 3.5;
            if (this._rightTurnClear(car, seg)) { if (near) car.turnGo = seg; }
            else take(dw, 0, 0.3, dw);
          }
        }
        // 横断歩道を渡っている人（信号無視の人、渡り遅れた人）
        for (const w of seg.cw) {
          if (!w.cw.peds.size) continue;
          const dc = d + w.s0;
          if (dc < -1.0) continue;
          for (const p of w.cw.peds) {
            if (Math.abs(p.u - w.u) < 2.4 && Math.abs(p.u) < ROAD_HALF + 1.2) { take(dc - 0.8, 0, 0.4, dc - 0.6, true); break; }
          }
        }
      }
      // 前の車：前の端の順では、追い越していく救急車と、横に寄って止まっている長い車の順が入れかわるので、
      // 前の数台のうち、後ろの端がいちばん近い車に合わせる
      let lead = null, leadGap = Infinity;
      const from = k === car.k ? car.idx - 1 : seg.cars.length - 1;
      for (let i = from, n = 0; i >= 0 && n < 4; i--) {
        const c = seg.cars[i];
        const gap = d + c.s - c.len;
        if (car.em && c.yieldTo === car && this._canPass(car, c, gap)) { passing = true; continue; }
        n++;
        if (gap < leadGap) { leadGap = gap; lead = c; }
        if (!c.yieldTo && !c.em) break; // ふつうの並びなら、すぐ前の 1 台で足りる
      }
      if (lead) {
        take(leadGap, lead.v, car.s0, leadGap - 0.4);
        break;
      }
      // 停止線：交差点に入ってよいか
      if (seg.kind === 'lane' && k + 1 < car.route.length) {
        const dEnd = d + seg.len;
        const conn = car.route[k + 1];
        // 交差点に入った車（右折待ちのトラック、曲がりきっていないバスなど）の後ろが、まだ停止線の手前・分かれ目に残っている
        for (const c of conn.node.box) {
          const onConn = c.seg.kind === 'conn';
          const D = onConn ? c.seg : c.boxConn;
          if (!D || D.fromLane !== seg) continue;
          const rear = (onConn ? c.s : D.len + c.s) - c.len;
          if (rear < (D === conn ? 99 : 5.5)) { const gap = dEnd + rear; take(gap, c.v, car.s0, gap - 0.4); }
        }
        if (dEnd < 60 && !this._mayEnter(car, conn, dEnd, dt)) {
          take(dEnd, 0, 0.5, dEnd - 0.05);
          break;
        }
      }
      d += seg.len;
    }
    // 救急車：道をゆずってくれた車の横を通るあいだは右に出る。交差点に入って後ろの端が停止線を越えたら戻る
    if (car.em) car.latT = (passing || car.yielders > 0) && !(car.seg.kind === 'conn' && car.s - car.len > 0) ? -1.2 : 0;
    const free = this._free(car, v0);
    let acc = free + inter;
    if (pedHard && acc < -4.2 && !car.hardPed) { car.hardPed = true; this.stats.nearMiss++; this.emit({ type: 'nearMiss', car, x: car.x, z: car.z }); }
    if (acc > -2) car.hardPed = false;
    car.accCmd = acc;
    car.maxAdv = maxAdv;
  }

  /** 救急車が、道をゆずっている車 c を追い越してよいか：c が寄りきっていて、救急車も右に出ているか、まだ間があるとき。 */
  _canPass(ev, c, gap) {
    if (c.lat < 0.6) return false;
    return ev.lat < -0.85 || gap > 7;
  }

  /** 交差点に入ってよいか（信号・出口の空き・交差点の中の車）。 */
  _mayEnter(car, conn, dEnd, dt) {
    const X = conn.node;
    if (car.yieldTo) return false;
    if (X.evCrossing && X.evCrossing !== car) return false;
    // 交差点の中を救急車が通っているあいだは、止まれる車は入らない
    if (!car.em && dEnd > (car.v * car.v) / (2 * car.b * 1.4) + 1) {
      for (const c of X.box) if (c.em && c.siren) return false;
    }
    if (X.diag.size) return false;
    const light = X.signal.car(conn.heading);
    const stopDist = (car.v * car.v) / (2 * car.b * 1.1);
    if (car.granted === X && car.v < 0.5 && light !== 'G') car.granted = null;
    let ok = car.granted === X;
    if (!ok) {
      if (light === 'G' || (light === 'Y' && car.yellowCommit === X)) ok = true;
      else if (car.em && car.siren) {
        // 赤でも、止まって安全を確かめてから進む（そのぶん遅れる）
        if (car.v < 0.6 && dEnd < 4) car.redWait += dt;
        if (car.redWait > 3.2 && this._room(conn.toLane, car) && !this._blocked(car, conn, 0, true)) {
          if (X.evCrossing !== car) X.evCrossingT = this.time;
          X.evCrossing = car;
          ok = true;
        }
      }
      if (!ok) return false;
      if (!this._room(conn.toLane, car)) {
        // 行きたい道が詰まって青のあいだ動けないときは、空いている別の道へ回る（先頭の 1 台だけ）
        if (light === 'G' && car.v < 0.5 && dEnd < 4 && conn.fromLane.cars[0] === car) {
          car.roomWait = (car.roomWait || 0) + dt;
          if (car.roomWait > 6) { car.roomWait = 0; this._reroute(car); }
        }
        return false;
      }
      car.roomWait = 0;
      if (dEnd < stopDist + 3) car.granted = X;
    }
    // 交差点の中の車は、停止線の近くに来てから見る（遠くでがくがく減速しないように）
    if (dEnd < stopDist + 6 && this._blocked(car, conn, 0)) return false;
    return true;
  }

  /** 経路案内（強化）：止まっている車の多い車線を避ける。 */
  _congestion(lane) {
    let n = 0;
    for (const c of lane.cars) if (c.v < 2) n++;
    return n * 9;
  }

  /** 車線 fromLane（今いる車線か、交差点の先の車線）から、行き先までの経路を引き直す（通行止めのとき）。 */
  reroute(car, fromLane, dest) {
    if (!dest) return false;
    const rest = findRoute(this.net, fromLane, dest, this.rng, 0.1);
    if (!rest) return false;
    const keep = car.seg === fromLane ? car.k : car.k + 1;
    car.route = [...car.route.slice(0, keep), ...rest];
    car.cum = null;
    return true;
  }

  /** 次の交差点での曲がり方を、出口に空きのあるものに変えて、そこから行き先までの経路を引き直す。 */
  _reroute(car) {
    const lane = car.route[car.k];
    if (lane.kind !== 'lane') return false;
    const dest = this.net.nodes.get(car.dest);
    const cur = car.route[car.k + 1];
    let best = null, bestLen = Infinity;
    for (const alt of lane.next) {
      if (alt === cur || alt.toLane.closed || !this._room(alt.toLane, car)) continue;
      const rest = findRoute(this.net, alt.toLane, dest, this.rng, 0.1);
      if (!rest) continue;
      const len = rest.reduce((t, s) => t + s.len, 0) + (alt.turn === 'S' ? 0 : 15);
      if (len < bestLen) { bestLen = len; best = [alt, ...rest]; }
    }
    if (!best) return false;
    car.route = [...car.route.slice(0, car.k + 1), ...best];
    car.cum = null;
    car.ideal = Math.max(car.ideal, car.route.reduce((t, s) => t + s.len, 0) / car.v0);
    this.stats.reroute = (this.stats.reroute || 0) + 1;
    return true;
  }

  /** 車線の入口に、この車が入るだけの空きがあるか（交差点の中で止まらないように）。 */
  _room(lane, car, extra = 0) {
    const last = lane.cars[lane.cars.length - 1];
    const room = (last ? last.s - last.len : lane.len + 50) - (lane.reserved || 0);
    return room >= car.len + 1.2 + extra;
  }

  /** 交差点の中に、この進路とぶつかる車がいるか。fromS より手前の区間は、もう通り過ぎたので見ない。 */
  _blocked(car, conn, fromS, strict = false) {
    for (const X of conn.node.box) {
      if (X === car) continue;
      const onConn = X.seg.kind === 'conn';
      const D = onConn ? X.seg : X.boxConn;
      if (!D || D === conn) continue;
      const cf = conn.conf.get(D);
      if (!cf) continue;
      if (cf.a1 < fromS - car.len) continue;
      const xs = onConn ? X.s : D.len + X.s;   // 進路 D の上での前の端
      if (xs - X.len > cf.b1 + 0.2) continue;
      if (!strict && onConn && D.turn === 'R' && X.turnGo !== D && xs <= D.waitS + 0.3 && xs < cf.b0 - 0.2) continue;
      return true;
    }
    return false;
  }

  /** 右折してよいか：対向の直進・左折が来ていない、交差点の中でぶつからない、出口が空いている。 */
  _rightTurnClear(car, conn) {
    const X = conn.node;
    if (this._blocked(car, conn, Math.max(0, car.s))) return false;
    const opp = OPP[conn.heading];
    const lane = X.approach[opp];
    if (lane) {
      const light = X.signal.car(opp);
      // 対向車線の先頭が、交差点の中の車（向こうの右折待ちなど）につかえて動けないなら、その車線からは来ない
      if (lane.cars.length && this._laneStuck(lane, X)) return this._room(conn.toLane, car, -0.5);
      for (const c of lane.cars) {
        const dEnd = lane.len - c.s;
        if (dEnd > 50) break;
        const nx = c.route[c.k + 1];
        if (!nx || nx.kind !== 'conn' || nx.turn === 'R') continue;
        const goes = light === 'G' || (light === 'Y' && c.yellowCommit === X) || c.granted === X || (X.evCrossing === c);
        if (!goes) continue;
        // 救急車の右折：対向車は止まってくれる（止まりきれない近さの車だけ待つ）
        if (car.em && car.siren && !c.em && dEnd > (c.v * c.v) / (2 * c.b * 1.4) + 1) continue;
        if (dEnd < 7 || dEnd / Math.max(c.v, 0.5) < 4.2) return false;
      }
    }
    return this._room(conn.toLane, car, -0.5);
  }

  /** 車線の先頭の車が、停止線の先にいる車（右折待ちのはみ出し・分かれ目）か交差点の中の車につかえて止まっているか。 */
  _laneStuck(lane, X) {
    const c = lane.cars[0];
    if (c.v > 1.0 || lane.len - c.s > 12) return false;
    for (const cn of lane.next) for (const o of cn.cars) if (o.s - o.len < 5.5) return true;
    const nx = c.route[c.k + 1];
    return !!(nx && nx.kind === 'conn' && (this._blocked(c, nx, 0) || !this._room(nx.toLane, c)));
  }

  /** 黄になった瞬間：止まりきれない車は、そのまま通ってよい印をつける。 */
  onYellow(X, axis) {
    for (const hd of axis === 'NS' ? ['N', 'S'] : ['E', 'W']) {
      const lane = X.approach[hd];
      if (!lane) continue;
      for (const c of lane.cars) {
        const dEnd = lane.len - c.s;
        const stop = (c.v * c.v) / (2 * c.b * 1.25);
        if (dEnd < stop + 0.8 || c.granted === X) c.yellowCommit = X;
      }
    }
  }

  // ------------------------------------------------------------------ 動かす
  _move(car, dt) {
    const acc = Math.max(-B_MAX, Math.min(car.a, car.accCmd));
    let v1 = car.v + acc * dt;
    let ds;
    if (v1 < 0) { ds = acc < 0 ? (car.v * car.v) / (2 * -acc) : 0; v1 = 0; }
    else ds = (car.v + v1) * 0.5 * dt;
    if (ds > car.maxAdv) { ds = Math.max(0, car.maxAdv); v1 = Math.min(v1, ds / dt); }
    car.acc = (v1 - car.v) / dt;
    car.v = v1;
    car.s += ds;
    car.dist += ds;
    car.brake = car.acc < -0.6 || (car.v < 0.3);
    car.lat += (car.latT - car.lat) * Math.min(1, dt * 2.2);
    // 区間の終わりを越えたら次へ
    while (car.s > car.seg.len) {
      const seg = car.seg;
      car.s -= seg.len;
      this._leave(car, seg);
      car.k++;
      if (car.k >= car.route.length) { this._arrive(car); return; }
      this._enter(car, car.route[car.k]);
    }
    if (car.boxConn && car.s - car.len > 0.2) this._leaveBox(car);
    // 曲がる合図（交差点の手前 30 m から）
    const nx = car.route[car.k + 1];
    car.blink = null;
    if (car.seg.kind === 'conn') car.blink = car.seg.turn === 'S' ? null : car.seg.turn;
    else if (nx && nx.kind === 'conn' && nx.turn !== 'S' && car.seg.len - car.s < 30) car.blink = nx.turn;
    this._pose(car);
  }

  _leave(car, seg) {
    const i = seg.cars.indexOf(car);
    if (i >= 0) seg.cars.splice(i, 1);
    if (seg.kind === 'conn') car.boxConn = seg; // 後ろの端が交差点を出るまでは、交差点の中にいるものとして数える
  }

  _leaveBox(car) {
    const X = car.boxConn.node;
    X.box.delete(car);
    if (X.evCrossing === car) X.evCrossing = null;
    car.boxConn = null;
  }

  _enter(car, seg) {
    car.seg = seg;
    seg.cars.push(car);
    if (seg.kind === 'conn') {
      if (car.boxConn) this._leaveBox(car); // 短い区間が続いたとき
      const X = seg.node;
      // 赤のまま入ってしまった（急に止まれなかった）
      if (X.signal.car(seg.heading) === 'R' && X.evCrossing !== car && car.yellowCommit !== X) this.stats.redRun++;
      X.box.add(car);
      seg.toLane.reserved = (seg.toLane.reserved || 0) + car.len + 1.2;
      car.resv = seg.toLane;
      car.granted = null;
      car.redWait = 0;
    } else {
      if (car.resv) { car.resv.reserved = Math.max(0, car.resv.reserved - car.len - 1.2); car.resv = null; }
      car.yellowCommit = null;
      car.turnGo = null;
    }
  }

  _arrive(car) {
    this._leave(car, car.seg);
    if (car.boxConn) this._leaveBox(car);
    (this._gone ||= []).push(car);
    car.gone = true;
    const travel = this.time - car.born;
    this.stats.served++;
    this.stats.delaySum += car.delay;
    this.stats.travelSum += travel;
    if (car.em) {
      const late = travel > car.ideal * 1.5 + 14;
      this.stats.evServed++;
      this.stats.evDelay += Math.max(0, travel - car.ideal);
      if (late) this.stats.evLate++;
      this.emit({ type: 'evArrive', car, travel, ideal: car.ideal, late });
    }
    this.emit({ type: 'exit', car, travel });
  }

  /** 車の中心の位置と向き（前の端と後ろの端から求める。曲がり角で自然に向きが変わる）。 */
  _pose(car) {
    const f = this._pointBack(car, 0, this._pf || (this._pf = { x: 0, z: 0 }));
    const fx = f.x, fz = f.z;
    const r = this._pointBack(car, car.len, f);
    let dx = fx - r.x, dz = fz - r.z;
    const l = Math.hypot(dx, dz);
    if (l > 1e-4) { dx /= l; dz /= l; } else { dx = car.dx; dz = car.dz; }
    car.dx = dx;
    car.dz = dz;
    const L = left({ x: dx, z: dz });
    car.x = (fx + r.x) / 2 + L.x * car.lat;
    car.z = (fz + r.z) / 2 + L.z * car.lat;
  }

  _pointBack(car, back, out) {
    let s = car.s - back;
    let k = car.k;
    while (s < 0 && k > 0) { k--; s += car.route[k].len; }
    return car.route[k].path.pointAt(Math.max(0, s), out);
  }

  // ------------------------------------------------------------------ 待ち時間・クラクション
  _waits(dt) {
    let pain = 0;
    for (const car of this.cars) {
      if (car.v < 1.0) car.wait += dt;
      else if (car.v > 3.5) { car.wait = 0; car.honked = 0; }
      car.delay += dt * Math.max(0, 1 - car.v / car.v0);
      // 待ちの重さ：15 秒をこえると増えはじめ、60 秒で頭打ち。人数が多い車（バス）は重いが、人数ほどには増やさない
      const w = car.wait;
      if (w > 15) pain += Math.min(1, (w - 15) / 45) * (1 + (car.pax - 1) * 0.18) * (car.em ? 3 : 1);
      if (car.honked < HONK_AT.length && w > HONK_AT[car.honked] && !car.em) {
        car.honked++;
        this.stats.honks++;
        this.emit({ type: 'honk', car });
      }
    }
    for (const T of this.net.terms) if (T.queue > 0) pain += T.queue * 0.6;
    pain += this.peds.pain();
    this.pain = pain;
  }

  _nodeStats() {
    let maxQ = 0;
    for (const X of this.net.inter) {
      for (const hd of ['N', 'E', 'S', 'W']) {
        const lane = X.approach[hd];
        let q = 0, w = 0, soon = 0;
        if (lane) {
          for (const c of lane.cars) {
            const dEnd = lane.len - c.s;
            if (c.v < 1.5 && c.wait > 0.5) { q++; if (c.wait > w) w = c.wait; }
            else if (dEnd < 45) soon++;
          }
        }
        X.q[hd] = q;
        X.qWait[hd] = w;
        X.qSoon[hd] = soon;
        if (q > maxQ) maxQ = q;
      }
    }
    if (maxQ > this.stats.maxQueue) this.stats.maxQueue = maxQ;
  }

  // ------------------------------------------------------------------ 信号から使う
  axisDemand(X, axis) {
    const hs = axis === 'NS' ? ['N', 'S'] : ['E', 'W'];
    let count = 0, wait = 0, approaching = false;
    for (const h of hs) {
      count += X.q[h];
      wait = Math.max(wait, X.qWait[h]);
      const lane = X.approach[h];
      if (lane) for (const c of lane.cars) { if (lane.len - c.s < 32 && c.v > 2) { approaching = true; break; } }
    }
    return { count, wait, approaching };
  }

  preferAxis(X, last) {
    const a = this.axisDemand(X, 'NS'), b = this.axisDemand(X, 'EW');
    const sa = a.count + a.wait * 0.08, sb = b.count + b.wait * 0.08;
    if (Math.abs(sa - sb) < 0.5) return last === 'NS' ? 'EW' : 'NS';
    return sa > sb ? 'NS' : 'EW';
  }

  pedWaiting(X) { return this.peds.waitingAt(X); }

  /** 道を閉じる・開ける（行事）。閉じた道は、これから出る車の経路に入らない。 */
  setClosed(linkId, closed) {
    const L = this.net.links.find((l) => l.id === linkId);
    if (!L) return;
    L.ab.closed = closed;
    L.ba.closed = closed;
  }

  /** 端で入口を待っている車の数。 */
  offmap() {
    let n = 0;
    for (const T of this.net.terms) n += T.queue;
    return n;
  }
}
