import { getCachedReplyDecision, setCachedReplyDecision } from '@/background/reply-decision-cache';
import { predictSpamScore } from '@/ml/model-loader';
import { normalizeReplyToPinyinWords, tokenizeCleanedPinyin, tokensToIds } from '@/ml/tokenizer';
import type {
  CollectedReply,
  CollectedThreadPayload,
  ExtensionSettings,
  ExtractedThreadPayload,
  ManualReplyPayload,
  ReplyRecord,
  SpamDecision,
} from '@/shared/types';

export interface ReplyDecisionTraceContext {
  requestId: string;
  requestType: string;
  requestStartedAt: number;
  replyCount: number;
}

let activeReplyDecisionCount = 0;

export async function evaluateCollectedThread(
  payload: CollectedThreadPayload,
  settings: ExtensionSettings,
  traceContext?: ReplyDecisionTraceContext,
): Promise<ReplyRecord[]> {
  return evaluateCollectedReplies(payload.threadId, payload.replies, settings, traceContext);
}

export async function evaluateCollectedReplies(
  threadId: string,
  replies: CollectedReply[],
  settings: ExtensionSettings,
  traceContext?: ReplyDecisionTraceContext,
): Promise<ReplyRecord[]> {
  return Promise.all(replies.map((reply) => buildReplyRecord(threadId, reply, settings, traceContext)));
}

export async function processCollectedThread(
  payload: CollectedThreadPayload,
  settings: ExtensionSettings,
  traceContext?: ReplyDecisionTraceContext,
): Promise<ExtractedThreadPayload> {
  return {
    threadId: payload.threadId,
    mainPost: payload.mainPost,
    replies: await evaluateCollectedReplies(payload.threadId, payload.replies, settings, traceContext),
  };
}

export async function buildManualReplyRecord(
  payload: ManualReplyPayload,
  _settings: ExtensionSettings,
  _traceContext?: ReplyDecisionTraceContext,
): Promise<ReplyRecord> {
  return {
    threadId: payload.threadId,
    replyId: payload.reply.replyId,
    author: payload.reply.author,
    authorName: payload.reply.authorName,
    originalText: payload.reply.text,
    cleanedPinyin: payload.cleanedPinyin,
    label: payload.label,
    source: 'manual',
    extractTime: Date.now(),
    matchedRules: [],
    modelConfidence: payload.modelConfidence,
  };
}

async function buildReplyRecord(
  threadId: string,
  reply: CollectedReply,
  settings: ExtensionSettings,
  traceContext?: ReplyDecisionTraceContext,
): Promise<ReplyRecord> {
  const decision = await buildReplyDecision(reply, settings.modelThreshold, traceContext);

  return {
    threadId,
    replyId: reply.replyId,
    author: reply.author,
    authorName: reply.authorName,
    originalText: reply.text,
    cleanedPinyin: decision.cleanedPinyin || undefined,
    label: decision.label,
    source: decision.source,
    extractTime: Date.now(),
    matchedRules: decision.matchedRules,
    modelConfidence: decision.modelConfidence,
  };
}

async function buildReplyDecision(
  reply: CollectedReply,
  modelThreshold: number,
  traceContext?: ReplyDecisionTraceContext,
): Promise<SpamDecision> {
  const decisionStartedAt = performance.now();
  const queueWaitMs = traceContext ? decisionStartedAt - traceContext.requestStartedAt : 0;
  const activeDecisionsAtStart = activeReplyDecisionCount;
  let cacheReadMs = 0;
  let featurePrepMs = 0;
  let inferenceMs = 0;
  let decisionPath: 'cache' | 'inference' = 'cache';
  let finalDecision: SpamDecision | undefined;
  let errorMessage: string | undefined;

  activeReplyDecisionCount += 1;

  try {
    const cacheLookupStartedAt = performance.now();
    const cachedDecision = getCachedReplyDecision(reply.replyId);
    cacheReadMs = performance.now() - cacheLookupStartedAt;
    if (cachedDecision) {
      finalDecision = resolveCachedDecision(cachedDecision, modelThreshold);
      return finalDecision;
    }

    decisionPath = 'inference';
    const featurePrepStartedAt = performance.now();
    const cleanedPinyin = buildReplyModelContext(reply.authorName, reply.text);
    const tokenIds = await tokensToIds(tokenizeCleanedPinyin(cleanedPinyin));
    featurePrepMs = performance.now() - featurePrepStartedAt;

    const inferenceStartedAt = performance.now();
    const modelScore = await predictSpamScore(tokenIds);
    inferenceMs = performance.now() - inferenceStartedAt;
    finalDecision = buildAutoDecision(cleanedPinyin, modelScore, modelThreshold);

    setCachedReplyDecision(reply.replyId, finalDecision);
    return finalDecision;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw error;
  } finally {
    activeReplyDecisionCount -= 1;
    logReplyDecisionTrace({
      traceContext,
      replyId: reply.replyId,
      modelThreshold,
      decisionPath,
      queueWaitMs,
      cacheReadMs,
      featurePrepMs,
      inferenceMs,
      decisionStartedAt,
      activeDecisionsAtStart,
      finalDecision,
      errorMessage,
    });
  }
}

function resolveCachedDecision(cachedDecision: SpamDecision, modelThreshold: number): SpamDecision {
  if (cachedDecision.source === 'manual') {
    return {
      ...cachedDecision,
      matchedRules: [],
    };
  }

  return buildAutoDecision(cachedDecision.cleanedPinyin, cachedDecision.modelConfidence ?? null, modelThreshold);
}

function buildAutoDecision(cleanedPinyin: string, modelScore: number | null, modelThreshold: number): SpamDecision {
  return {
    label: (modelScore ?? 0) >= modelThreshold ? 1 : 0,
    source: 'auto',
    matchedRules: [],
    modelConfidence: modelScore ?? undefined,
    cleanedPinyin,
  };
}

function buildReplyModelContext(authorName: string, replyText: string): string {
  return normalizeReplyToPinyinWords(authorName, replyText);
}

function logReplyDecisionTrace({
  traceContext,
  replyId,
  modelThreshold,
  decisionPath,
  queueWaitMs,
  cacheReadMs,
  featurePrepMs,
  inferenceMs,
  decisionStartedAt,
  activeDecisionsAtStart,
  finalDecision,
  errorMessage,
}: {
  traceContext?: ReplyDecisionTraceContext;
  replyId: string;
  modelThreshold: number;
  decisionPath: 'cache' | 'inference';
  queueWaitMs: number;
  cacheReadMs: number;
  featurePrepMs: number;
  inferenceMs: number;
  decisionStartedAt: number;
  activeDecisionsAtStart: number;
  finalDecision?: SpamDecision;
  errorMessage?: string;
}): void {
  if (!traceContext) {
    return;
  }

  const logEndedAt = performance.now();
  console.info('[XSpamShield][reply-decision]', {
    requestId: traceContext.requestId,
    requestType: traceContext.requestType,
    replyCountInRequest: traceContext.replyCount,
    replyId,
    decisionPath,
    queueWaitMs: roundDuration(queueWaitMs),
    cacheReadMs: roundDuration(cacheReadMs),
    featurePrepMs: roundDuration(featurePrepMs),
    inferenceMs: roundDuration(inferenceMs),
    totalDecisionMs: roundDuration(logEndedAt - decisionStartedAt),
    totalSinceRequestMs: roundDuration(logEndedAt - traceContext.requestStartedAt),
    activeDecisionsAtStart,
    threshold: roundScore(modelThreshold),
    label: finalDecision?.label,
    source: finalDecision?.source,
    modelConfidence: finalDecision?.modelConfidence === undefined ? undefined : roundScore(finalDecision.modelConfidence),
    error: errorMessage,
  });
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}