import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

interface Layer {
  node: HTMLElement;
  opener: HTMLElement | null;
  close: () => void;
}
const layers: Layer[] = [];
const listeners = new Set<() => void>();
function changed() { listeners.forEach((listener) => listener()); }
export function useModalTarget() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => layers.at(-1)?.node ?? null, () => null);
}
const inertBefore = new Map<HTMLElement, boolean>();
let overflowBefore = '';

function restoreBackground() {
  for (const [node, inert] of inertBefore) node.inert = inert;
  inertBefore.clear();
}

function isolateTop() {
  restoreBackground();
  let child = layers.at(-1)?.node;
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

function focusable(node: HTMLElement) {
  return [...node.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
  )].filter((item) => item.getClientRects().length > 0 && !item.closest('[inert]'));
}

/** Shared by dialogs, mobile sheets, processing and the match changing room. */
export function useModal<T extends HTMLElement>(ref: RefObject<T>, onClose?: () => void, active = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const layer: Layer = {
      node,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      close: () => close.current?.(),
    };
    if (layers.length === 0) {
      overflowBefore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    layers.push(layer);
    isolateTop();
    changed();
    node.tabIndex = -1;
    node.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (layers.at(-1) !== layer || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        layer.close();
      }
      if (event.key === 'Tab') {
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
      }
    };
    const focusin = (event: FocusEvent) => {
      if (layers.at(-1) === layer && !node.contains(event.target as Node)) node.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      const wasTop = layers.at(-1) === layer;
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      isolateTop();
      changed();
      if (layers.length === 0) document.body.style.overflow = overflowBefore;
      if (wasTop) {
        const target = layer.opener?.isConnected && !layer.opener.closest('[inert]') ? layer.opener : layers.at(-1)?.node;
        target?.focus({ preventScroll: true });
      }
    };
  }, [ref, active]);
}
