import type { ViewId } from '@/state/gameStore';
import { useGameStore } from '@/state/gameStore';
import { useGame } from './hooks';
import { clubStyle } from './colour';
import { AppShell } from './layout/AppShell';
import { StartView } from './views/StartView';
import { ProfileView } from './views/ProfileView';
import { ClubSelectView } from './views/ClubSelectView';
import { CreateClubView } from './views/CreateClubView';
import { DashboardView } from './views/DashboardView';
import { ManagerView } from './views/ManagerView';
import { SquadView } from './views/SquadView';
import { TeamSelectionView } from './views/TeamSelectionView';
import { TacticsView } from './views/TacticsView';
import { FixturesView } from './views/FixturesView';
import { LeagueView } from './views/LeagueView';
import { CupView } from './views/CupView';
import { FinancesView } from './views/FinancesView';
import { KitView } from './views/KitView';
import { HistoryView } from './views/HistoryView';
import { WorldView } from './views/WorldView';
import { NewsView } from './views/NewsView';
import { RecruitmentView } from './views/RecruitmentView';
import { TrainingView } from './views/TrainingView';
import { MatchView } from './views/MatchView';
import { AppDialogs } from './dialogs/AppDialogs';

/**
 * The application is four things: a menu screen, a club-choice screen, the game
 * itself inside the shell — and the match, which is a screen of its own.
 *
 * Matchday is a takeover rather than a page: the navigation, the command bar
 * and the calendar all get out of the way, because for ninety minutes there is
 * only the game in front of you. The 3D presentation will slot into this same
 * full-screen frame without touching the shell.
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
      {screen()}
      <AppDialogs />
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
