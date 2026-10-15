import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { formatDayMonth, formatKickOff } from '@/simulation/calendar';
import {
  cupRoundMatchday,
  cupRoundName,
  cupRoundSummaries,
  isPostponed,
  matchesForRound,
  planOf,
  roundDrawDate,
  tieScoreLine,
  winnerOf,
} from '@/simulation/cup';
import { cupCompetitions } from '@/simulation/pyramid';

/**
 * A knockout, read as the whole of itself.
 *
 * The cup screen used to show one round at a time — the round in hand at full
 * weight, everything before it behind a disclosure — and nothing after it at all.
 * That is half a bracket: the point of a knockout is the *road*, so a manager
 * could not see that his preliminary winners go into a round of thirty-two, could
 * not see when the final is, and could not see a Plate's shape before the main cup
 * had fed it. This reads the competition's whole plan instead: every round, its
 * date, how many clubs it holds and how many of them actually play a tie in it,
 * the ties where they have been drawn, and where the manager's own club stands in
 * each one.
 *
 * Everything here is derived, and derived from the same records the rest of the
 * game reads: the plan is the competition's own statement of its shape, the ties
 * are its matches carrying its id, the dates come off the calendar it was built
 * on, and whether the manager is in a round is answered by the entry list the day
 * loop maintains (`competition.clubIds`) plus the ties he actually played. Nothing
 * is written, so reading a bracket cannot move a club, a round or a date.
 *
 * Two readings deserve their own note, because they are the ones a bracket gets
 * wrong if it guesses:
 *
 *  - **A bye is not an absence.** A 36-club cup opens with a preliminary of eight
 *    and twenty-eight clubs sit it out. Those clubs are in the competition and in
 *    the round after it, and the stage says so rather than leaving a manager to
 *    conclude he was never entered. It is read off the plan's own arithmetic — the
 *    round's field against its entrants — and never off the ties, which cannot see
 *    a club that did not play.
 *  - **A round that has not been drawn is not a round he is out of.** Rounds after
 *    the one in hand are shown with their date and their size and no ties, because
 *    that is all anybody knows: the draw follows the round before it. A club still
 *    in the competition is told it is still in it, and nothing more.
 *
 * A save written before plans existed has none, and for it the rounds it has
 * actually drawn are the bracket it has — the same defensive reading the rest of
 * the cup screens keep.
 */

/** Where the manager's own club stands in one round. */
export type RoadStanding =
  /** He played it and won. */
  | 'through'
  /** He played it and lost. */
  | 'out'
  /** Drawn, not yet played: his next tie. */
  | 'toPlay'
  /** Drawn, called off, waiting on the replay. */
  | 'postponed'
  /** He was in the round's field and it was played without him: a bye. */
  | 'sittingOut'
  /** The round is about to be played and he is in its entry list. */
  | 'inTheDraw'
  /** A round still ahead of the football that decides it. */
  | 'ahead'
  /** The competition has moved on past him. */
  | 'notIn';

/**
 * The manager's own line in one round: what he did, what he is doing, or what he
 * is waiting for. Written beside the fact it comes from so the phrase and the fact
 * cannot drift apart.
 */
export interface BracketRoad {
  standing: RoadStanding;
  /** His tie in this round, when the round has one for him. */
  tie?: Match;
  /** The club he met or meets. */
  opponentId?: ClubId;
  /** One line of fact: 'beat Padkiln Athletic 2–1', 'v Shelfden British Legion'. */
  line: string;
  /**
   * The second line, where there is one: the date of a tie still to play,
   * 'Won it', the round it puts him into. Standing is left to the standing —
   * the word 'Bye' twice on one row is a row nobody proof-read.
   */
  note: string;
  tone: 'ok' | 'bad' | 'accent' | 'warn' | 'muted';
}

/** One round of a cup, as the bracket shows it. */
export interface BracketStage {
  round: number;
  /** 'Final', 'Semi-finals', 'Round of 32', 'Preliminary Round'. */
  name: string;
  /** The round's date, drawn or not: every round of a built season has one. */
  date: ISODate | null;
  /** Clubs the plan puts in the round, and how many of them play a tie in it. */
  field: number;
  entrants: number;
  /** Clubs that sit the round out on a bye: the field minus the ones who play. */
  byes: number;
  /** Every tie drawn for the round, postponements included. */
  ties: Match[];
  /** Every tie in it has been settled. */
  complete: boolean;
  /** Nothing has been drawn for it yet. */
  undrawn: boolean;
  /** The round about to be played. */
  inHand: boolean;
  /** The last round there is: the one that crowns the competition. */
  final: boolean;
  /** What the round is worth to the manager's own club, or null when he is not in this competition. */
  road: BracketRoad | null;
}

/** One round of the shape, before the ties and the manager are read into it. */
interface PlannedRound {
  round: number;
  name: string;
  field: number;
  entrants: number;
}

/**
 * The whole bracket of one cup, opening round first and the final last.
 *
 * `clubId` is the manager's club, which may have nothing to do with this
 * competition at all — the county has five cups in it and a manager is in three of
 * them — in which case every stage comes back with no road on it and the screen
 * draws the competition without marking anybody.
 */
export function cupBracket(state: GameState, competition: Competition, clubId: ClubId): BracketStage[] {
  const cup = competition.cup;
  if (!cup) return [];

  const plan = planOf(competition);
  const summaries = cupRoundSummaries(state, competition);
  const summaryOf = new Map(summaries.map((summary) => [summary.round, summary]));
  /** One round's ties: the summary's where there is one, the matches otherwise. */
  const tiesOf = (round: number): Match[] =>
    summaryOf.get(round)?.ties ?? matchesForRound(state, competition, round);

  // The plan is the shape; a save written before plans existed has only the rounds
  // it has drawn, which is the whole bracket it can be shown.
  const rounds: PlannedRound[] =
    plan.length > 0
      ? plan.map((entry) => ({
          round: entry.round,
          name: cupRoundName(competition, entry.round),
          field: entry.field,
          entrants: entry.entrants,
        }))
      : summaries.map((summary) => ({
          round: summary.round,
          name: summary.name,
          field: summary.ties.length * 2,
          entrants: summary.ties.length * 2,
        }));
  if (rounds.length === 0) return [];

  const lastRound = plan.length > 0 ? plan[plan.length - 1]!.round : null;
  const stageRound = cup.round;

  // Is his club in this competition at all? The entry list the day loop keeps, or
  // a tie it has already drawn — which is how a club that has been knocked out is
  // still read as having been in it.
  const competing =
    competition.clubIds.includes(clubId) ||
    rounds.some((entry) => tieOfClub(tiesOf(entry.round), clubId) !== undefined);

  // The round he went out in, if he has gone out. Read in round order, because a
  // club can only be eliminated once and it is the *first* loss that is the truth:
  // a Plate's field is drawn from the main cup's losers, so a club can lose in
  // each competition and the two are separate roads.
  let eliminatedIn: number | null = null;
  if (competing) {
    for (const entry of rounds) {
      const tie = tieOfClub(tiesOf(entry.round), clubId);
      const winner = tie ? winnerOf(tie) : null;
      if (winner && winner !== clubId) {
        eliminatedIn = entry.round;
        break;
      }
    }
  }

  return rounds.map((entry) => {
    const ties = tiesOf(entry.round);
    const summary = summaryOf.get(entry.round);
    const stage: BracketStage = {
      ...entry,
      date: stageDate(state, competition, entry.round, summary?.date ?? null),
      byes: Math.max(0, entry.field - entry.entrants),
      ties,
      complete: summary?.complete ?? false,
      undrawn: ties.length === 0,
      inHand: entry.round === stageRound && !cup.complete,
      final: lastRound !== null && entry.round === lastRound,
      road: null,
    };
    stage.road = competing
      ? roadFor(state, competition, {
          clubId,
          stage,
          rounds,
          eliminatedIn,
          stageRound,
        })
      : null;
    return stage;
  });
}

/** The stage a bracket should open on: the round in hand, or the final once there is none. */
export function openStageOf(stages: readonly BracketStage[]): number | null {
  return stages.find((stage) => stage.inHand)?.round ?? stages[stages.length - 1]?.round ?? null;
}

/**
 * What a round nobody has drawn yet is waiting on, in one line.
 *
 * A round that has not been drawn is not a round with nothing to say. It has a
 * date and a size, and it is waiting on one of two things: the round before it to
 * be settled, or — for the first round of a Plate — the competition that feeds it
 * to hand its losers down. Saying which, on the round itself, is the difference
 * between a bracket that looks unfinished and one that is telling the manager what
 * his competition is doing.
 */
export function drawNote(
  state: GameState,
  competition: Competition,
  rounds: readonly { round: number; name: string }[],
  round: number,
): string {
  const fed = fedByLine(state, competition);
  if (fed && rounds[0]?.round === round) return `${fed} — nobody is in it yet`;
  const before = rounds.find((entry) => entry.round === round - 1);
  if (!before) return 'The draw has not been made yet';
  // The semi-finals *are* settled and the final *is*: the round's own name is the
  // only thing that knows which, and a bracket reading "Drawn once the
  // Semi-finals is settled" is a bracket nobody proof-read.
  return `Drawn once the ${before.name} ${before.name.endsWith('s') ? 'are' : 'is'} settled`;
}

/** The manager's tie in one round's ties, if he has one. */
function tieOfClub(ties: readonly Match[], clubId: ClubId): Match | undefined {
  return ties.find((tie) => tie.homeClubId === clubId || tie.awayClubId === clubId);
}

/**
 * A round's date.
 *
 * A drawn round is dated by its ties, which is what a manager checks the fixture
 * list against and what a rearranged tie moves. A round that has not been drawn
 * has no ties to read, and it is still dated: the season build dates every round
 * of every plan when it lays the calendar out, which is what makes it possible to
 * say when the final is a season in advance.
 */
function stageDate(
  state: GameState,
  competition: Competition,
  round: number,
  drawnDate: ISODate | null,
): ISODate | null {
  if (drawnDate) return drawnDate;
  const drawn = roundDrawDate(state, competition, round);
  if (drawn) return drawn;
  const matchday = cupRoundMatchday(state, competition, round);
  return state.season.calendar.find((entry) => entry.matchday === matchday)?.date ?? null;
}

/**
 * Where the manager's club stands in one round.
 *
 * The order of the questions is the order a manager asks them: did I play this
 * round, did I lose before it, is it the round I am waiting on, or am I nowhere
 * near it. Everything a round says about a club is derived from the ties and from
 * the entry list — never from the calendar date, which knows nothing about who is
 * in a round.
 */
function roadFor(
  state: GameState,
  competition: Competition,
  read: {
    clubId: ClubId;
    stage: BracketStage;
    rounds: readonly PlannedRound[];
    eliminatedIn: number | null;
    stageRound: number;
  },
): BracketRoad {
  const { clubId, stage, rounds, eliminatedIn, stageRound } = read;
  const tie = tieOfClub(stage.ties, clubId);

  if (tie) {
    const isHome = tie.homeClubId === clubId;
    const opponentId = isHome ? tie.awayClubId : tie.homeClubId;
    const opponent = state.clubs[opponentId]?.identity.name ?? 'a club';

    if (isPostponed(tie)) {
      return {
        standing: 'postponed',
        tie,
        opponentId,
        line: `${isHome ? 'v' : 'at'} ${opponent}`,
        note: tie.postponementReason ? `${tie.postponementReason} — a replay will be found` : 'Called off',
        tone: 'warn',
      };
    }
    if (!tie.played) {
      return {
        standing: 'toPlay',
        tie,
        opponentId,
        line: `${isHome ? 'v' : 'at'} ${opponent}`,
        note: `${formatDayMonth(tie.date)} · ${formatKickOff(tie.kickOff)}`,
        tone: 'accent',
      };
    }
    const won = winnerOf(tie) === clubId;
    return {
      standing: won ? 'through' : 'out',
      tie,
      opponentId,
      line: `${won ? 'beat' : 'lost to'} ${opponent} ${tieScoreLine(tie)}`,
      // A tie he lost needs no second line: the row *is* the round he went out in,
      // and "Out in the Round of 32" under a pill reading Out and a row headed
      // Round of 32 is the same fact three times.
      note: won ? (stage.final ? 'Won it' : `Into the ${nextRoundName(competition, stage.round)}`) : '',
      tone: won ? 'ok' : 'bad',
    };
  }

  // No tie of his in this round, and he lost one before it: the competition has
  // moved on without him.
  if (eliminatedIn !== null && stage.round > eliminatedIn) {
    return { standing: 'notIn', line: 'Not in it', note: '', tone: 'muted' };
  }

  // A round that has been drawn without him, and no loss behind him: he was in
  // its field and sat it out on a bye. This is the reading a bracket gets wrong
  // if it counts ties instead of entrants — a preliminary of eight out of a field
  // of thirty-six leaves twenty-eight clubs in the competition and out of the
  // draw, and they are in at the round after it.
  if (!stage.undrawn || stage.complete || stage.round < stageRound) {
    return {
      standing: 'sittingOut',
      line: `In at the ${nextRoundName(competition, stage.round)}`,
      note: '',
      tone: 'muted',
    };
  }

  // The round about to be played and not drawn yet, with him in the entry list:
  // the draw is the only thing still to happen.
  if (stage.round === stageRound && competition.clubIds.includes(clubId)) {
    return {
      standing: 'inTheDraw',
      line: drawNote(state, competition, rounds, stage.round),
      note: '',
      tone: 'accent',
    };
  }

  // A round still ahead of the football that decides it. Nobody knows who is in it
  // — a club still in the cup is told that much and nothing more.
  if (stage.round > stageRound && competition.clubIds.includes(clubId)) {
    return {
      standing: 'ahead',
      line: drawNote(state, competition, rounds, stage.round),
      note: '',
      tone: 'muted',
    };
  }

  return { standing: 'notIn', line: 'Not in it', note: '', tone: 'muted' };
}

/** The round after this one, by name, for a club that has just gone through. */
function nextRoundName(competition: Competition, round: number): string {
  const next = planOf(competition).find((entry) => entry.round === round + 1);
  return next ? cupRoundName(competition, next.round) : 'next round';
}

/**
 * What feeds a consolation cup, when this round is inside a competition that has
 * not been filled yet.
 *
 * A Plate opens the season with nobody in it: it is filled from the League Cup's
 * opening rounds, so a club that has not lost there is not in the Plate and may be
 * about to be. Saying so is the honest reading — it is the competition's own rule,
 * written on the cup itself (`consolationFor`).
 */
function fedByLine(state: GameState, competition: Competition): string | null {
  const source = competition.cup?.consolationFor;
  if (!source) return null;
  const feeder = cupCompetitions(state).find((cup) => cup.id === source);
  return feeder ? `Fed by the ${feeder.name}'s opening rounds` : null;
}
