/**
 * What is stacked over the screen, and in what order.
 *
 * A dialog, the mobile navigation sheet, the match's own drawers and the
 * waiting card over a league being played out are all the same idea seen from
 * different angles: something on top of the screen that the next "go back"
 * should take away. Until now each of them answered Escape for itself, which
 * was fine while Escape was the only key that asked — but a phone has a back
 * gesture, and a back gesture that closed the wrong thing (or left the match
 * entirely) would be a bug nobody could see in a browser.
 *
 * So the order is kept in one place, and everything layered registers here.
 * Two kinds are recorded, because there are two things a layer can be:
 *
 *  - a **modal** takes the screen: it holds focus, everything behind it is made
 *    inert, and the page does not scroll. A dialog is one, and so is the mobile
 *    sheet.
 *  - a **dismissable** is a panel that belongs to the screen under it and is
 *    simply put away — the match's tactics drawer, which sits inside the match
 *    bar and must not make the pitch inert.
 *
 * Both close on the back gesture; only a modal traps focus. The distinction
 * matters exactly once, in `useModal`, and nowhere else.
 *
 * Nothing in this module touches the DOM, so the order can be tested on its
 * own — which is the whole reason it is a module rather than a hook.
 */

export type LayerKind = 'modal' | 'dismissable';

export interface LayerEntry {
  readonly kind: LayerKind;
  /**
   * The panel that takes the screen, for a modal. The focus trap, the inert
   * background and the "where does focus return to" all need it; a dismissable
   * leaves it out.
   */
  readonly node?: HTMLElement | null;
  /** Put this layer away. Called by Escape, by the back button, by its scrim. */
  close: () => void;
}

/** The stack, oldest first, so the last entry is the one in front. */
const stack: LayerEntry[] = [];
const listeners = new Set<() => void>();

/**
 * Entries with a close in flight.
 *
 * Closing is a request rather than an assignment: a dialog is removed by React
 * re-rendering after the state it was opened by has been cleared, which is a
 * tick of the clock later. Two back presses inside that tick would otherwise
 * both find the same layer on top and close it twice — and a layer that closes
 * twice takes two screens with it. So the first close marks the entry and the
 * second is refused.
 */
const closing = new Set<LayerEntry>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Register a layer. Returns the way to take it off again. */
export function pushLayer(entry: LayerEntry): () => void {
  stack.push(entry);
  changed();
  return () => removeLayer(entry);
}

export function removeLayer(entry: LayerEntry): void {
  const index = stack.indexOf(entry);
  if (index >= 0) stack.splice(index, 1);
  closing.delete(entry);
  changed();
}

/** The layer in front, or null when nothing is stacked over the screen. */
export function topLayer(): LayerEntry | null {
  return stack.at(-1) ?? null;
}

/** Whether this exact layer is the one in front. */
export function isTopLayer(entry: LayerEntry): boolean {
  return stack.at(-1) === entry;
}

/**
 * The panel of the modal in front.
 *
 * Read past any dismissables: a drawer opened over a dialog does not change
 * which panel is trapping focus, and looking at the very top of the stack for
 * it would quietly let a background dialog become interactive.
 */
export function topModalNode(): HTMLElement | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index]!;
    if (entry.kind === 'modal') return entry.node ?? null;
  }
  return null;
}

/** The modal in front, for the focus trap in `useModal`. */
export function topModal(): LayerEntry | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index]!;
    if (entry.kind === 'modal') return entry;
  }
  return null;
}

/** How many things are stacked over the screen. */
export function layerDepth(): number {
  return stack.length;
}

/**
 * Put away whatever is in front, and say what that was.
 *
 * Returns the kind it closed, or null when there was nothing to close, so the
 * caller can decide what an empty stack means — for Escape that is nothing at
 * all, and for the Android back gesture it is the screen underneath.
 */
export function closeTopLayer(): LayerKind | null {
  const entry = stack.at(-1);
  if (!entry || closing.has(entry)) return null;
  closing.add(entry);
  entry.close();
  return entry.kind;
}

export function subscribeLayers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Only for tests: forget every layer, without closing any of them. */
export function resetLayersForTests(): void {
  stack.length = 0;
  closing.clear();
  changed();
}
