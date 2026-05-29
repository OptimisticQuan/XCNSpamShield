import { pinyin } from 'pinyin-pro';

import { DEFAULT_VOCAB, MAX_SEQUENCE_LENGTH, SPECIAL_TOKENS } from '@/shared/constants';
import confusableLatinMap from '@/ml/confusable-latin-map.json';
import pinyinSyllables from '@/ml/pinyin-syllables.json';

const HAN_CHARACTER = /\p{Script=Han}/u;
const ALPHA_CHARACTER = /[a-z]/i;
const DIGIT_CHARACTER = /\d/u;
const WHITESPACE = /\s/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const VARIATION_SELECTOR = /[\uFE0E\uFE0F]/u;
const ZERO_WIDTH_FORMAT = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const PINYIN_SYLLABLES = new Set(pinyinSyllables);
const DEFAULT_VOCAB_INDEX = new Map(DEFAULT_VOCAB.map((token, index) => [token, index]));
const CONFUSABLE_LATIN_MAP = new Map<string, string>(Object.entries(confusableLatinMap));

let vocabIndexPromise: Promise<Map<string, number>> | undefined;

export function normalizeToPinyinWords(text: string): string {
  return normalizeStructuredText(text);
}

export function normalizeReplyToPinyinWords(authorName: string, text: string, avatarOcrText?: string): string {
  const structuredText = [avatarOcrText ?? '', authorName, text]
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(':');

  return normalizeStructuredText(structuredText || text);
}

export function tokenizeCleanedPinyin(cleanedPinyin: string): string[] {
  const context = [
    '[CLS]',
    ...splitNormalizedTokens(cleanedPinyin),
    '[SEP]',
  ];
  const truncated = context.slice(0, MAX_SEQUENCE_LENGTH);

  while (truncated.length < MAX_SEQUENCE_LENGTH) {
    truncated.push('[PAD]');
  }

  return truncated;
}

export function tokenizeReply(authorName: string, text: string, avatarOcrText?: string): string[] {
  return tokenizeCleanedPinyin(normalizeReplyToPinyinWords(authorName, text, avatarOcrText));
}

export async function tokensToIds(tokens: string[]): Promise<number[]> {
  const vocabIndex = await getVocabIndex();
  const unknownId = vocabIndex.get('[UNK]') ?? 1;
  return tokens.map((token) => vocabIndex.get(token) ?? unknownId);
}

export function tokenizeText(text: string): string[] {
  return splitNormalizedTokens(normalizeStructuredText(text));
}

function splitNormalizedTokens(normalizedText: string): string[] {
  const tokens = normalizedText.split(/\s+/u).filter(Boolean);
  return tokens.length > 0 ? tokens : ['[UNK]'];
}

export function getDefaultVocab(): string[] {
  return [...SPECIAL_TOKENS, ...DEFAULT_VOCAB.slice(SPECIAL_TOKENS.length)];
}

function normalizeStructuredText(text: string): string {
  const normalized = text.normalize('NFKC');
  const tokens: string[] = [];
  let alphaBuffer = '';

  const flushAlphaBuffer = () => {
    if (!alphaBuffer) {
      return;
    }

    const segmented = segmentPinyinSequence(alphaBuffer.toLowerCase());
    if (segmented && isAcceptedLatinPinyinSequence(segmented)) {
      tokens.push(...segmented);
    }
    alphaBuffer = '';
  };

  const characters = Array.from(normalized);
  for (let index = 0; index < characters.length; ) {
    const emojiToken = consumeEmojiToken(characters, index);
    if (emojiToken) {
      flushAlphaBuffer();
      tokens.push(emojiToken.value);
      index = emojiToken.nextIndex;
      continue;
    }

    const character = applySimilarCharacterReplacement(characters[index]);

    if (WHITESPACE.test(character)) {
      flushAlphaBuffer();
      index += 1;
      continue;
    }

    if (character === ':') {
      flushAlphaBuffer();
      tokens.push(':');
      index += 1;
      continue;
    }

    if (ZERO_WIDTH_FORMAT.test(character)) {
      flushAlphaBuffer();
      index += 1;
      continue;
    }

    if (HAN_CHARACTER.test(character)) {
      flushAlphaBuffer();
      const converted = pinyin(character, { toneType: 'none', type: 'array' })[0] ?? '';
      const normalizedPinyin = converted.toLowerCase().replaceAll('ü', 'v');
      if (normalizedPinyin) {
        tokens.push(normalizedPinyin);
      }
      index += 1;
      continue;
    }

    if (ALPHA_CHARACTER.test(character)) {
      alphaBuffer += character.toLowerCase();
      index += 1;
      continue;
    }

    if (DIGIT_CHARACTER.test(character)) {
      flushAlphaBuffer();
      index += 1;
      continue;
    }

    flushAlphaBuffer();
    index += 1;
  }

  flushAlphaBuffer();
  return tokens.join(' ');
}

function segmentPinyinSequence(value: string): string[] | null {
  if (!value) {
    return null;
  }

  const memo = new Map<number, string[] | null>();
  return segmentFromIndex(value, 0, memo);
}

function segmentFromIndex(value: string, startIndex: number, memo: Map<number, string[] | null>): string[] | null {
  if (startIndex === value.length) {
    return [];
  }

  if (memo.has(startIndex)) {
    return memo.get(startIndex) ?? null;
  }

  for (let endIndex = value.length; endIndex > startIndex; endIndex -= 1) {
    const candidate = value.slice(startIndex, endIndex);
    if (!PINYIN_SYLLABLES.has(candidate)) {
      continue;
    }

    const remainder = segmentFromIndex(value, endIndex, memo);
    if (remainder) {
      const result = [candidate, ...remainder];
      memo.set(startIndex, result);
      return result;
    }
  }

  memo.set(startIndex, null);
  return null;
}

function isAcceptedLatinPinyinSequence(tokens: string[]): boolean {
  return tokens.every((token) => token.length > 1);
}

function consumeEmojiToken(characters: string[], startIndex: number): { value: string; nextIndex: number } | null {
  const first = characters[startIndex];
  if (!EXTENDED_PICTOGRAPHIC.test(first)) {
    return null;
  }

  let token = first;
  let index = startIndex + 1;

  while (index < characters.length) {
    const next = characters[index];

    if (VARIATION_SELECTOR.test(next)) {
      token += next;
      index += 1;
      continue;
    }

    if (next === '\u200d' && index + 1 < characters.length && EXTENDED_PICTOGRAPHIC.test(characters[index + 1])) {
      token += next;
      token += characters[index + 1];
      index += 2;
      continue;
    }

    break;
  }

  return {
    value: token,
    nextIndex: index,
  };
}

function applySimilarCharacterReplacement(character: string): string {
  return CONFUSABLE_LATIN_MAP.get(character) ?? character;
}

async function getVocabIndex(): Promise<Map<string, number>> {
  if (!vocabIndexPromise) {
    vocabIndexPromise = loadVocabIndex();
  }

  return vocabIndexPromise;
}

async function loadVocabIndex(): Promise<Map<string, number>> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
    return DEFAULT_VOCAB_INDEX;
  }

  try {
    const response = await fetch(chrome.runtime.getURL('tfjs_model/vocab.txt'));
    if (!response.ok) {
      return DEFAULT_VOCAB_INDEX;
    }

    const tokens = (await response.text()).split(/\r?\n/u).filter(Boolean);
    if (tokens.length === 0) {
      return DEFAULT_VOCAB_INDEX;
    }

    return new Map(tokens.map((token, index) => [token, index]));
  } catch {
    return DEFAULT_VOCAB_INDEX;
  }
}
