// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { collectParsedTweets, extractMainTweet, parseTweetArticle } from '@/content/selectors';

describe('selectors', () => {
  it('parses a detail-page tweet using the canonical status link and avatar handle', () => {
    document.body.innerHTML = `
      <main>
        <section data-testid="primaryColumn">
          <article data-testid="tweet">
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-some_author"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/some_author"><span>示例昵称</span></a>
              <a href="/some_author"><span>@some_author</span></a>
            </div>
            <div data-testid="tweetText">reply content</div>
            <a href="https://x.com/some_author/status/1234567890">
              <time datetime="2025-05-15T10:00:00.000Z"></time>
            </a>
          </article>
        </section>
      </main>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    expect(article).not.toBeNull();

    const parsed = parseTweetArticle(article!);
    expect(parsed).toMatchObject({
      tweetId: '1234567890',
      author: 'some_author',
      authorName: '示例昵称',
      text: 'reply content',
      timestamp: Date.parse('2025-05-15T10:00:00.000Z'),
    });
  });

  it('limits detail-page parsing to the primary column and resolves the current status tweet', () => {
    window.history.replaceState({}, '', '/main_author/status/2222222222');
    document.body.innerHTML = `
      <main>
        <section data-testid="primaryColumn">
          <article data-testid="tweet">
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-main_author"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/main_author"><span>主贴作者</span></a>
              <a href="/main_author"><span>@main_author</span></a>
            </div>
            <div data-testid="tweetText">main post</div>
            <a href="https://x.com/main_author/status/2222222222">
              <time datetime="2025-05-15T09:00:00.000Z"></time>
            </a>
          </article>
          <article data-testid="tweet">
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-replier"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/replier"><span>回复作者</span></a>
              <a href="/replier"><span>@replier</span></a>
            </div>
            <div data-testid="tweetText">reply</div>
            <a href="https://x.com/replier/status/3333333333">
              <time datetime="2025-05-15T09:05:00.000Z"></time>
            </a>
          </article>
        </section>
        <aside>
          <article data-testid="tweet">
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-sidebar"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/sidebar"><span>侧栏推荐</span></a>
              <a href="/sidebar"><span>@sidebar</span></a>
            </div>
            <div data-testid="tweetText">sidebar recommendation</div>
            <a href="https://x.com/sidebar/status/4444444444">
              <time datetime="2025-05-15T09:10:00.000Z"></time>
            </a>
          </article>
        </aside>
      </main>
    `;

    const tweets = collectParsedTweets();
    expect(tweets).toHaveLength(2);
    expect(tweets.map((tweet) => tweet.tweetId)).toEqual(['2222222222', '3333333333']);
    expect(extractMainTweet(tweets)?.tweetId).toBe('2222222222');
  });

  it('extracts emoji-only tweet text from image alt content', () => {
    document.body.innerHTML = `
      <main>
        <section data-testid="primaryColumn">
          <article data-testid="tweet">
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-emoji_user"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/emoji_user"><span>Emoji 用户</span></a>
              <a href="/emoji_user"><span>@emoji_user</span></a>
            </div>
            <div data-testid="tweetText">
              <span><img alt="🔥🔥🔥" src="emoji.png" /></span>
            </div>
            <a href="https://x.com/emoji_user/status/5555555555">
              <time datetime="2025-05-15T11:00:00.000Z"></time>
            </a>
          </article>
        </section>
      </main>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    expect(article).not.toBeNull();

    const parsed = parseTweetArticle(article!);
    expect(parsed?.text).toBe('🔥🔥🔥');
    expect(parsed?.authorName).toBe('Emoji 用户');
  });

  it('ignores nested tweet content when parsing the focal status tweet', () => {
    window.history.replaceState({}, '', '/main_author/status/9999999999');
    document.body.innerHTML = `
      <main>
        <section data-testid="primaryColumn">
          <article data-testid="tweet">
            <article data-testid="tweet">
              <div data-testid="Tweet-User-Avatar">
                <div data-testid="UserAvatar-Container-replier"></div>
              </div>
              <div data-testid="User-Name">
                <a href="/replier"><span>回复作者</span></a>
                <a href="/replier"><span>@replier</span></a>
              </div>
              <div data-testid="tweetText">clicked reply content</div>
              <a href="https://x.com/replier/status/8888888888">
                <time datetime="2025-05-15T09:05:00.000Z"></time>
              </a>
            </article>
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-main_author"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/main_author"><span>主贴作者</span></a>
              <a href="/main_author"><span>@main_author</span></a>
            </div>
            <div data-testid="tweetText">main post content</div>
            <a href="https://x.com/main_author/status/9999999999">
              <time datetime="2025-05-15T09:00:00.000Z"></time>
            </a>
          </article>
        </section>
      </main>
    `;

    const article = document.querySelector<HTMLElement>('section[data-testid="primaryColumn"] > article[data-testid="tweet"]');
    expect(article).not.toBeNull();

    const parsed = parseTweetArticle(article!);
    expect(parsed).toMatchObject({
      tweetId: '9999999999',
      author: 'main_author',
      authorName: '主贴作者',
      text: 'main post content',
    });
  });

  it('refreshes the parsed tweet when a virtualized article DOM node is reused for another status', () => {
    document.body.innerHTML = `
      <main>
        <section data-testid="primaryColumn">
          <article data-testid="tweet">
            <div data-testid="Tweet-User-Avatar">
              <div data-testid="UserAvatar-Container-first_user"></div>
            </div>
            <div data-testid="User-Name">
              <a href="/first_user"><span>第一个用户</span></a>
              <a href="/first_user"><span>@first_user</span></a>
            </div>
            <div data-testid="tweetText">first content</div>
            <a href="https://x.com/first_user/status/1111111111">
              <time datetime="2025-05-15T11:00:00.000Z"></time>
            </a>
          </article>
        </section>
      </main>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    expect(article).not.toBeNull();

    const firstParsed = parseTweetArticle(article!);
    expect(firstParsed).toMatchObject({
      tweetId: '1111111111',
      author: 'first_user',
      authorName: '第一个用户',
      text: 'first content',
    });

    article!.innerHTML = `
      <div data-testid="Tweet-User-Avatar">
        <div data-testid="UserAvatar-Container-second_user"></div>
      </div>
      <div data-testid="User-Name">
        <a href="/second_user"><span>第二个用户</span></a>
        <a href="/second_user"><span>@second_user</span></a>
      </div>
      <div data-testid="tweetText">second content</div>
      <a href="https://x.com/second_user/status/2222222222">
        <time datetime="2025-05-15T12:00:00.000Z"></time>
      </a>
    `;

    const secondParsed = parseTweetArticle(article!);
    expect(secondParsed).toMatchObject({
      tweetId: '2222222222',
      author: 'second_user',
      authorName: '第二个用户',
      text: 'second content',
      timestamp: Date.parse('2025-05-15T12:00:00.000Z'),
    });
  });
});