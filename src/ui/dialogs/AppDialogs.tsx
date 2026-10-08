import { useGameStore } from '@/state/gameStore';
import { clubStyle } from '../colour';
import { useGame } from '../hooks';
import {
  ChangelogDialog,
  CreditsDialog,
  PreferencesDialog,
  ProfilesDialog,
} from '../lazyViews';

/**
 * The dialogs that belong to the game rather than to a screen.
 *
 * Mounted once, above everything, because the same menu has to reach them from
 * the main menu before a career exists and from the header of a season in
 * progress. Which one is open is a single name in the store, so no screen needs
 * to know that any of them exist.
 *
 * They are mounted outside the shell, though, and the club's colours are put on
 * the shell — so a dialog opened from inside a career was drawing the *default*
 * club colour, a green that belongs to no club in the save, on the rule along
 * the top of the panel. It was measurable: ‘The game’ and its own ‘Preferences’
 * wore two different colours, one apiece, in the same menu. So the colours are
 * restated here when there is a career to take them from. There is nothing to
 * take them from on the main menu, where the game's own green is correct — there
 * is no club yet — which is why this is a wrapper rather than a second copy of
 * the shell.
 */
export function AppDialogs() {
  const dialog = useGameStore((state) => state.dialog);
  const game = useGame();

  if (!dialog) return null;
  const open =
    dialog === 'preferences' ? <PreferencesDialog /> :
    dialog === 'changelog' ? <ChangelogDialog /> :
    dialog === 'credits' ? <CreditsDialog /> :
    <ProfilesDialog />;
  if (!game) return open;
  return (
    <div style={clubStyle(game.clubs[game.userClubId]!.identity.colours)}>{open}</div>
  );
}
