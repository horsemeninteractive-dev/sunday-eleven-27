import type { GameState } from '@/domain/game';
import type { ClubId, EventId, MatchId, PersonId } from '@/domain/ids';
import type { GameEvent, GameEventType, NewsCategory, NewsItem } from '@/domain/news';
import { isPlayer } from '@/domain/person';
import { nextId } from './ids';

/**
 * News is *derived*: systems emit structured events, and this service turns
 * them into readable items using contextual templates. Because the events are
 * the source of truth, future consumers (journalists, social media, the
 * archive) can read exactly the same data without the game re-inventing it.
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

function writeMatchResult(event: GameEvent): Headline {
  const home = stringValue(event, 'homeClub');
  const away = stringValue(event, 'awayClub');
  const homeGoals = numberValue(event, 'homeGoals');
  const awayGoals = numberValue(event, 'awayGoals');
  const venue = stringValue(event, 'venue');
  const scorers = stringValue(event, 'scorers');
  const attendance = numberValue(event, 'attendance');
  const verdict = stringValue(event, 'verdict');

  return {
    headline: `${home} ${homeGoals}-${awayGoals} ${away}`,
    body: [
      verdict,
      scorers ? `Scorers: ${scorers}.` : 'No goals at either end.',
      `${venue} · ${attendance} watching.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function writeInjury(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const club = stringValue(event, 'club');
  const description = stringValue(event, 'description');
  const daysOut = numberValue(event, 'daysOut');
  const timescale =
    daysOut <= 3
      ? 'should be back within the week'
      : daysOut <= 12
        ? `could be out for a fortnight or so`
        : daysOut <= 40
          ? 'faces six weeks or more on the sidelines'
          : 'is looking at a long spell out';

  return {
    headline: `${player} picks up ${description}`,
    body: `${club} will be without ${player}, who ${timescale}.`,
  };
}

function writeGoalMilestone(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const goals = numberValue(event, 'goals');
  const club = stringValue(event, 'club');
  return {
    headline: `${player} reaches ${goals} goals for the season`,
    body: `That is ${goals} for ${player} in ${club} colours this campaign, and the club's scorers' board is being kept busy.`,
  };
}

function writeAppearanceMilestone(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const appearances = numberValue(event, 'appearances');
  const club = stringValue(event, 'club');
  return {
    headline: `${player} makes it ${appearances} appearances for ${club}`,
    body: `A milestone appearance for ${player}, who has been turning out for ${club} since ${stringValue(event, 'since') || 'the last few seasons'}.`,
  };
}

function writeNotableResult(event: GameEvent): Headline {
  const winner = stringValue(event, 'winner');
  const loser = stringValue(event, 'loser');
  const score = stringValue(event, 'score');
  const note = stringValue(event, 'note');
  return {
    headline: `${winner} ${score} ${loser}`,
    body: note || `A result that will be talked about in the clubhouse for a while.`,
  };
}

function writeLeagueMovement(event: GameEvent): Headline {
  const club = stringValue(event, 'club');
  const position = numberValue(event, 'position');
  const movement = stringValue(event, 'movement');
  return {
    headline: `${club} ${movement} to ${ordinal(position)}`,
    body: `The table has moved again. ${club} are now ${ordinal(position)} in ${stringValue(event, 'competition')}.`,
  };
}

/**
 * A promotion, a relegation, or a draw.
 *
 * These carry their own headline and body rather than being assembled from
 * positions and points, because what they are reporting has already happened and
 * already has a sentence: a club went up, a club went down, a place was refused,
 * or thirty-six clubs were put into a bag. The structured facts travel alongside
 * it so the archive and any future system can read them, but the prose is the
 * news and is written where the news is written.
 */
function writeExplicit(event: GameEvent): Headline {
  return {
    headline: stringValue(event, 'headline') || 'News from the county',
    body: stringValue(event, 'body'),
  };
}

function writeFinances(event: GameEvent, warning: boolean): Headline {
  const club = stringValue(event, 'club');
  const balance = numberValue(event, 'balance');
  const amount = numberValue(event, 'amount');
  if (warning) {
    return {
      headline: `${club} in the red`,
      body: `The club account stands at £${balance.toFixed(2)}. The treasurer wants a word about subs, sponsors and the cost of pitches.`,
    };
  }
  return {
    headline: `${club} bank £${Math.abs(amount).toFixed(2)}`,
    body: `A welcome boost for the club funds — the balance is now £${balance.toFixed(2)}.`,
  };
}

function writeAvailabilityCrisis(event: GameEvent): Headline {
  const club = stringValue(event, 'club');
  const count = numberValue(event, 'count');
  const names = stringValue(event, 'names');
  return {
    headline: `${club} sweating on numbers`,
    body: `Only ${count} players are definitely available this week. ${names ? `Out or doubtful: ${names}.` : ''} The manager is ringing round.`,
  };
}

function writeClubNews(event: GameEvent): Headline {
  return {
    headline: stringValue(event, 'headline') || 'Club news',
    body: stringValue(event, 'body'),
  };
}

function writeDressingRoom(event: GameEvent): Headline {
  return {
    headline: stringValue(event, 'headline') || 'Word from the dressing room',
    body: stringValue(event, 'body'),
  };
}

function writePostponement(event: GameEvent): Headline {
  const reason = stringValue(event, 'reason');
  const rearranged = stringValue(event, 'rearranged');
  const fixture = stringValue(event, 'fixture');
  return {
    headline: stringValue(event, 'headline') || `${fixture || 'The fixture'} is off`,
    body: [
      reason ? `${reason}.` : 'The game will not go ahead.',
      rearranged
        ? `The league has rearranged it for ${rearranged}.`
        : 'There is no new date yet — the league will sort it out.',
    ].join(' '),
  };
}

function writeForfeit(event: GameEvent): Headline {
  const fixture = stringValue(event, 'fixture');
  const short = stringValue(event, 'short');
  const awarded = stringValue(event, 'awarded');
  const score = stringValue(event, 'score');
  return {
    headline: stringValue(event, 'headline') || `${fixture || 'The fixture'} is abandoned`,
    body: [
      short
        ? `${short} could not field a side — fewer than seven players available.`
        : 'One side could not field a team.',
      awarded ? `${awarded} are awarded the game ${score}.` : `The game is awarded ${score}.`,
    ].join(' '),
  };
}

function writePlayerUnavailable(event: GameEvent): Headline {
  const player = stringValue(event, 'player');
  const note = stringValue(event, 'note');
  const club = stringValue(event, 'club');
  return {
    headline: `${player} unavailable for ${club}`,
    body: `${player} will not be available this week: ${note}.`,
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
    headline: written.headline,
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
