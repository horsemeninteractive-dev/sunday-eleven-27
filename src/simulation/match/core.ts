import type { ClubId, PlayerId } from '@/domain/ids';
import type { Match, MatchEvent, MatchEventType, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { Tactics } from '@/domain/tactics';
import { stream, type Rng } from '../rng';
import { computeTeamStrength, type TeamStrength } from './teamStrength';
import { tacticalProfile, type TacticalProfile } from './tacticsModel';

/**
 * The pieces every part of the match simulation shares.
 *
 * Touchline needs the same handful of things whichever resolution is playing: which
 * side is which, how it is named, how an event is written down, and how strong
 * each team is right now. Those live here so the two resolutions can share them
 * without importing each other.
 *
 * Nothing here decides any football. It is vocabulary, not judgement.
 */

export type Side = 'home' | 'away';

export const SIDES: Side[] = ['home', 'away'];

export interface MatchEnvironment {
  getPlayer: (id: PlayerId) => Player | undefined;
  clubName: (id: ClubId) => string;
  clubShortName: (id: ClubId) => string;
  /** Club whose bench is managed by the human; the engine leaves its bench alone. */
  userClubId: ClubId | null;
  /** When true the engine manages both benches (instant results, other games). */
  autoManageAllBenches: boolean;
  /**
   * When true the engine also writes the commentary transcript.
   *
   * Only a match somebody is reading is worth narrating: the human's own
   * fixture, whether he watches it minute by minute or sends it to the whistle.
   * Other clubs' games are simulated without it, so a season's saves stay lean.
   */
  recordCommentary?: boolean;
  substitutionsAllowed: number;
  /** 1-20 referee strictness. */
  refereeStrictness: number;
  /** Pre-match estimate from the matchday service; the engine adds noise to it. */
  expectedAttendance: number;
  /**
   * How well a club knows its system, and how settled it is (0-1 each, 0.5
   * neutral). Supplied by the matchday service from the training state; when a
   * caller (a test, a friendly) does not provide them the side is treated as
   * ordinary, which is what a fresh world looks like.
   */
  tacticalFamiliarity?: (clubId: ClubId) => number;
  cohesion?: (clubId: ClubId) => number;
}

export function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

export function sideClubId(match: Match, side: Side): ClubId {
  return side === 'home' ? match.homeClubId : match.awayClubId;
}

export function sideOfClub(match: Match, clubId: ClubId | null): Side | null {
  if (clubId === null) return null;
  if (clubId === match.homeClubId) return 'home';
  if (clubId === match.awayClubId) return 'away';
  return null;
}

/**
 * The bounds of *measured* added time, so a stop-start match cannot invent a
 * twenty-minute half. Separate from the seeded draw below on purpose: these
 * clamp what the engine counted, they do not set the range of the fallback.
 */
export const STOPPAGE_BOUNDS: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 1, max: 8 },
  2: { min: 2, max: 12 },
};

/**
 * Added time for a half, in minutes.
 *
 * The engine measures its own stoppages and records them on the match as each
 * half is played out; once it has, that measurement is the truth. Until then —
 * the first half before it ends, the old engine, a save written before any of
 * this existed — the figure is drawn from the seed exactly as it always was.
 */
export function stoppageMinutes(match: Match, half: 1 | 2): number {
  const recorded = half === 1 ? match.stoppage?.first : match.stoppage?.second;
  if (typeof recorded === 'number') return recorded;
  return stream(match.seed, 'stoppage', half).int(half === 1 ? 1 : 2, half === 1 ? 5 : 7);
}

/**
 * Which side is attacking toward x = 1.
 *
 * Sides change ends at half time, so the home side attacks right in the first
 * half and again in extra time — period three is not a period where nobody
 * moves.
 */
export function homeAttacksRight(match: Match): boolean {
  return match.half !== 2;
}

/**
 * Pitch coordinates for a loose action by `side`, used where no exact point exists.
 *
 * The abstract resolution places the ordinary moments of a match — a chance, the
 * build-up before it — on the pitch without ever knowing where anybody is
 * standing, and this is where it puts them: in front of the side that is
 * attacking, at the right end for the half.
 */
export function attackingCoordinates(
  match: Match,
  side: Side,
  rng: Rng,
  depth: 'chance' | 'build' = 'chance',
): { x: number; y: number } {
  const attackingHome = homeAttacksRight(match) ? side === 'home' : side === 'away';
  const dir = attackingHome ? 1 : -1;
  const reach = depth === 'chance' ? rng.float(0.16, 0.44) : rng.float(0.02, 0.2);
  return {
    x: Math.max(0.02, Math.min(0.98, 0.5 + dir * reach)),
    y: Math.max(0.06, Math.min(0.94, rng.float(0.1, 0.9))),
  };
}

/** Human-facing minute label, e.g. "45+2". */
export function displayMinute(match: Match): string {
  if (match.half === 1 && match.minute > 45) return `45+${match.minute - 45}`;
  if (match.half === 2 && match.minute > 90) return `90+${match.minute - 90}`;
  if (match.half === 3 && match.minute > 90) {
    return match.minute > 105 ? `105+${match.minute - 105}` : `90+${match.minute - 90}`;
  }
  return String(match.minute);
}

export function currentScore(match: Match): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const event of match.events) {
    if (event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored') {
      if (event.clubId === match.homeClubId) home += 1;
      else if (event.clubId === match.awayClubId) away += 1;
    }
  }
  return { home, away };
}

export function performanceOf(match: Match, playerId: PlayerId): PlayerPerformance | undefined {
  return match.performances[playerId];
}

export interface SideContext {
  side: Side;
  strength: TeamStrength;
  profile: TacticalProfile;
  tactics: Tactics;
}

export interface MatchContext {
  home: SideContext;
  away: SideContext;
  homeAdvantage: number;
}

/**
 * What both teams are worth right now — recomputed each minute, so a tactical
 * switch, a substitution or a tiring midfield genuinely changes the balance from
 * the moment it happens rather than at the next kick-off.
 */
export function buildContext(match: Match, env: MatchEnvironment): MatchContext {
  const build = (side: Side): SideContext => {
    const lineup = match.lineups[side];
    const clubId = sideClubId(match, side);
    const strength = computeTeamStrength({
      slots: lineup.starting,
      players: env.getPlayer,
      tactics: lineup.tactics,
      conditions: match.conditions,
      energy: (id) => performanceOf(match, id)?.energy ?? 100,
      carryingInjury: (id) => Boolean(performanceOf(match, id)?.injuryDetail),
      sentOff: (id) => Boolean(performanceOf(match, id)?.sentOff),
      tacticalFamiliarity: env.tacticalFamiliarity?.(clubId),
      cohesion: env.cohesion?.(clubId),
    });
    return { side, strength, profile: tacticalProfile(lineup.tactics, match.conditions), tactics: lineup.tactics };
  };
  return {
    home: build('home'),
    away: build('away'),
    homeAdvantage: match.neutralVenue ? 1 : 1.045,
  };
}

export function makeEvent(
  match: Match,
  type: MatchEventType,
  options: {
    minute: number;
    /** Simulation seconds since kick-off, when the caller keeps a continuous clock. */
    second?: number;
    side: Side | null;
    playerId?: PlayerId | null;
    secondaryPlayerId?: PlayerId | null;
    text: string;
    x: number;
    y: number;
    importance: 1 | 2 | 3;
    /** Goal events report the score *including* the goal just scored. */
    scoreAfter?: { home: number; away: number };
  },
): MatchEvent {
  return {
    id: `${match.id}_e${match.events.length + 1}`,
    minute: options.minute,
    second: options.second ?? options.minute * 60,
    type,
    clubId: options.side ? sideClubId(match, options.side) : null,
    playerId: options.playerId ?? null,
    secondaryPlayerId: options.secondaryPlayerId ?? null,
    text: options.text,
    x: options.x,
    y: options.y,
    scoreAfter: options.scoreAfter ?? currentScore(match),
    importance: options.importance,
  };
}

