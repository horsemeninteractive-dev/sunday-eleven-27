import type { GameState } from '@/domain/game';
import type { ISODate, MatchId } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import { addDays, isChristmasBreak, toDate } from './calendar';
import { createMatchRecord } from './matchday';
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
 * When the rearranged game is played.
 *
 * The natural slot is a free Sunday — the Christmas gap, or one of the weeks
 * after the last scheduled matchday. During the season every Sunday is taken,
 * so the league falls back the way real Sunday leagues do: a midweek evening
 * under the lights, and Saturday afternoon if even that is taken.
 *
 * The calendar is the authority on *when*: this only finds a date that suits
 * both clubs and is not a dead Sunday in the middle of winter.
 */
export function rescheduleDateFor(state: GameState, match: Match, from: ISODate): ISODate | null {
  const sunday = findSlot(state, match, from, [0], 30);
  if (sunday) return sunday;
  const evening = findSlot(state, match, from, [3], 30);
  if (evening) return evening;
  return findSlot(state, match, from, [6], 30);
}

/** A free date with one of these weekdays, at least three days away. */
function findSlot(state: GameState, match: Match, from: ISODate, weekdays: number[], limit: number): ISODate | null {
  let candidate = addDays(from, 3);
  for (let day = 0; day < limit; day += 1) {
    if (weekdays.includes(toDate(candidate).getUTCDay()) && !isChristmasBreak(candidate) && !clubBusyOn(state, match, candidate)) {
      return candidate;
    }
    candidate = addDays(candidate, 1);
  }
  return null;
}

/** True when either club is already playing that day. */
function clubBusyOn(state: GameState, match: Match, date: ISODate): boolean {
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
  state.matchOrder.push(id);
  const bucket = state.fixtures.byMatchday[match.matchday] ?? [];
  state.fixtures.byMatchday[match.matchday] = [...bucket, id];
  state.fixtures.matchdayOf[id] = match.matchday;
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
