import { useGameStore } from '@/state/gameStore';

/**
 * The rest of the league, being played out.
 *
 * Moving the clock past a matchday runs the match engine once for every other
 * club in the division — the same engine the manager watches, headless — and
 * each of those takes long enough that a screen with nothing on it reads as a
 * freeze. This is what stands in for the wait: how far through the day it is,
 * which match is being worked out at that moment, and what each game came out
 * of as it lands.
 *
 * It has no close button on purpose. The work is the manager's own; the only
 * way past it is for the football to finish, and it closes itself when it does.
 */
export function ProcessingModal() {
  const processing = useGameStore((state) => state.processing);
  if (!processing) return null;

  const { done, total, current, results } = processing;
  // The dialog only opens once a fixture is reached, and the loop knows how many
  // the day owes before it plays the first, so the fraction is always honest.
  const pct = Math.round((done / Math.max(1, total)) * 100);

  return (
    <div className="overlay overlay--processing" role="dialog" aria-modal="true" aria-label="Working">
      <div className="overlay__scrim" aria-hidden="true" />
      <div className="overlay__panel overlay__panel--narrow processing">
        <div className="overlay__bar">
          <span className="overlay__title">{processing.headline}</span>
        </div>
        <div className="overlay__body processing__body">
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label="Matches being played out"
          >
            <span className="progress__fill" style={{ width: `${pct}%` }} />
          </div>

          <div className="processing__count">
            <span className="muted small">
              {done} of {total} {total === 1 ? 'match' : 'matches'}
            </span>
          </div>

          <p className="processing__current" aria-live="polite">
            {current ? (
              <>
                <span className="processing__label">Now playing</span>
                <span className="processing__fixture">{current}</span>
              </>
            ) : (
              <span className="processing__fixture processing__fixture--quiet">
                {results.length > 0 ? 'Putting the results in' : 'Getting ready'}
              </span>
            )}
          </p>

          {results.length > 0 && (
            <ul className="processing__results" aria-label="Results so far">
              {results.map((line, index) => (
                <li key={`${line}-${index}`} className="processing__result">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}