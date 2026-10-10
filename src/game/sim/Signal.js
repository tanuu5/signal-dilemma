// 交差点の信号。現示（phase）は南北（NS）・東西（EW）・歩行者（WALK）の 3 つ。
//   車の現示：G（青）→ Y（黄）→ AR（全赤：交差点が空くまで）→ 次の現示
//   歩行者：W（青）→ WF（青の点滅）→ WC（横断歩道が空くまで）→ 車の現示
// mode：'manual'（プレイヤーが切り替えるまで今の青を続ける）／'auto'（一定の周期で切り替える）
import { AXIS } from './geom.js';
import { SIGNAL } from './constants.js';

export class Signal {
  constructor(node, sim, { phase = 'NS', mode = 'manual' } = {}) {
    this.node = node;
    this.sim = sim;
    this.mode = mode;
    this.phase = phase;
    this.stage = 'G';
    this.t = 0;              // 今の段階に入ってからの時間
    this.greenT = 0;         // 今の青が続いている時間
    this.next = null;        // 切り替え先
    this.lastCar = phase;    // 歩行者の前の車の現示
    this.afterWalk = null;   // 歩行者のあと、プレイヤーが選んだ現示
    this.hold = null;        // 行事などで全方向を赤にしておく（'allred'）
    this.sensor = false;     // 自動のとき、車の来かたを見て切り替える（強化）
    this.walkLong = 1;       // 歩行者の青の長さの倍率（判断で変わる）
    this.yellowT = SIGNAL.yellow;
    this.switches = 0;       // 切り替えた回数（記録）
  }

  /** 車の信号：'G' | 'Y' | 'R'。 */
  car(heading) {
    if (this.hold) return 'R';
    if (this.phase !== AXIS[heading]) return 'R';
    return this.stage === 'G' ? 'G' : this.stage === 'Y' ? 'Y' : 'R';
  }

  /** 歩行者の信号：'G' | 'F'（点滅）| 'R'。 */
  ped() {
    if (this.hold) return 'R';
    if (this.phase !== 'WALK') return 'R';
    return this.stage === 'W' ? 'G' : this.stage === 'WF' ? 'F' : 'R';
  }

  get busy() { return this.stage === 'Y' || this.stage === 'AR' || this.stage === 'WC'; }
  get isCarGreen() { return this.phase !== 'WALK' && this.stage === 'G'; }

  /** 南北⇄東西を切り替える（プレイヤーの操作）。切り替えを始めたら true。 */
  toggle(by = 'player') {
    if (this.hold) return false;
    if (this.phase === 'WALK') {
      // 歩行者の青の途中なら、点滅へ進めて早めに終える（そのあとは待っている車の多い向き）
      if (this.stage === 'W') { this.stage = 'WF'; this.t = 0; return true; }
      return false;
    }
    if (this.stage !== 'G') return false;
    this._begin(this.phase === 'NS' ? 'EW' : 'NS', by);
    return true;
  }

  /** 歩行者の青にする（車の青の途中・切り替えの途中から）。 */
  walk(by = 'player') {
    if (this.hold || this.phase === 'WALK') return false;
    if (this.stage === 'G') { this._begin('WALK', by); return true; }
    if (this.stage === 'Y' || this.stage === 'AR') { this.next = 'WALK'; return true; }
    return false;
  }

  /** 特定の向きを青にする（救急車を通す自動の手助けなど）。 */
  request(axis, by = 'auto') {
    if (this.hold || this.phase === axis) return false;
    if (this.phase === 'WALK') { this.afterWalk = axis; if (this.stage === 'W' && this.t > 2) { this.stage = 'WF'; this.t = 0; } return true; }
    if (this.stage === 'G') { this._begin(axis, by); return true; }
    return false;
  }

  _begin(target, by) {
    this.next = target;
    this.stage = 'Y';
    this.t = 0;
    this.switches++;
    this.sim.onYellow(this.node, this.phase);
    this.sim.emit({ type: 'signal', node: this.node, stage: 'Y', by });
  }

  _green(phase) {
    if (phase !== 'WALK') this.lastCar = phase;
    this.phase = phase;
    this.stage = phase === 'WALK' ? 'W' : 'G';
    this.t = 0;
    this.greenT = 0;
    this.next = null;
    this.sim.emit({ type: 'signal', node: this.node, stage: this.stage, phase });
  }

  step(dt) {
    this.t += dt;
    if (this.hold) return;
    const S = SIGNAL;
    switch (this.stage) {
      case 'G':
        this.greenT += dt;
        if (this.mode === 'auto') this._auto();
        break;
      case 'Y':
        if (this.t >= this.yellowT) { this.stage = 'AR'; this.t = 0; }
        break;
      case 'AR': {
        const empty = this.node.box.size === 0;
        if (this.t >= S.allRedMin && (empty || this.t >= S.allRedMax)) this._green(this.next || (this.phase === 'NS' ? 'EW' : 'NS'));
        break;
      }
      case 'W':
        if (this.t >= S.walk * this.walkLong) { this.stage = 'WF'; this.t = 0; }
        break;
      case 'WF':
        if (this.t >= S.walkFlash) { this.stage = 'WC'; this.t = 0; }
        break;
      case 'WC': {
        const busy = this.node.crosswalks.some((cw) => cw.peds.size > 0);
        if (this.t >= 0.6 && (!busy || this.t >= S.walkClearMax)) {
          const nxt = this.afterWalk || this.sim.preferAxis(this.node, this.lastCar);
          this.afterWalk = null;
          this._green(nxt);
        }
        break;
      }
    }
  }

  // 自動：一定の周期で切り替える。待っている歩行者がいれば歩行者の青をはさむ。
  // sensor（強化）なら、青の側に車が来ていないとき早めに、来ているあいだは長めにする。
  _auto() {
    const sim = this.sim;
    const other = this.phase === 'NS' ? 'EW' : 'NS';
    const peds = sim.pedWaiting(this.node);
    const wantWalk = peds.count >= 4 || (peds.count > 0 && peds.maxWait > 28) || (this.node.schoolPriority && peds.count > 0);
    let limit = 11;
    if (this.sensor) {
      const here = sim.axisDemand(this.node, this.phase);
      const there = sim.axisDemand(this.node, other);
      if (this.greenT < 5) return;
      if (there.count === 0 && !wantWalk) return;            // 待っている車がいなければ続ける
      if (here.approaching && this.greenT < 18) return;      // 青の側に車が来ていれば延ばす
      limit = 5;
    }
    if (this.greenT >= limit) {
      if (wantWalk) this._begin('WALK', 'auto');
      else this._begin(other, 'auto');
    }
  }
}
