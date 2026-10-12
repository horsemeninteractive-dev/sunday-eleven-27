import { useEffect, useMemo, useState } from 'react';
import type { StandingRow } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { Player } from '@/domain/person';
import { currentMatchday, squadOf, standings as computeTable, userClub } from '@/simulation/queries';
import { eventsOn, nextFixtureFor, upcomingEvents } from '@/simulation/schedule';
import type { ScheduledEvent } from '@/domain/events';
import { useGameStore } from '@/state/gameStore';
import { resolveTheme } from '@/state/preferences';
import { clubStyle, type ClubColours } from './colour';
import { inboxUnread } from './inboxState';

/**
 * Thin read-only hooks over the store. Components use these instead of
 * reaching into simulation modules directly, which keeps the UI declarative.
 */

export function useGame(): GameState | null {
  return useGameStore((state) => state.game);
}

/** Dispatch actions without subscribing to the whole store (avoids re-renders). */
export function gameActions() {
  return useGameStore.getState();
}

export function useUserClub() {
  const game = useGame();
  return game ? userClub(game) : null;
}

export function useStandings(): StandingRow[] {
  const game = useGame();
  return useMemo(() => (game ? computeTable(game) : []), [game]);
}

export function useSquad(): Player[] {
  const game = useGame();
  const clubId = game?.userClubId;
  return useMemo(() => (game && clubId ? squadOf(game, clubId) : []), [game, clubId]);
}

export function useCurrentMatchday(): number {
  const game = useGame();
  return game ? currentMatchday(game) : 1;
}

/**
 * The next game the club actually has to play.
 *
 * Read from the calendar by date, not from the matchday number: a rearranged
 * fixture is the next game on its new date, and a club with a bye this week
 * still has a next game.
 */
export function useNextFixture(): Match | null {
  const game = useGame();
  return useMemo(
    () => (game ? nextFixtureFor(game, game.userClubId, game.date) : null),
    [game],
  );
}

/** What is on the manager's own calendar today. */
export function useToday(): ScheduledEvent[] {
  const game = useGame();
  return useMemo(() => (game ? eventsOn(game, game.date) : []), [game]);
}

/** Everything the calendar knows about in the next few weeks. */
export function useSchedule(): ScheduledEvent[] {
  const game = useGame();
  return useMemo(() => (game ? upcomingEvents(game, game.date, 8) : []), [game]);
}

export function useSelectedPlayer(): Player | null {
  const game = useGame();
  const selectedId = useGameStore((state) => state.selectedPlayerId);
  if (!game || !selectedId) return null;
  const person = game.people[selectedId];
  return person && person.kind === 'player' ? person : null;
}

/**
 * How many messages are waiting for the manager.
 *
 * Read through `inboxState` rather than from the store directly so the number on
 * a badge and the number on the screen are the same number by construction: the
 * navigation should not be able to disagree with the inbox it sends him to.
 */
export function useUnreadMessages(): number {
  const game = useGame();
  return useMemo(() => (game ? inboxUnread(game) : 0), [game]);
}

/**
 * Which way the page is lit, as a component sees it.
 *
 * The stylesheet reads the decision off the document rather than being told it,
 * so almost nothing in the game has to ask this question — CSS answers for the
 * whole palette from one attribute. The one thing that does need it is a club's
 * colours: `clubStyle` makes the club's *text* ink readable against the surface
 * it will be written on, and that surface is a different colour in each theme.
 *
 * It is worked out here rather than read back off the document so that a
 * component cannot be a frame behind the attribute — the theme and the colours
 * on the same render are the same answer to the same question.
 */
export function useTheme(): 'dark' | 'light' {
  const preference = useGameStore((state) => state.preferences.theme);
  const [systemIsLight, setSystemIsLight] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
      : false,
  );

  // The system's answer is only consulted when the manager has not given one of
  // his own, but it is watched either way: a choice changed from 'system' has to
  // find the current answer, not the one from when the page opened.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => setSystemIsLight(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  return resolveTheme(preference, systemIsLight);
}

/** A club's colours, resolved for the theme the game is currently lit by. */
export function useClubColours(colours: ClubColours): Record<string, string> {
  return clubStyle(colours, useTheme());
}
