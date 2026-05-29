import {
  AVATAR_OCR_OFFSCREEN_REQUEST_TYPE,
  AVATAR_OCR_WORKER_REQUEST_TYPE,
  type AvatarOcrOffscreenRequest,
  type AvatarOcrOffscreenResponse,
  type AvatarOcrWorkerRequest,
  type AvatarOcrWorkerResponse,
  isAvatarOcrOffscreenRequest,
  isAvatarOcrWorkerResponse,
} from '@/shared/avatar-ocr';

type PendingAvatarOcrRequest = {
  resolve: (response: AvatarOcrWorkerResponse) => void;
  reject: (error: Error) => void;
};

const pendingAvatarOcrRequests = new Map<string, PendingAvatarOcrRequest>();

let avatarOcrWorker: Worker | undefined;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isAvatarOcrOffscreenRequest(message) || message.target !== 'offscreen') {
    return false;
  }

  void handleAvatarOcrRequest(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse(buildAvatarOcrFailureResponse(message, error));
    });

  return true;
});

async function handleAvatarOcrRequest(message: AvatarOcrOffscreenRequest): Promise<AvatarOcrOffscreenResponse> {
  const workerResponse = await requestAvatarOcrFromWorker(message);
  const response: AvatarOcrOffscreenResponse = {
    type: AVATAR_OCR_OFFSCREEN_REQUEST_TYPE,
    requestId: message.requestId,
    avatarImageUrl: workerResponse.avatarImageUrl,
    avatarOcrText: workerResponse.avatarOcrText,
    rawText: workerResponse.rawText,
    ocrConfidence: workerResponse.ocrConfidence,
    imageLoadDurationMs: workerResponse.imageLoadDurationMs,
    source: workerResponse.source,
    durationMs: workerResponse.durationMs,
    queueDepthAtStart: workerResponse.queueDepthAtStart,
    error: workerResponse.error,
  };

  console.info('[XCNSpamShield][avatar-ocr-offscreen]', {
    requestId: response.requestId,
    avatarImageUrl: response.avatarImageUrl,
    source: response.source,
    queueDepthAtStart: response.queueDepthAtStart,
    durationMs: roundDuration(response.durationMs),
    imageLoadDurationMs: roundDuration(response.imageLoadDurationMs ?? 0),
    ocrConfidence: roundScore(response.ocrConfidence ?? 0),
    avatarOcrText: response.avatarOcrText ?? undefined,
    rawText: response.rawText ?? undefined,
    error: response.error,
  });

  return response;
}

async function requestAvatarOcrFromWorker(message: AvatarOcrOffscreenRequest): Promise<AvatarOcrWorkerResponse> {
  const worker = ensureAvatarOcrWorker();

  return new Promise<AvatarOcrWorkerResponse>((resolve, reject) => {
    pendingAvatarOcrRequests.set(message.requestId, { resolve, reject });

    worker.postMessage({
      type: AVATAR_OCR_WORKER_REQUEST_TYPE,
      requestId: message.requestId,
      avatarImageUrl: message.avatarImageUrl,
      avatarImageDataUrl: message.avatarImageDataUrl,
      avatarImageLoadDurationMs: message.avatarImageLoadDurationMs,
    } satisfies AvatarOcrWorkerRequest);
  });
}

function ensureAvatarOcrWorker(): Worker {
  if (avatarOcrWorker) {
    return avatarOcrWorker;
  }

  const worker = new Worker(new URL('./avatar-ocr.worker.ts', import.meta.url), {
    type: 'module',
    name: 'xcnspamshield-avatar-ocr',
  });

  worker.addEventListener('message', (event: MessageEvent<AvatarOcrWorkerResponse>) => {
    const response = event.data;
    if (!isAvatarOcrWorkerResponse(response)) {
      return;
    }

    const pendingRequest = pendingAvatarOcrRequests.get(response.requestId);
    if (!pendingRequest) {
      return;
    }

    pendingAvatarOcrRequests.delete(response.requestId);
    pendingRequest.resolve(response);
  });

  worker.addEventListener('error', (event) => {
    resetAvatarOcrWorker(event.message || 'Avatar OCR worker crashed.');
  });

  avatarOcrWorker = worker;
  return worker;
}

function resetAvatarOcrWorker(errorMessage: string): void {
  if (avatarOcrWorker) {
    avatarOcrWorker.terminate();
    avatarOcrWorker = undefined;
  }

  for (const [requestId, pendingRequest] of pendingAvatarOcrRequests.entries()) {
    pendingRequest.reject(new Error(`${errorMessage} requestId=${requestId}`));
  }

  pendingAvatarOcrRequests.clear();
}

function buildAvatarOcrFailureResponse(
  message: AvatarOcrOffscreenRequest,
  error: unknown,
): AvatarOcrOffscreenResponse {
  return {
    type: AVATAR_OCR_OFFSCREEN_REQUEST_TYPE,
    requestId: message.requestId,
    avatarImageUrl: message.avatarImageUrl,
    avatarOcrText: null,
    rawText: null,
    ocrConfidence: null,
    imageLoadDurationMs: message.avatarImageLoadDurationMs ?? null,
    source: 'worker-run',
    durationMs: 0,
    queueDepthAtStart: 0,
    error: error instanceof Error ? error.message : 'Unknown avatar OCR offscreen error',
  };
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}