import { AUTHOR_SCORE_BLOCK_THRESHOLD, AUTHOR_SCORE_WHITELIST_THRESHOLD } from '@/shared/constants';
import type { SpamLabel } from '@/shared/types';

export interface ReplyScoreInput {
  author?: string;
  label: SpamLabel;
}

export function normalizeModerationAuthor(author?: string): string | undefined {
  const normalizedAuthor = author?.trim().replace(/^@/u, '');
  if (!normalizedAuthor || normalizedAuthor === 'unknown') {
    return undefined;
  }

  return normalizedAuthor;
}

export function getReplyScoreContribution(label: SpamLabel): number {
  return label === 1 ? 1 : -1;
}

export function buildAuthorScoreDeltas(
  previousReply: ReplyScoreInput | null,
  nextReply: ReplyScoreInput | null,
): Array<{ author: string; delta: number }> {
  const deltas = new Map<string, number>();

  applyReplyScoreDelta(deltas, previousReply, -1);
  applyReplyScoreDelta(deltas, nextReply, 1);

  return Array.from(deltas.entries())
    .filter(([, delta]) => delta !== 0)
    .map(([author, delta]) => ({ author, delta }));
}

export function shouldAutoQueueAuthor(score: number): boolean {
  return score >= AUTHOR_SCORE_BLOCK_THRESHOLD;
}

export function shouldWhitelistAuthor(score: number): boolean {
  return score <= AUTHOR_SCORE_WHITELIST_THRESHOLD;
}

function applyReplyScoreDelta(
  deltas: Map<string, number>,
  reply: ReplyScoreInput | null,
  direction: 1 | -1,
): void {
  if (!reply) {
    return;
  }

  const author = normalizeModerationAuthor(reply.author);
  if (!author) {
    return;
  }

  const contribution = getReplyScoreContribution(reply.label) * direction;
  deltas.set(author, (deltas.get(author) ?? 0) + contribution);
}