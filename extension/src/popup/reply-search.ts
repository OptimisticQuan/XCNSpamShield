import type { ExtractedReplyView, ThreadGroupView } from '@/shared/types';

export function normalizeReplyIdQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function filterThreadGroupsByReplyId(threadGroups: ThreadGroupView[], query: string): ThreadGroupView[] {
  const normalizedQuery = normalizeReplyIdQuery(query);
  if (!normalizedQuery) {
    return threadGroups;
  }

  return threadGroups.filter((group) => group.replies.some((reply) => reply.replyId.toLowerCase().includes(normalizedQuery)));
}

export function filterRepliesByReplyId(replies: ExtractedReplyView[], query: string): ExtractedReplyView[] {
  const normalizedQuery = normalizeReplyIdQuery(query);
  if (!normalizedQuery) {
    return replies;
  }

  return replies.filter((reply) => reply.replyId.toLowerCase().includes(normalizedQuery));
}