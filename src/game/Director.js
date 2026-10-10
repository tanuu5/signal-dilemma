// 1 日の進行役：時計を進め、交通量を時刻に合わせ、台本の出来事を起こし、市民の満足度を計算する。
// 画面のことは ui（Game が渡す）に頼む：say / tut / alert / dilemma / endDay / fail / icon
import { DAYS } from './campaign/days.js';
import { DILEMMAS, FOLLOWUPS } from './campaign/dilemmas.js';
import { ICON } from './view/textures.js';
import { OPP, AXIS } from './sim/geom.js';
import { clamp, lerp } from '../core/math.js';

const SAT_START = 72;

export class Director {
  /**
   * @param world  World（sim と見た目）
   * @param day    DAYS の 1 つ
   * @param camp   キャンペーンの状態（traits / flags / upgrades …。判断で書き換える）
   * @param ui     画面への頼みごと
   */
  constructor(world, day, camp, ui) {
    this.world = world;
    this.sim = world.sim;
    this.day = day;
    this.camp = camp;
    this.ui = ui;
    this.clock = day.start;
    this.sat = SAT_START;
    this.satSum = 0;
    this.satT = 0;
    this.minSat = SAT_START;
    this.events = [...day.events, ...FOLLOWUPS.filter((f) => f.day === day.n && f.if(camp.flags)).map((f) => ({ h: f.h, do: 'msg', who: f.who, key: f.key }))]
      .filter((e) => !e.if || camp.flags[e.if])
      .sort((a, b) => a.h - b.h);
    this.gate = null;          // チュートリアルで時計を止めている
    this.done = false;
    this.failed = false;
    this.kids = [];            // 下校の時間 { node, until, rate }
    this.closures = [];
    this.specials = new Map(); // 見張っている車（救急車・車列・配送・容疑車両…）car.id → 情報
    this.busT = 8;
    this.busI = 0;
    this.dealT = 0;
    this.log = [];             // 今日の判断 { id, choice }
    this.stats = { evOnTime: 0, evLate: 0, honks: 0, complaints: 0 };
    this.walkMul = 1;
    this.fireworks = false;
    this.rain = day.rain || 0;
    this.sim.weather.rain = this.rain;
    this.applyUpgrades();
    this._demand();
  }

  applyUpgrades() {
    const up = new Set(this.camp.upgrades);
    for (const X of this.sim.net.inter) X.signal.sensor = up.has('sensor') || this.camp.flags.hackerNow;
    this.preempt = up.has('preempt');
    this.sim.guide = up.has('guide');
    this.patience = up.has('care') ? 1.5 : 1;
  }

  /** 時計が 1 秒で進む時間（時）。 */
  rate() {
    for (const [a, b, sec] of this.day.pace) if (this.clock >= a && this.clock < b) return (b - a) / sec;
    const last = this.day.pace[this.day.pace.length - 1];
    return (last[1] - last[0]) / last[2];
  }

  /** 今の時刻の交通量を sim に渡す。 */
  _demand() {
    const keys = this.day.demand;
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].h <= this.clock) i++;
    const A = keys[i], B = keys[Math.min(i + 1, keys.length - 1)];
    const t = clamp((this.clock - A.h) / Math.max(0.01, B.h - A.h), 0, 1);
    const terms = this.sim.net.terms;
    const gen = {}, attract = {};
    for (const T of terms) {
      const ga = A.gen[T.id] ?? A.gen.all ?? 0, gb = B.gen[T.id] ?? B.gen.all ?? 0;
      gen[T.id] = lerp(ga, gb, t);
      const aa = A.attract[T.id] ?? 1, ab = B.attract[T.id] ?? 1;
      attract[T.id] = lerp(aa, ab, t);
    }
    const pedBase = lerp(A.ped, B.ped, t);
    const ped = {};
    for (const X of this.sim.net.inter) ped[X.id] = pedBase * (this.day.pedHot?.[X.id] ?? 1);
    let kids = 0.05;
    for (const k of this.kids) {
      if (this.clock < k.until) { ped[k.node] = (ped[k.node] || 0) + k.rate; kids = 0.55; }
    }
    if (this.fireworks) for (const X of this.sim.net.inter) ped[X.id] *= 1.3;
    const mix = { ...this.day.mix };
    this.sim.setDemand({ gen, attract, mix, ped, kids, patience: this.patience, scale: this.camp.difficulty ?? 1 });
  }

  // ---------------------------------------------------------------- 毎フレーム
  /** dt：シミュレーションが進んだ時間（秒）。 */
  step(dt) {
    if (this.done || this.failed) return;
    // 時計（チュートリアルで止めているあいだは進めない）
    if (this.gate) {
      this.gate.t += dt;
      if (this.gate.t > this.gate.max) this.clearGate();
    } else {
      this.clock += this.rate() * dt;
    }
    while (this.events.length && this.events[0].h <= this.clock && !this.gate) this._fire(this.events.shift());
    this._demandT = (this._demandT || 0) - dt;
    if (this._demandT <= 0) { this._demand(); this._demandT = 0.5; }
    this._buses(dt);
    this._specials(dt);
    if (this.preempt || this.camp.flags.hackerNow) this._preempt();
    this._closures();
    // 満足度
    // 満足度：待たされている人の重さ（pain）で下がり、流れていれば少しずつ戻る
    const pain = this.sim.pain;
    const gain = 1.0 + (this.sat < 40 ? 0.3 : 0);
    const d = clamp(gain - pain * 0.36, -5, 1.4);
    this.sat = clamp(this.sat + d * dt, 0, 100);
    this.satSum += this.sat * dt;
    this.satT += dt;
    this.minSat = Math.min(this.minSat, this.sat);
    if (this.sat <= 0 && !this.tutorialDay) { this.failed = true; this.ui.fail(); return; }
    if (this.sat <= 0 && this.tutorialDay) this.sat = 6; // 1 日目は止めない（覚える日）
    if (this.clock >= this.day.end && !this.gate) { this.done = true; this.ui.endDay(this.summary()); }
  }

  get tutorialDay() { return this.day.n === 1; }

  /** シミュレーションの出来事。 */
  onSim(e) {
    const ui = this.ui;
    switch (e.type) {
      case 'honk':
        this.stats.honks++;
        this.sat -= 0.15;
        ui.icon(ICON.anger, { follow: e.car, y: e.car.type === 'bus' ? 4.2 : 3.2 });
        ui.sfx('honk', e.car);
        break;
      case 'nearMiss':
        this.sat -= 4;
        ui.icon(ICON.warn, { follow: e.car, y: 3.4, size: 2.8 });
        ui.sfx('screech', e.car);
        ui.say('sys', 'sys.nearMiss');
        break;
      case 'jaywalk':
        this.sat -= 0.8;
        ui.icon(ICON.sweat, { follow: e.ped, y: 2.4, size: 1.6 });
        break;
      case 'pedAngry':
        ui.icon(ICON.wait, { follow: e.ped, y: 2.4, size: 1.6, life: 2.2 });
        break;
      case 'spawn': {
        const car = e.car;
        if (car.em) this._watchEV(car);
        else if (car.tag) this._watchTagged(car);
        break;
      }
      case 'evArrive': {
        const S = this.specials.get(e.car.id);
        this.specials.delete(e.car.id);
        if (e.late) { this.stats.evLate++; this.sat -= 8; ui.say('sys', 'sys.evLate', { kind: ui.t('car.' + e.car.type) }); ui.sfx('bad'); }
        else { this.stats.evOnTime++; this.sat += 3; ui.say('sys', 'sys.evOk', { kind: ui.t('car.' + e.car.type) }); ui.sfx('good'); }
        void S;
        break;
      }
      case 'exit': {
        const S = this.specials.get(e.car.id);
        if (S) { this.specials.delete(e.car.id); this._taggedExit(e.car, S, e.travel); }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- 出来事
  _fire(E) {
    const ui = this.ui, sim = this.sim;
    switch (E.do) {
      case 'msg': ui.say(E.who, E.key); break;
      case 'tut': this.gate = { id: E.id, node: E.node, t: 0, max: E.id === 'toggle' ? 60 : 45 }; ui.tut(E.id, sim.net.nodes.get(E.node)); break;
      case 'ev':
        // 入口が詰まっていれば sim が予約して、空いたら出す（出たら 'spawn' で知らせが来る）
        sim.spawnSpecial(E.from, E.to, E.type, { tag: 'ev' });
        if (E.tut) this.evTut = true;
        break;
      case 'dilemma': this.pending = E.id; ui.dilemma(E.id); break;
      case 'kids': this.kids.push({ node: E.node, until: E.until, rate: E.rate }); break;
      case 'closure': this._close(E.link, E.until); break;
      case 'fireworks': this.fireworks = true; this.fireworksUntil = E.until; ui.fireworks(true); break;
      case 'accident': this._accident(E.node); break;
    }
  }

  clearGate() {
    if (!this.gate) return;
    const id = this.gate.id;
    this.gate = null;
    this.ui.tutDone(id);
  }

  /** プレイヤーの操作（チュートリアルの関門を開ける）。 */
  onAction(kind, X) {
    const g = this.gate;
    if (!g) return;
    if (g.id === 'toggle' && kind === 'toggle') this.clearGate();
    else if (g.id === 'walk' && kind === 'walk') this.clearGate();
    else if (g.id === 'select' && (kind === 'toggle' || kind === 'select') && X?.id === g.node) this.clearGate();
    else if (g.id === 'auto' && (kind === 'toggle' || kind === 'auto') && X?.id === g.node) this.clearGate();
  }

  // ---------------------------------------------------------------- 判断
  choose(id, choiceId) {
    const D = DILEMMAS[id];
    const C = D.choices.find((c) => c.id === choiceId);
    const camp = this.camp;
    for (const [k, v] of Object.entries(C.traits || {})) camp.traits[k] = (camp.traits[k] || 0) + v;
    if (C.trust) camp.trust = clamp(camp.trust + C.trust * 4, 0, 100);
    if (C.budget) camp.budget += C.budget;
    if (C.sat) this.sat = clamp(this.sat + C.sat, 0, 100);
    Object.assign(camp.flags, C.flags || {});
    camp.decisions.push({ day: this.day.n, id, choice: choiceId });
    this.log.push({ id, choice: choiceId, traits: C.traits || {}, trust: C.trust || 0, budget: C.budget || 0 });
    this.pending = null;
    if (C.act) this._act(C.act, id);
    // 返事
    this.ui.say(D.who === 'unknown' ? 'yui' : D.who, `dl.${id}.${choiceId}.res`);
    return C;
  }

  _act(act) {
    const sim = this.sim, ui = this.ui;
    const nodes = sim.net.inter;
    const X0 = nodes[0];
    switch (act) {
      case 'catHold': {
        X0.signal.hold = 'allred';
        ui.icon(ICON.cat, { x: X0.pos.x, z: X0.pos.z, y: 1.6, life: 9, rise: 0.4, size: 2.4 });
        this.timers.push({ t: 9, fn: () => { X0.signal.hold = null; ui.icon(ICON.heart, { x: X0.pos.x, z: X0.pos.z, y: 2, life: 2 }); } });
        break;
      }
      case 'catWalk': {
        X0.signal.walk('event');
        ui.icon(ICON.cat, { x: X0.pos.x, z: X0.pos.z, y: 1.6, life: 6, rise: 0.4, size: 2.4 });
        break;
      }
      case 'catGo':
        ui.icon(ICON.cat, { x: X0.pos.x, z: X0.pos.z, y: 1.6, life: 1.6, rise: 2.5, size: 2.4 });
        ui.icon(ICON.warn, { x: X0.pos.x + 2, z: X0.pos.z, y: 3, life: 1.4 });
        break;
      case 'deal': this.dealT = 6; break;
      case 'labor': this._spawnTagged('labor', 'van', ['E0', 'E1', 'W0'], ['W0', 'N0', 'S1', 'E0']); break;
      case 'laborAmb': sim.spawnSpecial(this._edge('S'), this._edge('N'), 'ambulance', { tag: 'ev' }); break;
      case 'suspect': this._spawnTagged('suspect', 'sedan', ['W0', 'S0', 'E1', 'N1'], ['E1', 'N0', 'W1', 'S0']); break;
      case 'longWalk': this.walkMul = 1.7; for (const X of nodes) X.signal.walkLong = 1.7; this.timers.push({ h: 16.4, fn: () => { for (const X of nodes) X.signal.walkLong = 1; } }); break;
      case 'schoolAuto': { const X = sim.net.nodes.get('X1_1'); if (X) { X.signal.mode = 'auto'; X.schoolPriority = true; } break; }
      case 'motorcade': this.motorcadeAt = this.camp.flags.motorcade; break;
      case 'copycat': for (let i = 0; i < 3; i++) this.timers.push({ t: 2 + i * 5, fn: () => this._spawnTagged('copy', 'sedan', null, null) }); break;
      case 'hacker':
        this.camp.flags.hackerNow = true;
        for (const X of nodes) { X.signal.mode = 'auto'; X.signal.sensor = true; }
        this.preempt = true;
        ui.glitch(true);
        break;
      case 'reunion': { const X = sim.net.nodes.get('X1_1') || X0; X.signal.walk('event'); X.signal.walkLong = 2.0; this.timers.push({ t: 16, fn: () => { X.signal.walkLong = 1; ui.icon(ICON.heart, { x: X.pos.x, z: X.pos.z, y: 3, life: 3, size: 3 }); } }); break; }
      case 'escort': break;
    }
  }

  get timers() { return (this._timers ||= []); }

  /** 端の id を、向き（N/S/E/W）から 1 つ選ぶ。 */
  _edge(side) {
    const ts = this.sim.net.terms.filter((t) => t.side === side && t.entry);
    return ts.length ? ts[Math.floor(this.sim.rng.next() * ts.length)].id : this.sim.net.terms[0].id;
  }

  _spawnTagged(tag, type, froms, tos) {
    const terms = this.sim.net.terms.filter((t) => t.entry);
    const pick = (list) => {
      const ok = (list || []).filter((id) => this.sim.net.nodes.get(id)?.entry);
      return ok.length ? ok[Math.floor(this.sim.rng.next() * ok.length)] : terms[Math.floor(this.sim.rng.next() * terms.length)].id;
    };
    const from = pick(froms);
    let to = pick(tos);
    for (let i = 0; i < 6 && (to === from || OPP[this.sim.net.nodes.get(to).side] === this.sim.net.nodes.get(from).side && false); i++) to = pick(tos);
    if (to === from) to = terms.find((t) => t.id !== from).id;
    return this.sim.spawnSpecial(from, to, type, { tag });
  }

  _watchEV(car) {
    this.specials.set(car.id, { kind: 'ev', car });
    this.ui.alert('ev', car);
    this.ui.icon(ICON.siren, { follow: car, y: 4, life: 3, size: 2.4 });
  }

  _watchTagged(car) {
    const S = { kind: car.tag, car, waited: 0, complained: 0 };
    this.specials.set(car.id, S);
    if (car.tag === 'labor') { this.ui.alert('labor', car); this.ui.icon(ICON.heart, { follow: car, y: 3.4, life: 60, size: 2.2, rise: 0 }); }
    if (car.tag === 'copy') this.ui.icon(ICON.heart, { follow: car, y: 3.4, life: 30, size: 1.8, rise: 0 });
    if (car.tag === 'suspect') { this.ui.alert('suspect', car); this.ui.icon(ICON.question, { follow: car, y: 3.4, life: 90, size: 2.4, rise: 0 }); }
    if (car.tag === 'deal') this.ui.icon(ICON.star, { follow: car, y: 4.2, life: 40, size: 1.8, rise: 0 });
    if (car.tag === 'vip') this.ui.icon(ICON.star, { follow: car, y: 3.2, life: 60, size: 1.6, rise: 0 });
  }

  _taggedExit(car, S, travel) {
    const ui = this.ui;
    if (S.kind === 'labor') ui.say('citizen', travel < car.ideal * 1.6 + 12 ? 'ev.labor.ok' : 'ev.labor.late');
    if (S.kind === 'suspect' && !this.camp.flags.detain) { this.camp.flags.detain = 'missed'; ui.say('police', 'ev.suspect.missed'); }
    if (S.kind === 'vip' && S.lead) {
      const bad = this.motorcadeStops || 0;
      ui.say('mayor', bad > 2 ? 'ev.motorcade.bad' : 'ev.motorcade.ok');
      this.camp.trust = clamp(this.camp.trust + (bad > 2 ? -6 : 4), 0, 100);
    }
  }

  /** 見張っている車：待たされた時間を数える（配送の苦情、車列、容疑車両の足止め）。 */
  _specials(dt) {
    for (const t of [...this.timers]) {
      if (t.h !== undefined ? this.clock >= t.h : (t.t -= dt) <= 0) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); }
    }
    // 配送トラック（契約）
    if (this.camp.flags.deal && this.day.n >= 2) {
      this.dealT -= dt;
      if (this.dealT <= 0) { this.dealT = 26 + this.sim.rng.next() * 18; this._spawnTagged('deal', 'delivery', null, null); }
    }
    // 市長の車列
    if (this.motorcadeAt && this.clock >= this.motorcadeAt && !this.motorcadeGo) {
      this.motorcadeGo = true;
      const from = this.sim.net.nodes.get('N1') ? 'N1' : this._edge('N');
      const to = this.sim.net.nodes.get('E1') ? 'E1' : this._edge('E');
      let n = 0;
      const spawnNext = () => {
        const type = n === 0 || n === 3 ? 'police' : 'vip';
        const car = this.sim.spawnSpecial(from, to, type, { tag: 'vip' });
        if (car) {
          car.siren = false;
          car.em = false;
          const S = this.specials.get(car.id) || { kind: 'vip', car, waited: 0 };
          S.lead = n === 3;
          this.specials.set(car.id, S);
          n++;
        }
        if (n < 4) this.timers.push({ t: 1.6, fn: spawnNext });
      };
      spawnNext();
      this.ui.say('mayor', 'ev.motorcade.start');
      this.ui.alert('vip', null);
    }
    for (const S of this.specials.values()) {
      const car = S.car;
      if (S.kind === 'ev') continue;
      const stopped = car.v < 0.8;
      if (S.kind === 'deal' && stopped) {
        S.waited += dt;
        if (S.waited > 9 && !S.complained) {
          S.complained = 1;
          this.stats.complaints++;
          this.camp.trust = clamp(this.camp.trust - 1, 0, 100);
          this.camp.budget = Math.max(0, this.camp.budget - 10);
          this.ui.say('soramame', 'ev.deal.late');
        }
      }
      if (S.kind === 'vip' && stopped && car.seg.kind === 'lane' && car.seg.len - car.s < 12) {
        S.waited += dt;
        if (S.waited > 4 && !S.counted) { S.counted = true; this.motorcadeStops = (this.motorcadeStops || 0) + 1; this.ui.icon(ICON.anger, { follow: car, y: 3 }); }
      } else if (S.kind === 'vip') S.waited = 0;
      if (S.kind === 'suspect' && stopped && !this.camp.flags.detain) {
        S.waited += dt;
        if (S.waited > 12) {
          this.camp.flags.detain = 'caught';
          car.hold = true;
          car.siren = false;
          this.ui.say('police', 'ev.suspect.caught');
          this.ui.icon(ICON.ok, { follow: car, y: 3.4, life: 4, size: 2.6 });
          this.timers.push({ t: 8, fn: () => { car.hold = false; } });
        }
      }
    }
  }

  _buses(dt) {
    const B = this.day.bus;
    if (!B) return;
    this.busT -= dt;
    if (this.busT > 0) return;
    this.busT = B.every * (0.85 + this.sim.rng.next() * 0.3);
    const i = this.busI++ % B.from.length;
    if (this.sim.net.nodes.get(B.from[i])?.entry) this.sim.spawnSpecial(B.from[i], B.to[i], 'bus');
  }

  /** 緊急車両優先：救急車が交差点に近づいたら、その向きを青にする。 */
  _preempt() {
    for (const car of this.sim.cars) {
      if (!car.em || !car.siren || car.seg.kind !== 'lane' || !car.seg.next.length) continue;
      const dEnd = car.seg.len - car.s;
      if (dEnd > 55) continue;
      const X = car.seg.to;
      const axis = AXIS[car.seg.heading];
      const sig = X.signal;
      if (sig.phase !== axis && sig.stage === 'G') sig.request(axis, 'preempt');
      else if (sig.phase === 'WALK' && sig.stage === 'W') sig.request(axis, 'preempt');
      if (sig.phase === axis && sig.stage === 'G') sig.greenT = Math.min(sig.greenT, 3);
    }
  }

  _close(linkId, until) {
    this.sim.setClosed(linkId, true);
    this.closures.push({ linkId, until });
    this.ui.closure(linkId, true);
    // 閉じた道を通る予定だった車は、行き先までの道を引き直す
    for (const car of this.sim.cars) {
      const rest = car.route.slice(car.k + 1);
      if (!rest.some((s) => s.kind === 'lane' && s.closed)) continue;
      const fromLane = car.seg.kind === 'lane' ? car.seg : car.seg.toLane;
      if (fromLane.closed) continue;
      const dest = this.sim.net.nodes.get(car.dest);
      const r = this.sim.reroute?.(car, fromLane, dest);
      void r;
    }
  }

  _closures() {
    for (const c of this.closures) {
      if (!c.open && this.clock >= c.until) { c.open = true; this.sim.setClosed(c.linkId, false); this.ui.closure(c.linkId, false); }
    }
    if (this.fireworks && this.clock >= this.fireworksUntil) { this.fireworks = false; this.ui.fireworks(false); }
  }

  /** 事故：交差点のそばで、車が 1 台止まって動かなくなる（しばらくして片づく）。 */
  _accident(nodeId) {
    const X = this.sim.net.nodes.get(nodeId);
    if (!X) return;
    let best = null;
    for (const hd of ['N', 'E', 'S', 'W']) {
      const lane = X.approach[hd];
      if (!lane) continue;
      for (const c of lane.cars) if (!c.em && !c.tag && lane.len - c.s > 12 && lane.len - c.s < 30) { best = c; break; }
      if (best) break;
    }
    if (!best) {
      // 車がいなければ、少し待ってからもう一度
      this.timers.push({ t: 2, fn: () => this._accident(nodeId) });
      return;
    }
    best.hold = true;
    best.hazard = true;
    this.accidentCar = best;
    this.ui.icon(ICON.warn, { follow: best, y: 3.4, life: 6, size: 3 });
    this.ui.say('sys', 'sys.accident', { name: this.ui.nodeName(X) });
    this.ui.sfx('crash', best);
    this.ui.shake();
    this.sat -= 3;
    this.timers.push({ t: 38, fn: () => { best.hold = false; best.hazard = false; this.ui.say('sys', 'sys.accidentClear'); } });
  }

  // ---------------------------------------------------------------- まとめ
  avgSat() { return this.satT > 0 ? this.satSum / this.satT : this.sat; }

  summary() {
    const S = this.sim.stats;
    const avg = this.avgSat();
    const evTotal = this.stats.evOnTime + this.stats.evLate;
    let score = avg + this.stats.evOnTime * 3 - this.stats.evLate * 6 - S.nearMiss * 2 - S.jaywalk * 0.5;
    score = clamp(score, 0, 100);
    const rank = score >= 86 ? 'S' : score >= 72 ? 'A' : score >= 56 ? 'B' : score >= 40 ? 'C' : 'D';
    return {
      day: this.day.n, rank, score: Math.round(score), avgSat: Math.round(avg), endSat: Math.round(this.sat), minSat: Math.round(this.minSat),
      served: S.served, avgDelay: S.served ? S.delaySum / S.served : 0, pedServed: S.pedServed,
      evOnTime: this.stats.evOnTime, evTotal, nearMiss: S.nearMiss, jaywalk: S.jaywalk, honks: S.honks,
      decisions: this.log,
    };
  }
}

export { DAYS, SAT_START };
