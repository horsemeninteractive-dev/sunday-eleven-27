import type { CommentaryCategory, CommentaryEvent, CommentaryPriority, Match, MatchEvent, MatchEventType } from '@/domain/match';

/**
 * The match's commentary, as a history rather than a live feed.
 *
 * The engine's job is to be right; this layer's job is to be readable, and to
 * be the one place the rest of the UI asks for "what was said". It prefers the
 * match's own transcript, written as the game was played; a match nobody
 * watched — or a save from before narration existed — falls back to the raw
 * events, so a report can always be produced from what the record holds.
 *
 * Nothing here invents an incident: every line came from the engine.
 */

export type FeedTone = 'major' | 'important' | 'normal';

export interface FeedEntry {
  id: string;
  /** Human-facing minute, e.g. "45+2". */
  minute: string;
  /** Match minute the entry belongs to, for ordering and highlight windows. */
  rawMinute: number;
  tone: FeedTone;
  /** The narrator's category — possession, chance, keeper — when known. */
  category: CommentaryCategory | null;
  /** How loudly the line should be read. */
  priority: CommentaryPriority;
  /** Short label for the incident — GOAL, YELLOW CARD — or null for prose. */
  kind: string | null;
  side: 'home' | 'away' | null;
  text: string;
  scoreAfter: { home: number; away: number } | null;
}

export interface MatchFeed {
  /**
   * Newest first. When a limit is given it is applied from the newest end, so a
   * requested window always contains the latest incident.
   */
  entries: FeedEntry[];
  /** The oldest entry still in the feed, so the UI can say how far back it goes. */
  oldestMinute: string | null;
  /** True when the transcript came from the match's own narration. */
  narrated: boolean;
}

/** How much of the match a live window keeps on screen. */
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
  'shot-blocked': 'Blocked',
  'shot-off-target': 'Off target',
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

function toneForPriority(priority: CommentaryPriority): FeedTone {
  if (priority === 'major') return 'major';
  if (priority === 'important') return 'important';
  return 'normal';
}

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

function entryFromCommentary(event: CommentaryEvent): FeedEntry {
  return {
    id: event.id,
    minute: minuteLabel(event.minute, event.firstHalf),
    rawMinute: event.minute,
    tone: toneForPriority(event.priority),
    category: event.category,
    priority: event.priority,
    kind: event.kind,
    side: event.side,
    text: event.text,
    scoreAfter: event.scoreAfter,
  };
}

/** The raw events, told as they were when no narration was recorded. */
function entriesFromEvents(match: Match, limit: number, keyOnly: boolean): MatchFeed {
  const halfTimeIndex = match.events.findIndex((event) => event.type === 'half-time');
  const entries: FeedEntry[] = [];
  let previousText: string | null = null;
  for (let index = match.events.length - 1; index >= 0; index -= 1) {
    const event = match.events[index]!;
    // The half-time whistle itself belongs to the first half it ends.
    const firstHalf = halfTimeIndex < 0 || index <= halfTimeIndex;
    const tone = toneFor(event);
    if (keyOnly && tone === 'normal') continue;
    // The engine can produce the same line twice in a minute — a nudge and an
    // appeal. One is enough.
    if (event.text === previousText) continue;
    previousText = event.text;
    entries.push({
      id: event.id,
      minute: minuteLabel(event.minute, firstHalf),
      rawMinute: event.minute,
      tone,
      category: null,
      priority: tone === 'major' ? 'major' : tone === 'important' ? 'important' : 'routine',
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
    narrated: false,
  };
}

/**
 * Build the commentary history, newest first.
 *
 * `keyOnly` is the reader's own filter: it keeps only the lines with something
 * on them, so a manager skimming an afternoon can see its shape at a glance.
 */
export function buildMatchFeed(match: Match, options: { limit?: number; keyOnly?: boolean } = {}): MatchFeed {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const keyOnly = options.keyOnly ?? false;

  const commentary = match.commentary;
  if (!commentary || commentary.length === 0) return entriesFromEvents(match, limit, keyOnly);

  const entries: FeedEntry[] = [];
  for (let index = commentary.length - 1; index >= 0 && entries.length < limit; index -= 1) {
    const event = commentary[index]!;
    const tone = toneForPriority(event.priority);
    if (keyOnly && tone === 'normal') continue;
    entries.push(entryFromCommentary(event));
  }

  return {
    entries,
    oldestMinute: entries.length > 0 ? entries[entries.length - 1]!.minute : null,
    narrated: true,
  };
}

/** The line the live screen is showing: the newest incident, or nothing yet. */
export function latestLine(feed: MatchFeed): FeedEntry | null {
  return feed.entries[0] ?? null;
}
