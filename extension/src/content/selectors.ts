export interface ParsedTweet {
  article: HTMLElement;
  tweetId: string;
  author: string;
  authorName: string;
  text: string;
  timestamp: number;
}

const parsedTweetCache = new WeakMap<HTMLElement, ParsedTweet>();

export function collectParsedTweets(options?: { visibleOnly?: boolean }): ParsedTweet[] {
  const articles = options?.visibleOnly ? getVisibleTweetArticles() : getLoadedTweetArticles();
  const seenTweetIds = new Set<string>();

  return articles
    .map(parseTweetArticle)
    .filter((tweet): tweet is ParsedTweet => tweet !== null)
    .filter((tweet) => {
      if (seenTweetIds.has(tweet.tweetId)) {
        return false;
      }

      seenTweetIds.add(tweet.tweetId);
      return true;
    });
}

export function getLoadedTweetArticles(): HTMLElement[] {
  return getTweetArticles({ visibleOnly: false });
}

export function getVisibleTweetArticles(): HTMLElement[] {
  return getTweetArticles({ visibleOnly: true });
}

export function isStatusPage(): boolean {
  return window.location.pathname.includes('/status/');
}

export function parseTweetArticle(article: HTMLElement): ParsedTweet | null {
  const statusLink = findStatusLink(article);
  const tweetId = extractTweetId(statusLink?.href ?? '');

  if (!statusLink || !tweetId) {
    parsedTweetCache.delete(article);
    return null;
  }

  const cachedTweet = parsedTweetCache.get(article);
  if (cachedTweet?.tweetId === tweetId) {
    return cachedTweet;
  }

  const tweetTextNode = queryOwnTweetElement<HTMLElement>(article, 'div[data-testid="tweetText"]');
  const tweetText = extractTweetText(tweetTextNode);
  const timestampValue = queryOwnTweetElement<HTMLTimeElement>(article, 'a > time')?.dateTime
    ?? queryOwnTweetElement<HTMLTimeElement>(article, 'time')?.dateTime;

  const parsedTweet = {
    article,
    tweetId,
    author: extractAuthorHandle(article, statusLink) ?? 'unknown',
    authorName: extractAuthorName(article) ?? extractAuthorHandle(article, statusLink) ?? 'unknown',
    text: tweetText,
    timestamp: timestampValue ? Date.parse(timestampValue) : Date.now(),
  };

  parsedTweetCache.set(article, parsedTweet);
  return parsedTweet;
}

export function getActionBar(article: HTMLElement): HTMLElement | null {
  return queryOwnTweetElement<HTMLElement>(article, 'div[role="group"]');
}

export function extractMainTweet(tweets: ParsedTweet[]): ParsedTweet | null {
  if (tweets.length === 0) {
    return null;
  }

  if (!isStatusPage()) {
    return tweets[0];
  }

  const currentStatusId = extractTweetId(window.location.href);
  return tweets.find((tweet) => tweet.tweetId === currentStatusId) ?? tweets[0];
}

function extractTweetId(value: string): string | null {
  const match = value.match(/status\/(\d+)/u);
  return match?.[1] ?? null;
}

function getTweetArticles(options: { visibleOnly: boolean }): HTMLElement[] {
  const scopeRoot = getTweetScopeRoot();
  const articles = Array.from(scopeRoot.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')).filter(
    (article) => !article.parentElement?.closest('article[data-testid="tweet"]'),
  );

  if (!options.visibleOnly) {
    return articles;
  }

  return articles.filter((article) => {
    const rect = article.getBoundingClientRect();
    return rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
  });
}

function getTweetScopeRoot(): ParentNode {
  return document.querySelector<HTMLElement>('main [data-testid="primaryColumn"]') ?? document;
}

function findStatusLink(article: HTMLElement): HTMLAnchorElement | null {
  const timeLink = queryOwnTweetElement<HTMLTimeElement>(article, 'a > time')?.parentElement;
  if (timeLink instanceof HTMLAnchorElement && timeLink.href) {
    return timeLink;
  }

  const statusLinks = queryOwnTweetElements<HTMLAnchorElement>(article, 'a[href*="/status/"]').filter(
    (link) => extractTweetId(link.href) !== null,
  );

  return statusLinks.at(-1) ?? null;
}

function extractAuthorHandle(article: HTMLElement, statusLink: HTMLAnchorElement): string | null {
  const avatarContainer =
    queryOwnTweetElement<HTMLElement>(article, 'div[data-testid="Tweet-User-Avatar"] div[data-testid^="UserAvatar-Container-"]') ??
    queryOwnTweetElement<HTMLElement>(article, 'div[data-testid^="UserAvatar-Container-"]');

  const avatarHandle = avatarContainer?.dataset.testid?.replace(/^UserAvatar-Container-/u, '').trim();
  if (avatarHandle) {
    return avatarHandle;
  }

  const authorFromLink = statusLink.pathname.match(/^\/([^/]+)\/status\//u)?.[1];
  if (authorFromLink) {
    return authorFromLink;
  }

  const profileLink = queryOwnTweetElement<HTMLAnchorElement>(article, 'div[data-testid="User-Name"] a[href^="/"]');
  const profileHandle = profileLink?.getAttribute('href')?.split('/').filter(Boolean)[0];
  if (profileHandle) {
    return profileHandle;
  }

  return queryOwnTweetElement<HTMLElement>(article, 'div[data-testid="User-Name"] span')?.innerText?.trim() ?? null;
}

function extractAuthorName(article: HTMLElement): string | null {
  const spans = queryOwnTweetElements<HTMLElement>(article, 'div[data-testid="User-Name"] span');

  for (const span of spans) {
    const text = (span.innerText || span.textContent || '').trim();
    if (text && !text.startsWith('@')) {
      return text;
    }
  }

  return null;
}

function extractTweetText(tweetTextNode: HTMLElement | null): string {
  if (!tweetTextNode) {
    return '';
  }

  const visibleText = normalizeTweetText(tweetTextNode.innerText ?? tweetTextNode.textContent ?? '');
  if (!isVisuallyEmptyText(visibleText)) {
    return visibleText;
  }

  return normalizeTweetText(extractNodeText(tweetTextNode));
}

function extractNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (!(node instanceof HTMLElement)) {
    return '';
  }

  if (node.tagName === 'BR') {
    return '\n';
  }

  if (node.tagName === 'IMG') {
    return node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? '';
  }

  return Array.from(node.childNodes).map(extractNodeText).join('');
}

function normalizeTweetText(value: string): string {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/[\t\f\v ]*\n[\t\f\v ]*/gu, '\n')
    .replace(/[\t\f\v ]{2,}/gu, ' ')
    .trim();
}

function isVisuallyEmptyText(value: string): boolean {
  return value.replace(/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]/gu, '').trim().length === 0;
}

function queryOwnTweetElement<T extends Element>(article: HTMLElement, selector: string): T | null {
  return queryOwnTweetElements<T>(article, selector)[0] ?? null;
}

function queryOwnTweetElements<T extends Element>(article: HTMLElement, selector: string): T[] {
  return Array.from(article.querySelectorAll<T>(selector)).filter(
    (element) => element.closest('article[data-testid="tweet"]') === article,
  );
}
