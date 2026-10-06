import type { Competition, CupRound, CupState, FixtureList } from '@/domain/competition';
import { isCup } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate, MatchId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import {
  addDays,
  canPlayOnWeekday,
  CUP_KICKOFF,
  cupMatchdayFor,
  isChristmasBreak,
  toDate,
  type CupRoundSlot,
} from './calendar';
import { rearrangementDeadlineFor } from './postponement';
import { isLeagueMatchday } from './timeline';
import { createMatchRecord } from './matchday';
import { createEvent } from './news';
import { isActiveFixture } from './postponement';
import { registerFixture, tierOf } from './pyramid';
import { Rng, stream } from './rng';

/**
 * Knockout competitions.
 *
 * A cup is a competition with no table: its progress is the set of matches that
 * carry its id, and everything else — who is left in it, who has gone out, who
 * won it — is derived from those matches rather than stored beside them. The one
 * thing stored is the *round counter* on the competition, because that is the
 * one fact the simulation needs and cannot read off a result.
 *
 * The draw itself is the only interesting decision. It is random, as the design
 * document says it should be, with two qualifications that stop it being
 * nonsense: a club is never drawn against itself, and no club plays twice in
 * the same round. Beyond that it is a bag, seeded from the world seed and the
 * competition id, so the same career always gets the same draw.
 */

/**
 * How many clubs enter the opening round of a cup's preliminary.
 *
 * Eight, so it is four ties, so four go through and four go down. That is the
 * smallest prelim that leaves a whole number of winners to drop into a round
 * below.
 */
export const PRELIMINARY_SIZE = 8;

/** How many clubs the main cup's first-round losers send down to the Plate. */
export const PLATE_PRELIMINARY_FROM_FIRST_ROUND = 4;

/**
 * The main cup's rounds for a field of `entranceCount` clubs.
 *
 * A pyramid of 36 does not fit a knockout without byes — 36 is not a power of
 * two and pairing it blind produces a round of nine and then a round of five,
 * which nobody would call a cup. So the bottom of the ladder plays a
 * preliminary: eight clubs, four ties, four winners. Those four join the other
 * twenty-eight on a bye to make a round of thirty-two, and it runs clean from
 * there — 32, 16, 8, 4, 2 — which is 35 ties across the season and guarantees
 * every club plays at least twice before it can be knocked out.
 *
 * The preliminary takes the *lowest-seeded* clubs, which is the usual way round
 * it works: the bottom of the county earns its place rather than being handed
 * one.
 */
export function mainCupPlan(entranceCount: number): CupRound[] {
  if (entranceCount < 2) return [];
  const rounds: CupRound[] = [];
  let field = entranceCount;

  // Only worth a preliminary if there is something for the winners to drop
  // into: a field that already halves cleanly does not need one.
  const preliminary = field >= PRELIMINARY_SIZE * 2 ? PRELIMINARY_SIZE : 0;
  if (preliminary > 0) {
    rounds.push({ round: 1, field, entrants: preliminary });
    // Winners plus the clubs that sat this one out.
    field = field - preliminary + preliminary / 2;
  }

  let round = rounds.length + 1;
  while (field > 1) {
    rounds.push({ round, field, entrants: field });
    round += 1;
    field = field <= 2 ? 1 : Math.ceil(field / 2);
  }
  return rounds;
}

/**
 * The Plate's rounds, fed from the main cup's preliminary losers and its
 * round-of-thirty-two losers.
 *
 * Twenty clubs are available: four who lost the preliminary and sixteen who
 * lost the round of thirty-two. Eight of them play a Plate preliminary — the
 * four preliminary losers, who have to be eliminated somewhere, plus four of
 * the thirty-two losers — and the other twelve sit the round out and join the
 * four winners in a round of sixteen. From there it is the same clean run as
 * the main cup: 16, 8, 4, 2, for nineteen ties in the season.
 */
export function platePlan(mainPlan: readonly CupRound[]): CupRound[] {
  const preliminary = mainPlan[0];
  if (!preliminary) return [];
  // With a preliminary the Plate is fed from two rounds — the preliminary's
  // losers and the round of thirty-two's. Without one there is only the opening
  // round to feed from, and reading round two as well would pull in clubs who
  // went out of a competition they were never eligible for.
  const hasPreliminary = preliminary.entrants < preliminary.field;
  const firstRound = hasPreliminary ? mainPlan[1] : preliminary;
  if (!firstRound) return [];

  // Losers the main cup hands down: the preliminary's, plus every one of the
  // round of thirty-two's. Which of them actually play the Plate's preliminary
  // is `platePreliminaryLineup`'s business, not this function's — this only
  // needs to know how many there are.
  const prelimLosers = hasPreliminary ? preliminary.entrants / 2 : 0;
  const available = prelimLosers + firstRound.entrants / 2;
  const rounds: CupRound[] = [];

  // The Plate's own preliminary, but only when there are more clubs than can
  // sensibly play in it: eight entrants makes four ties, and the winners plus
  // the byes have to come to a whole number of clubs for the round below.
  const playIn = Math.min(PRELIMINARY_SIZE, available);
  const nextField = available - playIn + playIn / 2;
  if (playIn >= 4 && playIn < available && nextField === Math.ceil(nextField / 2) * 2) {
    rounds.push({ round: 1, field: available, entrants: playIn });
  }

  let field = rounds.length > 0 ? nextField : available;
  let round = rounds.length + 1;
  while (field > 1) {
    rounds.push({ round, field, entrants: field });
    round += 1;
    field = field <= 2 ? 1 : Math.ceil(field / 2);
  }
  return rounds;
}

/**
 * Split the Plate's entrants into the ones who play its preliminary and the ones
 * who get a bye into the round of sixteen.
 *
 * `required` are the clubs that have to be in the tie: the main cup's
 * preliminary losers, who have already been knocked out once and cannot be left
 * carrying the Plate's preliminary as a walkover. They fill the places first,
 * and the rest come from `available` in the order given — which is the order
 * the main cup reported them eliminated, so the split is derived from the draw
 * rather than invented here.
 *
 * The byes are the point of the round: twelve clubs who lost the round of
 * thirty-two join the four winners to make sixteen.
 */
export function platePreliminaryLineup(
  available: readonly ClubId[],
  required: readonly ClubId[],
  entrants: number,
): { playIn: ClubId[]; byes: ClubId[] } {
  const playIn: ClubId[] = [];
  const pool = new Set(available);
  for (const clubId of required) {
    if (playIn.length >= entrants || !pool.delete(clubId)) continue;
    playIn.push(clubId);
  }
  for (const clubId of available) {
    if (playIn.length >= entrants) break;
    if (!pool.delete(clubId)) continue;
    playIn.push(clubId);
  }
  return { playIn, byes: [...pool] };
}

/** How many rounds a whole-pyramid cup needs, and where each one lands. */
export function cupRoundSlots(entranceCount: number, leagueMatchdays: number): CupRoundSlot[] {
  const rounds = mainCupPlan(entranceCount);
  if (rounds.length === 0) return [];

  // Spread the rounds across the league season rather than bunching them at the
  // start, and keep every round inside the league calendar so a cup tie is
  // always settled inside the season that drew it.
  return rounds.map((_size, index) => ({
    round: index + 1,
    beforeMatchday: matchdayForCupRound(index, rounds.length, leagueMatchdays),
  }));
}

/**
 * Which league matchday a cup round is played in the week before.
 *
 * `index` is the round's position among *all* the season's cup rounds and
 * `total` how many there are, so both competitions can be spread through the
 * season together rather than one after the other — see `allCupRoundSlots`.
 *
 * The last round is pinned to the final matchday rather than falling where the
 * arithmetic puts it, so the League Cup final is a spring Sunday rather than
 * whenever the division of the season happens to land. The very first round
 * stays early, because a cup that opens in March is not a cup.
 */
function matchdayForCupRound(index: number, total: number, leagueMatchdays: number): number {
  const first = 2;
  const last = leagueMatchdays;
  if (index === 0) return first;
  if (total <= 1) return last;
  if (index === total - 1) return last;
  return Math.max(first, Math.min(last, Math.round(((index + 1) * last) / (total + 1))));
}

/**
 * Every cup round in the season: the main cup's, then the consolation cup's.
 *
 * One list, so the calendar, the draw and the round-advance all agree on which
 * date a round falls on.
 *
 * The two competitions' rounds are laid out *together* across the season rather
 * than one after the other. There is not the room to do it any other way: a
 * twelve-club division plays twenty-two matchdays, the League Cup needs six
 * rounds and the Plate needs five more, and putting the Plate after the League
 * Cup's final leaves it two matchdays to play five rounds in — every one of them
 * on the same night. Interleaved, they alternate down the season instead.
 *
 * The Plate's first round is second in the list, which is what it has to be: it
 * is fed from the League Cup's preliminary and first-round losers, so it cannot
 * be drawn before those rounds have been played.
 */
export function allCupRoundSlots(leagueField: number, leagueMatchdays: number, consolation: boolean): CupRoundSlot[] {
  const main = mainCupPlan(leagueField);
  if (main.length === 0) return [];
  const plate = consolation ? platePlan(main) : [];

  const all = [
    ...main.map((entry) => ({ round: entry.round })),
    ...plate.map((entry) => ({ round: entry.round })),
  ];

  // Spread every round across the season, keeping them all inside the league
  // calendar so a cup tie is settled in the season that drew it. Distinct
  // matchdays mean distinct Wednesdays, which is what stops a club being asked
  // for two ties on one night.
  return all.map((slot, index) => ({
    ...slot,
    beforeMatchday: matchdayForCupRound(index, all.length, leagueMatchdays),
  }));
}

/**
 * Seed a field so the first round pairs sensibly.
 *
 * With 36 clubs in a knockout, a flat bag gives a Division One club in the
 * first round as often as not, and the first two rounds produce a lot of ties
 * nobody would call a tie. Seeding by tier — and within a tier by reputation —
 * means the early rounds are mostly neighbours and near-neighbours, which is
 * what a county cup draw actually looks like, and it means the top of the
 * pyramid is still winning in round five rather than in round one.
 *
 * The seed order is then shuffled within bands of four, so a tier boundary
 * still produces some awkward ties rather than a perfectly tier-aligned
 * bracket.
 */
export function seedOrder(state: GameState, clubIds: readonly ClubId[]): ClubId[] {
  const ranked = [...clubIds].sort((a, b) => {
    const tierA = tierOf(state, a) ?? 99;
    const tierB = tierOf(state, b) ?? 99;
    if (tierA !== tierB) return tierA - tierB;
    const repA = state.clubs[a]?.reputation ?? 0;
    const repB = state.clubs[b]?.reputation ?? 0;
    if (repA !== repB) return repB - repA;
    return a.localeCompare(b);
  });

  const rng = new Rng(`seed-order::${ranked.join(',')}`);
  const seeded: ClubId[] = [];
  // Shuffle in bands of four so the seeding is real but not mechanical.
  for (let start = 0; start < ranked.length; start += 4) {
    seeded.push(...rng.shuffle(ranked.slice(start, start + 4)));
  }
  return seeded;
}

/** Split a field into ties: pairs, and one club a bye when the number is odd. */
export function pairUp(rng: Rng, field: readonly ClubId[]): Array<[ClubId, ClubId] | [ClubId]> {
  const shuffled = rng.shuffle(field);
  const ties: Array<[ClubId, ClubId] | [ClubId]> = [];
  for (let index = 0; index < shuffled.length; index += 2) {
    const home = shuffled[index]!;
    const away = shuffled[index + 1];
    ties.push(away ? [home, away] : [home]);
  }
  return ties;
}

/**
 * The club that won a tie.
 *
 * A knockout tie is never a draw: if the ninety minutes were level and penalties
 * were needed, the engine wrote down which club went through. Reading the
 * shootout record rather than comparing goals is what keeps a 1-1 decided on
 * penalties from being recorded as a draw and eliminating nobody.
 */
export function winnerOf(match: Match): ClubId {
  if (match.shootoutWinnerId) return match.shootoutWinnerId;
  const goals = match.result;
  if (!goals) return match.homeClubId;
  return goals.homeGoals > goals.awayGoals ? match.homeClubId : match.awayClubId;
}

/** The club that went out of a tie. */
export function loserOf(match: Match): ClubId {
  return winnerOf(match) === match.homeClubId ? match.awayClubId : match.homeClubId;
}

/** How a tie is described once it has been played. */
export function tieScoreLine(match: Match): string {
  if (!match.result) return 'not played';
  const base = `${match.result.homeGoals}-${match.result.awayGoals}`;
  if (!match.result.penalties) return base;
  return `${base} (${match.result.penalties.home}-${match.result.penalties.away} pens)`;
}

export interface CupDrawResult {
  events: GameEvent[];
  ties: MatchId[];
}

/**
 * Draw and schedule one round of a cup.
 *
 * Returns null when there is nothing to draw — the competition is finished, or
 * it is not this round yet — so the caller can ask every week without guarding.
 */
export function drawCupRound(
  state: GameState,
  competition: Competition,
  context: {
    seasonId: string;
    seasonLabel: string;
    leagueMatchdays: number;
    /** Announce the draw as news. Only the rounds the manager could act on. */
    announce?: boolean;
    /** The consolation cup takes the losers of this round rather than a field. */
    consolation?: boolean;
    /**
     * Exactly which clubs play this round.
     *
     * Only needed where the choice is not "the bottom of the seed order": the
     * Plate's preliminary is fed a specific list of clubs that have to be in it,
     * and those cannot be picked out of a sorted field.
     */
    playIn?: readonly ClubId[];
  },
): CupDrawResult | null {
  const cup = competition.cup;
  if (!cup || cup.complete) return null;

  const round = cup.round;
  const field = competition.clubIds.filter((clubId) => state.clubs[clubId]?.active);
  if (field.length < 2) return null;

  // How many clubs this round actually puts into ties. A round planned with
  // fewer entrants than clubs has byes: the rest of the field stays in
  // `competition.clubIds`, and `readCupRound` brings them back out as survivors
  // when the round finishes because they never lost.
  const planned = cup.plan?.find((entry) => entry.round === round);
  const entrants = planned?.entrants ?? field.length;
  // A preliminary takes the bottom of the seed order, which is the point of it:
  // the lowest-seeded clubs in the county have to win something to be here.
  const drawn = context.playIn
    ? field.filter((clubId) => context.playIn!.includes(clubId))
    : entrants >= field.length ? field : field.slice(-entrants);
  if (drawn.length < 2) return null;

  const rng = stream(state.seed, 'cup-draw', context.seasonId, competition.id, round);
  const ties = pairUp(rng, drawn);
  const matchday = cupMatchdayFor(round, context.leagueMatchdays, cup.matchdayOffset ?? 0);
  // Only the clubs actually playing need the night free; a club on a bye is
  // somewhere else and must not push the round off its Wednesday.
  const date = playDateFor(state, matchday, drawn);
  if (!date) return null;

  const created: MatchId[] = [];
  ties.forEach((tie, index) => {
    const home = tie[0];
    const away = tie[1];
    if (!home) return;
    if (!away) return; // a bye: the club is simply not drawn this round
    const id = `${competition.id}_${context.seasonId}_r${round}_t${index + 1}` as MatchId;
    const match = createMatchRecord({
      state,
      id,
      matchday,
      date,
      homeClubId: home,
      awayClubId: away,
      competitionId: competition.id,
      competitionName: competition.name,
      kickOff: CUP_KICKOFF,
    });
    // A knockout tie is level at ninety minutes, so it goes to extra time and
    // then penalties. This is the only place the flag is ever set.
    match.knockout = true;
    state.matches[id] = match;
    registerFixture(state, competition.id, id, matchday);
    created.push(id);
    // Home and away are decided by the draw; a single-leg tie still gives the
    // away side the choice of ends, which is why the ground is the home club's.
    match.groundId = state.clubs[home]?.groundId ?? match.groundId;
  });

  const events: GameEvent[] = [];
  if (context.announce && created.length > 0) {
    events.push(createEvent(state, {
      type: 'cup-draw',
      importance: 2,
      clubIds: drawn,
      data: {
        headline: `${competition.name} round ${round} draw`,
        body: drawSentence(state, competition, created, context.seasonLabel),
        round,
        competition: competition.name,
      },
    }));
  }

  return { events, ties: created };
}

/** The draw, said the way the local paper lists it. */
function drawSentence(state: GameState, competition: Competition, tieIds: readonly MatchId[], seasonLabel: string): string {
  const listed = tieIds
    .slice(0, 6)
    .map((id) => {
      const match = state.matches[id];
      if (!match) return '';
      const home = state.clubs[match.homeClubId]?.identity.shortName ?? '?';
      const away = state.clubs[match.awayClubId]?.identity.shortName ?? '?';
      return `${home} v ${away}`;
    })
    .filter(Boolean)
    .join(', ');
  const more = tieIds.length > 6 ? `, and ${tieIds.length - 6} more ties` : '';
  return `${competition.name} round ${competition.cup?.round ?? 1} of the ${seasonLabel} season: ${listed}${more}.`;
}

/** The date a matchday falls on. */
function matchDateFor(state: GameState, matchday: number): ISODate | null {
  return state.season.calendar.find((entry) => entry.matchday === matchday)?.date ?? null;
}

/**
 * When a round is actually played.
 *
 * Normally the round's own slot in the calendar. Two things move it:
 *
 *  - A round can be drawn after its slot has gone — an earlier round's
 *    rearranged ties push it back — and a tie dated in the past would sit
 *    scheduled for ever, because nothing plays matches that have already been.
 *    The slot has to be *after* today rather than merely today: a round is drawn
 *    in the same day's processing as the tie that completed the round before it,
 *    so when that tie's replay lands on this round's own slot the slot is
 *    already today — and today's fixtures have been through the pitch. A tie
 *    dated today is never picked up either, and the season cannot close.
 *
 *  - The slot can already be spoken for. A rearranged league fixture lands on a
 *    spare Sunday, and if it lands on the same Sunday a cup round wants, one club
 *    ends up booked to play twice. The round moves to the next free Sunday
 *    nobody in its field is already playing rather than double-booking anybody.
 */
function playDateFor(state: GameState, matchday: number, clubIds: readonly ClubId[]): ISODate | null {
  const date = matchDateFor(state, matchday);
  if (!date || clubIds.length < 2) return date;
  // The round's own slot is the right date whenever it is still to come. The
  // guard used to demand three clear days, which a round drawn early in pre-season
  // could never satisfy — the slot was weeks away, not imminent — so the round
  // fell through to a search that settled for the next spare day instead, and a
  // tie dated on a day the clock then stepped over is how a cup round failed to
  // complete. A slot the club has since been given another game on is not taken
  // either: the round moves rather than double-booking anybody.
  if (date > state.date && fieldIsFree(state, clubIds, date)) return date;
  return nextFreeDateForField(state, clubIds);
}

/** True when none of these clubs already has a fixture on this date. */
function fieldIsFree(state: GameState, clubIds: readonly ClubId[], date: ISODate): boolean {
  return !clubIds.some((clubId) => clubBusyOn(state, clubId, date));
}

/** True when this club already has a fixture booked on this date. */
function clubBusyOn(state: GameState, clubId: ClubId, date: ISODate): boolean {
  return Object.values(state.matches).some(
    (other) =>
      other.date === date &&
      !other.played &&
      other.status !== 'abandoned' &&
      (other.homeClubId === clubId || other.awayClubId === clubId),
  );
}

/**
 * The next free day on which every club in the field is available.
 *
 * A cup round is one day for the whole field, so unlike a single rearranged
 * fixture there is no pairing to dodge the clash with — the date itself has to
 * move. It looks for a Sunday, because that is when this league plays, and falls
 * back to a Wednesday evening. Never a Thursday or a Saturday; see
 * `NO_GAME_WEEKDAYS`.
 *
 * Bounded by the same rearrangement deadline, so a round whose field is scattered
 * across a congested calendar is given up on rather than chased to the end of the
 * year.
 */
function nextFreeDateForField(state: GameState, clubIds: readonly ClubId[]): ISODate | null {
  const deadline = rearrangementDeadlineFor(state);
  // Never before the season starts. A career opens in pre-season, weeks before the
  // league's first Sunday, so a round drawn in late July would otherwise be moved
  // to the first free Wednesday *from today* — a date before the competition it
  // belongs to has even begun, and one that nothing will ever come round to play.
  const seasonStart = state.season.calendar[0]?.date ?? state.season.startDate;
  let candidate = addDays(state.date, 3);
  if (candidate < seasonStart) candidate = seasonStart;
  // The search runs as far as the rearrangement deadline, not for a fixed month.
  // A congested spring can leave every spare Sunday and Wednesday taken for weeks
  // on end, and a round that gave up after thirty days was never drawn at all:
  // the competition simply stopped, with no winner and an honour nobody ever
  // collected. The deadline is the real bound, and it is the one the doc comment
  // above always claimed was being used.
  while (candidate <= deadline) {
    const weekday = toDate(candidate).getUTCDay();
    // A round that has to move looks for a free Sunday first, the same as any
    // other fixture, and falls back to a Wednesday evening. Never a Thursday
    // (training) and never a Saturday (other football).
    if (
      (weekday === 0 || weekday === 3) &&
      canPlayOnWeekday(weekday) &&
      !isChristmasBreak(candidate) &&
      fieldIsFree(state, clubIds, candidate)
    ) {
      return candidate;
    }
    candidate = addDays(candidate, 1);
  }
  return null;
}

export interface CupRoundOutcome {
  /** Clubs still in the competition. */
  survivors: ClubId[];
  /** Clubs that went out this round. */
  eliminated: ClubId[];
  /** True when this round is over — every tie in it has been settled. */
  complete: boolean;
  /** True when this round produced a winner of the whole competition. */
  decided: boolean;
  winnerClubId: ClubId | null;
  runnerUpClubId: ClubId | null;
  events: GameEvent[];
}

/**
 * Read a played round back out of the matches.
 *
 * Everything about a cup's progress is derived here: who is left, who went out,
 * whether the final has been played. The competition's own `clubIds` is the
 * *entry list* for the next draw, and `cup.round` is the only thing that moves
 * forward — which means a cup can never double-draw a club or resurrect an
 * eliminated one, because neither could be derived from a result that has not
 * happened.
 */
export function readCupRound(state: GameState, competition: Competition): CupRoundOutcome {
  const cup = competition.cup;
  const empty: CupRoundOutcome = { survivors: competition.clubIds, eliminated: [], complete: false, decided: false, winnerClubId: null, runnerUpClubId: null, events: [] };
  if (!cup) return empty;

  const roundMatches = matchesForRound(state, competition, cup.round);
  // "Waiting" means still on the books as a fixture to be played. A tie that was
  // called off and could not be rearranged is abandoned, and an abandoned tie
  // goes to the home side on a technicality — the alternative is a cup that can
  // never finish.
  const waiting = roundMatches.filter((match) => isActiveFixture(match));
  if (roundMatches.length === 0 || waiting.length > 0) {
    return { ...empty, survivors: roundMatches.map((match) => match.homeClubId) };
  }

  const survivors: ClubId[] = [];
  const eliminated: ClubId[] = [];
  for (const match of roundMatches) {
    survivors.push(winnerOf(match));
    eliminated.push(loserOf(match));
  }
  // A club given a bye this round never played, so it is neither a survivor of
  // a tie nor eliminated: it is still in.
  const played = new Set(roundMatches.flatMap((match) => [match.homeClubId, match.awayClubId]));
  for (const clubId of competition.clubIds) {
    if (!played.has(clubId)) survivors.push(clubId);
  }

  const decided = survivors.length <= 1;
  const events: GameEvent[] = [];

  if (decided) {
    const winnerClubId = survivors[0] ?? null;
    cup.complete = winnerClubId !== null;
    cup.winnerClubId = winnerClubId;
    // The runner-up is the loser of the last tie actually played.
    const finalMatch = roundMatches[roundMatches.length - 1];
    cup.runnerUpClubId = finalMatch ? loserOf(finalMatch) : null;
    if (winnerClubId) events.push(...cupWinNews(state, competition, winnerClubId, finalMatch));
  }

  return { survivors, eliminated, complete: true, decided, winnerClubId: survivors[0] ?? null, runnerUpClubId: null, events };
}

/**
 * Every tie in a round of a cup, one entry per tie.
 *
 * A postponed tie leaves two fixtures on the same matchday: the original, which
 * will never be played, and the rearranged game that replaces it. Only the live
 * one counts — reading both would give the round two winners for one tie, and a
 * club would go out twice.
 */
export function matchesForRound(state: GameState, competition: Competition, round: number): Match[] {
  return tiesOnMatchday(state, competition, cupRoundMatchday(state, competition, round))
    .filter((match) => !match.replacedByMatchId);
}

/**
 * Every fixture booked for a matchday, including the ones that were called off.
 *
 * `matchesForRound` drops a tie that has been rearranged, because a postponed
 * game and its replay are two records of one tie and reading both would give the
 * round two winners for it. A fixture *list* is the opposite case: the game that
 * was called off happened, it happened on that date, and a manager looking at
 * his month wants to see it marked P-P next to the replay that replaced it.
 */
export function tiesOnMatchday(state: GameState, competition: Competition, matchday: number): Match[] {
  const list: FixtureList | undefined = state.fixtures?.[competition.id];
  if (!list) return [];
  return Object.entries(list.matchdayOf)
    .filter(([, entry]) => entry === matchday)
    .map(([id]) => state.matches[id])
    .filter((match): match is Match => Boolean(match));
}

/**
 * Whether a fixture was called off rather than played.
 *
 * A postponed fixture is not a cancelled one: it stays on the record on the date
 * it was due, and a replacement is created for a later date. The screens show
 * the first as P-P and the second as a fixture in its own right, because both are
 * true and a manager planning his month needs to see both.
 */
export function isPostponed(match: Match): boolean {
  return match.status === 'postponed' || match.status === 'abandoned';
}

/**
 * The matchday number a cup round is numbered on.
 *
 * League matchdays take 1..N, so a cup round is N + offset + round. The offset
 * is what keeps the League Cup and the Plate off each other's nights. The
 * calendar is the authority: if a round has no date in the calendar it simply
 * has no matchday, and nothing is played on it.
 */
export function cupRoundMatchday(state: GameState, competition: Competition, round: number): number {
  const league = state.season.calendar.filter((entry) => isLeagueMatchday(state, entry.matchday));
  return (league.length || state.season.calendar.length) + (competition.cup?.matchdayOffset ?? 0) + round;
}

/** True when a matchday number belongs to a league rather than a cup. */
export { isLeagueMatchday } from './timeline';

/**
 * A giant killing: a club from the bottom of the ladder past somebody from the
 * top of it, in a cup tie.
 *
 * The threshold is a tier gap rather than a result margin, because what makes a
 * cup tie memorable is not that it was a surprise scoreline — it is that the
 * pub side went to the club with the floodlights.
 */
export function isGiantKilling(state: GameState, match: Match): boolean {
  if (!isCup(state.competitions[match.competitionId])) return false;
  if (!match.result || !match.played) return false;
  const homeTier = tierOf(state, match.homeClubId);
  const awayTier = tierOf(state, match.awayClubId);
  if (homeTier === null || awayTier === null) return false;
  const winnerTier = winnerOf(match) === match.homeClubId ? homeTier : awayTier;
  const loserTier = winnerTier === homeTier ? awayTier : homeTier;
  return loserTier - winnerTier >= 2;
}

/** The winner's evening, written for the news. */
function cupWinNews(state: GameState, competition: Competition, winnerClubId: ClubId, finalMatch?: Match): GameEvent[] {
  const club = state.clubs[winnerClubId];
  if (!club) return [];
  const events: GameEvent[] = [];
  const finalScore = finalMatch ? tieScoreLine(finalMatch) : null;

  club.history.honours.push(`${state.season.label} ${competition.name} winners`);
  club.history.notableEvents.unshift({
    date: finalMatch?.date ?? state.date,
    seasonLabel: state.season.label,
    description: `Won the ${competition.name}${finalScore ? `, beating the finalists ${finalScore}` : ''}.`,
    importance: 3,
  });

  events.push(createEvent(state, {
    type: 'cup-result',
    importance: 3,
    clubIds: [winnerClubId],
    data: {
      headline: `${club.identity.name} win the ${competition.name}`,
      body: finalScore
        ? `${club.identity.name} have won the ${competition.name}, beating the finalists ${finalScore} in the final. A trophy for the cabinet and a Sunday nobody will forget.`
        : `${club.identity.name} have won the ${competition.name}.`,
      competition: competition.name,
      winner: club.identity.name,
    },
  }));

  return events;
}

/** Giant-killing news for a tie that has just been played. */
export function cupTieNews(state: GameState, match: Match): GameEvent[] {
  if (!isCup(state.competitions[match.competitionId])) return [];
  if (!isGiantKilling(state, match)) return [];
  const winnerId = winnerOf(match);
  const loserId = loserOf(match);
  const winner = state.clubs[winnerId];
  const loser = state.clubs[loserId];
  if (!winner || !loser) return [];

  winner.history.notableEvents.unshift({
    date: match.date,
    seasonLabel: state.season.label,
    description: `Beat ${loser.identity.name} ${tieScoreLine(match)} in the ${match.competitionName}.`,
    importance: 3,
  });
  return [createEvent(state, {
    type: 'cup-result',
    importance: 2,
    clubIds: [winnerId, loserId],
    matchId: match.id,
    data: {
      headline: `${winner.identity.shortName} knock out ${loser.identity.shortName}`,
      body: `${winner.identity.name} beat ${loser.identity.name} ${tieScoreLine(match)} in the ${match.competitionName}. The kind of afternoon the whole county will be talking about.`,
      competition: match.competitionName,
      winner: winner.identity.name,
      loser: loser.identity.name,
    },
  })];
}

/** A fresh cup state for a new season, following the round plan it was built to. */
export function newCupState(plan?: readonly CupRound[], consolationFor?: CompetitionId, matchdayOffset = 0): CupState {
  return {
    round: 1,
    winnerClubId: null,
    runnerUpClubId: null,
    complete: false,
    matchdayOffset,
    ...(plan && plan.length > 0 ? { plan: plan.map((entry) => ({ ...entry })) } : {}),
    ...(consolationFor ? { consolationFor } : {}),
  };
}

/**
 * The plan a cup is running to, or a plain knockout for a save made before
 * rounds were planned.
 *
 * A competition with no plan is one built by an older version of the game, where
 * every club played in every round. Reading it as "everybody plays" is exactly
 * what that save was doing, so an in-progress career carries on rather than
 * finding eight clubs mysteriously unaccounted for.
 */
export function planOf(competition: Competition): CupRound[] {
  return competition.cup?.plan ?? [];
}

/** When a cup round's ties were drawn, for the archive and the UI. */
export function roundDrawDate(state: GameState, competition: Competition, round: number): ISODate | null {  const list = state.fixtures?.[competition.id];
  if (!list) return null;
  const matchday = cupRoundMatchday(state, competition, round);
  const ids = Object.entries(list.matchdayOf)
    .filter(([, entry]) => entry === matchday)
    .map(([id]) => id);
  const match = ids.map((id) => state.matches[id]).find((entry): entry is Match => Boolean(entry));
  return match?.date ?? null;
}

/**
 * The round number a cup tie belongs to, or 0 if it is not one of this
 * competition's.
 *
 * A cup round is numbered on a matchday above the league's own, so the round is
 * read back out of the same arithmetic rather than stored on the tie: there is
 * nowhere to keep it that a postponed or rearranged game would have to be
 * updated in as well.
 */
export function cupRoundOf(state: GameState, competition: Competition, match: Match): number {
  const cup = competition.cup;
  if (!cup || match.competitionId !== competition.id) return 0;
  const league = state.season.calendar.filter((entry) => isLeagueMatchday(state, entry.matchday));
  const base = league.length || state.season.calendar.length;
  return match.matchday - (base + (cup.matchdayOffset ?? 0));
}

/**
 * What a round of a cup is called.
 *
 * A round of eight is the quarter-finals unless it is the one at the bottom of
 * the competition, where the same eight clubs are the preliminary — which is why
 * this reads the plan rather than counting ties: four clubs left is the
 * semi-finals in a main cup and the first round of a Plate drawn from four
 * losers, and only the plan says which.
 */
export function cupRoundName(competition: Competition, round: number): string {
  const plan = competition.cup?.plan ?? [];
  const entry = plan.find((candidate) => candidate.round === round);
  if (!entry) return `Round ${round}`;

  // Fewer clubs in the ties than in the round means some were on a bye, so this
  // is the round that decides who plays rather than who goes through.
  const isPreliminary = entry.entrants < entry.field;
  switch (entry.entrants) {
    case 2:
      return 'Final';
    case 4:
      return 'Semi-finals';
    case 8:
      return isPreliminary ? 'Preliminary Round' : 'Quarter-finals';
    case 16:
      return 'Last 16';
    case 32:
      return 'Round of 32';
    case 64:
      return 'Round of 64';
    default:
      return isPreliminary ? 'Preliminary Round' : `Round of ${entry.entrants}`;
  }
}

/** One round of a cup, read back for the screen that shows the competition. */
export interface CupRoundSummary {
  round: number;
  /** What the round is called on the screens and in the news. */
  name: string;
  date: ISODate | null;
  /**
   * Every tie booked for the round, including the ones that were called off.
   *
   * A postponed tie stays on the round it was drawn for, marked P-P, with its
   * replay booked separately for a later date: the manager has to be able to see
   * that a game did not happen *and* when it is being played instead.
   */
  ties: Match[];
  /** Ties that are still to be settled, postponements excluded. */
  outstanding: Match[];
  /** True when every tie in the round has been settled. */
  complete: boolean;
}

/**
 * A cup's rounds so far, oldest first.
 *
 * `cup.round` is the round about to be played, so the rounds worth showing are
 * the ones before it, and the round in hand if it has been drawn. The tie count
 * halves each time, which is how the bracket is read on the screen: round one
 * is the widest and the final is two clubs and a date.
 */
export function cupRoundSummaries(state: GameState, competition: Competition): CupRoundSummary[] {
  const cup = competition.cup;
  if (!cup) return [];
  const summaries: CupRoundSummary[] = [];
  for (let round = 1; round <= cup.round; round += 1) {
    const ties = tiesOnMatchday(state, competition, cupRoundMatchday(state, competition, round));
    if (ties.length === 0) break;
    // A round is finished when nothing is left to play on it. A called-off tie is
    // not outstanding *here* — its replay is a fixture in its own right — so it
    // cannot hold the round open on its own.
    const outstanding = ties.filter((tie) => isActiveFixture(tie));
    summaries.push({
      round,
      name: cupRoundName(competition, round),
      date: roundDrawDate(state, competition, round),
      ties: ties.sort((a, b) => a.homeClubId.localeCompare(b.homeClubId)),
      outstanding,
      complete: outstanding.length === 0,
    });
  }
  return summaries;
}

/** How many days before a date, for a phrase in the news. */
export function daysUntil(date: ISODate, today: ISODate): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
