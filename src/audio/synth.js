// 音源と効果音。音声ファイルは使わず、Web Audio のオシレーターとノイズで鳴らす。
// どの関数も (ctx, out, t, p) の形：out はミキサーの系統（{ dry, wet }）、t は鳴らす時刻（ctx.currentTime 基準）。
// p は { f（Hz）or m（MIDI）, dur, vel（0〜1）, pan（-1〜1）, rev（リバーブへの送り 0〜1） } など。
// 値はすべて fin() で確かめてから使う（NaN が AudioParam に入ると、その音はもう鳴らない）。

const fin = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const FLOOR = 0.0001; // 指数ランプは 0 に向かえないので、ここまで下げる

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const n = ctx.sampleRate * 1.5;
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 22222;
    for (let i = 0; i < n; i++) d[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** node → 音量 → 定位 → out.dry（と、rev があれば out.wet）につなぐ。音量の GainNode を返す。 */
function route(ctx, node, out, p) {
  const g = ctx.createGain();
  g.gain.value = 0;
  let last = node.connect(g);
  if (p.pan) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, fin(p.pan, 0)));
    last = last.connect(pan);
  }
  last.connect(out.dry);
  const rev = fin(p.rev, 0);
  if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; last.connect(s).connect(out.wet); }
  return g;
}

/** 立ち上がり a、減衰 d で peak から消える（打楽器・効果音の形）。 */
function perc(param, t, peak, a, d) {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  param.exponentialRampToValueAtTime(FLOOR, t + a + d);
}
/** 立ち上がり a、保持、離して r で消える（持続音の形）。 */
function adsr(param, t, peak, a, hold, r) {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  param.setValueAtTime(Math.max(FLOOR, peak), t + a + hold);
  param.exponentialRampToValueAtTime(FLOOR, t + a + hold + r);
}

function osc(ctx, type, f, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f), t);
  o.start(t);
  o.stop(end + 0.05);
  return o;
}

function noise(ctx, t, end) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t, Math.random() * 1.2);
  s.stop(end + 0.05);
  return s;
}

function filter(ctx, type, f, q = 0.8) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(10, f);
  b.Q.value = q;
  return b;
}

const hz = (p, def) => fin(p.f, p.m !== undefined ? mtof(fin(p.m, 69)) : def);

// ---------------------------------------------------------------- 楽器（シーケンサーから使う）
export const INSTRUMENTS = {
  /** 矩形波のリード（チップチューン寄り）。 */
  lead(ctx, out, t, p) {
    const f = hz(p, 440), dur = fin(p.dur, 0.25), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'square', f, t, t + dur + 0.2);
    const lp = filter(ctx, 'lowpass', Math.min(9000, f * 6), 0.7);
    const g = route(ctx, o.connect(lp), out, { rev: 0.18, ...p });
    adsr(g.gain, t, 0.14 * vel, 0.006, Math.max(0, dur - 0.03), 0.12);
  },
  /** のこぎり波のベース（フィルターで弾く）。 */
  bass(ctx, out, t, p) {
    const f = hz(p, 55), dur = fin(p.dur, 0.25), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.15);
    const lp = filter(ctx, 'lowpass', 900, 3);
    lp.frequency.setValueAtTime(220 + 2200 * vel, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.18);
    const g = route(ctx, o.connect(lp), out, p);
    adsr(g.gain, t, 0.3 * vel, 0.004, Math.max(0, dur - 0.04), 0.08);
  },
  /** 少しずらした 3 本ののこぎり波のパッド（和音向け）。 */
  pad(ctx, out, t, p) {
    const f = hz(p, 220), dur = fin(p.dur, 1), vel = fin(p.vel, 0.6);
    const lp = filter(ctx, 'lowpass', 1800, 0.5);
    const mix = ctx.createGain();
    for (const det of [-9, 0, 8]) { const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.8); o.detune.value = det; o.connect(mix); }
    mix.gain.value = 0.33;
    const g = route(ctx, mix.connect(lp), out, { rev: 0.35, ...p });
    adsr(g.gain, t, 0.08 * vel, 0.12, Math.max(0, dur - 0.12), 0.6);
  },
  /** 弾いた音（三角波＋短い倍音）。アルペジオ・メロディに。 */
  pluck(ctx, out, t, p) {
    const f = hz(p, 440), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'triangle', f, t, t + 0.6);
    const o2 = osc(ctx, 'sine', f * 2, t, t + 0.25);
    const m = ctx.createGain();
    o.connect(m); o2.connect(m);
    const g = route(ctx, m, out, { rev: 0.2, ...p });
    perc(g.gain, t, 0.25 * vel, 0.003, 0.45);
  },
  /** 鐘（FM）。完成・ご褒美の合図に。 */
  bell(ctx, out, t, p) {
    const f = hz(p, 880), vel = fin(p.vel, 0.7), dur = fin(p.dur, 1.4);
    const car = osc(ctx, 'sine', f, t, t + dur);
    const mod = osc(ctx, 'sine', f * 3.5, t, t + dur);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = route(ctx, car, out, { rev: 0.35, ...p });
    perc(g.gain, t, 0.18 * vel, 0.002, dur);
  },
  kick(ctx, out, t, p) {
    const vel = fin(p.vel, 0.9);
    const o = osc(ctx, 'sine', 150, t, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.9 * vel, 0.002, 0.38);
  },
  snare(ctx, out, t, p) {
    const vel = fin(p.vel, 0.8);
    const n = noise(ctx, t, t + 0.25);
    const g = route(ctx, n.connect(filter(ctx, 'bandpass', 1800, 0.7)), out, { rev: 0.15, ...p });
    perc(g.gain, t, 0.5 * vel, 0.001, 0.18);
    const o = osc(ctx, 'triangle', 190, t, t + 0.15);
    const g2 = route(ctx, o, out, p);
    perc(g2.gain, t, 0.3 * vel, 0.001, 0.09);
  },
  hat(ctx, out, t, p) {
    const vel = fin(p.vel, 0.6), open = !!p.open;
    const n = noise(ctx, t, t + (open ? 0.35 : 0.08));
    const g = route(ctx, n.connect(filter(ctx, 'highpass', 7500, 0.7)), out, p);
    perc(g.gain, t, 0.22 * vel, 0.001, open ? 0.3 : 0.05);
  },
  /** エレクトリックピアノ（FM）。夜の街の、やわらかい和音に。 */
  epiano(ctx, out, t, p) {
    const f = hz(p, 440), vel = fin(p.vel, 0.7), dur = Math.max(0.2, fin(p.dur, 0.6));
    const end = t + dur + 1.2;
    const car = osc(ctx, 'sine', f, t, end);
    const mod = osc(ctx, 'sine', f, t, end);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6 * vel, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.12), t + 0.6);
    mod.connect(mg).connect(car.frequency);
    const tine = osc(ctx, 'sine', f * 4.01, t, t + 0.3);
    const tg = ctx.createGain();
    tg.gain.value = 0.18;
    const mix = ctx.createGain();
    car.connect(mix);
    tine.connect(tg).connect(mix);
    const g = route(ctx, mix, out, { rev: 0.25, ...p });
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.07 * vel, t + 0.35);
    g.gain.setValueAtTime(0.07 * vel, t + Math.max(0.36, dur));
    g.gain.exponentialRampToValueAtTime(FLOOR, t + Math.max(0.36, dur) + 0.9);
  },
  /** 低いサイン波のベース。 */
  sub(ctx, out, t, p) {
    const f = hz(p, 55), dur = fin(p.dur, 0.4), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'sine', f, t, t + dur + 0.2);
    const o2 = osc(ctx, 'triangle', f * 2, t, t + dur + 0.2);
    const m = ctx.createGain();
    o.connect(m);
    const g2 = ctx.createGain(); g2.gain.value = 0.18; o2.connect(g2).connect(m);
    const g = route(ctx, m, out, p);
    adsr(g.gain, t, 0.34 * vel, 0.008, Math.max(0, dur - 0.05), 0.12);
  },
  /** 柔らかい鍵盤の打音（マリンバ寄り）。 */
  mallet(ctx, out, t, p) {
    const f = hz(p, 660), vel = fin(p.vel, 0.7);
    const o = osc(ctx, 'sine', f, t, t + 0.8);
    const o2 = osc(ctx, 'sine', f * 3.98, t, t + 0.12);
    const m = ctx.createGain();
    o.connect(m);
    const g2 = ctx.createGain(); g2.gain.value = 0.22; o2.connect(g2).connect(m);
    const g = route(ctx, m, out, { rev: 0.3, ...p });
    perc(g.gain, t, 0.22 * vel, 0.002, 0.55);
  },
};

// ---------------------------------------------------------------- 効果音（audio.sfx(name) で鳴らす）
// 作品に合わせて足す・作り替える。名前はゲームの出来事に合わせる（coin, hit, gameover …）。
export const SFX = {
  ui_move(ctx, out, t) { INSTRUMENTS.pluck(ctx, out, t, { f: 1320, vel: 0.35, rev: 0 }); },
  ui_ok(ctx, out, t) { INSTRUMENTS.pluck(ctx, out, t, { f: 988, vel: 0.5 }); INSTRUMENTS.pluck(ctx, out, t + 0.06, { f: 1480, vel: 0.5 }); },
  ui_back(ctx, out, t) { INSTRUMENTS.pluck(ctx, out, t, { f: 880, vel: 0.45 }); INSTRUMENTS.pluck(ctx, out, t + 0.06, { f: 587, vel: 0.45 }); },
  pause(ctx, out, t) { INSTRUMENTS.bell(ctx, out, t, { f: 784, vel: 0.9, dur: 0.6 }); },
  jump(ctx, out, t, p = {}) {
    const o = osc(ctx, 'square', 300, t, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(760 * fin(p.pitch, 1), t + 0.14);
    const g = route(ctx, o.connect(filter(ctx, 'lowpass', 3200)), out, p);
    perc(g.gain, t, 0.12, 0.004, 0.16);
  },
  land(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.12);
    const g = route(ctx, n.connect(filter(ctx, 'lowpass', 600, 0.9)), out, p);
    perc(g.gain, t, 0.35 * fin(p.vel, 1), 0.002, 0.1);
  },
  coin(ctx, out, t, p = {}) {
    const k = fin(p.pitch, 1);
    for (const [dt, f] of [[0, 1319], [0.07, 1976]]) {
      const o = osc(ctx, 'square', f * k, t + dt, t + dt + 0.3);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 6000)), out, { rev: 0.15, ...p });
      perc(g.gain, t + dt, 0.1, 0.002, dt ? 0.26 : 0.08);
    }
  },
  hit(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sawtooth', 220, t, t + 0.25);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const g = route(ctx, o.connect(filter(ctx, 'lowpass', 1400)), out, p);
    perc(g.gain, t, 0.3, 0.002, 0.22);
    SFX.land(ctx, out, t, { vel: 0.8 });
  },
  explode(ctx, out, t, p = {}) {
    const dur = fin(p.dur, 1.1);
    const n = noise(ctx, t, t + dur);
    const lp = filter(ctx, 'lowpass', 3000, 0.6);
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = route(ctx, n.connect(lp), out, { rev: 0.3, ...p });
    perc(g.gain, t, 0.7, 0.004, dur);
    INSTRUMENTS.kick(ctx, out, t, { vel: 1 });
  },
  powerup(ctx, out, t, p = {}) {
    [523, 659, 784, 1047, 1319].forEach((f, i) => INSTRUMENTS.pluck(ctx, out, t + i * 0.055, { f, vel: 0.55, rev: 0.25, ...p }));
  },

  // ---- この作品の音
  /** 交差点を選んだ（小さな電子音）。 */
  select(ctx, out, t) { blipTone(ctx, out, t, 1760, 0.05, 0.06, 'sine'); },
  /** 信号を切り替えた（ピッ・ポン）。 */
  switch(ctx, out, t) { blipTone(ctx, out, t, 1320, 0.05, 0.09, 'triangle'); blipTone(ctx, out, t + 0.07, 1760, 0.08, 0.08, 'triangle'); },
  /** できない（切り替えの途中など）。 */
  deny(ctx, out, t) { blipTone(ctx, out, t, 220, 0.12, 0.09, 'square', 900); },
  walkReq(ctx, out, t) { INSTRUMENTS.bell(ctx, out, t, { f: 1318, vel: 0.45, dur: 0.5 }); INSTRUMENTS.bell(ctx, out, t + 0.09, { f: 1760, vel: 0.35, dur: 0.6 }); },
  autoOn(ctx, out, t) { [880, 1175, 1568].forEach((f, i) => blipTone(ctx, out, t + i * 0.05, f, 0.05, 0.06, 'sine')); },
  autoOff(ctx, out, t) { [1568, 1175, 880].forEach((f, i) => blipTone(ctx, out, t + i * 0.05, f, 0.05, 0.06, 'sine')); },
  fastOn(ctx, out, t) { sweep(ctx, out, t, 300, 2600, 0.25, 0.12); },
  fastOff(ctx, out, t) { sweep(ctx, out, t, 2600, 300, 0.25, 0.12); },
  /** 知らせが届いた（ポン）。 */
  msg(ctx, out, t) { INSTRUMENTS.mallet(ctx, out, t, { f: 988, vel: 0.5 }); INSTRUMENTS.mallet(ctx, out, t + 0.08, { f: 1480, vel: 0.4 }); },
  blip(ctx, out, t) { blipTone(ctx, out, t, 2100, 0.03, 0.05, 'square', 5000); },
  /** 注意（救急車が来る）。 */
  alert(ctx, out, t) {
    for (let i = 0; i < 2; i++) { blipTone(ctx, out, t + i * 0.32, 988, 0.14, 0.14, 'square', 3000); blipTone(ctx, out, t + i * 0.32 + 0.15, 784, 0.14, 0.14, 'square', 3000); }
  },
  /** 判断を求められた（重い和音）。 */
  dilemma(ctx, out, t) {
    for (const m of [50, 57, 62, 65]) INSTRUMENTS.pad(ctx, out, t, { m, dur: 1.6, vel: 0.9 });
    INSTRUMENTS.bell(ctx, out, t, { f: 587, vel: 0.6, dur: 2.2 });
  },
  /** 乱れ（あやしい通信）。 */
  glitch(ctx, out, t) {
    for (let i = 0; i < 9; i++) blipTone(ctx, out, t + i * 0.045, 200 + ((i * 7919) % 13) * 140, 0.035, 0.08, 'square', 6000);
    const n = noise(ctx, t, t + 0.5);
    const g = route(ctx, n.connect(filter(ctx, 'bandpass', 2400, 2)), out, {});
    perc(g.gain, t, 0.12, 0.002, 0.45);
  },
  good(ctx, out, t) { [784, 988, 1175, 1568].forEach((f, i) => INSTRUMENTS.mallet(ctx, out, t + i * 0.07, { f, vel: 0.5 })); },
  bad(ctx, out, t) { blipTone(ctx, out, t, 330, 0.18, 0.12, 'triangle', 1400); blipTone(ctx, out, t + 0.2, 247, 0.3, 0.12, 'triangle', 1200); },
  fanfare(ctx, out, t) {
    const seq = [[0, 72], [0.12, 76], [0.24, 79], [0.42, 84]];
    for (const [dt, m] of seq) { INSTRUMENTS.epiano(ctx, out, t + dt, { m, vel: 0.8, dur: 0.5 }); INSTRUMENTS.mallet(ctx, out, t + dt, { m: m + 12, vel: 0.4 }); }
    for (const m of [60, 64, 67, 72]) INSTRUMENTS.pad(ctx, out, t + 0.42, { m, dur: 1.4, vel: 0.6 });
  },
  dayend(ctx, out, t) { [[0, 76], [0.18, 72], [0.36, 79]].forEach(([dt, m]) => INSTRUMENTS.bell(ctx, out, t + dt, { m, vel: 0.5, dur: 1.4 })); },
  fail(ctx, out, t) {
    const o = osc(ctx, 'sawtooth', 440, t, t + 1.4);
    o.frequency.exponentialRampToValueAtTime(40, t + 1.3);
    const g = route(ctx, o.connect(filter(ctx, 'lowpass', 1600)), out, { rev: 0.3 });
    adsr(g.gain, t, 0.22, 0.01, 0.9, 0.4);
  },
  buy(ctx, out, t) { [1047, 1319, 1568, 2093].forEach((f, i) => INSTRUMENTS.bell(ctx, out, t + i * 0.05, { f, vel: 0.35, dur: 0.5 })); },
  start(ctx, out, t) { [0, 0.16, 0.32].forEach((dt, i) => blipTone(ctx, out, t + dt, i < 2 ? 880 : 1760, i < 2 ? 0.09 : 0.3, 0.1, 'sine')); },
  /** クラクション（2 つの音を重ねた、少し割れた音）。 */
  honk(ctx, out, t, p = {}) {
    const k = fin(p.pitch, 0.9 + Math.random() * 0.25);
    const dur = 0.18 + Math.random() * 0.22;
    for (const f of [392 * k, 494 * k]) {
      const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.05);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 2200, 1.2)), out, { rev: 0.15 });
      adsr(g.gain, t, 0.07, 0.01, dur, 0.05);
    }
  },
  /** タイヤのきしみ。 */
  screech(ctx, out, t) {
    const n = noise(ctx, t, t + 0.7);
    const bp = filter(ctx, 'bandpass', 2600, 9);
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.linearRampToValueAtTime(2200, t + 0.6);
    const g = route(ctx, n.connect(bp), out, { rev: 0.2 });
    adsr(g.gain, t, 0.55, 0.02, 0.45, 0.2);
  },
  /** ぶつかった音（金属の鈍い音）。 */
  crash(ctx, out, t) {
    SFX.explode(ctx, out, t, { dur: 0.5 });
    for (let i = 0; i < 5; i++) blipTone(ctx, out, t + 0.03 + i * 0.04, 600 + i * 330, 0.12, 0.08, 'square', 3000);
  },
  /** 救急車（ピーポー）。くり返し鳴らす（1.3 秒ごと）。 */
  siren(ctx, out, t) {
    for (const [dt, f] of [[0, 960], [0.65, 770]]) {
      const o = osc(ctx, 'square', f, t + dt, t + dt + 0.66);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 2600, 0.8)), out, { rev: 0.25 });
      g.gain.setValueAtTime(FLOOR, t + dt);
      g.gain.linearRampToValueAtTime(0.09, t + dt + 0.02);
      g.gain.setValueAtTime(0.09, t + dt + 0.6);
      g.gain.linearRampToValueAtTime(FLOOR, t + dt + 0.65);
    }
  },
  /** 消防車（ウー）。 */
  sirenFire(ctx, out, t) {
    const o = osc(ctx, 'sawtooth', 420, t, t + 1.35);
    o.frequency.linearRampToValueAtTime(880, t + 0.6);
    o.frequency.linearRampToValueAtTime(420, t + 1.3);
    const g = route(ctx, o.connect(filter(ctx, 'lowpass', 1800, 0.8)), out, { rev: 0.25 });
    adsr(g.gain, t, 0.08, 0.05, 1.15, 0.1);
  },
  /** 歩行者の青の音「カッコー」。 */
  cuckoo(ctx, out, t) {
    for (const [dt, f, d] of [[0, 1050, 0.13], [0.2, 860, 0.32]]) {
      const o = osc(ctx, 'sine', f, t + dt, t + dt + d + 0.05);
      const g = route(ctx, o, out, { rev: 0.2 });
      adsr(g.gain, t + dt, 0.12, 0.012, d - 0.03, 0.04);
    }
  },
  /** 歩行者の青の音「ピヨピヨ」。 */
  piyo(ctx, out, t) {
    for (const dt of [0, 0.22]) {
      const o = osc(ctx, 'sine', 2300, t + dt, t + dt + 0.12);
      o.frequency.exponentialRampToValueAtTime(3100, t + dt + 0.05);
      o.frequency.exponentialRampToValueAtTime(2500, t + dt + 0.1);
      const g = route(ctx, o, out, { rev: 0.15 });
      adsr(g.gain, t + dt, 0.09, 0.006, 0.07, 0.03);
    }
  },
  /** 鳥（すずめのさえずり）。 */
  chirp(ctx, out, t, p = {}) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.09 + Math.random() * 0.05);
      const f0 = 3800 + Math.random() * 1500;
      const o = osc(ctx, 'sine', f0, tt, tt + 0.08);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.7, tt + 0.06);
      const g = route(ctx, o, out, { pan: fin(p.pan, 0), rev: 0.3 });
      perc(g.gain, tt, 0.035, 0.004, 0.06);
    }
  },
  /** 花火（どーん）。 */
  boom(ctx, out, t, p = {}) {
    INSTRUMENTS.kick(ctx, out, t, { vel: 0.8 });
    const n = noise(ctx, t, t + 1.4);
    const lp = filter(ctx, 'lowpass', 900, 0.6);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.2);
    const g = route(ctx, n.connect(lp), out, { rev: 0.5, ...p });
    perc(g.gain, t, 0.45, 0.005, 1.2);
    for (let i = 0; i < 14; i++) { // ぱちぱち
      const tt = t + 0.25 + Math.random() * 0.9;
      const c = noise(ctx, tt, tt + 0.03);
      const g2 = route(ctx, c.connect(filter(ctx, 'highpass', 3000)), out, { rev: 0.4 });
      perc(g2.gain, tt, 0.05, 0.001, 0.02);
    }
  },
};

/** 短い電子音。lp を渡すとローパスを通す。 */
function blipTone(ctx, out, t, f, dur, vol, type = 'sine', lp = 0) {
  const o = osc(ctx, type, f, t, t + dur + 0.05);
  const src = lp ? o.connect(filter(ctx, 'lowpass', lp)) : o;
  const g = route(ctx, src, out, {});
  adsr(g.gain, t, vol, 0.004, Math.max(0, dur - 0.02), 0.03);
}

/** ノイズを帯域フィルターで滑らせる（さっと動く音）。 */
function sweep(ctx, out, t, f0, f1, dur, vol) {
  const n = noise(ctx, t, t + dur + 0.05);
  const bp = filter(ctx, 'bandpass', f0, 4);
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = route(ctx, n.connect(bp), out, {});
  adsr(g.gain, t, vol, 0.02, dur - 0.05, 0.05);
}
