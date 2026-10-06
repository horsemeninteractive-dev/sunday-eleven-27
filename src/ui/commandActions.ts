import { useMemo } from 'react';
import { useGameStore } from '@/state/gameStore';
import type { MatterDestination } from './clubMatters';
import { commandStateFor, type CommandIntent, type CommandState } from './commandState';
import { gameActions, useGame } from './hooks';

/**
 * The one place a command intent turns into a store call. Every surface that
 * offers the current action — desktop header, mobile strip, dashboard hero —
 * goes through here, so there is no second copy of the decision.
 */
export function runCommand(intent: CommandIntent): void {
  const actions = gameActions();
  if (intent.kind === 'view') {
    actions.setView(intent.view);
    return;
  }
  switch (intent.action) {
    case 'continue':
      actions.closePlanner();
      actions.continueGame();
      break;
    case 'open-planner':
      actions.openPlanner();
      break;
    case 'run-training':
      actions.runTrainingSession();
      break;
    case 'advance-day':
      actions.advanceDays(1);
      break;
    case 'start-match':
      actions.startUserMatch();
      break;
    case 'instant-result':
      actions.instantResult();
      break;
    case 'resume-match':
      actions.setView('match');
      break;
    case 'rollover-season':
      actions.rollOverSeason();
      break;
  }
}

/**
 * Follow a card to the thing it is about.
 *
 * Every actionable card in the club area ends here, so there is one answer to
 * "where does this go": a fact opens the screen that owns it and scrolls to the
 * relevant part, a message opens the thread that is already waiting, and a
 * person opens the conversation with him — which the store already knows how to
 * do correctly for a player, an officer or a volunteer alike.
 *
 * A card with nowhere to go is not drawn, so the undefined case is a guard
 * rather than a path the manager can take.
 */
export function openMatter(destination: MatterDestination | undefined): void {
  if (!destination) return;
  const actions = gameActions();
  switch (destination.kind) {
    case 'view':
      actions.setView(destination.view, destination.anchor ?? null);
      break;
    case 'conversation':
      // Messages is the primary people-facing screen, so the manager lands in
      // the thread he was told about rather than on a list to search.
      actions.setView('inbox');
      actions.openConversation(destination.conversationId);
      break;
    case 'person':
      actions.startConversationWith(destination.personId);
      break;
  }
}

export function useCommandState(): CommandState | null {
  const game = useGame();
  const session = useGameStore((state) => state.session);
  return useMemo(() => (game ? commandStateFor(game, session) : null), [game, session]);
}
