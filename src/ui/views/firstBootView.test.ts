import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FirstBootView } from './FirstBootView';

/**
 * The first boot, as it is actually drawn.
 *
 * Rendered once here rather than asserted against the source, because the point
 * of this file is not that the words are typed somewhere in it — it is that they
 * reach the screen, in the right order, with a way out of them. Nothing about
 * the timing or the animation is checked: neither exists on a server, and the
 * sequence's auto-advance, its timer and its Escape handler are the parts of it
 * that need a browser.
 */

const html = renderToStaticMarkup(createElement(FirstBootView, { onDone: () => {} }));

describe('the first boot screen', () => {
  it('introduces the engine before it names the game, which is the whole point', () => {
    const engine = html.indexOf('Match Simulation Engine');
    const game = html.indexOf('aria-label="Sunday Eleven 27"');
    expect(engine).toBeGreaterThan(-1);
    expect(game).toBeGreaterThan(-1);
    expect(engine).toBeLessThan(game);
  });

  it('names Touchline, and says what it is rather than what it is like', () => {
    expect(html).toContain('Touchline');
    expect(html).toContain('Match Simulation Engine');
    expect(html).toContain('Powered by Touchline');
    // Never described as any of the things it is not.
    for (const claim of ['AI', 'machine learning', 'neural', 'third-party', 'middleware', 'physics engine']) {
      expect(html).not.toContain(claim);
    }
  });

  it('hands the game its own lockup, the same one the menu uses', () => {
    expect(html).toContain('Sunday League Football Management');
    expect(html).toContain('aria-label="Sunday Eleven 27"');
  });

  it('gives the mark a slot to land in rather than drawing one', () => {
    // The artwork is not drawn anywhere in the component: the mark is a file,
    // and until it exists the slot is what is shown.
    expect(html).toContain('src="/touchline-mark.svg"');
    expect(html).toContain('alt=""');
  });

  it('offers a way out of it, as a real button with a name', () => {
    expect(html).toContain('>Skip intro</button>');
    expect(html).toContain('type="button"');
  });

  it('is announced as one thing, with the relationship in its own name', () => {
    // The sequence is decoration over a sentence, so the group is what a screen
    // reader is given, and it says what the two names have to do with each other
    // rather than reading them out as unrelated typography.
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Touchline, the match simulation engine, in Sunday Eleven 27"');
  });
});
