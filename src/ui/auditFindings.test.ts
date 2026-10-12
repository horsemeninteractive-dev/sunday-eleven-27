import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { Bubble } from './components/Bubble';

/**
 * The findings the completed UI audit left open, held to the change that closes
 * each one: the error has one owner, a conversation has one bubble, the squad
 * list drops columns instead of shrinking them, the tactical effects are beside
 * the instructions that cause them, and the calendar opens on a day the career
 * knows about rather than a month written into the component.
 *
 * These are contracts rather than a second audit: each one is a rule that would
 * regress in silence otherwise — the error becoming invisible again on a surface
 * that does not draw it, a second bubble vocabulary growing back, a column
 * creeping back onto a narrow table.
 */

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Strip CSS comments so an assertion cannot be satisfied by prose. */
function css(path: string): string {
  return source(path).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every UI source file, so a claim about "the only place" can be checked. */
function uiSources(dir = 'src/ui'): Array<{ path: string; code: string }> {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return uiSources(path);
    if (!/\.tsx?$/.test(path) || path.includes('.test.')) return [];
    return [{ path, code: source(path) }];
  });
}

describe('the error has one owner', () => {
  it('is drawn by one surface and one surface only', () => {
    // Every screen file that both reads the store's error and announces
    // something on it. There must be exactly one: two is the double rule this
    // pass removed, and none is the error nobody sees — which is what a failure
    // raised over a surface that does not draw it used to be.
    const owners = uiSources()
      .filter(({ code }) => code.includes('state.error') && code.includes('role="alert"'))
      .map(({ path }) => path);
    expect(owners).toEqual(['src/ui/components/GlobalFeedback.tsx']);
    // And the one Dismiss is the one that clears it.
    expect(source('src/ui/components/GlobalFeedback.tsx')).toContain('setState({ error: null })');
  });

  it('belongs to whatever has the screen, rather than floating over it', () => {
    const feedback = source('src/ui/components/GlobalFeedback.tsx');
    // Portaled into the surface in front — the panel, not its scrolling body, so a
    // long dialog cannot push the sentence off the bottom of the screen it is about.
    expect(feedback).toContain('createPortal(feedback, top)');
    expect(feedback).toContain('global-feedback--in-modal');
    // Placed by the sheet as a strip of that surface, not the corner toast.
    expect(css('src/ui/styles.css')).toMatch(
      /\.global-feedback--in-modal \{[^}]*position: static/,
    );
  });

  it('leaves the dialog shell drawing its own content and nothing else', () => {
    const dialog = source('src/ui/dialogs/Dialog.tsx');
    expect(dialog).not.toContain('state.error');
    expect(dialog).not.toContain('useModalTarget');
    expect(dialog).not.toContain('callout--bad');
  });
});

describe('a conversation is drawn one way', () => {
  it('gives both directions the same component and the same vocabulary', () => {
    const mine = renderToStaticMarkup(
      createElement(Bubble, { mine: true, from: 'You say', when: 'Yesterday', children: 'We’ll see.' }),
    );
    expect(mine).toContain('bubble--mine');
    expect(mine).not.toContain('bubble--them');
    expect(mine).not.toContain('bubble__face');

    const theirs = renderToStaticMarkup(
      createElement(Bubble, { face: createElement('span', null, 'face'), from: 'Kev', children: 'All right for Sunday?' }),
    );
    expect(theirs).toContain('bubble--them');
    expect(theirs).not.toContain('bubble--mine');
    expect(theirs).toContain('bubble__face');
    expect(theirs).toContain('All right for Sunday?');

    // Both screens render it, and neither keeps a bubble of its own.
    expect(source('src/ui/views/InboxView.tsx')).toContain("from '../components/Bubble'");
    expect(source('src/ui/components/NegotiationModal.tsx')).toContain("from './Bubble'");
    expect(source('src/ui/views/InboxView.tsx')).not.toContain('bubble--mine');
    expect(source('src/ui/components/NegotiationModal.tsx')).not.toContain('bubble--you');
  });

  it('leaves one rule for each direction in the sheet', () => {
    const sheet = css('src/ui/styles.css');
    // The second vocabulary, and the rule nothing used, are gone.
    expect(sheet).not.toContain('.bubble--you');
    expect(sheet).not.toContain('.bubble__who');
    expect(sheet.match(/^\.bubble--them \{/gm) ?? []).toHaveLength(1);
    expect(sheet.match(/^\.bubble--mine \{/gm) ?? []).toHaveLength(1);
  });

  it('draws the sentence itself, so neither screen has to remember how', () => {
    // The body belonged to the caller, and only one of the two callers remembered
    // it: the inbox wrapped each message in `.bubble__body`, the negotiation handed
    // over a bare string — so the wrapping rule that keeps a long word inside its
    // bubble was on one screen's messages and not the other's, and the next screen
    // to draw a sentence would have had to know to add a class the bubble's own
    // stylesheet defines. The component owns it now, once, for both.
    for (const bubble of [
      renderToStaticMarkup(createElement(Bubble, { children: 'All right for Sunday?' })),
      renderToStaticMarkup(createElement(Bubble, { mine: true, children: 'Just checking.' })),
    ]) {
      expect(bubble).toContain('class="bubble__body"');
      expect(bubble).toContain('bubble__words');
    }
    // And neither screen wraps its own, which is also how a `p` ends up in a `p`.
    for (const screen of ['src/ui/views/InboxView.tsx', 'src/ui/components/NegotiationModal.tsx']) {
      expect(source(screen), `${screen} wraps its own sentence`).not.toContain('bubble__body');
    }
  });
});

describe('the squad list drops columns on a narrow screen', () => {
  const view = source('src/ui/views/SquadView.tsx');

  it('says which columns each view may do without', () => {
    expect(view).toContain("selection: new Set(['form', 'morale'])");
    expect(view).toContain("performance: new Set(['assists', 'form'])");
    expect(view).toContain("attributes: new Set(['shooting', 'pace', 'stamina'])");
  });

  it('marks the heading and the cell, so no stray column is left behind', () => {
    // Two literals per column — the `th` and the `td` — and four for form, which
    // both the selection and the performance view carry. The attribute columns are
    // named once each, because their heading is drawn from the same key.
    const counts: Record<string, number> = { form: 4, morale: 2, assists: 2, shooting: 1, pace: 1, stamina: 1 };
    for (const [key, count] of Object.entries(counts)) {
      const uses = view.match(new RegExp(`optionalColumn\\(viewMode, '${key}'\\)`, 'g')) ?? [];
      expect(uses, `${key} is marked ${uses.length} times`).toHaveLength(count);
    }
    expect(view).toContain('className={optionalColumn(viewMode, key)}');
    // And the sheet really hides them where the table stops fitting.
    const sheet = css('src/ui/styles.css');
    expect(sheet).toMatch(/@media \(max-width: 860px\)[\s\S]*\.col--opt \{\s*display: none;/);
  });
});

describe('the tactical effects sit beside the instructions', () => {
  const view = source('src/ui/views/TacticsView.tsx');

  it('prints them on the panel that sets them', () => {
    expect(view).toContain('className="tactics-effects"');
    expect(view).toContain('<h3 className="subhead">What this asks of the team</h3>');
    expect(view).toContain('{effects.map((effect) => (');
    // A plain, balanced setup buys nothing and pays for nothing, and the block says
    // so rather than leaving a heading over an empty list.
    expect(view).toContain('className="tactics-effects__empty muted small"');
    expect(view).toContain('{effects.length > 0 ? (');
    // The closed disclosure at the foot of the screen is gone with them.
    expect(view).not.toContain('<details');
    expect(view).not.toContain('What these instructions ask of the team');
  });

  it('styles them as a list of consequences rather than as tiles', () => {
    const sheet = css('src/ui/styles.css');
    expect(sheet).toMatch(/\.tactics-effects \{[^}]*border-top: 1px solid var\(--line-soft\)/);
    expect(sheet).toMatch(/\.tactics-effects__list \{[^}]*display: grid/);
  });
});

describe('the calendar opens on a day the career knows about', () => {
  it('takes its fallback from the season rather than a month written into the file', () => {
    const planner = source('src/ui/components/PlannerModal.tsx');
    expect(planner).toContain('game?.date ?? game?.season.startDate');
    // The literal that would have opened the planner a month out of step.
    expect(planner).not.toContain('2026-09-01');
  });
});
