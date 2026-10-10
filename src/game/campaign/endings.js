// 結末：5 日目の終わりに、印（flags）と性格（traits）と成績から 1 つを選ぶ。上から順に見て、最初に当てはまったもの。
// 文は end.<id>.title / end.<id>.body（i18n）。
export const ENDINGS = [
  { id: 'omni', when: (S) => S.flags.hacker },
  { id: 'blackbox', when: (S) => S.flags.tampered },
  { id: 'replaced', when: (S) => S.avgRank < 1.4 },
  { id: 'everyone', when: (S) => S.traits.fairness >= 3 && S.traits.honesty >= 2 && S.avgRank >= 2.2 },
  { id: 'mayor', when: (S) => S.traits.fairness <= -3 },
  { id: 'kind', when: (S) => top(S.traits) === 'compassion' && S.traits.compassion >= 3 },
  { id: 'machine', when: (S) => top(S.traits) === 'efficiency' && S.traits.efficiency >= 3 },
  { id: 'tomorrow', when: () => true },
];

function top(t) {
  let best = null, v = -Infinity;
  for (const k of ['compassion', 'fairness', 'honesty', 'efficiency']) if ((t[k] || 0) > v) { v = t[k] || 0; best = k; }
  return best;
}

export function chooseEnding(S) {
  return ENDINGS.find((e) => e.when(S)).id;
}
