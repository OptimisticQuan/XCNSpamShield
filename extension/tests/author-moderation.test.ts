import { describe, expect, it } from 'vitest';

import {
  buildAuthorScoreDeltas,
  getReplyScoreContribution,
  normalizeModerationAuthor,
  shouldAutoQueueAuthor,
  shouldWhitelistAuthor,
} from '@/shared/author-moderation';

describe('author moderation', () => {
  it('treats spam as +1 and ham as -1', () => {
    expect(getReplyScoreContribution(1)).toBe(1);
    expect(getReplyScoreContribution(0)).toBe(-1);
  });

  it('builds score deltas for new, relabeled, and removed replies', () => {
    expect(buildAuthorScoreDeltas(null, { author: '@spam_handle', label: 1 })).toEqual([{ author: 'spam_handle', delta: 1 }]);
    expect(buildAuthorScoreDeltas({ author: 'spam_handle', label: 1 }, { author: '@spam_handle', label: 0 })).toEqual([{ author: 'spam_handle', delta: -2 }]);
    expect(buildAuthorScoreDeltas({ author: 'spam_handle', label: 0 }, null)).toEqual([{ author: 'spam_handle', delta: 1 }]);
  });

  it('normalizes handles by trimming and removing the leading at sign', () => {
    expect(normalizeModerationAuthor(' @ExampleHandle ')).toBe('ExampleHandle');
    expect(normalizeModerationAuthor('')).toBeUndefined();
    expect(normalizeModerationAuthor('unknown')).toBeUndefined();
  });

  it('derives auto-block and whitelist thresholds from score', () => {
    expect(shouldAutoQueueAuthor(3)).toBe(true);
    expect(shouldAutoQueueAuthor(2)).toBe(false);
    expect(shouldWhitelistAuthor(-3)).toBe(true);
    expect(shouldWhitelistAuthor(-2)).toBe(false);
  });
});