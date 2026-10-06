/**
 * The bridge between the people who run the club and conversation.
 *
 * Everything the manager talks to off the pitch goes through here — the
 * treasurer with the book, the secretary with the paperwork, the chairman with
 * the view from the committee, the assistant, coach, physio and scout with the
 * football, and the sponsor through the man who signed them. This is not a
 * second messaging system: it is one more reader of the *one* Communication
 * system, exactly like `playerConversation.ts`, `paymentComms.ts` and
 * `availabilityComms.ts`. The conversations live in the same store, render on
 * the same screen and carry the same `Message` shape.
 *
 * The rule this module exists to keep is the whole of it:
 *
 *   **The systems that run the club decide; communication asks, explains and
 *   remembers.**
 *
 * Nothing here invents a balance, a fixture, an injury or an obligation. Every
 * answer is read out of the system that already owns the fact — the ledger, the
 * secretary's desk, the chairman's expectations, the physio's own report — and
 * the only times anything *changes* are the two places where the manager has
 * explicitly invoked a domain action: asking the chairman to back the club
 * (`requestChairmanBacking`) and asking the treasurer to see to a bill
 * (`addLedgerEntry`), both through the mechanism those systems already expose.
 *
 * Two smaller rules keep it from becoming a nuisance:
 *
 *  - **Inbound is event-driven and deduplicated.** A concern, a letter, a knock
 *    or a renewal is announced once, keyed on the fact that caused it, so a
 *    reloaded save or a day visited twice writes nothing new.
 *  - **Priorties mean something.** Most of this is `normal`; only a real
 *    problem — an overdraft, a missed deadline, a sponsor about to walk — is
 *    allowed to raise its voice.
 */

import {
  createEmptyConsequence,
  MANAGER_PERSON_ID,
  type CommunicationIntent,
  type Message,
  type MessagePriority,
  type ResponseOption,
} from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ISODate, PersonId } from '@/domain/ids';
import { isOfficial, isPlayer, personDisplayName, type Official } from '@/domain/person';
import { STAFF_ROLE_LABEL } from '@/domain/staff';
import { addDays, dayOfWeek, daysBetween, formatDayMonth } from '@/simulation/calendar';
import { clubChairman, clubExpectations, governanceSummary, requestChairmanBacking } from '@/simulation/governance';
import { addLedgerEntry } from '@/simulation/finance';
import { applyRelationshipEvent } from '@/simulation/relationships';
import { candidatesOf } from '@/simulation/recruitment/store';
import { nextFixtureFor } from '@/simulation/schedule';
import { clubSecretary, outstandingAdmin } from '@/simulation/secretary';
import { sponsorshipSummary, renewalText } from '@/simulation/sponsorship';
import { assistantAdvice, physioReport } from '@/simulation/staffOps';
import { staffIsAvailable } from '@/simulation/staff';
import { financialConcerns, financialResponsibility, outstandingSubs, treasurerSummary } from '@/simulation/treasurer';
import { hasDelivered } from './dedup';
import { recordCommunicationHistory } from './history';
import { appendMessage, lastMessageOf } from './store';
import { registerConsequence, sendFromManager, threadWith } from './system';

/* ------------------------------------------------------------------------ *\
 * Naming the people who run the club
 * ------------------------------------------------------------------------ */

/** The off-pitch and coaching roles a person can hold at a Sunday club. */
export type OfficeRole =
  | 'chairman'
  | 'treasurer'
  | 'secretary'
  | 'assistant'
  | 'coach'
  | 'physio'
  | 'scout';

export const OFFICE_ROLE_LABEL: Record<OfficeRole, string> = {
  chairman: STAFF_ROLE_LABEL.chairman,
  treasurer: STAFF_ROLE_LABEL.treasurer,
  secretary: STAFF_ROLE_LABEL.secretary,
  assistant: STAFF_ROLE_LABEL.assistant,
  coach: STAFF_ROLE_LABEL.coach,
  physio: STAFF_ROLE_LABEL.physio,
  scout: STAFF_ROLE_LABEL.scout,
};

/**
 * Which office, if any, a person holds at a club.
 *
 * Read straight off the club's own roster — the same ids the staff screen and
 * the treasurer and secretary services read — so there is no second list of who
 * does what. A person who holds no office is simply a person.
 */
export function officeRoleOf(state: GameState, personId: PersonId, clubId: string = state.userClubId): OfficeRole | null {
  const club = state.clubs[clubId];
  if (!club) return null;
  if (club.chairmanId === personId) return 'chairman';
  const staff = club.staff;
  if (staff?.treasurerId === personId) return 'treasurer';
  if (staff?.secretaryId === personId) return 'secretary';
  if (staff?.assistantId === personId) return 'assistant';
  if (staff?.physioId === personId) return 'physio';
  if (staff?.coachIds?.includes(personId)) return 'coach';
  if (staff?.scoutIds?.includes(personId)) return 'scout';
  return null;
}

/** The person holding an office, or null when the club has nobody in it. */
export function officerFor(state: GameState, role: OfficeRole, clubId: string = state.userClubId): Official | null {
  const club = state.clubs[clubId];
  if (!club) return null;
  const staff = club.staff;
  const id =
    role === 'chairman'
      ? club.chairmanId
      : role === 'treasurer'
        ? staff?.treasurerId
        : role === 'secretary'
          ? staff?.secretaryId
          : role === 'assistant'
            ? staff?.assistantId
            : role === 'physio'
              ? staff?.physioId
              : role === 'coach'
                ? staff?.coachIds?.[0]
                : staff?.scoutIds?.[0];
  const person = id ? state.people[id] : undefined;
  return isOfficial(person) ? person : null;
}

/** The kind of thread an office's conversation lives in. */
function threadTypeFor(role: OfficeRole): 'board' | 'staff' | 'club' {
  if (role === 'chairman') return 'board';
  if (role === 'treasurer' || role === 'secretary') return 'club';
  return 'staff';
}

/**
 * Open the thread with somebody who runs the club, or find the one that exists.
 *
 * Mirrors `openPlayerThread`: it ensures the thread is of the right kind for the
 * office, and refreshes the questions offered so the manager opens it to the
 * things this person can actually answer. A person who holds no office has no
 * thread here and gets `null`.
 */
export function openOfficerThread(state: GameState, personId: PersonId): string | null {
  const role = officeRoleOf(state, personId);
  if (!role) return null;
  const conversation = threadWith(state, personId, threadTypeFor(role));
  const last = lastMessageOf(state, conversation.id);
  if (last) last.responseOptions = officerResponseOptions(state, personId);
  return conversation.id;
}

/* ------------------------------------------------------------------------ *\
 * What the manager can ask
 * ------------------------------------------------------------------------ */

/**
 * The questions that make sense to this person, in the manager's own words.
 *
 * Read from the office the person holds, so a treasurer is offered the money
 * questions and never the fixture ones, and the chairman is offered the club and
 * never the subs book. Nothing is offered that the game cannot answer.
 */
export function officerResponseOptions(state: GameState, personId: PersonId): ResponseOption[] {
  const role = officeRoleOf(state, personId);
  if (!role) return [];
  const targetId = personId;
  const options: ResponseOption[] = [];
  const add = (intent: CommunicationIntent, label: string): void => {
    options.push({ intent, label, targetId });
  };

  switch (role) {
    case 'treasurer':
      add('ASK_FINANCES', 'How are we doing?');
      add('ASK_ARREARS', 'Who still owes subs?');
      add('ASK_TAKINGS', 'What did Sunday take?');
      if (treasurerSummary(state).balance < 0) add('ASK_AFFORD', 'Can we afford this?');
      else add('ASK_BILLS', 'Bills paid?');
      break;
    case 'secretary':
      add('ASK_LEAGUE_NEWS', 'League news?');
      add('ASK_FIXTURE_STATUS', 'Is Sunday confirmed?');
      add('ASK_AGM', 'When is the AGM?');
      add('ASK_FA', 'The county FA?');
      break;
    case 'chairman':
      add('ASK_EXPECTATIONS', 'What do you expect?');
      add('ASK_SUPPORT', 'Will you back me?');
      add('DISCUSS_CLUB', 'How do you see it?');
      add('DISCUSS_FINANCES', 'About the money?');
      add('EXPLAIN_DECISION', 'Let me explain');
      add('ASK_SPONSOR', 'The sponsor?');
      break;
    case 'assistant':
      add('ASK_ADVICE', 'What are you seeing?');
      add('CHECK_IN', 'How are things?');
      break;
    case 'coach':
      add('ASK_ADVICE', 'How are they looking?');
      add('CHECK_IN', 'How is the group?');
      break;
    case 'physio':
      add('ASK_ADVICE', 'Who is fit?');
      add('CHECK_IN', 'How are the knocks?');
      break;
    case 'scout':
      add('ASK_ADVICE', 'Any names?');
      add('CHECK_IN', 'Anything out there?');
      break;
  }
  return options;
}

/* ------------------------------------------------------------------------ *\
 * What they say
 * ------------------------------------------------------------------------ */

export interface OrganisationReply {
  body: string;
  /** A state tag, so a test can assert the words match the facts without matching prose. */
  replyState: string;
  priority: MessagePriority;
  context: Record<string, string | number>;
}

const money = (value: number): string => `£${Math.round(value)}`;
const round2 = (value: number): number => Math.round(value * 100) / 100;

function firstName(state: GameState, personId: PersonId): string {
  return state.people[personId]?.firstName ?? 'him';
}

/** The treasurer, reading the book that already exists. */
function treasurerReply(state: GameState, clubId: string, intent: CommunicationIntent): OrganisationReply {
  const club = state.clubs[clubId]!;
  const summary = treasurerSummary(state, clubId);
  switch (intent) {
    case 'ASK_FINANCES': {
      const concern = summary.concerns.find((entry) => entry.kind !== 'no-treasurer' && entry.kind !== 'treasurer-away') ?? null;
      const trend =
        summary.net < 0
          ? ` We are running about ${money(-summary.net)} down a month at the moment.`
          : summary.net > 0
            ? ' It is ticking over, which is all we ask.'
            : '';
      const body = concern
        ? `Straight with you: ${concern.text} The balance is ${money(summary.balance)}.${trend}`
        : `The book is fine. We are at ${money(summary.balance)}.${trend}`;
      return {
        body,
        replyState: summary.balance < 0 ? 'overdrawn' : summary.balance < 120 ? 'tight' : 'sound',
        priority: summary.balance < 0 ? 'important' : 'normal',
        context: { balance: round2(summary.balance), net: summary.net, outstanding: round2(summary.outstandingTotal) },
      };
    }
    case 'ASK_ARREARS': {
      const rows = outstandingSubs(state, clubId);
      if (rows.length === 0) {
        return { body: 'Nobody owes us a penny this week. Everyone is square.', replyState: 'clear', priority: 'normal', context: { count: 0 } };
      }
      const named = rows.slice(0, 3).map((row) => `${row.name} (${money(row.owed)})`).join(', ');
      const rest = rows.length > 3 ? `, and ${rows.length - 3} more` : '';
      return {
        body: `${named}${rest}. That is ${money(summary.outstandingTotal)} owed — owed, not banked.`,
        replyState: 'arrears',
        priority: 'normal',
        context: { count: rows.length, total: round2(summary.outstandingTotal) },
      };
    }
    case 'ASK_BILLS': {
      const last = [...club.finances.ledger].reverse().find((line) => line.category === 'pitch-hire') ?? null;
      if (!last) {
        return { body: 'There is no pitch invoice in the book this season. If one lands, I will see to it.', replyState: 'unpaid', priority: 'normal', context: { paid: 'no' } };
      }
      return {
        body: `The pitch hire is settled — ${money(Math.abs(last.amount))} went out on ${formatDayMonth(last.date)}.`,
        replyState: 'paid',
        priority: 'normal',
        context: { paid: 'yes', lastPaidOn: last.date },
      };
    }
    case 'ASK_TAKINGS': {
      const sunday = addDays(state.date, -dayOfWeek(state.date));
      const lines = club.finances.ledger.filter((line) => line.date >= sunday && line.amount > 0);
      const total = lines.reduce((sum, line) => sum + line.amount, 0);
      if (lines.length === 0) {
        return { body: 'Nothing came in on Sunday. The gate was the gate.', replyState: 'nothing', priority: 'normal', context: { total: 0 } };
      }
      const breakdown = lines
        .slice(0, 3)
        .map((line) => `${line.description.toLowerCase()} ${money(line.amount)}`)
        .join(', ');
      return { body: `Sunday brought in ${money(total)} — ${breakdown}.`, replyState: 'takings', priority: 'normal', context: { total: round2(total) } };
    }
    case 'ASK_AFFORD': {
      const balance = club.finances.balance;
      const body =
        balance >= 250
          ? `We can afford it, within reason. There is ${money(balance)} in the account.`
          : balance >= 0
            ? `It would leave us thin. There is ${money(balance)}, and the week's bills are not paid.`
            : `Not without somebody putting money in. We are ${money(-balance)} in the red already.`;
      return { body, replyState: balance < 0 ? 'cannot' : balance < 250 ? 'tight' : 'can', priority: 'normal', context: { balance: round2(balance) } };
    }
    default:
      return { body: 'Ask me again and I will have a look.', replyState: 'unknown', priority: 'normal', context: {} };
  }
}

/** The secretary, reading the desk that already exists. */
function secretaryReply(state: GameState, clubId: string, intent: CommunicationIntent): OrganisationReply {
  const open = outstandingAdmin(state, clubId);
  switch (intent) {
    case 'ASK_LEAGUE_NEWS': {
      const league = open.filter((item) => item.source === 'league' || item.source === 'competition');
      if (league.length === 0) return { body: 'Nothing outstanding from the league. The last bulletin is filed.', replyState: 'quiet', priority: 'normal', context: { count: 0 } };
      const top = league[0]!;
      return { body: `${top.title} — ${top.detail}`, replyState: 'news', priority: top.importance >= 3 ? 'important' : 'normal', context: { count: league.length, category: top.category } };
    }
    case 'ASK_FA': {
      const fa = open.filter((item) => item.source === 'fa');
      if (fa.length === 0) return { body: 'The county have not written since the last letter. Nothing pending.', replyState: 'quiet', priority: 'normal', context: { count: 0 } };
      const top = fa[0]!;
      return { body: `${top.title} — ${top.detail}`, replyState: 'fa', priority: top.importance >= 3 ? 'important' : 'normal', context: { count: fa.length } };
    }
    case 'ASK_AGM': {
      const agm = open.find((item) => item.category === 'agm');
      if (!agm) return { body: 'The AGM is on the calendar for the end of the season. Nothing to do yet.', replyState: 'future', priority: 'normal', context: { agenda: '' } };
      const agenda = agm.agenda.slice(0, 2).join(', ');
      return {
        body: `${agm.title} is on ${formatDayMonth(agm.date)}${agm.deadline ? `, and you have until ${formatDayMonth(agm.deadline)}` : ''}.${agenda ? ` Agenda: ${agenda}.` : ''}${agm.attendanceRequired ? ' They expect you there in person.' : ''}`,
        replyState: 'agm',
        priority: agm.deadline && agm.deadline < addDays(state.date, 7) ? 'important' : 'normal',
        context: { agenda, attendance: agm.attendanceRequired ? 'yes' : 'no' },
      };
    }
    case 'ASK_FIXTURE_STATUS': {
      const fixture = nextFixtureFor(state, clubId);
      if (!fixture) return { body: 'There is no fixture on the books at the moment.', replyState: 'none', priority: 'normal', context: { status: 'none' } };
      const home = state.clubs[fixture.homeClubId]?.identity.shortName ?? 'us';
      const away = state.clubs[fixture.awayClubId]?.identity.shortName ?? 'them';
      if (fixture.status === 'postponed' || fixture.status === 'abandoned') {
        const replacement = fixture.replacedByMatchId ? state.matches[fixture.replacedByMatchId] : undefined;
        const when = replacement ? ` It has been rearranged for ${formatDayMonth(replacement.date)}.` : ' There is no new date yet.';
        return {
          body: `${home} v ${away} is off — ${fixture.postponementReason ?? 'the league called it off'}.${when}`,
          replyState: 'moved',
          priority: 'important',
          context: { status: fixture.status, matchId: fixture.id },
        };
      }
      return {
        body: `Confirmed: ${home} v ${away} on ${formatDayMonth(fixture.date)}, ${fixture.kickOff}. Nothing has come through to change it.`,
        replyState: 'confirmed',
        priority: 'normal',
        context: { status: fixture.status, matchId: fixture.id },
      };
    }
    default:
      return { body: 'I will have a look at the file and come back to you.', replyState: 'unknown', priority: 'normal', context: {} };
  }
}

/** The chairman, reading the committee's own view of the club. */
function chairmanReply(state: GameState, clubId: string, intent: CommunicationIntent): OrganisationReply {
  switch (intent) {
    case 'ASK_EXPECTATIONS': {
      const expectations = clubExpectations(state, clubId);
      const league = expectations.find((entry) => entry.key === 'league');
      const atRisk = expectations.filter((entry) => entry.status === 'at-risk' || entry.status === 'failed');
      const lead = league ? `A club like ours should be around where we were last year. ${league.detail}` : 'I want a season we can be proud of.';
      const worry = atRisk.length > 0 ? ` What bothers me is ${atRisk.map((entry) => entry.label.toLowerCase()).join(' and ')}.` : '';
      return {
        body: `${lead}${worry}`,
        replyState: atRisk.some((entry) => entry.status === 'failed') ? 'concerned' : atRisk.length > 0 ? 'watchful' : 'content',
        priority: atRisk.some((entry) => entry.status === 'failed') ? 'important' : 'normal',
        context: { atRisk: atRisk.map((entry) => entry.key).join(',') },
      };
    }
    case 'ASK_SUPPORT': {
      // The one place a message genuinely acts: asking the chairman to back the
      // club runs the existing backing mechanism, and this reads its answer.
      const result = requestChairmanBacking(state, clubId);
      const lines: Record<string, { body: string; priority: MessagePriority }> = {
        granted: { body: `Right — I have put ${money(result.amount)} in to steady the ship. Do not make me regret it, but I am behind you.`, priority: 'important' },
        'no-need': { body: 'You do not need me to. The club is not in the red — ask me when it actually is.', priority: 'normal' },
        refused: { body: 'I thought about it, and no. The club has put enough in for now, and I am not convinced it would be money well spent.', priority: 'important' },
        'already-asked': { body: 'You have already had your ask this season. There is no pot to go back to.', priority: 'normal' },
        'no-chairman': { body: 'There is nobody in the chair to ask.', priority: 'normal' },
      };
      const line = lines[result.reason] ?? lines['no-need']!;
      return { body: line.body, replyState: `support-${result.reason}`, priority: line.priority, context: { reason: result.reason, amount: result.amount } };
    }
    case 'EXPLAIN_DECISION': {
      const gov = governanceSummary(state, clubId);
      const concern = gov.concerns[0] ?? null;
      const body = concern
        ? `I hear you, and I am glad you came to me. But I have to say it plainly: ${concern.text} Sort that and the rest looks after itself.`
        : 'I hear you. You will not always get it right, and I would rather you explained it than hid it. Fine.';
      return { body, replyState: concern ? 'concerned' : 'reassured', priority: concern && concern.severity >= 3 ? 'important' : 'normal', context: { concern: concern?.key ?? '' } };
    }
    case 'DISCUSS_FINANCES': {
      const club = state.clubs[clubId]!;
      const finance = clubExpectations(state, clubId).find((entry) => entry.key === 'finances');
      const balance = club.finances.balance;
      const body =
        balance < 0
          ? `The money is the thing I lose sleep over. We are ${money(-balance)} in the red, and I do not like it any more than you do. If it comes to it I will help — but once, and only if I believe in what you are doing.`
          : `We are not badly off — ${money(balance)} in the account. ${finance ? finance.detail : ''} I would rather we kept it that way.`;
      return {
        body,
        replyState: balance < 0 ? 'worried' : 'steady',
        priority: balance < 0 ? 'important' : 'normal',
        context: { balance: round2(balance) },
      };
    }
    case 'DISCUSS_CLUB':
    default: {
      const gov = governanceSummary(state, clubId);
      const concern = gov.concerns.find((entry) => entry.severity >= 2) ?? null;
      const standingLine =
        gov.standing === 'support' || gov.standing === 'content'
          ? 'The committee could not be happier.'
          : gov.standing === 'pressure' || gov.standing === 'dismissal'
            ? 'The committee is watching, and I will not pretend otherwise.'
            : 'The committee is uneasy, if I am honest.';
      const rel = gov.relationship ? ` As for you and me, ${gov.relationship.toLowerCase()}.` : '';
      const worry = concern ? ` ${concern.text}` : '';
      return { body: `${standingLine}${rel}${worry}`, replyState: concern ? 'concerned' : 'content', priority: concern && concern.severity >= 3 ? 'important' : 'normal', context: { standing: gov.standing } };
    }
  }
}

/** The staff, reading the football they already look after. */
function staffReply(state: GameState, clubId: string, role: OfficeRole): OrganisationReply {
  if (role === 'physio') {
    const report = physioReport(state, clubId);
    const hurt = report.assessments;
    if (hurt.length === 0) return { body: 'Nobody is carrying anything. They can all train tonight.', replyState: 'clear', priority: 'normal', context: { injured: 0 } };
    const lead = hurt[0]!;
    const more = hurt.length > 1 ? ` And ${hurt.length - 1} other${hurt.length > 2 ? 's' : ''} want watching.` : '';
    return {
      body: `${lead.name} should not train tonight — ${lead.injury.toLowerCase()}, and I would give it ${lead.estimateDays} day${lead.estimateDays === 1 ? '' : 's'} yet.${more}`,
      replyState: 'injuries',
      priority: 'normal',
      context: { injured: hurt.length, personId: lead.personId },
    };
  }
  if (role === 'scout') {
    const found = candidatesOf(state).filter((candidate) => candidate.discoveredVia === 'scout');
    const latest = found[found.length - 1];
    if (!latest) return { body: 'Nothing worth a phone call this week. I will keep looking.', replyState: 'none', priority: 'normal', context: { count: 0 } };
    const player = state.people[latest.personId];
    const who = player ? personDisplayName(player) : 'a lad';
    return { body: `${who} — ${latest.sourceNote}`, replyState: 'name', priority: 'normal', context: { personId: latest.personId } };
  }

  // assistant or coach: both read the assistant's own weekly advice.
  const advice = assistantAdvice(state, clubId);
  if (!advice.available || advice.lines.length === 0) {
    return { body: 'Nothing jumping out at me this week. I will have a proper look at the session.', replyState: 'quiet', priority: 'normal', context: {} };
  }
  return { body: advice.lines.map((line) => line.text).join(' '), replyState: role, priority: 'normal', context: { lines: advice.lines.length } };
}

/**
 * What a member of the club says back.
 *
 * The office decides which system is read, and the intent within it decides
 * which fact is quoted. Every branch reads; none of them writes, save for the
 * two intents that are an explicit request for a domain action.
 */
export function draftOrganisationReply(
  state: GameState,
  personId: PersonId,
  intent: CommunicationIntent,
): OrganisationReply | null {
  const role = officeRoleOf(state, personId);
  if (!role) return null;
  const clubId = state.userClubId;
  switch (role) {
    case 'treasurer':
      return treasurerReply(state, clubId, intent);
    case 'secretary':
      return secretaryReply(state, clubId, intent);
    case 'chairman':
      if (intent === 'ASK_SPONSOR') return sponsorViaChairman(state, clubId);
      return chairmanReply(state, clubId, intent);
    default:
      return staffReply(state, clubId, role);
  }
}

/** The sponsor, relayed by the chairman: sponsorship is a Business, not a person. */
function sponsorViaChairman(state: GameState, clubId: string): OrganisationReply {
  const summary = sponsorshipSummary(state, clubId);
  if (!summary.deal) {
    return { body: 'We have no sponsor at the moment. If you want one, that is a job for the summer.', replyState: 'none', priority: 'normal', context: { sponsored: 'no' } };
  }
  const issue = summary.issue ? ` One thing — ${summary.issue.toLowerCase()}` : '';
  return {
    body: `${summary.sponsorName} are our sponsor — ${money(summary.instalment)} ${summary.frequency === 'weekly' ? 'a week' : 'a month'}. ${renewalText(state, summary)}.${issue}`,
    replyState: summary.issue ? 'issue' : 'fine',
    priority: summary.issue ? 'important' : 'normal',
    context: { dealId: summary.deal.id, sponsorId: summary.deal.sponsorId, issue: summary.issue ?? '' },
  };
}

/* ------------------------------------------------------------------------ *\
 * The manager writing to them
 * ------------------------------------------------------------------------ */

/**
 * Write to somebody who runs the club, and get their answer.
 *
 * The shape is the same as any other conversation — thread, the manager's line,
 * the reply, a small move in the relationship — with one difference: the reply
 * is drafted from the office above rather than from the generic register, and
 * the consequence hooks are run before it is written so that asking a question
 * that *acts* (backing, a bill) reads the state it has just changed.
 */
export function sendOrganisationMessage(
  state: GameState,
  personId: PersonId,
  intent: CommunicationIntent,
): { message: Message; reply: Message | null } | null {
  const role = officeRoleOf(state, personId);
  if (!role) return null;
  ensureOrganisationConsequences();

  const conversation = threadWith(state, personId, threadTypeFor(role));
  const sent = sendFromManager(state, {
    conversationId: conversation.id,
    intent,
    targetId: personId,
    context: { name: firstName(state, personId), topic: OFFICE_ROLE_LABEL[role] },
    deliver: false,
  });
  const message = sent.message;
  if (!message) return null;

  const drafted = draftOrganisationReply(state, personId, intent);
  if (!drafted) return { message, reply: null };

  message.consequence.resolvedOn = state.date;
  message.consequence.outcome = `Answered: ${drafted.replyState}`;

  const reply = appendMessage(state, conversation.id, {
    senderId: personId,
    recipientIds: [MANAGER_PERSON_ID],
    body: drafted.body,
    type: 'answer',
    context: { ...drafted.context, role, replyState: drafted.replyState },
    subject: conversation.subject ?? null,
    priority: drafted.priority,
    responseOptions: [],
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, {}),
    read: false,
  });
  if (reply) {
    reply.consequence.resolvedOn = state.date;
    reply.consequence.outcome = `Answered: ${drafted.replyState}`;
  }

  applyOfficerRelationship(state, personId, intent);
  const last = lastMessageOf(state, conversation.id);
  if (last) last.responseOptions = officerResponseOptions(state, personId);
  return { message, reply };
}

/**
 * How much a word with an officer moves the relationship.
 *
 * Small and one-directional on purpose: the manager chose to talk to this person,
 * so the club's own people warm to him very slightly — except when he has gone to
 * the chairman to ask for money, which the backing mechanism has already scored.
 */
function applyOfficerRelationship(state: GameState, personId: PersonId, intent: CommunicationIntent): void {
  if (intent === 'ASK_SUPPORT') return;
  const role = officeRoleOf(state, personId);
  if (!role) return;
  // The chairman has his own event; everybody else on the club's business shares
  // one, so their relationship is moved the same modest way every time.
  const type = role === 'chairman' ? 'chairman-praise' : 'club-officer-word';
  applyRelationshipEvent(state, {
    type,
    aId: MANAGER_PERSON_ID,
    bId: personId,
    intensity: 0.2,
    detail: 'The manager came to him about the club',
  });
}

/* ------------------------------------------------------------------------ *\
 * The one intent that acts
 * ------------------------------------------------------------------------ */

/**
 * Register the hook that lets a question change the book.
 *
 * Asking the treasurer whether the bills are paid is not merely a question: a
 * treasurer asked will go and settle the invoice, and settling it is the finance
 * system's own `addLedgerEntry` and nothing else. That is the whole consequence
 * rule in one place — communication does not invent a balance, it invokes the
 * mechanism that owns one.
 *
 * Registration is idempotent, and safe to call even after a test has cleared
 * the global handlers, because the map refuses a duplicate.
 */
export function ensureOrganisationConsequences(): void {
  registerConsequence('ASK_BILLS', payOutstandingPitchInvoice);
}

/** Settle a standing pitch invoice through the ledger, once, when asked. */
function payOutstandingPitchInvoice(state: GameState, message: Message): void {
  const clubId = state.userClubId;
  const club = state.clubs[clubId];
  if (!club) return;
  const paidThisSeason = club.finances.ledger.some(
    (line) => line.category === 'pitch-hire' && line.date >= state.season.startDate,
  );
  if (paidThisSeason) return;
  const amount = Math.max(0, club.finances.weeklyGroundCost);
  if (amount <= 0) return;
  addLedgerEntry(state, clubId, {
    date: state.date,
    description: 'Pitch hire invoice (settled by the treasurer)',
    category: 'pitch-hire',
    amount: -amount,
  });
  message.consequence.context = { ...message.consequence.context, paidPitch: amount };
}

/* ------------------------------------------------------------------------ *\
 * Writing to the manager, once per fact
 * ------------------------------------------------------------------------ */

interface InboundSpec {
  personId: PersonId;
  role: OfficeRole;
  body: string;
  type: Message['type'];
  priority: MessagePriority;
  context: Record<string, string | number>;
}

/** Put a message from somebody who runs the club into their thread. */
function writeInbound(state: GameState, spec: InboundSpec): Message | null {
  const conversation = threadWith(state, spec.personId, threadTypeFor(spec.role));
  const message = appendMessage(state, conversation.id, {
    senderId: spec.personId,
    recipientIds: [MANAGER_PERSON_ID],
    body: spec.body,
    type: spec.type,
    context: { ...spec.context, role: spec.role },
    subject: conversation.subject ?? null,
    priority: spec.priority,
    responseOptions: officerResponseOptions(state, spec.personId),
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, {}),
    read: false,
  });
  if (message) {
    const last = lastMessageOf(state, conversation.id);
    if (last) last.responseOptions = officerResponseOptions(state, spec.personId);
  }
  return message;
}

/** Where the manager is, for the managers who are also an officer. */
function managerIdOf(state: GameState): PersonId | null {
  return state.clubs[state.userClubId]?.managerId ?? null;
}

/* ------------------------------------------------------------------------ *\
 * The treasurer writing about the money
 * ------------------------------------------------------------------------ */

/**
 * The treasurer raises what the book actually says, once per concern a season.
 *
 * Only an appointed treasurer writes — when the manager holds the book himself
 * there is nobody to write to him — and each kind of worry (overdrawn, tight,
 * arrears) is announced at most once a season, so the answers stay rare enough
 * to read.
 */
export function announceFinancialConcern(state: GameState, _date: ISODate = state.date): Message[] {
  const clubId = state.userClubId;
  const club = state.clubs[clubId];
  const responsibility = financialResponsibility(state, clubId);
  if (!club || responsibility.role !== 'treasurer' || !responsibility.personId) return [];
  // When the manager holds the book himself there is nobody to write to him.
  if (responsibility.personId === managerIdOf(state)) return [];
  const personId = responsibility.personId;
  const out: Message[] = [];

  for (const concern of financialConcerns(state, clubId)) {
    if (concern.kind === 'no-treasurer' || concern.kind === 'treasurer-away') continue;
    const key = `treasurer:${concern.kind}:${state.season.id}`;
    if (hasDelivered(state, key)) continue;
    const body =
      concern.kind === 'overdrawn'
        ? `Manager, we are in the red — ${money(club.finances.balance)}. The next bill comes out of an empty account.`
        : concern.kind === 'tight'
          ? `I am keeping an eye on the book. There is ${money(club.finances.balance)} left, and a pitch hire and a referee would take most of it.`
          : (() => {
              const rows = outstandingSubs(state, clubId);
              const total = round2(rows.reduce((sum, row) => sum + row.owed, 0));
              return `${rows.length} ${rows.length === 1 ? 'man' : 'men'} still owe matchday subs — ${money(total)} in all. It is owed, not banked.`;
            })();
    const message = writeInbound(state, {
      personId,
      role: 'treasurer',
      body,
      type: concern.kind === 'arrears' ? 'notice' : 'warning',
      priority: concern.tone === 'bad' ? 'important' : 'normal',
      context: { deliveryKey: key, concern: concern.kind, amount: concern.amount ?? 0 },
    });
    if (message) out.push(message);
    if (message && concern.kind === 'overdrawn') {
      // The one financial moment a Sunday club is still talking about in ten
      // years. It is a fact about the club, so it belongs in the club's own
      // record and not only in a thread the manager may have scrolled past.
      recordCommunicationHistory(state, {
        kind: 'financial-crisis',
        importance: 2,
        description: `The club account went into the red (${money(club.finances.balance)}).`,
        key: `history:${key}`,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ *\
 * The secretary writing about the papers
 * ------------------------------------------------------------------------ */

/**
 * The secretary passes on what the desk actually holds.
 *
 * Only what the manager has to do something about, or what is genuinely worth
 * reading, and only while it is fresh or already late — so a backlog does not
 * land in one go. An overdue deadline is the one thing that raises its voice.
 */
export function announceAdminCorrespondence(state: GameState, date: ISODate = state.date): Message[] {
  const clubId = state.userClubId;
  const secretary = clubSecretary(state, clubId);
  const managerId = managerIdOf(state);
  if (!secretary.personId || secretary.personId === managerId) return [];
  const out: Message[] = [];
  let announced = 0;

  // What is worth saying, in the order it is worth saying it: what is already
  // late first, then the weightier letters, then the older ones. A day never
  // delivers the whole desk in one go — three at most — so the manager reads a
  // letter rather than a filing cabinet.
  const candidates = outstandingAdmin(state, clubId)
    .map((item) => ({ item, overdue: item.deadline !== null && item.deadline < date, fresh: daysBetween(item.receivedOn, date) <= 1 }))
    .filter(({ item, overdue, fresh }) => (overdue || fresh) && (overdue || item.actionRequired || item.importance >= 2))
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        b.item.importance - a.item.importance ||
        (a.item.receivedOn < b.item.receivedOn ? -1 : 1),
    );

  for (const { item, overdue } of candidates) {
    if (announced >= 3) break;
    const key = `secretary:${item.id}`;
    if (hasDelivered(state, key)) continue;
    const priority: MessagePriority = overdue ? 'urgent' : item.importance >= 3 ? 'important' : 'normal';
    const body = `${item.title} — ${item.detail}${item.deadline ? ` Have it done by ${formatDayMonth(item.deadline)}.` : ''}`;
    const message = writeInbound(state, {
      personId: secretary.personId,
      role: 'secretary',
      body,
      type: item.category === 'disciplinary' ? 'notice' : 'answer',
      priority,
      context: { deliveryKey: key, adminId: item.id, category: item.category, source: item.source, importance: item.importance },
    });
    if (message) {
      out.push(message);
      announced += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ *\
 * The chairman writing about the club
 * ------------------------------------------------------------------------ */

/**
 * The chairman says what the committee is actually worried about — once.
 *
 * A real concern gets a letter; a clean sheet sometimes gets a word of praise,
 * which is a `social` message and asks nothing of the manager at all.
 */
export function announceGovernanceConcern(state: GameState, date: ISODate = state.date): Message[] {
  void date;
  const clubId = state.userClubId;
  const chairman = clubChairman(state, clubId);
  if (!chairman) return [];
  const summary = governanceSummary(state, clubId);
  const out: Message[] = [];

  for (const concern of summary.concerns) {
    if (concern.severity < 2) continue;
    const key = `chairman:${concern.key}:${state.season.id}`;
    if (hasDelivered(state, key)) continue;
    const body = `I will be straight with you: ${concern.text} I am not going anywhere yet, but I want it sorted.`;
    const message = writeInbound(state, {
      personId: chairman.id,
      role: 'chairman',
      body,
      type: concern.severity >= 3 ? 'warning' : 'notice',
      priority: concern.severity >= 3 ? 'important' : 'normal',
      context: { deliveryKey: key, concern: concern.key, severity: concern.severity },
    });
    if (message) out.push(message);
    if (message && concern.severity >= 3) {
      // A serious word from the committee belongs beside the promotions and the
      // cup runs. A mild one stays in the thread where it was said.
      recordCommunicationHistory(state, {
        kind: 'governance-concern',
        importance: 3,
        description: concern.text,
        key: `history:${key}`,
      });
    }
  }

  if (summary.concerns.length === 0 && (summary.standing === 'support' || summary.standing === 'content')) {
    const key = `chairman:praise:${state.season.id}`;
    if (!hasDelivered(state, key)) {
      const message = writeInbound(state, {
        personId: chairman.id,
        role: 'chairman',
        body: 'No complaints from me. The club is being run properly and the committee has noticed.',
        type: 'thanks',
        priority: 'social',
        context: { deliveryKey: key },
      });
      if (message) out.push(message);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ *\
 * The staff writing about the football
 * ------------------------------------------------------------------------ */

/**
 * The staff bring the manager what they actually see.
 *
 * Each of them is grounded in the system that already knows: the physio in the
 * injury record, the assistant in the same weekly advice the staff screen shows,
 * the coach in the knocks the squad is carrying, the scout in the names the
 * recruitment system recorded. A club without the role hears nothing, which is
 * the ordinary state of a Sunday club.
 */
export function announceStaffConcern(state: GameState, date: ISODate = state.date): Message[] {
  const clubId = state.userClubId;
  const club = state.clubs[clubId];
  if (!club) return [];
  const out: Message[] = [];
  const weekday = dayOfWeek(date);

  // The physio, on a knock that only happened today.
  const physio = officerFor(state, 'physio', clubId);
  if (physio && staffIsAvailable(physio)) {
    for (const playerId of club.squadIds) {
      const player = state.people[playerId];
      if (!isPlayer(player) || !player.injury) continue;
      if (player.injury.occurredOn !== date) continue;
      const key = `physio:${playerId}:${player.injury.occurredOn}`;
      if (hasDelivered(state, key)) continue;
      const message = writeInbound(state, {
        personId: physio.id,
        role: 'physio',
        body: `${player.firstName} should not train tonight — ${player.injury.description.toLowerCase()}. I will look at him properly tomorrow.`,
        type: 'notice',
        priority: 'normal',
        context: { deliveryKey: key, personId: playerId },
      });
      if (message) out.push(message);
    }
  }

  // The assistant, once a week, and only when there is something to warn about.
  if (weekday === 1) {
    const assistant = officerFor(state, 'assistant', clubId);
    const advice = assistant ? assistantAdvice(state, clubId) : null;
    const warn = advice?.lines.filter((line) => line.tone === 'warn' || line.tone === 'accent') ?? [];
    const key = `assistant:${date}`;
    if (assistant && staffIsAvailable(assistant) && advice?.available && warn.length > 0 && !hasDelivered(state, key)) {
      const message = writeInbound(state, {
        personId: assistant.id,
        role: 'assistant',
        body: warn[0]!.text,
        type: 'notice',
        priority: 'normal',
        context: { deliveryKey: key },
      });
      if (message) out.push(message);
    }
  }

  // The coach, on the night of the session — and only when there is actually
  // something to say. A coach who texts the same sentence every Thursday is a
  // coach the manager stops reading, and "nothing out of the ordinary" is not
  // news. A squad carrying knocks is.
  if (weekday === 4) {
    const coach = officerFor(state, 'coach', clubId);
    const carrying = club.squadIds
      .map((id) => state.people[id])
      .filter((person) => isPlayer(person) && person.injury).length;
    const key = `coach:knocks:${date}`;
    if (coach && staffIsAvailable(coach) && carrying >= 2 && !hasDelivered(state, key)) {
      const message = writeInbound(state, {
        personId: coach.id,
        role: 'coach',
        body: `Pitch is poor today and we have ${carrying} carrying knocks, so I will keep the session light.`,
        type: 'notice',
        priority: 'normal',
        context: { deliveryKey: key },
      });
      if (message) out.push(message);
    }
  }

  // The scout, on a name he has just brought back.
  const scout = officerFor(state, 'scout', clubId);
  if (scout && staffIsAvailable(scout)) {
    const found = candidatesOf(state).filter((candidate) => candidate.discoveredVia === 'scout');
    const latest = found[found.length - 1];
    if (latest) {
      const key = `scout:${latest.personId}`;
      if (!hasDelivered(state, key)) {
        const player = state.people[latest.personId];
        const who = player ? personDisplayName(player) : 'a lad';
        const message = writeInbound(state, {
          personId: scout.id,
          role: 'scout',
          body: `${who} — ${latest.sourceNote}`,
          type: 'notice',
          priority: 'normal',
          context: { deliveryKey: key, personId: latest.personId },
        });
        if (message) out.push(message);
      }
    }
  }

  // A staff member away this week says so — once, on the Monday the week turns.
  if (weekday === 1) {
    const roles: OfficeRole[] = ['assistant', 'coach', 'physio', 'secretary', 'treasurer', 'scout'];
    for (const role of roles) {
      const person = officerFor(state, role, clubId);
      if (!person || staffIsAvailable(person)) continue;
      const key = `staff-away:${person.id}:${date}`;
      if (hasDelivered(state, key)) continue;
      const message = writeInbound(state, {
        personId: person.id,
        role,
        body: `I cannot make it this week — ${person.availability?.note ?? 'something has come up'}. I will catch up when I am back.`,
        type: 'notice',
        priority: 'normal',
        context: { deliveryKey: key, away: 'yes' },
      });
      if (message) out.push(message);
    }
  }

  return out;
}

/* ------------------------------------------------------------------------ *\
 * The sponsor, relayed through the chairman
 * ------------------------------------------------------------------------ */

/**
 * What the sponsor says, brought to the manager by the man who signed them.
 *
 * A sponsor is a `Business`, and a conversation in this game is with a `Person`,
 * so sponsorship news arrives through the chairman — the person who actually owns
 * the commercial relationship. It is deliberately rare: a payment that has not
 * come, and a deal coming up for renewal, and nothing else.
 */
export function announceSponsorMatter(state: GameState, date: ISODate = state.date): Message[] {
  const clubId = state.userClubId;
  const chairman = clubChairman(state, clubId);
  if (!chairman) return [];
  const summary = sponsorshipSummary(state, clubId);
  if (!summary.deal) return [];
  const deal = summary.deal;
  const out: Message[] = [];

  if (summary.issue) {
    const key = `sponsor:issue:${deal.id}:${summary.missedCount}`;
    if (!hasDelivered(state, key)) {
      const message = writeInbound(state, {
        personId: chairman.id,
        role: 'chairman',
        body: `${summary.sponsorName} have not paid. ${summary.issue} I will chase them, but you should know.`,
        type: 'warning',
        priority: 'important',
        context: { deliveryKey: key, sponsorId: deal.sponsorId, kind: 'payment' },
      });
      if (message) out.push(message);
    }
  }

  if (summary.renewalDate) {
    const days = daysBetween(date, summary.renewalDate);
    if (days >= 0 && days <= 21) {
      const key = `sponsor:renewal:${deal.id}`;
      if (!hasDelivered(state, key)) {
        const message = writeInbound(state, {
          personId: chairman.id,
          role: 'chairman',
          body: `${summary.sponsorName}'s deal runs out on ${formatDayMonth(summary.renewalDate)}. I will get on to them about renewing — worth us having a word first.`,
          type: 'reminder',
          priority: 'important',
          context: { deliveryKey: key, sponsorId: deal.sponsorId, kind: 'renewal' },
        });
        if (message) out.push(message);
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------------ *\
 * The club's day
 * ------------------------------------------------------------------------ */

/**
 * Everything the club says to the manager today.
 *
 * Called once from the day loop, after the secretary has had his day and the
 * money has been settled, so every announcer below is reading a state that is
 * already current. Each of them is deduplicated on the fact that caused it, which
 * is what keeps a run of quiet days silent rather than a daily digest.
 */
export function runOrganisationComms(state: GameState, date: ISODate = state.date): Message[] {
  ensureOrganisationConsequences();
  const out: Message[] = [];
  out.push(...announceFinancialConcern(state, date));
  out.push(...announceAdminCorrespondence(state, date));
  out.push(...announceGovernanceConcern(state, date));
  out.push(...announceStaffConcern(state, date));
  out.push(...announceSponsorMatter(state, date));
  return out;
}

