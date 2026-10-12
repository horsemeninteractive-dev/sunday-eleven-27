import { useEffect, useMemo, useRef, useState } from 'react';
import type { Match } from '@/domain/match';
import { buildMatchFeed } from '../matchFeed';

/**
 * The full transcript, for when the manager wants to look back.
 *
 * This is the deliberate, secondary view: everything the match said, in order,
 * with the shape of the afternoon visible at a glance. It is what the Commentary
 * tab and the match report both put on screen, so a game reads the same while it
 * is being played and a month after it was.
 *
 * A filter is offered here — and only here. The live screen never makes the
 * manager choose what to look at; this is the place he has already chosen.
 */
export function CommentaryTranscript({
  match,
  autoScroll = false,
  compact = false,
  focusMinute = null,
}: {
  match: Match;
  /** Keep the newest line in view, for the transcript being written now. */
  autoScroll?: boolean;
  compact?: boolean;
  /**
   * A minute the reader has asked for — from the timeline rail — which is
   * scrolled to rather than read from the top. The list is long and a match has
   * already been played by the time anyone asks, so arriving at the right line
   * is the difference between the rail being a way into the afternoon and being
   * a picture of it.
   */
  focusMinute?: number | null;
}) {
  const [keyOnly, setKeyOnly] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const feed = useMemo(
    () => buildMatchFeed(match, keyOnly ? { keyOnly: true } : {}),
    // The revision the caller re-renders on is not part of the match object, so
    // the count of lines stands in for it here.
    [match, match.commentary?.length, keyOnly],
  );
  // Newest first for reading; oldest first on screen so a match runs downwards.
  const ordered = useMemo(() => [...feed.entries].reverse(), [feed]);

  useEffect(() => {
    if (!autoScroll || focusMinute !== null) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [autoScroll, focusMinute, feed.entries.length]);

  // A minute the rail asked for: the first line of that minute, brought to the
  // middle of the list so the reader sees what led up to it as well.
  //
  // Once, when the minute changes, and not again as the match runs on: the
  // manager asked to look at one moment, and a transcript that dragged itself
  // back to it every time another pass was narrated would be fighting him for
  // the scroll bar.
  useEffect(() => {
    if (focusMinute === null) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-minute="${focusMinute}"]`);
    if (!list || !row) return;
    // The scroll is arithmetic on the list's own box rather than
    // `scrollIntoView`, which walks out of the panel and moves whatever else it
    // finds: this list scrolls, nothing behind it does.
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    list.scrollTop += rowBox.top - listBox.top - (listBox.height - rowBox.height) / 2;
    row.classList.add('transcript__row--found');
    const timer = window.setTimeout(() => row.classList.remove('transcript__row--found'), 2400);
    return () => window.clearTimeout(timer);
  }, [focusMinute]);

  if (feed.entries.length === 0) {
    return <p className="commentary__idle">{match.played ? 'No commentary was recorded for this match.' : 'Nothing yet — the whistle has not gone.'}</p>;
  }

  return (
    <div className={`transcript${compact ? ' transcript--compact' : ''}`}>
      {!compact && (
        <header className="transcript__head">
          <h3>Commentary</h3>
          <button
            type="button"
            className={`chip${keyOnly ? ' chip--on' : ''}`}
            onClick={() => setKeyOnly((value) => !value)}
            aria-pressed={keyOnly}
          >
            Key incidents
          </button>
        </header>
      )}
      <ol className="transcript__list" ref={listRef}>
        {ordered.map((entry) => (
          <li key={entry.id} data-minute={entry.rawMinute} className={`transcript__row transcript__row--${entry.tone}`}>
            <span className="transcript__minute">{entry.minute}&#39;</span>
            <span className="transcript__body">
              {entry.kind && <span className="transcript__kind">{entry.kind}</span>}
              <span className="transcript__text">{entry.text}</span>
            </span>
            {entry.scoreAfter ? (
              <span className="transcript__score">
                {entry.scoreAfter.home}–{entry.scoreAfter.away}
              </span>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
