/**
 * The bridge between availability and conversation.
 *
 * `src/simulation/availability.ts` decides who can play. It is the only thing
 * that decides, it is the record the selection screen reads, and nothing here
 * writes to it. This module exists because a record and a *word* are different
 * things: a manager looking at a list sees `doubtful`, and what he needs to know
 * is whether the man has been asked and has not answered yet.
 *
 * So the rule of this file is one sentence long:
 *
 *   **Availability decides. Communication explains, asks, and remembers.**
 *
 * Three things live here, and none of them is a second copy of the availability
 * simulation:
 *
 *  - **Announcements.** When the roll moves a squad member's availability, the
 *    manager is written to once — by the player, in the player's words, for the
 *    reason the roll gave. Event-driven and deduplicated, because a man who
 *    texts you about his knee on Monday has not texted you twice by Tuesday.
 *  - **A derived standing.** Four words for the squad screen: fit, doubtful,
 *    pending, out. *Derived* from the authoritative status plus whether an
 *    exchange is outstanding, and stored nowhere, so it cannot disagree with
 *    the roll that produced it.
 *  - **A chase.** The manager can put a pending man on the spot, through the
 *    same code path an ordinary question takes.
 *
 * What this module will not do, at any stage: write to `player.availability`,
 * put a man in a team sheet, or turn "I think I will be alright" into a yes.
 * A man's own uncertainty is recorded as uncertainty; only the roll moves him,
 * exactly as before.
 */

import {
  AVAILABILITY_INTENTS,
  createEmptyConsequence,
  MANAGER_PERSON_ID,
  type Message,
} from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ISODate, PersonId } from '@/domain/ids';
import { AVAILABILITY_REASON_LABEL, isPlayer, type AvailabilityReason } from '@/domain/person';
import type { LifeChangeKind } from '@/simulation/availability';
import { stream } from '@/simulation/rng';
import { playerResponseOptions, sendPlayerMessage, type FollowUp } from './playerConversation';
import { appendMessage, findConversation, lastMessageOf, messagesOf } from './store';
import { threadWith } from './system';

/* ------------------------------------------------------------------------ *
 * What the manager is told, in words
 * ------------------------------------------------------------------------ */

/**
 * How a player stands, in the four words a manager would use.
 *
 * `pending` is the one that does not exist in `AvailabilityStatus`, and its
 * absence is the whole point: the simulation has three states because it must
 * be decidable, while a manager waiting for a reply is genuinely in a fourth
 * place that nobody has resolved yet.
 */
export type AvailabilityStanding = 'fit' | 'doubtful' | 'pending' | 'unavailable';

export const AVAILABILITY_STANDING_LABEL: Record<AvailabilityStanding, string> = {
  fit: 'Available',
  doubtful: 'Doubtful — player says they expect to play.',
  pending: 'Awaiting player confirmation.',
  unavailable: 'Confirmed unavailable.',
};

/**
 * A one-line note under the standing, so the squad screen can say *why* without
 * the message thread being open.
 */
export function availabilityStandingNote(
  status: AvailabilityStanding,
  reason: AvailabilityReason,
  detail: string | null,
): string {
  if (status === 'fit') return detail ?? 'No problems reported';
  return detail ?? AVAILABILITY_REASON_LABEL[reason];
}

/* ------------------------------------------------------------------------ *
 * The standing, derived
 * ------------------------------------------------------------------------ */

/** Is this one of the questions a man is asked about his body or his Sunday? */
function isAvailabilityQuestion(message: Message): boolean {
  const intent = message.consequence.intent;
  return message.direction === 'outbound' && intent !== null && AVAILABILITY_INTENTS.includes(intent);
}

/**
 * Has the manager put it to him, and has he answered *that* question?
 *
 * Read from the thread rather than a flag, so the answer survives a reload and
 * cannot drift from what was actually said. The question is asked "has the
 * manager asked since the last thing he said" and the way to ask it is: find the
 * last thing the *manager* asked about availability, then see whether anything
 * has come back since.
 *
 * Only messages after that last question count. If a man was asked on Monday,
 * answered, and then lost his Sunday on Wednesday, the announcement on Wednesday
 * is after the question and nothing follows it — so he is pending again, which
 * is right: the new doubt has not been put to him.
 */
function managerHasAskedAndHeAnswered(state: GameState, playerId: PersonId): boolean {
  const conversation = findConversation(state, [playerId], { type: 'player' });
  if (!conversation) return false;
  const messages = [...conversation.messages].sort((a, b) => a.sequence - b.sequence);

  let lastQuestion = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isAvailabilityQuestion(messages[index]!)) {
      lastQuestion = index;
      break;
    }
  }
  // He has never been asked: whatever he has volunteered, the club is waiting.
  if (lastQuestion < 0) return false;
  return messages.slice(lastQuestion + 1).some((message) => message.direction === 'inbound');
}

/**
 * Where this player stands, as the manager understands it.
 *
 * Derived, never stored:
 *
 *  - the roll says available → **fit**, whatever anybody has said,
 *  - the roll says unavailable → **unavailable**; a man who says he is fine is
 *    not available, and the record wins,
 *  - the roll says doubtful → **pending** if the manager has not put it to him,
 *    and **doubtful** once he has and the man has said what he expects.
 *
 * The last line is the distinction the task turns on. "I reckon so, but I will
 * see how it feels Saturday" is not a yes and not a no; it becomes `doubtful`,
 * which says both that he expects to play and that nobody has promised.
 */
export function availabilityStanding(state: GameState, playerId: PersonId): AvailabilityStanding | null {
  const person = state.people[playerId];
  if (!person || !isPlayer(person)) return null;
  const status = person.availability.status;
  if (status === 'available') return 'fit';
  if (status === 'unavailable') return 'unavailable';

  // Asked and answered is the difference between a doubt nobody has chased and
  // a man who has told the manager what he expects. Everything else is pending.
  return managerHasAskedAndHeAnswered(state, playerId) ? 'doubtful' : 'pending';
}

/* ------------------------------------------------------------------------ *
 * The manager writing to him
 * ------------------------------------------------------------------------ */

/**
 * Chase a man who has not settled.
 *
 * Goes through the same path as any other question, so the answer is written
 * from the record as it stands today and a man who is still uncertain books
 * himself another day on the calendar rather than being left hanging.
 *
 * Returns null when there is nothing outstanding — a chase with nothing to
 * chase is a message the manager did not need to send.
 */
export function chaseConfirmation(
  state: GameState,
  playerId: PersonId,
): { message: Message; reply: Message | null; followUp: FollowUp | null } | null {
  if (availabilityStanding(state, playerId) !== 'pending') return null;
  return sendPlayerMessage(state, playerId, 'ASK_CONFIRMATION');
}

/* ------------------------------------------------------------------------ *
 * The player writing to the manager
 * ------------------------------------------------------------------------ */

/**
 * What the roll did.
 *
 * The four kinds the availability roll produces, unchanged and in its own
 * words: `clears` is carried here so the day loop can hand its roll over
 * untouched, and is refused below rather than filtered out at the call site —
 * the decision that becoming available is not a message belongs next to the
 * reason it is not.
 */
export type AnnouncementKind = LifeChangeKind;

export interface AvailabilityAnnouncement {
  kind: AnnouncementKind;
  reason: AvailabilityReason;
  note: string;
}

/**
 * What a man says when his Sunday has just changed.
 *
 * Keyed by the reason the roll gave, because that is the whole of what is known
 * about his life: a man on a late shift talks about the shift, not about his
 * knee. Doubtful and lost are deliberately different shapes — one leaves the
 * door open, the other does not — because that difference is the entire content
 * of the message.
 */
const SAYING: Record<AvailabilityReason, { doubtful: string[]; out: string[] }> = {
  work: {
    doubtful: ['Boss, work have put me on call again. I might get called out.', 'Not sure about Sunday, we are short at work.'],
    out: ["Work's put me on early Sunday again. Can't get out of it.", 'Sorry mate, I have had to take the extra shift. No chance of Sunday.'],
  },
  family: {
    // Every variant names the family. A man may put it as "the family thing"
    // rather than "a family commitment", but he will not say "something has come
    // up at home" — that is the wording for `personal`, and using it here would
    // make two different reasons produce the same message.
    doubtful: ['Family thing on, so I am not sure yet.', 'Something for the family, I will see how it lands.'],
    out: ['Got a family thing Sunday morning. Sorry.', 'Family do I cannot get out of. Apologies.'],
  },
  injury: {
    doubtful: [
      "Boss, just letting you know my knee's still not right. I'll see how it is tomorrow.",
      'The knee has not settled. I am not sure about Sunday yet.',
    ],
    out: ['The knee has gone again. I will have to sit this one out.', 'No luck, the knock is back and it is not settling.'],
  },
  illness: {
    doubtful: ['I am not right at all, sorry. Might be gone by Sunday.', 'Feeling rough. I will know more by the weekend.'],
    out: ['I am properly ill, mate. Not going to make Sunday.', 'Down with something. No chance this week.'],
  },
  holiday: {
    doubtful: ['We have booked a few days away. I think we are back, but not certain.', 'Away with the family, hopefully back in time.'],
    out: ['Booked a few days away, sorry. Not back until the week after.', 'We are away. I cannot make Sunday.'],
  },
  'other-football': {
    doubtful: ['I have been asked to play Saturday football. Not decided yet.', 'Might play Saturday instead. Depends how they ask.'],
    out: ['Got a game on Saturday, sorry. Cannot do both.', 'Playing Saturday football, so Sunday is out.'],
  },
  personal: {
    doubtful: ['Something on at home, boss. I will let you know.', 'Not easy to explain. I will see how the week goes.'],
    out: ['Sorry, I have something on I cannot move.', 'Personal thing, mate. Not going to make it.'],
  },
  suspension: {
    doubtful: ['I think I have a suspension coming. Waiting to hear.', 'Might be a matchday ban. Not confirmed.'],
    out: ['Got a suspension, sorry. I will not be able to play.', 'Banned for the game, that is me out.'],
  },
  unexplained: {
    doubtful: ['I have not managed to get hold of my reasons. Still trying.', 'Not sorted yet, boss. I will let you know.'],
    out: ['Cannot make it, sorry.', 'Not going to make Sunday.'],
  },
};

/**
 * The key that makes an announcement happen exactly once.
 *
 * A player, the state he moved to, and the day he moved there. Processing the
 * same day twice — a reloaded save, an undo, a calendar entry visited twice —
 * finds the key already in the thread and writes nothing. A doubt that clears
 * and comes back a week later has a different date and is a different event, so
 * it is written; that is the manager being told twice about two things, which
 * is correct.
 */
function deliveryKey(playerId: PersonId, kind: AnnouncementKind, date: ISODate): string {
  return `availability:${playerId}:${kind}:${date}`;
}

/**
 * Write to the manager about a change in his own availability.
 *
 * Called from the day loop, immediately after the availability roll has written
 * the new record — never before, and never instead of. Four guards keep it from
 * becoming a nuisance:
 *
 *  1. **His club only.** The rest of the county's players are simulated in
 *     silence, which is what keeps a league of this size affordable.
 *  2. **A change, not a state.** The caller hands over the roll; a day that
 *     changes nothing produces no message because there is nothing to send.
 *  3. **Once per event.** The delivery key above.
 *  4. **Only what a man would text about.** Becoming available again is not a
 *     message — it is a line in the news, and the roll has already made one.
 *     Losing it is.
 *
 * Returns the message written, or null when there was nothing to say.
 */
export function announceAvailabilityChange(
  state: GameState,
  playerId: PersonId,
  announcement: AvailabilityAnnouncement,
): Message | null {
  const person = state.people[playerId];
  if (!person || !isPlayer(person)) return null;
  if (person.clubId !== state.userClubId) return null;

  const { kind, reason } = announcement;

  // Becoming available is not a text. The roll has already put it in the news,
  // and a man messaging his manager to say he feels better is the sort of thing
  // that makes a manager stop reading.
  if (kind === 'clears') return null;

  const key = deliveryKey(playerId, kind, state.date);

  const existing = findConversation(state, [playerId], { type: 'player' });
  if (existing && messagesOf(state, existing.id).some((message) => message.context.deliveryKey === key)) {
    return null;
  }

  const out = kind !== 'doubts';
  const pool = SAYING[reason][out ? 'out' : 'doubtful'];
  const rng = stream(state.seed, 'availability-announcement', state.date, playerId, kind);
  const body = pool[Math.floor(rng.next() * pool.length) % pool.length]!;

  const conversation = threadWith(state, playerId, 'player');
  const message = appendMessage(state, conversation.id, {
    senderId: playerId,
    recipientIds: [MANAGER_PERSON_ID],
    body,
    type: 'notice',
    // Flat data, so a later stage — or a test — can read what this message was
    // about without parsing the prose or knowing anything about this file.
    context: {
      announced: 'yes',
      deliveryKey: key,
      availability: person.availability.status,
      reason,
      certain: out ? 'yes' : 'no',
    },
    subject: { kind: 'player', id: playerId, label: `${person.firstName} ${person.surname}` },
    // What the manager can do about it is *his* decision, offered as data and
    // chosen by whoever draws the screen. Notably absent: anything that would
    // select the man. He is told, and then it is the manager's problem.
    responseOptions: playerResponseOptions(state, playerId),
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, { availability: person.availability.status }),
    read: false,
  });
  if (!message) return null;

  const last = lastMessageOf(state, conversation.id);
  if (last) last.responseOptions = playerResponseOptions(state, playerId);
  return message;
}

/* ------------------------------------------------------------------------ *
 * What this layer will never do
 * ------------------------------------------------------------------------ */

/**
 * Apply what a message *said* to the authoritative record. Deliberately absent.
 *
 * The temptation this file exists to refuse is "he says he will be fine, so mark
 * him available". A Sunday League manager has been told a man is fine before and
 * has watched him not turn up; that is the entire texture of the level. The
 * roll moves the record, and a message only changes how *sure* everybody is.
 *
 * Stated as a function so the refusal is checkable: the tests assert this
 * returns false and leaves the record alone.
 */
export function messageCanOverwriteAvailability(): boolean {
  return false;
}