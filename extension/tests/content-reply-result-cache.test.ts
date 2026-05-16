import { describe, expect, it } from 'vitest';

import {
  cachedReplyResultFromRecord,
  ReplyResultCache,
  resolveCachedReplyResult,
} from '@/content/reply-result-cache';
import type { ReplyRecord } from '@/shared/types';

describe('content reply result cache', () => {
  it('evicts the least recently used reply result', () => {
    const cache = new ReplyResultCache(2);
    cache.set('reply-1', { label: 0, source: 'auto', modelConfidence: 0.1, isPersisted: false });
    cache.set('reply-2', { label: 1, source: 'auto', modelConfidence: 0.9, isPersisted: false });
    expect(cache.get('reply-1')?.modelConfidence).toBe(0.1);

    cache.set('reply-3', { label: 1, source: 'manual', isPersisted: true });

    expect(cache.get('reply-1')?.modelConfidence).toBe(0.1);
    expect(cache.get('reply-2')).toBeUndefined();
    expect(cache.get('reply-3')?.source).toBe('manual');
  });

  it('recomputes auto labels from model confidence and current threshold', () => {
    expect(resolveCachedReplyResult({ label: 1, source: 'auto', modelConfidence: 0.42, isPersisted: false }, 0.5).label).toBe(0);
    expect(resolveCachedReplyResult({ label: 1, source: 'manual', modelConfidence: 0.42, isPersisted: true }, 0.5).label).toBe(1);
  });

  it('shrinks stored records to only the in-page decision fields', () => {
    const reply: ReplyRecord = {
      threadId: 'thread-1',
      replyId: 'reply-1',
      author: 'reply',
      authorName: '回复人',
      originalText: 'hello',
      cleanedPinyin: 'ni hao',
      label: 1,
      source: 'manual',
      extractTime: 1,
      matchedRules: [],
      modelConfidence: 0.8,
    };

    expect(cachedReplyResultFromRecord(reply, true)).toEqual({
      label: 1,
      source: 'manual',
      modelConfidence: 0.8,
      isPersisted: true,
    });
  });
});