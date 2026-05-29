import { ACTION_BUTTON_CLASS, DIRECT_BLOCK_BUTTON_CLASS } from '@/shared/constants';

import { getActionBar } from '@/content/selectors';

const actionButtonHandlers = new WeakMap<HTMLButtonElement, () => void>();
const directBlockButtonHandlers = new WeakMap<HTMLButtonElement, () => void>();

interface ActionState {
  isSpam: boolean;
  isManual: boolean;
}

export function clearActionButton(article: HTMLElement): void {
  article.querySelectorAll(`.${ACTION_BUTTON_CLASS}, .${DIRECT_BLOCK_BUTTON_CLASS}`).forEach((button) => button.remove());
}

export function ensureActionButton(
  article: HTMLElement,
  state: ActionState,
  onToggle: () => void,
  onDirectBlock?: () => void,
): void {
  const actionBar = getActionBar(article);
  if (!actionBar) {
    return;
  }

  const existingPrimaryButtons = Array.from(article.querySelectorAll<HTMLButtonElement>(`.${ACTION_BUTTON_CLASS}`));
  let button = existingPrimaryButtons.shift() ?? null;
  existingPrimaryButtons.forEach((extraButton) => extraButton.remove());

  const existingDirectButtons = Array.from(article.querySelectorAll<HTMLButtonElement>(`.${DIRECT_BLOCK_BUTTON_CLASS}`));
  let directBlockButton = existingDirectButtons.shift() ?? null;
  existingDirectButtons.forEach((extraButton) => extraButton.remove());

  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = ACTION_BUTTON_CLASS;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      actionButtonHandlers.get(button!)?.();
    });
  }

  if (!directBlockButton) {
    directBlockButton = document.createElement('button');
    directBlockButton.type = 'button';
    directBlockButton.className = DIRECT_BLOCK_BUTTON_CLASS;
    directBlockButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      directBlockButtonHandlers.get(directBlockButton!)?.();
    });
  }

  if (button.parentElement !== actionBar) {
    actionBar.append(button);
  }
  if (directBlockButton.parentElement !== actionBar) {
    actionBar.append(directBlockButton);
  }

  actionButtonHandlers.set(button, onToggle);
  directBlockButtonHandlers.set(directBlockButton, onDirectBlock ?? (() => {}));

  const nextState = state.isSpam ? 'spam' : 'ham';
  if (button.dataset.state !== nextState) {
    button.dataset.state = nextState;
  }

  const nextSource = state.isManual ? 'manual' : 'auto';
  if (button.dataset.source !== nextSource) {
    button.dataset.source = nextSource;
  }

  const nextText = state.isSpam ? '撤销屏蔽' : '屏蔽/标记 Spam';
  if (button.textContent !== nextText) {
    button.textContent = nextText;
  }

  if (directBlockButton.textContent !== '直接拉黑') {
    directBlockButton.textContent = '直接拉黑';
  }
}
