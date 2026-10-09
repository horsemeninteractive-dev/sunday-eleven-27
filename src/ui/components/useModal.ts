import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import {
  isTopLayer,
  pushLayer,
  subscribeLayers,
  topModal,
  topModalNode,
  type LayerEntry,
} from '../layers';

/**
 * The panel of the layer that has the screen, or null.
 *
 * Read through the shared stack rather than tracked here, so that the component
 * asking "is it mine on top?" and the back gesture asking "what is in front?"
 * can never come to different answers.
 */
export function useModalTarget(): HTMLElement | null {
  return useSyncExternalStore(subscribeLayers, topModalNode, () => null);
}

const inertBefore = new Map<HTMLElement, boolean>();
let overflowBefore = '';

function restoreBackground(): void {
  for (const [node, inert] of inertBefore) node.inert = inert;
  inertBefore.clear();
}

function isolateTop(): void {
  restoreBackground();
  let child: HTMLElement | null = topModalNode();
  while (child?.parentElement) {
    for (const sibling of child.parentElement.children) {
      if (sibling === child || !(sibling instanceof HTMLElement) || sibling.classList.contains('overlay__scrim') || sibling.classList.contains('sheet__backdrop')) continue;
      inertBefore.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    child = child.parentElement;
    if (child === document.body) break;
  }
}

function focusable(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
  )].filter((item) => item.getClientRects().length > 0 && !item.closest('[inert]'));
}

/**
 * A panel that belongs to the screen under it, and is put away rather than
 * covering it.
 *
 * The match's drawers are the reason this exists: they sit inside the match bar
 * and the pitch stays live behind them, so they must not make the rest of the
 * screen inert or take the focus the way a dialog does — but the back gesture
 * should still close one before it does anything more drastic, and Escape
 * already did. Registered on the same stack as the modals so that "what is in
 * front" has one answer.
 */
export function useDismissable(active: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!active) return;
    return pushLayer({ kind: 'dismissable', close: () => latest.current() });
  }, [active]);
}

/** Shared by dialogs, mobile sheets, processing and the match changing room. */
export function useModal<T extends HTMLElement>(ref: RefObject<T>, onClose?: () => void, active = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const entry: LayerEntry = {
      kind: 'modal',
      node,
      close: () => close.current?.(),
    };
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The page stops scrolling behind the *first* modal, not the first layer:
    // a match drawer opened behind a dialog is not the thing holding the screen.
    if (!topModal()) {
      overflowBefore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const remove = pushLayer(entry);
    isolateTop();
    node.tabIndex = -1;
    node.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      // Escape is answered by whatever is in front, modal or not; the focus
      // trap belongs to the modal, even when a drawer is open over it.
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (!isTopLayer(entry)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        entry.close();
        return;
      }
      if (event.key !== 'Tab' || topModal() !== entry) return;
      const items = focusable(node);
      const first = items[0];
      const last = items.at(-1);
      const focused = document.activeElement;
      if (!first) { event.preventDefault(); node.focus(); }
      else if (event.shiftKey && (focused === first || focused === node || !node.contains(focused))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (focused === last || focused === node || !node.contains(focused))) {
        event.preventDefault(); first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (topModal() === entry && !node.contains(event.target as Node)) node.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      const wasTop = isTopLayer(entry);
      remove();
      isolateTop();
      if (!topModal()) document.body.style.overflow = overflowBefore;
      if (wasTop) {
        const target = opener?.isConnected && !opener.closest('[inert]') ? opener : topModalNode();
        target?.focus({ preventScroll: true });
      }
    };
  }, [ref, active]);
}
