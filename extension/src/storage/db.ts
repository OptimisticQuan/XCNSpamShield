import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { normalizeReplyToPinyinWords } from '@/ml/tokenizer';
import { DB_NAME, DB_VERSION, DEFAULT_SETTINGS, SETTINGS_KEY } from '@/shared/constants';
import type {
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

interface ThreadStoreRecord extends ThreadRecord {
  createdAt: number;
}

interface SettingStoreRecord {
  key: string;
  value: ExtensionSettings;
}

interface XSpamShieldDatabase extends DBSchema {
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
    };
  };
  settings: {
    key: string;
    value: SettingStoreRecord;
  };
}

let databasePromise: Promise<IDBPDatabase<XSpamShieldDatabase>> | undefined;

function getDatabase(): Promise<IDBPDatabase<XSpamShieldDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<XSpamShieldDatabase>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('threads', { keyPath: 'threadId' });

        const replyStore = database.createObjectStore('replies', { keyPath: 'replyId' });
        replyStore.createIndex('by-thread', 'threadId');
        replyStore.createIndex('by-extract-time', 'extractTime');

        database.createObjectStore('settings', { keyPath: 'key' });
      },
    });
  }

  return databasePromise;
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
  const transaction = database.transaction(['threads', 'replies'], 'readwrite');
  const uniqueReplies = dedupeReplies(payload.replies);
  const existingThread = await transaction.objectStore('threads').get(payload.threadId);
  const mergedReplies: ReplyRecord[] = [];

  const threadRecord = mergeThreadRecord(existingThread, payload);
  await transaction.objectStore('threads').put(threadRecord);

  for (const reply of uniqueReplies) {
    const existing = await transaction.objectStore('replies').get(reply.replyId);
    const nextReply = mergeReply(existing, reply);
    await transaction.objectStore('replies').put(nextReply);
    mergedReplies.push(nextReply);
  }

  await transaction.done;
  return {
    savedReplies: uniqueReplies.length,
    replies: mergedReplies.map((reply) => normalizeReplyRecord(reply)),
  };
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
  const normalizedIncoming = normalizeReplyRecord(incoming);

  if (!existing) {
    return normalizedIncoming;
  }

  const normalizedExisting = normalizeReplyRecord(existing);

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

function normalizeReplyRecord(reply: ReplyRecord): ReplyRecord {
  return {
    ...reply,
    authorName: reply.authorName || reply.author,
    cleanedPinyin: normalizeReplyToPinyinWords(reply.authorName || reply.author, reply.originalText),
    matchedRules: [],
  };
}

export async function listReplies(): Promise<ExtractedReplyView[]> {
  const database = await getDatabase();
  const replies = await database.getAllFromIndex('replies', 'by-extract-time');

  return replies
    .sort((left, right) => right.extractTime - left.extractTime)
    .map((reply) => normalizeReplyRecord(reply))
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
    const normalizedReply = normalizeReplyRecord(reply);
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

export async function getReplyRecord(replyId: string): Promise<ReplyRecord | null> {
  const database = await getDatabase();
  const reply = await database.get('replies', replyId);
  return reply ? normalizeReplyRecord(reply) : null;
}

export async function deleteReply(replyId: string): Promise<void> {
  const database = await getDatabase();
  await database.delete('replies', replyId);
}

export async function toggleReplyLabel(replyId: string): Promise<ReplyRecord> {
  const database = await getDatabase();
  const transaction = database.transaction('replies', 'readwrite');
  const reply = await transaction.store.get(replyId);

  if (!reply) {
    throw new Error(`Reply ${replyId} was not found.`);
  }

  const normalizedReply = normalizeReplyRecord(reply);
  const updated: ReplyRecord = {
    ...normalizedReply,
    label: normalizedReply.label === 1 ? 0 : 1,
    source: 'manual',
  };
  await transaction.store.put(updated);
  await transaction.done;
  return updated;
}

export async function clearAll(): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['threads', 'replies'], 'readwrite');
  await transaction.objectStore('threads').clear();
  await transaction.objectStore('replies').clear();
  await transaction.done;
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
    const normalizedReply = normalizeReplyRecord(reply);
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
