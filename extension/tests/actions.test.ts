// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { clearActionButton, ensureActionButton } from '@/content/actions';

describe('actions', () => {
  it('reuses the injected action button and updates the click handler between scans', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div role="group"></div>
      </article>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const firstDirectBlockHandler = vi.fn();
    const secondDirectBlockHandler = vi.fn();

    ensureActionButton(article!, { isSpam: true, isManual: true }, firstHandler, firstDirectBlockHandler);
    const firstButton = article!.querySelector<HTMLButtonElement>('.xcnspamshield-action-button');
    const firstDirectBlockButton = article!.querySelector<HTMLButtonElement>('.xcnspamshield-direct-block-button');

    expect(firstButton).not.toBeNull();
    expect(firstDirectBlockButton).not.toBeNull();
    firstButton!.click();
    firstDirectBlockButton!.click();
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(firstDirectBlockHandler).toHaveBeenCalledTimes(1);

    ensureActionButton(article!, { isSpam: false, isManual: false }, secondHandler, secondDirectBlockHandler);
    const secondButton = article!.querySelector<HTMLButtonElement>('.xcnspamshield-action-button');
    const secondDirectBlockButton = article!.querySelector<HTMLButtonElement>('.xcnspamshield-direct-block-button');

    expect(secondButton).toBe(firstButton);
    expect(secondDirectBlockButton).toBe(firstDirectBlockButton);
    expect(secondButton?.textContent).toBe('屏蔽/标记 Spam');
    expect(secondDirectBlockButton?.textContent).toBe('直接拉黑');

    secondButton!.click();
    secondDirectBlockButton!.click();
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(firstDirectBlockHandler).toHaveBeenCalledTimes(1);
    expect(secondDirectBlockHandler).toHaveBeenCalledTimes(1);
  });

  it('removes stale injected buttons regardless of which action group they are attached to', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div role="group"></div>
        <div role="group">
          <button type="button" class="xcnspamshield-action-button">撤销屏蔽</button>
          <button type="button" class="xcnspamshield-direct-block-button">直接拉黑</button>
        </div>
      </article>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');

    clearActionButton(article!);

    expect(article?.querySelector('.xcnspamshield-action-button')).toBeNull();
    expect(article?.querySelector('.xcnspamshield-direct-block-button')).toBeNull();
  });
});