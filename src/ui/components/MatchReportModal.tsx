import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { gameActions } from '../hooks';
import { Dialog } from '../dialogs/Dialog';
import { Button } from './primitives';
import { MatchDetailPanel } from './FixtureInfo';
import { MatchScoreline } from '../match/MatchScoreline';

/**
 * The afternoon written down.
 *
 * A report is a document — `kind="report"` is what gives it a ruled head and a
 * headline's type — and a document about a match has one headline: the result,
 * in the match's own marks. It is the same scoreline the header held all
 * afternoon and the same one half time and full time put in front of him, so the
 * report opens on the match rather than on the words "Match report". A fixture
 * nobody has played yet has no result to headline, so its report goes straight to
 * the panel underneath, which is where the explanation lives.
 */
export function MatchReportModal({ state, match, onClose }: { state: GameState; match: Match; onClose: () => void }) {
  return (
    <Dialog
      title="Match report"
      kind="report"
      onClose={onClose}
      className="match-report"
      subtitle={match.played ? <MatchScoreline game={state} match={match} /> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          {match.events.length > 0 && (
            <Button onClick={() => { onClose(); gameActions().openReplay(match.id); }}>Watch replay</Button>
          )}
        </>
      }
    >
      <MatchDetailPanel state={state} match={match} />
    </Dialog>
  );
}
