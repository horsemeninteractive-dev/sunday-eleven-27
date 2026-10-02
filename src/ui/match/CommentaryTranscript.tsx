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
}: {
  match: Match;
  /** Keep the newest line in view, for the transcript being written now. */
  autoScroll?: boolean;
  compact?: boolean;
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
    if (!autoScroll) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [autoScroll, feed.entries.length]);

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
          <li key={entry.id} className={`transcript__row transcript__row--${entry.tone}`}>
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
