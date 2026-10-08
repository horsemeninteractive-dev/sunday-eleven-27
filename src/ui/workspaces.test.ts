import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { getFormation, FORMATION_IDS } from '@/domain/positions';
import { defaultTactics } from '@/domain/tactics';
import { isPlayer, personDisplayName, type Person } from '@/domain/person';
import { createTestGame } from '@/simulation/testSupport';
import { sendFromManager, sendFromPerson, threadWith, threadWithGroup } from '@/simulation/communication/system';
import { readPanelLayout, AdaptivePanels } from './components/AdaptivePanels';
import { FormationBoard } from './components/FormationBoard';
import { flatClubInk } from './colour';
import { goalkeeperKitColour } from './kit';
import { diagramPosition, diagramStyle } from './tacticalDiagram';
import { facePlan } from './face';
import { inboxRows, threadMessages } from './inboxState';
import { PortraitArt, outfitFor } from './components/Portrait';
import { PersonLine, PersonLineArt } from './components/PersonIdentity';
import { MessageLog, Row } from './views/InboxView';

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
    // Eleven shirts, the keeper's among them: his carries a modifier class of its
    // own, so the count is of the shirts rather than of one exact class attribute.
    expect(start.match(/class="pitch__shirt/g)).toHaveLength(11);
    expect(start).toContain('Two banks of four');
    // The keeper is the one shirt on the diagram that is not the club's: it is
    // painted in the third strip, in a flat colour with an ink measured to read on
    // it, and the ten outfield shirts are left to the stylesheet.
    const shirts = [...start.matchAll(/<span class="pitch__shirt([^>]*)>/g)];
    expect(shirts).toHaveLength(11);
    const painted = shirts.filter(([, attrs]) => (attrs ?? '').includes('pitch__shirt--keeper'));
    expect(painted).toHaveLength(1);
    const third = goalkeeperKitColour(state, state.userClubId)!;
    expect(painted[0]![1]).toContain(`style="background:${third};color:${flatClubInk(third)}"`);
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

  it('gives a story a picture of the kind of story it is', () => {
    const view = source('views/NewsView.tsx');
    // One on the lead story and one on every card in the feed: the picture
    // belongs to the story rather than being an ornament on the screen.
    expect(view.split('<NewsPlate').length - 1).toBe(2);
    expect(view).toContain('<NewsPlate category={item.category} className="news-plate--lead" />');
    // And on a card it is drawn inside the summary, beside the headline it is a
    // picture of, rather than in the body that only opens when the card does.
    expect(view.slice(view.indexOf('<summary>'))).toContain('<NewsPlate category={item.category} />');

    // The six kinds of story, six drawings: a paper whose match report and whose
    // finance warning wore the same picture would have said nothing by drawing
    // it, so each kind has one of its own in the same map.
    const plate = source('components/NewsPlate.tsx');
    for (const category of ['Match', 'Squad', 'Club', 'League', 'World', 'Finances']) {
      expect(plate, category).toContain(`${category}: [`);
    }

    const css = source('styles.css');
    // One sheet, one size, and the lead story's copy of it twice that size —
    // drawn at half the stroke weight, or the lead's picture would be the one
    // thing on the screen with a heavier hand than everything around it.
    expect(css).toMatch(/\.news-plate \{[^}]*width: 64px/s);
    expect(css).toMatch(/\.news-plate--lead \{[^}]*stroke-width: 0\.75/s);
    expect(css).toMatch(/\.news-story > summary \{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/s);
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

/**
 * Every rule in the sheet as its selector, its body, and the at-rules around it.
 *
 * Comments go first so that an assertion cannot be satisfied by prose, and the
 * media context is carried because for these rules it is the whole point: a
 * background on a pre-game header is either a black box over the pitch
 * photograph or the thing that keeps the words legible while a phone scrolls the
 * page under a sticky header, and which of the two it is depends entirely on
 * where the rule sits. There is no nesting inside a rule body in this sheet, so a
 * body ends at the first closing brace.
 */
function rules(file: string): { media: string; selector: string; body: string }[] {
  const sheet = source(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const found: { media: string; selector: string; body: string }[] = [];
  const open: string[] = [];
  let index = 0;
  let start = 0;
  while (index < sheet.length) {
    const char = sheet[index];
    if (char === '{') {
      const head = sheet.slice(start, index).trim();
      if (head.startsWith('@')) {
        open.push(head);
        index += 1;
        start = index;
        continue;
      }
      const close = sheet.indexOf('}', index);
      found.push({ media: open.join(' '), selector: head, body: sheet.slice(index + 1, close) });
      index = close + 1;
      start = index;
      continue;
    }
    if (char === '}') {
      open.pop();
      index += 1;
      start = index;
      continue;
    }
    index += 1;
  }
  return found;
}

describe('the pre-game headers, the crest and the two screens rebuilt with them', () => {
  const sheet = rules('styles.css');
  const rule = (selector: string, media = '') =>
    sheet.find((candidate) => candidate.selector.trim() === selector && candidate.media === media);

  it('leaves the club designer and club selection headers unpainted on a desktop', () => {
    // Both screens put the header straight on the pitch photograph and lean on
    // the brand's drop shadow to keep the words readable — the shadow is written
    // for exactly that, and it is scoped so it is not worn inside a career where
    // the same header sits on flat black. An unscoped `background: var(--bg)`
    // then pasted a black rectangle over the photograph instead: measured as
    // `rgb(8, 9, 11)` across the top of both screens at 1024, 1280 and 1440.
    const painted = sheet.filter(
      (candidate) =>
        (candidate.selector.includes('.club-select .page-head') || candidate.selector.includes('.create-club .page-head')) &&
        candidate.body.includes('background'),
    );
    // The rule has not been deleted, it has been scoped: on a phone the header is
    // sticky and the page scrolls under it, so there it has to paint.
    expect(painted.length).toBeGreaterThan(0);
    for (const header of painted) {
      expect(header.media, `${header.selector} paints a background outside a phone width`).toContain('max-width');
      expect(header.body).toContain('position: sticky');
      expect(header.body).toContain('background: var(--bg)');
    }
  });

  it('draws the crest in the match header at a size the club is recognisable at', () => {
    // Thirty pixels was the same height as the club's name beside it, which is
    // what made a badge read as a bullet point. It costs the match no room: the
    // score and the clock in the middle of the row are already taller.
    expect(rule('.matchhead__crest')?.body).toContain('width: 44px');
    expect(rule('.matchhead__crest')?.body).toContain('height: 44px');
    // The phone keeps a smaller figure, because there the header is one line of
    // furniture above the pitch.
    const phone = sheet.find(
      (candidate) => candidate.selector.trim() === '.matchhead__crest' && candidate.media.includes('max-width: 860px'),
    );
    expect(phone?.body).toContain('width: 28px');
  });

  it('lays the club designer out three across once there is room for it', () => {
    // Two columns of about 570 could only be balanced if what was in them was the
    // same height, and it was not: Identity and Ground came to 862 against the
    // Badge and Squad panels' 1122, which is a 260 pixel hole at the foot of the
    // left column and a scrollbar on a 900 pixel screen.
    const grid = rule('.create-club__grid', '@media (min-width: 1024px)');
    expect(grid?.body).toContain('repeat(3, minmax(0, 1fr))');
    // The two column wrappers are only a way of ordering the panels, so in the
    // wide layout they stop being boxes and hand their four panels to the grid.
    expect(rule('.create-club__column', '@media (min-width: 1024px)')?.body).toContain('display: contents');
    // The badge panel's own `grid-column: 1 / -1` was written for a panel in the
    // grid and has never applied, because the panel is a flex item inside a
    // column. The moment the columns hand their children up it takes the whole
    // top row and pushes the other two out of it — measured, a taller page than
    // the two columns it replaced. So the release is written to outrank it, by
    // being scoped to the grid rather than by sitting further down the sheet.
    const badge = sheet.find(
      (candidate) => candidate.selector.includes('.create-club__badge-panel') && candidate.media.includes('min-width: 1024px'),
    );
    expect(badge?.selector).toBe('.create-club__grid .create-club__badge-panel');
    expect(badge?.body).toContain('grid-column: auto');
  });

  it('puts the kit the club wears beside the three it could have worn', () => {
    // The chosen kit on the left, the alternatives down the right. Read as one
    // column of three full width cards, the thing being compared against had
    // scrolled off the top before the comparison, and each card carried two
    // thirds of its own width empty.
    expect(rule('.kitscreen')?.body).toContain('grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr)');
    expect(rule('.kitoptions--stack')?.body).toContain('grid-template-columns: minmax(0, 1fr)');
    // Three shirts on one row. Left to wrap, a column 400 wide folds the third
    // onto a line of its own and the chosen column ends up half as tall again as
    // the designs beside it — the same reason the phone caps these figures at 96.
    expect(rule('.kitscreen__chosen .kitrow')?.body).toContain('flex-wrap: nowrap');

    // The view hands the chosen kit to the first of the two boxes and the designs
    // to the second, in that order, because that order is what the two columns
    // are. And it no longer opens with a full width section for the strip.
    const view = source('views/KitView.tsx');
    expect(view.indexOf('kitscreen__chosen')).toBeLessThan(view.indexOf('kitscreen__options'));
    expect(view).toContain('kitoptions kitoptions--stack');
    expect(view).not.toContain('className="kitoptions"');
  });
});

describe('a person is drawn, and a dialog says what kind of thing it is', () => {
  const sheet = rules('styles.css');
  const rule = (selector: string) => sheet.find((candidate) => candidate.selector.trim() === selector && candidate.media === '');

  it('draws a man rather than a pair of initials in a box', () => {
    // Everybody in the game used to be the same bust glyph in the same grey box,
    // which made a committee, a squad and a list of names found through the local
    // game read as one record repeated. Initials were tried next and were worse:
    // two letters in a square is the visual grammar of a database, and it made the
    // game look *more* like a dashboard rather than less. Every person is drawn
    // now — `components/Portrait.tsx`, whose plan is `face.ts` — and nothing in
    // the sheet or in the interface mentions a mark or an initial at all.
    expect(rule('.portrait')?.body).toContain('border-radius: var(--radius)');
    expect(rule('.portrait')?.body).toContain('overflow: hidden');
    expect(rule('.portrait__art')?.body).toContain('width: 100%');
    expect(sheet.some((candidate) => candidate.selector.includes('person-mark'))).toBe(false);
    expect(sheet.some((candidate) => candidate.selector.includes('initials'))).toBe(false);
    for (const file of ['components/PersonIdentity.tsx', 'components/ProfileOverlay.tsx', 'views/RecruitmentView.tsx']) {
      expect(source(file), `${file} still draws a mark`).not.toMatch(/person-mark|initials/i);
    }
    // The old bust glyph is not what a person is drawn with any more.
    expect(source('components/PersonIdentity.tsx')).not.toContain('name="manager"');
    expect(source('components/Portrait.tsx')).toContain('facePlan(person)');
    // And the club is read from the career, so no screen has to look it up itself.
    expect(source('components/Portrait.tsx')).toContain('useGame()');
    expect(source('components/Portrait.tsx')).toContain('outfitFor(game, person)');
  });

  it('puts the club on the man rather than on the box round him', () => {
    // The initials mark was tinted with the club's wash and edged with its colour,
    // which was the only way a square of two letters could say whose he was. A
    // drawing says it better and says more: he is wearing the club's own shirt,
    // read from the same kit the Kit screen draws, so a transfer changes the shirt
    // and never the face. A tinted box *behind* a shirt in the club's second colour
    // would be two answers to one question, so there is none.
    //
    // The one man in the club who wears something else is the keeper: he is drawn
    // in the third strip, because that is the shirt he turns out in and the laws
    // ask him to be told from the ten in front of him.
    expect(rule('.portrait')?.body).not.toContain('--club');
    expect(rule('.portrait')?.body).toContain('background: var(--panel-3)');
    expect(source('components/Portrait.tsx')).toContain(
      "designFor(kit, person.preferredPosition === 'GK' ? 'goalkeeper' : 'home')",
    );
    expect(source('components/Portrait.tsx')).toContain('person.clubId');
  });

  it("gives the portrait four sizes, all of the drawing's own proportions", () => {
    // One drawing in four boxes rather than four drawings: the sheet scales a
    // 56-wide, 64-tall box, so every size has to be that shape or the drawing is
    // letterboxed inside a chip that does not fit it.
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      const body = rule(`.portrait--${size}`)?.body ?? '';
      const width = Number(/width: (\d+)px/.exec(body)?.[1]);
      const height = Number(/height: (\d+)px/.exec(body)?.[1]);
      expect(Number.isFinite(width) && Number.isFinite(height), `no ${size} portrait`).toBe(true);
      expect(Math.abs(width / height - 0.875), `${size} is not the shape of the drawing`).toBeLessThan(0.01);
    }
    // The profile's is the big one, and being the big one is the point of it.
    expect(rule('.portrait--xl')?.body).toContain('width: 105px');
  });

  it('gives a person his own page at the top of it, and the manager his own face', () => {
    const profile = source('components/ProfileOverlay.tsx');
    // Both kinds of profile lead with the drawing: a player's, and an official's,
    // which used to open with a bare heading and no picture of anybody.
    expect(profile).toContain('<Portrait person={player} size="xl" />');
    expect(profile).toContain('<Portrait person={person} size="xl" />');
    expect(profile).toContain('profilehead--person');
    expect(source('views/ManagerView.tsx')).toContain('<Portrait person={official} size="xl" />');
    // The manager's frame was an arch, which suited a bust glyph and cut the top
    // off a face; it is a rectangle round the same chip every list uses.
    const frame = rule('.manager-identity__portrait .portrait')?.body ?? '';
    expect(frame).toContain('background: none');
    expect(rule('.manager-identity__portrait')?.body).not.toContain('50% 50%');
  });

  it('puts the square beside the name, in every list that draws a person', () => {
    // A name found through the local game was the one place the mark sat on a
    // line of its own above the name — measured on a tile two thirds empty, the
    // square's foot 2px clear of the name below it. Every other list of people in
    // the game finds a man by his square and reads his name to the right of it.
    const head = rule('.player-tile__head')?.body ?? '';
    expect(head).toContain('display: flex');
    expect(head).toContain('align-items: center');
    // And the name takes the rest of the row, so the hint beside it stays right
    // aligned on the same line as the mark.
    expect(rule('.player-tile__top')?.body).toContain('flex: 1 1 auto');
    expect(source('views/RecruitmentView.tsx')).toContain('player-tile__head');
  });

  it('lets the list decide how big the portrait is, not how it is painted', () => {
    // The staff roster and the squad table are where the size is decided, because
    // only they know the run of the list — but what the drawing *is* belongs to the
    // drawing, so neither of them paints anything.
    const roster = rule('.staff-roster__identity .portrait')?.body ?? '';
    const squad = rule('.squad-table .portrait')?.body ?? '';
    expect(roster).toContain('height: 53px');
    expect(squad).toContain('height: 32px');
    for (const context of [roster, squad]) {
      expect(context).toMatch(/width: \d+px/);
      expect(context).not.toContain('background');
    }
  });

  it('carries the kind of dialog on the overlay, from the dialog itself', () => {
    // Nothing behaves differently because of it: the scrim, the escape key and
    // the focus trap are one system. What changes is the head, which is how a
    // dossier stops looking like a question with two answers.
    const dialog = source('dialogs/Dialog.tsx');
    expect(dialog).toContain('data-modal={kind}');
    expect(dialog).toContain("'person' | 'club' | 'report' | 'confirm'");
    // A dialog with no kind is a utility and keeps the plain head it always had.
    expect(dialog).toContain('kind?: DialogKind');
  });

  it('paints four kinds, and never inside a media query', () => {
    // A kind is not a layout: which head a dialog wears does not depend on the
    // width of the window, and a kind that only applied on a desktop would be a
    // dialog that changed its identity when the screen was made smaller.
    const kinds = sheet.filter((candidate) => candidate.selector.includes('data-modal='));
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) expect(kind.media, `${kind.selector} is inside ${kind.media}`).toBe('');
    // A man's dossier and the club's own page get the club's tint on the head; a
    // match report gets a rule, not a tint, because it is a document either way.
    expect(rule(".overlay[data-modal='person'] .overlay__bar,\n.overlay[data-modal='club'] .overlay__bar")?.body).toContain('background: var(--club-wash)');
    expect(rule(".overlay[data-modal='report'] .overlay__title")?.body).toContain('font-size: var(--fs-xl)');
    // And a question wears none of it: no club colour, and a smaller title, so it
    // reads as a decision to take rather than as a document to read.
    const confirm = rule(".overlay[data-modal='confirm'] .overlay__panel")?.body ?? '';
    expect(confirm).toContain('border-top-color: var(--line)');
    expect(confirm).not.toContain('--club');
    expect(rule(".overlay[data-modal='confirm'] .overlay__title")?.body).toContain('font-size: var(--fs-md)');
  });

  it('wears the club’s colours on the dialogs that live outside the shell', () => {
    // The four game dialogs are mounted above the shell, and the club's colours
    // are set on the shell — so a career's own Settings and Preferences were
    // drawn in the game's default green, which is a colour no club in the save
    // has. Measured on a club whose colour is #1f6feb: `The game` wore the club's
    // blue and `Preferences`, opened from inside it, wore `rgb(76, 175, 125)`.
    const dialogs = source('dialogs/AppDialogs.tsx');
    expect(dialogs).toContain('clubStyle(game.clubs[game.userClubId]!.identity.colours)');
    // And the main menu still has no club to take a colour from, which is why
    // the colours are a wrapper around the dialog rather than a second shell.
    expect(dialogs).toContain('if (!game) return open;');
  });

  it('hands each dialog the kind it is, at the place that opens it', () => {
    expect(source('components/ProfileOverlay.tsx')).toContain("kind={current.kind === 'club' ? 'club' : 'person'}");
    expect(source('components/MatchReportModal.tsx')).toContain('kind="report"');
    for (const file of ['dialogs/SaveManager.tsx', 'dialogs/ProfilesDialog.tsx']) {
      expect(source(file), `${file} asks a question without saying so`).toContain('kind="confirm"');
    }
  });

  it('moves at one speed, in four places, and loops nowhere', () => {
    // The navigation, the thing under the pointer, the selection, and a row.
    const at = (needle: string) =>
      sheet.find((candidate) => candidate.selector.includes(needle) && candidate.body.includes('120ms'));
    for (const place of ['.sidenav__item', '.tile--pressable', '.chip']) {
      expect(at(place), `${place} does not move`).toBeTruthy();
      // One speed only: a thing that moves at its own pace is a thing that
      // belongs to a different screen.
      const durations = [...at(place)!.body.matchAll(/[\d.]+m?s/g)].map((match) => match[0]);
      expect(durations.length, `${place} moves without saying how long for`).toBeGreaterThan(0);
      for (const duration of durations) expect(duration, `${place} moves at its own speed`).toBe('120ms');
    }
    // A row of a table is the fourth, and it is a rule of its own.
    expect(rule('.table tbody tr')?.body).toContain('transition: background 120ms ease');
    // Reduced motion needs no guard here: the sheet already zeroes every
    // transition at once, and these rules are ordinary transitions.
    expect(sheet.filter((candidate) => candidate.media.includes('prefers-reduced-motion')).length).toBeGreaterThan(0);
  });
});

/**
 * A conversation is with a man, and he is on the page.
 *
 * The inbox and the transfer conversation are the two screens where the game is
 * something a manager *says* rather than something he reads, and both used to be
 * made of names: a heading, a list of sentences, and nothing on the page to say
 * the sentences had come out of anybody. Everybody in the game is drawn now, so a
 * thread with a man is headed with him and every line carries the face of whoever
 * said it. That is what makes talking to a man look like talking to a man rather
 * than like reading a transcript.
 *
 * What is pinned here is the rule and not the look: whose sentence gets a face
 * beside it, and that the face belongs to the man who said the words. The sizes,
 * the spacing and the colours are the sheet's business and are pinned there.
 */
describe('a conversation is with a man, and he is drawn in it', () => {
  const sheet = rules('styles.css');
  const rule = (selector: string) =>
    sheet.find((candidate) => candidate.selector.trim() === selector && candidate.media === '');

  /** The squad, in the order the club holds them, which is where these tests pick men from. */
  const squad = (state: ReturnType<typeof createTestGame>['state']): Person[] =>
    state.clubs[state.userClubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);

  /**
   * One man, drawn, at the size a thread gives him.
   *
   * `outfitFor(null, …)` for the same reason `Portrait.test.ts` reaches for
   * `PortraitArt` rather than `Portrait`: a component that reads the career cannot
   * be rendered here at all — a server render is handed zustand's *initial* state,
   * so the store holds no game and every man would come out plain. The face is
   * what is drawn either way, and the face is what this test is about.
   */
  const drawn = (person: Person, detail: 0 | 1 | 2 = 0) =>
    renderToStaticMarkup(
      createElement(PortraitArt, { plan: facePlan(person), outfit: outfitFor(null, person), detail }),
    );

  const log = (state: ReturnType<typeof createTestGame>['state'], conversationId: string) =>
    renderToStaticMarkup(
      createElement(MessageLog, {
        game: state,
        messages: threadMessages(state, conversationId),
        emptyCopy: 'Nothing here.',
      }),
    );

  it('draws the man beside his own sentence, and nobody beside the manager’s', () => {
    const game = createTestGame('thread-draws-the-man');
    const kev = squad(game.state)[0]!;
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Are we all right for Sunday?' });
    // Held back rather than delivered, so the thread is exactly two lines: his,
    // and the manager's answer to it.
    sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_AVAILABILITY',
      targetId: kev.id,
      body: 'Just checking.',
      deliver: false,
    });

    const bubbles = log(game.state, conversation.id).split('<article').slice(1);
    expect(bubbles).toHaveLength(2);
    // His sentence wears his face, and the drawing is *him* rather than a shape
    // that stands in for whoever wrote.
    expect(bubbles[0]).not.toContain('bubble--mine');
    expect(bubbles[0]).toContain('class="bubble__face"');
    expect(bubbles[0]).toContain(drawn(kev));
    // The manager is reading. He is a person in the save like everybody else, so
    // what keeps his own picture off his own sentence is the direction of the
    // message and not whether the game can draw him.
    expect(bubbles[1]).toContain('bubble--mine');
    expect(bubbles[1]).not.toContain('bubble__face');
    // And his words are still there, in the same place — just without the face.
    expect(bubbles[1]).toContain('class="bubble__words"');
    expect(bubbles[1]).toContain('Just checking.');
  });

  it('gives every man in a room his own face rather than one face for the room', () => {
    const game = createTestGame('thread-two-faces');
    const [a, b] = squad(game.state);
    const group = threadWithGroup(game.state, [a!.id, b!.id], 'group', 'The squad');
    sendFromPerson(game.state, group.id, a!.id, { body: 'Coming Thursday.' });
    sendFromPerson(game.state, group.id, b!.id, { body: 'Can’t make it, working.' });

    // Two men are two drawings; if they were one drawing the rest of this would
    // prove nothing, so it is said out loud first.
    expect(drawn(a!)).not.toBe(drawn(b!));
    // "Who said that" is genuinely ambiguous in a room, which is exactly why the
    // face is worth the ink there: each line carries the man who said it.
    const bubbles = log(game.state, group.id).split('<article').slice(1);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toContain(drawn(a!));
    expect(bubbles[0]).not.toContain(drawn(b!));
    expect(bubbles[1]).toContain(drawn(b!));
    expect(bubbles[1]).not.toContain(drawn(a!));
  });

  it('draws the man on the row in the list, and nobody on a room full of people', () => {
    const game = createTestGame('inbox-rows-draw-people');
    const [a, b] = squad(game.state);
    const one = threadWith(game.state, a!.id);
    const group = threadWithGroup(game.state, [a!.id, b!.id], 'group', 'The squad');
    const rows = inboxRows(game.state);
    const person = rows.find((candidate) => candidate.conversationId === one.id)!;
    const room = rows.find((candidate) => candidate.conversationId === group.id)!;

    // The list is where a manager finds a conversation, so it is where he
    // recognises the man: the row carries the same drawing the thread it opens is
    // headed with, and the name is still printed beside it.
    const drawnRow = renderToStaticMarkup(createElement(Row, { row: person, open: false }));
    expect(drawnRow).toContain('class="portrait portrait--md"');
    expect(drawnRow).toContain(drawn(a!, 1));
    expect(drawnRow).toContain('inbox__row-name');
    // Nobody for a room full of people: there is no single face to put on the row,
    // and putting one of them there would be claiming the thread is about him.
    const drawnRoom = renderToStaticMarkup(createElement(Row, { row: room, open: false }));
    expect(drawnRoom).not.toContain('portrait');
    expect(drawnRoom).toContain('The squad');
  });

  it('sizes the row’s face in the sheet, at the box the squad table draws him in', () => {
    // The size belongs to the list and not to the drawing, because only the list
    // knows how tall its rows are — and a rule that sizes a man may not repaint
    // him. He is not drawn at `sm`: that reduction belongs to a message bubble, and
    // this is where the manager finds the same man again.
    const sized = rule('.inbox__row .portrait')?.body ?? '';
    expect(sized).toContain('width: 28px');
    expect(sized).toContain('height: 32px');
    expect(sized).not.toContain('background');
    // Beside the name rather than above it, which is how it is centred on the two
    // lines the row is made of.
    expect(rule('.inbox__row')?.body).toContain('align-items: center');
  });

  it('heads a thread with the one man it is with', () => {
    // Which face a header gets is worked out by `threadFace`, which is a rule and
    // is tested as one in `inboxState.test.ts`. What is pinned here is that the
    // screen asks it, and draws the answer at the size a header gives a man.
    const inbox = source('views/InboxView.tsx');
    expect(inbox).toContain('threadFace(game, conversation)');
    expect(inbox).toContain('<Portrait person={face} size="md" />');
    expect(inbox).toContain('<Portrait person={sender} size="sm" />');
    // The face is added to the words, not swapped for them: a man the save has
    // forgotten still gets his name printed above his sentence.
    expect(inbox).toContain('{!message.mine && <p className="bubble__from">');
    expect(rule('.inbox__thread-face')?.body).toContain('flex: none');
  });

  it('opens the conversation on the man, in the dialog that talks terms with him', () => {
    const modal = source('components/NegotiationModal.tsx');
    // His face at the head of the transcript, and his own face on the lines that
    // are his — which is the same treatment a message gets in the inbox.
    expect(modal).toContain('<Portrait person={person} size="lg" />');
    expect(modal).toContain('<Portrait person={person} size="sm" />');
    expect(modal).toContain('negotiation__man');
    // `lg`, and not the profile's `xl`: this is not his page. The page about him
    // is a dialog away, and what is read here is a conversation with him.
    expect(modal).not.toContain('<Portrait person={person} size="xl" />');
    // The opening line is the game talking rather than him, so it is the one
    // bubble in there that has no face beside it.
    expect(modal).toContain('Nothing has been said yet.');
    // Him and his name, ruled off from the transcript beneath: structure is a
    // rule, not a box.
    expect(rule('.negotiation__man')?.body).toContain('display: flex');
    expect(rule('.negotiation__man')?.body).toContain('border-bottom: 1px solid var(--line-soft)');
  });

  it('draws the man and keeps the name, in the markup a browser is given', () => {
    const game = createTestGame('person-line');
    const kev = squad(game.state)[0]!;
    // The pure core, because the component that looks the man up reads the career
    // and a server render is handed zustand's initial state — see `PersonLine`.
    const html = renderToStaticMarkup(createElement(PersonLineArt, { person: kev }));
    expect(html).toContain('class="person-line"');
    expect(html).toContain('class="portrait portrait--md"');
    expect(html).toContain(
      renderToStaticMarkup(
        createElement(PortraitArt, { plan: facePlan(kev), outfit: outfitFor(null, kev), detail: 1 }),
      ),
    );
    // The words are still the man's name, and still the door to his page. His
    // name is checked as it is drawn rather than as it is held, because React
    // escapes the quotes around a nickname on the way into the markup.
    expect(html).toContain(renderToStaticMarkup(createElement('span', null, personDisplayName(kev))).slice(6, -7));
    expect(html).toContain('playerlink');
  });

  it('is still a name when there is nobody to draw', () => {
    // A save can hold a message, a record or a squad place for a man it no longer
    // holds, and a face cannot be invented for him: the line falls back to exactly
    // the link the name has always been.
    const html = renderToStaticMarkup(createElement(PersonLine, { personId: 'nobody_at_all' }));
    expect(html).toContain('playerlink');
    expect(html).not.toContain('portrait');
    expect(html).not.toContain('person-line');
  });

  it('sizes the man on a line in the sheet, and cuts his name rather than push him out', () => {
    // Size belongs to the list, as it does everywhere else, and a long surname in
    // a flex row has to be cut with an ellipsis rather than squeezing the man out
    // of his own cell — which is what a flex item does by default.
    const layout = rule('.person-identity, .person-line')?.body ?? '';
    expect(layout).toContain('display: flex');
    expect(layout).toContain('align-items: center');
    const sized = rule('.person-line .portrait')?.body ?? '';
    expect(sized).toContain('width: 28px');
    expect(sized).toContain('height: 32px');
    expect(sized).not.toContain('background');
    const name = rule('.person-line > .playerlink')?.body ?? '';
    expect(name).toContain('min-width: 0');
    expect(name).toContain('text-overflow: ellipsis');
    // A search result is drawn and not linked, because the row is already a button.
    expect(rule('.searchresults__item .portrait')?.body).toContain('width: 28px');
  });

  it('makes a bubble a face and its words, in both places a bubble is drawn', () => {
    // One message, two screens: the inbox thread and the transfer conversation.
    // Both are the same shape — a face on the left, the words taking the rest —
    // because both are a person saying something.
    const bubbles = sheet.filter(
      (candidate) => candidate.selector.trim() === '.bubble' && candidate.media === '',
    );
    const defined = bubbles.filter((bubble) => bubble.body.includes('background: var(--panel)'));
    expect(defined, 'expected a bubble in the inbox and one in the negotiation').toHaveLength(2);
    for (const bubble of defined) {
      expect(bubble.body).toContain('display: flex');
      expect(bubble.body).toContain('align-items: flex-start');
    }
    // Nothing further down the sheet turns that row back into a block.
    for (const bubble of bubbles) expect(bubble.body).not.toContain('display: block');
    // The drawing is sized by `.portrait` itself, so all the face's wrapper does is
    // stop a long message squeezing it.
    expect(rule('.bubble__face')?.body).toContain('flex: none');
    expect(rule('.bubble__face')?.body).not.toMatch(/width:|height:/);
    // And the words take what is left rather than overflowing the bubble.
    expect(rule('.bubble__words')?.body).toContain('flex: 1 1 auto');
    expect(rule('.bubble__words')?.body).toContain('min-width: 0');
  });
});

/**
 * The audit: a list of people is drawn, and a sentence is not.
 *
 * The pass that drew the squad, the staff and the inbox left the rest of the
 * game naming men — the record books, the subs book, the paper, a rival club's
 * page, a search result, the twelve names on the screen where a manager meets
 * the club he is about to take. This is the audit that closed it, and both
 * halves are worth pinning: every surface that *lists* people draws them, and
 * the surfaces that do not are the ones where a man is not being listed at all.
 */
describe('a list of people is drawn, and a sentence is not', () => {
  /** The surfaces that list people, and draw each one. */
  const DRAWN = [

    'components/PersonIdentity.tsx',
    'components/ProfileOverlay.tsx',
    'components/FixtureInfo.tsx',
    'components/FormationBoard.tsx',
    'components/Statistics.tsx',
    'views/FinancesView.tsx',
    'views/TrainingView.tsx',
    'views/ClubSelectView.tsx',
    'views/WorldView.tsx',
    'views/NewsView.tsx',
    'views/RecruitmentView.tsx',
  ];

  it('draws every man on every surface that lists people', () => {
    for (const file of DRAWN) {
      expect(source(file), `${file} still names men without drawing them`).toContain('PersonLine');
    }
    // And there is one line, defined once: a screen that wrote its own would be a
    // second answer to a question the game already answers in one place.
    for (const file of DRAWN.filter((name) => name !== 'components/PersonIdentity.tsx')) {
      expect(source(file), `${file} builds its own person line`).not.toContain('person-line');
    }
  });

  it('leaves a man as a word where he is not being listed', () => {

    // A table, a leaderboard, a roster, a search result: those are lists, and a
    // man in one is drawn. These are not lists. A pitch represents a man by where
    // he stands and by the shirt he is already wearing; the matchday drawers are
    // read at speed over a live match; and a scorer's name is a word inside a
    // sentence about a goal. The board is drawn in its own list above, because a
    // list of the eleven is a list of men.
    for (const file of [
      'match/MatchControls.tsx',
      'match/TeamSheet.tsx',
      'match/MatchPhases.tsx',
    ]) {

      expect(source(file), `${file} draws a face on the board`).not.toMatch(/<Portrait|PersonLine/);
    }
  });

  it('draws the men in the list a side is picked from', () => {
    // The one list in the game that is both a read and a handle. A man is
    // dragged out of it onto a shirt, so it began as a row of words; but it is
    // also where the manager sees who is in the side and where, which is the
    // question the squad screen answers with a portrait and four facts. The
    // moment that became this list's job, its row became a row of the squad.
    const view = source('views/TeamSelectionView.tsx');
    expect(view).toContain('<PersonIdentity');
    // And with the squad screen's own facts in it, in its own words: two
    // spellings of "how fit is he" is one spelling too many.
    for (const fact of ['Pos', 'Fitness', 'Form', 'Morale', 'Availability']) {
      expect(view, `the selection list says nothing about ${fact}`).toContain(`data-label="${fact}"`);
    }
  });

  it('puts what a row has to say on the line his face is on', () => {
    // Two rows in the game are a man, and then a sentence about him: the work he
    // is coming on for, and why he cannot play. Both are rows rather than blocks,
    // so the sentence stays beside the face instead of dropping underneath it and
    // leaving the drawing on a line of its own.
    expect(source('views/TrainingView.tsx')).toContain('<li key={entry.player.id} className="row row--wrap">');
    expect(source('components/FixtureInfo.tsx')).toContain('<li key={player.id} className="row row--wrap">');
  });
});

/**
 * One man in this game picks his own face, and this is where he is offered it.
 *
 * He is the one person whose name the player types, which is why the roll is seeded
 * with the name rather than the id, and it is also why the panel is worth having:
 * every other face in the world is a fact about a man, and his is the one he has to
 * look at every week — on his own page, in a thread, on the club's list of who runs
 * it. What is pinned here is where the control is offered and how it is wired to the
 * career. What it draws is pinned in `face.test.ts` and
 * `components/FaceDesigner.test.ts`.
 */
describe('the manager picks his own face', () => {
  const sheet = rules('styles.css');
  const rule = (selector: string) =>
    sheet.find((candidate) => candidate.selector.trim() === selector && candidate.media === '');

  it('offers it on the setup screen, before there is a career to put him in', () => {
    const view = source('views/ProfileView.tsx');
    expect(view).toContain('<FaceDesigner');
    expect(view).toContain('onChange={(face) => update({ face })}');
    // It opens on the face his name already draws, so this is a way of *changing* a
    // face rather than of building one out of nothing, and nothing is written into
    // the profile until he touches a row.
    expect(view).toContain('choices={profile.face ?? rolledFaceChoices(subject)}');
    expect(view).toContain('firstName: profile.firstName.trim()');
    // The face is one of the things the screen gathers, so it sits beside the
    // details rather than at the foot of the page under the world seed.
    expect(view.indexOf('<Panel title="Your face">')).toBeLessThan(view.indexOf('<Panel title="The world">'));
  });

  it('offers it on his own page afterwards, changing the career he is in', () => {
    const view = source('views/ManagerView.tsx');
    expect(view).toContain('<FaceDesigner');
    // The man the header draws is the subject, so the panel and the page above it
    // cannot disagree about whose face is being changed.
    expect(view).toContain('subject={official}');
    expect(view).toContain('gameActions().setManagerFace(face)');
    expect(view).toContain('onReset={official.face ? () => gameActions().setManagerFace(null) : undefined}');
  });

  it('keeps the face on the man, not on the browser that picked it', () => {
    // Both halves of the store action are exercised in `gameStore.test.ts`. What is
    // pinned here is why there are two: the person is what every screen draws — a
    // portrait, a message row, a club's list of who runs it — and the profile is
    // what a saved profile remembers. A face written only to the profile would be a
    // face no screen in the game could see.
    const store = readFileSync('src/state/gameStore.ts', 'utf8');
    expect(store).toContain('setManagerFace: (face) => {');
    expect(store).toContain('state.people[MANAGER_PERSON_ID]');
    expect(store).toContain('delete manager.face');
  });

  it('draws the preview in the box the profile gives a portrait', () => {
    // The same drawing at the same size as his own page. A preview in some other
    // box, or from some other plan, is a preview that can lie — and a face is one of
    // the few things a manager notices being lied to about.
    expect(rule('.facedesigner')?.body).toContain('display: grid');
    expect(rule('.facedesigner__preview > .portrait')?.body).toContain('grid-row: 1 / span 2');
    // Structure is a rule: the preview is ruled off from the rows beneath it.
    expect(rule('.facedesigner__preview')?.body).toContain('border-bottom: 1px solid var(--line)');
    // Twelve option groups each drawing three rules would be a comb, so inside the
    // designer a row keeps exactly one — the group's own.
    expect(rule('.facedesigner__rows .subhead')?.body).toContain('border-bottom: none');
    expect(rule('.facedesigner__rows .segmented')?.body).toContain('border-bottom: none');
    // One corner, one size: the colour chip is a chip.
    expect(rule('.facedesigner__dot')?.body).toContain('border-radius: var(--radius-pill)');
  });

  it('is a panel on two screens, and not a place in the navigation', () => {
    // A manager changes his own face about once. A permanent sidebar entry for it
    // would be a permanent invitation to fiddle with it.
    expect(source('navigation.ts')).not.toContain("id: 'face'");
  });
});

/**
 * The two sheets down either side of the pitch wear the shirts of the men on them.
 *
 * A teamsheet is a list of footballers and a footballer is a shirt: whose he is,
 * and — the one thing about the eleven a manager looks for rather than reads —
 * which of them is the man in goal. The strip a side turned out in was already the
 * sheet's own colour; it was drawn as a three pixel rule above the club's name and
 * nowhere else, so the list under it said nothing about what the men in it were
 * wearing and the keeper was marked as the keeper on the pitch and nowhere beside
 * it. What is pinned here is where those colours come from and how the sheet is
 * painted; what it renders is pinned in `match/teamsheet.test.ts`.
 */
describe('the team sheets wear the shirts', () => {
  const sheet = rules('styles.css');
  const rule = (selector: string) =>
    sheet.find((candidate) => candidate.selector.trim() === selector && candidate.media === '');

  it('heads each sheet in the strip its side turned out in', () => {
    // Edge to edge and flat, because the club's name is read on it: the head is the
    // shirt rather than a tint of the panel, and the ink is one measured for that
    // colour rather than the page's own text colour. A side in a white away strip
    // is therefore headed in white with a name that reads on white.
    expect(rule('.teamsheet__head')?.body).toContain('background: var(--sheet-colour');
    expect(rule('.teamsheet__head')?.body).toContain('color: var(--sheet-ink');
    expect(rule('.teamsheet__head')?.body).not.toContain('gradient');
    expect(rule('.teamsheet__club')?.body).toContain('color: inherit');
  });

  it('puts a shirt down every row, with the ten left to the sheet’s own strip', () => {
    // The same division the formation board draws the eleven with: the side's strip
    // is the stylesheet's business, and the one shirt that is not the side's own is
    // painted in the markup.
    expect(rule('.teamsheet__shirt')?.body).toContain('background: var(--sheet-colour');
    expect(rule('.teamsheet__shirt')?.body).toContain('align-self: stretch');
    expect(rule('.teamsheet__shirt')?.body).not.toContain('--club');
    // A bar and not a box: one corner, the small one.
    expect(rule('.teamsheet__shirt')?.body).toContain('border-radius: var(--radius-sm)');
  });

  it('mirrors the away sheet, shirt and all', () => {
    // The two sheets face the pitch, so the away one is the home one reversed —
    // and the shirt belongs on the far edge with the position code, or the two
    // sheets would be mirror images of each other's words and identical in their
    // colour.
    expect(rule('.teamsheet__row')?.body).toContain('grid-template-columns: 3px 26px minmax(0, 1fr) auto');
    expect(rule('.teamsheet--away .teamsheet__row')?.body).toContain(
      'grid-template-columns: auto minmax(0, 1fr) 26px 3px',
    );
    expect(rule('.teamsheet--away .teamsheet__shirt')?.body).toContain('order: 4');
  });

  it('hands both sheets the colours the pitch beside them is drawn from', () => {
    // One reading of the strips for the picture and the list. A sheet that went to
    // the career for the kits itself could come to disagree with the pitch about
    // which shirt a side is in, and the keeper's third strip is precisely the case
    // where a second reading goes wrong — a side whose away shirt is white still
    // has a keeper who is not.
    const view = source('views/MatchView.tsx');
    expect(view).toContain('colours={renderState.teams.home.colours}');
    expect(view).toContain('colours={renderState.teams.away.colours}');
    // And they are not the club's own colours: the away sheet is handed the away
    // strip and both sheets are handed a third strip for the man in goal.
    expect(view).not.toContain("colour={kitColours?.home ?? '#888888'}");
    // And the colours themselves are the whole answer — the strip each side turned
    // out in, with a third strip for each keeper — read once by `matchTeamColours`
    // rather than spelled out here as a spread of `matchKitColours` beside a second
    // reading for the keepers, which is what three views doing it themselves comes
    // to.
    expect(view).toContain('colours: strips.home');
    expect(view).toContain('colours: strips.away');
    expect(view).toContain('matchTeamColours(game, match.homeClubId, match.awayClubId)');

    // The rule itself is written once, in `match/shirt.ts`, and asked by the dots
    // on the pitch and the rows of both sheets. Three call sites, one answer.
    expect(source('match/shirt.ts')).toContain('isKeeper(position) ? colours.keeper : colours.primary');
    expect(source('match/MatchPitch.tsx')).toContain('shirtFor(state.teams[node.side].colours, node.position)');
    expect(source('match/TeamSheet.tsx')).toContain('shirtFor(colours, position)');
    expect(source('match/TeamSheet.tsx')).toContain('isKeeper(position)');
  });

  it('stands the same sheets beside the replay of an afternoon and in the report on it', () => {
    // A match is put in front of the manager on three screens — while it is being
    // played, when it is watched back, and in the report — and all three stand the
    // same two lists down the sides of it, in the shirts the sides turned out in.
    // They ask one function for those shirts rather than reading the kits each in
    // its own way, because a second reading is how a replay ends up in the clubs'
    // own colours and a report in a third strip somebody guessed at.
    for (const view of ['views/MatchView.tsx', 'views/ReplayView.tsx', 'components/FixtureInfo.tsx']) {
      expect(source(view), `${view}: reads the strips for itself`).toContain('matchTeamColours(');
    }

    const replay = source('views/ReplayView.tsx');
    expect(replay.match(/<TeamSheet/g), 'the replay stands two sheets').toHaveLength(2);
    expect(replay.match(/colours=\{renderState\.teams\.(home|away)\.colours\}/g)).toHaveLength(2);
    // A replay must not spoil its own ending, so its sheets carry no goals or
    // bookings: the afternoon arrives in the commentary line under the pitch, at
    // the minute it happened, and not in a list that already knows the result.
    expect(replay.match(/marks=\{false\}/g), 'the replay leaves the marks off').toHaveLength(2);
    expect(source('match/TeamSheet.tsx')).toContain('marks = true');
    expect(source('match/TeamSheet.tsx')).toContain('marks ? match.performances[slot.playerId] : undefined');
    // And the pitch it stands between them is dressed in those same shirts: the
    // record's own colours are the two clubs', not what they turned out in.
    expect(replay).toContain('colours: strips.home');
    expect(replay).toContain('colours: strips.away');

    const report = source('components/FixtureInfo.tsx');
    expect(report.match(/<TeamSheet/g), 'the report carries both elevens').toHaveLength(2);
    expect(report).toContain('matchTeamColours(state, match.homeClubId, match.awayClubId)');
    // Both of them, and only when both were actually picked: a fixture settled on
    // a forfeit has no eleven to list.
    expect(report).toContain(
      'match.lineups.home.starting.length > 0 && match.lineups.away.starting.length > 0 && (',
    );
  });
});

describe('the fixture sheet: one fact a screen, set at a size of its own', () => {
  const css = source('styles.css');
  const card = source('components/FixtureCard.tsx');

  it('prints a fixture as a sheet rather than a row of labelled facts', () => {
    // The competition across the club's own band, the two clubs at the size of a
    // name, the score at the size of a score, and the conditions as the small print
    // along the foot under a rule.
    for (const part of ['fixture-card__stamp', 'fixture-card__days', 'fixture-card__score', 'fixture-card__conditions']) {
      expect(card, part).toContain(part);
    }
    // Every line of it is a field the fixture already carried — nothing is invented
    // to make the board look busy, which is the difference between a fixture sheet
    // and a dashboard.
    for (const field of ['PITCH_LABEL', 'WEATHER_LABEL', 'formatKickOff', 'matchVenueLabel', 'ground.capacity']) {
      expect(card, field).toContain(field);
    }
    // And the band is the shell's own band, not a second club colour invented here,
    // with a plain surface behind it for the one case of a board drawn with no club
    // around it to take the band from.
    expect(css).toMatch(/\.fixture-card__stamp \{[^}]*background: var\(--club-band, var\(--panel-3\)\)/s);
  });

  it('names our own half of the board in the ink the club reads best', () => {
    expect(card).toContain('fixture-card__side--ours');
    expect(css).toContain('.fixture-card__side--ours, .fixture-card__side--ours a { color: var(--club-text); }');
  });

  it('uses that one board wherever a fixture is drawn', () => {
    for (const view of ['components/FixtureInfo.tsx', 'views/CupView.tsx', 'views/DashboardView.tsx']) {
      expect(source(view), view).toContain('<FixtureCard');
    }
  });

  it('has one display size and one letterpress, rather than a size per screen', () => {
    // The token is declared once as the base and once per room, and nowhere else:
    // a screen that wants a bigger number asks the room it is in.
    expect(css.match(/--fs-display: /g)?.length).toBe(6);
    expect(css).toContain('--tracking-letterpress: 0.11em');
    expect(css).toMatch(/\.focal-fact__value \{[^}]*font-size: var\(--fs-display\)/s);
    // The letterpress is the same small-caps line the shell's fixture band already
    // wears, written down once so a screen cannot drift from the shell.
    expect(css).toMatch(/\.letterpress \{[^}]*text-transform: uppercase/s);
    expect(css).toMatch(/\.letterpress \{[^}]*letter-spacing: var\(--tracking-letterpress\)/s);
  });

  it('spends the display size on the three screens whose fact is a number', () => {
    for (const view of ['views/LeagueView.tsx', 'views/FinancesView.tsx', 'views/TrainingView.tsx']) {
      expect(source(view), view).toContain('<FocalFact');
    }
    // And not on the screens whose fact is a picture, a list or a person.
    for (const view of ['views/SquadView.tsx', 'views/TacticsView.tsx', 'views/NewsView.tsx']) {
      expect(source(view), view).not.toContain('<FocalFact');
    }
  });

  it('sets the football and season rooms apart from the rest in type', () => {
    // Scoped to a window with room for it: a phone has one column and one size.
    const block = css.slice(css.indexOf('--- C ·'));
    expect(block).toContain('@media (min-width: 861px)');
    expect(block).toContain(".app__main[data-archetype='football'] .page-head__subtitle");
    expect(block).toContain('font-size: 1.75rem');
  });

  it('rules the squad list off in team-sheet lines, but only in team order', () => {
    const view = source('views/SquadView.tsx');
    expect(view).toContain('BAND_LABEL');
    expect(view).toContain('squad-band');
    // Sorted by goals the lines would lie about the list, so they are not drawn.
    expect(view).toContain("const banded = !sort.key || sort.key === 'pos';");
    expect(css).toMatch(/\.squad-band th \{[^}]*letter-spacing: var\(--tracking-letterpress\)/s);
  });

  it('prints a month of fixtures as a page of a fixture list', () => {
    const view = source('views/FixturesView.tsx');
    expect(view).toContain('fixture-month');
    expect(css).toMatch(/\.fixture-month > summary \{[^}]*text-transform: uppercase/s);
    // And the month that holds the next game is painted with the season's edge.
    expect(css).toMatch(
      /\.app__main\[data-archetype='competition'\] \.panel--level-primary \{ border-left: 2px solid var\(--club\); \}/,
    );
  });

  it('says what this week is under the tactics board', () => {
    const view = source('views/TacticsView.tsx');
    expect(view).toContain('tactics-caption');
    // Who, where, when and in what: the conditions the instructions are answering.
    expect(view).toContain('PITCH_LABEL[fixture.conditions.pitch]');
    expect(view).toContain('WEATHER_LABEL[fixture.conditions.weather]');
    expect(view).toContain('matchOpponent');
  });

  it('keeps the board readable on a phone rather than collapsing it', () => {
    expect(css).toMatch(/\.fixture-card__side \{ flex-direction: column; font-size: var\(--fs-lg\)/);
    expect(css).toMatch(/\.fixture-card__score \{ font-size: var\(--fs-2xl\); \}/);
  });
});
