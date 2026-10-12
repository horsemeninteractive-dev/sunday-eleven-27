import type { Club } from '@/domain/club';
import type { MatchConditions } from '@/domain/match';
import type { Ground } from '@/domain/world';
import { supporterAttendanceFactor } from '../support';

/**
 * Sunday League crowds are small, local and weather-dependent: a decent
 * rivalry or a title race can double a gate, heavy rain can halve it.
 *
 * One input is what the home crowd currently *thinks* of the side — the
 * aggregate supporter confidence the club carries — which is worth a bounded
 * fraction of the gate either way and is the only thing here that changes over
 * a season rather than from one Sunday to the next.
 */
export function estimateAttendance(params: {
  home: Club;
  away: Club;
  ground: Ground;
  conditions: MatchConditions;
  matchday: number;
  rivalryIntensity: number;
  /** Player's club involvement draws a few more friends and family. */
  involvesUserClub: boolean;
  /** 0-100: how the home crowd is feeling about the side. See `simulation/support.ts`. */
  supporterConfidence: number;
}): number {
  const { home, away, ground, conditions, matchday, rivalryIntensity, involvesUserClub, supporterConfidence } = params;

  const base = 22 + home.reputation * 0.75 + away.reputation * 0.3 + rivalryIntensity * 0.5;
  let attendance = base;

  switch (conditions.weather) {
    case 'clear':
      attendance *= 1.12;
      break;
    case 'light-rain':
      attendance *= 0.88;
      break;
    case 'heavy-rain':
      attendance *= 0.65;
      break;
    case 'cold':
      attendance *= 0.85;
      break;
    case 'frozen':
      attendance *= 0.7;
      break;
    default:
      attendance *= 1;
  }

  if (matchday <= 2) attendance *= 1.08; // New season optimism.
  if (involvesUserClub) attendance *= 1.05;
  if (ground.hasClubhouse) attendance *= 1.06;
  attendance *= supporterAttendanceFactor(supporterConfidence);

  return Math.max(12, Math.round(Math.min(ground.capacity * 1.6, attendance)));
}

/** Weather and pitch conditions for a fixture, derived from the seed. */
export function describeConditions(conditions: MatchConditions): string {
  return `${conditions.weather} · ${conditions.pitch}`;
}
