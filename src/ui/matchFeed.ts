import type { Match, MatchEvent, MatchEventType } from '@/domain/match';

/**
 * Between the match engine and the live feed.
 *
 * The engine's job is to be right; this layer's job is to be readable. It
 * decides what a manager actually needs thrown at him while the game is
 * running — a goal is not the same as a throw-in — and it keeps the feed
 * bounded, because a transcript that grows all afternoon is a transcript that
 * pushes the rest of the match off the screen.
 *
 * Nothing here invents an incident: every line is one the engine produced.
 */

export type FeedTone = 'major' | 'important' | 'normal';

export interface FeedEntry {
  id: string;
  /** Human-facing minute, e.g. "45+2". */
  minute: string;
  /** Match minute the entry belongs to, for ordering and highlight windows. */
  rawMinute: number;
  tone: FeedTone;
  /** Short label for the incident — GOAL, YELLOW CARD — or null for prose. */
  kind: string | null;
  side: 'home' | 'away' | null;
  text: string;
  scoreAfter: { home: number; away: number } | null;
}

export interface MatchFeed {
  /**
   * Newest first, already bounded. The first entry is the one the strip across
   * the top of the panel is showing, so the list beneath it starts at the
   * second — one incident is never reported twice.
   */
  entries: FeedEntry[];
  /** The oldest entry still in the feed, so the UI can say how far back it goes. */
  oldestMinute: string | null;
}

/** How much of the match the feed keeps on screen. */
export const FEED_LIMIT = 30;

const KIND_LABEL: Partial<Record<MatchEventType, string>> = {
  goal: 'Goal',
  'penalty-scored': 'Penalty scored',
  'penalty-missed': 'Penalty missed',
  'red-card': 'Red card',
  'yellow-card': 'Yellow card',
  substitution: 'Substitution',
  injury: 'Injury',
  'shot-saved': 'Save',
  chance: 'Chance',
  corner: 'Corner',
  foul: 'Foul',
  offside: 'Offside',
  'half-time': 'Half time',
  'full-time': 'Full time',
  'kick-off': 'Kick-off',
};

/** Incidents that are the match, whatever the engine's importance says. */
const MAJOR_TYPES: ReadonlySet<MatchEventType> = new Set(['goal', 'penalty-scored', 'penalty-missed', 'red-card', 'half-time', 'full-time']);
/** Incidents worth marking out, but not worth stopping the game for. */
const IMPORTANT_TYPES: ReadonlySet<MatchEventType> = new Set(['yellow-card', 'substitution', 'injury', 'shot-saved', 'chance']);

function toneFor(event: MatchEvent): FeedTone {
  if (MAJOR_TYPES.has(event.type) || event.importance >= 3) return 'major';
  if (IMPORTANT_TYPES.has(event.type) || event.importance >= 2) return 'important';
  return 'normal';
}

/**
 * The minute as a manager would say it.
 *
 * The engine's clock counts straight through, so minute 47 happens once as
 * first-half stoppage and once as the second half. Which one an incident
 * belongs to is decided by the half-time marker: everything before it is the
 * first half, everything after is the second.
 */
function minuteLabel(minute: number, firstHalf: boolean): string {
  if (minute === 0) return '0';
  if (firstHalf) return minute <= 45 ? String(minute) : `45+${minute - 45}`;
  return minute <= 90 ? String(minute) : `90+${minute - 90}`;
}

/**
 * Build the live feed.
 *
 * `keyOnly` is the manager's own filter: it drops the ordinary business of a
 * Sunday afternoon so only the incidents with something on them remain.
 */
export function buildMatchFeed(
  match: Match,
  options: { limit?: number; keyOnly?: boolean } = {},
): MatchFeed {
  const limit = Math.max(1, options.limit ?? FEED_LIMIT);
  const halfTimeIndex = match.events.findIndex((event) => event.type === 'half-time');

  const entries: FeedEntry[] = [];
  let previousText: string | null = null;
  for (let index = match.events.length - 1; index >= 0; index -= 1) {
    const event = match.events[index]!;
    // The half-time whistle itself belongs to the first half it ends.
    const firstHalf = halfTimeIndex < 0 || index <= halfTimeIndex;
    const tone = toneFor(event);
    if (options.keyOnly && tone === 'normal') continue;
    // The engine can produce the same line twice in a minute — a nudge and an
    // appeal. One is enough.
    if (event.text === previousText) continue;
    previousText = event.text;
    entries.push({
      id: event.id,
      minute: minuteLabel(event.minute, firstHalf),
      rawMinute: event.minute,
      tone,
      kind: KIND_LABEL[event.type] ?? null,
      side: event.clubId === match.homeClubId ? 'home' : event.clubId === match.awayClubId ? 'away' : null,
      text: event.text,
      scoreAfter: event.type === 'goal' || event.type === 'penalty-scored' ? event.scoreAfter : null,
    });
    if (entries.length >= limit) break;
  }

  return {
    entries,
    oldestMinute: entries.length > 0 ? entries[entries.length - 1]!.minute : null,
  };
}

/** The line the strip is showing: the newest incident, or nothing yet. */
export function latestLine(feed: MatchFeed): FeedEntry | null {
  return feed.entries[0] ?? null;
}
