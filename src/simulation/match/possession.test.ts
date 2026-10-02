import { describe, expect, it } from 'vitest';
import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { Tactics } from '@/domain/tactics';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { Rng } from '../rng';
import { weighActions, type ActionContext } from './actions';
import { buildContext } from './core';
import { phaseForZone, pressureFor, progressOf, shapeFor, urgencyFor, zoneOf } from './field';
import { cloneMatch } from './testHelpers';
import { currentScore, simulateToCompletion } from './engine';
import { takePenalty } from './setPieces';
import { collectingTrace, formatTrace, traceActions } from './trace';
import type { PlayerEffectiveness } from './teamStrength';

/**
 * What the overhaul was for.
 *
 * The old engine asked a per-minute question — does this side shoot? — and
 * answered it with a probability. These tests pin the properties that replaced
 * it: a player's decision follows from where he is and who is closing him down,
 * the ball is earned through interactions rather than assigned, a better side
 * keeps it more, tactics change what players attempt, and every figure on the
 * stats panel can be traced back to something that actually happened on the
 * pitch.
 */

function preparedMatch(state: GameState, fixture: Match): Match {
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function setGroup(state: GameState, clubId: string, group: 'technical' | 'mental', value: number): void {
  const club = state.clubs[clubId]!;
  for (const id of club.squadIds) {
    const player = state.people[id];
    if (player?.kind !== 'player') continue;
    const bucket = player.attributes[group] as unknown as Record<string, number>;
    for (const key of Object.keys(bucket)) bucket[key] = value;
  }
}

function evenFixture(seed: string): { state: GameState; home: Club; away: Club; base: Match } {
  const { state, draft } = createTestGame(seed);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  prepareMatchday(state, 1);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === home.id && candidate.awayClubId === away.id,
  )!;
  return { state, home, away, base: preparedMatch(state, fixture) };
}

// --- The decision model ----------------------------------------------------

function effective(overrides: Partial<PlayerEffectiveness['effective']> = {}): PlayerEffectiveness['effective'] {
  const base: PlayerEffectiveness['effective'] = {
    passing: 11,
    shooting: 11,
    tackling: 11,
    ballControl: 11,
    crossing: 11,
    heading: 11,
    goalkeeping: 1,
    pace: 11,
    stamina: 11,
    strength: 11,
    agility: 11,
    positioning: 11,
    decisions: 11,
    composure: 11,
    workRate: 11,
    determination: 11,
    discipline: 11,
    aggression: 11,
  };
  return { ...base, ...overrides };
}

function tactics(overrides: Partial<Tactics> = {}): Tactics {
  return {
    formation: '4-4-2',
    mentality: 'balanced',
    passingStyle: 'mixed',
    tempo: 'standard',
    pressing: 'medium',
    defensiveLine: 'standard',
    attackingFocus: 'balanced',
    ...overrides,
  };
}

function actionContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    position: 'CM',
    isKeeper: false,
    progress: 0.5,
    y: 0.5,
    zone: 'middle',
    pressure: 0.35,
    optionsTotal: 9,
    optionsAhead: 4,
    optionsWide: 4,
    effective: effective(),
    energy: 80,
    profile: {
      attackMultiplier: 1,
      defenceMultiplier: 1,
      controlMultiplier: 1,
      shotRateMultiplier: 1,
      shotQualityMultiplier: 1,
      errorRate: 1,
      fatigueRate: 1,
      foulRate: 1,
      cardRate: 1,
      counterVulnerability: 1,
      wideBias: 0.5,
      aerialMultiplier: 1,
      pressExposure: 1,
    },
    tactics: tactics(),
    urgency: 0,
    retaining: false,
    counter: false,
    ...overrides,
  };
}

function weightOf(ctx: ActionContext, kind: string): number {
  return weighActions(ctx).find((option) => option.kind === kind)?.weight ?? 0;
}

describe('player decisions follow from the situation', () => {
  it('changes what a man attempts when the manager changes the instructions', () => {
    const short = actionContext({ tactics: tactics({ passingStyle: 'short' }) });
    const direct = actionContext({ tactics: tactics({ passingStyle: 'direct' }) });

    // The same player, the same ball, the same pressure — different orders.
    expect(weightOf(direct, 'pass')).toBeLessThan(weightOf(short, 'pass'));
    // A route-one side gets rid of it more often, which is the whole point of it.
    const panicky = actionContext({ zone: 'own-third', progress: 0.25 });
    expect(weightOf({ ...panicky, tactics: tactics({ passingStyle: 'direct' }) }, 'clear')).toBeGreaterThan(
      weightOf({ ...panicky, tactics: tactics({ passingStyle: 'short' }) }, 'clear'),
    );
  });

  it('lets a good finisher shoot more than a poor one from the same place', () => {
    const good = actionContext({ progress: 0.78, effective: effective({ shooting: 17, composure: 16 }) });
    const poor = actionContext({ progress: 0.78, effective: effective({ shooting: 5, composure: 5 }) });
    expect(weightOf(good, 'shoot')).toBeGreaterThan(weightOf(poor, 'shoot'));
    // And the poor one is likelier to do something safer instead.
    expect(weightOf(poor, 'pass')).toBeGreaterThan(weightOf(poor, 'shoot'));
  });

  it('makes a centre-back under pressure in his own box clear it', () => {
    const trapped = actionContext({ position: 'CB', zone: 'own-box', progress: 0.08, pressure: 0.85 });
    const clear = weightOf(trapped, 'clear');
    expect(clear).toBeGreaterThan(weightOf(trapped, 'shoot'));
    expect(clear).toBeGreaterThan(weightOf(trapped, 'carry'));
  });

  it('never offers a keeper a shot or a cross', () => {
    const keeper = actionContext({ position: 'GK', isKeeper: true, progress: 0.04, zone: 'own-box' });
    expect(weightOf(keeper, 'shoot')).toBe(0);
    expect(weightOf(keeper, 'cross')).toBe(0);
    expect(weightOf(keeper, 'pass')).toBeGreaterThan(0);
  });
});

describe('the field model reads the game', () => {
  it('knows which third the ball is in, from the point of view of whoever has it', () => {
    expect(zoneOf('home', 0.05)).toBe('own-box');
    expect(zoneOf('home', 0.5)).toBe('middle');
    expect(zoneOf('home', 0.9)).toBe('box');
    // The same blade of grass is the away side's own box.
    expect(zoneOf('away', 0.9)).toBe('own-box');
    expect(zoneOf('away', 0.1)).toBe('box');
    expect(progressOf('away', 0.9)).toBeCloseTo(0.1, 10);
  });

  it('turns a position into a phase', () => {
    expect(phaseForZone('own-third')).toBe('build-up');
    expect(phaseForZone('middle')).toBe('progression');
    expect(phaseForZone('final-third')).toBe('final-third');
    expect(phaseForZone('box')).toBe('chance');
  });

  it('drops the block when the manager asks for a deep line and pushes it up for a high one', () => {
    const { state, base } = evenFixture('field-shape');
    const context = buildContext(base, matchEnvironment(state, base));
    const deepHome = shapeFor({ ...context, home: { ...context.home, tactics: tactics({ defensiveLine: 'deep' }) } }, 'home', {
      inPossession: false,
      energy: 100,
      urgency: 0,
    });
    const highHome = shapeFor({ ...context, home: { ...context.home, tactics: tactics({ defensiveLine: 'high' }) } }, 'home', {
      inPossession: false,
      energy: 100,
      urgency: 0,
    });
    // Home attacks toward x = 1, so a higher line is further up the pitch.
    expect(highHome.defensiveLine).toBeGreaterThan(deepHome.defensiveLine);
    // And the away side's line moves the other way, because it defends the other
    // goal: pushing up takes it *closer to the halfway line*, which is a smaller x.
    const awayWith = (defensiveLine: Tactics['defensiveLine']) =>
      shapeFor({ ...context, away: { ...context.away, tactics: tactics({ defensiveLine }) } }, 'away', {
        inPossession: false,
        energy: 100,
        urgency: 0,
      });
    expect(awayWith('high').defensiveLine).toBeLessThan(awayWith('deep').defensiveLine);
    expect(awayWith('deep').defensiveLine).toBeGreaterThan(0.5);
  });

  it('tires the pressing and agitates the losing side late on', () => {
    const { state, base } = evenFixture('field-pressure');
    const context = buildContext(base, matchEnvironment(state, base));
    const fresh = pressureFor(context, 'home', { energy: 100, inPossession: false });
    const tired = pressureFor(context, 'home', { energy: 30, inPossession: false });
    expect(tired).toBeLessThan(fresh);

    expect(urgencyFor('home', { minute: 50, goalDifference: -1 })).toBe(0);
    expect(urgencyFor('home', { minute: 88, goalDifference: -2 })).toBeGreaterThan(0.5);
    expect(urgencyFor('home', { minute: 88, goalDifference: 2 })).toBeLessThan(0);
  });
});

// --- The football itself ---------------------------------------------------

describe('possession is earned across the pitch', () => {
  it('gives the side that can actually play more of the ball', () => {
    const { state, home, base } = evenFixture('possession-earned');
    const away = state.clubs[base.awayClubId]!;
    setGroup(state, home.id, 'technical', 15);
    setGroup(state, home.id, 'mental', 15);
    setGroup(state, away.id, 'technical', 7);
    setGroup(state, away.id, 'mental', 7);

    let homeTicks = 0;
    let awayTicks = 0;
    for (let i = 0; i < 8; i++) {
      const match = cloneMatch(base);
      match.seed = 500 + i * 31;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      homeTicks += match.possessionTicks.home;
      awayTicks += match.possessionTicks.away;
    }

    // Not a formality, but the football tells.
    expect(homeTicks).toBeGreaterThan(awayTicks * 1.15);
    // And nobody is ever given all of it.
    expect(awayTicks).toBeGreaterThan(0);
  });

  it('derives possession from the minutes rather than from a separate estimate', () => {
    const { state, base } = evenFixture('possession-derived');
    const match = cloneMatch(base);
    simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
    const ticks = match.possessionTicks.home + match.possessionTicks.away;
    // One tick per minute of football played, stoppage time included.
    expect(ticks).toBeGreaterThan(80);
    expect(ticks).toBeLessThan(120);
    expect(match.result!.homePossession + match.result!.awayPossession).toBe(100);
  });
});

describe('passes are interactions, not statistics', () => {
  it('attempts passes, completes most of them, and never completes more than it attempts', () => {
    const { state, base } = evenFixture('passes-interactions');
    const match = cloneMatch(base);
    simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));

    let attempted = 0;
    let completed = 0;
    for (const performance of Object.values(match.performances)) {
      expect(performance.passesCompleted).toBeLessThanOrEqual(performance.passes);
      attempted += performance.passes;
      completed += performance.passesCompleted;
    }

    // A Sunday League side misplaces plenty, but not half of them.
    expect(attempted).toBeGreaterThan(200);
    const rate = completed / attempted;
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.9);
  });

  it('gives a better passing side a better completion rate', () => {
    const { state, home, base } = evenFixture('passes-quality');
    const away = state.clubs[base.awayClubId]!;
    setGroup(state, home.id, 'technical', 16);
    setGroup(state, away.id, 'technical', 6);

    let homeRate = 0;
    let awayRate = 0;
    for (let i = 0; i < 6; i++) {
      const match = cloneMatch(base);
      match.seed = 700 + i * 17;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      const rateFor = (clubId: string): number => {
        let attempted = 0;
        let completed = 0;
        for (const performance of Object.values(match.performances)) {
          if (performance.clubId !== clubId) continue;
          attempted += performance.passes;
          completed += performance.passesCompleted;
        }
        return attempted === 0 ? 0 : completed / attempted;
      };
      homeRate += rateFor(home.id);
      awayRate += rateFor(away.id);
    }

    expect(homeRate).toBeGreaterThan(awayRate);
  });
});

describe('defenders shape what happens', () => {
  it('records tackles, interceptions and fouls from the duels that produced them', () => {
    const { state, base } = evenFixture('defending-recorded');
    let tackles = 0;
    let interceptions = 0;
    let fouls = 0;
    for (let i = 0; i < 6; i++) {
      const match = cloneMatch(base);
      match.seed = 900 + i * 23;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      for (const performance of Object.values(match.performances)) {
        tackles += performance.tackles;
        interceptions += performance.interceptions;
      }
      fouls += match.events.filter((event) => event.type === 'foul').length;
    }

    expect(tackles).toBeGreaterThan(10);
    expect(interceptions).toBeGreaterThan(5);
    // And a side that keeps losing the ball gives fouls away trying to win it back.
    expect(fouls).toBeGreaterThan(10);
  });

  it('lets a foul in the box become a penalty rather than an isolated card', () => {
    const { state, base } = evenFixture('set-piece-penalty');
    const env = matchEnvironment(state, base);
    const context = buildContext(base, env);
    const sink: Match['events'] = [];
    const taker = base.lineups.home.starting.find((slot) => slot.position === 'ST')!;
    base.minute = 60;
    base.field = {
      ball: { x: 0.12, y: 0.5, possessionSide: 'home', possessionPlayerId: taker.playerId },
      homeShape: shapeFor(context, 'home', { inPossession: true, energy: 90, urgency: 0 }),
      awayShape: shapeFor(context, 'away', { inPossession: false, energy: 90, urgency: 0 }),
      pressure: { home: 0.5, away: 0.5 },
      phase: 'chance',
      counterPress: { home: 0, away: 0 },
    };

    const outcome = takePenalty(base, env, context, 'home', new Rng('spot-kick'), sink);
    // It is a penalty, not a rumour: the match record has the kick in it.
    expect(sink.some((event) => event.type === 'penalty-scored' || event.type === 'penalty-missed')).toBe(true);
    if (outcome.goal) expect(currentScore(base).home).toBe(1);
  });
});

describe('the match report agrees with the football', () => {
  it('keeps goals, shots on target and shots in the right order for both sides', () => {
    const { state, home, base } = evenFixture('statistics-consistent');
    const away = state.clubs[base.awayClubId]!;
    for (let i = 0; i < 8; i++) {
      const match = cloneMatch(base);
      match.seed = 1300 + i * 11;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));

      for (const clubId of [home.id, away.id]) {
        let shots = 0;
        let onTarget = 0;
        let goals = 0;
        for (const performance of Object.values(match.performances)) {
          if (performance.clubId !== clubId) continue;
          shots += performance.shots;
          onTarget += performance.shotsOnTarget;
          goals += performance.goals;
        }
        expect(onTarget).toBeLessThanOrEqual(shots);
        expect(goals).toBeLessThanOrEqual(onTarget);
      }

      // The result is read from the same performances, so they cannot disagree.
      const homeShots = Object.values(match.performances)
        .filter((performance) => performance.clubId === home.id)
        .reduce((sum, performance) => sum + performance.shots, 0);
      expect(match.result!.homeShots).toBe(homeShots);
    }
  });
});

describe('the developer trace', () => {
  it('reads a match back as a sequence of decisions, in order', () => {
    const { state, base } = evenFixture('trace-story');
    const collected = collectingTrace();
    const match = cloneMatch(base);
    match.seed = 4242;
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    simulateToCompletion(match, { ...env, trace: collected.trace });

    expect(collected.entries.length).toBeGreaterThan(100);
    const actions = traceActions(collected.entries);
    expect(actions.length).toBeGreaterThan(100);

    // Every decision names a man, a place and a phase, because that is what a
    // balance question is actually about.
    for (const entry of actions) {
      expect(entry.message).toMatch(/chose (pass|carry|dribble|cross|shoot|clear|hold|switch|through)/);
      expect(entry.playerId).toBeTruthy();
      expect(entry.phase).toBeTruthy();
    }

    const text = formatTrace(actions.slice(0, 5));
    expect(text).toContain("chose");
    expect(collected.entries.every((entry) => entry.minute >= 0)).toBe(true);
  });

  it('never lets a line about one side name a man from the other', () => {
    const { state, base } = evenFixture('commentary-cast');
    const match = cloneMatch(base);
    match.seed = 606;
    simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));

    const lines = match.commentary ?? [];
    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) {
      if (!line.playerId || !line.side) continue;
      const clubId = line.side === 'home' ? match.homeClubId : match.awayClubId;
      // Every named man plays for the side the line is about. The minute's
      // possessions used to be pooled into one list, which handed the narrator
      // the other team's players and produced passes nobody made.
      expect(match.performances[line.playerId]?.clubId).toBe(clubId);
    }
  });

  it('replays identically, decision for decision', () => {
    const { state, base } = evenFixture('trace-determinism');
    const first = collectingTrace();
    const second = collectingTrace();
    const a = cloneMatch(base);
    const b = cloneMatch(base);
    a.seed = 8181;
    b.seed = 8181;

    simulateToCompletion(a, { ...matchEnvironment(state, a, { autoManageAllBenches: true }), trace: first.trace });
    simulateToCompletion(b, { ...matchEnvironment(state, b, { autoManageAllBenches: true }), trace: second.trace });

    expect(first.entries.map((entry) => entry.message)).toEqual(second.entries.map((entry) => entry.message));
    expect(a.result).toEqual(b.result);
  });
});
