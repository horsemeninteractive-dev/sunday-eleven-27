import type { GameState } from '@/domain/game';
import type { ClubId, EventId, MatchId, PersonId } from '@/domain/ids';
import type { GameEvent, GameEventType, NewsCategory, NewsItem } from '@/domain/news';
import { isPlayer } from '@/domain/person';
import { nextId } from './ids';
import { variant } from './prose';

/**
 * News is *derived*: systems emit structured events, and this service turns
 * them into readable items using contextual templates. Because the events are
 * the source of truth, future consumers (journalists, social media, the
 * archive) can read exactly the same data without the game re-inventing it.
 *
 * Every writer below says its one thing several ways. A career produces an
 * injury, a booking and a club going into the red most weeks, and a paper that
 * uses the same sentence for all of them reads as a log rather than as a local
 * paper. The *facts* never vary with the wording, though: a phrasing may only
 * reword what the event already carries, and every phrasing of a thing carries
 * all of it. `say`, below, is how that is kept honest.
 */

export interface EventSeed {
  type: GameEventType;
  importance: 1 | 2 | 3;
  clubIds?: ClubId[];
  personIds?: PersonId[];
  matchId?: MatchId | null;
  data?: Record<string, string | number>;
}

export function createEvent(state: GameState, seed: EventSeed): GameEvent {
  return {
    id: nextId(state, 'event') as EventId,
    type: seed.type,
    date: state.date,
    importance: seed.importance,
    clubIds: seed.clubIds ?? [],
    personIds: seed.personIds ?? [],
    matchId: seed.matchId ?? null,
    data: seed.data ?? {},
  };
}

const CATEGORY_BY_TYPE: Record<GameEventType, NewsCategory> = {
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
};

function stringValue(event: GameEvent, key: string): string {
  const value = event.data[key];
  return value === undefined ? '' : String(value);
}

function numberValue(event: GameEvent, key: string): number {
  const value = event.data[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

interface Headline {
  headline: string;
  body: string;
}

/**
 * One of several ways of writing the same sentence, with the facts filled in.
 *
 * A pool holds the sentence the way the reporter would type it, with the facts
 * left as `{name}` placeholders — so a pool can be reworded freely without any
 * writer having to thread its own arguments through by hand. `variant` chooses
 * which reading a given event gets, and it is the event's own id that chooses,
 * so the same event reads the same way on every re-render.
 *
 * A placeholder with no fact behind it is a bug — a missing fact is a fact the
 * paper dropped — so it throws here rather than printing a blank.
 */
function say(pool: readonly string[], key: string, facts: Record<string, string | number>): string {
  return variant(pool, key).replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = facts[name];
    if (value === undefined) throw new Error(`news prose: no fact named "${name}"`);
    return String(value);
  });
}

/* Match results -----------------------------------------------------------
 * The score line is the one piece of prose a reader scans, so it stays a score
 * line: the variations are how a local paper sets a result, not a re-telling.
 */

const MATCH_HEADLINES = [
  '{home} {homeGoals}-{awayGoals} {away}',
  '{home} {homeGoals}, {away} {awayGoals}',
  'Full time: {home} {homeGoals}-{awayGoals} {away}',
];

const MATCH_SCORER_LINES = [
  'Scorers: {scorers}.',
  'Goals from {scorers}.',
  'On the scoresheet: {scorers}.',
  'The goals came from {scorers}.',
];

const MATCH_NO_GOALS_LINES = [
  'No goals at either end.',
  'Neither side found the net.',
  'A blank afternoon at both ends.',
];

const MATCH_CROWD_LINES = [
  '{venue} · {attendance} watching.',
  '{attendance} through the gate at {venue}.',
  'Crowd at {venue}: {attendance}.',
  '{venue}, with {attendance} in.',
];

function writeMatchResult(event: GameEvent): Headline {
  const home = stringValue(event, 'homeClub');
  const away = stringValue(event, 'awayClub');
  const homeGoals = numberValue(event, 'homeGoals');
  const awayGoals = numberValue(event, 'awayGoals');
  const venue = stringValue(event, 'venue');
  const scorers = stringValue(event, 'scorers');
  const attendance = numberValue(event, 'attendance');
  const verdict = stringValue(event, 'verdict');

  const facts = { home, away, homeGoals, awayGoals, venue, scorers, attendance, verdict };
  const goalsLine = scorers
    ? say(MATCH_SCORER_LINES, `${event.id}:scorers`, facts)
    : say(MATCH_NO_GOALS_LINES, `${event.id}:scorers`, facts);

  return {
    headline: say(MATCH_HEADLINES, `${event.id}:headline`, facts),
    body: [verdict, goalsLine, say(MATCH_CROWD_LINES, `${event.id}:crowd`, facts)]
      .filter(Boolean)
      .join(' '),
  };
}

/* Injuries ----------------------------------------------------------------
 * The timescale is the sentence the manager actually wants, and it is also the
 * one that was written once for four brackets of time out. Each bracket now has
 * its own set of readings, all of them clauses that follow both "who ..." and
 * "he ...", because the body templates put the clause behind either.
 */

const INJURY_HEADLINES = [
  '{player} picks up {description}',
  '{player} out with {description}',
  '{description} rules {player} out',
  '{description} for {player}',
  'A blow for {player}: {description}',
];

const INJURY_TIMESCALE_BRIEF = [
  'should be back within the week',
  'should only miss the one game',
  'is not thought to be badly hurt',
  'could be fit again by next weekend',
];

const INJURY_TIMESCALE_FORTNIGHT = [
  'could be out for a fortnight or so',
  'is looking at a couple of weeks out',
  'may miss the rest of the month',
  'will not be rushed back',
];

const INJURY_TIMESCALE_WEEKS = [
  'faces six weeks or more on the sidelines',
  'is looking at the best part of two months',
  'faces a long stretch in the treatment room',
  'is not expected back any time soon',
];

const INJURY_TIMESCALE_LONG = [
  'is looking at a long spell out',
  'faces a lengthy spell on the sidelines',
  'is looking at months rather than weeks',
  'could be missing for a good while yet',
];

const INJURY_BODIES = [
  '{club} will be without {player}, who {timescale}.',
  '{player} misses out for {club}, and {timescale}.',
  '{club} are without {player}, who {timescale}.',
  '{club} must do without {player}: he {timescale}.',
];

function writeInjury(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const club = stringValue(event, 'club');
  const description = stringValue(event, 'description');
  const daysOut = numberValue(event, 'daysOut');
  const timescalePool =
    daysOut <= 3
      ? INJURY_TIMESCALE_BRIEF
      : daysOut <= 12
        ? INJURY_TIMESCALE_FORTNIGHT
        : daysOut <= 40
          ? INJURY_TIMESCALE_WEEKS
          : INJURY_TIMESCALE_LONG;
  const timescale = say(timescalePool, `${event.id}:timescale`, {});

  const facts = { player, club, description, timescale };
  return {
    headline: say(INJURY_HEADLINES, `${event.id}:headline`, facts),
    body: say(INJURY_BODIES, `${event.id}:body`, facts),
  };
}

/* Milestones ------------------------------------------------------------- */

const GOAL_MILESTONE_HEADLINES = [
  '{player} reaches {goals} goals for the season',
  '{goals} and counting for {player}',
  '{player} makes it {goals} for the season',
  '{player} up to {goals} goals',
];

const GOAL_MILESTONE_BODIES = [
  "That is {goals} for {player} in {club} colours this campaign, and the club's scorers' board is being kept busy.",
  '{goals} for {player} in a {club} shirt this campaign, and the scorers’ board at the club is filling up.',
  '{club} have had {goals} from {player} this campaign, and nobody at the club is counting quietly.',
];

function writeGoalMilestone(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const goals = numberValue(event, 'goals');
  const club = stringValue(event, 'club');
  const facts = { player, goals, club };
  return {
    headline: say(GOAL_MILESTONE_HEADLINES, `${event.id}:headline`, facts),
    body: say(GOAL_MILESTONE_BODIES, `${event.id}:body`, facts),
  };
}

const APPEARANCE_HEADLINES = [
  '{player} makes it {appearances} appearances for {club}',
  '{appearances} up for {player}',
  '{player} reaches {appearances} for {club}',
  '{appearances} appearances and counting for {player}',
];

const APPEARANCE_BODIES = [
  'A milestone appearance for {player}, who has been turning out for {club} since {since}.',
  '{appearances} appearances for {player} since {since}, all of them in a {club} shirt.',
  '{player} has been at {club} since {since}, and that is {appearances} appearances.',
  '{club} have had {appearances} appearances out of {player} since {since}.',
];

function writeAppearanceMilestone(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const appearances = numberValue(event, 'appearances');
  const club = stringValue(event, 'club');
  const since = stringValue(event, 'since') || 'the last few seasons';
  const facts = { player, appearances, club, since };
  return {
    headline: say(APPEARANCE_HEADLINES, `${event.id}:headline`, facts),
    body: say(APPEARANCE_BODIES, `${event.id}:body`, facts),
  };
}

/* Notable results --------------------------------------------------------
 * The note is the system's own sentence about a result it already judged worth
 * writing about, so where there is one it is used as written. The pool is what
 * fills in when the event carries no note.
 */

const NOTABLE_HEADLINES = [
  '{winner} {score} {loser}',
  '{score} — {winner} too good for {loser}',
  'Result of the day: {winner} {score} {loser}',
];

const NOTABLE_BODIES = [
  'A result that will be talked about in the clubhouse for a while.',
  'Not one for the scrapbook if you were on the losing side.',
  'One of those afternoons that gets remembered around the county.',
  'Both sides will remember this one, for different reasons.',
];

function writeNotableResult(event: GameEvent): Headline {
  const winner = stringValue(event, 'winner');
  const loser = stringValue(event, 'loser');
  const score = stringValue(event, 'score');
  const note = stringValue(event, 'note');
  const facts = { winner, loser, score, note };
  return {
    headline: say(NOTABLE_HEADLINES, `${event.id}:headline`, facts),
    body: note || say(NOTABLE_BODIES, `${event.id}:body`, facts),
  };
}

/* The table --------------------------------------------------------------
 * `movement` is the verb the league system chose — "climb", "drop" — so every
 * headline here keeps the club, the verb and the position in the same order,
 * and only changes what is put around them.
 */

const MOVEMENT_HEADLINES = [
  '{club} {movement} to {position}',
  'Table: {club} {movement} to {position}',
  '{movement} to {position} for {club}',
];

const MOVEMENT_BODIES = [
  'The table has moved again. {club} are now {position} in {competition}.',
  'Movement in {competition}: {club} are {position}.',
  '{club} are {position} in {competition} after the latest results.',
  'The latest results put {club} {position} in {competition}.',
];

function writeLeagueMovement(event: GameEvent): Headline {
  const club = stringValue(event, 'club');
  const position = ordinal(numberValue(event, 'position'));
  const movement = stringValue(event, 'movement');
  const competition = stringValue(event, 'competition');
  const facts = { club, position, movement, competition };
  return {
    headline: say(MOVEMENT_HEADLINES, `${event.id}:headline`, facts),
    body: say(MOVEMENT_BODIES, `${event.id}:body`, facts),
  };
}

/* What the systems write for themselves ---------------------------------- */

const EXPLICIT_FALLBACKS = ['News from the county', 'From around the county', 'County news'];
const CLUB_NEWS_FALLBACKS = ['Club news', 'From the club', 'A word from the club'];
const DRESSING_ROOM_FALLBACKS = [
  'Word from the dressing room',
  'From inside the dressing room',
  'The mood in the camp',
];

/**
 * A promotion, a relegation, or a draw.
 *
 * These carry their own headline and body rather than being assembled from
 * positions and points, because what they are reporting has already happened and
 * already has a sentence: a club went up, a club went down, a place was refused,
 * or thirty-six clubs were put into a bag. The structured facts travel alongside
 * it so the archive and any future system can read them, but the prose is the
 * news and is written where the news is written.
 *
 * There is nothing to reword here — the sentence is the event's own — so the
 * only choice to make is which fallback stands in for a headline the system was
 * asked for and did not give.
 */
function writeExplicit(event: GameEvent): Headline {
  return {
    headline: stringValue(event, 'headline') || say(EXPLICIT_FALLBACKS, event.id, {}),
    body: stringValue(event, 'body'),
  };
}

/* Money ------------------------------------------------------------------ */

const RED_HEADLINES = [
  '{club} in the red',
  '{club} are in the red',
  'Treasurer’s report: {club} in the red',
];

/* The figure arrives with its sign and its symbol already on it — `-£42.75`,
   not `£-42.75` — so the templates that quote one leave the `£` to `money`. */
const RED_BODIES = [
  'The club account stands at {balance}. The treasurer wants a word about subs, sponsors and the cost of pitches.',
  'The account stands at {balance}, and the treasurer wants a word about subs, sponsors and the cost of pitches.',
  'The club account reads {balance}. Subs, sponsors and pitch hire are the treasurer’s three headaches.',
];

const BANKED_HEADLINES = [
  '{club} bank {amount}',
  '{club} up {amount}',
  'Money in: {club} bank {amount}',
  'A boost of {amount} for {club}',
];

const BANKED_BODIES = [
  'A welcome boost for the club funds — the balance is now {balance}.',
  'The club funds get a lift, taking the balance to {balance}.',
  'A welcome boost: the balance is now {balance}.',
  'The balance is now {balance}, and the club funds are the better for it.',
];

/**
 * Money as a local paper writes it.
 *
 * The sign goes in front of the symbol, because "£-42.75" is not how anybody
 * reads an overdraft and the treasurer has enough to put up with.
 */
function money(value: number): string {
  const amount = Math.abs(value).toFixed(2);
  return value < 0 ? `-£${amount}` : `£${amount}`;
}

function writeFinances(event: GameEvent, warning: boolean): Headline {
  const club = stringValue(event, 'club');
  const balance = numberValue(event, 'balance');
  const amount = numberValue(event, 'amount');
  if (warning) {
    const facts = { club, balance: money(balance) };
    return {
      headline: say(RED_HEADLINES, `${event.id}:headline`, facts),
      body: say(RED_BODIES, `${event.id}:body`, facts),
    };
  }
  const facts = { club, balance: money(balance), amount: money(Math.abs(amount)) };
  return {
    headline: say(BANKED_HEADLINES, `${event.id}:headline`, facts),
    body: say(BANKED_BODIES, `${event.id}:body`, facts),
  };
}

/* Numbers ---------------------------------------------------------------- */

const CRISIS_HEADLINES = [
  '{club} sweating on numbers',
  '{club} short of players',
  'Numbers worry for {club}',
  '{club} counting heads',
];

const CRISIS_OPENERS = [
  'Only {count} players are definitely available this week.',
  'It is {count} available players this week, and no more.',
  '{count} players are definitely available this week — the rest are not.',
];

const CRISIS_NAMES_LINES = [
  'Out or doubtful: {names}.',
  'Missing: {names}.',
  'Out or doubtful this week: {names}.',
];

const CRISIS_CLOSERS = [
  'The manager is ringing round.',
  'The manager is on the phone.',
  'Somebody is going to get a call.',
];

function writeAvailabilityCrisis(event: GameEvent): Headline {
  const club = stringValue(event, 'club');
  const count = numberValue(event, 'count');
  const names = stringValue(event, 'names');
  const facts = { club, count, names };
  const body = [
    say(CRISIS_OPENERS, `${event.id}:opener`, facts),
    names ? say(CRISIS_NAMES_LINES, `${event.id}:names`, facts) : '',
    say(CRISIS_CLOSERS, `${event.id}:closer`, facts),
  ]
    .filter(Boolean)
    .join(' ');
  return {
    headline: say(CRISIS_HEADLINES, `${event.id}:headline`, facts),
    body,
  };
}

/* Off, and given away ---------------------------------------------------- */

const POSTPONED_HEADLINES = [
  '{subject} is off',
  '{subject} called off',
  'No game: {subject}',
];

const NO_REASON_LINES = [
  'The game will not go ahead.',
  'The fixture will not be played.',
  'There will be no football there this week.',
];

const REARRANGED_LINES = [
  'The league has rearranged it for {rearranged}.',
  'It has been rearranged for {rearranged}.',
  'A new date has been found: {rearranged}.',
];

const NO_NEW_DATE_LINES = [
  'There is no new date yet — the league will sort it out.',
  'No new date yet; the league will sort that out.',
  'The league has yet to find a new date.',
];

function writePostponement(event: GameEvent): Headline {
  const reason = stringValue(event, 'reason');
  const rearranged = stringValue(event, 'rearranged');
  const fixture = stringValue(event, 'fixture');
  const subject = fixture || 'The fixture';
  const facts = { subject, reason, rearranged, fixture };
  return {
    headline: stringValue(event, 'headline') || say(POSTPONED_HEADLINES, `${event.id}:headline`, facts),
    body: [
      reason ? `${reason}.` : say(NO_REASON_LINES, `${event.id}:reason`, facts),
      rearranged
        ? say(REARRANGED_LINES, `${event.id}:rearranged`, facts)
        : say(NO_NEW_DATE_LINES, `${event.id}:nodate`, facts),
    ].join(' '),
  };
}

const FORFEIT_HEADLINES = [
  '{subject} is abandoned',
  '{subject} abandoned',
  'Abandoned: {subject}',
];

const SHORT_LINES = [
  '{short} could not field a side — fewer than seven players available.',
  '{short} could not raise a team: fewer than seven available.',
  'Fewer than seven available for {short}, who could not field a side.',
];

const NO_SHORT_LINES = [
  'One side could not field a team.',
  'One of the sides could not raise a team.',
  'There was no team to play against.',
];

const AWARDED_LINES = [
  '{awarded} are awarded the game {score}.',
  'The game goes to {awarded}, {score}.',
  '{awarded} take the game {score}.',
];

const AWARDED_UNKNOWN_LINES = [
  'The game is awarded {score}.',
  'It is awarded {score}.',
  'The result goes down as {score}.',
];

function writeForfeit(event: GameEvent): Headline {
  const fixture = stringValue(event, 'fixture');
  const short = stringValue(event, 'short');
  const awarded = stringValue(event, 'awarded');
  const score = stringValue(event, 'score');
  const subject = fixture || 'The fixture';
  const facts = { subject, fixture, short, awarded, score };
  return {
    headline: stringValue(event, 'headline') || say(FORFEIT_HEADLINES, `${event.id}:headline`, facts),
    body: [
      short ? say(SHORT_LINES, `${event.id}:short`, facts) : say(NO_SHORT_LINES, `${event.id}:short`, facts),
      awarded
        ? say(AWARDED_LINES, `${event.id}:awarded`, facts)
        : say(AWARDED_UNKNOWN_LINES, `${event.id}:awarded`, facts),
    ].join(' '),
  };
}

const UNAVAILABLE_HEADLINES = [
  '{player} unavailable for {club}',
  '{club} without {player}',
  '{player} out for {club}',
  'No {player} for {club}',
];

const UNAVAILABLE_BODIES = [
  '{player} will not be available this week: {note}.',
  '{club} will be without {player} this week: {note}.',
  '{player} misses out for {club} this week: {note}.',
  'Out for {club} this week: {player}, {note}.',
];

function writePlayerUnavailable(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const note = stringValue(event, 'note');
  const club = stringValue(event, 'club');
  const facts = { player, note, club };
  return {
    headline: say(UNAVAILABLE_HEADLINES, `${event.id}:headline`, facts),
    body: say(UNAVAILABLE_BODIES, `${event.id}:body`, facts),
  };
}

function writeClubNews(event: GameEvent): Headline {
  return {
    headline: stringValue(event, 'headline') || say(CLUB_NEWS_FALLBACKS, event.id, {}),
    body: stringValue(event, 'body'),
  };
}

function writeDressingRoom(event: GameEvent): Headline {
  return {
    headline: stringValue(event, 'headline') || say(DRESSING_ROOM_FALLBACKS, event.id, {}),
    body: stringValue(event, 'body'),
  };
}

export function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function renderNewsItem(state: GameState, event: GameEvent): NewsItem {
  let written: Headline;
  switch (event.type) {
    case 'match-result':
      written = writeMatchResult(event);
      break;
    case 'injury':
      written = writeInjury(event);
      break;
    case 'goal-milestone':
      written = writeGoalMilestone(event);
      break;
    case 'appearance-milestone':
      written = writeAppearanceMilestone(event);
      break;
    case 'notable-result':
      written = writeNotableResult(event);
      break;
    case 'league-movement':
      written = event.data.headline ? writeExplicit(event) : writeLeagueMovement(event);
      break;
    case 'cup-draw':
    case 'cup-result':
      written = writeExplicit(event);
      break;
    case 'finances-warning':
      written = writeFinances(event, true);
      break;
    case 'finances-positive':
      written = writeFinances(event, false);
      break;
    case 'availability-crisis':
      written = writeAvailabilityCrisis(event);
      break;
    case 'player-unavailable':
      written = writePlayerUnavailable(event);
      break;
    case 'dressing-room':
      written = writeDressingRoom(event);
      break;
    case 'recruitment':
    case 'player-approach':
    case 'training':
    case 'development':
    case 'club-event':
    case 'social':
    case 'world':
    case 'calendar':
      written = writeDressingRoom(event);
      break;
    case 'postponement':
      written = writePostponement(event);
      break;
    case 'forfeit':
      written = writeForfeit(event);
      break;
    default:
      written = writeClubNews(event);
      break;
  }

  return {
    id: nextId(state, 'news'),
    date: event.date,
    category: CATEGORY_BY_TYPE[event.type] ?? 'Club',
    importance: event.importance,
    // A headline starts with a capital, whichever pool it came out of: a paper
    // does not print "a tight hamstring rules him out".
    headline: written.headline.charAt(0).toUpperCase() + written.headline.slice(1),
    body: written.body,
    clubIds: event.clubIds,
    personIds: event.personIds,
    matchId: event.matchId,
    eventId: event.id,
    read: false,
  };
}

export function publishEvents(state: GameState, events: readonly GameEvent[]): NewsItem[] {
  const items = events.map((event) => renderNewsItem(state, event));
  // Newest first, capped so a save never grows without bound.
  state.news = [...items.reverse(), ...state.news].slice(0, 300);
  return items;
}

export function describePerson(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  if (!person) return 'Unknown';
  return isPlayer(person) ? `${person.firstName} ${person.surname}` : `${person.firstName} ${person.surname}`;
}
