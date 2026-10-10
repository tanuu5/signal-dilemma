// ゲーム中の表示（AI の操作盤ふう）。
//   上：曜日と時刻・一日の進み・市民の満足度・通過した台数・一時停止
//   左上：連絡（ユイや市民からの知らせ。チュートリアルは終わるまで残る）
//   上の真ん中：知らせの帯（救急車が接近中…）
//   下：選んでいる交差点の操作盤（切替・歩行者・自動）、右下：思考加速・早送り・全体
//   交差点の上：待っている人の数（押すと歩行者の青）とモードの印（M 手動・A 自動・ツ 補助AI）。端のゲート：入れない車の数
//   上の帯の「ツジ」：補助AI が受け持っている数と、手のあいている数
import { t, onLangChange } from '../core/i18n.js';

const WHO_ICON = { yui: 'Y', sys: '>', mayor: '市', soramame: 'ソ', citizen: '声', police: '警', pta: '学', unknown: '?', koban: '交', news: 'N', tsuji: 'ツ' };
const WHO_ICON_EN = { mayor: 'M', soramame: 'S', citizen: 'C', police: 'P', pta: 'T', koban: 'K', tsuji: 'T' };

export class Hud {
  constructor(root) {
    root.insertAdjacentHTML('beforeend', `
<div id="hud" class="hidden">
  <div class="topbar">
    <div class="clock"><span class="wd"></span><span class="time">07:00</span><div class="dayprog"><i></i></div></div>
    <div class="sat"><span class="lab" data-i18n="hud.sat">${t('hud.sat')}</span><div class="bar"><i></i><b></b></div><span class="val">72</span></div>
    <div class="served"><span class="lab" data-i18n="hud.served">${t('hud.served')}</span><span class="val">0</span></div>
    <div class="helpers hidden"><span class="lab" data-i18n="hud.helpers">${t('hud.helpers')}</span><span class="val"></span></div>
    <button class="pausebtn" data-hud="pause" aria-label="pause">Ⅱ</button>
  </div>
  <div class="comms"></div>
  <div class="alertbar hidden"><span class="txt"></span><button data-hud="focus" class="go"><i data-glyph="focus"></i><b data-i18n="hud.focus">${t('hud.focus')}</b></button></div>
  <div class="chips"></div>
  <div class="panel hidden">
    <div class="pname"><b class="nm"></b><span class="ph"></span></div>
    <div class="pbtns">
      <button data-hud="toggle" class="pb toggle"><i data-glyph="toggle"></i><b data-i18n="hud.toggle">${t('hud.toggle')}</b></button>
      <button data-hud="walk" class="pb walk"><i data-glyph="walk"></i><b data-i18n="hud.walk">${t('hud.walk')}</b></button>
      <button data-hud="auto" class="pb auto"><i data-glyph="auto"></i><b class="am"></b></button>
    </div>
  </div>
  <div class="tools">
    <button data-hud="home" class="tb home"><i data-glyph="home"></i><b data-i18n="hud.home">${t('hud.home')}</b></button>
    <button data-hud="fast" class="tb fast"><i data-glyph="fast"></i><b data-i18n="hud.fast">${t('hud.fast')}</b></button>
    <button data-hud="slow" class="tb slow"><i data-glyph="slow"></i><b data-i18n="hud.slow">${t('hud.slow')}</b><span class="gauge"><i></i></span></button>
  </div>
  <div class="edge"></div>
</div>`);
    this.el = root.querySelector('#hud');
    const q = (s) => this.el.querySelector(s);
    this.$ = {
      wd: q('.clock .wd'), time: q('.clock .time'), prog: q('.dayprog i'), satBar: q('.sat .bar i'), satGhost: q('.sat .bar b'), satVal: q('.sat .val'), sat: q('.sat'),
      served: q('.served .val'), comms: q('.comms'), alert: q('.alertbar'), alertTxt: q('.alertbar .txt'), chips: q('.chips'), panel: q('.panel'),
      pname: q('.pname .nm'), pphase: q('.pname .ph'), autoLab: q('.pb.auto .am'), toggleBtn: q('.pb.toggle'), walkBtn: q('.pb.walk'), autoBtn: q('.pb.auto'),
      fast: q('.tb.fast'), slow: q('.tb.slow'), gauge: q('.tb.slow .gauge i'), edge: q('.edge'), helpers: q('.topbar .helpers'), helpersVal: q('.topbar .helpers .val'),
    };
    this.msgs = [];
    this.chipEls = new Map();
    this.gateEls = new Map();
    this.edgeEls = new Map();
    this.onButton = null;     // (name, el, down) => void
    this.ghost = 72;
    // ボタン（思考加速は押しているあいだ）
    this.el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-hud]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      this.onButton?.(b.dataset.hud, b, true);
    });
    const up = (e) => { const b = e.target.closest?.('[data-hud="slow"]'); if (b || this.slowHeld) { this.slowHeld = false; this.onButton?.('slow', null, false); } };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    onLangChange(() => this._relabel());
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  // ---------------------------------------------------------------- 上の帯
  setClock(wdKey, hours, prog) {
    const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
    const txt = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (this._wd !== wdKey) { this._wd = wdKey; this.$.wd.textContent = t('wds.' + wdKey); }
    if (this._time !== txt) { this._time = txt; this.$.time.textContent = txt; }
    this.$.prog.style.width = `${Math.round(prog * 1000) / 10}%`;
  }

  setSat(v, dt = 1 / 60) {
    const r = Math.round(v);
    if (this._sat !== r) { this._sat = r; this.$.satVal.textContent = r; }
    this.$.satBar.style.width = `${v}%`;
    // 下がったぶんを少し遅れて追いかける影
    this.ghost = v > this.ghost ? v : this.ghost + (v - this.ghost) * Math.min(1, dt * 1.5);
    this.$.satGhost.style.width = `${this.ghost}%`;
    const cls = v < 25 ? 'low' : v < 50 ? 'mid' : 'ok';
    if (this._satCls !== cls) { this._satCls = cls; this.$.sat.dataset.lv = cls; }
  }

  setServed(n) { if (this._served !== n) { this._served = n; this.$.served.textContent = n; } }

  // ---------------------------------------------------------------- 連絡
  /** 知らせを出す。pin：消さずに残す（チュートリアル）。戻り値の要素を remove で消せる。 */
  say(who, text, { pin = false, life = 9, cls = '' } = {}) {
    const el = document.createElement('div');
    el.className = `msg who-${who} ${pin ? 'pin' : ''} ${cls}`;
    const icon = (document.documentElement.lang === 'en' && WHO_ICON_EN[who]) || WHO_ICON[who] || '•';
    el.innerHTML = `<span class="av">${icon}</span><div class="mb"><span class="nm"></span><p></p></div>`;
    el.querySelector('.nm').textContent = t('who.' + who);
    el.querySelector('p').textContent = text;
    this.$.comms.append(el);
    const m = { el, t: 0, life: pin ? Infinity : life + Math.min(6, text.length * 0.04) };
    this.msgs.push(m);
    // 多すぎたら古いものから（残すもの以外）
    const loose = this.msgs.filter((x) => x.life !== Infinity);
    if (loose.length > 3) this._drop(loose[0]);
    return { remove: () => this._drop(m) };
  }

  _drop(m) {
    const i = this.msgs.indexOf(m);
    if (i >= 0) this.msgs.splice(i, 1);
    m.el.remove();
  }

  clearMsgs() { for (const m of [...this.msgs]) this._drop(m); }

  /** 毎フレーム：古い知らせを消す（ゲームの時間で。撮影でも同じに写る）。 */
  tick(dt) {
    for (const m of [...this.msgs]) {
      m.t += dt;
      if (m.t > m.life) this._drop(m);
      else if (m.life !== Infinity) m.el.style.opacity = m.t > m.life - 0.8 ? String(Math.max(0, (m.life - m.t) / 0.8)) : '';
    }
  }

  setAlert(text) {
    this.$.alert.classList.toggle('hidden', !text);
    if (text) this.$.alertTxt.textContent = text;
  }

  // ---------------------------------------------------------------- 操作盤
  setPanel(X, info) {
    this.$.panel.classList.toggle('hidden', !X);
    if (!X) return;
    if (this._pnm !== info.name) { this._pnm = info.name; this.$.pname.textContent = info.name; }
    const ph = info.busy ? t('hud.busy') : t('hud.phase.' + info.phase);
    if (this._pph !== ph) { this._pph = ph; this.$.pphase.textContent = ph; this.$.pphase.dataset.ph = info.busy ? 'busy' : info.phase; }
    // モードのボタン（押すと 手動 → ツジ → 自動 の順に変わる）。水曜からは「自動 ON/OFF」（チュートリアルの［自動］）、
    // 自動のない火曜（ツジがいるときだけ出す）は「手動」。ツジが受け持っていれば「ツジ」
    const am = info.mode === 'helper' ? t('hud.helper') : info.autoOk ? `${t('hud.auto')} ${info.mode === 'auto' ? 'ON' : 'OFF'}` : t('hud.manual');
    if (this._pam !== am) { this._pam = am; this.$.autoLab.textContent = am; }
    this.$.autoBtn.classList.toggle('on', info.mode === 'auto');
    this.$.autoBtn.classList.toggle('helper', info.mode === 'helper');
    this.$.autoBtn.classList.toggle('hidden', info.showAuto === false);
    this.$.toggleBtn.classList.toggle('dis', info.busy);
    this.$.walkBtn.classList.toggle('hot', info.peds > 0);
    this.$.walkBtn.classList.toggle('dis', info.phase === 'WALK');
  }

  /** 補助AI「ツジ」：{ working, idle }（いなければ null）。 */
  setHelpers(h) {
    this.$.helpers.classList.toggle('hidden', !h);
    if (!h) return;
    const txt = `×${h.working}${h.idle ? ` · ${t('hud.helpersIdle', { n: h.idle })}` : ''}`;
    if (this._hlp !== txt) { this._hlp = txt; this.$.helpersVal.textContent = txt; }
    this.$.helpers.classList.toggle('idle', h.idle > 0);
  }

  setTools({ fast, slow, gauge }) {
    this.$.fast.classList.toggle('on', !!fast);
    this.$.slow.classList.toggle('on', !!slow);
    this.$.gauge.style.width = `${Math.round(gauge * 100)}%`;
  }

  // ---------------------------------------------------------------- 交差点の上の表示
  /** list：[{ id, x, y, peds, maxWait, mode, sel, vis }]（x, y は画面の座標。mode：'manual' | 'auto' | 'helper'） */
  setChips(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      let el = this.chipEls.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'chip';
        el.innerHTML = '<button class="pw" data-hud="walkAt"><span class="ic">🚶</span><b></b></button><button class="md" data-hud="autoAt">A</button>';
        el.querySelector('.pw').dataset.node = c.id;
        el.querySelector('.md').dataset.node = c.id;
        this.$.chips.append(el);
        this.chipEls.set(c.id, el);
      }
      el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
      el.classList.toggle('hidden', !c.vis);
      const pw = el.querySelector('.pw');
      pw.classList.toggle('hidden', !c.peds);
      if (c.peds) {
        const b = pw.querySelector('b');
        if (b.textContent !== String(c.peds)) b.textContent = c.peds;
        pw.dataset.lv = c.maxWait > 35 ? 'hi' : c.maxWait > 18 ? 'mid' : 'lo';
      }
      const md = el.querySelector('.md');
      md.classList.toggle('on', c.mode === 'auto');
      md.classList.toggle('helper', c.mode === 'helper');
      const mt = c.mode === 'auto' ? 'A' : c.mode === 'helper' ? t('hud.chip.helper') : 'M';
      if (md.textContent !== mt) md.textContent = mt;
      el.classList.toggle('sel', !!c.sel);
    }
    for (const [id, el] of this.chipEls) if (!seen.has(id)) { el.remove(); this.chipEls.delete(id); }
  }

  /** 端のゲートの、入れない車の数。 */
  setGates(list) {
    const seen = new Set();
    for (const g of list) {
      seen.add(g.id);
      let el = this.gateEls.get(g.id);
      if (!el) { el = document.createElement('div'); el.className = 'gate'; this.$.chips.append(el); this.gateEls.set(g.id, el); }
      el.style.transform = `translate(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px)`;
      const txt = t('hud.offmap', { n: g.n });
      if (el.textContent !== txt) el.textContent = txt;
      el.dataset.lv = g.n >= 6 ? 'hi' : g.n >= 3 ? 'mid' : 'lo';
      el.classList.toggle('hidden', !g.vis);
    }
    for (const [id, el] of this.gateEls) if (!seen.has(id)) { el.remove(); this.gateEls.delete(id); }
  }

  /** 画面の外にいる救急車などの方向を、画面のふちに矢印で出す。list：[{ id, x, y, ang, kind }] */
  setEdge(list) {
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id);
      let el = this.edgeEls.get(a.id);
      if (!el) { el = document.createElement('div'); el.className = 'edgearrow'; el.innerHTML = '<i>➤</i>'; this.$.edge.append(el); this.edgeEls.set(a.id, el); }
      el.dataset.kind = a.kind;
      el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
      el.firstChild.style.transform = `rotate(${a.ang.toFixed(3)}rad)`;
    }
    for (const [id, el] of this.edgeEls) if (!seen.has(id)) { el.remove(); this.edgeEls.delete(id); }
  }

  _relabel() {
    this._wd = this._pnm = this._pph = this._pam = this._hlp = null;
    for (const el of this.gateEls.values()) el.textContent = '';
  }
}
