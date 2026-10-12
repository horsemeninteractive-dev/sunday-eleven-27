import { describe, expect, it } from 'vitest';
import type { GameEventType, NewsCategory } from '@/domain/news';
import { NEWS_PLATE_PATHS } from './components/NewsPlate';
import {
  bylineOf,
  fixtureForStory,
  labelForStory,
  paragraphsOf,
  plateForStory,
  resultForStory,
  toneForConfidence,
} from './newsStory';

/**
 * What a story is about, and how the paper draws it.
 *
 * Four decisions and one rule are pinned here, and they are the things that can
 * be *wrong* about an editorial choice rather than merely arguable:
 *
 *   - a kind of event the paper cannot draw or cannot name;
 *   - a picture chosen from the column a story was filed in rather than from what
 *     happened, which is the fault the whole set was rebuilt to fix;
 *   - a score printed for football nobody has played, which is the one lie this
 *     screen could tell that a manager would have no way of catching;
 *   - half a masthead — a reporter's name with no paper behind it, or a paper
 *     with nobody's name on the story;
 *   - a claim drawn in the same ink as a fact, which is the one thing the local
 *     press exists in this game not to do.
 */

/** Every kind of event the simulation publishes. See `GameEventType`. */
const EVENT_TYPES: GameEventType[] = [
  'match-result', 'goal-milestone', 'appearance-milestone', 'injury', 'player-unavailable',
  'player-signed', 'player-released', 'league-movement', 'cup-draw', 'cup-result',
  'notable-result', 'finances-warning', 'finances-positive', 'availability-crisis', 'club-news',
  'dressing-room', 'recruitment', 'player-approach', 'training', 'development',
  'referee-assigned', 'weather-warning', 'season-milestone', 'postponement', 'forfeit',
  'club-event', 'social', 'world', 'calendar', 'press-rumour', 'press-verdict',
];

/**
 * The columns, as the simulation files them.
 *
 * Held here rather than imported, because the point of these cases is that the
 * *event* decides the picture whatever column the event was filed in — so each
 * one names a column the simulation really uses for it, and the drawing has to
 * come out the same regardless.
 */
const COLUMN: Record<GameEventType, NewsCategory> = {
  'match-result': 'Match',
  'goal-milestone': 'Squad',
  'appearance-milestone': 'Squad',
  injury: 'Squad',
  'player-unavailable': 'Squad',
  'player-signed': 'Squad',
  'player-released': 'Squad',
  'league-movement': 'League',
  'cup-draw': 'League',
  'cup-result': 'League',
  'notable-result': 'League',
  'finances-warning': 'Finances',
  'finances-positive': 'Finances',
  'availability-crisis': 'Squad',
  'club-news': 'Club',
  'dressing-room': 'Squad',
  recruitment: 'Squad',
  'player-approach': 'Squad',
  training: 'Squad',
  development: 'Squad',
  'referee-assigned': 'Match',
  'weather-warning': 'Match',
  'season-milestone': 'League',
  postponement: 'Match',
  forfeit: 'Match',
  'club-event': 'Club',
  social: 'Club',
  world: 'World',
  calendar: 'Club',
  // The press files both of these in the county column: a claim somebody printed
  // and the answer to it are news from around the local game rather than news
  // about one club's squad or books.
  'press-rumour': 'World',
  'press-verdict': 'World',
};

describe('a story knows what happened, not just which column it is in', () => {
  it('has a picture and a name for every kind of event the game publishes', () => {
    for (const eventType of EVENT_TYPES) {
      const item = { eventType, category: COLUMN[eventType] };
      const plate = plateForStory(item);
      // The mapper and the drawing set cannot drift: a story that chose a picture
      // nobody drew would render an empty sheet rather than fail.
      expect(NEWS_PLATE_PATHS[plate], `${eventType} chose a picture that is not drawn`).toBeDefined();
      expect(NEWS_PLATE_PATHS[plate].length, `${eventType} → ${plate}`).toBeGreaterThanOrEqual(4);
      const label = labelForStory(item);
      expect(label, eventType).toBeTruthy();
      // A kicker, not a sentence: it is set in small caps in a row with the
      // competition and the date.
      expect(label.length, `${eventType} → "${label}"`).toBeLessThanOrEqual(14);
    }
  });

  it('factors thirty-one events into the thirteen kinds of story a paper actually has', () => {
    // Not twenty-nine pictures and not six: events that are the same story to a
    // manager share one, and events that are different stories do not. This is a
    // bound rather than an exact set, because which events group is a judgement —
    // that there are more than the columns and fewer than the events is not.
    const drawn = new Set(EVENT_TYPES.map((eventType) => plateForStory({ eventType, category: COLUMN[eventType] })));
    expect(drawn.size).toBeGreaterThan(6);
    expect(drawn.size).toBeLessThan(EVENT_TYPES.length);
  });

  it('draws the cup, the league and a called-off fixture differently', () => {
    const cup = plateForStory({ eventType: 'cup-result', category: 'League' });
    const league = plateForStory({ eventType: 'league-movement', category: 'League' });
    const off = plateForStory({ eventType: 'postponement', category: 'Match' });
    const match = plateForStory({ eventType: 'match-result', category: 'Match' });
    // A cup tie is filed in the league column by the simulation. It is not a
    // league story, and the drawing is where that has to be visible: a cup final
    // on the front page wearing the league's trophy would be the paper getting
    // the competition wrong.
    expect(cup).toBe('Cup');
    expect(league).toBe('League');
    expect(cup).not.toBe(league);
    expect(off).toBe('CalledOff');
    expect(off).not.toBe(match);
  });

  it('draws a signing as a player and not as the squad', () => {
    // `player-signed` is filed in the Squad column, which is why a signing used
    // to be drawn as three anonymous men. A man arriving is its own story.
    const signing = plateForStory({ eventType: 'player-signed', category: 'Squad' });
    expect(signing).toBe('Transfer');
    expect(signing).not.toBe('Squad');
    // And leaving is the same kind of story, because it is: a name in the squad
    // list changed. The label is what says which way it went.
    expect(plateForStory({ eventType: 'player-released', category: 'Squad' })).toBe(signing);
    expect(labelForStory({ eventType: 'player-signed', category: 'Squad' })).not.toBe(
      labelForStory({ eventType: 'player-released', category: 'Squad' }),
    );
  });

  it('tells a training night, an injury and a row apart from each other', () => {
    const plates = (['training', 'injury', 'dressing-room'] as GameEventType[]).map((eventType) =>
      plateForStory({ eventType, category: 'Squad' }),
    );
    // All three are filed in the Squad column in the same week, and they are
    // three different things happening to three different people.
    expect(new Set(plates).size).toBe(3);
  });

  it('never draws a claim and a settled fact as the same kind of story', () => {
    // The paper's whole relationship with a rumour is that it does not pretend to
    // know: a claim wears one drawing and one word, and what the world did with
    // that claim wears another of each. A reader glancing down the board has to be
    // able to tell which of the two he is looking at without opening either.
    const claim = { eventType: 'press-rumour' as GameEventType, category: 'World' as NewsCategory };
    const settled = { eventType: 'press-verdict' as GameEventType, category: 'World' as NewsCategory };
    expect(plateForStory(claim)).not.toBe(plateForStory(settled));
    expect(labelForStory(claim)).not.toBe(labelForStory(settled));
    // And neither is drawn as the column it is filed in, which is the whole point
    // of the event type travelling with the item.
    expect(plateForStory(claim)).not.toBe('World');
    // What it *is* — talk, printed — is the drawing it shares with the other
    // thing somebody said rather than wrote down.
    expect(plateForStory(claim)).toBe('Rows');
    expect(labelForStory(claim)).toBe('Rumour');
    expect(labelForStory(settled)).toBe('Settled');
  });

  it('falls back to the column for a story written before it knew what it was', () => {
    // A career saved before the event type travelled with the item. Missing is
    // not corrupt: the story draws the picture the paper drew for everything.
    for (const category of ['Match', 'Squad', 'Club', 'League', 'World', 'Finances'] as NewsCategory[]) {
      expect(plateForStory({ category })).toBe(category);
      expect(labelForStory({ category })).toBe(category);
    }
  });

  it('falls back to the column, and says only the column, for an event type it has never heard of', () => {
    // A save from a newer build, or a type added to the union without a decision
    // here — the `Record` is what stops the second one at the build, and this is
    // what stops the first one at the front page.
    const stranger = { eventType: 'a-type-from-a-newer-build' as GameEventType, category: 'Club' as NewsCategory };
    // The column's picture, because it is drawn.
    expect(plateForStory(stranger)).toBe('Club');
    // And the column's *name*, not the label of some event we guessed it might
    // be: a paper that cannot say what happened says which part of the paper the
    // story is in rather than inventing the sentence above its own headline.
    expect(labelForStory(stranger)).toBe('Club');
  });
});

describe('a story says who wrote it, and how much of it is fact', () => {
  it('names the reporter and the paper, and only when it has both', () => {
    // `outlet` and `byline` travel together: a story was filed or it was not. A
    // paper that printed a name with no paper beside it, or a paper with no name,
    // would be half a masthead, so neither is printed at all.
    expect(bylineOf({ byline: 'Jean Marlow', outlet: 'The Granton Gazette' })).toBe(
      'By Jean Marlow, The Granton Gazette',
    );
    expect(bylineOf({})).toBeNull();
    expect(bylineOf({ byline: 'Jean Marlow' })).toBeNull();
    expect(bylineOf({ outlet: 'The Granton Gazette' })).toBeNull();
  });

  it('draws a claim as a claim, and a correction quietly', () => {
    // Three tones, four standings, and the two that are not facts share one: a
    // claim that was wrong and a claim that stopped mattering are both a story
    // about nothing much, and neither is bad news.
    expect(toneForConfidence('unverified')).toBe('warn');
    expect(toneForConfidence('confirmed')).toBe('ok');
    expect(toneForConfidence('disproved')).toBe('muted');
    expect(toneForConfidence('stale')).toBe('muted');
  });
});

describe('a body is paragraphs, and a blank line is where the paper breaks', () => {
  it('splits on blank lines, trims them, and drops the empties', () => {
    expect(paragraphsOf({ body: 'One.\n\n  Two.  \n\n\n\nThree.\n' })).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('reads a body written as one paragraph as one paragraph', () => {
    // Every body the writers produce today is joined sentences, so this is the
    // common case: the lead sets it as body copy rather than blowing one long
    // line up to standfirst size with nothing under it.
    expect(paragraphsOf({ body: 'One sentence. And another.' })).toEqual(['One sentence. And another.']);
    expect(paragraphsOf({ body: '' })).toEqual([]);
  });
});

describe('a story with a match is never given a result it does not have', () => {
  const matches = { played: { played: true }, toPlay: { played: false }, nowhere: undefined };

  it('hands out the match as a result only when it has been played', () => {
    expect(resultForStory(matches, { matchId: 'played' })).toEqual({ played: true });
    expect(resultForStory(matches, { matchId: 'toPlay' })).toBeNull();
  });

  it('hands out the tie as a fixture only when it has not', () => {
    expect(fixtureForStory(matches, { matchId: 'toPlay' })).toEqual({ played: false });
    expect(fixtureForStory(matches, { matchId: 'played' })).toBeNull();
  });

  it('is the same match, asked from both ends, and never both at once', () => {
    // A draw points at the tie it drew; a result points at the match it came out
    // of. `MatchScoreline` draws the score a match is currently at, so a drawn
    // tie handed over as a result would print **0–0** on the front page of a
    // paper about a game nobody has played. Both readers read `played` and
    // nothing else, and this is that rule.
    for (const matchId of ['played', 'toPlay']) {
      const asResult = resultForStory(matches, { matchId });
      const asFixture = fixtureForStory(matches, { matchId });
      expect(Boolean(asResult) !== Boolean(asFixture), matchId).toBe(true);
    }
  });

  it('says nothing at all about a story that is not about a match', () => {
    expect(resultForStory(matches, { matchId: null })).toBeNull();
    expect(fixtureForStory(matches, { matchId: null })).toBeNull();
    // And nothing about a match the save no longer holds, rather than throwing
    // on the front page of a career that has been migrated.
    expect(resultForStory(matches, { matchId: 'gone' })).toBeNull();
    expect(fixtureForStory(matches, { matchId: 'gone' })).toBeNull();
  });
});
