import type { SpamDecision } from '@/shared/types';

import { normalizeToPinyinWords } from '@/ml/tokenizer';

interface HeuristicRule {
  name: string;
  pattern: RegExp;
  weight: number;
}

const SPAM_RULES: HeuristicRule[] = [
  { name: 'home-page-flight', pattern: /(主页|主頁).{0,4}(能打|可约|能约|✈️)/iu, weight: 3 },
  { name: 'offline-meetup', pattern: /(线下|線下|真人|认识一下|認識一下|哥哥)/iu, weight: 2 },
  { name: 'breakup-hook', pattern: /(刚分手想被爱|剛分手想被愛|想被爱)/iu, weight: 2 },
  { name: 'sao-obfuscation', pattern: /(sao|骚|澀|涩)/iu, weight: 2 },
  { name: 'explicit-dd', pattern: /dd个线下/iu, weight: 3 },
  { name: 'contact-handle', pattern: /@[a-z0-9_]{4,}/iu, weight: 1 },
];

export function detectSpamHeuristics(text: string): SpamDecision {
  const matchedRules = SPAM_RULES.filter((rule) => rule.pattern.test(text));
  const emojiBurst = Array.from(text).filter((character) => /\p{Extended_Pictographic}/u.test(character)).length;
  const mixedNoise = /[a-z]\d|\d[a-z]/iu.test(text) ? 1 : 0;
  const ruleScore = matchedRules.reduce((total, rule) => total + rule.weight, 0);
  const score = ruleScore + Math.min(emojiBurst, 2) + mixedNoise;

  return {
    label: score >= 3 ? 1 : 0,
    source: 'auto',
    matchedRules: matchedRules.map((rule) => rule.name),
    score,
    cleanedPinyin: normalizeToPinyinWords(text),
  };
}
