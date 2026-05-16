import { describe, expect, it } from 'vitest';

import { normalizeReplyToPinyinWords, normalizeToPinyinWords, tokenizeCleanedPinyin } from '@/ml/tokenizer';

describe('tokenizer', () => {
  it('normalizes Chinese text to no-tone pinyin words', () => {
    expect(normalizeToPinyinWords('这只猫好乖。')).toBe('zhe zhi mao hao guai');
  });

  it('maps confusable digits, greek letters, and cyrillic letters to latin lookalikes before segmentation', () => {
    expect(normalizeToPinyinWords('ѕ4ο')).toBe('sao');
  });

  it('normalizes reply text with author name, keeps emoji, and drops non-pinyin english', () => {
    expect(normalizeReplyToPinyinWords('晓萱~❀同城上门', '$ao the 👆❤️\n‌‍👏\n🎊 💪😎💅')).toBe(
      'xiao xuan tong cheng shang men : sao 👆 ❤️ 👏 🎊 💪 😎 💅',
    );
  });

  it('builds padded reply-only tokens from cleaned pinyin', () => {
    const tokens = tokenizeCleanedPinyin('xiao xuan tong cheng shang men : zhu ye neng da ✈️');
    expect(tokens[0]).toBe('[CLS]');
    expect(tokens[1]).toBe('xiao');
    expect(tokens[2]).toBe('xuan');
    expect(tokens).toContain('[SEP]');
    expect(tokens).toContain('✈️');
    expect(tokens).toContain(':');
    expect(tokens).toHaveLength(100);
  });
});
