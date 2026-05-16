// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { applyCollapsedState, clearCollapsedState } from '@/content/collapser';

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

    const banner = host!.querySelector<HTMLButtonElement>('.xspamshield-collapse-banner');
    expect(host?.classList.contains('xspamshield-collapse-host-collapsed')).toBe(true);
    expect(article?.dataset.xspamshieldCollapsed).toBe('true');
    expect(banner?.textContent).toContain('晓萱~❀同城上门');
    expect(banner?.textContent).toContain('@howell_kat4653');
    expect(banner?.textContent).toContain('已折叠');

    banner?.click();

    expect(host?.classList.contains('xspamshield-collapse-host-expanded')).toBe(true);
    expect(article?.dataset.xspamshieldExpanded).toBe('true');
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
    expect(host?.querySelector('.xspamshield-collapse-banner')).toBeNull();
    expect(article?.classList.contains('xspamshield-collapsed')).toBe(false);
  });
});