import type { GameEventType, NewsCategory, NewsItem } from '@/domain/news';
import type { RumourStatus } from '@/domain/press';
import type { NewsPlateKey } from './components/NewsPlate';

/**
 * What a story is about, and how the paper draws it.
 *
 * The decisions here are the news screen's *editorial* ones, and they live in a
 * file of their own for the same reason `face.ts` decides what a man looks like
 * and `Portrait.tsx` turns it into SVG: a decision about what something means is
 * easier to check, and to argue with, when it is not tangled up in markup. This
 * file holds no JSX and reads no store, so every rule below can be tested with
 * two lines of plain data — see `newsStory.test.ts`.
 *
 * Two things are decided, and they are the two a reader notices first:
 *
 *   - **the picture**, from what actually happened rather than from the column
 *     the story was filed in;
 *   - **the label**, which is the line of small caps above the headline, and
 *     which is the only place the story's kind is ever spelled out.
 *
 * Both are total maps over `GameEventType`. That is deliberate and it is the one
 * piece of discipline this file relies on: adding a new kind of event to the
 * simulation stops the build here until somebody has decided whether it is its
 * own kind of story or one of the ones that already have a picture, which is a
 * better moment to have that argument than in front of a screen of identical
 * cards.
 */

/**
 * The picture a story wears.
 *
 * Thirty-one events, thirteen drawings. Where two events share one it is
 * because they are the same story to the manager — a signing and a release are
 * both "a name moved", which the label then says the direction of — and where
 * two *don't* share one it is because the difference is the story: a league
 * season and a cup tie are the two competitions the game runs, and a
 * postponement is the absence of football rather than a kind of it.
 *
 * The local press arrived with two more kinds of story and no new drawings: a
 * claim somebody printed and the same claim once the world has settled it. Both
 * already had a picture in the set — one is something said, and the other is news
 * from around the county — but they deliberately do not share *one*, because a
 * rumour and a fact are the two things this paper must never let a reader
 * confuse. See `NewsView`, which says the same thing again in words.
 */
const PLATE_BY_EVENT: Record<GameEventType, NewsPlateKey> = {
  'match-result': 'Match',
  'notable-result': 'Match',
  'referee-assigned': 'Match',
  'weather-warning': 'Match',
  'goal-milestone': 'Milestone',
  'appearance-milestone': 'Milestone',
  'season-milestone': 'Milestone',
  // A man visibly better at something after weeks of Thursdays is an achievement
  // as far as the paper is concerned, and it reads as one on a medal.
  development: 'Milestone',
  injury: 'Absence',
  'player-unavailable': 'Absence',
  'availability-crisis': 'Absence',
  'player-signed': 'Transfer',
  'player-released': 'Transfer',
  recruitment: 'Transfer',
  'player-approach': 'Transfer',
  'cup-draw': 'Cup',
  'cup-result': 'Cup',
  'league-movement': 'League',
  'finances-warning': 'Finances',
  'finances-positive': 'Finances',
  'club-news': 'Club',
  'club-event': 'Club',
  social: 'Club',
  calendar: 'Club',
  'dressing-room': 'Rows',
  training: 'Training',
  postponement: 'CalledOff',
  forfeit: 'CalledOff',
  world: 'World',
  // A whisper: something said, wearing the same drawing a dressing-room row
  // does, because a claim printed from somebody's word of mouth is talk rather
  // than football — and the label says whose talk it is.
  'press-rumour': 'Rows',
  // And what became of it: news from around the county, which is where an
  // answered question about somebody's manager, books or centre-forward belongs.
  'press-verdict': 'World',
};

/**
 * The line above the headline.
 *
 * Short, because it is set in small caps in a row with the competition and the
 * date, and honest, because it is the only place the paper claims what a story
 * is: "Signed" on a story about a man arriving, "Unavailable" on one about a man
 * who cannot play. It never says more than the event type does — there is no
 * "Injury blow" here, because how bad it is belongs in the headline the
 * simulation already wrote.
 */
const LABEL_BY_EVENT: Record<GameEventType, string> = {
  'match-result': 'Match',
  'notable-result': 'Result',
  'referee-assigned': 'Officials',
  'weather-warning': 'Weather',
  'goal-milestone': 'Milestone',
  'appearance-milestone': 'Milestone',
  'season-milestone': 'Milestone',
  development: 'Progress',
  injury: 'Injury',
  'player-unavailable': 'Unavailable',
  'availability-crisis': 'Squad crisis',
  'player-signed': 'Signed',
  'player-released': 'Released',
  recruitment: 'Recruitment',
  'player-approach': 'Approach',
  'cup-draw': 'Cup draw',
  'cup-result': 'Cup',
  'league-movement': 'League',
  'finances-warning': 'Money',
  'finances-positive': 'Money',
  'club-news': 'The club',
  'club-event': 'Club diary',
  social: 'Off the pitch',
  calendar: 'Coming up',
  'dressing-room': 'Dressing room',
  training: 'Training',
  postponement: 'Called off',
  forfeit: 'Forfeit',
  world: 'Local game',
  // Two words for the two halves of the same thing, and they are never allowed
  // to read alike: an unconfirmed claim says so on the label as well as on the
  // chip beside it, and what the world did with it gets a word of its own.
  'press-rumour': 'Rumour',
  'press-verdict': 'Settled',
};

/**
 * What a story wears when it does not know what it is.
 *
 * A career saved before the event type travelled with the item has six columns
 * and nothing else, and a story that cannot say what happened is still a story:
 * it falls back to the column's own picture, which is what the paper drew for
 * every item until now. Nothing needs migrating and nothing renders worse than
 * it did.
 */
const PLATE_BY_CATEGORY: Record<NewsCategory, NewsPlateKey> = {
  Match: 'Match',
  Squad: 'Squad',
  Club: 'Club',
  League: 'League',
  World: 'World',
  Finances: 'Finances',
};

/** A story's picture: what happened, or failing that which column it is in. */
export function plateForStory(item: Pick<NewsItem, 'eventType'> & Pick<NewsItem, 'category'>): NewsPlateKey {
  if (item.eventType) return PLATE_BY_EVENT[item.eventType] ?? PLATE_BY_CATEGORY[item.category];
  return PLATE_BY_CATEGORY[item.category];
}

/** A story's label: the same choice, said in one word or two. */
export function labelForStory(item: Pick<NewsItem, 'eventType'> & Pick<NewsItem, 'category'>): string {
  if (item.eventType) return LABEL_BY_EVENT[item.eventType] ?? item.category;
  return item.category;
}

/**
 * Who wrote it, in the words a paper puts under a headline.
 *
 * Null rather than an empty string when nobody filed the story: a routine result
 * the manager knows about because his club was there was not written by anybody,
 * and a paper that printed a byline over it would be claiming a reporter had a
 * hand in something he never saw. `outlet` and `byline` arrive together — a story
 * carries both or neither — and this reader is where that is enforced rather than
 * in three layouts.
 */
export function bylineOf(item: Pick<NewsItem, 'byline'> & Pick<NewsItem, 'outlet'>): string | null {
  if (!item.byline || !item.outlet) return null;
  return `By ${item.byline}, ${item.outlet}`;
}

/**
 * How much of a story is fact, in the colour the chip beside it is set in.
 *
 * Three tones and four standings, from the palette that already exists: a claim
 * nobody has settled is worth a warning rather than a fact, a claim the world
 * bore out is good news and gets the colour good news gets, and a claim that was
 * wrong — or that simply stopped mattering — is drawn quietly, because a
 * correction is not a calamity.
 */
export function toneForConfidence(confidence: RumourStatus): 'warn' | 'ok' | 'muted' {
  switch (confidence) {
    case 'unverified':
      return 'warn';
    case 'confirmed':
      return 'ok';
    case 'disproved':
    case 'stale':
      return 'muted';
  }
}

/**
 * A body is written as prose; a blank line is where the paper breaks.
 *
 * The writers' bodies are joined sentences rather than paragraphs, so most
 * stories come out as one — which is the honest answer and is why the lead
 * checks whether there is anything under the first line before it sets it as a
 * standfirst. A story that reads as one paragraph is printed as one paragraph.
 */
export function paragraphsOf(item: Pick<NewsItem, 'body'>): string[] {
  return item.body
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * The match a story is about, when it has one — and the two rules that keep it
 * honest.
 *
 * A story can point at a fixture from either end of it: a result points at the
 * match it came out of, and a draw points at a tie that has not been played. The
 * two are not interchangeable and they must not be confused, because the one
 * thing this screen may never do is print a score for football that has not
 * happened — `MatchScoreline` draws the score the match is currently at, so a
 * drawn tie handed to it as though it were a result would appear on the front
 * page as 0–0.
 *
 * So the two readers are separate, each asks the match itself which it is, and
 * there is no path through here that puts a score on a fixture nobody has
 * played. Touching nothing but `played`, they are testable with two objects —
 * which is why they are here rather than inline in the view.
 */
export function resultForStory<T extends { played: boolean }>(
  matches: Record<string, T | undefined>,
  item: Pick<NewsItem, 'matchId'>,
): T | null {
  const match = matchOf(matches, item);
  return match && match.played ? match : null;
}

/** The tie a story is about before it is played: a draw, an upcoming cup round. */
export function fixtureForStory<T extends { played: boolean }>(
  matches: Record<string, T | undefined>,
  item: Pick<NewsItem, 'matchId'>,
): T | null {
  const match = matchOf(matches, item);
  return match && !match.played ? match : null;
}

function matchOf<T extends { played: boolean }>(
  matches: Record<string, T | undefined>,
  item: Pick<NewsItem, 'matchId'>,
): T | null {
  if (!item.matchId) return null;
  return matches[item.matchId] ?? null;
}
