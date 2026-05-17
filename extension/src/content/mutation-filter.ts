import { ACTION_BUTTON_CLASS, FLOATING_CAPTURE_ROOT_ID, PLACEHOLDER_BANNER_CLASS } from '@/shared/constants';

type MutationLike = Pick<MutationRecord, 'target' | 'addedNodes' | 'removedNodes'>;

export function mutationsAffectOnlyInjectedUi(mutations: Iterable<MutationLike>): boolean {
  let hasMutation = false;

  for (const mutation of mutations) {
    hasMutation = true;
    if (!mutationAffectsOnlyInjectedUi(mutation)) {
      return false;
    }
  }

  return hasMutation;
}

function mutationAffectsOnlyInjectedUi(mutation: MutationLike): boolean {
  const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];

  if (changedNodes.length === 0) {
    return isInjectedUiNode(mutation.target);
  }

  return changedNodes.every((node) => isInjectedUiNode(node));
}

function isInjectedUiNode(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) {
    return false;
  }

  return Boolean(
    element.closest(
      `#${FLOATING_CAPTURE_ROOT_ID}, .${ACTION_BUTTON_CLASS}, .${PLACEHOLDER_BANNER_CLASS}`,
    ),
  );
}