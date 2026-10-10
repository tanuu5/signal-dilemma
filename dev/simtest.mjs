// シミュレーションだけを Node で回して確かめる（描画なし）。
//   node dev/simtest.mjs [--map 1x1|2x1|2x2|3x2|3x3] [--ctl auto|bot|none|sensor] [--min 6] [--rate 14] [--seed 1] [--ped 6] [--verbose]
// 確かめること：車どうしの重なり（＝ぶつかり）、NaN、全体が止まったまま動かない状態、通過台数と待ち時間。
import { Sim } from '../src/game/sim/Sim.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);
const [cx, cz] = arg('map', '1x1').split('x').map(Number);
const B = 64;
const def = {
  cols: Array.from({ length: cx }, (_, i) => i * B),
  rows: Array.from({ length: cz }, (_, j) => j * B),
  ext: 66,
  scramble: has('scramble') ? ['X0_0'] : [],
};
const ctl = arg('ctl', 'bot');
const minutes = +arg('min', 6);
const rate = +arg('rate', 12);
const pedRate = +arg('ped', 4);
const seed = +arg('seed', 1);
const verbose = has('verbose');
const rain = +arg('rain', 0);

const sim = new Sim(def, { seed, modes: Object.fromEntries(def.cols.flatMap((_, i) => def.rows.map((__, j) => [`X${i}_${j}`, ctl === 'auto' || ctl === 'sensor' ? 'auto' : 'manual']))) });
sim.weather.rain = rain;
if (ctl === 'sensor') for (const X of sim.net.inter) X.signal.sensor = true;
const gen = {};
for (const T of sim.net.terms) gen[T.id] = rate / sim.net.terms.length * (T.side === 'S' || T.side === 'N' ? 1.3 : 0.8);
sim.setDemand({ gen, attract: {}, mix: { sedan: 0.5, kei: 0.2, van: 0.1, taxi: 0.08, truck: 0.07, bus: 0.05 }, pedAll: pedRate, kids: 0.1 });

// 簡単な自動操作：待っている側が多ければ切り替える（人が操作するつもりの目安）
function bot(sim) {
  for (const X of sim.net.inter) {
    const s = X.signal;
    if (s.stage !== 'G') continue;
    const cur = s.phase;
    if (cur === 'WALK') continue;
    const other = cur === 'NS' ? 'EW' : 'NS';
    const a = sim.axisDemand(X, cur), b = sim.axisDemand(X, other);
    const peds = sim.pedWaiting(X);
    if (s.greenT > 6 && (peds.count >= 5 || peds.maxWait > 35)) { s.walk(); continue; }
    if (s.greenT > 4 && b.count > 0 && (!a.approaching || s.greenT > 16) && b.count + b.wait * 0.1 > a.count * 0.6) s.toggle();
  }
}

const dt = 1 / 60;
const steps = Math.round(minutes * 60 / dt);
if (has('noped')) sim.demand.pedAll = 0;
let overlaps = 0, nan = 0, firstOverlap = null;
let lastServed = 0, lastProgressT = 0, stuck = false;
const t0 = Date.now();
let evSpawned = 0;
for (let i = 0; i < steps; i++) {
  if (ctl === 'bot') bot(sim);
  if (has('ev') && i % (60 * 50) === 600) {
    const terms = sim.net.terms.filter((t) => t.entry);
    const a = terms[i % terms.length], b = terms[(i * 7 + 3) % terms.length];
    if (a !== b && sim.spawnSpecial(a.id, b.id, 'ambulance')) evSpawned++;
  }
  sim.step(dt);
  sim.out.length = 0;
  // NaN
  for (const c of sim.cars) if (!Number.isFinite(c.x) || !Number.isFinite(c.z) || !Number.isFinite(c.v) || !Number.isFinite(c.s)) { nan++; if (nan < 3) console.log('NaN car', c.id, c.type, c.seg.id, c.s, c.v); }
  // 重なり（10 コマに 1 回）
  if (i % 10 === 0) {
    const cars = sim.cars;
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], Bc = cars[b];
        if (Math.abs(A.x - Bc.x) > 12 || Math.abs(A.z - Bc.z) > 12) continue;
        if (overlap(A, Bc, 0.25)) {
          overlaps++;
          if (!firstOverlap || verbose) {
            const info = `t=${sim.time.toFixed(1)} #${A.id}(${A.type} ${A.seg.id} s=${A.s.toFixed(1)} v=${A.v.toFixed(1)}) × #${Bc.id}(${Bc.type} ${Bc.seg.id} s=${Bc.s.toFixed(1)} v=${Bc.v.toFixed(1)})`;
            if (!firstOverlap) firstOverlap = info;
            if (verbose && overlaps < 40) console.log('overlap', info);
          }
        }
      }
    }
  }
  if (sim.stats.served > lastServed) { lastServed = sim.stats.served; lastProgressT = sim.time; }
  if (sim.time - lastProgressT > 90 && sim.cars.length > 5 && !stuck) {
    stuck = true;
    console.log(`動かない状態: t=${sim.time.toFixed(0)} cars=${sim.cars.length}`);
    for (const X of sim.net.inter) console.log(' ', X.id, X.signal.phase, X.signal.stage, 'gT=' + X.signal.greenT.toFixed(1), 'evX=' + (X.evCrossing?.id ?? '-'), 'box', [...X.box].map((c) => `${c.id}:${c.seg.id}@${c.s.toFixed(1)} v${c.v.toFixed(1)} turnGo=${!!c.turnGo}`).join(' | '));
    const st = sim.cars.slice(0, 40).map((c) => `${c.id}${c.em ? '(EV ' + c.type + ' redWait=' + c.redWait.toFixed(1) + ' yielders=' + c.yielders + ')' : ''}:${c.seg.id}@${c.s.toFixed(1)}/${c.seg.len.toFixed(1)} v${c.v.toFixed(2)} lat=${c.lat.toFixed(2)}${c.yieldTo ? ' YIELD->' + c.yieldTo.id : ''} nx=${c.route[c.k + 1]?.id || '-'}`);
    console.log('  ', st.join('\n   '));
  }
}
const S = sim.stats;
const ms = Date.now() - t0;
console.log(JSON.stringify({
  map: arg('map', '1x1'), ctl, minutes, rate, rain,
  spawned: S.spawned, served: S.served, onMap: sim.cars.length, offmap: sim.offmap(),
  avgDelay: +(S.delaySum / Math.max(1, S.served)).toFixed(1), avgTravel: +(S.travelSum / Math.max(1, S.served)).toFixed(1),
  maxQueue: S.maxQueue, honks: S.honks, peds: sim.peds.list.length, pedServed: S.pedServed, jaywalk: S.jaywalk, nearMiss: S.nearMiss,
  redRun: S.redRun, reroute: S.reroute || 0, evSpawned, evServed: S.evServed, evLate: S.evLate,
  overlaps, firstOverlap, nan, stuck, simMsPerMin: Math.round(ms / minutes),
}, null, 1));
process.exit(overlaps || nan || stuck ? 1 : 0);

// 向きのある長方形どうしの重なり（分離軸）。shrink だけ小さくして、かすっただけは数えない
function overlap(A, B, shrink) {
  const ax = [A.dx, A.dz], ay = [-A.dz, A.dx], bx = [B.dx, B.dz], by = [-B.dz, B.dx];
  const ah = [A.len / 2 - shrink, A.wid / 2 - shrink], bh = [B.len / 2 - shrink, B.wid / 2 - shrink];
  const d = [B.x - A.x, B.z - A.z];
  for (const axis of [ax, ay, bx, by]) {
    const proj = (u, h) => Math.abs(u[0] * axis[0] + u[1] * axis[1]) * h;
    const ra = proj(ax, ah[0]) + proj(ay, ah[1]);
    const rb = proj(bx, bh[0]) + proj(by, bh[1]);
    if (Math.abs(d[0] * axis[0] + d[1] * axis[1]) > ra + rb) return false;
  }
  return true;
}
