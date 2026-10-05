import type {
  CommunicationIntent,
  Conversation,
  ConversationType,
  Message,
  ResponseOption,
} from '@/domain/communication';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ISODate, PersonId } from '@/domain/ids';
import { personDisplayName } from '@/domain/person';
import { daysBetween, DAY_NAMES, dayOfWeek } from '@/simulation/calendar';
import { availabilityStanding } from '@/simulation/communication/availabilityComms';
import { PAYMENT_STANDING_LABEL, paymentSummaryFor } from '@/simulation/communication/paymentComms';
import { conversationOf, conversationsInOrder, lastMessageOf, totalUnread } from '@/simulation/communication/store';

/**
 * The inbox, worked out before it is drawn.
 *
 * Everything the screen needs to know — which threads are there, what the last
 * thing anybody said was, how many are unread, what a conversation might be
 * called "five minutes ago" — is decided here, in plain functions over the game
 * state, and nowhere in the component. That follows the rule the rest of the UI
 * is written to: `commandState.ts` decides what the game expects to happen and
 * the header, the button and the strip all read it rather than each working it
 * out. It also means the awkward parts of this screen are testable without a
 * browser, which is where most of the rules here live.
 */

/* ------------------------------------------------------------------------ *
 * Naming people
 * ------------------------------------------------------------------------ */

/**
 * Who a thread is with.
 *
 * A Sunday League inbox is a contacts list, not a filing cabinet, so a thread is
 * named after the people in it. A one-to-one is just the person; a group gets
 * everybody's names up to a point and then a count, because "Ashton, Bailey,
 * Carter and five others" helps nobody and does not fit on a phone.
 */
export function conversationName(game: GameState, conversation: Conversation): string {
  const others = conversation.participantIds.filter((id) => id !== MANAGER_PERSON_ID);
  if (conversation.title.trim().length > 0) return conversation.title;
  if (others.length === 0) return 'Notes';
  if (others.length === 1) return personName(game, others[0]!);
  if (others.length === 2) return `${personName(game, others[0]!)} & ${personName(game, others[1]!)}`;
  if (others.length <= 3) return others.map((id) => personName(game, id)).join(', ');
  return `${others.slice(0, 2).map((id) => personName(game, id)).join(', ')} +${others.length - 2}`;
}

/** A person's name, or what is left of them if they have gone. */
export function personName(game: GameState, personId: PersonId): string {
  const person = game.people[personId];
  return person ? personDisplayName(person) : 'Former member';
}

/** Who wrote a message, as a manager would refer to them. */
export function senderName(game: GameState, message: Message): string {
  return message.direction === 'outbound' ? 'You' : personName(game, message.senderId);
}

/* ------------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------------ */

/**
 * When a message arrived, in the words a manager would use.
 *
 * Game time is continuous and the inbox is read daily, so a thread from this
 * morning has to be distinguishable from one from last March at a glance —
 * without a reader working it out. Inside a week the weekday does that job; past
 * that the date has to speak for itself. Anything from the future (a clock
 * running backwards in a test, a save from a later build) is described as
 * today rather than dated, because "in three days" is not a thing anybody wants
 * to read on a message list.
 */
export function relativeTime(date: ISODate, today: ISODate): string {
  // `daysBetween(from, to)` is signed `to - from`, and what we want is how far
  // *back* the message is, so the message is the `from`.
  const days = daysBetween(date, today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return DAY_NAMES[dayOfWeek(date)] ?? '';
  return shortDate(date, today);
}

/**
 * A date short enough for a list row.
 *
 * The year is compared against the *game's* year, not the wall clock's: a
 * career set in 2026 has to keep saying "12 Mar" while the player reads it in
 * 2026 or 2030 alike, and a list that started printing years because the
 * player's own calendar moved on would be confusing in a different game.
 */
function shortDate(date: ISODate, today: ISODate): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[Number(month) - 1] ?? month;
  const thisYear = today.split('-')[0];
  return year === thisYear ? `${Number(day)} ${name}` : `${Number(day)} ${name} ${year}`;
}

/** The full date, for the title attribute where a compact one will not do. */
export function fullDate(date: ISODate): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${Number(day)} ${names[Number(month) - 1] ?? month} ${year}`;
}

/* ------------------------------------------------------------------------ *
 * Previews
 * ------------------------------------------------------------------------ */

/**
 * The last thing anybody said, short enough to sit on one line.
 *
 * A preview that wraps to three lines is not a preview, so it is cut at a word
 * boundary rather than mid-word, and it is long enough to be recognisable —
 * "Manager, hope you are well. Right, one thing" is enough to tell two threads
 * apart without opening either.
 */
export function previewOf(message: Message | null, limit = 90): string {
  if (!message) return 'No messages yet';
  const body = message.body.replace(/\s+/g, ' ').trim();
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/* ------------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------------ */

export interface InboxRow {
  conversationId: string;
  name: string;
  /** The kind of thread, where it is worth saying: a group is not a person. */
  kind: ConversationType;
  kindLabel: string;
  preview: string;
  /** True when the manager wrote the last message, so it reads as his own. */
  lastFromManager: boolean;
  when: string;
  whenTitle: string;
  unread: number;
  active: boolean;
  /** Everyone in it, for a screen reader and for the header. */
  people: string[];
  /**
   * Where a player stands, when the row is about one player and the club has
   * not settled it.
   *
   * Short by design — this is the fourth state the availability model has no
   * name for, and a manager needs to see it without opening the thread. Null
   * for everything else, so the row stays a name and a sentence.
   */
  standing: string | null;
}

const KIND_LABEL: Record<ConversationType, string> = {
  player: 'Player',
  staff: 'Staff',
  board: 'Board',
  club: 'Club',
  league: 'League',
  recruitment: 'Scouting',
  general: 'Club',
  group: 'Group',
};

/** The label for a thread's type, which is only worth showing when it is not a plain player. */
export function kindLabel(conversation: Conversation): string {
  return KIND_LABEL[conversation.type] ?? '';
}

/**
 * The whole inbox, unread first and then most recent.
 *
 * Unread is put *above* recency deliberately. A Sunday League manager has a
 * handful of threads and needs to clear the ones waiting for him; sorting purely
 * by time buries a message from the treasurer under a reply he sent himself an
 * hour ago. Anything read falls back into plain recency, so an old thread he
 * has dealt with stops competing for attention.
 */
export function inboxRows(game: GameState): InboxRow[] {
  const today = game.date;
  const rows = conversationsInOrder(game).map((conversation) => toRow(game, conversation, today));
  return rows.sort((a, b) => {
    if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
    return b.sortKey - a.sortKey;
  });
}

/**
 * The one line a row carries about where the man stands.
 *
 * Only where it is not obvious from the rest of the row: a thread that already
 * says "cannot make it" does not need "Confirmed unavailable" printed under
 * it, and a man who is fit needs nothing said. What is left is the case the
 * simulation cannot express on its own — a doubt nobody has asked about yet —
 * plus the two the manager is waiting on an answer to.
 */
function standingFor(game: GameState, conversation: Conversation): string | null {
  if (conversation.type !== 'player') return null;
  const playerId = conversation.participantIds.find((id) => id !== MANAGER_PERSON_ID);
  if (!playerId) return null;

  // Money first. A man who owes four weeks and has a niggle in his knee has one
  // thing the manager needs to know, and it is not the knee.
  const owed = paymentSummaryFor(game, playerId);
  if (owed && !owed.startsWith(PAYMENT_STANDING_LABEL.clear)) return owed;

  const standing = availabilityStanding(game, playerId);
  if (standing === null || standing === 'fit') return null;
  // "Available" is the absence of news and is not printed.
  if (standing === 'unavailable') return 'Confirmed unavailable';
  return standing === 'pending' ? 'Awaiting confirmation' : 'Doubtful';
}

function toRow(game: GameState, conversation: Conversation, today: ISODate): InboxRow & { sortKey: number } {
  const last = lastMessageOf(game, conversation.id);
  return {
    conversationId: conversation.id,
    name: conversationName(game, conversation),
    kind: conversation.type,
    kindLabel: kindLabel(conversation),
    preview: previewOf(last),
    lastFromManager: last?.direction === 'outbound',
    when: last ? relativeTime(last.timestamp, today) : relativeTime(conversation.lastActivity, today),
    whenTitle: fullDate(last?.timestamp ?? conversation.lastActivity),
    unread: conversation.unreadCount,
    active: conversation.active,
    people: conversation.participantIds.filter((id) => id !== MANAGER_PERSON_ID).map((id) => personName(game, id)),
    standing: standingFor(game, conversation),
    sortKey: timeKey(last?.timestamp ?? conversation.lastActivity, conversation.messages.length, conversation.id),
  };
}

/**
 * An ordering key for a thread.
 *
 * The date alone is not enough: with continuous time, two threads can easily
 * share a day, and "most recent" has to be a total order or the list reorders
 * itself when the manager opens it. The message count breaks the tie, because
 * within a thread it only ever grows, and the id keeps two threads that somehow
 * match on both from swapping places between renders.
 */
function timeKey(date: ISODate, messageCount: number, conversationId: string): number {
  const stamp = Number(date.replace(/-/g, '')) || 0;
  const tiebreak = conversationId.length % 97;
  return stamp * 1_000_000 + messageCount * 1_000 + tiebreak;
}

/** How many messages are waiting across the whole inbox. */
export function inboxUnread(game: GameState): number {
  return totalUnread(game);
}

/** How many threads are waiting, which is what a badge can say in one word. */
export function inboxUnreadThreads(game: GameState): number {
  return conversationsInOrder(game).filter((conversation) => conversation.unreadCount > 0).length;
}

/* ------------------------------------------------------------------------ *
 * A thread
 * ------------------------------------------------------------------------ */

export interface ThreadMessage {
  id: string;
  body: string;
  mine: boolean;
  sender: string;
  when: string;
  whenTitle: string;
  read: boolean;
  /** The date, shown between messages rather than on every one of them. */
  dayLabel: string;
  /** True when this is the first message of its day in the thread. */
  startsDay: boolean;
}

/**
 * A thread, oldest first.
 *
 * Chronological order is not negotiable — a conversation read upside down is
 * not a conversation — and it comes from the sequence the message already
 * carries rather than from sorting dates, because two messages on one day have
 * the same date and the wrong order there is invisible until it matters.
 *
 * Day labels are worked out here rather than in the component because "where
 * does the divider go" is a rule, not a layout decision: it goes before the
 * first message of each day and nowhere else.
 */
export function threadMessages(game: GameState, conversationId: string): ThreadMessage[] {
  const conversation = conversationOf(game, conversationId);
  if (!conversation) return [];
  const ordered = [...conversation.messages].sort((a, b) => a.sequence - b.sequence);
  const today = game.date;
  let previousDay = '';
  return ordered.map((message) => {
    const startsDay = message.timestamp !== previousDay;
    previousDay = message.timestamp;
    return {
      id: message.id,
      body: message.body,
      mine: message.direction === 'outbound',
      sender: senderName(game, message),
      when: relativeTime(message.timestamp, today),
      whenTitle: fullDate(message.timestamp),
      read: message.read,
      dayLabel: startsDay ? dayHeading(message.timestamp, today) : '',
      startsDay,
    };
  });
}

/** A date divider: today and yesterday are named, anything older is a date. */
function dayHeading(date: ISODate, today: ISODate): string {
  const days = daysBetween(date, today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return DAY_NAMES[dayOfWeek(date)] ?? fullDate(date);
  return fullDate(date);
}

/* ------------------------------------------------------------------------ *
 * What the manager can say
 * ------------------------------------------------------------------------ */

/**
 * A thing the manager can do about a message, in his own words.
 *
 * The vocabulary the simulation speaks — `ASK_AVAILABILITY`, `WARN_PAYMENT` — is
 * not the vocabulary a manager thinks in, and putting it on a button would make
 * the game's internals the interface. So intents are mapped to something he
 * would actually say, and the underlying intent travels underneath where no
 * screen ever shows it.
 */
export interface ManagerAction {
  intent: CommunicationIntent;
  /** What the button says. */
  label: string;
  /** The line under it, explaining what will happen. */
  detail: string;
  group: 'ask' | 'say';
  icon: 'ask' | 'tell' | 'invite' | 'pay';
}

/** The two player-only intents, in the manager's words. */
const PLAYER_ACTIONS: ManagerAction[] = [
  { intent: 'CHECK_IN', label: 'How are you?', detail: 'A general word with him', group: 'ask', icon: 'ask' },
  {
    intent: 'DISCUSS_SELECTION',
    label: 'Where he stands',
    detail: 'Tell him what you have decided',
    group: 'say',
    icon: 'tell',
  },
];

/**
 * Every generic action, grouped.
 *
 * Generic on purpose: these are the eleven things the architecture can already
 * do to anybody, and none of them are about a particular player or a particular
 * situation. A thread about subs offers "Remind about subs" to whoever it is
 * about, because whether that is wise is the manager's judgement and not
 * something the screen should decide for him.
 */
export const MANAGER_ACTIONS: ManagerAction[] = [
  { intent: 'ASK_AVAILABILITY', label: 'Are you free?', detail: 'Ask whether he can make the match', group: 'ask', icon: 'ask' },
  { intent: 'ASK_FITNESS', label: 'How are you feeling?', detail: 'Ask how the knock is', group: 'ask', icon: 'ask' },
  { intent: 'ASK_ADVICE', label: 'Got a minute?', detail: 'Ask his advice about something', group: 'ask', icon: 'ask' },
  { intent: 'ASK_CONFIRMATION', label: 'Can you confirm?', detail: 'Put it to him for a definite answer', group: 'ask', icon: 'ask' },
  { intent: 'ASK_UPDATE', label: 'Any news?', detail: 'Ask whether anything has changed', group: 'ask', icon: 'ask' },
  ...PLAYER_ACTIONS,
  { intent: 'INVITE_TO_TRAINING', label: 'Come to training', detail: 'Ask him down on a Thursday', group: 'say', icon: 'invite' },
  { intent: 'INVITE_TO_TRIAL', label: 'Come to a game', detail: 'Ask him to come and watch', group: 'say', icon: 'invite' },
  { intent: 'OFFER_ROLE', label: 'Offer him a place', detail: 'Put a role to him', group: 'say', icon: 'invite' },
  { intent: 'REMIND_PAYMENT', label: 'Remind about subs', detail: 'Mention what is still owed', group: 'ask', icon: 'pay' },
  { intent: 'ASK_PAYMENT', label: 'Can you sort your subs?', detail: 'Ask for it this week', group: 'ask', icon: 'pay' },
  {
    intent: 'DISCUSS_PAYMENT',
    label: 'How are you managing?',
    detail: 'Ask him about his circumstances',
    group: 'ask',
    icon: 'ask',
  },
  { intent: 'WARN_PAYMENT', label: 'Warn about subs', detail: 'Say plainly that it is the last time', group: 'say', icon: 'pay' },
  { intent: 'PRAISE', label: 'Give him a lift', detail: 'Say he did well', group: 'say', icon: 'tell' },
  { intent: 'CRITICISE', label: 'Have a word', detail: 'Say what you thought', group: 'say', icon: 'tell' },
  { intent: 'GENERAL_CHECK_IN', label: 'Check in', detail: 'Ask how he is', group: 'say', icon: 'tell' },
];

const ACTIONS_BY_INTENT = new Map(MANAGER_ACTIONS.map((action) => [action.intent, action]));

export function actionFor(intent: CommunicationIntent): ManagerAction | undefined {
  return ACTIONS_BY_INTENT.get(intent);
}

/**
 * The actions offered on a thread.
 *
 * Where a message has already put its own suggestions on the table — or where
 * the caller has supplied live ones — those come first: an unanswered question
 * deserves the answer it asked for, not the whole menu. Everything else is still
 * there underneath, because a manager is allowed to answer a question about his
 * fitness with an invitation to training, and a screen that only offered the
 * first three replies would be a worse tool than one that offers them all.
 *
 * A brand new thread has no message to carry options, so the screen passes the
 * live ones in; that is what lets a thread opened from a player's profile offer
 * "How is the knock?" to a man with a hamstring and not to everybody else.
 */
export function threadActions(conversation: Conversation, liveOptions: ResponseOption[] = []): ManagerAction[] {
  const suggested = new Set<CommunicationIntent>();
  const offered = liveOptions.length > 0 ? liveOptions : responseOptionsFor(conversation);
  for (const option of offered) {
    if (option.targetId === null || option.targetId === undefined) suggested.add(option.intent);
    else if (conversation.participantIds.includes(option.targetId)) suggested.add(option.intent);
  }
  const ordered = [...suggested]
    .map((intent) => actionFor(intent))
    .filter((action): action is ManagerAction => Boolean(action));
  // A player is not the treasurer and the chairman is not a left back: the
  // intents that only mean something to one kind of person are left off a
  // thread that has nobody of that kind in it.
  const allowed = conversation.type === 'player' ? MANAGER_ACTIONS : PLAYER_FREE_ACTIONS;
  const rest = allowed.filter((action) => !ordered.includes(action));
  return [...ordered, ...rest];
}

/**
 * The intents that make sense to somebody who is not a player.
 *
 * "Where he stands" and "How are you?" are questions about a player's own
 * situation and mean nothing to a chairman, so offering them in a committee
 * thread would be offering the manager a question that cannot be asked.
 */
const PLAYER_FREE_ACTIONS = MANAGER_ACTIONS.filter((action) => !PLAYER_ACTIONS.includes(action));

/**
 * The options the newest message offers.
 *
 * Read from the last message whatever its direction: options describe what the
 * manager may say *next*, and after he has written, the newest message is his
 * own. Stopping at the last inbound message would mean that once he had
 * replied, every suggestion the thread had built up was thrown away.
 */
function responseOptionsFor(conversation: Conversation): ResponseOption[] {
  const last = conversation.messages[conversation.messages.length - 1];
  return last?.responseOptions ?? [];
}

/* ------------------------------------------------------------------------ *
 * The empty inbox
 * ------------------------------------------------------------------------ */

/**
 * What to say when there is nothing.
 *
 * An empty inbox is not an error and not a prompt to go and do something, so it
 * does not suggest a task. It says what this is and stops: a manager who has
 * been in the game a fortnight and has not been written to yet should not be
 * told he is behind.
 */
export function inboxEmptyCopy(): { title: string; detail: string } {
  return {
    title: 'Nobody has written to you yet',
    detail:
      'When a player, the committee or somebody trying to get into the club needs you, it will turn up here.',
  };
}
