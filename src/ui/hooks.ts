import { useMemo } from 'react';
import type { StandingRow } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { Player } from '@/domain/person';
import { currentMatchday, squadOf, standings as computeTable, userClub } from '@/simulation/queries';
import { eventsOn, nextFixtureFor, upcomingEvents } from '@/simulation/schedule';
import type { ScheduledEvent } from '@/domain/events';
import { useGameStore } from '@/state/gameStore';

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
