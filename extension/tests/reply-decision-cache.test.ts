import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearCachedReplyDecisions,
  getCachedReplyDecision,
  getCachedReplyDecisionSize,
  REPLY_DECISION_CACHE_LIMIT,
  setCachedReplyDecision,
  syncCachedReplyDecision,
} from '@/background/reply-decision-cache';
import type { ReplyRecord } from '@/shared/types';

describe('reply decision cache', () => {
  beforeEach(() => {
    clearCachedReplyDecisions();
  });

  it('evicts the least recently used reply once the limit is exceeded', () => {
    for (let index = 0; index < REPLY_DECISION_CACHE_LIMIT; index += 1) {
      setCachedReplyDecision(`reply-${index}`, {
        label: 0,
        source: 'auto',
        matchedRules: [],
        cleanedPinyin: `cleaned-${index}`,
        modelConfidence: index / REPLY_DECISION_CACHE_LIMIT,
      });
    }

    expect(getCachedReplyDecisionSize()).toBe(REPLY_DECISION_CACHE_LIMIT);
    expect(getCachedReplyDecision('reply-0')?.cleanedPinyin).toBe('cleaned-0');

    setCachedReplyDecision(`reply-${REPLY_DECISION_CACHE_LIMIT}`, {
      label: 1,
      source: 'auto',
      matchedRules: [],
      cleanedPinyin: 'cleaned-new',
      modelConfidence: 0.99,
    });

    expect(getCachedReplyDecision('reply-0')?.cleanedPinyin).toBe('cleaned-0');
    expect(getCachedReplyDecision('reply-1')).toBeUndefined();
    expect(getCachedReplyDecisionSize()).toBe(REPLY_DECISION_CACHE_LIMIT);
  });

  it('overwrites the cached decision when a reply is manually relabeled', () => {
    const reply: ReplyRecord = {
      threadId: 'thread-1',
      replyId: 'reply-1',
      author: 'reply',
      authorName: '回复人',
      originalText: '主页能打✈️ @aybek98',
      cleanedPinyin: 'zhu ye neng da',
      label: 1,
      source: 'manual',
      extractTime: 1,
      matchedRules: [],
      modelConfidence: 0.18,
    };

    syncCachedReplyDecision(reply);

    expect(getCachedReplyDecision('reply-1')).toEqual({
      label: 1,
      source: 'manual',
      matchedRules: [],
      cleanedPinyin: 'zhu ye neng da',
      avatarOcrText: undefined,
      modelConfidence: 0.18,
    });
  });
});