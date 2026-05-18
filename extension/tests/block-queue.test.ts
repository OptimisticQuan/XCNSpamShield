import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  addBlockLog: vi.fn(async (entry) => entry),
  deleteBlockQueueItem: vi.fn(async () => {}),
  getAuthorSpamSummary: vi.fn(async () => null),
  getBlockQueueItem: vi.fn(async () => null),
  getLatestSuccessfulBlockLog: vi.fn(async () => null),
  getNextBlockQueueRunAt: vi.fn(async () => null),
  listBlockQueueItems: vi.fn(async () => []),
  listBlockingOverview: vi.fn(async () => ({
    queue: { items: [], page: 1, pageSize: 4, total: 0, totalPages: 1 },
    logs: { items: [], page: 1, pageSize: 4, total: 0, totalPages: 1 },
    isProcessing: false,
    nextRunAt: null,
  })),
  putBlockQueueItem: vi.fn(async (item) => item),
}));

vi.mock('@/storage/db', () => storageMocks);
vi.mock('@/background/x-account-actions', () => ({
  blockAccountByScreenName: vi.fn(async () => {}),
  unblockAccountByScreenName: vi.fn(async () => {}),
}));

import { getReplyBlockingStates, queueBlockAuthor } from '@/background/block-queue';

describe('block queue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storageMocks.addBlockLog.mockClear();
    storageMocks.deleteBlockQueueItem.mockClear();
    storageMocks.getAuthorSpamSummary.mockReset();
    storageMocks.getBlockQueueItem.mockReset();
    storageMocks.getLatestSuccessfulBlockLog.mockReset();
    storageMocks.getNextBlockQueueRunAt.mockReset();
    storageMocks.listBlockQueueItems.mockReset();
    storageMocks.listBlockingOverview.mockClear();
    storageMocks.putBlockQueueItem.mockReset();

    storageMocks.getAuthorSpamSummary.mockResolvedValue(null);
    storageMocks.getBlockQueueItem.mockResolvedValue(null);
    storageMocks.getLatestSuccessfulBlockLog.mockResolvedValue(null);
    storageMocks.getNextBlockQueueRunAt.mockResolvedValue(null);
    storageMocks.listBlockQueueItems.mockResolvedValue([]);
    storageMocks.putBlockQueueItem.mockImplementation(async (item) => item);

    vi.stubGlobal('chrome', {
      alarms: {
        create: vi.fn(async () => {}),
        clear: vi.fn(async () => true),
        onAlarm: {
          addListener: vi.fn(),
        },
      },
    });
  });

  it('requeues a manual block request even after a previous successful block log exists', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_717_000_000_000);
    storageMocks.getLatestSuccessfulBlockLog.mockResolvedValue({
      id: 1,
      author: 'repeat_author',
      authorName: 'Repeat Author',
      action: 'block',
      status: 'success',
      createdAt: 1_716_999_000_000,
      message: '已自动拉黑 @repeat_author',
      spamReplyCount: 2,
    });

    const result = await queueBlockAuthor('repeat_author', 'Repeat Author', 'reply-1');

    expect(result).toEqual({
      queued: true,
      active: true,
      action: 'queued',
    });
    expect(storageMocks.putBlockQueueItem).toHaveBeenCalledTimes(1);
    expect(storageMocks.putBlockQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        author: 'repeat_author',
        authorName: 'Repeat Author',
        action: 'block',
        state: 'queued',
        spamReplyCount: 1,
        spamReplyIds: ['reply-1'],
      }),
    );
  });

  it('merges a newly queued reply id into an already queued block item', async () => {
    storageMocks.getBlockQueueItem.mockResolvedValue({
      author: 'repeat_author',
      authorName: 'Repeat Author',
      action: 'block',
      state: 'queued',
      queuedAt: 1,
      updatedAt: 1,
      nextRunAt: 2,
      attemptCount: 0,
      spamReplyCount: 1,
      spamReplyIds: ['reply-1'],
    });

    const result = await queueBlockAuthor('repeat_author', 'Repeat Author', 'reply-2');

    expect(result).toEqual({
      queued: false,
      active: true,
      action: 'already-queued',
    });
    expect(storageMocks.putBlockQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        spamReplyIds: ['reply-1', 'reply-2'],
      }),
    );
  });

  it('resolves queued and blocked reply states from queue items and latest logs', async () => {
    storageMocks.getBlockQueueItem.mockImplementation(async (author: string) => {
      if (author === 'queued_author') {
        return {
          author,
          authorName: 'Queued Author',
          action: 'block',
          state: 'queued',
          queuedAt: 1,
          updatedAt: 1,
          nextRunAt: 2,
          attemptCount: 0,
          spamReplyCount: 1,
          spamReplyIds: ['reply-queued'],
        };
      }

      return null;
    });
    storageMocks.getLatestSuccessfulBlockLog.mockImplementation(async (author: string) => {
      if (author === 'blocked_author') {
        return {
          id: 2,
          author,
          authorName: 'Blocked Author',
          action: 'block',
          status: 'success',
          createdAt: 2,
          message: 'blocked',
          spamReplyCount: 1,
          spamReplyIds: ['reply-blocked'],
        };
      }

      return null;
    });

    const states = await getReplyBlockingStates([
      { replyId: 'reply-queued', author: 'queued_author' },
      { replyId: 'reply-blocked', author: 'blocked_author' },
      { replyId: 'reply-none', author: 'none_author' },
    ]);

    expect(states).toEqual([
      { replyId: 'reply-queued', author: 'queued_author', state: 'queued' },
      { replyId: 'reply-blocked', author: 'blocked_author', state: 'blocked' },
      { replyId: 'reply-none', author: 'none_author', state: 'none' },
    ]);
  });
});