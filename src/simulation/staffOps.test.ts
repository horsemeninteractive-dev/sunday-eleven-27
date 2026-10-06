import { describe, expect, it } from 'vitest';
import { isPlayer, type Official, type OfficialAttributes, type Player } from '@/domain/person';
import { emptyClubStaff } from '@/domain/staff';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays } from './calendar';
import { recoverPlayerDaily } from './availability';
import { sessionCoachFor } from './training/plan';
import { conductTraining } from './training/session';
import { candidateOf } from './recruitment/store';
import { appointStaff, setStaffAvailability } from './staff';
import { assistantAdvice, physioReport, physioSupport, weeklyScoutReports } from './staffOps';
import { createTestGame } from './testSupport';

/**
 * What the committee does to the football.
 *
 * Each test here pins the integration to the system that already owns the fact:
 * the coach to training's own quality, the physio to the injury countdown, the
 * scout to the recruitment knowledge graph. None of them may create a second
 * version of anything, so several tests assert against the existing stores
 * directly, not against a new one.
 */

type Game = ReturnType<typeof createTestGame>;

const BASE_ATTRIBUTES: OfficialAttributes = {
  coaching: 10,
  manManagement: 10,
  motivation: 10,
  tacticalKnowledge: 10,
  recruitmentEye: 10,
  organisation: 10,
  reliability: 10,
};

function officer(id: string, overrides: Partial<Official> = {}): Official {
  return {
    id,
    kind: 'official',
    firstName: 'Test',
    surname: id,
    age: 42,
    townId: null,
    occupation: 'Joiner',
    reputation: 20,
    roles: [],
    role: 'volunteer',
    clubId: null,
    attributes: { ...BASE_ATTRIBUTES },
    patience: 10,
    notes: [],
    availability: { status: 'available', note: null },
    ...overrides,
  };
}

/** Strip a club's generated committee so a test controls exactly who is there. */
function clearStaff(game: Game, clubId: string): void {
  game.state.clubs[clubId]!.staff = emptyClubStaff();
}

function clubPlayer(game: Game, clubId: string, index = 0): Player {
  const person = game.state.people[game.state.clubs[clubId]!.squadIds[index]!]!;
  if (!isPlayer(person)) throw new Error('not a player');
  return person;
}

describe('the coach and training', () => {
  it('sends the session through the existing training system, and a better coach makes a better evening', () => {
    const game = createTestGame('ops-coach-quality');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    const weak = officer('coach_weak', {
      role: 'coach',
      attributes: { ...BASE_ATTRIBUTES, coaching: 5, motivation: 5, organisation: 5, manManagement: 5 },
    });
    game.state.people[weak.id] = weak;
    appointStaff(game.state, clubId, weak.id, 'coach', game.state.season.startDate);

    const clone = structuredClone(game.state);
    (clone.people[weak.id] as Official).attributes = {
      ...BASE_ATTRIBUTES,
      coaching: 18,
      motivation: 18,
      organisation: 18,
      manManagement: 18,
    };

    const weakPick = sessionCoachFor(game.state, clubId);
    expect(weakPick.role).toBe('coach');
    expect(weakPick.personId).toBe(weak.id);

    // Weather can call a session off, so find a matchday where both ran.
    let weakSession = null as ReturnType<typeof conductTraining>['session'];
    let strongSession = null as ReturnType<typeof conductTraining>['session'];
    for (let matchday = 1; matchday <= 8 && !(weakSession && strongSession); matchday += 1) {
      const w = conductTraining(game.state, clubId, matchday).session;
      const s = conductTraining(clone, clubId, matchday).session;
      if (w && s && !w.cancelled && !s.cancelled) {
        weakSession = w;
        strongSession = s;
      }
    }
    expect(weakSession && strongSession).toBeTruthy();

    // The coach is recorded on the session, and his competence moves the
    // evening's quality through training's own formula — not a new one.
    expect(weakSession!.coachRole).toBe('coach');
    expect(strongSession!.coachQuality).toBeGreaterThan(weakSession!.coachQuality);
    expect(strongSession!.quality).toBeGreaterThan(weakSession!.quality);
  });

  it('does not let an unavailable coach contribute', () => {
    const game = createTestGame('ops-coach-away');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    const coach = officer('coach_away', { role: 'coach', attributes: { ...BASE_ATTRIBUTES, coaching: 19 } });
    game.state.people[coach.id] = coach;
    appointStaff(game.state, clubId, coach.id, 'coach', game.state.season.startDate);
    setStaffAvailability(game.state, coach.id, 'unavailable', 'On holiday');

    const pick = sessionCoachFor(game.state, clubId);
    expect(pick.personId).not.toBe(coach.id);
    expect(pick.role).not.toBe('coach');
    // The session still happens, run by somebody else.
    expect(pick.quality).toBeGreaterThan(0);
  });
});

describe('the physio and the body', () => {
  it('gets a man back to fitness quicker, without touching the injury clock', () => {
    const game = createTestGame('ops-physio');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    const physio = officer('physio_good', {
      role: 'physio',
      attributes: { ...BASE_ATTRIBUTES, medical: 19, reliability: 19 },
    });
    game.state.people[physio.id] = physio;
    appointStaff(game.state, clubId, physio.id, 'physio', game.state.season.startDate);
    expect(physioSupport(game.state, clubId)).toBeGreaterThan(0.5);

    const source = clubPlayer(game, clubId, 0);
    source.injury = { description: 'a pulled hamstring', severity: 'minor', daysOut: 24, occurredOn: game.state.date };
    const withPhysio = structuredClone(source);
    const without = structuredClone(source);

    without.fitness = 40;
    withPhysio.fitness = 40;
    for (let day = 0; day < 10; day += 1) {
      recoverPlayerDaily(without, { physioSupport: 0 });
      recoverPlayerDaily(withPhysio, { physioSupport: 0.95 });
    }

    // Fitter, faster — but the same injury, on the same clock. The countdown is
    // still the authority, which is exactly what the physio is not allowed to
    // rewrite.
    expect(withPhysio.fitness).toBeGreaterThan(without.fitness);
    expect(withPhysio.injury).not.toBeNull();
    expect(withPhysio.injury!.daysOut).toBe(without.injury!.daysOut);
    expect(withPhysio.injury!.description).toBe(without.injury!.description);

    // A fit player is never given an injury by recovery.
    const fit = structuredClone(source);
    fit.injury = null;
    recoverPlayerDaily(fit, { physioSupport: 1 });
    expect(fit.injury).toBeNull();
    expect(fit.fitness).toBeGreaterThanOrEqual(source.fitness);
  });

  it('tells the manager what the physio reckons, and keeps the true state untouched', () => {
    const game = createTestGame('ops-physio-report');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);
    const physio = officer('physio_report', {
      role: 'physio',
      attributes: { ...BASE_ATTRIBUTES, medical: 16, reliability: 16 },
    });
    game.state.people[physio.id] = physio;
    appointStaff(game.state, clubId, physio.id, 'physio', game.state.season.startDate);

    const player = clubPlayer(game, clubId, 1);
    player.injury = { description: 'a twisted knee', severity: 'minor', daysOut: 15, occurredOn: game.state.date };
    const before = player.injury.daysOut;

    const report = physioReport(game.state, clubId);
    expect(report.physioName).toBe('Test physio_report');
    const row = report.assessments.find((entry) => entry.personId === player.id)!;
    expect(row).toBeDefined();
    expect(row.confidence === 'sure' || row.confidence === 'fair').toBe(true);
    // An estimate is an opinion; the real countdown did not move.
    expect(player.injury.daysOut).toBe(before);
  });

  it('carries on with no physio at all', () => {
    const game = createTestGame('ops-no-physio');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);
    const player = clubPlayer(game, clubId, 0);
    player.injury = { description: 'a dead leg', severity: 'knock', daysOut: 8, occurredOn: game.state.date };

    expect(physioSupport(game.state, clubId)).toBe(0);
    const report = physioReport(game.state, clubId);
    expect(report.physioName).toBeNull();
    expect(report.assessments).toHaveLength(1);
    // No physio: the manager only has the figure in front of him.
    expect(report.assessments[0]!.confidence).toBe('fair');
  });
});

describe('the assistant and the scout', () => {
  it('gives more advice the better the assistant is', () => {
    const game = createTestGame('ops-assistant');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    // Give him something to talk about.
    const squad = game.state.clubs[clubId]!.squadIds.map((id) => game.state.people[id]!).filter(isPlayer);
    squad.slice(0, 3).forEach((player) => {
      player.fitness = 55;
    });
    squad.slice(3, 5).forEach((player) => {
      player.form = 30;
    });
    squad[0]!.injury = { description: 'a knock', severity: 'knock', daysOut: 5, occurredOn: game.state.date };

    const weak = officer('assistant_weak', {
      role: 'assistant',
      attributes: { ...BASE_ATTRIBUTES, tacticalKnowledge: 5, judgement: 5, reliability: 5 },
    });
    const strong = officer('assistant_strong', {
      role: 'assistant',
      attributes: { ...BASE_ATTRIBUTES, tacticalKnowledge: 18, judgement: 18, reliability: 18 },
    });

    const weakState = structuredClone(game.state);
    weakState.people[weak.id] = weak;
    weakState.clubs[clubId]!.staff!.assistantId = weak.id;
    const strongState = structuredClone(game.state);
    strongState.people[strong.id] = strong;
    strongState.clubs[clubId]!.staff!.assistantId = strong.id;

    const weakAdvice = assistantAdvice(weakState, clubId);
    const strongAdvice = assistantAdvice(strongState, clubId);

    expect(weakAdvice.available).toBe(true);
    expect(strongAdvice.available).toBe(true);
    expect(strongAdvice.competence).toBeGreaterThan(weakAdvice.competence);
    expect(strongAdvice.lines.length).toBeGreaterThan(weakAdvice.lines.length);
    // The good assistant spots the knocks.
    expect(strongAdvice.lines.some((line) => /knock/i.test(line.text))).toBe(true);
  });

  it('finds players through the existing recruitment knowledge graph', () => {
    const game = createTestGame('ops-scout');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    const scout = officer('scout_good', {
      role: 'scout',
      attributes: { ...BASE_ATTRIBUTES, judgement: 18, recruitmentEye: 18, reliability: 18 },
    });
    game.state.people[scout.id] = scout;
    appointStaff(game.state, clubId, scout.id, 'scout', game.state.season.startDate);

    let discoveredId: string | null = null;
    for (let week = 0; week < 24 && !discoveredId; week += 1) {
      game.state.date = addDays(game.state.date, 7);
      const outcome = weeklyScoutReports(game.state, clubId);
      if (outcome.discovered.length > 0) discoveredId = outcome.discovered[0]!;
    }

    expect(discoveredId).not.toBeNull();
    // The name lands on the one recruitment list, with a real source and an
    // existing discovery kind — no parallel database.
    const candidate = candidateOf(game.state, discoveredId!)!;
    expect(candidate).toBeDefined();
    expect(candidate.discoveredVia).toBe('scout');
    expect(candidate.sourcePersonId).toBe(scout.id);
    expect(Object.keys(candidate.knowledge.attributes).length).toBeGreaterThan(0);
    expect(game.state.recruitment.candidates[discoveredId!]).toBeDefined();
  });

  it('does nothing when the club has no scout, and the club still works', () => {
    const game = createTestGame('ops-no-scout');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);
    expect(weeklyScoutReports(game.state, clubId).discovered).toHaveLength(0);
  });
});

describe('absence, and clubs without staff', () => {
  it('survives every staff member being unavailable', () => {
    const game = createTestGame('ops-all-away');
    const clubId = game.state.userClubId;

    for (const member of ['assistantId', 'physioId', 'secretaryId', 'treasurerId'] as const) {
      const id = game.state.clubs[clubId]!.staff?.[member];
      if (id) setStaffAvailability(game.state, id, 'unavailable', 'Away');
    }
    for (const id of game.state.clubs[clubId]!.staff?.coachIds ?? []) {
      setStaffAvailability(game.state, id, 'unavailable', 'Away');
    }

    expect(physioSupport(game.state, clubId)).toBe(0);
    expect(assistantAdvice(game.state, clubId).available).toBe(false);
    expect(weeklyScoutReports(game.state, clubId).discovered).toHaveLength(0);
    expect(sessionCoachFor(game.state, clubId).quality).toBeGreaterThan(0);
    // And a session still runs.
    const session = conductTraining(game.state, clubId, 1).session;
    expect(session).not.toBeNull();
  });

  it('keeps a club with an empty committee functioning', () => {
    const game = createTestGame('ops-empty-committee');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    expect(physioSupport(game.state, clubId)).toBe(0);
    expect(assistantAdvice(game.state, clubId).available).toBe(false);
    const pick = sessionCoachFor(game.state, clubId);
    expect(pick.quality).toBeGreaterThan(0);
    const session = conductTraining(game.state, clubId, 1).session;
    expect(session).not.toBeNull();
  });
});

describe('operational state and the shape of the game', () => {
  it('preserves the committee and its availability across a save and load', () => {
    const game = createTestGame('ops-save-load');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);

    const coach = officer('coach_persist', { role: 'coach', attributes: { ...BASE_ATTRIBUTES, coaching: 17 } });
    const physio = officer('physio_persist', {
      role: 'physio',
      attributes: { ...BASE_ATTRIBUTES, medical: 15, reliability: 15 },
    });
    game.state.people[coach.id] = coach;
    game.state.people[physio.id] = physio;
    appointStaff(game.state, clubId, coach.id, 'coach', game.state.season.startDate);
    appointStaff(game.state, clubId, physio.id, 'physio', game.state.season.startDate);
    setStaffAvailability(game.state, coach.id, 'unavailable', 'Working Saturdays');

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    expect(loaded.clubs[clubId]!.staff).toEqual(game.state.clubs[clubId]!.staff);
    expect((loaded.people[coach.id] as Official).availability).toEqual({ status: 'unavailable', note: 'Working Saturdays' });
    expect(physioSupport(loaded, clubId)).toBeCloseTo(physioSupport(game.state, clubId), 5);
    expect(assistantAdvice(loaded, clubId).assistantName).toBeNull();
  });

  it('reaches into the existing stores rather than inventing new ones', () => {
    const game = createTestGame('ops-no-duplicate-systems');
    const clubId = game.state.userClubId;
    clearStaff(game, clubId);
    const scout = officer('scout_shape', { role: 'scout', attributes: { ...BASE_ATTRIBUTES, judgement: 16, recruitmentEye: 16 } });
    game.state.people[scout.id] = scout;
    appointStaff(game.state, clubId, scout.id, 'scout', game.state.season.startDate);

    const keysBefore = Object.keys(game.state).sort();
    const candidatesBefore = Object.keys(game.state.recruitment.candidates).length;

    for (let week = 0; week < 24; week += 1) {
      game.state.date = addDays(game.state.date, 7);
      weeklyScoutReports(game.state, clubId);
      physioReport(game.state, clubId);
      assistantAdvice(game.state, clubId);
    }

    // No new top-level state was added, and scouting wrote to the recruitment
    // store the rest of the game already reads.
    expect(Object.keys(game.state).sort()).toEqual(keysBefore);
    expect(Object.keys(game.state.recruitment.candidates).length).toBeGreaterThanOrEqual(candidatesBefore);
    // Availability remains the single field on the person.
    expect((game.state.people[scout.id] as Official).availability).toBeDefined();
  });
});
