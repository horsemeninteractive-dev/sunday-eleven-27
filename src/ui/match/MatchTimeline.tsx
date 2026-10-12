import type { Match, MatchEventType } from '@/domain/match';
import type { MatchReplay } from '@/presentation/matchReplay';
import { buildMatchFeed, minuteLabel, type FeedEntry } from '../matchFeed';

/**
 * The afternoon, on one rail.
 *
 * A watched match is a stream: ninety minutes pass, and the manager who looked
 * away for the goal has no way of knowing where in the afternoon it was, or how
 * much of the game is left before the next thing happens. The commentary says
 * what happened and the stats say how much, but neither says *where*.
 *
 * The rail is drawn from the commentary feed rather than from the events, so it
 * marks exactly what the transcript marks — one account of the afternoon, in the
 * one place the UI already asks "what was said" (`ui/matchFeed.ts`). Nothing
 * here decides anything about the football.
 */

export type TimelineKind = 'goal' | 'miss' | 'card' | 'injury' | 'substitution' | 'whistle';

export interface TimelineMark {
  id: string;
  /** 0..1 along the match, which is what the rail draws. */
  fraction: number;
  /** The minute as a manager says it: "45+2". */
  minute: string;
  /** The engine's own minute, for jumping to the moment. */
  rawMinute: number;
  kind: TimelineKind;
  /** Which side it belongs to, so a goal can be marked in that side's colour. */
  side: 'home' | 'away' | null;
  /** The whole incident, as the label and the accessible name. */
  label: string;
  text: string;
  /** The score as it stood after it, when it moved. */
  scoreAfter: FeedEntry['scoreAfter'];
}

/** How long the match is: ninety minutes, or two hours of a knockout tie. */
export function matchLengthMinutes(match: Match): number {
  return match.knockout ? 120 : 90;
}

/**
 * Which mark an incident gets, from the label the feed gave it.
 *
 * Matched loosely on purpose: the label is presentation (`matchFeed.ts` owns it,
 * and the engine's narrated lines set their own), so the rail reads the words
 * rather than coupling itself to one spelling of them.
 */
function kindOf(entry: FeedEntry): TimelineKind | null {
  const label = (entry.kind ?? '').toLowerCase();
  if (label === '') return null;
  if (label.includes('missed')) return 'miss';
  if (label === 'penalties') return 'whistle';
  if (label.includes('goal') || label.includes('penalt')) return 'goal';
  if (label.includes('card')) return 'card';
  if (label.includes('injur')) return 'injury';
  if (label.includes('substitut')) return 'substitution';
  if (label.includes('time') || label.includes('kick-off')) return 'whistle';
  return null;
}

/**
 * Everything worth putting on the rail, oldest first.
 *
 * Only the incidents with something on them are marked: a corner and a misplaced
 * pass are the weave of the match, and a rail with two hundred marks on it says
 * nothing about the shape of the afternoon.
 */
export function timelineMarks(match: Match): TimelineMark[] {
  const length = matchLengthMinutes(match);
  const feed = buildMatchFeed(match, { keyOnly: true });
  return feed.entries
    .map((entry) => {
      const kind = kindOf(entry);
      if (!kind) return null;
      const label = entry.kind ? `${entry.kind} — ${entry.minute}'` : `${entry.minute}'`;
      return {
        id: entry.id,
        fraction: Math.max(0, Math.min(1, entry.rawMinute / length)),
        minute: entry.minute,
        rawMinute: entry.rawMinute,
        kind,
        side: entry.side,
        label,
        text: entry.text,
        scoreAfter: entry.scoreAfter,
      } satisfies TimelineMark;
    })
    .filter((mark): mark is TimelineMark => mark !== null)
    .reverse();
}

/**
 * The same rail for an afternoon already played.
 *
 * A replay is read from its cues rather than from the commentary, because the
 * cue is what the transport moves to: `cue.at` is a position on the replay's own
 * clock, so a marker is exactly where a press has to take the playhead, and the
 * marks cannot drift from the scrub bar beside them. `cue.index` is its place in
 * the record, so the incident is the engine's own event and its side and its
 * score come from there rather than from a second reading of the words.
 */
export function replayTimelineMarks(replay: MatchReplay, match: Match): TimelineMark[] {
  const marks: TimelineMark[] = [];
  for (const cue of replay.cues) {
    const event = match.events[cue.index];
    if (!event) continue;
    const shape = EVENT_KIND[event.type];
    if (!shape) continue;
    const minute = minuteLabel(cue.minute, cue.firstHalf);
    marks.push({
      id: event.id,
      fraction: replay.duration > 0 ? Math.max(0, Math.min(1, cue.at / replay.duration)) : 0,
      minute,
      rawMinute: cue.minute,
      kind: shape.kind,
      side: event.clubId === match.homeClubId ? 'home' : event.clubId === match.awayClubId ? 'away' : null,
      label: `${shape.label} — ${minute}'`,
      text: event.text,
      scoreAfter: event.scoreAfter ?? null,
    });
  }
  return marks;
}

/** Which mark an engine event gets, and what the rail calls it. */
const EVENT_KIND: Partial<Record<MatchEventType, { kind: TimelineKind; label: string }>> = {
  goal: { kind: 'goal', label: 'Goal' },
  'own-goal': { kind: 'goal', label: 'Own goal' },
  'penalty-scored': { kind: 'goal', label: 'Penalty scored' },
  'penalty-missed': { kind: 'miss', label: 'Penalty missed' },
  'yellow-card': { kind: 'card', label: 'Yellow card' },
  'red-card': { kind: 'card', label: 'Red card' },
  injury: { kind: 'injury', label: 'Injury' },
  substitution: { kind: 'substitution', label: 'Substitution' },
  'kick-off': { kind: 'whistle', label: 'Kick-off' },
  'half-time': { kind: 'whistle', label: 'Half time' },
  'full-time': { kind: 'whistle', label: 'Full time' },
  'extra-time': { kind: 'whistle', label: 'Extra time' },
  penalties: { kind: 'whistle', label: 'Penalties' },
};

/**
 * The rail itself.
 *
 * Markers are buttons, so the same rail works for a mouse, a keyboard and a
 * thumb, and each one names its incident ("Goal — 23'") rather than showing a
 * dot nobody can read with a screen reader. `onJump` is what a caller can do
 * about a mark: a replay seeks to it, a live match stops the clock and opens the
 * words. Without one the rail is still worth having — it is the shape of the
 * afternoon — and the markers stop being buttons.
 */
export function MatchTimeline({
  marks,
  minute,
  length,
  progress,
  homeColour,
  awayColour,
  onJump,
  label = 'Match timeline',
}: {
  marks: TimelineMark[];
  /** The minute the match is at now, for the playhead. */
  minute: number;
  length: number;
  /**
   * Where the playhead goes, 0..1, when the match time is not the scale the rail
   * is drawn on. A replay's marks are placed by replay seconds rather than by
   * minute, so its playhead has to be measured the same way or the two would
   * disagree about where the afternoon is.
   */
  progress?: number;
  homeColour?: string;
  awayColour?: string;
  onJump?: (mark: TimelineMark) => void;
  label?: string;
}) {
  const played = Math.max(0, Math.min(1, progress ?? minute / length));
  return (
    <div className="mtl" role="group" aria-label={label}>
      <div className="mtl__rail">
        {/* The interval is a fact about the match, not a mark on it: every game
            has one, and it is where the rail's own scale changes meaning. */}
        <span className="mtl__halfway" aria-hidden="true" />
        <span
          className="mtl__played"
          aria-hidden="true"
          style={{ width: `${played * 100}%` }}
        />
        <span
          className="mtl__now"
          aria-hidden="true"
          style={{ left: `${played * 100}%` }}
          title={`${minute}'`}
        />
        {marks.map((mark) =>
          onJump ? (
            <button
              key={mark.id}
              type="button"
              className={`mtl__mark mtl__mark--${mark.kind}${mark.side ? ` mtl__mark--${mark.side}` : ''}`}
              style={{
                left: `${mark.fraction * 100}%`,
                ...(mark.kind === 'goal' && mark.side
                  ? { background: mark.side === 'home' ? homeColour ?? undefined : awayColour ?? undefined }
                  : {}),
              }}
              onClick={() => onJump(mark)}
              title={`${mark.label} — ${mark.text}`}
              aria-label={`${mark.label}. ${mark.text}`}
            />
          ) : (
            <span
              key={mark.id}
              className={`mtl__mark mtl__mark--${mark.kind}${mark.side ? ` mtl__mark--${mark.side}` : ''}`}
              style={{
                left: `${mark.fraction * 100}%`,
                ...(mark.kind === 'goal' && mark.side
                  ? { background: mark.side === 'home' ? homeColour ?? undefined : awayColour ?? undefined }
                  : {}),
              }}
              title={`${mark.label} — ${mark.text}`}
            />
          ),
        )}
      </div>
      <span className="mtl__scale small muted" aria-hidden="true">
        <span>0&#39;</span>
        <span>{length}&#39;</span>
      </span>
    </div>
  );
}
