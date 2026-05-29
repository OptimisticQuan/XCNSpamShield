import { describe, expect, it } from 'vitest';

import { filterRepliesByReplyId, filterThreadGroupsByReplyId, normalizeReplyIdQuery } from '@/popup/reply-search';
import type { ThreadGroupView } from '@/shared/types';

const threadGroups: ThreadGroupView[] = [
  {
    threadId: 'thread-1',
    mainPost: {
      author: 'foo',
      text: 'main post 1',
      timestamp: 1,
    },
    replies: [
      {
        replyId: '1931110000000000001',
        threadId: 'thread-1',
        author: 'alice',
        authorName: 'Alice',
        originalText: 'first',
        label: 1,
        source: 'auto',
        extractTime: 10,
        matchedRules: [],
      },
      {
        replyId: '1931110000000000002',
        threadId: 'thread-1',
        author: 'bob',
        authorName: 'Bob',
        originalText: 'second',
        label: 0,
        source: 'manual',
        extractTime: 20,
        matchedRules: [],
      },
    ],
    replyCount: 2,
    spamCount: 1,
    lastExtractTime: 20,
  },
  {
    threadId: 'thread-2',
    mainPost: {
      author: 'bar',
      text: 'main post 2',
      timestamp: 2,
    },
    replies: [
      {
        replyId: '1932220000000000003',
        threadId: 'thread-2',
        author: 'carol',
        authorName: 'Carol',
        originalText: 'third',
        label: 1,
        source: 'auto',
        extractTime: 30,
        matchedRules: [],
      },
    ],
    replyCount: 1,
    spamCount: 1,
    lastExtractTime: 30,
  },
];

describe('reply search helpers', () => {
  it('normalizes whitespace around the reply_id query', () => {
    expect(normalizeReplyIdQuery(' 1931110000000000002 ')).toBe('1931110000000000002');
  });

  it('filters thread groups by matching reply_id', () => {
    expect(filterThreadGroupsByReplyId(threadGroups, '0002').map((group) => group.threadId)).toEqual(['thread-1']);
    expect(filterThreadGroupsByReplyId(threadGroups, '1932220000000000003').map((group) => group.threadId)).toEqual(['thread-2']);
  });

  it('filters replies within the selected thread by reply_id', () => {
    expect(filterRepliesByReplyId(threadGroups[0].replies, '000')).toHaveLength(2);
    expect(filterRepliesByReplyId(threadGroups[0].replies, '0002').map((reply) => reply.replyId)).toEqual(['1931110000000000002']);
  });
});