import { describe, expect, it } from 'vitest';
import { SUPPORTER_HISTORY_LIMIT } from '@/domain/club';
import type { Club, ClubSeasonRecord } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { matchEnvironment, prepareMatchday } from './matchday';
import { simulateFixture } from './fastMatch';
import { estimateAttendance } from './match/attendance';
import {
  SUPPORT_ATTENDANCE_CEILING,
  SUPPORT_ATTENDANCE_FLOOR,
  adjustSupporterConfidence,
  applyMatchSupport,
  applySeasonSupport,
  supportConfidenceOf,
  supporterAttendanceFactor,
  supporterMood,
} from './support';
import { createTestGame } from './testSupport';

/**
 * What the crowd thinks, and what the gate does about it.
 *
 * The crowd is one number per club — nobody is simulating eighty individuals —
 * and the things worth holding it to are the *bounds*: one afternoon cannot move
 * it far, a season cannot move it far, it never reaches either end, and the gate
 * it produces is the honest size of the effect rather than a swing that makes the
 * attendance meaningless. A test that only checked "a win moves it up" would pass
 * for a model that doubled the crowd on a Tuesday, so most of what is below is
 * about how little it moves.
 *
 * A played fixture is taken from the real fixture list and played by the real
 * simulator, as the news tests do: a hand-written `Match` would have tested the
 * arithmetic against a shape somebody believed the simulation writes.
 */

/** A league fixture between two clubs that are not the manager's, played out. */
function playedStrangers(state: GameState): { match: Match; home: Club; away: Club } {
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.homeClubId !== state.userClubId &&
      candidate.awayClubId !== state.userClubId &&
      state.competitions[candidate.competitionId]?.kind === 'league',
  )!;
  prepareMatchday(state, match.matchday);
  simulateFixture(match, matchEnvironment(state, match), 'fast');
  return { match, home: state.clubs[match.homeClubId]!, away: state.clubs[match.awayClubId]! };
}

/**
 * A quiet relationship between the two clubs.
 *
 * The derby multiplier is a real part of the model and is tested on its own, so
 * every other case pins the plain arithmetic by putting the pairing below the
 * threshold first rather than hoping the generator gave these two a grudge.
 */
function settleRelationship(home: Club, away: Club): void {
  home.rivalries[away.id] = { intensity: 20, note: '', baseline: 20, kind: 'competitive', heat: 0 };
}

describe('a crowd is a number with a band on it', () => {
  it('puts a confidence figure in one of five bands at the boundaries', () => {
    expect(supporterMood(100)).toBe('buzzing');
    expect(supporterMood(75)).toBe('buzzing');
    expect(supporterMood(74)).toBe('hopeful');
    expect(supporterMood(60)).toBe('hopeful');
    expect(supporterMood(59)).toBe('settled');
    expect(supporterMood(42)).toBe('settled');
    expect(supporterMood(41)).toBe('restless');
    expect(supporterMood(28)).toBe('restless');
    expect(supporterMood(27)).toBe('disillusioned');
    expect(supporterMood(0)).toBe('disillusioned');
  });

  it('answers the middle of the road for a club it has never been asked about', () => {
    // No club at all, and a club whose record is there: the default is a club
    // nobody has an opinion about, which is what a new career's clubs are.
    expect(supportConfidenceOf(null)).toBe(50);
    expect(supportConfidenceOf(undefined)).toBe(50);

    const { state } = createTestGame('support-default');
    const club = state.clubs[state.userClubId]!;
    expect(supportConfidenceOf(club)).toBe(50);
    club.supporters.confidence = 71;
    expect(supportConfidenceOf(club)).toBe(71);
  });
});

describe('what a crowd is worth at the gate', () => {
  it('is bounded to a seventh either way, and neutral in the middle', () => {
    // The bounds themselves, and what a club with no strong mood draws: the whole
    // point of the midpoint being 1.01 is that a career with no mood changes is a
    // career whose attendances are what they always were.
    expect(supporterAttendanceFactor(0)).toBe(SUPPORT_ATTENDANCE_FLOOR);
    expect(supporterAttendanceFactor(100)).toBe(SUPPORT_ATTENDANCE_CEILING);
    expect(supporterAttendanceFactor(0)).toBe(0.88);
    expect(supporterAttendanceFactor(100)).toBe(1.14);
    expect(supporterAttendanceFactor(50)).toBeCloseTo(1.01, 5);

    // Monotone, and clamped for a figure that has somehow escaped its range.
    expect(supporterAttendanceFactor(20)).toBeLessThan(supporterAttendanceFactor(60));
    expect(supporterAttendanceFactor(-40)).toBe(SUPPORT_ATTENDANCE_FLOOR);
    expect(supporterAttendanceFactor(140)).toBe(SUPPORT_ATTENDANCE_CEILING);

    // The extreme is the promised size of the effect and no more.
    expect(SUPPORT_ATTENDANCE_CEILING - 1).toBeLessThan(1 / 7);
    expect(1 - SUPPORT_ATTENDANCE_FLOOR).toBeLessThan(1 / 7);
  });
});

describe('moving a crowd', () => {
  it('will not move as far as it is asked to, and never past either end', () => {
    const { state } = createTestGame('support-adjust');
    const club = state.clubs[state.userClubId]!;

    // The per-event limit is a Sunday's worth of feeling, so an afternoon that
    // ought to be worth thirty points of goodwill is worth four.
    const landed = adjustSupporterConfidence(club, '2026-09-06', 30, 'Ten of them, in one afternoon.');
    expect(landed).toBe(4);
    expect(supportConfidenceOf(club)).toBe(54);

    // And a crowd that is already convinced cannot be convinced much further: the
    // ceiling holds, and what lands is what was left of the way to it.
    club.supporters.confidence = 95;
    const atTop = adjustSupporterConfidence(club, '2026-09-13', 30, 'The same afternoon, from the ceiling.');
    expect(supportConfidenceOf(club)).toBe(98);
    expect(atTop).toBe(3);

    // The floor is the same promise at the other end.
    club.supporters.confidence = 8;
    adjustSupporterConfidence(club, '2026-09-20', -30, 'Everything that could go wrong, going wrong.');
    expect(supportConfidenceOf(club)).toBe(5);
  });

  it('damps a move by how far the crowd already is from the middle', () => {
    const { state } = createTestGame('support-damping');
    const club = state.clubs[state.userClubId]!;

    club.supporters.confidence = 50;
    const fromTheMiddle = adjustSupporterConfidence(club, '2026-09-06', 2, 'A good point.');
    club.supporters.confidence = 92;
    const fromTheTop = adjustSupporterConfidence(club, '2026-09-13', 2, 'A good point.');

    expect(fromTheMiddle).toBe(2);
    // 42 away from the middle is 60% of the way to the edge of the range, so the
    // same good point is worth 40% as much to a crowd that already believes.
    expect(fromTheTop).toBeCloseTo(0.8, 5);
    expect(fromTheTop).toBeLessThan(fromTheMiddle);
  });

  it('keeps the reasons, newest first, and no more of them than it promises', () => {
    const { state } = createTestGame('support-history');
    const club = state.clubs[state.userClubId]!;

    for (let week = 0; week < SUPPORTER_HISTORY_LIMIT + 4; week++) {
      adjustSupporterConfidence(club, `2026-09-${String(6 + week).padStart(2, '0')}`, 1, `Week ${week}.`);
    }

    expect(club.supporters.recent).toHaveLength(SUPPORTER_HISTORY_LIMIT);
    expect(club.supporters.recent[0]!.reason).toBe(`Week ${SUPPORTER_HISTORY_LIMIT + 3}.`);
    expect(club.supporters.recent[SUPPORTER_HISTORY_LIMIT - 1]!.reason).toBe('Week 4.');
    expect(club.supporters.updatedOn).toBe(`2026-09-${String(6 + SUPPORTER_HISTORY_LIMIT + 3).padStart(2, '0')}`);
  });
});

describe('what an afternoon does to the two crowds', () => {
  it('moves the winner up and the loser down, and by no more than a Sunday should', () => {
    const { state } = createTestGame('support-match');
    const { match, home, away } = playedStrangers(state);
    settleRelationship(home, away);

    // A three-goal win: one for winning it and two for the margin.
    match.result!.homeGoals = 3;
    match.result!.awayGoals = 0;
    const before = { home: supportConfidenceOf(home), away: supportConfidenceOf(away) };

    applyMatchSupport(state, match);

    expect(supportConfidenceOf(home)).toBe(before.home + 3);
    expect(supportConfidenceOf(away)).toBe(before.away - 3);
    expect(Math.abs(supportConfidenceOf(home) - before.home)).toBeLessThanOrEqual(4);
    expect(Math.abs(supportConfidenceOf(away) - before.away)).toBeLessThanOrEqual(4);
    // And the club can say why, which is what makes the number a feeling rather
    // than a figure that moved on its own.
    expect(home.supporters.recent[0]!.reason).toContain('Beat');
    expect(away.supporters.recent[0]!.reason).toContain('Lost');
  });

  it('leaves a crowd alone for football that has not been played', () => {
    const { state } = createTestGame('support-unplayed');
    const { match, home, away } = playedStrangers(state);
    settleRelationship(home, away);
    match.result = null;

    expect(applyMatchSupport(state, match)).toEqual([]);
    expect(supportConfidenceOf(home)).toBe(50);
    expect(supportConfidenceOf(away)).toBe(50);
    expect(home.supporters.recent).toHaveLength(0);
  });

  it('leaves a crowd alone for a fixture that is not in a competition', () => {
    // A friendly: it counts for legs and lungs and for nothing anybody pays to
    // watch. `isCompetitiveMatch` is the rule, and this is it being applied.
    const { state } = createTestGame('support-friendly');
    const { match, home, away } = playedStrangers(state);
    settleRelationship(home, away);
    match.competitionId = 'not-a-competition';

    expect(applyMatchSupport(state, match)).toEqual([]);
    expect(supportConfidenceOf(home)).toBe(50);
    expect(supportConfidenceOf(away)).toBe(50);
  });

  it('is felt harder when the two clubs do not like each other', () => {
    // The same afternoon, the same seed, two relationships: only the relationship
    // differs, so the difference in what landed is the derby and nothing else.
    const derby = createTestGame('support-derby');
    const quiet = createTestGame('support-derby');

    const derbyGame = playedStrangers(derby.state);
    const quietGame = playedStrangers(quiet.state);
    derbyGame.home.rivalries[derbyGame.away.id] = {
      intensity: 70,
      note: '',
      baseline: 70,
      kind: 'derby',
      heat: 0,
    };
    settleRelationship(quietGame.home, quietGame.away);

    for (const match of [derbyGame.match, quietGame.match]) {
      match.result!.homeGoals = 2;
      match.result!.awayGoals = 1;
    }

    applyMatchSupport(derby.state, derbyGame.match);
    applyMatchSupport(quiet.state, quietGame.match);

    const inTheDerby = supportConfidenceOf(derbyGame.home) - 50;
    const inTheQuietOne = supportConfidenceOf(quietGame.home) - 50;
    expect(inTheDerby).toBeGreaterThan(inTheQuietOne);
    expect(inTheQuietOne).toBeCloseTo(2, 5);
    expect(inTheDerby).toBeCloseTo(2.8, 5);
    // Still bounded: a derby is felt harder, it is not a different sport.
    expect(inTheDerby).toBeLessThanOrEqual(4);
  });
});

describe('no run of results can take a crowd anywhere wild', () => {
  it('leaves ten consecutive wins inside the ceiling, and the gate inside its bounds', () => {
    // The assertion the whole model exists for: a good season makes a club worth
    // watching, and it does not treble the gate or empty the ground. Each win is
    // worth three, which is what a two-goal victory is worth — and ten of them, as
    // it happens to a club that was already mid-table, are worth about a
    // twenty-fifth of the range between a crisis and a promotion party.
    const { state } = createTestGame('support-run');
    const club = state.clubs[state.userClubId]!;
    const start = supportConfidenceOf(club);

    for (let week = 0; week < 10; week++) {
      adjustSupporterConfidence(club, `2026-09-${String(6 + week).padStart(2, '0')}`, 3, 'Won it.');
      const confidence = supportConfidenceOf(club);
      expect(confidence).toBeLessThanOrEqual(98);
      expect(confidence).toBeGreaterThanOrEqual(5);
      const factor = supporterAttendanceFactor(confidence);
      expect(factor).toBeGreaterThanOrEqual(SUPPORT_ATTENDANCE_FLOOR);
      expect(factor).toBeLessThanOrEqual(SUPPORT_ATTENDANCE_CEILING);
    }

    const finished = supportConfidenceOf(club);
    expect(finished).toBeGreaterThan(start);
    expect(finished).toBeGreaterThan(65);
    expect(finished).toBeLessThan(90);
    // Ten wins move the gate by a few per cent, not by half the crowd.
    expect(supporterAttendanceFactor(finished) - supporterAttendanceFactor(start)).toBeLessThan(0.1);
  });

  it('never puts a crowd above the ceiling, however good the afternoon was', () => {
    const { state } = createTestGame('support-ceiling');
    const club = state.clubs[state.userClubId]!;
    club.supporters.confidence = 96;

    for (let week = 0; week < 12; week++) {
      adjustSupporterConfidence(club, `2026-09-${String(6 + week).padStart(2, '0')}`, 4, 'Won it again.');
    }

    expect(supportConfidenceOf(club)).toBe(98);
  });
});

describe('a summer at the ground', () => {
  /**
   * A season line for the club, so the summer has something to read.
   *
   * The movement is spread in rather than set to `undefined`, so the un-moved
   * control is a club that simply has no movement on its record — which is what
   * every club that finished mid-table actually has.
   */
  function seasonLine(movement?: 'promoted' | 'relegated'): ClubSeasonRecord {
    return {
      seasonId: 'season_test',
      seasonLabel: '2025/26',
      competitionName: 'Division Two',
      tier: 2,
      played: 22,
      won: 10,
      drawn: 5,
      lost: 7,
      goalsFor: 38,
      goalsAgainst: 30,
      points: 35,
      finalPosition: 6,
      ...(movement ? { movement } : {}),
    };
  }

  it('pulls a crowd back towards the middle from both ends', () => {
    const { state } = createTestGame('support-summer');
    const clubs = Object.values(state.clubs).filter((club) => club.active);
    const up = clubs[0]!;
    const down = clubs[1]!;

    up.supporters.confidence = 90;
    down.supporters.confidence = 10;
    applySeasonSupport(state, '2026-08-03');

    expect(supportConfidenceOf(up)).toBeLessThan(90);
    expect(supportConfidenceOf(up)).toBeGreaterThan(50);
    expect(supportConfidenceOf(down)).toBeGreaterThan(10);
    expect(supportConfidenceOf(down)).toBeLessThan(50);
  });

  it('applies promotion and relegation on top of the drift, and never more than the season limit', () => {
    const { state } = createTestGame('support-movement');
    const promoted = state.clubs[state.userClubId]!;

    // Two clubs at exactly the same starting point, so the only difference left is
    // the season they have just had.
    const control = Object.values(state.clubs).find((club) => club.id !== promoted.id && club.active)!;
    promoted.supporters.confidence = 50;
    control.supporters.confidence = 50;
    promoted.history.seasons.push(seasonLine('promoted'));
    control.history.seasons.push(seasonLine());

    applySeasonSupport(state, '2026-08-03');

    expect(supportConfidenceOf(promoted)).toBeGreaterThan(supportConfidenceOf(control));
    expect(supportConfidenceOf(promoted) - supportConfidenceOf(control)).toBeCloseTo(8, 5);

    // And the bound holds from anywhere: a summer is not a gale.
    for (const confidence of [5, 50, 95]) {
      const club = state.clubs[state.userClubId]!;
      club.supporters.confidence = confidence;
      const landed = adjustSupporterConfidence(
        club,
        '2026-08-10',
        (50 - confidence) * 0.5 + 8,
        'A summer to think about it.',
        22,
      );
      expect(Math.abs(landed)).toBeLessThanOrEqual(22);
    }
  });
});

describe('the gate reads the crowd', () => {
  /** What a fixture would draw with a given crowd, all else equal. */
  function gate(state: GameState, match: Match, confidence: number): number {
    const home = state.clubs[match.homeClubId]!;
    const away = state.clubs[match.awayClubId]!;
    return estimateAttendance({
      home,
      away,
      ground: state.world.grounds[match.groundId]!,
      conditions: match.conditions,
      matchday: match.matchday,
      rivalryIntensity: home.rivalries[away.id]?.intensity ?? 0,
      involvesUserClub: false,
      supporterConfidence: confidence,
    });
  }

  it('draws a bigger gate for a confident club than a miserable one, by about a seventh', () => {
    const { state } = createTestGame('support-gate');
    const fixture = Object.values(state.matches)[0]!;
    prepareMatchday(state, fixture.matchday);
    const played = state.matches[fixture.id]!;

    const neutral = gate(state, played, 50);
    const keen = gate(state, played, 100);
    const miserable = gate(state, played, 0);

    expect(keen).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(miserable);
    // The actual size of it, in people: the extremes are within about a seventh of
    // what a club with no strong mood draws. A number larger than that would mean
    // the crowd, not the club, is what the attendance is measuring.
    expect(Math.abs(keen / neutral - 1)).toBeLessThan(0.15);
    expect(Math.abs(miserable / neutral - 1)).toBeLessThan(0.15);
    // And it is still a gate at a ground: never nothing, never over the rails.
    expect(miserable).toBeGreaterThanOrEqual(12);
    expect(keen).toBeLessThanOrEqual(Math.round(state.world.grounds[played.groundId]!.capacity * 1.6));
  });
});
