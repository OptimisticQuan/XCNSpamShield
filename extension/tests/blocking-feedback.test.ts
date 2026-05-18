import { describe, expect, it } from 'vitest';

import {
  formatAuthorHandle,
  getQueueBlockFailureFeedback,
  getQueueBlockFeedback,
} from '@/content/blocking-feedback';

describe('blocking feedback', () => {
  it('normalizes author handles for toast messages', () => {
    expect(formatAuthorHandle('foo')).toBe('@foo');
    expect(formatAuthorHandle('@bar')).toBe('@bar');
    expect(formatAuthorHandle('  baz  ')).toBe('@baz');
  });

  it('maps queue-block actions to stable feedback copy', () => {
    expect(getQueueBlockFeedback('foo', 'queued')).toEqual({
      tone: 'success',
      message: '已将 @foo 加入拉黑队列',
    });
    expect(getQueueBlockFeedback('foo', 'already-queued')).toEqual({
      tone: 'info',
      message: '@foo 已在拉黑队列中',
    });
    expect(getQueueBlockFeedback('foo', 'replaced-unblock')).toEqual({
      tone: 'success',
      message: '已将 @foo 切回拉黑队列',
    });
    expect(getQueueBlockFeedback('foo', 'noop')).toEqual({
      tone: 'info',
      message: '@foo 当前无需重复处理',
    });
  });

  it('returns an error toast copy for failed requests', () => {
    expect(getQueueBlockFailureFeedback('foo')).toEqual({
      tone: 'error',
      message: '@foo 处理失败，请稍后重试',
    });
  });
});