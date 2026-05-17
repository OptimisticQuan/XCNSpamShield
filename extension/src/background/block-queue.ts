import {
  AUTO_BLOCK_MIN_SPAM_REPLIES,
  BLOCK_QUEUE_ALARM_NAME,
  BLOCK_QUEUE_DELAY_MS,
  BLOCK_QUEUE_RETRY_DELAY_MS,
  BLOCKING_OVERVIEW_PAGE_SIZE,
} from '@/shared/constants';
import type { BlockingOverview } from '@/shared/types';
import {
  addBlockLog,
  deleteBlockQueueItem,
  getAuthorSpamSummary,
  getBlockQueueItem,
  getLatestSuccessfulBlockLog,
  getNextBlockQueueRunAt,
  listBlockQueueItems,
  listBlockingOverview,
  putBlockQueueItem,
  type AuthorSpamSummary,
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

export async function refreshAutoBlockQueueForAuthors(authors: string[]): Promise<void> {
  const uniqueAuthors = Array.from(new Set(authors.map(normalizeAuthor).filter(Boolean)));
  for (const author of uniqueAuthors) {
    await refreshAutoBlockQueueForAuthor(author);
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

export async function queueBlockAuthor(
  author: string,
  authorName?: string,
  replyId?: string,
): Promise<{ queued: boolean; active: boolean; action: 'queued' | 'already-queued' | 'replaced-unblock' | 'noop' }> {
  const normalizedAuthor = normalizeAuthor(author);
  if (!normalizedAuthor) {
    return { queued: false, active: false, action: 'noop' };
  }

  const existing = await getBlockQueueItem(normalizedAuthor);
  if (existing?.action === 'block') {
    await putBlockQueueItem({
      ...existing,
      authorName: authorName || existing.authorName,
      updatedAt: Date.now(),
    });
    return { queued: false, active: true, action: 'already-queued' };
  }

  if (existing?.action === 'unblock') {
    await cancelBlockQueueAuthor(normalizedAuthor);
  }

  const latestSuccessfulLog = await getLatestSuccessfulBlockLog(normalizedAuthor);
  if (latestSuccessfulLog?.action === 'block') {
    return { queued: false, active: false, action: 'noop' };
  }

  const summary = await getAuthorSpamSummary(normalizedAuthor);
  const queuedAt = Date.now();
  await putBlockQueueItem({
    author: normalizedAuthor,
    authorName: authorName || summary?.authorName || normalizedAuthor,
    action: 'block',
    state: 'queued',
    queuedAt,
    updatedAt: queuedAt,
    nextRunAt: await reserveNextRunAt(queuedAt),
    attemptCount: 0,
    spamReplyCount: summary?.spamReplyCount ?? 1,
    spamReplyIds: summary?.spamReplyIds ?? (replyId ? [replyId] : []),
  });
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
    authorName: existing.authorName,
    action: existing.action,
    status: 'cancelled',
    createdAt: Date.now(),
    message: existing.action === 'block' ? '已从自动拉黑队列移出' : '已取消排队中的撤销拉黑操作',
    spamReplyCount: existing.spamReplyCount,
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

async function refreshAutoBlockQueueForAuthor(author: string): Promise<void> {
  const summary = await getAuthorSpamSummary(author);
  const existing = await getBlockQueueItem(author);

  if (!summary || summary.spamReplyCount < AUTO_BLOCK_MIN_SPAM_REPLIES) {
    if (existing?.action === 'block') {
      await cancelBlockQueueAuthor(author);
    }
    return;
  }

  const latestSuccessfulLog = await getLatestSuccessfulBlockLog(author);
  if (!shouldAutoQueueBlock(summary, latestSuccessfulLog?.action ?? null, latestSuccessfulLog?.createdAt ?? 0)) {
    if (existing?.action === 'block' && latestSuccessfulLog?.action === 'block') {
      await deleteBlockQueueItem(author);
    }
    return;
  }

  if (existing) {
    if (existing.action !== 'block') {
      return;
    }

    await putBlockQueueItem({
      ...existing,
      authorName: summary.authorName,
      updatedAt: Date.now(),
      spamReplyCount: summary.spamReplyCount,
      spamReplyIds: summary.spamReplyIds,
    });
    return;
  }

  const queuedAt = Date.now();
  await putBlockQueueItem({
    author,
    authorName: summary.authorName,
    action: 'block',
    state: 'queued',
    queuedAt,
    updatedAt: queuedAt,
    nextRunAt: await reserveNextRunAt(queuedAt),
    attemptCount: 0,
    spamReplyCount: summary.spamReplyCount,
    spamReplyIds: summary.spamReplyIds,
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
      authorName: processingItem.authorName,
      action: processingItem.action,
      status: 'success',
      createdAt: Date.now(),
      message:
        processingItem.action === 'block'
          ? `已自动拉黑 @${processingItem.author}`
          : `已撤销 @${processingItem.author} 的拉黑`,
      spamReplyCount: processingItem.spamReplyCount,
    });
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
      authorName: processingItem.authorName,
      action: processingItem.action,
      status: 'failed',
      createdAt: Date.now(),
      message:
        processingItem.action === 'block'
          ? `自动拉黑 @${processingItem.author} 失败`
          : `撤销 @${processingItem.author} 的拉黑失败`,
      spamReplyCount: processingItem.spamReplyCount,
      errorMessage,
    });
  } finally {
    await scheduleBlockQueueAlarm();
  }
}

export function shouldAutoQueueBlock(
  summary: AuthorSpamSummary,
  latestSuccessfulAction: 'block' | 'unblock' | null,
  latestSuccessfulActionAt: number,
): boolean {
  if (summary.spamReplyCount < AUTO_BLOCK_MIN_SPAM_REPLIES) {
    return false;
  }

  if (latestSuccessfulAction === 'block') {
    return false;
  }

  if (latestSuccessfulAction === 'unblock' && summary.latestSpamExtractTime <= latestSuccessfulActionAt) {
    return false;
  }

  return true;
}

function normalizeAuthor(author: string): string {
  return author.trim().replace(/^@/u, '');
}