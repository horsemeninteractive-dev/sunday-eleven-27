import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameState } from '@/domain/game';
import { useGameStore, type ViewId } from '@/state/gameStore';
import { clubStyle } from '../colour';
import { gameActions } from '../hooks';
import { useCommandState } from '../commandActions';
import { DesktopTopBar, MobileCommandStrip, MobileTopBar } from './TopBar';
import { AppNotice, useNoticeTimeout } from './AppNotice';
import { Breadcrumbs } from './Breadcrumbs';
import { SideNav } from './SideNav';
import { MobileNav } from './MobileNav';
import { PlannerModal } from '../components/PlannerModal';
import { ProfileOverlay } from '../components/ProfileOverlay';
import { NegotiationModal } from '../components/NegotiationModal';

/**
 * The application shell.
 *
 * One command bar, one desktop navigation, one mobile navigation, one content
 * column, and the overlays that sit above all of it. Every screen is rendered
 * inside it, so the current phase and the next action are never more than a
 * glance away — and mobile is a first-class layout rather than the desktop
 * shell squeezed narrow.
 *
 * The matchday screen is a takeover: it covers the shell entirely, because a
 * match is not a page in a website.
 */
export function AppShell({ game, view, children }: { game: GameState; view: ViewId; children: ReactNode }) {
  const notice = useGameStore((state) => state.notice);
  const error = useGameStore((state) => state.error);
  const session = useGameStore((state) => state.session);
  const plannerOpen = useGameStore((state) => state.plannerOpen);
  const profile = useGameStore((state) => state.profile);
  const negotiationId = useGameStore((state) => state.negotiationId);
  const dialog = useGameStore((state) => state.dialog);
  const focus = useGameStore((state) => state.focus);
  const [moreOpen, setMoreOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const command = useCommandState();

  // A notice says its piece and goes: nothing the manager has to tidy away.
  const dismissNotice = useCallback(() => gameActions().setNotice(null), []);
  useNoticeTimeout(notice, dismissNotice);

  const navigate = useCallback((next: ViewId) => {
    gameActions().setView(next);
    setMoreOpen(false);
    // A new screen should start at the top: nothing is more disorienting than
    // landing halfway down a table you have not seen yet. The page itself does
    // not scroll in this shell — the content column does.
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  /**
   * A card that said "the treasurer is worried about the money" should land on
   * the treasurer's own words, not at the top of a screen to be searched. The
   * anchor is applied once per arrival, after the screen has painted, and the
   * target is given focus as well as being scrolled to, so a keyboard or screen
   * reader user is taken there too rather than left at the top of the page.
   *
   * Nothing happens if the screen has no such anchor, so a view is free to be
   * re-arranged without every caller having to be updated.
   */
  useEffect(() => {
    if (!focus) return;
    const handle = window.setTimeout(() => {
      const node = document.getElementById(focus);
      if (!node) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      node.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [view, focus]);

  // Escape closes whatever is on top, innermost first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dialog) gameActions().closeDialog();
      else if (negotiationId) gameActions().closeNegotiation();
      else if (profile) gameActions().closeProfile();
      else if (plannerOpen) gameActions().closePlanner();
      else if (moreOpen) setMoreOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [moreOpen, plannerOpen, profile, negotiationId, dialog]);

  return (
    <div className="app" style={clubStyle(game.clubs[game.userClubId]!.identity.colours)}>
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
      {command && <DesktopTopBar game={game} command={command} />}
      {command && <MobileTopBar game={game} command={command} />}

      <div className="app__body">
        <SideNav view={view} hasSession={Boolean(session)} onNavigate={navigate} />

        <main className="app__main" id="main" ref={mainRef}>
          {/* Errors stay in the page: something that has gone wrong is not a
              passing remark, and it should not take itself away before it has
              been read. Notices live in the footer instead. */}
          {error && (
            <div className="banner banner--error" role="alert">
              <span>{error}</span>
              <button type="button" className="link" onClick={() => gameActions().setNotice(null)}>
                dismiss
              </button>
            </div>
          )}
          {children}
        </main>
      </div>

      <footer className="app__footer">
        <Breadcrumbs
          view={view}
          clubName={game.clubs[game.userClubId]!.identity.name}
          onNavigate={navigate}
        />
        <AppNotice notice={notice} />
      </footer>

      {/* On a phone the breadcrumb trail rides with the rest of the fixed
          chrome, so the same "where am I, how do I get back" bar is in the same
          place on every screen at every size. */}
      <div className="app__mobilefooter">
        <Breadcrumbs
          view={view}
          clubName={game.clubs[game.userClubId]!.identity.name}
          onNavigate={navigate}
        />
        {command && <MobileCommandStrip command={command} />}
        <AppNotice notice={notice} />
        {command && (
          <MobileNav
            view={view}
            hasSession={Boolean(session)}
            open={moreOpen}
            onOpenChange={setMoreOpen}
            onNavigate={navigate}
          />
        )}
      </div>

      {plannerOpen && <PlannerModal />}
      {profile && <ProfileOverlay target={profile} />}
      {negotiationId && <NegotiationModal personId={negotiationId} />}
    </div>
  );
}
