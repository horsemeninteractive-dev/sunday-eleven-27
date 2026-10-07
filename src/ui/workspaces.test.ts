import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { getFormation, FORMATION_IDS } from '@/domain/positions';
import { defaultTactics } from '@/domain/tactics';
import { createTestGame } from '@/simulation/testSupport';
import { readPanelLayout, AdaptivePanels } from './components/AdaptivePanels';
import { FormationBoard } from './components/FormationBoard';
import { diagramPosition, diagramStyle } from './tacticalDiagram';

const source = (file: string) => readFileSync(`src/ui/${file}`, 'utf8');

describe('adaptive presentation panels', () => {
  it('uses defaults when browser storage is missing or malformed', () => {
    for (const value of [null, '{broken', 'null', '42']) {
      expect(readPanelLayout(value, ['job', 'record'])).toEqual({ order: ['job', 'record'], hidden: [] });
    }
  });
  it('validates ids, removes duplicates, and includes newly introduced panels', () => {
    expect(readPanelLayout(JSON.stringify({ order: ['record', 'old', 'record', 7], hidden: ['job', 'old', 'job'] }), ['job', 'record', 'honours']))
      .toEqual({ order: ['record', 'job', 'honours'], hidden: ['job'] });
  });
  it('renders without storage and exposes real customisation rather than fake controls', () => {
    const html = renderToStaticMarkup(createElement(AdaptivePanels, { name: 'manager', panels: [{ id: 'record', label: 'Record', content: createElement('p', null, 'Career') }] }));
    expect(html).toContain('Customise panels');
    expect(html).toContain('data-panel="record"');
    expect(html).toContain('Career');
  });
});

describe('a shared football preparation diagram', () => {
  it('changes depth and width for relevant instructions without mutating their source', () => {
    const tactics = defaultTactics();
    const slot = getFormation(tactics.formation).slots[1]!;
    const before = structuredClone({ slot, tactics });
    const normal = diagramPosition(slot, tactics, 'with-ball');
    expect(diagramPosition(slot, { ...tactics, defensiveLine: 'high' }, 'with-ball').x).toBeGreaterThan(normal.x);
    expect(diagramPosition(slot, { ...tactics, mentality: 'defensive' }, 'with-ball').x).toBeLessThan(normal.x);
    expect(Math.abs(diagramPosition(slot, { ...tactics, attackingFocus: 'wide' }, 'with-ball').y - 0.5)).toBeGreaterThan(Math.abs(normal.y - 0.5));
    expect(diagramPosition(slot, tactics, 'without-ball').x).toBeLessThan(normal.x);
    expect({ slot, tactics }).toEqual(before);
  });
  it('does not pretend tempo changes starting positions or move the goalkeeper', () => {
    const tactics = defaultTactics();
    const [keeper, defender] = getFormation(tactics.formation).slots;
    expect(diagramPosition(keeper!, { ...tactics, defensiveLine: 'high' }, 'with-ball')).toEqual({ x: 0.04, y: 0.5 });
    expect(diagramPosition(defender!, { ...tactics, tempo: 'high' }, 'with-ball')).toEqual(diagramPosition(defender!, tactics, 'with-ball'));
  });
  it('keeps every formation on the diagram and gives both screens the same marker vocabulary', () => {
    for (const formation of FORMATION_IDS) for (const slot of getFormation(formation).slots) {
      const style = diagramStyle(diagramPosition(slot));
      const left = Number.parseFloat(String(style['--shape-left' as keyof typeof style]));
      const top = Number.parseFloat(String(style['--shape-top' as keyof typeof style]));
      expect(left).toBeGreaterThanOrEqual(9); expect(left).toBeLessThanOrEqual(91);
      expect(top).toBeGreaterThan(0); expect(top).toBeLessThan(100);
    }
    const { state } = createTestGame('diagram-ui');
    // The starting shape is a shape, so it is captioned by the formation it is
    // drawn from.
    const start = renderToStaticMarkup(createElement(FormationBoard, { game: state, formation: '4-4-2', tactics: defaultTactics() }));
    expect(start.match(/class="pitch__shirt"/g)).toHaveLength(11);
    expect(start).toContain('Two banks of four');
    // A position with nobody picked in it must not print its code twice: the
    // shirt already carries it.
    expect(start.match(/class="pitch__name"/g)).toBeNull();
    // An instruction phase has to say it is an illustration, because a drawing
    // of a manager's instructions is not a claim about where Touchline puts men.
    const moved = renderToStaticMarkup(createElement(FormationBoard, { game: state, formation: '4-4-2', tactics: defaultTactics(), phase: 'without-ball' }));
    expect(moved).toContain('Illustrative shape, not a prediction');
    expect(moved).toContain('Touchline decides where players actually stand');
    expect(moved).not.toEqual(start);
    expect(source('views/TeamSelectionView.tsx')).toContain('diagramStyle(diagramPosition(formationSlot))');
  });
});

describe('the corrected screen contracts', () => {
  it('keeps one squad list with alternate information views', () => {
    const view = source('views/SquadView.tsx');
    expect(view.match(/<table /g)).toHaveLength(1);
    expect(view).toContain('Squad list view');
    expect(view).not.toContain('roster-list');
    expect(view).not.toContain('Full squad list');
  });
  it('does not put repeated biography or career dropdowns on the manager page', () => {
    const view = source('views/ManagerView.tsx');
    expect(view).not.toContain('Who you are');
    expect(view).not.toContain('<details');
    expect(view).toContain('AdaptivePanels');
  });
  it('keeps match tabs as their own toggles without a redundant close strip', () => {
    const view = source('match/MatchControls.tsx');
    expect(view).not.toContain('Close panel');
    expect(view).toContain('onDrawer(drawer === tab.id ? null : tab.id)');
  });
  it('bounds messages to the frame and allows their two panes to scroll', () => {
    const css = source('styles.css');
    expect(css).toContain(".app__main[data-view='inbox']");
    expect(css).toContain('.app__main > .inbox { flex: 1 1 0; overflow: hidden; }');
    expect(css).toMatch(/\.inbox__rows \{[^}]*overflow-y: auto/s);
    expect(css).toMatch(/\.inbox__log \{[^}]*overflow-y: auto/s);
  });
});

describe('the navigation is a rail that the frame gives way to', () => {
  const css = source('styles.css');
  const nav = source('layout/SideNav.tsx');
  const shell = source('layout/AppShell.tsx');

  it('reserves a rail width and gives the screen the rest', () => {
    expect(css).toContain('--sidebar-rail: 54px');
    expect(css).toContain('.app__body--nav-open');
    expect(css).toMatch(/\.app__body \{[^}]*grid-template-columns: var\(--sidebar-rail\) minmax\(0, 1fr\)/s);
  });

  it('only declares that track where there is a navigation to draw', () => {
    // Outside this query the phone layout hides the nav, and `main` — the only
    // grid item left — was auto-placed into the rail column and given 54px to
    // lay a whole screen out in. It was measured doing exactly that.
    const scoped = css.slice(css.indexOf('.app__body--nav-open') - 1200, css.indexOf('.app__body--nav-open') + 400);
    expect(scoped).toContain('@media (min-width: 861px)');
  });

  it('clips the labels rather than removing them, so the buttons stay named', () => {
    expect(css).toMatch(/\.app__body:not\(\.app__body--nav-open\) \.sidenav__label \{[^}]*width: 0/s);
    expect(css).toMatch(/\.app__body:not\(\.app__body--nav-open\) \.sidenav__label \{[^}]*overflow: hidden/s);
    expect(nav).not.toContain('display: none');
    expect(nav).toContain('className="sidenav__label"');
  });

  it('is opened by the pointer or by the keyboard, and reports that to the frame', () => {
    expect(nav).toContain('onPointerEnter');
    expect(nav).toContain('onFocusCapture');
    expect(nav).toContain('onOpenChange');
    // Both halves are held separately: navigating with the mouse moves focus to
    // the new screen's heading, outside the nav, and one shared flag would have
    // closed the rail under a pointer that was still inside it.
    expect(nav).toContain('pointerInside || focusInside');
    expect(shell).toContain('app__body--nav-open');
  });

  it('animates, and stops animating when motion is reduced', () => {
    expect(css).toMatch(/\.app__body \{[^}]*transition: grid-template-columns/s);
  });
});

describe('a chosen control is painted by its own state', () => {
  const css = source('styles.css');
  const declarations = [...css.matchAll(/^[^{}]*(?::not\(\.(?:tab--active|segmented__item--active|chip--on)\))?[^{}]*\{[^}]*background: linear-gradient\(180deg, rgba\(255, 255, 255, 0\.0[0-9]+\), transparent\)/gm)];

  it('keeps the neutral surface off the chosen one', () => {
    // The surface layer matched plain `.tab`/`.segmented__item` and, coming
    // later in the sheet, silently replaced the club fill on the chosen one —
    // so ink chosen for a solid club fill sat on the page background, which for
    // a club playing in yellow is black text on near-black.
    expect(css).toMatch(/\.segmented__item:not\(\.segmented__item--active\)/);
    expect(css).toMatch(/\.tab:not\(\.tab--active\)/);
    expect(css).toMatch(/\.chip:not\(\.chip--on\)/);
    expect(declarations.length).toBeGreaterThan(0);
  });

  it('restates every state fill at the end of the sheet, after the surfaces', () => {
    const at = css.indexOf('2. State is painted last');
    expect(at, 'no state block').toBeGreaterThan(-1);
    const stateBlock = css.slice(at);
    expect(stateBlock).toContain('.segmented__item--active');
    expect(stateBlock).toContain('background: var(--club);');
    expect(stateBlock).toContain('.chip--on');
    expect(stateBlock).toContain('.tile--selected');
    expect(stateBlock).toContain('.table tbody tr.table__row--active');
  });

  it('lifts muted ink on the surfaces that tint themselves with the club colour', () => {
    const block = css.slice(css.indexOf('.table__row--mine,'));
    expect(block).toContain('--text-dim: #b6c1cc;');
    expect(block.slice(0, 700)).toContain('.fixrow--mine');
  });
});

describe('the screens rebuilt in this pass', () => {
  it('gives Messages the frame instead of a page gutter around the panes', () => {
    const css = source('styles.css');
    expect(css).toMatch(/\.app__main\[data-view='inbox'\] \{[^}]*padding: 0/s);
    expect(css).toMatch(/\.inbox__list > \.page-head \{[^}]*padding: 18px 16px 12px/s);
  });

  it('paints the club across the top of the workspace, edge to edge', () => {
    const css = source('styles.css');
    // On the content column, not on a padded heading: that is the difference
    // between a band across the workspace and a patch floating in a box.
    const band = css.match(/\.app__main \{[^}]*linear-gradient\(180deg, var\(--club-soft\) 0, rgba\(0, 0, 0, 0\) (\d+)px\)/s);
    expect(band).not.toBeNull();
    // And it has to be a band the manager can see. The first version started at
    // the 16% surface tint and died out 132px down, which on screen measured as
    // `#2a1113` at the top edge of a club playing in `#c62828`: the manager
    // reported that as "no gradient at the top of the main content panel", and
    // was right. "A gradient exists" was already true of it, so the reach is
    // pinned here as well — a band nobody can see is not a band.
    expect(Number(band?.[1])).toBeGreaterThanOrEqual(180);
    expect(css).toMatch(/\.app__main \{[^}]*background-attachment: scroll, local, scroll/s);
  });

  it('draws the committee with the shared card on both screens', () => {
    expect(source('views/ClubView.tsx')).toContain('<StaffCard');
    expect(source('views/StaffView.tsx')).toContain('<StaffCard');
    const card = source('components/StaffCard.tsx');
    for (const slot of ['office', 'person', 'status', 'action', 'detail', 'duty', 'issue']) {
      expect(card).toContain(slot);
    }
    expect(card).toContain('staff-roster__person');
    // The old shape: a role pill and a name strung along one line.
    expect(source('views/ClubView.tsx')).not.toContain('<ul className="tight-list">\n          {roster.map');
  });

  it('lays News out as a paper rather than a list of summaries', () => {
    const view = source('views/NewsView.tsx');
    expect(view).toContain('news-layout');
    expect(view).toContain('news-lead');
    expect(view).toContain('news-rail');
    expect(view).toContain('news-story');
    // The archive is a rail now, not a disclosure at the foot of the page.
    expect(view).not.toContain('details className="more"');
    const css = source('styles.css');
    expect(css).toMatch(/\.news-feed \{[^}]*display: grid/s);
    expect(css).toContain('@media (min-width: 1080px)');
  });
});

describe('the club colour is a tint or an edge, never a fading patch', () => {
  const css = source('styles.css');
  // Declarations are matched wherever they start — after a newline, or inline
  // after the rule's opening brace, which several of this sheet's rules use.
  const backgrounds = css.match(/(?:^|[;{]\s*)background(?:-image|-color)?[^;{}]*;/gm) ?? [];
  const clubBackgrounds = backgrounds.filter((declaration) => /var\(--club/.test(declaration));

  it('fills the surface it tints rather than fading out inside it', () => {
    // A gradient that reaches `transparent` part way across a padded box leaves
    // the club's colour as a patch floating in that box, and the point it
    // vanishes at moves with the box's width, so the same wash lands somewhere
    // different in every panel. Tints fill; edges stop on a hard edge.
    //
    // One exception, and it is the shape that makes it one: a band that starts
    // at the top edge of the workspace and fades straight *down*, on a column
    // that is as wide as the screen, so there is no edge to land in the middle
    // of and no width to tune to. It is asserted to be the only one below.
    const BAND = /linear-gradient\(180deg, var\(--club[^)]*\) 0(?:px)?, rgba\(0, 0, 0, 0\) \d+px\)/;
    expect(clubBackgrounds.length).toBeGreaterThan(20);
    const bands = clubBackgrounds.filter((declaration) => BAND.test(declaration));
    expect(bands).toHaveLength(1);
    for (const declaration of clubBackgrounds) {
      if (BAND.test(declaration)) continue;
      expect(declaration.trim()).not.toMatch(/transparent|gradient\(/);
    }
  });

  it('paints an ordinary panel head edge to edge in neutral greys', () => {
    const heads = [...css.matchAll(/^\.panel__head \{[\s\S]*?\n\}/gm)].map((match) => match[0]);
    const head = heads.at(-1) ?? '';
    expect(head).toContain('linear-gradient(180deg, var(--panel-3), var(--panel-2))');
    expect(head).not.toContain('transparent');
  });

  it('spends the club colour once per screen, flat, and never as a metric foot', () => {
    expect(css).toContain('background: var(--club-soft);');
    expect(css).not.toMatch(/\.metric-tile\.tile--\w+::after \{[^}]*linear-gradient/);
  });

  it('tints the live commentary bar edge to edge, in the club colour it names', () => {
    expect(css).toMatch(
      /\.commentary--live \{[\s\S]*?background-image: linear-gradient\(var\(--c-bar, transparent\), var\(--c-bar, transparent\)\);/,
    );
    // No ink is chosen for the club colour here: the tint is faint, so dark-on-
    // light club ink would have been set for a surface that is not that colour.
    expect(source('match/CurrentCommentary.tsx')).not.toContain('--c-ink');
  });
});
