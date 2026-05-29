import { COLLAPSED_CLASS, PLACEHOLDER_BANNER_CLASS } from '@/shared/constants';

const COLLAPSE_HOST_CLASS = 'xcnspamshield-collapse-host';
const COLLAPSE_HOST_COLLAPSED_CLASS = 'xcnspamshield-collapse-host-collapsed';
const COLLAPSE_HOST_EXPANDED_CLASS = 'xcnspamshield-collapse-host-expanded';
const COLLAPSE_HOST_QUEUED_HIDDEN_CLASS = 'xcnspamshield-collapse-host-queued-hidden';
const COLLAPSE_BANNER_TOGGLE_CLASS = 'xcnspamshield-collapse-banner-toggle';
const COLLAPSE_BANNER_QUEUE_BUTTON_CLASS = 'xcnspamshield-collapse-banner-queue-button';

const collapseBannerCallbacks = new WeakMap<HTMLElement, CollapseBannerOptions>();

interface CollapseBannerOptions {
  onQueueBlock?: () => void;
}

export function applyCollapsedState(article: HTMLElement, reason: string, options: CollapseBannerOptions = {}): void {
  const host = getCollapseHost(article);
  host.dataset.xcnspamshieldCollapseReason = reason;
  host.classList.remove(COLLAPSE_HOST_QUEUED_HIDDEN_CLASS);
  delete host.dataset.xcnspamshieldQueuedHidden;
  delete host.dataset.xcnspamshieldBlockingState;
  delete article.dataset.xcnspamshieldQueuedHidden;
  delete article.dataset.xcnspamshieldBlockingState;
  let banner = host.querySelector<HTMLElement>(`:scope > .${PLACEHOLDER_BANNER_CLASS}`);

  if (!banner) {
    banner = document.createElement('div');
    banner.className = PLACEHOLDER_BANNER_CLASS;
    host.prepend(banner);
  }

  syncCollapseBanner(host, banner, options);
}

export function clearCollapsedState(article: HTMLElement): void {
  const host = getCollapseHost(article);
  host.classList.remove(COLLAPSE_HOST_CLASS, COLLAPSE_HOST_COLLAPSED_CLASS, COLLAPSE_HOST_EXPANDED_CLASS);
  delete host.dataset.xcnspamshieldExpanded;
  delete host.dataset.xcnspamshieldCollapsed;
  delete host.dataset.xcnspamshieldCollapseReason;
  host.querySelector(`:scope > .${PLACEHOLDER_BANNER_CLASS}`)?.remove();

  article.classList.remove(COLLAPSED_CLASS);
  article.dataset.xcnspamshieldCollapsed = 'false';
  delete article.dataset.xcnspamshieldExpanded;
  delete article.dataset.xcnspamshieldCollapseReason;
}

export function applyQueuedHiddenState(article: HTMLElement, state: 'queued' | 'blocked' = 'queued'): void {
  clearCollapsedState(article);

  const host = getCollapseHost(article);
  host.classList.add(COLLAPSE_HOST_QUEUED_HIDDEN_CLASS);
  host.dataset.xcnspamshieldQueuedHidden = 'true';
  host.dataset.xcnspamshieldBlockingState = state;
  article.dataset.xcnspamshieldQueuedHidden = 'true';
  article.dataset.xcnspamshieldBlockingState = state;
}

export function clearQueuedHiddenState(article: HTMLElement): void {
  const host = getCollapseHost(article);
  host.classList.remove(COLLAPSE_HOST_QUEUED_HIDDEN_CLASS);
  delete host.dataset.xcnspamshieldQueuedHidden;
  delete host.dataset.xcnspamshieldBlockingState;
  delete article.dataset.xcnspamshieldQueuedHidden;
  delete article.dataset.xcnspamshieldBlockingState;
}

function syncCollapseBanner(host: HTMLElement, banner: HTMLElement, options: CollapseBannerOptions): void {
  const article = getHostArticle(host);
  const expanded = host.dataset.xcnspamshieldExpanded === 'true';
  const reason = formatCollapseReason(host.dataset.xcnspamshieldCollapseReason ?? '');
  const authorMeta = article ? getReplyAuthorMeta(article) : { displayName: '未知用户', handle: null };

  host.classList.add(COLLAPSE_HOST_CLASS);
  host.classList.toggle(COLLAPSE_HOST_COLLAPSED_CLASS, !expanded);
  host.classList.toggle(COLLAPSE_HOST_EXPANDED_CLASS, expanded);
  host.dataset.xcnspamshieldCollapsed = expanded ? 'false' : 'true';
  host.dataset.xcnspamshieldExpanded = expanded ? 'true' : 'false';

  if (article) {
    article.classList.toggle(COLLAPSED_CLASS, !expanded);
    article.dataset.xcnspamshieldCollapsed = expanded ? 'false' : 'true';
    article.dataset.xcnspamshieldExpanded = expanded ? 'true' : 'false';
    article.dataset.xcnspamshieldCollapseReason = host.dataset.xcnspamshieldCollapseReason ?? '';
  }

  banner.dataset.state = expanded ? 'expanded' : 'collapsed';

  renderCollapseBannerContent(banner, {
    expanded,
    reason,
    displayName: authorMeta.displayName,
    handle: authorMeta.handle,
    onQueueBlock: options.onQueueBlock,
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
  banner: HTMLElement,
  options: {
    expanded: boolean;
    reason: string;
    displayName: string;
    handle: string | null;
    onQueueBlock?: () => void;
  },
): void {
  collapseBannerCallbacks.set(banner, { onQueueBlock: options.onQueueBlock });

  const { toggleButton, status, author, displayName, handle, detail } = ensureBannerToggleStructure(banner);
  const queueButton = ensureQueueButton(banner);

  const nextExpanded = String(options.expanded);
  if (toggleButton.getAttribute('aria-expanded') !== nextExpanded) {
    toggleButton.setAttribute('aria-expanded', nextExpanded);
  }

  const nextToggleAriaLabel = options.expanded ? 'Spam 已展开，点击收起' : 'Spam 已折叠，点击展开';
  if (toggleButton.getAttribute('aria-label') !== nextToggleAriaLabel) {
    toggleButton.setAttribute('aria-label', nextToggleAriaLabel);
  }

  const compactReason = options.reason.replace(/\s+/gu, ' ').trim();
  const nextStatusText = options.expanded
    ? `Spam 已展开${compactReason ? ` · ${compactReason}` : ''} · 点击收起`
    : `Spam 已折叠${compactReason ? ` · ${compactReason}` : ''} · 点击展开`;
  if (status.textContent !== nextStatusText) {
    status.textContent = nextStatusText;
  }

  if (displayName.textContent !== options.displayName) {
    displayName.textContent = options.displayName;
  }

  const nextHandleText = options.handle ? `@${options.handle}` : '';
  if (handle.textContent !== nextHandleText) {
    handle.textContent = nextHandleText;
  }
  handle.hidden = !options.handle;

  const nextDetailText = options.expanded
    ? options.reason || '当前回复已展开，再次点击可收起。'
    : '当前回复已隐藏。';
  if (detail.textContent !== nextDetailText) {
    detail.textContent = nextDetailText;
  }

  const nextQueueLabel = options.handle ? `将 @${options.handle} 加入拉黑队列` : '加入拉黑队列';
  if (queueButton.getAttribute('aria-label') !== nextQueueLabel) {
    queueButton.setAttribute('aria-label', nextQueueLabel);
  }
  if (queueButton.getAttribute('title') !== nextQueueLabel) {
    queueButton.setAttribute('title', nextQueueLabel);
  }

  if (banner.children.length !== 2 || banner.firstElementChild !== toggleButton || banner.lastElementChild !== queueButton) {
    banner.replaceChildren(toggleButton, queueButton);
  }
}

function ensureBannerToggleStructure(banner: HTMLElement): {
  toggleButton: HTMLButtonElement;
  status: HTMLSpanElement;
  author: HTMLSpanElement;
  displayName: HTMLSpanElement;
  handle: HTMLSpanElement;
  detail: HTMLSpanElement;
} {
  let toggleButton = banner.querySelector<HTMLButtonElement>(`:scope > .${COLLAPSE_BANNER_TOGGLE_CLASS}`);
  if (!toggleButton) {
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = COLLAPSE_BANNER_TOGGLE_CLASS;
    toggleButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const host = banner.parentElement;
      if (!(host instanceof HTMLElement)) {
        return;
      }

      const expanded = host.dataset.xcnspamshieldExpanded === 'true';
      host.dataset.xcnspamshieldExpanded = expanded ? 'false' : 'true';
      syncCollapseBanner(host, banner, collapseBannerCallbacks.get(banner) ?? {});
    });
  }

  let status = toggleButton.querySelector<HTMLSpanElement>(':scope > .xcnspamshield-collapse-banner-status');
  if (!status) {
    status = document.createElement('span');
    status.className = 'xcnspamshield-collapse-banner-status';
  }

  let author = toggleButton.querySelector<HTMLSpanElement>(':scope > .xcnspamshield-collapse-banner-author');
  if (!author) {
    author = document.createElement('span');
    author.className = 'xcnspamshield-collapse-banner-author';
  }

  let displayName = author.querySelector<HTMLSpanElement>(':scope > .xcnspamshield-collapse-banner-name');
  if (!displayName) {
    displayName = document.createElement('span');
    displayName.className = 'xcnspamshield-collapse-banner-name';
  }

  let handle = author.querySelector<HTMLSpanElement>(':scope > .xcnspamshield-collapse-banner-handle');
  if (!handle) {
    handle = document.createElement('span');
    handle.className = 'xcnspamshield-collapse-banner-handle';
  }

  if (author.children.length !== 2 || author.firstElementChild !== displayName || author.lastElementChild !== handle) {
    author.replaceChildren(displayName, handle);
  }

  let detail = toggleButton.querySelector<HTMLSpanElement>(':scope > .xcnspamshield-collapse-banner-detail');
  if (!detail) {
    detail = document.createElement('span');
    detail.className = 'xcnspamshield-collapse-banner-detail';
  }

  if (toggleButton.children.length !== 3 || toggleButton.children[0] !== status || toggleButton.children[1] !== author || toggleButton.children[2] !== detail) {
    toggleButton.replaceChildren(status, author, detail);
  }

  return {
    toggleButton,
    status,
    author,
    displayName,
    handle,
    detail,
  };
}

function ensureQueueButton(banner: HTMLElement): HTMLButtonElement {
  let queueButton = banner.querySelector<HTMLButtonElement>(`:scope > .${COLLAPSE_BANNER_QUEUE_BUTTON_CLASS}`);
  if (!queueButton) {
    queueButton = document.createElement('button');
    queueButton.type = 'button';
    queueButton.className = COLLAPSE_BANNER_QUEUE_BUTTON_CLASS;
    queueButton.innerHTML = [
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '<path d="M15 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/>',
      '<circle cx="9" cy="7" r="4"/>',
      '<path d="M17 8h5"/>',
      '<path d="M19.5 5.5v5"/>',
      '</svg>',
    ].join('');
    queueButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      collapseBannerCallbacks.get(banner)?.onQueueBlock?.();
    });
  }

  return queueButton;
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
