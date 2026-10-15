import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { processDay } from './day';
import { generateDraft, startGameFromDraft, type WorldDraft } from './gameSetup';
import { finishSeason } from './season';

/**
 * Play the league football out without an engine: the better-supported side wins
 * its own ground, which is all a table needs to settle a boundary.
 *
 * Cups are left unplayed. A test that is about what a *boundary* does with a
 * pyramid — promotion, relegation, a new season's fixtures — needs the league
 * decided and nothing else, and a real cup run would only be football nobody
 * asked for.
 */
export function settleLeague(state: GameState): void {
  for (const match of Object.values(state.matches)) {
    const competition = state.competitions[match.competitionId];
    if (!competition || competition.kind !== 'league') continue;
    const homeWins = state.clubs[match.homeClubId]!.reputation >= state.clubs[match.awayClubId]!.reputation;
    match.played = true;
    match.status = 'finished';
    match.result = {
      homeGoals: homeWins ? 2 : 0,
      awayGoals: homeWins ? 0 : 2,
      homeShots: 9,
      awayShots: 9,
      homePossession: homeWins ? 60 : 40,
      awayPossession: homeWins ? 40 : 60,
      attendance: 120,
    };
  }
}

/**
 * Settle every fixture due on a date, by hand.
 *
 * The engine is what a season's football costs, and a test about what the world
 * *keeps* of a season does not need the football inside it — only that each tie
 * has a winner and each league game has a score. A knockout tie is level at
 * ninety minutes, so a drawn one is decided on penalties, exactly as the engine
 * would have decided it.
 */
function settleFixturesOn(state: GameState, date: ISODate): void {
  for (const match of Object.values(state.matches)) {
    if (match.date !== date || match.played || match.status !== 'scheduled') continue;
    settleByHand(match);
  }
}

/** One fixture, decided without the engine: the coin is the clubs' own ids. */
function settleByHand(match: Match): void {
  const homeGoals = match.homeClubId.length % 3;
  const awayGoals = match.awayClubId.length % 2;
  match.played = true;
  match.status = 'finished';
  match.result = {
    homeGoals,
    awayGoals,
    homeShots: 8,
    awayShots: 6,
    homePossession: 52,
    awayPossession: 48,
    attendance: 180,
  } as Match['result'];
  if (match.knockout && homeGoals === awayGoals && match.result) {
    match.result.penalties = { home: 4, away: 3 };
    match.shootoutWinnerId = match.homeClubId;
  }
}

/**
 * Play a whole season out without the engine, and let the day loop close it.
 *
 * The days are stepped with every fixture settled by hand first — every fixture,
 * because a cup round is drawn only once the round before it has been settled
 * and a league Sunday is a date like any other: the season cannot be played in
 * one pass. The season then ends the way it always ends, on the day the calendar
 * runs out with nothing left to play, which is what makes this a test of the
 * game's own season close rather than of a function called by the test.
 *
 * The fallback is for a calendar that ran out with football still on it — a
 * season the day loop would not have closed — so a test that only wants a season
 * archived is not left without one.
 */
export function playSeason(state: GameState): void {
  for (let day = 0; day < 460 && state.phase !== 'complete'; day += 1) {
    settleFixturesOn(state, state.date);
    const before = state.date;
    processDay(state, state.date);
    if (state.date === before) break;
  }
  if (state.phase !== 'complete') {
    settleLeague(state);
    finishSeason(state);
  }
}

export interface TestGame {
  state: GameState;
  draft: WorldDraft;
  clubId: ClubId;
}

/**
 * Build a complete, ready-to-play game state for tests.
 *
 * `pyramids` is how many of the county's districts the career is founded with,
 * and it defaults to two: a test's world is the smallest one that has the shape
 * under test, and two districts is the world every save written before the
 * county had six carries — so the tests that hold this game together keep
 * holding the same game together. A test that is about the county as it was
 * before the district next door existed asks for one, which is also the only way
 * to hold the founding county against itself; a test that is about the whole
 * county asks for six — and that world is the county as a new career founds it,
 * map centres and all, because a count is a prefix of the county rather than a
 * county of its own.
 */
export function createTestGame(seed = 'test-seed', clubIndex = 0, startYear = 2026, pyramids = 2): TestGame {
  const draft = generateDraft({ seed, startYear, createdAt: `${startYear}-08-20`, pyramids });
  const clubId = draft.divisionClubIds[clubIndex] ?? draft.divisionClubIds[0]!;
  const state = startGameFromDraft(draft, {
    seed,
    startYear,
    clubId,
    saveName: 'Test save',
    createdAt: `${startYear}-08-20`,
  });
  return { state, draft, clubId };
}
