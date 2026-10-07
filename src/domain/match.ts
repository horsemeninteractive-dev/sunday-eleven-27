import type { ClubId, CompetitionId, GroundId, ISODate, MatchId, PersonId, PlayerId, SeasonId } from './ids';
import type { PositionCode } from './positions';
import type { Tactics } from './tactics';
import type { MatchRecording } from './matchRecording';
// Type-only on purpose: the role table lives in the simulation layer, and this
// keeps the domain free of any runtime dependency on it.
import type { Role } from '@/simulation/match/roles';

/**
 * The continuous-state vocabulary lives in `./matchState`, and is re-exported
 * here so that readers of the match domain have one place to look.
 */
export type {
  ActionOutcome,
  BallStatus,
  MatchAction,
  MatchActionKind,
  MatchActionStatus,
  MatchBallState,
  PlayerAction,
  PlayerState,
} from './matchState';

export type { MatchRecording, ReplayKeyframe, RecordedSample } from './matchRecording';

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

/**
 * Which part of a match is being played.
 *
 * A half number cannot tell the first period of extra time from the second, and
 * it is the season's own shorthand rather than what a manager is watching. The
 * period is the football's own answer, set by the engine as it plays and read by
 * the screen and the shell. It is optional on the `Match` so a save written
 * before it existed still loads; {@link periodOf} falls back to the half there.
 */
export type MatchPeriod = 'first-half' | 'second-half' | 'extra-first' | 'extra-second';

export const PERIOD_LABEL: Record<MatchPeriod, string> = {
  'first-half': 'First half',
  'second-half': 'Second half',
  'extra-first': 'Extra time',
  'extra-second': 'Extra time',
};

export interface LineupSlot {
  playerId: PlayerId;
  position: PositionCode;
  /**
   * What he is for, as opposed to where he stands.
   *
   * A formation places him; a role decides what he does once he has the ball,
   * whether he may shoot at all, and how far off his slot he drifts. Two sides
   * can set out identically and play nothing alike because of this field.
   *
   * The import is type-only on purpose: the role table itself lives in the
   * simulation layer, beside the decision model that reads it, and a type-only
   * import leaves no runtime edge between the domain and the simulation.
   */
  role: Role;
  /** True when the player is playing far from any recognised role. */
  outOfPosition: boolean;
}

export interface BenchSlot {
  playerId: PlayerId;
  /** Bench players are nominally given a role for warm-up purposes. */
  position: PositionCode;
  /** The role he takes the field in, if he is brought on. */
  role: Role;
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
  /**
   * A goal put into a side's own net by one of its own defenders.
   *
   * The event belongs to the side that *benefits*, exactly like a goal, and its
   * `playerId` names the defender who turned it in — so the score, the event
   * stream, the report and the statistic all agree about who it counts for and
   * who it happened to.
   */
  | 'own-goal'
  | 'penalty-scored'
  | 'penalty-missed'
  | 'shot-saved'
  | 'shot-off-target'
  | 'shot-blocked'
  | 'offside'
  | 'corner'
  /**
   * The ball going out over the goal line off an attacker: a goal kick.
   *
   * The engine counts it as a statistic *and* writes it down, so the record and
   * the tally agree about a restart the way they already do for a corner and a
   * throw-in.
   */
  | 'goal-kick'
  /**
   * The ball going out over the touchline: a throw-in to the side that did not
   * put it there. The engine writes it as an event as well as counting it, so
   * the record and the statistics agree about the restart.
   */
  | 'throw-in'
  /**
   * The ordinary texture of the game: a pass played, a carry, a tackle won.
   *
   * Emitted so the timeline has real passages to group — a move is a run of
   * passes and carries that *ended* somewhere, not a solitary shot — and so the
   * record is the football rather than only its loudest moments. They are the
   * lowest importance and carry no incident of their own: they are told by the
   * pitch and the passage, not shouted across the screen.
   */
  | 'pass'
  | 'carry'
  | 'tackle'
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
  /**
   * Seconds of football simulated since kick-off, when the engine wrote it.
   *
   * `minute` is a whole-minute summary for the record; this is the simulation's
   * own clock, at the resolution the presentation layer needs to decide how much
   * of a passage to show. Optional because events recorded before the continuous
   * engine have only a minute.
   */
  second?: number;
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
  /**
   * How far into the minute's move this line belongs, 0..1.
   *
   * Set on the lines that describe the passage, from the same steps the pitch
   * plays, so the words can be revealed *as the move happens* rather than paced
   * out at an even rate beside it. Absent on a line that is not part of a move —
   * a foul, a booking, a note — which is read when the move is done.
   */
  progress?: number | null;
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
 * How a team is standing, in the fixed frame.
 *
 * Three lines, as a real side has: where the back four holds, where the midfield
 * sits, and how far the front men have pushed. `compactness` is how narrow they
 * are (1 = a tight block down the middle, 0 = spread across the park), and
 * `width` is how far they stretch the pitch. These are the numbers a tactic
 * actually moves; everything else is read from them.
 */
export interface LineHeights {
  back: number;
  middle: number;
  front: number;
}

export interface TeamShape {
  /**
   * Where the three lines sit, keyed by where the ball is on the pitch.
   *
   * This is the change that makes the shape a shape rather than a number. A
   * single set of line heights has to average over every situation the ball can
   * be in, and an average is exactly what cannot produce a back four that steps
   * up together or a winger who stays on the touchline: the block only ever
   * has one answer, so it is always in the wrong place.
   */
  lines: {
    ownThird: LineHeights;
    middle: LineHeights;
    finalThird: LineHeights;
    /** Heights when the opponent has the ball in each third. */
    defending: {
      ownThird: LineHeights;
      middle: LineHeights;
      finalThird: LineHeights;
    };
  };
  /** How far the block slides sideways toward the ball, 0..1. */
  ballOrientation: number;
  /** How compact the block is in and out of possession. */
  compactness: { inPossession: number; outOfPossession: number };
  /** How wide the block is in and out of possession. */
  width: { inPossession: number; outOfPossession: number };
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

/**
 * How many players a side is built for, and the fewest it may field.
 *
 * Eleven is the shape a lineup is drawn for, but a side does not need all
 * eleven: the laws allow a team to start with as few as seven, and the match
 * engine arranges whatever it is given. Below the minimum there is no side to
 * put out at all, and the fixture is forfeited — see `FORFEIT_GOALS`.
 */
export const FULL_SIDE = 11;
export const MIN_SIDE = 7;

/** The score a side that cannot field a team forfeits the fixture by. */
export const FORFEIT_GOALS = 3;

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
 * How a fixture was decided.
 *
 * The game has two ways to play a match, and which one is used is a property of
 * the fixture rather than of the caller: `'full'` is the `MatchEngine` — the
 * fixed-step spatial simulation, run either watched or straight out to the
 * whistle — and `'fast'` is the abstract background model that plays the
 * fixtures nobody watches. The distinction is explicit because the two produce
 * different *depth* of record (the full engine writes the ordinary texture, the
 * fast mode writes only what the rest of the game reads) and because a reader
 * must never have to guess which one it is looking at.
 */
export type MatchSimulationMode = 'full' | 'fast';

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
   * The watched match's movement, remembered for the replay.
   *
   * Present only for a match somebody watched: the continuous state is sampled
   * while it moves, so a replay can play the real movement back instead of
   * laying the teams out from their formation between the recorded moments. It
   * is presentation data — nothing reads it to decide any football — and it is
   * optional, so a save written before it existed loads unchanged.
   */
  recording?: MatchRecording;
  performances: Record<PlayerId, PlayerPerformance>;
  /**
   * Incremental simulation state — the engine advances one minute at a time —
   * plus the calendar's two verdicts, `postponed` and `abandoned`.
   */
  status: MatchStatus | 'postponed' | 'abandoned';
  /**
   * The match clock, in whole minutes.
   *
   * This is the *label* — what the clock on the screen reads, and what an event
   * is filed under. It is derived from {@link Match.footballSeconds} rather than
   * counted on its own, so the minute a thing is reported in is always the
   * minute the football had actually reached when it happened.
   */
  minute: number;
  /**
   * Seconds of football played so far. The simulation's own clock.
   *
   * The minute is a label; *this* is the truth, and it does not come in sixtieths
   * of anything. A possession is a run of decisions that takes as long as it
   * takes — thirty seconds, ninety, whatever the football says — and it is free
   * to run straight through a minute mark without being cut in half. The engine
   * decides a slice of this clock at a time and the pitch plays that same clock
   * back at one second per second, so what was decided is what is shown.
   *
   * Optional so a save written before the clock existed still loads: the first
   * read gives it a value from the minute the match had already reached.
   */
  footballSeconds?: number;
  /**
   * The part of the last slice of football that was decided past the clock.
   *
   * The engine decides a little further than the minute it was asked for, so a
   * possession is never left dangling half-decided; this is how much further. The
   * next slice starts from here rather than from the clock, which is what lets a
   * possession run across a minute mark instead of being cut in half by it.
   */
  footballCarryoverSeconds?: number;
  /**
   * Which period is being played.
   *
   * 3 exists only for extra time in a knockout tie: a match never reaches it
   * unless `knockout` is set, and a league match cannot reach it at all.
   */
  half: 1 | 2 | 3;
  /**
   * The part of the game, as the engine played it: first half, second half, or
   * either period of extra time.
   *
   * The truth the UI labels with, rather than inferring it from {@link half} —
   * which cannot tell the two periods of extra time apart. Optional, so a save
   * written before it existed (or a match still played by the old engine) loads;
   * read it through {@link periodOf}, which falls back to the half.
   */
  period?: MatchPeriod;
  /**
   * Added time played at the end of each half, in minutes, as the engine
   * measured it.
   *
   * Not a guess made before kick-off: the engine watches the ball while it is
   * dead — restarts being arranged, goals being celebrated — adds the small
   * stuff it does not model (retrieving the ball, a word with the referee), and
   * the total is what the referee plays. Optional, because a half that has not
   * been played yet has nothing to report — and a save written before the engine
   * measured its own stoppages falls back to a seeded draw, as it always did.
   */
  stoppage?: { first?: number; second?: number };
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

  /**
   * Which simulation decided this fixture.
   *
   * Written by whichever entry point played the match, so nobody has to infer
   * it after the fact. Optional, and an absent value means the full engine —
   * every match already saved was played by it, and every save written before
   * the modes existed loads unchanged. See {@link MatchSimulationMode}.
   */
  simulationMode?: MatchSimulationMode;
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

/**
 * The part of the game a match is in.
 *
 * The engine sets `match.period` as it plays, and this is how the rest of the
 * game reads it — no longer guessing from the half number. The fallback is for a
 * save written before the field existed, or a fixture the old engine played: it
 * is the closest the half can come, and cannot tell the two periods of extra
 * time apart.
 */
export function periodOf(match: Match): MatchPeriod {
  if (match.period) return match.period;
  if (match.half === 1) return 'first-half';
  if (match.half === 2) return 'second-half';
  return 'extra-first';
}

/** What to call that part of the game: "First half", "Second half", "Extra time". */
export function periodLabel(match: Match): string {
  return PERIOD_LABEL[periodOf(match)];
}

