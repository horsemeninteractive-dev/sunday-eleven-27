import type { ClubId, CompetitionId, GroundId, ISODate, MatchId, PersonId, PlayerId, SeasonId } from './ids';
import type { PositionCode } from './positions';
import type { Tactics } from './tactics';

export type Weather = 'clear' | 'overcast' | 'windy' | 'light-rain' | 'heavy-rain' | 'cold' | 'frozen';

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'Clear and bright',
  overcast: 'Overcast',
  windy: 'Windy',
  'light-rain': 'Light rain',
  'heavy-rain': 'Heavy rain',
  cold: 'Cold and raw',
  frozen: 'Frozen',
};

export type PitchCondition = 'excellent' | 'good' | 'worn' | 'muddy' | 'waterlogged' | 'frozen';

export const PITCH_LABEL: Record<PitchCondition, string> = {
  excellent: 'Excellent',
  good: 'Good',
  worn: 'Worn',
  muddy: 'Muddy',
  waterlogged: 'Waterlogged',
  frozen: 'Frozen',
};

export interface LineupSlot {
  playerId: PlayerId;
  position: PositionCode;
  /** True when the player is playing far from any recognised role. */
  outOfPosition: boolean;
}

export interface BenchSlot {
  playerId: PlayerId;
  /** Bench players are nominally given a role for warm-up purposes. */
  position: PositionCode;
}

export interface MatchLineup {
  clubId: ClubId;
  formation: string;
  starting: LineupSlot[];
  bench: BenchSlot[];
  tactics: Tactics;
  captainId: PlayerId | null;
  /** Filled by the engine for players brought on. */
}

export type MatchEventType =
  | 'kick-off'
  | 'goal'
  | 'penalty-scored'
  | 'penalty-missed'
  | 'shot-saved'
  | 'shot-off-target'
  | 'shot-blocked'
  | 'offside'
  | 'corner'
  | 'foul'
  | 'yellow-card'
  | 'red-card'
  | 'injury'
  | 'substitution'
  | 'chance'
  | 'half-time'
  | 'full-time'
  | 'note';

export interface MatchEvent {
  id: string;
  minute: number;
  type: MatchEventType;
  /** Club the event belongs to; null for neutral events (half-time, full-time). */
  clubId: ClubId | null;
  playerId: PlayerId | null;
  secondaryPlayerId: PlayerId | null;
  /** Rendered commentary line. */
  text: string;
  /** Pitch position 0..1: x along the length (0 = home goal), y across the width. */
  x: number;
  y: number;
  scoreAfter: { home: number; away: number };
  /** 1 = background, 2 = notable, 3 = key incident. */
  importance: 1 | 2 | 3;
}

export interface InjuryDetail {
  description: string;
  severity: 'knock' | 'minor' | 'moderate' | 'serious';
  daysOut: number;
}

export interface PlayerPerformance {
  playerId: PlayerId;
  clubId: ClubId;
  started: boolean;
  minutesPlayed: number;
  positionPlayed: PositionCode;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passes: number;
  tackles: number;
  interceptions: number;
  saves: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  /** 0-10 match rating. */
  rating: number;
  cameOnMinute: number | null;
  wentOffMinute: number | null;
  /** In-match energy (0-100). Not the same as the player's weekly fitness. */
  energy: number;
  /** Set when the player picks up an injury during the match. */
  injuryDetail: InjuryDetail | null;
  sentOff: boolean;
}

export interface MatchConditions {
  weather: Weather;
  pitch: PitchCondition;
  /** 1-20 quality of the playing surface on the day. */
  pitchQuality: number;
  temperatureC: number;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homePossession: number;
  awayPossession: number;
  attendance: number;
}

export type MatchStatus = 'scheduled' | 'in-progress' | 'finished';

/**
 * The calendar's view of a fixture: on, off, or never played at all.
 *
 * A postponement is not a silent edit to a date — the original is kept, with
 * the reason and the date it was called off, and a replacement is created for
 * the rearranged game. That is how a season ends up with genuine congestion.
 */
export type FixtureState =
  /** Still to be played (or being played now). */
  | 'scheduled'
  /** Played. */
  | 'played'
  /** Called off, and a replacement has been arranged. */
  | 'postponed'
  /** Called off with nowhere left to play it. */
  | 'abandoned';

export interface Match {
  id: MatchId;
  seasonId: SeasonId;
  competitionId: CompetitionId;
  competitionName: string;
  matchday: number;
  date: ISODate;
  kickOff: string;
  homeClubId: ClubId;
  awayClubId: ClubId;
  groundId: GroundId;
  neutralVenue: boolean;
  conditions: MatchConditions;
  refereeId: PersonId | null;
  lineups: { home: MatchLineup; away: MatchLineup };
  events: MatchEvent[];
  performances: Record<PlayerId, PlayerPerformance>;
  /**
   * Incremental simulation state — the engine advances one minute at a time —
   * plus the calendar's two verdicts, `postponed` and `abandoned`.
   */
  status: MatchStatus | 'postponed' | 'abandoned';
  minute: number;
  half: 1 | 2;
  possessionTicks: { home: number; away: number };
  substitutions: { home: number; away: number };
  played: boolean;
  result: MatchResult | null;
  /** Random seed used by the engine; stored so a match can be replayed exactly. */
  seed: number;
  /** Non-critical incidents: missing nets, late arrivals, dog on the pitch. */
  incidents: string[];

  // --- The calendar's own record of the fixture -------------------------
  /** Why the original game did not happen, in words. */
  postponementReason: string | null;
  /** When it was called off. */
  postponedOn: ISODate | null;
  /** The date this fixture was originally scheduled for, once it has moved. */
  originalDate: ISODate | null;
  /** The match that replaced a postponed one, or the one this replaced. */
  replacedByMatchId: MatchId | null;
  /** Whether the morning-of-the-game phone calls have already been made. */
  lateCallMade: boolean;
}

/**
 * A match that counts: one played inside a competition the world runs.
 *
 * A friendly is arranged between two clubs and never touches a table, a league
 * record or a career appearance. Everything that writes those figures asks this
 * first, so a warm-up in July stays a warm-up in July.
 */
export function isCompetitiveMatch(state: { competitions: Record<string, unknown> }, match: Match): boolean {
  return Boolean(state.competitions[match.competitionId]);
}

