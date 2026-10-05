import { describe, expect, it } from 'vitest';
import { MANAGER_PERSON_ID, type CommunicationIntent } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { addDays } from '@/simulation/calendar';
import { getRelationship } from '@/simulation/relationships';
import { nextFixtureFor } from '@/simulation/schedule';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { createTestGame, type TestGame } from '../testSupport';
import { conversationOf } from './store';
import {
  answerIsUncertain,
  bookFollowUp,
  clearFollowUp,
  draftPlayerReply,
  openPlayerThread,
  outstandingFollowUps,
  playerContext,
  playerResponseOptions,
  replyStateFor,
  runDueFollowUps,
  selectionStatusFor,
  sendPlayerMessage,
} from './playerConversation';

/**
 * Talking to a player.
 *
 * The test that matters most here is the one that would fail if the templates
 * were written before the record: **a man's words must agree with his
 * availability**. The rest are about the machinery around that — relationships
 * moving, follow-ups being kept, the whole thing surviving a save.
 *
 * Assertions are made against `replyState` (the state key a reply was chosen
 * by) rather than against the prose, because the prose is allowed to vary and
 * the state is not. A test that matched exact sentences would break every time
 * somebody added a variant, and would prove nothing about the rule that
 * matters.
 */

function squad(game: TestGame): Player[] {
  return game.state.clubs[game.clubId]!.squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

/** A player with his availability set to something specific, and nothing else touched. */
function withAvailability(game: TestGame, index: number, status: 'available' | 'doubtful' | 'unavailable') {
  const player = squad(game)[index]!;
  player.availability = {
    status,
    reason: status === 'unavailable' ? 'work' : null,
    note: status === 'unavailable' ? 'Rota came up at work' : null,
    until: null,
    discoveredLate: false,
  };
  return player;
}

function injured(game: TestGame, index: number) {
  const player = squad(game)[index]!;
  player.injury = {
    description: 'Hamstring',
    severity: 'minor',
    daysOut: 6,
    occurredOn: game.state.date,
  };
  return player;
}

/**
 * A player who can actually play.
 *
 * A generated squad already contains men rolled `unavailable`, and selection is
 * not a question for a man who cannot play — so the selection tests need a
 * player whose availability says he is available.
 */
function fit(game: TestGame, index: number): Player {
  return withAvailability(game, index, 'available');
}

/** Make the player warm toward the manager, or cold. */
function withRelationship(game: TestGame, playerId: string, attitude: Partial<{ friendship: number; trust: number; tension: number; respect: number }>) {
  const relationship = getRelationship(game.state, MANAGER_PERSON_ID, playerId);
  if (!relationship) throw new Error('the test game has no manager relationship for this player');
  const target = relationship.personAId === MANAGER_PERSON_ID ? relationship.aToB : relationship.bToA;
  if (attitude.friendship !== undefined) target.friendship = attitude.friendship;
  if (attitude.trust !== undefined) target.trust = attitude.trust;
  if (attitude.tension !== undefined) target.tension = attitude.tension;
  if (attitude.respect !== undefined) target.respect = attitude.respect;
  return relationship;
}

function ask(state: GameState, playerId: string, intent: CommunicationIntent) {
  const sent = sendPlayerMessage(state, playerId, intent);
  if (!sent) throw new Error('the message was not sent');
  return sent;
}

describe('a player answers about his availability', () => {
  it('tells the manager he is available when the record says he is', () => {
    const game = createTestGame('pc-available');
    const player = withAvailability(game, 0, 'available');

    const { reply } = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(reply).not.toBeNull();
    expect(reply!.context.replyState).toMatch(/available/);
    expect(reply!.body.toLowerCase()).not.toMatch(/cannot|not this one|no luck/);
    // A straight yes does not leave the manager chasing anything.
    expect(reply!.context.replyState).toBe('available-confident');
  });

  it('tells the manager he is out when the record says he is', () => {
    const game = createTestGame('pc-unavailable');
    const player = withAvailability(game, 1, 'unavailable');

    const { reply } = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(reply!.context.replyState).toBe('unavailable');
    // And the reason he gave is the reason the record holds, not a different one.
    expect(reply!.body).toContain('Rota came up at work');
  });

  it('is honestly doubtful when he is doubtful, and says he will have to see', () => {
    const game = createTestGame('pc-doubtful');
    const player = withAvailability(game, 2, 'doubtful');

    const { reply, followUp } = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(reply!.context.replyState).toBe('doubtful');
    // Doubtful must not read as a straight yes or a straight no.
    expect(reply!.body.toLowerCase()).not.toMatch(/cannot make it|no luck|not this one/);
    // He did not commit, so the manager has something to chase.
    expect(followUp).not.toBeNull();
  });

  it('tells the manager about an injury, and an injury outranks the roll', () => {
    const game = createTestGame('pc-injured');
    const player = injured(game, 3);
    // Even with an availability roll that says he is fine: the injury is the
    // reason, and a man with a broken hamstring is not saying "yeah mate".
    player.availability = {
      status: 'available',
      reason: null,
      note: null,
      until: null,
      discoveredLate: false,
    };

    const { reply } = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(reply!.context.replyState).toBe('injured');
    expect(reply!.body).toContain('hamstring');
    // An injury is a fact, not a maybe, so nothing is left outstanding.
    expect(answerIsUncertain(player)).toBe(false);
  });

  it('never contradicts the record, whatever the wording', () => {
    const game = createTestGame('pc-consistency');
    // The rule, stated once: a man's *availability* decides whether he says he
    // can come. What he *thinks of the manager* decides his tone, and nothing
    // else. So an available player may be grumbling but must never say he is
    // out, and an unavailable player must never say he is there.
    const REFUSALS = /cannot make it|not this one|no luck|not right for it/i;
    const COMFORTS = /yeah mate|should be fine|no problem at all|straight on/i;

    const players = squad(game);
    expect(players.length).toBeGreaterThan(3);

    players.forEach((player, index) => {
      const status = (['available', 'doubtful', 'unavailable'] as const)[index % 3]!;
      withAvailability(game, index, status);
      const { reply } = ask(game.state, player.id, 'ASK_AVAILABILITY');

      if (status === 'unavailable') {
        expect(REFUSALS.test(reply!.body), 'an unavailable man must say he is out').toBe(true);
        expect(COMFORTS.test(reply!.body), 'an unavailable man must not say he is fine').toBe(false);
      }
      if (status === 'available') {
        expect(REFUSALS.test(reply!.body), 'an available man must not say he is out').toBe(false);
      }
      // Doubtful is neither, and must not read as either.
      if (status === 'doubtful') {
        expect(REFUSALS.test(reply!.body)).toBe(false);
      }
    });
  });

  it('varies the wording between two men, and between two conversations', () => {
    const game = createTestGame('pc-variety');
    const [a, b] = squad(game);
    withAvailability(game, 0, 'available');
    withAvailability(game, 1, 'available');

    const first = ask(game.state, a.id, 'ASK_AVAILABILITY').reply!.body;
    const second = ask(game.state, b.id, 'ASK_AVAILABILITY').reply!.body;
    expect(first).not.toBe(second);
  });

  it('answers a fitness question about the state the man is actually in', () => {
    const game = createTestGame('pc-fitness');
    const player = squad(game)[0]!;
    player.fitness = 30;
    player.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };

    const { reply } = ask(game.state, player.id, 'ASK_FITNESS');
    expect(reply!.context.fitness).toBeLessThan(60);
    expect(reply!.context.replyState).toMatch(/available/);
  });
});

describe('the answer depends on the man, not only on the record', () => {
  it('sounds different to a man who rates the manager and one who does not', () => {
    const game = createTestGame('pc-relationship');
    const [a, b] = squad(game);
    withAvailability(game, 0, 'available');
    withAvailability(game, 1, 'available');
    withRelationship(game, a.id, { friendship: 80, trust: 80, tension: 0 });
    withRelationship(game, b.id, { friendship: 10, trust: 20, tension: 40 });

    const warm = ask(game.state, a.id, 'ASK_AVAILABILITY').reply!;
    const cold = ask(game.state, b.id, 'ASK_AVAILABILITY').reply!;
    expect(warm.context.replyState).toBe('available-confident');
    expect(cold.context.replyState).toBe('grumbling');
    // Same fact — both are available — different man saying it.
    expect(warm.context.availability).toBe(cold.context.availability);
  });

  it('reads a stranger without a relationship record rather than failing', () => {
    const game = createTestGame('pc-stranger');
    const player = withAvailability(game, 0, 'available');
    expect(getRelationship(game.state, MANAGER_PERSON_ID, player.id)).toBeDefined();
    // A player from another club has no pair record at all.
    const outsider = Object.values(game.state.people).find(
      (p): p is Player => isPlayer(p) && p.clubId !== game.clubId,
    )!;
    const context = playerContext(game.state, outsider.id);
    expect(context).not.toBeNull();
    expect(context!.stranger).toBe(true);
    expect(draftPlayerReply(game.state, outsider.id, 'ASK_AVAILABILITY')).not.toBeNull();
  });

  it('picks the reply state by personality and morale where the record is thin', () => {
    const game = createTestGame('pc-morale');
    const player = squad(game)[0]!;
    player.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
    player.morale = 20;
    // Warm enough that tension is not the thing being measured here: a man who
    // is happy with the manager and miserable about his football is a different
    // case from a man who resents being asked.
    withRelationship(game, player.id, { friendship: 60, trust: 55, tension: 0 });
    const context = playerContext(game.state, player.id)!;
    expect(replyStateFor(game.state, context, 'ASK_AVAILABILITY')).toBe('available-mixed');
  });

  it('carries the personality it used, so a later stage can read it', () => {
    const game = createTestGame('pc-personality');
    const player = squad(game)[0]!;
    player.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
    const { reply } = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(reply!.context.personality).toBe(player.personality);
  });
});

describe('selection', () => {
  it('tells a man he is in when he is in the eleven', () => {
    const game = createTestGame('pc-selected');
    const player = squad(game)[0]!;
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    // What is being tested is the *reading* of a team sheet, not the picking of
    // one, so the sheet is written by hand.
    fixture.lineups[side].starting = squad(game)
      .slice(0, 5)
      .map((p) => ({ playerId: p.id, position: p.preferredPosition }) as never);

    expect(selectionStatusFor(game.state, player)).toBe('starting');
    const { reply } = ask(game.state, player.id, 'DISCUSS_SELECTION');
    expect(reply!.context.replyState).toBe('selected');
  });

  it('tells a man he is on the bench when he is on the bench', () => {
    const game = createTestGame('pc-bench');
    const player = squad(game)[1]!;
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    fixture.lineups[side].bench = fixture.lineups[side].bench.map((slot) =>
      slot.playerId === player.id ? slot : slot,
    );
    if (!fixture.lineups[side].bench.some((slot) => slot.playerId === player.id)) {
      fixture.lineups[side].bench.push({ playerId: player.id, position: player.preferredPosition, role: 'unknown' } as never);
    }

    expect(selectionStatusFor(game.state, player)).toBe('bench');
    expect(ask(game.state, player.id, 'DISCUSS_SELECTION').reply!.context.replyState).toBe('benched');
  });

  it('tells a man he has not been picked when he has not', () => {
    const game = createTestGame('pc-left-out');
    // A man who is genuinely in the squad but was not picked, which is the case
    // that matters: not somebody who was never registered.
    const player = fit(game, 0);
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    // Somebody has to be picked, or there is no team sheet to be left out of.
    fixture.lineups[side].starting = squad(game)
      .filter((p) => p.id !== player.id)
      .slice(0, 5)
      .map((p) => ({ playerId: p.id, position: p.preferredPosition }) as never);
    fixture.lineups[side].bench = [];

    expect(selectionStatusFor(game.state, player)).toBe('not-selected');
    expect(ask(game.state, player.id, 'DISCUSS_SELECTION').reply!.context.replyState).toBe('left-out');
  });

  it('does not pretend an unfit man has been left out', () => {
    const game = createTestGame('pc-unfit');
    const player = withAvailability(game, 0, 'unavailable');
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    fixture.lineups[side].starting = squad(game)
      .filter((p) => p.id !== player.id)
      .slice(0, 5)
      .map((p) => ({ playerId: p.id, position: p.preferredPosition }) as never);

    // He has not been dropped; he cannot play. Conflating the two would be both
    // wrong and the sort of thing that loses a player.
    expect(selectionStatusFor(game.state, player)).toBe('unfit');
    expect(ask(game.state, player.id, 'DISCUSS_SELECTION').reply!.context.replyState).toBe('unfit');
  });

  it('says nothing is decided when no team has been picked', () => {
    const game = createTestGame('pc-undecided');
    const player = squad(game)[3]!;
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    fixture.lineups[side].starting = [];

    expect(selectionStatusFor(game.state, player)).toBe('undecided');
    expect(ask(game.state, player.id, 'DISCUSS_SELECTION').reply!.context.replyState).toBe('undecided');
  });

  it('does not offer to discuss a selection before there is one to discuss', () => {
    const game = createTestGame('pc-no-selection-option');
    const player = squad(game)[4]!;
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    fixture.lineups[side].starting = [];

    const intents = playerResponseOptions(game.state, player.id).map((option) => option.intent);
    expect(intents).not.toContain('DISCUSS_SELECTION');
  });

  it('offers to discuss it once there is a team sheet', () => {
    const game = createTestGame('pc-selection-option');
    const player = fit(game, 0);
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    fixture.lineups[side].starting = squad(game)
      .filter((p) => p.id !== player.id)
      .slice(0, 4)
      .map((p) => ({ playerId: p.id, position: p.preferredPosition }) as never);
    fixture.lineups[side].bench = [];

    const intents = playerResponseOptions(game.state, player.id).map((option) => option.intent);
    expect(intents).toContain('DISCUSS_SELECTION');
  });
});

function nextUserFixture(game: TestGame) {
  const fixture = nextFixtureFor(game.state, game.clubId);
  if (!fixture) throw new Error('the test game has no fixture');
  return fixture;
}

describe('the relationship moves, modestly', () => {
  it('warmens when the manager praises him', () => {
    const game = createTestGame('pc-praise');
    const player = squad(game)[0]!;
    withRelationship(game, player.id, { friendship: 50, trust: 50, tension: 10 });
    const before = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const beforeToward = before.personAId === MANAGER_PERSON_ID ? before.bToA : before.aToB;

    ask(game.state, player.id, 'PRAISE');
    const after = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const afterToward = after.personAId === MANAGER_PERSON_ID ? after.bToA : after.aToB;

    // The player warms to the manager, not the other way round: this is what the
    // manager did for him, so it is the player's regard that moves. The praise
    // the game already models moves trust and eases tension rather than
    // friendship, and this conversation is not going to invent its own scale.
    expect(afterToward.trust).toBeGreaterThan(beforeToward.trust);
    expect(afterToward.tension).toBeLessThan(beforeToward.tension);
  });

  it('cools slightly when the manager tells him he has not been picked', () => {
    const game = createTestGame('pc-left-out-rel');
    const player = fit(game, squad(game).length - 1);
    withRelationship(game, player.id, { friendship: 50, trust: 50, tension: 5 });
    const fixture = nextUserFixture(game);
    const side = fixture.homeClubId === game.clubId ? 'home' : 'away';
    fixture.lineups[side].starting = squad(game)
      .filter((p) => p.id !== player.id)
      .slice(0, 5)
      .map((p) => ({ playerId: p.id, position: p.preferredPosition }) as never);
    fixture.lineups[side].bench = [];

    const before = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const beforeToward = before.personAId === MANAGER_PERSON_ID ? before.bToA : before.aToB;
    ask(game.state, player.id, 'DISCUSS_SELECTION');
    const after = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const afterToward = after.personAId === MANAGER_PERSON_ID ? after.bToA : after.aToB;

    // Being left out is worth being unhappy about. In the direction that
    // matters — the player toward the manager — the effect the game already
    // models is less respect and more tension; his *trust* is untouched, which
    // is right: a player who has been left out is annoyed, not convinced the
    // manager is dishonest.
    expect(afterToward.tension).toBeGreaterThan(beforeToward.tension);
    expect(afterToward.respect).toBeLessThan(beforeToward.respect);
  });

  it('keeps every effect small — a conversation is not a season', () => {
    const game = createTestGame('pc-modest');
    const player = squad(game)[2]!;
    withRelationship(game, player.id, { friendship: 50, trust: 50, tension: 0, respect: 50 });
    const before = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const snapshot = { ...(before.personAId === MANAGER_PERSON_ID ? before.bToA : before.aToB) };

    for (let i = 0; i < 5; i += 1) ask(game.state, player.id, 'PRAISE');

    const after = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const moved = after.personAId === MANAGER_PERSON_ID ? after.bToA : after.aToB;
    // Five conversations, and nothing has moved by a visible amount.
    expect(Math.abs(moved.friendship - snapshot.friendship)).toBeLessThan(12);
    expect(Math.abs(moved.trust - snapshot.trust)).toBeLessThan(12);
    expect(moved.friendship).toBeLessThanOrEqual(100);
  });

  it('records the conversation in the relationship history', () => {
    const game = createTestGame('pc-history');
    const player = squad(game)[3]!;
    withRelationship(game, player.id, { friendship: 50 });
    ask(game.state, player.id, 'PRAISE');
    const relationship = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    expect(relationship.history.length).toBeGreaterThan(0);
    expect(relationship.lastInteraction).toBe(game.state.date);
  });
});

describe('follow-ups', () => {
  it('books one on the calendar when a man will not commit', () => {
    const game = createTestGame('pc-follow-up');
    const player = withAvailability(game, 0, 'doubtful');
    const { followUp } = ask(game.state, player.id, 'ASK_AVAILABILITY');

    expect(followUp).not.toBeNull();
    const events = outstandingFollowUps(game.state);
    expect(events).toHaveLength(1);
    expect(events[0]!.playerId).toBe(player.id);
    expect(events[0]!.conversationId).toBe(followUp!.conversationId);
  });

  it('books nothing when the question was answered', () => {
    const game = createTestGame('pc-no-follow-up');
    const player = withAvailability(game, 1, 'available');
    const { followUp } = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(followUp).toBeNull();
    expect(outstandingFollowUps(game.state)).toHaveLength(0);
  });

  it('puts the chase on the manager’s own calendar before the match', () => {
    const game = createTestGame('pc-calendar');
    const player = withAvailability(game, 2, 'doubtful');
    const followUp = bookFollowUp(game.state, 'conversation_1', player.id, 'ASK_AVAILABILITY');
    const event = game.state.schedule.events.find((item) => item.resolvedOn === null && item.personIds.includes(player.id));
    expect(event).toBeDefined();
    expect(event!.source).toBe('player');
    expect(event!.data.conversationId).toBe('conversation_1');
    // The chase must be before the fixture, or it is no use to anybody.
    const fixture = nextUserFixture(game);
    expect(event!.date < fixture.date).toBe(true);
    expect(followUp.date).toBe(event!.date);
  });

  it('asks him again on the day, and reads the answer from today’s record', () => {
    const game = createTestGame('pc-run-follow-up');
    const player = withAvailability(game, 3, 'doubtful');
    ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(outstandingFollowUps(game.state)).toHaveLength(1);

    // By the day of the chase he is fine, and that is what he should say.
    player.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
    withRelationship(game, player.id, { friendship: 60, trust: 55, tension: 0 });
    const due = outstandingFollowUps(game.state)[0]!;
    game.state.date = due.date;

    const done = runDueFollowUps(game.state);
    expect(done).toBe(1);
    expect(outstandingFollowUps(game.state)).toHaveLength(0);

    const conversation = conversationOf(game.state, due.conversationId)!;
    const last = conversation.messages[conversation.messages.length - 1]!;
    expect(last.context.replyState).toMatch(/available/);
  });

  it('leaves a follow-up alone until its day', () => {
    const game = createTestGame('pc-not-due');
    const player = withAvailability(game, 4, 'doubtful');
    ask(game.state, player.id, 'ASK_AVAILABILITY');
    outstandingFollowUps(game.state);
    game.state.date = addDays(game.state.date, -3);
    expect(runDueFollowUps(game.state)).toBe(0);
    expect(outstandingFollowUps(game.state)).toHaveLength(1);
  });

  it('forgets a man who has left the world', () => {
    const game = createTestGame('pc-gone');
    const player = withAvailability(game, 5, 'doubtful');
    ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(outstandingFollowUps(game.state)).toHaveLength(1);

    delete game.state.people[player.id];
    // It is cleaned up rather than thrown at a man who no longer exists.
    expect(runDueFollowUps(game.state)).toBe(0);
  });

  it('closes one by hand when the manager has chased it himself', () => {
    const game = createTestGame('pc-clear');
    const player = withAvailability(game, 6, 'doubtful');
    ask(game.state, player.id, 'ASK_AVAILABILITY');
    const followUp = outstandingFollowUps(game.state)[0]!;
    expect(clearFollowUp(game.state, followUp)).toBe(true);
    expect(outstandingFollowUps(game.state)).toHaveLength(0);
    expect(clearFollowUp(game.state, followUp)).toBe(false);
  });
});

describe('threads', () => {
  it('opens a thread for a player without inventing anything said in it', () => {
    const game = createTestGame('pc-open');
    const player = squad(game)[0]!;
    const id = openPlayerThread(game.state, player.id);
    expect(id).not.toBeNull();
    const conversation = conversationOf(game.state, id!)!;
    expect(conversation.type).toBe('player');
    expect(conversation.participantIds).toContain(player.id);
    // Empty, on purpose: a thread nobody has spoken in yet should say so, not
    // carry a blank message nobody sent.
    expect(conversation.messages).toHaveLength(0);
    // And there is still something to say in it.
    const options = playerResponseOptions(game.state, player.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((o) => o.intent)).toContain('ASK_AVAILABILITY');
  });

  it('offers the fitness question by name when a man is injured', () => {
    const game = createTestGame('pc-injured-option');
    const player = injured(game, 0);
    const option = playerResponseOptions(game.state, player.id).find((o) => o.intent === 'ASK_FITNESS');
    expect(option?.label).toBe('How is the knock?');
    const fitPlayer = withAvailability(game, 1, 'available');
    const plain = playerResponseOptions(game.state, fitPlayer.id).find((o) => o.intent === 'ASK_FITNESS');
    expect(plain?.label).toBe('How are you feeling?');
  });

  it('reuses the one thread rather than starting a second', () => {
    const game = createTestGame('pc-reuse');
    const player = squad(game)[0]!;
    const first = openPlayerThread(game.state, player.id);
    const second = openPlayerThread(game.state, player.id);
    expect(second).toBe(first);
    expect(Object.keys(game.state.communication.conversations)).toHaveLength(1);
  });

  it('says nothing to somebody who is not a player', () => {
    const game = createTestGame('pc-not-player');
    const chairman = game.state.people[game.state.clubs[game.clubId]!.chairmanId!]!;
    expect(openPlayerThread(game.state, chairman.id)).toBeNull();
  });

  it('refuses to send to somebody who has gone', () => {
    const game = createTestGame('pc-vanished');
    const player = squad(game)[0]!;
    delete game.state.people[player.id];
    expect(sendPlayerMessage(game.state, player.id, 'ASK_AVAILABILITY')).toBeNull();
  });

  it('records what each message was for and what came of it', () => {
    const game = createTestGame('pc-record');
    const player = withAvailability(game, 7, 'available');
    const sent = ask(game.state, player.id, 'ASK_AVAILABILITY');
    expect(sent.message.consequence.intent).toBe('ASK_AVAILABILITY');
    expect(sent.message.consequence.targetId).toBe(player.id);
    // A question that has been answered is a closed question: the thread says so
    // rather than leaving a message looking outstanding forever.
    expect(sent.reply!.consequence.outcome).toContain('Answered');
    expect(sent.message.consequence.resolvedOn).toBe(game.state.date);
    expect(sent.message.consequence.outcome).toContain('Answered');
  });
});

describe('a conversation survives a save', () => {
  it('keeps the thread, the messages, the intents and the state they answered', () => {
    const game = createTestGame('pc-save');
    const player = withAvailability(game, 0, 'unavailable');
    ask(game.state, player.id, 'ASK_AVAILABILITY');

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    const rows = Object.values(loaded.communication.conversations);
    expect(rows).toHaveLength(1);
    const conversation = rows[0]!;
    expect(conversation.type).toBe('player');
    expect(conversation.messages.length).toBeGreaterThanOrEqual(2);
    const reply = conversation.messages[conversation.messages.length - 1]!;
    expect(reply.context.replyState).toBe('unavailable');
    expect(reply.consequence.outcome).toContain('unavailable');
  });

  it('keeps an outstanding follow-up across a reload', () => {
    const game = createTestGame('pc-save-follow-up');
    const player = withAvailability(game, 1, 'doubtful');
    ask(game.state, player.id, 'ASK_AVAILABILITY');

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    const outstanding = outstandingFollowUps(loaded);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.playerId).toBe(player.id);
    expect(outstanding[0]!.date).toBe(outstandingFollowUps(game.state)[0]!.date);
  });

  it('keeps the relationship the conversation moved', () => {
    const game = createTestGame('pc-save-relationship');
    const player = squad(game)[0]!;
    withRelationship(game, player.id, { friendship: 50, trust: 50, tension: 10 });
    ask(game.state, player.id, 'PRAISE');

    const loaded = deserialiseGame(serialiseGame(game.state)).state!;
    const before = getRelationship(game.state, MANAGER_PERSON_ID, player.id)!;
    const after = getRelationship(loaded, MANAGER_PERSON_ID, player.id)!;
    const beforeToward = before.personAId === MANAGER_PERSON_ID ? before.bToA : before.aToB;
    const afterToward = after.personAId === MANAGER_PERSON_ID ? after.bToA : after.aToB;
    expect(afterToward.friendship).toBe(beforeToward.friendship);
  });
});

describe('determinism', () => {
  it('writes the same words for the same career, day and question', () => {
    const first = createTestGame('pc-determinism');
    const second = createTestGame('pc-determinism');
    const bodies = [first, second].map((game) => {
      const player = squad(game)[0]!;
      player.availability = { status: 'doubtful', reason: null, note: null, until: null, discoveredLate: false };
      return sendPlayerMessage(game.state, player.id, 'ASK_AVAILABILITY')?.reply?.body ?? '';
    });
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('uses no uncontrolled randomness', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/simulation/communication/playerConversation.ts', 'utf8');
    expect(source).not.toMatch(/Math\.random/);
  });
});
