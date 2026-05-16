const X_WEB_API_BASE = 'https://x.com/i/api/1.1';
const X_WEB_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export async function blockAccountByScreenName(screenName: string): Promise<void> {
  await postAccountAction('blocks/create.json', screenName);
}

export async function unblockAccountByScreenName(screenName: string): Promise<void> {
  await postAccountAction('blocks/destroy.json', screenName);
}

async function postAccountAction(endpoint: 'blocks/create.json' | 'blocks/destroy.json', screenName: string): Promise<void> {
  const normalizedScreenName = normalizeScreenName(screenName);
  if (!normalizedScreenName) {
    throw new Error('Missing screen name for X account action.');
  }

  const csrfToken = await resolveCsrfToken();
  const response = await fetch(`${X_WEB_API_BASE}/${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      authorization: X_WEB_BEARER_TOKEN,
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
    },
    body: new URLSearchParams({
      screen_name: normalizedScreenName,
    }),
  });

  if (!response.ok) {
    throw new Error(`X request failed with status ${response.status}.`);
  }

  const payload = (await response.json().catch(() => null)) as {
    errors?: Array<{ message?: string }>;
  } | null;

  const firstErrorMessage = payload?.errors?.find((entry) => entry?.message)?.message;
  if (firstErrorMessage) {
    throw new Error(firstErrorMessage);
  }
}

async function resolveCsrfToken(): Promise<string> {
  const cookie = await chrome.cookies.get({
    url: 'https://x.com',
    name: 'ct0',
  }) ?? await chrome.cookies.get({
    url: 'https://twitter.com',
    name: 'ct0',
  });

  const token = cookie?.value?.trim();
  if (!token) {
    throw new Error('X csrf token was not found. Please make sure you are logged in to X/Twitter.');
  }

  return token;
}

function normalizeScreenName(value: string): string {
  return value.trim().replace(/^@/u, '');
}