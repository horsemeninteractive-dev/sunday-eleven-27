import { describe, expect, it } from 'vitest';
import { isPlayer, type Player } from '@/domain/person';
import { getFormation } from '@/domain/positions';
import { createTestGame } from './testSupport';
import { autoPickLineup, positionScore, validateLineup } from './selection';

function squadOf(state: ReturnType<typeof createTestGame>['state'], clubId: string): Player[] {
  return state.clubs[clubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);
}

describe('team selection', () => {
  it('picks a full XI with a goalkeeper for every formation', () => {
    const { state } = createTestGame('selection-check');
    const squad = squadOf(state, state.userClubId);
    const formations = ['4-4-2', '4-3-3', '3-5-2', '5-3-2', '4-1-4-1', '4-2-3-1', '4-5-1', '4-4-1-1'] as const;

    for (const formation of formations) {
      const selection = autoPickLineup(squad, formation);
      expect(selection.starting).toHaveLength(11);
      expect(selection.starting.some((slot) => slot.position === 'GK')).toBe(true);
      const positions = selection.starting.map((slot) => slot.position);
      for (const slot of getFormation(formation).slots) {
        expect(positions).toContain(slot.position);
      }
      const ids = new Set(selection.starting.map((slot) => slot.playerId));
      expect(ids.size).toBe(11);
      expect(selection.bench.length).toBeGreaterThan(0);
    }
  });

  it('never selects unavailable players and prefers available ones', () => {
    const { state } = createTestGame('availability-selection');
    const squad = squadOf(state, state.userClubId);
    // Make most of the squad unavailable.
    squad.slice(0, 12).forEach((player) => {
      player.availability = { status: 'unavailable', reason: 'work', note: 'On shift', until: null, discoveredLate: false };
    });

    const selection = autoPickLineup(squad, '4-4-2');
    const unavailableIds = new Set(squad.slice(0, 12).map((player) => player.id));
    for (const slot of [...selection.starting, ...selection.bench]) {
      expect(unavailableIds.has(slot.playerId)).toBe(false);
    }
  });

  it('rates players for positions from attributes and familiarity, not one overall score', () => {
    const { state } = createTestGame('position-score');
    const squad = squadOf(state, state.userClubId);
    const keeper = squad.find((player) => player.preferredPosition === 'GK')!;
    const striker = squad.find((player) => player.preferredPosition === 'ST')!;

    expect(positionScore(keeper, 'GK')).toBeGreaterThan(positionScore(keeper, 'ST'));
    expect(positionScore(striker, 'ST')).toBeGreaterThan(positionScore(striker, 'GK'));
    expect(positionScore(keeper, 'GK')).toBeLessThanOrEqual(1);
    expect(positionScore(keeper, 'GK')).toBeGreaterThan(0);
  });

  it('flags selection problems a manager should notice', () => {
    const { state } = createTestGame('validation');
    const squad = squadOf(state, state.userClubId);
    const selection = autoPickLineup(squad, '4-4-2');
    const lookup = (id: string) => state.people[id];

    const clean = validateLineup(selection.starting, selection.bench, (id) => (lookup(id)?.kind === 'player' ? (lookup(id) as Player) : undefined));
    expect(clean.filter((problem) => problem.severity === 'error')).toHaveLength(0);

    // Below the minimum there is no team to field at all.
    const short = selection.starting.slice(0, 6);
    const shortProblems = validateLineup(short, [], (id) => (lookup(id)?.kind === 'player' ? (lookup(id) as Player) : undefined));
    expect(
      shortProblems.some((problem) => problem.severity === 'error' && problem.message.includes('at least 7')),
    ).toBe(true);

    // Remove the keeper and the problems should call it out — ten outfielders is
    // short-handed, but a legal side.
    const noKeeper = selection.starting.filter((slot) => slot.position !== 'GK');
    const problems = validateLineup(noKeeper, selection.bench, (id) => (lookup(id)?.kind === 'player' ? (lookup(id) as Player) : undefined));
    expect(problems.some((problem) => problem.severity === 'error' && problem.message.includes('at least 7'))).toBe(false);
    expect(problems.some((problem) => problem.message.includes('goalkeeper'))).toBe(true);

    const duplicated = [...selection.starting.slice(0, 10), selection.starting[0]!];
    const dupProblems = validateLineup(duplicated, selection.bench, (id) => (lookup(id)?.kind === 'player' ? (lookup(id) as Player) : undefined));
    expect(dupProblems.some((problem) => problem.message.includes('twice'))).toBe(true);
  });

  it('permits sensible out-of-position selections instead of blocking them', () => {
    const { state } = createTestGame('out-of-position');
    const squad = squadOf(state, state.userClubId);
    const centreHalf = squad.find((player) => player.preferredPosition === 'CB')!;
    // A centre half at right back is a normal grassroots compromise.
    expect(positionScore(centreHalf, 'RB')).toBeGreaterThan(0.4);
    const selection = autoPickLineup(squad, '4-4-2');
    const lookup = (id: string) => {
      const person = state.people[id];
      return isPlayer(person) ? person : undefined;
    };
    const problems = validateLineup(selection.starting, selection.bench, lookup);
    expect(problems.filter((problem) => problem.severity === 'error')).toHaveLength(0);
  });
});
