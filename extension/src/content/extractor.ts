import { collectParsedTweets, extractMainTweet, type ParsedTweet } from '@/content/selectors';
import type { CollectedReply, CollectedThreadPayload } from '@/shared/types';

export function collectCurrentThread(): CollectedThreadPayload | null {
  const parsedTweets = collectParsedTweets();
  const mainTweet = extractMainTweet(parsedTweets);

  if (!mainTweet) {
    return null;
  }

  return buildCollectedThread(
    mainTweet,
    parsedTweets.filter((tweet) => tweet.tweetId !== mainTweet.tweetId),
  );
}

export function buildCollectedThread(mainTweet: ParsedTweet, replies: ParsedTweet[]): CollectedThreadPayload {
  return {
    threadId: mainTweet.tweetId,
    mainPost: {
      author: mainTweet.author,
      text: mainTweet.text,
      timestamp: mainTweet.timestamp,
    },
    replies: replies.map(toCollectedReply),
  };
}

export function toCollectedReply(tweet: ParsedTweet): CollectedReply {
  return {
    replyId: tweet.tweetId,
    author: tweet.author,
    authorName: tweet.authorName,
    text: tweet.text,
    timestamp: tweet.timestamp,
  };
}
