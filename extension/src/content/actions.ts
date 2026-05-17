import { ACTION_BUTTON_CLASS } from '@/shared/constants';

import { getActionBar } from '@/content/selectors';

const actionButtonHandlers = new WeakMap<HTMLButtonElement, () => void>();

interface ActionState {
  isSpam: boolean;
  isManual: boolean;
}

export function clearActionButton(article: HTMLElement): void {
  const actionBar = getActionBar(article);
  actionBar?.querySelector(`.${ACTION_BUTTON_CLASS}`)?.remove();
}

export function ensureActionButton(article: HTMLElement, state: ActionState, onToggle: () => void): void {
  const actionBar = getActionBar(article);
  if (!actionBar) {
    return;
  }

  let button = actionBar.querySelector<HTMLButtonElement>(`.${ACTION_BUTTON_CLASS}`);
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
    actionBar.append(button);
  }

  actionButtonHandlers.set(button, onToggle);

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
}
