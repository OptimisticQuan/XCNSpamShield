import { describe, expect, it } from 'vitest';

import { extractTweetAuthorIdentities } from '@/content/page-data-parser';

describe('page data parser', () => {
  it('extracts tweet author identities from graphQL tweet results', () => {
    const payload = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              entries: [
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: '1234567890',
                          legacy: {
                            full_text: 'reply content',
                            user_id_str: '9988776655',
                            conversation_id_str: '1234567890',
                          },
                          core: {
                            user_results: {
                              result: {
                                rest_id: '9988776655',
                                legacy: {
                                  screen_name: 'some_author',
                                  name: '示例昵称',
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    };

    expect(extractTweetAuthorIdentities(payload)).toEqual([
      {
        tweetId: '1234567890',
        authorId: '9988776655',
        author: 'some_author',
        authorName: '示例昵称',
      },
    ]);
  });

  it('unwraps visibility wrappers around tweets', () => {
    const payload = {
      data: {
        tweetResult: {
          result: {
            __typename: 'TweetWithVisibilityResults',
            tweet: {
              rest_id: '24680',
              legacy: {
                full_text: 'wrapped reply',
                user_id_str: '13579',
              },
              core: {
                user_results: {
                  result: {
                    rest_id: '13579',
                    legacy: {
                      screen_name: 'wrapped_user',
                      name: '外层用户',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(extractTweetAuthorIdentities(payload)).toEqual([
      {
        tweetId: '24680',
        authorId: '13579',
        author: 'wrapped_user',
        authorName: '外层用户',
      },
    ]);
  });
});