// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { applyCollapsedState, applyQueuedHiddenState, clearCollapsedState, clearQueuedHiddenState } from '@/content/collapser';

describe('collapser', () => {
  it('keeps collapsed state on the host wrapper and toggles expanded state via the banner', () => {
    document.body.innerHTML = `
      <div class="host">
        <article data-testid="tweet">
          <div data-testid="Tweet-User-Avatar">
            <div data-testid="UserAvatar-Container-howell_kat4653"></div>
          </div>
          <div data-testid="User-Name">
            <a href="/howell_kat4653"><span>晓萱~❀同城上门</span></a>
            <a href="/howell_kat4653"><span>@howell_kat4653</span></a>
          </div>
        </article>
      </div>
    `;

    const host = document.querySelector<HTMLElement>('.host');
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');

    expect(host).not.toBeNull();
    expect(article).not.toBeNull();

    applyCollapsedState(article!, '规则或模型命中');

    const banner = host!.querySelector<HTMLElement>('.xcnspamshield-collapse-banner');
    const toggleButton = host!.querySelector<HTMLButtonElement>('.xcnspamshield-collapse-banner-toggle');
    expect(host?.classList.contains('xcnspamshield-collapse-host-collapsed')).toBe(true);
    expect(article?.dataset.xcnspamshieldCollapsed).toBe('true');
    expect(banner?.textContent).toContain('晓萱~❀同城上门');
    expect(banner?.textContent).toContain('@howell_kat4653');
    expect(banner?.textContent).toContain('已折叠');

    toggleButton?.click();

    expect(host?.classList.contains('xcnspamshield-collapse-host-expanded')).toBe(true);
    expect(article?.dataset.xcnspamshieldExpanded).toBe('true');
    expect(banner?.dataset.state).toBe('expanded');
    expect(banner?.textContent).toContain('Spam 已展开');
  });

  it('removes host classes and banner when cleared', () => {
    document.body.innerHTML = `
      <div class="host">
        <article data-testid="tweet">
          <div data-testid="Tweet-User-Avatar">
            <div data-testid="UserAvatar-Container-howell_kat4653"></div>
          </div>
          <div data-testid="User-Name">
            <a href="/howell_kat4653"><span>晓萱~❀同城上门</span></a>
            <a href="/howell_kat4653"><span>@howell_kat4653</span></a>
          </div>
        </article>
      </div>
    `;

    const host = document.querySelector<HTMLElement>('.host');
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');

    applyCollapsedState(article!, '规则或模型命中');
    clearCollapsedState(article!);

    expect(host?.className).toBe('host');
    expect(host?.querySelector('.xcnspamshield-collapse-banner')).toBeNull();
    expect(article?.classList.contains('xcnspamshield-collapsed')).toBe(false);
  });

  it('hides queued authors without keeping the collapse banner', () => {
    document.body.innerHTML = `
      <div class="host">
        <article data-testid="tweet"></article>
      </div>
    `;

    const host = document.querySelector<HTMLElement>('.host');
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');

    applyCollapsedState(article!, '规则或模型命中');
    applyQueuedHiddenState(article!);

    expect(host?.classList.contains('xcnspamshield-collapse-host-queued-hidden')).toBe(true);
    expect(host?.querySelector('.xcnspamshield-collapse-banner')).toBeNull();

    clearQueuedHiddenState(article!);

    expect(host?.classList.contains('xcnspamshield-collapse-host-queued-hidden')).toBe(false);
  });
});