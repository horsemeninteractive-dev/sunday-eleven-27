import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import { isCompetitiveMatch } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import { createTestGame } from '@/simulation/testSupport';
import { processDay } from '@/simulation/day';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { fixtureIdsOnMatchday } from '@/simulation/pyramid';
import { nextMatchday } from '@/simulation/timeline';
import type { MatchEnvironment } from '@/simulation/match/core';
import { isMatchSimulationMode, MATCH_SIMULATION_MODES, simulateFixture, simulationModeFor } from './index';

/**
 * Which simulation plays which fixture, and whether the season can tell.
 *
 * Two halves. The first pins the *routing*: the manager's own fixture is the full
 * engine and everybody else's is the fast model, written down once and never
 * inferred from a call site. The second pins the *integration*: a season played
 * through the fast path must leave the same kind of state behind it — league
 * records that reconcile with the results, career totals that reconcile with the
 * performances, knocks and bans that land on the men.
 */

function fixtureFor(seed: string): { match: Match; env: MatchEnvironment } {
  const { state } = createTestGame(seed);
  const matchday = nextMatchday(state);
  prepareMatchday(state, matchday);
  const ids = fixtureIdsOnMatchday(state, matchday);
  const match = state.matches[ids[0]!]!;
  return { match, env: matchEnvironment(state, match, { autoManageAllBenches: true }) };
}

/** Walk the calendar until a day with a full card has been played. */
function playToFirstFullDay(seed: string) {
  const game = createTestGame(seed);
  for (let day = 0; day < 200; day += 1) {
    const outcome = processDay(game.state, game.state.date, { resolveUserMatch: true });
    if (outcome.results.length >= 8) return { ...game, outcome };
  }
  throw new Error('no full fixture day was reached');
}

describe('the two simulation modes', () => {
  it('knows exactly two modes', () => {
    expect(MATCH_SIMULATION_MODES).toEqual(['full', 'fast']);
    expect(isMatchSimulationMode('full')).toBe(true);
    expect(isMatchSimulationMode('fast')).toBe(true);
    expect(isMatchSimulationMode('legacy')).toBe(false);
    expect(isMatchSimulationMode(undefined)).toBe(false);
  });

  it('sends the manager to the full engine and everyone else to the fast model', () => {
    const { state } = createTestGame('mode-routing');
    const matchday = nextMatchday(state);
    prepareMatchday(state, matchday);
    const ids = fixtureIdsOnMatchday(state, matchday);

    let sawUser = false;
    let sawOther = false;
    for (const id of ids) {
      const match = state.matches[id]!;
      const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
      const mode = simulationModeFor(state, match);
      if (involvesUser) {
        expect(mode).toBe('full');
        sawUser = true;
      } else {
        expect(mode).toBe('fast');
        sawOther = true;
      }
    }
    expect(sawUser, 'no fixture involved the manager').toBe(true);
    expect(sawOther, 'every fixture involved the manager').toBe(true);
  });

  it('stamps the record with the mode it was played in', () => {
    const { match, env } = fixtureFor('mode-stamp');
    const full = structuredClone(match);
    simulateFixture(full, env, 'full');
    expect(full.simulationMode).toBe('full');
    // The full engine's fingerprint, which the fast mode does not produce.
    expect(full.events.some((event) => event.type === 'pass')).toBe(true);

    const fast = structuredClone(match);
    simulateFixture(fast, env, 'fast');
    expect(fast.simulationMode).toBe('fast');
    expect(fast.result).not.toBeNull();
  });

  it('plays a real day in the right mode on every fixture', () => {
    const { state } = playToFirstFullDay('mode-day');
    const played = Object.values(state.matches).filter((match) => match.played && match.result);
    expect(played.length).toBeGreaterThanOrEqual(8);
    for (const match of played) {
      expect(isMatchSimulationMode(match.simulationMode), `${match.id} has no mode`).toBe(true);
      const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
      expect(match.simulationMode).toBe(involvesUser ? 'full' : 'fast');
    }
    expect(played.some((match) => match.simulationMode === 'fast')).toBe(true);
    expect(played.some((match) => match.simulationMode === 'full')).toBe(true);
  });
});

describe('a season played through the fast path', () => {
  const { state } = playToFirstFullDay('mode-integration');

  it('leaves the club records reconciling with the results', () => {
    for (const club of Object.values(state.clubs)) {
      const record = club.history.seasons.find((season) => season.seasonId === state.season.id);
      if (!record) continue;
      const own = Object.values(state.matches).filter(
        (match) =>
          match.played &&
          match.result &&
          isCompetitiveMatch(state, match) &&
          (match.homeClubId === club.id || match.awayClubId === club.id),
      );
      let goalsFor = 0;
      let goalsAgainst = 0;
      let won = 0;
      let drawn = 0;
      for (const match of own) {
        const isHome = match.homeClubId === club.id;
        const scored = isHome ? match.result!.homeGoals : match.result!.awayGoals;
        const conceded = isHome ? match.result!.awayGoals : match.result!.homeGoals;
        goalsFor += scored;
        goalsAgainst += conceded;
        if (scored > conceded) won += 1;
        else if (scored === conceded) drawn += 1;
      }
      expect(record.played, `${club.identity.name} played`).toBe(own.length);
      expect(record.goalsFor, `${club.identity.name} goals for`).toBe(goalsFor);
      expect(record.goalsAgainst, `${club.identity.name} goals against`).toBe(goalsAgainst);
      expect(record.points, `${club.identity.name} points`).toBe(won * 3 + drawn);
    }
  });

  it('writes every appearance the fast matches claim onto the players', () => {
    let started = 0;
    let cameOn = 0;
    let goals = 0;
    for (const match of Object.values(state.matches)) {
      if (!match.played || !match.result || !isCompetitiveMatch(state, match)) continue;
      for (const performance of Object.values(match.performances)) {
        if (performance.started) started += 1;
        else if (performance.cameOnMinute !== null) cameOn += 1;
        goals += performance.goals;
      }
    }
    let recordedAppearances = 0;
    let recordedSubAppearances = 0;
    let recordedGoals = 0;
    for (const person of Object.values(state.people)) {
      if (!isPlayer(person)) continue;
      recordedAppearances += person.record.appearances;
      recordedSubAppearances += person.record.substituteAppearances;
      recordedGoals += person.record.goals;
    }
    expect(recordedAppearances).toBeGreaterThan(0);
    expect(recordedAppearances).toBe(started);
    expect(recordedSubAppearances).toBe(cameOn);
    expect(recordedGoals).toBe(goals);
  });

  it('propagates a sending off into a suspension and a knock into time out', () => {
    const game = createTestGame('mode-consequences');
    let suspendedPlayer: string | null = null;
    let injuredPlayer: string | null = null;

    for (let day = 0; day < 220 && (!suspendedPlayer || !injuredPlayer); day += 1) {
      processDay(game.state, game.state.date, { resolveUserMatch: true });
      for (const match of Object.values(game.state.matches)) {
        if (!match.played || match.simulationMode !== 'fast') continue;
        if (!suspendedPlayer) {
          const red = match.events.find((event) => event.type === 'red-card' && event.playerId);
          if (red?.playerId) {
            const player = game.state.people[red.playerId];
            if (isPlayer(player) && player.availability.status === 'unavailable' && player.availability.reason === 'suspension') {
              suspendedPlayer = player.id;
            }
          }
        }
        if (!injuredPlayer) {
          const knock = match.events.find((event) => event.type === 'injury' && event.playerId);
          if (knock?.playerId) {
            const player = game.state.people[knock.playerId];
            if (isPlayer(player) && player.injury && player.availability.status === 'unavailable') {
              injuredPlayer = player.id;
            }
          }
        }
      }
    }

    expect(suspendedPlayer, 'no sending off became a suspension').not.toBeNull();
    expect(injuredPlayer, 'no knock became time out').not.toBeNull();
  });
});
