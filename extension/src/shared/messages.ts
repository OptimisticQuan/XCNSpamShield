import type {
  BlockingOverview,
  CollectedThreadPayload,
  ExportPayload,
  ExtensionSettings,
  ExtractedReplyView,
  FloatingCapturePosition,
  ManualReplyPayload,
  ReplyBlockingStatus,
  ReplyBlockingTarget,
  ReplyClassificationPayload,
  ReplyRecord,
  ThreadGroupView,
} from '@/shared/types';

export type RuntimeRequest =
  | { type: 'GET_SETTINGS' }
  | { type: 'GET_BLOCKING_OVERVIEW'; queuePage?: number; logPage?: number; pageSize?: number }
  | { type: 'GET_BLOCK_QUEUE_AUTHORS'; authors: string[] }
  | { type: 'GET_REPLY_BLOCKING_STATES'; replies: ReplyBlockingTarget[] }
  | { type: 'SET_BLOCKING'; enabled: boolean }
  | { type: 'SET_SHOW_FLOATING_CAPTURE_BUTTON'; enabled: boolean }
  | { type: 'SET_FLOATING_CAPTURE_POSITION'; position: FloatingCapturePosition }
  | { type: 'LIST_REPLIES' }
  | { type: 'LIST_THREAD_GROUPS' }
  | { type: 'DELETE_REPLY'; replyId: string }
  | { type: 'TOGGLE_REPLY_LABEL'; replyId: string }
  | { type: 'CLEAR_ALL' }
  | { type: 'EXPORT_JSON' }
  | { type: 'EXTRACT_CURRENT_PAGE' }
  | { type: 'CLASSIFY_COLLECTED_THREAD'; payload: CollectedThreadPayload }
  | { type: 'CLASSIFY_REPLIES'; payload: ReplyClassificationPayload }
  | { type: 'UPSERT_COLLECTED_THREAD'; payload: CollectedThreadPayload }
  | { type: 'UPSERT_MANUAL_REPLY'; payload: ManualReplyPayload }
  | { type: 'GET_REPLY_RECORDS'; replyIds: string[] }
  | { type: 'GET_REPLY_RECORD'; replyId: string }
  | { type: 'QUEUE_BLOCK_AUTHOR'; author: string; authorName?: string; replyId?: string }
  | { type: 'CANCEL_BLOCK_QUEUE_AUTHOR'; author: string }
  | { type: 'QUEUE_UNBLOCK_AUTHOR'; author: string };

export type RuntimeResponseMap = {
  GET_SETTINGS: ExtensionSettings;
  GET_BLOCKING_OVERVIEW: BlockingOverview;
  GET_BLOCK_QUEUE_AUTHORS: string[];
  GET_REPLY_BLOCKING_STATES: ReplyBlockingStatus[];
  SET_BLOCKING: ExtensionSettings;
  SET_SHOW_FLOATING_CAPTURE_BUTTON: ExtensionSettings;
  SET_FLOATING_CAPTURE_POSITION: ExtensionSettings;
  LIST_REPLIES: ExtractedReplyView[];
  LIST_THREAD_GROUPS: ThreadGroupView[];
  DELETE_REPLY: { replyId: string };
  TOGGLE_REPLY_LABEL: ReplyRecord;
  CLEAR_ALL: { cleared: true };
  EXPORT_JSON: ExportPayload;
  EXTRACT_CURRENT_PAGE: { savedReplies: number };
  CLASSIFY_COLLECTED_THREAD: ReplyRecord[];
  CLASSIFY_REPLIES: ReplyRecord[];
  UPSERT_COLLECTED_THREAD: { savedReplies: number; replies: ReplyRecord[] };
  UPSERT_MANUAL_REPLY: ReplyRecord;
  GET_REPLY_RECORDS: ReplyRecord[];
  GET_REPLY_RECORD: ReplyRecord | null;
  QUEUE_BLOCK_AUTHOR: { author: string; queued: boolean; active: boolean; action: 'queued' | 'already-queued' | 'replaced-unblock' | 'noop' };
  CANCEL_BLOCK_QUEUE_AUTHOR: { author: string; cancelled: boolean };
  QUEUE_UNBLOCK_AUTHOR: { author: string; queued: boolean; action: 'cancelled' | 'queued' | 'noop' };
};

export interface RuntimeResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type ContentRequest =
  | { type: 'PING' }
  | { type: 'REQUEST_PAGE_EXTRACTION' }
  | { type: 'APPLY_SETTINGS'; settings: ExtensionSettings };

export async function sendRuntimeMessage<T extends RuntimeRequest>(
  message: T,
): Promise<RuntimeResponse<RuntimeResponseMap[T['type']]>> {
  try {
    return (await chrome.runtime.sendMessage(message)) as RuntimeResponse<RuntimeResponseMap[T['type']]>;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown runtime error',
    } as RuntimeResponse<RuntimeResponseMap[T['type']]>;
  }
}

export function isExtensionContextInvalidatedError(errorMessage: string | undefined): boolean {
  return typeof errorMessage === 'string' && /Extension context invalidated/u.test(errorMessage);
}
