// 5 日間の台本。時刻は「時」（7.5 = 7:30）。
//   pace：[始まり, 終わり, 実時間の秒]。時計の進み方（ラッシュはゆっくり、昼はさっと）
//   demand：時刻ごとの交通量（間はなめらかにつなぐ）。gen：端ごとの台/分、attract：行き先の重み、ped：交差点ごとの人/分
//   bus：バスの運行（every：何秒おきか。実時間）
//   events：決まった時刻に起きること（Director が読む）
//     msg：知らせ（話す人 who、キー key）、tut：チュートリアル（操作を待つ）、ev：救急車など、dilemma：判断、
//     rain：雨、kids：下校、closure：通行止め、fireworks：花火、bus：バスの運行
//   start：最初の信号の向き、modes：最初の自動・手動
//   helpers：補助AI「ツジ」が受け持つ順（やりなおすときに呼んだ数だけ、前から）。チュートリアルの交差点と、その日の中心の交差点は入れない
const MIX = { sedan: 0.42, kei: 0.26, van: 0.1, taxi: 0.08, truck: 0.08, bus: 0.0 };

export const DAYS = [
  {
    n: 1, map: 'd1', wd: 'mon', start: 7, end: 19,
    pace: [[7, 9.2, 120], [9.2, 12, 55], [12, 15, 55], [15, 16.5, 40], [16.5, 19, 105]],
    demand: [
      { h: 7, gen: { N0: 1.2, S0: 2.0, W0: 1.2, E0: 1.2 }, attract: { N0: 2.2, S0: 0.6, W0: 1, E0: 1 }, ped: 0 },
      { h: 7.6, gen: { N0: 1.6, S0: 4.4, W0: 2.0, E0: 2.0 }, attract: { N0: 3.2, S0: 0.6, W0: 1, E0: 1 }, ped: 0 },
      { h: 8.3, gen: { N0: 2.0, S0: 5.0, W0: 2.4, E0: 2.4 }, attract: { N0: 3.2, S0: 0.6, W0: 1, E0: 1 }, ped: 1.6 },
      { h: 9.3, gen: { N0: 1.8, S0: 2.6, W0: 2.0, E0: 2.0 }, attract: { N0: 1.4, S0: 1, W0: 1, E0: 1 }, ped: 2.4 },
      { h: 12, gen: { N0: 2.2, S0: 2.2, W0: 2.6, E0: 2.6 }, attract: { N0: 1, S0: 1, W0: 1, E0: 1 }, ped: 3 },
      { h: 15, gen: { N0: 2.2, S0: 2.2, W0: 2.6, E0: 2.6 }, attract: { N0: 1, S0: 1, W0: 1, E0: 1 }, ped: 4.5 },
      { h: 16.6, gen: { N0: 4.8, S0: 1.8, W0: 2.6, E0: 2.6 }, attract: { N0: 0.6, S0: 3.2, W0: 1, E0: 1 }, ped: 3 },
      { h: 17.6, gen: { N0: 5.4, S0: 2.0, W0: 3.0, E0: 3.0 }, attract: { N0: 0.6, S0: 3.2, W0: 1, E0: 1 }, ped: 2.6 },
      { h: 19, gen: { N0: 3, S0: 1.6, W0: 2, E0: 2 }, attract: { N0: 1, S0: 1.6, W0: 1, E0: 1 }, ped: 1.6 },
    ],
    mix: MIX,
    init: { phase: { X0_0: 'NS' }, mode: { X0_0: 'manual' } },
    events: [
      { h: 7.0, do: 'tut', id: 'toggle', node: 'X0_0' },
      { h: 7.5, do: 'msg', who: 'yui', key: 'd1.rush' },
      { h: 8.4, do: 'tut', id: 'walk', node: 'X0_0' },
      { h: 9.3, do: 'msg', who: 'yui', key: 'tut.sat' },
      { h: 10.3, do: 'ev', type: 'ambulance', from: 'W0', to: 'E0', tut: true },
      { h: 12.0, do: 'dilemma', id: 'cat' },
      { h: 14.9, do: 'kids', node: 'X0_0', until: 16.0, rate: 5 },
      { h: 15.0, do: 'msg', who: 'yui', key: 'd1.kids' },
      { h: 16.7, do: 'msg', who: 'yui', key: 'd1.evening' },
      { h: 18.4, do: 'msg', who: 'yui', key: 'd1.almost' },
    ],
  },
  {
    n: 2, map: 'd2', wd: 'tue', start: 7, end: 19,
    pace: [[7, 9.2, 115], [9.2, 12, 55], [12, 15, 55], [15, 16.5, 45], [16.5, 19, 110]],
    demand: [
      { h: 7, gen: { W0: 2.6, E0: 1.6, N0: 1.0, S0: 1.6, N1: 1.0, S1: 1.4 }, attract: { E0: 2.6, W0: 1, N0: 1, S0: 0.8, N1: 1.6, S1: 0.8 }, ped: 0.6 },
      { h: 7.7, gen: { W0: 5.0, E0: 2.0, N0: 1.6, S0: 2.6, N1: 1.4, S1: 2.6 }, attract: { E0: 3.2, W0: 0.8, N0: 1.2, S0: 0.6, N1: 2.2, S1: 0.6 }, ped: 1.6 },
      { h: 9.3, gen: { W0: 2.6, E0: 2.4, N0: 1.4, S0: 1.6, N1: 1.4, S1: 1.6 }, attract: { E0: 1.2, W0: 1.2, N0: 1, S0: 1, N1: 1.2, S1: 1 }, ped: 2.2 },
      { h: 12, gen: { W0: 2.8, E0: 2.8, N0: 1.6, S0: 1.6, N1: 1.6, S1: 1.6 }, attract: { E0: 1, W0: 1, N0: 1, S0: 1, N1: 1, S1: 1 }, ped: 2.8 },
      { h: 15, gen: { W0: 2.8, E0: 2.8, N0: 1.6, S0: 1.6, N1: 1.6, S1: 1.6 }, attract: { E0: 1, W0: 1, N0: 1, S0: 1, N1: 1, S1: 1 }, ped: 3.4 },
      { h: 16.8, gen: { W0: 2.2, E0: 5.2, N0: 2.6, S0: 1.4, N1: 2.6, S1: 1.4 }, attract: { E0: 0.8, W0: 3.2, N0: 0.6, S0: 2.0, N1: 0.6, S1: 1.4 }, ped: 2.6 },
      { h: 19, gen: { W0: 1.8, E0: 2.6, N0: 1.4, S0: 1, N1: 1.4, S1: 1 }, attract: { E0: 1, W0: 1.6, N0: 1, S0: 1.2, N1: 1, S1: 1 }, ped: 1.4 },
    ],
    mix: { ...MIX },
    bus: { from: ['W0', 'E0'], to: ['E0', 'W0'], every: 32 },
    init: { phase: { X0_0: 'EW', X1_0: 'EW' }, mode: { X0_0: 'manual', X1_0: 'manual' } },
    helpers: ['X0_0'],
    events: [
      { h: 7.0, do: 'msg', who: 'yui', key: 'd2.hello' },
      { h: 7.25, do: 'tut', id: 'select', node: 'X1_0' },
      { h: 8.4, do: 'dilemma', id: 'delivery' },
      { h: 10.6, do: 'ev', type: 'ambulance', from: 'N1', to: 'S0' },
      { h: 13.2, do: 'ev', type: 'fire', from: 'E0', to: 'W0' },
      { h: 15.4, do: 'dilemma', id: 'labor' },
      { h: 14.9, do: 'kids', node: 'X0_0', until: 16.0, rate: 4 },
      { h: 16.8, do: 'msg', who: 'yui', key: 'd2.evening' },
    ],
  },
  {
    n: 3, map: 'd3', wd: 'wed', start: 7, end: 19, rain: 1,
    pace: [[7, 9.2, 115], [9.2, 12, 55], [12, 15, 55], [15, 16.5, 45], [16.5, 19, 110]],
    demand: [
      { h: 7, gen: { all: 1.4 }, attract: { N0: 1.6, N1: 1.6 }, ped: 1 },
      { h: 7.7, gen: { all: 2.0, S0: 3.0, S1: 3.0, W0: 2.6 }, attract: { N0: 2.4, N1: 2.4, E0: 1.4 }, ped: 1.6 },
      { h: 9.4, gen: { all: 1.6 }, attract: {}, ped: 2 },
      { h: 12, gen: { all: 1.8 }, attract: {}, ped: 2.4 },
      { h: 15, gen: { all: 1.8 }, attract: {}, ped: 2.6 },
      { h: 16.8, gen: { all: 2.1, N0: 3.0, N1: 3.0, E1: 2.6 }, attract: { S0: 2.4, S1: 2.4, W1: 1.4 }, ped: 2 },
      { h: 19, gen: { all: 1.4 }, attract: {}, ped: 1.2 },
    ],
    mix: { ...MIX, bus: 0.0 },
    bus: { from: ['W1', 'E1'], to: ['E1', 'W1'], every: 36 },
    init: { phase: { X0_0: 'NS', X1_0: 'NS', X0_1: 'EW', X1_1: 'NS' }, mode: { X0_0: 'auto', X1_0: 'auto', X0_1: 'manual', X1_1: 'auto' } },
    helpers: ['X0_1', 'X1_0', 'X0_0'],
    events: [
      { h: 7.0, do: 'msg', who: 'yui', key: 'd3.hello' },
      { h: 7.2, do: 'tut', id: 'auto', node: 'X1_1' },
      { h: 9.4, do: 'dilemma', id: 'police' },
      { h: 11.5, do: 'ev', type: 'ambulance', from: 'S1', to: 'N0' },
      { h: 14.6, do: 'dilemma', id: 'school' },
      { h: 14.9, do: 'kids', node: 'X1_1', until: 16.2, rate: 6 },
      { h: 14.9, do: 'kids', node: 'X0_1', until: 16.2, rate: 3 },
      { h: 16.0, do: 'ev', type: 'ambulance', from: 'W0', to: 'E1' },
      { h: 17.0, do: 'msg', who: 'yui', key: 'd3.evening' },
    ],
  },
  {
    n: 4, map: 'd4', wd: 'thu', start: 7, end: 19,
    pace: [[7, 9.2, 110], [9.2, 12, 60], [12, 15, 60], [15, 16.5, 45], [16.5, 19, 105]],
    demand: [
      { h: 7, gen: { all: 1.3 }, attract: { N1: 1.6, E0: 1.4 }, ped: 1.2 },
      { h: 7.7, gen: { all: 1.8, S0: 2.8, S1: 2.6, W1: 2.4 }, attract: { N0: 2, N1: 2.6, E0: 2.2 }, ped: 1.8 },
      { h: 9.4, gen: { all: 1.5 }, attract: {}, ped: 2.2 },
      { h: 12, gen: { all: 1.7 }, attract: {}, ped: 2.6 },
      { h: 15, gen: { all: 1.7 }, attract: {}, ped: 2.8 },
      { h: 16.8, gen: { all: 2.0, N1: 2.8, E0: 2.8, N2: 2.4 }, attract: { S0: 2.2, S1: 2.4, W1: 2 }, ped: 2.2 },
      { h: 19, gen: { all: 1.3 }, attract: {}, ped: 1.4 },
    ],
    mix: { ...MIX },
    bus: { from: ['W1', 'E1'], to: ['E1', 'W1'], every: 34 },
    init: { phase: {}, mode: { X0_0: 'auto', X2_0: 'auto', X0_1: 'auto', X2_1: 'auto', X1_0: 'manual', X1_1: 'manual' } },
    helpers: ['X1_1', 'X2_1', 'X0_1', 'X2_0', 'X0_0'],
    events: [
      { h: 7.0, do: 'msg', who: 'yui', key: 'd4.hello' },
      { h: 8.3, do: 'dilemma', id: 'mayor' },
      { h: 10.2, do: 'ev', type: 'ambulance', from: 'N2', to: 'S0' },
      { h: 11.6, do: 'accident', node: 'X1_1' },
      { h: 12.8, do: 'dilemma', id: 'logs' },
      { h: 14.9, do: 'kids', node: 'X2_1', until: 16.0, rate: 4 },
      { h: 15.9, do: 'dilemma', id: 'copycat', if: 'laborHelped' },
      { h: 16.4, do: 'ev', type: 'fire', from: 'W0', to: 'E1' },
      { h: 17.0, do: 'msg', who: 'yui', key: 'd4.evening' },
    ],
  },
  {
    n: 5, map: 'd5', wd: 'fri', start: 15, end: 21.75,
    pace: [[15, 17, 60], [17, 18.5, 85], [18.5, 19.5, 50], [19.5, 20.3, 55], [20.3, 21.75, 95]],
    demand: [
      { h: 15, gen: { all: 1.4 }, attract: {}, ped: 2.2 },
      { h: 16.8, gen: { all: 1.9, N1: 2.6, E1: 2.4 }, attract: { S0: 1.6, S1: 1.8, S2: 1.6, W1: 1.6 }, ped: 3 },
      { h: 18.3, gen: { all: 1.8 }, attract: { E0: 1.6, E1: 1.6, E2: 1.6 }, ped: 4.5 },
      { h: 19.6, gen: { all: 1.3 }, attract: {}, ped: 2.4 },
      { h: 20.4, gen: { all: 1.6, E0: 2.6, E1: 2.6, E2: 2.6 }, attract: { W0: 1.8, W1: 2, W2: 1.8 }, ped: 5 },
      { h: 21.75, gen: { all: 1.5 }, attract: {}, ped: 3 },
    ],
    pedHot: { X1_1: 2.4 },   // 駅前（スクランブル）は人が多い
    mix: { ...MIX },
    bus: { from: ['W1', 'E1', 'N1'], to: ['E1', 'W1', 'S1'], every: 26 },
    init: { phase: {}, mode: { X0_0: 'auto', X1_0: 'auto', X2_0: 'auto', X0_1: 'auto', X1_1: 'manual', X2_1: 'manual', X0_2: 'auto', X1_2: 'auto', X2_2: 'auto' } },
    helpers: ['X2_1', 'X1_0', 'X1_2', 'X0_1', 'X2_2', 'X0_0', 'X2_0', 'X0_2'],
    events: [
      { h: 15.0, do: 'msg', who: 'yui', key: 'd5.hello' },
      { h: 15.9, do: 'dilemma', id: 'hacker' },
      { h: 17.4, do: 'ev', type: 'ambulance', from: 'S2', to: 'N0' },
      { h: 18.0, do: 'closure', link: 'X2_0-X2_1', until: 21.0 },
      { h: 18.05, do: 'msg', who: 'yui', key: 'd5.closure' },
      { h: 19.5, do: 'fireworks', until: 20.3 },
      { h: 19.55, do: 'msg', who: 'yui', key: 'd5.fireworks' },
      { h: 19.9, do: 'dilemma', id: 'lostchild' },
      { h: 20.35, do: 'msg', who: 'yui', key: 'd5.rush' },
      { h: 20.9, do: 'ev', type: 'ambulance', from: 'E1', to: 'W2' },
    ],
  },
];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
