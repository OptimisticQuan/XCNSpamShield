import { ACTION_BUTTON_CLASS } from '@/shared/constants';

import { getActionBar } from '@/content/selectors';

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
      onToggle();
    });
    actionBar.append(button);
  }

  button.dataset.state = state.isSpam ? 'spam' : 'ham';
  button.dataset.source = state.isManual ? 'manual' : 'auto';
  button.textContent = state.isSpam ? '撤销屏蔽' : '屏蔽/标记 Spam';
}
