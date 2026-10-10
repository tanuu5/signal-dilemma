// シミュレーションの寸法と、車の性質。単位は m・秒。
export const LANE_W = 3.5;            // 車線の幅
export const ROAD_HALF = LANE_W;      // 片側 1 車線の道路の半分の幅
export const BOX = ROAD_HALF + 0.2;   // 交差点の中心から横断歩道の内側の端まで
export const CW_W = 3.0;              // 横断歩道の幅
export const STOP = BOX + CW_W + 1.0; // 停止線（中心からの距離）
export const EXIT = BOX + CW_W + 0.4; // 交差点を出た先の車線の始まり
export const SIDEWALK = 3.2;          // 歩道の幅
export const CURB = ROAD_HALF;        // 車道の端
export const WALK_C = CURB + 1.1;     // 歩行者が角で待つ位置（中心からの距離）

export const SIGNAL = {
  yellow: 2.6,      // 黄
  allRedMin: 1.0,   // 全赤（最低）
  allRedMax: 6.0,   // 交差点が空くのを待つ上限
  walk: 7.0,        // 歩行者の青
  walkFlash: 3.0,   // 歩行者の青の点滅
  walkClearMax: 6.0,
  autoGreen: 11,    // 自動（一定周期）の青の長さ
};

// 車の種類。len：長さ、wid：幅、v0：出したい速さ、a：加速、b：快適な減速、T：車間時間、s0：止まったときの車間、pax：乗っている人の数
export const CAR_TYPES = {
  sedan: { len: 4.5, wid: 1.75, v0: 12.5, a: 1.7, b: 2.6, T: 1.2, s0: 2.0, pax: 1.4 },
  kei: { len: 3.4, wid: 1.48, v0: 11.8, a: 1.5, b: 2.6, T: 1.2, s0: 2.0, pax: 1.2 },
  van: { len: 4.7, wid: 1.8, v0: 12.0, a: 1.4, b: 2.5, T: 1.3, s0: 2.0, pax: 2.2 },
  taxi: { len: 4.6, wid: 1.72, v0: 12.8, a: 1.8, b: 2.7, T: 1.1, s0: 2.0, pax: 1.6 },
  truck: { len: 6.6, wid: 2.1, v0: 11.0, a: 0.95, b: 2.3, T: 1.5, s0: 2.5, pax: 1.0 },
  bus: { len: 10.5, wid: 2.4, v0: 11.0, a: 0.9, b: 2.2, T: 1.5, s0: 2.5, pax: 18 },
  ambulance: { len: 5.6, wid: 1.95, v0: 15.0, a: 2.2, b: 3.0, T: 1.0, s0: 2.0, pax: 3, emergency: true },
  fire: { len: 7.6, wid: 2.3, v0: 14.0, a: 1.6, b: 2.8, T: 1.1, s0: 2.2, pax: 4, emergency: true },
  police: { len: 4.7, wid: 1.78, v0: 15.0, a: 2.3, b: 3.0, T: 1.0, s0: 2.0, pax: 2, emergency: true },
  vip: { len: 5.2, wid: 1.9, v0: 12.5, a: 1.6, b: 2.6, T: 1.0, s0: 2.0, pax: 3 },
  delivery: { len: 5.8, wid: 2.0, v0: 11.5, a: 1.1, b: 2.4, T: 1.4, s0: 2.3, pax: 1.0 },
};

export const B_MAX = 8.0;   // 急ブレーキの上限
export const TURN_V = { L: 4.6, S: 99, R: 6.0 }; // 曲がるときの速さの上限
