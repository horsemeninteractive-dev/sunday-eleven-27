import { useEffect, useRef } from 'react';
import { latestLine, type MatchFeed } from '../matchFeed';

/**
 * The live feed.
 *
 * A bounded window on the match rather than a transcript of it, and one
 * incident appears exactly once: the newest is the strip across the top — the
 * line the manager is meant to read without looking for it — and everything
 * before it runs down the list underneath. The panel never grows, because it is
 * given a height by the shell and scrolls inside itself, so it can never push
 * the score, the clock or the manager's own controls off the screen.
 */

export function LiveFeed({
  feed,
  revision,
  keyOnly,
  onToggleKeyOnly,
}: {
  feed: MatchFeed;
  revision: number;
  keyOnly: boolean;
  onToggleKeyOnly: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const latest = latestLine(feed);
  const history = feed.entries.slice(1);

  // A new incident arrives at the top, so the panel goes back to the top with
  // it: the manager should never have to scroll to find out what just happened.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [revision]);

  return (
    <section className="livefeed" aria-label="Live commentary">
      <header className="livefeed__head">
        <h2>Live feed</h2>
        <button
          type="button"
          className={`chip${keyOnly ? ' chip--on' : ''}`}
          onClick={onToggleKeyOnly}
          aria-pressed={keyOnly}
        >
          Key incidents
        </button>
      </header>

      {latest ? (
        <div className={`moment moment--${latest.tone}`} role="status">
          <span className="moment__minute">{latest.minute}&#39;</span>
          <span className="moment__body">
            {latest.kind && <span className="moment__kind">{latest.kind}</span>}
            <span className="moment__text">{latest.text}</span>
          </span>
          {latest.scoreAfter && (
            <span className="moment__score">
              {latest.scoreAfter.home}–{latest.scoreAfter.away}
            </span>
          )}
        </div>
      ) : (
        <p className="moment moment--quiet">Nothing yet — we are not under way.</p>
      )}

      <div className="livefeed__list" ref={listRef}>
        <ol className="feed">
          {history.map((entry) => (
            <li key={entry.id} className={`feed__row feed__row--${entry.tone}`}>
              <span className="feed__minute">{entry.minute}&#39;</span>
              <span className="feed__body">
                {entry.kind && <span className="feed__kind">{entry.kind}</span>}
                <span className="feed__text">{entry.text}</span>
              </span>
              {entry.scoreAfter ? (
                <span className="feed__score">
                  {entry.scoreAfter.home}–{entry.scoreAfter.away}
                </span>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
      </div>

      {feed.oldestMinute !== null && (
        <p className="livefeed__foot small muted">From {feed.oldestMinute}&#39; onwards.</p>
      )}
    </section>
  );
}
