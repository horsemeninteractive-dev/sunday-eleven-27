import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LadderChoice } from '../worldNav';
import { PyramidPicker } from './PyramidPicker';

/**
 * The one control three screens use to say which ladder they are showing.
 *
 * Career creation, the club designer and the league table each ask the same
 * question of the player, so the answer is drawn once. What is held here is the
 * part that would be wrong on all three if it were wrong here: a world with a
 * single ladder is given no control at all, a world with two is given two that do
 * not read the same, and the ladder the manager actually plays in is marked on
 * the tab rather than left to be worked out from the page behind it.
 */

const WYRE: LadderChoice = { id: 'league', label: 'Wyre Valley', hint: 'Wyre Valley Sunday League · The county’s own · 36 clubs', mine: true };
const CALE: LadderChoice = { id: 'vale', label: 'Cale Valley', hint: 'Cale Valley Sunday League · One level below · 36 clubs', mine: false };

function render(choices: LadderChoice[], selected: string, onSelect = () => {}): string {
  return renderToStaticMarkup(
    createElement(PyramidPicker, {
      choices,
      selected,
      onSelect,
      label: 'Leagues',
      controls: 'league-table-panel',
      className: 'ladder-picker',
    }),
  );
}

describe('the ladder picker', () => {
  it('is not drawn at all when there is one ladder to choose from', () => {
    expect(render([WYRE], WYRE.id)).toBe('');
  });

  it('draws a tab for each ladder, and only the chosen one is pressed', () => {
    const html = render([WYRE, CALE], CALE.id);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Leagues"');
    expect(html.split('role="tab"')).toHaveLength(3);
    expect(html).toContain('aria-controls="league-table-panel"');
    // The labels are the two regions, which is what keeps the tabs distinct.
    expect(html).toContain('Wyre Valley');
    expect(html).toContain('Cale Valley');
    // Fully said, for a pointer that rests on a tab.
    expect(html).toContain('Wyre Valley Sunday League · The county’s own · 36 clubs');
    // One selected tab, and it is the one being shown.
    expect(html.split('aria-selected="true"')).toHaveLength(2);
    expect(html).toMatch(/aria-selected="true"[^>]*>Cale Valley/);
    expect(html).toMatch(/aria-selected="false"[^>]*>Wyre Valley/);
    // The chosen tab is the one in the tab order, the way every other tabstrip
    // in the game works.
    expect(html).toMatch(/tabindex="0"[^>]*aria-selected="true"[^>]*>Cale Valley/);
    expect(html).toMatch(/tabindex="-1"[^>]*aria-selected="false"[^>]*>Wyre Valley/);
  });

  it('says which ladder is the manager\u2019s own on the tab itself', () => {
    const html = render([WYRE, CALE], CALE.id);
    expect(html).toContain('Wyre Valley · yours');
    expect(html).not.toContain('Cale Valley · yours');
  });

  it('carries the class it is given, so a screen can place it where it belongs', () => {
    expect(render([WYRE, CALE], WYRE.id)).toContain('class="segmented ladder-picker"');
  });
});
