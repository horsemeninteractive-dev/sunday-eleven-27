import { describe, expect, it } from 'vitest';
import { MANAGER_PERSON_ID, PAYMENT_INTENTS } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import { isPlayer, type Player } from '@/domain/person';
import { defaultRoleFor } from '@/simulation/match/roles';
import { getRelationship } from '@/simulation/relationships';
import { collectPlayerSubs } from '@/simulation/finance';
import { addDays } from '@/simulation/calendar';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { createTestGame, type TestGame } from '../testSupport';
import {
  announceOverdueSubs,
  conversationCanSettleADebt,
  draftPaymentReply,
  PAYMENT_STANDING_LABEL,
  paymentDecisionsFor,
  paymentResponseOptions,
  paymentStandingFor,
  paymentSummaryFor,
  sendPaymentMessage,
} from './paymentComms';
import { findConversation, messagesOf } from './store';
import { playerResponseOptions, sendPlayerMessage } from './playerConversation';

/* --------------------------------------------------------------------- *
 * A man in debt.
 * --------------------------------------------------------------------- */

function squadOf(game: TestGame): Player[] {
  return game.state.clubs[game.clubId]!.squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

/**
 * Put a man in a known mood.
 *
 * A generated squad arrives with its own opinions, so a test that asserts a
 * particular answer has to say which mood it is asserting about rather than
 * hoping for one.
 */
function withTemperament(
  game: TestGame,
  index: number,
  attitude: Partial<{ friendship: number; trust: number; tension: number }>,
): Player {
  const player = squadOf(game)[index]!;
  const side = playerSideOf(game.state, player.id);
  if (attitude.friendship !== undefined) side.friendship = attitude.friendship;
  if (attitude.trust !== undefined) side.trust = attitude.trust;
  if (attitude.tension !== undefined) side.tension = attitude.tension;
  return player;
}

/**
 * Put a man into debt by hand, the way a settled subs book would.
 *
 * Takes a game and an index, or a player already chosen — so a test can pin a
 * player's mood first and then owe him money, which is nearly always the order
 * that makes the assertion mean something.
 */
function owing(target: TestGame | Player, index: number, weeks: number, subscription = 5): Player {
  const isPlayerTarget = 'kind' in target;
  const game = isPlayerTarget ? null : (target as TestGame);
  const player: Player = isPlayerTarget ? (target as Player) : squadOf(target as TestGame)[index]!;
  const today = game ? game.state.date : null;
  player.subs = { owed: weeks * subscription, missedWeeks: weeks, lastPaidOn: weeks > 0 ? null : today };
  return player;
}

/** Did this reply carry a promise? Read off the message, not out of thin air. */
function paymentResponsePromised(message: { context: Record<string, string | number> }): boolean {
  return message.context.promised === 'yes';
}

function balance(state: GameState): number {
  return state.clubs[state.userClubId]!.finances.balance;
}

function inbound(state: GameState, playerId: string): string[] {
  const conversation = findConversation(state, [playerId], { type: 'player' });
  if (!conversation) return [];
  return messagesOf(state, conversation.id)
    .filter((message) => message.direction === 'inbound')
    .map((message) => message.body);
}

/**
 * The *player's* own attitude toward the manager.
 *
 * The two sides of a relationship record are not symmetric, so which one a
 * conversation moves depends on who it names as the actor. Talking to a man
 * about his money moves this side.
 */
function playerSideOf(state: GameState, playerId: string) {
  const relationship = getRelationship(state, MANAGER_PERSON_ID, playerId);
  if (!relationship) throw new Error('no relationship for this player');
  return relationship.personAId === MANAGER_PERSON_ID ? relationship.bToA : relationship.aToB;
}

/* --------------------------------------------------------------------- */

describe('the subs book is per-player and per-match now', () => {
  it('books only the money that arrives, and never the debt', () => {
    const game = createTestGame('subs-book');
    const before = balance(game.state);
    owing(game, 0, 3, 5);
    // A man owing money is not income: the balance only ever holds money that
    // actually arrived, so an uncollected book changes nothing.
    expect(balance(game.state)).toBe(before);
  });

  it('applies a part payment to the oldest liability first', () => {
    const game = createTestGame('subs-part-payment');
    const player = squadOf(game)[0]!;
    player.subs = {
      owed: 8,
      missedWeeks: 2,
      lastPaidOn: null,
      liabilities: [
        { id: 'm1:p', matchId: 'm1', date: '2026-09-06', category: 'starter', amount: 5, paid: 0, paidOn: null },
        { id: 'm2:p', matchId: 'm2', date: '2026-09-13', category: 'substitute', amount: 3, paid: 0, paidOn: null },
      ],
    };
    const before = balance(game.state);

    const taken = collectPlayerSubs(game.state, game.clubId, player.id, game.state.date, 5);

    expect(taken).toBe(5);
    expect(player.subs.owed).toBe(3);
    expect(player.subs.missedWeeks).toBe(1);
    expect(player.subs.liabilities![0]!.paidOn).toBe(game.state.date);
    expect(player.subs.liabilities![1]!.paidOn).toBeNull();
    expect(balance(game.state)).toBe(before + 5);
  });

  it('clears a debt only when money genuinely arrives', () => {
    const game = createTestGame('subs-collect');
    const player = owing(game, 2, 3);
    const owed = player.subs.owed;
    const before = balance(game.state);

    const taken = collectPlayerSubs(game.state, game.clubId, player.id, game.state.date);

    expect(taken).toBe(owed);
    expect(player.subs.owed).toBe(0);
    expect(player.subs.missedWeeks).toBe(0);
    expect(player.subs.lastPaidOn).toBe(game.state.date);
    expect(balance(game.state)).toBe(before + owed);
    expect(
      game.state.clubs[game.clubId]!.finances.ledger.some((line) => line.category === 'subs' && line.amount === owed),
    ).toBe(true);
  });
});

/* --------------------------------------------------------------------- */

describe('a missed payment, then more', () => {
  it('reads a man one week behind as a week behind', () => {
    const game = createTestGame('standing-one');
    expect(paymentStandingFor(game.state, owing(game, 0, 1).id)).toBe('behind');
    expect(PAYMENT_STANDING_LABEL.behind).toBe('A week behind');
  });

  it('reads repeated missed payments as more than one', () => {
    const game = createTestGame('standing-many');
    expect(paymentStandingFor(game.state, owing(game, 0, 2).id)).toBe('well-behind');
    expect(paymentStandingFor(game.state, owing(game, 1, 5).id)).toBe('long-overdue');
  });

  it('says a man who pays nothing is not behind at all', () => {
    const game = createTestGame('standing-clear');
    const player = owing(game, 0, 0);
    expect(paymentStandingFor(game.state, player.id)).toBe('clear');
    expect(paymentSummaryFor(game.state, player.id)).toBe(PAYMENT_STANDING_LABEL.clear);
  });

  it('tells the manager when a man first falls behind, and when it gets worse', () => {
    const game = createTestGame('announce');
    const player = owing(game, 0, 1);

    const first = announceOverdueSubs(game.state, player.id);
    expect(first).not.toBeNull();
    expect(first!.context.standing).toBe('behind');

    // Three more weeks: a worse man, and a different message, because the
    // treasurer says something different the second time.
    player.subs = { owed: 15, missedWeeks: 4, lastPaidOn: null };
    const second = announceOverdueSubs(game.state, player.id);
    expect(second).not.toBeNull();
    expect(second!.context.standing).toBe('long-overdue');
    expect(inbound(game.state, player.id)).toHaveLength(2);
  });
});

/* --------------------------------------------------------------------- */

describe('the manager reminds him', () => {
  it('offers the reminder before anything else on a man who owes money', () => {
    const game = createTestGame('options');
    const player = owing(game, 0, 1);
    const first = playerResponseOptions(game.state, player.id)[0]!;
    expect(first.intent).toBe('REMIND_PAYMENT');
  });

  it('offers nothing about money to a man who is paid up', () => {
    const game = createTestGame('options-clear');
    const player = owing(game, 0, 0);
    const intents = playerResponseOptions(game.state, player.id).map((option) => option.intent);
    expect(PAYMENT_INTENTS.some((intent) => intents.includes(intent))).toBe(false);
  });

  it('does not offer a warning over a single missed week', () => {
    const game = createTestGame('no-early-warning');
    const player = owing(game, 0, 1);
    const intents = paymentResponseOptions(game.state, player.id).map((option) => option.intent);
    expect(intents).not.toContain('WARN_PAYMENT');
  });

  it('does not offer to discuss his circumstances over a single missed week', () => {
    const game = createTestGame('no-early-discuss');
    const player = owing(game, 0, 1);
    const intents = paymentResponseOptions(game.state, player.id).map((option) => option.intent);
    expect(intents).not.toContain('DISCUSS_PAYMENT');
  });

  it('offers the full escalation to a man well behind', () => {
    const game = createTestGame('full-escalation');
    const player = owing(game, 0, 5);
    const intents = paymentResponseOptions(game.state, player.id).map((option) => option.intent);
    expect(intents).toContain('REMIND_PAYMENT');
    expect(intents).toContain('ASK_PAYMENT');
    expect(intents).toContain('DISCUSS_PAYMENT');
    expect(intents).toContain('WARN_PAYMENT');
  });
});

/* --------------------------------------------------------------------- */

describe('what a man says about owing money', () => {
  it('apologies when he has simply let it slip', () => {
    const game = createTestGame('reply-apology');
    const player = owing(withTemperament(game, 0, { tension: 0, friendship: 45 }), 0, 1);
    const drafted = draftPaymentReply(game.state, player.id, 'REMIND_PAYMENT')!;
    expect(drafted.reply).toBe('apologetic');
  });

  it('explains himself when there is a lot of it', () => {
    const game = createTestGame('reply-struggling');
    // Calm about the manager, and a long way behind: he explains rather than
    // bristling, which is the whole difference the request asks for.
    const player = owing(withTemperament(game, 0, { tension: 0, friendship: 45 }), 0, 4);
    expect(draftPaymentReply(game.state, player.id, 'REMIND_PAYMENT')!.reply).toBe('struggling');
  });

  it('does not make everybody agree', () => {
    const game = createTestGame('reply-varies');
    // A manager who keeps going, with a man who does not rate him.
    const player = owing(withTemperament(game, 0, { tension: 50, friendship: 12 }), 0, 4);
    const drafted = draftPaymentReply(game.state, player.id, 'REMIND_PAYMENT')!;
    expect(drafted.reply).toBe('resentful');
    expect(drafted.body.toLowerCase()).toMatch(/treasurer|everyone|fine|say what/i);
  });

  it('is annoyed by a warning from a manager he does not much rate', () => {
    const game = createTestGame('reply-warned');
    const player = owing(withTemperament(game, 0, { tension: 30, friendship: 30 }), 0, 6);
    const drafted = draftPaymentReply(game.state, player.id, 'WARN_PAYMENT')!;
    expect(['resentful', 'annoyed']).toContain(drafted.reply);
  });

  it('talks about the debt he actually has', () => {
    const game = createTestGame('reply-context');
    const player = owing(game, 0, 3, 5);
    const drafted = draftPaymentReply(game.state, player.id, 'REMIND_PAYMENT')!;
    expect(drafted.context.owed).toBe(15);
    expect(drafted.context.missedWeeks).toBe(3);
  });

  it('writes the same words for the same career, day and man', () => {
    const a = createTestGame('reply-det');
    const b = createTestGame('reply-det');
    owing(a, 0, 2);
    owing(b, 0, 2);
    expect(draftPaymentReply(a.state, squadOf(a)[0]!.id, 'REMIND_PAYMENT')!.body).toBe(
      draftPaymentReply(b.state, squadOf(b)[0]!.id, 'REMIND_PAYMENT')!.body,
    );
  });

  it('uses no uncontrolled randomness', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/simulation/communication/paymentComms.ts', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('Math.random');
  });
});

/* --------------------------------------------------------------------- */

describe('a promise is not a payment', () => {
  it('records the promise and leaves the debt exactly where it was', () => {
    const game = createTestGame('promise');
    const player = owing(withTemperament(game, 0, { tension: 0, friendship: 45 }), 0, 3, 5);
    const owedBefore = player.subs.owed;
    const missedBefore = player.subs.missedWeeks;
    const balanceBefore = balance(game.state);

    const sent = sendPlayerMessage(game.state, player.id, 'REMIND_PAYMENT')!;

    expect(sent.reply).not.toBeNull();
    expect(sent.reply!.context.promised).toBe('yes');
    expect(player.subs.owed).toBe(owedBefore);
    expect(player.subs.missedWeeks).toBe(missedBefore);
    expect(balance(game.state)).toBe(balanceBefore);
  });

  it('does not record a promise from a man who only bristled', () => {
    const game = createTestGame('promise-none');
    const player = owing(withTemperament(game, 0, { tension: 50, friendship: 12 }), 0, 4);
    const sent = sendPlayerMessage(game.state, player.id, 'REMIND_PAYMENT')!;
    expect(paymentResponsePromised(sent.reply!)).toBe(false);
    expect(sent.reply!.context.promised).toBeUndefined();
  });

  it('still owes the money on Friday, promise or not', () => {
    const game = createTestGame('promise-friday');
    const player = owing(game, 0, 2, 5);
    sendPlayerMessage(game.state, player.id, 'ASK_PAYMENT');
    expect(player.subs.owed).toBe(10);

    game.state.date = addDays(game.state.date, 3);
    expect(player.subs.owed).toBe(10);
    expect(paymentStandingFor(game.state, player.id)).toBe('well-behind');
  });

  it('refuses, in as many words, to let a conversation settle a debt', () => {
    expect(conversationCanSettleADebt()).toBe(false);
  });
});

/* --------------------------------------------------------------------- */

describe('the manager warns him', () => {
  it('says plainly that it has to be sorted', () => {
    const game = createTestGame('warn');
    const player = owing(game, 0, 5);
    const sent = sendPaymentMessage(game.state, player.id, 'WARN_PAYMENT')!;
    expect(sent.message.consequence.intent).toBe('WARN_PAYMENT');
    // A warning that does not say how far behind he is is a threat, not a
    // warning, and the manager always knows the figure.
    expect(sent.message.body).toContain('25');
    expect(sent.message.body.toLowerCase()).toContain('last time');
    expect(player.subs.owed).toBe(25);
  });

  it('costs him goodwill with the manager', () => {
    const game = createTestGame('warn-tension');
    const player = owing(withTemperament(game, 0, { tension: 30, friendship: 30 }), 0, 6);
    const before = playerSideOf(game.state, player.id).tension;

    sendPlayerMessage(game.state, player.id, 'WARN_PAYMENT');

    expect(playerSideOf(game.state, player.id).tension).toBeGreaterThan(before);
  });
});

/* --------------------------------------------------------------------- */

describe('the relationship moves', () => {
  it('cools the relationship when a man bristles at being chased', () => {
    const game = createTestGame('rel-angry');
    const player = owing(withTemperament(game, 0, { tension: 50, friendship: 12 }), 0, 5);
    const playerTrustBefore = playerSideOf(game.state, player.id).trust;
    const playerTensionBefore = playerSideOf(game.state, player.id).tension;

    sendPlayerMessage(game.state, player.id, 'REMIND_PAYMENT');

    // The existing `manager-criticism` event moves trust and tension on the
    // player's own attitude toward the manager, which is the side that matters
    // here. Read explicitly rather than assumed, because the effect table's two
    // sides are not symmetric.
    expect(playerSideOf(game.state, player.id).trust).toBeLessThan(playerTrustBefore);
    expect(playerSideOf(game.state, player.id).tension).toBeGreaterThan(playerTensionBefore);
  });

  it('warms it very slightly when a man makes an excuse calmly', () => {
    const game = createTestGame('rel-calm');
    const player = owing(withTemperament(game, 0, { tension: 0, friendship: 45 }), 0, 1);
    const trustBefore = playerSideOf(game.state, player.id).trust;
    sendPlayerMessage(game.state, player.id, 'REMIND_PAYMENT');
    expect(playerSideOf(game.state, player.id).trust).toBeGreaterThan(trustBefore);
  });

  it('writes the conversation into the relationship history', () => {
    const game = createTestGame('rel-history');
    const player = owing(game, 0, 1);
    const relationship = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const historyBefore = relationship.history.length;
    sendPlayerMessage(game.state, player.id, 'REMIND_PAYMENT');
    expect(getRelationship(game.state, MANAGER_PERSON_ID, player.id)!.history.length).toBeGreaterThan(historyBefore);
  });
});

/* --------------------------------------------------------------------- */

describe('the manager decides, and selection is not decided for him', () => {
  it('offers the choices available at each level', () => {
    const game = createTestGame('decisions');
    const one = owing(game, 0, 1);
    expect(paymentDecisionsFor(game.state, one.id)).toEqual(['tolerate']);

    const six = owing(game, 1, 6);
    expect(paymentDecisionsFor(game.state, six.id)).toContain('warn');
    expect(paymentDecisionsFor(game.state, six.id)).toContain('restrict-selection');
  });

  it('offers nothing to a man who is paid up', () => {
    const game = createTestGame('decisions-clear');
    expect(paymentDecisionsFor(game.state, owing(game, 0, 0).id)).toEqual([]);
  });

  it('does not fail anybody, because the selection system has no financial input', async () => {
    const { validateLineup } = await import('@/simulation/selection');
    const game = createTestGame('decisions-selection');
    const player = owing(game, 0, 8);
    player.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };

    const slot = { position: 'CM' as const, playerId: player.id, role: defaultRoleFor('CM'), outOfPosition: false };
    const keeper = squadOf(game)[1]!;
    const problems = validateLineup(
      [slot],
      [{ position: 'GK' as const, playerId: keeper.id, role: defaultRoleFor('GK') }],
      (id) => {
        const person = game.state.people[id];
        return person && person.kind === 'player' ? person : undefined;
      },
    );

    // Eight weeks of nothing owed changes nothing about whether he may play:
    // `validateLineup` reads availability, fitness, position and duplicates, and
    // has never been told anything about money. That is the missing integration
    // point, and it is left missing rather than papered over with a second gate.
    expect(problems.some((problem) => /subs|owe|money|pay/i.test(problem.message))).toBe(false);
  });
});

/* --------------------------------------------------------------------- */

describe('the treasurer does not nag', () => {
  it('says once about a man who stays at the same level', () => {
    const game = createTestGame('nag');
    const player = owing(game, 0, 1);
    expect(announceOverdueSubs(game.state, player.id)).not.toBeNull();
    expect(announceOverdueSubs(game.state, player.id)).toBeNull();
    expect(announceOverdueSubs(game.state, player.id)).toBeNull();
    expect(inbound(game.state, player.id)).toHaveLength(1);
  });

  it('says nothing about a man who is paid up', () => {
    const game = createTestGame('nag-clear');
    const player = owing(game, 0, 0);
    expect(announceOverdueSubs(game.state, player.id)).toBeNull();
  });

  it('says nothing about another club’s man', () => {
    const game = createTestGame('nag-other');
    const other = Object.values(game.state.people).find(
      (person): person is Player => isPlayer(person) && person.clubId !== game.clubId,
    );
    if (!other) throw new Error('no rival player');
    other.subs = { owed: 20, missedWeeks: 4, lastPaidOn: null };
    expect(announceOverdueSubs(game.state, other.id)).toBeNull();
  });

  it('does not nag again after a reload, because the key travelled with the save', () => {
    const game = createTestGame('nag-reload');
    const player = owing(game, 0, 1);
    announceOverdueSubs(game.state, player.id);

    const loaded = deserialiseGame(serialiseGame(game.state));
    expect(loaded.state).not.toBeNull();
    expect(announceOverdueSubs(loaded.state!, player.id)).toBeNull();
    expect(inbound(loaded.state!, player.id)).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------- */

describe('it survives a save', () => {
  it('keeps the debt, the conversation and the promise across a reload', () => {
    const game = createTestGame('save-payment');
    const player = owing(game, 0, 3, 5);
    sendPlayerMessage(game.state, player.id, 'REMIND_PAYMENT');
    const conversation = findConversation(game.state, [player.id], { type: 'player' })!;
    const before = messagesOf(game.state, conversation.id);

    const loaded = deserialiseGame(serialiseGame(game.state));
    expect(loaded.state).not.toBeNull();
    const state = loaded.state!;

    expect((state.people[player.id] as Player).subs.owed).toBe(15);
    expect((state.people[player.id] as Player).subs.missedWeeks).toBe(3);
    expect(paymentStandingFor(state, player.id)).toBe('well-behind');
    const after = findConversation(state, [player.id], { type: 'player' })!;
    expect(messagesOf(state, after.id)).toEqual(before);
    // The promise is still a promise after a reload, and still not a payment.
    expect((state.people[player.id] as Player).subs.owed).toBe(15);
  });

  it('carries the debt across a week', () => {
    const game = createTestGame('save-week');
    const player = owing(game, 0, 2, 5);
    game.state.date = addDays(game.state.date, 7);
    const loaded = deserialiseGame(serialiseGame(game.state));
    expect((loaded.state!.people[player.id] as Player).subs.owed).toBe(10);
  });
});

/* --------------------------------------------------------------------- */

describe('the intents', () => {
  it('names the four money conversations the manager can have', () => {
    expect(PAYMENT_INTENTS).toEqual(['REMIND_PAYMENT', 'ASK_PAYMENT', 'WARN_PAYMENT', 'DISCUSS_PAYMENT']);
  });

  it('routes every one of them to the payment reply machinery', () => {
    const game = createTestGame('intent-route');
    const player = owing(game, 0, 5);
    for (const intent of PAYMENT_INTENTS) {
      const drafted = draftPaymentReply(game.state, player.id, intent);
      expect(drafted).not.toBeNull();
      // Never the availability rule: asking about money must not answer about
      // a knee.
      expect(drafted!.context.replyState).not.toBe('injured');
    }
  });
});