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

export async function evaluateCollectedThread(
  payload: CollectedThreadPayload,
  settings: ExtensionSettings,
): Promise<ReplyRecord[]> {
  return Promise.all(payload.replies.map((reply) => buildReplyRecord(payload.threadId, reply, settings)));
}

export async function processCollectedThread(
  payload: CollectedThreadPayload,
  settings: ExtensionSettings,
): Promise<ExtractedThreadPayload> {
  return {
    threadId: payload.threadId,
    mainPost: payload.mainPost,
    replies: await evaluateCollectedThread(payload, settings),
  };
}

export async function buildManualReplyRecord(
  payload: ManualReplyPayload,
  settings: ExtensionSettings,
): Promise<ReplyRecord> {
  const record = await buildReplyRecord(payload.threadId, payload.reply, settings);
  return {
    ...record,
    label: payload.label,
    source: 'manual',
    extractTime: Date.now(),
  };
}

async function buildReplyRecord(
  threadId: string,
  reply: CollectedReply,
  settings: ExtensionSettings,
): Promise<ReplyRecord> {
  const decision = await buildReplyDecision(reply, settings.modelThreshold);

  return {
    threadId,
    replyId: reply.replyId,
    author: reply.author,
    authorName: reply.authorName,
    originalText: reply.text,
    cleanedPinyin: decision.cleanedPinyin,
    label: decision.label,
    source: decision.source,
    extractTime: Date.now(),
    matchedRules: decision.matchedRules,
    modelConfidence: decision.modelConfidence,
  };
}

async function buildReplyDecision(reply: CollectedReply, modelThreshold: number): Promise<SpamDecision> {
  const cachedDecision = getCachedReplyDecision(reply.replyId);
  if (cachedDecision) {
    return resolveCachedDecision(cachedDecision, modelThreshold);
  }

  const cleanedPinyin = buildReplyModelContext(reply.authorName, reply.text);
  const tokenIds = await tokensToIds(tokenizeCleanedPinyin(cleanedPinyin));
  const modelScore = await predictSpamScore(tokenIds);
  const decision = buildAutoDecision(cleanedPinyin, modelScore, modelThreshold);

  setCachedReplyDecision(reply.replyId, decision);
  return decision;
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