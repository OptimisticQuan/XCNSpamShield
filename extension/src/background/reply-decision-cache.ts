import type { ReplyRecord, SpamDecision } from '@/shared/types';

export const REPLY_DECISION_CACHE_LIMIT = 10_000;

const replyDecisionCache = new Map<string, SpamDecision>();

export function getCachedReplyDecision(replyId: string): SpamDecision | undefined {
  const cachedDecision = replyDecisionCache.get(replyId);
  if (!cachedDecision) {
    return undefined;
  }

  replyDecisionCache.delete(replyId);
  replyDecisionCache.set(replyId, cloneDecision(cachedDecision));
  return cloneDecision(cachedDecision);
}

export function setCachedReplyDecision(replyId: string, decision: SpamDecision): void {
  if (!replyId) {
    return;
  }

  if (replyDecisionCache.has(replyId)) {
    replyDecisionCache.delete(replyId);
  }

  replyDecisionCache.set(replyId, cloneDecision(decision));

  while (replyDecisionCache.size > REPLY_DECISION_CACHE_LIMIT) {
    const oldestReplyId = replyDecisionCache.keys().next().value;
    if (!oldestReplyId) {
      break;
    }

    replyDecisionCache.delete(oldestReplyId);
  }
}

export function syncCachedReplyDecision(reply: ReplyRecord): void {
  setCachedReplyDecision(reply.replyId, {
    label: reply.label,
    source: reply.source,
    matchedRules: [],
    cleanedPinyin: reply.cleanedPinyin,
    modelConfidence: reply.modelConfidence,
  });
}

export function deleteCachedReplyDecision(replyId: string): void {
  replyDecisionCache.delete(replyId);
}

export function clearCachedReplyDecisions(): void {
  replyDecisionCache.clear();
}

export function getCachedReplyDecisionSize(): number {
  return replyDecisionCache.size;
}

function cloneDecision(decision: SpamDecision): SpamDecision {
  return {
    ...decision,
    matchedRules: [...decision.matchedRules],
  };
}