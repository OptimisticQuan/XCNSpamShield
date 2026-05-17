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

    ensureActionButton(article!, { isSpam: true, isManual: true }, firstHandler);
    const firstButton = article!.querySelector<HTMLButtonElement>('.xcnspamshield-action-button');

    expect(firstButton).not.toBeNull();
    firstButton!.click();
    expect(firstHandler).toHaveBeenCalledTimes(1);

    ensureActionButton(article!, { isSpam: false, isManual: false }, secondHandler);
    const secondButton = article!.querySelector<HTMLButtonElement>('.xcnspamshield-action-button');

    expect(secondButton).toBe(firstButton);
    expect(secondButton?.textContent).toBe('屏蔽/标记 Spam');

    secondButton!.click();
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it('removes stale injected buttons regardless of which action group they are attached to', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div role="group"></div>
        <div role="group">
          <button type="button" class="xcnspamshield-action-button">撤销屏蔽</button>
        </div>
      </article>
    `;

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');

    clearActionButton(article!);

    expect(article?.querySelector('.xcnspamshield-action-button')).toBeNull();
  });
});