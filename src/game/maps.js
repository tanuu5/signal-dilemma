// 地図。cols：南北の道路の x、rows：東西の道路の z、ext：いちばん外の交差点から台座の端まで（m）。
// names：交差点の名前（i18n のキー）。zones：ブロックの用途（'列,行' → commercial / mixed / residential / park / school）。
// 端の id：北の端 N0, N1…（左から）、南 S0…、西 W0, W1…（上から）、東 E0…
export const MAPS = {
  // 月曜：交差点 1 つ
  d1: {
    cols: [0], rows: [0], ext: 56,
    names: { X0_0: 'int.honcho' },
    zones: { '0,0': 'commercial', '1,0': 'mixed', '0,1': 'residential', '1,1': 'park' },
  },
  // 火曜：東西の大通りに 2 つ
  d2: {
    cols: [-32, 32], rows: [0], ext: 54,
    names: { X0_0: 'int.honcho', X1_0: 'int.ekimae' },
    zones: { '0,0': 'mixed', '1,0': 'commercial', '2,0': 'commercial', '0,1': 'residential', '1,1': 'park', '2,1': 'mixed' },
  },
  // 水曜：2 × 2
  d3: {
    cols: [-32, 32], rows: [-32, 32], ext: 50,
    names: { X0_0: 'int.kita', X1_0: 'int.ekimae', X0_1: 'int.honcho', X1_1: 'int.gakko' },
    zones: { '1,1': 'commercial', '0,0': 'residential', '2,0': 'commercial', '0,2': 'residential', '2,2': 'school', '1,0': 'mixed', '0,1': 'mixed', '2,1': 'commercial', '1,2': 'park' },
  },
  // 木曜：3 × 2
  d4: {
    cols: [-60, 0, 60], rows: [-30, 30], ext: 48,
    names: { X0_0: 'int.kita', X1_0: 'int.shiyakusho', X2_0: 'int.ekimae', X0_1: 'int.honcho', X1_1: 'int.chuo', X2_1: 'int.gakko' },
    zones: { '1,1': 'commercial', '2,1': 'commercial', '3,2': 'school', '0,2': 'residential', '0,0': 'residential', '2,0': 'mixed', '1,2': 'park' },
  },
  // 金曜：3 × 3（花火大会の夜）。真ん中はスクランブル交差点
  d5: {
    cols: [-58, 0, 58], rows: [-58, 0, 58], ext: 46,
    names: { X0_0: 'int.kita', X1_0: 'int.shiyakusho', X2_0: 'int.kawara', X0_1: 'int.honcho', X1_1: 'int.ekimae', X2_1: 'int.chuo', X0_2: 'int.minami', X1_2: 'int.gakko', X2_2: 'int.hashi' },
    scramble: ['X1_1'],
    zones: { '1,1': 'commercial', '2,1': 'commercial', '1,2': 'commercial', '2,2': 'commercial', '3,3': 'park', '0,3': 'residential', '3,0': 'park', '0,0': 'residential', '2,3': 'school' },
  },
};
