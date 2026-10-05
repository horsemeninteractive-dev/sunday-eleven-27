import type { Competition, CupState, FixtureList } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate, MatchId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import type { SeasonCalendarEntry } from '@/domain/world';
import {
  buildSeasonCalendarWithCups,
  kickOffTimeFor,
  type CupRoundSlot,
} from './calendar';
import { allCupRoundSlots, cupRoundSlots, drawCupRound, mainCupPlan, newCupState, platePlan, seedOrder } from './cup';
import { generateFixtures, matchdayCount } from './generation/fixtureGenerator';
import { createMatchRecord } from './matchday';
import {
  divisionCompetitionId,
  divisionNameFor,
  LEAGUE_CUP_ID,
  LEAGUE_CUP_NAME,

  PLATE_ID,
  PLATE_NAME,
  pyramidOf,
} from './pyramid';
import { Rng } from './rng';

/**
 * Building a season's competitions.
 *
 * A season is a set of competitions sharing one calendar. Every division plays
 * the same matchdays on the same Sundays — that is what lets a single matchday
 * counter, a single week of training and a single Friday subs round serve the
 * whole county — and the cups are numbered after the league's matchdays so they
 * sit in the same sequence rather than running beside it.
 *
 * This is the one place the ladder is written. Promotion and relegation decide
 * *who* is in which division; this decides the shape of the season those
 * divisions will play.
 */

export interface SeasonStructure {
  calendar: SeasonCalendarEntry[];
  /** How many of those matchdays are league Sundays. */
  leagueMatchdays: number;
  /** The cup round slots, for a caller that wants to know when cups fall. */
  cupSlots: CupRoundSlot[];
}

/** A fresh competition record for a division, with the boundary places set. */
function divisionCompetition(
  state: GameState,
  tier: number,
  seasonId: string,
  clubIds: ClubId[],
  regionName: string,
): Competition {
  const config = pyramidOf(state);
  const topTier = config.tiers;
  return {
    id: divisionCompetitionId(tier),
    name: divisionNameFor(regionName, tier),
    kind: 'league',
    tier,
    seasonId,
    clubIds,
    // The top division has nobody above it to be promoted into, and the bottom
    // one has nothing below it to fall into. Both are left undefined rather
    // than zero, so "there is no boundary" reads differently from "the boundary
    // swaps nobody".
    ...(tier > 1 ? { promotionPlaces: config.promotionPlaces } : {}),
    ...(tier < topTier ? { relegationPlaces: config.relegationPlaces } : {}),
  };
}

function cupCompetition(
  id: CompetitionId,
  name: string,
  seasonId: string,
  clubIds: ClubId[],
  cup: CupState,
): Competition {
  return { id, name, kind: 'cup', tier: 0, seasonId, clubIds, cup };
}

/** Every active club, ranked the way the generator ranked them. */
export function clubsForLadder(state: GameState): ClubId[] {
  return Object.values(state.clubs)
    .filter((club) => club.active)
    .map((club) => club.id)
    .sort((a, b) => {
      const repA = state.clubs[a]?.reputation ?? 0;
      const repB = state.clubs[b]?.reputation ?? 0;
      return repB - repA || a.localeCompare(b);
    });
}

/** Cut a ranked list of clubs into divisions of the configured size. */
export function divideIntoTiers(state: GameState, ranked: readonly ClubId[]): ClubId[][] {
  const config = pyramidOf(state);
  const divisions: ClubId[][] = [];
  for (let tier = 1; tier <= config.tiers; tier += 1) {
    divisions.push(ranked.slice((tier - 1) * config.clubsPerTier, tier * config.clubsPerTier));
  }
  return divisions;
}

export interface BuildSeasonOptions {
  state: GameState;
  seasonId: string;
  seasonLabel: string;
  /** The first league Sunday. */
  firstLeagueDate: ISODate;
  /** Divisions after any movement, tier 1 first. */
  divisions: ClubId[][];
  /** The region's name, for division names. */
  regionName: string;
  /** Announce the first cup draws as news. */
  announceDraws?: boolean;
}

/**
 * Build every competition for a season and put the fixtures in place.
 *
 * Replaces `state.competitions`, `state.fixtures`, `state.matches` and
 * `state.matchOrder` wholesale — a season is a clean sheet, and the archive of
 * what happened in the last one lives on the clubs rather than in the fixture
 * list.
 */
export function buildSeasonStructure(options: BuildSeasonOptions): SeasonStructure {
  const { state, seasonId, seasonLabel, firstLeagueDate, divisions, regionName } = options;
  const config = pyramidOf(state);

  // --- The calendar ---------------------------------------------------------
  // Every division has the same number of matchdays, so the league calendar is
  // sized by one division and the whole county plays it together.
  const clubsPerTier = Math.max(2, divisions[0]?.length ?? config.clubsPerTier);
  const leagueMatchdays = matchdayCount(clubsPerTier);
  const cupField = divisions.flat().length;
  // The consolation cup's rounds are numbered above the League Cup's, so its
  // dates come after them: a club knocked out in the opening round has already
  // lost by the time the Plate's first tie is played, and no club is asked for
  // two games on one Wednesday.
  const cupSlots = config.leagueCup ? allCupRoundSlots(cupField, leagueMatchdays, config.consolationCup) : [];
  const plateOffset = config.leagueCup ? cupRoundSlots(cupField, leagueMatchdays).length : 0;
  // How many clubs each round of each cup holds, fixed here so the draw, the
  // round-advance and the screens all read one description of the tournament.
  const mainPlan = config.leagueCup ? mainCupPlan(cupField) : [];
  const plateRounds = config.leagueCup && config.consolationCup ? platePlan(mainPlan) : [];
  const calendar = buildSeasonCalendarWithCups(firstLeagueDate, leagueMatchdays, cupSlots);

  // --- The competitions -----------------------------------------------------
  const competitions: Record<CompetitionId, Competition> = {};
  divisions.forEach((clubIds, index) => {
    const tier = index + 1;
    if (clubIds.length === 0) return;
    const competition = divisionCompetition(state, tier, seasonId, clubIds, regionName);
    competitions[competition.id] = competition;
  });

  // From the divisions just passed in, not from `state.competitions`: this
  // function is what *writes* those competitions, so at game start the old set
  // is empty and reading it would size the cup field at zero.
  const ladderClubs = divisions.flat();
  if (config.leagueCup && cupSlots.length > 0) {
    competitions[LEAGUE_CUP_ID] = cupCompetition(
      LEAGUE_CUP_ID,
      LEAGUE_CUP_NAME,
      seasonId,
      seedOrder(state, ladderClubs),
      newCupState(mainPlan),
    );
    if (config.consolationCup) {
      competitions[PLATE_ID] = cupCompetition(PLATE_ID, PLATE_NAME, seasonId, [], newCupState(plateRounds, LEAGUE_CUP_ID, plateOffset));
    }
  }

  // --- The fixtures ---------------------------------------------------------
  const matches: Record<MatchId, Match> = {};
  const order: MatchId[] = [];
  const fixtures: Record<CompetitionId, FixtureList> = {};
  let matchCounter = 0;

  for (const competition of Object.values(competitions)) {
    const list: FixtureList = { competitionId: competition.id, byMatchday: {}, matchdayOf: {} };
    fixtures[competition.id] = list;
    if (competition.kind !== 'league') continue;

    // A new stream per division: the top division's fixture list must not depend
    // on how many clubs the third division has.
    const rng = new Rng(`${state.seed}::fixtures::${seasonId}::${competition.id}`);
    const generated = generateFixtures(rng, competition.clubIds);
    for (const fixture of generated) {
      matchCounter += 1;
      const id = `match_${seasonId}_${matchCounter}` as MatchId;
      const entry = calendar[fixture.matchday - 1];
      if (!entry) continue;
      matches[id] = createMatchRecord({
        state,
        id,
        matchday: fixture.matchday,
        date: entry.date,
        homeClubId: fixture.homeClubId,
        awayClubId: fixture.awayClubId,
        competitionId: competition.id,
        competitionName: competition.name,
        kickOff: kickOffTimeFor(entry.date),
      });
      order.push(id);
      list.byMatchday[fixture.matchday] = [...(list.byMatchday[fixture.matchday] ?? []), id];
      list.matchdayOf[id] = fixture.matchday;
    }
  }

  state.competitions = competitions;
  state.fixtures = fixtures;
  state.matches = matches;
  state.matchOrder = order;
  // The calendar has to be in place before the draw: a cup tie is dated by
  // looking its matchday up in `state.season.calendar`, and a draw that cannot
  // find a date silently produces no ties at all.
  if (state.season) {
    state.season.calendar = calendar;
    state.season.endDate = calendar[calendar.length - 1]!.date;
  }

  // --- The first cup draw ---------------------------------------------------
  // Drawn here rather than on the day: a cup draw is an announcement, and a draw
  // that happened on the morning of the tie would be an announcement nobody had
  // heard.
  if (config.leagueCup && cupSlots.length > 0) {
    drawCupRound(state, competitions[LEAGUE_CUP_ID]!, {
      seasonId,
      seasonLabel,
      leagueMatchdays,
      announce: options.announceDraws ?? false,
    });
  }

  return { calendar, leagueMatchdays, cupSlots };
}

/**
 * Open this season's record on every club that played in it.
 *
 * The tier is stamped on the record rather than looked up later: the ladder
 * moves, so "Division Three, 2026/27" has to be written down while it is true.
 */
export function openSeasonRecords(state: GameState, seasonId: string, seasonLabel: string): void {
  for (const competition of Object.values(state.competitions)) {
    if (competition.kind !== 'league') continue;
    for (const clubId of competition.clubIds) {
      const club = state.clubs[clubId];
      if (!club || club.history.seasons.some((entry) => entry.seasonId === seasonId)) continue;
      club.history.seasons.unshift({
        seasonId,
        seasonLabel,
        competitionName: competition.name,
        tier: competition.tier,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        finalPosition: null,
      });
    }
  }
}

/**
 * Move clubs across a boundary.
 *
 * Applied before a new season is built, so the divisions a club lands in are
 * the ones it will actually play in. Every movement is one club leaving one
 * competition's list and joining another's, and the two lists are rebuilt from
 * the movements rather than spliced, so a club cannot end up in two divisions or
 * in none.
 */
export function applyMovements(
  state: GameState,
  divisions: readonly (readonly ClubId[])[],
  config: { promotionPlaces: number; relegationPlaces: number },
): void {
  const next = divisions.map((ids) => [...ids]);
  const boundaries = Math.min(next.length - 1, Math.max(0, config.promotionPlaces));

  for (let boundary = 0; boundary < boundaries; boundary += 1) {
    const above = next[boundary]!;
    const below = next[boundary + 1]!;
    const up = below.slice(0, config.promotionPlaces);
    const down = above.slice(Math.max(0, above.length - config.relegationPlaces));
    const survivorsAbove = above.filter((id) => !down.includes(id));
    const survivorsBelow = below.filter((id) => !up.includes(id));
    next[boundary] = [...survivorsAbove, ...up];
    next[boundary + 1] = [...survivorsBelow, ...down];
  }

  divisions.forEach((_, index) => {
    const competition = state.competitions[divisionCompetitionId(index + 1)];
    if (competition) competition.clubIds = [...next[index]!];
  });
}
