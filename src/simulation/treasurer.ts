import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import {
  isOfficial,
  isPlayer,
  outstandingOnLiability,
  personDisplayName,
  type Person,
} from '@/domain/person';
import { collectPlayerSubs, financeSummary } from './finance';
import { staffCompetence, staffIsAvailable } from './staff';
import { weeklySponsorshipIncome } from './sponsorship';
import { seasonEndDate, weeksRemaining } from './timeline';

/**
 * The treasurer.
 *
 * A Sunday club's money has one authority and it is not this file: the ledger in
 * `finance.ts` says what actually arrived, and the match-participation model says
 * who owes. What the club never had was *somebody accountable* for the book —
 * who holds it, what is still owed, and whether the position is worrying.
 *
 * So everything here is a thin read over systems that already own the truth.
 * Nothing is re-derived, nothing is stored twice, and nothing invents money. A
 * collection goes through `collectPlayerSubs`, which is the one place in the game
 * that turns a player's debt into club income; the treasurer merely decides *when*
 * that happens. Expenses are left entirely where they are — `applyStandingCosts`,
 * `applyMatchdayFinances` and `applyAnnualCosts` pay the club's bills through the
 * ledger, and the treasurer operates those, never a copy of them.
 *
 * A club with no treasurer is an ordinary Sunday club. The manager keeps the book
 * himself, every function below still works, and nothing about Finance changes.
 */

/* ------------------------------------------------------------------------ *
 * Who holds the book
 * ------------------------------------------------------------------------ */

export interface FinancialResponsibility {
  /** The person accountable for the club's money, or null when there is nobody. */
  personId: PersonId | null;
  name: string | null;
  /** Whether the book is held by an appointed treasurer or falls to the manager. */
  role: 'treasurer' | 'manager' | 'none';
  /** 1-20, on the same scale as every other staff judgement. 0 when unknowable. */
  competence: number;
  available: boolean;
  /** The same person is also the manager — the small-club doubling-up. */
  managerToo: boolean;
}

function competenceOf(person: Person | undefined, role: 'treasurer' | 'manager'): number {
  if (!isOfficial(person)) return 0;
  return staffCompetence(person, role);
}

/**
 * Who is responsible for the club's money.
 *
 * An appointed treasurer holds it; failing that, the manager does, as he does in
 * every club too small to have both. Only when there is nobody at all is the
 * book unheld, and even then the club keeps trading.
 */
export function financialResponsibility(
  state: GameState,
  clubId: ClubId = state.userClubId,
): FinancialResponsibility {
  const club = state.clubs[clubId];
  const none: FinancialResponsibility = {
    personId: null,
    name: null,
    role: 'none',
    competence: 0,
    available: true,
    managerToo: false,
  };
  if (!club) return none;

  const treasurerId = club.staff?.treasurerId ?? null;
  const treasurer = treasurerId ? state.people[treasurerId] : undefined;
  if (treasurer) {
    const official = isOfficial(treasurer) ? treasurer : null;
    return {
      personId: treasurer.id,
      name: personDisplayName(treasurer),
      role: 'treasurer',
      competence: competenceOf(treasurer, 'treasurer'),
      available: official ? staffIsAvailable(official) : true,
      managerToo: treasurer.id === club.managerId,
    };
  }

  const manager = club.managerId ? state.people[club.managerId] : undefined;
  if (manager) {
    const official = isOfficial(manager) ? manager : null;
    return {
      personId: manager.id,
      name: personDisplayName(manager),
      role: 'manager',
      competence: competenceOf(manager, 'treasurer'),
      available: official ? staffIsAvailable(official) : true,
      managerToo: true,
    };
  }

  return none;
}

/* ------------------------------------------------------------------------ *
 * What is owed
 * ------------------------------------------------------------------------ */

export interface OutstandingSub {
  personId: PersonId;
  name: string;
  /** Outstanding across every unpaid match liability, in pounds. */
  owed: number;
  /** How many match liabilities are still short. */
  matches: number;
  /** The oldest unpaid match, so the treasurer can see how far back it goes. */
  oldestDate: ISODate | null;
}

/**
 * Everybody at the club who owes matchday money, biggest debt first.
 *
 * This reads the liabilities off the player's own record — the same figures the
 * conversation layer is told about — and moves nothing. An unpaid sub is a player
 * debt, never club income.
 */
export function outstandingSubs(state: GameState, clubId: ClubId = state.userClubId): OutstandingSub[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const rows: OutstandingSub[] = [];

  for (const id of club.squadIds) {
    const person = state.people[id];
    if (!isPlayer(person)) continue;
    const owed = person.subs?.owed ?? 0;
    if (!(owed > 0)) continue;
    const unpaid = (person.subs?.liabilities ?? []).filter((liability) => outstandingOnLiability(liability) > 0);
    const dates = unpaid.map((liability) => liability.date).sort();
    rows.push({
      personId: person.id,
      name: personDisplayName(person),
      owed: Math.round(owed * 100) / 100,
      matches: unpaid.length || person.subs?.missedWeeks || 0,
      oldestDate: dates[0] ?? null,
    });
  }

  return rows.sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
}

/** The club's total outstanding player money, in pounds. */
export function outstandingSubsTotal(state: GameState, clubId: ClubId = state.userClubId): number {
  const total = outstandingSubs(state, clubId).reduce((sum, row) => sum + row.owed, 0);
  return Math.round(total * 100) / 100;
}

/* ------------------------------------------------------------------------ *
 * Taking money in
 * ------------------------------------------------------------------------ */

export interface CollectionResult {
  /** What actually arrived, and therefore what the ledger was credited. */
  collected: number;
  /** What is still owed afterwards. */
  owedAfter: number;
}

/**
 * Record money the manager has actually taken from a player.
 *
 * This is the treasurer confirming a collection: it delegates to
 * `collectPlayerSubs`, so the balance, the ledger line and the man's own record
 * all move together, exactly once. A part payment is fine — `amount` defaults to
 * everything he owes — and collecting more than he owes is impossible because the
 * debt is clamped. Calling it twice cannot book the same pound twice: the second
 * call finds nothing outstanding and does nothing.
 *
 * Only the club's own players can pay into its book.
 */
export function collectSubs(
  state: GameState,
  clubId: ClubId,
  playerId: PersonId,
  date: ISODate,
  amount?: number,
): CollectionResult {
  const person = state.people[playerId];
  if (!isPlayer(person) || person.clubId !== clubId) return { collected: 0, owedAfter: 0 };
  const collected = collectPlayerSubs(state, clubId, playerId, date, amount);
  const owedAfter = Math.max(0, Math.round((person.subs?.owed ?? 0) * 100) / 100);
  return { collected, owedAfter };
}

/* ------------------------------------------------------------------------ *
 * The position, and what to worry about
 * ------------------------------------------------------------------------ */

export interface FinancialConcern {
  kind: 'overdrawn' | 'tight' | 'arrears' | 'no-treasurer' | 'treasurer-away';
  tone: 'bad' | 'warn' | 'muted';
  text: string;
  /** A figure the UI can format, when the concern is about one. */
  amount?: number;
}

/**
 * The treasurer's worries, in the order they matter.
 *
 * These are readings of systems that already exist — the balance and the arrears
 * book — put into words a chairman would understand. Nothing here changes any
 * number; it is the treasurer looking at the position and saying what he sees.
 */
export function financialConcerns(state: GameState, clubId: ClubId = state.userClubId): FinancialConcern[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const concerns: FinancialConcern[] = [];

  const balance = club.finances.balance;
  if (balance < 0) {
    concerns.push({
      kind: 'overdrawn',
      tone: 'bad',
      text: 'The club is in the red — the next bill comes out of an empty account.',
      amount: balance,
    });
  } else if (balance < 120) {
    concerns.push({
      kind: 'tight',
      tone: 'warn',
      text: 'There is little room for error — a pitch hire and a referee would take most of that.',
      amount: balance,
    });
  }

  const outstanding = outstandingSubs(state, clubId);
  const total = Math.round(outstanding.reduce((sum, row) => sum + row.owed, 0) * 100) / 100;
  if (total > 0) {
    concerns.push({
      kind: 'arrears',
      tone: 'warn',
      text: `${outstanding.length} player${outstanding.length === 1 ? '' : 's'} owe matchday subs. It is owed, not banked.`,
      amount: total,
    });
  }

  const responsibility = financialResponsibility(state, clubId);
  if (responsibility.role === 'none') {
    concerns.push({
      kind: 'no-treasurer',
      tone: 'muted',
      text: 'Nobody is looking after the books. A volunteer would take that off your plate.',
    });
  } else if (!responsibility.available) {
    concerns.push({
      kind: 'treasurer-away',
      tone: 'muted',
      text: `${responsibility.name ?? 'The treasurer'} is not around this week, so the book is yours for now.`,
    });
  }

  return concerns;
}

export interface TreasurerSummary {
  responsibility: FinancialResponsibility;
  balance: number;
  income: number;
  expenditure: number;
  net: number;
  outstanding: OutstandingSub[];
  outstandingTotal: number;
  concerns: FinancialConcern[];
}

/** Everything the finance screen needs about the role, in one read. */
export function treasurerSummary(state: GameState, clubId: ClubId = state.userClubId): TreasurerSummary {
  const responsibility = financialResponsibility(state, clubId);
  const club = state.clubs[clubId];
  if (!club) {
    return {
      responsibility,
      balance: 0,
      income: 0,
      expenditure: 0,
      net: 0,
      outstanding: [],
      outstandingTotal: 0,
      concerns: [],
    };
  }
  const summary = financeSummary(club);
  const outstanding = outstandingSubs(state, clubId);
  return {
    responsibility,
    balance: club.finances.balance,
    income: summary.income,
    expenditure: summary.expenditure,
    net: summary.net,
    outstanding,
    outstandingTotal: Math.round(outstanding.reduce((sum, row) => sum + row.owed, 0) * 100) / 100,
    concerns: financialConcerns(state, clubId),
  };
}

/**
 * Where the book is heading, on the money that already runs every week.
 *
 * A treasurer can say what is in the account; the question the manager actually
 * asks is whether it will still be there in May. This is that arithmetic and
 * nothing more: the club's recurring week — the sponsor's income against the
 * pitch, the insurance and the hall on training night — carried forward over the
 * weeks the season has left.
 *
 * It is a run rate, not a prophecy, and it says so on the screen. Matchday subs,
 * a cup run and the equipment kitty are all outside it, because none of them is
 * money the club is due on a schedule: owed money is only income once it is
 * handed over. The weeks are calendar weeks rather than matchdays, because the
 * costs come round every seven days whether or not anybody plays.
 */
export interface SeasonOutlook {
  /** The recurring week: income minus outgoings. */
  weeklyNet: number;
  /** Calendar weeks left in the season — the multiplier, not the matchdays. */
  weeksLeft: number;
  /** The last date the season's calendar holds, or null when it holds none. */
  seasonEnd: ISODate | null;
  /** Where the balance lands if this week repeats until then. */
  projected: number;
}

/** One read for the two screens that ask where the money is heading. */
export function seasonOutlook(state: GameState, clubId: ClubId = state.userClubId): SeasonOutlook {
  const seasonEnd = seasonEndDate(state);
  const weeksLeft = weeksRemaining(state);
  const club = state.clubs[clubId];
  if (!club) return { weeklyNet: 0, weeksLeft, seasonEnd, projected: 0 };
  // The same week the money tiles count: the sponsor's agreement against the
  // costs that are billed every seven days. Subs are absent on purpose — they
  // are owed per match, and only the money handed over reaches the balance.
  const weeklyIn = weeklySponsorshipIncome(state, clubId);
  // The pitch is not in the weekly run rate: it is charged when the club plays
  // at home, which is a fixture cost rather than a standing one.
  const weeklyOut = club.finances.insurancePerWeek + club.finances.trainingCostPerWeek;
  const weeklyNet = Math.round((weeklyIn - weeklyOut) * 100) / 100;
  const projected = Math.round((club.finances.balance + weeklyNet * weeksLeft) * 100) / 100;
  return { weeklyNet, weeksLeft, seasonEnd, projected };
}
