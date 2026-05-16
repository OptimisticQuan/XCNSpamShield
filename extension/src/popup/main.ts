import '@/popup/styles.css';

import { AUTO_BLOCK_MIN_SPAM_REPLIES, BLOCKING_OVERVIEW_PAGE_SIZE } from '@/shared/constants';
import { sendRuntimeMessage } from '@/shared/messages';
import type { BlockActionLogView, BlockQueueItemView, BlockingOverview, ExportPayload, ExtensionSettings, ReplyRecord, ThreadGroupView } from '@/shared/types';

type PopupTab = 'home' | 'queue' | 'logs';

interface PopupState {
  settings: ExtensionSettings | null;
  blockingOverview: BlockingOverview | null;
  activeTab: PopupTab;
  queuePage: number;
  logPage: number;
  threadGroups: ThreadGroupView[];
  selectedThreadId: string | null;
  loading: boolean;
  message: string;
}

const isStandaloneView = new URLSearchParams(window.location.search).get('view') === 'standalone';

const state: PopupState = {
  settings: null,
  blockingOverview: null,
  activeTab: 'home',
  queuePage: 1,
  logPage: 1,
  threadGroups: [],
  selectedThreadId: null,
  loading: true,
  message: '',
};

const app = getAppRoot();
let threadListScrollTop = 0;
let replyListScrollTop = 0;
let blockingRefreshInterval: number | undefined;

void initialize();

async function initialize(): Promise<void> {
  document.body.dataset.pageMode = isStandaloneView ? 'standalone' : 'popup';
  await reload();
  startBlockingOverviewAutoRefresh();

  app.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionTarget = target.closest<HTMLElement>('[data-action]');
    if (!actionTarget || !app.contains(actionTarget)) {
      return;
    }

    if (actionTarget.matches('[data-action="set-tab"]')) {
      const tab = actionTarget.dataset.tab;
      if (tab === 'home' || tab === 'queue' || tab === 'logs') {
        state.activeTab = tab;
        render();
      }
      return;
    }

    if (actionTarget.matches('[data-action="prev-queue-page"]')) {
      if (state.queuePage > 1) {
        state.queuePage -= 1;
        void reloadBlockingOverview();
      }
      return;
    }

    if (actionTarget.matches('[data-action="next-queue-page"]')) {
      state.queuePage += 1;
      void reloadBlockingOverview();
      return;
    }

    if (actionTarget.matches('[data-action="prev-log-page"]')) {
      if (state.logPage > 1) {
        state.logPage -= 1;
        void reloadBlockingOverview();
      }
      return;
    }

    if (actionTarget.matches('[data-action="next-log-page"]')) {
      state.logPage += 1;
      void reloadBlockingOverview();
      return;
    }

    if (actionTarget.matches('[data-action="open-profile"]')) {
      const author = actionTarget.dataset.author;
      if (author) {
        void openProfile(author);
      }
      return;
    }

    if (actionTarget.matches('[data-action="cancel-block-queue"]')) {
      const author = actionTarget.dataset.author;
      if (author) {
        void cancelQueuedBlock(author);
      }
      return;
    }

    if (actionTarget.matches('[data-action="queue-unblock"]')) {
      const author = actionTarget.dataset.author;
      if (author) {
        void queueUnblock(author);
      }
      return;
    }

    if (actionTarget.matches('[data-action="clear"]')) {
      void clearRecords();
      return;
    }

    if (actionTarget.matches('[data-action="open-standalone"]')) {
      void openStandaloneView();
      return;
    }

    if (actionTarget.matches('[data-action="select-thread"]')) {
      const threadId = actionTarget.dataset.threadId;
      if (threadId && threadId !== state.selectedThreadId) {
        rememberScrollPositions();
        state.selectedThreadId = threadId;
        replyListScrollTop = 0;
        render({ rememberScroll: false });
      }
      return;
    }

    if (actionTarget.matches('[data-action="export"]')) {
      void exportJson();
      return;
    }

    if (actionTarget.matches('[data-action="toggle-label"]')) {
      const replyId = actionTarget.dataset.replyId;
      if (replyId) {
        void toggleLabel(replyId);
      }
      return;
    }

    if (actionTarget.matches('[data-action="delete"]')) {
      const replyId = actionTarget.dataset.replyId;
      if (replyId) {
        void deleteRecord(replyId);
      }
    }
  });

  app.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('[data-action="toggle-blocking"]')) {
      void setBlocking(target.checked);
      return;
    }

    if (target instanceof HTMLInputElement && target.matches('[data-action="toggle-capture-button"]')) {
      void setShowFloatingCaptureButton(target.checked);
    }
  });
}

async function reload(): Promise<void> {
  state.loading = true;
  render();

  const [settingsResponse, threadGroupsResponse, blockingOverviewResponse] = await Promise.all([
    sendRuntimeMessage({ type: 'GET_SETTINGS' }),
    sendRuntimeMessage({ type: 'LIST_THREAD_GROUPS' }),
    sendRuntimeMessage({
      type: 'GET_BLOCKING_OVERVIEW',
      queuePage: state.queuePage,
      logPage: state.logPage,
    }),
  ]);

  state.settings = settingsResponse.data ?? null;
  applyBlockingOverview(blockingOverviewResponse.data ?? createEmptyBlockingOverview());
  state.threadGroups = sortThreadGroups(threadGroupsResponse.data ?? []);
  syncSelectedThread();
  state.loading = false;
  render();
}

function render(options: { rememberScroll?: boolean } = {}): void {
  if (options.rememberScroll !== false) {
    rememberScrollPositions();
  }

  const settings = state.settings;
  const blockingOverview = state.blockingOverview ?? createEmptyBlockingOverview();
  const selectedGroup = getSelectedThreadGroup();
  const threadMarkup = state.threadGroups.length
    ? state.threadGroups
        .map(
          (group) => `
            <button
              class="thread-list-item ${group.threadId === state.selectedThreadId ? 'is-selected' : ''}"
              type="button"
              data-action="select-thread"
              data-thread-id="${group.threadId}"
            >
              <header class="thread-card-header">
                <div>
                  <div class="thread-card-author">@${escapeHtml(group.mainPost.author)}</div>
                  <div class="thread-card-meta">${formatDate(group.mainPost.timestamp)} · ${group.replyCount} 条回复 · ${group.spamCount} 条 Spam</div>
                </div>
                <div class="thread-chip">${escapeHtml(group.threadId.slice(-6))}</div>
              </header>
              <p class="thread-main-post">${escapeHtml(truncate(getDisplayText(group.mainPost.text, '主贴内容不可见'), 120))}</p>
            </button>
          `,
        )
        .join('')
    : '<p class="empty-state">本地还没有记录。先在 X 页面点击提取，或在页面内手动标记回复。</p>';

  const replyMarkup = selectedGroup
    ? selectedGroup.replies
        .map(
          (reply) => `
            <article class="reply-card">
              <header class="reply-card-header">
                <div class="reply-author-block">
                  <span class="reply-author-handle">@${escapeHtml(reply.author)}</span>
                  ${reply.authorName ? `<span class="reply-author-name">${escapeHtml(reply.authorName)}</span>` : ''}
                </div>
                <span class="reply-badge" data-label="${reply.label}">${reply.label === 1 ? 'Spam' : 'Ham'} / ${reply.source}</span>
              </header>
              <p>${escapeHtml(truncate(getDisplayText(reply.originalText, '内容不可见（可能仅包含零宽字符或未提取到 emoji）'), 140))}</p>
              <div class="reply-card-footer">
                <div class="meta reply-rule-meta">${escapeHtml(formatReplyMeta(reply))}</div>
                <div class="reply-actions">
                  <button class="secondary" data-action="toggle-label" data-reply-id="${reply.replyId}">切换标签</button>
                  <button class="danger" data-action="delete" data-reply-id="${reply.replyId}">删除</button>
                </div>
              </div>
            </article>
          `,
        )
        .join('')
    : '<p class="empty-state">选择左侧主贴后，在这里查看对应回复。</p>';

  app.innerHTML = `
    <main class="popup-shell">
      <section class="panel tab-nav-panel">
        ${renderTabNavigation(blockingOverview)}
      </section>
      <section class="tab-page ${state.activeTab === 'home' ? 'tab-page-home' : 'tab-page-blocking'}">
        ${state.activeTab === 'home'
          ? renderHomeTab(settings, selectedGroup, threadMarkup, replyMarkup)
          : renderBlockingTab(state.activeTab, blockingOverview)}
      </section>
    </main>
  `;

  restoreScrollPositions();
}

function renderTabNavigation(blockingOverview: BlockingOverview): string {
  return `
    <div class="tab-nav-row">
      ${renderTabButton('home', '主页', state.threadGroups.length)}
      ${renderTabButton('queue', '拉黑队列', blockingOverview.queue.total)}
      ${renderTabButton('logs', '操作日志', blockingOverview.logs.total)}
    </div>
  `;
}

function renderTabButton(tab: PopupTab, label: string, count: number): string {
  return `
    <button
      class="top-tab-button ${state.activeTab === tab ? 'is-active' : ''}"
      type="button"
      data-action="set-tab"
      data-tab="${tab}"
    >
      <span>${label}</span>
      <span class="top-tab-badge">${count}</span>
    </button>
  `;
}

function renderHomeTab(
  settings: ExtensionSettings | null,
  selectedGroup: ThreadGroupView | null,
  threadMarkup: string,
  replyMarkup: string,
): string {
  return `
    <section class="panel toolbar-panel">
      <div class="toolbar-row">
        <div class="brand-row">
          <h1>XSpamShield</h1>
          <span class="mode-chip">${settings?.blockingEnabled ? '主动拦截' : '静默采集'}</span>
          <span class="meta compact-meta">${state.threadGroups.length} 个线程</span>
        </div>
        <div class="toolbar-actions">
          <label class="toggle-inline">
            <span>拦截</span>
            <input class="toggle" type="checkbox" data-action="toggle-blocking" ${settings?.blockingEnabled ? 'checked' : ''} />
          </label>
          <label class="toggle-inline">
            <span>抓取按钮</span>
            <input class="toggle" type="checkbox" data-action="toggle-capture-button" ${settings?.showFloatingCaptureButton ? 'checked' : ''} />
          </label>
          ${isStandaloneView ? '' : '<button class="secondary compact-button" data-action="open-standalone">独立页</button>'}
          <button class="primary compact-button" data-action="export">导出</button>
          <button class="danger compact-button" data-action="clear">清空</button>
        </div>
      </div>
      <div class="toolbar-subrow">
        <span class="meta compact-meta">${settings?.showFloatingCaptureButton ? '状态页右下角已显示抓取按钮' : '抓取按钮默认关闭，可在上方手动开启'}</span>
        <span class="toolbar-message">${escapeHtml(state.message)}</span>
      </div>
    </section>
    <section class="panel panel-records">
      <div class="panel-records-header">
        <div>
          <h2>本地数据</h2>
          <div class="meta">左侧主贴列表，右侧仅显示当前主贴的回复。</div>
        </div>
      </div>
      <div class="records-columns">
        <section class="thread-column">
          <div class="column-header">
            <h3>主贴</h3>
          </div>
          <div class="thread-list-scroll" data-scroll-container="threads">
            <div class="thread-list">${state.loading ? '<p class="empty-state">正在加载...</p>' : threadMarkup}</div>
          </div>
        </section>
        <section class="reply-column">
          <div class="column-header">
            <div>
              <h3>回复</h3>
              <div class="meta">${selectedGroup ? `@${escapeHtml(selectedGroup.mainPost.author)} · ${selectedGroup.replyCount} 条回复` : '未选择主贴'}</div>
            </div>
          </div>
          <div class="reply-list-scroll" data-scroll-container="replies">
            <div class="reply-card-list">${state.loading ? '<p class="empty-state">正在加载...</p>' : replyMarkup}</div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderBlockingTab(view: Exclude<PopupTab, 'home'>, blockingOverview: BlockingOverview): string {
  const isQueueView = view === 'queue';
  const activePage = isQueueView ? blockingOverview.queue : blockingOverview.logs;
  const listMarkup = isQueueView
    ? renderBlockQueueList(blockingOverview.queue.items)
    : renderBlockLogList(blockingOverview.logs.items);
  const title = isQueueView ? '拉黑队列' : '操作日志';
  const description = isQueueView
    ? `同账号累计 ${AUTO_BLOCK_MIN_SPAM_REPLIES} 条 Spam 后进入延迟队列，后台逐个执行。`
    : '记录后台自动拉黑与撤销执行结果，可直接打开主页查看，必要时继续发起撤销。';

  return `
    <section class="panel blocking-tab-panel">
      <div class="blocking-panel-header">
        <div>
          <h2>${title}</h2>
          <div class="meta">${description}</div>
        </div>
        <div class="blocking-panel-stats">
          <span class="status-pill ${blockingOverview.isProcessing ? 'is-busy' : ''}">${blockingOverview.isProcessing ? '执行中' : '空闲'}</span>
          <span class="meta compact-meta">队列 ${blockingOverview.queue.total}</span>
          <span class="meta compact-meta">日志 ${blockingOverview.logs.total}</span>
          <span class="meta compact-meta">${blockingOverview.nextRunAt ? `下次 ${formatDate(blockingOverview.nextRunAt)}` : '无待执行任务'}</span>
        </div>
      </div>
      <div class="blocking-tab-subrow">
        <span class="meta compact-meta">${isQueueView ? '支持手动移出待执行账号。' : '仅最新一次成功拉黑记录支持撤销入队。'}</span>
        <span class="toolbar-message">${escapeHtml(state.message)}</span>
      </div>
      <div class="blocking-list">
        ${state.loading ? '<p class="empty-state">正在加载任务状态...</p>' : listMarkup}
      </div>
      <div class="blocking-pagination">
        <button
          class="secondary micro-button"
          type="button"
          data-action="${isQueueView ? 'prev-queue-page' : 'prev-log-page'}"
          ${activePage.page <= 1 ? 'disabled' : ''}
        >上一页</button>
        <span class="meta compact-meta">第 ${activePage.page} / ${activePage.totalPages} 页 · 共 ${activePage.total} 条</span>
        <button
          class="secondary micro-button"
          type="button"
          data-action="${isQueueView ? 'next-queue-page' : 'next-log-page'}"
          ${activePage.page >= activePage.totalPages ? 'disabled' : ''}
        >下一页</button>
      </div>
    </section>
  `;
}

function renderBlockQueueList(items: BlockQueueItemView[]): string {
  if (items.length === 0) {
    return '<p class="empty-state">当前没有待执行的拉黑任务。</p>';
  }

  return items.map(renderBlockQueueItem).join('');
}

function renderBlockQueueItem(item: BlockQueueItemView): string {
  const actionLabel = item.action === 'block' ? '拉黑' : '撤销';
  const stateLabel = item.state === 'queued' ? '排队中' : item.state === 'processing' ? '执行中' : '待重试';
  const timingLabel = item.lastError
    ? `上次错误：${escapeHtml(item.lastError)}`
    : `预计执行：${formatDate(item.nextRunAt)}`;

  return `
    <article class="blocking-entry-card">
      <div class="blocking-entry-body">
        <div class="blocking-entry-title-row">
          <div class="blocking-entry-author-row">
            <span class="blocking-entry-handle">@${escapeHtml(item.author)}</span>
            <span class="blocking-entry-name">${escapeHtml(item.authorName || item.author)}</span>
          </div>
          <span class="entry-chip" data-tone="${item.state}">${actionLabel} · ${stateLabel}</span>
        </div>
        <div class="blocking-entry-meta-row">
          <span class="meta">Spam ${item.spamReplyCount}</span>
          <span class="meta">尝试 ${item.attemptCount}</span>
          <span class="meta">入队 ${formatDate(item.queuedAt)}</span>
        </div>
        <div class="blocking-entry-message">${timingLabel}</div>
      </div>
      <div class="blocking-entry-actions">
        <button class="secondary micro-button" type="button" data-action="open-profile" data-author="${escapeHtml(item.author)}">主页</button>
        <button class="danger micro-button" type="button" data-action="cancel-block-queue" data-author="${escapeHtml(item.author)}">移出</button>
      </div>
    </article>
  `;
}

function renderBlockLogList(items: BlockActionLogView[]): string {
  if (items.length === 0) {
    return '<p class="empty-state">当前还没有自动拉黑相关日志。</p>';
  }

  return items.map(renderBlockLogItem).join('');
}

function renderBlockLogItem(item: BlockActionLogView): string {
  const actionLabel = item.action === 'block' ? '拉黑' : '撤销';
  const statusLabel = item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '已取消';
  const detail = item.errorMessage ? `${escapeHtml(item.message)} · ${escapeHtml(item.errorMessage)}` : escapeHtml(item.message);

  return `
    <article class="blocking-entry-card">
      <div class="blocking-entry-body">
        <div class="blocking-entry-title-row">
          <div class="blocking-entry-author-row">
            <span class="blocking-entry-handle">@${escapeHtml(item.author)}</span>
            <span class="blocking-entry-name">${escapeHtml(item.authorName || item.author)}</span>
          </div>
          <span class="entry-chip" data-tone="${item.status}">${actionLabel} · ${statusLabel}</span>
        </div>
        <div class="blocking-entry-meta-row">
          <span class="meta">${formatDate(item.createdAt)}</span>
          <span class="meta">Spam ${item.spamReplyCount}</span>
        </div>
        <div class="blocking-entry-message">${detail}</div>
      </div>
      <div class="blocking-entry-actions">
        <button class="secondary micro-button" type="button" data-action="open-profile" data-author="${escapeHtml(item.author)}">主页</button>
        ${item.canUndo ? `<button class="primary micro-button" type="button" data-action="queue-unblock" data-author="${escapeHtml(item.author)}">撤销</button>` : ''}
      </div>
    </article>
  `;
}

function formatReplyMeta(reply: ThreadGroupView['replies'][number]): string {
  if (reply.source === 'manual') {
    return '人工标记';
  }

  if (typeof reply.modelConfidence === 'number') {
    return `模型 ${(reply.modelConfidence * 100).toFixed(1)}%`;
  }

  return '模型未返回分数';
}

async function setBlocking(enabled: boolean): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'SET_BLOCKING', enabled });
  if (response.ok && response.data) {
    state.settings = response.data;
    state.message = enabled ? '已切换到主动拦截模式' : '已切换到静默采集模式';
    render();
  }
}

async function setShowFloatingCaptureButton(enabled: boolean): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'SET_SHOW_FLOATING_CAPTURE_BUTTON', enabled });
  if (response.ok && response.data) {
    state.settings = response.data;
    state.message = enabled ? '已开启页面抓取按钮' : '已关闭页面抓取按钮';
    render();
    return;
  }

  state.message = response.error ?? '抓取按钮设置失败';
  render();
}

async function clearRecords(): Promise<void> {
  await sendRuntimeMessage({ type: 'CLEAR_ALL' });
  state.threadGroups = [];
  state.selectedThreadId = null;
  applyBlockingOverview(createEmptyBlockingOverview());
  state.message = '本地库已清空';
  threadListScrollTop = 0;
  replyListScrollTop = 0;
  render({ rememberScroll: false });
}

async function exportJson(): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'EXPORT_JSON' });
  if (response.ok && response.data) {
    await downloadExportPayload(response.data);
    state.message = `已导出 ${response.data.total_records} 条记录`;
  } else {
    state.message = response.error ?? '导出失败';
  }
  render();
}

async function toggleLabel(replyId: string): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'TOGGLE_REPLY_LABEL', replyId });
  if (response.ok && response.data) {
    updateReplyInState(response.data);
    await reloadBlockingOverview();
    state.message = '标签已切换';
    render();
    return;
  }

  state.message = response.error ?? '标签切换失败';
  render();
}

async function deleteRecord(replyId: string): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'DELETE_REPLY', replyId });
  if (response.ok) {
    removeReplyFromState(replyId);
    await reloadBlockingOverview();
    state.message = '记录已删除';
    render();
    return;
  }

  state.message = response.error ?? '删除失败';
  render();
}

function updateReplyInState(updatedReply: ReplyRecord): void {
  state.threadGroups = sortThreadGroups(state.threadGroups.map((group) => {
    if (group.threadId !== updatedReply.threadId) {
      return group;
    }

    const replies = group.replies.map((reply) =>
      reply.replyId === updatedReply.replyId
        ? {
            ...reply,
            author: updatedReply.author,
            authorName: updatedReply.authorName,
            originalText: updatedReply.originalText,
            label: updatedReply.label,
            source: updatedReply.source,
            extractTime: updatedReply.extractTime,
            matchedRules: updatedReply.matchedRules,
            modelConfidence: updatedReply.modelConfidence,
          }
        : reply,
    );

    return {
      ...group,
      replies,
      spamCount: replies.filter((reply) => reply.label === 1).length,
      lastExtractTime: Math.max(group.lastExtractTime, updatedReply.extractTime),
    };
  }));
  syncSelectedThread(updatedReply.threadId);
}

function removeReplyFromState(replyId: string): void {
  state.threadGroups = sortThreadGroups(state.threadGroups
    .map((group) => {
      const replies = group.replies.filter((reply) => reply.replyId !== replyId);
      if (replies.length === group.replies.length) {
        return group;
      }

      return {
        ...group,
        replies,
        replyCount: replies.length,
        spamCount: replies.filter((reply) => reply.label === 1).length,
        lastExtractTime: replies[0]?.extractTime ?? 0,
      };
    })
    .filter((group) => group.replies.length > 0));
  syncSelectedThread();
}

function sortThreadGroups(threadGroups: ThreadGroupView[]): ThreadGroupView[] {
  return [...threadGroups].sort((left, right) => right.lastExtractTime - left.lastExtractTime);
}

function syncSelectedThread(preferredThreadId?: string): void {
  if (preferredThreadId && state.threadGroups.some((group) => group.threadId === preferredThreadId)) {
    state.selectedThreadId = preferredThreadId;
    return;
  }

  if (state.selectedThreadId && state.threadGroups.some((group) => group.threadId === state.selectedThreadId)) {
    return;
  }

  state.selectedThreadId = state.threadGroups[0]?.threadId ?? null;
}

function getSelectedThreadGroup(): ThreadGroupView | null {
  if (!state.selectedThreadId) {
    return null;
  }

  return state.threadGroups.find((group) => group.threadId === state.selectedThreadId) ?? null;
}

function rememberScrollPositions(): void {
  const threadContainer = app.querySelector<HTMLElement>('[data-scroll-container="threads"]');
  const replyContainer = app.querySelector<HTMLElement>('[data-scroll-container="replies"]');

  if (threadContainer) {
    threadListScrollTop = threadContainer.scrollTop;
  }

  if (replyContainer) {
    replyListScrollTop = replyContainer.scrollTop;
  }
}

function restoreScrollPositions(): void {
  const threadContainer = app.querySelector<HTMLElement>('[data-scroll-container="threads"]');
  const replyContainer = app.querySelector<HTMLElement>('[data-scroll-container="replies"]');

  if (threadContainer) {
    threadContainer.scrollTop = threadListScrollTop;
  }

  if (replyContainer) {
    replyContainer.scrollTop = replyListScrollTop;
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function getDisplayText(value: string, fallback: string): string {
  const normalized = value.replace(/\u00a0/gu, ' ').trim();
  return isVisuallyEmptyText(normalized) ? fallback : normalized;
}

function isVisuallyEmptyText(value: string): boolean {
  return value.replace(/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]/gu, '').trim().length === 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getAppRoot(): HTMLDivElement {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) {
    throw new Error('Popup root element was not found.');
  }
  return root;
}

async function openStandaloneView(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=standalone') });
}

async function openProfile(author: string): Promise<void> {
  await chrome.tabs.create({ url: `https://x.com/${author.replace(/^@/u, '')}` });
}

async function cancelQueuedBlock(author: string): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'CANCEL_BLOCK_QUEUE_AUTHOR', author });
  if (response.ok && response.data?.cancelled) {
    state.message = `已将 @${author.replace(/^@/u, '')} 移出队列`;
  } else {
    state.message = response.error ?? '移出队列失败';
  }

  await reloadBlockingOverview();
  render();
}

async function queueUnblock(author: string): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'QUEUE_UNBLOCK_AUTHOR', author });
  if (response.ok && response.data) {
    state.message = response.data.action === 'queued'
      ? `已将 @${author.replace(/^@/u, '')} 加入撤销队列`
      : response.data.action === 'cancelled'
        ? `已取消 @${author.replace(/^@/u, '')} 的待执行拉黑`
        : `@${author.replace(/^@/u, '')} 当前没有可撤销的自动拉黑`;
  } else {
    state.message = response.error ?? '撤销拉黑失败';
  }

  await reloadBlockingOverview();
  render();
}

async function reloadBlockingOverview(): Promise<void> {
  const response = await sendRuntimeMessage({
    type: 'GET_BLOCKING_OVERVIEW',
    queuePage: state.queuePage,
    logPage: state.logPage,
  });
  if (response.ok && response.data) {
    applyBlockingOverview(response.data);
    render();
  }
}

function applyBlockingOverview(overview: BlockingOverview): void {
  state.blockingOverview = overview;
  state.queuePage = overview.queue.page;
  state.logPage = overview.logs.page;
}

function createEmptyBlockingOverview(): BlockingOverview {
  return {
    queue: {
      items: [],
      page: 1,
      pageSize: BLOCKING_OVERVIEW_PAGE_SIZE,
      total: 0,
      totalPages: 1,
    },
    logs: {
      items: [],
      page: 1,
      pageSize: BLOCKING_OVERVIEW_PAGE_SIZE,
      total: 0,
      totalPages: 1,
    },
    isProcessing: false,
    nextRunAt: null,
  };
}

function startBlockingOverviewAutoRefresh(): void {
  window.clearInterval(blockingRefreshInterval);
  blockingRefreshInterval = window.setInterval(() => {
    void reloadBlockingOverview();
  }, 10_000);
}

async function downloadExportPayload(payload: ExportPayload): Promise<void> {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: `xspamshield-export-${Date.now()}.json`,
      saveAs: true,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
