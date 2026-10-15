import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Player } from '@/domain/person';
import { createTestGame } from '../testSupport';
import {
  POOL_PER_TOWN,
  refreshUnattachedPool,
  surplusOverCap,
  unattachedPlayers,
  unattachedPoolCap,
} from './unattachedPlayers';

/**
 * The unattached pool is generated per town and held to a cap of the same
 * size, both at the career's start and at every summer after it. The soak's
 * `unattached-pool-holds` band is measured against the first season, so a pool
 * that opens at one size and settles at another is a pool the band cannot hold.
 * These tests pin the cap to the towns, and the summer that holds the pool there.
 */

function townCount(state: GameState): number {
  return Object.keys(state.world.towns).length;
}

function pool(state: GameState): Player[] {
  return unattachedPlayers(state);
}

describe('the unattached pool cap', () => {
  it('is the same size as the opening draw, per town, with a floor for a very small world', () => {
    expect(POOL_PER_TOWN).toBe(3);
    expect(unattachedPoolCap(170)).toBe(510);
    expect(unattachedPoolCap(2)).toBe(12);
  });

  it('takes the surplus oldest first, by id within an age, and never more than it must', () => {
    const make = (id: string, age: number) => ({ id, age }) as Player;
    const pool = [make('p_b', 30), make('p_a', 30), make('p_c', 40), make('p_d', 20)];

    expect(surplusOverCap(pool, 4)).toEqual([]);
    expect(surplusOverCap(pool, 2).map((player) => player.id)).toEqual(['p_c', 'p_a']);
    // The same pool always loses the same men, whatever order it arrives in.
    expect(surplusOverCap([...pool].reverse(), 2).map((player) => player.id)).toEqual(['p_c', 'p_a']);
  });
});

describe('the pool a career opens with', () => {
  it('is generated at the cap size, so the first summer does not have to trim it down to size', () => {
    const { state } = createTestGame('pool-opening', 0, 2026, 6);
    const cap = unattachedPoolCap(townCount(state));

    // Two to four men a town, three on average: within a tenth of the cap.
    expect(pool(state).length).toBeGreaterThan(cap * 0.9);
    expect(pool(state).length).toBeLessThan(cap * 1.1);
  });
});

describe('the pool across summers', () => {
  it('stays at its cap every summer, with the new names counted inside it', () => {
    const { state } = createTestGame('pool-summers', 0, 2026, 2);
    const cap = unattachedPoolCap(townCount(state));

    for (let summer = 1; summer <= 4; summer += 1) {
      refreshUnattachedPool(state, state.season.startDate, `pool-summer-${summer}`);
      // Arrivals are a part of the pool, not a surplus on top of it: the pool is
      // at the cap after every summer, whatever the summer brought in.
      expect(pool(state).length).toBeLessThanOrEqual(cap);
      expect(pool(state).length).toBeGreaterThan(cap * 0.9);
    }
  });

  it('removes a man who leaves the pool from the world entirely, and returns only the men who stayed', () => {
    const { state } = createTestGame('pool-departures', 0, 2026, 2);
    const before = new Set(pool(state).map((player) => player.id));

    const arrivals = refreshUnattachedPool(state, state.season.startDate, 'pool-departures-1');

    for (const arrival of arrivals) {
      expect(state.people[arrival.id]).toBe(arrival);
    }
    // Everybody who was in the pool and is not now has left the world, not just
    // the pool: a departed man is not kept as a person no list reads.
    const after = new Set(pool(state).map((player) => player.id));
    for (const id of before) {
      if (!after.has(id)) expect(state.people[id]).toBeUndefined();
    }
  });
});
