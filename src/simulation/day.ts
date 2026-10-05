import type { Competition } from '@/domain/competition';
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

import { divisionOf, leagueClubIds, standingsFor, cupCompetitions } from './pyramid';
import {
  allCupRoundSlots,
  cupTieNews,
  drawCupRound,
  isLeagueMatchday,
  loserOf,
  matchesForRound,
  platePreliminaryLineup,
  readCupRound,
} from './cup';
import { prepareMatchday } from './matchday';
import { simulateMatchHeadless } from './match/matchEngine';
import { matchEnvironment } from './matchday';
import { rollWeeklyAvailabilityForAll } from './gameSetup';
import { decidePostponement, isActiveFixture, postponeFixture } from './postponement';
import { settleShortSides } from './forfeit';
import { stream } from './rng';
import { everyFixtureSettled, finishSeason } from './season';
import { snapshotStandings } from './gameSetup';
import { eventsOn, markNotifiedThrough, nextFixtureFor, recursOn, recurringEvents } from './schedule';
import { runDueFollowUps } from './communication/playerConversation';
import { announceAvailabilityChange } from './communication/availabilityComms';
import { announceOverdueSubs, paymentStandingFor } from './communication/paymentComms';
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

/**
 * A pause the day hands back to whoever asked for it.
 *
 * Playing out a matchday means running the same engine the manager watches,
 * headless, five or six times over — several seconds of work in which the
 * screen cannot repaint. A caller that can show a progress bar needs somewhere
 * to stand between two fixtures, so the loop yields before each one and again
 * once it has a result to report.
 *
 * `processDay` and `continueTime` are the drained form of these: same work, same
 * order, same result, and nothing for the caller to do.
 */
export type DayStep =
  | {
      kind: 'fixture';
      /** The day whose football is being played out. */
      date: ISODate;
      /** Fixtures finished so far on this day, and how many there are in all. */
      done: number;
      total: number;
      home: string;
      away: string;
    }
  | {
      kind: 'result';
      date: ISODate;
      done: number;
      total: number;
      /** The match as it would be written in the results table. */
      line: string;
    };

export function processDay(
  state: GameState,
  date: ISODate = state.date,
  options: DayOptions = {},
): DayOutcome {
  return drain(processDaySteps(state, date, options));
}

/** The same day, paused at every fixture so a caller can show progress. */
export function* processDaySteps(
  state: GameState,
  date: ISODate = state.date,
  options: DayOptions = {},
): Generator<DayStep, DayOutcome, void> {
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

  const football = yield* applyFixturesSteps(state, date, options);
  events.push(...football.events);
  notes.push(...football.notes);
  results.push(...football.results);

  events.push(...advanceCups(state));

  events.push(...applyWorldDay(state, date));

  // A player who said he would let the manager know has now had his chance to:
  // anybody the calendar says is owed a chase is written to today, and the
  // answer is read from the record as it stands now rather than from last
  // week's roll. This is the only place follow-ups are triggered, so nothing
  // else has to remember them.
  runDueFollowUps(state, date);

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


  // Every club in the county collects its subs and pays its costs, not only the
  // ones in the top division — otherwise the bottom of the pyramid would run on
  // nothing at all and would fold in a season.
  for (const clubId of leagueClubIds(state)) {
    if (subsDue) {
      applySubsAndSponsorship(state, clubId, date);
      // The manager is written to *after* the book has settled, never before,
      // and only about his own squad. The announcement fires on a threshold
      // being crossed and carries a key, so a man who stays behind is not
      // written to every Friday — which is the difference between a treasurer
      // telling him once and a treasurer telling him every week.
      if (clubId === state.userClubId) {
        const squad = state.clubs[clubId]?.squadIds ?? [];
        for (const playerId of squad) {
          if (!paymentStandingFor(state, playerId)) continue;
          announceOverdueSubs(state, playerId);
        }
      }
    }
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
    const statusBefore = player.availability.status;

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

    // The roll has written the record. Only now does anybody get told, and only
    // because something actually changed — a day that leaves a man where it
    // found him says nothing, and only the manager's own squad is written to,
    // because the rest of the county is simulated in silence. The announcement
    // reads the record the roll just wrote; it never writes one.
    if (player.clubId === clubId && statusBefore !== player.availability.status) {
      if (change.kind !== 'clears') {
        announceAvailabilityChange(state, player.id, {
          kind: change.kind,
          reason: change.reason,
          note: change.note,
        });
      }
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
/**
 * Run a generator to its end and hand back what it returned.
 *
 * The stepping variants exist only so a caller can stand between two fixtures.
 * Draining one is the same as never having stepped it, which is why every
 * internal caller keeps using the plain synchronous function.
 */
function drain<T>(steps: Generator<DayStep, T, void>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function* applyFixturesSteps(
  state: GameState,
  date: ISODate,
  options: DayOptions,
): Generator<DayStep, FixtureOutcome, void> {
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
  // The manager's own game is never in this count: he plays it himself, or sends
  // it to the bench, so it is not work the progress bar is waiting on.
  const othersToPlay = playable.filter(
    (match) => match.homeClubId !== state.userClubId && match.awayClubId !== state.userClubId,
  );
  let played = 0;
  for (const match of playable) {
    const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
    const home = state.clubs[match.homeClubId]?.identity.shortName ?? 'Home';
    const away = state.clubs[match.awayClubId]?.identity.shortName ?? 'Away';
    if (involvesUser && !options.resolveUserMatch) {
      // Left where it is: the manager has to play it, or send it to the bench.
      continue;
    }
    if (involvesUser) outcome.userMatchId = match.id;

    // Before a ball is kicked, the morning calls. Somebody's car has gone, or
    // his shift moved, and he tells you two hours before kick-off.
    if (involvesUser) outcome.events.push(...callLateWithdrawals(state, match, date));

    // A club with fewer than seven fit players has no team to put out. The
    // fixture is not simulated and not rearranged — it is forfeited, the
    // opposition is awarded the points, and the calendar moves on.
    const forfeit = settleShortSides(state, match);
    if (forfeit) {
      outcome.events.push(...forfeit.events);
      if (involvesUser) outcome.notes.push(forfeit.note);
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
      if (!involvesUser) {
        // A forfeit is decided without a ball being kicked, but the manager is
        // still waiting on it, so the bar counts it like any other game.
        played += 1;
        yield {
          kind: 'result',
          date,
          done: played,
          total: othersToPlay.length,
          line: match.result ? `${home} ${match.result.homeGoals}–${match.result.awayGoals} ${away}` : `${home} v ${away}`,
        };
      }
      continue;
    }

    // One engine decides every match, watched or not: an AI fixture is played
    // by the same MatchEngine the manager watches, headless. There is no second,
    // simplified simulation for the games he is not looking at.
    //
    // This is the moment the manager is waiting on — a second or more per game
    // — so the loop stands here and says which match is being worked out.
    if (!involvesUser) {
      yield {
        kind: 'fixture',
        date,
        done: played,
        total: othersToPlay.length,
        home,
        away,
      };
    }
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    simulateMatchHeadless(match, env);
    played += 1;
    const consequences = applyMatchConsequences(state, match);
    outcome.events.push(...consequences.events);
    // A cup tie that went the wrong way for the big club is the story of a cup
    // round, so it is written before the round is read back and advanced.
    outcome.events.push(...cupTieNews(state, match));
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
    if (!involvesUser) {
      yield {
        kind: 'result',
        date,
        done: played,
        total: othersToPlay.length,
        line: `${home} ${match.result?.homeGoals ?? 0}–${match.result?.awayGoals ?? 0} ${away}`,
      };
    }
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

  const competition = state.competitions[match.competitionId];
  const standings = competition
    ? standingsFor(state, competition)
    : [];
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

  const snapshots = snapshotStandings(state);
  state.standingHistory.push(...snapshots);

  // The news is about the manager's own division, so the movement is read from
  // that division's two most recent snapshots rather than from the county's.
  const division = divisionOf(state, state.userClubId);
  if (!division) return [];
  const own = state.standingHistory.filter((entry) => entry.competitionId === division.id);
  const previous = own[own.length - 2];
  const current = own[own.length - 1];
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
        competition: division.name,
      },
    }),
  ];
}

/**
 * The cups move on.
 *
 * A knockout has no table and no fixtures until it is drawn, so the day after
 * its ties are played is when the next round exists: the round that has just
 * finished is read back out of its results, the winners become the next round's
 * field, and the next round is drawn and put on the calendar. A round whose ties
 * are still waiting on a postponed replay is simply not finished, which is what
 * stops a cup advancing on a tie that never happened.
 */
function advanceCups(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  for (const cup of cupCompetitions(state)) {
    const cupState = cup.cup;
    if (!cupState || cupState.complete) continue;

    const outcome = readCupRound(state, cup);
    // `complete` is "every tie in this round has been settled"; `decided` is
    // "somebody has won the whole competition". Only the first one moves the
    // round on — a semi-final is complete long before it is decided.
    if (!outcome.complete) continue;
    events.push(...outcome.events);
    if (outcome.decided) continue; // the winner has already been crowned

    // The Plate is fed from the two opening rounds of the main cup: the four who
    // lose the preliminary and the sixteen who lose the round of thirty-two.
    // Both have to have happened, so this waits for the round that is fed by the
    // first of them and draws only once the second is known.
    if (cupState.round === plateFeedRound(cup)) {
      events.push(...feedPlate(state, cup));
    }

    // The next round is the winners, drawn into the calendar.
    cup.clubIds = [...outcome.survivors];
    cupState.round += 1;

    const slots = allCupRoundSlots(leagueCupField(state), leagueMatchdayCount(state), Boolean(cupState.consolationFor));
    const slot = slots.find((entry) => entry.round === cupState.round);
    if (!slot) {
      cupState.complete = true;
      continue;
    }
    const drawn = drawCupRound(state, cup, {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      leagueMatchdays: leagueMatchdayCount(state),
      announce: true,
    });
    events.push(...(drawn?.events ?? []));
  }
  return events;
}

/**
 * The main-cup round whose losers complete the Plate's field.
 *
 * With a preliminary the Plate needs both it and the round of thirty-two, so it
 * is fed when the second of them finishes. Without one, the opening round's
 * losers are the whole field and it is fed when that finishes.
 */
function plateFeedRound(main: Competition): number {
  const plan = main.cup?.plan ?? [];
  return plan.length > 0 && plan[0]!.entrants < plan[0]!.field ? 2 : 1;
}

/**
 * Draw the Plate's opening round from the main cup's losers.
 *
 * The Plate's own field is every club that lost the main cup's preliminary or
 * its round of thirty-two — twenty of them. Eight of those play, the other
 * twelve get a bye into the Plate's round of sixteen, and the four who lost the
 * preliminary have to be among the eight: they are already out of the main cup,
 * so leaving them to walk into the Plate's second round would hand a club a
 * second bite without playing for it.
 */
function feedPlate(state: GameState, main: Competition): GameEvent[] {
  const plate = cupCompetitions(state).find((entry) => entry.cup?.consolationFor === main.id);
  if (!plate?.cup || plate.clubIds.length > 0) return [];

  const mainPlan = main.cup?.plan ?? [];
  const planned = plate.cup.plan?.[0];
  const prelimLosers: ClubId[] = [];
  if (mainPlan[0] && mainPlan[0].entrants < mainPlan[0].field) {
    // The preliminary has finished by now — it is what fed this round.
    prelimLosers.push(...losersOfRound(state, main, 1));
  }
  // `main.cup.round` is still the round being fed at: `advanceCups` advances it
  // after this returns.
  const available = [...prelimLosers, ...losersOfRound(state, main, main.cup!.round)];

  const entrants = planned?.entrants ?? available.length;
  const { playIn, byes } = platePreliminaryLineup(available, prelimLosers, entrants);

  // The byes are real entrants: they sit this round out and are still in the
  // competition, so they join the winners in the round of sixteen.
  plate.clubIds = [...playIn, ...byes];
  plate.cup = { ...plate.cup, round: 1, complete: false, winnerClubId: null, runnerUpClubId: null };

  const drawn = drawCupRound(state, plate, {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    leagueMatchdays: leagueMatchdayCount(state),
    announce: true,
    playIn,
  });
  return drawn?.events ?? [];
}

/** The clubs that went out of one round of a cup, read back off the ties. */
function losersOfRound(state: GameState, competition: Competition, round: number): ClubId[] {
  return matchesForRound(state, competition, round)
    .filter((tie) => !isActiveFixture(tie))
    .map(loserOf);
}

/** How many of this season's matchdays are league Sundays. */
function leagueMatchdayCount(state: GameState): number {
  return Math.max(1, state.season.calendar.filter((entry) => isLeagueMatchday(state, entry.matchday)).length);
}

/** How many clubs the League Cup starts with. */
function leagueCupField(state: GameState): number {
  return leagueClubIds(state).length;
}

// ---------------------------------------------------------------------------
// 6. The world and the club
// ---------------------------------------------------------------------------
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
  return drain(continueTimeSteps(state, options));
}

/**
 * The Continue button, paused at every fixture.
 *
 * The manager presses Continue after a match and the league plays on around him:
 * one engine run per other club, each of them long enough to look like a freeze.
 * This hands the caller a step before each of those games so it can show which
 * one is being worked out, and the same `ContinueOutcome` at the end.
 */
export function* continueTimeSteps(
  state: GameState,
  options: ContinueOptions = {},
): Generator<DayStep, ContinueOutcome, void> {
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
      // He has now been shown it, so the day counts as told.
      //
      // This is what "pressing Continue twice should move the clock, not repeat
      // the message" actually requires. Nothing else can mark it, because the
      // only thing that marks a day is simulating it — and this is precisely a
      // day we are refusing to simulate. So without this the flag is shown
      // once and then shown forever: Continue stops on the same day, every
      // press, and the career cannot be moved past it at all.
      //
      // The event itself stays unresolved, so a Thursday's training is still
      // waiting to be run and still shows in the training view. All this says is
      // that he has read the notice, not that he has acted on it.
      markNotifiedThrough(state, today);
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
    const day = yield* processDaySteps(state, today, { resolveUserMatch: false });
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
  const flagged = eventsOn(state, today).filter(
    (item) => item.priority === 'important' && item.resolvedOn === null,
  );
  // A day the manager has already been shown is normally not worth stopping on
  // again: pressing Continue twice should move the clock, not repeat the
  // message.
  //
  // The exception is the training session. A notice being read is not the same
  // as the session being run, and the session only leaves the day's events once
  // it has been recorded. Without this the command bar would fall through to
  // Continue on a training Thursday, and pressing it would run the session out
  // from under the manager and move the clock on — which is exactly what made
  // pre-season skip its training days.
  const told = (state.schedule?.notifiedThrough ?? null) !== null && state.schedule.notifiedThrough! >= today;
  const pending = told ? flagged.filter((item) => item.kind === 'training') : flagged;
  if (pending.length > 0) {
    return { date: today, headline: pending[0]!.title, detail: pending[0]!.detail, kind: 'flagged', events: pending };
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
