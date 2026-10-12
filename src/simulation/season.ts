import type { GameState } from '@/domain/game';
import type { Club } from '@/domain/club';
import type { ClubId, ISODate } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';

import { isPlayer, createSystemFamiliarity, type Official, type Player } from '@/domain/person';
import { yearOf } from './calendar';
import { applyAnnualCosts, addLedgerEntry } from './finance';
import { addDays, preSeasonStart, seasonLabelFor } from './calendar';
import { prepareMatchday } from './matchday';
import { arrangePreSeason } from './preseason';
import { applyMovements, buildSeasonStructure, openSeasonRecords } from './seasonStructure';
import {
  divisionsOf,
  foundingPyramidId,
  leagueClubIds,
  pyramidsOf,
  recordMovementsOnClubs,
  resolvePromotionAndRelegation,
  standingsFor,
  tierPrizeMoney,
  tierOf,
} from './pyramid';
import { applySeasonStanding } from './standing';
import { generatePlayer, resetPlayerIdCounter } from './generation/playerGenerator';
import { clubQualityFromReputation } from './generation/worldGenerator';
import { linkNewTeammate } from './generation/relationshipGenerator';
import { refreshUnattachedPool } from './generation/unattachedPlayers';
import { clubSignsFromPool, releaseFromClub, runAiClubSummer } from './aiClubs';
import { squadAssessment, type SquadAssessment } from './recruitment/needs';
import type { PositionCode } from '@/domain/positions';
import { abilityMean } from './queries';
import { pruneTrainingHistory, trainingStore } from './training/store';
import { pruneCandidates } from './recruitment/store';
import { createEvent } from './news';
import { firstSundayOfSeptember, rollWeeklyAvailabilityForAll, snapshotStandings } from './gameSetup';
import { rollWeeklyStaffAvailabilityForAll } from './availability';
import { emptyScheduleState } from './schedule';
import { weekStartOf } from './timeline';
import { applyRelationshipEvent, relationshipStore, relationshipViewsFor } from './relationships';
import { runManagerMarket } from './managers';
import { ensurePress } from './press';
import { coolRivalries } from './rivalries';
import { applySeasonSupport } from './support';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import {
  dismissUserManager,
  guaranteeVacancyFor,
  releaseManagerFromFoldedClub,
  isEmployed,
  openJobMarket,
  reserveVacancyFor,
  type CareerContext,
} from './career';
import { leaveClubStaff, runStaffLifecycle } from './staff';
import { applyGovernanceDismissal, governanceCanDismiss, runGovernance } from './governance';
import { renewSponsorship } from './sponsorship';
import { reviewClubFinances } from './clubLifecycle';
import { defaultTactics } from '@/domain/tactics';
import type { Competition } from '@/domain/competition';
import { stream, type Rng } from './rng';

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
 * Close the season: archive every table, award the honours, and put the game
 * into its off-season state. Returns the news rather than publishing it, so the
 * daily engine can publish everything from one day together.
 *
 * Every division is closed, not just the manager's own. A ladder whose bottom
 * two-thirds never finish is not a ladder, and the soak reads all three tables
 * to ask whether the pyramid is stratifying.
 */
export function finishSeason(state: GameState): SeasonFinishResult {
  // Every division of every pyramid, in the order the world reads them: the
  // founding ladder first, tiers 1 upwards, then the next ladder's.
  const divisions = pyramidsOf(state).flatMap((pyramid) => divisionsOf(state, pyramid.id));
  const events: GameEvent[] = [];
  if (divisions.length === 0) return { events, championClubId: null, playerPosition: null };

  const champions: ClubId[] = [];
  let playerPosition: number | null = null;
  let playerCompetition: Competition | undefined;
  let playerPoints = 0;

  for (const competition of divisions) {
    const standings = standingsFor(state, competition);

    standings.forEach((row, index) => {
      const club = state.clubs[row.clubId];
      const record = club?.history.seasons.find((season) => season.seasonId === state.season.id);
      if (!record) return;
      record.finalPosition = index + 1;
      record.tier = competition.tier;
      record.points = row.points;
      record.played = row.played;
      record.won = row.won;
      record.drawn = row.drawn;
      record.lost = row.lost;
      record.goalsFor = row.goalsFor;
      record.goalsAgainst = row.goalsAgainst;
    });

    const championId = standings[0]?.clubId ?? null;
    const champion = championId ? state.clubs[championId] : undefined;
    if (champion) {
      champions.push(champion.id);
      champion.history.honours.push(`${state.season.label} ${competition.name} champions`);
      champion.history.notableEvents.unshift({
        date: state.date,
        seasonLabel: state.season.label,
        description: `Won ${competition.name}.`,
        importance: 3,
      });
      // The prize is what a promotion is worth in money, and it is paid here,
      // where the finishing position is known.
      const prize = tierPrizeMoney(competition.tier, 1);
      if (prize > 0) {
        addLedgerEntry(state, champion.id, {
          date: state.date,
          description: `${competition.name} title prize`,
          category: 'other',
          amount: prize,
        });
      }
    }

    if (competition.clubIds.includes(state.userClubId)) {
      playerCompetition = competition;
      const index = standings.findIndex((row) => row.clubId === state.userClubId);
      playerPosition = index >= 0 ? index + 1 : null;
      playerPoints = standings[index]?.points ?? 0;
    }
  }

  const playerClub = state.clubs[state.userClubId];
  const divisionName = playerCompetition?.name ?? 'the league';
  const championName = state.clubs[champions[0] ?? '']?.identity.name;
  const phrase =
    playerPosition === null
      ? 'The season is over'
      : playerPosition === 1
        ? 'finished top'
        : playerPosition === 2
          ? 'finished second'
          : playerPosition === 3
            ? 'finished third'
            : `finished ${playerPosition}th`;

  events.push(
    createEvent(state, {
      type: 'season-milestone',
      importance: 3,
      clubIds: [champions[0], state.userClubId].filter((id): id is ClubId => Boolean(id)),
      data: {
        headline: `${championName ?? 'Champions'} win ${divisionName}`,
        body: `${playerClub?.identity.name ?? 'Your club'} ${phrase} with ${playerPoints} points. Time for the AGM, the presentation night and a rest.`,
      },
    }),
  );

  // What the ladder does, decided at the boundary and written to the archive.
  // The move itself happens when the next season is built.
  const ladder = resolvePromotionAndRelegation(state, {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
  });
  recordMovementsOnClubs(state, ladder.movements);
  // And what the season did to what the county thinks of everybody: a good
  // finish lifts a club, a bad one lowers it, and going up a division is worth
  // more than either. Read against the club's own standing rather than against
  // the table alone, so a side that keeps finishing above itself keeps climbing
  // and a side that has caught up with its results stops moving.
  applySeasonStanding(state, ladder.movements);
  events.push(...ladder.events);
  state.promotionHistory = [...(state.promotionHistory ?? []), ...ladder.movements];

  state.phase = 'complete';
  state.season.finished = true;
  // One snapshot left standing per division: the final table is the archive of
  // the season and everything before it is already in the club records.
  const finals = divisions.map((competition) => {
    const rows = standingsFor(state, competition);
    return {
      date: state.date,
      matchday: state.season.calendar.length,
      competitionId: competition.id,
      rows,
      playerClubPosition: rows.findIndex((row) => row.clubId === state.userClubId) + 1 || null,
    };
  });
  state.standingHistory = finals;
  return { events, championClubId: champions[0] ?? null, playerPosition };
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
 * The quality a summer arrival is generated at, from the club's standing.
 *
 * A squad the world generator built drew every man at the club's level *plus his
 * own roll of the dice* — one of them is a ringer, the next is making up the
 * numbers — so the squad had a spread to it. An arrival generated at the club's
 * average with no roll had none, and a squad topped up by arrivals alone quietly
 * lost its top end: the best player in the side regressed towards the average.
 * The keeper shows it first, because a keeper is one man where the attack is a
 * team average — the county's best glove fell five per cent over a career and
 * dragged the goals-per-match rate up with it. Same centre, same roll, so a
 * squad built through the summer has the spread of one that was generated.
 *
 * The centre is the club's *standing*, not its current squad, so a club cannot
 * lift itself above the level it plays at by signing: see `clubStandardQuality`.
 * Exported so tests and the soak can reason about the numbers.
 */
export function arrivalQualityFor(rng: Rng, reputation: number, offset = 0): number {
  return clubQualityFromReputation(rng, reputation) + rng.gaussian(0, 1.1) + offset;
}

/**
 * The summer's squad business: a youth intake, and a cap on how many a club
 * carries. Exported so tests and the soak can reason about the numbers.
 */
export const SQUAD_REFRESH = {
  /**
   * Teenagers who come up through each club each summer.
   *
   * Kept at one or two because the rest of the summer's business depends on it.
   * Cutting it to one a year settles the county's age structure and slows the
   * world's drift, but it leaves every AI squad permanently short, which empties
   * the unattached pool and tips more clubs into administration. A thin pool and
   * a pyramid full of broke clubs are a worse world than one that improves
   * gently, so the intake stays generous and the drift is handled in the
   * development curve instead.
   */
  youthPerClub: [1, 2] as [number, number],
  youthAge: [16, 18] as [number, number],
  /** No club carries more than this once the summer is done. */
  cap: 26,
} as const;

/**
 * The fewest bodies a club will put on a pitch.
 *
 * Same number the top-up loop uses, so a club that signs from the pool and a club
 * that invents a player are filling the same gap against the same line.
 */
export const AI_SQUAD_MINIMUM = 20;

/**
 * How many men an AI club turns over in a summer, by tier.
 *
 * The bottom of the pyramid churns and the top does not, which is both how
 * football works and what keeps the ladder stratified: if every club turned over
 * at the same rate, the pyramid would flatten out within a decade. Tier 3 is the
 * level where a squad is rebuilt most years and where most released men find
 * another club rather than leaving the game.
 */
export const AI_CHURN_BY_TIER = [1, 2, 2, 3] as const;

/**
 * One AI club's summer: release a man or two, then sign as many back.
 *
 * Releasing first is the point. A club that only signed would grow, and a club
 * that only released would shrink to the legal minimum; doing both leaves squads
 * where they were and moves the men. The club only signs what it let go, plus
 * anything else it needs to reach the minimum.
 */
function clubChurn(state: GameState, club: Club, rng: Rng, seasonStart: ISODate): number {
  const tier = tierOf(state, club.id) ?? 1;
  const wanted = AI_CHURN_BY_TIER[Math.min(tier, AI_CHURN_BY_TIER.length) - 1] ?? 1;
  // The size the club is trying to be. It lets men go and then signs back to
  // where it started, which is what a club does over a summer and what stops
  // squads growing in step across the whole pyramid.
  const target = Math.min(club.squadIds.length, SQUAD_REFRESH.cap);
  // One reading of the squad, used twice: to choose who can be spared and to
  // tell the signing step which positions have just been left open. Read once
  // so the club cannot decide who to release from one picture of the squad and
  // who to sign from another.
  const assessment = squadAssessment(state, club.id);

  let released = 0;
  const releasedRatings: number[] = [];
  const releasedPositions: PositionCode[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const surplus = releaseCandidate(state, club, assessment);
    if (!surplus) break;
    releasedRatings.push(abilityMean(surplus));
    releasedPositions.push(surplus.preferredPosition);
    releaseFromClub(state, club, surplus);
    released += 1;
  }
  if (released === 0) return 0;

  return clubSignsFromPool(state, club, rng, seasonStart, target, {
    cap: SQUAD_REFRESH.cap,
    replaces: releasedRatings,
    positions: releasedPositions,
  }).length;
}

/**
 * The man a club lets go.
 *
 * It used to be simply the oldest man over thirty, and that is how a club ends
 * up with one goalkeeper and no right back: a side deep in forwards would let a
 * centre half go because he had the temerity to turn thirty-one, and then sign
 * whoever was available in the summer — which was another forward.
 *
 * What a club can spare is a *surplus* player: a man whose position the club
 * already answers well, and who is not the man answering it. So the oldest of
 * those goes, and only where the club has no surplus at all does it fall back to
 * the oldest, because a squad has to turn over somehow and a club that never
 * releases anybody is a club whose youth intake has nowhere to go.
 */
function releaseCandidate(state: GameState, club: Club, assessment: SquadAssessment): Player | null {
  const candidates = club.squadIds
    .map((id) => state.people[id])
    .filter(
      (person): person is Player =>
        isPlayer(person) && person.id !== club.managerId && person.age >= 30,
    );
  if (candidates.length === 0) return null;

  const spare = candidates.filter((player) => {
    const slot = assessment.slots.find((entry) => entry.position === player.preferredPosition);
    if (slot) return !slot.thin && slot.bestId !== player.id;
    // He plays a position the shape does not even ask for — an attacking
    // midfielder in a flat 4-4-2. If his area of the squad is well stocked he
    // is the surplus one by definition.
    return assessment.needs.positions.find((entry) => entry.group === player.positionGroup)?.verdict === 'strong';
  });

  const pool = spare.length > 0 ? spare : candidates;
  return pool.slice().sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))[0] ?? null;
}

/**
 * Let the oldest surplus players go.
 *
 * A club carries only so many, so the youth intake needs somewhere to go: an
 * intake with no outgo would only make squads grow, and the average age with
 * them.
 *
 * A released man joins the unattached pool rather than leaving the world, up to
 * a point: he is still playing, still local, and somebody else in the county
 * might want him. Past that age he has stopped, and he goes the way a man who
 * has stopped playing leaves — out of the world, with his relationships. The
 * player-manager is never released, because he is the manager.
 */
function trimSquad(state: GameState, club: Club): void {
  while (club.squadIds.length > SQUAD_REFRESH.cap) {
    const released = club.squadIds
      .map((id) => state.people[id])
      .filter((person): person is Player => isPlayer(person) && person.id !== club.managerId)
      .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))[0];
    if (!released) break;
    releaseFromClub(state, club, released);
  }
}

/**
 * A player-manager who has stopped playing has not stopped managing.
 *
 * Grassroots football is full of men who run the side and played until their
 * legs went; when the legs go they stay in the dugout as an ordinary manager.
 * He leaves the player world and joins the officials, keeping his id so every
 * relationship, record and note that named him still names him.
 */
function playerManagerAsOfficial(player: Player, clubId: ClubId, date: ISODate): Official {
  const { technical, mental, behavioural, hidden } = player.attributes;
  const mean = (...values: number[]): number =>
    Math.max(1, Math.min(20, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)));
  return {
    id: player.id,
    kind: 'official',
    firstName: player.firstName,
    surname: player.surname,
    nickname: player.nickname,
    age: player.age,
    townId: player.townId,
    occupation: player.occupation,
    reputation: player.reputation,
    roles: [{ clubId, role: 'manager', since: date }],
    role: 'manager',
    clubId,
    attributes: {
      coaching: mean(technical.passing, technical.ballControl, mental.decisions),
      manManagement: mean(mental.composure, mental.determination, behavioural.ambition),
      motivation: mean(mental.workRate, behavioural.commitment, mental.determination),
      tacticalKnowledge: hidden.tacticalIntelligence,
      recruitmentEye: mean(mental.positioning, mental.decisions),
      organisation: mean(behavioural.reliability, mental.decisions),
    },
    patience: 11,
    notes: [...player.notes, 'Stayed on as manager when he stopped playing.'],
  };
}

/**
 * Roll the world into a new season: ageing, retirements, new fixtures, and a
 * fresh calendar that starts on the Monday before the first Sunday, so the
 * manager gets the build-up rather than landing on a matchday.
 */
export function startNextSeason(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const previousSeason = state.season;
  const nextYear = yearOf(previousSeason.startDate) + 1;
  let firstSunday = firstSundayOfSeptember(nextYear);
  // A new season opens with pre-season, exactly as the first one did: six
  // Sundays before the football, starting on the Monday of the first of them.
  //
  // The opener cannot fall before the previous season closed. A season lasts its
  // own calendar plus whatever rearranged fixtures were played before the
  // rearrangement deadline, and that tail can put the last ball a week or more
  // past the fixed early-September rollover. Rolling over regardless would wind
  // the clock backwards — pre-season starting before the season that preceded it
  // had finished — so the opener steps on a week at a time until it is genuinely
  // after the football already played.
  const previousClosedOn = state.date > previousSeason.endDate ? state.date : previousSeason.endDate;
  while (weekStartOf(preSeasonStart(firstSunday)) <= previousClosedOn) {
    firstSunday = addDays(firstSunday, 7);
  }
  const firstPreSeasonSunday = preSeasonStart(firstSunday);
  const seasonStart = weekStartOf(firstPreSeasonSunday);
  const seasonId = `season_${nextYear}_${String((nextYear + 1) % 100).padStart(2, '0')}`;
  const seasonLabel = seasonLabelFor(firstSunday);

  // The ladder as it stands after last season's movements, which were decided
  // and archived by `finishSeason` but not applied to the competitions — the
  // competitions are about to be rebuilt. Each boundary is settled against its
  // own pyramid: a ladder's places are its own shape, and the founding pyramid
  // is the one this world was born with.
  const divisions = pyramidsOf(state).flatMap((pyramid) => {
    const ladder = divisionsOf(state, pyramid.id).map((competition) => [...competition.clubIds]);
    applyMovements(state, pyramid.id, ladder, {
      promotionPlaces: pyramid.config.promotionPlaces,
      relegationPlaces: pyramid.config.relegationPlaces,
    });
    return ladder;
  });

  resetPlayerIdCounter();

  // Ageing, retirement and squad top-ups — for every club in the county, not
  // just the top division. A ladder whose lower divisions never age is a ladder
  // of eighteen-year-olds by the third season.
  for (const clubId of leagueClubIds(state)) {
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
      // A man who stops playing gives up the committee posts he was holding at
      // the same time. Grassroots sides are full of players doubling up as
      // coach or secretary, and letting one retire while the club's staff
      // record still named him left the club pointing at a man who had left
      // the world. The player-manager keeps the dugout, under the same id.
      leaveClubStaff(state, club.id, player.id);
      player.clubId = null;
      player.registered = false;
      player.roles = [];
      player.notes.push(`Retired at the end of ${previousSeason.label}.`);
      club.squadIds = club.squadIds.filter((id) => id !== player.id);
      // He has stopped playing, not stopped managing: he stays in the dugout as
      // the club's ordinary manager rather than leaving the post to nobody.
      if (player.isPlayerManager) {
        player.isPlayerManager = false;
        if (club.managerId === player.id) {
          state.people[player.id] = playerManagerAsOfficial(player, club.id, seasonStart);
        }
      }
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

    // The youth intake. Every summer a couple of teenagers come up through the
    // club — a mate's younger brother, a kid who has filled out, a trialist who
    // stuck. They are raw, and they are the only arrival in the world who is not
    // a grown man, which is what stops the whole league ageing in lockstep.
    const intake = rng.int(SQUAD_REFRESH.youthPerClub[0], SQUAD_REFRESH.youthPerClub[1]);
    for (let i = 0; i < intake; i++) {
      const youth = generatePlayer({
        rng,
        id: `${clubId}_y${seasonId}_${i + 1}`,
        clubId,
        townId: club.townId,
        homeGroundId: club.groundId,
        // A teenager is not as good as the grown man the club would otherwise
        // sign, however much he might grow into. A shade below the club's own
        // standard keeps the intake an intake rather than an upgrade — and the
        // standard is the club's, not the squad's, so a summer of intakes can
        // never lift a club above the level its standing says it plays at.
        quality: arrivalQualityFor(rng, club.reputation, -0.2),
        seasonStart,
        age: rng.int(SQUAD_REFRESH.youthAge[0], SQUAD_REFRESH.youthAge[1]),
      });
      state.people[youth.id] = youth;
      const teammates = club.squadIds.filter((id) => id !== youth.id);
      club.squadIds.push(youth.id);
      linkNewTeammate(relationshipStore(state), state.seed, club, youth.id, teammates, seasonStart);
      added += 1;
    }

    // Grown men fill any remaining gap up to the legal minimum.
    while (club.squadIds.length < AI_SQUAD_MINIMUM) {
      const newPlayer = generatePlayer({
        rng,
        id: `${clubId}_n${seasonId}_${added + 1}`,
        clubId,
        townId: club.townId,
        homeGroundId: club.groundId,
        // A grown man filling a gap is a journeyman: the club's own standard,
        // no better. Generated a shade above it, as this used to be, every squad
        // that ever fell short of bodies was quietly upgraded.
        quality: arrivalQualityFor(rng, club.reputation),
        seasonStart,
      });
      state.people[newPlayer.id] = newPlayer;
      const teammates = club.squadIds.filter((id) => id !== newPlayer.id);
      club.squadIds.push(newPlayer.id);
      linkNewTeammate(relationshipStore(state), state.seed, club, newPlayer.id, teammates, seasonStart);
      added += 1;
    }

    trimSquad(state, club);

    // Any club the manager is not running also does a little transfer business
    // of its own: it lets a man go and signs another. Without this the world's
    // only football decisions are the manager's, released players leave the
    // world outright, and the unattached pool grows every summer without ever
    // emptying. See `aiClubs`.
    if (clubId !== state.userClubId) {
      const churned = clubChurn(state, club, rng, seasonStart);
      added += churned;
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
  // Every other club's summer of transfer business, after the pool has been
  // refreshed and after every club has released and topped itself up — so the
  // men released above are the men available to be signed below.
  runAiClubSummer(state, seasonId, seasonStart, AI_SQUAD_MINIMUM);
  pruneCandidates(state);
  state.standingHistory = [];

  // Clubs that cannot pay their way go into administration and, if they cannot
  // get out of it, fold. A new club forms in the town to take the place, so the
  // division keeps its size however many seasons pass. The player's own club is
  // held out of it for now, like his manager.
  // The review runs on the ladder the season is about to be built from, not on
  // `state.competitions` (last season's records, about to be replaced), so the
  // club that forms in a folded club's place is already in its division by the
  // time `buildSeasonStructure` reads `divisions`.
  // The context every service that judges a career needs, built here because the
  // lifecycle below is the first thing that can end one.
  const careerContext: CareerContext = {
    seasonId,
    seasonLabel,
    seasonStart,
    previousSeasonId: previousSeason.id,
    previousSeasonLabel: previousSeason.label,
  };

  const lifecycle = reviewClubFinances(state, {
    seasonId,
    seasonLabel,
    seasonStart,
    protectedClubIds: [state.userClubId],
    divisions,
  });
  events.push(...lifecycle.events);
  // A club folding is a career-ending event for the man in charge of it. The
  // ordinary cycle leaves the player's club alone, but a debt no committee can
  // survive takes any club — and then the career has to be handed to the job
  // market rather than left pointing at a club that no longer plays.
  for (const folded of lifecycle.folded) {
    if (folded.clubId !== state.userClubId) continue;
    events.push(...releaseManagerFromFoldedClub(state, folded.clubId, careerContext));
  }
  // A folded club's players may have been names on the manager's shortlist.
  pruneCandidates(state);

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

  const structure = buildSeasonStructure({
    state,
    seasonId,
    seasonLabel,
    firstLeagueDate: firstSunday,
    divisions,
    pyramidId: foundingPyramidId(state),
    regionName: state.world.regionName,
    announceDraws: false,
  });
  const calendar = structure.calendar;
  state.season.calendar = calendar;
  state.season.endDate = calendar[calendar.length - 1]!.date;

  // The manager gets the same summer of friendlies the first season began with —
  // unless he is between jobs, in which case there is no squad of his to arrange
  // a summer for.
  if (isEmployed(state)) arrangePreSeason(state, state.userClubId, firstPreSeasonSunday);
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

  openSeasonRecords(state, seasonId, seasonLabel);

  const managingClubId = isEmployed(state) ? state.userClubId : null;
  for (const clubId of leagueClubIds(state)) {
    const club = state.clubs[clubId];
    if (!club) continue;
    club.tactics = clubId === managingClubId ? defaultTactics('4-4-2') : club.tactics;
    const rng = stream(state.seed, 'finance', seasonId, clubId);
    applyAnnualCosts(state, clubId, rng);
  }

  // Sponsors review their agreements each summer. What they are judging is the
  // division the club is now in as much as the season it has just had: a club
  // that has gone up is worth a bigger deal, one that has come down is asked to
  // accept less, and a poor season can cost a club its backer altogether. The
  // sponsorship service owns all of that; this is where it is invoked.
  const sponsorshipReview = renewSponsorship(state, {
    seasonId,
    seasonLabel,
    seasonStart,
    previousSeasonId: previousSeason.id,
    previousSeasonLabel: previousSeason.label,
  });
  events.push(...sponsorshipReview.events);

  // The committee takes its view once a season, on the season that has actually
  // been played and the books as they actually stand. The player's own manager
  // is held out of the managers' market, so this is where his job is judged.
  const governance = runGovernance(state, careerContext);
  events.push(...governance.events);

  // And if the committee has decided on a change, it is carried out *before* the
  // managers' market turns, so the vacancy it creates is filled in the same
  // summer rather than leaving a club without a manager into the season. The
  // manager himself becomes a man between jobs — which is exactly what the job
  // market below is for.
  if (isEmployed(state) && governanceCanDismiss(state)) {
    applyGovernanceDismissal(state);
    events.push(...dismissUserManager(state, careerContext));
  }

  // The managers' market turns once a season, now that every club's record for
  // the season just finished has been archived and its money settled. The
  // player's own manager is never moved by it — his job is the committee's to
  // decide, and his next job is his own to find. While he is out of work the
  // market holds a few reachable vacancies for him instead of appointing over
  // them the same afternoon.
  const market = runManagerMarket(state, {
    ...careerContext,
    protectedManagerIds: [MANAGER_PERSON_ID],
    holdVacancies: reserveVacancyFor(state) ?? undefined,
    guaranteeVacancy: guaranteeVacancyFor(state) ?? undefined,
  });
  events.push(...market.events);
  openJobMarket(state, careerContext, market.held);

  // The committee turns over too: a year older, a few men stepping down, and the
  // posts they leave filled from the town. Kept apart from the managers' market
  // because it ages and replaces a different set of posts.
  const staffLifecycle = runStaffLifecycle(state, { seasonId, seasonLabel, seasonStart });
  events.push(...staffLifecycle.events);

  rollWeeklyAvailabilityForAll(state);
  rollWeeklyStaffAvailabilityForAll(state);
  prepareMatchday(state, 1);
  state.standingHistory.push(...snapshotStandings(state));

  // A man between jobs has no pre-season of his own to open: the milestone is
  // about a squad he is no longer picking.
  if (isEmployed(state)) {
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
  }

  // The county's relationships and crowds have a summer of their own, and both
  // are settled here rather than in the day loop, because both are about a
  // season rather than a Sunday: the heat between two clubs cools, a pairing
  // that has earned it is promoted from this season's bad temper to an old
  // rivalry, and every crowd drifts a long way back towards the middle before
  // promotion and relegation are applied on top. See `rivalries.ts` and
  // `support.ts` for the arithmetic and the bounds.
  coolRivalries(state, seasonStart);
  applySeasonSupport(state, seasonStart);

  // And the reporters' patches are redrawn. A club promoted two divisions up the
  // ladder is somebody else's story now, and the paper that covered it last
  // season is not necessarily the nearest one to it any more.
  ensurePress(state);

  return events;
}
