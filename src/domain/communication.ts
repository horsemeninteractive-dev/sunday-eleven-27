import type { ClubId, CompetitionId, ConversationId, ISODate, MatchId, MessageId, PersonId } from './ids';

/**
 * Communication is a *game system*, not a screen.
 *
 * Everything that talks to the manager in Sunday Eleven 27 — a player who
 * cannot get to training, a chairman about the money, a league official about
 * the ground, a lad ringing about a trial — does so through this one model, so
 * that a conversation is a first-class thing the rest of the game can schedule
 * against, react to and persist, rather than a notification that appears and is
 * forgotten.
 *
 * The rules that shape this file:
 *
 *  - **Messages carry intent, not just prose.** Every message the manager sends
 *    names a `CommunicationIntent`. What the intent *means* is left to the
 *    systems that read it: the same `ASK_AVAILABILITY` can move a player's
 *    availability, thread a recruitment lead and put something on the calendar
 *    without this file knowing about any of those.
 *  - **Nothing here performs a consequence.** A message records that it expects
 *    one, and later stages decide what happens. The hooks exist; they are empty.
 *  - **Time is game time.** A message is stamped with the game's date, because
 *    that is the only clock the whole career shares. Ordering within a day is by
 *    `sequence`, which is monotonic per conversation, so two messages on the
 *    same day still have a defined order after a save/load round trip.
 */

/** The manager is a person in the world like everybody else. */
export const MANAGER_PERSON_ID: PersonId = 'user_manager';

/**
 * Who a conversation is with. The set is the shape of Sunday League life; not
 * every type needs behaviour on day one, but each is a place a conversation
 * can come from, and systems can subscribe to them by type.
 */
export type ConversationType =
  /** One player: availability, fitness, being spoken to about a game. */
  | 'player'
  /** Coaching staff, assistants, volunteers. */
  | 'staff'
  /** The chairman or the board. */
  | 'board'
  /** The committee, or the club off the pitch. */
  | 'club'
  /** The league, the referee, the cup. */
  | 'league'
  /** Somebody the manager wants, or somebody wanting him. */
  | 'recruitment'
  /** No particular recipient: a broadcast to the whole club. */
  | 'general'
  /** A group: the squad, the committee, the away support. */
  | 'group';

export const CONVERSATION_TYPE_LABEL: Record<ConversationType, string> = {
  player: 'Player',
  staff: 'Staff',
  board: 'Board',
  club: 'Club',
  league: 'League',
  recruitment: 'Recruitment',
  general: 'General',
  group: 'Group',
};

/** Whether a message was sent by the manager or sent to him. */
export type MessageDirection = 'outbound' | 'inbound';

/**
 * What kind of message this is. Deliberately about *shape*, not about feeling:
 * the sentiment lives in the relationship record and the response that follows,
 * not in the message's type.
 */
export type MessageType =
  | 'greeting'
  | 'question'
  | 'answer'
  | 'notice'
  | 'reminder'
  | 'warning'
  | 'feedback'
  | 'invitation'
  | 'offer'
  | 'thanks'
  | 'apology'
  | 'follow-up';

export const MESSAGE_TYPE_LABEL: Record<MessageType, string> = {
  greeting: 'Opening',
  question: 'Question',
  answer: 'Answer',
  notice: 'Notice',
  reminder: 'Reminder',
  warning: 'Warning',
  feedback: 'Feedback',
  invitation: 'Invitation',
  offer: 'Offer',
  thanks: 'Thanks',
  apology: 'Apology',
  'follow-up': 'Follow-up',
};

/**
 * What the manager is trying to do by writing a message.
 *
 * These are the vocabulary a manager speaks in, not a set of buttons. Adding an
 * intent here costs nothing: the response machinery reads intent, personality
 * and circumstances, and the consequence hooks are keyed by intent too, so a
 * later stage can add `ASK_ABOUT_THE_GROUND` and have everything already
 * listening.
 */
export type CommunicationIntent =
  | 'ASK_AVAILABILITY'
  | 'ASK_FITNESS'
  | 'REMIND_PAYMENT'
  | 'WARN_PAYMENT'
  | 'PRAISE'
  | 'CRITICISE'
  | 'INVITE_TO_TRAINING'
  | 'INVITE_TO_TRIAL'
  | 'OFFER_ROLE'
  | 'ASK_ADVICE'
  | 'GENERAL_CHECK_IN'
  /** A general word with somebody, with nothing in particular behind it. */
  | 'CHECK_IN'
  /** Telling a player where he stands for a match. */
  | 'DISCUSS_SELECTION'
  /** Put to a man who has not settled: "can you confirm for Sunday?" */
  | 'ASK_CONFIRMATION'
  /** Chasing a doubt rather than asking fresh: "any news on the knee?" */
  | 'ASK_UPDATE'
  /** Money, said politely: "can you sort your subs this week?" */
  | 'ASK_PAYMENT'
  /** Money, said as a question about his circumstances rather than his debt. */
  | 'DISCUSS_PAYMENT';

export const COMMUNICATION_INTENTS: CommunicationIntent[] = [
  'ASK_AVAILABILITY',
  'ASK_FITNESS',
  'REMIND_PAYMENT',
  'WARN_PAYMENT',
  'PRAISE',
  'CRITICISE',
  'INVITE_TO_TRAINING',
  'INVITE_TO_TRIAL',
  'OFFER_ROLE',
  'ASK_ADVICE',
  'GENERAL_CHECK_IN',
  'CHECK_IN',
  'DISCUSS_SELECTION',
  'ASK_CONFIRMATION',
  'ASK_UPDATE',
  'ASK_PAYMENT',
  'DISCUSS_PAYMENT',
];

/** How an intent reads in a title bar, for lists and headers. */
export const COMMUNICATION_INTENT_LABEL: Record<CommunicationIntent, string> = {
  ASK_AVAILABILITY: 'Ask about availability',
  ASK_FITNESS: 'Ask about fitness',
  REMIND_PAYMENT: 'Remind about payment',
  WARN_PAYMENT: 'Warn about payment',
  PRAISE: 'Praise',
  CRITICISE: 'Criticise',
  INVITE_TO_TRAINING: 'Invite to training',
  INVITE_TO_TRIAL: 'Invite to a trial',
  OFFER_ROLE: 'Offer a role',
  ASK_ADVICE: 'Ask advice',
  GENERAL_CHECK_IN: 'Check in',
  CHECK_IN: 'Check in with him',
  DISCUSS_SELECTION: 'Discuss selection',
  ASK_CONFIRMATION: 'Ask him to confirm',
  ASK_UPDATE: 'Ask for an update',
  ASK_PAYMENT: 'Ask him to sort his subs',
  DISCUSS_PAYMENT: 'Ask how he is getting on',
};

/**
 * Intents that are about a player's money.
 *
 * Split out because the finance system is the only thing allowed to decide
 * whether a man has paid, and these are the intents that have to be careful
 * never to imply otherwise. `WARN_PAYMENT` and `REMIND_PAYMENT` existed from
 * the start; `ASK_PAYMENT` and `DISCUSS_PAYMENT` were added when the player's
 * side of the subs book existed to ask about.
 */
export const PAYMENT_INTENTS: CommunicationIntent[] = [
  'REMIND_PAYMENT',
  'ASK_PAYMENT',
  'WARN_PAYMENT',
  'DISCUSS_PAYMENT',
];

/**
 * Intents that put a question to somebody's *body or Sunday* rather than to
 * their character.
 *
 * A player thread and the availability bridge both need to know which questions
 * are about whether the man can actually play, because those are the ones that
 * may end in him not committing to an answer — and a man who will not commit is
 * a follow-up the calendar has to carry, not a question that quietly expires.
 */
export const AVAILABILITY_INTENTS: CommunicationIntent[] = [
  'ASK_AVAILABILITY',
  'ASK_FITNESS',
  'ASK_CONFIRMATION',
  'ASK_UPDATE',
];

/**
 * Intents that only mean something to one kind of person.
 *
 * The manager does not discuss a selection with the chairman or ask the
 * treasurer's opinion of his left back, and offering those buttons would be
 * offering the manager questions that cannot be asked. The vocabulary is one
 * list; who it is aimed at is a separate question, answered here.
 */
export const PLAYER_ONLY_INTENTS: CommunicationIntent[] = ['CHECK_IN', 'DISCUSS_SELECTION'];

/**
 * The thing a conversation is *about*, when it is about something.
 *
 * Messages that are just conversation carry `null`. A message about a player's
 * availability carries that player, so the reader can offer the right intents
 * and a later stage can resolve the answer against the real record rather than
 * trying to read it back out of prose.
 */
export interface ConversationSubject {
  kind: 'player' | 'official' | 'club' | 'match' | 'competition' | 'none';
  id: ClubId | PersonId | MatchId | CompetitionId | null;
  /** Short description for display: "Kev Taylor", "Saturday home game". */
  label: string | null;
}

/**
 * A structured way of answering, offered on an inbound message.
 *
 * This is what keeps the manager's choices from being hardcoded into a screen:
 * a message says which intents would make sense here, and each carries the
 * target it would apply to. Adding an intent to a message's options is all a
 * system has to do to make it available.
 */
export interface ResponseOption {
  intent: CommunicationIntent;
  label: string;
  /** Who the intent is aimed at, when it is aimed at somebody. */
  targetId: PersonId | null;
  /** Extra facts to carry into the response, e.g. which session. */
  context?: Record<string, string | number>;
}

/**
 * What a message expects to cause, and what actually happened.
 *
 * `outcome` is written by whatever acts on the message — a later stage — so the
 * thread keeps a record of a consequence having happened rather than only that
 * one was intended. Until something acts, `resolvedOn` is null and the intent is
 * still outstanding, which is exactly what a manager waiting to hear back looks
 * like.
 */
export interface ConsequenceMetadata {
  /** The intent this message was sent with, if any. */
  intent: CommunicationIntent | null;
  /** Who it was aimed at, if anybody. */
  targetId: PersonId | null;
  /** Facts handed over at the time, so the consequence can be resolved later. */
  context: Record<string, string | number>;
  /** True once the system that owns the intent has acted. */
  resolvedOn: ISODate | null;
  /** What came of it, in words: "Availability set to unavailable: work". */
  outcome: string | null;
  /** Named hooks that have run against this message, for the record. */
  appliedHooks: string[];
}

/** One message. Immutable once written; corrections are new messages. */
export interface Message {
  id: MessageId;
  conversationId: ConversationId;
  senderId: PersonId;
  recipientIds: PersonId[];
  /** Game date. The one clock the whole career shares. */
  timestamp: ISODate;
  /** Position within the conversation, monotonic, so same-day order survives a save. */
  sequence: number;
  body: string;
  direction: MessageDirection;
  read: boolean;
  type: MessageType;
  context: Record<string, string | number>;
  subject: ConversationSubject | null;
  /** Intents this message offers, if it is a message awaiting an answer. */
  responseOptions: ResponseOption[];
  /** What this message expects to cause. Never null, so every message is uniform. */
  consequence: ConsequenceMetadata;
}

/** A conversation: a thread with participants, and where it stands. */
export interface Conversation {
  id: ConversationId;
  type: ConversationType;
  /** Title as the manager would name it, e.g. "Kev Taylor". */
  title: string;
  participantIds: PersonId[];
  messages: Message[];
  /** Date of the most recent message. */
  lastActivity: ISODate;
  /** How many messages the manager has not read. Maintained, never guessed. */
  unreadCount: number;
  active: boolean;
  /** Set when it was closed, so a closed thread keeps its date. */
  closedOn: ISODate | null;
  subject: ConversationSubject | null;
}

/**
 * The communication store, held on the game state alongside the relationship,
 * recruitment and training stores.
 *
 * There is deliberately no index here. A career has one manager and a few
 * hundred people, so the number of conversations is small enough that a scan is
 * cheaper than an index that can disagree with the conversations themselves.
 */
export interface CommunicationStore {
  conversations: Record<ConversationId, Conversation>;
  /** Conversations ordered by most recent first. Derived, and rebuilt on load. */
  order: ConversationId[];
}

export function emptyCommunicationStore(): CommunicationStore {
  return { conversations: {}, order: [] };
}

/** A conversation with nothing in it yet, before the first message. */
export function createEmptyConsequence(
  intent: CommunicationIntent | null = null,
  targetId: PersonId | null = null,
  context: Record<string, string | number> = {},
): ConsequenceMetadata {
  return { intent, targetId, context, resolvedOn: null, outcome: null, appliedHooks: [] };
}