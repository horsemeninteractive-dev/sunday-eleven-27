import type { ClubFinances, LedgerCategory, LedgerEntry } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import { isCompetitiveMatch, type Match, type PlayerPerformance } from '@/domain/match';
import {
  emptyPlayerSubs,
  outstandingOnLiability,
  refreshSubSummary,
  type Player,
  type PlayerSubParticipation,
  type PlayerSubLiability,
} from '@/domain/person';
import { nextId } from './ids';
import { Rng, stream } from './rng';

/** Default matchday subs, used when a club has no setting of its own. */
export const DEFAULT_STARTER_SUB = 5;
export const DEFAULT_SUBSTITUTE_SUB = 3;

/**
 * Modest financial depth: money comes in from subs, sponsorship and the gate,
 * and goes out on pitches, referees, insurance and the small stuff that adds
 * up. The point is that money has consequences, not that it is a spreadsheet.
 */

/** How many ledger lines a club keeps before the oldest are folded away. */
const LEDGER_LIMIT = 400;

export function addLedgerEntry(
  state: GameState,
  clubId: ClubId,
  entry: { date: ISODate; description: string; category: LedgerCategory; amount: number },
): LedgerEntry | null {
  const club = state.clubs[clubId];
  if (!club) return null;
  const finances: ClubFinances = club.finances;
  const rounded = Math.round(entry.amount * 100) / 100;
  finances.balance = Math.round((finances.balance + rounded) * 100) / 100;
  const line: LedgerEntry = {
    id: nextId(state, 'ledger'),
    date: entry.date,
    description: entry.description,
    category: entry.category,
    amount: rounded,
    balanceAfter: finances.balance,
  };
  finances.ledger.push(line);
  // The book is capped so a long career cannot grow it without limit, but the
  // arithmetic must still add up: whatever is dropped is folded into the
  // opening balance, so `balance === openingBalance + sum(ledger)` holds for
  // ever. Nothing is double-counted and nothing is lost.
  if (finances.ledger.length > LEDGER_LIMIT) {
    const dropped = finances.ledger.splice(0, finances.ledger.length - LEDGER_LIMIT);
    const droppedTotal = dropped.reduce((sum, line) => sum + line.amount, 0);
    finances.openingBalance = Math.round(((finances.openingBalance ?? 0) + droppedTotal) * 100) / 100;
  }
  return line;
}

/**
 * Recompute the balance from the books: opening balance plus every recorded
 * transaction. This is the audit the club's finances must always pass — the
 * stored balance is only ever moved here, through `addLedgerEntry`.
 */
export function reconcileBalance(finances: ClubFinances): number {
  const history = finances.ledger.reduce((sum, line) => sum + line.amount, 0);
  return Math.round(((finances.openingBalance ?? 0) + history) * 100) / 100;
}

/** True when the stored balance and the ledger agree. */
export function ledgerBalances(finances: ClubFinances): boolean {
  return Math.abs(finances.balance - reconcileBalance(finances)) < 0.005;
}

export interface FinanceReport {
  income: number;
  expenditure: number;
  balance: number;
}

/**
 * Money moves on the day it actually moves.
 *
 * Player subs are a matchday liability now: raised from the Match Engine's own
 * participation record when a fixture is completed, and collected when a man
 * actually pays. Standing costs run on their weekly Wednesday, everything else
 * (gate money, referee fees, travel, a training pitch, a session moved indoors)
 * is dated by the event that caused it, and the sponsor's instalment is booked
 * by the sponsorship service on the payday its own agreement sets.
 */

/* ------------------------------------------------------------------------ *
 * Matchday subs: a liability created by the match, not a weekly squad tax
 * ------------------------------------------------------------------------ */

/**
 * Which subs category a performance falls into, straight off the engine.
 *
 * The engine writes a performance for every man it put on the pitch *and* every
 * man it named among the substitutes. That is what makes the two facts
 * distinguishable without Finance deciding anything: `started` is a starter, a
 * non-starter with a `cameOnMinute` came on, and a non-starter without one was
 * named but never used. A man who was neither is not in the record at all, so he
 * never reaches here.
 */
export function participationCategory(performance: PlayerPerformance): PlayerSubParticipation | null {
  if (performance.started) return 'starter';
  if (performance.cameOnMinute !== null) return 'substitute';
  return null;
}

/** What a club charges for a given participation category. */
export function subAmountFor(finances: ClubFinances, category: PlayerSubParticipation): number {
  const configured = category === 'starter' ? finances.starterSubAmount : finances.substituteSubAmount;
  const fallback = category === 'starter' ? DEFAULT_STARTER_SUB : DEFAULT_SUBSTITUTE_SUB;
  const amount = typeof configured === 'number' ? configured : fallback;
  return amount > 0 ? amount : 0;
}

/**
 * Raise the matchday liabilities for one completed match.
 *
 * This consumes the Match Engine's participation record and nothing else. A man
 * is charged because the engine says he played, never because he is on the
 * squad list: the unused substitute, the unselected player and the unavailable
 * one are simply absent from the record and are charged nothing.
 *
 * The liability id is `<matchId>:<playerId>`, so running this twice over the
 * same completed match is a no-op rather than a second charge.
 */
export function recordMatchdaySubs(state: GameState, match: Match): PlayerSubLiability[] {
  const created: PlayerSubLiability[] = [];
  if (!match.result) return created;

  for (const performance of Object.values(match.performances)) {
    const category = participationCategory(performance);
    if (!category) continue;
    const club = state.clubs[performance.clubId];
    const person = state.people[performance.playerId];
    if (!club || !person || person.kind !== 'player') continue;

    ensurePlayerSubs(person);
    const id = `${match.id}:${person.id}`;
    const liabilities = person.subs.liabilities ?? (person.subs.liabilities = []);
    if (liabilities.some((liability) => liability.id === id)) continue;

    const amount = subAmountFor(club.finances, category);
    if (amount <= 0) continue;

    const liability: PlayerSubLiability = {
      id,
      matchId: match.id,
      date: match.date,
      category,
      amount,
      paid: 0,
      paidOn: null,
    };
    liabilities.push(liability);
    refreshSubSummary(person.subs);
    created.push(liability);
  }

  return created;
}

/**
 * Settle a completed match: raise the liabilities, then let the men who are
 * good for it hand the money over on the day.
 *
 * This replaces the old Friday book. There is no squad-wide assessment and no
 * income independent of a match: money comes in only from men the engine says
 * played, and only when they actually pay. A man's reliability and the club's
 * own strain decide whether he hands it over now or carries it, on the same
 * named stream every time, so a career reproduces its own book.
 */
export function settleMatchdaySubs(state: GameState, match: Match): { liabilities: PlayerSubLiability[]; income: number } {
  const liabilities = recordMatchdaySubs(state, match);
  let income = 0;

  for (const performance of Object.values(match.performances)) {
    if (!participationCategory(performance)) continue;
    const person = state.people[performance.playerId];
    if (!person || person.kind !== 'player' || !person.clubId) continue;
    ensurePlayerSubs(person);
    if (person.subs.owed <= 0) continue;

    const clubId = person.clubId;
    const rng = stream(state.seed, 'subs', clubId, person.id, match.id);
    const reliability = person.attributes.behavioural.reliability / 20;
    // A club that has not paid its own bills is in no position to chase anybody,
    // and the man most likely to stop paying is the one already behind.
    const clubStrained = (state.clubs[clubId]?.finances.balance ?? 0) < 0;
    const pressure = person.subs.owed > 0 ? 0.88 : 1;
    const chance = Math.min(0.97, (0.72 + reliability * 0.22) * pressure * (clubStrained ? 0.97 : 1));
    if (!rng.chance(chance)) continue;

    const collected = collectPlayerSubs(state, clubId, person.id, match.date);
    income += collected;
  }

  return { liabilities, income: Math.round(income * 100) / 100 };
}

/**
 * Settle one man's debt by hand — the treasurer taking cash on a Sunday.
 *
 * Goes through `addLedgerEntry`, so the balance, the ledger line and his record
 * all move together. This is the only other thing in the game that may clear a
 * liability, and it exists because a real manager has a cash tin.
 *
 * Payment is applied oldest liability first, and a part payment is allowed: a
 * man with £5 from Match A and £3 from Match B who hands over £5 settles Match
 * A in full and still owes £3, because the liabilities are kept apart rather
 * than merged into one number. `amount` defaults to everything he owes.
 */
export function collectPlayerSubs(
  state: GameState,
  clubId: ClubId,
  playerId: PersonId,
  date: ISODate,
  amount?: number,
): number {
  const club = state.clubs[clubId];
  const person = state.people[playerId];
  if (!club || !person || person.kind !== 'player') return 0;
  ensurePlayerSubs(person);

  const target = Math.min(amount === undefined ? person.subs.owed : amount, person.subs.owed);
  if (!(target > 0)) return 0;

  let remaining = target;
  const liabilities = [...(person.subs.liabilities ?? [])].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
  for (const liability of liabilities) {
    if (remaining <= 0) break;
    const due = outstandingOnLiability(liability);
    if (due <= 0) continue;
    const paid = Math.min(due, remaining);
    liability.paid = Math.round((liability.paid + paid) * 100) / 100;
    if (outstandingOnLiability(liability) <= 0) liability.paidOn = date;
    remaining = Math.round((remaining - paid) * 100) / 100;
  }

  // A save written before liabilities existed can still carry a bare `owed`.
  // Whatever could not be applied to a real liability reduces it directly, so
  // the old book is not ignored on the first collection. Every penny of `target`
  // was applied one way or the other, so that is what actually arrived.
  if (remaining > 0) person.subs.owed = Math.round((person.subs.owed - remaining) * 100) / 100;
  const collected = target;

  const entry = addLedgerEntry(state, clubId, {
    date,
    description: `Subs from ${person.firstName} ${person.surname}`,
    category: 'subs',
    amount: collected,
  });
  person.subs.payments = [
    ...(person.subs.payments ?? []),
    { id: nextId(state, 'subpayment'), date, amount: collected },
  ];
  person.subs.lastPaidOn = date;
  refreshSubSummary(person.subs);
  return entry?.amount ?? collected;
}

/** Give a player the record if a save predates it. Never invents a debt. */
export function ensurePlayerSubs(player: Player): void {
  if (!player.subs) {
    // A save written before subs were tracked had every player paying in full,
    // because the ledger said they had. Giving anybody an opening balance would
    // be inventing a debt the club never recorded.
    player.subs = emptyPlayerSubs();
    return;
  }
  if (!player.subs.liabilities) player.subs.liabilities = [];
  if (!player.subs.payments) player.subs.payments = [];
  if (typeof player.subs.owed !== 'number') player.subs.owed = 0;
  if (typeof player.subs.missedWeeks !== 'number') player.subs.missedWeeks = 0;
  if (player.subs.lastPaidOn === undefined) player.subs.lastPaidOn = null;
}

/** Wednesday: insurance and the small things that add up. */
export function applyStandingCosts(state: GameState, clubId: ClubId, date: ISODate): FinanceReport {
  const club = state.clubs[clubId];
  if (!club) return { income: 0, expenditure: 0, balance: 0 };
  const finances = club.finances;
  let expenditure = 0;

  // The ground is not a weekly bill. A club pays for its pitch on the days it
  // actually plays at home, so nothing for it is charged here: a week with no
  // home fixture costs it nothing for a pitch it never used. The ground side of
  // a fixture is priced by `matchdayCosts` and billed with that fixture.
  const insurance = addLedgerEntry(state, clubId, {
    date,
    description: 'Insurance (weekly)',
    category: 'insurance',
    amount: -finances.insurancePerWeek,
  });
  expenditure += Math.abs(insurance?.amount ?? 0);

  // Balls go missing, nets need replacing, someone's boots need paying for.
  const equipmentRng = stream(state.seed, 'equipment', state.season.id, clubId, date);
  const equipment = addLedgerEntry(state, clubId, {
    date,
    description: equipmentRng.pick([
      'Balls, bibs and a new pump',
      'Replacement net for the far goal',
      'Physio kit and strapping',
      'Line marking paint',
      'Water bottles and oranges',
    ]),
    category: 'equipment',
    amount: -equipmentRng.int(6, 22),
  });
  expenditure += Math.abs(equipment?.amount ?? 0);

  return { income: 0, expenditure: Math.round(expenditure), balance: finances.balance };
}

/* ------------------------------------------------------------------------ *\
 * What a fixture costs, before it is played
 * ------------------------------------------------------------------------ */

/** The referee's fee for a fixture, before it is split between the two clubs. */
export const REFEREE_FEE_WITH_OFFICIAL = 46;
export const REFEREE_FEE_BARE = 30;

/** What a fixture will cost one club: the referee, the ground, the travel. */
export interface MatchdayCosts {
  /** This club's half of the referee. */
  referee: number;
  /** The ground, for the home club only: its own pitch, or the hire of somebody else's. */
  groundHire: number;
  /** Fuel money, for the away club only. */
  travel: number;
}

/**
 * The costs a fixture carries, worked out the same way it is charged.
 *
 * Both the ledger (below) and the treasurer's forward look (`obligations.ts`)
 * read this one function, so what the club is told it will owe and what it is
 * actually billed cannot drift apart. It reads state and returns numbers; it
 * writes nothing and is safe to call on a fixture that has not been played.
 */
export function matchdayCosts(state: GameState, match: Match, clubId: ClubId): MatchdayCosts {
  const referee = (match.refereeId ? REFEREE_FEE_WITH_OFFICIAL : REFEREE_FEE_BARE) / 2;

  // The ground is paid for on the day it is used, by the club that uses it. The
  // home club pays its own pitch cost when it plays at its own ground, and what
  // the ground charges for the fixture when it is borrowing somebody else's.
  const ground = state.world.grounds[match.groundId];
  let groundHire = 0;
  if (match.homeClubId === clubId && ground) {
    groundHire =
      ground.tenantClubId === match.homeClubId
        ? (state.clubs[clubId]?.finances.weeklyGroundCost ?? 0)
        : ground.matchdayCost;
  }

  let travel = 0;
  if (match.awayClubId === clubId) {
    const home = state.clubs[match.homeClubId];
    const away = state.clubs[match.awayClubId];
    const homeTown = home ? state.world.towns[home.townId] : undefined;
    const awayTown = away ? state.world.towns[away.townId] : undefined;
    if (homeTown && awayTown) {
      // 45p a mile, split across a couple of cars.
      const km = Math.hypot(homeTown.x - awayTown.x, homeTown.y - awayTown.y) * 0.45;
      travel = Math.round(km * 1.4 + 8);
    }
  }

  return { referee, groundHire, travel };
}

/** Matchday money: gate, clubhouse, referee fees, travel and fines. */
export function applyMatchdayFinances(state: GameState, match: Match): FinanceReport {
  const report: FinanceReport = { income: 0, expenditure: 0, balance: 0 };
  if (!match.result) return report;
  // A friendly is a run-out, not a payday: nobody pays at the gate in July to
  // watch a warm-up, and the matchday money belongs to the league's fixtures.
  if (!isCompetitiveMatch(state, match)) return report;

  const ground = state.world.grounds[match.groundId];
  const attendance = match.result.attendance;
  // Grassroots gate money: a couple of quid a head plus whatever the clubhouse
  // takes over the bar.
  const gateIncome = Math.round(attendance * 1.6);
  const clubhouseIncome = Math.round(attendance * (ground?.hasClubhouse ? 1.1 : 0.4));

  const home = addLedgerEntry(state, match.homeClubId, {
    date: match.date,
    description: `Gate receipts (${attendance} through the gate)`,
    category: 'matchday',
    amount: gateIncome,
  });
  const bar = addLedgerEntry(state, match.homeClubId, {
    date: match.date,
    description: 'Clubhouse takings',
    category: 'matchday',
    amount: clubhouseIncome,
  });
  report.income += (home?.amount ?? 0) + (bar?.amount ?? 0);

  const costs = matchdayCosts(state, match, match.homeClubId);
  if (costs.groundHire > 0) {
    addLedgerEntry(state, match.homeClubId, {
      date: match.date,
      description: `Ground hire — ${ground?.name ?? 'the ground'}`,
      category: 'pitch-hire',
      amount: -costs.groundHire,
    });
    report.expenditure += costs.groundHire;
  }

  // Referee fees are split between the two clubs.
  for (const clubId of [match.homeClubId, match.awayClubId]) {
    addLedgerEntry(state, clubId, {
      date: match.date,
      description: 'Referee fee (half share)',
      category: 'referee',
      amount: -costs.referee,
    });
    report.expenditure += costs.referee;
  }

  const awayCosts = matchdayCosts(state, match, match.awayClubId);
  if (awayCosts.travel > 0) {
    addLedgerEntry(state, match.awayClubId, {
      date: match.date,
      description: 'Away travel costs',
      category: 'other',
      amount: -awayCosts.travel,
    });
    report.expenditure += awayCosts.travel;
  }

  // Fines for cards keep the league honest and the treasurer grumpy.
  for (const performance of Object.values(match.performances)) {
    const cards = performance.yellowCards + performance.redCards * 2;
    if (cards === 0) continue;
    const fine = cards * 6 + performance.redCards * 15;
    addLedgerEntry(state, performance.clubId, {
      date: match.date,
      description: `League fines for ${cards} card${cards > 1 ? 's' : ''}`,
      category: 'fines',
      amount: -fine,
    });
    report.expenditure += fine;
  }

  const club = state.clubs[match.homeClubId];
  report.balance = club?.finances.balance ?? 0;
  return report;
}

export function applyAnnualCosts(state: GameState, clubId: ClubId, rng: Rng): void {
  const club = state.clubs[clubId];
  if (!club) return;
  addLedgerEntry(state, clubId, {
    date: state.date,
    description: 'League registration fee',
    category: 'league-fee',
    amount: -club.finances.annualLeagueFee,
  });
  addLedgerEntry(state, clubId, {
    date: state.date,
    description: 'Kit, balls and equipment',
    category: 'equipment',
    amount: -rng.int(45, 120),
  });
  // A winter's pitch repairs and ground upkeep, scaled to what the ground costs
  // to hire — the club with the expensive pitch is the one that feels it.
  addLedgerEntry(state, clubId, {
    date: state.date,
    description: 'Winter pitch repairs and ground upkeep',
    category: 'pitch-hire',
    amount: -Math.round(club.finances.weeklyGroundCost * rng.float(3, 7)),
  });
  // Running a squad has a cost that a club cannot avoid: kit, travel, physio and
  // the small expenses players claim back. This is the line that makes money a
  // risk rather than a scoreboard that only rises.
  addLedgerEntry(state, clubId, {
    date: state.date,
    description: `Players' expenses (${club.squadIds.length} players)`,
    category: 'other',
    amount: -club.squadIds.length * rng.int(9, 20),
  });
}

export function financeSummary(club: { finances: ClubFinances }): { income: number; expenditure: number; net: number } {
  const recent = club.finances.ledger.slice(-40);
  const income = recent.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0);
  const expenditure = Math.abs(recent.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0));
  return { income: Math.round(income), expenditure: Math.round(expenditure), net: Math.round(income - expenditure) };
}
