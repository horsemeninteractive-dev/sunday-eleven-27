import type { GameState } from '@/domain/game';
import type { ClubId, MatchId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import type { Match } from '@/domain/match';
import { isPlayer, createSystemFamiliarity, type Player } from '@/domain/person';
import { yearOf } from './calendar';
import { applyAnnualCosts } from './finance';
import { buildSeasonCalendar, kickOffTimeFor, preSeasonStart, seasonLabelFor } from './calendar';
import { createMatchRecord, prepareMatchday } from './matchday';
import { arrangePreSeason } from './preseason';
import { buildFixtureList, generateFixtures, matchdayCount } from './generation/fixtureGenerator';
import { generatePlayer, resetPlayerIdCounter } from './generation/playerGenerator';
import { linkNewTeammate } from './generation/relationshipGenerator';
import { refreshUnattachedPool } from './generation/unattachedPlayers';
import { pruneTrainingHistory, trainingStore } from './training/store';
import { pruneCandidates } from './recruitment/store';
import { createEvent } from './news';
import { firstSundayOfSeptember, rollWeeklyAvailabilityForAll, snapshotStandings } from './gameSetup';
import { computeStandings } from './league';
import { emptyScheduleState } from './schedule';
import { weekStartOf } from './timeline';
import { applyRelationshipEvent, relationshipStore, relationshipViewsFor } from './relationships';
import { defaultTactics } from '@/domain/tactics';
import { Rng, stream } from './rng';

/**
 * The ends of things.
 *
 * A season does not "roll over" because a function was called at the right
 * point in a weekly loop: it ends because the calendar has reached the day after
 * the last Sunday and every fixture has been settled, and the next one begins
 * because the manager has decided to start it.
 */

export interface SeasonFinishResult {
  events: GameEvent[];
  championClubId: ClubId | null;
  playerPosition: number | null;
}

/**
 * Close the season: archive the table, award the honours, and put the game into
 * its off-season state. Returns the news rather than publishing it, so the daily
 * engine can publish everything from one day together.
 */
export function finishSeason(state: GameState): SeasonFinishResult {
  const competition = Object.values(state.competitions)[0];
  const events: GameEvent[] = [];
  if (!competition) return { events, championClubId: null, playerPosition: null };

  const standings = computeStandings({
    clubIds: competition.clubIds,
    matches: Object.values(state.matches),
    competitionId: competition.id,
    clubName: (id) => state.clubs[id]?.identity.name ?? id,
  });

  standings.forEach((row, index) => {
    const club = state.clubs[row.clubId];
    const record = club?.history.seasons.find((season) => season.seasonId === state.season.id);
    if (!record) return;
    record.finalPosition = index + 1;
    record.points = row.points;
    record.played = row.played;
    record.won = row.won;
    record.drawn = row.drawn;
    record.lost = row.lost;
    record.goalsFor = row.goalsFor;
    record.goalsAgainst = row.goalsAgainst;
  });

  const champion = state.clubs[standings[0]?.clubId ?? ''];
  if (champion) {
    champion.history.honours.push(`${state.season.label} ${competition.name} champions`);
    champion.history.notableEvents.unshift({
      date: state.date,
      seasonLabel: state.season.label,
      description: `Won ${competition.name}.`,
      importance: 3,
    });
  }

  const playerRow = standings.findIndex((row) => row.clubId === state.userClubId) + 1;
  const playerClub = state.clubs[state.userClubId];
  const position = playerRow > 0 ? playerRow : null;
  const phrase =
    position === null
      ? 'The season is over'
      : position === 1
        ? 'finished top'
        : position === 2
          ? 'finished second'
          : position === 3
            ? 'finished third'
            : `finished ${position}th`;

  events.push(
    createEvent(state, {
      type: 'season-milestone',
      importance: 3,
      clubIds: [champion?.id, state.userClubId].filter((id): id is ClubId => Boolean(id)),
      data: {
        headline: `${champion?.identity.name ?? 'Champions'} win ${competition.name}`,
        body: `${playerClub?.identity.name ?? 'Your club'} ${phrase} with ${
          standings.find((row) => row.clubId === state.userClubId)?.points ?? 0
        } points. Time for the AGM, the presentation night and a rest.`,
      },
    }),
  );

  state.phase = 'complete';
  state.season.finished = true;
  state.standingHistory = [state.standingHistory[state.standingHistory.length - 1] ?? snapshotStandings(state)];
  return { events, championClubId: champion?.id ?? null, playerPosition: position };
}

/**
 * True when there is nothing left to play.
 *
 * A fixture that was called off counts as settled once it has a replacement:
 * the replacement is the game now, and it will be played on its own date.
 */
export function everyFixtureSettled(state: GameState): boolean {
  return Object.values(state.matches).every(
    (match) =>
      match.played ||
      match.status === 'abandoned' ||
      (match.status === 'postponed' && match.replacedByMatchId !== null),
  );
}

/**
 * Roll the world into a new season: ageing, retirements, new fixtures, and a
 * fresh calendar that starts on the Monday before the first Sunday, so the
 * manager gets the build-up rather than landing on a matchday.
 */
export function startNextSeason(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const competition = Object.values(state.competitions)[0]!;
  const previousSeason = state.season;
  const nextYear = yearOf(previousSeason.startDate) + 1;
  const firstSunday = firstSundayOfSeptember(nextYear);
  // A new season opens with pre-season, exactly as the first one did: six
  // Sundays before the football, starting on the Monday of the first of them.
  const firstPreSeasonSunday = preSeasonStart(firstSunday);
  const seasonStart = weekStartOf(firstPreSeasonSunday);
  const seasonId = `season_${nextYear}_${String((nextYear + 1) % 100).padStart(2, '0')}`;
  const seasonLabel = seasonLabelFor(firstSunday);

  resetPlayerIdCounter();

  // Ageing, retirement and squad top-ups.
  for (const clubId of competition.clubIds) {
    const club = state.clubs[clubId];
    if (!club) continue;
    const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer) as Player[];
    const retirees: Player[] = [];

    for (const player of squad) {
      player.age += 1;
      player.fitness = 100;
      player.form = 50;
      player.injury = null;
      player.morale = Math.max(45, player.morale);
    }

    // Legs go before the head does: the oldest and slowest call it a day.
    const overTheHill = squad.filter(
      (player) => player.age >= 41 || (player.age >= 38 && player.attributes.physical.pace <= 6),
    );
    for (const player of overTheHill) {
      player.clubId = null;
      player.registered = false;
      player.roles = [];
      player.notes.push(`Retired at the end of ${previousSeason.label}.`);
      club.squadIds = club.squadIds.filter((id) => id !== player.id);
      retirees.push(player);
    }

    for (const retiree of retirees) {
      for (const view of relationshipViewsFor(state, retiree.id)) {
        const other = state.people[view.otherId];
        if (!isPlayer(other) || other.clubId !== clubId) continue;
        applyRelationshipEvent(state, {
          type: 'left-club',
          aId: retiree.id,
          bId: other.id,
          intensity: 1,
          date: seasonStart,
          clubId,
        });
      }
    }

    const rng = stream(state.seed, 'recruitment', seasonId, clubId);
    let added = 0;
    while (club.squadIds.length < 20) {
      const newPlayer = generatePlayer({
        rng,
        id: `${clubId}_n${seasonId}_${added + 1}`,
        clubId,
        townId: club.townId,
        homeGroundId: club.groundId,
        quality: 9 + club.reputation / 20,
        seasonStart,
      });
      state.people[newPlayer.id] = newPlayer;
      const teammates = club.squadIds.filter((id) => id !== newPlayer.id);
      club.squadIds.push(newPlayer.id);
      linkNewTeammate(relationshipStore(state), state.seed, club, newPlayer.id, teammates, seasonStart);
      added += 1;
    }

    if (clubId === state.userClubId) {
      for (const retiree of retirees) {
        events.push(
          createEvent(state, {
            type: 'club-news',
            importance: 2,
            clubIds: [clubId],
            personIds: [retiree.id],
            data: {
              headline: `${retiree.firstName} ${retiree.surname} hangs up his boots`,
              body: `After ${retiree.record.appearances} appearances and ${retiree.record.goals} goals, ${retiree.firstName} ${retiree.surname} has called it a day at ${retiree.age}.`,
            },
          }),
        );
      }
      if (added > 0) {
        events.push(
          createEvent(state, {
            type: 'club-news',
            importance: 2,
            clubIds: [clubId],
            data: {
              headline: `${added} new face${added > 1 ? 's' : ''} at pre-season`,
              body: `${added} new player${added > 1 ? 's have' : ' has'} been registered ahead of the ${seasonLabel} season. Pre-season starts now.`,
            },
          }),
        );
      }
    }
  }

  refreshUnattachedPool(state, seasonStart, seasonId);
  pruneCandidates(state);
  state.standingHistory = [];

  state.season = {
    id: seasonId,
    label: seasonLabel,
    startDate: seasonStart,
    endDate: firstSunday,
    calendar: [],
    finished: false,
  };
  state.date = seasonStart;
  state.schedule = { ...emptyScheduleState(), notifiedThrough: seasonStart };
  state.phase = 'season';

  const calendar = buildSeasonCalendar(firstSunday, matchdayCount(competition.clubIds.length));
  state.season.calendar = calendar;
  state.season.endDate = calendar[calendar.length - 1]!.date;

  const fixtureRng = new Rng(`${state.seed}::fixtures::${seasonId}`);
  const generatedFixtures = generateFixtures(fixtureRng, competition.clubIds);

  const matches: Record<MatchId, Match> = {};
  const ordered: MatchId[] = [];
  generatedFixtures.forEach((fixture, index) => {
    const matchId = `match_${nextYear}_${index + 1}`;
    const date = calendar[fixture.matchday - 1]!.date;
    matches[matchId] = createMatchRecord({
      state,
      id: matchId,
      matchday: fixture.matchday,
      date,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      competitionId: competition.id,
      competitionName: competition.name,
      kickOff: kickOffTimeFor(date),
    });
    ordered.push(matchId);
  });

  state.matches = matches;
  state.matchOrder = ordered;
  state.fixtures = buildFixtureList(competition.id, generatedFixtures, (_fixture, index) => ordered[index]!);
  // The manager gets the same summer of friendlies the first season began with.
  arrangePreSeason(state, state.userClubId, firstPreSeasonSunday);
  state.lastMatchId = null;
  state.pendingMatchId = null;

  // Pre-season: the routine starts again from scratch, and a summer away has
  // taken the edge off what they knew.
  const training = trainingStore(state);
  training.plans = {};
  training.history = [];
  training.systemSignatures = {};
  for (const person of Object.values(state.people)) {
    if (!isPlayer(person)) continue;
    const player = person;
    player.systemFamiliarity = createSystemFamiliarity({
      formation: Math.max(7, (player.systemFamiliarity?.formation ?? 10) * 0.72),
      instructions: Math.max(7, (player.systemFamiliarity?.instructions ?? 10) * 0.78),
      setPieces: Math.max(7, (player.systemFamiliarity?.setPieces ?? 10) * 0.8),
    });
  }
  pruneTrainingHistory(state);

  for (const clubId of competition.clubIds) {
    const club = state.clubs[clubId]!;
    club.history.seasons.unshift({
      seasonId,
      seasonLabel,
      competitionName: competition.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      finalPosition: null,
    });
    club.tactics = clubId === state.userClubId ? defaultTactics('4-4-2') : club.tactics;
    const rng = stream(state.seed, 'finance', seasonId, clubId);
    applyAnnualCosts(state, clubId, rng);
    // Sponsors review their deal each summer.
    club.finances.sponsorIncomePerWeek = Math.max(
      5,
      Math.round(club.finances.sponsorIncomePerWeek * rng.float(0.85, 1.2)),
    );
  }

  rollWeeklyAvailabilityForAll(state);
  prepareMatchday(state, 1);
  state.standingHistory.push(snapshotStandings(state));

  events.push(
    createEvent(state, {
      type: 'season-milestone',
      importance: 3,
      clubIds: [state.userClubId],
      data: {
        headline: `${seasonLabel} pre-season`,
        body: `Registration is open, the pitch needs marking and the squad list has ${state.clubs[state.userClubId]?.squadIds.length ?? 0} names on it. The ${seasonLabel} season starts on ${firstSunday}.`,
      },
    }),
  );

  return events;
}
