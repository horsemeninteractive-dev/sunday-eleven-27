import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import { FORFEIT_GOALS, MIN_SIDE, type Match } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { isPlayer } from '@/domain/person';
import { createEvent } from './news';
import { expectedAttendanceFor } from './matchday';

/**
 * A fixture that cannot be played because a side has no team to put out.
 *
 * The laws allow a side to start with seven, so seven is the line: a club with
 * seven fit players plays short-handed, and a club with six forfeits. The
 * fixture is not postponed — there is nothing to rearrange, because the problem
 * will still be there next Sunday. It goes on the record as played, the
 * opposition is awarded the points, and the season keeps moving.
 */

/** How many fit players a club could put on the pitch today. */
export function playableSideSize(state: GameState, clubId: ClubId): number {
  const club = state.clubs[clubId];
  if (!club) return 0;
  let fit = 0;
  for (const id of club.squadIds) {
    const person = state.people[id];
    if (isPlayer(person) && person.availability.status !== 'unavailable') fit += 1;
  }
  return fit;
}

/** True when the club can field the minimum seven. */
export function canFieldSide(state: GameState, clubId: ClubId): boolean {
  return playableSideSize(state, clubId) >= MIN_SIDE;
}

export interface ForfeitOutcome {
  /** The club that had no team. */
  shortClubId: ClubId;
  /** The club awarded the win (the home side when neither could field one). */
  awardedClubId: ClubId;
  events: GameEvent[];
  /** A line for the day's digest, in the manager's words. */
  note: string;
}

function clubName(state: GameState, clubId: ClubId): string {
  return state.clubs[clubId]?.identity.shortName ?? 'the club';
}

/**
 * Settle a fixture by forfeit, if a side cannot field a team. Returns null when
 * both clubs have enough players and the match should be played normally.
 *
 * Both clubs short is the corner nobody wants: there is no side to award the win
 * to, so — as a cup tie that is called off and never rearranged already does —
 * the game goes to the home club on a technicality rather than leaving a hole in
 * the season.
 */
export function settleShortSides(state: GameState, match: Match): ForfeitOutcome | null {
  if (match.played) return null;
  const homeShort = !canFieldSide(state, match.homeClubId);
  const awayShort = !canFieldSide(state, match.awayClubId);
  if (!homeShort && !awayShort) return null;

  const bothShort = homeShort && awayShort;
  // The side with a team takes the points; when neither has one, the home club
  // takes it on the technicality a cup already uses.
  const awardedClubId = bothShort ? match.homeClubId : homeShort ? match.awayClubId : match.homeClubId;
  const shortClubId = homeShort ? match.homeClubId : match.awayClubId;
  const awarded = clubName(state, awardedClubId);
  const short = clubName(state, shortClubId);

  const homeGoals = awardedClubId === match.homeClubId ? FORFEIT_GOALS : 0;
  const awayGoals = awardedClubId === match.awayClubId ? FORFEIT_GOALS : 0;

  match.played = true;
  match.status = 'finished';
  match.result = {
    homeGoals,
    awayGoals,
    homeShots: 0,
    awayShots: 0,
    homePossession: 50,
    awayPossession: 50,
    attendance: expectedAttendanceFor(state, match),
  };
  match.minute = 90;
  match.half = 2;

  const fixture = `${clubName(state, match.homeClubId)} v ${clubName(state, match.awayClubId)}`;
  const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;

  const events: GameEvent[] = [
    createEvent(state, {
      type: 'forfeit',
      importance: involvesUser ? 3 : 1,
      clubIds: [match.homeClubId, match.awayClubId],
      matchId: match.id,
      data: {
        fixture,
        short,
        awarded,
        score: `${awarded} ${FORFEIT_GOALS}-0`,
        headline: `${fixture} is abandoned`,
      },
    }),
  ];

  return {
    shortClubId,
    awardedClubId,
    events,
    note: `${short} could not field a side, so the game is abandoned and ${awarded} are awarded a ${FORFEIT_GOALS}-0 win.`,
  };
}
