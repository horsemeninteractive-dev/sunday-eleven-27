import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId } from '@/domain/ids';
import type { GameEvent, NewsItem } from '@/domain/news';
import type { Match } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { addDays } from './calendar';
import { recoverPlayerDaily, rollDailyLifeChange } from './availability';
import { applyMatchConsequences, matchReportEvent } from './consequences';
import { applyMatchdayFinances, applyStandingCosts, applySubsAndSponsorship } from './finance';
import { createEvent, publishEvents } from './news';
import { sessionDatesFor, sessionKeyFor } from './training/plan';
import { ensureTrainingConducted } from './training/session';
import { describeSessionQuality } from '@/domain/training';
import { weeklyApproaches, type DiscoveryResult } from './recruitment/discovery';
import { computeStandings } from './league';
import { prepareMatchday } from './matchday';
import { simulateToCompletion } from './match/engine';
import { matchEnvironment } from './matchday';
import { rollWeeklyAvailabilityForAll } from './gameSetup';
import { decidePostponement, isActiveFixture, postponeFixture } from './postponement';
import { stream } from './rng';
import { everyFixtureSettled, finishSeason } from './season';
import { snapshotStandings } from './gameSetup';
import { eventsOn, markNotifiedThrough, nextFixtureFor, recursOn, recurringEvents } from './schedule';
import { matchdaysPlayed, nextMatchday, seasonCalendarExhausted } from './timeline';

/**
 * A day in the life of a Sunday league club.
 *
 * `processDay` simulates exactly one date and moves the clock on. The order is
 * fixed and the same every day, which is what makes a save reproducible: the
 * same state and the same seed always produce the same Tuesday.
 *
 *   1. **The environment.** The day's weather and pitch, rolled from the place
 *      and the date. Same day, same weather, every time it is asked for.
 *   2. **Bookkeeping.** Dated money (subs on a Friday, standing costs on a
 *      Wednesday) and the weekly availability list on the Monday of a match
 *      week. These do not depend on anybody's legs.
 *   3. **Bodies.** Every player in the world recovers a day: fitness returns,
 *      an injury's `daysOut` counts down, form and morale drift. Somebody whose
 *      injury reaches zero is back, today.
 *   4. **Life.** Shifts change, family things come up, niggles clear or get
 *      worse. Most days, nothing happens to anybody.
 *   5. **Football.** Thursday's session is run, then any fixtures dated today:
 *      a pitch inspection first (fixtures can be called off), then the games
 *      that are not the manager's own. His own match is never taken out of his
 *      hands.
 *   6. **The world and the club.** Recruitment approaches, local gossip, and
 *      other clubs getting on with it.
 *   7. **The season.** If the last Sunday has gone and every fixture is
 *      settled, the season is closed and archived.
 *   8. **Publish.** Everything the day produced becomes news, the manager is
 *      marked as having been told, and the date moves to tomorrow.
 */

export interface MatchSummary {
  matchId: MatchId;
  homeClubId: ClubId;
  awayClubId: ClubId;
  homeGoals: number;
  awayGoals: number;
  involvesUser: boolean;
}

export interface DayOutcome {
  date: ISODate;
  nextDate: ISODate;
  events: GameEvent[];
  news: NewsItem[];
  notes: string[];
  results: MatchSummary[];
  userMatchId: MatchId | null;
  /** Something happened that the manager will want to look at. */
  flagged: boolean;
  seasonFinished: boolean;
}

export interface DayOptions {
  /**
   * Take the manager's own fixture out of his hands and simulate it. Used by
   * "simulate the result" and by the whole-week shortcut.
   */
  resolveUserMatch?: boolean;
}

export function processDay(
  state: GameState,
  date: ISODate = state.date,
  options: DayOptions = {},
): DayOutcome {
  // For the length of this call, "today" is this date: everything that happens
  // is dated by the day that caused it.
  state.date = date;

  const events: GameEvent[] = [];
  const notes: string[] = [];
  const results: MatchSummary[] = [];

  prepareToday(state, date);

  events.push(...applyAvailabilityRoll(state, date));
  events.push(...applyDatedMoney(state, date));

  const recovery = applyRecovery(state);
  events.push(...recovery.events);
  notes.push(...recovery.notes);

  events.push(...applyDailyLife(state, date));
  events.push(...applyTraining(state, date, notes));

  const football = applyFixtures(state, date, options);
  events.push(...football.events);
  notes.push(...football.notes);
  results.push(...football.results);

  events.push(...applyWorldDay(state, date));

  const nextDate = addDays(date, 1);
  events.push(...applyStandingsSnapshot(state, date, nextDate));

  const season = applySeasonBoundary(state, date, nextDate);
  events.push(...season.events);

  const news = publishEvents(state, events);
  markNotifiedThrough(state, date);

  state.date = nextDate;

  return {
    date,
    nextDate,
    events,
    news,
    notes,
    results,
    userMatchId: football.userMatchId,
    flagged: events.some((item) => item.importance >= 2),
    seasonFinished: season.finished,
  };
}

// ---------------------------------------------------------------------------
// 1. The environment
// ---------------------------------------------------------------------------

/**
 * Today's fixtures need their weather, their referee and their default lineups
 * before anybody can be stopped by one. This is idempotent — the conditions are
 * rolled from the fixture id — so the match the manager looked at on Wednesday
 * is the match he kicks off on Sunday.
 */
/**
 * The same work, reachable from outside the day loop.
 *
 * The clock stops *on* a matchday rather than passing through it, so the day the
 * manager actually plays on is never processed — without this he would arrive at
 * his own fixture with two empty teams, and nothing for the opposition. Every
 * place that offers him his next match calls this first; it is idempotent, so
 * the match he looked at on Wednesday is the match he kicks off on Sunday.
 */
export function readyForToday(state: GameState, date: ISODate = state.date): void {
  prepareToday(state, date);
}

function prepareToday(state: GameState, date: ISODate): void {
  const matchday = state.season.calendar.find((entry) => entry.date === date)?.matchday;
  if (matchday) prepareMatchday(state, matchday);

  // A match rearranged into a midweek slot still needs preparing on the day.
  for (const match of Object.values(state.matches)) {
    if (match.date !== date || match.played || match.status === 'abandoned') continue;
    if (match.lineups.home.starting.length > 0 && match.refereeId) continue;
    prepareMatchdayForFixture(state, match);
  }
}

function prepareMatchdayForFixture(state: GameState, match: Match): void {
  prepareMatchday(state, match.matchday);
}

// ---------------------------------------------------------------------------
// 2. Bookkeeping on its own dates
// ---------------------------------------------------------------------------

/** Monday: the list for the coming Sunday goes up. */
function applyAvailabilityRoll(state: GameState, date: ISODate): GameEvent[] {
  // Asked of the rule book rather than worked out again here: the list goes up
  // every Monday of the club's year, pre-season included.
  const due = recurringEvents(state).some((rule) => rule.id === 'rec_availability' && recursOn(rule, date));
  if (!due) return [];
  // The model itself lives in gameSetup; this only decides *when* it runs. The
  // roll is keyed on the date, so asking twice for the same Monday is safe.
  rollWeeklyAvailabilityForAll(state);
  return [];
}

/** Friday's subs book, Wednesday's standing costs, dated by the event. */
function applyDatedMoney(state: GameState, date: ISODate): GameEvent[] {
  const events: GameEvent[] = [];
  const rules = recurringEvents(state);
  const subsDue = rules.some((rule) => rule.id === 'rec_subs' && recursOn(rule, date));
  const costsDue = rules.some((rule) => rule.id === 'rec_costs' && recursOn(rule, date));
  if (!subsDue && !costsDue) return events;

  const competition = Object.values(state.competitions)[0];
  for (const clubId of competition?.clubIds ?? []) {
    if (subsDue) applySubsAndSponsorship(state, clubId, date);
    if (costsDue) applyStandingCosts(state, clubId, date);
    if (clubId === state.userClubId && (state.clubs[clubId]?.finances.balance ?? 0) < 0) {
      events.push(
        createEvent(state, {
          type: 'finances-warning',
          importance: costsDue ? 3 : 2,
          clubIds: [clubId],
          data: {
            club: state.clubs[clubId]?.identity.shortName ?? 'the club',
            balance: state.clubs[clubId]?.finances.balance ?? 0,
          },
        }),
      );
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// 3. Bodies
// ---------------------------------------------------------------------------

function applyRecovery(state: GameState): { events: GameEvent[]; notes: string[] } {
  const events: GameEvent[] = [];
  const notes: string[] = [];

  for (const person of Object.values(state.people)) {
    if (!isPlayer(person)) continue;
    const player = person;
    const before = player.injury?.description ?? null;
    const recovery = recoverPlayerDaily(player);
    if (recovery.returned && player.clubId === state.userClubId) {
      events.push(
        createEvent(state, {
          type: 'injury',
          importance: 1,
          clubIds: [player.clubId],
          personIds: [player.id],
          data: {
            player: `${player.firstName} ${player.surname}`,
            club: state.clubs[player.clubId]?.identity.shortName ?? 'the club',
            description: before ?? 'his knock',
            daysOut: 0,
          },
        }),
      );
      notes.push(`${player.firstName} ${player.surname} is over ${before ?? 'his knock'} and back in training.`);
    }
  }

  return { events, notes };
}

// ---------------------------------------------------------------------------
// 4. Life
// ---------------------------------------------------------------------------

/**
 * Availability changes when life happens, not when a week advances.
 *
 * The user's own squad gets a line in the news when somebody's Sunday changes;
 * the rest of the world is simulated silently, which is the tier that keeps a
 * county of football affordable.
 */
function applyDailyLife(state: GameState, date: ISODate): GameEvent[] {
  const events: GameEvent[] = [];
  const clubId = state.userClubId;
  const fixtures = Object.values(state.matches).filter(
    (match) => !match.played && match.status === 'scheduled',
  );

  for (const person of Object.values(state.people)) {
    if (!isPlayer(person)) continue;
    const player = person;
    if (!player.clubId) continue;
    const rng = stream(state.seed, 'daily-life', date, player.id);
    const nextMatch =
      fixtures.find(
        (match) => match.homeClubId === player.clubId || match.awayClubId === player.clubId,
      ) ?? null;
    const change = rollDailyLifeChange({ rng, player, date, matchDate: nextMatch?.date ?? null });
    if (!change) continue;

    if (change.kind === 'loses') {
      player.availability = {
        status: 'unavailable',
        reason: change.reason,
        note: change.note,
        until: null,
        discoveredLate: false,
      };
    } else if (change.kind === 'doubts') {
      player.availability = {
        status: 'doubtful',
        reason: change.reason,
        note: change.note,
        until: null,
        discoveredLate: false,
      };
    } else if (change.kind === 'worsens') {
      player.availability = {
        status: 'unavailable',
        reason: change.reason,
        note: change.note,
        until: null,
        discoveredLate: false,
      };
    } else {
      player.availability = {
        status: 'available',
        reason: null,
        note: null,
        until: null,
        discoveredLate: false,
      };
    }

    if (player.clubId !== clubId) continue;
    if (change.kind === 'clears') {
      events.push(
        createEvent(state, {
          type: 'calendar',
          importance: 1,
          clubIds: [clubId],
          personIds: [player.id],
          data: {
            headline: `${player.firstName} ${player.surname} is available again`,
            body: `${change.note}. He is in the frame for ${nextMatch ? 'Sunday' : 'the next game'}.`,
          },
        }),
      );
    } else {
      events.push(
        createEvent(state, {
          type: 'player-unavailable',
          importance: 2,
          clubIds: [clubId],
          personIds: [player.id],
          data: {
            player: `${player.firstName} ${player.surname}`,
            club: state.clubs[clubId]?.identity.shortName ?? 'the club',
            note: change.note,
          },
        }),
      );
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// 5. Football
// ---------------------------------------------------------------------------

function applyTraining(state: GameState, date: ISODate, notes: string[]): GameEvent[] {
  if (!sessionDatesFor(state).includes(date)) return [];

  const events: GameEvent[] = [];
  const outcome = ensureTrainingConducted(state, sessionKeyFor(state, date));
  events.push(...outcome.events);
  if (outcome.session) {
    const session = outcome.session;
    const club = state.clubs[state.userClubId];
    notes.push(
      session.cancelled
        ? `Training was called off: ${session.summary}`
        : `Training: ${session.attended} of ${club?.squadIds.length ?? 0} turned up out of ${session.expectedAttending} expected. ${describeSessionQuality(session.quality).label}.`,
    );
  }
  return events;
}

interface FixtureOutcome {
  events: GameEvent[];
  notes: string[];
  results: MatchSummary[];
  userMatchId: MatchId | null;
}

/**
 * Today's fixtures.
 *
 * A pitch inspection comes first: the game can be called off, and when it is,
 * the original fixture records why and a replacement is arranged. Then the
 * games that are not the manager's are played out — the league does not wait
 * for him — while his own is left alone, because it is his.
 */
function applyFixtures(state: GameState, date: ISODate, options: DayOptions): FixtureOutcome {
  const outcome: FixtureOutcome = { events: [], notes: [], results: [], userMatchId: null };
  const todays = Object.values(state.matches).filter(
    (match) => match.date === date && isActiveFixture(match),
  );
  if (todays.length === 0) return outcome;

  // --- The pitch inspection -------------------------------------------------
  const playable: Match[] = [];
  for (const match of todays) {
    const decision = decidePostponement(state, match, date);
    if (!decision.postpone || !decision.reason) {
      playable.push(match);
      continue;
    }
    const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
    const replacement = postponeFixture(state, match, date, decision.reason);
    const home = state.clubs[match.homeClubId]?.identity.shortName ?? 'Home';
    const away = state.clubs[match.awayClubId]?.identity.shortName ?? 'Away';
    outcome.events.push(
      createEvent(state, {
        type: 'postponement',
        importance: involvesUser ? 3 : 1,
        clubIds: [match.homeClubId, match.awayClubId],
        matchId: match.id,
        data: {
          fixture: `${home} v ${away}`,
          reason: decision.reason,
          rearranged: replacement ? replacement.date : '',
          headline: `${home} v ${away} is off`,
        },
      }),
    );
    if (involvesUser) {
      outcome.notes.push(
        replacement
          ? `Your game was called off — ${decision.reason.toLowerCase()}. It has been rearranged for ${replacement.date}.`
          : `Your game was called off and there is no room left in the season to replay it.`,
      );
    }
  }

  // --- The games themselves -------------------------------------------------
  let otherReports = 0;
  for (const match of playable) {
    const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
    if (involvesUser && !options.resolveUserMatch) {
      // Left where it is: the manager has to play it, or send it to the bench.
      continue;
    }
    if (involvesUser) outcome.userMatchId = match.id;

    // Before a ball is kicked, the morning calls. Somebody's car has gone, or
    // his shift moved, and he tells you two hours before kick-off.
    if (involvesUser) outcome.events.push(...callLateWithdrawals(state, match, date));

    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    simulateToCompletion(match, env);
    const consequences = applyMatchConsequences(state, match);
    outcome.events.push(...consequences.events);
    applyMatchdayFinances(state, match);

    if (involvesUser) {
      outcome.events.push(matchReportEvent(state, match, 3));
      const reported = match.result;
      if (reported) {
        const mine = match.homeClubId === state.userClubId ? reported.homeGoals : reported.awayGoals;
        const theirs = match.homeClubId === state.userClubId ? reported.awayGoals : reported.homeGoals;
        const opponentId = match.homeClubId === state.userClubId ? match.awayClubId : match.homeClubId;
        const verdict = mine > theirs ? 'won' : mine === theirs ? 'drew' : 'lost';
        outcome.notes.push(
          `You ${verdict} ${mine}–${theirs} ${
            match.homeClubId === state.userClubId ? 'at home to' : 'away at'
          } ${state.clubs[opponentId]?.identity.name ?? 'the opposition'}.`,
        );
      }
    } else if (otherReports < 2) {
      const notable = notableResultEvent(state, match);
      if (notable) {
        outcome.events.push(notable);
        otherReports += 1;
      }
    }

    if (match.result) {
      outcome.results.push({
        matchId: match.id,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        homeGoals: match.result.homeGoals,
        awayGoals: match.result.awayGoals,
        involvesUser,
      });
    }
    if (involvesUser) state.lastMatchId = match.id;
  }

  const others = playable.length - (outcome.userMatchId ? 1 : 0);
  if (others > 0 && outcome.results.length > 0) {
    outcome.notes.push(
      `${others} other fixture${others === 1 ? '' : 's'} went ahead in the division.`,
    );
  }

  return outcome;
}

/**
 * The late withdrawal.
 *
 * Not "he is unavailable this week" — "he has just rung you". At most one per
 * game, and only ever for a player who was in the frame, which is exactly the
 * Sunday morning problem the manager has to solve.
 */
export function callLateWithdrawals(state: GameState, match: Match, date: ISODate): GameEvent[] {
  const events: GameEvent[] = [];
  if (match.lateCallMade) return events;
  match.lateCallMade = true;
  const squad = state.clubs[state.userClubId]?.squadIds ?? [];
  const rng = stream(state.seed, 'late-withdrawal', match.id, date);
  if (!rng.chance(0.16)) return events;

  const candidates = squad
    .map((id) => state.people[id])
    .filter((person): person is Player => isPlayer(person))
    .filter((player) => player.availability.status === 'available' && !player.injury)
    // The least reliable ones are the ones you cannot rely on.
    .sort((a, b) => a.attributes.behavioural.reliability - b.attributes.behavioural.reliability);

  if (candidates.length < 12) return events;
  const unlucky = candidates[Math.floor(rng.next() * Math.min(3, candidates.length))];
  if (!unlucky) return events;

  const note = rng.pick([
    'Car will not start and it is a two-bus journey',
    'Called into work at short notice',
    'Done his ankle in the garden',
    'Forgot he is at his sister’s wedding',
    'Been up all night with the baby',
  ]);
  unlucky.availability = {
    status: 'unavailable',
    reason: 'unexplained',
    note,
    until: null,
    discoveredLate: true,
  };
  events.push(
    createEvent(state, {
      type: 'player-unavailable',
      importance: 3,
      clubIds: [state.userClubId],
      personIds: [unlucky.id],
      matchId: match.id,
      data: {
        player: `${unlucky.firstName} ${unlucky.surname}`,
        club: state.clubs[state.userClubId]?.identity.shortName ?? 'the club',
        note,
      },
    }),
  );
  return events;
}

/** Results elsewhere worth mentioning. */
export function notableResultEvent(state: GameState, match: Match): GameEvent | null {
  if (!match.result) return null;
  const margin = Math.abs(match.result.homeGoals - match.result.awayGoals);
  if (margin < 3) return null;

  const home = state.clubs[match.homeClubId];
  const away = state.clubs[match.awayClubId];
  if (!home || !away) return null;

  const competition = Object.values(state.competitions)[0];
  const standings = computeStandings({
    clubIds: competition?.clubIds ?? [],
    matches: Object.values(state.matches),
    competitionId: competition?.id ?? '',
    clubName: (id) => state.clubs[id]?.identity.name ?? id,
  });
  const positionOf = (clubId: ClubId) => standings.findIndex((row) => row.clubId === clubId) + 1;

  const homeWon = match.result.homeGoals > match.result.awayGoals;
  const winnerId = homeWon ? home.id : away.id;
  const loserId = homeWon ? away.id : home.id;
  const winnerPosition = positionOf(winnerId);
  const loserPosition = positionOf(loserId);
  const upset = winnerPosition > 0 && loserPosition > 0 && winnerPosition - loserPosition >= 5;
  const rivalry = (home.rivalries[away.id]?.intensity ?? 0) >= 60;
  const thrashing = margin >= 5;
  if (!(upset || (thrashing && rivalry))) return null;
  return matchReportEvent(state, match, 2);
}

// ---------------------------------------------------------------------------
// 6. The world and the club
// ---------------------------------------------------------------------------

/**
 * Local football carries on whether or not the manager is looking.
 *
 * The division is already simulated in full — its players train on a Thursday,
 * get injured, recover and play on a Sunday. This adds the tier below that: the
 * occasional line of local gossip, drawn from clubs and people that really
 * exist in the world, so the county does not feel like scenery.
 */
function applyWorldDay(state: GameState, date: ISODate): GameEvent[] {
  const events: GameEvent[] = [];
  const rng = stream(state.seed, 'world', date);

  // Recruitment: somebody's mate gets in touch on a Tuesday.
  const approachDay = state.season.calendar.some((entry) => addDays(entry.date, -4) === date);
  if (approachDay) {
    const result: DiscoveryResult = weeklyApproaches(state);
    events.push(...result.events);
  }

  if (!rng.chance(0.09)) return events;

  const others = Object.values(state.clubs).filter((club) => club.id !== state.userClubId);
  if (others.length === 0) return events;
  const club = rng.pick(others);
  const town = state.world.towns[club.townId]?.name ?? 'the village';
  const lines = [
    {
      headline: `Word from ${town}`,
      body: `${club.identity.name} are a couple short for Sunday and have been asking around.`,
    },
    {
      headline: `${club.identity.name} are looking`,
      body: `A goalkeeper, apparently — the one they have has been playing with a bad shoulder for a month.`,
    },
    {
      headline: `Trouble at ${club.identity.name}?`,
      body: `Two of their older lads have not been seen at training for a fortnight, and nobody at ${town} is saying why.`,
    },
    {
      headline: `${club.identity.name} get a helping hand`,
      body: `A local business has put a few quid behind the club for the rest of the season.`,
    },
  ];
  const line = rng.pick(lines);
  events.push(
    createEvent(state, {
      type: 'world',
      importance: 1,
      clubIds: [club.id],
      data: { headline: line.headline, body: line.body },
    }),
  );
  return events;
}

// ---------------------------------------------------------------------------
// 7. The season
// ---------------------------------------------------------------------------

/**
 * The table is photographed as each Sunday ends — the raw material of the
 * archive — and a big move in it is worth a line in the news.
 */
function applyStandingsSnapshot(state: GameState, date: ISODate, nextDate: ISODate): GameEvent[] {
  if (matchdaysJustPassed(state, date, nextDate) === 0) return [];

  state.standingHistory.push(snapshotStandings(state));
  const history = state.standingHistory;
  const previous = history[history.length - 2];
  const current = history[history.length - 1];
  if (!previous?.playerClubPosition || !current?.playerClubPosition) return [];

  const delta = previous.playerClubPosition - current.playerClubPosition;
  if (Math.abs(delta) < 2) return [];
  return [
    createEvent(state, {
      type: 'league-movement',
      importance: 1,
      clubIds: [state.userClubId],
      data: {
        club: state.clubs[state.userClubId]?.identity.shortName ?? 'the club',
        position: current.playerClubPosition,
        movement: delta > 0 ? 'climb' : 'slip',
        competition: Object.values(state.competitions)[0]?.name ?? 'the league',
      },
    }),
  ];
}

/** How many matchdays fall between two consecutive dates. */
function matchdaysJustPassed(state: GameState, date: ISODate, nextDate: ISODate): number {
  return matchdaysPlayed(state, nextDate) - matchdaysPlayed(state, date);
}

function applySeasonBoundary(
  state: GameState,
  date: ISODate,
  nextDate: ISODate,
): { events: GameEvent[]; finished: boolean } {
  if (state.season.finished) return { events: [], finished: false };
  // The season ends the day *after* the last Sunday: a rearranged game dated
  // past the end of the calendar still has to be played first.
  void date;
  if (!seasonCalendarExhausted(state, nextDate)) return { events: [], finished: false };
  // A rearranged game is still a game: the season waits for it.
  if (!everyFixtureSettled(state)) return { events: [], finished: false };

  const result = finishSeason(state);
  return { events: result.events, finished: true };
}

// ---------------------------------------------------------------------------
// Continuing
// ---------------------------------------------------------------------------

export interface ContinueOptions {
  /** Stop after this many days however quiet it is. */
  maxDays?: number;
}

export interface ContinueStop {
  date: ISODate;
  headline: string;
  detail: string;
  kind: 'blocking' | 'flagged' | 'season-end';
  events: ReturnType<typeof eventsOn>;
}

export interface ContinueOutcome {
  /** The days that were simulated, in order. */
  days: ISODate[];
  news: NewsItem[];
  /** Everything that happened, in the manager's words. */
  notes: string[];
  results: MatchSummary[];
  stop: ContinueStop | null;
  seasonFinished: boolean;
}

/**
 * The Continue button.
 *
 * Days pass until something needs the manager. A day worth stopping on stops
 * the clock *before* it is simulated, so he sees "Training tonight" while
 * standing on Thursday rather than reading about it afterwards. A day that
 * cannot pass — an unplayed fixture, the end of the season — refuses to move at
 * all. Everything in between is simulated and reported in the digest.
 */
export function continueTime(state: GameState, options: ContinueOptions = {}): ContinueOutcome {
  const maxDays = options.maxDays ?? 21;
  const outcome: ContinueOutcome = {
    days: [],
    news: [],
    notes: [],
    results: [],
    stop: null,
    seasonFinished: false,
  };

  for (let step = 0; step < maxDays; step += 1) {
    if (state.phase === 'complete') {
      outcome.stop = seasonStop(state);
      outcome.seasonFinished = true;
      return outcome;
    }

    const today = state.date;
    const blocking = eventsOn(state, today).filter(
      (item) => item.priority === 'critical' && item.resolvedOn === null,
    );
    if (blocking.length > 0) {
      outcome.stop = {
        date: today,
        headline: blocking[0]!.title,
        detail: blocking[0]!.detail,
        kind: 'blocking',
        events: blocking,
      };
      return outcome;
    }

    const flagged = eventsOn(state, today).filter(
      (item) => item.priority === 'important' && item.resolvedOn === null,
    );
    const alreadyTold = (state.schedule?.notifiedThrough ?? null) !== null && state.schedule.notifiedThrough! >= today;
    if (flagged.length > 0 && !alreadyTold) {
      outcome.stop = {
        date: today,
        headline: flagged[0]!.title,
        detail: flagged[0]!.detail,
        kind: 'flagged',
        events: flagged,
      };
      return outcome;
    }

    // Never take the manager's own fixture out of his hands: an unplayed one is
    // a blocking event, and the check at the top of this loop would have
    // returned before we got here.
    const day = processDay(state, today, { resolveUserMatch: false });
    outcome.days.push(today);
    outcome.news.push(...day.news);
    outcome.notes.push(...day.notes);
    outcome.results.push(...day.results);
    if (day.seasonFinished) outcome.seasonFinished = true;
  }

  return outcome;
}

function seasonStop(state: GameState): ContinueStop {
  const seasonEvents = eventsOn(state, state.date).filter((item) => item.kind === 'season-end');
  const events =
    seasonEvents.length > 0
      ? seasonEvents
      : [
          {
            id: 'season-over',
            date: state.date,
            time: null,
            kind: 'season-end' as const,
            priority: 'critical' as const,
            source: 'season' as const,
            title: `${state.season.label} is over`,
            detail: 'Start pre-season when you are ready.',
            resolvedOn: null,
            resolution: null,
            matchId: null,
            clubIds: [state.userClubId],
            personIds: [],
            data: {},
          },
        ];
  return {
    date: state.date,
    headline: events[0]!.title,
    detail: events[0]!.detail,
    kind: 'season-end',
    events,
  };
}

/**
 * What the manager has to deal with right now, without moving the clock.
 * The store uses this to decide what the command bar is offering.
 */
export function currentAttention(state: GameState): ContinueStop | null {
  if (state.phase === 'complete') return seasonStop(state);
  const today = state.date;
  const blocking = eventsOn(state, today).filter(
    (item) => item.priority === 'critical' && item.resolvedOn === null,
  );
  if (blocking.length > 0) {
    return { date: today, headline: blocking[0]!.title, detail: blocking[0]!.detail, kind: 'blocking', events: blocking };
  }
  // A day the manager has already been shown is not worth stopping on again:
  // pressing Continue twice should move the clock, not repeat the message.
  const told = (state.schedule?.notifiedThrough ?? null) !== null && state.schedule.notifiedThrough! >= today;
  if (told) return null;
  const flagged = eventsOn(state, today).filter(
    (item) => item.priority === 'important' && item.resolvedOn === null,
  );
  if (flagged.length > 0) {
    return { date: today, headline: flagged[0]!.title, detail: flagged[0]!.detail, kind: 'flagged', events: flagged };
  }
  return null;
}

/** The next fixture the manager has to think about. */
export function upcomingFixture(state: GameState): Match | null {
  return nextFixtureFor(state, state.userClubId, state.date);
}

// ---------------------------------------------------------------------------
// Compatibility: the old weekly step
// ---------------------------------------------------------------------------

export interface WeekOutcome {
  events: GameEvent[];
  results: MatchSummary[];
  userMatchId: MatchId | null;
  matchday: number;
  seasonFinished: boolean;
}

/**
 * Advance until the current matchday has been played.
 *
 * Continuous time made "a week" a convenience rather than a unit of
 * simulation, but tests and the quick-advance shortcut still think in weeks.
 * This runs the days until the matchday in hand has been settled, which is
 * exactly what the old weekly step did — it just does it a day at a time.
 */
export function advanceWeek(state: GameState, options: { instant?: boolean } = {}): WeekOutcome {
  const startMatchday = nextMatchday(state);
  const outcome: WeekOutcome = {
    events: [],
    results: [],
    userMatchId: null,
    matchday: startMatchday,
    seasonFinished: false,
  };

  void options;
  // One day at a time as far as the matchday in hand: with a pre-season in
  // front of a new career that can be a couple of months of days.
  for (let guard = 0; guard < 400; guard += 1) {
    if (state.phase === 'complete') {
      outcome.seasonFinished = true;
      return outcome;
    }
    // A whole week at once means the manager's game goes ahead too.
    const day = processDay(state, state.date, { resolveUserMatch: true });
    outcome.events.push(...day.events);
    outcome.results.push(...day.results);
    if (day.userMatchId) outcome.userMatchId = day.userMatchId;
    if (day.seasonFinished) outcome.seasonFinished = true;
    if (nextMatchday(state) > startMatchday) return outcome;
  }
  return outcome;
}
