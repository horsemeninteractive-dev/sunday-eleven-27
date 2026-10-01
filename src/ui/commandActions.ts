import { useMemo } from 'react';
import { useGameStore } from '@/state/gameStore';
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

export function useCommandState(): CommandState | null {
  const game = useGame();
  const session = useGameStore((state) => state.session);
  return useMemo(() => (game ? commandStateFor(game, session) : null), [game, session]);
}
