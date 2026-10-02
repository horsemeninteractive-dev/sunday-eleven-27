import type { Competition, CupState, FixtureList } from '@/domain/competition';
import { isCup } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate, MatchId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { addDays, CUP_KICKOFF, cupMatchdayFor, isChristmasBreak, toDate, type CupRoundSlot } from './calendar';
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

/** How many rounds a whole-pyramid cup needs, and where each one lands. */
export function cupRoundSlots(entranceCount: number, leagueMatchdays: number): CupRoundSlot[] {
  const rounds = roundSizes(entranceCount);
  if (rounds.length === 0) return [];

  // Spread the rounds across the league season rather than bunching them at the
  // start, and keep every round inside the league calendar so a cup tie is
  // always settled inside the season that drew it.
  const usable = Math.max(1, leagueMatchdays - 2);
  return rounds.map((_size, index) => ({
    round: index + 1,
    beforeMatchday: Math.max(2, Math.round(((index + 1) * usable) / rounds.length)),
  }));
}

/** Knock a field of `n` down to one: the number of clubs left after each round. */
function roundSizes(entranceCount: number): number[] {
  let survivors = entranceCount;
  const rounds: number[] = [];
  while (survivors > 1) {
    rounds.push(survivors);
    survivors = survivors <= 2 ? 1 : Math.ceil(survivors / 2);
  }
  return rounds;
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
 * is fed from the League Cup's first-round losers, so it cannot be drawn before
 * that round has been played.
 */
export function allCupRoundSlots(leagueField: number, leagueMatchdays: number, consolation: boolean): CupRoundSlot[] {
  const main = roundSizes(leagueField);
  if (main.length === 0) return [];
  // A consolation cup starts from the main cup's first-round losers: half the
  // field, rounded up for the odd one out.
  const plate = consolation ? roundSizes(Math.ceil(leagueField / 2)) : [];

  const all = [
    ...main.map((_size, index) => ({ round: index + 1 })),
    ...plate.map((_size, index) => ({ round: index + 1 })),
  ];

  // Spread every round across the season, keeping them all inside the league
  // calendar so a cup tie is settled in the season that drew it. Distinct
  // matchdays mean distinct Wednesdays, which is what stops a club being asked
  // for two ties on one night.
  const usable = Math.max(all.length, leagueMatchdays - 2);
  return all.map((slot, index) => ({
    ...slot,
    beforeMatchday: Math.max(2, Math.min(leagueMatchdays, Math.round(((index + 1) * usable) / all.length))),
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
  },
): CupDrawResult | null {
  const cup = competition.cup;
  if (!cup || cup.complete) return null;

  const round = cup.round;
  const field = competition.clubIds.filter((clubId) => state.clubs[clubId]?.active);
  if (field.length < 2) return null;

  const rng = stream(state.seed, 'cup-draw', context.seasonId, competition.id, round);
  const ties = pairUp(rng, field);
  const matchday = cupMatchdayFor(round, context.leagueMatchdays, cup.matchdayOffset ?? 0);
  const date = playDateFor(state, matchday, field);
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
      clubIds: field,
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
 *
 *  - The slot can already be spoken for. A rearranged league fixture lands on a
 *    spare midweek, and if it lands on the same Wednesday a cup round wants, one
 *    club ends up booked to play twice. The round moves to the next midweek
 *    nobody in its field is already playing rather than double-booking anybody.
 */
function playDateFor(state: GameState, matchday: number, clubIds: readonly ClubId[]): ISODate | null {
  const date = matchDateFor(state, matchday);
  if (!date || clubIds.length < 2) return date;
  if (date > addDays(state.date, 2) && fieldIsFree(state, clubIds, date)) return date;
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
 * The next midweek on which every club in the field is free.
 *
 * A cup round is one night for the whole field, so unlike a single rearranged
 * fixture there is no pairing to dodge the clash with — the date itself has to
 * move. Bounded by the same rearrangement deadline, so a round whose field is
 * scattered across a congested calendar is given up on rather than chased to the
 * end of the year.
 */
function nextFreeDateForField(state: GameState, clubIds: readonly ClubId[]): ISODate | null {
  const deadline = rearrangementDeadlineFor(state);
  let candidate = addDays(state.date, 3);
  for (let day = 0; day < 30; day += 1) {
    if (candidate > deadline) return null;
    const weekday = toDate(candidate).getUTCDay();
    if ((weekday === 3 || weekday === 6) && !isChristmasBreak(candidate) && fieldIsFree(state, clubIds, candidate)) {
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
  const list: FixtureList | undefined = state.fixtures?.[competition.id];
  if (!list) return [];
  const matchday = cupRoundMatchday(state, competition, round);
  const ids = Object.entries(list.matchdayOf)
    .filter(([, entry]) => entry === matchday)
    .map(([id]) => id);
  return ids
    .map((id) => state.matches[id])
    .filter((match): match is Match => Boolean(match) && !match.replacedByMatchId);
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

/** A fresh cup state for a new season. */
export function newCupState(consolationFor?: CompetitionId, matchdayOffset = 0): CupState {
  return {
    round: 1,
    winnerClubId: null,
    runnerUpClubId: null,
    complete: false,
    matchdayOffset,
    ...(consolationFor ? { consolationFor } : {}),
  };
}

/** When a cup round's ties were drawn, for the archive and the UI. */
export function roundDrawDate(state: GameState, competition: Competition, round: number): ISODate | null {
  const list = state.fixtures?.[competition.id];
  if (!list) return null;
  const matchday = cupRoundMatchday(state, competition, round);
  const ids = Object.entries(list.matchdayOf)
    .filter(([, entry]) => entry === matchday)
    .map(([id]) => id);
  const match = ids.map((id) => state.matches[id]).find((entry): entry is Match => Boolean(entry));
  return match?.date ?? null;
}

/** How many days before a date, for a phrase in the news. */
export function daysUntil(date: ISODate, today: ISODate): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
