import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import { addDays, isChristmasBreak, toDate } from './calendar';
import { isCup } from '@/domain/competition';
import { createMatchRecord } from './matchday';
import { registerFixture } from './pyramid';
import { stream } from './rng';
import { scheduleEvent } from './schedule';

/**
 * Fixtures get called off. It is half of what Sunday league management is.
 *
 * A postponement is never a quiet edit to a date. The original fixture keeps its
 * date and its place in the season, records *why* it did not happen and *when*
 * it was called off, and a replacement match is created for the rearranged
 * game. The league table then catches up whenever the game is actually played,
 * and congestion becomes a real thing the manager has to live with.
 */

export interface PostponementDecision {
  postpone: boolean;
  reason: string | null;
}

/**
 * Would this game be called off?
 *
 * Read from the fixture's own conditions, which the matchday preparation has
 * already rolled — so the same weather that made the pitch heavy is the weather
 * that calls the game off.
 */
export function decidePostponement(state: GameState, match: Match, date: ISODate): PostponementDecision {
  // A friendly is not worth a pitch inspection, and there is no room in the
  // calendar to rearrange one if it were: it is off, and nobody minds.
  if (!isCompetitiveMatch(state, match)) return { postpone: false, reason: null };
  const rng = stream(state.seed, 'postponement', match.id, date);
  const ground = state.world.grounds[match.groundId];
  const conditions = match.conditions;

  if (conditions.pitch === 'frozen') {
    return rng.chance(0.7)
      ? { postpone: true, reason: 'Frozen pitch — the groundsman called it off at eight o\'clock' }
      : { postpone: false, reason: null };
  }
  if (conditions.pitch === 'waterlogged') {
    return rng.chance(0.72)
      ? { postpone: true, reason: 'Standing water in the goalmouth — the pitch failed its inspection' }
      : { postpone: false, reason: null };
  }
  if (conditions.weather === 'heavy-rain' && conditions.pitchQuality <= 6) {
    return rng.chance(0.22)
      ? { postpone: true, reason: 'Heavy overnight rain on a pitch that could not take any more' }
      : { postpone: false, reason: null };
  }
  if (conditions.weather === 'frozen' && !ground?.hasFloodlights) {
    return rng.chance(0.16)
      ? { postpone: true, reason: 'The pitch froze overnight and never thawed' }
      : { postpone: false, reason: null };
  }
  if (!match.refereeId) {
    return rng.chance(0.3)
      ? { postpone: true, reason: 'No referee allocated, and neither club would do it' }
      : { postpone: false, reason: null };
  }
  if (conditions.pitch === 'muddy' && (ground?.drainage ?? 10) <= 6) {
    return rng.chance(0.06)
      ? { postpone: true, reason: 'The goalmouths were ankle-deep — neither side fancied it' }
      : { postpone: false, reason: null };
  }
  // The other great cause of a blank Sunday: one club simply cannot raise a side.
  if (homeClubCannotRaiseATeam(state, match)) {
    return rng.chance(0.35)
      ? { postpone: true, reason: 'The home club could not raise a side' }
      : { postpone: false, reason: null };
  }
  return { postpone: false, reason: null };
}

/** Fewer than eight available bodies is a club in trouble. */
function homeClubCannotRaiseATeam(state: GameState, match: Match): boolean {
  const squad = state.clubs[match.homeClubId]?.squadIds ?? [];
  let available = 0;
  for (const id of squad) {
    const person = state.people[id];
    if (person && person.kind === 'player' && person.availability.status === 'available') available += 1;
  }
  return available < 8;
}

/**
 * How long past the season's last scheduled Sunday a game may still be played.
 *
 * A rearranged fixture has to be played, and until there was a deadline it always
 * could be: a slot can always be found within a month, so a game called off in a
 * bad winter was rearranged into the same bad weather, called off again, and
 * rearranged again — the replacement rolls its own conditions from its own id, so
 * each bounce is an independent roll of the dice. One seed ran a single fixture
 * through twenty-one rearrangements, took the season five months past its own
 * calendar and never closed it at all, which cost the *next* season as well: a
 * season that does not end is a season that never archives a champion, and the
 * world stops having seasons.
 *
 * Real Sunday leagues do not do that. There is a point at which the league gives
 * up on a game, and this is it — two months of grace past the last scheduled
 * Sunday. That is generous enough for a genuine backlog of winter call-offs, and
 * comfortably clear of the next season's pre-season, which begins the summer
 * after next. The deadline is fixed, and every rearrangement is dated later than
 * the game it replaces, so a chain of them can only ever be finite.
 */
const REARRANGEMENT_GRACE_DAYS = 56;

/** The last date in the season on which a rearranged game may be played. */
export function rearrangementDeadlineFor(state: GameState): ISODate {
  const calendar = state.season.calendar;
  const last = calendar[calendar.length - 1]?.date ?? state.season.endDate;
  return addDays(last, REARRANGEMENT_GRACE_DAYS);
}

/**
 * When the rearranged game is played.
 *
 * The natural slot is a free Sunday — the Christmas gap, or one of the weeks
 * after the last scheduled matchday. During the season every Sunday is taken,
 * so the league falls back the way real Sunday leagues do: a midweek evening
 * under the lights, and Saturday afternoon if even that is taken.
 *
 * The calendar is the authority on *when*: this only finds a date that suits
 * both clubs, is not a dead Sunday in the middle of winter, and is still inside
 * the season. Null means there is genuinely no room, and the league abandons the
 * fixture rather than shuffling it around for the rest of the year.
 */
export function rescheduleDateFor(state: GameState, match: FixtureSlotRequest, from: ISODate): ISODate | null {
  const deadline = rearrangementDeadlineFor(state);
  // A cup tie is already a midweek game. Putting its replay on a Sunday means
  // competing with the league fixture that Sunday for the same players, which
  // is how one tie ends up bounced five times before the round can move.
  const midweekFirst = isCup(state.competitions[match.competitionId]);
  if (midweekFirst) {
    return findSlot(state, match, from, [3], 30, deadline) ?? findSlot(state, match, from, [6], 30, deadline);
  }
  const sunday = findSlot(state, match, from, [0], 30, deadline);
  if (sunday) return sunday;
  const evening = findSlot(state, match, from, [3], 30, deadline);
  if (evening) return evening;
  return findSlot(state, match, from, [6], 30, deadline);
}

/** The two clubs and the competition a date search has to avoid clashes for. */
export interface FixtureSlotRequest {
  id: string;
  competitionId: string;
  homeClubId: ClubId;
  awayClubId: ClubId;
}

/**
 * The next date this fixture could be played on, at least three days out.
 *
 * Used when a competition is drawn late — a cup round whose slot has already
 * gone by — so that a tie is never created in the past, where it would sit
 * scheduled for ever and the round could never finish.
 */
export function nextPlayableDateFor(state: GameState, request: FixtureSlotRequest): ISODate | null {
  return rescheduleDateFor(state, request as Match, state.date);
}

/**
 * A free date with one of these weekdays, at least three days away.
 *
 * `deadline` is what stops the search running off the end of the season: the
 * candidates only ever move forward, so the first one past it ends the search.
 */
function findSlot(
  state: GameState,
  match: FixtureSlotRequest,
  from: ISODate,
  weekdays: number[],
  limit: number,
  deadline: ISODate,
): ISODate | null {
  let candidate = addDays(from, 3);
  for (let day = 0; day < limit; day += 1) {
    if (candidate > deadline) return null;
    if (weekdays.includes(toDate(candidate).getUTCDay()) && !isChristmasBreak(candidate) && !clubBusyOn(state, match, candidate)) {
      return candidate;
    }
    candidate = addDays(candidate, 1);
  }
  return null;
}

/** True when either club is already playing that day. */
function clubBusyOn(state: GameState, match: FixtureSlotRequest, date: ISODate): boolean {
  const clubs = [match.homeClubId, match.awayClubId];
  return Object.values(state.matches).some(
    (other) =>
      other.id !== match.id &&
      other.date === date &&
      !other.played &&
      other.status !== 'abandoned' &&
      (clubs.includes(other.homeClubId) || clubs.includes(other.awayClubId)),
  );
}

/** Midweek games kick off after work; Saturday ones in the afternoon. */
export function kickOffForReplay(date: ISODate, fallback: string): string {
  const weekday = toDate(date).getUTCDay();
  if (weekday === 3) return '18:45';
  if (weekday === 6) return '14:00';
  return fallback;
}

/**
 * Call a fixture off and arrange the replacement.
 *
 * Returns the replacement match, or null when there is no room left in the
 * season — in which case the original is abandoned and stays on the record as
 * a game that was never played.
 */
export function postponeFixture(
  state: GameState,
  match: Match,
  date: ISODate,
  reason: string,
): Match | null {
  match.status = 'postponed';
  match.postponedOn = date;
  match.postponementReason = reason;

  const replacementDate = rescheduleDateFor(state, match, date);
  if (!replacementDate) {
    match.status = 'abandoned';
    scheduleEvent(state, {
      date: addDays(date, 2),
      kind: 'postponed',
      priority: 'important',
      source: 'fixture',
      title: 'No room left to play it',
      detail: `${reason}. There is no spare Sunday before the season ends, so the league has abandoned the fixture.`,
    });
    return null;
  }

  // The replacement hangs off the fixture it replaces, so the pair can always
  // be read back together and the id can never collide with a scheduled game.
  const id = replacementIdFor(state, match.id);
  const replacement = createMatchRecord({
    state,
    id,
    matchday: match.matchday,
    date: replacementDate,
    homeClubId: match.homeClubId,
    awayClubId: match.awayClubId,
    competitionId: match.competitionId,
    competitionName: match.competitionName,
    kickOff: kickOffForReplay(replacementDate, match.kickOff),
  });
  replacement.originalDate = match.date;
  replacement.postponedOn = date;
  state.matches[id] = replacement;
  registerFixture(state, match.competitionId, id, match.matchday);
  match.replacedByMatchId = id;
  return replacement;
}

/** An active fixture: still to be played, not called off. */
export function isActiveFixture(match: Match): boolean {
  return !match.played && match.status === 'scheduled';
}

/** `match_34_r1`, `match_34_r2` — one per rearranged playing of a fixture. */
function replacementIdFor(state: GameState, matchId: MatchId): MatchId {
  let attempt = 1;
  let id = `${matchId}_r${attempt}`;
  while (state.matches[id]) {
    attempt += 1;
    id = `${matchId}_r${attempt}`;
  }
  return id;
}
