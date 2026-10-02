import { Suspense } from 'react';
import type { ViewId } from '@/state/gameStore';
import { useGameStore } from '@/state/gameStore';
import { useGame } from './hooks';
import { clubStyle } from './colour';
import { AppShell } from './layout/AppShell';
import { AppDialogs } from './dialogs/AppDialogs';
import { UpdatePrompt } from './components/UpdatePrompt';
// The one eager screen: it is the first thing painted, so it stays in the entry
// chunk rather than waiting behind a fallback that would blank the page.
import { StartView } from './views/StartView';
import {
  ClubSelectView,
  CreateClubView,
  CupView,
  DashboardView,
  FixturesView,
  FinancesView,
  HistoryView,
  KitView,
  LeagueView,
  ManagerView,
  MatchView,
  NewsView,
  ProfileView,
  RecruitmentView,
  SquadView,
  TacticsView,
  TeamSelectionView,
  TrainingView,
  WorldView,
} from './lazyViews';

/**
 * The application is four things: a menu screen, a club-choice screen, the game
 * itself inside the shell — and the match, which is a screen of its own.
 *
 * Matchday is a takeover rather than a page: the navigation, the command bar
 * and the calendar all get out of the way, because for ninety minutes there is
 * only the game in front of you. The 3D presentation will slot into this same
 * full-screen frame without touching the shell.
 *
 * The screens themselves arrive on demand (see lazyViews), so there is a moment
 * between the click and the screen. It is brief — the service worker has the
 * chunk already — but it is real, and the fallback below is deliberately
 * nothing at all rather than a spinner: a blank frame for a few milliseconds
 * reads as the screen settling, where a spinner reads as something being
 * fetched and invites the manager to wait for it.
 */
export function App() {
  const game = useGame();
  const draft = useGameStore((state) => state.draft);
  const view = useGameStore((state) => state.view);
  const session = useGameStore((state) => state.session);

  // The game's own dialogs — settings, the changelog, the credits, the managers
  // already saved — sit above whichever screen is showing, because the header of
  // a running career and the main menu both have to be able to reach them.
  const screen = () => {
    if (!game) {
      // Before a career exists every screen is part of setting one up, and which
      // one is showing is simply where the manager got to in that flow.
      if (view === 'profile') return <ProfileView />;
      if (view === 'create-club' && draft) return <CreateClubView />;
      if (draft && view === 'select-club') return <ClubSelectView />;
      return <StartView />;
    }

    if (view === 'match' && session) {
      // The club's colours come with it: the match is still your club's match.
      return (
        <div className="takeover" style={clubStyle(game.clubs[game.userClubId]!.identity.colours)}>
          <MatchView />
        </div>
      );
    }

    return (
      <AppShell game={game} view={view}>
        <ViewRouter view={view} />
      </AppShell>
    );
  };

  return (
    <>
      <Suspense fallback={null}>
        {screen()}
        <AppDialogs />
      </Suspense>
      {/* Above the Suspense boundary on purpose: a deploy can land while a
          screen is still being fetched, and the bar saying so should not be one
          of the things still waiting. */}
      <UpdatePrompt />
    </>
  );
}

function ViewRouter({ view }: { view: ViewId }) {
  switch (view) {
    case 'manager':
      return <ManagerView />;
    case 'squad':
      return <SquadView />;
    case 'team':
      return <TeamSelectionView />;
    case 'tactics':
      return <TacticsView />;
    case 'fixtures':
      return <FixturesView />;
    case 'league':
      return <LeagueView />;
    case 'cup':
      return <CupView />;
    case 'finances':
      return <FinancesView />;
    case 'kit':
      return <KitView />;
    case 'history':
      return <HistoryView />;
    case 'world':
      return <WorldView />;
    case 'news':
      return <NewsView />;
    case 'recruitment':
      return <RecruitmentView />;
    case 'training':
      return <TrainingView />;
    case 'dashboard':
    default:
      return <DashboardView />;
  }
}
