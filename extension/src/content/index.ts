import '@/content/content.css';

import { clearActionButton, ensureActionButton } from '@/content/actions';
import { formatAuthorHandle, getQueueBlockFailureFeedback, getQueueBlockFeedback, type BlockingFeedbackTone } from '@/content/blocking-feedback';
import { applyCollapsedState, applyQueuedHiddenState, clearCollapsedState, clearQueuedHiddenState } from '@/content/collapser';
import { mutationsAffectOnlyInjectedUi } from '@/content/mutation-filter';
import { cacheTweetAuthorIdentities, clearTweetAuthorIdentityCache, type TweetAuthorIdentity } from '@/content/page-identity-cache';
import { cachedReplyResultFromRecord, ReplyResultCache, resolveCachedReplyResult, type CachedReplyResult } from '@/content/reply-result-cache';
import { collectCurrentThread, collectRepliesForAvatarOcrRecheck, toCollectedReply } from '@/content/extractor';
import { collectParsedTweets, getLoadedTweetArticles, isStatusPage, type ParsedTweet } from '@/content/selectors';
import {
  ACTION_BUTTON_CLASS,
  DEFAULT_SETTINGS,
  FLOATING_CAPTURE_ROOT_ID,
  PAGE_BRIDGE_EVENT_NAME,
  PAGE_BRIDGE_SCRIPT_FILE,
  PAGE_BRIDGE_SCRIPT_ID,
  THREAD_SCAN_DEBOUNCE_MS,
  THREAD_SCROLL_SCAN_DEBOUNCE_MS,
} from '@/shared/constants';
import type { ContentRequest, RuntimeRequest } from '@/shared/messages';
import { isExtensionContextInvalidatedError, sendRuntimeMessage } from '@/shared/messages';
import type { CollectedThreadPayload, ExtensionSettings, ReplyBlockingState, ReplyBlockingStatus, ReplyRecord } from '@/shared/types';

declare global {
  var __xcnspamshieldContentInitialized__: boolean | undefined;
}

const BLOCKING_FEEDBACK_ROOT_ID = 'xcnspamshield-blocking-feedback-root';
const MAX_CACHED_BLOCKING_STATES = 500;

let currentSettings: ExtensionSettings | null = null;
let scanTimeout: number | undefined;
let scanFrameHandle: number | undefined;
const replyResultCache = new ReplyResultCache();
const replyBlockingStateByReplyId = new Map<string, ReplyBlockingState>();
const replyBlockingStateByAuthor = new Map<string, ReplyBlockingState>();
const replyBlockingStateByAuthorId = new Map<string, ReplyBlockingState>();
const pendingStoredReplyIds = new Set<string>();
const pendingInferenceReplyIds = new Set<string>();
let bootstrapPromise: Promise<void> = Promise.resolve();
let captureInProgress = false;
let captureTone: 'idle' | 'loading' | 'success' | 'error' = 'idle';
let captureMessage = '';
let activeThreadId: string | null = null;
let floatingPosition: ExtensionSettings['floatingCapturePosition'] | null = null;
let feedbackTimeout: number | undefined;
let blockingFeedbackTimeout: number | undefined;
let blockingFeedbackTone: 'idle' | 'loading' | BlockingFeedbackTone = 'idle';
let blockingFeedbackMessage = '';
let mutationObserver: MutationObserver | null = null;
let contentContextActive = true;
let scanInProgress = false;
let rerunScanRequested = false;
let pageBridgeListenerRegistered = false;

if (!globalThis.__xcnspamshieldContentInitialized__) {
  globalThis.__xcnspamshieldContentInitialized__ = true;
  bootstrapPromise = bootstrap();

  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse(true);
      return false;
    }

    if (message.type === 'REQUEST_PAGE_EXTRACTION') {
      void handleExtraction(sendResponse);
      return true;
    }

    if (message.type === 'REQUEST_REPLY_AVATAR_DATA_URLS') {
      void handleReplyAvatarDataUrlRequest(message.replyIds, sendResponse);
      return true;
    }

    if (message.type === 'APPLY_SETTINGS') {
      currentSettings = message.settings;
      floatingPosition = message.settings.floatingCapturePosition;
      void runScan();
    }

    return false;
  });
}

async function bootstrap(): Promise<void> {
  registerPageBridgeListener();
  ensurePageBridgeInjected();

  const settingsResponse = await sendContentRuntimeMessage({ type: 'GET_SETTINGS' });

  if (!contentContextActive) {
    return;
  }

  currentSettings = settingsResponse.data ?? { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
  floatingPosition = currentSettings.floatingCapturePosition;

  syncBlockingFeedbackToast();
  syncFloatingCaptureCard();
  observeMutations();
  await runScan();
}

function registerPageBridgeListener(): void {
  if (pageBridgeListenerRegistered) {
    return;
  }

  window.addEventListener(PAGE_BRIDGE_EVENT_NAME, handlePageBridgeIdentities as EventListener);
  pageBridgeListenerRegistered = true;
}

function ensurePageBridgeInjected(): void {
  if (document.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement('script');
  script.id = PAGE_BRIDGE_SCRIPT_ID;
  script.src = chrome.runtime.getURL(PAGE_BRIDGE_SCRIPT_FILE);
  script.async = false;
  script.addEventListener('load', () => {
    script.remove();
  }, { once: true });
  script.addEventListener('error', () => {
    script.remove();
  }, { once: true });

  (document.head ?? document.documentElement).append(script);
}

function handlePageBridgeIdentities(event: Event): void {
  const customEvent = event as CustomEvent<{ identities?: TweetAuthorIdentity[] }>;
  if (!contentContextActive) {
    return;
  }

  const identities = customEvent.detail?.identities ?? [];
  if (identities.length === 0) {
    return;
  }

  if (cacheTweetAuthorIdentities(identities)) {
    scheduleScan(0);
  }
}

async function handleExtraction(sendResponse: (response: CollectedThreadPayload | null) => void): Promise<void> {
  try {
    await bootstrapPromise;
    sendResponse(collectCurrentThread());
  } catch (error) {
    console.error('XCNSpamShield extraction failed', error);
    sendResponse(null);
  }
}

async function handleReplyAvatarDataUrlRequest(
  replyIds: string[],
  sendResponse: (response: ReturnType<typeof collectRepliesForAvatarOcrRecheck> extends Promise<infer T> ? T : never) => void,
): Promise<void> {
  try {
    await bootstrapPromise;
    if (!contentContextActive || replyIds.length === 0) {
      sendResponse([]);
      return;
    }

    const replyIdSet = new Set(replyIds);
    const replies = collectParsedTweets().filter((tweet) => replyIdSet.has(tweet.tweetId));
    sendResponse(await collectRepliesForAvatarOcrRecheck(replies));
  } catch (error) {
    console.error('XCNSpamShield avatar data URL collection failed', error);
    sendResponse([]);
  }
}

function observeMutations(): void {
  mutationObserver = new MutationObserver((mutations) => {
    if (mutationsAffectOnlyInjectedUi(mutations)) {
      return;
    }

    scheduleScan(THREAD_SCAN_DEBOUNCE_MS);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
}

async function runScan(): Promise<void> {
  if (scanInProgress) {
    rerunScanRequested = true;
    return;
  }

  scanInProgress = true;

  try {
    do {
      rerunScanRequested = false;
      await performScan();
    } while (rerunScanRequested && contentContextActive);
  } finally {
    scanInProgress = false;
  }
}

async function performScan(): Promise<void> {
  if (!contentContextActive) {
    return;
  }

  syncFloatingCaptureCard();

  if (!currentSettings) {
    return;
  }

  if (!isStatusPage()) {
    activeThreadId = null;
    pendingStoredReplyIds.clear();
    pendingInferenceReplyIds.clear();
    clearInjectedTweetUi();
    return;
  }

  const currentThreadId = getCurrentThreadIdFromLocation();
  if (!currentThreadId) {
    activeThreadId = null;
    return;
  }

  if (activeThreadId !== currentThreadId) {
    activeThreadId = currentThreadId;
    pendingStoredReplyIds.clear();
    pendingInferenceReplyIds.clear();
  }

  const allowManualToggle = true;
  const loadedTweets = collectParsedTweets();
  const visibleTweetIds = new Set(collectParsedTweets({ visibleOnly: true }).map((tweet) => tweet.tweetId));
  const loadedMainTweet = loadedTweets.find((tweet) => tweet.tweetId === currentThreadId) ?? null;
  const loadedReplies = loadedTweets.filter((tweet) => tweet.tweetId !== currentThreadId);
  const visibleReplies = loadedReplies.filter((tweet) => visibleTweetIds.has(tweet.tweetId));

  if (loadedMainTweet) {
    clearActionButton(loadedMainTweet.article);
  }

  await refreshReplyBlockingStates(loadedReplies);

  for (const tweet of loadedReplies) {
    const blockingState = getCachedReplyBlockingState(tweet);
    if (blockingState) {
      clearActionButton(tweet.article);
      applyQueuedHiddenState(tweet.article, blockingState);
      continue;
    }

    clearQueuedHiddenState(tweet.article);
  }

  void warmVisibleReplyDecisions(
    currentThreadId,
    visibleReplies.filter((tweet) => getCachedReplyModerationState(tweet) === null),
  );

  for (const tweet of loadedReplies) {
    const moderationState = getCachedReplyModerationState(tweet);
    if (moderationState === 'queued' || moderationState === 'blocked') {
      continue;
    }

    const decision = moderationState === 'whitelisted'
      ? getDefaultReplyDecisionForModerationState(moderationState)
      : getCachedReplyDecision(tweet.tweetId);
    if (!decision) {
      clearCollapsedState(tweet.article);
      clearActionButton(tweet.article);
      continue;
    }

    const shouldCollapse = currentSettings.blockingEnabled && decision.label === 1;

    if (shouldCollapse) {
      applyCollapsedState(tweet.article, getCollapseReason(decision), {
        onQueueBlock: () => {
          void queueAuthorForBlock(tweet);
        },
      });
    } else {
      clearCollapsedState(tweet.article);
    }

    const isExpandedSpam = shouldCollapse && tweet.article.dataset.xcnspamshieldExpanded === 'true';

    if (allowManualToggle && (!shouldCollapse || isExpandedSpam)) {
      ensureActionButton(tweet.article, { isSpam: decision.label === 1, isManual: decision.source === 'manual' }, () => {
        void toggleReply(tweet, decision);
      }, () => {
        void queueAuthorForBlock(tweet);
      });
    } else {
      clearActionButton(tweet.article);
    }
  }
}

async function refreshReplyBlockingStates(replies: ParsedTweet[]): Promise<void> {
  const replyTargets = replies
    .map((tweet) => ({
      replyId: tweet.tweetId,
      authorId: tweet.authorId,
      author: tweet.author,
    }))
    .filter((tweet) => tweet.replyId && (tweet.author || tweet.authorId));

  if (replyTargets.length === 0) {
    replyBlockingStateByAuthor.clear();
    replyBlockingStateByAuthorId.clear();
    return;
  }

  const response = await sendContentRuntimeMessage({
    type: 'GET_REPLY_BLOCKING_STATES',
    replies: replyTargets,
  });

  if (!response.ok) {
    if (!isExtensionContextInvalidatedError(response.error)) {
      console.error('XCNSpamShield lookup reply blocking states failed', response.error);
    }
    return;
  }

  cacheReplyBlockingStates(response.data ?? []);
}

function cacheReplyBlockingStates(states: ReplyBlockingStatus[]): void {
  const requestedAuthors = new Set<string>();
  const requestedAuthorIds = new Set<string>();
  const nextAuthorStates = new Map<string, ReplyBlockingState>();
  const nextAuthorIdStates = new Map<string, ReplyBlockingState>();

  for (const state of states) {
    const normalizedAuthor = normalizeAuthorHandle(state.author);
    const normalizedAuthorId = normalizeAuthorId(state.authorId);
    if (!normalizedAuthor && !normalizedAuthorId) {
      continue;
    }

    const nextState = state.state;

    if (normalizedAuthor) {
      requestedAuthors.add(normalizedAuthor);
    }
    if (normalizedAuthorId) {
      requestedAuthorIds.add(normalizedAuthorId);
    }

    if (nextState === 'none') {
      replyBlockingStateByReplyId.delete(state.replyId);
      continue;
    }

    const activeState = nextState as Exclude<ReplyBlockingState, 'none'>;

    setReplyBlockingStateCache(state.replyId, normalizedAuthor, normalizedAuthorId, activeState);

    if (normalizedAuthor) {
      const currentAuthorState = nextAuthorStates.get(normalizedAuthor);
      if (!currentAuthorState || getReplyStatePriority(activeState) > getReplyStatePriority(currentAuthorState)) {
        nextAuthorStates.set(normalizedAuthor, activeState);
      }
    }

    if (normalizedAuthorId) {
      const currentAuthorIdState = nextAuthorIdStates.get(normalizedAuthorId);
      if (!currentAuthorIdState || getReplyStatePriority(activeState) > getReplyStatePriority(currentAuthorIdState)) {
        nextAuthorIdStates.set(normalizedAuthorId, activeState);
      }
    }
  }

  for (const author of requestedAuthors) {
    const nextState = nextAuthorStates.get(author);
    if (nextState) {
      replyBlockingStateByAuthor.set(author, nextState);
      continue;
    }

    replyBlockingStateByAuthor.delete(author);
  }

  for (const authorId of requestedAuthorIds) {
    const nextState = nextAuthorIdStates.get(authorId);
    if (nextState) {
      replyBlockingStateByAuthorId.set(authorId, nextState);
      continue;
    }

    replyBlockingStateByAuthorId.delete(authorId);
  }
}

async function queueAuthorForBlock(tweet: ParsedTweet): Promise<void> {
  showBlockingFeedback('loading', `正在处理 ${formatAuthorHandle(tweet.author)}`);

  const response = await sendContentRuntimeMessage({
    type: 'QUEUE_BLOCK_AUTHOR',
    author: tweet.author,
    authorId: tweet.authorId,
    authorName: tweet.authorName,
    replyId: tweet.tweetId,
  });

  if (!response.ok) {
    if (!isExtensionContextInvalidatedError(response.error)) {
      console.error('XCNSpamShield queue block author failed', response.error);
    }

    const failureFeedback = getQueueBlockFailureFeedback(tweet.author);
    showBlockingFeedback(failureFeedback.tone, failureFeedback.message, 2400);
    return;
  }

  if (!response.data) {
    const failureFeedback = getQueueBlockFailureFeedback(tweet.author);
    showBlockingFeedback(failureFeedback.tone, failureFeedback.message, 2400);
    return;
  }

  const feedback = getQueueBlockFeedback(tweet.author, response.data.action);
  showBlockingFeedback(feedback.tone, feedback.message, feedback.tone === 'success' ? 1800 : 2200);

  if (response.data?.active) {
    setReplyBlockingStateCache(tweet.tweetId, normalizeAuthorHandle(tweet.author), normalizeAuthorId(tweet.authorId), 'queued');
    await runScan();
  }
}

function scheduleScan(delayMs: number): void {
  if (!contentContextActive) {
    return;
  }

  window.clearTimeout(scanTimeout);
  scanTimeout = window.setTimeout(() => {
    scheduleAnimationFrameScan();
  }, delayMs);
}

function scheduleAnimationFrameScan(): void {
  if (!contentContextActive || scanFrameHandle !== undefined) {
    return;
  }

  scanFrameHandle = window.requestAnimationFrame(() => {
    scanFrameHandle = undefined;
    void runScan();
  });
}

function handleViewportChange(): void {
  scheduleScan(THREAD_SCROLL_SCAN_DEBOUNCE_MS);
}

function getCollapseReason(decision: CachedReplyResult): string {
  if (decision.source === 'manual') {
    return '人工标记';
  }

  if (typeof decision.modelConfidence === 'number') {
    return `模型 ${(decision.modelConfidence * 100).toFixed(1)}%`;
  }

  return '模型命中';
}

async function warmVisibleReplyDecisions(threadId: string, replies: ParsedTweet[]): Promise<void> {
  const loadedStoredReplies = await loadStoredReplies(replies);
  const loadedTransientReplies = await loadTransientReplies(threadId, replies);

  if (loadedStoredReplies || loadedTransientReplies) {
    void runScan();
  }
}

async function loadStoredReplies(replies: ParsedTweet[]): Promise<boolean> {
  const missingReplyIds = replies
    .map((tweet) => tweet.tweetId)
    .filter(
      (replyId) =>
        !hasCachedReplyDecision(replyId)
        && !pendingStoredReplyIds.has(replyId)
        && !pendingInferenceReplyIds.has(replyId),
    );

  if (missingReplyIds.length === 0) {
    return false;
  }

  missingReplyIds.forEach((replyId) => pendingStoredReplyIds.add(replyId));

  try {
    const response = await sendContentRuntimeMessage({
      type: 'GET_REPLY_RECORDS',
      replyIds: missingReplyIds,
    });

    if (!response.ok) {
      if (isExtensionContextInvalidatedError(response.error)) {
        return false;
      }

      console.error('XCNSpamShield lookup stored replies failed', response.error);
      return false;
    }

    let hasUpdates = false;
    for (const reply of response.data ?? []) {
      cachePersistedReply(reply);
      hasUpdates = true;
    }

    return hasUpdates;
  } finally {
    missingReplyIds.forEach((replyId) => pendingStoredReplyIds.delete(replyId));
  }
}

async function loadTransientReplies(threadId: string, replies: ParsedTweet[]): Promise<boolean> {
  const missingReplies = replies.filter(
    (tweet) =>
      !hasCachedReplyDecision(tweet.tweetId)
      && !pendingStoredReplyIds.has(tweet.tweetId)
      && !pendingInferenceReplyIds.has(tweet.tweetId),
  );

  if (missingReplies.length === 0) {
    return false;
  }

  missingReplies.forEach((tweet) => pendingInferenceReplyIds.add(tweet.tweetId));

  try {
    const response = await sendContentRuntimeMessage({
      type: 'CLASSIFY_REPLIES',
      payload: {
        threadId,
        replies: missingReplies.map(toCollectedReply),
      },
    });

    if (!response.ok) {
      if (isExtensionContextInvalidatedError(response.error)) {
        return false;
      }

      console.error('XCNSpamShield classify replies failed', response.error);
      return false;
    }

    let hasUpdates = false;
    for (const reply of response.data ?? []) {
      cachePersistedReply(reply);
      hasUpdates = true;
    }

    return hasUpdates;
  } finally {
    missingReplies.forEach((tweet) => pendingInferenceReplyIds.delete(tweet.tweetId));
  }
}

async function toggleReply(replyTweet: ParsedTweet, currentRecord: CachedReplyResult): Promise<void> {
  const nextLabel = currentRecord.label === 1 ? 0 : 1;

  if (currentRecord.isPersisted) {
    const response = await sendContentRuntimeMessage({ type: 'TOGGLE_REPLY_LABEL', replyId: replyTweet.tweetId });
    if (response.ok && response.data) {
      cachePersistedReply(response.data);
    }
    await runScan();
    return;
  }

  const currentThread = collectCurrentThread();
  const fallbackThreadId = activeThreadId ?? getCurrentThreadIdFromLocation() ?? replyTweet.tweetId;

  const response = await sendContentRuntimeMessage({
    type: 'UPSERT_MANUAL_REPLY',
    payload: {
      threadId: currentThread?.threadId ?? fallbackThreadId,
      mainPost: currentThread?.mainPost ?? {
        author: 'unknown',
        text: '',
        timestamp: Date.now(),
      },
      reply: toCollectedReply(replyTweet),
      label: nextLabel,
      modelConfidence: currentRecord.modelConfidence,
    },
  });

  if (response.ok && response.data) {
    cachePersistedReply(response.data);
  }

  await runScan();
}

async function extractAndPersistCurrentThread(): Promise<ReplyRecord[] | null> {
  await bootstrapPromise;

  if (!contentContextActive) {
    return null;
  }

  const thread = collectCurrentThread();
  if (!thread) {
    return null;
  }

  const response = await sendContentRuntimeMessage({ type: 'UPSERT_COLLECTED_THREAD', payload: thread });
  if (!response.ok || !response.data) {
    throw new Error(response.error ?? 'Failed to save extracted thread.');
  }

  for (const reply of response.data.replies) {
    cachePersistedReply(reply);
  }

  return response.data.replies;
}

function syncFloatingCaptureCard(): void {
  if (!isStatusPage() || !currentSettings?.showFloatingCaptureButton) {
    document.getElementById(FLOATING_CAPTURE_ROOT_ID)?.remove();
    return;
  }

  const card = ensureFloatingCaptureCard();
  applyFloatingPosition(card);
  const button = card.querySelector<HTMLButtonElement>('.xcnspamshield-floating-capture-button');
  const message = card.querySelector<HTMLParagraphElement>('.xcnspamshield-floating-capture-message');

  if (!button || !message) {
    return;
  }

  card.dataset.tone = captureTone;
  button.disabled = captureInProgress;
  button.textContent = captureInProgress ? '处理中' : '抓取';
  message.textContent = captureMessage;
  message.hidden = captureTone === 'idle' || captureMessage.length === 0;
}

function syncBlockingFeedbackToast(): void {
  if (!isStatusPage()) {
    document.getElementById(BLOCKING_FEEDBACK_ROOT_ID)?.remove();
    return;
  }

  const toast = ensureBlockingFeedbackToast();
  toast.dataset.tone = blockingFeedbackTone;
  toast.textContent = blockingFeedbackMessage;
  toast.hidden = blockingFeedbackTone === 'idle' || blockingFeedbackMessage.length === 0;
}

function ensureBlockingFeedbackToast(): HTMLParagraphElement {
  let toast = document.getElementById(BLOCKING_FEEDBACK_ROOT_ID) as HTMLParagraphElement | null;
  if (toast) {
    return toast;
  }

  toast = document.createElement('p');
  toast.id = BLOCKING_FEEDBACK_ROOT_ID;
  toast.hidden = true;
  document.body.append(toast);
  return toast;
}

function showBlockingFeedback(
  tone: 'loading' | BlockingFeedbackTone,
  message: string,
  durationMs?: number,
): void {
  window.clearTimeout(blockingFeedbackTimeout);
  blockingFeedbackTone = tone;
  blockingFeedbackMessage = message;
  syncBlockingFeedbackToast();

  if (durationMs === undefined) {
    return;
  }

  blockingFeedbackTimeout = window.setTimeout(() => {
    blockingFeedbackTone = 'idle';
    blockingFeedbackMessage = '';
    syncBlockingFeedbackToast();
  }, durationMs);
}

function ensureFloatingCaptureCard(): HTMLDivElement {
  let card = document.getElementById(FLOATING_CAPTURE_ROOT_ID) as HTMLDivElement | null;
  if (card) {
    return card;
  }

  card = document.createElement('div');
  card.id = FLOATING_CAPTURE_ROOT_ID;
  card.dataset.tone = captureTone;
  card.innerHTML = `
    <p class="xcnspamshield-floating-capture-message"></p>
    <div class="xcnspamshield-floating-capture-shell">
      <button class="xcnspamshield-floating-drag-handle" type="button" aria-label="拖拽抓取按钮">⋮⋮</button>
      <button class="xcnspamshield-floating-capture-button" type="button">抓取</button>
    </div>
  `;

  const button = card.querySelector<HTMLButtonElement>('.xcnspamshield-floating-capture-button');
  const dragHandle = card.querySelector<HTMLButtonElement>('.xcnspamshield-floating-drag-handle');
  button?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void runFloatingCapture();
  });

  document.body.append(card);
  setupFloatingDrag(card, dragHandle);
  applyFloatingPosition(card);
  return card;
}

async function runFloatingCapture(): Promise<void> {
  if (captureInProgress || !contentContextActive) {
    return;
  }

  window.clearTimeout(feedbackTimeout);
  captureInProgress = true;
  captureTone = 'loading';
  captureMessage = '';
  syncFloatingCaptureCard();

  try {
    const replies = await extractAndPersistCurrentThread();
    if (!replies) {
      captureTone = 'error';
      captureMessage = '当前页面未识别到可抓取的帖子线程。';
      scheduleFeedbackReset(2200);
      return;
    }

    captureTone = 'success';
    captureMessage = `本次抓取 ${replies.length} 条回复`;
    scheduleFeedbackReset(1800);
    await runScan();
  } catch (error) {
    captureTone = 'error';
    captureMessage = error instanceof Error ? error.message : '抓取失败，请稍后重试。';
    scheduleFeedbackReset(2200);
  } finally {
    captureInProgress = false;
    syncFloatingCaptureCard();
  }
}

function scheduleFeedbackReset(delayMs: number): void {
  window.clearTimeout(feedbackTimeout);
  feedbackTimeout = window.setTimeout(() => {
    captureTone = 'idle';
    captureMessage = '';
    syncFloatingCaptureCard();
  }, delayMs);
}

function setupFloatingDrag(card: HTMLDivElement, dragHandle: HTMLButtonElement | null): void {
  if (!dragHandle) {
    return;
  }

  dragHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();

    const rect = card.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    dragHandle.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextPosition = clampFloatingPixels(
        {
          left: moveEvent.clientX - offsetX,
          top: moveEvent.clientY - offsetY,
        },
        width,
        height,
      );
      floatingPosition = positionToRatio(nextPosition, width, height);
      applyFloatingPosition(card);
    };

    const release = () => {
      dragHandle.releasePointerCapture(event.pointerId);
      dragHandle.removeEventListener('pointermove', handlePointerMove);
      dragHandle.removeEventListener('pointerup', release);
      dragHandle.removeEventListener('pointercancel', release);
      void persistFloatingPosition();
    };

    dragHandle.addEventListener('pointermove', handlePointerMove);
    dragHandle.addEventListener('pointerup', release);
    dragHandle.addEventListener('pointercancel', release);
  });
}

function applyFloatingPosition(card: HTMLDivElement): void {
  const rect = card.getBoundingClientRect();
  const resolvedPosition = ratioToPosition(
    floatingPosition ?? currentSettings?.floatingCapturePosition ?? DEFAULT_SETTINGS.floatingCapturePosition,
    rect.width,
    rect.height,
  );

  card.style.left = `${resolvedPosition.left}px`;
  card.style.top = `${resolvedPosition.top}px`;
  card.style.right = 'auto';
  card.style.bottom = 'auto';
}

function clampFloatingPixels(position: { left: number; top: number }, width: number, height: number): { left: number; top: number } {
  return {
    left: Math.min(Math.max(8, position.left), window.innerWidth - width - 8),
    top: Math.min(Math.max(8, position.top), window.innerHeight - height - 8),
  };
}

function ratioToPosition(
  position: ExtensionSettings['floatingCapturePosition'],
  width: number,
  height: number,
): { left: number; top: number } {
  const availableWidth = Math.max(window.innerWidth - width - 16, 8);
  const availableHeight = Math.max(window.innerHeight - height - 16, 8);

  return clampFloatingPixels(
    {
      left: 8 + availableWidth * position.xRatio,
      top: 8 + availableHeight * position.yRatio,
    },
    width,
    height,
  );
}

function positionToRatio(
  position: { left: number; top: number },
  width: number,
  height: number,
): ExtensionSettings['floatingCapturePosition'] {
  const availableWidth = Math.max(window.innerWidth - width - 16, 1);
  const availableHeight = Math.max(window.innerHeight - height - 16, 1);

  return {
    xRatio: clampRatio((position.left - 8) / availableWidth),
    yRatio: clampRatio((position.top - 8) / availableHeight),
  };
}

function clampRatio(value: number): number {
  return Math.min(Math.max(0, value), 1);
}

async function persistFloatingPosition(): Promise<void> {
  if (!contentContextActive || !floatingPosition) {
    return;
  }

  const response = await sendContentRuntimeMessage({
    type: 'SET_FLOATING_CAPTURE_POSITION',
    position: floatingPosition,
  });

  if (response.ok && response.data) {
    currentSettings = response.data;
    floatingPosition = response.data.floatingCapturePosition;
  }
}

async function sendContentRuntimeMessage<T extends RuntimeRequest>(
  message: T,
): Promise<ReturnType<typeof sendRuntimeMessage<T>> extends Promise<infer TResult> ? TResult : never> {
  const response = await sendRuntimeMessage(message);
  if (!response.ok && isExtensionContextInvalidatedError(response.error)) {
    deactivateContentContext();
  }

  return response;
}

function deactivateContentContext(): void {
  if (!contentContextActive) {
    return;
  }

  contentContextActive = false;
  window.clearTimeout(scanTimeout);
  if (scanFrameHandle !== undefined) {
    window.cancelAnimationFrame(scanFrameHandle);
    scanFrameHandle = undefined;
  }
  window.clearTimeout(feedbackTimeout);
  mutationObserver?.disconnect();
  mutationObserver = null;
  document.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
  pendingStoredReplyIds.clear();
  pendingInferenceReplyIds.clear();
  clearTweetAuthorIdentityCache();
  replyResultCache.clear();
  replyBlockingStateByReplyId.clear();
  replyBlockingStateByAuthor.clear();
  replyBlockingStateByAuthorId.clear();
  if (pageBridgeListenerRegistered) {
    window.removeEventListener(PAGE_BRIDGE_EVENT_NAME, handlePageBridgeIdentities as EventListener);
    pageBridgeListenerRegistered = false;
  }
  captureInProgress = false;
  captureTone = 'idle';
  captureMessage = '';
  document.getElementById(FLOATING_CAPTURE_ROOT_ID)?.remove();
  clearInjectedTweetUi();
}

function clearInjectedTweetUi(): void {
  for (const article of getLoadedTweetArticles()) {
    clearActionButton(article);
    clearQueuedHiddenState(article);
    clearCollapsedState(article);
  }
}

function normalizeAuthorHandle(author: string): string {
  return author.replace(/^@+/u, '').trim().toLowerCase();
}

function normalizeAuthorId(authorId?: string): string | undefined {
  const normalizedAuthorId = authorId?.trim();
  return normalizedAuthorId || undefined;
}

function getCachedReplyModerationState(tweet: ParsedTweet): Exclude<ReplyBlockingState, 'none'> | null {
  const replyState = replyBlockingStateByReplyId.get(tweet.tweetId);
  if (replyState && replyState !== 'none') {
    return replyState;
  }

  const authorIdState = normalizeAuthorId(tweet.authorId)
    ? replyBlockingStateByAuthorId.get(normalizeAuthorId(tweet.authorId)!)
    : undefined;
  if (authorIdState && authorIdState !== 'none') {
    return authorIdState;
  }

  const authorState = replyBlockingStateByAuthor.get(normalizeAuthorHandle(tweet.author));
  if (authorState && authorState !== 'none') {
    return authorState;
  }

  return null;
}

function getCachedReplyBlockingState(tweet: ParsedTweet): Exclude<ReplyBlockingState, 'none' | 'whitelisted'> | null {
  const moderationState = getCachedReplyModerationState(tweet);
  return moderationState === 'queued' || moderationState === 'blocked' ? moderationState : null;
}

function setReplyBlockingStateCache(
  replyId: string,
  author: string | undefined,
  authorId: string | undefined,
  state: Exclude<ReplyBlockingState, 'none'>,
): void {
  if (!replyId) {
    return;
  }

  if (replyBlockingStateByReplyId.has(replyId)) {
    replyBlockingStateByReplyId.delete(replyId);
  }
  replyBlockingStateByReplyId.set(replyId, state);

  while (replyBlockingStateByReplyId.size > MAX_CACHED_BLOCKING_STATES) {
    const oldestReplyId = replyBlockingStateByReplyId.keys().next().value;
    if (!oldestReplyId) {
      break;
    }
    replyBlockingStateByReplyId.delete(oldestReplyId);
  }

  if (author) {
    replyBlockingStateByAuthor.set(author, state);
  }
  if (authorId) {
    replyBlockingStateByAuthorId.set(authorId, state);
  }
}

function getReplyStatePriority(state: ReplyBlockingState): number {
  switch (state) {
    case 'blocked':
      return 3;
    case 'queued':
      return 2;
    case 'whitelisted':
      return 1;
    case 'none':
      return 0;
  }
}

function getDefaultReplyDecisionForModerationState(
  moderationState: Exclude<ReplyBlockingState, 'none'> | null,
): CachedReplyResult | undefined {
  if (moderationState !== 'whitelisted') {
    return undefined;
  }

  return {
    label: 0,
    source: 'auto',
    isPersisted: false,
  };
}

function getCachedReplyDecision(replyId: string): CachedReplyResult | undefined {
  const cachedDecision = replyResultCache.get(replyId);
  if (!cachedDecision || !currentSettings) {
    return cachedDecision;
  }

  return resolveCachedReplyResult(cachedDecision, currentSettings.modelThreshold);
}

function hasCachedReplyDecision(replyId: string): boolean {
  return Boolean(replyResultCache.get(replyId));
}

function cachePersistedReply(reply: ReplyRecord): void {
  replyResultCache.set(reply.replyId, cachedReplyResultFromRecord(reply, true));
}

function cacheTransientReply(reply: ReplyRecord): void {
  replyResultCache.set(reply.replyId, cachedReplyResultFromRecord(reply, false));
}

function getCurrentThreadIdFromLocation(): string | null {
  const match = window.location.pathname.match(/\/status\/(\d+)/u);
  return match?.[1] ?? null;
}
