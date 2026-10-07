import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { gameActions } from '../hooks';
import { Dialog } from '../dialogs/Dialog';
import { Button } from './primitives';
import { MatchDetailPanel } from './FixtureInfo';

export function MatchReportModal({ state, match, onClose }: { state: GameState; match: Match; onClose: () => void }) {
  return <Dialog title="Match report" onClose={onClose} className="match-report"
    footer={<><Button variant="ghost" onClick={onClose}>Back</Button>{match.events.length > 0 &&
      <Button onClick={() => { onClose(); gameActions().openReplay(match.id); }}>Watch replay</Button>}</>}>
    <MatchDetailPanel state={state} match={match} />
  </Dialog>;
}
