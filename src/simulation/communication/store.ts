import type { GameState } from '@/domain/game';
import {
  emptyCommunicationStore,
  MANAGER_PERSON_ID,
  type CommunicationStore,
  type Conversation,
  type ConversationSubject,
  type ConversationType,
  type Message,
} from '@/domain/communication';
import type { ConversationId, ISODate, MessageId, PersonId } from '@/domain/ids';
import { isOfficial, isPlayer, personDisplayName, type Person } from '@/domain/person';
import { nextId } from '../ids';

/**
 * The communication store: conversations, messages and who has read them.
 *
 * The store lives on the game state like every other subsystem store
 * (`relationships`, `recruitment`, `training`) — there is no second root object
 * and nothing here is module-level, so a save carries the whole inbox with it
 * and a reload has nothing to rebuild.
 *
 * Everything is defensive about people, because people leave. A Sunday League
 * career churns: players get released, clubs fold, officials move on. A
 * conversation with somebody who is no longer in the world must still render,
 * still count, and still be readable — so ids are kept even when the person
 * behind them is gone, and display falls back rather than throwing.
 */

/** The store, created on demand so an older save is repaired in place. */
export function communicationStore(state: GameState): CommunicationStore {
  const existing = state.communication as CommunicationStore | undefined;
  if (!existing || typeof existing !== 'object') {
    state.communication = emptyCommunicationStore();
    return state.communication;
  }
  if (!existing.conversations || typeof existing.conversations !== 'object') existing.conversations = {};
  if (!Array.isArray(existing.order)) existing.order = [];
  return existing;
}

export function conversationOf(state: GameState, id: ConversationId): Conversation | undefined {
  return communicationStore(state).conversations[id];
}

/** Conversations the manager is part of, most recently active first. */
export function conversationsInOrder(state: GameState): Conversation[] {
  const store = communicationStore(state);
  const seen = new Set<ConversationId>();
  const ordered: Conversation[] = [];
  for (const id of store.order) {
    const conversation = store.conversations[id];
    if (!conversation || seen.has(id)) continue;
    seen.add(id);
    ordered.push(conversation);
  }
  // Anything missing from the order (an old save, a hand-built state) is still
  // a conversation, and still has to be readable.
  for (const conversation of Object.values(store.conversations)) {
    if (!seen.has(conversation.id)) ordered.push(conversation);
  }
  return ordered;
}

/** Conversations involving one person, newest activity first. */
export function conversationsWith(state: GameState, personId: PersonId): Conversation[] {
  return conversationsInOrder(state).filter((conversation) => conversation.participantIds.includes(personId));
}

/** Threads the manager has not finished with, newest first. */
export function openConversations(state: GameState): Conversation[] {
  return conversationsInOrder(state).filter((conversation) => conversation.active);
}

/** Total unread across every conversation: what the badge on the inbox shows. */
export function totalUnread(state: GameState): number {
  return conversationsInOrder(state).reduce((sum, conversation) => sum + conversation.unreadCount, 0);
}

export function unreadCountFor(state: GameState, conversationId: ConversationId): number {
  return conversationOf(state, conversationId)?.unreadCount ?? 0;
}

export interface NewConversationSeed {
  type: ConversationType;
  /** Everyone in the thread, the manager included. Order is kept as given. */
  participantIds: PersonId[];
  title?: string;
  subject?: ConversationSubject | null;
  date?: ISODate;
  /** Start closed — a thread archived at the moment it is created. */
  active?: boolean;
}

/**
 * Open a new conversation.
 *
 * Ids come from the state's counters like every other generated id, so a career
 * regenerated from the same seed produces the same conversation ids, and a
 * reloaded save carries on numbering where it left off rather than colliding.
 */
export function createConversation(state: GameState, seed: NewConversationSeed): Conversation {
  const store = communicationStore(state);
  const participants = dedupeIds(seed.participantIds);
  const conversation: Conversation = {
    id: nextId(state, 'conversation'),
    type: seed.type,
    title: seed.title?.trim() || defaultTitleFor(state, participants),
    participantIds: participants,
    messages: [],
    lastActivity: seed.date ?? state.date,
    unreadCount: 0,
    active: seed.active ?? true,
    closedOn: seed.active === false ? (seed.date ?? state.date) : null,
    subject: seed.subject ?? null,
  };
  store.conversations[conversation.id] = conversation;
  store.order = [conversation.id, ...store.order.filter((id) => id !== conversation.id)];
  return conversation;
}

/**
 * The conversation a thread should live in.
 *
 * There should be one thread per pair (or per group) rather than a new one for
 * every exchange, so this finds the existing open conversation with the same
 * correspondents and the same subject, and opens one only if there is none.
 * Matching is on the exact set: a group thread with six people in it is a
 * different conversation from a one-to-one with two of them.
 *
 * The manager is left out of the comparison, because he is in every one of his
 * own threads and a caller naming the people he is talking *to* should not have
 * to remember to add himself.
 */
export function findConversation(
  state: GameState,
  participantIds: PersonId[],
  options: { type?: ConversationType; subjectId?: string | null; includeClosed?: boolean } = {},
): Conversation | undefined {
  const wanted = canonicalIdSet(participantIds.filter((id) => id !== MANAGER_PERSON_ID));
  const subjectId = options.subjectId ?? null;
  return conversationsInOrder(state).find((conversation) => {
    if (!conversation.active && !options.includeClosed) return false;
    if (options.type && conversation.type !== options.type) return false;
    if (canonicalIdSet(correspondentsOf(conversation)) !== wanted) return false;
    if (subjectId) return (conversation.subject?.id ?? null) === subjectId;
    return true;
  });
}

/** Open the thread, or find the one that already exists. */
export function ensureConversation(state: GameState, seed: NewConversationSeed): Conversation {
  const found = findConversation(state, seed.participantIds, {
    ...(seed.type ? { type: seed.type } : {}),
    subjectId: seed.subject?.id ?? null,
  });
  return found ?? createConversation(state, seed);
}

export interface AppendMessageSeed {
  senderId: PersonId;
  recipientIds: PersonId[];
  body: string;
  type: Message['type'];
  timestamp?: ISODate;
  subject?: ConversationSubject | null;
  context?: Record<string, string | number>;
  responseOptions?: Message['responseOptions'];
  consequence?: Message['consequence'];
  /** Inbound messages arrive unread; the manager's own do not. */
  read?: boolean;
}

/**
 * Put a message into a conversation.
 *
 * The message's sequence is the conversation's next one rather than a timestamp
 * comparison: game time moves a day at a time, so two messages on the same day
 * would otherwise have no order, and after a save/load the order they were
 * written in has to be the order they come back in.
 */
export function appendMessage(state: GameState, conversationId: ConversationId, seed: AppendMessageSeed): Message | null {
  const conversation = conversationOf(state, conversationId);
  if (!conversation) return null;

  const message: Message = {
    id: nextId(state, 'message'),
    conversationId,
    senderId: seed.senderId,
    recipientIds: dedupeIds(seed.recipientIds),
    timestamp: seed.timestamp ?? state.date,
    sequence: conversation.messages.length + 1,
    body: seed.body,
    direction: seed.senderId === MANAGER_PERSON_ID ? 'outbound' : 'inbound',
    read: seed.read ?? seed.senderId === MANAGER_PERSON_ID,
    type: seed.type,
    context: seed.context ?? {},
    subject: seed.subject ?? conversation.subject ?? null,
    responseOptions: seed.responseOptions ?? [],
    consequence:
      seed.consequence ?? {
        intent: null,
        targetId: null,
        context: {},
        resolvedOn: null,
        outcome: null,
        appliedHooks: [],
      },
  };

  conversation.messages.push(message);
  if (message.timestamp >= conversation.lastActivity) conversation.lastActivity = message.timestamp;
  if (!message.read && message.direction === 'inbound') conversation.unreadCount += 1;
  bumpOrder(state, conversationId);
  return message;
}

/** Mark one message read, keeping the conversation's count honest. */
export function markMessageRead(state: GameState, messageId: MessageId): boolean {
  for (const conversation of Object.values(communicationStore(state).conversations)) {
    const message = conversation.messages.find((entry) => entry.id === messageId);
    if (!message) continue;
    if (message.read) return false;
    message.read = true;
    if (conversation.unreadCount > 0) conversation.unreadCount -= 1;
    return true;
  }
  return false;
}

/** Mark a whole conversation read. Returns how many messages that cleared. */
export function markConversationRead(state: GameState, conversationId: ConversationId): number {
  const conversation = conversationOf(state, conversationId);
  if (!conversation) return 0;
  let cleared = 0;
  for (const message of conversation.messages) {
    if (message.read) continue;
    message.read = true;
    cleared += 1;
  }
  conversation.unreadCount = 0;
  return cleared;
}

/** Close a thread. Nothing is deleted: a closed conversation is history. */
export function closeConversation(state: GameState, conversationId: ConversationId): Conversation | null {
  const conversation = conversationOf(state, conversationId);
  if (!conversation) return null;
  conversation.active = false;
  conversation.closedOn = state.date;
  return conversation;
}

/** Reopen a closed thread — a subject that comes back round next week. */
export function reopenConversation(state: GameState, conversationId: ConversationId): Conversation | null {
  const conversation = conversationOf(state, conversationId);
  if (!conversation) return null;
  conversation.active = true;
  conversation.closedOn = null;
  bumpOrder(state, conversationId);
  return conversation;
}

/** Messages in a conversation, oldest first. A copy, not the live array. */
export function messagesOf(state: GameState, conversationId: ConversationId): Message[] {
  const conversation = conversationOf(state, conversationId);
  if (!conversation) return [];
  return [...conversation.messages].sort((a, b) => a.sequence - b.sequence);
}

/** The most recent message in a conversation, or null if it is empty. */
export function lastMessageOf(state: GameState, conversationId: ConversationId): Message | null {
  const conversation = conversationOf(state, conversationId);
  if (!conversation || conversation.messages.length === 0) return null;
  return conversation.messages[conversation.messages.length - 1] ?? null;
}

/**
 * Rebuild the store after loading, and drop what has gone stale.
 *
 * Ids for people who have left the world are kept — a thread with a released
 * player still happened, and pretending otherwise would quietly rewrite the
 * manager's history — but the ids are filtered out of `participantIds` so that
 * nothing tries to render, or send something to, somebody who is not there. The
 * unread count is recalculated from the messages rather than trusted, because a
 * count that has drifted is worse than no count.
 *
 * Returns what was removed, so callers can see it and tests can assert on it.
 */
export function pruneCommunication(state: GameState): { droppedParticipants: number; conversations: number } {
  const store = communicationStore(state);
  let droppedParticipants = 0;
  let conversations = 0;

  for (const conversation of Object.values(store.conversations)) {
    const live = conversation.participantIds.filter((id) => Boolean(state.people[id]));
    droppedParticipants += conversation.participantIds.length - live.length;
    conversation.participantIds = live;

    // A thread whose every message is still fine is kept. Messages are never
    // deleted: the manager's own correspondence is part of the career.
    conversation.messages.sort((a, b) => a.sequence - b.sequence);
    conversation.unreadCount = conversation.messages.filter((message) => !message.read && message.direction === 'inbound').length;
    conversation.lastActivity =
      conversation.messages.length > 0
        ? conversation.messages[conversation.messages.length - 1]!.timestamp
        : (state.date as ISODate);
    conversations += 1;

    // A thread left with the manager alone is not dead: it is a thread with
    // nobody on the other end, and the manager can still read it. It only goes
    // quiet if the manager said so himself.
    if (conversation.participantIds.length === 0) {
      conversation.active = false;
      conversation.closedOn = conversation.closedOn ?? (state.date as ISODate);
    }
  }

  store.order = store.order.filter((id) => Boolean(store.conversations[id]));
  return { droppedParticipants, conversations };
}

/**
 * People the manager can hold a conversation with, most obvious first.
 *
 * This is not a UI list: it is the set of *valid targets*, so a caller that
 * offers the manager somebody to write to cannot offer a person who has left the
 * world or somebody outside his club without the caller deciding to allow it.
 */
export function contactablePeople(state: GameState): Person[] {
  const club = state.clubs[state.userClubId];
  const squad = new Set(club?.squadIds ?? []);
  const people = Object.values(state.people).filter((person) => person.id !== MANAGER_PERSON_ID);
  return people
    .filter((person) => squad.has(person.id) || person.clubId === state.userClubId || person.clubId === null)
    .sort((a, b) => {
      const rank = (person: Person): number => (isPlayer(person) ? 0 : isOfficial(person) ? 1 : 2);
      return (
        rank(a) - rank(b) ||
        a.surname.localeCompare(b.surname) ||
        a.firstName.localeCompare(b.firstName)
      );
    });
}

/** How a person is named in a thread, or what is left of them if they have gone. */
export function participantName(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  if (!person) return 'Former member';
  return personDisplayName(person);
}

/** A sensible title for a thread nobody named: the other people in it. */
export function defaultTitleFor(state: GameState, participantIds: PersonId[]): string {
  const others = participantIds.filter((id) => id !== MANAGER_PERSON_ID);
  if (others.length === 0) return 'Notes';
  if (others.length === 1) return participantName(state, others[0]!);
  if (others.length === 2) return `${participantName(state, others[0]!)} and ${participantName(state, others[1]!)}`;
  return `${participantName(state, others[0]!)} +${others.length - 1}`;
}

function dedupeIds(ids: PersonId[]): PersonId[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
}

/** Two participant lists match when they hold the same ids, in any order. */
function canonicalIdSet(ids: PersonId[]): string {
  return [...new Set(ids)].sort().join('|');
}

/** Everyone in a thread except the manager: the people he is talking to. */
export function correspondentsOf(conversation: Conversation): PersonId[] {
  return conversation.participantIds.filter((id) => id !== MANAGER_PERSON_ID);
}

/** Move a conversation to the front of the order after activity. */
function bumpOrder(state: GameState, conversationId: ConversationId): void {
  const store = communicationStore(state);
  store.order = [conversationId, ...store.order.filter((id) => id !== conversationId)];
}