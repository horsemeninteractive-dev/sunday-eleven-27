import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/state/gameStore';
import { facilitiesStore, groundWorkInHand, groundWorkOption, upkeepCostFor } from '@/simulation/grounds';
import { ledgerBalances } from '@/simulation/finance';

/**
 * The ground, from the screen's side.
 *
 * The simulation tests prove the money is real and the work arrives once; this
 * proves the *door* is: the manager presses a button on the Clubhouse screen,
 * the store takes exactly what the panel quoted, and the four jobs the screen
 * draws are the four the service prices. A manager between jobs has no ground
 * of his own, and a career that pulls out of a job stops paying for it.
 */

const source = (file: string) => readFileSync(file, 'utf8');

function aCareer(seed: string) {
  const store = useGameStore.getState();
  store.createDraft(seed);
  store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
  const game = useGameStore.getState().game!;
  // A ground the club actually holds, with room for the work, so the panel is
  // offering the whole catalogue rather than a set of refusals.
  const club = game.clubs[game.userClubId]!;
  const ground = game.world.grounds[club.groundId]!;
  ground.tenantClubId = club.id;
  ground.quality = 9;
  ground.drainage = 6;
  ground.hasFloodlights = false;
  ground.hasClubhouse = false;
  club.finances.balance = 5000;
  club.finances.openingBalance = 5000 - club.finances.ledger.reduce((sum, line) => sum + line.amount, 0);
  return game;
}

beforeEach(() => {
  useGameStore.getState().quitToMenu();
});

describe('commissioning work from the club screen', () => {
  it('takes exactly the price the panel quoted, and opens the job', () => {
    const game = aCareer('ui-grounds-commission');
    const clubId = game.userClubId;
    const quoted = groundWorkOption(game, clubId, 'drainage')!;
    const balance = game.clubs[clubId]!.finances.balance;

    useGameStore.getState().commissionGroundWork('drainage');

    const after = useGameStore.getState().game!;
    expect(groundWorkInHand(after, clubId)).toHaveLength(1);
    expect(groundWorkInHand(after, clubId)[0]!.cost).toBe(quoted.cost);
    expect(after.clubs[clubId]!.finances.balance).toBeCloseTo(balance - quoted.cost, 2);
    expect(ledgerBalances(after.clubs[clubId]!.finances)).toBe(true);
    expect(useGameStore.getState().notice).toMatch(/Pitch drainage/);
    expect(useGameStore.getState().error).toBeNull();
  });

  it('refuses a job the club cannot pay for, and books nothing', () => {
    const game = aCareer('ui-grounds-refuse');
    const clubId = game.userClubId;
    game.clubs[clubId]!.finances.balance = 0;
    game.clubs[clubId]!.finances.openingBalance = -game.clubs[clubId]!.finances.ledger.reduce(
      (sum, line) => sum + line.amount,
      0,
    );

    useGameStore.getState().commissionGroundWork('surface');

    const after = useGameStore.getState().game!;
    expect(groundWorkInHand(after, clubId)).toHaveLength(0);
    expect(after.clubs[clubId]!.finances.ledger.filter((line) => line.category === 'ground')).toHaveLength(0);
    expect(useGameStore.getState().notice).toMatch(/the club has/i);
  });

  it('refuses a second job over the top of the first, and says what it is waiting on', () => {
    aCareer('ui-grounds-one-at-a-time');
    useGameStore.getState().commissionGroundWork('drainage');
    useGameStore.getState().commissionGroundWork('surface');

    const after = useGameStore.getState().game!;
    expect(groundWorkInHand(after, after.userClubId)).toHaveLength(1);
    expect(useGameStore.getState().notice).toMatch(/already work in hand/i);
  });

  it('stops paying for the ground the moment the club pulls out, and closes the job', () => {
    const game = aCareer('ui-grounds-cancel');
    const clubId = game.userClubId;
    useGameStore.getState().commissionGroundWork('drainage');
    const project = groundWorkInHand(useGameStore.getState().game!, clubId)[0]!;

    useGameStore.getState().cancelGroundWork(project.id);

    const after = useGameStore.getState().game!;
    expect(groundWorkInHand(after, clubId)).toHaveLength(0);
    expect(facilitiesStore(after).projects.find((candidate) => candidate.id === project.id)!.cancelledOn).toBe(
      after.date,
    );
    expect(useGameStore.getState().notice).toMatch(/cancelled/i);
  });

  it('takes on the weekly upkeep, and gives it up again', () => {
    const game = aCareer('ui-grounds-upkeep');
    const clubId = game.userClubId;
    expect(upkeepCostFor(game, clubId)).toBe(0);

    useGameStore.getState().setGroundUpkeep(true);
    expect(upkeepCostFor(useGameStore.getState().game!, clubId)).toBeGreaterThan(0);
    expect(useGameStore.getState().notice).toMatch(/upkeep on/i);

    useGameStore.getState().setGroundUpkeep(false);
    expect(upkeepCostFor(useGameStore.getState().game!, clubId)).toBe(0);
  });

  it('does not let a manager between jobs spend a club’s money on its ground', () => {
    const game = aCareer('ui-grounds-out-of-work');
    const clubId = game.userClubId;
    // Sacked, and nowhere to go: the ground screens have nothing of his.
    useGameStore.getState().game!.career.status = 'unemployed';
    useGameStore.getState().game!.career.clubId = null;

    useGameStore.getState().commissionGroundWork('drainage');

    const after = useGameStore.getState().game!;
    expect(after.clubs[clubId]!.finances.ledger.filter((line) => line.category === 'ground')).toHaveLength(0);
    expect(useGameStore.getState().notice).toMatch(/between jobs/i);
  });
});

describe('the ground screen', () => {
  it('is a section of the club screen rather than a second ground screen', () => {
    const view = source('src/ui/views/ClubView.tsx');
    expect(view).toContain('<GroundPanel clubId={club.id} />');
    expect(source('src/ui/components/GroundPanel.tsx')).toContain('id="ground"');
  });

  it('draws the ground the manager is standing on, and what it does to the football', () => {
    const panel = source('src/ui/components/GroundPanel.tsx');
    // The condition is drawn and said, from the same badge and the same verdict
    // the matchday card uses — a screen cannot invent its own reading of a pitch.
    expect(panel).toContain('groundSummary(game, clubId)');
    expect(panel).toContain('<PitchBadge conditions={summary.conditions} />');
    expect(panel).toContain('pitchSummary(summary.conditions)');
    expect(panel).toContain('summary.quality');
    expect(panel).toContain('summary.drainage');
  });

  it('says why a job cannot be done instead of only disabling it', () => {
    const panel = source('src/ui/components/GroundPanel.tsx');
    expect(panel).toContain('option.reason');
    // And the states it distinguishes are the service's, not a string match.
    expect(panel).toContain('option.blocked');
    expect(panel).toContain("option.blocked === 'tenancy'");
    expect(panel).toContain("option.blocked === 'in-hand'");
    expect(panel).toContain("option.blocked === 'complete'");
  });

  it('asks before it spends the club’s money, and asks again before it cancels', () => {
    const panel = source('src/ui/components/GroundPanel.tsx');
    expect(panel).toContain('kind="confirm"');
    expect(panel).toContain('gameActions().commissionGroundWork(question.option.work)');
    expect(panel).toContain('gameActions().cancelGroundWork(question.project.id)');
    // The question quotes the price, the date and what is left in the bank.
    expect(panel).toContain('moneyWhole(summary.balance - question.option.cost)');
  });

  it('is wired from the store to the simulation, not to a second copy of the model', () => {
    const store = source('src/state/gameStore.ts');
    expect(store).toContain("from '@/simulation/grounds'");
    expect(store).toContain('commissionGroundWorkSimulation(state, clubId, work)');
    expect(store).toContain('cancelGroundWorkSimulation(state, clubId, projectId)');
    expect(store).toContain('setUpGroundUpkeepSimulation(state, clubId, on)');
    expect(store).toContain('managingClubId(state)');
  });

  it('counts the upkeep in the weeks the two money screens promise', () => {
    for (const file of ['src/ui/views/FinancesView.tsx', 'src/ui/views/ClubView.tsx']) {
      expect(source(file), `${file} leaves the upkeep out of the week`).toContain('upkeepCostFor(game, club.id)');
    }
    expect(source('src/simulation/treasurer.ts')).toContain('GROUND_UPKEEP.perWeek');
    // And the treasurer's forward look is told about it too, so the outlook
    // cannot promise a balance the club is about to be billed out of.
    expect(source('src/simulation/obligations.ts')).toContain('RECURRING_UPKEEP_ID');
  });
});
