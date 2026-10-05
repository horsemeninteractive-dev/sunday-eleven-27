import type { CommunicationIntent, Message, ResponseOption } from '@/domain/communication';
import { AVAILABILITY_INTENTS, createEmptyConsequence, MANAGER_PERSON_ID, PAYMENT_INTENTS } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ISODate, MatchId, PersonId } from '@/domain/ids';
import type { AvailabilityStatus, Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { addDays, dayOfWeek, DAY_NAMES } from '@/simulation/calendar';
import { nextFixtureFor } from '@/simulation/schedule';
import { getRelationship, applyRelationshipEvent } from '@/simulation/relationships';
import { scheduleEvent } from '@/simulation/schedule';
import { stream, type Rng } from '@/simulation/rng';
import { appendMessage, conversationOf, findConversation, lastMessageOf, participantName } from './store';
import { sendFromManager, threadWith } from './system';
import { paymentDecisionsFor, paymentResponseOptions, sendPaymentMessage } from './paymentComms';

/**
 * Talking to a player.
 *
 * The rule this module exists to keep is the simple one: **what a man says about
 * himself is his record, not a mood.** A player with `availability.status` of
 * `unavailable` says he is not right for it; a player who is available says he
 * will be there. The templates below are grouped by the state they describe and
 * nothing else may choose them, so the wording can vary as much as we like
 * without ever contradicting the simulation the words are about.
 *
 * What is *not* modelled here is a conversation. There are no branches, no
 * history walk, no tree. One intent goes in, one answer comes out, chosen from
 * a small set of variants that share the same underlying fact. That is enough
 * for a Sunday League, where a word with a man lasts four sentences.
 *
 * Three things happen when a message goes out, in this order:
 *
 *  - the answer is written from the player's real state (`draftPlayerReply`),
 *  - a follow-up is booked if he did not know the answer yet,
 *  - the relationship moves, by a small amount, through the *existing*
 *    relationship service — never by writing to an attitude field directly.
 */

/* ------------------------------------------------------------------------ *
 * Reading the man
 * ------------------------------------------------------------------------ */

/**
 * Everything a reply might depend on, gathered once.
 *
 * Assembled in one place on purpose: a later stage can widen this single
 * function — with form, with recent minutes, with the bench news — and every
 * reply in the game gets the new input at once, rather than each template
 * remembering to go and look.
 */
export interface PlayerContext {
  player: Player;
  /** How he feels about the manager, 0-100 each. Defaults when there is no record. */
  friendship: number;
  respect: number;
  trust: number;
  tension: number;
  loyalty: number;
  /** True when the world holds no relationship for the pair at all. */
  stranger: boolean;
  /** The generator for this one reply, off the world seed. */
  rng: Rng;
  today: ISODate;
}

export function playerContext(state: GameState, playerId: PersonId): PlayerContext | null {
  const person = state.people[playerId];
  if (!isPlayer(person)) return null;
  const relationship = getRelationship(state, MANAGER_PERSON_ID, playerId);
  // The relationship record holds two attitudes and the pair is stored in
  // canonical order, so it has to be read in whichever direction is the
  // player's view of the manager. Getting this backwards would have a manager's
  // opinion of a player standing in for the player's opinion of the manager.
  const towardsManager = relationship
    ? relationship.personAId === MANAGER_PERSON_ID
      ? relationship.aToB
      : relationship.bToA
    : null;

  return {
    player: person,
    friendship: towardsManager?.friendship ?? 30,
    respect: towardsManager?.respect ?? 50,
    trust: towardsManager?.trust ?? 45,
    tension: towardsManager?.tension ?? 0,
    loyalty: towardsManager?.loyalty ?? 40,
    stranger: !relationship,
    rng: stream(state.seed, 'player-conversation', state.saveId, playerId, state.date),
    today: state.date,
  };
}

/* ------------------------------------------------------------------------ *
 * Follow-ups
 * ------------------------------------------------------------------------ */

/**
 * A question the player could not answer yet.
 *
 * This is the whole of the follow-up system, and it is deliberately tiny: a
 * message that left something unresolved says so, and the calendar carries a
 * single event for the day he is to be asked again. There is no queue, no
 * retry policy and no state machine — an unanswered question in grassroots
 * football gets asked once, in person, on a Saturday.
 */
export interface FollowUp {
  conversationId: string;
  playerId: PersonId;
  /** What is still outstanding, for the calendar's own line. */
  reason: string;
  date: ISODate;
  matchId: MatchId | null;
}

/**
 * Does this man know yet?
 *
 * `availability.status` is the answer the *club* holds, which is not always the
 * answer the man holds: a player rolled doubtful on Monday may not know himself
 * what Saturday will bring, and one rolled available may still turn up having
 * worked a double. So the player is only certain when his record is certain —
 * and doubtful is honestly doubtful rather than dressed up as a yes.
 */
export function answerIsUncertain(player: Player): boolean {
  if (player.injury && player.injury.daysOut > 0) return false;
  return player.availability.status === 'doubtful';
}

/** When to ask again: the day before the match he is uncertain about. */
export function followUpDateFor(state: GameState, _player: Player): ISODate {
  const fixture = nextFixtureFor(state, state.userClubId);
  if (!fixture) return addDays(state.date, 3);
  // The day before is the last point at which changing the plan is still useful.
  const dayBefore = addDays(fixture.date, -1);
  return dayBefore >= state.date ? dayBefore : state.date;
}

/* ------------------------------------------------------------------------ *
 * Squad status
 * ------------------------------------------------------------------------ */

export type SelectionStatus = 'starting' | 'bench' | 'not-selected' | 'unfit' | 'undecided';

/**
 * Where a man stands for the coming match.
 *
 * Read from the fixture that already exists rather than from a second copy of
 * the squad, so this can never disagree with the team sheet the manager actually
 * picked. "Undecided" is a real answer and not a failure: before the team is
 * chosen there is genuinely nothing to tell him, and pretending otherwise would
 * have the manager telling a player he is in a side he has not picked.
 */
export function selectionStatusFor(state: GameState, player: Player): SelectionStatus {
  const fixture = nextFixtureFor(state, state.userClubId);
  if (!fixture) return 'undecided';
  const side = fixture.homeClubId === state.userClubId ? 'home' : 'away';
  const lineup = fixture.lineups[side];
  if (lineup.starting.some((slot) => slot.playerId === player.id)) return 'starting';
  if (lineup.bench.some((slot) => slot.playerId === player.id)) return 'bench';
  // A man who cannot play has not been left out of the side — he is not in it
  // for other reasons, and telling him otherwise would be both unkind and wrong.
  // He can still be told where he stands, so this is a state of its own rather
  // than a shrug.
  if (player.availability.status === 'unavailable' || (player.injury && player.injury.daysOut > 0)) {
    return 'unfit';
  }
  return lineup.starting.length === 0 ? 'undecided' : 'not-selected';
}

function fixtureFor(state: GameState): MatchId | null {
  return nextFixtureFor(state, state.userClubId)?.id ?? null;
}

/* ------------------------------------------------------------------------ *
 * Answering
 * ------------------------------------------------------------------------ */

/**
 * The state key a reply is chosen by.
 *
 * Exported so a test can assert that the *wording* and the *record* agree
 * without matching prose: an unavailable player's reply is always in the
 * `unavailable` bucket whatever it happens to say.
 */
export type ReplyState =
  | 'injured'
  | 'unavailable'
  | 'doubtful'
  | 'available-confident'
  | 'available-mixed'
  | 'grumbling'
  | 'selected'
  | 'benched'
  | 'left-out'
  | 'unfit'
  | 'undecided'
  | 'advice'
  | 'praise'
  | 'check-in';

/**
 * What state this reply is about, given the player and the intent.
 *
 * This function *is* the truth rule. Every template is reached through it and
 * nowhere else, which is why the wording cannot contradict the simulation.
 */
export function replyStateFor(state: GameState, context: PlayerContext, intent: CommunicationIntent): ReplyState {
  const { player } = context;

  if (intent === 'DISCUSS_SELECTION') {
    const status = selectionStatusFor(state, player);
    if (status === 'starting') return 'selected';
    if (status === 'bench') return 'benched';
    if (status === 'not-selected') return 'left-out';
    if (status === 'unfit') return 'unfit';
    return 'undecided';
  }

  if (intent === 'PRAISE') return 'praise';
  if (intent === 'ASK_ADVICE') return 'advice';
  if (intent === 'CHECK_IN' || intent === 'GENERAL_CHECK_IN') return 'check-in';

  // Everything below is a question about his body or his Sunday. `ASK_CONFIRMATION`
  // and `ASK_UPDATE` land here on purpose: a man asked to confirm what he has
  // already said is being asked about the same thing in the same terms, and a
  // reply that described a different state would be the system arguing with
  // itself.
  //
  // An injury outranks the availability roll: it is the reason, and a man with
  // a broken ankle does not need the club's other explanation for it.
  if (player.injury && player.injury.daysOut > 0) return 'injured';

  const status: AvailabilityStatus = player.availability.status;
  if (status === 'unavailable') return 'unavailable';
  if (status === 'doubtful') return 'doubtful';

  // He is available. Whether he says so warmly depends on how he feels about
  // the man asking — the one place mood is allowed to change the tone without
  // changing the fact.
  if (context.tension >= 25 || context.friendship < 22) return 'grumbling';
  if (player.morale < 45 || context.trust < 35) return 'available-mixed';
  return 'available-confident';
}

/**
 * The words, grouped by the state they describe.
 *
 * Three or four variants each, and that is the whole design: the manager should
 * not learn a player's lines, but two conversations in a career should not read
 * identically either. Every array is interchangeable with the others in its
 * row — no entry depends on another having been said.
 */
const VARIANTS: Record<ReplyState, string[]> = {
  injured: [
    'Still not right, to be honest. The {injury} has not settled. I would sit this one out.',
    'My {injury} is still bothering me. Best I watch, I think.',
    'I have not got the {injury} right yet. I do not want to make it worse.',
  ],
  unavailable: [
    'I cannot make it, mate. {note}',
    'Not this one, I am afraid. {note}',
    'No luck, I am out. {note}',
  ],
  doubtful: [
    'I reckon so, but I will see how it feels Saturday.',
    'I should be there. I am not committing to it yet though.',
    'Probably fine, but do not count on me.',
  ],
  'available-confident': [
    'Yeah mate, should be fine.',
    'No problem at all, I will be there.',
    'Straight on, not a chance of missing it.',
  ],
  'available-mixed': [
    'I will be there, no drama.',
    'Yes, I am good for it.',
    'I think so. It has not been great but I will manage.',
  ],
  grumbling: [
    'I will be there. Whether I am happy about it is another matter.',
    'Fine. I will be there.',
    'I suppose so. Since you ask.',
  ],
  selected: [
    'Good, I will be there then.',
    'Right. I will be there an hour early if you want.',
    'Thanks for telling me.',
  ],
  benched: [
    'On the bench, is it? I would rather be out than that.',
    'Bench. I see where I am.',
    'I will take the bench. I have been there before.',
  ],
  'left-out': [
    'Right. I am not going to argue with it.',
    'That is disappointing, but I understand.',
    'Not my best week, then.',
  ],
  unfit: [
    'I know I am not in it. {note}',
    'Not much point asking, I cannot play.',
    'I am not right for it, as you know.',
  ],
  undecided: [
    'Not decided yet, is it. Let me know when you know.',
    'I will wait and see. You have not picked anybody yet.',
    'No news, then.',
  ],
  advice: [
    'Honestly? I would do what keeps everyone calm. Nobody wants a fuss.',
    'I would talk to the chairman first. He is reasonable if you go to him straight.',
    'Ask me again when I have had a think about it.',
    'That depends what you are trying to achieve, honestly.',
  ],
  praise: [
    'Appreciate that. Thank you.',
    'That means a lot, coming from you.',
    'Good of you to say so.',
  ],
  'check-in': [
    'All good, you know how it is.',
    'Not bad, thanks for asking.',
    'You know, fine.',
    'Could be worse.',
  ],
};

/** Fills the placeholders that keep a line tied to the actual reason. */
function fill(body: string, player: Player): string {
  return body
    .replace('{injury}', player.injury?.description.toLowerCase() ?? 'knock')
    .replace('{note}', player.availability.note ?? 'It has come up at work.');
}

/**
 * Write the reply.
 *
 * The variant is drawn from the player's own stream, so the same man asked the
 * same question on the same day says the same thing (a save and a reload do not
 * change his words), while two different men never share a line.
 */
export function draftPlayerReply(state: GameState, personId: PersonId, intent: CommunicationIntent): {
  body: string;
  replyState: ReplyState;
  uncertain: boolean;
  context: Record<string, string | number>;
} | null {
  const context = playerContext(state, personId);
  if (!context) return null;
  const replyState = replyStateFor(state, context, intent);
  const pool = VARIANTS[replyState];
  const body = pool[Math.floor(context.rng.next() * pool.length) % pool.length]!;

  return {
    body: fill(body, context.player),
    replyState,
    // Every question about his Sunday can end in "I will see how it feels", so
    // every one of them has to be able to book a follow-up. Checking the two
    // original intents here rather than the whole set is the kind of omission
    // that quietly stops a man ever being chased again.
    uncertain: AVAILABILITY_INTENTS.includes(intent) && answerIsUncertain(context.player),
    context: {
      replyState,
      availability: context.player.availability.status,
      morale: Math.round(context.player.morale),
      fitness: Math.round(context.player.fitness),
      personality: context.player.personality,
    },
  };
}

/* ------------------------------------------------------------------------ *
 * What the manager can say to this man
 * ------------------------------------------------------------------------ */

/**
 * The options to put on a thread, for a player.
 *
 * Not the whole vocabulary: the intents that only make sense to one kind of
 * person, or that need something the game cannot yet answer, are left off. A
 * screen offering a manager "Remind about subs" for every player would be
 * offering a feature the next task is meant to build properly; until then it is
 * better absent than present and doing nothing.
 */
export function playerResponseOptions(state: GameState, playerId: PersonId): ResponseOption[] {
  const context = playerContext(state, playerId);
  if (!context) return [];
  const targetId = playerId;
  const injured = Boolean(context.player.injury && context.player.injury.daysOut > 0);
  const options: ResponseOption[] = [];

  options.push(
    {
      intent: 'ASK_AVAILABILITY',
      label: 'Are you alright for the match?',
      targetId,
      context: { status: context.player.availability.status },
    },
  );
  options.push({
    intent: 'ASK_FITNESS',
    label: injured ? 'How is the knock?' : 'How are you feeling?',
    targetId,
  });

  // When a man has not settled, chasing is the point, so the chase goes to the
  // *front* of the list rather than behind three pleasantries. The two are
  // different: a confirmation asks for the answer to a question already asked,
  // an update asks what has happened since. Offering both at once would be
  // offering the same message twice in different words.
  if (answerIsUncertain(context.player)) {
    options.unshift({
      intent: 'ASK_CONFIRMATION',
      label: 'Ask him to confirm',
      targetId,
      context: { status: context.player.availability.status },
    });
  } else if (context.player.availability.status === 'unavailable') {
    // He is out and it is not in doubt; the only thing left to ask is whether
    // it will have changed by the weekend.
    options.push({ intent: 'ASK_UPDATE', label: 'Ask if he will be back', targetId });
  }

  // Money, when there is any to talk about. Asked about *before* the pleasantries,
  // because a man who owes four weeks of subs and is asked how his knee is will
  // answer the wrong question. The escalation is not offered at every level: a
  // week behind is not a warning.
  const moneyOptions = paymentOptionsFor(state, playerId);
  if (moneyOptions.length > 0) options.unshift(...moneyOptions);

  options.push({ intent: 'CHECK_IN', label: 'How are you, generally?', targetId });
  options.push({
    intent: 'PRAISE',
    label: 'Tell him well done',
    targetId,
  });
  // Selection only means something when there is a fixture to be picked for.
  if (selectionStatusFor(state, context.player) !== 'undecided') {
    options.push({ intent: 'DISCUSS_SELECTION', label: 'Tell him where he stands', targetId });
  }
  // Not every man has an opinion worth having, and the ones who do are the ones
  // with some experience of the game or the manager's ear. Read from the
  // behavioural attributes the game already generates — there is no opinion
  // field of our own to invent.
  const behavioural = context.player.attributes.behavioural;
  if (behavioural.ambition >= 10 || behavioural.loyalty >= 11 || context.player.age >= 32 || context.trust >= 55) {
    options.push({ intent: 'ASK_ADVICE', label: 'Ask his advice', targetId });
  }
  return options;
}

/* ------------------------------------------------------------------------ *
 * Relationship effects
 * ------------------------------------------------------------------------ */

/**
 * How much a conversation moves the relationship.
 *
 * Modest on purpose, and applied through the existing `applyRelationshipEvent`
 * rather than by touching an attitude field. The scale: praise is worth about a
 * good week at Thursday night; being left out is worth a bad one. A manager who
 * talks to his squad every day should see his relationships drift slowly, not
 * swing.
 */
function relationshipEffectFor(intent: CommunicationIntent, replyState: ReplyState): {
  type: 'manager-praise' | 'manager-criticism' | null;
  intensity: number;
  note: string;
} {
  switch (intent) {
    case 'PRAISE':
      return { type: 'manager-praise', intensity: 0.5, note: 'The manager told him he had done well' };
    case 'CRITICISE':
      return { type: 'manager-criticism', intensity: 0.6, note: 'The manager had a go at him' };
    case 'DISCUSS_SELECTION':
      // Being left out is the one conversation that genuinely costs something,
      // and the game already models it — the `dropped` event is exactly this.
      // Telling an unfit man where he stands is not the same as dropping him,
      // and must not be scored as though it were.
      if (replyState === 'left-out') {
        return { type: 'manager-criticism', intensity: 0.5, note: 'Told him he had not been picked' };
      }
      if (replyState === 'unfit') {
        return { type: 'manager-praise', intensity: 0.2, note: 'Told him where he stands' };
      }
      return { type: 'manager-praise', intensity: 0.25, note: 'Told him where he stands' };
    case 'ASK_AVAILABILITY':
    case 'ASK_FITNESS':
    case 'ASK_CONFIRMATION':
    case 'ASK_UPDATE':
    case 'CHECK_IN':
    case 'GENERAL_CHECK_IN':
    case 'ASK_ADVICE':
      // Being asked how you are is not a favour and not an insult. It is worth a
      // very little warmth, which is the point: the manager checking in is
      // noticed, but not dramatically.
      return { type: 'manager-praise', intensity: 0.15, note: 'The manager asked how he was' };
    default:
      return { type: null, intensity: 0, note: '' };
  }
}

/** Move the relationship through the existing service. Returns the description. */
export function applyConversationRelationship(
  state: GameState,
  playerId: PersonId,
  intent: CommunicationIntent,
  replyState: ReplyState,
): string | null {
  const effect = relationshipEffectFor(intent, replyState);
  if (!effect.type) return null;
  // `aId` is the actor — the manager — so the effect lands on the player's
  // attitude toward him, which is the direction that matters here.
  const result = applyRelationshipEvent(state, {
    type: effect.type,
    aId: MANAGER_PERSON_ID,
    bId: playerId,
    intensity: effect.intensity,
    detail: effect.note,
  });
  return result?.description ?? null;
}

/* ------------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------------ */

/**
 * Start (or continue) a thread with a player.
 *
 * A brand new thread is left with no messages rather than being given a
 * placeholder: an empty bubble is not a thing a manager would ever see, and
 * inventing one only to carry a payload onto it would put a message in his
 * history that nobody sent. The options for the thread come from
 * `playerResponseOptions`, which the screen reads directly.
 */
export function openPlayerThread(state: GameState, playerId: PersonId): string | null {
  const person = state.people[playerId];
  if (!isPlayer(person)) return null;
  const conversation = threadWith(state, playerId, 'player');
  // Keep whatever the last message offered in step with the player's situation
  // as it stands, so an option that has stopped making sense does not linger.
  const last = lastMessageOf(state, conversation.id);
  if (last) last.responseOptions = playerResponseOptions(state, playerId);
  return conversation.id;
}

/**
 * Write to a player with an intent, and everything that follows from it.
 *
 * Order matters: the reply is written from the record *before* the
 * relationship moves, so a conversation cannot change the answer it gets.
 */
export function sendPlayerMessage(
  state: GameState,
  playerId: PersonId,
  intent: CommunicationIntent,
  options: { body?: string; date?: ISODate } = {},
): { message: Message; reply: Message | null; followUp: FollowUp | null } | null {
  const context = playerContext(state, playerId);
  if (!context) return null;

  // Money has its own reply machinery, because its rule is its own: what a man
  // says about owing is decided by whether he has been chased before and how he
  // feels about the man asking, not by what the finance system happens to know.
  // A promise written there changes no balance, which is the whole point.
  if (PAYMENT_INTENTS.includes(intent)) {
    const sent = sendPaymentMessage(state, playerId, intent);
    if (!sent || !sent.message) return null;
    return { message: sent.message, reply: sent.reply, followUp: null };
  }

  const conversationId =
    findConversation(state, [playerId], { type: 'player' })?.id ?? openPlayerThread(state, playerId);
  if (!conversationId) return null;

  // `deliver: false` because the answer to a player is not the generic one the
  // communication service would generate: it has to be written from this man's
  // own record, below, or the two would disagree.
  const sent = sendFromManager(state, {
    conversationId,
    intent,
    targetId: playerId,
    ...(options.body ? { body: options.body } : {}),
    context: { name: context.player.firstName, topic: context.player.surname },
    ...(options.date ? { date: options.date } : {}),
    deliver: false,
  });
  const message = sent.message;
  if (!message) return null;

  const drafted = draftPlayerReply(state, playerId, intent);
  if (!drafted) return { message, reply: null, followUp: null };

  // Mark the manager's question as answered by whatever comes back, so the
  // thread reads as a conversation and not as a question left hanging.
  message.consequence.resolvedOn = options.date ?? state.date;
  message.consequence.outcome = `Answered: ${drafted.replyState}`;

  const reply = appendMessage(state, conversationId, {
    senderId: playerId,
    recipientIds: [MANAGER_PERSON_ID],
    body: drafted.body,
    type: drafted.replyState === 'grumbling' ? 'answer' : 'answer',
    // Message context is deliberately flat data, so "uncertain" is recorded as
    // the word rather than a boolean: a later stage reads it without having to
    // know that a flag was ever involved.
    context: { ...drafted.context, uncertain: drafted.uncertain ? 'yes' : 'no' },
    subject: conversationOf(state, conversationId)?.subject ?? null,
    responseOptions: [],
    consequence: createEmptyConsequence(null, MANAGER_PERSON_ID, {}),
    ...(options.date ? { timestamp: options.date } : {}),
    read: false,
  });
  if (!reply) return { message, reply: null, followUp: null };
  const replyState = drafted.replyState;
  const uncertain = drafted.uncertain || answerIsUncertain(context.player);

  // An answer that came with an intention attached to it is not "resolved" in
  // the sense of closed off — the man has answered, and the manager knows where
  // he stands.
  reply.consequence.resolvedOn = options.date ?? state.date;
  reply.consequence.outcome = `Answered: ${replyState}`;

  const followUp = uncertain ? bookFollowUp(state, conversationId, playerId, intent) : null;

  // The relationship moves last, and only if there was an answer to react to.
  const described = applyConversationRelationship(state, playerId, intent, replyState);
  if (described && reply) {
    reply.consequence.appliedHooks.push('relationship');
  }

  // Leave the manager something to say next time.
  const last = lastMessageOf(state, conversationId);
  if (last) last.responseOptions = playerResponseOptions(state, playerId);

  return { message, reply, followUp };
}

/**
 * Book the conversation the manager is going to have on Saturday.
 *
 * Uses the game's own calendar rather than a second scheduler, which is what
 * stops a follow-up from being a thing the calendar knows nothing about when the
 * manager looks at his week.
 */
export function bookFollowUp(
  state: GameState,
  conversationId: string,
  playerId: PersonId,
  intent: CommunicationIntent,
): FollowUp {
  const player = state.people[playerId];
  const date = isPlayer(player) ? followUpDateFor(state, player) : addDays(state.date, 3);
  const name = player ? participantName(state, playerId) : 'a player';

  // One outstanding chase per thread, not one per asking. A man who says "I
  // will see how it feels Saturday" twice has still said it once: the manager
  // chased, he was vague again, and the same Saturday is still the day to try.
  // Leaving both events behind would put "Chase Vinny Isaacs" on the calendar
  // twice and leave one of them there forever.
  for (const outstanding of outstandingFollowUps(state)) {
    if (outstanding.conversationId === conversationId) clearFollowUp(state, outstanding);
  }

  scheduleEvent(state, {
    date,
    time: null,
    kind: 'availability-change',
    priority: 'important',
    source: 'player',
    title: `Chase ${name}`,
    detail: `${name} said he would let you know. Ask again about ${intent.toLowerCase().replace(/_/g, ' ')}.`,
    clubIds: [state.userClubId],
    personIds: [playerId],
    data: { conversationId, playerId, intent },
  });

  return { conversationId, playerId, reason: 'Player would not commit', date, matchId: fixtureFor(state) };
}

/**
 * The follow-ups waiting, for the calendar and for tests.
 *
 * Read from the calendar, so what the manager is told about his week and what
 * this system believes it owes him cannot drift apart.
 */
export function outstandingFollowUps(state: GameState): FollowUp[] {
  const store = state.schedule?.events ?? [];
  return store
    .filter(
      (event) =>
        event.source === 'player' &&
        event.kind === 'availability-change' &&
        event.resolvedOn === null &&
        typeof event.data.conversationId === 'string',
    )
    .map((event) => ({
      conversationId: String(event.data.conversationId),
      playerId: event.personIds[0] ?? '',
      reason: event.detail,
      date: event.date,
      matchId: null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Close a follow-up once it has been had. */
export function clearFollowUp(state: GameState, followUp: FollowUp): boolean {
  const store = state.schedule?.events ?? [];
  const event = store.find(
    (item) => item.source === 'player' && item.data.conversationId === followUp.conversationId && item.resolvedOn === null,
  );
  if (!event) return false;
  event.resolvedOn = state.date;
  event.resolution = 'Chased';
  return true;
}

/**
 * Work through everything the calendar says is outstanding.
 *
 * Called on day progression so a man who said "I will let you know Saturday" is
 * written to on Saturday, without anything having to remember him.
 */
export function runDueFollowUps(state: GameState, onDate: ISODate = state.date): number {
  let done = 0;
  for (const followUp of outstandingFollowUps(state)) {
    if (followUp.date > onDate) continue;
    if (!state.people[followUp.playerId]) continue;
    // The question is put again, and the answer this time is read from the
    // record as it stands today rather than from last week's roll.
    const sent = sendPlayerMessage(state, followUp.playerId, 'ASK_AVAILABILITY', { date: onDate });
    if (!sent) continue;
    clearFollowUp(state, followUp);
    done += 1;
  }
  return done;
}

/** A human sentence for when a man is being asked about himself. */
export function followUpPrompt(state: GameState, player: Player): string {
  const weekday = DAY_NAMES[dayOfWeek(state.date)] ?? 'today';
  return `${player.nickname ?? player.firstName} - any news for ${weekday}?`;
}


/**
 * The money actions for this man, if he owes any.
 *
 * A thin pass-through so `playerResponseOptions` does not have to know what
 * subs are. The dependency runs one way — the payment layer reads the finance
 * record, and this asks it what it would like to offer.
 */
export function paymentOptionsFor(state: GameState, playerId: PersonId): ResponseOption[] {
  return paymentResponseOptions(state, playerId);
}

export { paymentDecisionsFor, sendPaymentMessage };
