import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { useGameStore } from '@/state/gameStore';
import { createTestGame } from '@/simulation/testSupport';
import { gameActions } from './hooks';
import { clubMatters } from './clubMatters';
import { inPreSeason, kitChosenForSeason, kitDecisionOutstanding } from './kit';

/**
 * The four pieces of UI tuning, checked where they can be checked without a
 * browser: the geometry rules in the stylesheet, the wiring in the views, and
 * the kit gate in the state.
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

    // Home really does draw that list.
    expect(source('src/ui/views/DashboardView.tsx')).toContain('clubMatters(game');

    // Still not a place in the navigation — that was the point of it.
    expect(source('src/ui/navigation.ts')).not.toContain("id: 'kit',");
  });
});