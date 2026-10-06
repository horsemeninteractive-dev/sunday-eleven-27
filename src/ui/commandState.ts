import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { FORFEIT_GOALS, MIN_SIDE, periodLabel, type Match } from '@/domain/match';
import { canFieldSide } from '@/simulation/forfeit';
import { isPlayer } from '@/domain/person';
import { daysBetween, formatDayMonth, formatKickOff } from '@/simulation/calendar';
import { currentScore } from '@/simulation/match/matchEngine';
import { currentAttention, type ContinueStop } from '@/simulation/day';
import { currentMatchday, matchOpponent, matchVenueLabel, squadAvailability } from '@/simulation/queries';
import { nextFixtureFor, nextStop } from '@/simulation/schedule';
import { leagueMatchdayCount } from '@/simulation/timeline';
import { validateLineup } from '@/simulation/selection';
import type { MatchSession } from '@/state/gameStore';
import type { ViewId } from '@/state/gameStore';

/**
 * What the game expects the manager to do next.
 *
 * The single source of truth for the current moment: the command bar, the
 * mobile strip, the dashboard hero and the Continue button all read it, and
 * none of them work it out for themselves. Nothing here mutates or talks to the
 * store — it reads the state and the calendar and says what is going on.
 *
 * Time is continuous, so the question is no longer "which day of the week is
 * it" but "what is the next thing, and does it want me now?".
 */

export type CommandIntent =
  | { kind: 'view'; view: ViewId }
  | {
      kind: 'action';
      action:
        | 'run-training'
        | 'start-match'
        | 'instant-result'
        | 'resume-match'
        | 'rollover-season'
        | 'continue'
        | 'advance-day'
        | 'open-planner';
    };

/**
 * Is this intent a door to a screen, rather than something that moves the game
 * on?
 *
 * The command bar owns advancing: continuing the week, running the session,
 * playing the match. Everything elsewhere in the game — the overview above all
 * — may only offer screens, so there is never a second button that quietly
 * does the same thing as Continue.
 */
export function isScreenIntent(intent: CommandIntent): boolean {
  return intent.kind === 'view' || intent.action === 'open-planner';
}

export interface CommandAction {
  label: string;
  /** Used where space is tight, such as the mobile command strip. */
  short: string;
  intent: CommandIntent;
  variant: 'primary' | 'secondary' | 'quiet';
  hint?: string;
}

export type CommandPhase =
  | 'season-complete'
  | 'match-live'
  | 'match-finished'
  | 'matchday'
  | 'training-tonight'
  | 'today'
  | 'upcoming'
  | 'quiet';

export interface CommandState {
  phase: CommandPhase;
  /** Small caps label: MATCHDAY, TRAINING, NEXT MATCH, SEASON. */
  eyebrow: string;
  title: string;
  /** When the title is a club, this is which one, so the title can be a door. */
  titleClubId?: string;
  lines: string[];
  detail?: string;
  action: CommandAction;
  secondary: CommandAction[];
  progress: {
    matchday: number;
    of: number;
    label: string;
    date: ISODate;
    /** Days until the thing being described, 0 when it is today. */
    daysAway: number | null;
  };
  /** How much attention this deserves. Drives emphasis, never behaviour. */
  urgency: 'now' | 'soon' | 'routine';
  /** Where Continue is heading, in the manager's words: "in 3 days". */
  continueHint: string;
}

export function commandStateFor(game: GameState, session: MatchSession | null): CommandState {
  const club = game.clubs[game.userClubId]!;
  const today = game.date;
  const matchdays = leagueMatchdayCount(game);
  const matchday = Math.min(currentMatchday(game), matchdays);
  const fixture = nextFixtureFor(game, club.id, today);
  const progress = {
    matchday,
    of: matchdays,
    label: game.season.label,
    date: today,
    daysAway: fixture ? daysBetween(today, fixture.date) : null,
  };

  if (game.phase === 'complete') {
    return {
      phase: 'season-complete',
      eyebrow: 'Season',
      title: `${game.season.label} is over`,
      lines: ['Promotion and relegation are settled elsewhere in the county.'],
      detail: 'Players get older, the oldest retire, and a fresh fixture list gets drawn up.',
      action: {
        label: 'Start pre-season',
        short: 'Pre-season',
        intent: { kind: 'action', action: 'rollover-season' },
        variant: 'primary',
      },
      secondary: [
        { label: 'The table', short: 'Table', intent: { kind: 'view', view: 'league' }, variant: 'quiet' },
        { label: 'The archive', short: 'History', intent: { kind: 'view', view: 'history' }, variant: 'quiet' },
      ],
      progress,
      urgency: 'soon',
      continueHint: 'Nothing left this season',
    };
  }

  if (session) {
    const live = session.live;
    const home = game.clubs[live.homeClubId]!;
    const away = game.clubs[live.awayClubId]!;
    const score = currentScore(live);
    const finished = session.phase === 'full-time';
    return {
      phase: finished ? 'match-finished' : 'match-live',
      eyebrow: finished ? 'Full time' : 'Match in progress',
      title: `${home.identity.shortName} ${score.home}–${score.away} ${away.identity.shortName}`,
      lines: finished
        ? [`${formatDayMonth(live.date)} · ${live.competitionName}`]
        : [`${periodLabel(live)} · minute ${Math.min(live.minute, 90)}`],
      detail: finished ? 'Have a look at the report, then get back to the week.' : 'The referee is waiting.',
      action: {
        label: finished ? 'View the report' : 'Return to the match',
        short: finished ? 'Report' : 'Match',
        intent: { kind: 'action', action: 'resume-match' },
        variant: 'primary',
      },
      secondary: finished
        ? [
            { label: 'Back to the club', short: 'Club', intent: { kind: 'action', action: 'continue' }, variant: 'secondary' },
            { label: 'Fixtures', short: 'Fixtures', intent: { kind: 'view', view: 'fixtures' }, variant: 'quiet' },
          ]
        : [],
      progress,
      urgency: 'now',
      continueHint: finished ? 'Carry on with the day' : 'The match is still going',
    };
  }

  const availability = squadAvailability(game, club.id);
  const availabilityLine = `${availability.available.length} available${
    availability.doubtful.length > 0 ? ` · ${availability.doubtful.length} doubtful` : ''
  }${availability.unavailable.length > 0 ? ` · ${availability.unavailable.length} out` : ''}`;
  const attention = currentAttention(game);
  const stop = nextStop(game, today);

  // 1. Something is on today and it wants him.
  if (attention && attention.kind === 'blocking') {
    const fixtureToday = todayFixture(game, attention);
    if (fixtureToday) return matchdayState(game, fixtureToday, availabilityLine, progress, today);
    return todayState(attention, availabilityLine, progress, 'now');
  }
  if (attention && attention.kind === 'flagged') {
    return todayState(attention, availabilityLine, progress, 'soon');
  }

  // 2. Nothing today: say what is coming, and offer to move time on.
  const daysAway = daysBetween(today, stop.date);
  const hint =
    stop.kind === 'none'
      ? 'The calendar is clear'
      : daysAway <= 0
        ? 'Today'
        : daysAway === 1
          ? 'Tomorrow'
          : `In ${daysAway} days`;

  if (fixture) {
    const opponent = game.clubs[matchOpponent(fixture, club.id)]!;
    const venue = matchVenueLabel(fixture, club.id);
    // Something may come before the match — Thursday, usually. Say so on the
    // line the manager will read while he looks at the fixture.
    const before = stop.kind !== 'none' && stop.date < fixture.date;
    const playedToday = resultPlayedToday(game);
    return {
      phase: 'upcoming',
      eyebrow: 'Next match',
      title: `${opponent.identity.name} (${venue})`,
      titleClubId: opponent.id,
      lines: [
        ...(playedToday ? [`Today: ${playedToday}`] : []),
        `${competitionDay(fixture)} · ${formatKickOff(fixture.kickOff)}`,
        `${venue} · ${game.world.grounds[fixture.groundId]?.name ?? 'ground to confirm'}`,
        before ? `${stop.headline} on ${formatDayMonth(stop.date)} comes first` : hint,
      ],
      detail: availabilityLine,
      action: {
        label: `Continue to ${formatDayMonth(stop.date)}`,
        short: 'Continue',
        intent: { kind: 'action', action: 'continue' },
        variant: 'primary',
        hint: daysAway <= 0 ? 'Today' : `Move the calendar on ${hint.toLowerCase()}`,
      },
      secondary: [
        { label: 'Team selection', short: 'Team', intent: { kind: 'view', view: 'team' }, variant: 'secondary' },
        { label: 'The calendar', short: 'Calendar', intent: { kind: 'action', action: 'open-planner' }, variant: 'quiet' },
      ],
      progress,
      urgency: daysAway <= 1 ? 'soon' : 'routine',
      continueHint: hint,
    };
  }

  return {
    phase: stop.kind === 'none' ? 'quiet' : 'upcoming',
    eyebrow: todayEyebrow(today),
    title: stop.kind === 'none' ? 'Nothing on the calendar' : `${stop.headline}`,
    lines: [formatDayMonth(today), formatDateLong(today), hint],
    detail: stop.kind === 'none' ? undefined : stop.detail,
    action: {
      label: stop.kind === 'none' ? 'Continue' : `Continue to ${formatDayMonth(stop.date)}`,
      short: 'Continue',
      intent: { kind: 'action', action: 'continue' },
      variant: 'primary',
      hint: daysAway <= 0 ? 'Today' : `Move the calendar on ${hint.toLowerCase()}`,
    },
    secondary: [
      { label: 'The calendar', short: 'Calendar', intent: { kind: 'action', action: 'open-planner' }, variant: 'secondary' },
      { label: 'The squad', short: 'Squad', intent: { kind: 'view', view: 'squad' }, variant: 'quiet' },
    ],
    progress,
    urgency: 'routine',
    continueHint: hint,
  };
}

/** Today is matchday, and this is the game. */
function matchdayState(
  game: GameState,
  match: Match,
  availabilityLine: string,
  progress: CommandState['progress'],
  today: ISODate,
): CommandState {
  const clubId = game.userClubId;
  const opponent = game.clubs[matchOpponent(match, clubId)]!;
  const venue = matchVenueLabel(match, clubId);
  const problems = lineupProblems(game, match, clubId);
  // A club with fewer than seven fit players cannot name a legal side, but it is
  // not stuck: playing the game is how it is abandoned and awarded away. So the
  // match is still ready to play, with the warning said plainly.
  const canField = canFieldSide(game, clubId);
  const ready = problems.length === 0 || !canField;
  const conditions = match.conditions;
  const weather = conditions ? WEATHER_WORDS[conditions.weather] ?? '' : '';

  return {
    phase: 'matchday',
    eyebrow: 'Matchday',
    title: `${opponent.identity.name} (${venue})`,
    titleClubId: opponent.id,
    lines: [
      `Kick-off ${formatKickOff(match.kickOff)} · ${venue}`,
      `${game.world.grounds[match.groundId]?.name ?? 'ground to confirm'}${weather ? ` · ${weather}` : ''}`,
      match.refereeId ? `Referee: ${personName(game, match.refereeId)}` : 'No referee allocated yet',
    ],
    detail: !canField
      ? `${availabilityLine}. Fewer than ${MIN_SIDE} fit players — playing the game abandons it.`
      : ready
        ? `${availabilityLine}. ${problems.length === 0 ? 'The XI is legal.' : ''}`.trim()
        : `${problems[0]} — ${availabilityLine}`,
    action: ready
      ? {
          label: 'Play the match',
          short: 'Play match',
          intent: { kind: 'action', action: 'start-match' },
          variant: 'primary',
          hint: canField
            ? 'Kick off and watch it minute by minute'
            : `Not enough players — playing forfeits the game ${FORFEIT_GOALS}-0`,
        }
      : {
          label: 'Prepare the team',
          short: 'Pick team',
          intent: { kind: 'view', view: 'team' },
          variant: 'primary',
          hint: 'The selection is not legal yet',
        },
    secondary: [
      { label: 'Team selection', short: 'Team', intent: { kind: 'view', view: 'team' }, variant: 'secondary' },
      {
        label: 'Simulate the result',
        short: 'Simulate',
        intent: { kind: 'action', action: 'instant-result' },
        variant: 'quiet',
        hint: 'Let somebody else text you the score',
      },
    ],
    progress,
    urgency: 'now',
    continueHint: `Loading ${formatDayMonth(today)}`,
  };
}

/** Something else is on today — training, the AGM, a registration deadline. */
function todayState(
  attention: ContinueStop,
  availabilityLine: string,
  progress: CommandState['progress'],
  urgency: CommandState['urgency'],
): CommandState {
  const lead = attention.events[0];
  const training = lead?.kind === 'training';
  return {
    phase: training ? 'training-tonight' : 'today',
    eyebrow: training ? 'Training tonight' : 'Today',
    title: attention.headline,
    lines: [formatDayMonth(attention.date), attention.detail],
    detail: availabilityLine,
    action: training
      ? {
          label: 'Run the session',
          short: 'Run session',
          intent: { kind: 'action', action: 'run-training' },
          variant: 'primary',
          hint: 'Take the session, then read the report',
        }
      : {
          label: 'Continue',
          short: 'Continue',
          intent: { kind: 'action', action: 'continue' },
          variant: 'primary',
          hint: 'Let the day pass',
        },
    secondary: training
      ? [
          { label: 'Plan the session', short: 'Plan', intent: { kind: 'view', view: 'training' }, variant: 'secondary' },
          { label: 'The calendar', short: 'Calendar', intent: { kind: 'action', action: 'open-planner' }, variant: 'quiet' },
        ]
      : [
          { label: 'The calendar', short: 'Calendar', intent: { kind: 'action', action: 'open-planner' }, variant: 'secondary' },
        ],
    progress,
    urgency,
    continueHint: 'Today',
  };
}

/**
 * The result of a match that finished today.
 *
 * The day the match is played has not been processed yet, so the calendar is
 * already looking forward to next Sunday. Saying what today has just produced
 * keeps the two from reading as though the game never happened.
 */
function resultPlayedToday(game: GameState): string | null {
  const match = game.lastMatchId ? game.matches[game.lastMatchId] : undefined;
  if (!match?.result || !match.played) return null;
  if (match.date !== game.date) return null;
  const opponent = game.clubs[matchOpponent(match, game.userClubId)]?.identity.shortName ?? 'them';
  const home = match.homeClubId === game.userClubId;
  const mine = home ? match.result.homeGoals : match.result.awayGoals;
  const theirs = home ? match.result.awayGoals : match.result.homeGoals;
  const verdict = mine > theirs ? 'won' : mine === theirs ? 'drew' : 'lost';
  return `${verdict} ${mine}–${theirs} against ${opponent}`;
}

/** The fixture the manager's own blocking event refers to. */
function todayFixture(game: GameState, attention: ContinueStop): Match | null {
  const id = attention.events.find((item) => item.matchId)?.matchId;
  if (!id) return null;
  const match = game.matches[id];
  if (!match || match.played) return null;
  return match;
}

/** Errors in the manager's own XI: what stops a match being ready to play. */
function lineupProblems(game: GameState, match: Match, clubId: string): string[] {
  const isHome = match.homeClubId === clubId;
  const lineup = isHome ? match.lineups.home : match.lineups.away;
  const players = (id: string) => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  };
  return validateLineup(lineup.starting, lineup.bench, players)
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message);
}

const WEATHER_WORDS: Record<string, string> = {
  clear: 'clear and bright',
  overcast: 'overcast',
  windy: 'windy',
  'light-rain': 'light rain',
  'heavy-rain': 'heavy rain',
  cold: 'cold and raw',
  frozen: 'frozen',
};

function personName(game: GameState, personId: string): string {
  const person = game.people[personId];
  return person ? `${person.firstName} ${person.surname}` : 'to be confirmed';
}

function todayEyebrow(iso: ISODate): string {
  return weekdayName(iso);
}

function competitionDay(match: Match): string {
  return weekdayName(match.date);
}

function weekdayName(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()] ?? 'Sunday';
}

function formatDateLong(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return `${weekdayName(iso)} ${date.getUTCDate()} ${date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
}
