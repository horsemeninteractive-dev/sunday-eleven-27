import { useState } from 'react';
import { useInstall } from '@/pwa';
import { Button } from './primitives';

/**
 * The invitation to keep the game.
 *
 * It lives on the main menu rather than behind a dialog because it is the one
 * piece of the game's chrome that asks for something: it wants to be put on a
 * home screen, so it can be opened without a browser and played without a
 * signal. The browser offers that chance exactly once, unprompted, in a strip
 * along the bottom of the window that most people dismiss without reading — so
 * the game catches the offer (see captureInstallPrompt in pwa.ts) and spends it
 * somewhere the manager is actually looking.
 *
 * It is asked for quietly, and it is not asked for twice. A manager who says no
 * is told nothing further for the rest of the session, and a manager who already
 * has the game on a home screen never sees the card at all — there is no version
 * of this that needs to congratulate someone for installing what they just
 * installed.
 *
 * On iOS the browser never offers the prompt at all: there is no event to catch,
 * and the only way in is Share, then Add to Home Screen. So there the card
 * explains that instead of offering a button, because a button that cannot work
 * is worse than no button.
 */
export function InstallCard() {
  const { route, promptInstall } = useInstall();
  const [dismissed, setDismissed] = useState(false);

  if (route === 'none' || dismissed) return null;

  if (route === 'manual') {
    return (
      <section className="installcard installcard--manual" aria-label="Keep the game">
        <div className="installcard__body">
          <span className="installcard__label">Keep the game</span>
          <span className="installcard__detail">
            Tap Share, then Add to Home Screen, and it opens from there — full screen, and playable with no
            signal.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="installcard" aria-label="Keep the game">
      <div className="installcard__body">
        <span className="installcard__label">Keep the game</span>
        <span className="installcard__detail">
          Put it on your home screen and it opens full screen, launches like any other app, and plays with no
          signal.
        </span>
      </div>
      <div className="installcard__actions">
        <Button variant="primary" size="sm" onClick={() => void promptInstall()}>
          Install
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Not now
        </Button>
      </div>
    </section>
  );
}