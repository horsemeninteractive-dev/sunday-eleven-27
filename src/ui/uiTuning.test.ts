import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { isPlayer, type Player } from '@/domain/person';
import { POSITIONS } from '@/domain/positions';
import { useGameStore } from '@/state/gameStore';
import { WARM_UP_ORDER, warmUpEnergyDelta, warmUpFamiliarityDelta } from '@/simulation/match/preparation';
import { createTestGame } from '@/simulation/testSupport';
import { gameActions } from './hooks';
import { clubMatters } from './clubMatters';
import { inPreSeason, kitChosenForSeason, kitDecisionOutstanding } from './kit';
import { PositionMap, positionBands } from './components/PositionMap';
import { warmUpEffects } from './match/MatchPhases';
import { nextRecruitmentStep } from './views/RecruitmentView';
import { contrastRatio } from './colour';

/**
 * The pieces of UI tuning, and the reported polish items that followed them:
 * checked where they can be checked without a browser — the rules in the
 * stylesheet, the wiring in the views, and the arithmetic the screens read from
 * the simulation rather than restating.
 */

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Strip CSS comments so an assertion cannot be satisfied by prose. */
function css(path: string): string {
  return source(path).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the sidebar lines up', () => {
  const sheet = css('src/ui/styles.css');

  function rule(selector: string): string {
    const start = sheet.indexOf(`.${selector} {`);
    expect(start, `no rule for .${selector}`).toBeGreaterThan(-1);
    return sheet.slice(start, sheet.indexOf('}', start));
  }

  it('gives a section heading the same left padding as the screens inside it', () => {
    // Two different paddings is what put the icons in two columns and made the
    // headings look like a separate list.
    expect(rule('sidenav__toggle')).toContain('padding: 10px var(--s3) 10px var(--s4)');
    expect(rule('sidenav__item')).toContain('padding: 8px var(--s3) 8px var(--s4)');
  });

  it('gives a section heading the same type size as the screens inside it', () => {
    expect(rule('sidenav__toggle')).toContain('font-size: var(--fs-base)');
    expect(rule('sidenav__item')).toContain('font-size: var(--fs-base)');
  });

  it('reserves the same left rule on both, so the content boxes line up', () => {
    // The screens below carry a 2px active rule; without it on the heading the
    // heading's icon sat 2px left of every other icon in the sidebar.
    expect(rule('sidenav__item')).toContain('border-left: 2px solid transparent');
    expect(rule('sidenav__toggle')).toContain('border-left: 2px solid transparent');
  });

  it('draws both icons at the same size', () => {
    expect(rule('sidenav__toggle .glyph')).toContain('width: 15px');
    expect(rule('sidenav__item .glyph')).toContain('width: 15px');
  });
});

describe('club selection is one division at a time', () => {
  const view = source('src/ui/views/ClubSelectView.tsx');

  it('offers a division tabstrip, the way the league table does', () => {
    expect(view).toContain('role="tablist"');
    expect(view).toContain('aria-label="Divisions"');
    expect(view).toContain('segmented__item');
  });

  it('renders the clubs of the selected division only', () => {
    // The old shape mapped every division into a stack of panels, which is the
    // "full list of all clubs from every division" this replaces.
    expect(view).toContain('visible.clubs.map');
    expect(view).not.toContain('divisions.map((division) => (\n            <Panel');
  });

  it('keeps the whole ladder reachable', () => {
    // The header still says how big the ladder is, so the tabstrip does not
    // read as "these twelve are all there is".
    expect(view).toContain('local clubs in');
    expect(view).toContain('divisions.length === 1');
    expect(view).toContain('divisions.length > 1');
  });
});

describe('the two big buttons live in the header', () => {
  it('puts "Generate world" beside "Back to menu", not at the bottom of the form', () => {
    const view = source('src/ui/views/ProfileView.tsx');
    const header = view.slice(view.indexOf('<PageHeader'), view.indexOf('</PageHeader>'));
    expect(header).toContain('Generate world');
    expect(header).toContain('Back to menu');
    // And it is gone from where it was.
    expect(view.split('Generate world').length - 1).toBe(2); // the label and the ternary
  });

  it('disables "Generate world" until the profile is actually complete', () => {
    const view = source('src/ui/views/ProfileView.tsx');
    expect(view).toContain('disabled={!ready}');
    // One source of truth: the same three checks the button and `begin` make.
    expect(view).toMatch(/const ready =[\s\S]*isManagerProfileComplete\(profile\)/);
  });

  it('puts "Take charge" beside "Back" on the club select screen', () => {
    const view = source('src/ui/views/ClubSelectView.tsx');
    const header = view.slice(view.indexOf('<PageHeader'), view.indexOf('</PageHeader>'));
    expect(header).toContain('Take charge of');
    expect(header).toContain('Back');
    // Not also at the bottom of the detail panel, where it used to be.
    const detail = view.slice(view.indexOf('club-select__detail'));
    expect(detail).not.toContain('chooseClub');
    expect(detail).not.toContain('Take charge of');
  });

  it('will not offer to take charge of nothing', () => {
    const view = source('src/ui/views/ClubSelectView.tsx');
    expect(view).toContain('disabled={!selectedClub}');
  });
});

describe('the clock has exactly two hands', () => {
  /** Every UI source that is not a test, so a new hand on the clock shows up. */
  function uiSources(folder: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) found.push(...uiSources(path));
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) found.push(path);
    }
    return found;
  }

  it('lets only the command bar and the calendar move time', () => {
    // Continue and the calendar. Anything else that can reach the clock is a
    // third way to lose a day, and a manager who has not chosen to lose it.
    const movers = uiSources('src/ui')
      .filter((file) => /advanceDays|jumpToDate|continueGame/.test(source(file)))
      .sort();
    expect(movers).toEqual(['src/ui/commandActions.ts', 'src/ui/components/PlannerModal.tsx']);
  });

  it('keeps a shortcut to the match off the calendar and off the team sheet', () => {
    // The calendar is the clock, so it moves the clock; it does not also start
    // the match. The side is picked and the match is played from the command
    // bar's own action once the day arrives.
    const planner = source('src/ui/components/PlannerModal.tsx');
    expect(planner).not.toContain('Go to the match');
    expect(planner).not.toContain('startUserMatch');
    expect(planner).toContain('Go to this day');

    const view = source('src/ui/views/TeamSelectionView.tsx');
    expect(view).not.toContain('Go to the match');
    expect(view).not.toContain('startUserMatch');
  });
});

describe('the kit is a pre-season decision', () => {
  it('is offered before a season, once the shirts arrive', () => {
    const game = createTestGame('kit-preseason');
    delete game.state.clubs[game.clubId]!.kitSeason;
    delete game.state.clubs[game.clubId]!.kitChoice;
    // A career opens six weeks before the first league game, and `phase` is
    // already 'season' by then, so the calendar is what has to be consulted.
    expect(game.state.phase).toBe('season');
    expect(inPreSeason(game.state)).toBe(true);
    expect(kitDecisionOutstanding(game.state, game.clubId)).toBe(true);
  });

  it('stops being offered the moment a kit is confirmed', () => {
    const game = createTestGame('kit-chosen');
    useGameStore.setState({ game: game.state });

    // Confirming the *first* design is the case that used to settle nothing,
    // because the club was already wearing it and the action bailed out.
    gameActions().chooseKit(0);

    const club = game.state.clubs[game.clubId]!;
    const after = useGameStore.getState().game!;
    expect(after.clubs[game.clubId]!.kitSeason).toBe(after.season.label);
    expect(kitDecisionOutstanding(after, game.clubId)).toBe(false);
    expect(club.kitChoice ?? 0).toBe(0);
  });

  it('comes back at the next pre-season without anything resetting it', () => {
    const game = createTestGame('kit-next');
    useGameStore.setState({ game: game.state });
    gameActions().chooseKit(2);

    const settled = useGameStore.getState().game!;
    expect(kitDecisionOutstanding(settled, game.clubId)).toBe(false);

    // A new pre-season: a new label, so the shirts are new again and the club's
    // last July says nothing about this one.
    const next = structuredClone(settled);
    next.season = { ...next.season, id: 's2', label: '2027/28' };
    expect(kitChosenForSeason(next.clubs[game.clubId]!, next.season.label)).toBe(false);
    expect(kitDecisionOutstanding(next, game.clubId)).toBe(true);

    useGameStore.setState({ game: game.state });
  });

  it('is not offered during the season, chosen or not', () => {
    const game = createTestGame('kit-season');
    const mid = structuredClone(game.state);
    // Kick-off day: the shirts were settled before then or not at all.
    mid.date = mid.season.calendar[0]!.date;
    delete mid.clubs[game.clubId]!.kitSeason;
    delete mid.clubs[game.clubId]!.kitChoice;
    expect(inPreSeason(mid)).toBe(false);
    expect(kitDecisionOutstanding(mid, game.clubId)).toBe(false);
  });

  it('leaves an old save that already picked a kit alone', () => {
    const game = createTestGame('kit-legacy');
    const club = game.state.clubs[game.clubId]!;
    // No `kitSeason`, because the field did not exist: a club that picked a kit
    // before it did has already answered, and must not be prompted again.
    club.kitChoice = 1;
    delete club.kitSeason;
    expect(kitChosenForSeason(club, game.state.season.label)).toBe(true);
  });

  it('offers itself from the dashboard, and nowhere permanent', () => {
    // The prompt now comes out of the shared club-matters list that Home and
    // the Club screen both draw, so it is asserted where it is decided rather
    // than by searching the dashboard for a string it no longer needs to
    // contain. The behaviour is the same: it arrives on Home, in pre-season,
    // and it is not a place in the sidebar.
    const game = createTestGame('kit-dashboard');
    const prompt = clubMatters(game.state, 0).find((matter) => matter.id === 'kit');
    expect(prompt).toBeTruthy();
    expect(prompt!.destination).toEqual({ kind: 'view', view: 'kit' });

    // Home really does draw that list — now by reading the briefing that reads
    // it, which is where the reading of it is decided (`homeBriefing.ts`). The
    // assertion is on the wiring either way; that the briefing returns this very
    // model's own rows is `homeBriefing.test.ts`'s job.
    expect(source('src/ui/views/DashboardView.tsx')).toContain('homeBriefing(game)');

    // Still not a place in the navigation — that was the point of it.
    expect(source('src/ui/navigation.ts')).not.toContain("id: 'kit',");
  });
});

describe('the reported polish items', () => {
  const sheet = css('src/ui/styles.css');


  /** Every rule for a selector, in sheet order: a class with two lives has two. */
  function rules(selector: string): string[] {
    const found: string[] = [];
    let from = 0;
    for (;;) {
      const start = sheet.indexOf(`.${selector} {`, from);
      if (start === -1) return found;
      const end = sheet.indexOf('}', start);
      found.push(sheet.slice(start, end));
      from = end;
    }
  }

  function rule(selector: string): string {
    const [first] = rules(selector);
    expect(first, `no rule for .${selector}`).toBeDefined();
    return first!;
  }

  /** A token's value, so a declaration can be checked against what it names. */
  function token(name: string): string {
    const found = sheet.match(new RegExp(`${name}: (#[0-9a-f]{6})`, 'i'));
    expect(found, `no token ${name}`).toBeTruthy();
    return found![1]!;
  }

  function hexIn(declaration: string, property: string): string {
    const found = declaration.match(new RegExp(`${property}: (#[0-9a-f]{6})`, 'i'));
    expect(found, `no ${property} in:\n${declaration}`).toBeTruthy();
    return found![1]!;
  }

  it('fills the chosen team talk rather than edging it', () => {
    // A 1px edge in the club's colour was the whole of the selected state, and
    // on a row of six talks it left the manager reading borders to find the one
    // he had already picked.
    const chosen = rule('choice--on');
    expect(chosen).toContain('background: var(--club)');
    expect(chosen).toContain('color: var(--club-flat-ink)');

    // And it is stated again after the surfaces that would repaint it grey.
    const raw = source('src/ui/styles.css');
    const stateBlock = raw.slice(raw.indexOf('2. State is painted last'));
    expect(stateBlock).toContain('.choice--on');

    // On a chosen button the effect words take the fill's own ink: the status
    // tones were never chosen for a solid club fill.
    expect(sheet).toMatch(/\.choice--on \.choice__effect \{[^}]*color: var\(--club-flat-ink\)/s);

    const view = source('src/ui/match/MatchPhases.tsx');
    expect(view).toMatch(/session\.teamTalk === talk \? ' choice--on'/);
    expect(view).toMatch(/session\.warmUp === warmUp \? ' choice--on'/);
  });

  it('says what a warm-up costs and buys, from the numbers the simulation applies', () => {
    for (const warmUp of WARM_UP_ORDER) {
      const labels = warmUpEffects(warmUp).map((effect) => effect.label);
      const legs = warmUpEnergyDelta(warmUp);
      expect(labels.includes('Fresher legs'), `${warmUp} legs`).toBe(legs > 0);
      expect(labels.includes('Heavier legs'), `${warmUp} legs`).toBe(legs < 0);
      expect(labels.includes('Sharper shape'), `${warmUp} shape`).toBe(warmUpFamiliarityDelta(warmUp) > 0);
      expect(labels.length, `${warmUp} says nothing`).toBeGreaterThan(0);
    }

    // Four buttons saying the same thing would be no better than none: the
    // trade-offs have to differ, because that is the decision being asked for.
    const described = WARM_UP_ORDER.map((warmUp) =>
      warmUpEffects(warmUp).map((effect) => effect.label).join(' + '),
    );
    expect(new Set(described).size).toBeGreaterThan(1);

    // Drawn on the button itself, not in the paragraph underneath the row.
    const view = source('src/ui/match/MatchPhases.tsx');
    expect(view).toContain('warmUpEffects(warmUp)');
    expect(view).toContain('choice__effects');
  });

  it('makes a secondary action visible as a secondary action', () => {
    // "Look around" beside a filled "Kick off": a ghost button used to wear the
    // same hairline as every divider in the sheet, so it read as a patch of
    // background with words in it rather than as a control.
    const ghost = rules('btn--ghost').find((body) => body.includes('border-color:'));
    expect(ghost, 'the ghost edge is not stated anywhere').toBeDefined();
    const edge = hexIn(ghost!, 'border-color');
    const panel = token('--panel');
    const hairline = token('--line');
    expect(contrastRatio(edge, panel)).toBeGreaterThan(contrastRatio(hairline, panel) * 1.7);
    // Still nowhere near the fill a primary button carries, so the hierarchy it
    // exists to express is untouched.
    expect(contrastRatio(edge, panel)).toBeLessThan(4.5);
  });

  it('draws the same gauge and badge on every squad-need card', () => {
    const view = source('src/ui/views/RecruitmentView.tsx');
    // One badge and one bar per card, from one tone for both — so four cards
    // can be compared by looking along them.
    expect(view).toContain('need-gauge');
    expect(view).toContain('need-badge need-badge--${tone}');
    expect(view).toMatch(/const tone = needVerdictTone\(need\.verdict\)/);
    expect(view).toContain('aria-label={`${need.available} of ${need.registered} available this week`}');

    // A verdict is named in exactly one place, so the card cannot describe the
    // same number differently from the table under it.
    expect(view.match(/'Well covered'/g)).toHaveLength(1);
    expect(view.match(/'Light'/g)).toHaveLength(1);

    // The badge and the bar are styled for all three verdicts, including the
    // middle one, which must not be dressed as either of the other two.
    for (const tone of ['ok', 'warn', 'default']) {
      expect(sheet).toContain(`.need-badge--${tone}`);
    }
    expect(sheet).toMatch(/\.need-gauge \.meter \{[^}]*width: 100%/s);
  });

  it('points at the one thing left to do about the squad', () => {
    expect(nextRecruitmentStep({ asked: false, watched: false, sessionPutOn: false, awaitingSession: 0 })).toBe('ask');
    expect(nextRecruitmentStep({ asked: true, watched: false, sessionPutOn: false, awaitingSession: 0 })).toBe('five-a-side');
    expect(nextRecruitmentStep({ asked: true, watched: true, sessionPutOn: false, awaitingSession: 0 })).toBe('open-session');
    // Nothing left is nothing recommended: no door is painted as the next one.
    expect(nextRecruitmentStep({ asked: true, watched: true, sessionPutOn: true, awaitingSession: 0 })).toBeNull();
    // A man already waiting on a session leads everything else.
    expect(nextRecruitmentStep({ asked: false, watched: false, sessionPutOn: false, awaitingSession: 2 })).toBe('trial');

    const view = source('src/ui/views/RecruitmentView.tsx');
    const variants = view.match(/variant=\{nextStep === '[a-z-]+' \? 'primary' : 'ghost'\}/g);
    expect(variants).toHaveLength(4);
  });

  it('pairs the profile facts up, with a label that is not dust', () => {
    // The panel is 556px of column, so two to a row; the min track is what has
    // to stay small enough for the pairs to fit in it.
    expect(rule('facts')).toContain('grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))');
    // Beside a bold value in full ink, the label was grey dust at the weight of
    // body copy. Weight rather than colour: the value still wins the row.
    expect(rule('facts dt')).toContain('font-weight: 600');
    expect(rule('facts dt')).toContain('color: var(--text-dim)');
    expect(rule('facts__row')).toContain('justify-content: space-between');

    // Those four facts are rows of that grid, not a separate list.
    const overlay = source('src/ui/components/ProfileOverlay.tsx');
    for (const label of ['Condition', 'Availability', 'Deal', 'Subs']) {
      expect(overlay).toContain(`<Row label="${label}"`);
    }
  });

  it('names the roles in words beside the pitch', () => {
    const game = createTestGame('polish-posmap');
    const player = game.state.clubs[game.clubId]!.squadIds
      .map((id) => game.state.people[id])
      .find((person) => isPlayer(person)) as Player;
    const html = renderToStaticMarkup(createElement(PositionMap, { player }));

    const bands = positionBands(player);
    expect(bands.natural.length).toBeGreaterThan(0);
    for (const code of bands.natural) expect(html).toContain(POSITIONS[code].label);
    for (const code of bands.fillIn) expect(html).toContain(POSITIONS[code].label);
    // The old wording said it in a sentence; the tag is the manager's word for
    // it, which is what a glance at a squad sheet needs.
    expect(html).toContain('Natural');
    expect(html).not.toContain('his positions');
    expect(html).not.toContain('no use there');
    // The roles he cannot play stay a count: listing eight of them is the
    // twelve-row list this panel replaced.
    expect(html).toMatch(/Not suited<\/span><strong class="small">\d+ roles/);
  });

  it('gives the Continue button an edge, and the day’s action its own rule', () => {
    expect(rule('continue-btn')).toContain('border: 1px solid var(--club-ink)');
    expect(rule('continue-btn--solid')).toContain('box-shadow: inset 0 -2px 0 var(--club-text)');
    // Raised only when the command state says the action is due now, and by a
    // rule rather than a loop: a button blinking in the corner of the eye is a
    // button the manager learns to ignore.
    expect(source('src/ui/layout/TopBar.tsx')).toContain("command.urgency === 'now' ? ' continue-btn--solid'");
    expect(sheet).not.toMatch(/\.continue-btn--solid[^}]*animation/);
  });

  it('lets a desktop player find a club or a man without the mouse', () => {
    const bar = source('src/ui/layout/TopBar.tsx');
    // One combination, one search: Ctrl on a Windows keyboard and Cmd on a Mac.
    expect(bar).toContain('event.metaKey || event.ctrlKey');
    expect(bar).toContain("event.key.toLowerCase() === 'k'");
    // The browser's own Ctrl+K is not this game's, so the default is stopped.
    expect(bar).toContain('event.preventDefault();');
    // Both halves are in the document and only one is ever laid out, so each
    // claims the key only when its own control is on the screen.
    expect(bar).toContain('isOnScreen(input.current)');
    expect(bar).toContain('isOnScreen(searchButton.current)');
    // And the hint is written where the shortcut is used, on the key cap.
    expect(bar).toContain('topbar__search-key');
    expect(sheet).toMatch(/\.topbar \.topbar__search-key \{/);
    expect(sheet).toMatch(/\.topbar__search-key \{\s*display: none;/);
    // One thing on the bar is allowed to be slack: the search box keeps pushing
    // the cluster right, so the cap cannot be what moves the rest of the bar.
    expect(sheet).toMatch(/\.topbar__search \{[^}]*margin-left: auto/s);
  });

  it('pins the news to the board the club already has, as clippings', () => {
    const view = source('src/ui/views/NewsView.tsx');
    // The same board the noticeboard on the local-game screen is a picture of.
    expect(view).toContain('news-board');
    expect(view).toContain('/photos/inbox-noticeboard.webp');
    // A clipping is a sheet of paper with tape across it, and no two sheets are
    // cut or hung the same way — which is the whole difference between paper and
    // a card, and it is made of the sheet's own ink rather than a photograph.
    expect(sheet).toMatch(/\.news-board \{[^}]*background: var\(--bg-2\)/s);
    expect(sheet).toMatch(/\.news-story::before \{[^}]*transform: rotate\(-0\.5deg\)/s);
    expect(sheet).toMatch(/\.news-story:nth-child\(even\)::before \{\s*transform: rotate\(0\.55deg\)/);
    expect(sheet).toMatch(/\.news-story::after \{[^}]*height: 13px/s);
    // The paper is a layer behind the words, so it has to be isolated behind
    // them: without this the negative-z sheet paints behind the board itself.
    expect(sheet).toMatch(/\.news-story \{[^}]*isolation: isolate/s);
    // The board holds the stories; the feed is still the grid of them.
    expect(sheet).toMatch(/\.news-feed \{[^}]*display: grid/s);
  });

  it('gives the breadcrumb trail room and full ink', () => {
    // The bar it rides in gets the padding; the trail itself is one line of ink
    // that was the faintest and smallest in the frame.
    expect(rule('app__footer')).toContain('padding: 9px var(--s3)');
    for (const selector of ['breadcrumbs__crumb', 'breadcrumbs__here']) {
      expect(rule(selector)).toContain('font-size: var(--fs-base)');
    }
    expect(rule('breadcrumbs__crumb')).toContain('color: var(--text)');
    expect(rule('breadcrumbs__crumb')).not.toContain('--text-faint');
  });
});