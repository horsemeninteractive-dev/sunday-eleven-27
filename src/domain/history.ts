import type { StandingRow } from './club';
import type { ClubId, CompetitionId, ISODate, SeasonId } from './ids';

/**
 * A season's competitions, as the record of them.
 *
 * A season is a clean sheet: at the boundary the divisions are cut again, the
 * cups are redrawn from a field that has had clubs promoted into it and
 * relegated out of it, and every one of last season's ties goes with the record
 * that held it. What was left a season later was the *shape* of the world — a
 * club's own line of points and the honours on its shelf — and nothing of the
 * football itself: the bracket that was played, who was drawn into it, and which
 * club went out in which round were all unreachable the moment the new calendar
 * existed.
 *
 * This is that record, written once as the season closes, and kept. It is
 * deliberately a *reading* of the season rather than a second copy of it: the
 * tables are the same rows `standingsFor` computes, the ties are the same
 * matches, and nothing here is invented to fill a gap. Nothing in the archive is
 * ever written to again — a season, once archived, is a fact about the past, and
 * the ladder above it moves on without it.
 *
 * The archive is bounded (`SEASON_HISTORY_LIMIT`): a career is finite but its
 * competitive record is not, and a save that carried every tie of every season
 * for ever would grow without a reason — the same reason news, ledgers and
 * standing history are capped.
 */

/** One tie of a cup, as it finished. */
export interface SeasonTieRecord {
  homeClubId: ClubId;
  awayClubId: ClubId;
  /**
   * Goals at the end of normal and extra time, or null for a tie that was never
   * played — one called off with no room left to replay it before the season
   * closed. Kept as absence rather than as 0-0, because a tie nobody played is
   * not a goalless draw.
   */
  score: { home: number; away: number } | null;
  /** The shootout, where the tie was level after extra time. */
  penalties?: { home: number; away: number };
  /** The club that went through, or null for a tie that produced no winner. */
  winnerClubId: ClubId | null;
}

/** One round of a cup: its date, the size of its field, and its ties. */
export interface SeasonCupRoundRecord {
  /** 1-based, as the plan numbers it. */
  round: number;
  /** 'Final', 'Semi-finals', 'Round of 32'. */
  name: string;
  /**
   * Clubs the round held, and how many of them played a tie in it.
   *
   * Both are kept because a bye is not an absence: a thirty-six-club cup opens
   * with eight clubs playing and twenty-eight sitting it out, and a record that
   * kept only the ties would say those twenty-eight were never in the round. The
   * difference between the two *is* the byes.
   *
   * The entrants are counted from the ties rather than taken from the plan the
   * season was built with, which counts a round of an odd number of clubs as if
   * all of them played one — the county cup's round of seventeen is eight ties
   * and a club on a bye, and a record that said seventeen played would have the
   * byes wrong in every round below it.
   */
  field: number;
  entrants: number;
  date: ISODate | null;
  ties: SeasonTieRecord[];
}

/** A knockout competition's season: who was in it, what was played, and who won it. */
export interface SeasonCupRecord {
  competitionId: CompetitionId;
  name: string;
  /**
   * Every club that played a tie in it, sorted — the field it was actually
   * drawn from, byes included.
   *
   * Read off the ties rather than off the competition's entry list, which by the
   * day the season closes holds only the clubs still in it. A club that sat out
   * the opening round on a bye played the round after it, so the field is whole.
   */
  clubIds: ClubId[];
  rounds: SeasonCupRoundRecord[];
  winnerClubId: ClubId | null;
  runnerUpClubId: ClubId | null;
}

/** A division's season: its final table, as it stood when the last Sunday was played. */
export interface SeasonLeagueRecord {
  competitionId: CompetitionId;
  name: string;
  /** 1 is the top division of its ladder. */
  tier: number;
  /** The final table, best first — the rows the season ended with. */
  rows: StandingRow[];
}

/** One finished season, whole. */
export interface SeasonRecord {
  seasonId: SeasonId;
  seasonLabel: string;
  leagues: SeasonLeagueRecord[];
  cups: SeasonCupRecord[];
}

/**
 * How many finished seasons a career keeps.
 *
 * Long enough that the table a manager was promoted out of is still there when
 * his first season up is over, and short enough that a fifty-season career does
 * not carry fifty seasons of ties around. The oldest is dropped whole, so the
 * archive never holds half a season.
 */
export const SEASON_HISTORY_LIMIT = 12;
