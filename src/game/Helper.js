// 補助AI「ツジ」の判断：受け持った交差点（signal.mode === 'helper'）の信号を、待っている車と人を見て切り替える。
// 確認用の自動プレイ（Game._bot）と dev/simtest.mjs の --ctl helper も、同じ判断を使う。
//   救急車が近づいていれば、その向きを青にする（ミチが判断で優先すると決めた車も：priority）
//   待っている人が多い・長く待っている人がいれば、歩行者の青をはさむ
//   青の側の流れが切れたか、赤の側の列のほうが重ければ切り替える
// 青は MIN_GREEN 秒より短くしない。短く切り替え続けると、黄と全赤ばかりになり、発進の遅いバスが何周も渡れなくなる
// （火曜の夕方、4 秒ごとに切り替え続けて、満足度が 0 になったことがあった）。
import { AXIS } from './sim/geom.js';

const MIN_GREEN = 7;     // 青の最短（秒）
const LONG_GREEN = 14;   // これより長い青は、赤の側が同じくらい待っていれば切り替える
const MAX_GREEN = 28;    // 赤の側に誰かいれば、これより長くは続けない

/** 青の側に、まだ流れている車がいるか（近づいてくる車と、停止線の前で動き出したところの車）。 */
function flowing(X, axis) {
  for (const h of axis === 'NS' ? ['N', 'S'] : ['E', 'W']) {
    const lane = X.approach[h];
    if (!lane) continue;
    for (const c of lane.cars) {
      const d = lane.len - c.s;
      if ((d < 32 && c.v > 2) || (d < 14 && c.v > 0.3)) return true;
    }
  }
  return false;
}

/**
 * X の信号を 1 回見て、必要なら切り替える。切り替えたら何をしたか（'ev' | 'walk' | 'toggle'）、しなければ null。
 * priority：(car) => bool。救急車のほかに、近づいたら青にする車（配送の契約・市長の車列など）。
 */
export function smartStep(sim, X, by = 'helper', priority = null) {
  const s = X.signal;
  if (s.hold || s.stage !== 'G' || s.phase === 'WALK') return null;
  const cur = s.phase, other = cur === 'NS' ? 'EW' : 'NS';
  let pAxis = null;
  for (const c of sim.cars) {
    if (c.seg.kind !== 'lane' || c.seg.to !== X) continue;
    const d = c.seg.len - c.s;
    if (c.em && c.siren && d < 60) { pAxis = AXIS[c.seg.heading]; break; }
    if (priority && d < 45 && priority(c)) pAxis = AXIS[c.seg.heading];
  }
  if (pAxis) return pAxis !== cur && s.toggle(by) ? 'ev' : null;
  if (s.greenT < MIN_GREEN) return null;
  const peds = sim.pedWaiting(X);
  if ((peds.count >= 5 || peds.maxWait > 30 || (X.schoolPriority && peds.count > 0)) && s.walk(by)) return 'walk';
  const a = sim.axisDemand(X, cur), b = sim.axisDemand(X, other);
  if (b.count === 0) return null;
  const pa = a.count + a.wait * 0.1, pb = b.count + b.wait * 0.1;
  const gap = !flowing(X, cur);
  if ((gap && pb > a.count * 0.6) || (s.greenT > LONG_GREEN && pb > pa * 0.6) || s.greenT > MAX_GREEN) return s.toggle(by) ? 'toggle' : null;
  return null;
}
