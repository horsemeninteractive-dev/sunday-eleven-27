import { SUPPORTER_HISTORY_LIMIT, defaultSupporters, type Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { createEvent } from './news';
import { formatShortDate } from './calendar';

/**
 * The crowd.
 *
 * Every Sunday club has a crowd, and it is a small one: the same sixty or eighty
 * people who turn up whatever the weather, plus whoever the football has
 * attracted this month. This module is that, as one number per club.
 *
 * The rules it follows are deliberately unremarkable:
 *
 *   - **a result moves it a little.** A win is worth a point or two, a heavy
 *     defeat costs about the same, and a derby is felt about half again as
 *     hard. Nothing moves it by ten, because nothing does;
 *   - **hard numbers move it less than the number itself suggests.** The effect
 *     of a result is damped as a crowd gets further from the middle: the
 *     believers cannot get much keener and the disillusioned cannot get much
 *     more so, which is what keeps ninety-nine and one out of reach;
 *   - **it drifts back.** A summer is a long time and a crowd forgets: every
 *     close season pulls confidence a long way back towards not minding;
 *   - **it is what the gate reads.** Up to about a seventh of the attendance
 *     either way, which is the honest size of the effect for a club whose crowd
 *     is drawn from one town.
 *
 * Nothing here is a difficulty dial and nothing here decides anything on its
 * own. It is what the people who pay at the gate think, and the attendance is
 * where they say it.
 */

/** The most the crowd can add or cost the gate, at the extremes of mood. */
export const SUPPORT_ATTENDANCE_FLOOR = 0.88;
export const SUPPORT_ATTENDANCE_CEILING = 1.14;

const CONFIDENCE_MIN = 5;
const CONFIDENCE_MAX = 98;

/** One match can move a crowd this much at most, before damping. */
const MAX_MATCH_SWING = 4;
/** A close season is a bigger event than a match, but still not a gale. */
const MAX_SEASON_SWING = 22;

export type SupporterMood = 'buzzing' | 'hopeful' | 'settled' | 'restless' | 'disillusioned';

export const SUPPORTER_MOOD_LABEL: Record<SupporterMood, string> = {
  buzzing: 'Buzzing',
  hopeful: 'Hopeful',
  settled: 'Settled',
  restless: 'Restless',
  disillusioned: 'Disillusioned',
};

/** Which band a confidence figure falls in. */
export function supporterMood(confidence: number): SupporterMood {
  if (confidence >= 75) return 'buzzing';
  if (confidence >= 60) return 'hopeful';
  if (confidence >= 42) return 'settled';
  if (confidence >= 28) return 'restless';
  return 'disillusioned';
}

/** A club's confidence, with the default for a club that has never been asked. */
export function supportConfidenceOf(club: Club | null | undefined): number {
  return club?.supporters?.confidence ?? 50;
}

/**
 * What a crowd does to the gate.
 *
 * Linear and bounded, so the effect can be reasoned about: a club at the very
 * top of the range draws about an eighth more than one in the middle of it, and
 * one at the very bottom about an eighth less. The number is deliberately not
 * exponential — a crowd that has turned up for forty years does not stop coming
 * because of one bad November.
 */
export function supporterAttendanceFactor(confidence: number): number {
  const value = Math.max(0, Math.min(100, confidence));
  return SUPPORT_ATTENDANCE_FLOOR + (value / 100) * (SUPPORT_ATTENDANCE_CEILING - SUPPORT_ATTENDANCE_FLOOR);
}

/**
 * Move a club's crowd, by as much as it will actually move.
 *
 * Returns the amount that landed, which is not always the amount asked for: the
 * damping, the per-event limit and the floor and ceiling are applied here rather
 * than at every call site, so no caller has to know how a crowd behaves to move
 * one. The limit is an argument because a match and a summer are not the same
 * size of event. The reason is kept, because a mood that has moved and cannot
 * say why is a number rather than a feeling.
 */
export function adjustSupporterConfidence(
  club: Club,
  date: ISODate,
  delta: number,
  reason: string,
  limit = MAX_MATCH_SWING,
): number {
  const supporters = club.supporters ?? (club.supporters = defaultSupporters(date));
  const from = supporters.confidence;
  const damped = delta * (1 - Math.abs(from - 50) / 70);
  const applied = Math.max(-limit, Math.min(limit, damped));
  const next = Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, Math.round((from + applied) * 10) / 10));
  const landed = Math.round((next - from) * 10) / 10;
  supporters.confidence = next;
  supporters.updatedOn = date;
  if (landed !== 0) {
    supporters.recent.unshift({ date, delta: landed, reason });
    if (supporters.recent.length > SUPPORTER_HISTORY_LIMIT) {
      supporters.recent = supporters.recent.slice(0, SUPPORTER_HISTORY_LIMIT);
    }
  }
  return landed;
}

/**
 * What a match did to the two crowds.
 *
 * Only football that was actually played moves anything, and only by a small
 * amount: the margin, whether it was a derby, and which way the result went are
 * the whole of the reckoning. The reason handed to each club is a sentence
 * rather than a number, because it goes in the club's own record and the manager
 * may well read it.
 */
export function applyMatchSupport(state: GameState, match: Match): GameEvent[] {
  const events: GameEvent[] = [];
  if (!match.result || !isCompetitiveMatch(state, match)) return events;

  const home = state.clubs[match.homeClubId];
  const away = state.clubs[match.awayClubId];
  if (!home || !away) return events;

  const { homeGoals, awayGoals } = match.result;
  const margin = Math.abs(homeGoals - awayGoals);
  const rivalry = home.rivalries[away.id]?.intensity ?? 0;
  const heat = rivalry >= 55 ? 1.4 : 1;

  const homeResult: 'win' | 'draw' | 'loss' = homeGoals > awayGoals ? 'win' : homeGoals === awayGoals ? 'draw' : 'loss';
  const awayResult: 'win' | 'draw' | 'loss' = homeResult === 'win' ? 'loss' : homeResult === 'draw' ? 'draw' : 'win';
  const worth = (result: 'win' | 'draw' | 'loss') =>
    result === 'win' ? 1 + Math.min(2, margin) : result === 'draw' ? 0 : -(1 + Math.min(2, margin));

  for (const [club, result, opponent] of [
    [home, homeResult, away] as const,
    [away, awayResult, home] as const,
  ]) {
    const delta = worth(result) * heat;
    if (delta === 0) continue;
    const own = club.id === home.id ? homeGoals : awayGoals;
    const their = club.id === home.id ? awayGoals : homeGoals;
    const reason =
      result === 'win'
        ? `Beat ${opponent.identity.shortName} ${own}–${their}.`
        : result === 'draw'
          ? `Held ${opponent.identity.shortName} to ${own}–${their}.`
          : `Lost ${own}–${their} to ${opponent.identity.shortName}.`;
    adjustSupporterConfidence(club, match.date, delta, reason);

    // A crowd that has turned right round is worth a line in the paper, and one
    // that has given up entirely more so. Only the manager's own club: a story
    // about a stranger's mood is a story nobody asked for.
    if (club.id === state.userClubId) {
      const story = moodStory(state, club, match, result);
      if (story) events.push(story);
    }
  }

  return events;
}

/**
 * The line the paper runs when a crowd changes its mind.
 *
 * Held to the crossings rather than the movements: a point gained is not news,
 * but a club that has just gone from restless to disillusioned — or from hopeful
 * to buzzing — is. A club whose mood has not entered a new band gets silence,
 * which is what keeps this from becoming a weekly bulletin.
 */
function moodStory(state: GameState, club: Club, match: Match, result: 'win' | 'draw' | 'loss'): GameEvent | null {
  const last = club.supporters?.recent[0];
  if (!last) return null;
  const mood = supporterMood(supportConfidenceOf(club));
  const before = supporterMood(supportConfidenceOf(club) - last.delta);
  if (before === mood) return null;

  const rising = moodRank(mood) > moodRank(before);
  if (!rising && mood !== 'disillusioned') return null;

  const opponentId = match.homeClubId === club.id ? match.awayClubId : match.homeClubId;
  const opponent = state.clubs[opponentId]?.identity.shortName ?? 'the opposition';
  const headline = rising
    ? `The place is up at ${club.identity.shortName}`
    : `The mood has gone at ${club.identity.shortName}`;
  const body = rising
    ? `After ${result === 'win' ? 'beating' : result === 'draw' ? 'holding' : 'losing to'} ${opponent} on ${formatShortDate(match.date)}, the talk around ${club.identity.shortName} is that this side is worth watching again.`
    : `The crowd at ${club.identity.shortName} has had enough of the last few weeks, and the afternoon against ${opponent} has not helped.`;
  return createEvent(state, {
    type: 'club-news',
    importance: 2,
    clubIds: [club.id],
    matchId: match.id,
    data: { headline, body, mood },
  });
}

/** A mood band as a number, so two of them can be compared. */
function moodRank(mood: SupporterMood): number {
  return ['disillusioned', 'restless', 'settled', 'hopeful', 'buzzing'].indexOf(mood);
}

/**
 * The close season.
 *
 * A summer pulls every crowd back towards the middle — nobody stays furious
 * about a season that ended in May — and then the one thing everybody in the
 * county has an opinion about is applied on top: going up, or going down. Both
 * are bounded, and both are read from the season the club has just had rather
 * than from anybody's opinion of it.
 */
export function applySeasonSupport(state: GameState, date: ISODate): void {
  for (const club of Object.values(state.clubs)) {
    if (!club.active) continue;
    const confidence = supportConfidenceOf(club);
    const movement = club.history.seasons[club.history.seasons.length - 1]?.movement;
    const swing = movement === 'promoted' ? 8 : movement === 'relegated' ? -8 : 0;
    const drift = (50 - confidence) * 0.5;
    adjustSupporterConfidence(club, date, drift + swing, 'A summer to think about it.', MAX_SEASON_SWING);
  }
}
