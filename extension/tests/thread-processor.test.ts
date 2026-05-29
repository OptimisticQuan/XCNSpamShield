import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvatarOcrExecutionResult } from '@/shared/avatar-ocr';

const mocks = vi.hoisted(() => ({
  predictSpamScore: vi.fn<() => Promise<number | null>>(),
  resolveAvatarOcrResult: vi.fn<() => Promise<AvatarOcrExecutionResult | undefined>>(),
  normalizeReplyToPinyinWords: vi.fn(() => 'tou xiang wen an : zhu ye neng da'),
  tokensToIds: vi.fn(async () => [2, 3, 4, 5]),
}));

vi.mock('@/background/avatar-ocr', () => ({
  resolveAvatarOcrResult: mocks.resolveAvatarOcrResult,
}));

vi.mock('@/ml/model-loader', () => ({
  predictSpamScore: mocks.predictSpamScore,
}));

vi.mock('@/ml/tokenizer', () => ({
  normalizeReplyToPinyinWords: mocks.normalizeReplyToPinyinWords,
  tokenizeCleanedPinyin: vi.fn(() => ['[CLS]', 'zhu', 'ye', 'neng', 'da', '[SEP]']),
  tokensToIds: mocks.tokensToIds,
}));

import { clearCachedReplyDecisions } from '@/background/reply-decision-cache';
import { evaluateCollectedThread } from '@/background/thread-processor';
import type { CollectedThreadPayload, ExtensionSettings } from '@/shared/types';

const settings: ExtensionSettings = {
  blockingEnabled: true,
  showFloatingCaptureButton: false,
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
      avatarImageUrl: 'https://pbs.twimg.com/profile_images/example_normal.jpg',
      text: '主页能打✈️ @aybek98',
      timestamp: 2,
    },
  ],
};

describe('thread processor', () => {
  beforeEach(() => {
    clearCachedReplyDecisions();
    mocks.predictSpamScore.mockReset();
    mocks.resolveAvatarOcrResult.mockReset();
    mocks.normalizeReplyToPinyinWords.mockClear();
    mocks.tokensToIds.mockClear();
  });

  it('keeps rule-like text as ham when the model score is below threshold', async () => {
    mocks.predictSpamScore.mockResolvedValue(0.31);

    const [reply] = await evaluateCollectedThread(payload, settings);

    expect(reply.label).toBe(0);
    expect(reply.avatarOcrText).toBeUndefined();
    expect(reply.matchedRules).toEqual([]);
    expect(reply.modelConfidence).toBe(0.31);
    expect(mocks.resolveAvatarOcrResult).not.toHaveBeenCalled();
    expect(mocks.normalizeReplyToPinyinWords).toHaveBeenCalledWith('回复人', '主页能打✈️ @aybek98', undefined);
  });

  it('marks reply as spam only when the model score crosses threshold', async () => {
    mocks.predictSpamScore.mockResolvedValue(0.33);

    const [reply] = await evaluateCollectedThread(payload, settings);

    expect(reply.label).toBe(1);
    expect(reply.modelConfidence).toBe(0.33);
  });

  it('reuses cached scores for the same reply id and reapplies the latest threshold', async () => {
    mocks.predictSpamScore.mockResolvedValue(0.33);

    const [firstReply] = await evaluateCollectedThread(payload, settings);
    const [secondReply] = await evaluateCollectedThread(payload, {
      ...settings,
      modelThreshold: 0.5,
    });

    expect(firstReply.label).toBe(1);
    expect(secondReply.label).toBe(0);
    expect(secondReply.modelConfidence).toBe(0.33);
    expect(mocks.predictSpamScore).toHaveBeenCalledTimes(1);
    expect(mocks.tokensToIds).toHaveBeenCalledTimes(1);
  });

  it('reruns inference with avatar OCR text when recheck is requested and confidence is high', async () => {
    mocks.predictSpamScore.mockResolvedValueOnce(0.31).mockResolvedValueOnce(0.61);
    mocks.resolveAvatarOcrResult.mockResolvedValue({
      avatarImageUrl: 'https://pbs.twimg.com/profile_images/example_normal.jpg',
      avatarOcrText: '头像文案',
      rawText: '头像文案',
      ocrConfidence: 0.91,
      imageLoadDurationMs: 18,
      source: 'worker-run',
      durationMs: 210,
      queueDepthAtStart: 0,
    });

    const [firstReply] = await evaluateCollectedThread(payload, settings);
    const [secondReply] = await evaluateCollectedThread({
      ...payload,
      replies: payload.replies.map((reply) => ({
        ...reply,
        avatarImageDataUrl: 'data:image/png;base64,avatar',
        avatarImageLoadDurationMs: 18,
        forceAvatarOcrRecheck: true,
      })),
    }, settings);

    expect(firstReply.label).toBe(0);
    expect(secondReply.label).toBe(1);
    expect(secondReply.avatarOcrText).toBe('头像文案');
    expect(secondReply.modelConfidence).toBe(0.61);
    expect(mocks.resolveAvatarOcrResult).toHaveBeenCalledWith({
      avatarImageUrl: 'https://pbs.twimg.com/profile_images/example_normal.jpg',
      avatarImageDataUrl: 'data:image/png;base64,avatar',
      avatarImageLoadDurationMs: 18,
    });
    expect(mocks.predictSpamScore).toHaveBeenCalledTimes(2);
    expect(mocks.normalizeReplyToPinyinWords).toHaveBeenNthCalledWith(2, '回复人', '主页能打✈️ @aybek98', '头像文案');
  });

  it('keeps the cached first-pass result when avatar OCR confidence is too low', async () => {
    mocks.predictSpamScore.mockResolvedValue(0.31);
    mocks.resolveAvatarOcrResult.mockResolvedValue({
      avatarImageUrl: 'https://pbs.twimg.com/profile_images/example_normal.jpg',
      avatarOcrText: '头像文案',
      rawText: '头像文案',
      ocrConfidence: 0.49,
      imageLoadDurationMs: 18,
      source: 'worker-run',
      durationMs: 210,
      queueDepthAtStart: 0,
    });

    const [firstReply] = await evaluateCollectedThread(payload, settings);
    const [secondReply] = await evaluateCollectedThread({
      ...payload,
      replies: payload.replies.map((reply) => ({
        ...reply,
        avatarImageDataUrl: 'data:image/png;base64,avatar',
        avatarImageLoadDurationMs: 18,
        forceAvatarOcrRecheck: true,
      })),
    }, settings);

    expect(firstReply.label).toBe(0);
    expect(secondReply.label).toBe(0);
    expect(secondReply.avatarOcrText).toBeUndefined();
    expect(secondReply.modelConfidence).toBe(0.31);
    expect(mocks.predictSpamScore).toHaveBeenCalledTimes(1);
    expect(mocks.tokensToIds).toHaveBeenCalledTimes(1);
  });
});