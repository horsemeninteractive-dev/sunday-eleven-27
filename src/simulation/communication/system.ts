import type { GameState } from '@/domain/game';
import {
  createEmptyConsequence,
  MANAGER_PERSON_ID,
  type CommunicationIntent,
  type Conversation,
  type ConversationSubject,
  type ConversationType,
  type Message,
  type ResponseOption,
} from '@/domain/communication';
import type { ConversationId, ISODate, PersonId } from '@/domain/ids';
import { personDisplayName } from '@/domain/person';
import { draftOpening, draftReply } from './responses';
import {
  appendMessage,
  closeConversation,
  communicationStore,
  conversationOf,
  conversationsInOrder,
  defaultTitleFor,
  ensureConversation,
  findConversation,
  markConversationRead,
  markMessageRead,
  messagesOf,
  participantName,
  reopenConversation,
  totalUnread,
  unreadCountFor,
} from './store';

/**
 * The CommunicationSystem.
 *
 * This is the only door into conversations. Everything that wants to talk to the
 * manager — a player rolling unavailable, a chairman about the money, a league
 * official, a trial — comes through here, and everything the manager sends goes
 * out through here. The rules of a conversation live in `store.ts` (storage,
 * ordering, read state) and `responses.ts` (what people say); this file is the
 * vocabulary they are spoken through.
 *
 * What it deliberately does not do is *decide* anything. A message records what
 * it was for; whether that intent turns into an availability, a relationship
 * shift or a bank transfer is a later stage's business, and the hook registry
 * below is where that business registers itself. Building the doors first means
 * every consequence can be added without touching a conversation.
 */

/** A consequence handler, registered by whichever system owns an intent. */
export type ConsequenceHandler = (state: GameState, message: Message) => void;

/**
 * Hooks keyed by intent.
 *
 * Empty on day one. A system that owns an intent registers here and is called
 * when a message carrying that intent is written, so the conversation layer
 * never has to know that availability, money or relationships exist. Handlers
 * record themselves on the message, which is what makes "what did this actually
 * cause?" answerable later without a second log.
 */
const handlers = new Map<CommunicationIntent, ConsequenceHandler[]>();

export function registerConsequence(intent: CommunicationIntent, handler: ConsequenceHandler): void {
  const existing = handlers.get(intent) ?? [];
  if (!existing.includes(handler)) existing.push(handler);
  handlers.set(intent, existing);
}

export function clearConsequenceHandlers(): void {
  handlers.clear();
}

/** Run every handler registered for a message's intent, in registration order. */
export function applyConsequences(state: GameState, message: Message): number {
  const intent = message.consequence.intent;
  if (!intent) return 0;
  const registered = handlers.get(intent) ?? [];
  let applied = 0;
  for (const handler of registered) {
    try {
      handler(state, message);
      const name = handler.name || 'anonymous';
      if (!message.consequence.appliedHooks.includes(name)) message.consequence.appliedHooks.push(name);
      applied += 1;
    } catch (error) {
      // A consequence that throws must not take the message with it: the words
      // have already been said, and losing them would be worse than losing the
      // effect.
      console.warn(`A consequence for ${intent} failed.`, error);
    }
  }
  return applied;
}

/** Record that something has been settled, and what it settled into. */
export function resolveConsequence(
  state: GameState,
  messageId: string,
  outcome: string,
  date: ISODate = state.date,
): Message | null {
  for (const conversation of Object.values(communicationStore(state).conversations)) {
    const message = conversation.messages.find((entry) => entry.id === messageId);
    if (!message) continue;
    message.consequence.resolvedOn = date;
    message.consequence.outcome = outcome;
    return message;
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * Opening threads
 * ------------------------------------------------------------------------ */

export interface OpenConversationRequest {
  /** Everyone in the thread, the manager included. */
  participantIds: PersonId[];
  type: ConversationType;
  title?: string;
  subject?: ConversationSubject | null;
  /** The intent behind the opening, which shapes the opening message. */
  intent?: CommunicationIntent;
  body?: string;
  /** Context recorded on the message, for whoever resolves it later. */
  context?: Record<string, string | number>;
  date?: ISODate;
}

/**
 * A thread somebody else starts.
 *
 * The NPC's first message is generated here rather than passed in, because the
 * message *is* the conversation: opening a thread and saying something in it are
 * the same act in the world. A caller that has its own words to speak passes a
 * `body` and gets exactly those.
 */
export function openConversation(state: GameState, request: OpenConversationRequest): Conversation {
  const participants = withManager(request.participantIds);
  const conversation = ensureConversation(state, {
    type: request.type,
    participantIds: participants,
    ...(request.title ? { title: request.title } : {}),
    subject: request.subject ?? null,
    ...(request.date ? { date: request.date } : {}),
  });

  const speaker = participants.find((id) => id !== MANAGER_PERSON_ID) ?? MANAGER_PERSON_ID;
  if (conversation.messages.length > 0 && !request.body) return conversation;

  const intent = request.intent ?? 'GENERAL_CHECK_IN';
  const draft = request.body
    ? null
    : draftOpening(state, speaker, intent, {
        ...(conversation.subject ? { subject: conversation.subject } : {}),
        ...(request.context ? { context: request.context } : {}),
      });

  appendMessage(state, conversation.id, {
    senderId: speaker,
    recipientIds: conversation.participantIds.filter((id) => id !== speaker),
    body: request.body ?? draft?.body ?? '',
    type: draft?.type ?? 'greeting',
    ...(conversation.subject ? { subject: conversation.subject } : {}),
    context: draft?.context ?? request.context ?? {},
    responseOptions: draft?.responseOptions ?? [],
    consequence: createEmptyConsequence(intent, speaker, request.context ?? {}),
    ...(request.date ? { timestamp: request.date } : {}),
    read: false,
  });

  // An opening message from somebody else expects to be answered, so it runs
  // through the same hook path as any other message carrying an intent.
  const opening = messagesOf(state, conversation.id)[messagesOf(state, conversation.id).length - 1] ?? null;
  if (opening) applyConsequences(state, opening);
  return conversation;
}

/** Ask somebody something, from a system rather than from the manager. */
export function deliver(
  state: GameState,
  request: OpenConversationRequest,
): { conversation: Conversation; message: Message | null } {
  const conversation = openConversation(state, request);
  const last = messagesOf(state, conversation.id);
  return { conversation, message: last[last.length - 1] ?? null };
}

/* ------------------------------------------------------------------------ *
 * The manager writing
 * ------------------------------------------------------------------------ */

export interface ManagerSendRequest {
  conversationId: ConversationId;
  /** What the manager is trying to do. The thing the reply will be shaped by. */
  intent: CommunicationIntent;
  /** Who it is aimed at. Falls back to the other participants. */
  targetId?: PersonId | null;
  /** The manager's own words. Generated from the intent when omitted. */
  body?: string;
  context?: Record<string, string | number>;
  /** Options to put on the reply this message expects. */
  responseOptions?: ResponseOption[];
  date?: ISODate;
  /** Write the words now (default) or hold the message for later. */
  deliver?: boolean;
}

export interface ManagerSendResult {
  message: Message | null;
  reply: Message | null;
}

/**
 * The manager writes.
 *
 * The message is recorded with its intent, its target and its context, and only
 * then are the consequence hooks run — so a handler reads a message that is
 * already in the thread, exactly as any later reader would. If the manager
 * intends to get an answer, one is generated deterministically and appended; the
 * manager's own message is never unread, and the reply always is.
 */
export function sendFromManager(state: GameState, request: ManagerSendRequest): ManagerSendResult {
  const conversation = conversationOf(state, request.conversationId);
  if (!conversation) return { message: null, reply: null };

  // Writing into a closed thread reopens it: people write back weeks later.
  if (!conversation.active) reopenConversation(state, conversation.id);

  const recipients = recipientsFor(conversation, request.targetId ?? null);
  const context = request.context ?? {};
  const message = appendMessage(state, conversation.id, {
    senderId: MANAGER_PERSON_ID,
    recipientIds: recipients,
    body: request.body ?? intentPrompt(request.intent, context),
    type: managerMessageType(request.intent),
    context,
    subject: conversation.subject,
    responseOptions: request.responseOptions ?? [],
    consequence: createEmptyConsequence(
      request.intent,
      request.targetId ?? recipients[0] ?? null,
      context,
    ),
    ...(request.date ? { timestamp: request.date } : {}),
    read: true,
  });
  if (!message) return { message: null, reply: null };

  applyConsequences(state, message);
  if (request.deliver === false) return { message, reply: null };

  const target = request.targetId ?? recipients[0] ?? null;
  if (!target || recipients.length === 0) return { message, reply: null };

  const draft = draftReply(state, target, request.intent, {
    ...(conversation.subject ? { subject: conversation.subject } : {}),
    context,
  });
  const reply = appendMessage(state, conversation.id, {
    senderId: target,
    recipientIds: [MANAGER_PERSON_ID],
    body: draft.body,
    type: draft.type,
    context: draft.context,
    subject: conversation.subject,
    responseOptions: request.responseOptions ?? draft.responseOptions,
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, {}),
    ...(request.date ? { timestamp: request.date } : {}),
    read: false,
  });
  if (reply) applyConsequences(state, reply);
  return { message, reply };
}

/**
 * Answer an inbound message with a structured intent.
 *
 * The point of this over `sendFromManager` is that it takes the intent from the
 * message's own options, so a caller offering the manager choices is reading the
 * thread rather than inventing the vocabulary.
 */
export function respondWithIntent(
  state: GameState,
  conversationId: ConversationId,
  option: ResponseOption,
  options: { body?: string; context?: Record<string, string | number>; date?: ISODate } = {},
): ManagerSendResult {
  return sendFromManager(state, {
    conversationId,
    intent: option.intent,
    targetId: option.targetId,
    ...(options.body ? { body: options.body } : {}),
    context: { ...(option.context ?? {}), ...(options.context ?? {}) },
    ...(options.date ? { date: options.date } : {}),
  });
}

/** Somebody else says something in an existing thread. */
export function sendFromPerson(
  state: GameState,
  conversationId: ConversationId,
  personId: PersonId,
  options: { body: string; type?: Message['type']; intent?: CommunicationIntent; context?: Record<string, string | number>; date?: ISODate; read?: boolean } = { body: '' },
): Message | null {
  const conversation = conversationOf(state, conversationId);
  if (!conversation) return null;
  if (!conversation.active) reopenConversation(state, conversation.id);
  const message = appendMessage(state, conversation.id, {
    senderId: personId,
    recipientIds: conversation.participantIds.filter((id) => id !== personId),
    body: options.body,
    type: options.type ?? 'answer',
    context: options.context ?? {},
    subject: conversation.subject,
    responseOptions: [],
    consequence: createEmptyConsequence(options.intent ?? null, null, options.context ?? {}),
    ...(options.date ? { timestamp: options.date } : {}),
    read: options.read ?? false,
  });
  if (message) applyConsequences(state, message);
  return message;
}

/* ------------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------------ */

/** Everything the manager is in the middle of, newest first. */
export function inbox(state: GameState): Conversation[] {
  return conversationsInOrder(state).filter((conversation) => conversation.active);
}

/** Threads with something unread in them. */
export function unreadConversations(state: GameState): Conversation[] {
  return conversationsInOrder(state).filter((conversation) => conversation.unreadCount > 0);
}

export { closeConversation, communicationStore, conversationOf, conversationsInOrder, markConversationRead, markMessageRead, messagesOf, reopenConversation, totalUnread, unreadCountFor, findConversation, ensureConversation, participantName, defaultTitleFor };

/** A conversation with one person, opened if it is not already there. */
export function threadWith(state: GameState, personId: PersonId, type: ConversationType = 'player'): Conversation {
  return ensureConversation(state, {
    type,
    participantIds: withManager([personId]),
    title: personDisplayNameOf(state, personId),
  });
}

/** A thread with several people at once — the squad, the committee. */
export function threadWithGroup(
  state: GameState,
  personIds: PersonId[],
  type: ConversationType,
  title?: string,
): Conversation {
  return ensureConversation(state, {
    type,
    participantIds: withManager(personIds),
    ...(title ? { title } : {}),
  });
}

function personDisplayNameOf(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  return person ? personDisplayName(person) : 'Former member';
}

/** The manager is always in his own conversations. */
function withManager(participantIds: PersonId[]): PersonId[] {
  const unique = [...new Set(participantIds.filter((id) => typeof id === 'string' && id.length > 0))];
  return unique.includes(MANAGER_PERSON_ID) ? unique : [MANAGER_PERSON_ID, ...unique];
}

/** Who a manager message goes to: the target, or everyone else in the thread. */
function recipientsFor(conversation: Conversation, targetId: PersonId | null): PersonId[] {
  if (targetId && conversation.participantIds.includes(targetId)) return [targetId];
  return conversation.participantIds.filter((id) => id !== MANAGER_PERSON_ID);
}

/**
 * The manager's own words when a system sends an intent without a body.
 *
 * A manager's message is a sentence he would actually type, and the fact it
 * stands in for a missing body is honest rather than dressed up: the intent is
 * the content until a later stage writes something better. `context.topic` is
 * what makes it personal — the day a player rolls unavailable, the topic is his
 * name.
 */
function intentPrompt(intent: CommunicationIntent, context: Record<string, string | number>): string {
  const topic = typeof context.topic === 'string' ? context.topic : '';
  const who = typeof context.name === 'string' ? context.name : topic;
  switch (intent) {
    case 'ASK_AVAILABILITY':
      return who ? `${who} - are you good for Sunday?` : 'Are you good for Sunday?';
    case 'ASK_FITNESS':
      return who ? `${who} - how is the knock, are you right for it?` : 'How is the knock?';
    case 'ASK_CONFIRMATION':
      // The chase is deliberately plainer than the first question. He has been
      // asked already and given an answer that was not an answer; repeating the
      // question in new words would read as the manager forgetting he asked.
      return who ? `${who} - can you confirm for me, yes or no?` : 'Can you confirm for me?';
    case 'ASK_UPDATE':
      return who ? `${who} - any news since last week?` : 'Any news since last week?';
    case 'REMIND_PAYMENT': {
      const owed = typeof context.owed === 'number' ? Math.round(context.owed) : null;
      const figure = owed === null ? '' : `£${owed} of it`;
      return who
        ? `${who} - subs are still outstanding${figure ? `, ${figure} of it` : ''}, can I catch you?`
        : `Subs are still outstanding${figure ? `, ${figure} of it` : ''}.`;
    }
    case 'ASK_PAYMENT':
      return who ? `${who} - can you get your subs in this week?` : 'Can you get your subs in this week?';
    case 'DISCUSS_PAYMENT':
      return who ? `${who} - how are you managing? No pressure, but I should ask.` : 'How are you managing?';
    case 'WARN_PAYMENT': {
      // A warning that does not say how far behind the man is is a threat rather
      // than a warning, and the manager always knows the figure.
      const owed = typeof context.owed === 'number' ? Math.round(context.owed) : null;
      const behind = owed === null ? '' : ` You are £${owed} behind.`;
      return who
        ? `${who} -${behind} This is the last time I ask. Get the money in or I cannot keep you on.`
        : `${behind.trim()} This is the last time I ask. Get the money in.`.trim();
    }
    case 'PRAISE':
      return who ? `${who} - well played, that was a good one.` : 'Well played, that was a good one.';
    case 'CRITICISE':
      return who ? `${who} - I want a word about Saturday.` : 'I want a word about Saturday.';
    case 'INVITE_TO_TRAINING':
      return who ? `${who} - down Thursday if you are free?` : 'Down Thursday if you are free?';
    case 'INVITE_TO_TRIAL':
      return who ? `${who} - fancy coming down for a game?` : 'Fancy coming down for a game?';
    case 'OFFER_ROLE':
      return who ? `${who} - I would like to offer you a place.` : 'I would like to offer you a place.';
    case 'ASK_ADVICE':
      return who ? `${who} - got a minute for a bit of advice?` : 'Got a minute for a bit of advice?';
    default:
      return who ? `Quick one about you, ${who}.` : 'Quick word.';
  }
}

function managerMessageType(intent: CommunicationIntent): Message['type'] {
  switch (intent) {
    case 'REMIND_PAYMENT':
    case 'WARN_PAYMENT':
      return 'reminder';
    case 'PRAISE':
    case 'CRITICISE':
      return 'feedback';
    case 'INVITE_TO_TRAINING':
    case 'INVITE_TO_TRIAL':
      return 'invitation';
    case 'OFFER_ROLE':
      return 'offer';
    case 'ASK_AVAILABILITY':
    case 'ASK_FITNESS':
    case 'ASK_ADVICE':
    case 'GENERAL_CHECK_IN':
      return 'question';
    default:
      return 'answer';
  }
}

