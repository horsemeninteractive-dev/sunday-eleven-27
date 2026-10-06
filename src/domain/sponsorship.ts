import type { BusinessId, ClubId, ISODate } from './ids';
import type { BusinessKind } from './world';

/**
 * Sponsorship.
 *
 * A sponsor is a real business that already exists in the world — the same pub,
 * builder or garage a club is named after. This layer turns the old
 * `sponsorIncomePerWeek` financial modifier into an actual agreement with a
 * start, a term, a payment and a relationship, so a club's sponsor is a fact
 * about the club rather than a number that drifts on its own.
 *
 * Three ideas keep it honest:
 *
 *  - **The agreement is the authority.** A deal says when money is due and how
 *    much. There is no separate weekly or monthly sponsorship schedule: the
 *    calendar supplies the date, the agreement says whether today is a payday.
 *  - **One ledger.** An instalment is one `addLedgerEntry` line, keyed on the
 *    deal and the due date, so a day paid once can never be paid twice.
 *  - **One relationship system.** The people whose relationship the game
 *    actually tracks are the manager and the chairman who own the decision;
 *    sponsorship moves their relationship through the existing service and
 *    nothing else.
 *
 * Not every club has a sponsor, and a club that loses one can go without until
 * it finds another.
 */

/** How often an instalment falls due. The agreement decides, not the calendar. */
export type SponsorshipFrequency = 'weekly' | 'monthly';

/**
 * Where a deal stands.
 *
 *  - `active` — signed and paying.
 *  - `lapsed` — the sponsor walked away, or the club stopped honouring it.
 *  - `ended` — the club brought it to a close deliberately.
 */
export type SponsorshipStatus = 'active' | 'lapsed' | 'ended';

export interface SponsorshipDeal {
  id: string;
  clubId: ClubId;
  /** The real local business behind the club. */
  sponsorId: BusinessId;
  /** The day the agreement was signed. */
  startDate: ISODate;
  /** The day the term runs to; renewal is decided at this point. */
  endDate: ISODate;
  /** The value of one instalment, in pounds. */
  instalment: number;
  /** Basic terms: how often, and on which day. */
  terms: {
    frequency: SponsorshipFrequency;
    /** 0-6 (Sun-Sat) for weekly; 1-28 for monthly. */
    payDay: number;
  };
  status: SponsorshipStatus;
  /** 0-100: how well a business of this size fits the club's standing. */
  fit: number;
  /** 0-100: the sponsor's goodwill toward the club. */
  relationship: number;
  /** Instalments settled. */
  paidCount: number;
  /** Instalments that did not arrive. */
  missedCount: number;
  /** The last date an instalment actually landed. */
  lastPaidOn: ISODate | null;
  /**
   * The last due date this deal dealt with, paid or missed. It is what keeps a
   * day from being settled twice when the same date is processed again.
   */
  lastDueOn: ISODate | null;
  /** The current sponsor issue, in one short line, for the club screen. */
  issue: string | null;
}

/** The sponsorship record. Small on purpose: a club has one sponsor at a time. */
export interface SponsorshipState {
  /** Every deal the career has known, newest last. Ended deals are kept as history. */
  deals: SponsorshipDeal[];
}

export function emptySponsorshipState(): SponsorshipState {
  return { deals: [] };
}

/** A short label for a weekday, used wherever a payday is shown. */
export const WEEKDAY_LABEL: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

/** A short label for a business kind, for the club screen and its news. */
export const BUSINESS_KIND_LABEL: Record<BusinessKind, string> = {
  pub: 'Pub',
  'social-club': 'Social club',
  builder: 'Builder',
  garage: 'Garage',
  butcher: 'Butcher',
  cafe: 'Café',
  plumbers: 'Plumbers',
  'farm-shop': 'Farm shop',
};
