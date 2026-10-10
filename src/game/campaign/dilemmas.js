// 判断に迷う依頼。どれを選んでも正解・不正解はなく、選んだことが「ミチの性格」と、のちの出来事・結末に残る。
//   who：送ってきた人（i18n の who.<id>）。文は dl.<id>.body、選ぶ肢は dl.<id>.<a|b|c>、選んだあとの返事は dl.<id>.<a|b|c>.res
//   traits：性格の変化（compassion 思いやり / fairness 公平 / honesty 誠実 / efficiency 効率）
//   trust：市の信頼、budget：予算（万円）、sat：市民の満足度、flags：あとで使う印、act：その場で起きること（Director が行う）
export const DILEMMAS = {
  cat: {
    who: 'yui', icon: 'cat',
    choices: [
      { id: 'a', traits: { compassion: 1 }, act: 'catHold' },
      { id: 'b', traits: { compassion: 1, fairness: 1 }, act: 'catWalk' },
      { id: 'c', traits: { efficiency: 1 }, act: 'catGo' },
    ],
  },
  delivery: {
    who: 'soramame', icon: 'truck',
    choices: [
      { id: 'a', traits: { fairness: -2, efficiency: 1 }, budget: 150, flags: { deal: true }, act: 'deal' },
      { id: 'b', traits: { fairness: 2 }, trust: -1 },
      { id: 'c', traits: { fairness: -1 }, trust: 1, budget: 150, flags: { deal: true, askedMayor: true }, act: 'deal' },
    ],
  },
  labor: {
    who: 'citizen', icon: 'heart',
    choices: [
      { id: 'a', traits: { compassion: 2, fairness: -1 }, flags: { laborHelped: true }, act: 'labor' },
      { id: 'b', traits: { compassion: 1, honesty: 1 }, act: 'laborAmb' },
      { id: 'c', traits: { fairness: 1, compassion: -1 }, flags: { laborDeclined: true } },
    ],
  },
  police: {
    who: 'police', icon: 'police',
    choices: [
      { id: 'a', traits: { fairness: -1, efficiency: 1 }, trust: 1, flags: { gaveData: true } },
      { id: 'b', traits: { honesty: 1, fairness: 1 }, trust: -1 },
      { id: 'c', traits: { efficiency: 1, fairness: -1 }, flags: { detainTried: true }, act: 'suspect' },
    ],
  },
  school: {
    who: 'pta', icon: 'school',
    choices: [
      { id: 'a', traits: { compassion: 1, efficiency: -1 }, act: 'longWalk' },
      { id: 'b', traits: { efficiency: 1 } },
      { id: 'c', traits: { fairness: 1 }, act: 'schoolAuto' },
    ],
  },
  mayor: {
    who: 'mayor', icon: 'mayor',
    choices: [
      { id: 'a', traits: { fairness: -2 }, trust: 2, flags: { motorcade: 15.0 }, act: 'motorcade' },
      { id: 'b', traits: { fairness: 2 }, trust: -3 },
      { id: 'c', traits: { efficiency: 1, fairness: -1 }, trust: 1, flags: { motorcade: 11.0 }, act: 'motorcade' },
    ],
  },
  logs: {
    who: 'yui', icon: 'log', private: true,
    choices: [
      { id: 'a', traits: { honesty: 2 }, trust: -1 },
      { id: 'b', traits: { honesty: -3 }, flags: { tampered: true } },
      { id: 'c', traits: { honesty: 1 }, flags: { yuiLogs: true } },
    ],
  },
  copycat: {
    who: 'citizen', icon: 'wait',
    choices: [
      { id: 'a', traits: { compassion: 1, fairness: -2 }, sat: -6, act: 'copycat' },
      { id: 'b', traits: { fairness: 1 } },
    ],
  },
  hacker: {
    who: 'unknown', icon: 'unknown', glitch: true,
    choices: [
      { id: 'a', traits: { efficiency: 3, honesty: -2 }, flags: { hacker: true }, act: 'hacker' },
      { id: 'b', traits: { honesty: 2 }, trust: 2, flags: { reported: true } },
      { id: 'c', traits: {} },
    ],
  },
  lostchild: {
    who: 'koban', icon: 'child',
    choices: [
      { id: 'a', traits: { compassion: 2, efficiency: -1 }, act: 'reunion' },
      { id: 'b', traits: { efficiency: 1 } },
      { id: 'c', traits: { fairness: 1 }, act: 'escort' },
    ],
  },
};

// 判断のあと、別の日に届く知らせ（flags で選ぶ）
export const FOLLOWUPS = [
  { day: 3, h: 7.3, if: (f) => f.laborHelped, who: 'citizen', key: 'fu.labor.thanks' },
  { day: 3, h: 7.3, if: (f) => f.laborDeclined, who: 'news', key: 'fu.labor.fine' },
  { day: 4, h: 7.25, if: (f) => f.gaveData, who: 'news', key: 'fu.police.data' },
  { day: 4, h: 7.25, if: (f) => f.detain === 'caught', who: 'news', key: 'fu.police.detain' },
  { day: 4, h: 7.25, if: (f) => f.detain === 'missed', who: 'news', key: 'fu.police.missed' },
  { day: 4, h: 7.25, if: (f) => !f.gaveData && !f.detainTried, who: 'news', key: 'fu.police.warrant' },
  { day: 5, h: 15.25, if: (f) => f.deal, who: 'news', key: 'fu.deal' },
  { day: 5, h: 15.4, if: (f) => f.motorcade, who: 'news', key: 'fu.motorcade' },
];
