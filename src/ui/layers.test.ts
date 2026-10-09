import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTopLayer,
  isTopLayer,
  layerDepth,
  pushLayer,
  resetLayersForTests,
  subscribeLayers,
  topLayer,
  topModal,
  topModalNode,
} from './layers';

/**
 * What is in front, and how it is put away.
 *
 * Escape, the back gesture and the scrim of a dialog all mean the same thing,
 * and this is where the order they mean it in is kept. Tested on its own
 * because the alternative is testing it through a phone.
 */

afterEach(() => {
  resetLayersForTests();
});

const layer = (close: () => void = () => undefined) => ({ kind: 'dismissable' as const, close });

describe('the layer stack', () => {
  it('closes the thing in front, not the thing underneath it', () => {
    const closed: string[] = [];
    pushLayer(layer(() => closed.push('first')));
    pushLayer(layer(() => closed.push('second')));

    expect(layerDepth()).toBe(2);
    expect(closeTopLayer()).toBe('dismissable');
    expect(closed).toEqual(['second']);
  });

  it('keeps closing inwards as the back gesture is pressed again', () => {
    // Each close removes nothing itself — React does that when the state that
    // opened the layer has been cleared — so the stack is asked again, and the
    // entry below is now the one in front.
    const closed: string[] = [];
    const removeFirst = pushLayer(layer(() => closed.push('first')));
    const removeSecond = pushLayer(layer(() => closed.push('second')));

    closeTopLayer();
    removeSecond();
    closeTopLayer();

    expect(closed).toEqual(['second', 'first']);
    // The first is still up, because only the second was taken down.
    expect(layerDepth()).toBe(1);
    removeFirst();
    expect(layerDepth()).toBe(0);
    // And with nothing left, there is nothing to close: the caller decides what
    // an empty screen means, which for the back gesture is the screen itself.
    expect(closeTopLayer()).toBeNull();
  });

  it('refuses to close the same layer twice in one press', () => {
    // A second gesture arriving before React has re-rendered must not take the
    // screen behind the dialog with it.
    const close = vi.fn();
    pushLayer(layer(close));

    expect(closeTopLayer()).toBe('dismissable');
    expect(closeTopLayer()).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('takes a layer off when its own component goes away', () => {
    const remove = pushLayer(layer());
    expect(layerDepth()).toBe(1);
    remove();
    expect(layerDepth()).toBe(0);
    expect(topLayer()).toBeNull();
  });

  it('reads past a drawer to the modal that has the screen', () => {
    // The match's tactics drawer sits over the pitch and belongs to the screen
    // under it; a dialog opened over the match still owns the focus and the
    // inertness, and the drawer must not appear to be the thing in charge of
    // either.
    const dialogNode = {} as HTMLElement;
    pushLayer({ kind: 'modal', node: dialogNode, close: () => undefined });
    pushLayer({ kind: 'dismissable', close: () => undefined });

    expect(topModalNode()).toBe(dialogNode);
    expect(topModal()?.kind).toBe('modal');
    // Escape, though, means the drawer: it is the thing in front.
    expect(topLayer()?.kind).toBe('dismissable');
  });

  it('knows which layer is in front, so only that one answers', () => {
    const first = { kind: 'dismissable' as const, close: () => undefined };
    pushLayer(first);
    const second = { kind: 'dismissable' as const, close: () => undefined };
    pushLayer(second);

    expect(isTopLayer(second)).toBe(true);
    expect(isTopLayer(first)).toBe(false);
  });

  it('tells whoever is drawing that the stack changed', () => {
    // `useModalTarget` is subscribed: the error banner only belongs on the
    // dialog that is actually in front.
    const listener = vi.fn();
    const unsubscribe = subscribeLayers(listener);
    const remove = pushLayer(layer());
    remove();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    pushLayer(layer());
    // Nothing after the unsubscribe: a component that has gone away must not
    // be redrawn by a stack it is no longer watching.
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
