import type { Competition, MovementRecord } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import {
  SEASON_HISTORY_LIMIT,
  type SeasonCupRecord,
  type SeasonCupRoundRecord,
  type SeasonLeagueRecord,
  type SeasonRecord,
  type SeasonTieRecord,
} from '@/domain/history';
import type { ClubId, CompetitionId, SeasonId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { isCup } from '@/domain/competition';
import { cupRoundName, cupRoundSummaries, matchesForRound, planOf, roundDrawDate, winnerOf } from './cup';
import { divisionsOf, pyramidsOf, standingsFor } from './pyramid';

/**
 * The archive of finished seasons.
 *
 * A season is a clean sheet, and until this existed that was true of the record
 * as well: at the boundary every division is cut again, every cup is redrawn
 * from the field the ladder now holds, and last season's ties went out with the
 * competitions that carried them. What a manager could still read a season later
 * was his own club's line — points, position, movement — and the honours on the
 * shelf. Which clubs were in the cup he was knocked out of, what the round of
 * thirty-two looked like, when the final was played and who won it were gone.
 *
 * So the season is written down once, as it closes, and kept: `archiveSeason`
 * reads the world the way the screens read it, `rememberSeason` appends the
 * result and drops the oldest season when the archive is full. Nothing here
 * writes to the season it describes, and nothing is derived twice — the tables
 * are `standingsFor`, the ties are the competition's own matches, the winner is
 * the one written on the cup when the final was settled.
 *
 * Everything is read defensively for a save that predates the archive, which has
 * none: `seasonHistoryOf` answers with an empty list rather than inventing a
 * season nobody played.
 */

/**
 * One season's competitions, as of this moment.
 *
 * Called by `finishSeason`, when every fixture has been settled and the cups
 * have their winners — the one moment in the year at which the whole season is
 * true at once and the next one has not yet begun.
 */
export function archiveSeason(state: GameState): SeasonRecord {
  const leagues = pyramidsOf(state)
    .flatMap((pyramid) => divisionsOf(state, pyramid.id))
    .map((competition) => leagueRecord(state, competition));
  // Sorted by name so the archive's shape does not depend on the order the
  // competitions happened to be built in: the same season reads the same way
  // twice, which is what lets a save be compared with itself.
  const cups = Object.values(state.competitions)
    .filter(isCup)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((competition) => cupRecord(state, competition));

  return { seasonId: state.season.id, seasonLabel: state.season.label, leagues, cups };
}

/**
 * Put the season just finished into the archive, and keep the archive bounded.
 *
 * The oldest season is dropped whole. A career is finite but its seasons are
 * not, and an archive that grew for ever would be carried in every save and
 * every autosave after it.
 */
export function rememberSeason(state: GameState): SeasonRecord {
  const record = archiveSeason(state);
  state.seasonHistory = [...seasonHistoryOf(state), record].slice(-SEASON_HISTORY_LIMIT);
  return record;
}

/** The archive, as every reader wants it: a save that predates it has none. */
export function seasonHistoryOf(state: GameState): SeasonRecord[] {
  return state.seasonHistory ?? [];
}

/** The season that has just finished, or null before a career has played one. */
export function lastSeasonRecord(state: GameState): SeasonRecord | null {
  const history = seasonHistoryOf(state);
  return history[history.length - 1] ?? null;
}

/**
 * One division's final table from the most recent finished season.
 *
 * Keyed by the competition id, which is stable across the seasons of a career —
 * a ladder's third division is `comp_league_t3` whatever clubs are in it this
 * year — so this answers "the table of the division I am looking at" rather than
 * "a table with the same name". A division that did not exist last season (the
 * county's second ladder, in its first year) simply has no record, and the
 * screens say so rather than showing one from somewhere else.
 */
export function lastFinalTable(
  state: GameState,
  competitionId: CompetitionId,
): { season: SeasonRecord; league: SeasonLeagueRecord } | null {
  const season = lastSeasonRecord(state);
  if (!season) return null;
  const league = season.leagues.find((entry) => entry.competitionId === competitionId);
  return league ? { season, league } : null;
}

/**
 * The clubs that went up or down out of a division in a given season.
 *
 * Read out of `promotionHistory`, which is the ladder's own record of its
 * boundary rather than a club's line in its own history: it names the
 * competition the club moved within, which is what makes it possible to mark
 * promotion and relegation on *this* division's table and not on a division of
 * the same rung in the league next door.
 */
export function movementsFor(
  state: GameState,
  seasonId: SeasonId,
  competitionId: CompetitionId,
): MovementRecord[] {
  return (state.promotionHistory ?? []).filter(
    (movement) => movement.seasonId === seasonId && movement.competitionId === competitionId,
  );
}

/** One division's season: its name, its tier, and the table it ended on. */
function leagueRecord(state: GameState, competition: Competition): SeasonLeagueRecord {
  return {
    competitionId: competition.id,
    name: competition.name,
    tier: competition.tier,
    rows: standingsFor(state, competition),
  };
}

/**
 * One cup's season: the field it was drawn from, every round it played, and who
 * won it.
 *
 * The rounds come from the plan the season was built with, and each one's ties
 * from the competition's own fixture list — so a bye round is recorded with the
 * field it held and no ties, rather than being skipped as a round that did not
 * happen. A save written before plans existed has only the rounds it actually
 * drew, which is the whole cup it can be shown, and is read as such.
 */
function cupRecord(state: GameState, competition: Competition): SeasonCupRecord {
  const plan = planOf(competition);
  // `entrants` is read off the ties rather than taken from the plan, because the
  // plan counts a round of an odd number of clubs as if all of them played one:
  // the county cup's round of seventeen says seventeen entrants while sixteen of
  // them are in eight ties and the seventeenth is on a bye. The ties are what
  // happened, so the byes — the difference between a round's field and the clubs
  // it actually put out — come out right for every round, odd or even.
  const rounds: SeasonCupRoundRecord[] =
    plan.length > 0
      ? plan.map((entry) => {
          const ties = matchesForRound(state, competition, entry.round).map(tieRecord);
          return {
            round: entry.round,
            name: cupRoundName(competition, entry.round),
            field: entry.field,
            entrants: ties.length * 2,
            date: roundDrawDate(state, competition, entry.round),
            ties,
          };
        })
      : cupRoundSummaries(state, competition).map((summary) => ({
          round: summary.round,
          name: summary.name,
          // With no plan there is nothing that says how many clubs the round held
          // outside its ties, so the ties are the whole of what it can say.
          field: summary.ties.length * 2,
          entrants: summary.ties.length * 2,
          date: summary.date,
          ties: summary.ties.map(tieRecord),
        }));

  return {
    competitionId: competition.id,
    name: competition.name,
    clubIds: entrantsOf(rounds),
    rounds,
    winnerClubId: competition.cup?.winnerClubId ?? null,
    runnerUpClubId: competition.cup?.runnerUpClubId ?? null,
  };
}

/**
 * Every club that played a tie in the competition, sorted.
 *
 * Deliberately *not* `competition.clubIds`. That list is the live entry list the
 * day loop maintains — the clubs still in it — so on the day the season closes it
 * holds the two finalists and nothing else, and reading it into the archive would
 * record a thirty-six-club cup as a two-club one whose rounds happen to have
 * thirty-six names in them.
 *
 * The ties are the truth instead. A club in the field of a competition plays at
 * least one tie before it is over — a bye in the opening round means it comes in
 * at the next one, and only the winner of the last round never loses — so the
 * clubs across every round are the clubs that were in it. Where a competition
 * never got past its opening round there is nothing else to read, and the ties
 * are the whole of what it can honestly say.
 */
function entrantsOf(rounds: readonly SeasonCupRoundRecord[]): ClubId[] {
  const ids = new Set<ClubId>();
  for (const round of rounds) {
    for (const tie of round.ties) {
      ids.add(tie.homeClubId);
      ids.add(tie.awayClubId);
    }
  }
  return [...ids].sort();
}

/**
 * One tie, as it finished.
 *
 * A tie that was called off and replayed is recorded once, as the game that was
 * actually played: `matchesForRound` leaves out the original fixture, which will
 * never be played, so the round cannot read as two ties between the same two
 * clubs with one of them won twice.
 */
function tieRecord(match: Match): SeasonTieRecord {
  const result = match.result;
  return {
    homeClubId: match.homeClubId,
    awayClubId: match.awayClubId,
    score: result ? { home: result.homeGoals, away: result.awayGoals } : null,
    ...(result?.penalties ? { penalties: { home: result.penalties.home, away: result.penalties.away } } : {}),
    // `winnerOf` assumes a settled tie and would name the home club for a game
    // that was never played, which is exactly the claim the archive must not make.
    winnerClubId: result ? winnerOf(match) : null,
  };
}
