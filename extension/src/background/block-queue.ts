import {
  AUTHOR_SCORE_BLOCK_THRESHOLD,
  BLOCK_QUEUE_ALARM_NAME,
  BLOCK_QUEUE_DELAY_MS,
  BLOCK_QUEUE_RETRY_DELAY_MS,
  BLOCKING_OVERVIEW_PAGE_SIZE,
} from '@/shared/constants';
import { normalizeModerationAuthor, shouldAutoQueueAuthor } from '@/shared/author-moderation';
import type { BlockingOverview, ReplyBlockingState, ReplyBlockingStatus, ReplyBlockingTarget, ReplyRecord } from '@/shared/types';
import {
  addBlockLog,
  deleteAuthorState,
  deleteBlockQueueItem,
  getAuthorSpamSummaryByIdentity,
  getAuthorStates,
  getBlockQueueItem,
  getLatestSuccessfulBlockLog,
  getNextBlockQueueRunAt,
  listBlockLogEntries,
  listBlockQueueItems,
  listBlockingOverview,
  putBlockQueueItem,
  type StoredAuthorState,
  type StoredBlockLogEntry,
  type StoredBlockQueueItem,
} from '@/storage/db';

import { blockAccountByScreenName, unblockAccountByScreenName } from '@/background/x-account-actions';

let blockQueueProcessingPromise: Promise<void> | null = null;
let blockQueueAlarmListenerRegistered = false;

export function initializeBlockQueueProcessing(): void {
  ensureBlockQueueAlarmListener();
  void scheduleBlockQueueAlarm();
  void processDueBlockQueueItem();
}

export async function refreshAutoBlockQueueForReplies(
  replies: Array<Pick<ReplyRecord, 'authorId' | 'author' | 'authorName' | 'replyId'>>,
): Promise<void> {
  const uniqueReplies = dedupeRepliesByAuthorIdentity(replies);
  const authorStates = await getAuthorStates(uniqueReplies.map((reply) => reply.author));
  const authorStatesByAuthor = new Map(authorStates.map((authorState) => [authorState.author, authorState]));

  for (const reply of uniqueReplies) {
    await refreshAutoBlockQueueForReply(reply, authorStatesByAuthor.get(normalizeAuthor(reply.author)) ?? null);
  }

  await scheduleBlockQueueAlarm();
}

export async function getQueuedBlockAuthors(authors: string[]): Promise<string[]> {
  const uniqueAuthors = Array.from(new Set(authors.map(normalizeAuthor).filter(Boolean)));
  if (uniqueAuthors.length === 0) {
    return [];
  }

  const queueItems = await Promise.all(uniqueAuthors.map((author) => getBlockQueueItem(author)));
  return uniqueAuthors.filter((author, index) => queueItems[index]?.action === 'block');
}

export async function getReplyBlockingStates(replies: ReplyBlockingTarget[]): Promise<ReplyBlockingStatus[]> {
  const normalizedReplies = replies
    .map((reply) => ({
      replyId: reply.replyId.trim(),
      authorId: normalizeAuthorId(reply.authorId),
      author: normalizeAuthor(reply.author),
    }))
    .filter((reply) => reply.replyId && (reply.author || reply.authorId));

  if (normalizedReplies.length === 0) {
    return [];
  }

  const [queueItems, blockLogs, authorStates] = await Promise.all([
    listBlockQueueItems(),
    listBlockLogEntries(),
    getAuthorStates(normalizedReplies.map((reply) => reply.author)),
  ]);

  const queueItemsByAuthor = new Map<string, StoredBlockQueueItem>();
  const queueItemsByAuthorId = new Map<string, StoredBlockQueueItem>();
  for (const queueItem of queueItems) {
    if (!queueItemsByAuthor.has(queueItem.author)) {
      queueItemsByAuthor.set(queueItem.author, queueItem);
    }
    if (queueItem.authorId && !queueItemsByAuthorId.has(queueItem.authorId)) {
      queueItemsByAuthorId.set(queueItem.authorId, queueItem);
    }
  }

  const latestLogsByAuthor = new Map<string, StoredBlockLogEntry>();
  const latestLogsByAuthorId = new Map<string, StoredBlockLogEntry>();
  for (const logEntry of blockLogs) {
    if (logEntry.status !== 'success') {
      continue;
    }

    if (!latestLogsByAuthor.has(logEntry.author)) {
      latestLogsByAuthor.set(logEntry.author, logEntry);
    }
    if (logEntry.authorId && !latestLogsByAuthorId.has(logEntry.authorId)) {
      latestLogsByAuthorId.set(logEntry.authorId, logEntry);
    }
  }

  const authorStatesByAuthor = new Map(authorStates.map((authorState) => [authorState.author, authorState]));

  return normalizedReplies.map((reply) => ({
    ...reply,
    state: resolveReplyBlockingState(
      reply,
      resolveIdentityMatch(reply, queueItemsByAuthor, queueItemsByAuthorId),
      resolveIdentityMatch(reply, latestLogsByAuthor, latestLogsByAuthorId),
      reply.author ? authorStatesByAuthor.get(reply.author) ?? null : null,
    ),
  }));
}

export async function queueBlockAuthor(
  author: string,
  authorName?: string,
  authorId?: string,
  replyId?: string,
): Promise<{ queued: boolean; active: boolean; action: 'queued' | 'already-queued' | 'replaced-unblock' | 'noop' }> {
  const normalizedAuthor = normalizeAuthor(author);
  const normalizedAuthorId = normalizeAuthorId(authorId);
  if (!normalizedAuthor) {
    return { queued: false, active: false, action: 'noop' };
  }

  const existing = await getBlockQueueItem(normalizedAuthor);
  if (existing?.action === 'block') {
    await putBlockQueueItem({
      ...existing,
      authorId: normalizedAuthorId || existing.authorId,
      authorName: authorName || existing.authorName,
      spamReplyIds: mergeReplyIds(existing.spamReplyIds, replyId),
      updatedAt: Date.now(),
    });
    if (normalizedAuthor) {
      await deleteAuthorState(normalizedAuthor);
    }
    return { queued: false, active: true, action: 'already-queued' };
  }

  if (existing?.action === 'unblock') {
    await cancelBlockQueueAuthor(normalizedAuthor);
  }

  const summary = await getAuthorSpamSummaryByIdentity(normalizedAuthorId, normalizedAuthor);
  const queuedAt = Date.now();
  await putBlockQueueItem({
    author: normalizedAuthor,
    authorId: normalizedAuthorId,
    authorName: authorName || summary?.authorName || normalizedAuthor,
    action: 'block',
    state: 'queued',
    queuedAt,
    updatedAt: queuedAt,
    nextRunAt: await reserveNextRunAt(queuedAt),
    attemptCount: 0,
    spamReplyCount: summary?.spamReplyCount ?? 1,
    spamReplyIds: mergeReplyIds(summary?.spamReplyIds, replyId),
  });
  if (normalizedAuthor) {
    await deleteAuthorState(normalizedAuthor);
  }
  await scheduleBlockQueueAlarm();
  return {
    queued: true,
    active: true,
    action: existing?.action === 'unblock' ? 'replaced-unblock' : 'queued',
  };
}

export async function cancelBlockQueueAuthor(author: string): Promise<boolean> {
  const normalizedAuthor = normalizeAuthor(author);
  if (!normalizedAuthor) {
    return false;
  }

  const existing = await getBlockQueueItem(normalizedAuthor);
  if (!existing) {
    return false;
  }

  await deleteBlockQueueItem(normalizedAuthor);
  await addBlockLog({
    author: existing.author,
    authorId: existing.authorId,
    authorName: existing.authorName,
    action: existing.action,
    status: 'cancelled',
    createdAt: Date.now(),
    message: existing.action === 'block' ? '已从自动拉黑队列移出' : '已取消排队中的撤销拉黑操作',
    spamReplyCount: existing.spamReplyCount,
    spamReplyIds: existing.spamReplyIds,
  });
  await scheduleBlockQueueAlarm();
  return true;
}

export async function queueUnblockAuthor(author: string): Promise<{ queued: boolean; action: 'cancelled' | 'queued' | 'noop' }> {
  const normalizedAuthor = normalizeAuthor(author);
  if (!normalizedAuthor) {
    return { queued: false, action: 'noop' };
  }

  const existing = await getBlockQueueItem(normalizedAuthor);
  if (existing?.action === 'block') {
    await cancelBlockQueueAuthor(normalizedAuthor);
    return { queued: false, action: 'cancelled' };
  }

  if (existing?.action === 'unblock') {
    return { queued: false, action: 'noop' };
  }

  const latestSuccessfulLog = await getLatestSuccessfulBlockLog(normalizedAuthor);
  if (!latestSuccessfulLog || latestSuccessfulLog.action !== 'block') {
    return { queued: false, action: 'noop' };
  }

  const queuedAt = Date.now();
  await putBlockQueueItem({
    author: normalizedAuthor,
    authorId: latestSuccessfulLog.authorId,
    authorName: latestSuccessfulLog.authorName || normalizedAuthor,
    action: 'unblock',
    state: 'queued',
    queuedAt,
    updatedAt: queuedAt,
    nextRunAt: await reserveNextRunAt(queuedAt),
    attemptCount: 0,
    spamReplyCount: latestSuccessfulLog.spamReplyCount,
    spamReplyIds: [],
  });
  await scheduleBlockQueueAlarm();
  return { queued: true, action: 'queued' };
}

export async function getBlockingOverviewData(
  queuePage: number = 1,
  logPage: number = 1,
  pageSize: number = BLOCKING_OVERVIEW_PAGE_SIZE,
): Promise<BlockingOverview> {
  return listBlockingOverview(
    queuePage,
    logPage,
    pageSize,
    Boolean(blockQueueProcessingPromise),
    await getNextBlockQueueRunAt(),
  );
}

async function refreshAutoBlockQueueForReply(
  reply: Pick<ReplyRecord, 'authorId' | 'author' | 'authorName' | 'replyId'>,
  authorState: StoredAuthorState | null,
): Promise<void> {
  const normalizedAuthor = normalizeAuthor(reply.author);
  if (!normalizedAuthor) {
    return;
  }

  const normalizedAuthorId = normalizeAuthorId(reply.authorId);
  const existing = await getBlockQueueItem(normalizedAuthor);

  if (authorState?.isWhitelisted) {
    if (existing?.action === 'block') {
      await cancelBlockQueueAuthor(normalizedAuthor);
    }
    return;
  }

  if (!authorState || !shouldAutoQueueAuthor(authorState.score)) {
    return;
  }

  const latestSuccessfulLog = await getLatestSuccessfulBlockLog(normalizedAuthor);
  if (latestSuccessfulLog?.action === 'block') {
    if (existing?.action === 'block') {
      await deleteBlockQueueItem(normalizedAuthor);
    }
    return;
  }

  const summary = await getAuthorSpamSummaryByIdentity(normalizedAuthorId, normalizedAuthor);
  if (existing) {
    if (existing.action !== 'block') {
      return;
    }

    await putBlockQueueItem({
      ...existing,
      authorId: normalizedAuthorId || existing.authorId,
      authorName: reply.authorName || authorState.authorName || summary?.authorName || existing.authorName,
      updatedAt: Date.now(),
      spamReplyCount: summary?.spamReplyCount ?? Math.max(existing.spamReplyCount, AUTHOR_SCORE_BLOCK_THRESHOLD),
      spamReplyIds: mergeReplyIds(existing.spamReplyIds, ...(summary?.spamReplyIds ?? []), reply.replyId),
    });
    return;
  }

  const queuedAt = Date.now();
  await putBlockQueueItem({
    author: normalizedAuthor,
    authorId: normalizedAuthorId,
    authorName: reply.authorName || authorState.authorName || summary?.authorName || normalizedAuthor,
    action: 'block',
    state: 'queued',
    queuedAt,
    updatedAt: queuedAt,
    nextRunAt: await reserveNextRunAt(queuedAt),
    attemptCount: 0,
    spamReplyCount: summary?.spamReplyCount ?? AUTHOR_SCORE_BLOCK_THRESHOLD,
    spamReplyIds: mergeReplyIds(summary?.spamReplyIds, reply.replyId),
  });
}

async function reserveNextRunAt(queuedAt: number): Promise<number> {
  const queueItems = await listBlockQueueItems();
  const lastScheduledAt = queueItems.at(-1)?.nextRunAt ?? 0;
  return Math.max(queuedAt + BLOCK_QUEUE_DELAY_MS, lastScheduledAt + BLOCK_QUEUE_DELAY_MS);
}

function ensureBlockQueueAlarmListener(): void {
  if (blockQueueAlarmListenerRegistered) {
    return;
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== BLOCK_QUEUE_ALARM_NAME) {
      return;
    }

    void processDueBlockQueueItem();
  });

  blockQueueAlarmListenerRegistered = true;
}

async function scheduleBlockQueueAlarm(): Promise<void> {
  const nextRunAt = await getNextBlockQueueRunAt();
  if (!nextRunAt) {
    await chrome.alarms.clear(BLOCK_QUEUE_ALARM_NAME);
    return;
  }

  await chrome.alarms.create(BLOCK_QUEUE_ALARM_NAME, {
    when: Math.max(Date.now() + 250, nextRunAt),
  });
}

async function processDueBlockQueueItem(): Promise<void> {
  if (blockQueueProcessingPromise) {
    return blockQueueProcessingPromise;
  }

  blockQueueProcessingPromise = runNextDueBlockQueueItem().finally(() => {
    blockQueueProcessingPromise = null;
  });
  return blockQueueProcessingPromise;
}

async function runNextDueBlockQueueItem(): Promise<void> {
  const nextItem = (await listBlockQueueItems())[0];
  if (!nextItem) {
    await chrome.alarms.clear(BLOCK_QUEUE_ALARM_NAME);
    return;
  }

  if (nextItem.nextRunAt > Date.now()) {
    await scheduleBlockQueueAlarm();
    return;
  }

  const processingItem: StoredBlockQueueItem = {
    ...nextItem,
    state: 'processing',
    updatedAt: Date.now(),
    lastError: undefined,
  };
  await putBlockQueueItem(processingItem);

  try {
    if (processingItem.action === 'block') {
      await blockAccountByScreenName(processingItem.author);
    } else {
      await unblockAccountByScreenName(processingItem.author);
    }

    await deleteBlockQueueItem(processingItem.author);
    await addBlockLog({
      author: processingItem.author,
      authorId: processingItem.authorId,
      authorName: processingItem.authorName,
      action: processingItem.action,
      status: 'success',
      createdAt: Date.now(),
      message:
        processingItem.action === 'block'
          ? `已自动拉黑 @${processingItem.author}`
          : `已撤销 @${processingItem.author} 的拉黑`,
      spamReplyCount: processingItem.spamReplyCount,
      spamReplyIds: processingItem.spamReplyIds,
    });

    if (processingItem.action === 'block') {
      await deleteAuthorState(processingItem.author);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await putBlockQueueItem({
      ...processingItem,
      state: 'failed',
      updatedAt: Date.now(),
      nextRunAt: Date.now() + BLOCK_QUEUE_RETRY_DELAY_MS,
      attemptCount: processingItem.attemptCount + 1,
      lastError: errorMessage,
    });
    await addBlockLog({
      author: processingItem.author,
      authorId: processingItem.authorId,
      authorName: processingItem.authorName,
      action: processingItem.action,
      status: 'failed',
      createdAt: Date.now(),
      message:
        processingItem.action === 'block'
          ? `自动拉黑 @${processingItem.author} 失败`
          : `撤销 @${processingItem.author} 的拉黑失败`,
      spamReplyCount: processingItem.spamReplyCount,
      spamReplyIds: processingItem.spamReplyIds,
      errorMessage,
    });
  } finally {
    await scheduleBlockQueueAlarm();
  }
}

function normalizeAuthor(author: string): string {
  return normalizeModerationAuthor(author) ?? '';
}

function normalizeAuthorId(authorId?: string): string | undefined {
  const normalizedAuthorId = authorId?.trim();
  return normalizedAuthorId || undefined;
}

function resolveReplyBlockingState(
  reply: ReplyBlockingTarget,
  queueItem: StoredBlockQueueItem | null,
  latestSuccessfulLog: StoredBlockLogEntry | null,
  authorState: StoredAuthorState | null,
): ReplyBlockingState {
  if (queueItem?.action === 'block') {
    return 'queued';
  }

  if (latestSuccessfulLog?.action === 'block') {
    return 'blocked';
  }

  if (queueItem?.spamReplyIds.includes(reply.replyId)) {
    return 'none';
  }

  if (authorState?.isWhitelisted) {
    return 'whitelisted';
  }

  return 'none';
}

function resolveIdentityMatch<T extends { author: string; authorId?: string }>(
  reply: ReplyBlockingTarget,
  matchesByAuthor: Map<string, T>,
  matchesByAuthorId: Map<string, T>,
): T | null {
  const normalizedAuthorId = normalizeAuthorId(reply.authorId);
  if (normalizedAuthorId && matchesByAuthorId.has(normalizedAuthorId)) {
    return matchesByAuthorId.get(normalizedAuthorId) ?? null;
  }

  const normalizedAuthor = normalizeAuthor(reply.author);
  if (normalizedAuthor && matchesByAuthor.has(normalizedAuthor)) {
    return matchesByAuthor.get(normalizedAuthor) ?? null;
  }

  return null;
}

function dedupeRepliesByAuthorIdentity(
  replies: Array<Pick<ReplyRecord, 'authorId' | 'author' | 'authorName' | 'replyId'>>,
): Array<Pick<ReplyRecord, 'authorId' | 'author' | 'authorName' | 'replyId'>> {
  const repliesByAuthor = new Map<string, Pick<ReplyRecord, 'authorId' | 'author' | 'authorName' | 'replyId'>>();

  for (const reply of replies) {
    const normalizedAuthorId = normalizeAuthorId(reply.authorId);
    const normalizedAuthor = normalizeAuthor(reply.author);
    const key = normalizedAuthor || normalizedAuthorId;
    if (!key) {
      continue;
    }

    repliesByAuthor.set(key, {
      ...reply,
      authorId: normalizedAuthorId,
      author: normalizedAuthor,
    });
  }

  return Array.from(repliesByAuthor.values());
}

function mergeReplyIds(replyIds: Iterable<string> | undefined, ...extraReplyIds: Array<string | undefined>): string[] {
  const nextReplyIds = new Set<string>();

  for (const replyId of replyIds ?? []) {
    const normalizedReplyId = replyId.trim();
    if (normalizedReplyId) {
      nextReplyIds.add(normalizedReplyId);
    }
  }

  for (const replyId of extraReplyIds) {
    const normalizedReplyId = replyId?.trim();
    if (normalizedReplyId) {
      nextReplyIds.add(normalizedReplyId);
    }
  }

  return Array.from(nextReplyIds);
}