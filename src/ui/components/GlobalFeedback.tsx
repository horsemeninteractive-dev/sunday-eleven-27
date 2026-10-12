import { useGameStore } from '@/state/gameStore';
import { Button } from './primitives';
import { createPortal } from 'react-dom';
import { useModalTarget } from './useModal';

/**
 * The error, and the only place in the game it is drawn.
 *
 * One rule, kept in one file: a failure is announced once, with the same words
 * and the same Dismiss wherever the manager happens to be — a strip of whatever
 * surface has the screen, or the toast in the corner when nothing has it. The
 * dialog shell used to draw the error as well whenever it happened to be on top,
 * which split the rule for where it appeared across two files and left two bad
 * cases: an error raised over a surface that does not draw it (a player's own
 * page, the changing room at half time) was announced nowhere at all, and an
 * error raised over a dialog left a reader with two rules and one banner. It is
 * one banner, one owner, one dismissal.
 */
export function GlobalFeedback() {
  const error = useGameStore((state) => state.error);
  const top = useModalTarget();
  if (!error) return null;
  const feedback = (
    <aside
      className={`banner banner--error global-feedback${top ? ' global-feedback--in-modal' : ''}`}
      role="alert"
    >
      <span>{error}</span>
      <Button variant="ghost" size="sm" ariaLabel="Dismiss error" onClick={() => useGameStore.setState({ error: null })}>Dismiss</Button>
    </aside>
  );
  // Into whatever has the screen — the panel itself, not its scrolling body, so
  // the sentence is on the surface the manager is looking at rather than at the
  // bottom of the content that raised it. The stylesheet turns it into a strip of
  // that surface; with nothing in front it stays the toast in the corner.
  return top ? createPortal(feedback, top) : feedback;
}
