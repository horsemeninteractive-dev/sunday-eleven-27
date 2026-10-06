import type { GameState } from '@/domain/game';
import {
  COMMUNICATION_INTENT_LABEL,
  createEmptyConsequence,
  MANAGER_PERSON_ID,
  type CommunicationIntent,
  type ConversationSubject,
  type MessageType,
  type ResponseOption,
} from '@/domain/communication';
import { isOfficial, isPlayer, type Person } from '@/domain/person';
import { getRelationship } from '../relationships';
import { stream, type Rng } from '../rng';

/**
 * How somebody answers.
 *
 * This is the *minimum* response architecture, not the finished one. It answers
 * from the five things a real answer comes from — personality, the relationship
 * with the manager, their role, their circumstances and the intent they were
 * sent — and it does so deterministically, drawing every choice from a named
 * stream off the world seed rather than from `Math.random`. The same career, on
 * the same day, with the same message, produces the same words.
 *
 * What it deliberately does *not* do is decide consequences. A reply says what
 * the man would say; whether that moves an availability, a relationship or a
 * bank balance is the business of a later stage reading the message's intent.
 * Keeping those two apart is what stops a conversation from quietly becoming
 * the only place game rules live.
 */

/** The circumstances a reply is written under, gathered once and passed on. */
export interface ResponseCircumstances {
  person: Person | null;
  /** How they feel about the manager, where the two have a relationship. */
  respect: number;
  trust: number;
  tension: number;
  friendship: number;
  loyalty: number;
  /** True when the world holds no relationship record for the pair at all. */
  stranger: boolean;
  /** Where they are at the club, in words: "player", "chairman". */
  roleLabel: string;
  /** Deterministic generator for this specific reply. */
  rng: Rng;
}

export interface ResponseDraft {
  body: string;
  type: MessageType;
  context: Record<string, string | number>;
  responseOptions: ResponseOption[];
}

/**
 * The words a person uses, by how they are.
 *
 * Three registers, chosen from personality and warmth, and no more: Sunday
 * League conversations are short and mostly plain. This is a template table
 * keyed by register, not a dialogue tree — every entry here is interchangeable
 * with every other in its row, and adding a row costs nothing.
 */
const REGISTERS = {
  /** Talks a lot, says what he means at length. */
  talkative: {
    ASK_AVAILABILITY: [
      'Manager, no trouble at all for Sunday, I will be there. It is the Wednesday I am in work until six.',
      'That is grand of you to ask. I am straight on, no problems at all.',
      'Sunday is easy. Give me a ring if anything changes.',
    ],
    ASK_FITNESS: [
      'Leg is still not right, honestly, but I can manage an hour and I will not let you down.',
      'I am about eighty per cent. Give it another week and I will be back properly.',
      'Fit enough. It is nothing serious, I just need to be careful.',
    ],
    REMIND_PAYMENT: [
      'Sorry about that, I have had a bad month. Can I bring it to you on Sunday and sort it there?',
      'Right you are, I know I am behind. I will get it to you before the weekend.',
      'I have been waiting on work coming through. It will be with you this week.',
    ],
    WARN_PAYMENT: [
      'I know, I know. I am not trying to avoid you, it is just been a hard few weeks.',
      'Fair enough. I will sort something out this week, I do want to keep playing.',
      'That is the last I can stretch it to, I am afraid.',
    ],
    PRAISE: ['That means a lot coming from you, honestly.', 'Appreciate that, manager.', 'Good of you to say so.'],
    CRITICISE: [
      'I know I was poor, I have been thinking about it since Saturday.',
      'Fair enough, I know I let you down.',
      'Noted. I will do better.',
    ],
    INVITE_TO_TRAINING: ['Count me in, I will be there.', 'Yes, definitely.', 'I will be down Thursday, no problem.'],
    INVITE_TO_TRIAL: ['When do you want me down?', 'Happy to come and have a go.', 'Yes, I am interested.'],
    OFFER_ROLE: ['I would be honoured, honestly.', 'I will have a think about it tonight.', 'That is a good offer, thank you.'],
    ASK_ADVICE: [
      'Well, if it was me I would go for the safe option and keep the dressing room with you.',
      'Honestly? I would do what you think is right. You know the club better than me.',
    ],
    GENERAL_CHECK_IN: ['Not bad, you know how it is.', 'All good, thanks for asking.'],
    // A player thread reaches this file only for the generic manager-to-person
    // replies. The fuller, state-derived player answers are written by
    // `playerConversation.ts`, which reads the player's own record.
    CHECK_IN: ['Not bad, you know how it is.', 'Fine. Ask me again after the weekend.'],
    DISCUSS_SELECTION: ['Right. I will be there.', 'I see. Right you are.'],
    ASK_CONFIRMATION: ['I am still in. I will let you know for definite.', 'I think so, but not certain yet.'],
    ASK_UPDATE: ['No change, I am afraid.', 'Same as I said. I will know more tomorrow.'],
    ASK_PAYMENT: ['It is done, I will drop it in.', 'Sorry, I will get it to you this week.'],
    DISCUSS_PAYMENT: ['It is hard at the moment but I am working on it.', 'I appreciate you asking, honestly.'],
    // The club officers' fallback lines. The organisation bridge writes the
    // real, state-derived answers; these exist so the vocabulary is complete
    // and so a generic reply is never nothing at all.
    ASK_FINANCES: ['I will talk you through the book, no problem.'],
    ASK_ARREARS: ['There is money outstanding, I can tell you who.'],
    ASK_BILLS: ['I have the invoices here, let me look.'],
    ASK_AFFORD: ['Give me a minute and I will tell you honestly.'],
    ASK_TAKINGS: ['The gate was not bad, all told.'],
    ASK_LEAGUE_NEWS: ['There is a letter from the league, yes.'],
    ASK_FA: ['The county have written, I will read it to you.'],
    ASK_AGM: ['It is in the diary, do not worry.'],
    ASK_FIXTURE_STATUS: ['That one is confirmed as far as I know.'],
    ASK_EXPECTATIONS: ['I will tell you what I am looking for this year.'],
    ASK_SUPPORT: ['Let me have a think about that.'],
    EXPLAIN_DECISION: ['I hear you. Go on.'],
    DISCUSS_CLUB: ['Always time for a word about the club.'],
    DISCUSS_FINANCES: ['The money, is it? Go on, then.'],
    ASK_SPONSOR: ['They have been on to me, as it happens.'],
  },
  /** Quiet, short, and does not volunteer anything. */
  quiet: {
    ASK_AVAILABILITY: ['Yes. Sunday.', 'I should be there.', 'Cannot make it, sorry.'],
    ASK_FITNESS: ['Fine.', 'Not right, sorry.', 'Getting there.'],
    REMIND_PAYMENT: ['I know. Sorry.', 'I will sort it.', 'Give me a few days.'],
    WARN_PAYMENT: ['Understood.', 'I did not mean to cause trouble.', 'Right. I will find it.'],
    PRAISE: ['Thanks.', 'Appreciate it.', 'Good.'],
    CRITICISE: ['Right.', 'I know.', 'That is fair.'],
    INVITE_TO_TRAINING: ['I will be there.', 'Yes.', 'Okay.'],
    INVITE_TO_TRIAL: ['When?', 'Okay, yes.', 'Happy to.'],
    OFFER_ROLE: ['I will think about it.', 'Noted.', 'Thank you.'],
    ASK_ADVICE: ['Your call.', 'I do not know, honestly.', 'Whatever you think.'],
    GENERAL_CHECK_IN: ['Fine.', 'Yes.', 'No complaints.'],
    CHECK_IN: ['Fine.', 'Yes.'],
    DISCUSS_SELECTION: ['Right.', 'I see.'],
    ASK_CONFIRMATION: ['Probably.', 'I will know Saturday.'],
    ASK_UPDATE: ['No change.', 'Same.'],
    ASK_PAYMENT: ['I know. I will sort it.', 'Give me a few days.'],
    DISCUSS_PAYMENT: ['It is what it is. I will get there.'],
    ASK_FINANCES: ['It is what it is.'],
    ASK_ARREARS: ['A couple still owe, yes.'],
    ASK_BILLS: ['Paid, as far as I know.'],
    ASK_AFFORD: ['Not really.'],
    ASK_TAKINGS: ['Enough to cover it.'],
    ASK_LEAGUE_NEWS: ['Nothing much.'],
    ASK_FA: ['Not yet.'],
    ASK_AGM: ['End of the season.'],
    ASK_FIXTURE_STATUS: ['It is on.'],
    ASK_EXPECTATIONS: ['Mid-table will do.'],
    ASK_SUPPORT: ['We will see.'],
    EXPLAIN_DECISION: ['Right.'],
    DISCUSS_CLUB: ['Go on then.'],
    DISCUSS_FINANCES: ['It is not free, running a club.'],
    ASK_SPONSOR: ['They are still with us.'],
  },
  /** Warm and easy, but not chirpy. */
  warm: {
    ASK_AVAILABILITY: ['No problem at all, I will be down.', 'That is fine by me, thanks for checking.', 'I am on for Sunday, yes.'],
    ASK_FITNESS: ['I am coming along nicely now, thanks for asking.', 'Still a niggle but nothing serious.', 'Fine, thanks.'],
    REMIND_PAYMENT: ['You are quite right, apologies to you and the treasurer.', 'Guilty as charged, I will have it to you.', 'It has been a month of it. Sorry.'],
    WARN_PAYMENT: [
      'I did not want it to come to this, honestly.',
      'That is the last time. I will have it to you this week.',
    ],
    PRAISE: ['That means a lot, that does.', 'Kind of you, manager.', 'Thank you for saying so.'],
    CRITICISE: ['You are right, I was poor.', 'I have been kicking myself about it.', 'Understood, my mistake.'],
    INVITE_TO_TRAINING: ['I will be there, thanks for asking.', 'Delighted.', 'Count me in.'],
    INVITE_TO_TRIAL: ['I would love a chance.', 'Yes, when would you like me?', 'Definitely interested.'],
    OFFER_ROLE: ['I would love to, genuinely.', 'Thank you for thinking of me.', 'That is made my week, that is.'],
    ASK_ADVICE: [
      'I would talk to the chairman first, if it was me. He is reasonable if you go to him straight.',
      'Honestly I would do what keeps the club calm. Nobody wants a fuss.',
    ],
    GENERAL_CHECK_IN: ['Good, thanks for asking.', 'Not too bad, you know how it is down here.'],
    CHECK_IN: ['Good, thanks for asking.', 'Not too bad, you know how it is down here.'],
    DISCUSS_SELECTION: ['Thanks for telling me.', 'Good, I will be there then.'],
    ASK_CONFIRMATION: ['I am fairly sure, yes. I will confirm either way.', 'Should be fine. I will let you know.'],
    ASK_UPDATE: ['No change yet, sorry.', 'Still the same. Nothing new.'],
    ASK_PAYMENT: ['You will have it before the weekend, I promise.', 'Fair play, it had slipped my mind. It is done.'],
    DISCUSS_PAYMENT: ['Work has been difficult but I am not asking to be let off.', 'Thank you for asking rather than just demanding.'],
    ASK_FINANCES: ['I will give it to you straight, as always.'],
    ASK_ARREARS: ['There are one or two outstanding, but it is owed, not banked.'],
    ASK_BILLS: ['The bills are looked after, do not worry about that.'],
    ASK_AFFORD: ['I would want to look at the book first, honestly.'],
    ASK_TAKINGS: ['It was a decent Sunday, all things considered.'],
    ASK_LEAGUE_NEWS: ['I have the league post here somewhere.'],
    ASK_FA: ['The county are usually slow, but I will chase them.'],
    ASK_AGM: ['It comes round quickly, the AGM.'],
    ASK_FIXTURE_STATUS: ['It is confirmed. Nothing has come through to say otherwise.'],
    ASK_EXPECTATIONS: ['I just want the club to hold its own this season.'],
    ASK_SUPPORT: ['You have my ear, at least. Let us see.'],
    EXPLAIN_DECISION: ['Thanks for coming to me about it.'],
    DISCUSS_CLUB: ['Good of you to ask, manager.'],
    DISCUSS_FINANCES: ['I will always be honest with you about the money.'],
    ASK_SPONSOR: ['They are happy enough, and they are worth keeping.'],
  },
} as const satisfies Record<string, Record<CommunicationIntent, readonly string[]>>;

type Register = keyof typeof REGISTERS;

/** Which register a person writes in, from personality and how they feel about the manager. */
function registerFor(person: Person | null, circumstances: ResponseCircumstances): Register {
  const personality = person?.kind === 'player' ? person.personality : null;
  if (personality === 'Talkative' || personality === 'Wind-up merchant') return 'talkative';
  if (personality === 'Quiet') return 'quiet';
  if (personality === 'Model pro' || personality === 'Reliable sort' || personality === 'Competitive') return 'warm';
  // With nobody to read, warmth decides: somebody the manager has a good
  // relationship with warms up, somebody he does not stays short.
  const warmth = circumstances.friendship + circumstances.trust;
  if (warmth >= 90) return 'warm';
  if (warmth >= 55) return 'talkative';
  return 'quiet';
}

/**
 * Read everything a reply could depend on.
 *
 * Deliberately assembled rather than spread through the reply code: a future
 * stage can widen this one function — with morale, with the calendar, with the
 * season — and every reply gets the new input for free.
 */
export function circumstancesFor(state: GameState, personId: string): ResponseCircumstances {
  const person = state.people[personId] ?? null;
  const relationship = getRelationship(state, MANAGER_PERSON_ID, personId);
  // Which way round is the manager's attitude stored? The relationship records
  // two feelings, so the pair has to be asked in the right direction.
  const towardsManager = relationship
    ? relationship.personAId === MANAGER_PERSON_ID
      ? relationship.aToB
      : relationship.bToA
    : null;

  return {
    person,
    respect: towardsManager?.respect ?? 50,
    trust: towardsManager?.trust ?? 45,
    tension: towardsManager?.tension ?? 0,
    friendship: towardsManager?.friendship ?? 30,
    loyalty: towardsManager?.loyalty ?? 40,
    stranger: !relationship,
    roleLabel: roleLabelFor(person),
    rng: stream(state.seed, 'communication-response', state.saveId, personId, state.date),
  };
}

function roleLabelFor(person: Person | null): string {
  if (!person) return 'former member';
  if (isPlayer(person)) return 'player';
  if (isOfficial(person)) return person.role;
  return 'member';
}

/** The options an inbound message can offer the manager. */
function optionsFor(intent: CommunicationIntent, person: Person | null): ResponseOption[] {
  const targetId = person ? person.id : null;
  const name = person && person.kind === 'player' ? `${person.firstName}` : 'them';
  switch (intent) {
    case 'ASK_AVAILABILITY':
      return [
        { intent: 'INVITE_TO_TRAINING', label: 'Invite to training', targetId },
        { intent: 'PRAISE', label: 'Thank him', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Ask after him', targetId },
      ];
    case 'ASK_FITNESS':
    case 'ASK_UPDATE':
      return [
        { intent: 'ASK_CONFIRMATION', label: 'Ask him to confirm', targetId },
        { intent: 'PRAISE', label: 'Tell him to rest it', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Ask again later', targetId },
      ];
    case 'ASK_CONFIRMATION':
      return [
        { intent: 'ASK_AVAILABILITY', label: 'Ask if he can play', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Leave it for now', targetId },
      ];
    case 'REMIND_PAYMENT':
    case 'WARN_PAYMENT':
    case 'ASK_PAYMENT':
    case 'DISCUSS_PAYMENT':
      return [
        { intent: 'ASK_PAYMENT', label: 'Ask him to sort it this week', targetId },
        { intent: 'DISCUSS_PAYMENT', label: 'Ask how he is getting on', targetId },
        { intent: 'WARN_PAYMENT', label: 'Warn him properly', targetId },
      ];
    case 'PRAISE':
      return [{ intent: 'GENERAL_CHECK_IN', label: `Ask ${name} how he is`, targetId }];
    case 'CRITICISE':
      return [{ intent: 'GENERAL_CHECK_IN', label: 'Say it is forgotten', targetId }];
    case 'INVITE_TO_TRAINING':
      return [
        { intent: 'PRAISE', label: 'Tell him well done', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Ask how he felt', targetId },
      ];
    case 'INVITE_TO_TRIAL':
      return [
        { intent: 'OFFER_ROLE', label: 'Offer him a place', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Ask how he got on', targetId },
      ];
    case 'OFFER_ROLE':
      return [
        { intent: 'PRAISE', label: 'Welcome him aboard', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Check he is settled', targetId },
      ];
    case 'ASK_ADVICE':
      return [
        { intent: 'PRAISE', label: 'Thank him for the advice', targetId },
        { intent: 'GENERAL_CHECK_IN', label: 'Tell him the plan', targetId },
      ];
    default:
      return [];
  }
}

/**
 * Write somebody's reply to a manager's message.
 *
 * The reply is built from the circumstance register and the intent, then
 * modified by the intent itself where the intent demands something particular:
 * a fitness question answered by a man whose `availability` says `unavailable`
 * does not say he is fine, and that fact is read from the *player record* rather
 * than invented. That is the difference between a message that is flavour and
 * one the rest of the game can rely on.
 */
export function draftReply(
  state: GameState,
  personId: string,
  intent: CommunicationIntent,
  options: { subject?: ConversationSubject | null; context?: Record<string, string | number> } = {},
): ResponseDraft {
  const circumstances = circumstancesFor(state, personId);
  const register = registerFor(circumstances.person, circumstances);
  const pool = REGISTERS[register][intent] ?? REGISTERS.quiet[intent];
  let body: string = pool[Math.floor(circumstances.rng.next() * pool.length) % pool.length]!;

  // Circumstances override the template when the world already knows the answer.
  body = applyCircumstanceOverride(state, circumstances.person, intent, body);

  const context: Record<string, string | number> = { register, ...(options.context ?? {}) };
  if (circumstances.person) {
    context.personKind = circumstances.person.kind;
    context.role = circumstances.roleLabel;
  }
  if (isPlayer(circumstances.person)) {
    context.availability = circumstances.person.availability.status;
    context.fitness = Math.round(circumstances.person.fitness);
  }

  return {
    body,
    type: replyTypeFor(intent),
    context,
    responseOptions: optionsFor(intent, circumstances.person),
  };
}

/**
 * What the world already knows overrides what the man would politely say.
 *
 * This is the only place in the system that reads another system's state to
 * write words, and it reads it without changing it: availability, fitness and
 * injury come out of the player record exactly as they already are.
 */
function applyCircumstanceOverride(
  state: GameState,
  person: Person | null,
  intent: CommunicationIntent,
  body: string,
): string {
  if (!isPlayer(person)) return body;
  if (intent === 'ASK_AVAILABILITY' || intent === 'ASK_CONFIRMATION') {
    if (person.availability.status === 'unavailable') {
      return person.availability.note ?? 'I am not right for it this week, sorry.';
    }
    if (person.availability.status === 'doubtful') {
      return person.availability.note ?? 'I should be there, but it is not certain.';
    }
    if (person.injury) return `I will be there, but the ${person.injury.description} is still with me.`;
  }
  if (intent === 'ASK_FITNESS' || intent === 'ASK_UPDATE') {
    if (person.fitness < 50) return 'I am not honest, I am nowhere near sharp yet.';
    if (person.fitness < 70) return 'Getting there. Another week and I will be right.';
  }
  if (intent === 'REMIND_PAYMENT' || intent === 'WARN_PAYMENT') {
    const club = state.clubs[person.clubId ?? ''];
    if (!club) return body;
    if (club.finances.balance < 0) {
      return 'I have not forgotten, if that is what you think. The club is in the same hole and you know it.';
    }
  }
  return body;
}

/** The message type a reply arrives as. */
function replyTypeFor(intent: CommunicationIntent): MessageType {
  switch (intent) {
    case 'ASK_AVAILABILITY':
    case 'ASK_FITNESS':
    case 'ASK_CONFIRMATION':
    case 'ASK_UPDATE':
      return 'answer';
    case 'REMIND_PAYMENT':
    case 'WARN_PAYMENT':
    case 'ASK_PAYMENT':
    case 'DISCUSS_PAYMENT':
      return 'answer';
    case 'INVITE_TO_TRAINING':
    case 'INVITE_TO_TRIAL':
      return 'answer';
    case 'OFFER_ROLE':
      return 'answer';
    default:
      return 'follow-up';
  }
}

/**
 * The opening words of a conversation somebody else started.
 *
 * Generated rather than written per call site so that a thread opened by an
 * availability roll, a chairman's letter and a lad ringing about a trial all
 * come out of the same place and can be tuned together.
 */
export function draftOpening(
  state: GameState,
  personId: string,
  intent: CommunicationIntent,
  options: { subject?: ConversationSubject | null; context?: Record<string, string | number> } = {},
): ResponseDraft {
  const circumstances = circumstancesFor(state, personId);
  const register = registerFor(circumstances.person, circumstances);
  const greeting: Record<Register, string[]> = {
    talkative: ['Manager, hope you are well.', 'Right, one thing for you.', 'Hiya, quick one.'],
    quiet: ['Manager.', 'Sorry to bother you.', 'Hi.'],
    warm: ['Hiya manager, hope you are well.', 'Hello, quick thing if you have got a minute.', 'Morning.'],
  };
  const lead = greeting[register][Math.floor(circumstances.rng.next() * greeting[register].length) % greeting[register].length]!;
  const reply = draftReply(state, personId, intent, options);
  return {
    ...reply,
    body: `${lead} ${reply.body}`,
    type: 'greeting',
    responseOptions: reply.responseOptions,
  };
}

/** A consequence awaiting resolution, built from an intent. */
export function pendingConsequence(
  intent: CommunicationIntent,
  targetId: string | null,
  context: Record<string, string | number> = {},
) {
  return createEmptyConsequence(intent, targetId, context);
}

/** Human label for an intent, re-exported so callers need one import. */
export { COMMUNICATION_INTENT_LABEL };