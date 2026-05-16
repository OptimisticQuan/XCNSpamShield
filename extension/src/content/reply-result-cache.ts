import type { LabelSource, ReplyRecord, SpamLabel } from '@/shared/types';

export const CONTENT_REPLY_RESULT_CACHE_LIMIT = 10_000;

export interface CachedReplyResult {
  label: SpamLabel;
  source: LabelSource;
  modelConfidence?: number;
  isPersisted: boolean;
}

export class ReplyResultCache {
  private readonly cache = new Map<string, CachedReplyResult>();

  constructor(private readonly limit: number = CONTENT_REPLY_RESULT_CACHE_LIMIT) {}

  get(replyId: string): CachedReplyResult | undefined {
    const cachedResult = this.cache.get(replyId);
    if (!cachedResult) {
      return undefined;
    }

    this.cache.delete(replyId);
    this.cache.set(replyId, cloneCachedReplyResult(cachedResult));
    return cloneCachedReplyResult(cachedResult);
  }

  set(replyId: string, result: CachedReplyResult): void {
    if (!replyId) {
      return;
    }

    if (this.cache.has(replyId)) {
      this.cache.delete(replyId);
    }

    this.cache.set(replyId, cloneCachedReplyResult(result));

    while (this.cache.size > this.limit) {
      const oldestReplyId = this.cache.keys().next().value;
      if (!oldestReplyId) {
        break;
      }

      this.cache.delete(oldestReplyId);
    }
  }

  delete(replyId: string): void {
    this.cache.delete(replyId);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export function cachedReplyResultFromRecord(reply: ReplyRecord, isPersisted: boolean): CachedReplyResult {
  return {
    label: reply.label,
    source: reply.source,
    modelConfidence: reply.modelConfidence,
    isPersisted,
  };
}

export function resolveCachedReplyResult(result: CachedReplyResult, modelThreshold: number): CachedReplyResult {
  if (result.source === 'manual' || typeof result.modelConfidence !== 'number') {
    return cloneCachedReplyResult(result);
  }

  return {
    ...cloneCachedReplyResult(result),
    label: result.modelConfidence >= modelThreshold ? 1 : 0,
  };
}

function cloneCachedReplyResult(result: CachedReplyResult): CachedReplyResult {
  return {
    ...result,
  };
}