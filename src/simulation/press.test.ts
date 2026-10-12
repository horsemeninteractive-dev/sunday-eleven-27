import { describe, expect, it } from 'vitest';
import { MAX_LIVE_RUMOURS, FILED_KEY_LIMIT, type Rumour } from '@/domain/press';
import { GAME_STATE_VERSION } from '@/domain/game';
import { isPlayer } from '@/domain/person';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays } from './calendar';
import { createEvent, publishEvents } from './news';
import {
  evaluateRumour,
  ensurePress,
  journalistForClub,
  publicationOf,
  respondToRumour,
  runPressDay,
  rumourCandidatesFor,
  storyKey,
} from './press';
import { createTestGame } from './testSupport';

/**
 * The local press, held to its promises.
 *
 * Four things are being pinned, and they are the four that would be easy to get
 * wrong in a way nobody would notice for a season:
 *
 *   - **who is there** — a small, stable cast, every club on somebody's patch,
 *     and the same cast after a save is written and read back;
 *   - **what gets covered** — a name on the stories a paper would run, and no
 *     name on the ones nobody wrote;
 *   - **what is printed once** — the same afternoon handed to the pipeline twice
 *     produces one story, because a reprocessed calendar is a real thing;
 *   - **what is only claimed** — a rumour built from a fact the game already
 *     keeps, settled by comparing the world against that fact, and never turning
 *     itself into the truth.
 */

/** A day of press work, dated the way the day loop dates it. */
function pressDay(state: ReturnType<typeof createTestGame>['state'], date: string) {
  state.date = date;
  const events = runPressDay(state, date);
  publishEvents(state, events);
  return events;
}

describe('who writes about the county', () => {
  it('gives a county a handful of papers and puts every club on exactly one patch', () => {
    const { state } = createTestGame('press-beats');
    const press = ensurePress(state);

    // A county of clubs is covered by a few papers, not one per club.
    expect(press.publications.length).toBeGreaterThanOrEqual(3);
    expect(press.publications.length).toBeLessThanOrEqual(5);
    expect(press.journalists).toHaveLength(press.publications.length);

    // The partition: every club has a reporter, and no club has two.
    const active = Object.values(state.clubs).filter((club) => club.active);
    const assignments = press.journalists.flatMap((journalist) => journalist.beats);
    expect(new Set(assignments).size).toBe(assignments.length);
    for (const club of active) {
      expect(assignments).toContain(club.id);
    }
  });

  it('hands a club to the reporter who is nearest to it, not to whoever was picked first', () => {
    const { state } = createTestGame('press-nearest');
    const press = ensurePress(state);

    for (const club of Object.values(state.clubs)) {
      if (!club.active) continue;
      const home = state.world.towns[club.townId]!;
      const journalist = journalistForClub(state, club.id)!;
      const mine = state.world.towns[journalist.townId]!;
      const distance = Math.hypot(mine.x - home.x, mine.y - home.y);
      for (const other of press.journalists) {
        const town = state.world.towns[other.townId]!;
        expect(distance).toBeLessThanOrEqual(Math.hypot(town.x - home.x, town.y - home.y) + 1e-9);
      }
    }
  });

  it('keeps the same papers, reporters and patches across a save and a load', () => {
    const { state } = createTestGame('press-identity');
    ensurePress(state);
    const signature = (game: typeof state) =>
      game.press.journalists.map((journalist) => [
        journalist.id,
        journalist.firstName,
        journalist.surname,
        journalist.publicationId,
        journalist.focus,
        [...journalist.beats].sort().join(','),
      ]);

    const before = signature(state);
    const restored = deserialiseGame(serialiseGame(state)).state!;

    expect(restored.version).toBe(GAME_STATE_VERSION);
    expect(signature(restored)).toEqual(before);
    expect(restored.press.publications.map((publication) => publication.name)).toEqual(
      state.press.publications.map((publication) => publication.name),
    );
  });

  it('generates the same press for the same world, so a career and its own re-run agree', () => {
    const first = createTestGame('press-determinism');
    const second = createTestGame('press-determinism');
    const describePress = ({ state }: ReturnType<typeof createTestGame>) =>
      state.press.journalists.map((journalist) => `${journalist.firstName} ${journalist.surname}@${journalist.publicationId}`);

    expect(describePress(first)).toEqual(describePress(second));
  });
});

describe('what a paper bothers with', () => {
  it('files a story about a club with the name of the reporter whose patch it is, and keeps the facts it was given', () => {
    const { state } = createTestGame('press-byline');
    const clubId = state.userClubId;
    const event = createEvent(state, {
      type: 'match-result',
      importance: 2,
      clubIds: [clubId],
      personIds: [],
      data: { homeClub: 'A', awayClub: 'B', homeGoals: 2, awayGoals: 1, verdict: 'A win.', venue: 'The Rec', scorers: 'Kev', attendance: 40 },
    });
    const [item] = publishEvents(state, [event]);
    const journalist = journalistForClub(state, clubId)!;
    const publication = publicationOf(state, journalist)!;

    expect(item!.outlet).toBe(publication.name);
    expect(item!.byline).toBe(`${journalist.firstName} ${journalist.surname}`);
    expect(item!.journalistId).toBe(journalist.id);
    // A report of something that happened is not a claim: nothing was unsettled.
    expect(item!.confidence).toBe('confirmed');
    // And the participants are the event's own, not the reporter's.
    expect(item!.clubIds).toEqual([clubId]);
    expect(item!.matchId).toBeNull();
  });

  it('leaves a routine club matter to the club, with no masthead on it', () => {
    const { state } = createTestGame('press-brief');
    const event = createEvent(state, {
      type: 'training',
      importance: 1,
      clubIds: [state.userClubId],
      data: { headline: 'Thursday night', body: 'Eleven turned up and it rained.' },
    });
    const [item] = publishEvents(state, [event]);

    // A Thursday night is the manager's own knowledge. It is still a story in
    // the feed; it simply has nobody's name on it.
    expect(item!.outlet).toBeUndefined();
    expect(item!.byline).toBeUndefined();
    expect(item!.confidence).toBeUndefined();
    expect(state.news.some((candidate) => candidate.id === item!.id)).toBe(true);
  });

  it('gives an ordinary matter a name when it is that reporter’s sort of thing, and not otherwise', () => {
    const { state } = createTestGame('press-focus');
    const press = ensurePress(state);
    // The second paper in the county is the one whose reporter follows the books.
    const moneyReporter = press.journalists.find((journalist) => journalist.focus === 'money')!;
    const clubId = moneyReporter.beats[0]!;

    const result = (importance: 1 | 2, homeGoals: number) =>
      publishEvents(state, [
        createEvent(state, {
          type: 'match-result',
          importance,
          clubIds: [clubId],
          data: { homeClub: 'A', awayClub: 'B', homeGoals, awayGoals: 0, verdict: '', venue: '', scorers: '', attendance: 30 },
        }),
      ])[0]!;

    // At two, it is his patch and it is his to cover.
    expect(result(2, 1).byline).toBeDefined();
    // At one, a result is not his sort of thing, and nobody else is on that patch.
    expect(result(1, 2).byline).toBeUndefined();

    const finances = publishEvents(state, [
      createEvent(state, {
        type: 'finances-positive',
        importance: 1,
        clubIds: [clubId],
        data: { club: 'B', balance: 100, amount: 100 },
      }),
    ])[0]!;
    expect(finances.byline).toBe(`${moneyReporter.firstName} ${moneyReporter.surname}`);
  });
});

describe('a story is printed once', () => {
  it('prints the same afternoon once however many times its facts arrive', () => {
    const { state } = createTestGame('press-once');
    const facts = {
      type: 'finances-warning' as const,
      importance: 2 as const,
      clubIds: [state.userClubId],
      data: { club: 'Us', balance: -10.5 },
    };
    const first = createEvent(state, facts);
    const again = createEvent(state, facts);

    // Different events — the id is handed out fresh every time — and the same
    // story, which is the whole reason the key is built from the facts.
    expect(first.id).not.toBe(again.id);
    expect(storyKey(first)).toBe(storyKey(again));

    publishEvents(state, [first]);
    publishEvents(state, [again]);
    const printed = state.news.filter((item) => item.eventId === first.id || item.eventId === again.id);
    expect(printed).toHaveLength(1);

    // And a genuinely different story still prints: the guard is about repeats,
    // not about the kind of thing.
    publishEvents(state, [createEvent(state, { ...facts, data: { club: 'Us', balance: -40.25 } })]);
    expect(state.news.filter((item) => item.eventType === 'finances-warning')).toHaveLength(2);
  });

  it('forgets its oldest keys rather than growing for ever', () => {
    const { state } = createTestGame('press-ring');
    const events = Array.from({ length: FILED_KEY_LIMIT + 120 }, (_unused, index) =>
      createEvent(state, {
        type: 'finance' as never,
        importance: 1,
        data: { n: index },
      }),
    );
    publishEvents(state, events);
    expect(state.press.filed.length).toBeLessThanOrEqual(FILED_KEY_LIMIT);
  });
});

describe('what the county only thinks it knows', () => {
  /** A career whose committee is losing patience, so there is something to hear. */
  function underPressure(seed: string) {
    const game = createTestGame(seed);
    game.state.governance.standing = 'pressure';
    return game;
  }

  it('files a claim built from a real fact, with a source, and does not change the world by making it', () => {
    const { state } = underPressure('press-rumour');
    const start = state.date;
    const before = Object.values(state.clubs).map((club) => `${club.id}:${club.managerId ?? ''}:${club.finances.balance}`);
    const managerBefore = state.clubs[state.userClubId]!.managerId;

    // The paper hears something on a day of its own choosing, so the test walks
    // the calendar until it does — the same way the day loop would.
    let filed: Rumour | null = null;
    for (let day = 0; day < 120 && !filed; day++) {
      pressDay(state, addDays(start, day));
      filed = state.press.rumours.find((rumour) => rumour.status === 'unverified') ?? null;
    }

    // Which club it is about is the paper's business; that it is built on a real
    // fact, and attributed, is the game's.
    expect(filed).not.toBeNull();
    const rumour = filed!;
    const club = state.clubs[rumour.clubIds[0]!]!;
    expect(club).toBeDefined();
    switch (rumour.subject) {
      case 'manager':
        expect(rumour.basis).toEqual({ key: 'managerId', value: club.managerId });
        expect(rumour.claim).toContain(club.identity.name);
        break;
      case 'money':
        expect(club.finances.balance).toBeLessThan(0);
        expect(rumour.claim).toContain(club.identity.name);
        break;
      case 'availability':
        expect(rumour.claim).toContain(club.identity.name);
        break;
      case 'transfer': {
        const player = state.people[rumour.personIds[0]!]!;
        expect(rumour.claim).toContain(player.surname);
        break;
      }
    }
    // A claim is a claim: hedged, sourced, and never a certainty.
    expect(rumour.evidence).toBeGreaterThan(0);
    expect(rumour.evidence).toBeLessThan(1);
    expect(rumour.reliability).toBeGreaterThan(0);
    expect(rumour.reliability).toBeLessThanOrEqual(1);
    expect(rumour.resolvesOn > rumour.date).toBe(true);

    const story = state.news.find((item) => item.eventType === 'press-rumour')!;
    expect(story).toBeDefined();
    expect(story.confidence).toBe('unverified');
    expect(story.clubIds).toEqual([club.id]);
    const journalist = state.press.journalists.find((candidate) => candidate.id === rumour.journalistId)!;
    expect(story.outlet).toBe(publicationOf(state, journalist)!.name);
    expect(story.byline).toBe(`${journalist.firstName} ${journalist.surname}`);

    // Nothing about the world moved because it was said out loud: no manager was
    // sacked and no book was balanced by a rumour being filed.
    expect(Object.values(state.clubs).map((candidate) => `${candidate.id}:${candidate.managerId ?? ''}:${candidate.finances.balance}`)).toEqual(before);
    expect(state.clubs[state.userClubId]!.managerId).toBe(managerBefore);
  });

  it('is answered by the world, and is not confirmed by having been said', () => {
    const { state } = createTestGame('press-settle');
    const club = state.clubs[state.userClubId]!;
    const rumour: Rumour = {
      id: 'rumour_test',
      key: 'rumour:manager:test',
      date: state.date,
      subject: 'manager',
      status: 'unverified',
      journalistId: journalistForClub(state, state.userClubId)!.id,
      clubIds: [state.userClubId],
      personIds: club.managerId ? [club.managerId] : [],
      claim: `There is talk at ${club.identity.name} that the manager is on borrowed time.`,
      evidence: 0.6,
      reliability: 0.6,
      resolvesOn: addDays(state.date, 14),
      basis: { key: 'managerId', value: club.managerId ?? '' },
      outcome: null,
      settledOn: null,
    };
    state.press.rumours = [rumour];

    // Nothing happens, and the deadline arrives: the claim was wrong.
    pressDay(state, rumour.resolvesOn);
    expect(rumour.status).toBe('disproved');
    expect(rumour.outcome).toContain('stuck with him');
    const verdict = state.news.find((item) => item.eventType === 'press-verdict' && item.confidence === 'disproved');
    expect(verdict).toBeDefined();

    // The same claim in a world where the committee did act is confirmed — and
    // the world was changed by the committee, never by the claim.
    const second = createTestGame('press-settle');
    const secondClub = second.state.clubs[second.state.userClubId]!;
    const otherManager = Object.values(second.state.people).find(
      (person) => person.kind === 'official' && person.id !== secondClub.managerId,
    )!.id;
    second.state.press.rumours = [
      {
        ...rumour,
        id: 'rumour_test_2',
        clubIds: [second.state.userClubId],
        basis: { key: 'managerId', value: secondClub.managerId ?? '' },
        // The first claim's fate is its own: the copy starts unanswered.
        status: 'unverified',
        outcome: null,
        settledOn: null,
      },
    ];
    secondClub.managerId = otherManager;
    pressDay(second.state, rumour.resolvesOn);
    expect(second.state.press.rumours[0]!.status).toBe('confirmed');
    expect(
      second.state.news.some((item) => item.eventType === 'press-verdict' && item.confidence === 'confirmed'),
    ).toBe(true);
  });

  it('reads the books and the team sheet for the claims that are about them', () => {
    const { state } = createTestGame('press-books');
    const club = state.clubs[state.userClubId]!;
    const deadline = addDays(state.date, 21);

    const money: Rumour = {
      id: 'r_money',
      key: 'k',
      date: state.date,
      subject: 'money',
      status: 'unverified',
      journalistId: journalistForClub(state, state.userClubId)!.id,
      clubIds: [state.userClubId],
      personIds: [],
      claim: 'The books are in a state.',
      evidence: 0.6,
      reliability: 0.6,
      resolvesOn: deadline,
      basis: { key: 'inRed', value: 'yes' },
      outcome: null,
      settledOn: null,
    };

    // Before the deadline nothing is decided, however bad the books look.
    expect(evaluateRumour(state, money, false).status).toBe('pending');
    club.finances.balance = -120;
    expect(evaluateRumour(state, money, true).status).toBe('confirmed');
    club.finances.balance = 40;
    expect(evaluateRumour(state, money, true).status).toBe('disproved');

    const numbers: Rumour = { ...money, id: 'r_numbers', subject: 'availability' };
    const squad = club.squadIds.map((id) => state.people[id]!).filter((person) => person.kind === 'player');
    for (const player of squad.slice(0, 3)) {
      player.availability = { status: 'unavailable', reason: 'work', note: '', until: null, discoveredLate: false };
    }
    expect(evaluateRumour(state, numbers, true).status).toBe('confirmed');
    for (const player of squad) {
      player.availability = { status: 'available', reason: null, note: '', until: null, discoveredLate: false };
      player.injury = null;
    }
    expect(evaluateRumour(state, numbers, true).status).toBe('disproved');
  });

  it('only ever claims things the game already keeps, and never a hidden one', () => {
    const { state } = createTestGame('press-candidates');
    const candidates = rumourCandidatesFor(state, state.date);
    expect(candidates.length).toBeGreaterThan(0);

    for (const candidate of candidates) {
      const club = state.clubs[candidate.clubId]!;
      switch (candidate.subject) {
        case 'manager':
          expect(candidate.basis).toEqual({ key: 'managerId', value: club.managerId });
          break;
        case 'money':
          expect(club.finances.balance).toBeLessThan(0);
          break;
        case 'availability':
          expect(candidate.basis.value).toBe('three-or-more');
          break;
        case 'transfer': {
          const player = state.people[candidate.personId!]!;
          if (!isPlayer(player)) throw new Error('a transfer claim must name a player');
          // A centre-forward everybody has noticed, judged on the goals he has
          // actually scored this season: nothing about what he might do next.
          const goals = player.record.seasons.reduce(
            (total, season) => (season.seasonLabel === state.season.label ? total + season.goals : total),
            0,
          );
          expect(goals).toBeGreaterThanOrEqual(5);
          break;
        }
      }
    }
  });

  it('settles a claim early when the world answers it early, and once only', () => {
    const { state } = createTestGame('press-early');
    const club = state.clubs[state.userClubId]!;
    const start = state.date;
    const rumour: Rumour = {
      id: 'r_early',
      key: 'k',
      date: state.date,
      subject: 'manager',
      status: 'unverified',
      journalistId: journalistForClub(state, state.userClubId)!.id,
      clubIds: [state.userClubId],
      personIds: [],
      claim: 'The manager is on borrowed time.',
      evidence: 0.6,
      reliability: 0.6,
      resolvesOn: addDays(state.date, 14),
      basis: { key: 'managerId', value: club.managerId ?? '' },
      outcome: null,
      settledOn: null,
    };
    state.press.rumours = [rumour];

    // Days pass and nothing happens: the claim is not answered by being repeated.
    pressDay(state, start);
    expect(rumour.status).toBe('unverified');

    // The world answers it on the day it answers it, not on the day the reporter
    // guessed it might.
    const answeredOn = addDays(start, 3);
    club.managerId = null;
    pressDay(state, answeredOn);
    expect(rumour.status).toBe('confirmed');
    expect(rumour.settledOn).toBe(answeredOn);

    // A claim is answered once: later days do not file a second verdict.
    const printedBefore = state.news.filter((item) => item.eventType === 'press-verdict').length;
    pressDay(state, addDays(start, 5));
    expect(state.news.filter((item) => item.eventType === 'press-verdict').length).toBe(printedBefore);
  });
});

describe('answering the paper', () => {
  function filedClaim(seed: string) {
    const { state } = createTestGame(seed);
    state.governance.standing = 'pressure';
    const club = state.clubs[state.userClubId]!;
    const journalist = journalistForClub(state, state.userClubId)!;
    const rumour: Rumour = {
      id: 'r_answer',
      key: 'k',
      date: state.date,
      subject: 'manager',
      status: 'unverified',
      journalistId: journalist.id,
      clubIds: [state.userClubId],
      personIds: [],
      claim: `There is talk at ${club.identity.name} that the manager is on borrowed time.`,
      evidence: 0.6,
      reliability: 0.6,
      resolvesOn: addDays(state.date, 14),
      basis: { key: 'managerId', value: club.managerId ?? '' },
      outcome: null,
      settledOn: null,
    };
    state.press.rumours = [rumour];
    return { state, rumour, journalist, club };
  }

  it('records what the manager said, moves his standing with the reporter, and says so in the paper', () => {
    const { state, rumour, journalist, club } = filedClaim('press-answer');
    const regardBefore = journalist.regard;
    const confidenceBefore = club.supporters.confidence;

    const answered = respondToRumour(state, rumour.id, 'declined')!;
    expect(answered).not.toBeNull();
    expect(journalist.regard).toBe(regardBefore - 6);
    // A denial steadies a crowd a little, and only a little.
    expect(club.supporters.confidence).toBeGreaterThan(confidenceBefore);
    expect(club.supporters.confidence - confidenceBefore).toBeLessThanOrEqual(2);

    publishEvents(state, answered.events);
    const printed = state.news.find((item) => item.eventType === 'club-news')!;
    expect(printed.headline).toContain(club.identity.shortName);
    expect(printed.body).toContain(journalist.firstName);

    // One answer per claim: the manager does not get to deny the same thing twice.
    expect(respondToRumour(state, rumour.id, 'declined')).toBeNull();

    // And a denial of something that then happened is remembered: the reporter
    // who was told he was wrong comes back to it when the world proves he was not.
    const club2 = state.clubs[state.userClubId]!;
    club2.managerId = null;
    pressDay(state, rumour.resolvesOn);
    expect(rumour.status).toBe('confirmed');
    expect(journalist.regard).toBe(regardBefore - 14);
    const verdict = state.news.find((item) => item.eventType === 'press-verdict')!;
    expect(verdict.body).toContain('played the story down');
  });

  it('cannot answer a claim about somebody else’s club', () => {
    const { state, rumour } = filedClaim('press-answer-other');
    const other = Object.values(state.clubs).find((club) => club.id !== state.userClubId && club.active)!;
    state.press.rumours = [{ ...rumour, clubIds: [other.id] }];
    expect(respondToRumour(state, rumour.id, 'acknowledged')).toBeNull();
  });
});

describe('a season of the local paper', () => {
  it('does not fill up, does not go quiet, and files the same stories from the same seed', () => {
    const run = (seed: string) => {
      const { state } = createTestGame(seed);
      state.governance.standing = 'pressure';
      const filed: string[] = [];
      const start = state.date;
      let aboutUs = 0;
      for (let day = 0; day < 200; day++) {
        const events = pressDay(state, addDays(start, day));
        for (const event of events) {
          filed.push(`${event.type}:${String(event.data.headline ?? '')}`);
          if (event.type === 'press-rumour' && event.clubIds.includes(state.userClubId)) aboutUs += 1;
        }
      }
      return { state, filed, aboutUs };
    };

    const first = run('press-season');
    const { state } = first;

    // Somebody hears something in 200 days, and hears it a few times rather than
    // every day: a paper, not a feed.
    expect(first.filed.length).toBeGreaterThan(1);
    expect(first.filed.length).toBeLessThan(45);
    // The rate that actually matters is the manager's own: a couple of seasons of
    // hearing about his own club, not a bulletin a week.
    expect(first.aboutUs).toBeLessThanOrEqual(6);
    expect(first.aboutUs).toBeGreaterThanOrEqual(0);

    // The record stays small in both directions.
    expect(state.press.rumours.filter((rumour) => rumour.status === 'unverified').length).toBeLessThanOrEqual(
      MAX_LIVE_RUMOURS + 2,
    );
    expect(state.press.rumours.length).toBeLessThanOrEqual(MAX_LIVE_RUMOURS + 10);
    expect(state.press.filed.length).toBeLessThanOrEqual(FILED_KEY_LIMIT);
    // And every claim it has left is either live or answered — never half-settled.
    for (const rumour of state.press.rumours) {
      if (rumour.status !== 'unverified') expect(rumour.settledOn).not.toBeNull();
    }

    // The same world, run again, hears the same things: the press is simulation,
    // not decoration.
    const second = run('press-season');
    expect(second.filed).toEqual(first.filed);
  });
});

describe('a career written before the county had a press', () => {
  it('wakes up with the press of its own world, a crowd for every club, and its rivalries intact', () => {
    const { state } = createTestGame('press-migration');
    const rivalries = Object.values(state.clubs)
      .flatMap((club) => Object.values(club.rivalries))
      .map((rivalry) => rivalry.intensity);
    expect(rivalries.length).toBeGreaterThan(0);

    // A save as it was written before any of this existed.
    const legacy = JSON.parse(serialiseGame(state)) as {
      version: number;
      savedAt: string;
      state: Record<string, unknown>;
    };
    legacy.version = 19;
    delete legacy.state.press;
    for (const club of Object.values(state.clubs)) {
      delete (club as { supporters?: unknown }).supporters;
      for (const rivalry of Object.values(club.rivalries)) {
        delete rivalry.baseline;
        delete rivalry.kind;
        delete rivalry.heat;
      }
    }
    const raw = JSON.stringify({ ...legacy, state: { ...legacy.state, clubs: state.clubs } });

    const { state: migrated, error } = deserialiseGame(raw);
    expect(error).toBeNull();
    expect(migrated!.version).toBe(GAME_STATE_VERSION);

    // The press of its own world, generated from its own seed.
    expect(migrated!.press.publications.length).toBeGreaterThanOrEqual(3);
    expect(migrated!.press.journalists.length).toBe(migrated!.press.publications.length);
    expect(migrated!.press.rumours).toEqual([]);
    expect(migrated!.press.filed).toEqual([]);

    // A crowd it did not have: no opinion, because none was invented for it.
    for (const club of Object.values(migrated!.clubs)) {
      expect(club.supporters.confidence).toBe(50);
    }

    // And the rivalries it already had, kept exactly — read as the part of them
    // that does not cool rather than re-guessed.
    const after = Object.values(migrated!.clubs).flatMap((club) => Object.values(club.rivalries));
    expect(after.map((rivalry) => rivalry.intensity).sort((a, b) => a - b)).toEqual([...rivalries].sort((a, b) => a - b));
    for (const rivalry of after) {
      expect(rivalry.baseline).toBe(rivalry.intensity);
      expect(rivalry.heat).toBe(0);
    }
  });
});
