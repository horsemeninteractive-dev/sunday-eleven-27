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
  | 'extra-time'
  | 'penalties'
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

/**
 * How much of the manager's attention a commentary line deserves.
 *
 * The simulation knows what happened; this says how loudly to say it. A
 * routine line is the ordinary traffic of a Sunday afternoon, a major one is
 * the reason he is standing on the touchline. The live screen shows one line at
 * a time and uses this to decide how it is dressed; the transcript uses it to
 * decide what a reader skimming wants to see.
 */
export type CommentaryPriority = 'routine' | 'contextual' | 'developing' | 'important' | 'major';

/**
 * The kind of football a commentary line describes.
 *
 * This is the vocabulary of the narrator, not of the engine: a single
 * authoritative event — a shot that is saved — becomes a sequence of lines
 * whose categories walk from possession to chance to keeper.
 */
export type CommentaryCategory =
  | 'possession'
  | 'passing'
  | 'movement'
  | 'challenge'
  | 'progression'
  | 'chance'
  | 'keeper'
  | 'dead-ball'
  | 'major'
  | 'period';

/**
 * One line of the match's own voice.
 *
 * Commentary is generated from the authoritative record and never invents an
 * outcome — it can only say what the simulation did, in the order and with the
 * players it did it. It is kept beside the events rather than instead of them:
 * the events remain the truth, the commentary is how it was told.
 */
export interface CommentaryEvent {
  id: string;
  minute: number;
  /** Whether the minute belongs to the first half, for the 45+/90+ label. */
  firstHalf: boolean;
  side: 'home' | 'away' | null;
  category: CommentaryCategory;
  priority: CommentaryPriority;
  /** Short label for the major moments — GOAL, RED CARD — or null for prose. */
  kind: string | null;
  text: string;
  /** Pitch position 0..1, so a future renderer can follow the same line. */
  x: number;
  y: number;
  scoreAfter: { home: number; away: number } | null;
  playerId: PlayerId | null;
}

/**
 * Where the ball is and what it is doing.
 *
 * The ball is a first-class part of the simulation, not an implication of the
 * last event: it has a position the simulation owns, a previous position so a
 * renderer can interpolate between steps, and a state that says whether it is
 * at somebody's feet, travelling, or loose. `speed` is in pitch-lengths per
 * simulation second; `height` is carried for the aerial game later and is
 * deliberately unused for now.
 */
export type BallStatus = 'controlled' | 'travelling' | 'loose';

export interface BallSpatial {
  x: number;
  y: number;
  px: number;
  py: number;
  status: BallStatus;
  /** The player with the ball at his feet, when it is under control. */
  ownerId: PlayerId | null;
  /** The player a travelling ball is aimed at, or null for a loose aim point. */
  targetId: PlayerId | null;
  /** Where a travelling ball is headed. */
  tx: number;
  ty: number;
  speed: number;
  /** 0 = on the deck. Reserved for flight. */
  height: number;
}

/** What a player is doing with himself, in the coarsest useful sense. */
export type PlayerAction = 'shape' | 'chasing' | 'carrying' | 'supporting' | 'celebrating';

/**
 * Where a player is and where he is going.
 *
 * This is the player's place in the match as the simulation holds it, not a
 * position worked out for the picture: the renderer draws these, it does not
 * derive them. `tx/ty` is the target the simulation has chosen for him, and
 * `px/py` is where he was a step ago so the renderer can smooth between them.
 */
export interface PlayerSpatial {
  playerId: PlayerId;
  side: 'home' | 'away';
  position: PositionCode;
  /** Where his slot tells him to stand, in the match's fixed orientation. */
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  px: number;
  py: number;
  tx: number;
  ty: number;
  /** Pitch-lengths per simulation second. */
  speed: number;
  action: PlayerAction;
}

/**
 * The match's continuous spatial state.
 *
 * Present only for a match somebody is watching: the engine plays other clubs'
 * fixtures out a minute at a time without ever needing to know where anybody
 * stood. It is optional on the match so a save written before the match had a
 * pitch underneath it still loads, and is rebuilt from the lineups when it is
 * first needed.
 */
/** What a passage of play is made of, step by step. */
export type PassageStepKind = 'carry' | 'pass' | 'shot';

/** The outcome the engine has already decided for a shot. */
export type PassageOutcome =
  | 'goal'
  | 'penalty-scored'
  | 'penalty-missed'
  | 'saved'
  | 'blocked'
  | 'off-target';

/**
 * One thing a player does with the ball.
 *
 * A step is a plan, not a wish: the commentary is written from the same steps
 * the pitch plays out, so the words and the picture are the same passage rather
 * than two accounts of the same minute that happen to agree on the score.
 */
export interface PassageStep {
  kind: PassageStepKind;
  playerId: PlayerId;
  /** The man a pass is played to. */
  targetId: PlayerId | null;
  /** Set on a shot, from the engine's own event — never invented here. */
  outcome: PassageOutcome | null;
  /** The engine's sentence for a shot, kept so the narrator can use its words. */
  text: string | null;
  /** Seconds this step is given before the next one begins. */
  duration: number;
  /** Seconds spent on it so far. */
  elapsed: number;
  /** Whether the ball has been put into motion for this step yet. */
  started: boolean;
}

/**
 * The move a side is playing out this minute.
 *
 * Built once, from the names the engine actually used, and then used twice: the
 * spatial layer executes it, and the commentary describes it. That is what stops
 * the words describing a passage the pitch is not playing.
 */
export interface Passage {
  side: 'home' | 'away';
  minute: number;
  steps: PassageStep[];
  step: number;
}

/**
 * The football the simulation is playing right now.
 *
 * A match is not a list of incidents but a run of phases: somebody builds from
 * the back, somebody progresses, somebody reaches the final third, and only then
 * does a chance exist. This is the label for where in that story the match is.
 * It is chiefly the simulation's own vocabulary — only a few of these are ever
 * said to the manager — and it exists so that a decision can depend on what kind
 * of moment it is being made in.
 */
export type MatchPhase =
  | 'kickoff'
  | 'build-up'
  | 'progression'
  | 'final-third'
  | 'chance'
  | 'transition'
  | 'defensive'
  | 'set-piece'
  | 'throw-in'
  | 'goal'
  | 'half-time'
  | 'full-time';

/**
 * Where the ball is on the pitch, from the point of view of the side in
 * possession. "Own box" is his own six-yard area; "box" is the one he attacks.
 */
export type FieldZone = 'own-box' | 'own-third' | 'middle' | 'final-third' | 'box';

/**
 * Where the ball is and who, if anyone, has it.
 *
 * Coordinates are fractions of the pitch in a single fixed frame — the home side
 * always attacks toward x = 1 — so the simulation never has to remember which
 * way anybody is kicking. The event log flips this into its own half-time
 * convention at the point a line is written; the simulation itself does not care.
 */
export interface BallState {
  x: number;
  y: number;
  possessionSide: 'home' | 'away' | null;
  possessionPlayerId: PlayerId | null;
}

/**
 * How a team is standing, in the fixed frame.
 *
 * Three lines, as a real side has: where the back four holds, where the midfield
 * sits, and how far the front men have pushed. `compactness` is how narrow they
 * are (1 = a tight block down the middle, 0 = spread across the park), and
 * `width` is how far they stretch the pitch. These are the numbers a tactic
 * actually moves; everything else is read from them.
 */
export interface TeamShape {
  /** Absolute x of the back line, 0..1 in the fixed frame. */
  defensiveLine: number;
  midfieldLine: number;
  attackingLine: number;
  /** 0..1: how narrow the block is. */
  compactness: number;
  /** 0..1: how far the side stretches across the pitch. */
  width: number;
}

/** How hard each side is currently pressing, 0..1. */
export interface PressureState {
  home: number;
  away: number;
}

/**
 * The authoritative picture of the football, minute to minute.
 *
 * This is deliberately small: a ball, two shapes and a pressure reading. It is
 * not a second spatial renderer — the watched pitch has its own, much richer,
 * `MatchSpatial` — it is the simulation's own working memory, so that the next
 * decision can depend on the last one. It is optional on the match so older
 * saves load unchanged and are given a state the first time one is needed.
 */
export interface MatchFieldState {
  ball: BallState;
  homeShape: TeamShape;
  awayShape: TeamShape;
  pressure: PressureState;
  phase: MatchPhase;
  /** Consecutive possessions each side has won back within a few seconds. */
  counterPress: { home: number; away: number };
}

export interface MatchSpatial {
  players: PlayerSpatial[];
  /** The move being played out right now, or null between moves. */
  passage: Passage | null;
  ball: BallSpatial;
  /** Simulation seconds elapsed since the whistle. */
  clock: number;
  /**
   * Real time not yet spent on a whole step. The simulation is advanced in
   * fixed steps from this, so the football cannot speed up or slow down with
   * the frame rate, and a renderer can interpolate by the fraction left over.
   */
  residual: number;
  /** The goal being celebrated right now, or absent between them. */
  celebration?: Celebration | null;
}

/**
 * A goal being celebrated.
 *
 * Football stops for a moment when the ball goes in: the scorer breaks away and
 * his own team chase him, while the side that conceded is left with the walk
 * back to the halfway line. It is presentation state on the pitch and nothing
 * else — the score was settled by the engine the instant the ball crossed the
 * line, before any of this — and it holds only for as long as the celebration
 * lasts, after which the ball is put back on the centre spot for the restart.
 */
export interface Celebration {
  side: 'home' | 'away';
  scorerId: PlayerId;
  /** Simulation seconds of celebration so far. */
  elapsed: number;
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
  /** Balls played to a teammate, attempted. */
  passes: number;
  /** How many of them arrived. Never more than `passes`. */
  passesCompleted: number;
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
  /**
   * The penalty shootout that decided a cup tie, when there was one.
   *
   * Absent on every match that was decided in normal time or after extra time,
   * which is every league match: this field is written only by the shootout
   * routine and is the single place a cup tie's decider is recorded.
   */
  penalties?: { home: number; away: number };
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
  /**
   * A knockout tie: level after 90 minutes means extra time and then penalties
   * rather than a draw. Absent on every league fixture, so the two-hour contract
   * of a league match is unchanged by this field existing.
   */
  knockout?: boolean;
  conditions: MatchConditions;
  refereeId: PersonId | null;
  lineups: { home: MatchLineup; away: MatchLineup };
  events: MatchEvent[];
  /**
   * The told version of `events`, in order. Absent on matches the human did not
   * watch — the engine only narrates what someone is there to read — and on
   * saves written before narration existed, where readers fall back to the
   * events themselves.
   */
  commentary?: CommentaryEvent[];
  /**
   * The match as it is happening in space. Authoritative simulation state the
   * renderers read; see `MatchSpatial`.
   */
  spatial?: MatchSpatial;
  /**
   * The simulation's own working picture of the football — ball position, team
   * shapes, pressure and the current phase. Distinct from `spatial`, which is
   * presentation for a match somebody is watching; this exists whether or not
   * anybody is looking, because the next decision depends on it.
   */
  field?: MatchFieldState;
  performances: Record<PlayerId, PlayerPerformance>;
  /**
   * Incremental simulation state — the engine advances one minute at a time —
   * plus the calendar's two verdicts, `postponed` and `abandoned`.
   */
  status: MatchStatus | 'postponed' | 'abandoned';
  minute: number;
  /**
   * Which period is being played.
   *
   * 3 exists only for extra time in a knockout tie: a match never reaches it
   * unless `knockout` is set, and a league match cannot reach it at all.
   */
  half: 1 | 2 | 3;
  possessionTicks: { home: number; away: number };
  substitutions: { home: number; away: number };
  played: boolean;
  result: MatchResult | null;
  /** Random seed used by the engine; stored so a match can be replayed exactly. */
  seed: number;
  /**
   * The club a penalty shootout carried through the tie, when one was needed.
   *
   * The goals on a shootout are not goals — they are the record of a decider —
   * so the club that went through is stored here rather than being read back
   * out of a scoreline. Absent on every match decided in normal time or after
   * extra time, and so on every league match.
   */
  shootoutWinnerId?: ClubId;
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

