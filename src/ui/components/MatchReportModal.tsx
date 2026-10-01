import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { MatchDetailPanel } from './FixtureInfo';

/**
 * A report on a match that has already been played.
 *
 * Reading the details of a Sunday from three weeks ago is a detour, not a
 * destination: it opens over the top of whatever the manager was looking at so
 * the list he was reading is exactly where he left it when he closes it. The
 * panel inside is the same one the live match screen uses, so a report reads
 * the same wherever it is opened from.
 */
export function MatchReportModal({
  state,
  match,
  onClose,
}: {
  state: GameState;
  match: Match;
  onClose: () => void;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Match report">
      <div className="overlay__panel">
        <div className="overlay__bar">
          <span className="overlay__title">Match report</span>
          <button type="button" className="overlay__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="overlay__body">
          <MatchDetailPanel state={state} match={match} />
        </div>
      </div>
    </div>
  );
}
