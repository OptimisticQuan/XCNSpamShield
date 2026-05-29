import { collectParsedTweets, extractMainTweet, type ParsedTweet } from '@/content/selectors';
import { buildAvatarImageCandidates } from '@/shared/avatar-ocr';
import type { CollectedReply, CollectedThreadPayload } from '@/shared/types';

type CollectedReplyOverrides = Pick<
  CollectedReply,
  'avatarImageDataUrl' | 'avatarImageLoadDurationMs' | 'avatarOcrText' | 'forceAvatarOcrRecheck'
>;

type AvatarImageDataResult = {
  avatarImageDataUrl?: string;
  avatarImageLoadDurationMs?: number;
};

const AVATAR_IMAGE_SELECTOR = 'div[data-testid="Tweet-User-Avatar"] img, div[data-testid^="UserAvatar-Container-"] img';

export function collectCurrentThread(): CollectedThreadPayload | null {
  const parsedTweets = collectParsedTweets();
  const mainTweet = extractMainTweet(parsedTweets);

  if (!mainTweet) {
    return null;
  }

  return buildCollectedThread(
    mainTweet,
    parsedTweets.filter((tweet) => tweet.tweetId !== mainTweet.tweetId),
  );
}

export function buildCollectedThread(mainTweet: ParsedTweet, replies: ParsedTweet[]): CollectedThreadPayload {
  return {
    threadId: mainTweet.tweetId,
    mainPost: {
      author: mainTweet.author,
      text: mainTweet.text,
      timestamp: mainTweet.timestamp,
    },
    replies: replies.map(toCollectedReply),
  };
}

export function toCollectedReply(tweet: ParsedTweet, overrides: Partial<CollectedReplyOverrides> = {}): CollectedReply {
  return {
    replyId: tweet.tweetId,
    authorId: tweet.authorId,
    author: tweet.author,
    authorName: tweet.authorName,
    avatarImageUrl: tweet.avatarImageUrl,
    avatarImageDataUrl: overrides.avatarImageDataUrl,
    avatarImageLoadDurationMs: overrides.avatarImageLoadDurationMs,
    avatarOcrText: overrides.avatarOcrText,
    forceAvatarOcrRecheck: overrides.forceAvatarOcrRecheck,
    text: tweet.text,
    timestamp: tweet.timestamp,
  };
}

export async function collectRepliesForAvatarOcrRecheck(replies: ParsedTweet[]): Promise<CollectedReply[]> {
  const avatarImageDataByReplyId = await collectAvatarImageDataByReplyId(replies);

  return replies.flatMap((tweet) => {
    const avatarImageData = avatarImageDataByReplyId.get(tweet.tweetId);
    if (!avatarImageData?.avatarImageDataUrl) {
      return [];
    }

    return [
      toCollectedReply(tweet, {
        avatarImageDataUrl: avatarImageData.avatarImageDataUrl,
        avatarImageLoadDurationMs: avatarImageData.avatarImageLoadDurationMs,
        forceAvatarOcrRecheck: true,
      }),
    ];
  });
}

async function collectAvatarImageDataByReplyId(replies: ParsedTweet[]): Promise<Map<string, AvatarImageDataResult>> {
  const firstReplyByAvatarUrl = new Map<string, ParsedTweet>();

  for (const reply of replies) {
    const avatarImageUrl = reply.avatarImageUrl?.trim();
    if (!avatarImageUrl || firstReplyByAvatarUrl.has(avatarImageUrl)) {
      continue;
    }

    firstReplyByAvatarUrl.set(avatarImageUrl, reply);
  }

  const avatarImageDataByUrl = new Map(
    await Promise.all(
      [...firstReplyByAvatarUrl.entries()].map(async ([avatarImageUrl, reply]) => {
        return [avatarImageUrl, await loadAvatarImageData(reply)] as const;
      }),
    ),
  );

  const avatarImageDataByReplyId = new Map<string, AvatarImageDataResult>();
  for (const reply of replies) {
    const avatarImageUrl = reply.avatarImageUrl?.trim();
    if (!avatarImageUrl) {
      continue;
    }

    const avatarImageData = avatarImageDataByUrl.get(avatarImageUrl);
    if (avatarImageData) {
      avatarImageDataByReplyId.set(reply.tweetId, avatarImageData);
    }
  }

  return avatarImageDataByReplyId;
}

async function loadAvatarImageData(reply: ParsedTweet): Promise<AvatarImageDataResult> {
  const avatarImageUrl = reply.avatarImageUrl?.trim();
  if (!avatarImageUrl) {
    return {};
  }

  const startedAt = performance.now();
  let lastErrorMessage: string | undefined;

  for (const candidateUrl of buildAvatarImageCandidates(avatarImageUrl)) {
    try {
      const avatarImageDataUrl = await fetchAvatarImageAsDataUrl(candidateUrl);
      const avatarImageLoadDurationMs = performance.now() - startedAt;
      logAvatarImageLoad(reply.tweetId, avatarImageUrl, candidateUrl, avatarImageLoadDurationMs);

      return {
        avatarImageDataUrl,
        avatarImageLoadDurationMs,
      };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : 'Unknown avatar image load error';
    }
  }

  try {
    const avatarImageDataUrl = await readAvatarImageElementAsDataUrl(reply.article);
    const avatarImageLoadDurationMs = performance.now() - startedAt;
    logAvatarImageLoad(reply.tweetId, avatarImageUrl, 'article-img', avatarImageLoadDurationMs);

    return {
      avatarImageDataUrl,
      avatarImageLoadDurationMs,
    };
  } catch (error) {
    lastErrorMessage = error instanceof Error ? error.message : lastErrorMessage;
  }

  const avatarImageLoadDurationMs = performance.now() - startedAt;
  logAvatarImageLoad(reply.tweetId, avatarImageUrl, 'unavailable', avatarImageLoadDurationMs, lastErrorMessage);
  return {
    avatarImageLoadDurationMs,
  };
}

async function fetchAvatarImageAsDataUrl(avatarImageUrl: string): Promise<string> {
  const response = await fetch(avatarImageUrl, {
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch avatar image: ${response.status}`);
  }

  return blobToDataUrl(await response.blob());
}

async function readAvatarImageElementAsDataUrl(article: HTMLElement): Promise<string> {
  const avatarImage = article.querySelector<HTMLImageElement>(AVATAR_IMAGE_SELECTOR);
  if (!avatarImage) {
    throw new Error('Avatar image element was not found in the tweet article.');
  }

  if (typeof avatarImage.decode === 'function') {
    await avatarImage.decode().catch(() => undefined);
  }

  const width = avatarImage.naturalWidth || avatarImage.width;
  const height = avatarImage.naturalHeight || avatarImage.height;
  if (!width || !height) {
    throw new Error('Avatar image element has no intrinsic size.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Avatar image canvas context is unavailable.');
  }

  context.drawImage(avatarImage, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Avatar image data URL conversion returned a non-string result.'));
        return;
      }

      resolve(reader.result);
    }, { once: true });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Avatar image data URL conversion failed.'));
    }, { once: true });
    reader.readAsDataURL(blob);
  });
}

function logAvatarImageLoad(
  replyId: string,
  avatarImageUrl: string,
  candidateUrl: string,
  durationMs: number,
  error?: string,
): void {
  console.info('[XCNSpamShield][avatar-image-load]', {
    replyId,
    avatarImageUrl,
    candidateUrl,
    imageLoadDurationMs: roundDuration(durationMs),
    error,
  });
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}
