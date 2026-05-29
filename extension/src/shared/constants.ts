import type { ExtensionSettings } from '@/shared/types';
import pinyinSyllables from '@/ml/pinyin-syllables.json';

export const EXTENSION_NAME = 'XCNSpamShield';
export const DB_NAME = 'xcnspamshield-db';
export const DB_VERSION = 4;
export const SETTINGS_KEY = 'extension-settings';
export const MAX_SEQUENCE_LENGTH = 30;
export const COLLAPSED_CLASS = 'xcnspamshield-collapsed';
export const MANUAL_SPAM_CLASS = 'xcnspamshield-manual-spam';
export const ACTION_BUTTON_CLASS = 'xcnspamshield-action-button';
export const DIRECT_BLOCK_BUTTON_CLASS = 'xcnspamshield-direct-block-button';
export const PLACEHOLDER_BANNER_CLASS = 'xcnspamshield-collapse-banner';
export const FLOATING_CAPTURE_ROOT_ID = 'xcnspamshield-floating-capture-root';
export const PAGE_BRIDGE_EVENT_NAME = 'xcnspamshield:tweet-author-identities';
export const PAGE_BRIDGE_SCRIPT_FILE = 'page-bridge.js';
export const PAGE_BRIDGE_SCRIPT_ID = 'xcnspamshield-page-bridge';
export const THREAD_SCAN_DEBOUNCE_MS = 120;
export const THREAD_SCROLL_SCAN_DEBOUNCE_MS = 80;
export const AUTO_BLOCK_MIN_SPAM_REPLIES = 3;
export const AUTHOR_SCORE_BLOCK_THRESHOLD = 3;
export const AUTHOR_SCORE_WHITELIST_THRESHOLD = -3;
export const AUTHOR_STATE_CACHE_LIMIT = 10_000;
export const TWEET_AUTHOR_IDENTITY_CACHE_LIMIT = 10_000;
export const BLOCK_QUEUE_DELAY_MS = 10_000;
export const BLOCK_QUEUE_RETRY_DELAY_MS = 60_000;
export const BLOCKING_OVERVIEW_PAGE_SIZE = 4;
export const BLOCK_QUEUE_ALARM_NAME = 'xcnspamshield-block-queue';
export const DEFAULT_SETTINGS: ExtensionSettings = {
  blockingEnabled: true,
  showFloatingCaptureButton: false,
  modelThreshold: 0.5,
  updatedAt: Date.now(),
  floatingCapturePosition: {
    xRatio: 1,
    yRatio: 1,
  },
};

export const SPECIAL_TOKENS = ['[PAD]', '[UNK]', '[CLS]', '[SEP]'] as const;

const DEFAULT_EMOJI = ['✈️', '😡', '😎', '😱', '😮', '🤯', '🍑', '🔥', '🥰', '🍀', '🙏'];

export const DEFAULT_VOCAB = Array.from(new Set([...SPECIAL_TOKENS, ':', ...pinyinSyllables, ...DEFAULT_EMOJI]));
