import type { ClubFinances, LedgerCategory, LedgerEntry } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import { nextId } from './ids';
import { Rng, stream } from './rng';

/**
 * Modest financial depth: money comes in from subs, sponsorship and the gate,
 * and goes out on pitches, referees, insurance and the small stuff that adds
 * up. The point is that money has consequences, not that it is a spreadsheet.
 */

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
  if (finances.ledger.length > 400) finances.ledger.splice(0, finances.ledger.length - 400);
  return line;
}

export interface FinanceReport {
  income: number;
  expenditure: number;
  balance: number;
}

/**
 * Money moves on the day it actually moves.
 *
 * The club's finances used to be settled by one weekly tick, which meant the
 * balance lurched every time the week advanced and nothing could be said about
 * *when* the subs came in. Now there are two dated rounds — the subs book on a
 * Friday, the standing costs on a Wednesday — and everything else (gate money,
 * referee fees, travel, a session moved indoors) is dated by the event that
 * caused it.
 */

/** Friday: the subs book and the sponsor's weekly instalment. */
export function applySubsAndSponsorship(state: GameState, clubId: ClubId, date: ISODate): FinanceReport {
  const club = state.clubs[clubId];
  if (!club) return { income: 0, expenditure: 0, balance: 0 };
  const finances = club.finances;
  const payingPlayers = club.squadIds.filter((id) => state.people[id]?.kind === 'player').length;
  let income = 0;

  const subs = addLedgerEntry(state, clubId, {
    date,
    description: `Player subs (${payingPlayers} players)`,
    category: 'subs',
    amount: payingPlayers * finances.subscriptionPerPlayer,
  });
  income += subs?.amount ?? 0;

  if (finances.sponsorIncomePerWeek > 0) {
    const sponsor = addLedgerEntry(state, clubId, {
      date,
      description: 'Sponsorship instalment',
      category: 'sponsorship',
      amount: finances.sponsorIncomePerWeek,
    });
    income += sponsor?.amount ?? 0;
  }

  return { income: Math.round(income), expenditure: 0, balance: finances.balance };
}

/** Wednesday: pitch hire, insurance and the small things that add up. */
export function applyStandingCosts(state: GameState, clubId: ClubId, date: ISODate): FinanceReport {
  const club = state.clubs[clubId];
  if (!club) return { income: 0, expenditure: 0, balance: 0 };
  const finances = club.finances;
  let expenditure = 0;

  const ground = addLedgerEntry(state, clubId, {
    date,
    description: 'Weekly pitch hire',
    category: 'pitch-hire',
    amount: -finances.weeklyGroundCost,
  });
  expenditure += Math.abs(ground?.amount ?? 0);

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

/**
 * Both rounds in one call, for callers that genuinely want a whole week at once
 * (the compatibility `advanceWeek`, and tests that think weekly).
 */
export function applyWeeklyFinances(state: GameState, clubId: ClubId): FinanceReport {
  const income = applySubsAndSponsorship(state, clubId, state.date);
  const costs = applyStandingCosts(state, clubId, state.date);
  return {
    income: income.income,
    expenditure: costs.expenditure,
    balance: state.clubs[clubId]?.finances.balance ?? 0,
  };
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

  if (ground && ground.tenantClubId !== match.homeClubId) {
    addLedgerEntry(state, match.homeClubId, {
      date: match.date,
      description: `Ground hire — ${ground.name}`,
      category: 'pitch-hire',
      amount: -ground.matchdayCost,
    });
    report.expenditure += ground.matchdayCost;
  }

  // Referee fees are split between the two clubs.
  const refereeFee = match.refereeId ? 46 : 30;
  for (const clubId of [match.homeClubId, match.awayClubId]) {
    addLedgerEntry(state, clubId, {
      date: match.date,
      description: 'Referee fee (half share)',
      category: 'referee',
      amount: -refereeFee / 2,
    });
    report.expenditure += refereeFee / 2;
  }

  // Away travel: fuel money at 45p a mile, split across a couple of cars.
  const homeClub = state.clubs[match.homeClubId];
  const awayClub = state.clubs[match.awayClubId];
  if (homeClub && awayClub) {
    const homeTown = state.world.towns[homeClub.townId];
    const awayTown = state.world.towns[awayClub.townId];
    if (homeTown && awayTown) {
      const km = Math.hypot(homeTown.x - awayTown.x, homeTown.y - awayTown.y) * 0.45;
      const travelCost = Math.round(km * 1.4 + 8);
      addLedgerEntry(state, match.awayClubId, {
        date: match.date,
        description: 'Away travel costs',
        category: 'other',
        amount: -travelCost,
      });
      report.expenditure += travelCost;
    }
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
}

export function financeSummary(club: { finances: ClubFinances }): { income: number; expenditure: number; net: number } {
  const recent = club.finances.ledger.slice(-40);
  const income = recent.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0);
  const expenditure = Math.abs(recent.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0));
  return { income: Math.round(income), expenditure: Math.round(expenditure), net: Math.round(income - expenditure) };
}
