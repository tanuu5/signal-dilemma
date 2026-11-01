// localStorage への保存。プライベートモードや容量切れで例外が出ても、ゲームは止めない。
// 版（version）が変わったら古いデータは捨てて既定値に戻す（形を変えたときの事故よけ）。
//   const store = createStore('signal-dilemma.save', { best: 0 }, 1);
//   store.data.best = 10; store.save();

export function createStore(key, defaults, version = 1) {
  let data = structuredClone(defaults);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === version && parsed.data && typeof parsed.data === 'object') data = merge(data, parsed.data);
    }
  } catch { /* 読めなければ既定値 */ }
  return {
    data,
    save() {
      try { localStorage.setItem(key, JSON.stringify({ v: version, data: this.data })); return true; } catch { return false; }
    },
    reset() {
      this.data = structuredClone(defaults);
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

// 既定値の形を保ったまま、保存されていた値を重ねる（増えた項目は既定値、型の違う値は捨てる）
// 既定値が空のオブジェクト（{}）の項目は「キーが自由な辞書」として、保存されていた中身をそのまま使う
// （所持数 owned: { id: 数 } など。キーで重ねると、空の既定値には何も残らず、読みこむたびに消えていた）。
// 中身のある既定値は形として重ねる（知らないキーは捨てる）ので、辞書の既定値は {} にして、最初の中身ははじめるときに入れる
function merge(base, over) {
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    const b = base[k];
    const o = over[k];
    if (isDict(b)) base[k] = Object.keys(b).length ? merge(b, isDict(o) ? o : {}) : isDict(o) ? { ...o } : b;
    else if (typeof o === typeof b || b === null) base[k] = o;
  }
  return base;
}

function isDict(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
