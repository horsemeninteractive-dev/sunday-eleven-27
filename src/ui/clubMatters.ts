import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import { isOfficial, isPlayer, personDisplayName } from '@/domain/person';
import { competenceLabel, STAFF_ROLE_LABEL, type StaffRole } from '@/domain/staff';
import type { ViewId } from '@/state/gameStore';
import { staffCompetence, staffIsAvailable, staffMembers } from '@/simulation/staff';
import { physioReport } from '@/simulation/staffOps';
import { formatShortDate } from '@/simulation/calendar';
import { currentMatchday, squadAvailability, squadOf, userClub } from '@/simulation/queries';
import { nextFixtureFor } from '@/simulation/schedule';
import { validateLineup } from '@/simulation/selection';
import { secretarySummary } from '@/simulation/secretary';
import { governanceSummary } from '@/simulation/governance';
import { renewalText, sponsorshipSummary } from '@/simulation/sponsorship';
import { sessionForecast } from '@/simulation/training/plan';
import { sessionRecordedFor } from '@/simulation/training/store';
import { treasurerSummary } from '@/simulation/treasurer';
import { kitDecisionOutstanding } from './kit';
import { moneyShort } from './format';
import { inboxRows } from './inboxState';

/**
 * What needs the manager, and where to go about it.
 *
 * This is the answer to one question — *what should I be looking at?* — and it
 * is written once, here, so Home and the Club screen cannot give two different
 * answers to it. Both read this list and show different amounts of it; neither
 * decides for itself what matters.
 *
 * Three rules, which are the whole design:
 *
 *  1. **Nothing is invented.** Every matter is read out of the system that owns
 *     the fact — the ledger, the secretary's desk, the chairman's expectations,
 *     the sponsorship agreement, the record of who played and who is fit. If a
 *     system has nothing to say, there is no card, and an empty list shows no
 *     section at all.
 *  2. **Every card is a door.** A card that names a man opens the conversation
 *     with him; a card about a fact opens the screen where the fact is dealt
 *     with, scrolled to the relevant part. A card you cannot act on is a
 *     notification, and notifications are what this screen exists to avoid.
 *  3. **One card per thing.** The treasurer writing about the arrears and the
 *     arrears themselves are the same matter, so the message wins and the fact
 *     stands down: the manager is told once, and told where to go.
 *
 * The list is short on purpose. It is ordered by how loudly each thing is
 * speaking, and it is capped, because a screen that shows everything shows
 * nothing — see `HOME_MATTER_LIMIT` and `CLUB_MATTER_LIMIT`.
 */

/** Where a card takes the manager when he presses it. */
export type MatterDestination =
  /** A screen, optionally scrolled to the part of it that matters. */
  | { kind: 'view'; view: ViewId; anchor?: string }
  /** The thread that is already waiting, opened on its newest message. */
  | { kind: 'conversation'; conversationId: string }
  /** The conversation with a person, opened where he is already known. */
  | { kind: 'person'; personId: PersonId };

export type MatterTone = 'bad' | 'warn' | 'info';

export interface ClubMatter {
  id: string;
  /** How it is labelled on the card: whether it is shouting or noting. */
  tone: MatterTone;
  /** The micro-label. One of three, so a wall of cards still reads at a glance. */
  label: string;
  title: string;
  detail: string;
  /** What it is about, so the same subject cannot appear twice. */
  topic: string;
  /** Higher speaks first. */
  weight: number;
  destination?: MatterDestination;
}

/* ------------------------------------------------------------------------ *\
 * Who runs the club
 * ------------------------------------------------------------------------ */

export interface ClubPerson {
  personId: PersonId;
  role: StaffRole;
  /** What the manager calls him here — "Assistant manager", "Treasurer". */
  roleLabel: string;
  name: string;
  /** True when he is around this week. */
  available: boolean;
  /** One word for how good he is at this job, where that is knowable at all. */
  competence: string | null;
  /** What is on him right now. Null is the ordinary case, and the common one. */
  issue: string | null;
  /** True for the manager's own row, which has no Message button. */
  isManager: boolean;
}

/**
 * The committee, as a manager would run through it.
 *
 * For each person: who they are, what they do, whether they are around, one
 * word on how good they are at it, and — only where there is one — the single
 * thing currently on them. The physio's list of knocks is an issue; his coaching
 * attributes are not, which is why nothing here reads an attribute that is not
 * the one for the job he actually holds.
 *
 * Read out of the systems that own each duty, so the line beside the treasurer
 * is the treasurer's own concern and the line beside the secretary is the state
 * of the desk. Two screens draw this list; neither works it out for itself.
 */
export function clubRoster(game: GameState, clubId: string = game.userClubId): ClubPerson[] {
  const club = game.clubs[clubId];
  if (!club) return [];
  const board = governanceSummary(game, clubId);
  const book = treasurerSummary(game, clubId);
  const desk = secretarySummary(game, clubId);
  const physio = physioReport(game, clubId);
  const arrears = book.outstanding.length;

  return staffMembers(club).map((member) => {
    const person = game.people[member.personId];
    const official = isOfficial(person) ? person : null;
    const available = official ? staffIsAvailable(official) : true;
    const issue = roleIssue(member.role, {
      // Only a genuine concern counts. A one-step "at risk" reading of an
      // expectation reads as reassurance — "a settled club" is not something
      // the chairman is carrying — so the line stays empty until he is actually
      // unhappy about something.
      boardConcern: board.concerns.find((concern) => concern.severity >= 2)?.text ?? null,
      moneyConcern:
        book.concerns.find((concern) => concern.kind !== 'no-treasurer' && concern.kind !== 'treasurer-away')?.text ??
        (arrears > 0 ? `${arrears} ${arrears === 1 ? 'man' : 'men'} still owe matchday subs` : null),
      deskConcern:
        desk.outstanding.length === 0
          ? null
          : desk.overdue > 0
            ? `${desk.overdue} overdue on the desk`
            : `${desk.needsManager} waiting on you`,
      knocks: physio.assessments.length > 0 ? `${physio.assessments.length} on the treatment table` : null,
      away: available ? null : official?.availability?.note ?? 'Away this week',
    });
    return {
      personId: member.personId,
      role: member.role,
      roleLabel: STAFF_ROLE_LABEL[member.role],
      name: person ? personDisplayName(person) : 'Vacant',
      available,
      competence: official ? competenceLabel(staffCompetence(official, member.role)) : null,
      issue,
      isManager: member.personId === club.managerId,
    };
  });
}

/**
 * What one office is currently carrying, if anything.
 *
 * The duty comes first and the absence is the fallback, for every role: a
 * secretary who is away with the registration form still unposted is carrying
 * the form, and that is the line the manager needs. Only when there is no duty
 * to report is "he is not here" the most useful thing to say.
 */
function roleIssue(
  role: StaffRole,
  context: { boardConcern: string | null; moneyConcern: string | null; deskConcern: string | null; knocks: string | null; away: string | null },
): string | null {
  const duty = (() => {
    switch (role) {
      case 'chairman':
        return context.boardConcern;
      case 'treasurer':
        return context.moneyConcern;
      case 'secretary':
        return context.deskConcern;
      case 'physio':
        return context.knocks;
      default:
        // These roles carry no standing duty the manager has to know about.
        return null;
    }
  })();
  return duty ?? context.away;
}

/** How many cards Home shows. More than four and it stops being a dashboard. */
export const HOME_MATTER_LIMIT = 4;
/** The Club screen is where the manager has asked to look, so it shows more. */
export const CLUB_MATTER_LIMIT = 8;

const LABEL: Record<MatterTone, string> = {
  bad: 'Action needed',
  warn: 'Worth a look',
  info: 'For information',
};

/**
 * Everything worth a card, loudest first.
 *
 * `limit` is applied after the list has been ordered and de-duplicated, so
 * asking Home for four never hides a genuine emergency behind three notes from
 * the secretary.
 */
export function clubMatters(game: GameState, limit = CLUB_MATTER_LIMIT): ClubMatter[] {
  const club = userClub(game);
  const matters: ClubMatter[] = [];

  matters.push(...messageMatters(game));
  matters.push(...moneyMatters(game, club.id));
  matters.push(...committeeMatters(game, club.id));
  matters.push(...sponsorMatters(game, club.id));
  matters.push(...teamMatters(game, club.id));

  // The first card on a subject wins. Messages are built first because a person
  // actually asking the manager for something outranks the system that noticed
  // the same thing, and because the manager's answer is the thing that resolves
  // it — the desk is where it is filed, the thread is where it is dealt with.
  const seen = new Set<string>();
  const ordered = matters
    .sort((a, b) => b.weight - a.weight)
    .filter((matter) => {
      if (seen.has(matter.topic)) return false;
      seen.add(matter.topic);
      return true;
    });

  return limit > 0 ? ordered.slice(0, limit) : ordered;
}

/* ------------------------------------------------------------------------ *\
 * People who have written
 * ------------------------------------------------------------------------ */

/**
 * The messages that are asking for the manager rather than telling him.
 *
 * Only `urgent` and `important` threads get a card here, which is the whole
 * reason priorities exist: an inbox of eleven ordinary notes is not something to
 * interrupt Home with, and a treasurer saying the account is empty is. The card
 * carries what was actually said, so the manager can judge it without opening
 * anything, and it opens that very thread.
 */
function messageMatters(game: GameState): ClubMatter[] {
  return inboxRows(game)
    .filter((row) => row.unread > 0 && row.attention)
    .map((row) => ({
      id: `message:${row.conversationId}`,
      tone: row.priority === 'urgent' ? ('bad' as const) : ('warn' as const),
      label: LABEL[row.priority === 'urgent' ? 'bad' : 'warn'],
      title: `${row.name} has written`,
      detail: row.preview,
      topic: `thread:${row.conversationId}`,
      weight: row.priority === 'urgent' ? 100 : 92,
      destination: { kind: 'conversation' as const, conversationId: row.conversationId },
    }));
}

/* ------------------------------------------------------------------------ *\
 * The money
 * ------------------------------------------------------------------------ */

function moneyMatters(game: GameState, clubId: string): ClubMatter[] {
  const club = game.clubs[clubId]!;
  const treasurer = treasurerSummary(game, clubId);
  const matters: ClubMatter[] = [];

  if (club.finances.balance < 0) {
    matters.push({
      id: 'balance',
      tone: 'bad',
      label: LABEL.bad,
      title: 'The club is in the red',
      detail: `${moneyShort(club.finances.balance)} in the account, and the bills keep coming.`,
      topic: 'money',
      weight: 88,
      destination: { kind: 'view', view: 'finances', anchor: 'money-outlook' },
    });
  } else if (club.finances.balance < 120) {
    matters.push({
      id: 'balance-low',
      tone: 'warn',
      label: LABEL.warn,
      title: 'Money is tight',
      detail: `${moneyShort(club.finances.balance)} left in the account.`,
      topic: 'money',
      weight: 48,
      destination: { kind: 'view', view: 'finances', anchor: 'money-outlook' },
    });
  }

  for (const concern of treasurer.concerns) {
    if (concern.kind === 'no-treasurer' || concern.kind === 'treasurer-away') continue;
    matters.push({
      id: `treasurer:${concern.kind}`,
      tone: concern.tone === 'bad' ? 'bad' : 'warn',
      label: LABEL[concern.tone === 'bad' ? 'bad' : 'warn'],
      title: 'The treasurer is worried about the money',
      detail: concern.text,
      topic: 'money',
      weight: concern.tone === 'bad' ? 86 : 64,
      destination: treasurer.responsibility.personId
        ? { kind: 'person', personId: treasurer.responsibility.personId }
        : { kind: 'view', view: 'finances', anchor: 'money-outlook' },
    });
  }

  // One card for the arrears as a whole, not one per man. The breakdown belongs
  // on the screen where the money is actually taken, and the manager does not
  // need six cards to learn that six men owe him.
  if (treasurer.outstanding.length > 0) {
    const rows = treasurer.outstanding;
    const biggest = rows[0]!;
    matters.push({
      id: 'arrears',
      tone: 'warn',
      label: LABEL.warn,
      title:
        rows.length === 1
          ? `${biggest.name} owes sub money`
          : `${rows.length} players owe sub money`,
      detail:
        rows.length === 1
          ? `${moneyShort(biggest.owed)} outstanding since ${biggest.matches} match${biggest.matches === 1 ? '' : 'es'}.`
          : `${moneyShort(treasurer.outstandingTotal)} outstanding, ${biggest.name} the most at ${moneyShort(biggest.owed)}.`,
      topic: 'arrears',
      weight: 80,
      // The money is taken on the Finances screen; the man is chased in the
      // thread. Both work, so the card goes where the debt is settled.
      destination: { kind: 'view', view: 'finances', anchor: 'money-owed' },
    });
  }

  return matters;
}

/* ------------------------------------------------------------------------ *\
 * The committee and the paperwork
 * ------------------------------------------------------------------------ */

function committeeMatters(game: GameState, clubId: string): ClubMatter[] {
  const matters: ClubMatter[] = [];
  const board = governanceSummary(game, clubId);

  for (const concern of board.concerns) {
    if (concern.severity < 2) continue;
    matters.push({
      id: `board:${concern.key}`,
      tone: concern.severity >= 3 ? 'bad' : 'warn',
      label: LABEL[concern.severity >= 3 ? 'bad' : 'warn'],
      title: board.chairmanName ? `${board.chairmanName} wants a word` : 'The committee wants a word',
      detail: concern.text,
      topic: 'board',
      weight: concern.severity >= 3 ? 90 : 70,
      destination: board.chairman ? { kind: 'person', personId: board.chairman.id } : { kind: 'view', view: 'staff', anchor: 'chairman' },
    });
  }

  if (board.canDismiss) {
    matters.push({
      id: 'board-position',
      tone: 'bad',
      label: LABEL.bad,
      title: 'Your position is on the line',
      detail: 'The committee has the grounds to make a change.',
      topic: 'board',
      weight: 94,
      destination: { kind: 'view', view: 'staff', anchor: 'chairman' },
    });
  }

  const desk = secretarySummary(game, clubId);
  const urgent = desk.outstanding.filter((item) => item.deadline !== null && item.deadline < game.date);
  const actionNeeded = desk.outstanding.filter((item) => item.actionRequired);

  if (urgent.length > 0) {
    matters.push({
      id: 'admin-overdue',
      tone: 'bad',
      label: LABEL.bad,
      title: urgent.length === 1 ? `${urgent[0]!.title} is overdue` : `${urgent.length} league matters are overdue`,
      detail: desk.identity.name ? `${desk.identity.name} is waiting on you.` : 'The paperwork is on your desk.',
      topic: 'admin',
      weight: 84,
      destination: { kind: 'view', view: 'staff', anchor: 'secretary-desk' },
    });
  } else if (actionNeeded.length > 0) {
    const first = actionNeeded[0]!;
    matters.push({
      id: 'admin',
      tone: first.importance >= 3 ? 'warn' : 'info',
      label: LABEL[first.importance >= 3 ? 'warn' : 'info'],
      title: first.title,
      detail: first.deadline ? `${first.detail} Have it done by ${formatShortDate(first.deadline)}.` : first.detail,
      topic: 'admin',
      weight: first.importance >= 3 ? 76 : 52,
      destination: { kind: 'view', view: 'staff', anchor: 'secretary-desk' },
    });
  }

  return matters;
}

/* ------------------------------------------------------------------------ *\
 * The sponsor
 * ------------------------------------------------------------------------ */

function sponsorMatters(game: GameState, clubId: string): ClubMatter[] {
  const club = game.clubs[clubId]!;
  const deal = sponsorshipSummary(game, clubId);
  const matters: ClubMatter[] = [];
  const chairman = governanceSummary(game, clubId).chairman;

  if (deal.issue) {
    matters.push({
      id: 'sponsor-issue',
      tone: deal.standing === 'lapsed' ? 'bad' : 'warn',
      label: LABEL[deal.standing === 'lapsed' ? 'bad' : 'warn'],
      title: `${deal.sponsorName ?? 'The sponsor'} have not paid`,
      detail: deal.issue,
      topic: 'sponsor',
      weight: deal.standing === 'lapsed' ? 82 : 74,
      destination: { kind: 'view', view: 'finances', anchor: 'sponsorship' },
    });
    return matters;
  }

  if (deal.renewalDue || (deal.renewalDate && deal.renewalDate <= addDaysIso(game.date, 28))) {
    matters.push({
      id: 'sponsor-renewal',
      tone: 'warn',
      label: LABEL.warn,
      title: `${deal.sponsorName ?? 'The sponsor'} are up for renewal`,
      detail: `${renewalText(game, deal)} · ${moneyShort(deal.instalment)} ${deal.frequency === 'weekly' ? 'a week' : 'a month'} coming in.`,
      topic: 'sponsor',
      weight: 72,
      destination: { kind: 'view', view: 'finances', anchor: 'sponsorship' },
    });
  }

  // A club with no sponsor at all is worth mentioning once the money is thin,
  // and never before: the manager has enough to do without being nagged about a
  // relationship he has not lost.
  if (!deal.deal && chairman && club.finances.balance < 150) {
    matters.push({
      id: 'sponsor-none',
      tone: 'info',
      label: LABEL.info,
      title: 'The club has no sponsor',
      detail: 'Income is leaner without one, and there are businesses on the doorstep.',
      topic: 'sponsor',
      weight: 44,
      destination: { kind: 'view', view: 'finances', anchor: 'sponsorship' },
    });
  }

  return matters;
}

/* ------------------------------------------------------------------------ *\
 * The football
 * ------------------------------------------------------------------------ */

function teamMatters(game: GameState, clubId: string): ClubMatter[] {
  const matters: ClubMatter[] = [];
  const matchday = currentMatchday(game);
  const squad = squadOf(game, clubId);
  const breakdown = squadAvailability(game, clubId);
  const next = nextFixtureFor(game, clubId, game.date);

  if (next) {
    const lineup = next.homeClubId === clubId ? next.lineups.home : next.lineups.away;
    const problems = validateLineup(lineup.starting, lineup.bench, (id) => {
      const person = game.people[id];
      return isPlayer(person) ? person : undefined;
    }).filter((problem) => problem.severity === 'error');
    if (problems.length > 0) {
      matters.push({
        id: 'selection',
        tone: 'bad',
        label: LABEL.bad,
        title: 'The team is not picked',
        detail: problems[0]!.message,
        topic: 'selection',
        weight: 78,
        destination: { kind: 'view', view: 'team' },
      });
    }
  }

  if (breakdown.unavailable.length > 0) {
    matters.push({
      id: 'unavailable',
      tone: breakdown.unavailable.length > 3 ? 'warn' : 'info',
      label: LABEL[breakdown.unavailable.length > 3 ? 'warn' : 'info'],
      title:
        breakdown.unavailable.length === 1
          ? `${breakdown.unavailable[0]!.surname} is out`
          : `${breakdown.unavailable.length} players unavailable`,
      detail: `${breakdown.unavailable.slice(0, 3).map((player) => player.surname).join(', ')}${
        breakdown.unavailable.length > 3 ? ` and ${breakdown.unavailable.length - 3} more` : ''
      }.`,
      topic: 'squad',
      weight: breakdown.unavailable.length > 3 ? 62 : 50,
      destination: { kind: 'view', view: 'squad' },
    });
  }

  const unhappy = squad.filter((player) => player.morale < 35);
  if (unhappy.length > 0) {
    matters.push({
      id: 'morale',
      tone: 'warn',
      label: LABEL.warn,
      title: unhappy.length === 1 ? `${unhappy[0]!.surname} is not happy` : `${unhappy.length} players are not happy`,
      detail: 'Morale decides who turns up and how they play.',
      topic: 'morale',
      weight: 56,
      destination: { kind: 'view', view: 'squad' },
    });
  }

  if (!sessionRecordedFor(game, clubId, matchday)) {
    const forecast = sessionForecast(game, clubId);
    if (forecast.attendance.attending.length < 11) {
      matters.push({
        id: 'attendance',
        tone: 'warn',
        label: LABEL.warn,
        title: `Only ${forecast.attendance.attending.length} expected at training`,
        detail: 'Work, kids and bad knees. The session will be thin.',
        topic: 'training',
        weight: 54,
        destination: { kind: 'view', view: 'training' },
      });
    }
  }

  // The shirts are a once-a-season decision made in pre-season, so this is a
  // note rather than a worry, and it disappears the moment it is answered.
  if (kitDecisionOutstanding(game, clubId)) {
    matters.push({
      id: 'kit',
      tone: 'info',
      label: LABEL.info,
      title: 'New kit for the season',
      detail: 'This summer’s shirts have arrived. Pick the one the club runs out in.',
      topic: 'kit',
      weight: 42,
      destination: { kind: 'view', view: 'kit' },
    });
  }

  return matters;
}

/** A date a few days on, for "coming up" checks. Kept local: this is a nudge, not a calendar. */
function addDaysIso(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
