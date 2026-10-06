import { describe, expect, it } from 'vitest';
import type { ClubId, GroundId, ISODate, PlayerId, TownId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { clubSignsFromPool } from './aiClubs';
import { generatePlayer, generateSquad } from './generation/playerGenerator';
import { clubQualityFromReputation, clubStandardQuality } from './generation/worldGenerator';
import { abilityMean } from './queries';
import { Rng } from './rng';
import { arrivalQualityFor } from './season';
import { createTestGame } from './testSupport';

const SEASON_START = '2026-07-20' as ISODate;
const meanOf = (players: readonly Player[]): number =>
  players.reduce((sum, player) => sum + abilityMean(player), 0) / Math.max(1, players.length);

/**
 * The summer's squad business.
 *
 * A career is fifteen seasons of arrivals and departures, and the soak's job is
 * to catch a world that inflates over them. It caught two: the bottom division
 * gained six per cent of ability while the ladder flattened, and goals per match
 * climbed eighteen per cent. Both traced back to the same thing — every arrival
 * was generated *better than the club it joined*, or at least better than the
 * men it replaced — so the county ratcheted upward one summer at a time.
 *
 * These pin the two rules that stop it: an arrival is generated at the club's
 * standing (with the spread of a real squad), and no club signs a man better
 * than the club it is.
 */

describe('the summer arrivals', () => {
  it('generates a man at the club’s standing, with the spread of a real squad', () => {
    const reputation = 52;
    const standard = clubStandardQuality(reputation);
    const rng = new Rng('arrival-quality');
    const draws = Array.from({ length: 500 }, () => arrivalQualityFor(rng, reputation));

    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    const spread = Math.sqrt(draws.reduce((sum, value) => sum + (value - mean) ** 2, 0) / draws.length);

    // Centred on the level the club plays at, not above it: an arrival replaces
    // a man, he does not upgrade the squad.
    expect(Math.abs(mean - standard)).toBeLessThan(0.2);
    // And a real spread, so a squad built out of arrivals keeps its best men
    // rather than regressing to its average. A keeper is one man where the
    // attack is a team average, and a flat intake had the county's best glove
    // falling five per cent over a career.
    expect(spread).toBeGreaterThan(0.8);
    expect(spread).toBeLessThan(1.9);
  });

  it('puts the youth intake a shade below the standing rather than above it', () => {
    const reputation = 52;
    const standard = clubStandardQuality(reputation);
    const rng = new Rng('arrival-youth');
    const draws = Array.from({ length: 600 }, () => arrivalQualityFor(rng, reputation, -0.2));
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    // An intake is an intake: behind the seniors, never an upgrade.
    expect(mean).toBeLessThan(standard);
    expect(mean).toBeGreaterThan(standard - 0.6);
  });

  it('signs arrivals of the same standard as the squad they are joining', () => {
    const reputation = 52;
    const rng = new Rng('arrival-vs-squad');

    // Squads, generated the way the world generator builds them...
    const squad: Player[] = [];
    for (let index = 0; index < 3; index += 1) {
      squad.push(
        ...generateSquad({
          rng,
          clubId: `club_s${index}` as ClubId,
          townId: 'town_a' as TownId,
          homeGroundId: 'ground_a' as GroundId,
          quality: clubQualityFromReputation(rng, reputation),
          seasonStart: SEASON_START,
          idSeedPrefix: `squad_${index}`,
        }),
      );
    }

    // ...and a summer's arrivals, at the same standing.
    const arrivals = Array.from({ length: 200 }, (_, index) =>
      generatePlayer({
        rng,
        id: `arrival_${index}` as PlayerId,
        clubId: null,
        townId: 'town_a' as TownId,
        homeGroundId: null,
        quality: arrivalQualityFor(rng, reputation),
        seasonStart: SEASON_START,
        age: 23,
      }),
    );

    // A man who arrives in the summer is a man of the squad he joins. Generated
    // any better and the world climbs a rung every season; any worse and it
    // slides. This is the equality the soak's decade of drift was missing.
    expect(Math.abs(meanOf(arrivals) - meanOf(squad))).toBeLessThan(0.4);
  });
});

describe('the club standard', () => {
  it('is the centre a regenerated squad is drawn around, noise and all', () => {
    const reputation = 52;
    const standard = clubStandardQuality(reputation);
    const rng = new Rng('standard-centre');
    const draws = Array.from({ length: 800 }, () => clubQualityFromReputation(rng, reputation));
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    const spread = Math.sqrt(draws.reduce((sum, value) => sum + (value - mean) ** 2, 0) / draws.length);
    expect(Math.abs(mean - standard)).toBeLessThan(0.1);
    // The per-club roll is still there: a standard is not a straitjacket.
    expect(spread).toBeGreaterThan(0.25);
    expect(spread).toBeLessThan(0.6);
  });
});

describe('what a club signs', () => {
  it('never signs a man better than the club it is', () => {
    const { state } = createTestGame('signing-band');
    const club = Object.values(state.clubs).find((candidate) => candidate.active && candidate.id !== state.userClubId)!;
    const standard = clubStandardQuality(club.reputation);

    // A pool stacked with men just above this club's standard — the *little*
    // upgrade, not the obvious ringer, because that is the one a banded signing
    // policy lets through and the one that ratchets the world. A couple of far
    // better men ride along to check the ceiling is a ceiling.
    const rng = new Rng('signing-band-pool');
    const stars: PlayerId[] = [];
    for (let index = 0; index < 8; index += 1) {
      const star = generatePlayer({
        rng,
        id: `star_${index}` as PlayerId,
        clubId: null,
        townId: club.townId,
        homeGroundId: null,
        quality: index < 6 ? standard * 1.05 : standard + 4,
        seasonStart: state.season.startDate,
        age: 26,
      });
      state.people[star.id] = star;
      stars.push(star.id);
    }
    // The men who really are above the club's standard: the ones it must refuse.
    // Generating a man at `standard * 1.05` leaves him somewhere around it, so
    // the pool is filtered on the reading the signing policy itself uses.
    const above = stars.filter((id) => {
      const man = state.people[id];
      return Boolean(man && isPlayer(man) && abilityMean(man) > standard);
    });
    expect(above.length).toBeGreaterThan(0);

    const target = club.squadIds.length + 3;
    club.squadIds = club.squadIds.slice(0, Math.max(0, club.squadIds.length - 3));

    const signed = clubSignsFromPool(state, club, new Rng('signing-band-sign'), state.season.startDate, target);

    // The club fills its gaps...
    expect(signed.length).toBeGreaterThan(0);
    // ...but the men above its own standard stay in the pool. This is the rule
    // that stops thirty-six clubs each climbing one signing at a time.
    for (const id of above) expect(signed).not.toContain(id);
    for (const id of signed) {
      const man = state.people[id];
      if (!man || !isPlayer(man)) continue;
      expect(abilityMean(man)).toBeLessThanOrEqual(standard);
    }
  });

  it('leaves a club that has risen above its standing unable to climb further', () => {
    const { state } = createTestGame('signing-ceiling');
    const club = Object.values(state.clubs).find((candidate) => candidate.active && candidate.id !== state.userClubId)!;
    const standard = clubStandardQuality(club.reputation);
    // Every man the club already has is better than the club's standing says.
    for (const id of club.squadIds) {
      const man = state.people[id];
      if (man && isPlayer(man)) man.attributes.technical.passing = 18;
    }

    const rng = new Rng('signing-ceiling-pool');
    for (let index = 0; index < 6; index += 1) {
      const star = generatePlayer({
        rng,
        id: `ceiling_star_${index}` as PlayerId,
        clubId: null,
        townId: club.townId,
        homeGroundId: null,
        quality: 17,
        seasonStart: state.season.startDate,
        age: 26,
      });
      state.people[star.id] = star;
    }
    club.squadIds = club.squadIds.slice(0, Math.max(0, club.squadIds.length - 3));
    const target = club.squadIds.length + 3;

    const signed = clubSignsFromPool(state, club, new Rng('signing-ceiling-sign'), state.season.startDate, target);
    for (const id of signed) {
      const man = state.people[id];
      if (!man || !isPlayer(man)) continue;
      expect(abilityMean(man)).toBeLessThanOrEqual(standard);
    }
  });
});
