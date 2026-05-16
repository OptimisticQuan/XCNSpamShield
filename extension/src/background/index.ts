import { clearCachedReplyDecisions, deleteCachedReplyDecision, syncCachedReplyDecision } from '@/background/reply-decision-cache';
import { buildManualReplyRecord, evaluateCollectedThread, processCollectedThread } from '@/background/thread-processor';
import { buildExportPayload, clearAll, deleteReply, getReplyRecord, getSettings, listReplies, listThreadGroups, setBlockingEnabled, setFloatingCapturePosition, toggleReplyLabel, upsertThreadPayload } from '@/storage/db';
import type { RuntimeRequest, RuntimeResponse } from '@/shared/messages';
import type { CollectedThreadPayload, ReplyRecord } from '@/shared/types';

const X_TAB_MATCHERS = ['https://x.com/*', 'https://twitter.com/*'] as const;

chrome.runtime.onInstalled.addListener(() => {
  void getSettings();
  void ensureContentScriptsOnMatchingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContentScriptsOnMatchingTabs();
});

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
    case 'SET_BLOCKING': {
      const settings = await setBlockingEnabled(message.enabled);
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
      await deleteReply(message.replyId);
      deleteCachedReplyDecision(message.replyId);
      return success({ replyId: message.replyId });
    case 'TOGGLE_REPLY_LABEL': {
      const reply = await toggleReplyLabel(message.replyId);
      syncCachedReplyDecision(reply);
      return success(reply);
    }
    case 'CLEAR_ALL':
      await clearAll();
      clearCachedReplyDecisions();
      return success({ cleared: true as const });
    case 'EXPORT_JSON': {
      const payload = await buildExportPayload();
      return success(payload);
    }
    case 'EXTRACT_CURRENT_PAGE': {
      const payload = await requestPageExtraction();
      const result = await upsertCollectedThread(payload);
      return success({ savedReplies: result.savedReplies });
    }
    case 'CLASSIFY_COLLECTED_THREAD': {
      const settings = await getSettings();
      return success(await evaluateCollectedThread(message.payload, settings));
    }
    case 'UPSERT_COLLECTED_THREAD':
      return success(await upsertCollectedThread(message.payload));
    case 'UPSERT_MANUAL_REPLY': {
      const settings = await getSettings();
      const reply = await buildManualReplyRecord(message.payload, settings);
      const result = await upsertThreadPayload({
        threadId: message.payload.threadId,
        mainPost: message.payload.mainPost,
        replies: [reply],
      });
      const storedReply = result.replies[0] ?? reply;
      syncCachedReplyDecision(storedReply);
      return success(storedReply);
    }
    case 'GET_REPLY_RECORD':
      return success(await getReplyRecord(message.replyId));
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

async function upsertCollectedThread(payload: CollectedThreadPayload): Promise<{ savedReplies: number; replies: ReplyRecord[] }> {
  const settings = await getSettings();
  const processed = await processCollectedThread(payload, settings);
  const result = await upsertThreadPayload(processed);
  result.replies.forEach((reply) => syncCachedReplyDecision(reply));

  return {
    savedReplies: result.savedReplies,
    replies: result.replies,
  };
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
