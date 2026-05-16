import { detectSpamHeuristics } from '@/ml/heuristics';
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
  const replyContext = buildReplyModelContext(reply.authorName, reply.text);
  const heuristic = detectSpamHeuristics(replyContext.raw);
  const tokenIds = await tokensToIds(tokenizeCleanedPinyin(replyContext.normalized));
  const modelScore = heuristic.score >= 3 ? null : await predictSpamScore(tokenIds);
  const decision: SpamDecision = {
    ...heuristic,
    label: heuristic.label === 1 || (modelScore ?? 0) >= settings.modelThreshold ? 1 : 0,
    modelConfidence: modelScore ?? undefined,
    cleanedPinyin: replyContext.normalized,
  };

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

function buildReplyModelContext(authorName: string, replyText: string): { raw: string; normalized: string } {
  const prefix = authorName.trim();
  return {
    raw: prefix ? `${prefix}:${replyText}` : replyText,
    normalized: normalizeReplyToPinyinWords(authorName, replyText),
  };
}