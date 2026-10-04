import type { ClubId, PlayerId } from '@/domain/ids';
import type {
  FieldZone,
  Match,
  MatchEvent,
  MatchEventType,
  MatchPhase,
  PlayerPerformance,
} from '@/domain/match';
import type { Player } from '@/domain/person';
import type { Tactics } from '@/domain/tactics';
import { stream, type Rng } from '../rng';
import * as C from './commentary';
import { computeTeamStrength, type TeamStrength } from './teamStrength';
import { tacticalProfile, type TacticalProfile } from './tacticsModel';

/**
 * The pieces every part of the match simulation shares.
 *
 * The engine, the possession model, the set-piece routines and the shot model
 * all need the same handful of things: which side is which, how the minute's
 * random stream is read, how an event is written down, and how strong each team
 * is right now. Those live here so the newer modules can use them without
 * importing the engine back — the engine imports them, not the other way round.
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
  /**
   * A developer-only hook for watching the simulation think.
   *
   * When supplied, every decision the possession model makes — the action it
   * weighed, the one it chose, the pass it played, the duel it lost — is handed
   * to this callback in plain English. It exists so a balance problem can be
   * read rather than guessed at, and it is never wired up for a normal player:
   * an ordinary match passes nothing here and pays nothing for it.
   */
  trace?: (entry: SimTraceEntry) => void;
}

export interface MinuteResult {
  minute: number;
  events: MatchEvent[];
  halfTime: boolean;
  finished: boolean;
}

/** One line of the developer trace. Prose first; the numbers are the detail. */
export interface SimTraceEntry {
  minute: number;
  half: 1 | 2 | 3;
  phase: MatchPhase;
  side: Side | null;
  playerId: PlayerId | null;
  zone: FieldZone | null;
  message: string;
  detail?: Record<string, number | string | null>;
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

export function halfEndMinute(match: Match, half: 1 | 2 | 3): number {
  if (half === 1) return 45 + stoppageMinutes(match, 1);
  if (half === 2) return 90 + stoppageMinutes(match, 1) + stoppageMinutes(match, 2);
  // Extra time is fifteen a period with nothing added on top: the whole point of
  // it is that it is short and every leg in it is heavy.
  return half === 3 ? 105 : 120;
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

export function pushEvent(match: Match, event: MatchEvent, sink: MatchEvent[]): void {
  match.events.push(event);
  sink.push(event);
}

/**
 * Turn a point in the simulation's fixed frame into the event log's frame.
 *
 * The simulation always has the home side attacking toward x = 1, because that
 * is the simplest thing to reason about. The event log, and the little map strip
 * that reads it, keeps the old convention of flipping at half time so that the
 * "home" half of the pitch is the one being attacked in each period. This is the
 * single place the two meet.
 */
export function eventCoords(match: Match, x: number, y: number): { x: number; y: number } {
  const attackingRight = homeAttacksRight(match);
  return {
    x: Math.max(0.02, Math.min(0.98, attackingRight ? x : 1 - x)),
    y: Math.max(0.04, Math.min(0.96, y)),
  };
}

/** Pitch coordinates for a loose action by `side`, used where no exact point exists. */
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

export function textContext(
  env: MatchEnvironment,
  match: Match,
  side: Side,
  rng: Rng,
  extras: { player?: Player | null; partner?: Player | null; quality?: number; score?: string } = {},
): C.CommentaryContext {
  const opponent = otherSide(side);
  const score = currentScore(match);
  return {
    player: extras.player ?? null,
    partner: extras.partner ?? null,
    teamName: env.clubShortName(sideClubId(match, side)),
    opponentName: env.clubShortName(sideClubId(match, opponent)),
    minute: match.minute,
    score: extras.score ?? `${score.home}-${score.away}`,
    quality: extras.quality,
    rngPick: <T,>(items: readonly T[]) => rng.pick(items),
  };
}

/** The number of goals, as the match currently stands, for a given side. */
export function goalsFor(match: Match, side: Side): number {
  const score = currentScore(match);
  return side === 'home' ? score.home : score.away;
}

export function goalsAgainst(match: Match, side: Side): number {
  const score = currentScore(match);
  return side === 'home' ? score.away : score.home;
}
