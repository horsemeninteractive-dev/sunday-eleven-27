import { describe, expect, it } from 'vitest';
import { isPlayer } from '@/domain/person';
import { createTestGame } from '@/simulation/testSupport';
import { conversationOf } from '@/simulation/communication/store';
import { sendFromPerson, threadWith } from '@/simulation/communication/system';
import { HOME_MATTER_LIMIT, clubMatters, type ClubMatter } from './clubMatters';
import { homeBriefing, leadMatter, matterActionLabel, waitingLine } from './homeBriefing';
import { inboxRows } from './inboxState';

/**
 * How Home reads the club.
 *
 * Three rules, and they are the three a screen like this can get *wrong* rather
 * than merely argue about:
 *
 *   - the front of the screen is the loudest genuine **decision**, not merely the
 *     row the model happened to weight highest;
 *   - nothing the model produced is invented, dropped or drawn twice;
 *   - the mail that is already a card is not counted again as a quiet line, and
 *     the quiet line is not drawn at all when there is none.
 *
 * The rows in the first two cases are typed rather than generated, because the
 * argument is about the *rule* and a generated career is a moving target; the
 * last three are checked against a real career, because the rule there is about
 * what the game actually produces.
 */

function matter(over: Partial<ClubMatter> & Pick<ClubMatter, 'id'>): ClubMatter {
  return {
    tone: 'warn',
    label: 'Worth a look',
    title: 'A thing',
    detail: 'What it means.',
    topic: over.id,
    weight: 50,
    ...over,
  };
}

describe('which matter goes in front', () => {
  it('puts a decision in front of a note, even when the note outweighs it', () => {
    // Weight is the model's order, and a note can genuinely outweigh a decision:
    // "there is money in a night" is a good idea filed above "a man is out",
    // which is a problem. The front of Home is not the model's order — it is the
    // loudest *decision*, because a band with a button on it is a decision's
    // shape, and a manager cannot press "for information".
    const note = matter({ id: 'fundraising', tone: 'info', weight: 58 });
    const decision = matter({ id: 'unavailable', tone: 'warn', weight: 50 });
    expect(leadMatter([note, decision])).toBe(decision);
  });

  it('leads with a note only when there is nothing else, and with nothing when there is none', () => {
    const note = matter({ id: 'kit', tone: 'info', weight: 42 });
    expect(leadMatter([note])).toBe(note);
    expect(leadMatter([])).toBeNull();
  });

  it('takes its rows from the shared club-matters model, in the model’s own order', () => {
    const { state } = createTestGame('home-briefing-order');
    const briefing = homeBriefing(state);
    const shown = clubMatters(state, HOME_MATTER_LIMIT);
    // Nothing invented, nothing lost, nothing twice: the same rows in the same
    // order, with one of them lifted to the front.
    expect([briefing.lead, ...briefing.rest].map((row) => row?.id)).toEqual(shown.map((row) => row.id));
    expect(new Set([briefing.lead, ...briefing.rest].map((row) => row?.id)).size).toBe(shown.length);
    if (briefing.lead) expect(briefing.lead.tone).not.toBe('info');
  });

  it('counts what the limit kept off the screen, so the door can say how much', () => {
    const { state } = createTestGame('home-briefing-beyond');
    const club = state.clubs[state.userClubId]!;
    // Two matters from two different systems, so the arithmetic below is the
    // arithmetic rather than a hope about what a generated career carries: the
    // club is in the red, and two of the squad are thoroughly fed up.
    club.finances.balance = -50;
    for (const id of club.squadIds.slice(0, 2)) {
      const person = state.people[id];
      if (isPlayer(person)) person.morale = 10;
    }

    const all = clubMatters(state, 0);
    expect(all.length).toBeGreaterThan(1);

    const one = homeBriefing(state, 1);
    expect(one.lead).toBeTruthy();
    expect(one.rest).toHaveLength(0);
    expect(one.beyond).toBe(all.length - 1);

    // Home's own limit is the model's four, and the door says how many are past
    // it rather than offering a list it has already refused to draw.
    expect(homeBriefing(state).beyond).toBe(Math.max(0, all.length - HOME_MATTER_LIMIT));
  });
});

describe('the post that is not asking for anything', () => {
  function squadIds(state: ReturnType<typeof createTestGame>['state']): string[] {
    return state.clubs[state.userClubId]!.squadIds;
  }

  it('says nothing at all when nothing is waiting', () => {
    const { state } = createTestGame('home-briefing-quiet');
    expect(homeBriefing(state).waiting).toBeNull();
  });

  it('counts the unread threads and the messages inside them separately', () => {
    const { state } = createTestGame('home-briefing-waiting');
    const [first, second] = squadIds(state);
    const one = threadWith(state, first!);
    const two = threadWith(state, second!);
    sendFromPerson(state, one.id, first!, { body: 'One.' });
    sendFromPerson(state, one.id, first!, { body: 'Two.' });
    sendFromPerson(state, two.id, second!, { body: 'Three.' });

    expect(homeBriefing(state).waiting).toEqual({ threads: 2, messages: 3 });
    // Counted through the inbox's own reading rather than a second one of Home's:
    // six things to read is one job and six threads is six, and the number on the
    // line has to be the number of rows the screen it points at will draw.
    expect(inboxRows(state).filter((row) => row.unread > 0 && !row.attention)).toHaveLength(2);
  });

  it('leaves the mail that is already a card to the card that carries it', () => {
    const { state } = createTestGame('home-briefing-flagged');
    const [man] = squadIds(state);
    const conversation = threadWith(state, man!);
    sendFromPerson(state, conversation.id, man!, { body: 'The account is empty.' });
    // Flagged the way the club's own correspondence is flagged: the last word is
    // urgent, which is the test the model uses to decide whether a thread is
    // asking for the manager.
    const thread = conversationOf(state, conversation.id)!;
    thread.messages[thread.messages.length - 1]!.priority = 'urgent';

    expect(clubMatters(state, 0).some((row) => row.topic === `thread:${conversation.id}`)).toBe(true);
    // Told once: the card above says it, so the quiet line does not.
    expect(homeBriefing(state).waiting).toBeNull();
  });
});

describe('the words on the button and beside the post', () => {
  it('names what pressing a matter actually does, rather than saying "open"', () => {
    expect(matterActionLabel({ destination: { kind: 'conversation', conversationId: 'c1' } })).toBe('Read the message');
    expect(matterActionLabel({ destination: { kind: 'person', personId: 'p1' } })).toBe('Have a word');
    expect(matterActionLabel({ destination: { kind: 'view', view: 'finances' } })).toBe('Sort it out');
    // A matter with nowhere to go still answers with a word; the view draws no
    // button for it, which is where that case is handled.
    expect(matterActionLabel({})).toBe('Sort it out');
  });

  it('says how much post is waiting without promising more than it knows', () => {
    // "None of them urgent" is the claim the data supports — the priorities are
    // urgent, important, normal and social. It deliberately does not say nothing
    // in there wants an answer, because an ordinary note can still ask a question.
    expect(waitingLine({ threads: 1, messages: 1 })).toBe('A thread is waiting: 1 unread message, none of them urgent.');
    expect(waitingLine({ threads: 3, messages: 7 })).toBe('3 threads are waiting: 7 unread messages, none of them urgent.');
  });
});
