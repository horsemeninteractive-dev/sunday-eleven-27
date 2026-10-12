import type { ClubId, ISODate, SeasonId } from './ids';

/**
 * Fundraising: the club's own money, raised off its own people.
 *
 * A Sunday club is paid for as much by quiz nights and raffles as by subs. This
 * is the small, data-driven part of that: *what* the club can put on, and what
 * each of those needs to go well. The numbers themselves — who turns up and what
 * they spend — are worked out in `simulation/fundraising.ts`, from the club's
 * standing, the place it plays in, the crowd it has actually been drawing, how
 * well the night is run and who is behind it.
 *
 * Deliberately a small set of kinds with a distinct shape rather than a long
 * menu. A raffle is cheap, low-risk and sold in the bar; a quiz night needs a
 * room and a quizmaster; a do in the pub is the ambitious one — the biggest take
 * and the one that notices if the pub, the weather or the committee is not with
 * you.
 */

export type FundraiserKind = 'quiz-night' | 'raffle' | 'pub-event';

export const FUNDRAISER_KINDS: readonly FundraiserKind[] = ['quiz-night', 'raffle', 'pub-event'];

export interface FundraiserProfile {
  kind: FundraiserKind;
  label: string;
  /** One line on what the evening is, for the calendar and the news. */
  blurb: string;
  /** What it costs to put on, before a penny comes back. */
  cost: number;
  /** What each person through the door leaves behind, on average. */
  perHead: number;
  /** How much of the club's ordinary following the night draws, 0-1. */
  draw: number;
  /** Whether it is held somewhere with its own pull. */
  inVenue: boolean;
  /**
   * How much a wet or cold night costs it, 0-1. A quiz in the back room barely
   * notices; a do in the pub garden notices a lot.
   */
  weatherWeight: number;
}

/**
 * The three nights, as data.
 *
 * `draw` is the share of the club's following that comes out, and `perHead` is
 * what the club actually *keeps* from each of them: a raffle is a cheap ticket
 * sold to a lot of people, a pub event is fewer people who each leave rather
 * more behind — and, being held in somebody's bar, the riskier and the bigger.
 *
 * The scale is deliberately grassroots: a good night for a well-backed town club
 * is a couple of hundred pounds, not a second income.
 */
export const FUNDRAISERS: Record<FundraiserKind, FundraiserProfile> = {
  'quiz-night': {
    kind: 'quiz-night',
    label: 'Quiz night',
    blurb: 'Teams of six, a raffle in the interval and a chip supper in the back room.',
    cost: 18,
    perHead: 4,
    draw: 0.26,
    inVenue: false,
    weatherWeight: 0.25,
  },
  raffle: {
    kind: 'raffle',
    label: 'Raffle',
    blurb: 'Tickets sold around the pubs and the shops, drawn on a Sunday.',
    cost: 10,
    perHead: 2.5,
    draw: 0.38,
    inVenue: true,
    weatherWeight: 0.15,
  },
  'pub-event': {
    kind: 'pub-event',
    label: 'Do at the pub',
    blurb: 'A band, a barbecue and the pub full of the club’s own people.',
    cost: 55,
    perHead: 4,
    draw: 0.42,
    inVenue: true,
    weatherWeight: 0.7,
  },
};

/** One night that has actually been run, and what it took. */
export interface FundraisingRun {
  id: string;
  clubId: ClubId;
  kind: FundraiserKind;
  date: ISODate;
  seasonId: SeasonId;
  /** How many came through the door. */
  turnout: number;
  /** What the club cleared: one ledger line, and the whole of the night. */
  net: number;
}

export interface FundraisingState {
  /** Most recent first. */
  runs: FundraisingRun[];
}

export function emptyFundraisingState(): FundraisingState {
  return { runs: [] };
}

export function fundraiserLabel(kind: FundraiserKind): string {
  return FUNDRAISERS[kind].label;
}
