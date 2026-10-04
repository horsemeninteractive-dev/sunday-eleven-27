import { describe, expect, it } from 'vitest';
import { FORFEIT_GOALS, MIN_SIDE } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { processDay } from '@/simulation/day';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { simulateMatchHeadless } from '@/simulation/match/matchEngine';
import { autoPickLineup, validateLineup } from '@/simulation/selection';
import { nextFixtureFor } from '@/simulation/schedule';
import { createTestGame } from '@/simulation/testSupport';
import { canFieldSide, playableSideSize, settleShortSides } from './forfeit';

/**
 * A side is eleven players, but the laws let a club start with as few as seven.
 * Below that there is no team, and the fixture is forfeited rather than leaving
 * the manager stuck on a matchday he cannot play.
 */

type State = ReturnType<typeof createTestGame>['state'];

/** Leave a club with exactly `keep` fit players; everybody else is out. */
function thinSquad(state: State, clubId: string, keep: number): void {
  const club = state.clubs[clubId]!;
  club.squadIds.forEach((id, index) => {
    const person = state.people[id];
    if (!isPlayer(person)) return;
    person.availability =
      index < keep
        ? { status: 'available', reason: null, note: null, until: null, discoveredLate: false }
        : { status: 'unavailable', reason: 'injury', note: 'Out injured', until: null, discoveredLate: false };
  });
}

function aNonUserFixture(state: State) {
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.status === 'scheduled' &&
      candidate.matchday === 1 &&
      candidate.homeClubId !== state.userClubId &&
      candidate.awayClubId !== state.userClubId,
  );
  if (!match) throw new Error('no AI fixture on matchday one');
  return match;
}

describe('a side short of players', () => {
  it('needs at least seven to take the field, and allows fewer than eleven', () => {
    const { state, clubId } = createTestGame('forfeit-minimum');
    const squad = state.clubs[clubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);

    const full = autoPickLineup(squad, '4-4-2');
    const lookup = (id: string) => {
      const person = state.people[id];
      return isPlayer(person) ? (person as Player) : undefined;
    };
    // Ten outfielders, no keeper, is legal — short-handed, not illegal.
    const ten = full.starting.slice(0, 10);
    const tenProblems = validateLineup(ten, [], lookup).filter((problem) => problem.severity === 'error');
    expect(tenProblems.some((problem) => problem.message.includes(`${MIN_SIDE} players`))).toBe(false);

    // Six is not a team.
    const six = full.starting.slice(0, 6);
    const sixProblems = validateLineup(six, [], lookup).filter((problem) => problem.severity === 'error');
    expect(sixProblems.some((problem) => problem.message.includes(`at least ${MIN_SIDE}`))).toBe(true);
  });

  it('fields a short-handed side and plays the match', () => {
    const { state, clubId } = createTestGame('forfeit-ten-play');
    const fixture = nextFixtureFor(state, clubId, state.date);
    if (!fixture) throw new Error('no fixture to play');
    const side = fixture.homeClubId === clubId ? 'home' : 'away';

    state.date = fixture.date;
    prepareMatchday(state, fixture.matchday);
    thinSquad(state, clubId, 10);
    expect(canFieldSide(state, clubId)).toBe(true);
    expect(playableSideSize(state, clubId)).toBe(10);

    const squad = state.clubs[clubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);
    const selection = autoPickLineup(squad, '4-4-2');
    expect(selection.starting).toHaveLength(10);
    fixture.lineups[side] = {
      ...fixture.lineups[side],
      starting: selection.starting,
      bench: selection.bench,
    };

    const env = matchEnvironment(state, fixture, { autoManageAllBenches: true });
    simulateMatchHeadless(fixture, env);
    expect(fixture.played).toBe(true);
    expect(fixture.result).not.toBeNull();
  });

  it('forfeits the fixture when a side cannot field seven', () => {
    const { state } = createTestGame('forfeit-award');
    const match = aNonUserFixture(state);
    thinSquad(state, match.awayClubId, 6);

    const forfeit = settleShortSides(state, match);
    expect(forfeit).not.toBeNull();
    expect(forfeit!.shortClubId).toBe(match.awayClubId);
    expect(forfeit!.awardedClubId).toBe(match.homeClubId);
    expect(match.played).toBe(true);
    expect(match.status).toBe('finished');
    expect(match.result).toEqual(expect.objectContaining({ homeGoals: FORFEIT_GOALS, awayGoals: 0 }));
  });

  it('settles the day rather than letting the clock stick on an unplayable fixture', () => {
    const { state } = createTestGame('forfeit-day');
    const match = aNonUserFixture(state);
    // A squad of five, not five fit men: the day's own availability roll cannot
    // conjure players who are not on the books.
    const club = state.clubs[match.homeClubId]!;
    club.squadIds = club.squadIds.slice(0, 5);
    state.date = match.date;

    processDay(state, match.date, { resolveUserMatch: true });
    expect(match.played).toBe(true);
    expect(match.status).toBe('finished');
    expect(match.result!.homeGoals).toBe(0);
    expect(match.result!.awayGoals).toBe(FORFEIT_GOALS);
  });
});
