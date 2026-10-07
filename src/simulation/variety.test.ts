import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@/domain/news';
import type { Match } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import { createTestGame } from './testSupport';
import { generateDraft } from './gameSetup';
import { commentaryFor } from './match/matchEngine/narrate';
import { createMatchEngine } from './match/matchEngine/engine';
import { matchEnvironment, prepareMatchday } from './matchday';
import { nextMatchday } from './timeline';
import { cloneMatch } from './match/testHelpers';
import { renderNewsItem } from './news';
import { readings, variant } from './prose';
import { MIN_SEED_LENGTH, SUGGESTED_SEEDS, pickSuggestedSeeds, rollSeed, seedIsUsable } from './generation/seeds';

/**
 * How much of the world there is.
 *
 * A career is read, not audited: the complaint this file exists for is that the
 * third career reads like the first, because four seeds were offered, the same
 * names came round, and every goal, injury and club-in-the-red was told the one
 * way it had been written. These tests hold the *amount* of variety — how many
 * seeds there are to pick, how many towns and businesses a county holds, how
 * many readings a fact has — and they are deliberately blind to which words
 * those are, so the pools can be rewritten without rewriting the tests.
 *
 * The one rule that is not about amount is determinism: prose is written twice
 * for the same fact, so the same event must read the same way every time.
 */

function injuryEvent(id: string, player: string, club: string): GameEvent {
  return {
    id,
    type: 'injury',
    date: '2026-09-06',
    importance: 2,
    clubIds: [],
    personIds: [],
    matchId: null,
    data: { player, club, description: 'a tight hamstring', daysOut: 21 },
  };
}

function resultEvent(id: string): GameEvent {
  return {
    id,
    type: 'match-result',
    date: '2026-09-06',
    importance: 2,
    clubIds: [],
    personIds: [],
    matchId: null,
    data: {
      homeClub: 'Holmere Athletic',
      awayClub: 'Draywick Rovers',
      homeGoals: 3,
      awayGoals: 1,
      venue: 'Holmere Recreation Ground',
      scorers: 'A. Pearce 2, S. Vickers',
      attendance: 84,
      verdict: 'Comfortable in the end.',
    },
  };
}

function financeEvent(id: string): GameEvent {
  return {
    id,
    type: 'finances-warning',
    date: '2026-09-06',
    importance: 3,
    clubIds: [],
    personIds: [],
    matchId: null,
    data: { club: 'Draywick Rovers', balance: -42.75, amount: -42.75 },
  };
}

describe('a fact reads the same way every time, and differently from the next one', () => {
  it('picks from a pool by the identity of the thing described, never at random', () => {
    const pool = ['one', 'two', 'three', 'four', 'five'];
    expect(variant(pool, 'event-7')).toBe(variant(pool, 'event-7'));
    // Different facts have to be able to read differently, or the pool is a
    // constant with extra steps.
    const keys = Array.from({ length: 200 }, (_, index) => `event-${index}`);
    expect(readings(pool, keys).size).toBe(pool.length);
  });

  it('refuses an empty pool rather than returning nothing', () => {
    expect(() => variant([], 'event-1')).toThrow();
  });

  it('tells a match result, an injury and a warning several ways', () => {
    const { state } = createTestGame('variety-news');
    const ids = Array.from({ length: 40 }, (_, index) => `evt_${index}`);
    const cases = [
      { events: ids.map((id) => resultEvent(id)), name: 'match result' },
      { events: ids.map((id) => injuryEvent(id, 'A. Pearce', 'Draywick Rovers')), name: 'injury' },
      { events: ids.map((id) => financeEvent(id)), name: 'finances' },
    ];
    for (const { events, name } of cases) {
      const written = events.map((event) => renderNewsItem(state, event));
      const headlines = new Set(written.map((item) => item.headline));
      const bodies = new Set(written.map((item) => item.body));
      expect(headlines.size, `${name} headline`).toBeGreaterThan(1);
      expect(bodies.size, `${name} body`).toBeGreaterThan(1);
      for (const item of written) {
        // Every reading keeps the facts, and none of them leaks a placeholder.
        expect(item.headline).not.toMatch(/[{}]/);
        expect(item.body).not.toMatch(/[{}]/);
      }
    }
  });

  it('never loses the facts a news item is about', () => {
    const { state } = createTestGame('variety-news-facts');
    const ids = Array.from({ length: 30 }, (_, index) => `evt_${index}`);

    for (const id of ids) {
      const result = renderNewsItem(state, resultEvent(id));
      expect(`${result.headline} ${result.body}`).toContain('Holmere Athletic');
      expect(`${result.headline} ${result.body}`).toContain('Draywick Rovers');
      expect(`${result.headline} ${result.body}`).toContain('84');

      const injury = renderNewsItem(state, injuryEvent(id, 'A. Pearce', 'Draywick Rovers'));
      expect(`${injury.headline} ${injury.body}`).toContain('A. Pearce');
      expect(`${injury.headline} ${injury.body}`).toContain('Draywick Rovers');

      const money = renderNewsItem(state, financeEvent(id));
      expect(`${money.headline} ${money.body}`).toContain('Draywick Rovers');
      expect(`${money.headline} ${money.body}`).toContain('42.75');
    }
  });
});

describe('the commentary says the same moment the same way, and different moments differently', () => {
  function playedMatch(seed: string): { match: Match; env: ReturnType<typeof matchEnvironment>; state: ReturnType<typeof createTestGame>['state'] } {
    const { state } = createTestGame(seed);
    const matchday = nextMatchday(state);
    const fixture = Object.values(state.matches).find(
      (candidate) =>
        candidate.matchday === matchday &&
        (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
    )!;
    prepareMatchday(state, fixture.matchday);
    const match = cloneMatch(state.matches[fixture.id]!);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    createMatchEngine(match, env).runToCompletion();
    return { match, env, state };
  }

  it('reads a match back exactly as it was told, every time it is read', () => {
    const { match, env } = playedMatch('variety-commentary');
    const first = commentaryFor(match.events, match, env);
    const second = commentaryFor(match.events, match, env);
    expect(first.map((line) => line.text)).toEqual(second.map((line) => line.text));
  });

  it('has more than one way of saying the ordinary things', () => {
    const { match, env } = playedMatch('variety-commentary');
    const lines = commentaryFor(match.events, match, env);
    // A match is thousands of events and a handful of kinds of moment: if the
    // reading were single, the transcript would hold about as many distinct
    // sentences as it has categories.
    const texts = new Set(lines.map((line) => line.text));
    expect(texts.size).toBeGreaterThan(60);
    // And the commonest kind of moment really does vary: passes are the weave of
    // every match, and no two of them have to be worded identically.
    const passes = lines.filter((line) => /pass/.test(line.category)).map((line) => line.text);
    expect(passes.length).toBeGreaterThan(20);
    expect(new Set(passes).size).toBeGreaterThan(3);
  });
});

describe('a county has more than a handful of anything', () => {
  it('builds a wide county, and a different one for a different seed', () => {
    const a = generateDraft({ seed: 'variety-county-a' });
    const b = generateDraft({ seed: 'variety-county-b' });

    const towns = Object.values(a.world.towns);
    expect(towns.length).toBeGreaterThanOrEqual(15);
    // Every place has a name and something on it.
    expect(new Set(towns.map((town) => town.name)).size).toBe(towns.length);
    for (const town of towns) {
      expect(town.name.length).toBeGreaterThan(3);
      expect(town.description.length).toBeGreaterThan(10);
    }
    // Pubs, builders, garages: a county with fewer businesses than clubs is not
    // a county the sponsorship system can work in.
    expect(Object.keys(a.world.businesses).length).toBeGreaterThan(40);
    // And no town holds two businesses of the same name. Two towns at opposite
    // ends of a county may each have a Red Lion and always have; one high street
    // with three Social Clubs is the generator repeating itself.
    for (const town of towns) {
      const names = town.businessIds.map((id) => a.world.businesses[id]!.name);
      expect(new Set(names).size, town.name).toBe(names.length);
      for (const name of names) expect(name.length).toBeGreaterThan(3);
    }

    // The same seed is the same county, and a different seed is not.
    expect(
      Object.values(generateDraft({ seed: 'variety-county-a' }).world.towns).map((town) => town.name),
    ).toEqual(towns.map((town) => town.name));
    expect(Object.values(b.world.towns).map((town) => town.name)).not.toEqual(towns.map((town) => town.name));
  });

  it('draws a squad from a wide pool of names rather than from a shortlist', () => {
    const world = generateDraft({ seed: 'variety-names' });
    const players = Object.values(world.people).filter(isPlayer);
    expect(players.length).toBeGreaterThan(700);

    const firsts = new Set(players.map((player) => player.firstName));
    const surnames = new Set(players.map((player) => player.surname));
    // A county of this size should be meeting a large share of the pool, not
    // cycling through the forty names at the top of it.
    expect(firsts.size).toBeGreaterThan(150);
    expect(surnames.size).toBeGreaterThan(150);

    // Clubs are named for their place, and no two of them are the same name.
    const names = Object.values(world.clubs).map((club) => club.identity.name);
    expect(new Set(names).size).toBe(names.length);
    const nicknames = Object.values(world.clubs).map((club) => club.identity.nickname);
    expect(new Set(nicknames).size).toBe(nicknames.length);
    const colours = new Set(Object.values(world.clubs).map((club) => club.identity.colours.primary));
    expect(colours.size).toBeGreaterThan(8);
  });
});

describe('the seeds a manager is offered', () => {
  it('are a long list of worlds, not four', () => {
    expect(SUGGESTED_SEEDS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SUGGESTED_SEEDS).size).toBe(SUGGESTED_SEEDS.length);
    for (const seed of SUGGESTED_SEEDS) {
      expect(seedIsUsable(seed), seed).toBe(true);
      // Typeable and unmistakable: a seed is a line a manager may have to say
      // out loud to somebody else.
      expect(seed).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('can invent one, so the list is not the whole offer', () => {
    // A pinned source, so the roll itself is the thing under test.
    let calls = 0;
    const random = () => {
      calls += 1;
      return ((calls * 0.137) % 1 + 1) % 1;
    };
    const rolled = new Set(Array.from({ length: 50 }, () => rollSeed(random)));
    expect(rolled.size).toBeGreaterThan(20);
    for (const seed of rolled) {
      expect(seedIsUsable(seed), seed).toBe(true);
      expect(seed).toMatch(/^[a-z0-9-]+$/);
      expect(seed.trim().length).toBeGreaterThanOrEqual(MIN_SEED_LENGTH);
      expect(seed.length).toBeLessThan(46);
    }
  });

  it('offers a handful of them without ever repeating one', () => {
    const picked = pickSuggestedSeeds(9, () => 0.42);
    expect(picked).toHaveLength(9);
    expect(new Set(picked).size).toBe(9);
    for (const seed of picked) expect(SUGGESTED_SEEDS).toContain(seed);
  });
});
