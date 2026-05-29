export type SpamLabel = 0 | 1;
export type LabelSource = 'auto' | 'manual';
export type BlockQueueAction = 'block' | 'unblock';
export type BlockQueueState = 'queued' | 'processing' | 'failed';
export type BlockLogStatus = 'success' | 'failed' | 'cancelled';
export type ReplyBlockingState = 'none' | 'queued' | 'blocked' | 'whitelisted';

export interface MainPostRecord {
  author: string;
  text: string;
  timestamp: number;
}

export interface CollectedReply {
  replyId: string;
  authorId?: string;
  author: string;
  authorName: string;
  avatarImageUrl?: string;
  avatarImageDataUrl?: string;
  avatarImageLoadDurationMs?: number;
  avatarOcrText?: string;
  forceAvatarOcrRecheck?: boolean;
  text: string;
  timestamp: number;
}

export interface ReplyBlockingTarget {
  replyId: string;
  authorId?: string;
  author: string;
}

export interface ReplyBlockingStatus extends ReplyBlockingTarget {
  state: ReplyBlockingState;
}

export interface CollectedThreadPayload {
  threadId: string;
  mainPost: MainPostRecord;
  replies: CollectedReply[];
}

export interface ManualReplyPayload {
  threadId: string;
  mainPost: MainPostRecord;
  reply: CollectedReply;
  label: SpamLabel;
  cleanedPinyin?: string;
  modelConfidence?: number;
}

export interface ReplyClassificationPayload {
  threadId: string;
  replies: CollectedReply[];
}

export interface ReplyRecord {
  threadId: string;
  replyId: string;
  authorId?: string;
  author: string;
  authorName: string;
  avatarOcrText?: string;
  originalText: string;
  cleanedPinyin?: string;
  label: SpamLabel;
  source: LabelSource;
  extractTime: number;
  matchedRules: string[];
  modelConfidence?: number;
}

export interface ThreadRecord {
  threadId: string;
  mainPost: MainPostRecord;
}

export interface ExtractedThreadPayload {
  threadId: string;
  mainPost: MainPostRecord;
  replies: ReplyRecord[];
}

export interface ExportThread {
  thread_id: string;
  main_post: MainPostRecord;
  replies: Array<{
    reply_id: string;
    author: string;
    author_name: string;
    original_text: string;
    cleaned_pinyin: string;
    label: SpamLabel;
    source: LabelSource;
    extract_time: number;
    matched_rules?: string[];
    model_confidence?: number;
  }>;
}

export interface ExportPayload {
  export_time: number;
  total_records: number;
  data: ExportThread[];
}

export interface FloatingCapturePosition {
  xRatio: number;
  yRatio: number;
}

export interface ExtensionSettings {
  blockingEnabled: boolean;
  showFloatingCaptureButton: boolean;
  modelThreshold: number;
  updatedAt: number;
  floatingCapturePosition: FloatingCapturePosition;
}

export interface SpamDecision {
  label: SpamLabel;
  source: LabelSource;
  matchedRules: string[];
  cleanedPinyin: string;
  avatarOcrText?: string;
  modelConfidence?: number;
}

export interface ExtractedReplyView {
  replyId: string;
  threadId: string;
  author: string;
  authorName: string;
  originalText: string;
  label: SpamLabel;
  source: LabelSource;
  extractTime: number;
  matchedRules: string[];
  modelConfidence?: number;
}

export interface ThreadGroupView {
  threadId: string;
  mainPost: MainPostRecord;
  replies: ExtractedReplyView[];
  replyCount: number;
  spamCount: number;
  lastExtractTime: number;
}

export interface BlockQueueItemView {
  author: string;
  authorName: string;
  action: BlockQueueAction;
  state: BlockQueueState;
  queuedAt: number;
  nextRunAt: number;
  attemptCount: number;
  spamReplyCount: number;
  lastError?: string;
  profileUrl: string;
}

export interface BlockActionLogView {
  id: number;
  author: string;
  authorName: string;
  action: BlockQueueAction;
  status: BlockLogStatus;
  createdAt: number;
  message: string;
  spamReplyCount: number;
  errorMessage?: string;
  canUndo: boolean;
  profileUrl: string;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BlockingOverview {
  queue: PagedResult<BlockQueueItemView>;
  logs: PagedResult<BlockActionLogView>;
  isProcessing: boolean;
  nextRunAt: number | null;
}
