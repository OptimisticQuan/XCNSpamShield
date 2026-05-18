import type { RuntimeResponseMap } from '@/shared/messages';

type QueueBlockAction = RuntimeResponseMap['QUEUE_BLOCK_AUTHOR']['action'];

export type BlockingFeedbackTone = 'info' | 'success' | 'error';

export interface BlockingFeedback {
  tone: BlockingFeedbackTone;
  message: string;
}

export function formatAuthorHandle(author: string): string {
  const normalized = author.trim();
  if (!normalized) {
    return '@unknown';
  }

  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}

export function getQueueBlockFeedback(author: string, action: QueueBlockAction): BlockingFeedback {
  const handle = formatAuthorHandle(author);

  switch (action) {
    case 'queued':
      return { tone: 'success', message: `已将 ${handle} 加入拉黑队列` };
    case 'already-queued':
      return { tone: 'info', message: `${handle} 已在拉黑队列中` };
    case 'replaced-unblock':
      return { tone: 'success', message: `已将 ${handle} 切回拉黑队列` };
    case 'noop':
      return { tone: 'info', message: `${handle} 当前无需重复处理` };
  }
}

export function getQueueBlockFailureFeedback(author: string): BlockingFeedback {
  return {
    tone: 'error',
    message: `${formatAuthorHandle(author)} 处理失败，请稍后重试`,
  };
}