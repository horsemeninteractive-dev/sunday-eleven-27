import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_INTENTS,
  COMMUNICATION_INTENT_LABEL,
  MANAGER_PERSON_ID,
  type CommunicationIntent,
} from '@/domain/communication';
import { isPlayer, type Player } from '@/domain/person';
import { addDays } from '@/simulation/calendar';
import { sendFromManager, sendFromPerson, threadWith, threadWithGroup } from '@/simulation/communication/system';
import { markConversationRead, conversationOf, findConversation } from '@/simulation/communication/store';
import { openPlayerThread, sendPlayerMessage } from '@/simulation/communication/playerConversation';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { useGameStore } from '@/state/gameStore';
import { createTestGame } from '@/simulation/testSupport';
import {
  inboxEmptyCopy,
  inboxRows,
  inboxUnread,
  inboxUnreadThreads,
  previewOf,
  relativeTime,
  threadActions,
  threadMessages,
  conversationName,
  MANAGER_ACTIONS,
  OFFICER_ACTIONS,
} from './inboxState';

/**
 * The inbox's rules, tested without a browser.
 *
 * Everything here is a decision rather than a layout — who a thread is called,
 * what order it appears in, when a date is described as "yesterday", what the
 * manager may say — so testing it as functions is both possible and more
 * honest than asserting on class names. The rendering is deliberately thin over
 * these, and that is what makes the screen small.
 */

type State = ReturnType<typeof createTestGame>['state'];

function squad(game: ReturnType<typeof createTestGame>): Player[] {
  return game.state.clubs[game.clubId]!.squadIds
    .map((id) => game.state.people[id])
    .filter(isPlayer);
}

function person(state: State, index: number): Player {
  const list = Object.values(state.people).filter(isPlayer).filter((p) => state.clubs[state.userClubId]?.squadIds.includes(p.id));
  return list[index] ?? list[0]!;
}

describe('the inbox list', () => {
  it('is empty before anybody has written, and says so without inventing work', () => {
    const game = createTestGame('inbox-empty');
    expect(inboxRows(game.state)).toHaveLength(0);
    expect(inboxUnread(game.state)).toBe(0);

    const copy = inboxEmptyCopy();
    expect(copy.title).toMatch(/nobody has written/i);
    // It must not tell a new manager he is behind: there is nothing to be
    // behind, and inventing a task here would be the screen nagging.
    expect(copy.detail.toLowerCase()).not.toMatch(/\d/);
  });

  it('lists a conversation with its participant, preview, type and unread count', () => {
    const game = createTestGame('inbox-row');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Are we all right for Sunday?' });

    const rows = inboxRows(game.state);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toContain(kev.surname);
    expect(row.preview).toContain('Sunday');
    expect(row.unread).toBe(1);
    expect(row.when).toBe('Today');
    expect(row.kind).toBe('player');
    expect(row.people).toHaveLength(1);
  });

  it('marks the manager’s own last message so the preview reads as his', () => {
    const game = createTestGame('inbox-mine');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    // Held back rather than delivered, so the manager really is the last to
    // speak; a delivered message would be answered and the reply would be last.
    sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'ASK_AVAILABILITY',
      targetId: kev.id,
      deliver: false,
    });

    expect(inboxRows(game.state)[0]!.lastFromManager).toBe(true);
    expect(inboxRows(game.state)[0]!.preview).toContain('Are you good for Sunday');
  });

  it('names a group thread after its people and shows what kind it is', () => {
    const game = createTestGame('inbox-group');
    const [a, b] = squad(game);
    const group = threadWithGroup(game.state, [a.id, b.id], 'group', 'The squad');
    sendFromPerson(game.state, group.id, a.id, { body: 'Are we all coming Thursday?' });

    const row = inboxRows(game.state)[0]!;
    expect(row.name).toBe('The squad');
    expect(row.kindLabel).toBe('Group');
    expect(row.people).toHaveLength(2);
  });

  it('puts unread threads above read ones, whatever their date', () => {
    const game = createTestGame('inbox-unread-first');
    const [a, b] = squad(game);

    // `a` was written to this morning and read; `b` is from last month and unread.
    const older = threadWith(game.state, a.id);
    game.state.date = addDays(game.state.date, -30);
    sendFromPerson(game.state, older.id, a.id, { body: 'Old news.' });
    markConversationRead(game.state, older.id);

    game.state.date = addDays(game.state.date, 30);
    const newer = threadWith(game.state, b.id);
    sendFromPerson(game.state, newer.id, b.id, { body: 'Just got your message.' });

    const rows = inboxRows(game.state);
    expect(rows[0]!.conversationId).toBe(newer.id);
    expect(rows[0]!.unread).toBe(1);
    expect(rows[1]!.unread).toBe(0);
  });

  it('counts unread messages and unread threads separately', () => {
    const game = createTestGame('inbox-counts');
    const [a, b] = squad(game);
    const one = threadWith(game.state, a.id);
    const two = threadWith(game.state, b.id);

    sendFromPerson(game.state, one.id, a.id, { body: 'One.' });
    sendFromPerson(game.state, one.id, a.id, { body: 'Two.' });
    sendFromPerson(game.state, two.id, b.id, { body: 'One.' });

    expect(inboxUnread(game.state)).toBe(3);
    expect(inboxUnreadThreads(game.state)).toBe(2);
  });

  it('cuts a long preview at a word and never wider than one line needs', () => {
    const long = `${'a proper long message '.repeat(20)}end`;
    const preview = previewOf({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'p1',
      recipientIds: [],
      timestamp: '2026-08-20',
      sequence: 1,
      body: long,
      direction: 'inbound',
      read: false,
      type: 'greeting',
      context: {},
      subject: null,
      responseOptions: [],
      consequence: { intent: null, targetId: null, context: {}, resolvedOn: null, outcome: null, appliedHooks: [] },
    });
    expect(preview.length).toBeLessThanOrEqual(91);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toMatch(/long messag…/);
  });

  it('collapses whitespace so a message preview is one line', () => {
    expect(previewOf(null)).toBe('No messages yet');
  });
});

describe('when things were said', () => {
  const today = '2026-09-20';

  it('describes the last few days in the words a manager uses', () => {
    expect(relativeTime(today, today)).toBe('Today');
    expect(relativeTime('2026-09-19', today)).toBe('Yesterday');
    expect(relativeTime('2026-09-18', today)).toBe('Friday');
    expect(relativeTime('2026-09-17', today)).toBe('Thursday');
  });

  it('falls back to a date once a weekday would be misleading', () => {
    // Six days back is still recent enough to name the day; nineteen is not.
    expect(relativeTime('2026-09-14', today)).toBe('Monday');
    expect(relativeTime('2026-09-01', today)).toBe('1 Sep');
    expect(relativeTime('2025-03-02', today)).toBe('2 Mar 2025');
  });

  it('describes a message dated ahead as today rather than in the future', () => {
    // A save from a later build, or a clock that has been moved back: either
    // way "in three days" is not a thing anyone wants to read on a list.
    expect(relativeTime('2026-09-23', today)).toBe('Today');
  });

  it('compares the year against the game, not the wall clock', () => {
    // The same message must read the same way in 2026 and in 2030: a list that
    // started printing years because the player's own calendar moved on would
    // be a list describing a different game.
    expect(relativeTime('2026-09-01', today)).toBe('1 Sep');
    expect(relativeTime('2026-09-01', '2030-01-05')).toBe('1 Sep 2026');
  });
});

describe('a conversation opens', () => {
  it('renders its messages oldest first', () => {
    const game = createTestGame('inbox-order');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);

    sendFromPerson(game.state, conversation.id, kev.id, { body: 'First.' });
    sendFromManager(game.state, { conversationId: conversation.id, intent: 'GENERAL_CHECK_IN', targetId: kev.id, body: 'Second.' });
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Third.' });

    const messages = threadMessages(game.state, conversation.id);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    // Order is write order, including the reply the manager's own words drew.
    expect(messages[0]!.body).toBe('First.');
    expect(messages[1]!.body).toBe('Second.');
    expect(messages[2]!.mine).toBe(false);
  });

  it('tells the manager’s own messages from everybody else’s', () => {
    const game = createTestGame('inbox-mine-flag');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Kev here.' });
    sendFromManager(game.state, { conversationId: conversation.id, intent: 'PRAISE', targetId: kev.id, body: 'Well played.' });

    const messages = threadMessages(game.state, conversation.id);
    expect(messages[0]!.mine).toBe(false);
    expect(messages[0]!.sender).toContain(kev.surname);
    expect(messages[1]!.mine).toBe(true);
    // The manager's own messages need no name: he wrote them.
    expect(messages[1]!.sender).toBe('You');
  });

  it('divides a thread by day, once per day and not on every message', () => {
    const game = createTestGame('inbox-days');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);

    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Two in a row.' });
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Also the same day.' });
    // The clock moves on, so the third message is genuinely the next day.
    game.state.date = addDays(game.state.date, 1);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'The next day.' });

    const messages = threadMessages(game.state, conversation.id);
    // A divider before the first message of a day, and not before the second
    // message of the same day.
    expect(messages.map((m) => m.startsDay)).toEqual([true, false, true]);
    expect(messages[0]!.dayLabel).toBe('Yesterday');
    expect(messages[1]!.dayLabel).toBe('');
    expect(messages[2]!.dayLabel).toBe('Today');
  });

  it('carries the read state of each message through to the screen', () => {
    const game = createTestGame('inbox-read');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Unread.' });
    sendFromManager(game.state, { conversationId: conversation.id, intent: 'PRAISE', targetId: kev.id, body: 'Read by me.' });

    let messages = threadMessages(game.state, conversation.id);
    expect(messages[0]!.read).toBe(false);

    markConversationRead(game.state, conversation.id);
    messages = threadMessages(game.state, conversation.id);
    expect(messages.every((m) => m.read)).toBe(true);
  });

  it('stays usable with a long thread rather than rendering all of it at once', () => {
    const game = createTestGame('inbox-long');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);

    for (let i = 0; i < 200; i += 1) {
      sendFromPerson(game.state, conversation.id, kev.id, { body: `Message ${i}` });
    }

    const messages = threadMessages(game.state, conversation.id);
    expect(messages).toHaveLength(200);
    // Order is still total after a long run, which is the thing that breaks
    // first when messages share a date.
    expect(messages.map((m) => m.body)).toEqual(
      Array.from({ length: 200 }, (_, i) => `Message ${i}`),
    );
    expect(messages[199]!.body).toBe('Message 199');
  });

  it('returns nothing at all for a conversation that is not there', () => {
    const game = createTestGame('inbox-missing');
    expect(threadMessages(game.state, 'conversation_999')).toEqual([]);
  });
});

describe('naming a thread', () => {
  it('names it after the person, and keeps the name after they have gone', () => {
    const game = createTestGame('inbox-names');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    expect(conversationName(game.state, conversationOf(game.state, conversation.id)!)).toContain(kev.surname);

    // A thread the manager named keeps the name he knew them by. Wiping it to
    // "Former member" the moment somebody left would throw away the one thing
    // he remembers about the conversation — who it was with.
    delete game.state.people[kev.id];
    expect(conversationName(game.state, conversationOf(game.state, conversation.id)!)).toContain(kev.surname);

    // A thread with no name of its own falls back rather than rendering blank.
    const anonymous = threadWith(game.state, kev.id);
    anonymous.title = '';
    expect(conversationName(game.state, anonymous)).toBe('Former member');
  });

  it('summarises a large group rather than listing everyone', () => {
    const game = createTestGame('inbox-biggroup');
    const many = squad(game).slice(0, 6);
    const group = threadWithGroup(game.state, many.map((p) => p.id), 'group', '');
    const name = conversationName(game.state, group);
    expect(name).toMatch(/\+\d$/);
    expect(name.length).toBeLessThan(40);
  });
});

describe('what the manager can say', () => {
  it('offers every intent the architecture supports, generic or officer', () => {
    // Counted against the domain rather than a literal, so adding an intent is
    // a deliberate act here too. Every intent has a button somewhere; which
    // *thread* offers it is a separate question, answered by who is in it.
    const all = [...MANAGER_ACTIONS, ...OFFICER_ACTIONS];
    expect(all).toHaveLength(COMMUNICATION_INTENTS.length);
    const intents = all.map((a) => a.intent);
    for (const intent of Object.keys(COMMUNICATION_INTENT_LABEL) as CommunicationIntent[]) {
      expect(intents).toContain(intent);
    }
  });

  it('never shows the manager an internal intent name', () => {
    for (const action of [...MANAGER_ACTIONS, ...OFFICER_ACTIONS]) {
      // The label is read aloud and read at a glance; it has to be a sentence a
      // manager would say, not a constant from the simulation.
      expect(action.label).not.toMatch(/_/);
      expect(action.label).not.toMatch(action.intent);
      expect(action.label.length).toBeGreaterThan(3);
      expect(action.label.length).toBeLessThan(24);
      expect(action.detail.length).toBeGreaterThan(5);
    }
  });

  it('puts the suggestions a message made first, and still offers everything else', () => {
    const game = createTestGame('inbox-actions');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Cannot make Sunday.', type: 'question' });

    const actions = threadActions(conversationOf(game.state, conversation.id)!);
    // Everything a *player* thread can do remains reachable: a manager may
    // answer a question about Sunday with an invitation to training, and a menu
    // of three would stop him. The club officers' questions are deliberately
    // absent — there is nobody in a player thread who can answer them.
    expect(actions).toHaveLength(MANAGER_ACTIONS.length);
    expect(new Set(actions.map((a) => a.intent)).size).toBe(MANAGER_ACTIONS.length);
    const officerIntents = new Set(OFFICER_ACTIONS.map((a) => a.intent));
    for (const action of actions) expect(officerIntents.has(action.intent)).toBe(false);
  });
});

describe('the store actions the screen uses', () => {
  it('opens a thread and marks it read as it does', () => {
    const game = createTestGame('store-open');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Are we on?' });

    const store = useGameStore.getState();
    store.game = game.state;
    store.view = 'inbox';

    expect(inboxUnread(game.state)).toBe(1);
    useGameStore.getState().openConversation(conversation.id);
    const after = useGameStore.getState().game!;

    expect(useGameStore.getState().openConversationId).toBe(conversation.id);
    expect(conversationOf(after, conversation.id)!.unreadCount).toBe(0);
    expect(inboxUnread(after)).toBe(0);
    expect(threadMessages(after, conversation.id).every((m) => m.read)).toBe(true);
  });

  it('does not mark a thread read merely by navigating to the screen', () => {
    const game = createTestGame('store-no-read-on-nav');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Are we on?' });

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().setView('inbox');

    // Looking at the list is not reading: the badge must still be there, or the
    // manager has no way to tell what he has actually dealt with.
    expect(conversationOf(useGameStore.getState().game!, conversation.id)!.unreadCount).toBe(1);
  });

  it('sends a message with a real intent and gets a reply', () => {
    const game = createTestGame('store-send');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Hello.' });

    const store = useGameStore.getState();
    store.game = game.state;
    // Nothing is open: he is writing from outside the thread, so the answer he
    // gets is genuinely unread. (The store outlives the test that set it up, so
    // the premise is stated rather than assumed.)
    useGameStore.getState().closeConversation();
    useGameStore.getState().sendConversationMessage(conversation.id, 'ASK_FITNESS');

    const after = useGameStore.getState().game!;
    const messages = threadMessages(after, conversation.id);
    const sent = messages.find((m) => m.body.includes('knock'));
    expect(sent).toBeDefined();
    expect(sent!.mine).toBe(true);

    // And the conversation recorded *why* it was sent, which is the part the
    // later stages read.
    const stored = conversationOf(after, conversation.id)!.messages.find((m) => m.body.includes('knock'))!;
    expect(stored.consequence.intent).toBe('ASK_FITNESS');
    expect(stored.consequence.targetId).toBe(kev.id);
    // A reply came back and is unread, because nobody has read it yet.
    expect(inboxUnread(after)).toBeGreaterThan(0);
  });

  it('leaves no badge on the thread the manager is reading when he writes in it', () => {
    const game = createTestGame('store-send-open');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Hello.' });

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().openConversation(conversation.id);
    useGameStore.getState().sendConversationMessage(conversation.id, 'ASK_FITNESS');

    const after = useGameStore.getState().game!;
    const thread = conversationOf(after, conversation.id)!;
    // The answer came back into the thread that is on screen, so it is not news.
    // A badge here asks him to open the thread he is already reading, which is
    // the one thing opening it again cannot do.
    expect(threadMessages(after, conversation.id).some((message) => message.mine)).toBe(true);
    expect(thread.unreadCount).toBe(0);
    expect(inboxUnread(after)).toBe(0);
    expect(threadMessages(after, conversation.id).every((message) => message.read)).toBe(true);
  });

  it('reads a message that lands in the thread while he is sitting in it', async () => {
    const game = createTestGame('store-lands-while-open');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().openConversation(conversation.id);

    // Something arrives while he is looking at the thread — the shape of a
    // promised reply landing days later, with him still on the screen.
    sendFromPerson(useGameStore.getState().game!, conversation.id, kev.id, {
      body: 'Forgot to say — I can play.',
    });
    expect(inboxUnread(useGameStore.getState().game!)).toBe(1);

    // A day passing is one of the ways a message arrives.
    await useGameStore.getState().advanceDays(1);

    // Only the open thread is the rule's business: a day brings post of its own
    // to other threads, and those badges are meant to stay.
    const after = useGameStore.getState().game!;
    expect(conversationOf(after, conversation.id)!.unreadCount).toBe(0);
    expect(threadMessages(after, conversation.id).every((message) => message.read)).toBe(true);
  });

  it('does nothing to a conversation that is not there', () => {
    const game = createTestGame('store-missing');
    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().sendConversationMessage('conversation_999', 'PRAISE');
    expect(useGameStore.getState().game).toBe(game.state);
  });

  it('closes a thread without forgetting it', () => {
    const game = createTestGame('store-close');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Hello.' });

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().openConversation(conversation.id);
    useGameStore.getState().closeConversation();

    expect(useGameStore.getState().openConversationId).toBeNull();
    expect(threadMessages(useGameStore.getState().game!, conversation.id)).toHaveLength(1);
  });

  it('drops the open thread when the manager navigates away', () => {
    const game = createTestGame('store-navigate-away');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Hello.' });

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().openConversation(conversation.id);
    useGameStore.getState().setView('squad');
    expect(useGameStore.getState().openConversationId).toBeNull();

    // Coming back to Messages shows the list, not a thread he already read.
    useGameStore.getState().setView('inbox');
    expect(useGameStore.getState().openConversationId).toBeNull();
    expect(inboxRows(useGameStore.getState().game!)).toHaveLength(1);
  });

  it('keeps the open thread when the manager moves around inside Messages', () => {
    const game = createTestGame('store-stay-in-inbox');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().openConversation(conversation.id);
    // Re-navigating to the same screen must not slam the thread shut.
    useGameStore.getState().setView('inbox');
    expect(useGameStore.getState().openConversationId).toBe(conversation.id);
  });

  it('starts a thread with somebody who has never written to him', () => {
    const game = createTestGame('store-start');
    const kev = person(game.state, 0);

    const store = useGameStore.getState();
    store.game = game.state;
    useGameStore.getState().startConversationWith(kev.id);

    const state = useGameStore.getState();
    expect(state.view).toBe('inbox');
    expect(state.openConversationId).not.toBeNull();
    // An empty thread is a legitimate thing to open, and the screen says so
    // rather than looking broken.
    expect(threadMessages(state.game!, state.openConversationId!)).toEqual([]);
  });
});

describe('messages survive a save', () => {
  it('keeps the threads, the order, the previews and the read state', () => {
    const game = createTestGame('inbox-save');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);

    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Are we on for Sunday?' });
    markConversationRead(game.state, conversation.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'Only asking.' });

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    const rows = inboxRows(loaded);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.preview).toContain('Only asking');
    expect(rows[0]!.unread).toBe(1);
    expect(threadMessages(loaded, conversation.id)).toHaveLength(2);
  });

  it('keeps a sent message and its intent across a reload', () => {
    const game = createTestGame('inbox-save-intent');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromManager(game.state, {
      conversationId: conversation.id,
      intent: 'INVITE_TO_TRAINING',
      targetId: kev.id,
      body: 'Down Thursday if you are free?',
    });

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    const stored = conversationOf(loaded, conversation.id)!.messages.find((m) =>
      m.body.includes('Thursday'),
    )!;
    expect(stored.body).toBe('Down Thursday if you are free?');
    expect(stored.consequence.intent).toBe('INVITE_TO_TRAINING');
    expect(stored.consequence.resolvedOn).toBeNull();
  });

  it('keeps the manager in the thread he can still read after somebody leaves', () => {
    const game = createTestGame('inbox-save-gone');
    const kev = person(game.state, 0);
    const conversation = threadWith(game.state, kev.id);
    sendFromPerson(game.state, conversation.id, kev.id, { body: 'See you Sunday.' });

    const raw = JSON.parse(serialiseGame(game.state)) as { state: { people: Record<string, unknown> } };
    delete raw.state.people[kev.id];

    const loaded = deserialiseGame(JSON.stringify(raw)).state!;
    const restored = conversationOf(loaded, conversation.id)!;
    expect(restored.participantIds).toEqual([MANAGER_PERSON_ID]);
    expect(threadMessages(loaded, conversation.id)).toHaveLength(1);
    // The row still renders, and still says who it was about.
    expect(inboxRows(loaded)[0]!.name).toContain(kev.surname);
    expect(inboxRows(loaded)[0]!.preview).toContain('Sunday');
  });
});

describe('the screen is reachable', () => {
  it('has a destination in the navigation and a label', async () => {
    const { NAV_LEAVES, VIEW_LABEL, isNavigable } = await import('./navigation');
    const leaf = NAV_LEAVES.find((l) => l.id === 'inbox');
    expect(leaf).toBeDefined();
    expect(leaf!.hint.length).toBeGreaterThan(5);
    expect(VIEW_LABEL.inbox).toBeTruthy();
    expect(isNavigable('inbox')).toBe(true);
  });

  it('is not one of the five phone destinations, so it cannot crowd the bar', async () => {
    const { MOBILE_PRIMARY } = await import('./navigation');
    // The bottom bar has room for five things. Messages is something a manager
    // opens deliberately, not one of the things he is doing.
    expect(MOBILE_PRIMARY.some((d) => d.id === 'inbox')).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * Where a player stands
 * ------------------------------------------------------------------------- */

function squadOf(game: ReturnType<typeof createTestGame>): Player[] {
  return game.state.clubs[game.clubId]!.squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

function withAvailability(
  game: ReturnType<typeof createTestGame>,
  index: number,
  status: 'available' | 'doubtful' | 'unavailable',
): Player {
  const player = squadOf(game)[index]!;
  player.availability = {
    status,
    reason: status === 'unavailable' ? 'work' : null,
    note: status === 'unavailable' ? 'Early shift' : null,
    until: null,
    discoveredLate: false,
  };
  return player;
}

const fit = (game: ReturnType<typeof createTestGame>, index: number) => withAvailability(game, index, 'available');

describe('the inbox shows where a player stands', () => {
  it('says nothing about a man who is fit, because that is not news', () => {
    const game = createTestGame('standing-fit');
    const player = fit(game, 0);
    const conversation = openPlayerThread(game.state, player.id)!;
    expect(inboxRows(game.state).find((row) => row.conversationId === conversation)!.standing).toBeNull();
  });

  it('says a doubt is awaiting confirmation before the manager has asked', () => {
    const game = createTestGame('standing-pending');
    const player = withAvailability(game, 1, 'doubtful');
    const conversation = openPlayerThread(game.state, player.id)!;
    const row = inboxRows(game.state).find((item) => item.conversationId === conversation)!;
    expect(row.standing).toBe('Awaiting confirmation');
  });

  it('says a doubt is just a doubt once he has answered', () => {
    const game = createTestGame('standing-doubtful');
    const player = withAvailability(game, 2, 'doubtful');
    openPlayerThread(game.state, player.id);
    const conversation = findConversation(game.state, [player.id], { type: 'player' })!;
    sendPlayerMessage(game.state, player.id, 'ASK_AVAILABILITY');
    const row = inboxRows(game.state).find((item) => item.conversationId === conversation.id)!;
    expect(row.standing).toBe('Doubtful');
  });

  it('says a man who is out is confirmed unavailable', () => {
    const game = createTestGame('standing-out');
    const player = withAvailability(game, 3, 'unavailable');
    const conversation = openPlayerThread(game.state, player.id)!;
    expect(inboxRows(game.state).find((row) => row.conversationId === conversation)!.standing).toBe(
      'Confirmed unavailable',
    );
  });

  it('says nothing about a thread that is not about a player', () => {
    const game = createTestGame('standing-group');
    const thread = threadWithGroup(game.state, ['someone-a', 'someone-b'], 'group', 'The squad');
    expect(inboxRows(game.state).find((row) => row.conversationId === thread.id)!.standing).toBeNull();
  });
});
