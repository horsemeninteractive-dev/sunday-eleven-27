import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/state/gameStore';
import { fundraisingRuns, scheduledFundraisers } from '@/simulation/fundraising';

/**
 * Fundraising, from the screen's side.
 *
 * The simulation tests prove the money is real; this proves the *door* is: the
 * manager presses a button on the finances screen, the store books the night
 * into the calendar without taking a penny, and the club cannot be talked into
 * two nights at once.
 */

const source = (file: string) => readFileSync(file, 'utf8');

function aCareer(seed: string) {
  const store = useGameStore.getState();
  store.createDraft(seed);
  store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
  return useGameStore.getState().game!;
}

beforeEach(() => {
  useGameStore.getState().quitToMenu();
});

describe('booking a night from the finances screen', () => {
  it('puts it on the calendar, takes nothing yet, and says what it booked', () => {
    const game = aCareer('ui-fundraising-book');
    const clubId = game.userClubId;
    const balance = game.clubs[clubId]!.finances.balance;
    const lines = game.clubs[clubId]!.finances.ledger.length;

    useGameStore.getState().organiseFundraiser('quiz-night');

    const after = useGameStore.getState().game!;
    expect(scheduledFundraisers(after, clubId)).toHaveLength(1);
    expect(fundraisingRuns(after, clubId)).toHaveLength(0);
    // The money is not taken until the night has actually happened.
    expect(after.clubs[clubId]!.finances.balance).toBe(balance);
    expect(after.clubs[clubId]!.finances.ledger.length).toBe(lines);
    expect(useGameStore.getState().notice).toMatch(/Quiz night/);
    expect(useGameStore.getState().error).toBeNull();
  });

  it('will not book a second over the top of the first, and says why', () => {
    aCareer('ui-fundraising-second');
    useGameStore.getState().organiseFundraiser('raffle');
    useGameStore.getState().organiseFundraiser('quiz-night');

    const after = useGameStore.getState().game!;
    expect(scheduledFundraisers(after, after.userClubId)).toHaveLength(1);
    expect(useGameStore.getState().notice).toMatch(/already/i);
  });
});

describe('the fundraising screen', () => {
  it('prices each night and offers a way to book it', () => {
    const view = source('src/ui/views/FinancesView.tsx');
    expect(view).toContain('id="fundraising"');
    expect(view).toContain('fundraisingSummary(game, club.id)');
    expect(view).toContain('gameActions().organiseFundraiser(option.kind)');
    // The forecast the button quotes is the forecast the night settles against.
    expect(view).toContain('option.forecast.net');
  });

  it('is wired from the store to the simulation, not to a second copy of the model', () => {
    const store = source('src/state/gameStore.ts');
    expect(store).toContain('organiseFundraiserSimulation(state, clubId, kind)');
    expect(store).toContain("from '@/simulation/fundraising'");
    // A man between jobs has no club of his to raise money for.
    expect(store).toContain('managingClubId(state)');
  });

  it('takes the club matter to the section that actually exists', () => {
    const matters = source('src/ui/clubMatters.ts');
    expect(matters).toContain("anchor: 'fundraising'");
    const view = source('src/ui/views/FinancesView.tsx');
    expect(view).toContain('id="fundraising"');
  });
});
