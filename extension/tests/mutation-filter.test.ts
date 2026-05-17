// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { mutationsAffectOnlyInjectedUi } from '@/content/mutation-filter';

describe('mutation-filter', () => {
  it('ignores mutations that only add injected extension controls', () => {
    document.body.innerHTML = '<article data-testid="tweet"><div role="group"></div></article>';

    const actionBar = document.querySelector<HTMLElement>('div[role="group"]');
    const button = document.createElement('button');
    button.className = 'xcnspamshield-action-button';

    expect(
      mutationsAffectOnlyInjectedUi([
        {
          target: actionBar!,
          addedNodes: [button] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
        },
      ]),
    ).toBe(true);
  });

  it('does not ignore native tweet subtree changes', () => {
    document.body.innerHTML = '<article data-testid="tweet"><div role="group"></div></article>';

    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    const nativeNode = document.createElement('div');
    nativeNode.textContent = 'new native tweet content';

    expect(
      mutationsAffectOnlyInjectedUi([
        {
          target: article!,
          addedNodes: [nativeNode] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
        },
      ]),
    ).toBe(false);
  });
});