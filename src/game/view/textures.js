// canvas で作るテクスチャ（画像ファイルは使わない）。窓の並び、看板、アスファルト、頭の上に出す記号、歩行者信号の絵。
import * as THREE from 'three';

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = false, srgb = true, aniso = 4, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

// 決まった並びの乱数（毎回同じ模様にする）
function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** アスファルト（白黒の細かいむら。1 枚 8 m 四方で繰り返す）。 */
export function asphaltTexture() {
  const [c, g] = canvas(256, 256);
  const r = rnd(7);
  g.fillStyle = '#7d7f84';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 34 + (r() < 0.02 ? 30 : 0);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2;
  }
  g.putImageData(img, 0, 0);
  // 補修のあと・しみ
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '40,42,48' : '150,150,150'},${0.05 + r() * 0.06})`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 10 + r() * 40, 6 + r() * 20, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, { repeat: true });
}

/**
 * 建物の壁と窓。1 枚に 4 柱間 × 4 階。style：'office' | 'apartment' | 'mixed'
 * 戻り値 { map, emissive }：emissive は夜に光る窓（ばらばらに点いている）。
 */
export function facadeTextures(style, seed = 1) {
  const S = 256, cell = 64;
  const [c, g] = canvas(S, S);
  const [ce, ge] = canvas(S, S);
  const r = rnd(seed * 97 + style.length);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  for (let fy = 0; fy < 4; fy++) {
    for (let fx = 0; fx < 4; fx++) {
      const x0 = fx * cell, y0 = fy * cell;
      let wx, wy, ww, wh;
      if (style === 'office') { wx = 4; wy = 8; ww = 56; wh = 44; }
      else if (style === 'apartment') { wx = 10; wy = 10; ww = 44; wh = 30; }
      else { wx = 12; wy = 12; ww = 40; wh = 32; }
      // 窓の枠
      g.fillStyle = style === 'office' ? '#c9ced6' : '#d8d4cc';
      g.fillRect(x0 + wx - 2, y0 + wy - 2, ww + 4, wh + 4);
      // ガラス（上が少し明るい：空の映り込み）
      const grd = g.createLinearGradient(0, y0 + wy, 0, y0 + wy + wh);
      if (style === 'office') { grd.addColorStop(0, '#6f8aa6'); grd.addColorStop(1, '#2b3a4c'); }
      else { grd.addColorStop(0, '#59677a'); grd.addColorStop(1, '#262d38'); }
      g.fillStyle = grd;
      g.fillRect(x0 + wx, y0 + wy, ww, wh);
      // カーテン・ブラインド（ところどころ）
      if (r() < 0.35) { g.fillStyle = r() < 0.5 ? 'rgba(235,225,205,0.55)' : 'rgba(200,215,230,0.45)'; g.fillRect(x0 + wx, y0 + wy, ww * (0.3 + r() * 0.5), wh); }
      if (style === 'office') { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x0 + wx + ww * 0.5 - 1, y0 + wy, 2, wh); }
      if (style === 'apartment') {
        // ベランダの手すり
        g.fillStyle = '#f1efe9';
        g.fillRect(x0 + 2, y0 + 42, cell - 4, 18);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let k = 0; k < 8; k++) g.fillRect(x0 + 5 + k * 7, y0 + 44, 1, 14);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x0 + 2, y0 + 59, cell - 4, 2);
        if (r() < 0.3) { g.fillStyle = ['#e6a7a0', '#9fc3e6', '#f2e3a0', '#ffffff'][Math.floor(r() * 4)]; g.fillRect(x0 + 8 + r() * 30, y0 + 40, 10, 8); } // 洗濯物
      }
      // 夜に点く窓
      if (r() < (style === 'office' ? 0.55 : 0.5)) {
        const warm = style === 'office' ? r() < 0.6 : r() < 0.85;
        const k = 0.45 + r() * 0.55;
        ge.fillStyle = warm ? `rgba(255,${190 + r() * 40},${120 + r() * 40},${k})` : `rgba(200,225,255,${k})`;
        ge.fillRect(x0 + wx, y0 + wy, ww, wh);
      }
    }
  }
  return { map: tex(c, { repeat: true }), emissive: tex(ce, { repeat: true }) };
}

// 縦の看板の文字（店の種類。実在の店名は使わない）
export const SIGN_TEXT = ['薬', 'カラオケ', '居酒屋', 'らーめん', '歯科', 'BAR', '喫茶', '不動産', '塾', '花', 'うどん', '整体', '中華', '質', '酒', '焼肉'];
const SIGN_BG = ['#d93a3a', '#2f5fb3', '#f2c230', '#ffffff', '#2f9e62', '#222831', '#ef7a2a', '#7b4bb0', '#e85d8f', '#1a8fb0', '#f5f0e1', '#355c3a', '#c0392b', '#2c3e50', '#b7472a', '#8e2c3a'];
const SIGN_FG = ['#fff', '#fff', '#222', '#c0392b', '#fff', '#ffd34d', '#fff', '#fff', '#fff', '#fff', '#8e2c3a', '#fff', '#ffe08a', '#fff', '#fff', '#fff'];

/** 縦の看板 16 種類（1 枚 64×256 を 8 列 × 2 段）。光るのは文字と地の両方。 */
export function signAtlas() {
  const W = 512, H = 512, cw = 64, ch = 256;
  const [c, g] = canvas(W, H);
  SIGN_TEXT.forEach((txt, i) => {
    const x = (i % 8) * cw, y = Math.floor(i / 8) * ch;
    g.fillStyle = SIGN_BG[i];
    g.fillRect(x, y, cw, ch);
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 3;
    g.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
    g.fillStyle = SIGN_FG[i];
    const chars = [...txt];
    const latin = /^[A-Z]+$/.test(txt);
    const fs = Math.min(48, (ch - 30) / chars.length - 2);
    g.font = `900 ${fs}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const total = chars.length * (fs + 2);
    chars.forEach((chr, k) => {
      const cy = y + ch / 2 - total / 2 + (fs + 2) * (k + 0.5);
      g.save();
      g.translate(x + cw / 2, cy);
      if (chr === 'ー') g.rotate(Math.PI / 2); // 縦書きの長音
      g.fillText(chr, 0, latin ? 0 : 2);
      g.restore();
    });
  });
  return tex(c);
}

// 横の看板（店先の帯）
export const SHOP_TEXT = ['ベーカリー', 'クリーニング', 'ドラッグ', 'MART 24h', 'カフェ', '書店', 'そば', '八百屋'];
const SHOP_BG = ['#f6e7c8', '#2d6cb5', '#e04848', '#2f9e62', '#5b3a29', '#f0f0f0', '#2c2c2c', '#f2b134'];
const SHOP_FG = ['#8b4a1c', '#fff', '#fff', '#fff', '#f6e7c8', '#2d4a7a', '#f6e7c8', '#3a2a10'];
export function shopAtlas() {
  const W = 512, H = 512, cw = 512, ch = 64;
  const [c, g] = canvas(W, H);
  SHOP_TEXT.forEach((txt, i) => {
    const y = i * ch;
    g.fillStyle = SHOP_BG[i];
    g.fillRect(0, y, cw, ch);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, y + ch - 6, cw, 6);
    g.fillStyle = SHOP_FG[i];
    g.font = `800 40px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, cw / 2, y + ch / 2);
  });
  return tex(c);
}

/** 頭の上に出す記号（4×4）。ICON の番号で選ぶ。 */
export const ICON = { anger: 0, warn: 1, heart: 2, sweat: 3, note: 4, wait: 5, sparkle: 6, siren: 7, zzz: 8, pin: 9, question: 10, clock: 11, cat: 12, ok: 13, star: 14, umbrella: 15 };
export function iconAtlas() {
  const S = 512, cell = 128;
  const [c, g] = canvas(S, S);
  const at = (i) => [(i % 4) * cell + cell / 2, Math.floor(i / 4) * cell + cell / 2];
  const bubble = (i, fill) => {
    const [x, y] = at(i);
    g.fillStyle = fill;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(x, y - 6, 46, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x - 10, y + 34); g.lineTo(x, y + 56); g.lineTo(x + 12, y + 32);
    g.fill();
  };
  // 0 怒り（漫画の怒りマーク）
  {
    const [x, y] = at(0);
    g.strokeStyle = '#ff3b3b';
    g.lineWidth = 12;
    g.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(x, y);
      g.rotate(k * Math.PI / 2);
      g.beginPath();
      g.arc(22, 22, 20, Math.PI * 1.0, Math.PI * 1.5);
      g.stroke();
      g.restore();
    }
  }
  // 1 注意（！）
  bubble(1, '#ffd23a');
  g.fillStyle = '#2a1f00'; g.font = `900 70px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', at(1)[0], at(1)[1] - 4);
  // 2 ハート
  {
    const [x, y] = at(2);
    g.fillStyle = '#ff6fa4';
    g.beginPath();
    g.moveTo(x, y + 36);
    g.bezierCurveTo(x - 60, y - 6, x - 30, y - 50, x, y - 18);
    g.bezierCurveTo(x + 30, y - 50, x + 60, y - 6, x, y + 36);
    g.fill();
  }
  // 3 汗
  {
    const [x, y] = at(3);
    g.fillStyle = '#7cc8ff';
    g.beginPath();
    g.moveTo(x, y - 44);
    g.quadraticCurveTo(x + 34, y + 10, x, y + 34);
    g.quadraticCurveTo(x - 34, y + 10, x, y - 44);
    g.fill();
  }
  // 4 音符
  bubble(4, '#ffffff');
  g.fillStyle = '#333'; g.font = `900 64px ${FONT}`; g.fillText('♪', at(4)[0], at(4)[1] - 4);
  // 5 待っている（…）
  bubble(5, '#ffffff');
  g.fillStyle = '#444'; g.font = `900 56px ${FONT}`; g.fillText('…', at(5)[0], at(5)[1] - 12);
  // 6 きらり
  {
    const [x, y] = at(6);
    g.fillStyle = '#fff6b0';
    g.beginPath();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const rr = k % 2 ? 14 : 50; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  // 7 サイレン
  bubble(7, '#ff4d4d');
  g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.fillText('!!', at(7)[0], at(7)[1] - 6);
  // 8 zzz
  g.fillStyle = '#cfe6ff'; g.font = `900 48px ${FONT}`; g.fillText('z z', at(8)[0], at(8)[1]);
  // 9 ピン（下向きの印）
  {
    const [x, y] = at(9);
    g.fillStyle = '#5ff0ff';
    g.beginPath();
    g.moveTo(x - 36, y - 30); g.lineTo(x + 36, y - 30); g.lineTo(x, y + 40); g.closePath();
    g.fill();
  }
  // 10 ？
  bubble(10, '#ffffff');
  g.fillStyle = '#2f5fb3'; g.font = `900 64px ${FONT}`; g.fillText('?', at(10)[0], at(10)[1] - 4);
  // 11 時計
  bubble(11, '#ffffff');
  {
    const [x, y] = at(11);
    g.strokeStyle = '#333'; g.lineWidth = 7;
    g.beginPath(); g.arc(x, y - 6, 26, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y - 24); g.moveTo(x, y - 6); g.lineTo(x + 14, y - 2); g.stroke();
  }
  // 12 ねこ
  {
    const [x, y] = at(12);
    g.fillStyle = '#f2a65a';
    g.beginPath(); g.arc(x, y + 6, 34, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x - 32, y - 6); g.lineTo(x - 24, y - 44); g.lineTo(x - 6, y - 24); g.fill();
    g.beginPath(); g.moveTo(x + 32, y - 6); g.lineTo(x + 24, y - 44); g.lineTo(x + 6, y - 24); g.fill();
    g.fillStyle = '#2a1a10';
    g.beginPath(); g.arc(x - 12, y + 2, 5, 0, Math.PI * 2); g.arc(x + 12, y + 2, 5, 0, Math.PI * 2); g.fill();
  }
  // 13 OK
  bubble(13, '#3ee0a6');
  g.fillStyle = '#063'; g.font = `900 44px ${FONT}`; g.fillText('OK', at(13)[0], at(13)[1] - 6);
  // 14 星
  {
    const [x, y] = at(14);
    g.fillStyle = '#ffd34d';
    g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2; const rr = k % 2 ? 20 : 48; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  // 15 傘
  {
    const [x, y] = at(15);
    g.fillStyle = '#5aa9ff';
    g.beginPath(); g.arc(x, y, 44, Math.PI, 0); g.fill();
    g.strokeStyle = '#333'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 40); g.arc(x - 8, y + 40, 8, 0, Math.PI); g.stroke();
  }
  return tex(c, { aniso: 2 });
}

/** 歩行者信号の絵（上：止まれの人（赤）、下：歩く人（青））。白い形を、色は材質で付ける。 */
export function pedSignalTexture() {
  const [c, g] = canvas(64, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#fff';
  // 立っている人
  const person = (cx, cy, walking) => {
    g.beginPath(); g.arc(cx, cy - 18, 6, 0, Math.PI * 2); g.fill();
    g.lineCap = 'round';
    g.strokeStyle = '#fff';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 6);
    if (walking) {
      g.moveTo(cx, cy + 5); g.lineTo(cx - 9, cy + 20);
      g.moveTo(cx, cy + 5); g.lineTo(cx + 8, cy + 19);
      g.moveTo(cx, cy - 6); g.lineTo(cx - 9, cy + 3);
      g.moveTo(cx, cy - 6); g.lineTo(cx + 9, cy - 1);
    } else {
      g.moveTo(cx - 3, cy + 5); g.lineTo(cx - 4, cy + 21);
      g.moveTo(cx + 3, cy + 5); g.lineTo(cx + 4, cy + 21);
      g.moveTo(cx - 3, cy - 7); g.lineTo(cx - 7, cy + 6);
      g.moveTo(cx + 3, cy - 7); g.lineTo(cx + 7, cy + 6);
    }
    g.stroke();
  };
  person(32, 32, false);
  person(32, 96, true);
  return tex(c, { aniso: 2 });
}

/** 地面のやわらかい光（街灯の下・自販機の前）。中心が白く、外へ透明になる丸。 */
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { aniso: 1 });
}

/** 駐車場・校庭などの地面の模様。 */
export function groundTexture(kind) {
  const [c, g] = canvas(256, 256);
  const r = rnd(kind.length * 31);
  if (kind === 'grass') {
    g.fillStyle = '#7fae5a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) { g.fillStyle = r() < 0.5 ? 'rgba(60,110,40,0.35)' : 'rgba(170,210,120,0.3)'; g.fillRect(r() * 256, r() * 256, 2, 3); }
  } else if (kind === 'dirt') {
    g.fillStyle = '#c9a57a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,90,60,0.25)' : 'rgba(240,220,190,0.25)'; g.fillRect(r() * 256, r() * 256, 2, 2); }
  }
  return tex(c, { repeat: true });
}
