import * as ort from 'onnxruntime-web/wasm';
import { PaddleOcrService } from 'paddleocr';

import {
  AVATAR_OCR_WORKER_REQUEST_TYPE,
  MAX_AVATAR_OCR_CACHE_SIZE,
  buildAvatarImageCandidates,
  isAvatarOcrWorkerRequest,
  normalizeAvatarImageUrl,
  normalizeAvatarOcrText,
  trimAvatarOcrCache,
  type AvatarOcrWorkerRequest,
  type AvatarOcrWorkerResponse,
} from '@/shared/avatar-ocr';

const OCR_DETECTION_MODEL_FILE = '../ocr/PP-OCRv3_mobile_det_infer.onnx';
const OCR_RECOGNITION_MODEL_FILE = '../ocr/PP-OCRv3_mobile_rec_infer.onnx';
const OCR_DICTIONARY_FILE = '../ocr/ppocr_keys_v1.txt';
const ORT_WASM_MJS_FILE = '../ort/ort-wasm-simd-threaded.mjs';
const ORT_WASM_FILE = '../ort/ort-wasm-simd-threaded.wasm';
const TARGET_MIN_IMAGE_SIDE = 192;
const MAX_IMAGE_SCALE_FACTOR = 4;

type AvatarImageInput = {
  width: number;
  height: number;
  data: Uint8Array;
};

type CachedAvatarOcrResult = {
  avatarOcrText: string | null;
  rawText: string | null;
  ocrConfidence: number | null;
};

type LoadedAvatarImage = {
  imageInput: AvatarImageInput;
  imageLoadDurationMs: number | null;
};

const avatarOcrCache = new Map<string, CachedAvatarOcrResult>();

let paddleOcrServicePromise: Promise<PaddleOcrService | null> | undefined;
let recognitionQueue: Promise<void> = Promise.resolve();
let pendingRecognitionCount = 0;

globalThis.addEventListener('message', (event: MessageEvent<AvatarOcrWorkerRequest>) => {
  const message = event.data;
  if (!isAvatarOcrWorkerRequest(message)) {
    return;
  }

  const queueDepthAtStart = pendingRecognitionCount;
  pendingRecognitionCount += 1;

  const task = recognitionQueue.then(
    () => recognizeAvatarText(message, queueDepthAtStart),
    () => recognizeAvatarText(message, queueDepthAtStart),
  );

  recognitionQueue = task.then(() => undefined, () => undefined);

  void task.then((response) => {
    globalThis.postMessage(response);
  });
});

async function recognizeAvatarText(
  message: AvatarOcrWorkerRequest,
  queueDepthAtStart: number,
): Promise<AvatarOcrWorkerResponse> {
  const startedAt = performance.now();
  const normalizedAvatarImageUrl = normalizeAvatarImageUrl(message.avatarImageUrl);

  try {
    if (!normalizedAvatarImageUrl) {
      return buildWorkerResponse(message, queueDepthAtStart, startedAt, {
        avatarImageUrl: message.avatarImageUrl,
        avatarOcrText: null,
        rawText: null,
        source: 'worker-run',
        error: 'Avatar image URL is empty.',
      });
    }

    if (avatarOcrCache.has(normalizedAvatarImageUrl)) {
      const cachedAvatarOcrResult = avatarOcrCache.get(normalizedAvatarImageUrl) ?? {
        avatarOcrText: null,
        rawText: null,
        ocrConfidence: null,
      };

      return buildWorkerResponse(message, queueDepthAtStart, startedAt, {
        avatarImageUrl: normalizedAvatarImageUrl,
        avatarOcrText: cachedAvatarOcrResult.avatarOcrText,
        rawText: cachedAvatarOcrResult.rawText,
        ocrConfidence: cachedAvatarOcrResult.ocrConfidence,
        imageLoadDurationMs: normalizeDuration(message.avatarImageLoadDurationMs),
        source: 'worker-cache',
      });
    }

    const paddleOcrService = await getPaddleOcrService();
    if (!paddleOcrService) {
      return buildWorkerResponse(message, queueDepthAtStart, startedAt, {
        avatarImageUrl: normalizedAvatarImageUrl,
        avatarOcrText: null,
        rawText: null,
        ocrConfidence: null,
        imageLoadDurationMs: normalizeDuration(message.avatarImageLoadDurationMs),
        source: 'worker-run',
        error: 'Avatar OCR worker could not initialize PaddleOCR.',
      });
    }

    const loadedAvatarImage = await loadAvatarImageInput(message);
    if (!loadedAvatarImage) {
      avatarOcrCache.set(normalizedAvatarImageUrl, {
        avatarOcrText: null,
        rawText: null,
        ocrConfidence: null,
      });
      trimAvatarOcrCache(avatarOcrCache, MAX_AVATAR_OCR_CACHE_SIZE);

      return buildWorkerResponse(message, queueDepthAtStart, startedAt, {
        avatarImageUrl: normalizedAvatarImageUrl,
        avatarOcrText: null,
        rawText: null,
        ocrConfidence: null,
        imageLoadDurationMs: normalizeDuration(message.avatarImageLoadDurationMs),
        source: 'worker-run',
        error: 'Avatar OCR worker could not decode the avatar image.',
      });
    }

    const recognition = await paddleOcrService.recognize(loadedAvatarImage.imageInput, {
      detection: {
        minimumAreaThreshold: 8,
        textPixelThreshold: 0.42,
        paddingBoxVertical: 0.12,
        paddingBoxHorizontal: 0.12,
      },
      ordering: {
        sortByReadingOrder: true,
        sameLineThresholdRatio: 0.2,
      },
    });
    const processedRecognition = paddleOcrService.processRecognition(recognition, {
      lineMergeThresholdRatio: 0.7,
    });

    const rawText = processedRecognition.text.trim() || null;
    const avatarOcrText = normalizeAvatarOcrText(processedRecognition.text);
    const ocrConfidence = normalizeConfidence(processedRecognition.confidence);

    avatarOcrCache.set(normalizedAvatarImageUrl, {
      avatarOcrText,
      rawText,
      ocrConfidence,
    });
    trimAvatarOcrCache(avatarOcrCache, MAX_AVATAR_OCR_CACHE_SIZE);

    return buildWorkerResponse(message, queueDepthAtStart, startedAt, {
      avatarImageUrl: normalizedAvatarImageUrl,
      avatarOcrText,
      rawText,
      ocrConfidence,
      imageLoadDurationMs: loadedAvatarImage.imageLoadDurationMs,
      source: 'worker-run',
    });
  } catch (error) {
    return buildWorkerResponse(message, queueDepthAtStart, startedAt, {
      avatarImageUrl: normalizedAvatarImageUrl ?? message.avatarImageUrl,
      avatarOcrText: null,
      rawText: null,
      ocrConfidence: null,
      imageLoadDurationMs: normalizeDuration(message.avatarImageLoadDurationMs),
      source: 'worker-run',
      error: error instanceof Error ? error.message : 'Unknown avatar OCR worker error',
    });
  } finally {
    pendingRecognitionCount = Math.max(0, pendingRecognitionCount - 1);
  }
}

async function getPaddleOcrService(): Promise<PaddleOcrService | null> {
  if (!paddleOcrServicePromise) {
    paddleOcrServicePromise = createPaddleOcrService().catch((error) => {
      console.warn('XCNSpamShield avatar OCR worker initialization failed', error);
      return null;
    });
  }

  return paddleOcrServicePromise;
}

async function createPaddleOcrService(): Promise<PaddleOcrService | null> {
  ort.env.logLevel = 'error';
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    mjs: getAssetUrl(ORT_WASM_MJS_FILE),
    wasm: getAssetUrl(ORT_WASM_FILE),
  };

  const [detectionModelBuffer, recognitionModelBuffer, dictionaryText] = await Promise.all([
    fetchAssetArrayBuffer(OCR_DETECTION_MODEL_FILE),
    fetchAssetArrayBuffer(OCR_RECOGNITION_MODEL_FILE),
    fetchAssetText(OCR_DICTIONARY_FILE),
  ]);

  const charactersDictionary = dictionaryText.split(/\r?\n/u).map((token) => token.trim()).filter(Boolean);
  if (charactersDictionary.length === 0) {
    return null;
  }

  return PaddleOcrService.createInstance({
    ort,
    detection: {
      modelBuffer: detectionModelBuffer,
      minimumAreaThreshold: 8,
      textPixelThreshold: 0.42,
      paddingBoxVertical: 0.12,
      paddingBoxHorizontal: 0.12,
    },
    recognition: {
      modelBuffer: recognitionModelBuffer,
      charactersDictionary,
      imageHeight: 48,
    },
  });
}

async function fetchAssetArrayBuffer(assetPath: string): Promise<ArrayBuffer> {
  const response = await fetch(getAssetUrl(assetPath));
  if (!response.ok) {
    throw new Error(`Failed to load asset: ${assetPath}`);
  }

  return response.arrayBuffer();
}

async function fetchAssetText(assetPath: string): Promise<string> {
  const response = await fetch(getAssetUrl(assetPath));
  if (!response.ok) {
    throw new Error(`Failed to load asset: ${assetPath}`);
  }

  return response.text();
}

async function loadAvatarImageInput(message: AvatarOcrWorkerRequest): Promise<LoadedAvatarImage | null> {
  const normalizedAvatarImageDataUrl = message.avatarImageDataUrl?.trim();
  if (normalizedAvatarImageDataUrl) {
    const imageInput = await loadAvatarImageInputFromDataUrl(normalizedAvatarImageDataUrl);
    if (!imageInput) {
      return null;
    }

    return {
      imageInput,
      imageLoadDurationMs: normalizeDuration(message.avatarImageLoadDurationMs),
    };
  }

  return loadAvatarImageInputFromUrl(message.avatarImageUrl);
}

async function loadAvatarImageInputFromUrl(avatarImageUrl: string): Promise<LoadedAvatarImage | null> {
  const candidateUrls = buildAvatarImageCandidates(avatarImageUrl);
  const imageLoadStartedAt = performance.now();

  for (const candidateUrl of candidateUrls) {
    try {
      const response = await fetch(candidateUrl, {
        credentials: 'omit',
      });
      if (!response.ok) {
        continue;
      }

      const rasterizedImage = await rasterizeImageBlob(await response.blob());
      if (rasterizedImage) {
        return {
          imageInput: rasterizedImage,
          imageLoadDurationMs: performance.now() - imageLoadStartedAt,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function loadAvatarImageInputFromDataUrl(avatarImageDataUrl: string): Promise<AvatarImageInput | null> {
  try {
    const response = await fetch(avatarImageDataUrl);
    if (!response.ok) {
      return null;
    }

    return rasterizeImageBlob(await response.blob());
  } catch {
    return null;
  }
}

async function rasterizeImageBlob(imageBlob: Blob): Promise<AvatarImageInput | null> {
  const imageBitmap = await createImageBitmap(imageBlob);

  try {
    return rasterizeImage(imageBitmap);
  } finally {
    imageBitmap.close();
  }
}

function rasterizeImage(imageBitmap: ImageBitmap): AvatarImageInput | null {
  const sourceWidth = imageBitmap.width;
  const sourceHeight = imageBitmap.height;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const scaleFactor = Math.min(
    MAX_IMAGE_SCALE_FACTOR,
    Math.max(1, TARGET_MIN_IMAGE_SIDE / Math.min(sourceWidth, sourceHeight)),
  );
  const targetWidth = Math.max(1, Math.round(sourceWidth * scaleFactor));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scaleFactor));
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.imageSmoothingEnabled = true;
  context.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8Array(imageData.data),
  };
}

function buildWorkerResponse(
  message: AvatarOcrWorkerRequest,
  queueDepthAtStart: number,
  startedAt: number,
  result: {
    avatarImageUrl: string;
    avatarOcrText: string | null;
    rawText: string | null;
    ocrConfidence: number | null;
    imageLoadDurationMs: number | null;
    source: 'worker-cache' | 'worker-run';
    error?: string;
  },
): AvatarOcrWorkerResponse {
  const response: AvatarOcrWorkerResponse = {
    type: AVATAR_OCR_WORKER_REQUEST_TYPE,
    requestId: message.requestId,
    avatarImageUrl: result.avatarImageUrl,
    avatarOcrText: result.avatarOcrText,
    rawText: result.rawText,
    ocrConfidence: result.ocrConfidence,
    imageLoadDurationMs: result.imageLoadDurationMs,
    source: result.source,
    durationMs: performance.now() - startedAt,
    queueDepthAtStart,
    error: result.error,
  };

  console.info('[XCNSpamShield][avatar-ocr-worker]', {
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

function getAssetUrl(assetPath: string): string {
  return new URL(assetPath, globalThis.location.href).href;
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeConfidence(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeDuration(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}