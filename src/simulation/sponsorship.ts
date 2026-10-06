import type { GameState } from '@/domain/game';
import type { Business, BusinessKind } from '@/domain/world';
import type { BusinessId, ClubId, ISODate, PersonId, SeasonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import {
  BUSINESS_KIND_LABEL,
  emptySponsorshipState,
  WEEKDAY_LABEL,
  type SponsorshipDeal,
  type SponsorshipFrequency,
  type SponsorshipState,
  type SponsorshipStatus,
} from '@/domain/sponsorship';
import { dayOfWeek, formatShortDate } from './calendar';
import { recordCommunicationHistory } from './communication/history';
import { addLedgerEntry } from './finance';
import { nextId } from './ids';
import { createEvent } from './news';
import { leagueClubIds, leagueCompetitions, tierFactor, tierOf, TIER_EXPECTATIONS } from './pyramid';
import { applyRelationshipEvent, getRelationship } from './relationships';
import { stream } from './rng';

/**
 * The sponsorship service.
 *
 * Everything that finds, signs, pays, renews or ends a sponsor goes through
 * here. It replaces the old `sponsorIncomePerWeek` modifier with a real
 * agreement: the deal says when money is due, and the money is a single ledger
 * line like every other transaction in the game.
 *
 * There is exactly one schedule. The calendar supplies today's date; the
 * agreement says whether today is a payday. Nothing else generates sponsorship
 * income, weekly or monthly.
 */

export const SPONSORSHIP = {
  /** The grassroots payday: the sponsor's money lands on a Friday. */
  weeklyPayDay: 5,
  /**
   * The monthly payday.
   *
   * The 28th: late enough in the month that a business has been paid before it
   * pays the club, and a date every month has, so February is never skipped.
   */
  monthlyPayDay: 28,
  /** No deal is worth less than this. */
  minInstalment: 5,
  /** Instalments that can go missing before the sponsor walks. */
  missThreshold: 3,
  /** How many candidates the club screen is offered. */
  candidateLimit: 6,
  /** A business this far from the club is unlikely to be interested (map units). */
  candidateRadius: 45,
} as const;

/** The store, created on demand so old saves can be repaired in place. */
export function sponsorshipStore(state: GameState): SponsorshipState {
  const existing = state.sponsorship as SponsorshipState | undefined;
  if (existing && Array.isArray(existing.deals)) return existing;
  const store = emptySponsorshipState();
  state.sponsorship = store;
  return store;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

/* ------------------------------------------------------------------------ *\
 * Reading a club's sponsorship
 * ------------------------------------------------------------------------ */

export function dealsForClub(state: GameState, clubId: ClubId): SponsorshipDeal[] {
  return sponsorshipStore(state).deals.filter((deal) => deal.clubId === clubId);
}

/** The club's current deal, if it has one. */
export function activeDealForClub(state: GameState, clubId: ClubId): SponsorshipDeal | null {
  const deals = dealsForClub(state, clubId);
  for (let i = deals.length - 1; i >= 0; i -= 1) {
    if (deals[i]!.status === 'active') return deals[i]!;
  }
  return null;
}

export function sponsorBusinessFor(state: GameState, clubId: ClubId): Business | null {
  const deal = activeDealForClub(state, clubId);
  if (!deal) return null;
  return state.world.businesses[deal.sponsorId] ?? null;
}

/** The sponsor's name for the kit and the club screen, or null if there is none. */
export function sponsorNameFor(state: GameState, clubId: ClubId): string | null {
  return sponsorBusinessFor(state, clubId)?.name ?? null;
}

/**
 * The agreement's income, averaged to a week.
 *
 * A deal is paid on its own cadence — weekly on a Friday, or monthly on the
 * 28th — but the club's books compare it with costs that fall every week. This
 * is what a week of it is worth: a monthly instalment is the same money over a
 * year, so a twelfth of it is not the weekly equivalent and dividing by the
 * weeks in a year is. Without that, a monthly sponsor would look four times
 * richer one day a month and absent the rest.
 */
export function weeklySponsorshipIncome(state: GameState, clubId: ClubId): number {
  const deal = activeDealForClub(state, clubId);
  if (!deal) return 0;
  return deal.terms.frequency === 'weekly' ? deal.instalment : Math.round((deal.instalment * 12) / 52);
}

/** Whether an instalment falls due on this date, by the agreement's own terms. */
export function instalmentDueOn(deal: SponsorshipDeal, date: ISODate): boolean {
  if (deal.status !== 'active') return false;
  if (deal.startDate && date < deal.startDate) return false;
  if (deal.endDate && date > deal.endDate) return false;
  if (deal.terms.frequency === 'weekly') return dayOfWeek(date) === deal.terms.payDay;
  return Number(date.slice(8, 10)) === deal.terms.payDay;
}

function payDayText(deal: SponsorshipDeal): string {
  if (deal.terms.frequency === 'weekly') {
    return `${WEEKDAY_LABEL[deal.terms.payDay] ?? 'each week'}, weekly`;
  }
  const day = deal.terms.payDay;
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix} of the month`;
}

/* ------------------------------------------------------------------------ *\
 * Fit: how well a business suits a club
 * ------------------------------------------------------------------------ */

/**
 * How well a business fits the club.
 *
 * A sponsor of a certain size expects a club of a certain standing: a big
 * builder backing a pub team looks generous, a corner café backing the
 * champions looks stretched. Fit is that gap, plus a small pull for being on
 * the club's own doorstep. It is read off the world every time, never stored
 * on the business.
 */
export function sponsorFit(state: GameState, clubId: ClubId, business: Business): number {
  const club = state.clubs[clubId];
  if (!club) return 0;
  const expected = business.wealth * 5;
  const town = club.townId === business.townId ? 8 : 0;
  return clamp(100 - Math.abs(club.reputation - expected) + town);
}

export interface SponsorCandidate {
  businessId: BusinessId;
  name: string;
  kindLabel: string;
  wealth: number;
  townId: string;
  townName: string;
  fit: number;
  /** How the business pays if it signs — the club takes what it is offered. */
  frequency: SponsorshipFrequency;
}

/**
 * Businesses the club could plausibly approach.
 *
 * Real businesses that already exist in the world, nearest first, scoring best
 * first: a club looks after its own town before it looks down the road, and it
 * looks where its standing actually fits.
 */
export function sponsorCandidates(state: GameState, clubId: ClubId): SponsorCandidate[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const home = state.world.towns[club.townId];
  const candidates: SponsorCandidate[] = [];
  for (const business of Object.values(state.world.businesses)) {
    const town = state.world.towns[business.townId];
    if (!town) continue;
    const distance = home ? Math.hypot(town.x - home.x, town.y - home.y) : 0;
    if (home && business.townId !== club.townId && distance > SPONSORSHIP.candidateRadius) continue;
    candidates.push({
      businessId: business.id,
      name: business.name,
      kindLabel: BUSINESS_KIND_LABEL[business.kind],
      wealth: business.wealth,
      townId: business.townId,
      townName: town.name,
      fit: sponsorFit(state, clubId, business),
      frequency: sponsorshipTermsFor(business).frequency,
    });
  }
  candidates.sort((a, b) => {
    const aHome = a.townId === club.townId ? 1 : 0;
    const bHome = b.townId === club.townId ? 1 : 0;
    return bHome - aHome || b.fit - a.fit || a.name.localeCompare(b.name);
  });
  return candidates.slice(0, SPONSORSHIP.candidateLimit);
}

/* ------------------------------------------------------------------------ *\
 * Signing a sponsor
 * ------------------------------------------------------------------------ */

export type OfferOutcome = 'accepted' | 'refused' | 'no-business' | 'already-sponsored' | 'unknown-club';

export interface OfferResult {
  outcome: OfferOutcome;
  deal: SponsorshipDeal | null;
  businessName: string | null;
}

/**
 * The businesses that run on invoices rather than a pint glass.
 *
 * A builder, a garage or a plumber is paid by other people at the end of a
 * month, and pays its own suppliers the same way; a pub, a café or a butcher
 * hands money over the counter. The cadence is the sponsor's own, so it is read
 * off the business rather than chosen by the club — the club takes what it is
 * offered, which is exactly what happens down the road. It is a fact about the
 * kind of business, so it never consumes the RNG and never drifts between two
 * careers with the same seed.
 */
const MONTHLY_KINDS: ReadonlySet<BusinessKind> = new Set(['builder', 'garage', 'plumbers']);

/** The terms a business brings to a deal: how often it pays, and on which day. */
export function sponsorshipTermsFor(business: Business): {
  frequency: SponsorshipFrequency;
  payDay: number;
} {
  if (MONTHLY_KINDS.has(business.kind)) {
    return { frequency: 'monthly', payDay: SPONSORSHIP.monthlyPayDay };
  }
  return { frequency: 'weekly', payDay: SPONSORSHIP.weeklyPayDay };
}

/**
 * Approach a business and, if it agrees, sign the deal.
 *
 * Whether a business says yes is read from how well it fits the club and how
 * well the club is regarded locally; the manager's standing with the chairman
 * helps a little, because the chairman is the one who opens the door. Nothing
 * here invents a commercial negotiation — it is a Sunday club asking the local
 * builder, and either he will or he won't.
 */
export function offerSponsorship(
  state: GameState,
  clubId: ClubId,
  businessId: BusinessId,
  options: { date?: ISODate; endDate?: ISODate } = {},
): OfferResult {
  const club = state.clubs[clubId];
  if (!club) return { outcome: 'unknown-club', deal: null, businessName: null };
  const business = state.world.businesses[businessId];
  if (!business) return { outcome: 'no-business', deal: null, businessName: null };
  if (activeDealForClub(state, clubId)) return { outcome: 'already-sponsored', deal: null, businessName: business.name };

  const date = options.date ?? state.date;
  const fit = sponsorFit(state, clubId, business);
  const rng = stream(state.seed, 'sponsorship-offer', clubId, businessId, state.season.id);
  let chance = 0.28 + fit / 170 + club.reputation / 420;
  // A chairman on good terms with the manager is worth a word in the right ear.
  const chairman = clubChairmanId(state, clubId);
  const manager = club.managerId;
  if (chairman && manager && getRelationship(state, manager, chairman)) chance += 0.05;
  chance = Math.max(0.1, Math.min(0.9, chance));
  if (!rng.chance(chance)) {
    return { outcome: 'refused', deal: null, businessName: business.name };
  }

  const tier = tierOf(state, clubId);
  // What the business puts behind a club over a year, expressed as a week.
  const weekly = Math.max(
    SPONSORSHIP.minInstalment,
    Math.round(business.wealth * 2.6 * tierFactor(TIER_EXPECTATIONS.sponsor, tier) * rng.float(0.85, 1.2)),
  );
  // The cadence changes the dates the money lands on, not how much of it there
  // is: a monthly deal is the same annual money in twelve instalments instead
  // of fifty-two. Anything else would make a monthly sponsor a four-fold cut.
  const terms = sponsorshipTermsFor(business);
  const instalment =
    terms.frequency === 'weekly'
      ? weekly
      : Math.max(SPONSORSHIP.minInstalment, Math.round((weekly * 52) / 12));
  const deal: SponsorshipDeal = {
    id: nextId(state, 'sponsor'),
    clubId,
    sponsorId: business.id,
    startDate: date,
    endDate: options.endDate ?? state.season.endDate,
    instalment,
    terms,
    status: 'active',
    fit,
    relationship: clamp(45 + fit / 5),
    paidCount: 0,
    missedCount: 0,
    lastPaidOn: null,
    lastDueOn: null,
    issue: null,
  };
  sponsorshipStore(state).deals.push(deal);
  if (!business.sponsoredClubIds.includes(clubId)) business.sponsoredClubIds.push(clubId);
  trimDeals(state);
  noteRelationship(state, clubId, 'sponsor-secured', `${business.name} came in as sponsor.`, 1);
  // A new backer is worth a line in the club's own record. Written here, where
  // the agreement is actually made, rather than by whoever reports it later.
  recordCommunicationHistory(state, {
    kind: 'sponsor-event',
    importance: 2,
    clubId,
    date,
    key: `history:sponsor-sign:${deal.id}`,
    description: `${business.name} agreed to back the club — ${deal.instalment} an instalment.`,
  });
  return { outcome: 'accepted', deal, businessName: business.name };
}

/**
 * Try to find the club (or another) a sponsor from the candidates on its
 * doorstep. Used by the manager's own search and by the season review for the
 * clubs the world runs.
 */
export function seekSponsor(
  state: GameState,
  clubId: ClubId = state.userClubId,
  options: { date?: ISODate; endDate?: ISODate } = {},
): OfferResult {
  if (activeDealForClub(state, clubId)) {
    return { outcome: 'already-sponsored', deal: null, businessName: null };
  }
  const candidates = sponsorCandidates(state, clubId).filter((candidate) => candidate.fit >= 25);
  for (const candidate of candidates) {
    const result = offerSponsorship(state, clubId, candidate.businessId, options);
    if (result.outcome === 'accepted') return result;
  }
  const first = candidates[0];
  return { outcome: first ? 'refused' : 'no-business', deal: null, businessName: first?.name ?? null };
}

/* ------------------------------------------------------------------------ *\
 * Seeding a career
 * ------------------------------------------------------------------------ */

/**
 * Give each club the sponsor it already had.
 *
 * The generated world attached a business to a club as its name source and set
 * a weekly figure. This turns that into a real agreement without inventing one:
 * a club only gets a deal if a business actually backs it and a figure existed.
 * A club with neither starts the career without a sponsor, which is a perfectly
 * normal Sunday club.
 *
 * No money moves here: the first instalment lands on the first payday that
 * follows, through the ordinary payment path.
 */
export function seedInitialSponsorship(state: GameState): void {
  const store = sponsorshipStore(state);
  for (const club of Object.values(state.clubs)) {
    if (activeDealForClub(state, club.id)) continue;
    const sponsorIds = club.sponsorIds ?? [];
    const instalment = club.finances.sponsorIncomePerWeek ?? 0;
    if (instalment <= 0) continue;
    const business = sponsorIds.map((id) => state.world.businesses[id]).find((candidate): candidate is Business => !!candidate);
    if (!business) continue;
    const deal: SponsorshipDeal = {
      id: nextId(state, 'sponsor'),
      clubId: club.id,
      sponsorId: business.id,
      startDate: state.season.startDate,
      endDate: state.season.endDate,
      instalment: Math.round(instalment),
      terms: { frequency: 'weekly', payDay: SPONSORSHIP.weeklyPayDay },
      status: 'active',
      fit: sponsorFit(state, club.id, business),
      relationship: 50,
      paidCount: 0,
      missedCount: 0,
      lastPaidOn: null,
      lastDueOn: null,
      issue: null,
    };
    store.deals.push(deal);
    if (!business.sponsoredClubIds.includes(club.id)) business.sponsoredClubIds.push(club.id);
  }
  trimDeals(state);
}

/* ------------------------------------------------------------------------ *\
 * Payment, on the agreement's own dates
 * ------------------------------------------------------------------------ */

/**
 * Settle every instalment that is due today.
 *
 * This is the only thing that generates sponsorship income. It runs for every
 * club in the county, asks each agreement whether today is a payday, and books
 * exactly one ledger line when it is. A due date already dealt with is skipped,
 * so processing the same day twice — or reloading a save mid-day — can never
 * pay a club twice.
 *
 * A payment can go missing. When it does the sponsor's goodwill takes a knock,
 * and enough missed instalments and the sponsor walks.
 */
export function runSponsorship(state: GameState, date: ISODate = state.date): GameEvent[] {
  const events: GameEvent[] = [];
  for (const clubId of leagueClubIds(state)) {
    const deal = activeDealForClub(state, clubId);
    if (!deal) continue;
    if (!instalmentDueOn(deal, date)) continue;
    // One due date is settled once. Paydays only ever move forward, so any date
    // at or before the last one dealt with has already been settled — paid or
    // missed — and asking again (a reload, a repeated tick, a replayed day) can
    // never produce a second payment.
    if (deal.lastDueOn && date <= deal.lastDueOn) continue;
    deal.lastDueOn = date;

    const club = state.clubs[clubId];
    const rng = stream(state.seed, 'sponsorship', deal.id, date);
    const strained = (club?.finances.balance ?? 0) < 0;
    const chance = Math.max(0.55, Math.min(0.99, 0.93 + deal.relationship / 1200 - deal.missedCount * 0.05 - (strained ? 0.08 : 0)));

    if (rng.chance(chance)) {
      const business = state.world.businesses[deal.sponsorId];
      addLedgerEntry(state, clubId, {
        date,
        description: `${business?.name ?? 'Sponsor'} sponsorship`,
        category: 'sponsorship',
        amount: deal.instalment,
      });
      deal.paidCount += 1;
      deal.lastPaidOn = date;
      deal.relationship = clamp(deal.relationship + 1);
      if (deal.issue && /payment/i.test(deal.issue)) deal.issue = null;
      continue;
    }

    // The money did not arrive. Modest consequences: goodwill cools, and the
    // club is told once. A run of them is a sponsor ready to walk.
    deal.missedCount += 1;
    deal.relationship = clamp(deal.relationship - 8);
    deal.issue = 'A sponsor payment did not arrive.';
    if (deal.missedCount >= SPONSORSHIP.missThreshold) {
      endSponsorship(state, clubId, date, 'lapsed');
      if (clubId === state.userClubId) {
        events.push(
          createEvent(state, {
            type: 'club-event',
            importance: 3,
            clubIds: [clubId],
            data: {
              headline: 'The sponsor has walked',
              body: `${deal.sponsorId ? state.world.businesses[deal.sponsorId]?.name ?? 'The sponsor' : 'The sponsor'} has pulled out after missed payments.`,
            },
          }),
        );
      }
      continue;
    }
    if (clubId === state.userClubId) {
      events.push(
        createEvent(state, {
          type: 'club-event',
          importance: 2,
          clubIds: [clubId],
          data: {
            headline: 'A sponsorship payment is late',
            body: `${state.world.businesses[deal.sponsorId]?.name ?? 'The sponsor'} has not paid this week.`,
          },
        }),
      );
    }
  }
  return events;
}

/**
 * Bring a deal to an end.
 *
 * Used both when a sponsor walks and when the club ends the arrangement. The
 * business is released, the manager hears about it through the relationship he
 * already has with the chairman, and the club goes without until it finds
 * another — which it does not have to.
 */
export function endSponsorship(
  state: GameState,
  clubId: ClubId,
  date: ISODate = state.date,
  reason: Extract<SponsorshipStatus, 'lapsed' | 'ended'> = 'ended',
): SponsorshipDeal | null {
  const deal = activeDealForClub(state, clubId);
  if (!deal) return null;
  deal.status = reason;
  deal.issue = reason === 'lapsed' ? 'The sponsor has pulled out.' : 'The agreement was brought to an end.';
  const business = state.world.businesses[deal.sponsorId];
  if (business) business.sponsoredClubIds = business.sponsoredClubIds.filter((id) => id !== clubId);
  noteRelationship(
    state,
    clubId,
    'sponsor-lost',
    business ? `The club lost ${business.name} as sponsor.` : 'The club lost its sponsor.',
    reason === 'lapsed' ? 1.2 : 0.8,
  );
  // A sponsor walking is one of the few moments a Sunday club is still talking
  // about years later, so the club's own record keeps it — the fact recorded
  // where it happened, exactly like every other consequence.
  recordCommunicationHistory(state, {
    kind: 'sponsor-event',
    importance: reason === 'lapsed' ? 3 : 2,
    clubId,
    date,
    key: `history:sponsor-end:${deal.id}`,
    description: business
      ? reason === 'lapsed'
        ? `${business.name} ended their sponsorship of the club.`
        : `The club ended its sponsorship with ${business.name}.`
      : 'The club lost its sponsor.',
  });
  return deal;
}

/* ------------------------------------------------------------------------ *\
 * The season review: renewal, leaving, replacement
 * ------------------------------------------------------------------------ */

export interface RenewalContext {
  seasonId: SeasonId;
  seasonLabel: string;
  seasonStart: ISODate;
  previousSeasonId: SeasonId;
  previousSeasonLabel: string;
}

export interface RenewalOutcome {
  events: GameEvent[];
  renewed: number;
  lost: number;
  gained: number;
}

/**
 * The summer review of every sponsorship.
 *
 * Called once at the season boundary, after the season has been archived and
 * the world's finances settled. Each sponsor weighs the season it has just had
 * and the division the club is now in: a promoted club is worth more, a
 * struggling one can lose its backer. A club that loses one may find another,
 * and a club without one may pick one up — but never all of them, because a
 * sponsor is not a right.
 */
export function renewSponsorship(state: GameState, context: RenewalContext): RenewalOutcome {
  const out: RenewalOutcome = { events: [], renewed: 0, lost: 0, gained: 0 };
  for (const clubId of leagueClubIds(state)) {
    const club = state.clubs[clubId];
    if (!club) continue;
    const rng = stream(state.seed, 'sponsorship-renewal', context.seasonId, clubId);
    const deal = activeDealForClub(state, clubId);
    const tier = tierOf(state, clubId);
    const previousRecord = club.history.seasons.find((entry) => entry.seasonId === context.previousSeasonId);
    const finish = previousRecord?.finalPosition ?? null;
    const divisionSize = leagueCompetitions(state).find((entry) => entry.tier === tier)?.clubIds.length ?? 12;
    const struggling = finish !== null && finish > Math.max(1, divisionSize) - 3;

    if (deal) {
      // Renewed by default: extend the term and let the figures follow the
      // season. The tier factor is where a promotion or relegation bites.
      const factor = tierFactor(TIER_EXPECTATIONS.sponsor, tier);
      const perfBonus = finish !== null && finish <= 3 ? 1.06 : 1;
      deal.endDate = state.season.endDate;
      deal.instalment = Math.max(
        SPONSORSHIP.minInstalment,
        Math.round(deal.instalment * rng.float(0.92, 1.15) * factor * perfBonus),
      );
      const business = state.world.businesses[deal.sponsorId];
      if (business) deal.fit = sponsorFit(state, clubId, business);
      deal.relationship = clamp(deal.relationship + (struggling ? -6 : 3));
      deal.issue = deal.missedCount > 0 ? deal.issue : null;

      // A struggling club with a cooling sponsor can lose them.
      if ((struggling || deal.missedCount > 0) && deal.relationship < 45 && rng.chance(0.3)) {
        const name = state.world.businesses[deal.sponsorId]?.name ?? 'The sponsor';
        endSponsorship(state, clubId, context.seasonStart, 'lapsed');
        out.lost += 1;
        if (clubId === state.userClubId) {
          out.events.push(
            createEvent(state, {
              type: 'club-event',
              importance: 3,
              clubIds: [clubId],
              data: { headline: `${name} end their sponsorship`, body: 'A difficult season has cost the club its backer.' },
            }),
          );
        }
      } else {
        out.renewed += 1;
        if (clubId === state.userClubId) {
          out.events.push(
            createEvent(state, {
              type: 'club-event',
              importance: 1,
              clubIds: [clubId],
              data: {
                headline: `${state.world.businesses[deal.sponsorId]?.name ?? 'The sponsor'} renew for ${context.seasonLabel}`,
                body: `The deal runs on at £${deal.instalment} an instalment.`,
              },
            }),
          );
        }
      }
    }

    // Find a sponsor for a club that has none. Every club gets a look, but not
    // every club gets one: the world's weaker sides can go a summer without.
    if (!activeDealForClub(state, clubId)) {
      const chance = 0.35 + club.reputation / 400;
      if (rng.chance(chance)) {
        const result = seekSponsor(state, clubId, { date: context.seasonStart, endDate: state.season.endDate });
        if (result.outcome === 'accepted' && result.deal) {
          out.gained += 1;
          if (clubId === state.userClubId) {
            out.events.push(
              createEvent(state, {
                type: 'club-event',
                importance: 2,
                clubIds: [clubId],
                data: {
                  headline: `${result.businessName} take on the sponsorship`,
                  body: `A new deal for ${context.seasonLabel}, worth £${result.deal.instalment} an instalment.`,
                },
              }),
            );
          }
        }
      }
    }
  }
  return out;
}



/* ------------------------------------------------------------------------ *\
 * The club screen
 * ------------------------------------------------------------------------ */

export type SponsorshipStanding = 'none' | 'active' | 'renewal-due' | 'lapsed';

export interface SponsorshipSummary {
  deal: SponsorshipDeal | null;
  sponsorName: string | null;
  sponsorKindLabel: string | null;
  sponsorTownName: string | null;
  instalment: number;
  payDay: string;
  frequency: SponsorshipFrequency;
  renewalDate: ISODate | null;
  renewalDue: boolean;
  fit: number;
  relationship: number;
  paidCount: number;
  missedCount: number;
  issue: string | null;
  standing: SponsorshipStanding;
  candidates: SponsorCandidate[];
}

/**
 * Everything the club screen needs about the sponsor, read from the deal and
 * the world rather than stored twice. The renewal point is the term's own end
 * date, so the screen and the season review can never disagree about it.
 */
export function sponsorshipSummary(state: GameState, clubId: ClubId = state.userClubId): SponsorshipSummary {
  const deal = activeDealForClub(state, clubId);
  const business = deal ? state.world.businesses[deal.sponsorId] ?? null : null;
  const renewalDue = deal ? state.date >= deal.endDate : false;
  const standing: SponsorshipStanding = !deal
    ? 'none'
    : renewalDue
      ? 'renewal-due'
      : deal.issue
        ? 'lapsed'
        : 'active';
  return {
    deal,
    sponsorName: business?.name ?? null,
    sponsorKindLabel: business ? BUSINESS_KIND_LABEL[business.kind] : null,
    sponsorTownName: business ? state.world.towns[business.townId]?.name ?? null : null,
    instalment: deal?.instalment ?? 0,
    payDay: deal ? payDayText(deal) : '—',
    frequency: deal?.terms.frequency ?? 'weekly',
    renewalDate: deal?.endDate ?? null,
    renewalDue,
    fit: deal?.fit ?? 0,
    relationship: deal?.relationship ?? 0,
    paidCount: deal?.paidCount ?? 0,
    missedCount: deal?.missedCount ?? 0,
    issue: deal?.issue ?? null,
    standing,
    candidates: deal ? [] : sponsorCandidates(state, clubId),
  };
}

/** One line for a summary elsewhere: who backs the club, and for how much. */
export function sponsorshipLine(state: GameState, clubId: ClubId): string {
  const deal = activeDealForClub(state, clubId);
  if (!deal) return 'No sponsor';
  const name = state.world.businesses[deal.sponsorId]?.name ?? 'A sponsor';
  return `${name} · £${deal.instalment} ${deal.terms.frequency === 'weekly' ? 'a week' : 'a month'}`;
}

/** A short, human renewal line for the club screen. */
export function renewalText(state: GameState, summary: SponsorshipSummary): string {
  if (!summary.deal || !summary.renewalDate) return 'No agreement';
  const when = formatShortDate(summary.renewalDate);
  if (state.date >= summary.renewalDate) return `Due now (${when})`;
  return `Runs to ${when}`;
}

/* ------------------------------------------------------------------------ *\
 * Helpers
 * ------------------------------------------------------------------------ */

function clubChairmanId(state: GameState, clubId: ClubId): PersonId | null {
  return state.clubs[clubId]?.chairmanId ?? null;
}

/**
 * Sponsorship sentiment travels through the relationship the manager and the
 * chairman already have. They are the two people who actually own the decision
 * at a Sunday club, and their relationship is the one the game already keeps —
 * this is not a second social system.
 */
function noteRelationship(
  state: GameState,
  clubId: ClubId,
  type: 'sponsor-secured' | 'sponsor-lost',
  detail: string,
  intensity: number,
): void {
  const club = state.clubs[clubId];
  const chairman = club?.chairmanId;
  const manager = club?.managerId;
  if (!chairman || !manager || chairman === manager) return;
  applyRelationshipEvent(state, { type, aId: chairman, bId: manager, intensity, detail, clubId, date: state.date });
}

/** Keep the deal log bounded: the oldest settled deals fall away first. */
function trimDeals(state: GameState): void {
  const store = sponsorshipStore(state);
  if (store.deals.length <= 220) return;
  const ended = store.deals.filter((deal) => deal.status !== 'active');
  const drop = new Set(ended.slice(0, store.deals.length - 220).map((deal) => deal.id));
  store.deals = store.deals.filter((deal) => !drop.has(deal.id));
}

export type { SponsorshipState };
