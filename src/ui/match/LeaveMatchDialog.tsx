import { useGameStore } from '@/state/gameStore';
import { currentScore } from '@/simulation/match/matchEngine';
import { periodLabel } from '@/domain/match';
import { Dialog } from '../dialogs/Dialog';
import { Button } from '../components/primitives';

/**
 * The question the back gesture asks during a match.
 *
 * Android has a back gesture and a manager will use it, mid-afternoon, probably
 * meaning "put that panel away" or "I have seen enough of this". There is no
 * way to tell those apart, so the game asks — and what it asks has to be worth
 * reading, which means it has to be true. Two things are true, and they are the
 * whole of the warning:
 *
 *   - **The match is not lost by leaving it.** The session survives being
 *     navigated away from; the match in progress is waiting on the side
 *     navigation and in the More sheet until the application closes. So this is
 *     not a confirmation of destruction and it does not pretend to be.
 *   - **But a match being played is not written to disk.** Only the durable
 *     `game` is saved, and a match in progress lives beside it as a session —
 *     see the note on `MatchSession`. If the application closes now, what is on
 *     disk is the fixture before kick-off: the afternoon has to be played again
 *     from the start. Saying "your match is saved" here would be a lie the
 *     manager only finds out about later, at the worst possible moment.
 *
 * The dressing room is a different sentence rather than a different mechanism:
 * nothing has been played, so nothing can be lost, and the only thing worth
 * saying is that the fixture is still there.
 */
export function LeaveMatchDialog() {
  const open = useGameStore((state) => state.leaveMatchPrompt);
  const session = useGameStore((state) => state.session);
  if (!open || !session) return null;

  const game = useGameStore.getState().game;
  const live = session.live;
  const home = game?.clubs[live.homeClubId];
  const away = game?.clubs[live.awayClubId];
  const score = currentScore(live);
  const underway = session.phase !== 'pre-match';

  const leave = (): void => {
    useGameStore.getState().dismissLeaveMatch();
    useGameStore.getState().setView('dashboard');
  };

  return (
    <Dialog
      title={underway ? 'Leave the match?' : 'Leave the dressing room?'}
      kind="confirm"
      narrow
      subtitle={
        underway && home && away
          ? `${home.identity.shortName} ${score.home}–${score.away} ${away.identity.shortName} · ${periodLabel(live)}`
          : undefined
      }
      onClose={() => useGameStore.getState().dismissLeaveMatch()}
      footer={
        <>
          <Button variant="ghost" onClick={() => useGameStore.getState().dismissLeaveMatch()}>
            {underway ? 'Stay in the match' : 'Stay in the dressing room'}
          </Button>
          <Button variant="danger" onClick={leave}>
            Leave
          </Button>
        </>
      }
    >
      {underway ? (
        <>
          <p>
            The football stops where it is, and you can come back to it from the side navigation —
            or from <strong>More</strong> on a phone — for as long as the game stays open.
          </p>
          <p className="muted small">
            A match being played is held in memory rather than saved, so if the application closes
            before the final whistle, this afternoon is lost and the fixture is played again from
            the start.
          </p>
        </>
      ) : (
        <>
          <p>
            Nothing has been played yet. The fixture is still on the calendar, and your team talk,
            your warm-up and the side you picked are kept until the application closes.
          </p>
        </>
      )}
    </Dialog>
  );
}
