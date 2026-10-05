import { describe, expect, it } from 'vitest';
import { AVAILABILITY_INTENTS } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import type { AvailabilityReason, AvailabilityStatus, Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { addDays } from '@/simulation/calendar';
import { nextFixtureFor } from '@/simulation/schedule';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { createTestGame, type TestGame } from '../testSupport';
import {
  announceAvailabilityChange,
  availabilityStanding,
  availabilityStandingNote,
  AVAILABILITY_STANDING_LABEL,
  chaseConfirmation,
  messageCanOverwriteAvailability,
} from './availabilityComms';
import {
  outstandingFollowUps,
  runDueFollowUps,
  selectionStatusFor,
  sendPlayerMessage,
} from './playerConversation';
import { findConversation, messagesOf } from './store';

/* --------------------------------------------------------------------- *
 * A world, and a man in it we can move by hand.
 * --------------------------------------------------------------------- */

function world(): TestGame {
  return createTestGame('availability-bridge');
}

function squadOf(game: TestGame): Player[] {
  return game.state.clubs[game.clubId]!.squadIds
    .map((id) => game.state.people[id])
    .filter(isPlayer);
}

function setAvailability(player: Player, status: AvailabilityStatus, reason: AvailabilityReason, note: string): void {
  player.availability = { status, reason, note, until: null, discoveredLate: false };
}

function inbound(state: GameState, playerId: PersonId) {
  const conversation = findConversation(state, [playerId], { type: 'player' });
  if (!conversation) return [];
  return messagesOf(state, conversation.id).filter((message) => message.direction === 'inbound');
}

/* --------------------------------------------------------------------- */

describe('the standing the manager sees', () => {
  it('says a man who is available is available', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'available', 'work', '');
    expect(availabilityStanding(state, player.id)).toBe('fit');
    expect(AVAILABILITY_STANDING_LABEL.fit).toBe('Available');
  });

  it('says a man who is out is confirmed unavailable, whatever he says', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'unavailable', 'work', 'On the early shift');
    expect(availabilityStanding(state, player.id)).toBe('unavailable');
    expect(AVAILABILITY_STANDING_LABEL.unavailable).toBe('Confirmed unavailable.');
  });

  it('calls a doubt pending until the manager has put it to him', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');

    // Nobody has said anything yet: the manager knows he is a doubt and has not
    // heard from him, which is a fourth state the availability model has no
    // name for.
    expect(availabilityStanding(state, player.id)).toBe('pending');
    expect(AVAILABILITY_STANDING_LABEL.pending).toBe('Awaiting player confirmation.');

    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });
    expect(availabilityStanding(state, player.id)).toBe('pending');

    // Once he has answered — even vaguely — the standing becomes doubtful,
    // which says he expects to play and that nobody has promised.
    sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    expect(availabilityStanding(state, player.id)).toBe('doubtful');
    expect(AVAILABILITY_STANDING_LABEL.doubtful).toBe('Doubtful — player says they expect to play.');
  });

  it('has a line to say for every state', () => {
    for (const standing of ['fit', 'doubtful', 'pending', 'unavailable'] as const) {
      expect(AVAILABILITY_STANDING_LABEL[standing]).toMatch(/\S/);
      expect(availabilityStandingNote(standing, 'work', null)).toMatch(/\S/);
    }
  });

  it('returns nothing for somebody who is not a player', () => {
    const state = world().state;
    const official = Object.values(state.people).find((person) => person.kind === 'official');
    if (!official) throw new Error('no official in the world');
    expect(availabilityStanding(state, official.id)).toBeNull();
    expect(availabilityStanding(state, 'nobody-at-all')).toBeNull();
  });
});

/* --------------------------------------------------------------------- */

describe('a man tells the manager when his Sunday changes', () => {
  it('writes to him when he becomes doubtful', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Something is not right with his knee');

    const message = announceAvailabilityChange(state, player.id, {
      kind: 'doubts',
      reason: 'injury',
      note: 'Something is not right with his knee',
    });

    expect(message).not.toBeNull();
    expect(message!.direction).toBe('inbound');
    expect(message!.senderId).toBe(player.id);
    expect(message!.context.announced).toBe('yes');
    expect(message!.context.availability).toBe('doubtful');
    // Doubtful leaves the door open. The wording says so, so the manager is not
    // left reading "cannot play" into an uncertainty.
    expect(message!.context.certain).toBe('no');
    expect(message!.read).toBe(false);
    expect(availabilityStanding(state, player.id)).toBe('pending');
  });

  it('writes to him when he becomes unavailable, and says so plainly', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'unavailable', 'family', 'Family do he cannot get out of');

    const message = announceAvailabilityChange(state, player.id, {
      kind: 'loses',
      reason: 'family',
      note: 'Family do he cannot get out of',
    });

    expect(message!.context.availability).toBe('unavailable');
    expect(message!.context.certain).toBe('yes');
    expect(availabilityStanding(state, player.id)).toBe('unavailable');
  });

  it('talks about the reason the roll gave, not a knee he does not have', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;

    setAvailability(player, 'unavailable', 'work', 'Shift changed');
    const work = announceAvailabilityChange(state, player.id, {
      kind: 'loses',
      reason: 'work',
      note: 'Shift changed',
    })!;

    setAvailability(player, 'doubtful', 'family', 'Family do');
    const family = announceAvailabilityChange(state, player.id, {
      kind: 'doubts',
      reason: 'family',
      note: 'Family do',
    })!;

    expect(work.body.toLowerCase()).toContain('work');
    expect(work.body.toLowerCase()).not.toContain('knee');
    expect(family.body.toLowerCase()).toContain('family');
  });

  it('says nothing about becoming available again', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'available', 'personal', 'Sorted itself out');
    // A man does not text his manager to say he feels better; the roll already
    // wrote that into the news, and a second line about it is noise.
    expect(announceAvailabilityChange(state, player.id, { kind: 'clears', reason: 'personal', note: 'Sorted' })).toBeNull();
    expect(inbound(state, player.id)).toHaveLength(0);
  });

  it('says nothing about another club’s man', () => {
    const state = world().state;
    const other = Object.values(state.people).find(
      (person): person is Player => isPlayer(person) && person.clubId !== state.userClubId,
    );
    if (!other) throw new Error('no rival player in the world');
    setAvailability(other, 'unavailable', 'work', 'Shift changed');
    expect(announceAvailabilityChange(state, other.id, { kind: 'loses', reason: 'work', note: 'Shift' })).toBeNull();
  });

  it('says nothing about somebody who has left the world', () => {
    const state = world().state;
    expect(
      announceAvailabilityChange(state, 'a-man-who-never-existed', {
        kind: 'loses',
        reason: 'work',
        note: 'Shift',
      }),
    ).toBeNull();
  });
});

/* --------------------------------------------------------------------- */

describe('the manager is not written to twice about the same thing', () => {
  it('writes one message for one change, however many times the day is processed', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const announcement = { kind: 'doubts' as const, reason: 'injury' as const, note: 'Knee' };

    expect(announceAvailabilityChange(state, player.id, announcement)).not.toBeNull();
    // A reloaded save, an undo, a calendar entry visited twice.
    expect(announceAvailabilityChange(state, player.id, announcement)).toBeNull();
    expect(announceAvailabilityChange(state, player.id, announcement)).toBeNull();
    expect(inbound(state, player.id)).toHaveLength(1);
  });

  it('does write again when the same man changes a week later, because that is a different event', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });

    state.date = '2026-07-27';
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const second = announceAvailabilityChange(state, player.id, {
      kind: 'doubts',
      reason: 'injury',
      note: 'Knee',
    });
    expect(second).not.toBeNull();
    expect(inbound(state, player.id)).toHaveLength(2);
  });

  it('books one chase per thread, however often the manager asks', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });

    sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    expect(outstandingFollowUps(state)).toHaveLength(1);

    sendPlayerMessage(state, player.id, 'ASK_CONFIRMATION');
    sendPlayerMessage(state, player.id, 'ASK_CONFIRMATION');
    // One Saturday to chase him on, not three.
    expect(outstandingFollowUps(state)).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------- */

describe('the manager chases', () => {
  it('does nothing when there is nothing outstanding', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'available', 'work', '');
    expect(chaseConfirmation(state, player.id)).toBeNull();
  });

  it('asks a pending man to confirm, and reads the answer off today’s record', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });

    const chase = chaseConfirmation(state, player.id);
    expect(chase).not.toBeNull();
    expect(chase!.message.consequence.intent).toBe('ASK_CONFIRMATION');
    // A reply that describes a different state than the record would be the
    // system arguing with itself.
    expect(chase!.reply!.context.availability).toBe('doubtful');
    expect(availabilityStanding(state, player.id)).toBe('doubtful');
  });

  it('does not chase a man who has already been chased', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });

    expect(chaseConfirmation(state, player.id)).not.toBeNull();
    // He has answered now, so the standing has moved on and there is nothing
    // left to press him about.
    expect(chaseConfirmation(state, player.id)).toBeNull();
  });
});

/* --------------------------------------------------------------------- */

describe('the follow-up', () => {
  it('is booked on the calendar when a man will not commit', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const sent = sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');

    expect(sent!.followUp).not.toBeNull();
    const fixture = nextFixtureFor(state, state.userClubId);
    if (fixture) expect(sent!.followUp!.date < fixture.date).toBe(true);
    expect(outstandingFollowUps(state)).toHaveLength(1);
  });

  it('books nothing when the man has committed', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'available', 'work', '');
    const sent = sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    expect(sent!.followUp).toBeNull();
    expect(outstandingFollowUps(state)).toHaveLength(0);
  });

  it('leaves a man alone until the day it booked', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const sent = sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    const due = sent!.followUp!.date;

    expect(runDueFollowUps(state, addDays(state.date, -1))).toBe(0);
    expect(outstandingFollowUps(state)).toHaveLength(1);
    expect(runDueFollowUps(state, due)).toBe(1);
  });

  it('writes to him on the day it booked, in his own words', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const sent = sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    const before = messagesOf(state, sent!.message.conversationId).length;

    runDueFollowUps(state, sent!.followUp!.date);
    const after = messagesOf(state, sent!.message.conversationId);
    expect(after.length).toBe(before + 2);
    expect(after.at(-1)!.senderId).toBe(player.id);
  });

  it('answers from the record as it stands on the day, not from the one he gave on Monday', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const sent = sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');

    // By Saturday he has got himself fit.
    setAvailability(player, 'available', 'work', '');
    runDueFollowUps(state, sent!.followUp!.date);

    const thread = messagesOf(state, sent!.message.conversationId);
    expect(thread.at(-1)!.context.availability).toBe('available');
    expect(availabilityStanding(state, player.id)).toBe('fit');
  });
});

/**
 * Save and load through the game's own serialiser — the same code path a
 * reload takes, minus the browser's storage, which is what the other
 * persistence suites use.
 */
function roundTrip(state: GameState): GameState {
  const loaded = deserialiseGame(serialiseGame(state));
  if (!loaded.state) throw new Error(`the save did not load: ${loaded.error}`);
  return loaded.state;
}

/* --------------------------------------------------------------------- */

describe('the availability simulation stays the authority', () => {
  it('does not move a man when he says he will be fine', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'unavailable', 'work', 'On the early shift');

    // A man told he is out says he is out, and the record is unchanged by the
    // conversation either way. What changed is that the manager has now asked.
    sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    expect(player.availability.status).toBe('unavailable');
    expect(player.availability.reason).toBe('work');
  });

  it('does not move a man when he says he expects to play', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    sendPlayerMessage(state, player.id, 'ASK_CONFIRMATION');
    expect(player.availability.status).toBe('doubtful');
  });

  it('refuses, in as many words, to let a message overwrite availability', () => {
    expect(messageCanOverwriteAvailability()).toBe(false);
  });

  it('does not select anybody, however uncertain the man is', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    const before = selectionStatusFor(state, player);

    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });
    chaseConfirmation(state, player.id);
    sendPlayerMessage(state, player.id, 'DISCUSS_SELECTION');

    // Whether to take a doubt is the manager's call and nobody else's. Nothing
    // in this layer can move a man into a side.
    expect(selectionStatusFor(state, player)).toBe(before);
  });

  it('writes the record itself when the roll does, and the communication follows', () => {
    // The authority is the roll: here the record is changed directly, exactly
    // as `applyDailyLife` does, and the conversation picks it up from there.
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'available', 'work', '');
    expect(availabilityStanding(state, player.id)).toBe('fit');

    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });
    expect(availabilityStanding(state, player.id)).toBe('pending');
  });
});

/* --------------------------------------------------------------------- */

describe('it survives a save', () => {
  it('keeps the announcement, the doubt and the outstanding chase', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });
    const sent = sendPlayerMessage(state, player.id, 'ASK_AVAILABILITY');
    const before = messagesOf(state, sent!.message.conversationId);

    const loaded = roundTrip(state);

    expect(availabilityStanding(loaded, player.id)).toBe('doubtful');
    expect(outstandingFollowUps(loaded)).toHaveLength(1);
    const conversation = findConversation(loaded, [player.id], { type: 'player' })!;
    expect(messagesOf(loaded, conversation.id)).toEqual(before);
  });

  it('still does not write to him twice after a reload', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });

    const loaded = roundTrip(state);

    // The delivery key survived, so replaying the same day writes nothing.
    expect(
      announceAvailabilityChange(loaded, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' }),
    ).toBeNull();
    expect(inbound(loaded, player.id)).toHaveLength(1);
  });

  it('crosses a day boundary carrying the standing with it', () => {
    const game = world();
    const state = game.state;
    const player = squadOf(game)[0]!;
    setAvailability(player, 'doubtful', 'injury', 'Knee');
    announceAvailabilityChange(state, player.id, { kind: 'doubts', reason: 'injury', note: 'Knee' });

    state.date = '2026-07-22';
    const loaded = roundTrip(state);

    expect(loaded.date).toBe('2026-07-22');
    expect(availabilityStanding(loaded, player.id)).toBe('pending');
  });
});

/* --------------------------------------------------------------------- */

describe('determinism', () => {
  it('writes the same words for the same career, day and man', () => {
    const first = world();
    const second = world();
    const playerA = squadOf(first)[3]!;
    const playerB = squadOf(second)[3]!;
    setAvailability(playerA, 'doubtful', 'injury', 'Knee');
    setAvailability(playerB, 'doubtful', 'injury', 'Knee');

    const announcement = { kind: 'doubts' as const, reason: 'injury' as const, note: 'Knee' };
    expect(announceAvailabilityChange(first.state, playerA.id, announcement)!.body).toBe(
      announceAvailabilityChange(second.state, playerB.id, announcement)!.body,
    );
  });

  it('uses no uncontrolled randomness', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/simulation/communication/availabilityComms.ts', 'utf8');
    // Comments may name it; code may not call it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('Math.random');
  });

  it('has every availability intent counted as one', () => {
    expect(AVAILABILITY_INTENTS).toEqual([
      'ASK_AVAILABILITY',
      'ASK_FITNESS',
      'ASK_CONFIRMATION',
      'ASK_UPDATE',
    ]);
  });
});