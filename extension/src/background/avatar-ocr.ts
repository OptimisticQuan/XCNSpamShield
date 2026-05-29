import {
  AVATAR_OCR_OFFSCREEN_REQUEST_TYPE,
  MAX_AVATAR_OCR_CACHE_SIZE,
  type AvatarOcrExecutionResult,
  type AvatarOcrOffscreenRequest,
  isAvatarOcrOffscreenResponse,
  normalizeAvatarImageUrl,
  trimAvatarOcrCache,
} from '@/shared/avatar-ocr';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

const avatarOcrTaskCache = new Map<string, Promise<AvatarOcrExecutionResult>>();

let avatarOcrRequestCounter = 0;
let offscreenDocumentCreationPromise: Promise<void> | null = null;

export async function resolveAvatarOcrResult({
  avatarImageUrl,
  avatarImageDataUrl,
  avatarImageLoadDurationMs,
}: {
  avatarImageUrl: string | undefined;
  avatarImageDataUrl?: string;
  avatarImageLoadDurationMs?: number;
}): Promise<AvatarOcrExecutionResult | undefined> {
  const normalizedAvatarImageUrl = normalizeAvatarImageUrl(avatarImageUrl);
  if (!normalizedAvatarImageUrl) {
    return undefined;
  }

  const cachedTask = avatarOcrTaskCache.get(normalizedAvatarImageUrl);
  if (cachedTask) {
    avatarOcrTaskCache.delete(normalizedAvatarImageUrl);
    avatarOcrTaskCache.set(normalizedAvatarImageUrl, cachedTask);
    return (await cachedTask) ?? undefined;
  }

  const task = requestAvatarOcr({
    avatarImageUrl: normalizedAvatarImageUrl,
    avatarImageDataUrl,
    avatarImageLoadDurationMs,
  });
  avatarOcrTaskCache.set(normalizedAvatarImageUrl, task);
  trimAvatarOcrCache(avatarOcrTaskCache, MAX_AVATAR_OCR_CACHE_SIZE);

  return (await task) ?? undefined;
}

export async function resolveAvatarOcrText(avatarImageUrl: string | undefined): Promise<string | undefined> {
  const result = await resolveAvatarOcrResult({ avatarImageUrl });
  return result?.avatarOcrText ?? undefined;
}

async function requestAvatarOcr({
  avatarImageUrl,
  avatarImageDataUrl,
  avatarImageLoadDurationMs,
}: {
  avatarImageUrl: string;
  avatarImageDataUrl?: string;
  avatarImageLoadDurationMs?: number;
}): Promise<AvatarOcrExecutionResult> {
  const requestId = nextAvatarOcrRequestId();
  const startedAt = performance.now();
  const normalizedAvatarImageDataUrl = avatarImageDataUrl?.trim() || undefined;
  const normalizedAvatarImageLoadDurationMs = normalizeDuration(avatarImageLoadDurationMs);

  try {
    await ensureOffscreenOcrDocument();

    const response = await chrome.runtime.sendMessage({
      type: AVATAR_OCR_OFFSCREEN_REQUEST_TYPE,
      target: 'offscreen',
      requestId,
      avatarImageUrl,
      avatarImageDataUrl: normalizedAvatarImageDataUrl,
      avatarImageLoadDurationMs: normalizedAvatarImageLoadDurationMs ?? undefined,
    } satisfies AvatarOcrOffscreenRequest);

    if (!isAvatarOcrOffscreenResponse(response) || response.requestId !== requestId) {
      throw new Error('Avatar OCR response was invalid.');
    }

    logAvatarOcrResult({
      requestId,
      avatarImageUrl,
      totalDurationMs: performance.now() - startedAt,
      workerDurationMs: response.durationMs,
      queueDepthAtStart: response.queueDepthAtStart,
      source: response.source,
      avatarOcrText: response.avatarOcrText,
      rawText: response.rawText,
      ocrConfidence: response.ocrConfidence,
      imageLoadDurationMs: response.imageLoadDurationMs,
      error: response.error,
    });

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown avatar OCR error';
    const failureResult: AvatarOcrExecutionResult = {
      avatarImageUrl,
      avatarOcrText: null,
      rawText: null,
      ocrConfidence: null,
      imageLoadDurationMs: normalizedAvatarImageLoadDurationMs,
      source: 'worker-run',
      durationMs: 0,
      queueDepthAtStart: 0,
      error: errorMessage,
    };

    logAvatarOcrResult({
      requestId,
      avatarImageUrl,
      totalDurationMs: performance.now() - startedAt,
      workerDurationMs: failureResult.durationMs,
      queueDepthAtStart: failureResult.queueDepthAtStart,
      source: failureResult.source,
      avatarOcrText: failureResult.avatarOcrText,
      rawText: failureResult.rawText,
      ocrConfidence: failureResult.ocrConfidence,
      imageLoadDurationMs: failureResult.imageLoadDurationMs,
      error: failureResult.error,
    });
    return failureResult;
  }
}

async function ensureOffscreenOcrDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (offscreenDocumentCreationPromise) {
    await offscreenDocumentCreationPromise;
    return;
  }

  offscreenDocumentCreationPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['WORKERS', 'BLOBS'],
    justification: 'Run avatar OCR in a dedicated worker without blocking the extension service worker.',
  }).finally(() => {
    offscreenDocumentCreationPromise = null;
  });

  await offscreenDocumentCreationPromise;
}

function nextAvatarOcrRequestId(): string {
  avatarOcrRequestCounter += 1;
  return `avatar-ocr-${avatarOcrRequestCounter}`;
}

function logAvatarOcrResult({
  requestId,
  avatarImageUrl,
  totalDurationMs,
  workerDurationMs,
  queueDepthAtStart,
  source,
  avatarOcrText,
  rawText,
  ocrConfidence,
  imageLoadDurationMs,
  error,
}: {
  requestId: string;
  avatarImageUrl: string;
  totalDurationMs: number;
  workerDurationMs: number;
  queueDepthAtStart: number;
  source: 'worker-cache' | 'worker-run';
  avatarOcrText: string | null;
  rawText: string | null;
  ocrConfidence: number | null;
  imageLoadDurationMs: number | null;
  error?: string;
}): void {
  console.info('[XCNSpamShield][avatar-ocr]', {
    requestId,
    avatarImageUrl,
    source,
    queueDepthAtStart,
    totalDurationMs: roundDuration(totalDurationMs),
    workerDurationMs: roundDuration(workerDurationMs),
    imageLoadDurationMs: roundDuration(imageLoadDurationMs ?? 0),
    ocrConfidence: roundScore(ocrConfidence ?? 0),
    avatarOcrText: avatarOcrText ?? undefined,
    rawText: rawText ?? undefined,
    error,
  });
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeDuration(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}