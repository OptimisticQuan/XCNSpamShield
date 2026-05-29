import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { normalizeReplyToPinyinWords } from '@/ml/tokenizer';
import { buildAuthorScoreDeltas, normalizeModerationAuthor, shouldWhitelistAuthor } from '@/shared/author-moderation';
import { AUTHOR_STATE_CACHE_LIMIT, BLOCKING_OVERVIEW_PAGE_SIZE, DB_NAME, DB_VERSION, DEFAULT_SETTINGS, SETTINGS_KEY } from '@/shared/constants';
import type {
  BlockActionLogView,
  BlockingOverview,
  BlockLogStatus,
  BlockQueueAction,
  BlockQueueItemView,
  BlockQueueState,
  ExportPayload,
  ExportThread,
  ExtensionSettings,
  ExtractedReplyView,
  ExtractedThreadPayload,
  MainPostRecord,
  ReplyRecord,
  ThreadGroupView,
  ThreadRecord,
} from '@/shared/types';

const LEGACY_DB_NAME = 'xspamshield-db';

interface ThreadStoreRecord extends ThreadRecord {
  createdAt: number;
}

interface SettingStoreRecord {
  key: string;
  value: ExtensionSettings;
}

export interface StoredBlockQueueItem {
  author: string;
  authorId?: string;
  authorName: string;
  action: BlockQueueAction;
  state: BlockQueueState;
  queuedAt: number;
  updatedAt: number;
  nextRunAt: number;
  attemptCount: number;
  spamReplyCount: number;
  spamReplyIds: string[];
  lastError?: string;
}

export interface StoredBlockLogEntry {
  id?: number;
  author: string;
  authorId?: string;
  authorName: string;
  action: BlockQueueAction;
  status: BlockLogStatus;
  createdAt: number;
  message: string;
  spamReplyCount: number;
  spamReplyIds?: string[];
  errorMessage?: string;
}

export interface AuthorSpamSummary {
  author: string;
  authorId?: string;
  authorName: string;
  spamReplyCount: number;
  spamReplyIds: string[];
  latestSpamExtractTime: number;
}

export interface StoredAuthorState {
  author: string;
  authorName: string;
  score: number;
  isWhitelisted: boolean;
  updatedAt: number;
}

interface AuthorStateStoreLike {
  get(key: string): Promise<StoredAuthorState | undefined>;
  put(value: StoredAuthorState): Promise<unknown>;
  delete(key: string): Promise<void>;
  index(name: 'by-updated-at'): {
    getAll(): Promise<StoredAuthorState[]>;
  };
}

interface XCNSpamShieldDatabase extends DBSchema {
  threads: {
    key: string;
    value: ThreadStoreRecord;
  };
  replies: {
    key: string;
    value: ReplyRecord;
    indexes: {
      'by-thread': string;
      'by-extract-time': number;
      'by-author': string;
      'by-author-id': string;
    };
  };
  settings: {
    key: string;
    value: SettingStoreRecord;
  };
  blockQueue: {
    key: string;
    value: StoredBlockQueueItem;
    indexes: {
      'by-next-run': number;
      'by-state-next-run': [BlockQueueState, number];
    };
  };
  blockLogs: {
    key: number;
    value: StoredBlockLogEntry;
    indexes: {
      'by-created-at': number;
      'by-author': string;
    };
  };
  authorStates: {
    key: string;
    value: StoredAuthorState;
    indexes: {
      'by-updated-at': number;
    };
  };
}

let databasePromise: Promise<IDBPDatabase<XCNSpamShieldDatabase>> | undefined;

function getDatabase(): Promise<IDBPDatabase<XCNSpamShieldDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<XCNSpamShieldDatabase>(DB_NAME, DB_VERSION, {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          database.createObjectStore('threads', { keyPath: 'threadId' });

          const replyStore = database.createObjectStore('replies', { keyPath: 'replyId' });
          replyStore.createIndex('by-thread', 'threadId');
          replyStore.createIndex('by-extract-time', 'extractTime');
          replyStore.createIndex('by-author', 'author');
          replyStore.createIndex('by-author-id', 'authorId');

          database.createObjectStore('settings', { keyPath: 'key' });

          const blockQueueStore = database.createObjectStore('blockQueue', { keyPath: 'author' });
          blockQueueStore.createIndex('by-next-run', 'nextRunAt');
          blockQueueStore.createIndex('by-state-next-run', ['state', 'nextRunAt']);

          const blockLogStore = database.createObjectStore('blockLogs', { keyPath: 'id', autoIncrement: true });
          blockLogStore.createIndex('by-created-at', 'createdAt');
          blockLogStore.createIndex('by-author', 'author');

          const authorStateStore = database.createObjectStore('authorStates', { keyPath: 'author' });
          authorStateStore.createIndex('by-updated-at', 'updatedAt');
        }

        if (oldVersion < 2) {
          const replyStore = transaction.objectStore('replies');
          if (!replyStore.indexNames.contains('by-author')) {
            replyStore.createIndex('by-author', 'author');
          }

          if (!database.objectStoreNames.contains('blockQueue')) {
            const blockQueueStore = database.createObjectStore('blockQueue', { keyPath: 'author' });
            blockQueueStore.createIndex('by-next-run', 'nextRunAt');
            blockQueueStore.createIndex('by-state-next-run', ['state', 'nextRunAt']);
          }

          if (!database.objectStoreNames.contains('blockLogs')) {
            const blockLogStore = database.createObjectStore('blockLogs', { keyPath: 'id', autoIncrement: true });
            blockLogStore.createIndex('by-created-at', 'createdAt');
            blockLogStore.createIndex('by-author', 'author');
          }
        }

        if (oldVersion < 3) {
          const replyStore = transaction.objectStore('replies');
          if (!replyStore.indexNames.contains('by-author-id')) {
            replyStore.createIndex('by-author-id', 'authorId');
          }

          if (!database.objectStoreNames.contains('authorStates')) {
            const authorStateStore = database.createObjectStore('authorStates', { keyPath: 'author' });
            authorStateStore.createIndex('by-updated-at', 'updatedAt');
          }
        }

        if (oldVersion < 4) {
          const replyStore = transaction.objectStore('replies');
          if (database.objectStoreNames.contains('authorStates')) {
            database.deleteObjectStore('authorStates');
          }

          const authorStateStore = database.createObjectStore('authorStates', { keyPath: 'author' });
          authorStateStore.createIndex('by-updated-at', 'updatedAt');

          const replies = (await replyStore.getAll()) as ReplyRecord[];
          await rebuildAuthorStatesFromReplies(authorStateStore, replies);
        }
      },
    }).then(async (database) => {
      await migrateLegacyDatabaseIfNeeded(database);
      return database;
    });
  }

  return databasePromise;
}

async function migrateLegacyDatabaseIfNeeded(database: IDBPDatabase<XCNSpamShieldDatabase>): Promise<void> {
  if (!(await legacyDatabaseExists()) || !(await isDatabaseEmpty(database))) {
    return;
  }

  const legacyDatabase = await openDB<XCNSpamShieldDatabase>(LEGACY_DB_NAME);

  try {
    const [threads, replies, settings, blockQueue, blockLogs] = await Promise.all([
      legacyDatabase.getAll('threads'),
      legacyDatabase.getAll('replies'),
      legacyDatabase.getAll('settings'),
      legacyDatabase.getAll('blockQueue'),
      legacyDatabase.getAll('blockLogs'),
    ]);

    if (threads.length + replies.length + settings.length + blockQueue.length + blockLogs.length === 0) {
      return;
    }

    const transaction = database.transaction(['threads', 'replies', 'settings', 'blockQueue', 'blockLogs'], 'readwrite');

    for (const thread of threads) {
      await transaction.objectStore('threads').put(thread);
    }

    for (const reply of replies) {
      await transaction.objectStore('replies').put(reply);
    }

    for (const setting of settings) {
      await transaction.objectStore('settings').put(setting);
    }

    for (const queueItem of blockQueue) {
      await transaction.objectStore('blockQueue').put(queueItem);
    }

    for (const logEntry of blockLogs) {
      await transaction.objectStore('blockLogs').put(logEntry);
    }

    await transaction.done;
  } finally {
    legacyDatabase.close();
  }
}

async function legacyDatabaseExists(): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') {
    return false;
  }

  const databases = await indexedDB.databases();
  return databases.some((database) => database.name === LEGACY_DB_NAME);
}

async function isDatabaseEmpty(database: IDBPDatabase<XCNSpamShieldDatabase>): Promise<boolean> {
  const counts = await Promise.all([
    database.count('threads'),
    database.count('replies'),
    database.count('settings'),
    database.count('blockQueue'),
    database.count('blockLogs'),
    database.count('authorStates'),
  ]);

  return counts.every((count) => count === 0);
}

export async function getSettings(): Promise<ExtensionSettings> {
  const database = await getDatabase();
  const record = await database.get('settings', SETTINGS_KEY);

  if (record) {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      ...record.value,
      floatingCapturePosition: {
        ...DEFAULT_SETTINGS.floatingCapturePosition,
        ...record.value.floatingCapturePosition,
      },
    };

    if (record.value.modelThreshold === 0.85 || record.value.modelThreshold === 0.32) {
      nextSettings.modelThreshold = DEFAULT_SETTINGS.modelThreshold;
      await database.put('settings', { key: SETTINGS_KEY, value: nextSettings });
    }

    return nextSettings;
  }

  await database.put('settings', { key: SETTINGS_KEY, value: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export async function setBlockingEnabled(enabled: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    blockingEnabled: enabled,
    updatedAt: Date.now(),
  };
  const database = await getDatabase();
  await database.put('settings', { key: SETTINGS_KEY, value: next });
  return next;
}

export async function setShowFloatingCaptureButton(enabled: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    showFloatingCaptureButton: enabled,
    updatedAt: Date.now(),
  };
  const database = await getDatabase();
  await database.put('settings', { key: SETTINGS_KEY, value: next });
  return next;
}

export async function setFloatingCapturePosition(position: ExtensionSettings['floatingCapturePosition']): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    floatingCapturePosition: position,
    updatedAt: Date.now(),
  };
  const database = await getDatabase();
  await database.put('settings', { key: SETTINGS_KEY, value: next });
  return next;
}

export async function upsertThreadPayload(
  payload: ExtractedThreadPayload,
): Promise<{ savedReplies: number; replies: ReplyRecord[] }> {
  const database = await getDatabase();
  const transaction = database.transaction(['threads', 'replies', 'authorStates'], 'readwrite');
  const uniqueReplies = dedupeReplies(payload.replies);
  const existingThread = await transaction.objectStore('threads').get(payload.threadId);
  const mergedReplies: ReplyRecord[] = [];
  const authorStateDeltas = new Map<string, { delta: number; author: string; authorName: string }>();

  const threadRecord = mergeThreadRecord(existingThread, payload);
  await transaction.objectStore('threads').put(threadRecord);

  for (const reply of uniqueReplies) {
    const existing = await transaction.objectStore('replies').get(reply.replyId);
    const nextReply = mergeReply(existing, reply);
    await transaction.objectStore('replies').put(nextReply);
    mergedReplies.push(nextReply);
    accumulateAuthorStateDelta(authorStateDeltas, existing, nextReply);
  }

  await applyAuthorStateDeltas(transaction.objectStore('authorStates'), authorStateDeltas);

  await transaction.done;
  return {
    savedReplies: uniqueReplies.length,
    replies: mergedReplies.map((reply) => sanitizeReplyRecord(reply)),
  };
}

export async function upsertReplyRecords(replies: ReplyRecord[]): Promise<ReplyRecord[]> {
  const uniqueReplies = dedupeReplies(replies);
  if (uniqueReplies.length === 0) {
    return [];
  }

  const database = await getDatabase();
  const transaction = database.transaction(['replies', 'authorStates'], 'readwrite');
  const mergedReplies: ReplyRecord[] = [];
  const authorStateDeltas = new Map<string, { delta: number; author: string; authorName: string }>();

  for (const reply of uniqueReplies) {
    const existing = await transaction.objectStore('replies').get(reply.replyId);
    const nextReply = mergeReply(existing, reply);
    await transaction.objectStore('replies').put(nextReply);
    mergedReplies.push(nextReply);
    accumulateAuthorStateDelta(authorStateDeltas, existing, nextReply);
  }

  await applyAuthorStateDeltas(transaction.objectStore('authorStates'), authorStateDeltas);
  await transaction.done;

  return mergedReplies.map((reply) => sanitizeReplyRecord(reply));
}

function dedupeReplies(replies: ReplyRecord[]): ReplyRecord[] {
  return Array.from(new Map(replies.map((reply) => [reply.replyId, reply])).values());
}

function mergeThreadRecord(
  existing: ThreadStoreRecord | undefined,
  incoming: ExtractedThreadPayload,
): ThreadStoreRecord {
  return {
    threadId: incoming.threadId,
    mainPost: mergeMainPostRecord(existing?.mainPost, incoming.mainPost),
    createdAt: existing?.createdAt ?? Date.now(),
  };
}

function mergeMainPostRecord(existing: MainPostRecord | undefined, incoming: MainPostRecord): MainPostRecord {
  if (!existing) {
    return incoming;
  }

  return {
    author: incoming.author || existing.author,
    text: incoming.text || existing.text,
    timestamp: incoming.timestamp || existing.timestamp,
  };
}

function mergeReply(existing: ReplyRecord | undefined, incoming: ReplyRecord): ReplyRecord {
  const normalizedIncoming = sanitizeReplyRecord(incoming);

  if (!existing) {
    return normalizedIncoming;
  }

  const normalizedExisting = sanitizeReplyRecord(existing);

  if (normalizedExisting.source === 'manual' && normalizedIncoming.source === 'auto') {
    return {
      ...normalizedIncoming,
      label: normalizedExisting.label,
      source: normalizedExisting.source,
    };
  }

  return {
    ...normalizedExisting,
    ...normalizedIncoming,
  };
}

function sanitizeReplyRecord(reply: ReplyRecord): ReplyRecord {
  return {
    ...reply,
    authorId: reply.authorId?.trim() || undefined,
    authorName: reply.authorName || reply.author,
    avatarOcrText: reply.avatarOcrText?.trim() || undefined,
    cleanedPinyin: reply.cleanedPinyin?.trim() || undefined,
    matchedRules: [],
  };
}

function ensureReplyCleanedPinyin(reply: ReplyRecord): ReplyRecord & { cleanedPinyin: string } {
  const sanitizedReply = sanitizeReplyRecord(reply);
  if (sanitizedReply.cleanedPinyin) {
    return sanitizedReply as ReplyRecord & { cleanedPinyin: string };
  }

  return {
    ...sanitizedReply,
    cleanedPinyin: normalizeReplyToPinyinWords(
      sanitizedReply.authorName || sanitizedReply.author,
      sanitizedReply.originalText,
      sanitizedReply.avatarOcrText,
    ),
  };
}

export async function listReplies(): Promise<ExtractedReplyView[]> {
  const database = await getDatabase();
  const replies = await database.getAllFromIndex('replies', 'by-extract-time');

  return replies
    .sort((left, right) => right.extractTime - left.extractTime)
    .map((reply) => sanitizeReplyRecord(reply))
    .map((reply) => ({
      replyId: reply.replyId,
      threadId: reply.threadId,
      author: reply.author,
      authorName: reply.authorName,
      originalText: reply.originalText,
      label: reply.label,
      source: reply.source,
      extractTime: reply.extractTime,
      matchedRules: reply.matchedRules,
      modelConfidence: reply.modelConfidence,
    }));
}

export async function listThreadGroups(): Promise<ThreadGroupView[]> {
  const database = await getDatabase();
  const [threads, replies] = await Promise.all([database.getAll('threads'), database.getAll('replies')]);
  const threadRecordMap = new Map(threads.map((thread) => [thread.threadId, thread]));
  const groupedReplies = new Map<string, ExtractedReplyView[]>();

  for (const reply of replies) {
    const normalizedReply = sanitizeReplyRecord(reply);
    const existingReplies = groupedReplies.get(reply.threadId) ?? [];
    existingReplies.push({
      replyId: normalizedReply.replyId,
      threadId: normalizedReply.threadId,
      author: normalizedReply.author,
      authorName: normalizedReply.authorName,
      originalText: normalizedReply.originalText,
      label: normalizedReply.label,
      source: normalizedReply.source,
      extractTime: normalizedReply.extractTime,
      matchedRules: normalizedReply.matchedRules,
      modelConfidence: normalizedReply.modelConfidence,
    });
    groupedReplies.set(reply.threadId, existingReplies);
  }

  return Array.from(groupedReplies.entries())
    .map(([threadId, threadReplies]) => {
      const repliesByTime = threadReplies.sort((left, right) => right.extractTime - left.extractTime);
      const thread = threadRecordMap.get(threadId);

      return {
        threadId,
        mainPost: thread?.mainPost ?? createFallbackThread(threadId).main_post,
        replies: repliesByTime,
        replyCount: repliesByTime.length,
        spamCount: repliesByTime.filter((reply) => reply.label === 1).length,
        lastExtractTime: repliesByTime[0]?.extractTime ?? thread?.createdAt ?? 0,
      } satisfies ThreadGroupView;
    })
    .sort((left, right) => right.lastExtractTime - left.lastExtractTime);
}

export async function getReplyRecords(replyIds: string[]): Promise<ReplyRecord[]> {
  const uniqueReplyIds = Array.from(new Set(replyIds.filter(Boolean)));
  if (uniqueReplyIds.length === 0) {
    return [];
  }

  const database = await getDatabase();
  const transaction = database.transaction('replies', 'readonly');
  const records = await Promise.all(uniqueReplyIds.map((replyId) => transaction.store.get(replyId)));
  await transaction.done;

  return records
    .filter((reply): reply is ReplyRecord => Boolean(reply))
    .map((reply) => sanitizeReplyRecord(reply));
}

export async function getReplyRecord(replyId: string): Promise<ReplyRecord | null> {
  const database = await getDatabase();
  const reply = await database.get('replies', replyId);
  return reply ? sanitizeReplyRecord(reply) : null;
}

export async function getAuthorState(author: string): Promise<StoredAuthorState | null> {
  const normalizedAuthor = normalizeModerationAuthor(author);
  if (!normalizedAuthor) {
    return null;
  }

  const database = await getDatabase();
  return (await database.get('authorStates', normalizedAuthor)) ?? null;
}

export async function getAuthorStates(authors: string[]): Promise<StoredAuthorState[]> {
  const uniqueAuthors = Array.from(new Set(authors.map((author) => normalizeModerationAuthor(author)).filter(Boolean))) as string[];
  if (uniqueAuthors.length === 0) {
    return [];
  }

  const database = await getDatabase();
  const transaction = database.transaction('authorStates', 'readonly');
  const states = await Promise.all(uniqueAuthors.map((author) => transaction.store.get(author)));
  await transaction.done;

  return states.filter((state): state is StoredAuthorState => Boolean(state));
}

export async function deleteAuthorState(author: string): Promise<void> {
  const normalizedAuthor = normalizeModerationAuthor(author);
  if (!normalizedAuthor) {
    return;
  }

  const database = await getDatabase();
  await database.delete('authorStates', normalizedAuthor);
}

export async function getAuthorSpamSummary(author: string): Promise<AuthorSpamSummary | null> {
  return getAuthorSpamSummaryByIdentity(undefined, author);
}

export async function getAuthorSpamSummaryByIdentity(authorId?: string, author?: string): Promise<AuthorSpamSummary | null> {
  const normalizedAuthor = normalizeModerationAuthor(author);
  const normalizedAuthorId = authorId?.trim();
  if (!normalizedAuthor && !normalizedAuthorId) {
    return null;
  }

  const database = await getDatabase();
  const replies = normalizedAuthor
    ? await database.getAllFromIndex('replies', 'by-author', normalizedAuthor)
    : await database.getAllFromIndex('replies', 'by-author-id', normalizedAuthorId!);
  const spamReplies = replies
    .map((reply) => sanitizeReplyRecord(reply))
    .filter((reply) => reply.label === 1);

  if (spamReplies.length === 0) {
    return null;
  }

  const latestSpamReply = [...spamReplies].sort((left, right) => right.extractTime - left.extractTime)[0];

  return {
    author: latestSpamReply?.author ?? normalizedAuthor ?? 'unknown',
    authorId: latestSpamReply?.authorId ?? normalizedAuthorId,
    authorName: latestSpamReply?.authorName ?? latestSpamReply?.author ?? normalizedAuthor ?? 'unknown',
    spamReplyCount: spamReplies.length,
    spamReplyIds: spamReplies.map((reply) => reply.replyId),
    latestSpamExtractTime: latestSpamReply?.extractTime ?? 0,
  };
}

export async function deleteReply(replyId: string): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['replies', 'authorStates'], 'readwrite');
  const reply = await transaction.objectStore('replies').get(replyId);
  if (!reply) {
    await transaction.done;
    return;
  }

  await transaction.objectStore('replies').delete(replyId);
  const authorStateDeltas = new Map<string, { delta: number; author: string; authorName: string }>();
  accumulateAuthorStateDelta(authorStateDeltas, reply, null);
  await applyAuthorStateDeltas(transaction.objectStore('authorStates'), authorStateDeltas);
  await transaction.done;
}

export async function toggleReplyLabel(replyId: string): Promise<ReplyRecord> {
  const database = await getDatabase();
  const transaction = database.transaction(['replies', 'authorStates'], 'readwrite');
  const reply = await transaction.objectStore('replies').get(replyId);

  if (!reply) {
    throw new Error(`Reply ${replyId} was not found.`);
  }

  const normalizedReply = sanitizeReplyRecord(reply);
  const updated: ReplyRecord = {
    ...normalizedReply,
    label: normalizedReply.label === 1 ? 0 : 1,
    source: 'manual',
  };
  await transaction.objectStore('replies').put(updated);
  const authorStateDeltas = new Map<string, { delta: number; author: string; authorName: string }>();
  accumulateAuthorStateDelta(authorStateDeltas, normalizedReply, updated);
  await applyAuthorStateDeltas(transaction.objectStore('authorStates'), authorStateDeltas);
  await transaction.done;
  return updated;
}

export async function clearAll(): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['threads', 'replies', 'blockQueue', 'blockLogs', 'authorStates'], 'readwrite');
  await transaction.objectStore('threads').clear();
  await transaction.objectStore('replies').clear();
  await transaction.objectStore('blockQueue').clear();
  await transaction.objectStore('blockLogs').clear();
  await transaction.objectStore('authorStates').clear();
  await transaction.done;
}

export async function getBlockQueueItem(author: string): Promise<StoredBlockQueueItem | null> {
  const database = await getDatabase();
  return (await database.get('blockQueue', author)) ?? null;
}

export async function putBlockQueueItem(item: StoredBlockQueueItem): Promise<StoredBlockQueueItem> {
  const database = await getDatabase();
  await database.put('blockQueue', item);
  return item;
}

export async function deleteBlockQueueItem(author: string): Promise<void> {
  const database = await getDatabase();
  await database.delete('blockQueue', author);
}

export async function listBlockQueueItems(): Promise<StoredBlockQueueItem[]> {
  const database = await getDatabase();
  const items = await database.getAll('blockQueue');
  return items.sort((left, right) => left.nextRunAt - right.nextRunAt || left.queuedAt - right.queuedAt);
}

export async function getNextBlockQueueRunAt(): Promise<number | null> {
  const items = await listBlockQueueItems();
  return items[0]?.nextRunAt ?? null;
}

export async function addBlockLog(entry: StoredBlockLogEntry): Promise<StoredBlockLogEntry> {
  const database = await getDatabase();
  const id = await database.add('blockLogs', entry);
  return {
    ...entry,
    id,
  };
}

export async function listBlockLogEntries(): Promise<StoredBlockLogEntry[]> {
  const database = await getDatabase();
  const entries = await database.getAllFromIndex('blockLogs', 'by-created-at');
  return entries.sort((left, right) => right.createdAt - left.createdAt);
}

export async function getLatestSuccessfulBlockLog(author: string): Promise<StoredBlockLogEntry | null> {
  const database = await getDatabase();
  const entries = await database.getAllFromIndex('blockLogs', 'by-author', author);
  const latestEntry = entries
    .filter((entry) => entry.status === 'success')
    .sort((left, right) => right.createdAt - left.createdAt)[0];

  return latestEntry ?? null;
}

export async function listBlockingOverview(
  queuePage: number = 1,
  logPage: number = 1,
  pageSize: number = BLOCKING_OVERVIEW_PAGE_SIZE,
  isProcessing: boolean = false,
  nextRunAt: number | null = null,
): Promise<BlockingOverview> {
  const [queueItems, logEntries] = await Promise.all([listBlockQueueItems(), listBlockLogEntries()]);
  const normalizedPageSize = Math.max(1, pageSize);
  const latestSuccessfulByAuthor = new Map<string, StoredBlockLogEntry>();

  for (const entry of logEntries) {
    if (entry.status !== 'success' || latestSuccessfulByAuthor.has(entry.author)) {
      continue;
    }
    latestSuccessfulByAuthor.set(entry.author, entry);
  }

  return {
    queue: paginateItems(
      queueItems.map(toBlockQueueItemView),
      queuePage,
      normalizedPageSize,
    ),
    logs: paginateItems(
      logEntries.map((entry) => toBlockActionLogView(entry, latestSuccessfulByAuthor.get(entry.author))),
      logPage,
      normalizedPageSize,
    ),
    isProcessing,
    nextRunAt,
  };
}

export async function buildExportPayload(): Promise<ExportPayload> {
  const database = await getDatabase();
  const [threads, replies] = await Promise.all([database.getAll('threads'), database.getAll('replies')]);
  const threadMap = new Map<string, ExportThread>();

  for (const thread of threads) {
    threadMap.set(thread.threadId, {
      thread_id: thread.threadId,
      main_post: thread.mainPost,
      replies: [],
    });
  }

  for (const reply of replies) {
    const normalizedReply = ensureReplyCleanedPinyin(reply);
    const existingThread = threadMap.get(reply.threadId) ?? createFallbackThread(reply.threadId);
    existingThread.replies.push({
      reply_id: normalizedReply.replyId,
      author: normalizedReply.author,
      author_name: normalizedReply.authorName,
      original_text: normalizedReply.originalText,
      cleaned_pinyin: normalizedReply.cleanedPinyin,
      label: normalizedReply.label,
      source: normalizedReply.source,
      extract_time: normalizedReply.extractTime,
      matched_rules: normalizedReply.matchedRules,
      model_confidence: normalizedReply.modelConfidence,
    });
    threadMap.set(reply.threadId, existingThread);
  }

  const data = Array.from(threadMap.values()).filter((thread) => thread.replies.length > 0);
  return {
    export_time: Date.now(),
    total_records: data.reduce((total, thread) => total + thread.replies.length, 0),
    data,
  };
}

function createFallbackThread(threadId: string): ExportThread {
  return {
    thread_id: threadId,
    main_post: {
      author: 'unknown',
      text: '',
      timestamp: Date.now(),
    } satisfies MainPostRecord,
    replies: [],
  };
}

function toBlockQueueItemView(item: StoredBlockQueueItem): BlockQueueItemView {
  return {
    author: item.author,
    authorName: item.authorName,
    action: item.action,
    state: item.state,
    queuedAt: item.queuedAt,
    nextRunAt: item.nextRunAt,
    attemptCount: item.attemptCount,
    spamReplyCount: item.spamReplyCount,
    lastError: item.lastError,
    profileUrl: buildProfileUrl(item.author),
  };
}

function toBlockActionLogView(
  entry: StoredBlockLogEntry,
  latestSuccessfulEntry: StoredBlockLogEntry | undefined,
): BlockActionLogView {
  const canUndo = Boolean(
    entry.action === 'block'
    && entry.status === 'success'
    && latestSuccessfulEntry
    && latestSuccessfulEntry.id === entry.id
    && latestSuccessfulEntry.action === 'block',
  );

  return {
    id: entry.id ?? 0,
    author: entry.author,
    authorName: entry.authorName,
    action: entry.action,
    status: entry.status,
    createdAt: entry.createdAt,
    message: entry.message,
    spamReplyCount: entry.spamReplyCount,
    errorMessage: entry.errorMessage,
    canUndo,
    profileUrl: buildProfileUrl(entry.author),
  };
}

function paginateItems<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

function buildProfileUrl(author: string): string {
  return `https://x.com/${author}`;
}

function accumulateAuthorStateDelta(
  authorStateDeltas: Map<string, { delta: number; author: string; authorName: string }>,
  previousReply: ReplyRecord | null | undefined,
  nextReply: ReplyRecord | null | undefined,
): void {
  for (const { author, delta } of buildAuthorScoreDeltas(previousReply ?? null, nextReply ?? null)) {
    const current = authorStateDeltas.get(author) ?? {
      delta: 0,
      author,
      authorName: nextReply?.authorName || previousReply?.authorName || nextReply?.author || previousReply?.author || author,
    };
    current.delta += delta;
    current.author = author;
    current.authorName = nextReply?.authorName || previousReply?.authorName || current.authorName;
    authorStateDeltas.set(author, current);
  }
}

async function applyAuthorStateDeltas(
  authorStateStore: AuthorStateStoreLike,
  authorStateDeltas: Map<string, { delta: number; author: string; authorName: string }>,
): Promise<void> {
  if (authorStateDeltas.size === 0) {
    return;
  }

  for (const [author, stateDelta] of authorStateDeltas) {
    const existingState = (await authorStateStore.get(author)) as StoredAuthorState | undefined;
    const nextScore = (existingState?.score ?? 0) + stateDelta.delta;

    if (nextScore === 0) {
      await authorStateStore.delete(author);
      continue;
    }

    await authorStateStore.put({
      author,
      authorName: stateDelta.authorName || existingState?.authorName || stateDelta.author || existingState?.author || 'unknown',
      score: nextScore,
      isWhitelisted: shouldWhitelistAuthor(nextScore),
      updatedAt: Date.now(),
    });
  }

  const states = (await authorStateStore.index('by-updated-at').getAll()) as StoredAuthorState[];
  const overflow = states.length - AUTHOR_STATE_CACHE_LIMIT;
  if (overflow <= 0) {
    return;
  }

  for (const staleState of states.slice(0, overflow)) {
    await authorStateStore.delete(staleState.author);
  }
}

async function rebuildAuthorStatesFromReplies(
  authorStateStore: AuthorStateStoreLike,
  replies: ReplyRecord[],
): Promise<void> {
  const authorStateDeltas = new Map<string, { delta: number; author: string; authorName: string }>();

  for (const reply of dedupeReplies(replies).map((item) => sanitizeReplyRecord(item))) {
    accumulateAuthorStateDelta(authorStateDeltas, null, reply);
  }

  await applyAuthorStateDeltas(authorStateStore, authorStateDeltas);
}
