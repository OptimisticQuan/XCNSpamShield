export const AVATAR_OCR_OFFSCREEN_REQUEST_TYPE = 'XCNSPAMSHIELD_OFFSCREEN_OCR_AVATAR';
export const AVATAR_OCR_WORKER_REQUEST_TYPE = 'XCNSPAMSHIELD_WORKER_OCR_AVATAR';
export const MAX_AVATAR_OCR_CACHE_SIZE = 200;

export type AvatarOcrSource = 'worker-cache' | 'worker-run';

export interface AvatarOcrExecutionResult {
  avatarImageUrl: string;
  avatarOcrText: string | null;
  rawText: string | null;
  ocrConfidence: number | null;
  imageLoadDurationMs: number | null;
  source: AvatarOcrSource;
  durationMs: number;
  queueDepthAtStart: number;
  error?: string;
}

export interface AvatarOcrOffscreenRequest {
  type: typeof AVATAR_OCR_OFFSCREEN_REQUEST_TYPE;
  target: 'offscreen';
  requestId: string;
  avatarImageUrl: string;
  avatarImageDataUrl?: string;
  avatarImageLoadDurationMs?: number;
}

export interface AvatarOcrOffscreenResponse extends AvatarOcrExecutionResult {
  type: typeof AVATAR_OCR_OFFSCREEN_REQUEST_TYPE;
  requestId: string;
}

export interface AvatarOcrWorkerRequest {
  type: typeof AVATAR_OCR_WORKER_REQUEST_TYPE;
  requestId: string;
  avatarImageUrl: string;
  avatarImageDataUrl?: string;
  avatarImageLoadDurationMs?: number;
}

export interface AvatarOcrWorkerResponse extends AvatarOcrExecutionResult {
  type: typeof AVATAR_OCR_WORKER_REQUEST_TYPE;
  requestId: string;
}

export function normalizeAvatarImageUrl(avatarImageUrl: string | undefined): string | null {
  const normalizedAvatarImageUrl = avatarImageUrl?.trim();
  return normalizedAvatarImageUrl || null;
}

export function buildAvatarImageCandidates(avatarImageUrl: string): string[] {
  const upgradedAvatarImageUrl = avatarImageUrl
    .replace(/_normal(?=\.[^.?#]+(?:[?#]|$))/iu, '_400x400')
    .replace(/_bigger(?=\.[^.?#]+(?:[?#]|$))/iu, '_400x400')
    .replace(/([?&]name=)(normal|bigger|mini)(?=&|$)/iu, '$1400x400');

  return Array.from(new Set([upgradedAvatarImageUrl, avatarImageUrl]));
}

export function normalizeAvatarOcrText(value: string): string | null {
  const normalizedText = value
    .replace(/[:：]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalizedText || !/[\p{Letter}\p{Number}\p{Script=Han}]/u.test(normalizedText)) {
    return null;
  }

  return normalizedText;
}

export function trimAvatarOcrCache<T>(cache: Map<string, T>, limit: number): void {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }

    cache.delete(oldestKey);
  }
}

export function isAvatarOcrOffscreenRequest(value: unknown): value is AvatarOcrOffscreenRequest {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === AVATAR_OCR_OFFSCREEN_REQUEST_TYPE
    && value.target === 'offscreen'
    && typeof value.requestId === 'string'
    && typeof value.avatarImageUrl === 'string'
    && (value.avatarImageDataUrl === undefined || typeof value.avatarImageDataUrl === 'string')
    && (value.avatarImageLoadDurationMs === undefined || typeof value.avatarImageLoadDurationMs === 'number');
}

export function isAvatarOcrOffscreenResponse(value: unknown): value is AvatarOcrOffscreenResponse {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === AVATAR_OCR_OFFSCREEN_REQUEST_TYPE
    && typeof value.requestId === 'string'
    && typeof value.avatarImageUrl === 'string'
    && typeof value.durationMs === 'number'
    && typeof value.queueDepthAtStart === 'number'
    && (value.avatarOcrText === null || typeof value.avatarOcrText === 'string')
    && (value.rawText === null || typeof value.rawText === 'string')
    && (value.ocrConfidence === null || typeof value.ocrConfidence === 'number')
    && (value.imageLoadDurationMs === null || typeof value.imageLoadDurationMs === 'number')
    && (value.source === 'worker-cache' || value.source === 'worker-run')
    && (value.error === undefined || typeof value.error === 'string');
}

export function isAvatarOcrWorkerRequest(value: unknown): value is AvatarOcrWorkerRequest {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === AVATAR_OCR_WORKER_REQUEST_TYPE
    && typeof value.requestId === 'string'
    && typeof value.avatarImageUrl === 'string'
    && (value.avatarImageDataUrl === undefined || typeof value.avatarImageDataUrl === 'string')
    && (value.avatarImageLoadDurationMs === undefined || typeof value.avatarImageLoadDurationMs === 'number');
}

export function isAvatarOcrWorkerResponse(value: unknown): value is AvatarOcrWorkerResponse {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === AVATAR_OCR_WORKER_REQUEST_TYPE
    && typeof value.requestId === 'string'
    && typeof value.avatarImageUrl === 'string'
    && typeof value.durationMs === 'number'
    && typeof value.queueDepthAtStart === 'number'
    && (value.avatarOcrText === null || typeof value.avatarOcrText === 'string')
    && (value.rawText === null || typeof value.rawText === 'string')
    && (value.ocrConfidence === null || typeof value.ocrConfidence === 'number')
    && (value.imageLoadDurationMs === null || typeof value.imageLoadDurationMs === 'number')
    && (value.source === 'worker-cache' || value.source === 'worker-run')
    && (value.error === undefined || typeof value.error === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}