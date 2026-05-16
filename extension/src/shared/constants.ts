import type { ExtensionSettings } from '@/shared/types';
import pinyinSyllables from '@/ml/pinyin-syllables.json';

export const EXTENSION_NAME = 'XSpamShield';
export const DB_NAME = 'xspamshield-db';
export const DB_VERSION = 1;
export const SETTINGS_KEY = 'extension-settings';
export const MAX_SEQUENCE_LENGTH = 30;
export const COLLAPSED_CLASS = 'xspamshield-collapsed';
export const MANUAL_SPAM_CLASS = 'xspamshield-manual-spam';
export const ACTION_BUTTON_CLASS = 'xspamshield-action-button';
export const PLACEHOLDER_BANNER_CLASS = 'xspamshield-collapse-banner';
export const FLOATING_CAPTURE_ROOT_ID = 'xspamshield-floating-capture-root';
export const THREAD_SCAN_DEBOUNCE_MS = 120;
export const THREAD_SCROLL_SCAN_DEBOUNCE_MS = 80;
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
