import { extractTweetAuthorIdentities } from '@/content/page-data-parser';
import { PAGE_BRIDGE_EVENT_NAME } from '@/shared/constants';

declare global {
  interface Window {
    __xcnspamshieldPageBridgeInstalled__?: boolean;
  }
}

initializePageBridge();

function initializePageBridge(): void {
  if (window.__xcnspamshieldPageBridgeInstalled__) {
    return;
  }

  window.__xcnspamshieldPageBridgeInstalled__ = true;
  patchFetch();
  patchXmlHttpRequest();
}

function patchFetch(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    void inspectResponsePayload(response.url, response.headers.get('content-type'), async () => response.clone().json());
    return response;
  };
}

function patchXmlHttpRequest(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]): void {
    Reflect.set(this, '__xcnspamshieldUrl__', String(url));
    const [asyncValue, username, password] = rest as [boolean | undefined, string | undefined, string | undefined];

    if (typeof asyncValue === 'boolean') {
      if (typeof username === 'string') {
        originalOpen.call(this, method, url, asyncValue, username, password);
        return;
      }

      originalOpen.call(this, method, url, asyncValue);
      return;
    }

    originalOpen.call(this, method, url, true);
  };

  XMLHttpRequest.prototype.send = function send(...args: unknown[]): void {
    this.addEventListener(
      'load',
      () => {
        const requestUrl = Reflect.get(this, '__xcnspamshieldUrl__');
        void inspectResponsePayload(
          typeof requestUrl === 'string' ? requestUrl : '',
          this.getResponseHeader('content-type'),
          async () => JSON.parse(this.responseText) as unknown,
        );
      },
      { once: true },
    );

    originalSend.call(this, ...(args as [Document | XMLHttpRequestBodyInit | null | undefined]));
  };
}

async function inspectResponsePayload(
  url: string,
  contentType: string | null,
  loadPayload: () => Promise<unknown>,
): Promise<void> {
  if (!shouldInspectPayload(url, contentType)) {
    return;
  }

  try {
    const payload = await loadPayload();
    const identities = extractTweetAuthorIdentities(payload);
    if (identities.length === 0) {
      return;
    }

    window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_EVENT_NAME, {
      detail: {
        identities,
      },
    }));
  } catch {
    // Ignore parse failures from unrelated X endpoints.
  }
}

function shouldInspectPayload(url: string, contentType: string | null): boolean {
  if (!url || !/https:\/\/(x|twitter)\.com\//u.test(url)) {
    return false;
  }

  if (!/\/i\/api\//u.test(url) && !/\/graphql\//u.test(url)) {
    return false;
  }

  if (contentType && !/json/u.test(contentType)) {
    return false;
  }

  return true;
}