import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  predictSpamScore: vi.fn<() => Promise<number | null>>(),
  tokensToIds: vi.fn(async () => [2, 3, 4, 5]),
}));

vi.mock('@/ml/model-loader', () => ({
  predictSpamScore: mocks.predictSpamScore,
}));

vi.mock('@/ml/tokenizer', () => ({
  normalizeReplyToPinyinWords: vi.fn(() => 'zhu ye neng da'),
  tokenizeCleanedPinyin: vi.fn(() => ['[CLS]', 'zhu', 'ye', 'neng', 'da', '[SEP]']),
  tokensToIds: mocks.tokensToIds,
}));

import { evaluateCollectedThread } from '@/background/thread-processor';
import type { CollectedThreadPayload, ExtensionSettings } from '@/shared/types';

const settings: ExtensionSettings = {
  blockingEnabled: true,
  modelThreshold: 0.32,
  updatedAt: 1,
  floatingCapturePosition: {
    xRatio: 1,
    yRatio: 1,
  },
};

const payload: CollectedThreadPayload = {
  threadId: 'thread-1',
  mainPost: {
    author: 'main',
    text: 'main text',
    timestamp: 1,
  },
  replies: [
    {
      replyId: 'reply-1',
      author: 'reply',
      authorName: '回复人',
      text: '主页能打✈️ @aybek98',
      timestamp: 2,
    },
  ],
};

describe('thread processor', () => {
  beforeEach(() => {
    mocks.predictSpamScore.mockReset();
    mocks.tokensToIds.mockClear();
  });

  it('keeps rule-like text as ham when the model score is below threshold', async () => {
    mocks.predictSpamScore.mockResolvedValue(0.31);

    const [reply] = await evaluateCollectedThread(payload, settings);

    expect(reply.label).toBe(0);
    expect(reply.matchedRules).toEqual([]);
    expect(reply.modelConfidence).toBe(0.31);
  });

  it('marks reply as spam only when the model score crosses threshold', async () => {
    mocks.predictSpamScore.mockResolvedValue(0.33);

    const [reply] = await evaluateCollectedThread(payload, settings);

    expect(reply.label).toBe(1);
    expect(reply.modelConfidence).toBe(0.33);
  });
});