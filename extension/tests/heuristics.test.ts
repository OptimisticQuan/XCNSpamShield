import { describe, expect, it } from 'vitest';

import { detectSpamHeuristics } from '@/ml/heuristics';

describe('heuristics', () => {
  it('flags handle-and-flight style spam as spam', () => {
    const decision = detectSpamHeuristics('主页能打✈️ @aybek98');
    expect(decision.label).toBe(1);
    expect(decision.matchedRules).toContain('home-page-flight');
  });

  it('keeps normal cat comments as ham', () => {
    const decision = detectSpamHeuristics('很可爱的猫咪');
    expect(decision.label).toBe(0);
  });
});
