import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * The screens, fetched when they are first shown.
 *
 * The game is twenty screens in a menu-driven shell, and for a long time all
 * twenty were imported eagerly: one 783 KB bundle in which the main menu
 * carried the recruitment screen, the finances and the match commentary with it.
 * A manager who opened the game to look at his inbox was paying to download the
 * whole of a game he had not started playing.
 *
 * Splitting them costs nothing to play, because the service worker precaches
 * every chunk the build produces (see the precacheManifest plugin in
 * vite.config.ts). The split decides *when* a screen's code is wanted, not
 * whether it is there: by the time a manager clicks, the chunk is in the cache,
 * so the screen appears as fast as it used to and the game still opens with no
 * signal at all.
 *
 * The alternative — leaving them eager — would be simpler, and would mean
 * nobody ever opens the game on a train and finds a screen missing.
 *
 * The main menu is deliberately absent from this list. It is the first thing
 * painted, so it cannot be allowed to wait for a chunk: a blank first frame on
 * every cold start would be a worse trade than the 4 KB it costs to keep it in
 * the entry chunk, and it is imported directly by App instead.
 */

/**
 * Every screen here reads the store and takes no props, so this asks for a
 * component that takes none — which is checked at the call site rather than
 * assumed, and so a screen cannot quietly grow a prop that nobody passes.
 */
const view = (loader: () => Promise<Record<string, unknown>>, name: string): LazyExoticComponent<ComponentType> =>
  lazy(async () => ({ default: (await loader())[name] as ComponentType }));

export const ProfileView = view(() => import('./views/ProfileView'), 'ProfileView');
export const ClubSelectView = view(() => import('./views/ClubSelectView'), 'ClubSelectView');
export const CreateClubView = view(() => import('./views/CreateClubView'), 'CreateClubView');
export const DashboardView = view(() => import('./views/DashboardView'), 'DashboardView');
export const ManagerView = view(() => import('./views/ManagerView'), 'ManagerView');
export const SquadView = view(() => import('./views/SquadView'), 'SquadView');
export const TeamSelectionView = view(() => import('./views/TeamSelectionView'), 'TeamSelectionView');
export const TacticsView = view(() => import('./views/TacticsView'), 'TacticsView');
export const FixturesView = view(() => import('./views/FixturesView'), 'FixturesView');
export const LeagueView = view(() => import('./views/LeagueView'), 'LeagueView');
export const CupView = view(() => import('./views/CupView'), 'CupView');
export const FinancesView = view(() => import('./views/FinancesView'), 'FinancesView');
export const KitView = view(() => import('./views/KitView'), 'KitView');
export const HistoryView = view(() => import('./views/HistoryView'), 'HistoryView');
export const WorldView = view(() => import('./views/WorldView'), 'WorldView');
export const NewsView = view(() => import('./views/NewsView'), 'NewsView');
export const RecruitmentView = view(() => import('./views/RecruitmentView'), 'RecruitmentView');
export const TrainingView = view(() => import('./views/TrainingView'), 'TrainingView');
export const MatchView = view(() => import('./views/MatchView'), 'MatchView');
export const ReplayView = view(() => import('./views/ReplayView'), 'ReplayView');

/**
 * The dialogs too, and the changelog earns its place on this list twice over: it
 * is a screen most players never open, and it carries the whole CHANGELOG.md
 * into the bundle as a string — 25 KB of history inlined so that a menu item can
 * render it.
 */
export const ChangelogDialog = view(
  () => import('./dialogs/ChangelogDialog'),
  'ChangelogDialog',
);
export const CreditsDialog = view(() => import('./dialogs/CreditsDialog'), 'CreditsDialog');
export const PreferencesDialog = view(
  () => import('./dialogs/PreferencesDialog'),
  'PreferencesDialog',
);
export const ProfilesDialog = view(() => import('./dialogs/ProfilesDialog'), 'ProfilesDialog');