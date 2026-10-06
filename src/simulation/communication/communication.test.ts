import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_INTENT_LABEL,
  emptyCommunicationStore,
  MANAGER_PERSON_ID,
  type CommunicationIntent,
  type Conversation,
} from '@/domain/communication';
import { GAME_STATE_VERSION } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { refreshUnattachedPool } from '../generation/unattachedPlayers';
import { createTestGame, type TestGame } from '../testSupport';
import {
  applyConsequences,
  clearConsequenceHandlers,
  deliver,
  inbox,
  openConversation,
  registerConsequence,
  resolveConsequence,
  respondWithIntent,
  sendFromManager,
  sendFromPerson,
  threadWith,
  threadWithGroup,
  totalUnread,
  unreadConversations,
} from './system';
import {
  appendMessage,
  closeConversation,
  contactablePeople,
  conversationOf,
  conversationsInOrder,
  defaultTitleFor,
  findConversation,
  markConversationRead,
  markMessageRead,
  messagesOf,
  pruneCommunication,
  removePersonFromCommunication,
} from './store';

function squadOf(game: TestGame): Player[] {
  const club = game.state.clubs[game.clubId]!;
  return club.squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

function subjectFor(player: Player) {
  return { kind: 'player' as const, id: player.id, label: `${player.firstName} ${player.surname}` };
}

describe('communication: conversations', () => {
  it('opens a conversation with its participants, title and opening message', () => {
    const game = createTestGame('comms-1');
    const player = squadOf(game)[0]!;

    const conversation = openConversation(game.state, {
      participantIds: [player.id],
      type: 'player',
      intent: 'ASK_AVAILABILITY',
      subject: subjectFor(player),
      context: { name: player.firstName },
    });

    expect(conversation.id).toMatch(/^conversation_\d+$/);
    expect(conversation.type).toBe('player');
    expect(conversation.participantIds).toContain(player.id);
    expect(conversation.participantIds).toContain(MANAGER_PERSON_ID);
    expect(conversation.title).toContain(player.surname);
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]!.direction).toBe('inbound');
    expect(conversation.messages[0]!.body.length).toBeGreaterThan(0);
    expect(conversation.active).toBe(true);
    expect(conversation.lastActivity).toBe(game.state.date);
  });

  it('starts a new career with an empty inbox', () => {
    const game = createTestGame('comms-empty');
    expect(game.state.communication).toEqual(emptyCommunicationStore());
    expect(inbox(game.state)).toHaveLength(0);
    expect(totalUnread(game.state)).toBe(0);
  });

  it('reuses one thread per set of participants instead of opening a second', () => {
    const game = createTestGame('comms-reuse');
    const player = squadOf(game)[0]!;

    const first = threadWith(game.state, player.id, 'player');
    const second = threadWith(game.state, player.id, 'player');

    expect(second.id).toBe(first.id);
    expect(Object.keys(game.state.communication.conversations)).toHaveLength(1);
  });

  it('keeps a group thread distinct from a one-to-one with the same people', () => {
    const game = createTestGame('comms-group');
    const [a, b] = squadOf(game);

    const oneToOne = threadWith(game.state, a.id, 'player');
    const group = threadWithGroup(game.state, [a.id, b.id], 'group', 'The squad');

    expect(group.id).not.toBe(oneToOne.id);
    expect(group.title).toBe('The squad');
    expect(findConversation(game.state, [a.id, b.id], { type: 'group' })?.id).toBe(group.id);
  });

  it('names an untitled thread after the people in it', () => {
    const game = createTestGame('comms-title');
    const [a, b] = squadOf(game);
    expect(defaultTitleFor(game.state, [a.id])).toContain(a.surname);
    expect(defaultTitleFor(game.state, [a.id, b.id])).toContain('and');
    expect(defaultTitleFor(game.state, [a.id, b.id, squadOf(game)[2]!.id])).toMatch(/\+\d/);
  });
});

describe('communication: sending and receiving', () => {
  it('records a manager message as outbound, read, and carrying its intent', () => {
    const game = createTestGame('comms-send');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    const { message } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_AVAILABILITY',
      targetId: player.id,
      body: 'Are you good for Sunday?',
    });

    expect(message).not.toBeNull();
    expect(message!.senderId).toBe(MANAGER_PERSON_ID);
    expect(message!.direction).toBe('outbound');
    expect(message!.read).toBe(true);
    expect(message!.recipientIds).toEqual([player.id]);
    expect(message!.consequence.intent).toBe('ASK_AVAILABILITY');
    expect(message!.consequence.targetId).toBe(player.id);
    expect(message!.consequence.resolvedOn).toBeNull();
  });

  it('writes a manager message from its intent when no body is given', () => {
    const game = createTestGame('comms-intent-body');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    const { message } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_FITNESS',
      targetId: player.id,
      context: { name: player.firstName },
    });

    expect(message!.body).toContain(player.firstName);
    expect(message!.body).toContain('knock');
  });

  it('answers a manager message with an inbound message from the recipient', () => {
    const game = createTestGame('comms-reply');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    const { reply } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_AVAILABILITY',
      targetId: player.id,
    });

    expect(reply).not.toBeNull();
    expect(reply!.senderId).toBe(player.id);
    expect(reply!.direction).toBe('inbound');
    expect(reply!.read).toBe(false);
    expect(reply!.recipientIds).toEqual([MANAGER_PERSON_ID]);
  });

  it('holds the message back when the manager asks it to', () => {
    const game = createTestGame('comms-nodeliver');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    const { message, reply } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'GENERAL_CHECK_IN',
      targetId: player.id,
      deliver: false,
    });

    expect(message).not.toBeNull();
    expect(reply).toBeNull();
    expect(conversationOf(game.state, conversation.id)!.messages).toHaveLength(1);
  });

  it('answers with the intent the message itself offered', () => {
    const game = createTestGame('comms-respond-intent');
    const player = squadOf(game)[0]!;
    const opened = deliver(game.state, {
      participantIds: [player.id],
      type: 'player',
      intent: 'ASK_AVAILABILITY',
      subject: subjectFor(player),
    });

    const options = opened.message!.responseOptions;
    expect(options.length).toBeGreaterThan(0);
    const option = options[0]!;
    expect(options.map((entry) => entry.intent)).toContain('INVITE_TO_TRAINING');

    const { message } = respondWithIntent(game.state, opened.conversation.id, option, {
      context: { name: player.firstName },
    });
    expect(message!.consequence.intent).toBe(option.intent);
    expect(message!.consequence.targetId).toBe(player.id);
  });

  it('lets somebody else write into a thread', () => {
    const game = createTestGame('comms-person');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    const message = sendFromPerson(game.state, conversation.id, player.id, {
      body: 'Are we all right for a knockabout Wednesday?',
      type: 'question',
      intent: 'ASK_AVAILABILITY',
      context: { session: 'wednesday' },
    });

    expect(message!.direction).toBe('inbound');
    expect(message!.consequence.context.session).toBe('wednesday');
    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(1);
  });

  it('offers the manager structured intents on an inbound message', () => {
    const game = createTestGame('comms-options');
    const player = squadOf(game)[0]!;
    const { message } = deliver(game.state, {
      participantIds: [player.id],
      type: 'player',
      intent: 'ASK_FITNESS',
      subject: subjectFor(player),
    });

    const labels = message!.responseOptions.map((option) => option.label);
    expect(labels.length).toBeGreaterThan(0);
    for (const option of message!.responseOptions) {
      expect(COMMUNICATION_INTENT_LABEL[option.intent]).toBeTruthy();
    }
  });
});

describe('communication: ordering and timestamps', () => {
  it('keeps messages in the order they were written', () => {
    const game = createTestGame('comms-order');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    sendFromManager(game.state, { conversationId: conversation.id, intent: 'ASK_AVAILABILITY', targetId: player.id });
    sendFromPerson(game.state, conversation.id, player.id, { body: 'I am not sure yet, boss.' });
    sendFromManager(game.state, { conversationId: conversation.id, intent: 'INVITE_TO_TRAINING', targetId: player.id });

    const messages = messagesOf(game.state, conversation.id);
    // Each of the manager's own messages drew an answer, so the thread reads
    // out, in, in, out, in — in the order it was written, not in any sorted
    // or grouped order.
    expect(messages.map((message) => message.direction)).toEqual(['outbound', 'inbound', 'inbound', 'outbound', 'inbound']);
    expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(messages[2]!.body).toBe('I am not sure yet, boss.');
    expect(messages[3]!.body).toContain('Thursday');
  });

  it('stamps each message with the date it was sent', () => {
    const game = createTestGame('comms-stamp');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    game.state.date = '2026-09-02';
    sendFromPerson(game.state, conversation.id, player.id, { body: 'First.' });
    game.state.date = '2026-09-09';
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Second.' });

    const messages = messagesOf(game.state, conversation.id);
    expect(messages.map((message) => message.timestamp)).toEqual(['2026-09-02', '2026-09-09']);
    expect(conversationOf(game.state, conversation.id)!.lastActivity).toBe('2026-09-09');
  });

  it('moves the most recently active conversation to the front', () => {
    const game = createTestGame('comms-bump');
    const [a, b] = squadOf(game);
    const first = threadWith(game.state, a.id);
    const second = threadWith(game.state, b.id);

    expect(conversationsInOrder(game.state)[0]!.id).toBe(second.id);
    sendFromPerson(game.state, first.id, a.id, { body: 'Are we still on?' });
    expect(conversationsInOrder(game.state)[0]!.id).toBe(first.id);
  });
});

describe('communication: read state', () => {
  it('counts unread inbound messages and ignores the manager\'s own', () => {
    const game = createTestGame('comms-unread');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(0);

    sendFromPerson(game.state, conversation.id, player.id, { body: 'One.' });
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Two.' });
    // The manager's own words are not unread, and the reply they draw is.
    sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'PRAISE',
      targetId: player.id,
      deliver: false,
    });

    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(2);
    expect(totalUnread(game.state)).toBe(2);
    expect(unreadConversations(game.state)).toHaveLength(1);
  });

  it('reads one message without touching the rest', () => {
    const game = createTestGame('comms-read-one');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    const first = sendFromPerson(game.state, conversation.id, player.id, { body: 'One.' })!;
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Two.' });

    expect(markMessageRead(game.state, first.id)).toBe(true);
    expect(markMessageRead(game.state, first.id)).toBe(false);
    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(1);
  });

  it('reads a whole conversation at once', () => {
    const game = createTestGame('comms-read-all');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    sendFromPerson(game.state, conversation.id, player.id, { body: 'One.' });
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Two.' });

    expect(markConversationRead(game.state, conversation.id)).toBe(2);
    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(0);
    expect(totalUnread(game.state)).toBe(0);
  });

  it('keeps an unread message that arrived before the thread was read', () => {
    const game = createTestGame('comms-read-order');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);

    markConversationRead(game.state, conversation.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Only now.' });

    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(1);
  });

  it('closes and reopens a thread without losing its messages', () => {
    const game = createTestGame('comms-close');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Hello.' });

    closeConversation(game.state, conversation.id);
    expect(conversationOf(game.state, conversation.id)!.active).toBe(false);
    expect(conversationOf(game.state, conversation.id)!.closedOn).toBe(game.state.date);
    expect(messagesOf(game.state, conversation.id)).toHaveLength(1);
    expect(inbox(game.state)).toHaveLength(0);

    sendFromPerson(game.state, conversation.id, player.id, { body: 'One more thing.' });
    expect(conversationOf(game.state, conversation.id)!.active).toBe(true);
    expect(messagesOf(game.state, conversation.id)).toHaveLength(2);
  });

  it('returns nothing rather than throwing for a conversation that is not there', () => {
    const game = createTestGame('comms-missing');
    expect(conversationOf(game.state, 'conversation_999')).toBeUndefined();
    expect(messagesOf(game.state, 'conversation_999')).toEqual([]);
    expect(markConversationRead(game.state, 'conversation_999')).toBe(0);
    expect(appendMessage(game.state, 'conversation_999', { senderId: MANAGER_PERSON_ID, recipientIds: [], body: 'x', type: 'question' })).toBeNull();
    expect(sendFromManager(game.state, { conversationId: 'conversation_999', intent: 'PRAISE' }).message).toBeNull();
  });
});

describe('communication: invalid and departed participants', () => {
  it('drops a message sent to somebody who is not in the world, and keeps the thread', () => {
    const game = createTestGame('comms-ghost');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Hello.' });

    delete game.state.people[player.id];

    // Reading the thread still works: the words were said, whatever has
    // happened since.
    expect(messagesOf(game.state, conversation.id)).toHaveLength(1);
    expect(markConversationRead(game.state, conversation.id)).toBe(1);

    // Once the world has been swept, a message aimed at somebody who has gone
    // has nobody to go to — and saying so is better than inventing a reader.
    pruneCommunication(game.state);
    const result = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'GENERAL_CHECK_IN',
      targetId: player.id,
    });
    expect(result.message!.recipientIds).toEqual([]);
    expect(result.reply).toBeNull();
    expect(result.message!.read).toBe(true);
  });

  it('names somebody who has gone rather than rendering a blank', () => {
    const game = createTestGame('comms-gone-name');
    const player = squadOf(game)[0]!;
    const id: PersonId = player.id;
    delete game.state.people[id];

    expect(defaultTitleFor(game.state, [id])).toBe('Former member');
  });

  it('prunes departed participants and closes a thread left with nobody', () => {
    const game = createTestGame('comms-prune');
    const [a, b] = squadOf(game);
    const duo = threadWithGroup(game.state, [a.id, b.id], 'group');
    const lonely = threadWith(game.state, b.id);

    delete game.state.people[a.id];
    delete game.state.people[b.id];

    const report = pruneCommunication(game.state);
    expect(report.droppedParticipants).toBeGreaterThan(0);

    const prunedDuo = conversationOf(game.state, duo.id)!;
    // The manager is still in it: a thread he is left holding is a thread he
    // can still read, it simply has nobody on the other end.
    expect(prunedDuo.participantIds).toEqual([MANAGER_PERSON_ID]);
    expect(prunedDuo.active).toBe(true);

    expect(conversationOf(game.state, lonely.id)!.participantIds).toEqual([MANAGER_PERSON_ID]);
  });

  it('recalculates unread counts rather than trusting the stored one', () => {
    const game = createTestGame('comms-unread-drift');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'One.' });

    const stored = conversationOf(game.state, conversation.id)!;
    stored.unreadCount = 99;
    pruneCommunication(game.state);
    expect(conversationOf(game.state, conversation.id)!.unreadCount).toBe(1);
  });

  it('does not offer the manager somebody who has left the world', () => {
    const game = createTestGame('comms-contacts');
    const player = squadOf(game)[0]!;
    const before = contactablePeople(game.state).map((person) => person.id);
    expect(before).toContain(player.id);

    delete game.state.people[player.id];
    expect(contactablePeople(game.state).map((person) => person.id)).not.toContain(player.id);
    // And the manager is never a correspondent with himself.
    expect(contactablePeople(game.state).map((person) => person.id)).not.toContain(MANAGER_PERSON_ID);
  });

  it('forgets a man who leaves the world, and leaves nothing for the loader to prune', () => {
    const game = createTestGame('comms-departure');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Still on for Sunday?' });

    delete game.state.people[player.id];
    const changed = removePersonFromCommunication(game.state, player.id);

    expect(changed).toBeGreaterThan(0);
    expect(conversationOf(game.state, conversation.id)!.participantIds).toEqual([MANAGER_PERSON_ID]);
    // The words survive him: a thread the manager is left holding is still his.
    expect(messagesOf(game.state, conversation.id)).toHaveLength(1);
    // And the loader has nothing left to do — the point being that a running
    // career and a reloaded one are the same inbox.
    expect(pruneCommunication(game.state).droppedParticipants).toBe(0);
  });

  it('is the same inbox before and after a save once a man has left', () => {
    const game = createTestGame('comms-departure-save');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Right you are.' });

    delete game.state.people[player.id];
    removePersonFromCommunication(game.state, player.id);

    const restored = deserialiseGame(serialiseGame(game.state));
    expect(restored.error).toBeNull();
    const before = conversationOf(game.state, conversation.id)!;
    const after = conversationOf(restored.state!, conversation.id)!;
    expect(after.participantIds).toEqual(before.participantIds);
    expect(after.messages).toEqual(before.messages);
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(after.active).toBe(before.active);
    expect(after.lastActivity).toBe(before.lastActivity);
  });

  it('takes a departed free agent out of every thread when the pool is refreshed', () => {
    const game = createTestGame('comms-departure-pool');
    const state = game.state;
    const freeAgent = Object.values(state.people).filter(isPlayer).find((player) => player.clubId === null)!;
    expect(freeAgent).toBeDefined();
    const conversation = threadWith(state, freeAgent.id);
    sendFromPerson(state, conversation.id, freeAgent.id, { body: 'Fancy a game Sunday?' });
    expect(conversationOf(state, conversation.id)!.participantIds).toContain(freeAgent.id);

    // Old enough to drift out of the local game when the pool is refreshed.
    freeAgent.age = 41;
    refreshUnattachedPool(state, state.season.startDate, 'comms-departure');

    expect(state.people[freeAgent.id]).toBeUndefined();
    // No thread still lists somebody who has gone...
    for (const thread of conversationsInOrder(state)) {
      expect(thread.participantIds).not.toContain(freeAgent.id);
    }
    // ...the loader agrees with the running career, and the words are still there.
    expect(pruneCommunication(state).droppedParticipants).toBe(0);
    expect(messagesOf(state, conversation.id).length).toBeGreaterThan(0);
  });
});

describe('communication: determinism', () => {
  it('writes the same words for the same career, day and message', () => {
    const first = createTestGame('comms-determinism');
    const second = createTestGame('comms-determinism');
    const intent: CommunicationIntent = 'ASK_AVAILABILITY';

    const bodies = [first, second].map((game) => {
      const player = squadOf(game)[0]!;
      const conversation = openConversation(game.state, {
        participantIds: [player.id],
        type: 'player',
        intent,
        subject: subjectFor(player),
      });
      return conversation.messages[0]!.body;
    });

    expect(bodies[0]).toBe(bodies[1]!);
  });

  it('gives different people different replies in the same conversation', () => {
    const game = createTestGame('comms-diverse');
    const players = squadOf(game).slice(0, 4);
    const replies = new Set<string>();

    for (const player of players) {
      const conversation = threadWith(game.state, player.id);
      const { reply } = sendFromManager(game.state, {
        conversationId: conversation.id,
        intent: 'ASK_AVAILABILITY',
        targetId: player.id,
      });
      replies.add(reply!.body);
    }

    // Determinism is not sameness: four men should not say the same thing.
    expect(replies.size).toBeGreaterThan(1);
  });

  it('numbers conversations and messages from the state counters', () => {
    const game = createTestGame('comms-ids');
    const [a, b] = squadOf(game);
    const first = threadWith(game.state, a.id);
    const second = threadWith(game.state, b.id);

    expect(first.id).toBe('conversation_1');
    expect(second.id).toBe('conversation_2');

    const message = appendMessage(game.state, first.id, {
      senderId: MANAGER_PERSON_ID,
      recipientIds: [a.id],
      body: 'Are you good for Sunday?',
      type: 'question',
    })!;
    expect(message.id).toBe('message_1');
    expect(appendMessage(game.state, second.id, {
      senderId: b.id,
      recipientIds: [MANAGER_PERSON_ID],
      body: 'I am.',
      type: 'answer',
    })!.id).toBe('message_2');
  });
});

describe('communication: consequences', () => {
  it('runs a registered handler when a message carrying its intent is written', () => {
    const game = createTestGame('comms-hooks');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    const seen: string[] = [];

    function noteSubject(_state: typeof game.state, message: { body: string }) {
      seen.push(message.body);
    }
    registerConsequence('ASK_AVAILABILITY', noteSubject);
    try {
      const { message } = sendFromManager(game.state, {
        conversationId: conversation.id,
        intent: 'ASK_AVAILABILITY',
        targetId: player.id,
        body: 'Are you good for Sunday?',
      });
      expect(seen).toHaveLength(1);
      expect(message!.consequence.appliedHooks).toEqual(['noteSubject']);
    } finally {
      clearConsequenceHandlers();
    }
  });

  it('records what a consequence settled into', () => {
    const game = createTestGame('comms-resolve');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    const { message } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_AVAILABILITY',
      targetId: player.id,
    });

    expect(resolveConsequence(game.state, message!.id, 'Availability: unavailable (work)')).not.toBeNull();
    const stored = messagesOf(game.state, conversation.id).find((entry) => entry.id === message!.id)!;
    expect(stored.consequence.resolvedOn).toBe(game.state.date);
    expect(stored.consequence.outcome).toContain('unavailable');
  });

  it('runs no handlers for an intent nobody has claimed', () => {
    const game = createTestGame('comms-no-hooks');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    const { message } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_ADVICE',
      targetId: player.id,
    });
    expect(message!.consequence.appliedHooks).toEqual([]);
    expect(applyConsequences(game.state, message!)).toBe(0);
  });
});

describe('communication: persistence', () => {
  it('survives a save and load with its messages, order and read state', () => {
    const game = createTestGame('comms-save');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Are we on for Sunday?' });
    markMessageRead(game.state, messagesOf(game.state, conversation.id)[0]!.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Assuming no news.' });

    const round = deserialiseGame(serialiseGame(game.state));
    expect(round.error).toBeNull();
    const loaded = round.state!;

    const restored = conversationOf(loaded, conversation.id) as Conversation;
    expect(restored.title).toBe(conversation.title);
    expect(restored.type).toBe('player');
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages.map((message) => message.body)).toEqual([
      'Are we on for Sunday?',
      'Assuming no news.',
    ]);
    expect(restored.messages.map((message) => message.sequence)).toEqual([1, 2]);
    expect(restored.unreadCount).toBe(1);
    expect(restored.messages[0]!.read).toBe(true);
    expect(restored.messages[1]!.read).toBe(false);
    expect(totalUnread(loaded)).toBe(1);
  });

  it('keeps a manager message\'s intent and its consequence record across a reload', () => {
    const game = createTestGame('comms-save-intent');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    const { message } = sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'WARN_PAYMENT',
      targetId: player.id,
      context: { amount: 15 },
    });
    resolveConsequence(game.state, message!.id, 'Treasurer told');

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    const restored = messagesOf(loaded, conversation.id).find((entry) => entry.id === message!.id)!;
    expect(restored.consequence.intent).toBe('WARN_PAYMENT');
    expect(restored.consequence.context.amount).toBe(15);
    expect(restored.consequence.outcome).toBe('Treasurer told');
  });

  it('carries conversations through the day without any extra work', () => {
    const game = createTestGame('comms-days');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'First.' });

    game.state.date = '2026-09-16';
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Second.' });

    expect(messagesOf(game.state, conversation.id).map((message) => message.timestamp)).toEqual([
      game.state.season.startDate,
      '2026-09-16',
    ]);
    expect(totalUnread(game.state)).toBe(2);
  });

  it('gives a save written before communication an empty inbox rather than inventing one', () => {
    const game = createTestGame('comms-migrate');
    const legacy = JSON.parse(serialiseGame(game.state)) as {
      version: number;
      state: Record<string, unknown>;
    };
    legacy.version = 9;
    delete legacy.state.communication;

    const loaded = deserialiseGame(JSON.stringify(legacy));
    expect(loaded.error).toBeNull();
    expect(loaded.state!.version).toBe(GAME_STATE_VERSION);
    expect(inbox(loaded.state!)).toHaveLength(0);
  });

  it('repairs a conversation whose people have gone while the save was away', () => {
    const game = createTestGame('comms-save-prune');
    const player = squadOf(game)[0]!;
    const conversation = threadWith(game.state, player.id);
    sendFromPerson(game.state, conversation.id, player.id, { body: 'Hello.' });

    const legacy = JSON.parse(serialiseGame(game.state)) as { state: { people: Record<string, unknown> } };
    delete legacy.state.people[player.id];

    const loaded = deserialiseGame(JSON.stringify(legacy)).state!;
    const restored = conversationOf(loaded, conversation.id)!;
    expect(restored.participantIds).toEqual([MANAGER_PERSON_ID]);
    // The message itself is kept: it was said.
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]!.body).toBe('Hello.');
  });
});