import type { Club } from '@/domain/club';
import type { ScheduledEvent } from '@/domain/events';
import {
  emptyFundraisingState,
  FUNDRAISERS,
  FUNDRAISER_KINDS,
  type FundraiserKind,
  type FundraisingRun,
  type FundraisingState,
} from '@/domain/fundraising';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import { isCompetitiveMatch } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { isOfficial } from '@/domain/person';
import { attitudeOf } from '@/domain/relationship';
import { addDays } from './calendar';
import { managingClubId, userManager } from './career';
import { addLedgerEntry } from './finance';
import { clubChairman } from './governance';
import { nextId } from './ids';
import { createEvent } from './news';
import { getRelationship, applyRelationshipEvent } from './relationships';
import { stream } from './rng';
import { dayWeather, resolveScheduledEvent, scheduleEvent, scheduleStore } from './schedule';
import { staffCompetence } from './staff';

/**
 * Fundraising, running.
 *
 * The club's own money, raised off the club's own people: a quiz night, a raffle,
 * a do at the pub. Each one is organised in advance, sits on the calendar like
 * anything else, and settles on its own evening as **one ledger line** — the
 * whole night, in or out, booked once under `fundraising`.
 *
 * What makes it a loop rather than a button is that the return is *read off the
 * club as it stands*, through four things a manager already knows:
 *
 *  1. **Standing and the place it plays in.** Who comes to a raffle in a hamlet
 *     is not who comes to one in a town. This is the club's following.
 *  2. **Attendance.** The crowd the club has actually been drawing lately, not
 *     its reputation on paper: a club whose gates have fallen away gets a quiet
 *     quiz night, and the night's own weather moves it further.
 *  3. **Organisation.** The manager's own handling, the secretary's competence
 *     and how many volunteers turn out to put chairs on tables.
 *  4. **Relationships.** The chairman's goodwill is worth people in the room, and
 *     a do at the pub is only as big as the pub's own pull and its ties to the
 *     club.
 *
 * And the other end is a loop too: a good night improves the chairman's view of
 * the manager through the ordinary relationship system, and a night that loses
 * money is a club matter he hears about.
 *
 * Only the manager's own club runs nights. The county's other clubs are not
 * asked to imagine their own committee's raffle, so nothing here touches a
 * ledger but his.
 */

/** Every knob, in one place. */
export const FUNDRAISING = {
  /** Days between one night and the next: the same people cannot be asked twice in a month. */
  windowDays: 21,
  /** Days' notice a night needs — a room to book, tickets to print. */
  leadDays: 3,
  /** How many nights a club can put on in one season before the well runs dry. */
  perSeason: 4,
  /** How many past nights are kept. The money is in the ledger; this is the story. */
  historyLimit: 40,
} as const;

/* ------------------------------------------------------------------------ *\
 * Reading it
 * ------------------------------------------------------------------------ */

/** The fundraising store, filled in if a save predates it. */
export function fundraisingStore(state: GameState): FundraisingState {
  if (!state.fundraising) state.fundraising = emptyFundraisingState();
  if (!Array.isArray(state.fundraising.runs)) state.fundraising.runs = [];
  return state.fundraising;
}

/** Every night the club has run, newest first. */
export function fundraisingRuns(state: GameState, clubId: ClubId): FundraisingRun[] {
  return fundraisingStore(state)
    .runs.filter((run) => run.clubId === clubId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Nights run this season, which is what the season's cap counts. */
export function fundraisingRunsThisSeason(state: GameState, clubId: ClubId): FundraisingRun[] {
  return fundraisingRuns(state, clubId).filter((run) => run.seasonId === state.season.id);
}

/** Nights organised but not yet held: the ones already on the calendar. */
export function scheduledFundraisers(state: GameState, clubId: ClubId): ScheduledEvent[] {
  return scheduleStore(state)
    .events.filter(
      (event) =>
        event.kind === 'fundraising' &&
        event.resolvedOn === null &&
        event.clubIds.includes(clubId) &&
        isFundraiserKind(event.data.fundraiser),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function isFundraiserKind(value: unknown): value is FundraiserKind {
  return typeof value === 'string' && (FUNDRAISER_KINDS as readonly string[]).includes(value);
}

export interface FundraisingAvailability {
  /** True when a night can be organised today. */
  canOrganise: boolean;
  /** The earliest date one could actually be held. */
  nextDate: ISODate;
  /** Nights left this season. */
  remaining: number;
  /** Why not, in the manager's words. Null when there is nothing stopping him. */
  reason: string | null;
}

/**
 * When the club can next put a night on, and whether it can at all.
 *
 * Two real limits, both of them about not asking too much of the same people:
 * a few weeks between nights, and a few nights a season. A night already on the
 * calendar both uses one of the season's allowance and pushes the date.
 */
export function fundraisingAvailability(state: GameState, clubId: ClubId): FundraisingAvailability {
  const club = state.clubs[clubId];
  const runs = fundraisingRunsThisSeason(state, clubId);
  const pending = scheduledFundraisers(state, clubId);
  const remaining = Math.max(0, FUNDRAISING.perSeason - runs.length - pending.length);

  // The later of the last night and any night already booked sets the floor.
  const dates = [...runs.map((run) => run.date), ...pending.map((event) => event.date)].sort();
  const last = dates[dates.length - 1];
  const earliest = last ? addDays(last, FUNDRAISING.windowDays) : state.date;
  const fromToday = addDays(state.date, FUNDRAISING.leadDays);
  const nextDate = earliest > fromToday ? earliest : fromToday;

  if (!club) return { canOrganise: false, nextDate, remaining, reason: 'There is no club to raise money for.' };
  if (pending.length > 0) {
    return {
      canOrganise: false,
      nextDate,
      remaining,
      reason: `There is already a night in the diary for ${pending[0]!.date}.`,
    };
  }
  if (remaining <= 0) {
    return {
      canOrganise: false,
      nextDate,
      remaining,
      reason: 'The club has asked enough of its people this season.',
    };
  }
  return { canOrganise: true, nextDate, remaining, reason: null };
}

/* ------------------------------------------------------------------------ *\
 * What the night is worth
 * ------------------------------------------------------------------------ */

/** The crowd the club has actually been drawing at home lately, or null if it has not played. */
export function recentHomeCrowd(state: GameState, clubId: ClubId): number | null {
  const played = Object.values(state.matches)
    .filter(
      (match) =>
        match.played &&
        match.homeClubId === clubId &&
        match.result !== null &&
        isCompetitiveMatch(state, match),
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 3);
  if (played.length === 0) return null;
  const total = played.reduce((sum, match) => sum + (match.result?.attendance ?? 0), 0);
  return Math.round(total / played.length);
}

/** The pub or social club that would put a night on, and what it is worth. */
function localVenue(state: GameState, club: Club): { name: string; wealth: number; backs: boolean } | null {
  const town = state.world.towns[club.townId];
  if (!town) return null;
  const candidates = town.businessIds
    .map((id) => state.world.businesses[id])
    .filter((business): business is NonNullable<typeof business> => !!business)
    .filter((business) => business.kind === 'pub' || business.kind === 'social-club');
  if (candidates.length === 0) return null;
  // The club's own pub first: a sponsor that is a pub is the room it already uses.
  const backer = candidates.find((business) => business.sponsoredClubIds.includes(club.id));
  const chosen =
    backer ??
    [...candidates].sort((a, b) => b.wealth - a.wealth || a.id.localeCompare(b.id))[0]!;
  return { name: chosen.name, wealth: chosen.wealth, backs: chosen.sponsoredClubIds.includes(club.id) };
}

export interface FundraiserForecast {
  kind: FundraiserKind;
  label: string;
  /** How many are expected through the door. */
  turnout: number;
  /** What they spend, before the cost of putting it on. */
  take: number;
  cost: number;
  /** The one number that becomes the ledger line. */
  net: number;
  /** What moved it, in the manager's words, for the screen. */
  notes: string[];
}

/**
 * The one place a night's numbers are worked out.
 *
 * Both the screen's forecast and the night itself call this, so what the manager
 * is promised and what he actually banks cannot drift apart — the same reason
 * `matchdayCosts` is shared between the ledger and the treasurer's forward look.
 * It reads state and returns numbers; it writes nothing.
 */
export function fundraiserForecast(
  state: GameState,
  clubId: ClubId,
  kind: FundraiserKind,
  date: ISODate,
): FundraiserForecast {
  const club = state.clubs[clubId];
  const profile = FUNDRAISERS[kind];
  if (!club) return { kind, label: profile.label, turnout: 0, take: 0, cost: 0, net: 0, notes: [] };

  const town = state.world.towns[club.townId];
  const population = town?.population ?? 1200;
  const reputation = club.reputation;

  // 1. Standing and the place it plays in. The club's ordinary following is
  //    anchored to what it actually draws at a home game — a couple of dozen for
  //    a village side, the best part of a hundred for a good one — with the size
  //    of the place adding a little reach on top. A night draws a *share* of
  //    those people, so a quiz night can never be bigger than a match, which is
  //    the thing that keeps this from being a money printer.
  const townReach = Math.sqrt(Math.min(population, 8000)) * 0.25;
  const following = 18 + reputation * 0.75 + townReach;

  // 2. Attendance: what it has actually been drawing lately, which is the honest
  //    signal of how interested the place is right now.
  const crowd = recentHomeCrowd(state, clubId);
  const interest = crowd === null ? 1 : clamp(crowd / Math.max(30, following), 0.55, 1.6);
  const weather = dayWeather(state, date)?.weather ?? 'clear';
  const weatherFactor = 1 - weatherDrag(profile.weatherWeight, weather);

  // 3. Organisation: the manager's own handling, the man with the list, and how
  //    many volunteers turn up to put the chairs out.
  const manager = userManager(state);
  const secretaryId = club.staff?.secretaryId ?? null;
  const secretary = secretaryId ? state.people[secretaryId] : undefined;
  const organisationBase =
    0.78 +
    ((manager?.attributes.organisation ?? 10) / 20) * 0.2 +
    (isOfficial(secretary) ? (staffCompetence(secretary, 'secretary') / 20) * 0.12 : -0.05) +
    Math.min(0.06, (club.staff?.volunteerIds.length ?? 0) * 0.025);
  const organisation = clamp(organisationBase, 0.65, 1.2);

  // 4. Relationships: the chairman's goodwill, and the pub's own pull.
  const { factor: support, note: supportNote } = chairmanSupport(state, club);
  const venue = profile.inVenue ? localVenue(state, club) : null;
  const venueFactor = !venue ? 1 : clamp(0.9 + (venue.wealth / 20) * 0.18 + (venue.backs ? 0.08 : 0), 0.9, 1.16);

  // A night is not a spreadsheet: a good quizmaster and a full room, or a wet
  // Tuesday. Seeded on the club, the date and the kind, so a career reproduces
  // its own evenings.
  const variance = stream(state.seed, 'fundraising', clubId, date, kind).float(0.85, 1.2);

  const turnout = Math.max(
    3,
    Math.round(following * profile.draw * interest * organisation * support * venueFactor * weatherFactor * variance),
  );
  // What those people spend, a little richer in a bigger place.
  const take = Math.round(turnout * profile.perHead * (0.9 + reputation / 250));
  const net = take - profile.cost;

  const notes: string[] = [
    `${turnout} expected through the door`,
    town
      ? `${town.name}, ${town.population.toLocaleString('en-GB')} people · standing ${Math.round(reputation)}`
      : `standing ${Math.round(reputation)}`,
    `A following of about ${Math.round(following)}`,
  ];
  if (crowd !== null) notes.push(`The gate has been about ${crowd} lately`);
  notes.push(supportNote);
  if (venue) notes.push(venue.backs ? `${venue.name} backs the club` : `Room at ${venue.name}`);
  if (weatherFactor < 1) notes.push(`Weather: ${weather}`);

  return { kind, label: profile.label, turnout, take, cost: profile.cost, net, notes };
}

function weatherDrag(weight: number, weather: string): number {
  const severity =
    weather === 'heavy-rain' ? 0.35 : weather === 'light-rain' ? 0.15 : weather === 'frozen' ? 0.25 : weather === 'cold' ? 0.12 : 0;
  return weight * severity;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * What the committee's goodwill is worth in the room.
 *
 * Read through the one relationship system rather than a second opinion: the
 * chairman's own attitude toward the manager, turned into a multiplier around 1.
 * A chairman who trusts and respects the man gets his own people along; one who
 * has no time for him does not put the word round.
 */
function chairmanSupport(state: GameState, club: Club): { factor: number; note: string } {
  const chairman = clubChairman(state, club.id);
  const managerId = club.managerId;
  if (!chairman || !managerId) return { factor: 1, note: 'No committee to lean on' };
  const relationship = getRelationship(state, managerId, chairman.id);
  const view = relationship ? attitudeOf(relationship, chairman.id) : null;
  if (!view) return { factor: 1, note: `${chairman.firstName} ${chairman.surname} is neutral` };
  const goodwill =
    (view.trust * 0.4 + view.respect * 0.3 + view.friendship * 0.2 + view.loyalty * 0.3 - view.tension * 0.5) / 100;
  const factor = clamp(0.82 + goodwill * 0.4, 0.78, 1.18);
  const note =
    factor >= 1.1
      ? `${chairman.firstName} ${chairman.surname} is right behind it`
      : factor <= 0.9
        ? `${chairman.firstName} ${chairman.surname} has little time for it`
        : `${chairman.firstName} ${chairman.surname} is lukewarm`;
  return { factor, note };
}

/* ------------------------------------------------------------------------ *\
 * What the screen is shown
 * ------------------------------------------------------------------------ */

export interface FundraiserOption {
  kind: FundraiserKind;
  label: string;
  blurb: string;
  /** The night this option would be held on: the earliest legal date. */
  date: ISODate;
  forecast: FundraiserForecast;
}

export interface FundraisingSummary {
  availability: FundraisingAvailability;
  /** The night already in the diary, with what it is expected to make. */
  pending: { kind: FundraiserKind; label: string; date: ISODate; forecast: FundraiserForecast } | null;
  /** The three nights on offer, each priced on the earliest date it could be held. */
  options: FundraiserOption[];
  /** Nights already run, newest first. */
  recent: FundraisingRun[];
  /** Everything raised this season. */
  seasonTotal: number;
}

/**
 * Everything the fundraising screen needs, worked out once.
 *
 * The screen does not price a night itself: it reads the same forecast the night
 * will settle against, so the number the manager is offered is the number the
 * club books.
 */
export function fundraisingSummary(state: GameState, clubId: ClubId): FundraisingSummary {
  const availability = fundraisingAvailability(state, clubId);
  const scheduled = scheduledFundraisers(state, clubId)[0] ?? null;
  const scheduledKind = scheduled && isFundraiserKind(scheduled.data.fundraiser) ? scheduled.data.fundraiser : null;
  const runs = fundraisingRunsThisSeason(state, clubId);

  return {
    availability,
    pending:
      scheduled && scheduledKind
        ? {
            kind: scheduledKind,
            label: FUNDRAISERS[scheduledKind].label,
            date: scheduled.date,
            forecast: fundraiserForecast(state, clubId, scheduledKind, scheduled.date),
          }
        : null,
    options: FUNDRAISER_KINDS.map((kind) => ({
      kind,
      label: FUNDRAISERS[kind].label,
      blurb: FUNDRAISERS[kind].blurb,
      date: availability.nextDate,
      forecast: fundraiserForecast(state, clubId, kind, availability.nextDate),
    })),
    recent: runs,
    seasonTotal: runs.reduce((sum, run) => sum + run.net, 0),
  };
}

/* ------------------------------------------------------------------------ *\
 * Organising one
 * ------------------------------------------------------------------------ */

export interface OrganiseResult {
  ok: boolean;
  /** The manager-facing line, whatever happened. */
  message: string;
  /** The night as booked, when one was. */
  event?: ScheduledEvent;
}

/**
 * Put a night on.
 *
 * Only the manager's own club, and only within the club's means: a few weeks
 * clear of the last one and a few in a season. Nothing is taken or booked here —
 * the money moves on the night itself, when the club actually knows what it
 * took.
 */
export function organiseFundraiser(
  state: GameState,
  clubId: ClubId,
  kind: FundraiserKind,
  when?: ISODate,
): OrganiseResult {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, message: 'There is no club to raise money for.' };
  // Only the club the manager actually runs. A fundraising night is his to call,
  // and nobody else's committee is his to spend.
  if (managingClubId(state) !== clubId) {
    return { ok: false, message: 'That is not your club to raise money for.' };
  }
  const availability = fundraisingAvailability(state, clubId);
  if (!availability.canOrganise) {
    return { ok: false, message: availability.reason ?? 'The club cannot put a night on just now.' };
  }
  const date = when && when >= availability.nextDate ? when : availability.nextDate;
  const profile = FUNDRAISERS[kind];

  const event = scheduleEvent(state, {
    date,
    time: '19:30',
    kind: 'fundraising',
    priority: 'informational',
    source: 'club',
    title: profile.label,
    detail: profile.blurb,
    clubIds: [clubId],
    data: { fundraiser: kind },
  });

  return { ok: true, event, message: `${profile.label} booked for ${date}.` };
}

/* ------------------------------------------------------------------------ *\
 * The night itself
 * ------------------------------------------------------------------------ */

/**
 * Settle any night falling today, from the day loop.
 *
 * The one thing that touches money: a single ledger line for the whole evening,
 * under `fundraising`, and the club's record of it. A night that loses money
 * books a negative line rather than being quietly forgotten, because that is
 * what happened.
 */
export function runFundraisingDay(state: GameState, date: ISODate): GameEvent[] {
  const store = scheduleStore(state);
  const due = store.events.filter(
    (event) => event.kind === 'fundraising' && event.date === date && event.resolvedOn === null,
  );
  const events: GameEvent[] = [];

  for (const event of due) {
    const clubId = event.clubIds[0];
    const kind = event.data.fundraiser;
    if (!clubId || !isFundraiserKind(kind)) {
      resolveScheduledEvent(state, event.id, 'Nothing came of it', date);
      continue;
    }
    const club = state.clubs[clubId];
    if (!club) {
      resolveScheduledEvent(state, event.id, 'The club is gone', date);
      continue;
    }

    const forecast = fundraiserForecast(state, clubId, kind, date);
    const line = addLedgerEntry(state, clubId, {
      date,
      description:
        forecast.net >= 0
          ? `${forecast.label} (${forecast.turnout} through the door)`
          : `${forecast.label} — costs not covered`,
      category: 'fundraising',
      amount: forecast.net,
    });

    const run: FundraisingRun = {
      id: nextId(state, 'fundraiser'),
      clubId,
      kind,
      date,
      seasonId: state.season.id,
      turnout: forecast.turnout,
      net: line?.amount ?? forecast.net,
    };
    const record = fundraisingStore(state);
    record.runs.unshift(run);
    if (record.runs.length > FUNDRAISING.historyLimit) record.runs.length = FUNDRAISING.historyLimit;

    resolveScheduledEvent(
      state,
      event.id,
      `${forecast.turnout} through the door · ${moneyText(run.net)}`,
      date,
    );

    // The night lands on the committee too, through the relationship they already
    // have: a good evening is worth something to the chairman, a bad one is a
    // concern he will remember.
    const chairman = clubChairman(state, clubId);
    const managerId = club.managerId;
    let afterword = '';
    if (chairman && managerId && chairman.id !== managerId) {
      const good = run.net >= Math.max(60, forecast.cost * 2);
      const bad = run.net < 0;
      if (good || bad) {
        const result = applyRelationshipEvent(state, {
          type: good ? 'chairman-praise' : 'chairman-concern',
          aId: chairman.id,
          bId: managerId,
          intensity: good ? 0.8 : 1,
          detail: `${forecast.label}: ${moneyText(run.net)}`,
          date,
          clubId,
        });
        if (result) afterword = ` ${result.description}.`;
      }
    }

    events.push(
      createEvent(state, {
        type: 'club-news',
        importance: run.net < 0 ? 2 : 1,
        clubIds: [clubId],
        personIds: managerId ? [managerId] : [],
        data: {
          headline:
            run.net < 0
              ? `${forecast.label} loses money`
              : `${forecast.label} raises ${moneyText(run.net)}`,
          body:
            run.net < 0
              ? `${forecast.turnout} came to the ${forecast.label.toLowerCase()} and it did not cover the ${moneyText(forecast.cost)} it cost to put on. The club is ${moneyText(Math.abs(run.net))} down.${afterword}`
              : `${forecast.turnout} through the door and ${moneyText(run.net)} cleared for the club.${afterword}`,
        },
      }),
    );
  }

  return events;
}

/** Simulation-side money text. The screens have their own formatter. */
function moneyText(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}£${Math.abs(rounded).toLocaleString('en-GB')}`;
}
