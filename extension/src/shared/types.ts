export type SpamLabel = 0 | 1;
export type LabelSource = 'auto' | 'manual';

export interface MainPostRecord {
  author: string;
  text: string;
  timestamp: number;
}

export interface CollectedReply {
  replyId: string;
  author: string;
  authorName: string;
  text: string;
  timestamp: number;
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
}

export interface ReplyRecord {
  threadId: string;
  replyId: string;
  author: string;
  authorName: string;
  originalText: string;
  cleanedPinyin: string;
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
  modelThreshold: number;
  updatedAt: number;
  floatingCapturePosition: FloatingCapturePosition;
}

export interface SpamDecision {
  label: SpamLabel;
  source: LabelSource;
  matchedRules: string[];
  cleanedPinyin: string;
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
