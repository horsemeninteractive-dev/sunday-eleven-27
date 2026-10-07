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
  const session = useGameStore((state) => state.session);
  const plannerOpen = useGameStore((state) => state.plannerOpen);
  const profile = useGameStore((state) => state.profile);
  const negotiationId = useGameStore((state) => state.negotiationId);
  const focus = useGameStore((state) => state.focus);
  const [moreOpen, setMoreOpen] = useState(false);
  // Whether the desktop navigation is open or an icon rail. Held here because
  // it is the frame's own first column that changes width, and because this
  // component is not re-mounted when a screen changes — a nav that owned this
  // itself would have to survive the navigation it just caused.
  const [navOpen, setNavOpen] = useState(false);
  const handleNavOpenChange = useCallback((open: boolean) => setNavOpen(open), []);
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
    if (!focus || focus.startsWith('report:')) return;
    const observer = new MutationObserver(() => arrive());
    const arrive = () => {
      const node = document.getElementById(focus);
      if (!node) return;
      observer.disconnect();
      // A contextual destination can live inside a disclosure.
      let parent = node.parentElement;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      node.scrollIntoView({ block: 'start', behavior: 'auto' });
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
    };
    if (mainRef.current) observer.observe(mainRef.current, { childList: true, subtree: true });
    arrive();
    return () => observer.disconnect();
  }, [view, focus]);

  // Every navigation path, including contextual links, lands at the screen's top.
  useEffect(() => {
    if (focus) return;
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    const main = mainRef.current;
    let arrived = false;
    const observer = new MutationObserver(() => arrive());
    const arrive = () => {
      const heading = main?.querySelector<HTMLElement>('h1');
      if (!heading || arrived) return;
      arrived = true;
      observer.disconnect();
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    };
    arrive();
    if (main && !arrived) observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [view, focus]);

  return (
    <div className="app" style={clubStyle(game.clubs[game.userClubId]!.identity.colours)}>
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
      {command && <DesktopTopBar game={game} command={command} />}
      {command && <MobileTopBar game={game} command={command} />}

      <div className={`app__body${navOpen ? ' app__body--nav-open' : ''}`}>
        <SideNav
          view={view}
          hasSession={Boolean(session)}
          onNavigate={navigate}
          onOpenChange={handleNavOpenChange}
        />

        <main className="app__main" id="main" ref={mainRef} data-view={view} tabIndex={-1}>
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
