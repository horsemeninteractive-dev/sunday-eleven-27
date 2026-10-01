import type { Match, MatchEvent, MatchEventType } from '@/domain/match';

/**
 * What the game can honestly say about a match in progress.
 *
 * Everything here is read from the authoritative match record — the events the
 * engine has already produced, the possession ticks it keeps for exactly this
 * purpose, and the per-player performances it writes minute by minute. Nothing
 * is invented to fill a panel: a statistic that the simulation does not support
 * simply is not offered.
 */

export interface SideStats {
  /** 0..1 share of the ball so far. */
  possession: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  offsides: number;
  yellowCards: number;
  redCards: number;
}

export interface MatchStats {
  home: SideStats;
  away: SideStats;
  /** Weighted activity over the last quarter of an hour, 0..1 per side. */
  pressure: { home: number; away: number };
  /** How many minutes of football the pressure reading covers. */
  pressureWindow: number;
}

/** Event types that say something about who is on top, and how much. */
const ACTIVITY_WEIGHT: Partial<Record<MatchEventType, number>> = {
  goal: 4,
  'penalty-scored': 4,
  'penalty-missed': 3,
  'shot-saved': 2,
  'shot-off-target': 1.5,
  'shot-blocked': 1,
  chance: 1,
  corner: 1,
};

export const PRESSURE_WINDOW_MINUTES = 15;

function countEvents(events: readonly MatchEvent[], type: MatchEventType, side: 'home' | 'away', match: Match): number {
  const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
  return events.filter((event) => event.type === type && event.clubId === clubId).length;
}

function sideStats(match: Match, side: 'home' | 'away'): SideStats {
  const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
  const events = match.events;
  let shots = 0;
  let shotsOnTarget = 0;
  for (const performance of Object.values(match.performances)) {
    if (performance.clubId !== clubId) continue;
    shots += performance.shots;
    shotsOnTarget += performance.shotsOnTarget;
  }
  const ticks = match.possessionTicks;
  const total = ticks.home + ticks.away;
  return {
    possession: total > 0 ? (side === 'home' ? ticks.home : ticks.away) / total : 0.5,
    shots,
    shotsOnTarget,
    corners: countEvents(events, 'corner', side, match),
    fouls: countEvents(events, 'foul', side, match),
    offsides: countEvents(events, 'offside', side, match),
    yellowCards: countEvents(events, 'yellow-card', side, match),
    redCards: countEvents(events, 'red-card', side, match),
  };
}

/**
 * How the last quarter of an hour has actually gone — a share of the chances,
 * shots and corners that both sides have produced in it. It is a reading of the
 * match record, not a hidden mechanic, which is why it is described to the
 * manager as recent pressure rather than as a number that changes the game.
 */
export function recentPressure(match: Match, window = PRESSURE_WINDOW_MINUTES): { home: number; away: number } {
  const from = Math.max(0, match.minute - window);
  let home = 0;
  let away = 0;
  for (const event of match.events) {
    if (event.minute < from) continue;
    const weight = ACTIVITY_WEIGHT[event.type];
    if (!weight || !event.clubId) continue;
    if (event.clubId === match.homeClubId) home += weight;
    else if (event.clubId === match.awayClubId) away += weight;
  }
  const total = home + away;
  if (total === 0) return { home: 0.5, away: 0.5 };
  return { home: home / total, away: away / total };
}

export function matchStats(match: Match): MatchStats {
  return {
    home: sideStats(match, 'home'),
    away: sideStats(match, 'away'),
    pressure: recentPressure(match),
    pressureWindow: PRESSURE_WINDOW_MINUTES,
  };
}
