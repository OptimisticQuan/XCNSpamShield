import { TWEET_AUTHOR_IDENTITY_CACHE_LIMIT } from '@/shared/constants';

export interface TweetAuthorIdentity {
  tweetId: string;
  authorId: string;
  author?: string;
  authorName?: string;
}

const tweetAuthorIdentityCache = new Map<string, TweetAuthorIdentity>();

export function getCachedTweetAuthorIdentity(tweetId: string): TweetAuthorIdentity | undefined {
  const cachedIdentity = tweetAuthorIdentityCache.get(tweetId);
  if (!cachedIdentity) {
    return undefined;
  }

  tweetAuthorIdentityCache.delete(tweetId);
  const nextIdentity = cloneTweetAuthorIdentity(cachedIdentity);
  tweetAuthorIdentityCache.set(tweetId, nextIdentity);
  return cloneTweetAuthorIdentity(nextIdentity);
}

export function cacheTweetAuthorIdentities(identities: Iterable<TweetAuthorIdentity>): boolean {
  let hasUpdates = false;

  for (const identity of identities) {
    const normalizedIdentity = normalizeTweetAuthorIdentity(identity);
    if (!normalizedIdentity) {
      continue;
    }

    const previousIdentity = tweetAuthorIdentityCache.get(normalizedIdentity.tweetId);
    if (areTweetAuthorIdentitiesEqual(previousIdentity, normalizedIdentity)) {
      continue;
    }

    if (previousIdentity) {
      tweetAuthorIdentityCache.delete(normalizedIdentity.tweetId);
    }

    tweetAuthorIdentityCache.set(normalizedIdentity.tweetId, normalizedIdentity);
    hasUpdates = true;
  }

  while (tweetAuthorIdentityCache.size > TWEET_AUTHOR_IDENTITY_CACHE_LIMIT) {
    const oldestTweetId = tweetAuthorIdentityCache.keys().next().value;
    if (!oldestTweetId) {
      break;
    }

    tweetAuthorIdentityCache.delete(oldestTweetId);
  }

  return hasUpdates;
}

export function applyCachedTweetAuthorIdentity<T extends { tweetId: string; authorId?: string; author: string; authorName: string }>(tweet: T): T {
  const cachedIdentity = getCachedTweetAuthorIdentity(tweet.tweetId);
  if (!cachedIdentity) {
    return tweet;
  }

  tweet.authorId = cachedIdentity.authorId;
  if (cachedIdentity.author) {
    tweet.author = cachedIdentity.author;
  }
  if (cachedIdentity.authorName) {
    tweet.authorName = cachedIdentity.authorName;
  }

  return tweet;
}

export function clearTweetAuthorIdentityCache(): void {
  tweetAuthorIdentityCache.clear();
}

function normalizeTweetAuthorIdentity(identity: TweetAuthorIdentity): TweetAuthorIdentity | null {
  const tweetId = identity.tweetId?.trim();
  const authorId = identity.authorId?.trim();
  if (!tweetId || !authorId) {
    return null;
  }

  const author = identity.author?.trim();
  const authorName = identity.authorName?.trim();
  return {
    tweetId,
    authorId,
    author: author || undefined,
    authorName: authorName || undefined,
  };
}

function cloneTweetAuthorIdentity(identity: TweetAuthorIdentity): TweetAuthorIdentity {
  return {
    ...identity,
  };
}

function areTweetAuthorIdentitiesEqual(
  previousIdentity: TweetAuthorIdentity | undefined,
  nextIdentity: TweetAuthorIdentity,
): boolean {
  if (!previousIdentity) {
    return false;
  }

  return previousIdentity.authorId === nextIdentity.authorId
    && previousIdentity.author === nextIdentity.author
    && previousIdentity.authorName === nextIdentity.authorName;
}