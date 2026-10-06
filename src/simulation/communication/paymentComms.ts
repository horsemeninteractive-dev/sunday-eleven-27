/**
 * The bridge between the subs book and conversation.
 *
 * The finance system owns the money and keeps owning it: the ledger says what
 * arrived, the balance says what is in the account, and `settleMatchdaySubs`
 * and `collectPlayerSubs` are the only things in the game that move either.
 * This module reads those facts and talks about them. It cannot move money,
 * cannot clear a liability, and cannot make a man who says "I'll pay Sunday"
 * paid — the promise lives on the message that carried it and nowhere else.
 *
 * The rules this file exists to keep:
 *
 *  - **Money is decided by finance.** Every function here takes the debt as
 *    given. Nothing writes `player.subs`.
 *  - **A promise is not a payment.** It is recorded as a promise, it moves the
 *    relationship a little, and the liability is still there afterwards.
 *  - **Not everybody agrees.** A man who is annoyed at being chased stays
 *    annoyed; he does not roll over. The reply is chosen from his circumstances
 *    and from how he already feels about the man asking.
 */

import {
  createEmptyConsequence,
  MANAGER_PERSON_ID,
  type CommunicationIntent,
  type Message,
  type ResponseOption,
} from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { applyRelationshipEvent, getRelationship } from '@/simulation/relationships';
import { stream } from '@/simulation/rng';
import { ensurePlayerSubs } from '@/simulation/finance';
import { deliveryContext, deliveryKey, hasDelivered } from './dedup';
import { appendMessage, findConversation, lastMessageOf } from './store';
import { sendFromManager, threadWith } from './system';

/* ------------------------------------------------------------------------ *
 * Where a man stands with the treasurer
 * ------------------------------------------------------------------------ */

/**
 * The four states of a subs account, in the treasurer's language.
 *
 * Derived from `owed` and `missedWeeks`, and stored nowhere: the record in the
 * player is the only copy, and this is a reading of it.
 */
export type PaymentStanding = 'clear' | 'behind' | 'well-behind' | 'long-overdue';

export const PAYMENT_STANDING_LABEL: Record<PaymentStanding, string> = {
  clear: 'Subs paid up',
  behind: 'A week behind',
  'well-behind': 'Several weeks behind',
  'long-overdue': 'Well behind',
};

export function paymentStandingFor(state: GameState, playerId: PersonId): PaymentStanding | null {
  const person = state.people[playerId];
  if (!person || !isPlayer(person)) return null;
  ensurePlayerSubs(person);
  if (person.subs.missedWeeks === 0) return 'clear';
  if (person.subs.missedWeeks === 1) return 'behind';
  if (person.subs.missedWeeks <= 3) return 'well-behind';
  return 'long-overdue';
}

/**
 * How much of this the manager has already been told.
 *
 * The four states are thresholds, and crossing one is the only thing worth a
 * message. A man who falls from three weeks behind to four is not news; a man
 * who crosses from "a week behind" to "several weeks behind" is, because that is
 * when a manager starts thinking about what to do about it.
 */
function crossedInto(standing: PaymentStanding): PaymentStanding | null {
  if (standing === 'behind') return 'behind';
  if (standing === 'well-behind') return 'well-behind';
  if (standing === 'long-overdue') return 'long-overdue';
  return null;
}

/* ------------------------------------------------------------------------ *
 * A promise, which is not a payment
 * ------------------------------------------------------------------------ */

/** The most recent thing a man said about paying, read off the thread. */
export function lastPaymentPromise(state: GameState, playerId: PersonId): Message | null {
  const conversation = findConversation(state, [playerId], { type: 'player' });
  if (!conversation) return null;
  const messages = [...conversation.messages].sort((a, b) => a.sequence - b.sequence);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.direction === 'inbound' && message.context.promised === 'yes') return message;
  }
  return null;
}

/** Has the man been chased since he last said he would pay? */
function promiseIsOutstanding(state: GameState, playerId: PersonId): boolean {
  const promise = lastPaymentPromise(state, playerId);
  if (!promise) return false;
  const conversation = findConversation(state, [playerId], { type: 'player' });
  if (!conversation) return false;
  const messages = [...conversation.messages].sort((a, b) => a.sequence - b.sequence);
  const index = messages.findIndex((message) => message.id === promise.id);
  return !messages.slice(index + 1).some((message) => message.direction === 'outbound');
}

/* ------------------------------------------------------------------------ *
 * The treasurer telling the manager
 * ------------------------------------------------------------------------ */

const OVERDUE_SAYING: Record<PaymentStanding, string[]> = {
  clear: [],
  behind: ['I am a bit behind with my subs, sorry. I will sort it.'],
  'well-behind': [
    'I owe you a few weeks, I know. I am working on it.',
    'Sorry, I am behind with the subs. I have not been ignoring you.',
  ],
  'long-overdue': [
    'I know what I owe, mate. I have not got it yet and I am not going to pretend otherwise.',
    'By rights you should have had that money months ago. I know.',
  ],
};

/**
 * The club telling the manager that a man is behind, once, and only once.
 *
 * Event-driven in the same way the availability announcements are: it fires
 * when a *threshold* is crossed rather than when a debt exists, and the key is
 * written on the message so a reloaded save or a twice-processed week finds it
 * already there. A man five weeks behind does not get a fifth reminder.
 *
 * Returns the message, or null when there was nothing new to say.
 */
export function announceOverdueSubs(state: GameState, playerId: PersonId): Message | null {
  const person = state.people[playerId];
  if (!person || !isPlayer(person)) return null;
  if (person.clubId !== state.userClubId) return null;

  const standing = paymentStandingFor(state, playerId);
  if (!standing) return null;
  const crossed = crossedInto(standing);
  if (!crossed) return null;

  // Once per threshold, across every thread — the shared rule in `dedup.ts`.
  const key = deliveryKey('subs', playerId, crossed);
  if (hasDelivered(state, key)) return null;

  const pool = OVERDUE_SAYING[crossed];
  const rng = stream(state.seed, 'subs-announcement', state.date, playerId, crossed);
  const body = pool[Math.floor(rng.next() * pool.length) % pool.length]!;

  const conversation = threadWith(state, playerId, 'player');
  const weeks = person.subs.missedWeeks;
  const message = appendMessage(state, conversation.id, {
    senderId: playerId,
    recipientIds: [MANAGER_PERSON_ID],
    body,
    type: 'notice',
    context: {
      ...deliveryContext(key),
      announced: 'subs',
      standing: crossed,
      owed: Math.round(person.subs.owed * 100) / 100,
      missedWeeks: weeks,
    },
    subject: { kind: 'player', id: playerId, label: `${person.firstName} ${person.surname}` },
    // Deliberately no selection consequence is offered here. What the manager
    // does about a man who owes money is a decision, and the thread offers the
    // conversation — not the verdict.
    responseOptions: paymentResponseOptions(state, playerId),
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, { owed: person.subs.owed }),
    read: false,
  });
  if (!message) return null;

  const last = lastMessageOf(state, conversation.id);
  if (last) last.responseOptions = paymentResponseOptions(state, playerId);
  return message;
}

/* ------------------------------------------------------------------------ *
 * What the manager can say about money
 * ------------------------------------------------------------------------ */

/**
 * The options for a man who owes money.
 *
 * Escalation is available but not forced: a manager behind by a week is offered
 * the friendly end of it and not the warning, because offering "this is the
 * last time I ask" to a man who missed one week is the screen making a
 * decision that is not its to make.
 */
export function paymentResponseOptions(state: GameState, playerId: PersonId): ResponseOption[] {
  const person = state.people[playerId];
  if (!person || !isPlayer(person)) return [];
  const targetId = playerId;
  const standing = paymentStandingFor(state, playerId) ?? 'clear';

  const options: ResponseOption[] = [];
  if (standing === 'clear') {
    options.push({ intent: 'GENERAL_CHECK_IN', label: 'Ask after him', targetId });
    return options;
  }

  options.push({ intent: 'REMIND_PAYMENT', label: 'Remind him about subs', targetId });
  options.push({ intent: 'ASK_PAYMENT', label: 'Ask him to sort it this week', targetId });
  // Only a man with a month of it behind him gets asked how he is managing,
  // and only a man well behind gets warned. Anything else would be the manager
  // scripted rather than choosing.
  if (standing === 'well-behind' || standing === 'long-overdue') {
    options.push({ intent: 'DISCUSS_PAYMENT', label: 'Ask how he is getting on', targetId });
  }
  if (standing === 'long-overdue') {
    options.push({ intent: 'WARN_PAYMENT', label: 'Warn him it has to be sorted', targetId });
  }
  return options;
}

/* ------------------------------------------------------------------------ *
 * What a man says about money
 * ------------------------------------------------------------------------ */

/**
 * How a man talks about owing money.
 *
 * The thing the design has to get right is that asking about a debt does not
 * make anybody agreeable. Three things decide this: whether he has been caught
 * out before, how he already feels about the man asking, and whether he is the
 * sort who means it when he says he will pay. Nobody is made to agree by being
 * asked — `resentful` is a perfectly reachable answer for a manager who chases
 * every week, and reaching it twice running is the point.
 */
export type PaymentReply = 'apologetic' | 'struggling' | 'annoyed' | 'resentful' | 'promising';

export interface PaymentContext {
  player: Player;
  owed: number;
  missedWeeks: number;
  standing: PaymentStanding;
  /** True when he has already broken a promise to pay. */
  brokenPromise: boolean;
  /** True when he has an unfulfilled promise on the go. */
  outstandingPromise: boolean;
  /** How he feels about the manager, read in the direction that matters. */
  friendship: number;
  trust: number;
  tension: number;
  loyalty: number;
}

export function paymentContext(state: GameState, playerId: PersonId): PaymentContext | null {
  const person = state.people[playerId];
  if (!person || !isPlayer(person)) return null;
  ensurePlayerSubs(person);
  // The *player's* own attitude toward the manager, not the manager's toward
  // him. That is the direction a conversation about owing money has to be read
  // in: what decides whether a man bristles is how he already feels about the
  // man asking, and it is the same side that `applyPaymentRelationship` moves.
  // Reading the other side here and moving this one would mean a man explained
  // himself because of something the manager thinks of him, which is not how
  // people work.
  const relationship = getRelationship(state, MANAGER_PERSON_ID, playerId);
  const towards = relationship
    ? relationship.personAId === MANAGER_PERSON_ID
      ? relationship.bToA
      : relationship.aToB
    : null;
  const standing = paymentStandingFor(state, playerId) ?? 'clear';
  const promise = lastPaymentPromise(state, playerId);

  return {
    player: person,
    owed: person.subs.owed,
    missedWeeks: person.subs.missedWeeks,
    standing,
    brokenPromise: Boolean(promise) && person.subs.lastPaidOn === null && person.subs.missedWeeks > 0,
    outstandingPromise: promiseIsOutstanding(state, playerId),
    friendship: towards?.friendship ?? 30,
    trust: towards?.trust ?? 45,
    tension: towards?.tension ?? 0,
    loyalty: towards?.loyalty ?? 40,
  };
}

/**
 * The state a reply is chosen by. This is the truth rule for money, exactly as
 * `replyStateFor` is for availability: the templates are grouped by what came
 * out of here, so the wording cannot contradict the circumstances.
 */
export function paymentReplyFor(context: PaymentContext, intent: CommunicationIntent): PaymentReply {
  const { player, missedWeeks, tension, friendship } = context;

  // A man who has already had a go at the manager about money will have another
  // go. Being chased twice has been shown not to work on him, and the honest
  // simulation of that is that it stops working in the other direction too.
  //
  // The thresholds are set against the world's own scale rather than an
  // imagined one: a generated squad starts its men at around 15 tension, so
  // "already had a go" has to mean substantially above that, not merely above
  // zero. A threshold that catches everybody catches nobody.
  if (tension >= 45 || friendship < 22) return 'resentful';
  // Being annoyed needs a reason, and the only reason worth having is the
  // manager. An older man with a month out is not bristling at the chasing — he
  // is explaining, and `struggling` is the truer answer. Annoyed is reserved for
  // a man who already had something against the man asking, which is also the
  // man who will say "why are you having a go at me".
  // Tension, not friendship. Everybody starts a career with a middling opinion
  // of everybody, so friendship cannot separate "annoyed" from "fine" — but
  // nobody starts with a grudge, so tension can.
  if (tension >= 28) return 'annoyed';

  // `DISCUSS_PAYMENT` is the manager asking about his life, not his debt, and
  // that is the one conversation where he is likely to say the truth about it.
  if (intent === 'DISCUSS_PAYMENT') {
    if (context.outstandingPromise || context.brokenPromise) return 'struggling';
    return missedWeeks >= 2 ? 'struggling' : 'apologetic';
  }

  if (intent === 'WARN_PAYMENT') {
    // A warning lands differently depending on the man. Some hear it; some
    // harden. That difference is the whole reason a warning is worth issuing.
    return tension >= 28 || friendship < 32 ? 'resentful' : 'promising';
  }

  if (missedWeeks >= 3) return 'struggling';
  if (player.attributes.behavioural.commitment >= 12) return 'promising';
  return 'apologetic';
}

const PAYMENT_VARIANTS: Record<PaymentReply, string[]> = {
  apologetic: [
    'Sorry mate, completely forgot. I will bring it Sunday.',
    'Completely slipped my mind, honestly. It is done.',
    'I know, I know. It is sorted from me this week.',
  ],
  struggling: [
    "Money's tight this month. Can I catch up next week?",
    'I am short this week, mate. Give me a fortnight and it is done.',
    'Work has been rough. I will get it to you as soon as I can.',
  ],
  annoyed: [
    "Why are you having a go at me? I've always paid.",
    'I know what I owe. I do not need telling like I am a child.',
    'I said I would pay. I am not going to be chased for it.',
  ],
  resentful: [
    'Are you the treasurer now? Put it in the book and leave it.',
    'Everyone got a go but me. Fine.',
    'Say what you like. I have heard it.',
  ],
  promising: [
    "You'll have it Sunday, I promise.",
    'Right, it is done. You will have it this week.',
    'Understood. It will be in before the weekend.',
  ],
};

/**
 * Write the reply.
 *
 * Returns the words, the state they were chosen by, and — importantly — whether
 * he promised to pay. A promise is carried on the message and is worth exactly
 * as much as it is: it changes the conversation and it does not change the
 * balance.
 */
export function draftPaymentReply(
  state: GameState,
  personId: PersonId,
  intent: CommunicationIntent,
): { body: string; reply: PaymentReply; promised: boolean; context: Record<string, string | number> } | null {
  const context = paymentContext(state, personId);
  if (!context) return null;
  const reply = paymentReplyFor(context, intent);

  const pool = PAYMENT_VARIANTS[reply];
  const rng = stream(state.seed, 'payment-reply', state.date, personId, intent, reply);
  const body = pool[Math.floor(rng.next() * pool.length) % pool.length]!;

  // Three of the six states are a promise to hand money over. The other three —
  // annoyed, resentful and a plain apology — are not, and recording them as one
  // would let the game treat a brush-off as an undertaking.
  const promised = reply === 'promising' || reply === 'struggling' || reply === 'apologetic';

  return {
    body,
    reply,
    promised,
    context: {
      replyState: reply,
      owed: Math.round(context.owed * 100) / 100,
      missedWeeks: context.missedWeeks,
      standing: context.standing,
      ...(promised ? { promised: 'yes' } : {}),
    },
  };
}

/* ------------------------------------------------------------------------ *
 * Sending, and what it costs
 * ------------------------------------------------------------------------ */

/**
 * What a conversation about money does to how the man feels.
 *
 * Through the existing relationship service and its own two events, at
 * intensities that reflect how the man answered rather than how much he owes: a
 * man who made an excuse is not owed the same warmth as one who paid on the
 * nail, and a man who bristled is not scored as though he were the problem.
 */
export function applyPaymentRelationship(
  state: GameState,
  personId: PersonId,
  reply: PaymentReply,
): string | null {
  const person = state.people[personId];
  if (!person || !isPlayer(person)) return null;
  const type = reply === 'resentful' || reply === 'annoyed' ? 'manager-criticism' : 'manager-praise';
  const intensity = reply === 'resentful' ? 0.4 : reply === 'annoyed' ? 0.3 : reply === 'struggling' ? 0.15 : 0.3;
  // The actor here is the **player**, not the manager, and that is a deliberate
  // difference from the praise-and-criticism conversations above.
  //
  // A word of thanks moves the manager's trust in the man he is praising, which
  // is the sensible reading of being nice to somebody. Going to a man about his
  // money is not: what it changes is how much the *player* trusts the manager
  // afterwards, and that is `aToB` when the player is the actor. Passing the
  // manager here — as the other conversations do — would have moved the
  // manager's own opinion of the player and left the player's untouched, which
  // is precisely backwards for a conversation about owing him money.
  const result = applyRelationshipEvent(state, {
    type,
    aId: personId,
    bId: MANAGER_PERSON_ID,
    intensity,
    detail: 'The manager went to him about his subs',
  });
  return result?.description ?? null;
}

/**
 * The manager's decision, recorded where it will be read.
 *
 * The game has no financial gate on selection: `validateLineup` reads
 * availability, fitness, position and duplicates, and has never been told a
 * thing about money. Rather than invent a second gate or quietly fail players,
 * this records what the manager chose and leaves the consequence to him — which
 * is where the existing design puts it.
 */
export type PaymentDecision = 'tolerate' | 'chase' | 'warn' | 'restrict-selection';

export const PAYMENT_DECISION_LABEL: Record<PaymentDecision, string> = {
  tolerate: 'Leave it for now',
  chase: 'Chase him again',
  warn: 'Warn him it has to be sorted',
  'restrict-selection': 'Keep an eye on his selection',
};

/** The decisions available to a man in this state. */
export function paymentDecisionsFor(state: GameState, playerId: PersonId): PaymentDecision[] {
  const standing = paymentStandingFor(state, playerId);
  if (!standing || standing === 'clear') return [];
  const decisions: PaymentDecision[] = ['tolerate'];
  if (promiseIsOutstanding(state, playerId)) decisions.push('chase');
  if (standing === 'well-behind' || standing === 'long-overdue') decisions.push('warn');
  // Offered as a decision the manager may take and record. The selection screen
  // has no financial input, so nothing acts on it automatically — see the note
  // in the integration report.
  if (standing === 'long-overdue') decisions.push('restrict-selection');
  return decisions;
}

/** True, and asserted by the tests: this layer cannot move money. */
export function conversationCanSettleADebt(): boolean {
  return false;
}

/** Re-exported so a screen can label a thread without reaching into the finance system. */
export function paymentSummaryFor(state: GameState, playerId: PersonId): string {
  const context = paymentContext(state, playerId);
  if (!context) return '';
  if (context.standing === 'clear') return PAYMENT_STANDING_LABEL.clear;
  const pounds = Math.round(context.owed);
  return `${PAYMENT_STANDING_LABEL[context.standing]} — £${pounds}`;
}

/* ------------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------------ */

/**
 * Write to a man about his money.
 *
 * Same shape as any other player message — thread, manager's line, reply,
 * relationship — with two differences that matter:
 *
 *  - the reply is the one drafted above, from his circumstances;
 *  - **nothing about the debt is touched.** A promise is written on the reply
 *    and nothing else, and the outstanding liabilities are exactly where the
 *    finance system left them.
 */
export function sendPaymentMessage(
  state: GameState,
  personId: PersonId,
  intent: CommunicationIntent,
): { message: Message; reply: Message | null; promised: boolean } | null {
  const person = state.people[personId];
  if (!person || !isPlayer(person)) return null;

  const conversationId = findConversation(state, [personId], { type: 'player' })?.id ?? threadWith(state, personId, 'player').id;

  const owedBefore = person.subs.owed;
  const sent = sendFromManager(state, {
    conversationId,
    intent,
    targetId: personId,
    context: { name: person.firstName, topic: person.surname, owed: Math.round(owedBefore) },
    // `deliver: false` because the answer must be the one drafted from his
    // circumstances below, not the generic reply the service would produce.
    deliver: false,
  });
  const message = sent.message;
  if (!message) return null;

  const drafted = draftPaymentReply(state, personId, intent);
  if (!drafted) return { message, reply: null, promised: false };

  message.consequence.resolvedOn = state.date;
  message.consequence.outcome = `Answered: ${drafted.reply}`;

  const reply = appendMessage(state, conversationId, {
    senderId: personId,
    recipientIds: [MANAGER_PERSON_ID],
    body: drafted.body,
    type: 'answer',
    context: drafted.context,
    subject: { kind: 'player', id: personId, label: `${person.firstName} ${person.surname}` },
    responseOptions: [],
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, {}),
    read: false,
  });

  // The promise is worth recording and worth nothing else. `player.subs` is
  // deliberately not touched anywhere in this function, and the test suite says
  // so out loud.
  if (reply) {
    reply.consequence.resolvedOn = state.date;
    reply.consequence.outcome = drafted.promised ? `Promised to pay (owed £${Math.round(owedBefore)})` : `Answered: ${drafted.reply}`;
  }

  const described = applyPaymentRelationship(state, personId, drafted.reply);
  if (described && reply) reply.consequence.appliedHooks.push('relationship');

  const last = lastMessageOf(state, conversationId);
  if (last) last.responseOptions = paymentResponseOptions(state, personId);

  return { message, reply, promised: drafted.promised };
}
