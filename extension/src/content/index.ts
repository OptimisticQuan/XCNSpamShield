import '@/content/content.css';

import { clearActionButton, ensureActionButton } from '@/content/actions';
import { applyCollapsedState, clearCollapsedState } from '@/content/collapser';
import { collectCurrentThread, toCollectedReply } from '@/content/extractor';
import { collectParsedTweets, extractMainTweet, getLoadedTweetArticles, isStatusPage, type ParsedTweet } from '@/content/selectors';
import { ACTION_BUTTON_CLASS, DEFAULT_SETTINGS, FLOATING_CAPTURE_ROOT_ID, THREAD_SCAN_DEBOUNCE_MS, THREAD_SCROLL_SCAN_DEBOUNCE_MS } from '@/shared/constants';
import type { ContentRequest, RuntimeRequest } from '@/shared/messages';
import { isExtensionContextInvalidatedError, sendRuntimeMessage } from '@/shared/messages';
import type { CollectedThreadPayload, ExtensionSettings, ReplyRecord } from '@/shared/types';

declare global {
  var __xspamshieldContentInitialized__: boolean | undefined;
}

let currentSettings: ExtensionSettings | null = null;
let scanTimeout: number | undefined;
let scanFrameHandle: number | undefined;
const storedReplyMap = new Map<string, ReplyRecord>();
const transientReplyMap = new Map<string, ReplyRecord>();
const pendingStoredReplyIds = new Set<string>();
const pendingInferenceReplyIds = new Set<string>();
let bootstrapPromise: Promise<void> = Promise.resolve();
let captureInProgress = false;
let captureTone: 'idle' | 'loading' | 'success' | 'error' = 'idle';
let captureMessage = '';
let activeThreadId: string | null = null;
let floatingPosition: ExtensionSettings['floatingCapturePosition'] | null = null;
let feedbackTimeout: number | undefined;
let mutationObserver: MutationObserver | null = null;
let contentContextActive = true;
let scanInProgress = false;
let rerunScanRequested = false;

if (!globalThis.__xspamshieldContentInitialized__) {
  globalThis.__xspamshieldContentInitialized__ = true;
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

    if (message.type === 'APPLY_SETTINGS') {
      currentSettings = message.settings;
      floatingPosition = message.settings.floatingCapturePosition;
      transientReplyMap.clear();
      void runScan();
    }

    return false;
  });
}

async function bootstrap(): Promise<void> {
  const settingsResponse = await sendContentRuntimeMessage({ type: 'GET_SETTINGS' });

  if (!contentContextActive) {
    return;
  }

  currentSettings = settingsResponse.data ?? { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
  floatingPosition = currentSettings.floatingCapturePosition;

  syncFloatingCaptureCard();
  observeMutations();
  await runScan();
}

async function handleExtraction(sendResponse: (response: CollectedThreadPayload | null) => void): Promise<void> {
  try {
    await bootstrapPromise;
    sendResponse(collectCurrentThread());
  } catch (error) {
    console.error('XSpamShield extraction failed', error);
    sendResponse(null);
  }
}

function observeMutations(): void {
  mutationObserver = new MutationObserver(() => {
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
    transientReplyMap.clear();
    pendingStoredReplyIds.clear();
    pendingInferenceReplyIds.clear();
    clearInjectedTweetUi();
    return;
  }

  const parsedTweets = collectParsedTweets();
  const mainTweet = extractMainTweet(parsedTweets);
  if (!mainTweet) {
    activeThreadId = null;
    transientReplyMap.clear();
    return;
  }

  if (activeThreadId !== mainTweet.tweetId) {
    activeThreadId = mainTweet.tweetId;
    transientReplyMap.clear();
    pendingStoredReplyIds.clear();
    pendingInferenceReplyIds.clear();
  }

  const allowManualToggle = isStatusPage();
  const visibleReplies = parsedTweets.filter((tweet) => tweet.tweetId !== mainTweet.tweetId && isTweetVisible(tweet.article));

  clearActionButton(mainTweet.article);

  void warmVisibleReplyDecisions(mainTweet, visibleReplies);

  for (const tweet of visibleReplies) {
    const decision = storedReplyMap.get(tweet.tweetId) ?? transientReplyMap.get(tweet.tweetId);
    if (!decision) {
      continue;
    }

    const shouldCollapse = currentSettings.blockingEnabled && decision.label === 1;

    if (shouldCollapse) {
      applyCollapsedState(tweet.article, getCollapseReason(decision));
    } else {
      clearCollapsedState(tweet.article);
    }

    const isExpandedSpam = shouldCollapse && tweet.article.dataset.xspamshieldExpanded === 'true';

    if (allowManualToggle && (!shouldCollapse || isExpandedSpam)) {
      ensureActionButton(tweet.article, { isSpam: decision.label === 1, isManual: decision.source === 'manual' }, () => {
        void toggleReply(mainTweet, tweet, decision);
      });
    } else {
      clearActionButton(tweet.article);
    }
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

function getCollapseReason(decision: ReplyRecord): string {
  if (decision.source === 'manual') {
    return '人工标记';
  }

  if (typeof decision.modelConfidence === 'number') {
    return `模型 ${(decision.modelConfidence * 100).toFixed(1)}%`;
  }

  return '模型命中';
}

async function warmVisibleReplyDecisions(mainTweet: ParsedTweet, replies: ParsedTweet[]): Promise<void> {
  const loadedStoredReplies = await loadStoredReplies(replies);
  const loadedTransientReplies = await loadTransientReplies(mainTweet.tweetId, replies);

  if (loadedStoredReplies || loadedTransientReplies) {
    void runScan();
  }
}

async function loadStoredReplies(replies: ParsedTweet[]): Promise<boolean> {
  const missingReplyIds = replies
    .map((tweet) => tweet.tweetId)
    .filter(
      (replyId) =>
        !storedReplyMap.has(replyId)
        && !transientReplyMap.has(replyId)
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

      console.error('XSpamShield lookup stored replies failed', response.error);
      return false;
    }

    let hasUpdates = false;
    for (const reply of response.data ?? []) {
      storedReplyMap.set(reply.replyId, reply);
      transientReplyMap.delete(reply.replyId);
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
      !storedReplyMap.has(tweet.tweetId)
      && !transientReplyMap.has(tweet.tweetId)
      && !pendingStoredReplyIds.has(tweet.tweetId)
      && !pendingInferenceReplyIds.has(tweet.tweetId),
  );

  if (missingReplies.length === 0) {
    return false;
  }

  const collectedReplies = missingReplies.map(toCollectedReply);
  collectedReplies.forEach((reply) => pendingInferenceReplyIds.add(reply.replyId));

  try {
    const response = await sendContentRuntimeMessage({
      type: 'CLASSIFY_REPLIES',
      payload: {
        threadId,
        replies: collectedReplies,
      },
    });

    if (!response.ok) {
      if (isExtensionContextInvalidatedError(response.error)) {
        return false;
      }

      console.error('XSpamShield classify replies failed', response.error);
      return false;
    }

    let hasUpdates = false;
    for (const reply of response.data ?? []) {
      transientReplyMap.set(reply.replyId, reply);
      hasUpdates = true;
    }

    return hasUpdates;
  } finally {
    collectedReplies.forEach((reply) => pendingInferenceReplyIds.delete(reply.replyId));
  }
}

async function toggleReply(mainTweet: ParsedTweet, replyTweet: ParsedTweet, currentRecord: ReplyRecord): Promise<void> {
  const storedReply = storedReplyMap.get(replyTweet.tweetId);
  const nextLabel = currentRecord.label === 1 ? 0 : 1;

  if (storedReply) {
    const response = await sendContentRuntimeMessage({ type: 'TOGGLE_REPLY_LABEL', replyId: storedReply.replyId });
    if (response.ok && response.data) {
      storedReplyMap.set(replyTweet.tweetId, response.data);
      transientReplyMap.delete(replyTweet.tweetId);
    }
    await runScan();
    return;
  }

  const response = await sendContentRuntimeMessage({
    type: 'UPSERT_MANUAL_REPLY',
    payload: {
      threadId: mainTweet.tweetId,
      mainPost: {
        author: mainTweet.author,
        text: mainTweet.text,
        timestamp: mainTweet.timestamp,
      },
      reply: toCollectedReply(replyTweet),
      label: nextLabel,
      cleanedPinyin: currentRecord.cleanedPinyin,
      modelConfidence: currentRecord.modelConfidence,
    },
  });

  if (response.ok && response.data) {
    storedReplyMap.set(replyTweet.tweetId, response.data);
    transientReplyMap.delete(replyTweet.tweetId);
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
    storedReplyMap.set(reply.replyId, reply);
    transientReplyMap.delete(reply.replyId);
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
  const button = card.querySelector<HTMLButtonElement>('.xspamshield-floating-capture-button');
  const message = card.querySelector<HTMLParagraphElement>('.xspamshield-floating-capture-message');

  if (!button || !message) {
    return;
  }

  card.dataset.tone = captureTone;
  button.disabled = captureInProgress;
  button.textContent = captureInProgress ? '处理中' : '抓取';
  message.textContent = captureMessage;
  message.hidden = captureTone === 'idle' || captureMessage.length === 0;
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
    <p class="xspamshield-floating-capture-message"></p>
    <div class="xspamshield-floating-capture-shell">
      <button class="xspamshield-floating-drag-handle" type="button" aria-label="拖拽抓取按钮">⋮⋮</button>
      <button class="xspamshield-floating-capture-button" type="button">抓取</button>
    </div>
  `;

  const button = card.querySelector<HTMLButtonElement>('.xspamshield-floating-capture-button');
  const dragHandle = card.querySelector<HTMLButtonElement>('.xspamshield-floating-drag-handle');
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
  captureInProgress = false;
  captureTone = 'idle';
  captureMessage = '';
  document.getElementById(FLOATING_CAPTURE_ROOT_ID)?.remove();
  clearInjectedTweetUi();
}

function isTweetVisible(article: HTMLElement): boolean {
  const rect = article.getBoundingClientRect();
  return rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function clearInjectedTweetUi(): void {
  document.querySelectorAll(`.${ACTION_BUTTON_CLASS}`).forEach((button) => button.remove());
  for (const article of getLoadedTweetArticles()) {
    clearCollapsedState(article);
  }
}
