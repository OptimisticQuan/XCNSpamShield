import {
  cancelBlockQueueAuthor,
  getBlockingOverviewData,
  initializeBlockQueueProcessing,
  queueUnblockAuthor,
  refreshAutoBlockQueueForAuthors,
} from '@/background/block-queue';
import { clearCachedReplyDecisions, deleteCachedReplyDecision, syncCachedReplyDecision } from '@/background/reply-decision-cache';
import { buildManualReplyRecord, evaluateCollectedReplies, evaluateCollectedThread, processCollectedThread } from '@/background/thread-processor';
import { buildExportPayload, clearAll, deleteReply, getReplyRecord, getReplyRecords, getSettings, listReplies, listThreadGroups, setBlockingEnabled, setFloatingCapturePosition, setShowFloatingCaptureButton, toggleReplyLabel, upsertThreadPayload } from '@/storage/db';
import type { RuntimeRequest, RuntimeResponse } from '@/shared/messages';
import type { CollectedThreadPayload, ReplyRecord } from '@/shared/types';
import type { ReplyDecisionTraceContext } from '@/background/thread-processor';

const X_TAB_MATCHERS = ['https://x.com/*', 'https://twitter.com/*'] as const;
let replyDecisionRequestCounter = 0;

chrome.runtime.onInstalled.addListener(() => {
  void getSettings();
  initializeBlockQueueProcessing();
  void ensureContentScriptsOnMatchingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  initializeBlockQueueProcessing();
  void ensureContentScriptsOnMatchingTabs();
});

initializeBlockQueueProcessing();

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  void handleRuntimeMessage(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

  return true;
});

async function handleRuntimeMessage(message: RuntimeRequest): Promise<RuntimeResponse<unknown>> {
  switch (message.type) {
    case 'GET_SETTINGS':
      return success(await getSettings());
    case 'GET_BLOCKING_OVERVIEW':
      return success(await getBlockingOverviewData(message.queuePage, message.logPage, message.pageSize));
    case 'SET_BLOCKING': {
      const settings = await setBlockingEnabled(message.enabled);
      await broadcastSettings(settings);
      return success(settings);
    }
    case 'SET_SHOW_FLOATING_CAPTURE_BUTTON': {
      const settings = await setShowFloatingCaptureButton(message.enabled);
      await broadcastSettings(settings);
      return success(settings);
    }
    case 'SET_FLOATING_CAPTURE_POSITION': {
      const settings = await setFloatingCapturePosition(message.position);
      await broadcastSettings(settings);
      return success(settings);
    }
    case 'LIST_REPLIES':
      return success(await listReplies());
    case 'LIST_THREAD_GROUPS':
      return success(await listThreadGroups());
    case 'DELETE_REPLY':
    {
      const reply = await getReplyRecord(message.replyId);
      await deleteReply(message.replyId);
      deleteCachedReplyDecision(message.replyId);
      if (reply) {
        await refreshAutoBlockQueueForAuthors([reply.author]);
      }
      return success({ replyId: message.replyId });
    }
    case 'TOGGLE_REPLY_LABEL': {
      const reply = await toggleReplyLabel(message.replyId);
      syncCachedReplyDecision(reply);
      await refreshAutoBlockQueueForAuthors([reply.author]);
      return success(reply);
    }
    case 'CLEAR_ALL':
      await clearAll();
      clearCachedReplyDecisions();
      initializeBlockQueueProcessing();
      return success({ cleared: true as const });
    case 'EXPORT_JSON': {
      const payload = await buildExportPayload();
      return success(payload);
    }
    case 'EXTRACT_CURRENT_PAGE': {
      const payload = await requestPageExtraction();
      const result = await upsertCollectedThread(payload, 'EXTRACT_CURRENT_PAGE');
      return success({ savedReplies: result.savedReplies });
    }
    case 'CLASSIFY_COLLECTED_THREAD': {
      const settings = await getSettings();
      return success(
        await runReplyDecisionRequest(
          'CLASSIFY_COLLECTED_THREAD',
          message.payload.replies.length,
          (traceContext) => evaluateCollectedThread(message.payload, settings, traceContext),
          (replies) => ({ completedReplies: replies.length }),
        ),
      );
    }
    case 'CLASSIFY_REPLIES': {
      const settings = await getSettings();
      return success(
        await runReplyDecisionRequest(
          'CLASSIFY_REPLIES',
          message.payload.replies.length,
          (traceContext) => evaluateCollectedReplies(message.payload.threadId, message.payload.replies, settings, traceContext),
          (replies) => ({ completedReplies: replies.length }),
        ),
      );
    }
    case 'UPSERT_COLLECTED_THREAD':
      return success(await upsertCollectedThread(message.payload, 'UPSERT_COLLECTED_THREAD'));
    case 'UPSERT_MANUAL_REPLY': {
      const settings = await getSettings();
      const result = await runReplyDecisionRequest(
        'UPSERT_MANUAL_REPLY',
        1,
        async (traceContext) => {
          const reply = await buildManualReplyRecord(message.payload, settings, traceContext);
          const stored = await upsertThreadPayload({
            threadId: message.payload.threadId,
            mainPost: message.payload.mainPost,
            replies: [reply],
          });

          return stored.replies[0] ?? reply;
        },
        (reply) => ({ replyId: reply.replyId, label: reply.label }),
      );
      syncCachedReplyDecision(result);
      return success(result);
    }
    case 'GET_REPLY_RECORDS':
      return success(await lookupReplyRecords(message.replyIds));
    case 'GET_REPLY_RECORD':
      return success(await getReplyRecord(message.replyId));
    case 'CANCEL_BLOCK_QUEUE_AUTHOR': {
      const cancelled = await cancelBlockQueueAuthor(message.author);
      return success({ author: message.author, cancelled });
    }
    case 'QUEUE_UNBLOCK_AUTHOR': {
      const result = await queueUnblockAuthor(message.author);
      return success({ author: message.author, ...result });
    }
  }
}

function success<T>(data: T): RuntimeResponse<T> {
  return {
    ok: true,
    data,
  };
}

async function requestPageExtraction(): Promise<CollectedThreadPayload> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab is available.');
  }

  if (!isSupportedXTab(tab.url)) {
    throw new Error('Please open an x.com or twitter.com post page first.');
  }

  await ensureContentScript(tab.id);
  return sendPageExtractionRequest(tab.id);
}

async function sendPageExtractionRequest(tabId: number): Promise<CollectedThreadPayload> {
  const payload = (await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_PAGE_EXTRACTION' })) as unknown;
  if (!isCollectedThreadPayload(payload)) {
    throw new Error('No tweet thread was detected on the current page.');
  }

  return payload;
}

async function upsertCollectedThread(
  payload: CollectedThreadPayload,
  requestType: 'UPSERT_COLLECTED_THREAD' | 'EXTRACT_CURRENT_PAGE',
): Promise<{ savedReplies: number; replies: ReplyRecord[] }> {
  const settings = await getSettings();
  return runReplyDecisionRequest(
    requestType,
    payload.replies.length,
    async (traceContext) => {
      const processed = await processCollectedThread(payload, settings, traceContext);
      const result = await upsertThreadPayload(processed);
      result.replies.forEach((reply) => syncCachedReplyDecision(reply));
      await refreshAutoBlockQueueForAuthors(result.replies.map((reply) => reply.author));

      return {
        savedReplies: result.savedReplies,
        replies: result.replies,
      };
    },
    (result) => ({
      savedReplies: result.savedReplies,
      completedReplies: result.replies.length,
    }),
  );
}

async function lookupReplyRecords(replyIds: string[]): Promise<ReplyRecord[]> {
  const lookupStartedAt = performance.now();
  const replies = await getReplyRecords(replyIds);

  for (const reply of replies) {
    if (reply.source === 'manual' || reply.cleanedPinyin) {
      syncCachedReplyDecision(reply);
    }
  }

  console.info('[XSpamShield][reply-record-lookup]', {
    requestedReplyCount: replyIds.length,
    matchedReplyCount: replies.length,
    durationMs: roundDuration(performance.now() - lookupStartedAt),
  });

  return replies;
}

function isCollectedThreadPayload(value: unknown): value is CollectedThreadPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Partial<CollectedThreadPayload>;
  return typeof payload.threadId === 'string' && Array.isArray(payload.replies) && typeof payload.mainPost?.text === 'string';
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await hasContentReceiver(tabId)) {
    return;
  }

  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => undefined);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function ensureContentScriptsOnMatchingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: [...X_TAB_MATCHERS] });
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
      .map((tab) => ensureContentScript(tab.id).catch(() => undefined)),
  );
}

async function hasContentReceiver(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return response === true;
  } catch (error) {
    if (isMissingReceiverError(error)) {
      return false;
    }

    throw error;
  }
}

function isSupportedXTab(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return /^https:\/\/(x|twitter)\.com\//u.test(url);
}

function isMissingReceiverError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Could not establish connection|Receiving end does not exist/u.test(error.message);
}

async function broadcastSettings(settings: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  const tabs = await chrome.tabs.query({ url: [...X_TAB_MATCHERS] });
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SETTINGS', settings }).catch(() => undefined)),
  );
}

async function runReplyDecisionRequest<T>(
  requestType: string,
  replyCount: number,
  runner: (traceContext: ReplyDecisionTraceContext) => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const traceContext = createReplyDecisionTraceContext(requestType, replyCount);
  logReplyDecisionRequestStart(traceContext);

  try {
    const result = await runner(traceContext);
    logReplyDecisionRequestEnd(traceContext, {
      ok: true,
      ...summarize?.(result),
    });
    return result;
  } catch (error) {
    logReplyDecisionRequestEnd(traceContext, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

function createReplyDecisionTraceContext(requestType: string, replyCount: number): ReplyDecisionTraceContext {
  replyDecisionRequestCounter += 1;
  return {
    requestId: `${requestType}-${Date.now()}-${replyDecisionRequestCounter}`,
    requestType,
    requestStartedAt: performance.now(),
    replyCount,
  };
}

function logReplyDecisionRequestStart(traceContext: ReplyDecisionTraceContext): void {
  console.info('[XSpamShield][reply-decision-request:start]', {
    requestId: traceContext.requestId,
    requestType: traceContext.requestType,
    replyCount: traceContext.replyCount,
  });
}

function logReplyDecisionRequestEnd(
  traceContext: ReplyDecisionTraceContext,
  details: Record<string, unknown>,
): void {
  console.info('[XSpamShield][reply-decision-request:end]', {
    requestId: traceContext.requestId,
    requestType: traceContext.requestType,
    replyCount: traceContext.replyCount,
    durationMs: roundDuration(performance.now() - traceContext.requestStartedAt),
    ...details,
  });
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}
