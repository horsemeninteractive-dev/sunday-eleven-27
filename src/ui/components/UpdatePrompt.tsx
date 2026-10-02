import { useUpdate } from '@/pwa';
import { Button } from './primitives';

/**
 * A new build has arrived, and is being held.
 *
 * The service worker installs a new version and then deliberately sits on it
 * rather than swapping itself in (see the note in sw.js). That leaves the game
 * to say so, which is what this is — because the alternative is a deploy that
 * takes effect on its own schedule, halfway through a match, with nothing on
 * screen to explain it.
 *
 * It is mounted above every screen rather than on the menu, because a deploy
 * does not care what the manager is doing. Arriving mid-match is precisely when
 * it matters most, and it is the only moment the manager can actually act on
 * it: the reload is on a click rather than on a timer.
 *
 * Applying it flushes the career on the way out. `location.reload()` raises
 * pagehide, which the game already listens for to write a pending save, so
 * whatever was in the debounce window is written before the old bundle goes.
 */
export function UpdatePrompt() {
  const { ready, running, applyUpdate, dismiss } = useUpdate();
  if (!ready) return null;

  return (
    <aside className="updatebar" role="status" aria-label="A new version is available">
      <div className="updatebar__body">
        <span className="updatebar__label">A new version is ready</span>
        <span className="updatebar__detail">
          {running ? `v${running} is replaced by a newer build.` : 'A newer build has finished installing.'} Your
          career is saved; reloading picks it up.
        </span>
      </div>
      <div className="updatebar__actions">
        <Button variant="primary" size="sm" onClick={applyUpdate}>
          Reload
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Later
        </Button>
      </div>
    </aside>
  );
}