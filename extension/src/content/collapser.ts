import { COLLAPSED_CLASS, PLACEHOLDER_BANNER_CLASS } from '@/shared/constants';

const COLLAPSE_HOST_CLASS = 'xspamshield-collapse-host';
const COLLAPSE_HOST_COLLAPSED_CLASS = 'xspamshield-collapse-host-collapsed';
const COLLAPSE_HOST_EXPANDED_CLASS = 'xspamshield-collapse-host-expanded';

export function applyCollapsedState(article: HTMLElement, reason: string): void {
  const host = getCollapseHost(article);
  host.dataset.xspamshieldCollapseReason = reason;
  let banner = host.querySelector<HTMLButtonElement>(`:scope > .${PLACEHOLDER_BANNER_CLASS}`);

  if (!banner) {
    banner = document.createElement('button');
    banner.type = 'button';
    banner.className = PLACEHOLDER_BANNER_CLASS;
    banner.addEventListener('click', () => {
      const expanded = host.dataset.xspamshieldExpanded === 'true';
      host.dataset.xspamshieldExpanded = expanded ? 'false' : 'true';
      syncCollapseBanner(host, banner!);
    });
    host.prepend(banner);
  }

  syncCollapseBanner(host, banner);
}

export function clearCollapsedState(article: HTMLElement): void {
  const host = getCollapseHost(article);
  host.classList.remove(COLLAPSE_HOST_CLASS, COLLAPSE_HOST_COLLAPSED_CLASS, COLLAPSE_HOST_EXPANDED_CLASS);
  delete host.dataset.xspamshieldExpanded;
  delete host.dataset.xspamshieldCollapsed;
  delete host.dataset.xspamshieldCollapseReason;
  host.querySelector(`:scope > .${PLACEHOLDER_BANNER_CLASS}`)?.remove();

  article.classList.remove(COLLAPSED_CLASS);
  article.dataset.xspamshieldCollapsed = 'false';
  delete article.dataset.xspamshieldExpanded;
  delete article.dataset.xspamshieldCollapseReason;
}

function syncCollapseBanner(host: HTMLElement, banner: HTMLButtonElement): void {
  const article = getHostArticle(host);
  const expanded = host.dataset.xspamshieldExpanded === 'true';
  const reason = formatCollapseReason(host.dataset.xspamshieldCollapseReason ?? '');
  const authorMeta = article ? getReplyAuthorMeta(article) : { displayName: '未知用户', handle: null };

  host.classList.add(COLLAPSE_HOST_CLASS);
  host.classList.toggle(COLLAPSE_HOST_COLLAPSED_CLASS, !expanded);
  host.classList.toggle(COLLAPSE_HOST_EXPANDED_CLASS, expanded);
  host.dataset.xspamshieldCollapsed = expanded ? 'false' : 'true';

  if (article) {
    article.classList.toggle(COLLAPSED_CLASS, !expanded);
    article.dataset.xspamshieldCollapsed = expanded ? 'false' : 'true';
    article.dataset.xspamshieldExpanded = expanded ? 'true' : 'false';
    article.dataset.xspamshieldCollapseReason = host.dataset.xspamshieldCollapseReason ?? '';
  }

  banner.dataset.state = expanded ? 'expanded' : 'collapsed';
  banner.setAttribute('aria-expanded', String(expanded));
  banner.setAttribute('aria-label', expanded ? 'Spam 已展开，点击收起' : 'Spam 已折叠，点击展开');
  banner.removeAttribute('title');

  renderCollapseBannerContent(banner, {
    expanded,
    reason,
    displayName: authorMeta.displayName,
    handle: authorMeta.handle,
  });
}

function formatCollapseReason(reason: string): string {
  return reason
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}

function getCollapseHost(article: HTMLElement): HTMLElement {
  return article.parentElement ?? article;
}

function getHostArticle(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(`:scope > article[data-testid="tweet"]`) ?? host.querySelector<HTMLElement>('article[data-testid="tweet"]');
}

function renderCollapseBannerContent(
  banner: HTMLButtonElement,
  options: {
    expanded: boolean;
    reason: string;
    displayName: string;
    handle: string | null;
  },
): void {
  const status = document.createElement('span');
  status.className = 'xspamshield-collapse-banner-status';
  status.textContent = options.expanded ? 'Spam 已展开 · 点击收起' : 'Spam 已折叠 · 点击展开';

  const author = document.createElement('span');
  author.className = 'xspamshield-collapse-banner-author';

  const displayName = document.createElement('span');
  displayName.className = 'xspamshield-collapse-banner-name';
  displayName.textContent = options.displayName;
  author.append(displayName);

  if (options.handle) {
    const handle = document.createElement('span');
    handle.className = 'xspamshield-collapse-banner-handle';
    handle.textContent = `@${options.handle}`;
    author.append(handle);
  }

  const detail = document.createElement('span');
  detail.className = 'xspamshield-collapse-banner-detail';
  detail.textContent = options.expanded
    ? options.reason || '当前回复已展开，再次点击可收起。'
    : '当前回复已隐藏。';

  banner.replaceChildren(status, author, detail);
}

function getReplyAuthorMeta(article: HTMLElement): { displayName: string; handle: string | null } {
  const userNameRoot = article.querySelector<HTMLElement>('div[data-testid="User-Name"]');
  const displayName = extractDisplayName(userNameRoot) ?? extractHandle(article) ?? '未知用户';
  const handle = extractHandle(article);

  return {
    displayName,
    handle,
  };
}

function extractDisplayName(userNameRoot: HTMLElement | null): string | null {
  if (!userNameRoot) {
    return null;
  }

  const spans = Array.from(userNameRoot.querySelectorAll<HTMLElement>('span'));
  for (const span of spans) {
    const text = (span.innerText || span.textContent || '').trim();
    if (text && !text.startsWith('@')) {
      return text;
    }
  }

  return null;
}

function extractHandle(article: HTMLElement): string | null {
  const avatarContainer =
    article.querySelector<HTMLElement>('div[data-testid="Tweet-User-Avatar"] div[data-testid^="UserAvatar-Container-"]') ??
    article.querySelector<HTMLElement>('div[data-testid^="UserAvatar-Container-"]');

  const avatarHandle = avatarContainer?.dataset.testid?.replace(/^UserAvatar-Container-/u, '').trim();
  if (avatarHandle) {
    return avatarHandle;
  }

  const profileLink = Array.from(article.querySelectorAll<HTMLAnchorElement>('div[data-testid="User-Name"] a[href^="/"]')).find(
    (link) => !/\/status\//u.test(link.getAttribute('href') ?? ''),
  );
  const profileHandle = profileLink?.getAttribute('href')?.split('/').filter(Boolean)[0];
  return profileHandle ?? null;
}
