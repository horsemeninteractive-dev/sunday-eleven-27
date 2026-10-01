import { describe, expect, it } from 'vitest';
import { isPlayer, type Player } from '@/domain/person';
import {
  RELATIONSHIP_ORIGIN_LABEL,
  attitudeOf,
  attitudeToward,
  relationshipIdFor,
  type Relationship,
} from '@/domain/relationship';
import { GAME_STATE_VERSION } from '@/domain/game';
import { serialiseGame, deserialiseGame } from '@/state/persistence';
import { applyMatchConsequences } from './consequences';
import { matchEnvironment } from './matchday';
import { simulateToCompletion } from './match/engine';
import { startNextSeason } from './progression';
import {
  applyRelationshipEvent,
  contactsOf,
  getRelationship,
  moraleInputFromRelationships,
  rebuildRelationshipIndex,
  recordInteraction,
  relationshipCounts,
  relationshipStore,
  relationshipViewsFor,
  socialGroupsFor,
  socialProfileOf,
  trustedContactsOf,
  upsertRelationship,
  visibleRelationshipViewsFor,
} from './relationships';
import { createTestGame, type TestGame } from './testSupport';
import { nextMatchday } from '@/simulation/timeline';

function allPlayers(game: TestGame): Player[] {
  return Object.values(game.state.people).filter(isPlayer);
}

/** Two people with no relationship yet — used to test creation from scratch. */
function strangerPair(game: TestGame): [string, string] {
  const ids = Object.keys(game.state.people);
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      if (!getRelationship(game.state, a, b)) return [a, b];
    }
  }
  throw new Error('Every pair in the world is already connected');
}

function attitudeSignature(relationship: Relationship): string {
  const { aToB, bToA } = relationship;
  return [
    aToB.friendship,
    aToB.respect,
    aToB.trust,
    aToB.tension,
    aToB.loyalty,
    bToA.friendship,
    bToA.respect,
    bToA.trust,
    bToA.tension,
    bToA.loyalty,
  ].join('|');
}

describe('relationship domain', () => {
  it('keeps one record per pair and answers from either participant', () => {
    const game = createTestGame('rel-domain');
    const [a, b] = strangerPair(game);

    const created = upsertRelationship(game.state, {
      aId: a,
      bId: b,
      origin: 'five-a-side',
      context: 'Test link',
      aToB: { friendship: 84, trust: 72, tension: 4 },
      bToA: { friendship: 18, trust: 26, tension: 62 },
    });

    expect(created.id).toBe(relationshipIdFor(a, b));
    // Asked the other way round, it is the same single record.
    expect(getRelationship(game.state, b, a)).toBe(created);
    expect(Object.keys(relationshipStore(game.state).byId)).toContain(created.id);

    const viewsForA = relationshipViewsFor(game.state, a).find((view) => view.otherId === b)!;
    const viewsForB = relationshipViewsFor(game.state, b).find((view) => view.otherId === a)!;
    expect(viewsForA.attitude.friendship).toBe(84);
    expect(viewsForA.theirAttitude.friendship).toBe(18);
    // And the two sides really do read differently.
    expect(viewsForB.attitude.tension).toBe(62);
    expect(viewsForA.summary.label).not.toBe(viewsForA.theirSummary.label);
  });

  it('applies, clamps and remembers changes', () => {
    const game = createTestGame('rel-deltas');
    const [a, b] = strangerPair(game);
    upsertRelationship(game.state, {
      aId: a,
      bId: b,
      origin: 'work-colleagues',
      aToB: { friendship: 50, trust: 50, tension: 10, loyalty: 50 },
      bToA: { friendship: 50, trust: 50, tension: 10, loyalty: 50 },
    });

    recordInteraction(game.state, {
      aId: a,
      bId: b,
      aToB: { friendship: 999, trust: -999 },
      description: 'Clamped test',
    });
    const relationship = getRelationship(game.state, a, b)!;
    const forA = attitudeOf(relationship, a)!;
    expect(forA.friendship).toBe(100);
    expect(forA.trust).toBe(0);
    // B's side is untouched — attitudes are independent.
    expect(attitudeOf(relationship, b)!.friendship).toBe(50);

    expect(relationship.history[0]?.description).toBe('Clamped test');
    expect(relationship.lastInteraction).toBe(game.state.date);

    // History is bounded so a save cannot grow forever.
    for (let i = 0; i < 40; i++) {
      recordInteraction(game.state, { aId: a, bId: b, aToB: { trust: 1 }, description: `Note ${i}` });
    }
    expect(relationship.history.length).toBeLessThanOrEqual(12);
  });
});

describe('generated social network', () => {
  it('gives a new world a connected, plausible society', () => {
    const game = createTestGame('rel-generation');
    const counts = relationshipCounts(game.state);

    expect(counts.total).toBeGreaterThan(100);
    expect(counts.acrossClubs).toBeGreaterThan(0);

    for (const player of allPlayers(game)) {
      const views = relationshipViewsFor(game.state, player.id);
      expect(views.length).toBeGreaterThan(0);
      // Every player knows his manager, whatever else is going on.
      if (player.clubId) {
        const managerId = game.state.clubs[player.clubId]?.managerId;
        // A player-manager has no relationship with himself.
        if (managerId && managerId !== player.id) {
          expect(getRelationship(game.state, player.id, managerId)).toBeDefined();
        }
      }
    }
  });

  it('gives every relationship a real origin and a plausible context', () => {
    const game = createTestGame('rel-origins');
    const store = relationshipStore(game.state);
    const origins = new Set(Object.keys(RELATIONSHIP_ORIGIN_LABEL));
    let withContext = 0;

    for (const relationship of Object.values(store.byId)) {
      expect(origins.has(relationship.origin)).toBe(true);
      expect(relationship.personAId).not.toBe(relationship.personBId);
      // The network is built for the season, which now starts on the Monday of
      // the first match week.
      expect(relationship.established).toBe(game.state.season.startDate);
      if (relationship.context) withContext += 1;
    }
    // Origins carry the shared context with them: teammates, villages, jobs.
    expect(withContext).toBeGreaterThan(Object.keys(store.byId).length * 0.8);
  });

  it('keeps the index consistent with the records and free of duplicates', () => {
    const game = createTestGame('rel-index');
    const store = relationshipStore(game.state);
    const ids = Object.keys(store.byId);

    for (const [personId, list] of Object.entries(store.byPerson)) {
      expect(new Set(list).size).toBe(list.length);
      for (const id of list) {
        const relationship = store.byId[id];
        expect(relationship).toBeDefined();
        expect([relationship!.personAId, relationship!.personBId]).toContain(personId);
      }
    }

    const pairs = new Set<string>();
    for (const relationship of Object.values(store.byId)) {
      expect(relationship.id).toBe(relationshipIdFor(relationship.personAId, relationship.personBId));
      const key = relationship.id;
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
      expect(store.byId[relationship.id]).toBe(relationship);
    }
    expect(pairs.size).toBe(ids.length);
  });

  it('leaves the manager his own dressing room and is vague about the rest', () => {
    const game = createTestGame('rel-visibility');
    const managerId = game.state.clubs[game.state.userClubId]!.managerId!;
    const squad = allPlayers(game).filter((player) => player.clubId === game.state.userClubId);

    for (const player of squad) {
      const visible = visibleRelationshipViewsFor(game.state, player.id);
      const all = relationshipViewsFor(game.state, player.id);
      expect(visible.length).toBeLessThanOrEqual(all.length);
      expect(visible.length).toBeGreaterThan(0);
      for (const view of visible) {
        const other = game.state.people[view.otherId];
        const otherClubId = other && 'clubId' in other ? other.clubId : null;
        const known = view.provenance === 'observed' || view.provenance === 'known';
        expect(known || otherClubId === game.state.userClubId || view.otherId === managerId).toBe(true);
      }
    }

    const managerViews = visibleRelationshipViewsFor(game.state, managerId);
    expect(managerViews.length).toBeGreaterThanOrEqual(squad.length);
  });
});

describe('social queries', () => {
  it('answers who a player knows, and how, without scanning the world by hand', () => {
    const game = createTestGame('rel-contacts');
    const player = allPlayers(game).find((candidate) => candidate.clubId)!;

    const all = contactsOf(game.state, player.id);
    expect(all.length).toBe(relationshipViewsFor(game.state, player.id).length);

    const former = contactsOf(game.state, player.id, { origins: ['former-teammates'] });
    expect(former.every((view) => view.origin === 'former-teammates')).toBe(true);

    for (const view of contactsOf(game.state, player.id, { outsideHisClub: true })) {
      const other = game.state.people[view.otherId];
      expect(other && 'clubId' in other ? other.clubId : null).not.toBe(player.clubId);
    }
    // The world really is cross-connected, not just a set of closed dressing rooms.
    const withOutsideContacts = allPlayers(game).filter(
      (candidate) => contactsOf(game.state, candidate.id, { outsideHisClub: true }).length > 0,
    );
    expect(withOutsideContacts.length).toBeGreaterThan(5);

    const closeOnes = contactsOf(game.state, player.id, { minStrength: 60 });
    expect(closeOnes.every((view) => view.strength >= 60)).toBe(true);

    // The recruitment question: who would act on a recommendation?
    const trusted = trustedContactsOf(game.state, player.id);
    expect(trusted.every((view) => view.theirAttitude.trust >= 55)).toBe(true);
  });
});

describe('relationship persistence', () => {
  it('survives a save and load without duplicating anything', () => {
    const game = createTestGame('rel-save');
    const before = Object.keys(relationshipStore(game.state).byId).length;

    const loaded = deserialiseGame(serialiseGame(game.state));
    expect(loaded.error).toBeNull();
    const restored = loaded.state!;
    expect(Object.keys(restored.relationships.byId).length).toBe(before);

    const repaired = rebuildRelationshipIndex(restored);
    expect(repaired.duplicates).toBe(0);
    expect(repaired.relationships).toBe(before);

    // The loaded network still answers queries the same way.
    const player = allPlayers(game).find((candidate) => candidate.clubId)!;
    expect(relationshipViewsFor(restored, player.id).length).toBe(
      relationshipViewsFor(game.state, player.id).length,
    );
  });

  it('repairs duplicate records instead of keeping both', () => {
    const game = createTestGame('rel-dedupe');
    const store = relationshipStore(game.state);
    const first = Object.values(store.byId)[0]!;
    store.byId[`dupe__${first.id}`] = { ...first, id: `dupe__${first.id}`, history: [] };

    const repaired = rebuildRelationshipIndex(game.state);
    expect(repaired.duplicates).toBe(1);
    expect(relationshipStore(game.state).byId[`dupe__${first.id}`]).toBeUndefined();
  });

  it('builds the social network for saves made before it existed', () => {
    const game = createTestGame('rel-migrate');
    const legacy = JSON.parse(serialiseGame(game.state)) as {
      version: number;
      state: Record<string, unknown>;
    };
    legacy.version = 1;
    delete legacy.state.relationships;

    const loaded = deserialiseGame(JSON.stringify(legacy));
    expect(loaded.error).toBeNull();
    const restored = loaded.state!;
    expect(Object.keys(restored.relationships.byId).length).toBeGreaterThan(50);
    expect(restored.version).toBe(GAME_STATE_VERSION);

    const repaired = rebuildRelationshipIndex(restored);
    expect(repaired.duplicates).toBe(0);
  });
});

describe('relationships in the simulation', () => {
  it('changes because something happened, and records why', () => {
    const game = createTestGame('rel-events');
    const club = game.state.clubs[game.state.userClubId]!;
    const managerId = club.managerId!;
    const player = allPlayers(game).find(
      (candidate) => candidate.clubId === club.id && candidate.id !== managerId,
    )!;

    const relationship = getRelationship(game.state, player.id, managerId)!;
    const before = { ...attitudeOf(relationship, player.id)! };

    const outcome = applyRelationshipEvent(game.state, {
      type: 'dropped',
      aId: player.id,
      bId: managerId,
      intensity: 1,
      detail: 'left out against Test Rovers',
    });

    expect(outcome).not.toBeNull();
    const after = attitudeOf(relationship, player.id)!;
    expect(after.trust).toBeLessThan(before.trust);
    expect(after.tension).toBeGreaterThan(before.tension);
    expect(relationship.history[0]?.description).toContain('left out');
    expect(relationship.history[0]?.tone).toBe('negative');

    // The manager's own view is its own attitude: it barely budges.
    const managerView = attitudeToward(relationship, player.id)!;
    expect(Math.abs(managerView.trust - 50)).toBeLessThan(60);
  });

  it('lets a good result pull two players closer together', () => {
    const game = createTestGame('rel-success');
    const [a, b] = strangerPair(game);
    upsertRelationship(game.state, {
      aId: a,
      bId: b,
      origin: 'current-teammates',
      aToB: { friendship: 50, trust: 50, tension: 20 },
      bToA: { friendship: 50, trust: 50, tension: 20 },
    });

    applyRelationshipEvent(game.state, { type: 'shared-success', aId: a, bId: b });
    const relationship = getRelationship(game.state, a, b)!;
    expect(attitudeOf(relationship, a)!.friendship).toBeGreaterThan(50);
    expect(attitudeOf(relationship, a)!.tension).toBeLessThan(20);
    expect(attitudeOf(relationship, b)!.trust).toBeGreaterThan(50);
  });

  it('leaves the vast majority of relationships alone after a routine match', () => {
    const game = createTestGame('rel-quiet-match');
    const matchday = nextMatchday(game.state);
    const match = Object.values(game.state.matches).find(
      (candidate) =>
        candidate.matchday === matchday &&
        (candidate.homeClubId === game.state.userClubId || candidate.awayClubId === game.state.userClubId),
    )!;

    const store = relationshipStore(game.state);
    const before = new Map(Object.entries(store.byId).map(([id, rel]) => [id, attitudeSignature(rel)]));

    simulateToCompletion(match, matchEnvironment(game.state, match, { autoManageAllBenches: true }));
    applyMatchConsequences(game.state, match);

    let changed = 0;
    let newlyHostile = 0;
    for (const [id, signature] of before) {
      const relationship = store.byId[id]!;
      if (attitudeSignature(relationship) !== signature) changed += 1;
      if (relationship.aToB.tension >= 76 || relationship.bToA.tension >= 76) newlyHostile += 1;
    }

    // A matchday does leave a mark: somebody was left out, somebody was praised.
    expect(changed).toBeGreaterThan(0);
    // But a normal game does not tear the world apart.
    expect(changed).toBeLessThan(before.size * 0.15);
    expect(newlyHostile).toBeLessThan(before.size * 0.05);
  });

  it('feeds relationships into morale as one input among others', () => {
    const game = createTestGame('rel-morale');
    const club = game.state.clubs[game.state.userClubId]!;
    const managerId = club.managerId!;
    const player = allPlayers(game).find(
      (candidate) => candidate.clubId === club.id && candidate.id !== managerId,
    )!;

    recordInteraction(game.state, {
      aId: player.id,
      bId: managerId,
      aToB: { trust: 100, loyalty: 100, tension: -100 },
      description: 'Backed him in public',
    });
    const buoyed = moraleInputFromRelationships(game.state, player);

    recordInteraction(game.state, {
      aId: player.id,
      bId: managerId,
      aToB: { trust: -200, loyalty: -200, tension: 200 },
      description: 'Hung out to dry',
    });
    const bruised = moraleInputFromRelationships(game.state, player);

    expect(buoyed).toBeGreaterThan(0);
    expect(bruised).toBeLessThan(0);
    expect(buoyed - bruised).toBeGreaterThan(2);
    // It stays an input: it can never swing a player's whole week on its own.
    expect(Math.abs(buoyed)).toBeLessThanOrEqual(3.5);
    expect(Math.abs(bruised)).toBeLessThanOrEqual(3.5);
  });

  it('keeps the network across a season rollover', () => {
    const game = createTestGame('rel-rollover');
    const before = Object.keys(relationshipStore(game.state).byId).length;

    startNextSeason(game.state);

    const after = Object.keys(relationshipStore(game.state).byId).length;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(rebuildRelationshipIndex(game.state).duplicates).toBe(0);

    // New faces arrive attached to somebody rather than floating free.
    for (const club of Object.values(game.state.clubs)) {
      for (const id of club.squadIds) {
        expect(relationshipViewsFor(game.state, id).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('social structure', () => {
  it('derives recognisable groups without hard-coded factions', () => {
    const game = createTestGame('rel-groups');
    const clubId = game.state.userClubId;
    const groups = socialGroupsFor(game.state, clubId);
    expect(groups.length).toBeGreaterThan(0);

    const seen = new Set<string>();
    for (const group of groups) {
      expect(group.memberIds.length).toBeGreaterThanOrEqual(3);
      expect(group.cohesion).toBeGreaterThan(0);
      expect(group.label).not.toMatch(/faction|group \d/i);
      for (const id of group.memberIds) {
        // One player belongs to one group: the grouping is a partition.
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        const person = game.state.people[id];
        expect(person).toBeDefined();
        expect(isPlayer(person) && person.clubId).toBe(clubId);
      }
      // Members of a group really are connected to somebody else in it.
      const connected = group.memberIds.filter((id) =>
        group.memberIds.some((other) => other !== id && (getRelationship(game.state, id, other)?.strength ?? 0) >= 40),
      );
      expect(connected.length).toBeGreaterThanOrEqual(3);
    }

    // A higher bar can only ever split groups, never invent new ones.
    const strict = socialGroupsFor(game.state, clubId, { threshold: 90 });
    const strictMembers = strict.reduce((sum, group) => sum + group.memberIds.length, 0);
    const looseMembers = groups.reduce((sum, group) => sum + group.memberIds.length, 0);
    expect(strictMembers).toBeLessThanOrEqual(looseMembers);
  });

  it('identifies dressing-room influence from what teammates actually think', () => {
    const game = createTestGame('rel-influence');
    const club = game.state.clubs[game.state.userClubId]!;
    const player = allPlayers(game).find((candidate) => candidate.clubId === club.id)!;
    const profile = socialProfileOf(game.state, player.id);

    expect(profile.clubId).toBe(club.id);
    expect(profile.influence).toBeGreaterThanOrEqual(0);
    expect(profile.influence).toBeLessThanOrEqual(100);
    expect(profile.closeFriends).toBeGreaterThanOrEqual(0);

    // Anybody flagged as a leader must actually be respected by several peers.
    if (profile.informalLeader) {
      expect(profile.respectedBy).toBeGreaterThanOrEqual(3);
      expect(profile.influence).toBeGreaterThanOrEqual(62);
    }
    if (profile.troublemaker) expect(profile.tensionWith).toBeGreaterThanOrEqual(2);
  });
});
