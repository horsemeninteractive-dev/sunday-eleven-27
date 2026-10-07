import { Suspense, useCallback, useState } from 'react';
import type { ViewId } from '@/state/gameStore';
import { useGameStore } from '@/state/gameStore';
import { hasSeenFirstBoot, markFirstBootSeen, shouldShowFirstBoot } from '@/state/firstBoot';
import { useGame } from './hooks';
import { clubStyle } from './colour';
import { AppShell } from './layout/AppShell';
import { AppDialogs } from './dialogs/AppDialogs';
import { UpdatePrompt } from './components/UpdatePrompt';
import { ProcessingModal } from './components/ProcessingModal';
import { GlobalFeedback } from './components/GlobalFeedback';
import { useCareerLoading } from './careerActions';
// The two eager screens: the first boot and the menu behind it. Both are painted
// before anything else can be, so both stay in the entry chunk rather than waiting
// behind a fallback that would blank the page.
import { StartView } from './views/StartView';
import { FirstBootView } from './views/FirstBootView';
import {
  ClubSelectView,
  ClubView,
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
  InboxView,
  ProfileView,
  RecruitmentView,
  ReplayView,
  SquadView,
  StaffView,
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
 * an honest screen-opening status, distinct from storage boot and career loading.
 */
export function App() {
  const careerLoading = useCareerLoading();
  const ready = useGameStore((state) => state.ready);
  const game = useGame();
  const draft = useGameStore((state) => state.draft);
  const view = useGameStore((state) => state.view);
  const session = useGameStore((state) => state.session);
  const replay = useGameStore((state) => state.replay);

  // Whether Touchline has introduced itself yet, and whether there is anything here
  // it could have introduced itself over. The flag is read from the browser rather
  // than from a career, and read once, because `useState` is handed the function
  // itself rather than its answer; the save list was read by the store as it opened.
  const [introSeen, setIntroSeen] = useState(hasSeenFirstBoot);
  const hasSaves = useGameStore((state) => state.hasSaves);

  // The sequence hands over exactly once: it runs out, the manager skips it, or
  // Escape dismisses it, and all three mean the same thing. Stable, because the
  // view's own timer is keyed to this function.
  const finishIntro = useCallback(() => {
    markFirstBootSeen();
    setIntroSeen(true);
  }, []);

  // The game's own dialogs — settings, the changelog, the credits, the managers
  // already saved — sit above whichever screen is showing, because the header of
  // a running career and the main menu both have to be able to reach them.
  const screen = () => {
    // Nothing can be decided until the store knows whether there is a career to
    // reopen. `main.tsx` waits for that before rendering at all, so this is the
    // belt to that braces: if anything ever mounts the game early, it waits
    // here rather than showing a menu that is about to contradict itself.
    if (careerLoading) return <div className="start booting booting--inline" role="status"><div className="booting__body"><span className="booting__label">Sunday Eleven 27</span><span className="booting__note">Opening your career…</span></div></div>;
    if (!ready) {
      return (
        <div className="start booting booting--inline">
          <div className="booting__body">
            <span className="booting__label">Sunday Eleven 27</span>
            <span className="booting__note">Opening Sunday Eleven…</span>
          </div>
        </div>
      );
    }
    if (!game) {
      // Nothing to open, nothing saved to open it with, and no introduction made
      // yet: Touchline goes first, and goes first exactly once. What makes it the
      // first is the save list as much as the flag — a manager with a season on
      // disk has already met the game — and the whole of that reasoning lives in
      // `shouldShowFirstBoot`, where it can be read and tested on its own.
      if (shouldShowFirstBoot({ seen: introSeen, hasSaves, atMenu: view === 'start' })) {
        return <FirstBootView onDone={finishIntro} />;
      }
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

    if (view === 'replay' && replay) {
      // Watching an afternoon back is a takeover too: nothing about the career
      // should be reachable while the replay has the screen.
      return (
        <div className="takeover" style={clubStyle(game.clubs[game.userClubId]!.identity.colours)}>
          <ReplayView />
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
      <Suspense fallback={<div className="loading-screen" role="status">Opening the next screen…</div>}>
        {screen()}
        <AppDialogs />
      </Suspense>
      {/* Above the Suspense boundary on purpose: a deploy can land while a
          screen is still being fetched, and the bar saying so should not be one
          of the things still waiting. */}
      <UpdatePrompt />
      <GlobalFeedback />
      {/* Also above everything, and not dismissible: while the league is being
          played out there is nothing on the screen he could usefully be doing,
          and a dialog he can close would let him press Continue twice. */}
      <ProcessingModal />
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
    case 'inbox':
      return <InboxView />;
    case 'club':
      return <ClubView />;
    case 'staff':
      return <StaffView />;
    case 'recruitment':
      return <RecruitmentView />;
    case 'training':
      return <TrainingView />;
    case 'dashboard':
    default:
      return <DashboardView />;
  }
}
