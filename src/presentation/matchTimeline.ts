import type { MatchEvent, MatchEventType } from '@/domain/match';
import type { Side } from '@/domain/matchState';

/**
 * The match, as passages rather than events.
 *
 * The engine writes one authoritative stream of events: a pass, a tackle, a
 * shot, a goal, each with the second of football it happened on. That is the
 * right record, but it is the wrong unit for *watching* — a highlight is not a
 * single pass, it is the move that ended in the shot, and a replay that treats
 * every event as its own moment spends its time on throw-ins.
 *
 * So this reads the stream and groups it into **passages**: coherent stretches
 * of football by one side, bounded by a change of possession, a stoppage, a goal
 * or a long lull. A passage knows when it started and ended, who was attacking,
 * how important it was, and what it came to. It decides nothing about the
 * football — every event is the engine's own — it only says which of them belong
 * together, so the presentation layer has something to show and the highlight
 * selector has something to choose between.
 *
 * Pure: given the same events it returns the same passages. It is the shared
 * reading of the record that the live screen, a replay and the debug readout all
 * use, so there is one account of the match's story and not one per consumer.
 */

/** What a passage came to, in the coarsest useful sense. */
export type PassageOutcome = 'goal' | 'shot' | 'set-piece' | 'turnover' | 'neutral' | 'whistle';

/**
 * One coherent stretch of football.
 *
 * `startSecond` and `endSecond` are simulation seconds since kick-off — the
 * engine's own clock, not a wall-clock or a minute. A consumer that wants to
 * show this passage knows exactly how much football it is worth.
 */
export interface MatchPassage {
  /** Stable id, derived from its place in the stream. */
  id: string;
  /** Position in the timeline, 0-based. */
  index: number;
  /** Simulation second the passage opened on. */
  startSecond: number;
  /** Simulation second of its last event. */
  endSecond: number;
  /** The side attacking through it, or null for a neutral moment. */
  side: Side | null;
  /** The engine's own events, in order. */
  events: MatchEvent[];
  /** The loudest thing in the passage, 1..3, as the engine rated it. */
  importance: 1 | 2 | 3;
  /** What it came to. */
  outcome: PassageOutcome;
  /** Whether a goal was scored in it. */
  goal: boolean;
  /** The event the detail view is built around — a goal, a shot, a whistle. */
  keyEventId: string | null;
}

/** The whole match as an ordered list of passages. */
export interface MatchTimeline {
  passages: MatchPassage[];
  /** How many seconds of football the match actually ran. */
  durationSeconds: number;
}

/** Which club plays for which side, so a passage can name its attacking side. */
export interface TimelineTeams {
  homeClubId: string;
  awayClubId: string;
}

/**
 * How long a lull ends a passage.
 *
 * Events land every second or so during open play; a gap much longer than this
 * is not the same passage any more — it is a stoppage, a set piece being
 * arranged, or simply quiet. Six seconds is long enough to keep a slow move
 * together and short enough that two unrelated moments are not welded into one.
 */
export const PASSAGE_GAP_SECONDS = 6;

/**
 * The event types that say which side has the ball.
 *
 * A pass, a carry or a tackle is the ball changing hands. Unlike the old sparse
 * stream — one event every nineteen seconds, sides alternating — these now come
 * often enough that a *possession* is legible: a run of them by one side is the
 * move, and the first one by the other side is where it ended. Grouping on them
 * is what turns the timeline back into passages instead of one welded half.
 */
const ON_BALL: ReadonlySet<MatchEventType> = new Set<MatchEventType>(['pass', 'carry', 'tackle']);

/** The event types that end a passage wherever they fall. */
const HARD_BREAK: ReadonlySet<MatchEventType> = new Set<MatchEventType>([
  'kick-off',
  'goal',
  'own-goal',
  'penalty-scored',
  'penalty-missed',
  'half-time',
  'full-time',
  'extra-time',
  'penalties',
  'substitution',
]);

/** The event types that make a passage worth showing in detail. */
const KEY_EVENT: ReadonlySet<MatchEventType> = new Set<MatchEventType>([
  'goal',
  'own-goal',
  'penalty-scored',
  'penalty-missed',
  'shot-saved',
  'shot-off-target',
  'shot-blocked',
  'red-card',
  'half-time',
  'full-time',
  'extra-time',
  'penalties',
  'kick-off',
]);

function sideOfEvent(teams: TimelineTeams, event: MatchEvent): Side | null {
  if (event.clubId === null) return null;
  if (event.clubId === teams.homeClubId) return 'home';
  if (event.clubId === teams.awayClubId) return 'away';
  return null;
}

function outcomeOf(events: readonly MatchEvent[]): PassageOutcome {
  let outcome: PassageOutcome = 'neutral';
  const rank: Record<PassageOutcome, number> = {
    neutral: 0,
    turnover: 1,
    'set-piece': 2,
    shot: 3,
    goal: 4,
    whistle: 5,
  };
  const raise = (next: PassageOutcome) => {
    // A whistle is not "more important" than a goal; it is just its own thing,
    // so it is only chosen when nothing louder happened in the passage.
    if (next === 'whistle' && outcome !== 'neutral') return;
    if (next !== 'whistle' && outcome === 'whistle') return;
    if (rank[next] > rank[outcome]) outcome = next;
  };
  for (const event of events) {
    switch (event.type) {
      case 'goal':
      case 'own-goal':
      case 'penalty-scored':
        raise('goal');
        break;
      case 'penalty-missed':
      case 'shot-saved':
      case 'shot-off-target':
      case 'shot-blocked':
        raise('shot');
        break;
      case 'corner':
      case 'throw-in':
      case 'goal-kick':
      case 'foul':
        raise('set-piece');
        break;
      case 'tackle':
      case 'yellow-card':
      case 'red-card':
      case 'offside':
        raise('turnover');
        break;
      case 'kick-off':
      case 'half-time':
      case 'full-time':
      case 'extra-time':
      case 'penalties':
        raise('whistle');
        break;
      default:
        break;
    }
  }
  return outcome;
}

function secondOf(event: MatchEvent): number {
  return event.second ?? event.minute * 60;
}

/**
 * The side a passage belongs to.
 *
 * The key event decides it — the shot, the goal — because that is the moment the
 * passage is *about*; a passage of passes that ended in a goal is the scorer's.
 * A passage with no key event falls back to whoever caused most of it, and one
 * with no side at all is neutral (a whistle, a stoppage).
 *
 * Deliberately not the side of the first event: the engine's stream talks about
 * the man who *did* each thing, and a tackle by the defending side sits inside
 * the attacking passage that provoked it, so the first event is often the wrong
 * answer.
 */
function sideOfPassage(teams: TimelineTeams, events: readonly MatchEvent[], keyEvent: MatchEvent): Side | null {
  const key = sideOfEvent(teams, keyEvent);
  if (key) return key;
  const tally = new Map<Side, number>();
  for (const event of events) {
    const side = sideOfEvent(teams, event);
    if (side) tally.set(side, (tally.get(side) ?? 0) + 1);
  }
  let best: Side | null = null;
  let bestCount = 0;
  for (const [side, count] of tally) {
    if (count > bestCount) {
      best = side;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Group the engine's events into passages.
 *
 * The rules are deliberately simple and legible, because a timeline nobody can
 * predict is a timeline nobody can test: a new passage opens when the ball
 * changes hands, when a lull longer than {@link PASSAGE_GAP_SECONDS} passes, or
 * immediately after a hard break (a goal, a whistle, a change), which always
 * ends the thing it belongs to.
 *
 * It splits on a change of *possession*, read from the on-ball events alone —
 * the pass, the carry, the tackle — not on the side of every event. The engine's
 * events name the man who did each thing, and inside one move the non-ball
 * events (an interception, a keeper's save) can name either side; splitting on
 * those would shatter the move. The on-ball events, by contrast, are one-sided
 * for as long as one side has it, which is exactly the unit worth watching.
 *
 * A passage's *side* is still read afterwards, from the moment it is about, so a
 * move that began with a tackle the other way is still told from its finish.
 */
export function buildTimeline(events: readonly MatchEvent[], teams: TimelineTeams): MatchTimeline {
  const passages: MatchPassage[] = [];
  let current: MatchEvent[] = [];
  // Who has the ball, as the on-ball events last said. Null between passages
  // and after a hard break, so the first pass of a new move never "changes"
  // hands from a stale value.
  let possession: Side | null = null;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const importance = current.reduce<1 | 2 | 3>(
      (loudest, event) => (event.importance > loudest ? event.importance : loudest),
      1,
    );
    const outcome = outcomeOf(current);
    const keyEvent =
      [...current].reverse().find((event) => KEY_EVENT.has(event.type)) ?? last;
    passages.push({
      id: `p${passages.length + 1}`,
      index: passages.length,
      startSecond: secondOf(first),
      endSecond: secondOf(last),
      side: sideOfPassage(teams, current, keyEvent),
      events: current,
      importance,
      outcome,
      goal: outcome === 'goal',
      keyEventId: keyEvent.id,
    });
    current = [];
  };

  for (const event of events) {
    const second = secondOf(event);
    const previous = current[current.length - 1];
    const ballSide = ON_BALL.has(event.type) ? sideOfEvent(teams, event) : null;
    const changedHands = ballSide !== null && possession !== null && ballSide !== possession;
    const lull = previous !== undefined && second - secondOf(previous) > PASSAGE_GAP_SECONDS;

    if (current.length === 0 || changedHands || lull) flush();
    current.push(event);
    if (ballSide !== null) possession = ballSide;

    // A hard break ends the passage it belongs to: a goal closes the move that
    // made it, a whistle closes the spell of play before it. The ball is nobody's
    // until the next passage starts.
    if (HARD_BREAK.has(event.type)) {
      flush();
      possession = null;
    }
  }
  flush();

  const durationSeconds = events.length === 0 ? 0 : secondOf(events[events.length - 1]!);
  return { passages, durationSeconds };
}

/** The loudest passages, for a highlight reel or a key-only viewing mode. */
export function highlightPassages(timeline: MatchTimeline, minimumImportance: 1 | 2 | 3 = 2): MatchPassage[] {
  return timeline.passages.filter((passage) => passage.importance >= minimumImportance);
}

/** The most recent passage at or before a simulation second. */
export function passageAt(timeline: MatchTimeline, second: number): MatchPassage | null {
  let found: MatchPassage | null = null;
  for (const passage of timeline.passages) {
    if (passage.startSecond <= second) found = passage;
    else break;
  }
  return found;
}

/** The next passage that starts strictly after a simulation second. */
export function nextPassageAfter(timeline: MatchTimeline, second: number): MatchPassage | null {
  for (const passage of timeline.passages) {
    if (passage.startSecond > second) return passage;
  }
  return null;
}
