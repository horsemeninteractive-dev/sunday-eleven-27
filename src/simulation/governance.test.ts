import { describe, expect, it } from 'vitest';
import type { ClubHistory } from '@/domain/club';
import { isOfficial } from '@/domain/person';
import { attitudeOf, relationshipIdFor } from '@/domain/relationship';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays } from './calendar';
import { addLedgerEntry, ledgerBalances } from './finance';
import {
  applyGovernanceDismissal,
  clubChairman,
  clubExpectations,
  failureStreak,
  governanceCanDismiss,
  governanceConcerns,
  governanceStore,
  governanceSummary,
  requestChairmanBacking,
  runGovernance,
  type GovernanceContext,
} from './governance';
import { getRelationship, relationshipStore } from './relationships';
import { runSecretary, secretaryStore } from './secretary';
import { createTestGame, type TestGame } from './testSupport';

/* ------------------------------------------------------------------------ *\
 * Helpers
 * ------------------------------------------------------------------------ */

type State = TestGame['state'];

function userClub(state: State) {
  return state.clubs[state.userClubId]!;
}

function managerId(state: State): string {
  return userClub(state).managerId!;
}

/** Put a finished season in the club's archive, so the committee has something to judge. */
function recordSeason(
  state: State,
  options: { seasonId: string; seasonLabel: string; position: number; tier?: number },
): void {
  const record: ClubHistory['seasons'][number] = {
    seasonId: options.seasonId,
    seasonLabel: options.seasonLabel,
    competitionName: 'Stour Valley Sunday League Division One',
    tier: options.tier ?? 1,
    played: 22,
    won: 4,
    drawn: 4,
    lost: 14,
    goalsFor: 24,
    goalsAgainst: 58,
    points: 16,
    finalPosition: options.position,
  };
  userClub(state).history.seasons.unshift(record);
}

function contextFor(state: State, previousSeasonId = 'season_prev', previousSeasonLabel = '2025/26'): GovernanceContext {
  return {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    seasonStart: state.date,
    previousSeasonId,
    previousSeasonLabel,
  };
}

function matchFingerprint(state: State): string {
  return Object.values(state.matches)
    .map((match) => `${match.id}:${match.date}:${match.status}:${match.played}:${match.homeClubId}:${match.awayClubId}`)
    .sort()
    .join('|');
}

function seasonBounds(state: State): { first: string; last: string } {
  const calendar = state.season.calendar;
  return {
    first: calendar[0]?.date ?? state.season.startDate,
    last: calendar[calendar.length - 1]?.date ?? state.season.endDate,
  };
}

/** Put the club in debt the honest way — through the treasurer's own ledger. */
function setBalance(state: State, target: number): void {
  const club = userClub(state);
  const delta = Math.round((target - club.finances.balance) * 100) / 100;
  if (delta === 0) return;
  addLedgerEntry(state, club.id, {
    date: state.date,
    description: 'Test adjustment',
    category: 'other',
    amount: delta,
  });
}

/* ------------------------------------------------------------------------ *\
 * The chairman is a person
 * ------------------------------------------------------------------------ */

describe('the chairman is a real person', () => {
  it('is an official on the club, not a disembodied opinion', () => {
    const game = createTestGame('gov-chairman');
    const chairman = clubChairman(game.state);

    expect(chairman).not.toBeNull();
    expect(chairman!.kind).toBe('official');
    expect(chairman!.role).toBe('chairman');
    expect(userClub(game.state).chairmanId).toBe(chairman!.id);
    // The same record the rest of the world reads.
    expect(game.state.people[chairman!.id]).toBe(chairman);
    expect(typeof chairman!.patience).toBe('number');
  });
});

/* ------------------------------------------------------------------------ *\
 * Expectations
 * ------------------------------------------------------------------------ */

describe('expectations are read off the club as it stands', () => {
  it('derives a set of expectations from the club, not from a stored score', () => {
    const game = createTestGame('gov-expectations');
    const expectations = clubExpectations(game.state);

    expect(expectations.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['league', 'finances', 'stability', 'squad', 'reputation']),
    );
    // A generated club starts solvent with a full squad.
    expect(expectations.find((entry) => entry.key === 'finances')!.status).toBe('met');
    expect(expectations.find((entry) => entry.key === 'squad')!.status).toBe('met');
    // No football played yet, so the league expectation is not yet decided.
    expect(expectations.find((entry) => entry.key === 'league')!.status).toBe('pending');
  });

  it('moves when the club’s state moves', () => {
    const game = createTestGame('gov-expectations-change');
    userClub(game.state).finances.balance = -2000;
    const financed = clubExpectations(game.state).find((entry) => entry.key === 'finances')!;
    expect(financed.status).toBe('failed');

    userClub(game.state).finances.balance = 500;
    expect(clubExpectations(game.state).find((entry) => entry.key === 'finances')!.status).toBe('met');
  });
});

/* ------------------------------------------------------------------------ *\
 * Reactions go through the relationship the two men already share
 * ------------------------------------------------------------------------ */

describe('the chairman reacts through the existing relationship', () => {
  it('turns cooler on the manager after a poor season', () => {
    const game = createTestGame('gov-results');
    const chairman = clubChairman(game.state)!;
    const manager = managerId(game.state);
    // Whatever the two already think of each other, remember it.
    const before = getRelationship(game.state, manager, chairman.id);
    const tensionBefore = before ? (attitudeOf(before, chairman.id)?.tension ?? 0) : 0;
    // A club in the red and far below where its standing says it belongs: a
    // season the committee cannot like.
    setBalance(game.state, -3000);
    recordSeason(game.state, { seasonId: 'season_prev', seasonLabel: '2025/26', position: 20 });

    runGovernance(game.state, contextFor(game.state));

    const record = getRelationship(game.state, manager, chairman.id)!;
    const chairmanView = attitudeOf(record, chairman.id)!;
    // A poor season makes the chairman cooler on the manager than he was.
    expect(chairmanView.tension).toBeGreaterThan(tensionBefore);
    expect(['warning', 'pressure']).toContain(governanceStore(game.state).standing);
  });

  it('keeps one relationship record for the pair, however often it reacts', () => {
    const game = createTestGame('gov-one-relationship');
    const chairman = clubChairman(game.state)!;
    const manager = managerId(game.state);
    recordSeason(game.state, { seasonId: 'season_a', seasonLabel: '2025/26', position: 10 });

    runGovernance(game.state, contextFor(game.state, 'season_a', '2025/26'));
    runGovernance(game.state, contextFor(game.state, 'season_a', '2025/26'));

    const store = relationshipStore(game.state);
    const between = Object.values(store.byId).filter(
      (record) =>
        (record.personAId === chairman.id && record.personBId === manager) ||
        (record.personAId === manager && record.personBId === chairman.id),
    );
    expect(between).toHaveLength(1);
    expect(between[0]!.id).toBe(relationshipIdFor(chairman.id, manager));
  });
});

/* ------------------------------------------------------------------------ *\
 * Concerns
 * ------------------------------------------------------------------------ */

describe('financial trouble reaches the chairman', () => {
  it('raises a financial concern when the club is deep in the red', () => {
    const game = createTestGame('gov-finance-concern');
    expect(governanceConcerns(game.state).some((concern) => concern.kind === 'finances')).toBe(false);

    userClub(game.state).finances.balance = -1500;
    const concerns = governanceConcerns(game.state);
    expect(concerns.some((concern) => concern.kind === 'finances')).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * The AGM runs through the secretary's desk
 * ------------------------------------------------------------------------ */

describe('the AGM uses the secretary’s own calendar-derived item', () => {
  it('records the club AGM from the letter the secretary already holds', () => {
    const game = createTestGame('gov-agm');
    const { last } = seasonBounds(game.state);
    // The secretary posts the club AGM near the end of the season, dated off
    // the calendar's own last fixture — not off a second calendar we made here.
    runSecretary(game.state, addDays(last, 5));
    const adminAgm = secretaryStore(game.state).events.find(
      (event) => event.key === `admin:club-agm:${game.state.season.id}`,
    );
    expect(adminAgm).toBeDefined();
    expect(adminAgm!.date).toBe(addDays(last, 5));

    const outcome = runGovernance(
      game.state,
      contextFor(game.state, game.state.season.id, game.state.season.label),
    );

    const govAgm = outcome.recorded.find((event) => event.kind === 'agm');
    expect(govAgm).toBeDefined();
    // Same day, same business: the governance record reads the secretary's item
    // rather than inventing an AGM of its own.
    expect(govAgm!.date).toBe(adminAgm!.date);
    expect(govAgm!.detail).toContain(adminAgm!.detail);
  });
});

/* ------------------------------------------------------------------------ *\
 * It persists
 * ------------------------------------------------------------------------ */

describe('the governance record survives a save', () => {
  it('carries the standing and the events through serialisation', () => {
    const game = createTestGame('gov-save');
    setBalance(game.state, -3000);
    recordSeason(game.state, { seasonId: 'season_prev', seasonLabel: '2025/26', position: 20 });
    runGovernance(game.state, contextFor(game.state));

    const before = governanceStore(game.state);
    expect(before.events.length).toBeGreaterThan(0);
    const beforeKeys = before.events.map((event) => event.key).sort();

    const restored = deserialiseGame(serialiseGame(game.state));
    expect(restored.error).toBeNull();
    const after = governanceStore(restored.state!);
    expect(after.standing).toBe(before.standing);
    expect(after.events.map((event) => event.key).sort()).toEqual(beforeKeys);
  });
});

/* ------------------------------------------------------------------------ *\
 * Nobody in the chair
 * ------------------------------------------------------------------------ */

describe('a club with nobody in the chair, or a new man in it', () => {
  it('takes no view at all when there is no chairman', () => {
    const game = createTestGame('gov-no-chairman');
    userClub(game.state).chairmanId = null;
    recordSeason(game.state, { seasonId: 'season_prev', seasonLabel: '2025/26', position: 20 });

    const outcome = runGovernance(game.state, contextFor(game.state));

    expect(outcome.recorded).toHaveLength(0);
    expect(outcome.events).toHaveLength(0);
    expect(governanceStore(game.state).events).toHaveLength(0);
  });

  it('forms the relationship with whoever is actually in the chair', () => {
    const game = createTestGame('gov-new-chairman');
    const club = userClub(game.state);
    const oldChairman = club.chairmanId!;
    const replacement = Object.values(game.state.people).find(
      (person) => isOfficial(person) && person.role === 'chairman' && person.id !== oldChairman,
    );
    expect(replacement).toBeDefined();
    club.chairmanId = replacement!.id;
    recordSeason(game.state, { seasonId: 'season_prev', seasonLabel: '2025/26', position: 20 });

    runGovernance(game.state, contextFor(game.state));

    const manager = managerId(game.state);
    const record = getRelationship(game.state, manager, replacement!.id);
    expect(record).toBeDefined();
    expect([record!.personAId, record!.personBId]).toContain(replacement!.id);
  });
});

/* ------------------------------------------------------------------------ *\
 * It reads the football; it does not rewrite it
 * ------------------------------------------------------------------------ */

describe('governance does not touch the football or the books', () => {
  it('leaves the fixtures and every ledger exactly where they were', () => {
    const game = createTestGame('gov-read-only');
    setBalance(game.state, -3000);
    recordSeason(game.state, { seasonId: 'season_prev', seasonLabel: '2025/26', position: 20 });

    const fixtures = matchFingerprint(game.state);
    for (const club of Object.values(game.state.clubs)) {
      expect(ledgerBalances(club.finances)).toBe(true);
    }

    runGovernance(game.state, contextFor(game.state));

    expect(matchFingerprint(game.state)).toBe(fixtures);
    for (const club of Object.values(game.state.clubs)) {
      expect(ledgerBalances(club.finances)).toBe(true);
    }
  });

  it('reads out as a summary without writing anything of its own', () => {
    const game = createTestGame('gov-summary');
    const before = JSON.stringify(governanceStore(game.state));
    const summary = governanceSummary(game.state);
    expect(summary.chairman).not.toBeNull();
    expect(summary.expectations.length).toBeGreaterThan(0);
    expect(JSON.stringify(governanceStore(game.state))).toBe(before);
  });
});

/* ------------------------------------------------------------------------ *\
 * Rare intervention
 * ------------------------------------------------------------------------ */

describe('the chairman can dig the club out — rarely, and within limits', () => {
  it('does nothing when there is no need', () => {
    const game = createTestGame('gov-backing-noneed');
    setBalance(game.state, 500);
    expect(requestChairmanBacking(game.state).reason).toBe('no-need');
  });

  it('cannot act without a chairman', () => {
    const game = createTestGame('gov-backing-nochair');
    setBalance(game.state, -400);
    userClub(game.state).chairmanId = null;
    expect(requestChairmanBacking(game.state).reason).toBe('no-chairman');
  });

  it('helps at most once a season, and never invents free money', () => {
    const game = createTestGame('gov-backing-once');
    const club = userClub(game.state);
    setBalance(game.state, -400);
    const before = club.finances.balance;

    const first = requestChairmanBacking(game.state);
    if (first.granted) {
      expect(first.amount).toBeGreaterThan(0);
      // Bounded by the debt — never a blank cheque.
      expect(first.amount).toBeLessThanOrEqual(400);
      expect(club.finances.balance).toBeCloseTo(before + first.amount, 5);
    } else {
      expect(first.amount).toBe(0);
      expect(club.finances.balance).toBe(before);
    }

    // Whatever he decided, the pocket is shut for the rest of the season: the
    // ledger cannot move again on a second ask.
    const balanceAfterFirst = club.finances.balance;
    const second = requestChairmanBacking(game.state);
    // A grant big enough to clear the debt simply leaves nothing to ask for.
    expect(second.reason).toBe(balanceAfterFirst >= 0 ? 'no-need' : 'already-asked');
    expect(second.amount).toBe(0);
    expect(club.finances.balance).toBe(balanceAfterFirst);
  });

  it('moves money only through the treasurer’s ledger', () => {
    const game = createTestGame('gov-backing-ledger');
    const club = userClub(game.state);
    setBalance(game.state, -400);
    const fixtures = matchFingerprint(game.state);
    const lines = club.finances.ledger.length;

    const result = requestChairmanBacking(game.state);

    if (result.granted) expect(club.finances.ledger.length).toBe(lines + 1);
    else expect(club.finances.ledger.length).toBe(lines);
    expect(ledgerBalances(club.finances)).toBe(true);
    expect(matchFingerprint(game.state)).toBe(fixtures);
  });
});

/* ------------------------------------------------------------------------ *\
 * The brink
 * ------------------------------------------------------------------------ */

describe('the committee only parts ways after persistent failure', () => {
  it('will not dismiss on one bad season', () => {
    const game = createTestGame('gov-dismiss-one');
    setBalance(game.state, -3000);
    recordSeason(game.state, { seasonId: 'season_prev', seasonLabel: '2025/26', position: 20 });
    runGovernance(game.state, contextFor(game.state));

    expect(failureStreak(game.state, game.clubId)).toBe(1);
    expect(governanceCanDismiss(game.state)).toBe(false);
  });

  it('reaches the brink after a sustained run below expectation', () => {
    const game = createTestGame('gov-dismiss-run');
    recordSeason(game.state, { seasonId: 'season_3', seasonLabel: '2024/25', position: 20 });
    recordSeason(game.state, { seasonId: 'season_2', seasonLabel: '2023/24', position: 20 });
    recordSeason(game.state, { seasonId: 'season_1', seasonLabel: '2022/23', position: 20 });
    expect(failureStreak(game.state, game.clubId)).toBe(3);

    governanceStore(game.state).standing = 'pressure';
    expect(governanceCanDismiss(game.state)).toBe(true);

    const recorded = applyGovernanceDismissal(game.state);
    expect(recorded).not.toBeNull();
    expect(recorded!.kind).toBe('dismissal');
    expect(governanceStore(game.state).standing).toBe('dismissal');
    expect(userClub(game.state).history.notableEvents[0]!.description).toContain('manager');
  });

  it('cannot dismiss without the standing to do it', () => {
    const game = createTestGame('gov-dismiss-standing');
    recordSeason(game.state, { seasonId: 'season_2', seasonLabel: '2024/25', position: 20 });
    recordSeason(game.state, { seasonId: 'season_1', seasonLabel: '2023/24', position: 20 });
    recordSeason(game.state, { seasonId: 'season_0', seasonLabel: '2022/23', position: 20 });
    governanceStore(game.state).standing = 'warning';
    expect(governanceCanDismiss(game.state)).toBe(false);
  });
});
