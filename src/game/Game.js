// ゲーム本体：状態（タイトル・日のはじめ・プレイ・判断・報告・強化・停止・結末）と、5 日間のキャンペーン。
// 交通そのものは sim/、見た目は view/、1 日の進行は Director、画面の部品は ui/。
//   step(dt)：入力 → 状態ごとの処理 → シミュレーション → 見た目の同期 → 音（描画はしない）
//   render(dt)：描く
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { events } from '../core/events.js';
import { createStore } from '../core/save.js';
import { t, applyDom, getLang } from '../core/i18n.js';
import { settings } from '../core/settings.js';
import { World } from './World.js';
import { Sky } from './view/Sky.js';
import { CameraRig } from './view/CameraRig.js';
import { Overlay3D } from './view/Overlay3D.js';
import { Fireworks } from './view/Fireworks.js';
import { Rain } from './view/Rain.js';
import { Controls } from './Controls.js';
import { Director } from './Director.js';
import { DAYS } from './campaign/days.js';
import { DILEMMAS } from './campaign/dilemmas.js';
import { UPGRADES } from './campaign/upgrades.js';
import { chooseEnding } from './campaign/endings.js';
import { ICON } from './view/textures.js';
import { AXIS } from './sim/geom.js';

// 状態の表。title：タイトルを出す ／ hud：ゲーム中の表示 ／ input：'play' | 'actions' | 'menu' ／ music：曲 ／ modal：開く画面 ／ duck：曲を下げる
export const STATES = {
  title: { title: true, input: 'menu', music: 'title' },
  days: { title: true, input: 'menu', modal: 'days', music: 'title' },
  confirm: { title: true, input: 'menu', modal: 'confirm', music: 'title' },
  brief: { input: 'menu', modal: 'brief', music: 'brief' },
  play: { hud: true, input: 'play', music: 'play' },
  dilemma: { hud: true, input: 'menu', modal: 'dilemma', music: 'dilemma' },
  paused: { hud: true, input: 'menu', modal: 'pause', duck: true },
  report: { input: 'menu', modal: 'report', music: 'result' },
  shop: { input: 'menu', modal: 'shop', music: 'result' },
  fail: { hud: true, input: 'menu', modal: 'fail', music: 'fail' },
  ending: { input: 'menu', modal: 'ending', music: 'ending' },
};

const FAST = 2.6, SLOW = 0.3;
const TRAIT_KEYS = ['compassion', 'fairness', 'honesty', 'efficiency'];

function newCampaign() {
  return { day: 1, maxDay: 1, traits: { compassion: 0, fairness: 0, honesty: 0, efficiency: 0 }, trust: 50, budget: 100, flags: {}, upgrades: [], decisions: [], results: {}, snaps: {}, ranks: {} };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Game {
  constructor({ renderer, input, audio, screens, touch, hud }) {
    Object.assign(this, { renderer, input, audio, screens, touch, hud });
    this.store = createStore('signal-dilemma.save', { camp: null, best: {}, ending: null }, 1);
    this.time = 0;
    this.state = 'title';
    const scene = (this.scene = new THREE.Scene());
    // near を 1 m より大きくして奥行きの精度を上げる（遠くから見下ろすタイトルで、重なった板がちらつかないように）
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 3, 5000);
    this.sky = new Sky(scene, renderer);
    this.rig = new CameraRig(this.camera);
    this.rain = new Rain(scene);
    this.fireworks = new Fireworks(scene);
    renderer.onQuality = (p) => { const s = this.sky.sun; s.shadow.mapSize.set(p.shadowSize, p.shadowSize); s.shadow.map?.dispose(); s.shadow.map = null; };
    renderer.onQuality(renderer.preset);
    renderer.setScene(scene, this.camera);
    renderer.setLook({ exposure: 1.0, bloomStrength: 0.5, bloomRadius: 0.55, bloomThreshold: 0.9, vignette: 0.22, saturation: 1.08, contrast: 1.04 });
    renderer.onResize = () => { if (this.world) this._frame(true); };
    this.hours = 17.5;
    this.weather = 0;
    this.speed = 1;
    this.fast = false;
    this.slowHeld = false;
    this.gauge = 1;
    this.sel = null;
    this.hover = null;
    this.alertCar = null;
    this.glitch = 0;
    this.controls = new Controls(renderer.domElement, {
      camera: this.camera, rig: this.rig, getWorld: () => this.world,
      enabled: () => this.state === 'play' || this.state === 'title',
      onTap: (X) => { if (this.state === 'play' && X) this.tapNode(X); },
      onHover: (X) => { this.hover = this.state === 'play' ? X : null; },
    });
    this._v = new THREE.Vector3();
    this._buildModals();
    hud.onButton = (name, el, down) => this.hudButton(name, el, down);
    this.fireworks.onBurst = (x, y, z) => this.audio.sfx('boom', { pos: { x, y, z }, refDistance: 90, minGap: 0.1 });
    // 別のタブやアプリに移ったら一時停止（戻ったときに渋滞だけが進んでいない、とはならないように）
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.bot) this.setState('paused'); });
  }

  // ---------------------------------------------------------------- 起動
  async init() {
    await document.fonts?.ready;
    this.loadTitleWorld();
    this.setState('title');
  }

  afterUi() { this._refreshContinue(); }

  get camp() { return this.store.data.camp; }

  _refreshContinue() {
    const c = this.camp;
    const on = !!c && c.day <= 5 && !c.finished;
    this.screens.setContinue(on, on ? t('title.continue', { day: t('wd.' + DAYS[c.day - 1].wd) }) : '');
    if (c?.finished) this.screens.setContinue(false);
    const days = this.screens.title.querySelector('.days');
    days?.classList.toggle('hidden', !c);
  }

  /** タイトルの後ろで動いている街（金曜の街の夕方。信号は自動）。 */
  loadTitleWorld() {
    this.director = null;
    this.setWorld('d5', { seed: 3, modes: Object.fromEntries(['X0_0', 'X1_0', 'X2_0', 'X0_1', 'X1_1', 'X2_1', 'X0_2', 'X1_2', 'X2_2'].map((k) => [k, 'auto'])) });
    for (const X of this.world.net.inter) X.signal.sensor = true;
    const gen = {};
    for (const T of this.world.net.terms) gen[T.id] = 1.5;
    this.world.sim.setDemand({ gen, attract: {}, mix: { sedan: 0.42, kei: 0.24, van: 0.1, taxi: 0.1, truck: 0.08, bus: 0.06 }, pedAll: 2.4, kids: 0.05 });
    for (let i = 0; i < 60 * 50; i++) this.world.sim.step(1 / 60);
    this.world.sim.out.length = 0;
    this.hours = 17.7;
    this.weather = 0;
    this.rig.goal.dist = this.rig.fitDist * 0.8;
    this.rig.goal.pitch = 0.82;
    Object.assign(this.rig.cur, this.rig.goal);
  }

  setWorld(mapId, opts) {
    this.world?.dispose();
    this.overlay?.group.removeFromParent();
    this.world = new World(this.scene, mapId, opts);
    this.overlay = new Overlay3D(this.world.root, this.world.net);
    this.rig.setBounds(this.world.net.bounds);
    this.sky.fitShadow(this.world.net.bounds);
    this.rain.fit(this.world.net.bounds);
    this.fireworks.fit(this.world.net.bounds, -0.55);
    this.sel = null;
    this._frame(true);
    this.barriers = [];
  }

  /** 交差点のまわり（道の待ち列が見える範囲）が画面に収まるように寄る。タイトルは台座全体。 */
  _frame(instant) {
    const W = this.world;
    if (!W) return;
    const inter = W.net.inter;
    const n = inter.length;
    let bounds = null;
    if (this.director) {
      const M = n === 1 ? 34 : 30;
      const xs = inter.map((X) => X.pos.x), zs = inter.map((X) => X.pos.z);
      bounds = { x0: Math.min(...xs) - M, x1: Math.max(...xs) + M, z0: Math.min(...zs) - M, z1: Math.max(...zs) + M };
    }
    // 縦長の画面は横の視野が狭いので、視野角を広げ、斜めの度合いを弱める（そうしないとカメラが遠くなりすぎる）
    const portrait = innerWidth < innerHeight * 0.9;
    const fov = portrait ? 46 : 30;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const yaw = portrait ? -0.32 : -0.55;
    this.rig.frame({ instant, bounds, pitch: this.director ? 1.04 : 0.86, yaw, margin: portrait ? 0.97 : 0.88 });
  }

  // ---------------------------------------------------------------- 状態
  setState(s) {
    const S = STATES[s];
    if (!S) throw new Error('状態がありません: ' + s);
    const prev = this.state;
    this.state = s;
    this.screens.showTitle(!!S.title);
    this.hud.show(!!S.hud);
    this.touch.setVisible(!!S.hud);
    this.input.mode = S.input || 'menu';
    if (!S.modal) this.screens.closeAll();
    else {
      // 前の状態の画面（一時停止など）を閉じてから開く
      while (this.screens.top && this.screens.top !== this.screens.modals[S.modal] && !(s === 'paused' && this.screens.top === this.screens.modals.settings)) this.screens.back();
      if (!this.screens.isOpen(S.modal)) this.screens.open(S.modal);
    }
    if (S.music) this.audio.music(S.music);
    this.audio.duck(!!S.duck);
    this[`enter_${s}`]?.(prev);
    if (prev !== s) events.emit('state', { from: prev, to: s });
  }

  enter_title() {
    this.hud.clearMsgs();
    this._refreshContinue();
    this.fast = false;
    this.overlay?.setSelected(null);
    this.audio.setAmbience({ city: 0.6 });
  }

  enter_paused() { this.audio.sfx('pause'); }

  toTitle() {
    this.director = null;
    this.loadTitleWorld();
    this.setState('title');
  }

  // ---------------------------------------------------------------- キャンペーン
  newGame() {
    if (this.camp && !this.camp.finished && (this.camp.day > 1 || this.camp.decisions.length)) { this.setState('confirm'); return; }
    this._startNew();
  }

  _startNew() {
    this.store.data.camp = newCampaign();
    this.store.save();
    this.startDay(1);
  }

  /** つづきから：その日のはじめの状態から（途中で選んだ判断が二重に数えられないように）。 */
  continueGame() {
    if (!this.camp) return this._startNew();
    if (this.camp.snaps?.[this.camp.day]) this.retryDay();
    else this.startDay(this.camp.day);
  }

  /** 日 n をはじめる（その日のはじめの状態を残しておき、やりなおせるようにする）。 */
  startDay(n, { brief = true } = {}) {
    const camp = this.camp;
    camp.day = n;
    camp.maxDay = Math.max(camp.maxDay || 1, n);
    const { snaps, ...rest } = camp;
    camp.snaps = snaps || {};
    camp.snaps[n] = clone(rest);
    this.store.save();
    const day = DAYS[n - 1];
    const modes = { ...day.init.mode };
    const phases = { ...day.init.phase };
    this.setWorld(day.map, { seed: 1000 + n * 17, modes, phases });
    camp.difficulty = settings.difficulty === 'easy' ? 0.78 : 1;
    this.director = new Director(this.world, day, camp, this._ui());
    this._frame(true);
    this.hours = day.start;
    this.weather = day.rain || 0;
    this.fireworks.set(false);
    this.glitch = 0;
    this.renderer.setLook({ ...this.renderer.look, ca: 0 });
    this.gauge = 1;
    this.fast = false;
    this.alertCar = null;
    this.hud.clearMsgs();
    this.tutMsg = null;
    // 少しだけ進めて、車がいる状態から
    this.world.sim.setDemand(this.world.sim.demand);
    for (let i = 0; i < 60 * 6; i++) { this.world.sim.step(1 / 60); }
    this.world.sim.out.length = 0;
    this.selectNode(this.world.net.inter.find((X) => X.signal.mode === 'manual') || this.world.net.inter[0], false);
    if (brief) this._openBrief(n);
    else this.setState('play');
  }

  retryDay() {
    const n = this.camp?.day || 1;
    const snap = this.camp?.snaps?.[n];
    if (snap) { const snaps = this.camp.snaps; this.store.data.camp = { ...clone(snap), snaps }; }
    this.startDay(n);
  }

  /** 日を選んでやりなおす（その日のはじめの状態に戻す。あとの日の記録は消える）。 */
  replayDay(n) {
    const snap = this.camp?.snaps?.[n];
    if (!snap) return;
    const snaps = {};
    for (const k of Object.keys(this.camp.snaps)) if (+k <= n) snaps[k] = this.camp.snaps[k];
    this.store.data.camp = { ...clone(snap), snaps, maxDay: n };
    this.startDay(n);
  }

  // ---------------------------------------------------------------- Director から頼まれること
  _ui() {
    const self = this;
    return {
      t: (k, v) => t(k, v),
      say: (who, key, vars) => { self.hud.say(who, t(key, vars)); self.audio.sfx(who === 'sys' ? 'blip' : 'msg'); },
      tut: (id, X) => self._tut(id, X),
      tutDone: (id) => self._tutDone(id),
      alert: (kind, car) => self._alert(kind, car),
      dilemma: (id) => self.openDilemma(id),
      endDay: (sum) => self.endDay(sum),
      fail: () => self.failDay(),
      icon: (cell, o) => self.overlay.icon(cell, o),
      sfx: (name, car) => self.audio.sfx(name, car ? { pos: self._v.set(car.x, 1, car.z).clone() } : {}),
      shake: () => { self.rig.shake = 1; },
      glitch: (on) => { self.glitch = on ? 1 : 0; },
      closure: (id, on) => self._barrier(id, on),
      fireworks: (on) => self.fireworks.set(on),
      nodeName: (X) => self.nodeName(X),
    };
  }

  nodeName(X) {
    if (!X) return '';
    const key = X.name || 'int.honcho';
    return t(key) + t('int.suffix');
  }

  _tut(id, X) {
    this.tutMsg?.remove();
    this.tutMsg = this.hud.say('yui', t('tut.' + id), { pin: true });
    this.audio.sfx('msg');
    this.overlay.setPulse(X);
    if (X && id !== 'walk') this.selectNode(X, false);
  }

  _tutDone(id) {
    this.tutMsg?.remove();
    this.tutMsg = null;
    this.overlay.setPulse(null);
    const done = 'tut.' + id + '.done';
    if (t(done) !== done) this.hud.say('yui', t(done));
  }

  _alert(kind, car) {
    if (car) this.alertCar = car;
    this.alertKind = kind;
    this.audio.sfx('alert');
    if (kind === 'ev' && this.director?.evTut) {
      this.director.evTut = false;
      this.hud.say('yui', t('tut.ev'));
    }
  }

  // ---------------------------------------------------------------- 画面（モーダル）
  _buildModals() {
    const S = this.screens;
    S.addModal('brief', `<section id="m-brief" class="modal hidden"><div class="card" data-scroll>
      <div class="daynum"></div><div class="dayname"></div><p class="bt"></p>
      <div class="goal"><b data-i18n="brief.goal">${t('brief.goal')}</b><span class="gt"></span></div>
      <button data-act="begin" data-i18n="brief.start">${t('brief.start')}</button></div></section>`);
    S.addModal('dilemma', `<section id="m-dilemma" class="modal hidden"><div class="card" data-scroll>
      <div class="dh" data-i18n="dl.title">${t('dl.title')}</div>
      <div class="from"><span class="av"></span><span class="nm"></span><span class="pv"></span></div>
      <p class="body"></p><div class="choices"></div></div></section>`);
    S.addModal('report', `<section id="m-report" class="modal hidden"><div class="card" data-scroll></div></section>`);
    S.addModal('shop', `<section id="m-shop" class="modal hidden"><div class="card" data-scroll></div></section>`);
    S.addModal('fail', `<section id="m-fail" class="modal hidden"><div class="card">
      <div class="failtitle" data-i18n="fail.title">${t('fail.title')}</div><p data-i18n="fail.body">${t('fail.body')}</p>
      <button data-act="retry" data-i18n="fail.retry">${t('fail.retry')}</button>
      <button data-act="toTitle" data-i18n="fail.toTitle">${t('fail.toTitle')}</button></div></section>`);
    S.addModal('ending', `<section id="m-ending" class="modal hidden"><div class="card" data-scroll></div></section>`);
    S.addModal('days', `<section id="m-days" class="modal hidden"><div class="card" data-scroll></div></section>`);
    S.addModal('confirm', `<section id="m-confirm" class="modal hidden"><div class="card">
      <p data-i18n="title.newConfirm">${t('title.newConfirm')}</p>
      <button data-act="newYes" data-i18n="title.yes">${t('title.yes')}</button>
      <button data-act="back" data-i18n="title.no">${t('title.no')}</button></div></section>`);
    // 判断のカードと、もどる（Esc / B）で閉じてはいけない画面は、もどるで閉じない
  }

  _openBrief(n) {
    const day = DAYS[n - 1];
    const m = this.screens.modals.brief;
    m.querySelector('.daynum').textContent = `DAY ${n} · ${t('wds.' + day.wd)}`;
    m.querySelector('.dayname').textContent = `${t('wd.' + day.wd)}「${t('day.' + n)}」`;
    if (getLang() === 'en') m.querySelector('.dayname').textContent = `${t('wd.' + day.wd)} — ${t('day.' + n)}`;
    m.querySelector('.bt').textContent = t('brief.' + n);
    m.querySelector('.gt').textContent = t(`brief.${n}.goal`);
    this.setState('brief');
  }

  openDilemma(id) {
    const D = DILEMMAS[id];
    const m = this.screens.modals.dilemma;
    m.classList.toggle('glitch', !!D.glitch);
    m.querySelector('.av').textContent = D.who === 'unknown' ? '?' : t('who.' + D.who).slice(0, 1);
    m.querySelector('.nm').textContent = t('who.' + D.who);
    m.querySelector('.pv').textContent = D.private ? t('dl.private') : '';
    m.querySelector('.body').textContent = t(`dl.${id}.body`);
    const box = m.querySelector('.choices');
    box.innerHTML = '';
    D.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.dataset.act = 'choose';
      b.dataset.id = id;
      b.dataset.choice = c.id;
      b.dataset.k = 'ABC'[i];
      b.textContent = t(`dl.${id}.${c.id}`);
      box.append(b);
    });
    this.dilemmaId = id;
    this.setState('dilemma');
    this.audio.sfx(D.glitch ? 'glitch' : 'dilemma');
  }

  endDay(sum) {
    const camp = this.camp;
    const inc = { S: 200, A: 160, B: 120, C: 80, D: 40 }[sum.rank] + (camp.flags.deal ? 80 : 0);
    camp.budget += inc;
    camp.trust = clamp(camp.trust + { S: 6, A: 3, B: 0, C: -3, D: -6 }[sum.rank], 0, 100);
    camp.results[sum.day] = sum;
    camp.ranks[sum.day] = sum.rank;
    const best = this.store.data.best;
    const order = 'DCBAS';
    if (!best[sum.day] || order.indexOf(sum.rank) > order.indexOf(best[sum.day])) best[sum.day] = sum.rank;
    camp.day = Math.min(6, sum.day + 1);
    camp.maxDay = Math.max(camp.maxDay, Math.min(5, camp.day));
    this.store.save();
    this._report(sum, inc);
    this.setState('report');
    this.audio.sfx(sum.rank === 'S' || sum.rank === 'A' ? 'fanfare' : 'dayend');
  }

  _report(sum, inc) {
    const camp = this.camp;
    const card = this.screens.modals.report.querySelector('.card');
    const day = DAYS[sum.day - 1];
    const dec = sum.decisions.length ? sum.decisions.map((d) => {
      const tr = Object.entries(d.traits).filter(([, v]) => v).map(([k, v]) => `${t('trait.' + k)}${v > 0 ? '+' : ''}${v}`).join(' ');
      return `<li>${esc(t(`dl.${d.id}.${d.choice}`))}<span class="tr">${esc(tr)}</span></li>`;
    }).join('') : `<li>${t('rep.none')}</li>`;
    const last = sum.day >= 5;
    card.innerHTML = `
      <div class="daynum">DAY ${sum.day} · ${t('wds.' + day.wd)}</div>
      <h2>${t('rep.title')}</h2>
      <div class="rank" data-r="${sum.rank}"><span>${t('rep.rank')}</span><b>${sum.rank}</b></div>
      <dl class="stats">
        <dt>${t('rep.avgSat')}</dt><dd>${sum.avgSat}</dd>
        <dt>${t('rep.served')}</dt><dd>${sum.served}</dd>
        <dt>${t('rep.delay')}</dt><dd>${t('rep.sec', { n: sum.avgDelay.toFixed(1) })}</dd>
        <dt>${t('rep.peds')}</dt><dd>${sum.pedServed}</dd>
        <dt>${t('rep.ev')}</dt><dd>${sum.evOnTime} / ${sum.evTotal}</dd>
        <dt>${t('rep.nearMiss')}</dt><dd>${sum.nearMiss}</dd>
        <dt>${t('rep.jaywalk')}</dt><dd>${sum.jaywalk}</dd>
      </dl>
      <b class="note">${t('rep.decisions')}</b><ul class="decs">${dec}</ul>
      <div class="money"><span>${t('rep.budget')} ${t('rep.man', { n: camp.budget })}（${t('rep.income', { n: inc })}）</span><span>${t('rep.trust')} ${Math.round(camp.trust)}</span></div>
      ${last ? `<button data-act="final">${t('rep.final')}</button>` : `<button data-act="nextDay">${t('rep.next')}</button><button data-act="shop">${t('rep.shop')}</button>`}
      <button data-act="replayLast">${t('rep.retry')}</button>`;
  }

  _shop() {
    const camp = this.camp;
    const card = this.screens.modals.shop.querySelector('.card');
    card.innerHTML = `<h2>${t('shop.title')}</h2><div class="money"><span>${t('shop.budget', { n: camp.budget })}</span></div>
      <div class="ups">${UPGRADES.map((u) => {
        const owned = camp.upgrades.includes(u.id);
        return `<div class="up ${owned ? 'owned' : ''}"><b>${t('up.' + u.id)}</b><span class="d">${t('up.' + u.id + '.d')}</span>
        ${owned ? `<button disabled>${t('shop.owned')}</button>` : `<button data-act="buy" data-id="${u.id}" ${camp.budget < u.cost ? 'disabled' : ''}>${t('shop.buy', { n: u.cost })}</button>`}</div>`;
      }).join('')}</div>
      <button data-act="nextDay">${t('shop.done')}</button>`;
  }

  _ending() {
    const camp = this.camp;
    const ranks = Object.values(camp.ranks || {});
    const rv = { S: 4, A: 3, B: 2, C: 1, D: 0 };
    const avgRank = ranks.length ? ranks.reduce((a, r) => a + rv[r], 0) / ranks.length : 2;
    const id = chooseEnding({ flags: camp.flags, traits: camp.traits, trust: camp.trust, avgRank });
    camp.finished = true;
    camp.ending = id;
    this.store.data.ending = id;
    this.store.save();
    const card = this.screens.modals.ending.querySelector('.card');
    const max = Math.max(4, ...TRAIT_KEYS.map((k) => Math.abs(camp.traits[k] || 0)));
    const audit = !camp.flags.tampered && camp.decisions.some((d) => d.id === 'logs') ? `<p class="note">${t('end.audit.ok')}</p>` : '';
    card.innerHTML = `<div class="daynum">${t('end.head')}</div>
      <div class="endtitle">${t('end.' + id + '.title')}</div>
      <p class="endbody">${esc(t('end.' + id + '.body'))}</p>${audit}
      <div class="traits">${TRAIT_KEYS.map((k) => {
        const v = camp.traits[k] || 0;
        const w = Math.abs(v) / max * 50;
        return `<span>${t('trait.' + k)}</span><span class="tb2"><i class="${v < 0 ? 'neg' : ''}" style="${v < 0 ? `left:${50 - w}%;width:${w}%` : `width:${w}%`}"></i></span><span class="tv">${v > 0 ? '+' : ''}${v}</span>`;
      }).join('')}</div>
      <button data-act="toTitle">${t('end.again')}</button>
      <button data-act="days">${t('end.days')}</button>`;
    this.setState('ending');
  }

  _days() {
    const camp = this.camp;
    const card = this.screens.modals.days.querySelector('.card');
    const best = this.store.data.best;
    card.innerHTML = `<h2>${t('days.title')}</h2><div class="daylist">${DAYS.map((d) => {
      const ok = camp && camp.snaps?.[d.n] && d.n <= (camp.maxDay || 1);
      return `<button data-act="pickDay" data-n="${d.n}" ${ok ? '' : 'disabled'}><span>${t('wds.' + d.wd)}　${t('day.' + d.n)}</span><span class="r">${ok ? (best[d.n] ? t('days.best', { rank: best[d.n] }) : '') : t('days.locked')}</span></button>`;
    }).join('')}</div><p class="note">${t('days.note')}</p><button data-act="back">${t('ui.back')}</button>`;
  }

  failDay() {
    this.setState('fail');
    this.audio.sfx('fail');
  }

  /** モーダルのボタン（Screens が知らない data-act）。 */
  onAction(act, el) {
    switch (act) {
      case 'begin': this.setState('play'); this.audio.sfx('start'); break;
      case 'choose': {
        const C = this.director?.choose(el.dataset.id, el.dataset.choice);
        if (C) this.store.save();
        this.setState('play');
        break;
      }
      case 'nextDay':
        if ((this.camp?.day || 6) <= 5) this.startDay(this.camp.day);
        break;
      case 'shop': this._shop(); this.setState('shop'); break;
      case 'buy': {
        const u = UPGRADES.find((x) => x.id === el.dataset.id);
        const camp = this.camp;
        if (u && camp.budget >= u.cost && !camp.upgrades.includes(u.id)) {
          camp.budget -= u.cost;
          camp.upgrades.push(u.id);
          this.store.save();
          this.audio.sfx('buy');
          this._shop();
          applyDom(this.screens.modals.shop);
        }
        break;
      }
      case 'replayLast': {
        const n = Math.max(1, (this.camp?.day || 2) - 1);
        this.replayDay(n);
        break;
      }
      case 'final': this._ending(); break;
      case 'days':
        if (this.state === 'ending') this.toTitle();
        this._days();
        this.setState('days');
        break;
      case 'pickDay': this.replayDay(+el.dataset.n); break;
      case 'newYes': this._startNew(); break;
      case 'retry': this.retryDay(); break;
      case 'toTitle': this.toTitle(); break;
    }
  }

  /** 画面が閉じられたとき（「もどる」ボタンなど）。その画面だけの状態なら、元の状態へ。 */
  onModal(name, open) {
    if (open) return;
    if ((name === 'days' || name === 'confirm') && STATES[this.state]?.modal === name) this.setState('title');
  }

  onSettings(what) {
    if (what === 'lang') this._refreshContinue();
  }

  // ---------------------------------------------------------------- 交差点の操作
  selectNode(X, sound = true) {
    if (!X) return;
    if (this.sel !== X && sound) this.audio.sfx('select');
    this.sel = X;
    this.overlay?.setSelected(X);
  }

  tapNode(X) {
    this.selectNode(X, false);
    this.doToggle(X);
  }

  doToggle(X) {
    const sig = X.signal;
    if (sig.mode === 'auto') { sig.mode = 'manual'; this.director?.onAction('auto', X); }
    if (sig.toggle('player')) { this.audio.sfx('switch'); this.director?.onAction('toggle', X); }
    else this.audio.sfx('deny');
  }

  doWalk(X) {
    const sig = X.signal;
    if (sig.mode === 'auto') sig.mode = 'manual';
    if (sig.walk('player')) { this.audio.sfx('walkReq'); this.director?.onAction('walk', X); }
    else this.audio.sfx('deny');
  }

  doAuto(X) {
    X.signal.mode = X.signal.mode === 'auto' ? 'manual' : 'auto';
    X.signal.greenT = 0;
    this.audio.sfx(X.signal.mode === 'auto' ? 'autoOn' : 'autoOff');
    this.director?.onAction('auto', X);
  }

  hudButton(name, el, down) {
    if (name === 'pause') { if (this.state === 'play') this.setState('paused'); return; }
    if (this.state !== 'play') return;
    const X = this.sel;
    if (name === 'slow') { this.slowHeld = down; return; }
    if (!down) return;
    if (name === 'toggle' && X) this.doToggle(X);
    else if (name === 'walk' && X) this.doWalk(X);
    else if (name === 'auto' && X) this.doAuto(X);
    else if (name === 'fast') { this.fast = !this.fast; this.audio.sfx(this.fast ? 'fastOn' : 'fastOff'); }
    else if (name === 'home') this._frame(false);
    else if (name === 'focus') this._focusAlert();
    else if (name === 'walkAt' || name === 'autoAt') {
      const N = this.world.net.nodes.get(el.dataset.node);
      if (!N) return;
      this.selectNode(N, false);
      if (name === 'walkAt') this.doWalk(N);
      else this.doAuto(N);
    }
  }

  _focusAlert() {
    const c = this.alertCar;
    if (c && !c.gone) this.rig.focus(c.x, c.z, this.rig.fitDist * 0.55);
  }

  /** 画面の向きで、いま選んでいる交差点から dir の方にある交差点を選ぶ。 */
  _selectDir(dx, dy) {
    const list = this.world.net.inter;
    const from = this.sel || list[0];
    const p0 = this._screen(from.pos.x, 0, from.pos.z);
    let best = null, bs = Infinity;
    for (const X of list) {
      if (X === from) continue;
      const p = this._screen(X.pos.x, 0, X.pos.z);
      const vx = p.x - p0.x, vy = p.y - p0.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const side = Math.abs(vx * dy - vy * dx);
      const score = along + side * 2.2;
      if (score < bs) { bs = score; best = X; }
    }
    if (best) this.selectNode(best);
    this.director?.onAction('select', best);
  }

  _screen(x, y, z) {
    this._v.set(x, y, z).project(this.camera);
    return { x: (this._v.x + 1) / 2 * innerWidth, y: (1 - this._v.y) / 2 * innerHeight, behind: this._v.z > 1 };
  }

  /** 交差点の番号（左上から右へ、上から下へ）。数字キーで選ぶため。 */
  _ordered() {
    return [...this.world.net.inter].sort((a, b) => (a.j - b.j) || (a.i - b.i));
  }

  /**
   * 確認用の自動プレイ（__dev.game.bot = 'smart' | 'idle'）。smart：待っている側が多ければ切り替え、歩行者もさばく。
   * 判断は __dev.game.botChoice（'a' など）で選び、日のはじめ・報告も自動で進める。
   */
  _bot(dt) {
    const mode = this.bot;
    if (this.state === 'brief') { this.onAction('begin'); return; }
    if (this.state === 'dilemma') { this._botWait = (this._botWait || 0) + dt; if (this._botWait > 0.5) { this._botWait = 0; this.onAction('choose', { dataset: { id: this.dilemmaId, choice: this.botChoice || 'a' } }); } return; }
    if ((this.state === 'report' || this.state === 'shop') && this.botStopAtReport) return;
    if (this.state === 'report' || this.state === 'shop') { this.botReports = [...(this.botReports || []), this.camp.results[this.camp.day - 1]]; if (this.camp.day <= 5) this.startDay(this.camp.day); else this._ending(); return; }
    if (this.state === 'fail') {
      const D = this.director;
      this.botFails = [...(this.botFails || []), { day: D.day.n, clock: +D.clock.toFixed(2), served: this.world.sim.stats.served }];
      this.camp.day = D.day.n + 1;
      if (this.camp.day <= 5) this.startDay(this.camp.day); else this.setState('title');
      return;
    }
    if (this.state !== 'play' || mode === 'idle') return;
    const D = this.director;
    if (D?.gate) { if (D.gate.id === 'walk') this.doWalk(this.world.net.nodes.get(D.gate.node)); else this.doToggle(this.world.net.nodes.get(D.gate.node)); }
    const sim = this.world.sim;
    for (const X of this.world.net.inter) {
      const s = X.signal;
      if (s.mode === 'auto' && mode !== 'manualAll') continue;
      if (s.stage !== 'G' || s.phase === 'WALK') continue;
      const cur = s.phase, other = cur === 'NS' ? 'EW' : 'NS';
      const a = sim.axisDemand(X, cur), b = sim.axisDemand(X, other);
      const peds = sim.pedWaiting(X);
      // 救急車が来ている向きは青にする
      let evAxis = null;
      for (const c of sim.cars) if (c.em && c.siren && c.seg.kind === 'lane' && c.seg.to === X && c.seg.len - c.s < 60) evAxis = AXIS[c.seg.heading];
      if (evAxis) { if (evAxis !== cur) s.toggle('bot'); continue; }
      if (s.greenT > 5 && (peds.count >= 5 || peds.maxWait > 30)) { s.walk('bot'); continue; }
      if (s.greenT > 4 && b.count > 0 && (!a.approaching || s.greenT > 14) && b.count + b.wait * 0.1 > a.count * 0.6) s.toggle('bot');
    }
  }

  // ---------------------------------------------------------------- 毎フレーム
  step(dt) {
    const input = this.input;
    input.update(dt);
    this.time += dt;
    if (this.bot) this._bot(dt);
    this[`update_${this.state}`]?.(dt);
    // シミュレーション（プレイ中とタイトルだけ動かす）
    let simDt = 0;
    if (this.state === 'play') {
      const slow = this.slowHeld && this.gauge > 0.01;
      this.speed = slow ? SLOW : this.fast ? FAST : 1;
      const cap = this.camp?.upgrades.includes('core') ? 1.6 : 1;
      if (slow) this.gauge = Math.max(0, this.gauge - dt / (7 * cap));
      else this.gauge = Math.min(1, this.gauge + dt / (24 / cap));
      simDt = dt * this.speed;
    } else if (this.state === 'title' || this.state === 'days' || this.state === 'confirm') {
      simDt = dt;
      this.hours = 17.7;
    }
    if (simDt > 0) {
      this.world.step(simDt, (e) => this.director?.onSim(e));
      if (this.director && this.state === 'play') {
        this.director.step(simDt);
        this.hours = this.director.clock;
      }
    }
    // 見た目
    this.sky.camDist = this.rig.cur.dist;
    const night = this.sky.set(this.hours, this.weather);
    const fx = this.fireworks.active ? this.fireworks.flash : 0;
    this.renderer.setLook({ ...this.renderer.look, exposure: this.sky.exposure + fx * 0.15, bloomStrength: 0.42 + night * 0.55 + fx * 0.3, ca: this.glitch ? 0.6 + Math.sin(this.time * 9) * 0.3 : (this.speed === SLOW ? 0.35 : 0), saturation: this.speed === SLOW ? 0.75 : 1.08 });
    this.world.city.setNight(night, this.weather);
    this.world.sync(dt, night, this.weather);
    this.overlay.visible = this.state !== 'title';
    this.overlay.update(dt, this.world.sim, this.rig.cur.dist);
    this.rain.update(dt, this.weather, this.camera);
    this.fireworks.update(dt);
    this.rig.update(dt);
    if (this.state === 'play' || this.state === 'paused' || this.state === 'dilemma' || this.state === 'fail') this._hud(dt);
    this._sound(dt);
    this.audio.listen(this.camera);
    this.audio.tick(dt);
    input.endFrame();
  }

  update_title(dt) {
    if (this.input.menu.back && this.screens.back()) this.audio.sfx('ui_back');
    this.rig.rotate(dt * 0.035);
  }

  update_days() { if (this.input.menu.back) { this.screens.back(); this.setState('title'); } }
  update_confirm() { if (this.input.menu.back) { this.screens.back(); this.setState('title'); } }

  update_paused() {
    const input = this.input;
    if (input.menu.back || input.menu.start || input.pressed('pause')) {
      if (this.screens.top !== this.screens.modals.pause) { this.screens.back(); this.audio.sfx('ui_back'); }
      else this.setState('play');
    }
  }

  update_play(dt) {
    const input = this.input;
    if (input.pressed('pause') || input.menu.start) { this.setState('paused'); return; }
    const W = this.world;
    // 交差点を選ぶ・操作する
    if (input.sel.left) this._selectDir(-1, 0);
    if (input.sel.right) this._selectDir(1, 0);
    if (input.sel.up) this._selectDir(0, -1);
    if (input.sel.down) this._selectDir(0, 1);
    if (input.digit) {
      const X = this._ordered()[input.digit - 1];
      if (X) { this.selectNode(X, false); this.doToggle(X); }
    }
    const X = this.sel;
    if (X && input.pressed('toggle')) this.doToggle(X);
    if (X && input.pressed('walk')) this.doWalk(X);
    if (X && input.pressed('auto')) this.doAuto(X);
    if (input.pressed('fast')) { this.fast = !this.fast; this.audio.sfx(this.fast ? 'fastOn' : 'fastOff'); }
    if (input.pressed('focus')) this._focusAlert();
    if (input.pressed('home')) this._frame(false);
    const slowKey = input.down('slow');
    if (slowKey !== this._slowKey) { this._slowKey = slowKey; this.slowHeld = slowKey; }
    // カメラ（キーボード・パッド）
    const r = this.rig;
    const panSpeed = r.cur.dist * 0.9;
    if (input.move.x || input.move.y) r.pan(input.move.x * panSpeed * dt, input.move.y * panSpeed * dt);
    if (input.down('rotL')) r.rotate(dt * 1.2);
    if (input.down('rotR')) r.rotate(-dt * 1.2);
    if (input.down('zoomIn')) r.zoom(Math.exp(-dt * 1.2));
    if (input.down('zoomOut')) r.zoom(Math.exp(dt * 1.2));
    if (input.device === 'pad') {
      if (input.look.x) r.rotate(-input.look.x * 0.9);
      if (input.look.y) r.zoom(Math.exp(input.look.y * 1.4));
    }
    void W;
  }

  /** 判断のカード：数字キー（1〜3）でも選べる。 */
  update_dilemma() {
    const n = this.input.digit;
    if (n >= 1 && n <= 3) this.screens.modals.dilemma.querySelectorAll('.choices button')[n - 1]?.click();
  }
  update_brief() {}

  // ---------------------------------------------------------------- 表示の同期
  _hud(dt) {
    const D = this.director, H = this.hud, W = this.world;
    if (!D) return;
    const day = D.day;
    H.setClock(day.wd, D.clock, clamp((D.clock - day.start) / (day.end - day.start), 0, 1));
    H.setSat(D.sat, dt);
    H.setServed(W.sim.stats.served);
    H.tick(dt);
    const X = this.sel;
    if (X) {
      const sig = X.signal;
      const peds = W.sim.pedWaiting(X);
      H.setPanel(X, { name: this.nodeName(X), phase: sig.phase, busy: sig.busy || sig.stage === 'Y', auto: sig.mode === 'auto', peds: peds.count, showAuto: D.day.n >= 3 });
    } else H.setPanel(null);
    H.setTools({ fast: this.fast, slow: this.speed === SLOW, gauge: this.gauge });
    // 交差点の上の表示
    const multi = W.net.inter.length > 2 || D.day.n >= 3;
    const chips = W.net.inter.map((N) => {
      const p = this._screen(N.pos.x, 9, N.pos.z);
      const peds = W.sim.pedWaiting(N);
      const vis = !p.behind && p.x > -20 && p.x < innerWidth + 20 && p.y > 40 && p.y < innerHeight + 20 && (peds.count > 0 || multi);
      return { id: N.id, x: p.x, y: p.y, peds: peds.count, maxWait: peds.maxWait, auto: N.signal.mode === 'auto', sel: N === X, vis, showMode: multi };
    });
    H.setChips(chips);
    for (const c of chips) H.chipEls.get(c.id)?.querySelector('.md')?.classList.toggle('hidden', !c.showMode);
    // ゲートの、入れない車
    const gates = (W.city.gatePos || []).map((g) => {
      const T = W.net.nodes.get(g.id);
      const p = this._screen(g.x, g.y, g.z);
      return { id: g.id, x: p.x, y: p.y, n: T?.queue || 0, vis: (T?.queue || 0) > 0 && !p.behind };
    });
    H.setGates(gates);
    // 画面の外の、救急車などの方向
    const edge = [];
    const watch = [...D.specials.values()].filter((S) => !S.car.gone && (S.kind === 'ev' || S.kind === 'labor' || S.kind === 'suspect'));
    for (const S of watch) {
      const p = this._screen(S.car.x, 1, S.car.z);
      const m = 34;
      if (!p.behind && p.x > m && p.x < innerWidth - m && p.y > 80 && p.y < innerHeight - m) continue;
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let vx = p.x - cx, vy = p.y - cy;
      if (p.behind) { vx = -vx; vy = -vy; }
      const k = Math.min((innerWidth / 2 - m) / Math.max(1, Math.abs(vx)), (innerHeight / 2 - m - 40) / Math.max(1, Math.abs(vy)));
      edge.push({ id: S.car.id, x: cx + vx * k, y: cy + vy * k + 20, ang: Math.atan2(vy, vx), kind: S.kind });
    }
    H.setEdge(edge);
    // 知らせの帯
    const evs = watch.filter((S) => S.kind === 'ev');
    let alert = '';
    if (evs.length) { alert = t('alert.ev', { kind: t('car.' + evs[0].car.type) }); this.alertCar = evs[0].car; }
    else if (watch.some((S) => S.kind === 'suspect')) { const S = watch.find((s) => s.kind === 'suspect'); alert = t('alert.suspect'); this.alertCar = S.car; }
    else if (watch.some((S) => S.kind === 'labor')) { const S = watch.find((s) => s.kind === 'labor'); alert = t('alert.labor'); this.alertCar = S.car; }
    else if ([...D.specials.values()].some((S) => S.kind === 'vip' && !S.car.gone)) { const S = [...D.specials.values()].find((s) => s.kind === 'vip' && !s.car.gone); alert = t('alert.vip'); this.alertCar = S.car; }
    if (alert !== this._alertTxt) { this._alertTxt = alert; H.setAlert(alert); }
    // 選んでいる・指している交差点の輪
    this.overlay.setHover(this.hover && this.hover !== X ? this.hover : null);
    void ICON; void AXIS;
  }

  /** 環境音・サイレン・歩行者信号の音。 */
  _sound(dt) {
    const A = this.audio, W = this.world;
    if (!W) return;
    const moving = W.sim.cars.reduce((n, c) => n + (c.v > 2 ? 1 : 0), 0);
    const night = this.sky.night;
    if (this.state === 'play' || this.state === 'title' || this.state === 'days' || this.state === 'confirm') {
      A.setAmbience({ city: clamp(0.25 + moving / 40, 0, 1), rain: this.weather, night: night * 0.8, birds: (1 - night) * (this.weather ? 0 : 0.5) });
    }
    // 鳥（朝と昼、晴れのとき）
    this._chirpT = (this._chirpT ?? 2) - dt;
    if (this._chirpT <= 0) {
      this._chirpT = 1.5 + Math.random() * 4;
      if (night < 0.3 && !this.weather && (this.state === 'play' || this.state === 'title')) A.sfx('chirp', { pan: Math.random() * 2 - 1, bus: 'amb' });
    }
    // サイレン（いちばん近い 1 台）
    let ev = null;
    if (this.state === 'play') for (const c of W.sim.cars) if (c.em && c.siren) { ev = c; break; }
    if (ev) A.loop('siren', ev.type === 'fire' ? 'sirenFire' : 'siren', { period: 1.3, pos: { x: ev.x, y: 1.5, z: ev.z }, refDistance: 22, follow: ev });
    else A.stopLoop('siren');
    // 歩行者の青の音（選んでいる交差点）
    const X = this.sel || W.net.inter[0];
    const walking = this.state === 'play' && X.signal.ped() === 'G';
    if (walking !== this._walkSnd) {
      this._walkSnd = walking;
      if (walking) A.loop('ped', X.i % 2 === X.j % 2 ? 'cuckoo' : 'piyo', { period: 1.15, pos: { x: X.pos.x, y: 2, z: X.pos.z }, refDistance: 30 });
      else A.stopLoop('ped');
    }
    void dt;
  }

  _barrier(linkId, on) {
    // 通行止めの柵（赤白の板）を、道の両端に置く
    const L = this.world.net.links.find((l) => l.id === linkId);
    if (!L) return;
    if (!on) { for (const b of this.barriers) b.removeFromParent(); this.barriers = []; return; }
    const mk = (x, z, rot) => {
      const g = new THREE.Group();
      for (let i = -1; i <= 1; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.15), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xe8322e, emissive: 0x401010, roughness: 0.6 }));
        b.position.set(i * 2.2, 0.6, 0);
        g.add(b);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      this.world.root.add(g);
      this.barriers.push(g);
    };
    const a = L.a.pos, b = L.b.pos;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    const ux = dx / d, uz = dz / d;
    const rot = Math.atan2(ux, uz) + Math.PI / 2;
    mk(a.x + ux * 11, a.z + uz * 11, rot);
    mk(b.x - ux * 11, b.z - uz * 11, rot);
  }

  render(dt) { this.renderer.render(dt); }

  /** window.__dev.state() に出す値。 */
  snapshot() {
    const D = this.director, sim = this.world?.sim;
    return {
      state: this.state, map: this.world?.mapId, day: D?.day.n, clock: D ? +D.clock.toFixed(2) : null, sat: D ? +D.sat.toFixed(1) : null,
      sel: this.sel?.id, phase: this.sel?.signal.phase, stage: this.sel?.signal.stage, cars: sim?.cars.length, peds: sim?.peds.list.length,
      served: sim?.stats.served, offmap: sim?.offmap(), speed: this.speed, camp: this.camp ? { day: this.camp.day, traits: this.camp.traits, trust: this.camp.trust, budget: this.camp.budget, flags: this.camp.flags } : null,
    };
  }

  /** 確認・撮影用：その日のその時刻から（dilemma を開いたままにしない）。 */
  devGoto(name, { day = 1, h = null, sel = null } = {}) {
    if (name === 'title') { this.toTitle(); return this.state; }
    if (!this.camp) { this.store.data.camp = newCampaign(); }
    if (name === 'play' || name === 'brief') {
      this.camp.day = day;
      this.startDay(day, { brief: name === 'brief' });
      if (h !== null && this.director) {
        const D = this.director;
        D.events = D.events.filter((e) => e.h >= h || e.do === 'kids' || e.do === 'closure');
        D.gate = null;
        D.clock = h;
        this.hours = h;
        this.tutMsg?.remove();
        this.overlay.setPulse(null);
      }
      if (sel) this.selectNode(this.world.net.nodes.get(sel), false);
    }
    if (name === 'dilemma') { this.camp.day = day; this.startDay(day, { brief: false }); this.openDilemma(sel || 'cat'); }
    if (name === 'report' && this.director) this.director.clock = this.director.day.end;
    return this.state;
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
