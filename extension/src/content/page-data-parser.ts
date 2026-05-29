import type { TweetAuthorIdentity } from '@/content/page-identity-cache';

export function extractTweetAuthorIdentities(payload: unknown): TweetAuthorIdentity[] {
  const identitiesByTweetId = new Map<string, TweetAuthorIdentity>();
  const visited = new WeakSet<object>();

  visitPayload(payload, visited, identitiesByTweetId);

  return Array.from(identitiesByTweetId.values());
}

function visitPayload(
  value: unknown,
  visited: WeakSet<object>,
  identitiesByTweetId: Map<string, TweetAuthorIdentity>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitPayload(item, visited, identitiesByTweetId);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  const identity = extractTweetAuthorIdentity(value);
  if (identity) {
    identitiesByTweetId.set(identity.tweetId, identity);
  }

  for (const nestedValue of Object.values(value)) {
    visitPayload(nestedValue, visited, identitiesByTweetId);
  }
}

function extractTweetAuthorIdentity(candidate: Record<string, unknown>): TweetAuthorIdentity | null {
  if (!looksLikeTweet(candidate)) {
    return null;
  }

  const legacy = asRecord(candidate.legacy);
  const userResult = resolveUserResult(candidate);
  const userLegacy = asRecord(userResult?.legacy);

  const tweetId = asNumericString(candidate.rest_id);
  const authorId = asNumericString(userResult?.rest_id)
    ?? asNumericString(userLegacy?.id_str)
    ?? asNumericString(legacy?.user_id_str)
    ?? asNumericString(legacy?.user_id);
  const author = asNonEmptyString(userLegacy?.screen_name)
    ?? asNonEmptyString(userResult?.screen_name)
    ?? asNonEmptyString(legacy?.screen_name);
  const authorName = asNonEmptyString(userLegacy?.name)
    ?? asNonEmptyString(userResult?.name)
    ?? asNonEmptyString(legacy?.name)
    ?? author;

  if (!tweetId || !authorId || !author) {
    return null;
  }

  return {
    tweetId,
    authorId,
    author,
    authorName: authorName || undefined,
  };
}

function looksLikeTweet(candidate: Record<string, unknown>): boolean {
  const tweetId = asNumericString(candidate.rest_id);
  if (!tweetId) {
    return false;
  }

  const legacy = asRecord(candidate.legacy);
  if (legacy && (
    'full_text' in legacy
    || 'conversation_id_str' in legacy
    || 'user_id_str' in legacy
    || 'retweeted_status_result' in legacy
    || 'quoted_status_result' in legacy
  )) {
    return true;
  }

  return isRecord(candidate.core) || isRecord(candidate.tweet);
}

function resolveUserResult(candidate: Record<string, unknown>): Record<string, unknown> | null {
  const core = asRecord(candidate.core);
  const userResults = asRecord(core?.user_results) ?? asRecord(candidate.user_results);
  if (!userResults) {
    return null;
  }

  const directResult = unwrapGraphResult(userResults.result);
  if (directResult) {
    return directResult;
  }

  return unwrapGraphResult(userResults);
}

function unwrapGraphResult(value: unknown): Record<string, unknown> | null {
  let current = asRecord(value);

  while (current) {
    if (isRecord(current.tweet)) {
      current = asRecord(current.tweet);
      continue;
    }

    if (isRecord(current.result)) {
      current = asRecord(current.result);
      continue;
    }

    return current;
  }

  return null;
}

function asNumericString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    return undefined;
  }

  const normalizedValue = value.trim();
  return /^\d+$/u.test(normalizedValue) ? normalizedValue : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}