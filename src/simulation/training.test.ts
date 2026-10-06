import { describe, expect, it } from 'vitest';
import { emptyKnowledge } from '@/domain/recruitment';
import { isPlayer, type Player } from '@/domain/person';
import { defaultTactics } from '@/domain/tactics';
import {
  TRAINING_LENGTH_MINUTES,
  TRAINING_SESSION_HISTORY_PER_CLUB,
  blockCapacity,
  sessionBlockMinutes,
  type TrainingBlockId,
} from '@/domain/training';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays, dayOfWeek } from './calendar';
import { advanceWeek } from './progression';
import { addCandidate, recruitmentStore } from './recruitment/store';
import { relationshipStore } from './relationships';
import { clubCohesionValue } from './training/cohesion';
import { developmentFor, lastSessionFor, sessionsFor, trainingStore } from './training/store';
import { overallAbility, applyDecline } from './training/development';
import { leagueClubIds } from './pyramid';
import {
  currentPlan,
  currentSessionKey,
  expectedAttendance,
  sessionDateFor,
  sessionDatesFor,
  sessionKeyFor,
  validatePlan,
} from './training/plan';
import { currentAttention } from './day';
import { conductTraining, ensureClubTrained, ensureTrainingConducted } from './training/session';
import { createTestGame, type TestGame } from './testSupport';
import { nextMatchday, weekStartOf } from '@/simulation/timeline';

function clubOf(game: TestGame) {
  return game.state.clubs[game.state.userClubId]!;
}

function squadOf(game: TestGame): Player[] {
  return clubOf(game)
    .squadIds.map((id) => game.state.people[id])
    .filter(isPlayer);
}

function planFor(game: TestGame, blocks: TrainingBlockId[]) {
  const plan = currentPlan(game.state, game.state.userClubId);
  plan.blocks = [...blocks];
  return plan;
}

/** Nobody can train: every player is out for the week. */
function makeEveryoneUnavailable(game: TestGame): void {
  for (const player of squadOf(game)) {
    player.availability = {
      status: 'unavailable',
      reason: 'work',
      note: 'On shift all week',
      until: null,
      discoveredLate: false,
    };
  }
}

function attributeSnapshot(players: readonly Player[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const player of players) {
    for (const [group, bucket] of Object.entries(player.attributes)) {
      for (const [key, value] of Object.entries(bucket as unknown as Record<string, number>)) {
        map.set(`${player.id}.${group}.${key}`, value);
      }
    }
  }
  return map;
}

describe('planning a session', () => {
  it('starts with a sensible routine the manager can change, and checks it', () => {
    const game = createTestGame('training-plan');
    const plan = currentPlan(game.state, game.state.userClubId);

    expect(plan.blocks).toContain('warm-up');
    expect(plan.blocks.length).toBeLessThanOrEqual(blockCapacity(plan.length));
    expect(validatePlan(plan).filter((problem) => problem.severity === 'error')).toHaveLength(0);

    // Too much for the time available.
    const overloaded = { ...plan, length: 'short' as const, blocks: ['warm-up', 'possession', 'attacking', 'fitness'] as TrainingBlockId[] };
    expect(validatePlan(overloaded).some((problem) => problem.severity === 'error')).toBe(true);

    // The same block twice is a mistake, not a preference.
    const doubled = { ...plan, blocks: ['warm-up', 'warm-up', 'possession'] as TrainingBlockId[] };
    expect(validatePlan(doubled).some((problem) => problem.severity === 'error')).toBe(true);

    // No warm-up is allowed — it is just a bad idea, and the game says so.
    const cold = { ...plan, blocks: ['possession', 'tactical'] as TrainingBlockId[] };
    expect(validatePlan(cold).some((problem) => problem.severity === 'warning')).toBe(true);

    // Empty is not a session.
    expect(validatePlan({ ...plan, blocks: [] }).some((problem) => problem.severity === 'error')).toBe(true);
  });

  it('turns the chosen length into minutes on the grass', () => {
    expect(sessionBlockMinutes(['warm-up', 'fitness'], 120).get('fitness')).toBeGreaterThan(50);

    // The same world twice, so the only difference between the two nights is
    // the plan: two clubs' worth of squad would otherwise be being compared.
    const short = createTestGame('training-length');
    planFor(short, ['warm-up', 'possession', 'tactical']);
    currentPlan(short.state, short.state.userClubId).length = 'short';
    const shortSession = conductTraining(short.state, short.state.userClubId, 1).session!;

    const long = createTestGame('training-length');
    planFor(long, ['warm-up', 'possession', 'tactical', 'fitness', 'teamwork']);
    currentPlan(long.state, long.state.userClubId).length = 'long';
    const longSession = conductTraining(long.state, long.state.userClubId, 1).session!;

    expect(shortSession.minutes).toBe(TRAINING_LENGTH_MINUTES.short);
    expect(longSession.minutes).toBe(TRAINING_LENGTH_MINUTES.long);
    expect(longSession.minutes).toBeGreaterThan(shortSession.minutes);

    // More work in the long session, and more tired legs to show for it.
    const shortFitness = squadOf(short).reduce((sum, player) => sum + player.fitness, 0);
    const longFitness = squadOf(long).reduce((sum, player) => sum + player.fitness, 0);
    expect(longFitness).toBeLessThan(shortFitness);
  });

  it('is held midweek, before the game it is preparing for', () => {
    const game = createTestGame('training-date');
    const matchdayDate = game.state.season.calendar[0]!.date;
    const sessionDate = sessionDateFor(game.state, 1);
    expect(sessionDate < matchdayDate).toBe(true);
    expect(sessionDate).toBe('2026-09-03');
  });

  it('trains on every Thursday, and never twice in a week', () => {
    // The club's week is anchored to the Thursday, not to "three days before
    // the next game". A midweek cup tie used to drag a session onto the Sunday
    // morning, so a week trained twice — and the Thursday after a cup tie could
    // read as already done before it had happened.
    const game = createTestGame('training-thursdays');
    const dates = sessionDatesFor(game.state);
    expect(dates.length).toBeGreaterThan(1);
    expect(dates.every((date) => dayOfWeek(date) === 4)).toBe(true);
    // Exactly one session per week, Christmas break aside.
    const weeks = new Set(dates.map((date) => weekStartOf(date)));
    expect(weeks.size).toBe(dates.length);
  });
});

describe('pre-season weeks', () => {
  it('gives every pre-season Thursday its own key rather than matchday one', () => {
    const game = createTestGame('training-preseason-keys');
    const opening = game.state.season.calendar[0]!.date;
    // Everything strictly before the session that leads into matchday one: the
    // weeks of pre-season proper.
    const before = sessionDatesFor(game.state).filter((date) => date < addDays(opening, -3));

    // A pre-season is several weeks of Thursdays; collapsing them all onto
    // matchday one is what made the second week read as already done.
    expect(before.length).toBeGreaterThan(1);
    const keys = before.map((date) => sessionKeyFor(game.state, date));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key < 0)).toBe(true);
  });

  it('runs the session the manager is standing on, and asks again the next week', () => {
    const game = createTestGame('training-preseason-run');
    const state = game.state;
    const first = sessionDatesFor(state)[0]!;

    // Standing on the first pre-season Thursday, the session is waiting.
    state.date = first;
    expect(currentAttention(state)?.kind).toBe('flagged');
    expect(currentSessionKey(state)).toBe(sessionKeyFor(state, first));

    // Running it — what the header's "Run the session" does — uses that week's
    // key, dates the session on the night, and clears the prompt.
    const outcome = ensureClubTrained(state, state.userClubId, currentSessionKey(state));
    expect(outcome.session?.date).toBe(first);
    expect(currentAttention(state)).toBeNull();

    // The following Thursday is a fresh session, not "already run this week".
    const second = sessionDatesFor(state)[1]!;
    state.date = second;
    expect(currentSessionKey(state)).toBe(sessionKeyFor(state, second));
    expect(currentAttention(state)?.kind).toBe('flagged');
    expect(ensureClubTrained(state, state.userClubId, currentSessionKey(state)).session).not.toBeNull();
    expect(currentAttention(state)).toBeNull();
  });
});

describe('attendance', () => {
  it('cannot include somebody who is unavailable, and does include the rest', () => {
    const game = createTestGame('training-attendance');
    const squad = squadOf(game);
    const out = squad[0]!;
    const doubtful = squad[1]!;
    out.availability = { status: 'unavailable', reason: 'work', note: 'On shift Sunday morning', until: null, discoveredLate: false };
    doubtful.availability = { status: 'doubtful', reason: 'illness', note: 'Under the weather', until: null, discoveredLate: false };

    const session = conductTraining(game.state, game.state.userClubId, 1).session!;
    const entryFor = (id: string) => session.attendance.find((entry) => entry.personId === id)!;

    expect(entryFor(out.id).status).toBe('absent');
    expect(entryFor(out.id).reason).toContain('shift');
    expect(['doubtful', 'absent']).toContain(entryFor(doubtful.id).status);
    expect(session.attendance.some((entry) => entry.status === 'attending')).toBe(true);
    expect(session.attended).toBe(session.attendance.filter((entry) => entry.status === 'attending').length);
    expect(session.attended).toBeLessThan(squad.length);
  });

  it('expects roughly the same people the availability of the squad suggests', () => {
    const game = createTestGame('training-expected');
    const expectation = expectedAttendance(game.state, game.state.userClubId);
    const availability = squadOf(game).filter((player) => player.availability.status !== 'unavailable');
    expect(expectation.attending.length + expectation.doubtful.length).toBeGreaterThan(0);
    expect(expectation.attending.length).toBeLessThanOrEqual(availability.length);
    expect(expectation.ratio).toBeGreaterThan(0);
    expect(expectation.ratio).toBeLessThanOrEqual(1);
  });

  it('makes a thin night a worse night', () => {
    // A night is judged on who came, but any single evening carries a few
    // points of noise either way — so the judgement is checked over a summer of
    // Thursdays rather than on one of them.
    let judgedWorse = 0;
    for (let i = 0; i < 6; i += 1) {
      const full = createTestGame(`training-thin-${i}`);
      const thin = createTestGame(`training-thin-${i}`);
      let handedOut = 0;
      for (const player of squadOf(thin)) {
        if (handedOut >= 11) break;
        player.availability = { status: 'unavailable', reason: 'work', note: 'On shift', until: null, discoveredLate: false };
        handedOut += 1;
      }

      const fullSession = conductTraining(full.state, full.state.userClubId, 1).session!;
      const thinSession = conductTraining(thin.state, thin.state.userClubId, 1).session!;
      // A night called off for a waterlogged pitch is not a thin night, it is
      // no night — nobody attended either session, so it says nothing about who
      // turns up and is not counted.
      if (fullSession.cancelled || thinSession.cancelled) continue;
      expect(thinSession.attended).toBeLessThan(fullSession.attended);
      if (thinSession.quality < fullSession.quality) judgedWorse += 1;
    }
    expect(judgedWorse).toBeGreaterThanOrEqual(4);
  });

  it('rusts the knowledge of the lads who did not turn up', () => {
    const game = createTestGame('training-rust');
    const squad = squadOf(game);
    const absent = squad[0]!;
    absent.availability = { status: 'unavailable', reason: 'work', note: 'On shift', until: null, discoveredLate: false };
    const before = new Map(squad.map((player) => [player.id, player.systemFamiliarity!.formation]));

    conductTraining(game.state, game.state.userClubId, 1);

    expect(absent.systemFamiliarity!.formation).toBeLessThan(before.get(absent.id)!);
    const trainer = squad.find((player) => player.id !== absent.id && player.availability.status === 'available')!;
    if (sessionAttendanceIds(game).includes(trainer.id)) {
      expect(trainer.systemFamiliarity!.formation).toBeGreaterThan(before.get(trainer.id)!);
    }
  });

  it('cannot be run twice for the same matchday', () => {
    const game = createTestGame('training-once');
    const first = conductTraining(game.state, game.state.userClubId, 1);
    const second = conductTraining(game.state, game.state.userClubId, 1);
    expect(first.session).toBeTruthy();
    expect(second.session).toBeNull();
    expect(sessionsFor(game.state, game.state.userClubId).filter((session) => session.matchday === 1)).toHaveLength(1);
  });

  it('runs for every club in the division, not just the club the manager runs', () => {
    const game = createTestGame('training-world');
    const division = Object.values(game.state.competitions)[0]!.clubIds;
    ensureTrainingConducted(game.state, 1);
    for (const clubId of division) {
      expect(sessionsFor(game.state, clubId)[0]?.matchday).toBe(1);
    }
  });
});

function sessionAttendanceIds(game: TestGame): string[] {
  const session = lastSessionFor(game.state, game.state.userClubId);
  return session ? session.attendance.filter((entry) => entry.status === 'attending').map((entry) => entry.personId) : [];
}

describe('what the session does to the squad', () => {
  it('tires the legs and lifts nobody to superhuman fitness', () => {
    const game = createTestGame('training-fatigue');
    const squad = squadOf(game);
    const before = new Map(squad.map((player) => [player.id, player.fitness]));
    const session = conductTraining(game.state, game.state.userClubId, 1).session!;

    const attendees = session.attendance.filter((entry) => entry.status === 'attending').map((entry) => entry.personId);
    const tired = attendees.filter((id) => (game.state.people[id] as Player).fitness < before.get(id)!);
    expect(tired.length).toBeGreaterThan(attendees.length * 0.6);
    for (const player of squad) {
      expect(player.fitness).toBeLessThanOrEqual(100);
      expect(player.fitness).toBeGreaterThanOrEqual(20);
    }
  });

  it('makes a hard session that bit harder on the legs', () => {
    // Again: an evening's work is the plan plus the noise, so the direction is
    // checked across several of them.
    const meanFitness = (game: TestGame) =>
      squadOf(game).reduce((sum, player) => sum + player.fitness, 0) / squadOf(game).length;
    let heavier = 0;
    for (let i = 0; i < 6; i += 1) {
      const light = createTestGame(`training-load-${i}`);
      planFor(light, ['warm-up', 'set-pieces', 'teamwork']);
      const lightSession = conductTraining(light.state, light.state.userClubId, 1).session!;

      const heavy = createTestGame(`training-load-${i}`);
      planFor(heavy, ['warm-up', 'fitness', 'defending', 'teamwork', 'fitness' as TrainingBlockId]);
      currentPlan(heavy.state, heavy.state.userClubId).blocks = ['warm-up', 'fitness', 'defending', 'attacking'];
      currentPlan(heavy.state, heavy.state.userClubId).length = 'long';
      const heavySession = conductTraining(heavy.state, heavy.state.userClubId, 1).session!;

      expect(heavySession.blocks).toContain('fitness');
      expect(lightSession.blocks).not.toContain('fitness');
      if (meanFitness(heavy) < meanFitness(light)) heavier += 1;
    }
    expect(heavier).toBeGreaterThanOrEqual(4);
  });

  it('can produce a knock, but not often', () => {
    const game = createTestGame('training-injuries');
    let injuries = 0;
    let samples = 0;
    for (let i = 0; i < 25; i++) {
      const sample = structuredClone(game.state);
      sample.seed = `training-injuries-${i}`;
      const session = conductTraining(sample, sample.userClubId, 1).session;
      if (!session) continue;
      samples += 1;
      injuries += session.injuredIds.length;
    }
    const perSession = injuries / Math.max(1, samples);
    expect(injuries).toBeGreaterThan(0);
    expect(perSession).toBeLessThan(2.5);
  });
});

describe('development', () => {
  it('banks the work done in the block that was run, and not in the others', () => {
    const game = createTestGame('training-development-blocks');
    planFor(game, ['warm-up', 'fitness']);
    const session = conductTraining(game.state, game.state.userClubId, 1).session!;

    const attendee = session.attendance.find((entry) => entry.status === 'attending')!;
    const banked = developmentFor(game.state, attendee.personId);
    const keys = Object.keys(banked);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith('physical.'))).toBe(true);
  });

  it('does not turn training into an attribute every week', () => {
    // The rate this is testing is deliberately so low that any one seed can show
    // nobody improving over half a season — the roll is a coin toss at the world
    // level, not a property of a single squad. The claim is about the model, so
    // it is measured across several worlds rather than trusting one seed's luck.
    const seeds = [
      'training-development-rate',
      'training-development-rate-b',
      'training-development-rate-c',
      'training-development-rate-d',
    ];
    const sessions: number[] = [];
    let increases = 0;
    for (const seed of seeds) {
      const game = createTestGame(seed);
      const squad = squadOf(game);
      const before = attributeSnapshot(squad);

      // Half a season rather than a fortnight: every player now has his own
      // ceiling, and the older half of a squad is at or near it, so an
      // improvement is worth waiting a few months for rather than ten weeks.
      for (let week = 0; week < 26; week++) {
        const outcome = week === 0
          ? ensureTrainingConducted(game.state, 1)
          : (advanceWeek(game.state), ensureTrainingConducted(game.state, nextMatchday(game.state)));
        sessions.push(outcome.session?.improvements.length ?? 0);
      }

      const after = attributeSnapshot(squad);
      for (const [key, value] of after) {
        const previous = before.get(key);
        if (previous !== undefined && value > previous) increases += 1;
      }
    }

    // Over half a season somebody should have come on a bit...
    expect(increases).toBeGreaterThan(0);
    // ...but the average Thursday does not hand out anything at all.
    const meanPerSession = sessions.reduce((sum, value) => sum + value, 0) / sessions.length;
    // Across a squad of roughly twenty that is fewer than one lad in ten coming
    // on in any given week, which is the scarcity this is protecting.
    expect(meanPerSession).toBeLessThan(2);
  });

  it('stops improving a player who has reached his ceiling', () => {
    const game = createTestGame('training-ceiling');
    const player = squadOf(game)[0]!;

    // A man who is already as good as he is ever going to get has no headroom,
    // so however much he trains he stays exactly where he is.
    player.development = { potential: overallAbility(player), peakAge: player.age };
    const before = player.attributes.physical.pace;
    for (let week = 0; week < 6; week++) {
      advanceWeek(game.state);
      ensureTrainingConducted(game.state, nextMatchday(game.state));
    }
    expect(player.attributes.physical.pace).toBe(before);
  });

  it('takes attributes off a man who is past his peak, and off his legs first', () => {
    const game = createTestGame('training-decline');

    // Age alone does it: no session, no injury, just a man getting older.
    const old = squadOf(game)[0]!;
    old.age = (old.development?.peakAge ?? 27) + 10;
    const paceBefore = old.attributes.physical.pace;
    const decisionsBefore = old.attributes.mental.decisions;
    let physicalDropped = 0;
    let mentalDropped = 0;
    for (let day = 1; day <= 400; day += 1) {
      const date = addDays(game.state.date, day);
      for (const decline of applyDecline(game.state, old, date)) {
        if (decline.attribute.startsWith('physical.')) physicalDropped += 1;
        if (decline.attribute.startsWith('mental.')) mentalDropped += 1;
      }
    }
    expect(physicalDropped).toBeGreaterThan(0);
    expect(old.attributes.physical.pace).toBeLessThan(paceBefore);
    // The legs go long before the know-how does.
    expect(physicalDropped).toBeGreaterThan(mentalDropped);
    expect(old.attributes.mental.decisions).toBeGreaterThanOrEqual(decisionsBefore - 1);

    // A man still at his best loses nothing at all.
    const prime = squadOf(game)[1]!;
    prime.age = Math.max(18, (prime.development?.peakAge ?? 27) - 2);
    const primeBefore = overallAbility(prime);
    for (let day = 1; day <= 400; day += 1) {
      applyDecline(game.state, prime, addDays(game.state.date, day));
    }
    expect(overallAbility(prime)).toBe(primeBefore);
  });

  it('is concentrated in the younger lads', () => {
    const game = createTestGame('training-development-age');
    const squad = squadOf(game);
    const young = squad.filter((player) => player.age <= 22);
    const old = squad.filter((player) => player.age >= 33);
    expect(young.length).toBeGreaterThan(0);
    expect(old.length).toBeGreaterThan(0);

    for (let week = 0; week < 12; week++) {
      if (week > 0) advanceWeek(game.state);
      ensureTrainingConducted(game.state, nextMatchday(game.state));
    }

    const banked = (player: Player) => Object.values(developmentFor(game.state, player.id)).reduce((sum, value) => sum + value, 0);
    const mean = (players: Player[]) => players.reduce((sum, player) => sum + banked(player), 0) / players.length;
    expect(mean(young)).toBeGreaterThan(mean(old));
  });
});

describe('tactical familiarity', () => {
  it('improves with tactical and teamwork work', () => {
    const game = createTestGame('training-familiarity');
    planFor(game, ['warm-up', 'tactical', 'teamwork']);
    const before = squadOf(game).reduce((sum, player) => sum + player.systemFamiliarity!.formation, 0) / squadOf(game).length;

    const session = conductTraining(game.state, game.state.userClubId, 1).session!;
    expect(session.familiarityGain).toBeGreaterThan(0);

    const after = squadOf(game).reduce((sum, player) => sum + player.systemFamiliarity!.formation, 0) / squadOf(game).length;
    expect(after).toBeGreaterThan(before);
  });

  it('is unwound when the manager changes how the team plays', () => {
    const game = createTestGame('training-tactics-change');
    const club = clubOf(game);
    planFor(game, ['warm-up', 'tactical', 'possession', 'teamwork']);
    conductTraining(game.state, game.state.userClubId, 1);
    const afterFirst = squadOf(game).reduce((sum, player) => sum + player.systemFamiliarity!.formation, 0) / squadOf(game).length;

    club.tactics = { ...defaultTactics('3-5-2'), mentality: 'attacking' as const };
    const second = conductTraining(game.state, game.state.userClubId, 2).session!;
    const afterChange = squadOf(game).reduce((sum, player) => sum + player.systemFamiliarity!.formation, 0) / squadOf(game).length;

    expect(afterChange).toBeLessThan(afterFirst);
    expect(second.cancelled).toBe(false);
  });
});

describe('team cohesion', () => {
  it('is derived, bounded, and better in a squad that gets on', () => {
    const game = createTestGame('training-cohesion');
    const squad = squadOf(game);
    const value = clubCohesionValue(game.state, game.state.userClubId);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);

    const happy = structuredClone(game.state);
    const unhappy = structuredClone(game.state);
    for (let i = 0; i < squad.length; i++) {
      for (let j = i + 1; j < squad.length; j++) {
        const a = squad[i]!.id;
        const b = squad[j]!.id;
        addPair(happy, a, b, 92);
        addPair(unhappy, a, b, 8);
      }
    }
    expect(clubCohesionValue(happy, happy.userClubId)).toBeGreaterThan(clubCohesionValue(unhappy, unhappy.userClubId));
  });
});

function addPair(state: TestGame['state'], aId: string, bId: string, strength: number): void {
  const store = relationshipStore(state);
  const existing = store.byId[`rel__${aId <= bId ? aId : bId}__${aId <= bId ? bId : aId}`];
  const attitude = { friendship: strength, trust: strength, respect: strength, tension: Math.max(0, 60 - strength), loyalty: strength };
  if (existing) {
    existing.aToB = { ...attitude };
    existing.bToA = { ...attitude };
    existing.strength = strength;
    return;
  }
  store.byId[`rel__${aId}__${bId}`] = {
    id: `rel__${aId}__${bId}`,
    personAId: aId <= bId ? aId : bId,
    personBId: aId <= bId ? bId : aId,
    origin: 'current-teammates',
    context: 'Test squad',
    aToB: { ...attitude },
    bToA: { ...attitude },
    strength,
    established: state.date,
    lastInteraction: state.date,
    history: [],
    provenance: 'observed',
  };
  store.byPerson[aId] = [...(store.byPerson[aId] ?? []), store.byId[`rel__${aId}__${bId}`]!.id];
  store.byPerson[bId] = [...(store.byPerson[bId] ?? []), store.byId[`rel__${aId}__${bId}`]!.id];
}

describe('the social side of training', () => {
  it('changes relationships when something actually happened, and leaves the rest alone', () => {
    const game = createTestGame('training-social');
    const store = relationshipStore(game.state);
    const before = new Map(Object.values(store.byId).map((relationship) => [relationship.id, relationship.history.length]));

    for (let week = 0; week < 8; week++) {
      advanceWeek(game.state);
    }

    const touched = Object.values(store.byId).filter((relationship) => {
      const previous = before.get(relationship.id) ?? 0;
      if (relationship.history.length <= previous) return false;
      return relationship.history
        .slice(0, relationship.history.length - previous)
        .some((entry) => /afterwards|in front of the rest|showed him the ropes|missed training again/.test(entry.description));
    });

    expect(touched.length).toBeGreaterThan(0);
    const total = Object.values(store.byId).length;
    // Most of the county's relationships have nothing to do with Thursday night.
    expect(touched.length / total).toBeLessThan(0.1);
  });

  it('changes nothing at all when the session never happens', () => {
    const game = createTestGame('training-social-cancelled');
    makeEveryoneUnavailable(game);
    const store = relationshipStore(game.state);
    const before = Object.values(store.byId).map((relationship) => relationship.history.length);

    const outcome = conductTraining(game.state, game.state.userClubId, 1);
    expect(outcome.session?.cancelled).toBe(true);
    expect(Object.values(store.byId).map((relationship) => relationship.history.length)).toEqual(before);
  });
});

describe('cancellation', () => {
  it('calls the session off when nobody can come, and teaches nobody anything', () => {
    const game = createTestGame('training-cancelled');
    makeEveryoneUnavailable(game);
    const outcome = conductTraining(game.state, game.state.userClubId, 1);
    const session = outcome.session!;

    expect(session.cancelled).toBe(true);
    expect(session.cancelReason).toBeTruthy();
    expect(session.attended).toBe(0);
    expect(session.improvements).toHaveLength(0);
    expect(session.familiarityGain).toBe(0);
    expect(outcome.events.some((event) => event.type === 'training')).toBe(true);

    // No work was banked for anybody.
    for (const player of squadOf(game)) {
      expect(Object.values(developmentFor(game.state, player.id)).reduce((sum, value) => sum + value, 0)).toBe(0);
    }
  });
});

describe('trialists', () => {
  it('come down to training and are watched there', () => {
    const game = createTestGame('training-trialist');
    const club = clubOf(game);
    const candidate = Object.values(game.state.people)
      .filter(isPlayer)
      .find((player) => player.clubId !== club.id && player.availability.status !== 'unavailable' && player.age < 34)!;
    candidate.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
    addCandidate(game.state, {
      personId: candidate.id,
      discoveredVia: 'recommendation',
      sourceNote: 'A mate of his said he could do a job.',
      knowledge: emptyKnowledge(),
    });
    recruitmentStore(game.state).pendingTrialIds.push(candidate.id);

    const outcome = conductTraining(game.state, game.state.userClubId, 1);
    const session = outcome.session!;
    const record = recruitmentStore(game.state).candidates[candidate.id]!;

    if (session.trialistIds.includes(candidate.id)) {
      expect(record.trials).toBeGreaterThanOrEqual(1);
      expect(Object.keys(record.knowledge.attributes).length).toBeGreaterThan(0);
      expect(record.history.some((entry) => /training|session/i.test(entry.description))).toBe(true);
      expect(session.observations.some((line) => /Trialist/i.test(line))).toBe(true);
    }
  });
});

describe('training persistence', () => {
  it('keeps the plan, the history, the banked work and the familiarity across a save', () => {
    const game = createTestGame('training-save');
    planFor(game, ['warm-up', 'fitness', 'tactical']);
    conductTraining(game.state, game.state.userClubId, 1);
    advanceWeek(game.state);

    const before = {
      history: trainingStore(game.state).history.length,
      plan: JSON.stringify(trainingStore(game.state).plans[game.state.userClubId]),
      familiarity: Object.fromEntries(
        squadOf(game).map((player) => [player.id, player.systemFamiliarity!.formation]),
      ),
    };

    const raw = serialiseGame(game.state);
    const loaded = deserialiseGame(raw).state!;

    expect(trainingStore(loaded).history.length).toBe(before.history);
    expect(JSON.stringify(trainingStore(loaded).plans[loaded.userClubId])).toBe(before.plan);
    for (const player of loaded.clubs[loaded.userClubId]!.squadIds.map((id) => loaded.people[id]).filter(isPlayer)) {
      expect(player.systemFamiliarity!.formation).toBeCloseTo(before.familiarity[player.id]!, 5);
    }
    // Nothing was run twice on the way back in.
    const matchdays = sessionsFor(loaded, loaded.userClubId).map((session) => session.matchday);
    expect(new Set(matchdays).size).toBe(matchdays.length);
  });

  it('gives an older save a squad that knows the system', () => {
    const game = createTestGame('training-migration');
    const state = game.state as unknown as Record<string, unknown>;
    delete state.training;
    for (const person of Object.values(game.state.people)) {
      if (isPlayer(person)) delete (person as unknown as Record<string, unknown>).systemFamiliarity;
    }

    const raw = serialiseGame(game.state);
    const loaded = deserialiseGame(raw).state!;

    expect(trainingStore(loaded).history).toHaveLength(0);
    for (const person of Object.values(loaded.people)) {
      if (!isPlayer(person)) continue;
      expect(person.systemFamiliarity).toBeTruthy();
      expect(person.systemFamiliarity!.formation).toBeGreaterThan(0);
      expect(person.systemFamiliarity!.formation).toBeLessThanOrEqual(20);
    }
    const session = conductTraining(loaded, loaded.userClubId, 1).session!;
    expect(session.cancelled).toBe(false);
  });
});

describe('training in the weekly loop', () => {
  it('happens before the match, and only once a week', () => {
    const game = createTestGame('training-week');
    const first = advanceWeek(game.state);
    const userSession = sessionsFor(game.state, game.state.userClubId).find((session) => session.matchday === 1);
    expect(userSession).toBeTruthy();
    expect(first.events.some((event) => event.type === 'training')).toBe(true);
    expect(game.state.news.some((item) => item.category === 'Squad' && /training|turn(ed)? up|session/i.test(item.body))).toBe(true);

    // The matchday that has just been played has its own session, and no more.
    expect(sessionsFor(game.state, game.state.userClubId).filter((session) => session.matchday === 1)).toHaveLength(1);
    // The upcoming matchday has not been trained for yet.
    expect(sessionsFor(game.state, game.state.userClubId).some((session) => session.matchday === 2)).toBe(false);
  });

  it('leaves the world in a state the next week can build on', () => {
    const game = createTestGame('training-season');
    for (let week = 0; week < 6; week++) advanceWeek(game.state);
    const store = trainingStore(game.state);
    // Every club in the pyramid trains, not just the first division's: the
    // whole county plays on Thursday.
    const division = leagueClubIds(game.state);
    expect(store.history.length).toBeGreaterThan(0);
    // A short recent history per club, never an ever-growing log.
    for (const clubId of division) {
      const sessions = sessionsFor(game.state, clubId);
      expect(sessions.length).toBeGreaterThanOrEqual(5);
      expect(sessions.length).toBeLessThanOrEqual(TRAINING_SESSION_HISTORY_PER_CLUB);
      const cohesion = clubCohesionValue(game.state, clubId);
      expect(cohesion).toBeGreaterThan(0);
      expect(cohesion).toBeLessThan(1);
    }
    expect(store.history.length).toBeLessThanOrEqual(division.length * TRAINING_SESSION_HISTORY_PER_CLUB);
  });
});
