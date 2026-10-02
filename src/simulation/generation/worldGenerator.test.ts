import { describe, expect, it } from 'vitest';
import { DEFAULT_PYRAMID } from '@/domain/competition';
import { isPlayer } from '@/domain/person';
import { ALL_POSITION_CODES } from '@/domain/positions';
import { generateDraft } from '../gameSetup';
import { generatePlayer } from './playerGenerator';
import { Rng } from '../rng';

function summarise(world: ReturnType<typeof generateDraft>) {
  return Object.values(world.clubs)
    .map((club) => ({
      name: club.identity.name,
      town: club.townId,
      ground: world.world.grounds[club.groundId]?.name,
      structure: club.structure,
      reputation: club.reputation,
      squad: club.squadIds
        .map((id) => world.people[id])
        .filter(isPlayer)
        .map((player) => `${player.firstName} ${player.surname} ${player.preferredPosition} ${player.attributes.technical.passing}`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('world generation', () => {
  it('is deterministic for a given seed', () => {
    const a = generateDraft({ seed: 'ash-tree-7' });
    const b = generateDraft({ seed: 'ash-tree-7' });
    expect(summarise(a)).toEqual(summarise(b));
    expect(a.leagueName).toBe(b.leagueName);
  });

  it('produces different worlds for different seeds', () => {
    const a = generateDraft({ seed: 'ash-tree-7' });
    const b = generateDraft({ seed: 'willow-lane-2' });
    expect(summarise(a)).not.toEqual(summarise(b));
  });

  it('builds a believable local area of clubs, towns and grounds', () => {
    const world = generateDraft({ seed: 'grassroots-1' });
    const clubs = Object.values(world.clubs);
    expect(clubs.length).toBe(DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    expect(world.divisionClubIds.length).toBe(DEFAULT_PYRAMID.clubsPerTier);

    // The ladder: three divisions, full, and ranked so the top division is the
    // strongest. Reputation drove both the ranking and the squads, so this is
    // stratification from the moment the world is built rather than something
    // the first few seasons sort out.
    expect(world.divisions.length).toBe(DEFAULT_PYRAMID.tiers);
    const divisionReputations = world.divisions.map((division) =>
      division.map((id) => world.clubs[id]!.reputation),
    );
    for (const division of divisionReputations) {
      expect(division.length).toBe(DEFAULT_PYRAMID.clubsPerTier);
    }
    const tierMean = (reputations: number[]) =>
      reputations.reduce((sum, value) => sum + value, 0) / reputations.length;
    expect(tierMean(divisionReputations[0]!)).toBeGreaterThan(tierMean(divisionReputations[1]!));
    expect(tierMean(divisionReputations[1]!)).toBeGreaterThan(tierMean(divisionReputations[2]!));

    const towns = Object.values(world.world.towns);
    expect(towns.length).toBeGreaterThanOrEqual(5);
    for (const town of towns) {
      expect(town.population).toBeGreaterThan(100);
      expect(town.description.length).toBeGreaterThan(10);
    }

    for (const club of clubs) {
      expect(club.identity.name.length).toBeGreaterThan(3);
      expect(club.identity.foundedYear).toBeGreaterThan(1880);
      expect(world.world.grounds[club.groundId]).toBeTruthy();
      expect(club.squadIds.length).toBeGreaterThanOrEqual(20);
      expect(club.squadIds.length).toBeLessThanOrEqual(25);
      expect(club.managerId).toBeTruthy();
      expect(club.chairmanId).toBeTruthy();
      expect(club.identity.colours.primary).toMatch(/^#/);
    }
  });

  it('generates squads with credible depth in every area of the pitch', () => {
    const world = generateDraft({ seed: 'squad-depth' });
    for (const club of Object.values(world.clubs)) {
      const squad = club.squadIds.map((id) => world.people[id]).filter(isPlayer);
      expect(squad.filter((player) => player.preferredPosition === 'GK').length).toBeGreaterThanOrEqual(2);
      expect(squad.filter((player) => player.positionGroup === 'DEF').length).toBeGreaterThanOrEqual(5);
      expect(squad.filter((player) => player.positionGroup === 'MID').length).toBeGreaterThanOrEqual(5);
      expect(squad.filter((player) => player.positionGroup === 'FWD').length).toBeGreaterThanOrEqual(4);
    }
  });

  it('creates rivalries between nearby clubs, symmetrically', () => {
    const world = generateDraft({ seed: 'derby-day' });
    const withRivalries = Object.values(world.clubs).filter((club) => Object.keys(club.rivalries).length > 0);
    expect(withRivalries.length).toBeGreaterThan(0);
    for (const club of withRivalries) {
      for (const [opponentId, rivalry] of Object.entries(club.rivalries)) {
        expect(world.clubs[opponentId]?.rivalries[club.id]?.intensity).toBe(rivalry.intensity);
        expect(rivalry.intensity).toBeGreaterThan(0);
      }
    }
  });
});

describe('player generation', () => {
  it('keeps every attribute on the 1-20 scale', () => {
    const rng = new Rng('attributes');
    for (let i = 0; i < 200; i++) {
      const player = generatePlayer({
        rng,
        id: `p${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
      });
      for (const group of Object.values(player.attributes)) {
        for (const value of Object.values(group as unknown as Record<string, number>)) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(20);
          expect(Number.isInteger(value)).toBe(true);
        }
      }
      expect(player.age).toBeGreaterThanOrEqual(17);
      expect(player.age).toBeLessThanOrEqual(42);
      expect(ALL_POSITION_CODES).toContain(player.preferredPosition);
      expect(player.availability.status).toBe('available');
    }
  });

  it('makes goalkeepers good in goal and outfielders not', () => {
    const rng = new Rng('keepers');
    const keepers = Array.from({ length: 30 }, (_, i) =>
      generatePlayer({
        rng,
        id: `gk${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
        positionGroup: 'GK',
      }),
    );
    const outfield = Array.from({ length: 30 }, (_, i) =>
      generatePlayer({
        rng,
        id: `of${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
        positionGroup: 'MID',
      }),
    );
    const meanKeeping = (players: typeof keepers) =>
      players.reduce((sum, player) => sum + player.attributes.technical.goalkeeping, 0) / players.length;
    expect(meanKeeping(keepers)).toBeGreaterThan(meanKeeping(outfield) + 6);
  });

  it('produces meaningful differences between players rather than clones', () => {
    const rng = new Rng('variety');
    const players = Array.from({ length: 60 }, (_, i) =>
      generatePlayer({
        rng,
        id: `v${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
        positionGroup: 'MID',
      }),
    );
    const running = players.map((player) => player.attributes.physical.stamina);
    const passing = players.map((player) => player.attributes.technical.passing);
    expect(new Set(running).size).toBeGreaterThan(8);
    expect(new Set(passing).size).toBeGreaterThan(8);
    // Plenty of players are good at one thing and poor at another.
    const specialists = players.filter(
      (player) => Math.abs(player.attributes.technical.passing - player.attributes.physical.pace) >= 5,
    );
    expect(specialists.length).toBeGreaterThan(10);
  });
});
