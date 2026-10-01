import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import { generateDraft, startGameFromDraft, type WorldDraft } from './gameSetup';

export interface TestGame {
  state: GameState;
  draft: WorldDraft;
  clubId: ClubId;
}

/** Build a complete, ready-to-play game state for tests. */
export function createTestGame(seed = 'test-seed', clubIndex = 0, startYear = 2026): TestGame {
  const draft = generateDraft({ seed, startYear, createdAt: `${startYear}-08-20` });
  const clubId = draft.divisionClubIds[clubIndex] ?? draft.divisionClubIds[0]!;
  const state = startGameFromDraft(draft, {
    seed,
    startYear,
    clubId,
    saveName: 'Test save',
    createdAt: `${startYear}-08-20`,
  });
  return { state, draft, clubId };
}
