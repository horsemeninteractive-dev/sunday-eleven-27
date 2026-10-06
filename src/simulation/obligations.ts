import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import { isCompetitiveMatch } from '@/domain/match';
import { addDays, daysBetween } from './calendar';
import { matchdayCosts } from './finance';
import { recurringEvents, recursOn } from './schedule';

/**
 * What the club already owes.
 *
 * A treasurer looking at the book can say what has been paid. The question a
 * manager actually asks is the other one — *what is coming?* — and it has a real
 * answer, because the club's commitments are all already written down somewhere:
 * the standing costs run every week, the hall is paid for on training night, and
 * every fixture carries a referee, sometimes a ground and sometimes a drive.
 *
 * So this is a read-only projection, nothing more. It does not decide anything,
 * reserve money, or keep a second ledger — it reads the calendar's own recurring
 * rules (`recurringEvents`, the authority on what happens when), the fixtures in
 * `state.matches`, and the club's own configured costs, and it adds them up as a
 * treasurer would on the back of an envelope. The amounts come from
 * `matchdayCosts` and `applyStandingCosts`' own figures, so what this says the
 * club will owe is what the club will actually be billed.
 *
 * What it deliberately leaves out: anything random (the equipment kitty is
 * rolled from a stream on the day), anything settled in the past, and anything
 * the manager cannot act on. An obligation is a date, a reason and a number.
 */

export interface ClubObligation {
  id: string;
  date: ISODate;
  /** What it is, in the treasurer's words. */
  label: string;
  /** The one line of detail worth printing under it. */
  detail: string;
  /** Money out, so negative — the ledger's own sign convention. */
  amount: number;
}

/** The obligations between two dates, everything included, oldest first. */
export function obligationsBetween(state: GameState, clubId: ClubId, from: ISODate, to: ISODate): ClubObligation[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const finances = club.finances;
  const out: ClubObligation[] = [];

  // The recurring commitments, read from the calendar's own rules rather than
  // assumed: whatever day the schedule says the standing costs fall on is the
  // day they fall on.
  const rules = recurringEvents(state);
  const standingRule = rules.find((rule) => rule.id === 'rec_costs');
  const trainingRule = rules.find((rule) => rule.id === 'rec_training');
  // The pitch is not a weekly bill: it is charged when the club plays at home,
  // and appears on the fixture itself below. What recurs every week is the
  // insurance.
  const standing = finances.insurancePerWeek;
  const hall = finances.trainingCostPerWeek;

  for (let date = from; daysBetween(date, to) >= 0; date = addDays(date, 1)) {
    if (standingRule && standing > 0 && recursOn(standingRule, date)) {
      out.push({
        id: `standing:${date}`,
        date,
        label: 'Standing costs',
        detail: 'Insurance',
        amount: -standing,
      });
    }
    if (trainingRule && hall > 0 && recursOn(trainingRule, date)) {
      out.push({
        id: `training:${date}`,
        date,
        label: 'Training session',
        detail: 'Hall hire and floodlights',
        amount: -hall,
      });
    }
  }

  // Every fixture the club still has to play in the window. A friendly costs
  // nothing in the game's books, so it is not projected either.
  for (const match of Object.values(state.matches)) {
    if (match.played) continue;
    if (match.homeClubId !== clubId && match.awayClubId !== clubId) continue;
    if (daysBetween(from, match.date) < 0 || daysBetween(match.date, to) < 0) continue;
    if (!isCompetitiveMatch(state, match)) continue;

    const costs = matchdayCosts(state, match, clubId);
    const home = match.homeClubId === clubId;
    const parts: string[] = ['Referee'];
    if (costs.groundHire > 0) parts.push('ground hire');
    if (costs.travel > 0) parts.push('travel');
    const total = Math.round(costs.referee + costs.groundHire + costs.travel);
    if (total <= 0) continue;
    out.push({
      id: `match:${match.id}`,
      date: match.date,
      label: `${home ? 'Home' : 'Away'} — ${match.competitionName}`,
      detail: parts.join(' · '),
      amount: -total,
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * The next few things the club has to pay, oldest first.
 *
 * `weeks` is how far ahead to look and `limit` how many lines to return, because
 * the screen wants a treasurer's outlook rather than a cash-flow statement: the
 * nearest handful of commitments is enough to know whether the account is going
 * to hold.
 */
export function upcomingObligations(
  state: GameState,
  clubId: ClubId = state.userClubId,
  options: { weeks?: number; limit?: number } = {},
): ClubObligation[] {
  const weeks = Math.max(1, options.weeks ?? 6);
  const limit = Math.max(1, options.limit ?? 6);
  const from = state.date;
  const to = addDays(from, weeks * 7);
  return obligationsBetween(state, clubId, from, to).slice(0, limit);
}

/** What the listed obligations come to, as one number out of the account. */
export function obligationsTotal(obligations: ClubObligation[]): number {
  return Math.round(obligations.reduce((sum, obligation) => sum + obligation.amount, 0) * 100) / 100;
}
