// 曲のデータ（書き方は sequencer.js の先頭）。夕方の街のような、やわらかいエレピとパッドが中心。
// 小節の文字列は、書き間違い（16 個でない）を防ぐため、下の小さな関数で組み立てる。
//   hits(和音, 'x---..x-')   x：鳴らす、-：のばす、.：休み（16 文字）
//   arp([音…], '0.1.2.3.')   数字：音の番号、-：のばす、.：休み（16 文字）
const hits = (ch, pat) => [...pat].map((c) => (c === 'x' ? ch : c === 'X' ? ch + '!' : c === 'o' ? ch + '?' : c)).join(' ');
const arp = (notes, pat) => [...pat].map((c) => (/[0-9]/.test(c) ? notes[+c] : c)).join(' ');
const hold = (ch) => hits(ch, 'x---------------');

// 和音
const C = {
  Fmaj7: 'F3+A3+C4+E4', Em7: 'E3+G3+B3+D4', Dm7: 'D3+F3+A3+C4', Cmaj7: 'C3+E3+G3+B3', Bbmaj7: 'Bb2+D3+F3+A3',
  Am7: 'A2+C3+E3+G3', G7sus: 'G2+C3+D3+F3', Am9: 'A2+C3+E3+B3', Fmaj9: 'F2+A2+E3+G3', C69: 'C3+E3+A3+D4', Gadd9: 'G2+B2+D3+A3',
  Em: 'E3+G3+B3', Am: 'A2+C3+E3', Dm: 'D3+F3+A3', Bdim: 'B2+D3+F3', E7: 'E3+G#3+B3+D4',
};

export const SONGS = {
  // タイトル：夕方の街。エレピの和音と、きらきらしたマレット
  title: {
    id: 'title', bpm: 82, gain: 0.85,
    tracks: {
      pad: { inst: 'pad', vol: 0.55, bars: [C.Fmaj7, C.Em7, C.Dm7, C.Cmaj7, C.Bbmaj7, C.Am7, C.Dm7, C.G7sus].map(hold) },
      keys: { inst: 'epiano', vol: 0.75, bars: [C.Fmaj7, C.Em7, C.Dm7, C.Cmaj7, C.Bbmaj7, C.Am7, C.Dm7, C.G7sus].map((c) => hits(c, 'x------.--x---..')) },
      sparkle: { inst: 'mallet', vol: 0.45, pan: 0.25, bars: [
        arp(['A5', 'C6', 'E6', 'G5'], '..0...1...2.3...'), arp(['G5', 'B5', 'D6', 'E6'], '..0...1...3.2...'),
        arp(['F5', 'A5', 'C6', 'D6'], '..0...1...2.3...'), arp(['E5', 'G5', 'B5', 'C6'], '..0...1...3...2.'),
        arp(['D5', 'F5', 'A5', 'C6'], '..0...1...2.3...'), arp(['C5', 'E5', 'G5', 'A5'], '..0...1...3.2...'),
        arp(['D5', 'F5', 'A5', 'C6'], '..0...2...1.3...'), arp(['C5', 'D5', 'F5', 'G5'], '..3...2...1...0.'),
      ] },
      bass: { inst: 'sub', vol: 0.75, bars: ['F2', 'E2', 'D2', 'C2', 'Bb1', 'A1', 'D2', 'G1'].map((n) => hits(n, 'x-----.x-.------')) },
    },
  },
  // 日のはじめ：短い、やさしいくり返し
  brief: {
    id: 'brief', bpm: 78, gain: 0.8,
    tracks: {
      pad: { inst: 'pad', vol: 0.5, bars: [C.Cmaj7, C.Am7, C.Fmaj7, C.G7sus].map(hold) },
      keys: { inst: 'epiano', vol: 0.6, bars: [C.Cmaj7, C.Am7, C.Fmaj7, C.G7sus].map((c) => hits(c, 'x-------x-------')) },
      bell: { inst: 'mallet', vol: 0.35, pan: -0.2, bars: [arp(['E5', 'G5'], '0.......1.......'), arp(['C5', 'E5'], '0.......1.......'), arp(['A4', 'C5'], '0.......1.......'), arp(['B4', 'D5'], '0.......1.......')] },
    },
  },
  // プレイ中：控えめで、ずっと聞いていられる刻み
  play: {
    id: 'play', bpm: 98, gain: 0.72,
    tracks: {
      drums: { inst: 'drums', vol: 0.8, bars: [
        { kick: 'x.....x...x.....', snare: '....o.......o...', hat: 'x.x.x.x.x.x.x.x.' },
        { kick: 'x.....x...x...x.', snare: '....o.......o..o', hat: 'x.x.x.x.x.x.xxx.' },
      ] },
      bass: { inst: 'sub', vol: 0.8, bars: [
        arp(['A1', 'A2', 'E2', 'G2'], '0-.0..1.0-..2.3.'), arp(['F1', 'F2', 'C2', 'E2'], '0-.0..1.0-..2.3.'),
        arp(['C2', 'C3', 'G2', 'B2'], '0-.0..1.0-..2.3.'), arp(['G1', 'G2', 'D2', 'F2'], '0-.0..1.0-..2.3.'),
      ] },
      keys: { inst: 'epiano', vol: 0.55, pan: -0.15, bars: [C.Am9, C.Fmaj9, C.C69, C.Gadd9].map((c) => hits(c, '..o...x...o...x.')) },
      lead: { inst: 'mallet', vol: 0.38, pan: 0.2, bars: [
        arp(['E5', 'G5', 'A5', 'C6'], '0...1.2.........'), arp(['C5', 'E5', 'F5', 'A5'], '..0...1.2...3...'),
        arp(['G5', 'E5', 'D5', 'C5'], '0.1.2...3.......'), arp(['D5', 'B4', 'G4', 'A4'], '....0.1.2...3...'),
        arp(['A5', 'G5', 'E5', 'C5'], '0...1...2.3.....'), arp(['F5', 'E5', 'C5', 'A4'], '..0.1...2...3...'),
        arp(['E5', 'G5', 'C6', 'B5'], '0.1.2...3.......'), arp(['D5', 'E5', 'G5', 'B4'], '0...1.2.....3...'),
      ] },
      pad: { inst: 'pad', vol: 0.32, bars: [C.Am9, C.Fmaj9, C.C69, C.Gadd9].map(hold) },
    },
  },
  // 判断を待つあいだ：重い、ゆっくりした脈
  dilemma: {
    id: 'dilemma', bpm: 66, gain: 0.8,
    tracks: {
      pad: { inst: 'pad', vol: 0.65, bars: [C.Dm, C.Bdim, C.Am, C.E7].map(hold) },
      pulse: { inst: 'drums', vol: 0.55, bars: [{ kick: 'x.......x.......' }, { kick: 'x.......x...x...' }] },
      bell: { inst: 'bell', vol: 0.35, pan: 0.2, bars: [arp(['A5', 'F5'], '0.......1.......'), arp(['F5', 'D5'], '0.......1.......'), arp(['E5', 'C5'], '0.......1.......'), arp(['G#5', 'B5'], '0.......1.......')] },
      bass: { inst: 'sub', vol: 0.7, bars: ['D2', 'B1', 'A1', 'E2'].map((n) => hits(n, 'x---------------')) },
    },
  },
  // 報告：ほっとする
  result: {
    id: 'result', bpm: 88, gain: 0.8,
    tracks: {
      keys: { inst: 'epiano', vol: 0.7, bars: [C.Fmaj7, C.Em7, C.Dm7, C.Cmaj7].map((c) => hits(c, 'x-----x.--x-----')) },
      pad: { inst: 'pad', vol: 0.4, bars: [C.Fmaj7, C.Em7, C.Dm7, C.Cmaj7].map(hold) },
      mel: { inst: 'mallet', vol: 0.45, bars: [arp(['C6', 'A5', 'G5', 'E5'], '0...1...2...3...'), arp(['B5', 'G5', 'E5', 'D5'], '0...1...2...3...'), arp(['A5', 'F5', 'D5', 'C5'], '0...1...2...3...'), arp(['G5', 'E5', 'C5', 'B4'], '0...1...2.....3.')] },
      bass: { inst: 'sub', vol: 0.7, bars: ['F2', 'E2', 'D2', 'C2'].map((n) => hits(n, 'x-------x-------')) },
    },
  },
  // 停止：下がっていく短い曲（くり返さない）
  fail: {
    id: 'fail', bpm: 70, gain: 1.6, loop: false,
    tracks: {
      pad: { inst: 'pad', vol: 0.9, bars: [hold(C.Am), hold('F2+A2+C3'), hold('D2+F2+A2'), hold('E2+G#2+B2')] },
      bell: { inst: 'bell', vol: 0.4, bars: [arp(['E5', 'C5'], '0.......1.......'), arp(['A4', 'F4'], '0.......1.......'), arp(['D4', 'F4'], '0.......1.......'), arp(['E4'], '0---------------')] },
    },
  },
  // 結末：エレピとベルの、ゆっくりした旋律
  ending: {
    id: 'ending', bpm: 72, gain: 0.85,
    tracks: {
      pad: { inst: 'pad', vol: 0.5, bars: [C.Fmaj7, C.Em7, C.Am7, C.Cmaj7, C.Bbmaj7, C.Am7, C.Dm7, C.G7sus].map(hold) },
      keys: { inst: 'epiano', vol: 0.6, bars: [C.Fmaj7, C.Em7, C.Am7, C.Cmaj7, C.Bbmaj7, C.Am7, C.Dm7, C.G7sus].map((c) => hits(c, 'x-------x---x---')) },
      mel: { inst: 'bell', vol: 0.32, pan: 0.15, bars: [
        arp(['A5', 'G5', 'E5'], '0-----1-2-------'), arp(['G5', 'D5', 'E5'], '0-----1-2-------'),
        arp(['C6', 'B5', 'A5'], '0-----1-2-------'), arp(['G5', 'E5'], '0-------1-------'),
        arp(['F5', 'A5', 'D6'], '0-----1-2-------'), arp(['C6', 'A5', 'E5'], '0-----1-2-------'),
        arp(['F5', 'E5', 'D5'], '0-----1-2-------'), arp(['C5', 'D5'], '0-------1-------'),
      ] },
      bass: { inst: 'sub', vol: 0.7, bars: ['F2', 'E2', 'A1', 'C2', 'Bb1', 'A1', 'D2', 'G1'].map((n) => hits(n, 'x-------x-------')) },
    },
  },
};
