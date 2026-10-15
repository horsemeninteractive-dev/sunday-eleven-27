import { describe, expect, it } from 'vitest';
import type { StandingRow } from '@/domain/club';
import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import { SEASON_HISTORY_LIMIT } from '@/domain/history';
import type { CompetitionId } from '@/domain/ids';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { COUNTY_CUP_ID, cupCompetitions, divisionsOf, LEAGUE_CUP_ID, pyramidsOf, standingsFor } from './pyramid';
import { finishSeason, startNextSeason } from './season';
import {
  archiveSeason,
  lastFinalTable,
  lastSeasonRecord,
  movementsFor,
  rememberSeason,
  seasonHistoryOf,
} from './seasonHistory';
import { createTestGame, playSeason } from './testSupport';

/**
 * The record of a finished season.
 *
 * A season is a clean sheet — the divisions are cut again, the cups redrawn from
 * the field the ladder now holds, and the competitions that carried last
 * season's ties replaced whole. What is held here is that the *football*
 * survives it: every division's final table, and for every cup the field it was
 * drawn from, its rounds with their ties and results, and the club that won it.
 *
 * Two careers are played, for real, one fixture at a time (see `playSeason` —
 * nothing here depends on the engine's arithmetic, only on every tie having a
 * winner). The first is read as the season closed; the second is read after the
 * roll-over that rebuilt the world around the record.
 */

/** What one career's season was, captured as it closed and kept for comparison. */
interface PlayedSeason {
  state: GameState;
  seasonId: string;
  seasonLabel: string;
  divisions: ReturnType<typeof divisionsOf>;
  tables: Map<CompetitionId, StandingRow[]>;
  cups: Map<CompetitionId, { winnerClubId: string | null; runnerUpClubId: string | null }>;
}

/** Capture the season a career has just played, as the ladder and cups ended it. */
function capture(state: GameState): PlayedSeason {
  const divisions = pyramidsOf(state).flatMap((pyramid) => divisionsOf(state, pyramid.id));
  return {
    state,
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    divisions,
    tables: new Map(divisions.map((competition) => [competition.id, standingsFor(state, competition)])),
    // The cup's *winner*, and not its entry list: by the day the season closes
    // that list holds only the two finalists, which is the whole reason the
    // archive reads its field off the ties instead.
    cups: new Map(
      cupCompetitions(state).map((cup) => [
        cup.id,
        { winnerClubId: cup.cup?.winnerClubId ?? null, runnerUpClubId: cup.cup?.runnerUpClubId ?? null },
      ]),
    ),
  };
}

// A season that has closed, and the same football a season later. Played once
// each at collection time, and only ever read afterwards: the second career is
// rolled over before any test in the file runs, so every test that reads it is
// reading the world the archive outlived.
const closedGame = createTestGame('season-archive');
playSeason(closedGame.state);
const closed = capture(closedGame.state);

const rolledGame = createTestGame('season-archive-roll');
playSeason(rolledGame.state);
const beforeRoll = capture(rolledGame.state);
startNextSeason(rolledGame.state);

describe('a season, once it has closed', () => {
  it('is archived as the season is closed, and labelled as the season it was', () => {
    expect(closed.state.phase).toBe('complete');
    expect(seasonHistoryOf(closed.state)).toHaveLength(1);
    const archived = lastSeasonRecord(closed.state)!;
    expect(archived.seasonId).toBe(closed.seasonId);
    expect(archived.seasonLabel).toBe(closed.seasonLabel);
  });

  it('keeps every division’s final table, as the season ended it', () => {
    const archived = lastSeasonRecord(closed.state)!;
    expect(archived.leagues).toHaveLength(closed.divisions.length);
    for (const competition of closed.divisions) {
      const record = archived.leagues.find((entry) => entry.competitionId === competition.id);
      expect(record, competition.name).toBeDefined();
      expect(record!.name).toBe(competition.name);
      expect(record!.tier).toBe(competition.tier);
      // The rows are the table the season ended on, not a second reading of it.
      expect(record!.rows).toEqual(closed.tables.get(competition.id));
      expect(record!.rows).toHaveLength(competition.clubIds.length);
      expect(record!.rows[0]!.points).toBeGreaterThanOrEqual(record!.rows[record!.rows.length - 1]!.points);
    }
  });

  it('keeps a cup’s entrants, its rounds and its winner', () => {
    const archived = lastSeasonRecord(closed.state)!;
    expect(archived.cups).toHaveLength(closed.cups.size);
    for (const [competitionId, expected] of closed.cups) {
      const record = archived.cups.find((entry) => entry.competitionId === competitionId);
      expect(record, competitionId).toBeDefined();
      expect(record!.winnerClubId).toBe(expected.winnerClubId);
      expect(record!.runnerUpClubId).toBe(expected.runnerUpClubId);
      expect(record!.winnerClubId).not.toBeNull();
      // Every round of the plan, opening round first and the final last.
      expect(record!.rounds.length).toBeGreaterThan(1);
      expect(record!.rounds[record!.rounds.length - 1]!.name).toBe('Final');
      for (const round of record!.rounds) {
        // A round that was played has a field and entrants, and the gap between
        // them is the byes — which a record of ties alone could not carry.
        expect(round.field, round.name).toBeGreaterThanOrEqual(round.entrants);
        expect(round.date, round.name).toBeTruthy();
        for (const tie of round.ties) {
          expect(tie.score, `${round.name} tie`).not.toBeNull();
          expect(tie.winnerClubId).toBeTruthy();
          expect([tie.homeClubId, tie.awayClubId]).toContain(tie.winnerClubId);
        }
      }
      // Every club that was in it played a tie in it, and no club from anywhere
      // else appears: the field is the field, not the two clubs still standing
      // on the day the season closed.
      const played = new Set(record!.rounds.flatMap((round) => round.ties.flatMap((tie) => [tie.homeClubId, tie.awayClubId])));
      expect(record!.clubIds.length).toBe(played.size);
      expect([...record!.clubIds].sort()).toEqual([...played].sort());
      expect(record!.clubIds.length).toBeGreaterThan(2);
      // The bracket is chained: the winner of a tie is in the round after it,
      // either in a tie or on a bye in a round whose field is bigger than the
      // clubs who played in it. A cup read back a season later has to hold
      // together as a road, not as a pile of rounds.
      for (let index = 0; index < record!.rounds.length - 1; index += 1) {
        const round = record!.rounds[index]!;
        const next = record!.rounds[index + 1]!;
        const playing = new Set(next.ties.flatMap((tie) => [tie.homeClubId, tie.awayClubId]));
        for (const tie of round.ties) {
          const winner = tie.winnerClubId!;
          if (playing.has(winner)) continue;
          expect(next.field - next.entrants, `${next.name} byes`).toBeGreaterThan(0);
        }
      }
      // The last round is one tie and it decided the competition.
      const finalRound = record!.rounds[record!.rounds.length - 1]!;
      expect(finalRound.ties).toHaveLength(1);
      expect(finalRound.ties[0]!.winnerClubId).toBe(record!.winnerClubId);
      const beaten =
        finalRound.ties[0]!.homeClubId === record!.winnerClubId
          ? finalRound.ties[0]!.awayClubId
          : finalRound.ties[0]!.homeClubId;
      expect(record!.runnerUpClubId).toBe(beaten);
    }
  });

  it('reads a cup’s opening round as the field it was, not as the ties in it', () => {
    // A thirty-six-club cup opens with eight clubs playing and twenty-eight on a
    // bye. A record that kept only the ties would say the twenty-eight were never
    // in the round, and a manager reading it back a season later would conclude
    // his club had been thrown out of a competition it was still in.
    const archived = lastSeasonRecord(closed.state)!;
    const cup = archived.cups.find((entry) => entry.competitionId === LEAGUE_CUP_ID)!;
    // A thirty-six-club ladder cup: eight clubs play a preliminary of four ties
    // and the other twenty-eight are in at the round of thirty-two.
    expect(cup.rounds.map((round) => [round.name, round.field, round.entrants, round.ties.length])).toEqual([
      ['Preliminary Round', 36, 8, 4],
      ['Round of 32', 32, 32, 16],
      ['Last 16', 16, 16, 8],
      ['Quarter-finals', 8, 8, 4],
      ['Semi-finals', 4, 4, 2],
      ['Final', 2, 2, 1],
    ]);
    const first = cup.rounds[0]!;
    const playing = first.ties.flatMap((tie) => [tie.homeClubId, tie.awayClubId]);
    // Everybody who played a preliminary tie is a distinct club, and everybody
    // who did not is in the competition and in the round after it: a bye is not
    // an absence, and the archive says so.
    expect(new Set(playing).size).toBe(first.entrants);
    expect(first.field - first.entrants).toBe(28);
    expect(cup.clubIds).toHaveLength(36);
    const cameInAt32 = cup.clubIds.filter((clubId) => !playing.includes(clubId));
    expect(cameInAt32).toHaveLength(28);
    for (const clubId of cameInAt32) {
      const inTheNextRound = cup.rounds[1]!.ties.some(
        (tie) => tie.homeClubId === clubId || tie.awayClubId === clubId,
      );
      // Or knocked out later, but never missing: a club on a bye is in the draw.
      const playedLater = cup.rounds.slice(1).some((round) => round.ties.some((tie) => tie.homeClubId === clubId || tie.awayClubId === clubId));
      expect(inTheNextRound || playedLater, clubId).toBe(true);
    }
  });

  it('reads a round of an odd number of clubs as the round that was played', () => {
    // A county cup draws down from an odd field: seventeen clubs left is eight
    // ties and one club on a bye, which the plan itself counts as seventeen
    // entrants. The archive counts what the round put out, so the byes come out
    // right in every round of it.
    const archived = lastSeasonRecord(closed.state)!;
    const county = archived.cups.find((entry) => entry.competitionId === COUNTY_CUP_ID);
    expect(county).toBeDefined();
    expect(county!.rounds.map((round) => round.name)).toEqual([
      'Preliminary Round',
      'Round of 68',
      'Round of 34',
      'Round of 17',
      'Round of 9',
      'Round of 5',
      'Round of 3',
      'Final',
    ]);
    for (const round of county!.rounds) {
      expect(round.entrants, round.name).toBe(round.ties.length * 2);
      expect(round.entrants, round.name).toBeLessThanOrEqual(round.field);
    }
    const odd = county!.rounds.find((round) => round.name === 'Round of 17')!;
    expect(odd.field).toBe(17);
    expect(odd.entrants).toBe(16);
    expect(odd.field - odd.entrants).toBe(1);
    // Eight ties, eight clubs through, and the ninth in the round after it.
    expect(new Set(odd.ties.map((tie) => tie.winnerClubId)).size).toBe(8);
    expect(county!.rounds[county!.rounds.findIndex((round) => round.round === odd.round) + 1]!.field).toBe(9);
    // And the whole competition is the county: seventy-two clubs played in it.
    expect(county!.clubIds).toHaveLength(72);
  });

  it('is written by reading a season, not by editing it', () => {
    const { state } = createTestGame('season-archive-read');
    const before = JSON.stringify(state);
    const record = archiveSeason(state);
    expect(record.seasonId).toBe(state.season.id);
    expect(record.leagues.length).toBeGreaterThan(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('is written by the season close, once, and is idempotent about the season it finds', () => {
    // `finishSeason` is what writes the record, and it writes the season the
    // world is actually in. A career whose season was closed twice — which the
    // day loop never does — gets a second record of the same season rather than a
    // rewritten first one, so nothing already written is ever edited.
    const { state } = createTestGame('season-archive-once');
    finishSeason(state);
    expect(seasonHistoryOf(state)).toHaveLength(1);
    const first = seasonHistoryOf(state)[0]!;
    finishSeason(state);
    expect(seasonHistoryOf(state)).toHaveLength(2);
    expect(seasonHistoryOf(state)[0]!.seasonId).toBe(first.seasonId);
    expect(seasonHistoryOf(state)[0]).toEqual(first);
  });
});

describe('the archive across the roll-over', () => {
  it('is still there after the world has been rebuilt', () => {
    expect(rolledGame.state.season.id).not.toBe(beforeRoll.seasonId);
    expect(seasonHistoryOf(rolledGame.state)).toHaveLength(1);
    expect(lastSeasonRecord(rolledGame.state)!.seasonId).toBe(beforeRoll.seasonId);
  });

  it('is the only place last season’s competitions still exist', () => {
    // The live world is a new season: the cups are new competitions with no field
    // and no winner, and what they were is only in the archive.
    for (const [competitionId, expected] of beforeRoll.cups) {
      const competition = rolledGame.state.competitions[competitionId]!;
      expect(competition, competitionId).toBeDefined();
      // The new season's cup is a new competition: nothing played, nobody
      // through, no winner — and it is not the same competition object as the
      // one whose final was played last April.
      expect(competition.cup?.winnerClubId ?? null).toBeNull();
      expect(competition.cup?.complete).toBe(false);
      expect(competition.seasonId).toBe(rolledGame.state.season.id);
      const archived = lastSeasonRecord(rolledGame.state)!.cups.find((entry) => entry.competitionId === competitionId)!;
      expect(archived.winnerClubId).toBe(expected.winnerClubId);
      expect(archived.winnerClubId).not.toBeNull();
      // And the field it was drawn from is still whole, not the two clubs that
      // were left standing on the day the season closed.
      expect(archived.clubIds.length).toBeGreaterThan(2);
    }
  });

  it('answers for the division a manager is looking at, by its own id', () => {
    const division = beforeRoll.divisions.find((competition) => competition.clubIds.includes(rolledGame.clubId)) ?? beforeRoll.divisions[0]!;
    const table = lastFinalTable(rolledGame.state, division.id);
    expect(table).not.toBeNull();
    expect(table!.season.seasonId).toBe(beforeRoll.seasonId);
    expect(table!.league.rows).toEqual(beforeRoll.tables.get(division.id));
    // The division keeps its id across the seasons — that is what makes "last
    // season's table" a question with an answer — while the competition itself is
    // this season's, cut again from the field that came out of last year.
    expect(rolledGame.state.competitions[division.id]!.seasonId).toBe(rolledGame.state.season.id);
    // A division that played no season has no table to show.
    expect(lastFinalTable(rolledGame.state, 'comp_not_a_division')).toBeNull();
  });

  it('keeps the boundary that moved clubs out of that table', () => {
    const division = beforeRoll.divisions.find((competition) => competition.clubIds.includes(rolledGame.clubId)) ?? beforeRoll.divisions[0]!;
    const movements = movementsFor(rolledGame.state, beforeRoll.seasonId, division.id);
    const rows = lastFinalTable(rolledGame.state, division.id)!.league.rows;
    // Everybody the ladder moved was in the table it moved them out of, and the
    // movement names that division rather than the same rung of the other ladder.
    expect(movements.length).toBeGreaterThan(0);
    for (const movement of movements) {
      expect(rows.map((row) => row.clubId)).toContain(movement.clubId);
      expect(movement.competitionId).toBe(division.id);
      expect(movement.seasonId).toBe(beforeRoll.seasonId);
    }
    // Nothing is invented for a season or a division that has none.
    expect(movementsFor(rolledGame.state, beforeRoll.seasonId, 'comp_not_a_division')).toEqual([]);
    expect(movementsFor(rolledGame.state, 'season_never_played', division.id)).toEqual([]);
  });
});

describe('the archive is bounded and outlives the format it was written in', () => {
  it('keeps the most recent seasons and drops the oldest whole ones', () => {
    const { state } = createTestGame('season-archive-bound');
    for (let index = 0; index < SEASON_HISTORY_LIMIT + 3; index += 1) rememberSeason(state);
    const history = seasonHistoryOf(state);
    expect(history).toHaveLength(SEASON_HISTORY_LIMIT);
    for (const season of history) {
      // Whole seasons only: every one of them carries its tables and its cups.
      expect(season.seasonId).toBe(state.season.id);
      expect(season.leagues.length).toBeGreaterThan(0);
      expect(season.cups.length).toBeGreaterThan(0);
    }
  });

  it('gives a save written before it existed an empty archive rather than an invented one', () => {
    const { state } = createTestGame('season-archive-migration');
    // Written as a save actually is — the state as JSON, with the field the last
    // version did not have taken out of it.
    const stripped = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete stripped.seasonHistory;
    stripped.version = GAME_STATE_VERSION - 1;
    const loaded = deserialiseGame(
      JSON.stringify({ version: GAME_STATE_VERSION - 1, savedAt: '2026-08-20T00:00:00.000Z', state: stripped }),
    );
    expect(loaded.error).toBeNull();
    expect(loaded.state!.version).toBe(GAME_STATE_VERSION);
    // A career that played its seasons before the record existed keeps the
    // honours and seasons it already had, and is given no history it never wrote.
    expect(loaded.state!.seasonHistory).toEqual([]);
  });

  it('round-trips, so a saved season is the season that loads back', () => {
    const reloaded = deserialiseGame(serialiseGame(closed.state));
    expect(reloaded.error).toBeNull();
    expect(reloaded.state!.seasonHistory).toEqual(closed.state.seasonHistory);
    const archived = lastSeasonRecord(reloaded.state!)!;
    expect(archived.leagues).toHaveLength(closed.divisions.length);
    expect(archived.cups).toHaveLength(closed.cups.size);
  });
});
