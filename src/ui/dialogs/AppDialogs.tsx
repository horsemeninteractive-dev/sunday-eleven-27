import { useGameStore } from '@/state/gameStore';
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
 */
export function AppDialogs() {
  const dialog = useGameStore((state) => state.dialog);

  if (dialog === 'preferences') return <PreferencesDialog />;
  if (dialog === 'changelog') return <ChangelogDialog />;
  if (dialog === 'credits') return <CreditsDialog />;
  if (dialog === 'profiles') return <ProfilesDialog />;
  return null;
}
