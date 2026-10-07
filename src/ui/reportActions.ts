import { gameActions } from './hooks';

export function openMatchReport(matchId: string) {
  gameActions().setView('fixtures', `report:${matchId}`);
}
