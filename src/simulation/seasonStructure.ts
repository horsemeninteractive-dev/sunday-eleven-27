import type { Competition, CupField, CupRound, CupState, FixtureList } from '@/domain/competition';
import { storedCupField } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate, MatchId, PyramidId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import type { SeasonCalendarEntry } from '@/domain/world';
import {
  buildSeasonCalendar,
  kickOffTimeFor,
  placeCupRounds,
  type CupRoundPlacement,
  type CupRoundSlot,
  type PlacedCupSlot,
} from './calendar';
import { allCupRoundSlots, cupRoundSlots, drawCupRound, mainCupPlan, newCupState, platePlan, seedOrder } from './cup';
import { generateFixtures, matchdayCount } from './generation/fixtureGenerator';
import { createMatchRecord } from './matchday';
import { scheduleEvent } from './schedule';
import {
  countiesOf,
  countyClubIds,
  countyCupId,
  countyCupName,
  cupCompetitionId,
  cupNameFor,
  divisionCompetitionId,
  divisionNameFor,
  foundingCountyId,
  foundingPyramidId,
  invitedClubIds,
  PLATE_NAME,
  pyramidClubIds,
  pyramidIdsOfCounty,
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
  /**
   * The cup round slots, one per round the build asked the calendar for, in the
   * order they were asked for, each with the Sunday it took.
   *
   * A *slot* is not a calendar entry: two rounds whose fields have no club in
   * common are played on one Sunday and share one date, so the calendar grows by
   * one entry where two slots were dated. `shared` names the rounds on the same
   * afternoon, which is what a caller reads to tell the two apart.
   */
  cupSlots: PlacedCupSlot[];
}

/** A fresh competition record for a division, with the boundary places set. */
function divisionCompetition(
  state: GameState,
  pyramidId: PyramidId,
  tier: number,
  seasonId: string,
  clubIds: ClubId[],
  regionName: string,
): Competition {
  const config = pyramidOf(state, pyramidId).config;
  const topTier = config.tiers;
  return {
    id: divisionCompetitionId(pyramidId, tier),
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
  field: CupField,
): Competition {
  // The field travels with the cup: a ladder's own is left unsaid, because that
  // is what an absent field already means, and everything else is written down.
  const stored = storedCupField(field);
  return { id, name, kind: 'cup', tier: 0, seasonId, clubIds, cup: { ...cup, ...(stored ? { field: stored } : {}) } };
}

/**
 * The clubs a declared cup field draws from.
 *
 * A pyramid's field is that ladder's membership: the divisions this build was
 * handed for it, or — for a ladder this build is not writing — the divisions the
 * world already has. Membership is not filtered by whether a club is active,
 * because the division is the thing that says who plays in it; a draw re-checks
 * an entrant's activity when it draws, and a club that folded is moved out of its
 * division at the boundary rather than during a cup draw.
 *
 * A county's field is every *active* club in the county it names, whatever ladder
 * it plays on — read from the clubs' towns, so a second county's cup cannot reach
 * them and a club is never entered in a cup by geography it does not have. That
 * asymmetry is the point rather than an oversight: a ladder's field is a
 * membership somebody maintains, and a county's is a population read off the
 * world, so a county has to say what makes a club eligible — being a club that
 * county still has. An invitation is the clubs it names, in the order it names
 * them, less any the world cannot enter.
 */
export function fieldClubs(
  state: GameState,
  field: CupField,
  ladders: ReadonlyMap<PyramidId, readonly ClubId[]> = new Map(),
): ClubId[] {
  switch (field.kind) {
    case 'pyramid':
      return [...(ladders.get(field.pyramidId) ?? pyramidClubIds(state, field.pyramidId))];
    case 'county':
      // A county cup's field names its county. A cup that says nothing about
      // which county it belongs to is the career's own, which is what every
      // county cup written before counties had ids meant.
      return countyClubIds(state, field.countyId ?? foundingCountyId(state));
    case 'invitation':
      return invitedClubIds(state, field.clubIds);
  }
}

/** Cut a ranked list of clubs into divisions of the configured size. */
export function divideIntoTiers(
  state: GameState,
  ranked: readonly ClubId[],
  pyramidId: PyramidId = foundingPyramidId(state),
): ClubId[][] {
  const config = pyramidOf(state, pyramidId).config;
  const divisions: ClubId[][] = [];
  for (let tier = 1; tier <= config.tiers; tier += 1) {
    divisions.push(ranked.slice((tier - 1) * config.clubsPerTier, tier * config.clubsPerTier));
  }
  return divisions;
}

/**
 * One ladder's share of a season: which pyramid, which region, which divisions.
 *
 * A world build is handed a list of these rather than one flat ladder, because a
 * flat list of six divisions cannot say which three belong to which pyramid — and
 * a builder that guessed would merge two ladders of three tiers into one of six.
 * Each pyramid keeps its own id (and so its own competition ids), its own ordered
 * divisions, its own club membership and its own region for naming; its
 * configuration and the competitions it owns are read from, and written back to,
 * its own `Pyramid` record.
 */
export interface SeasonPyramidInput {
  pyramidId: PyramidId;
  /** The region's name, for division names. */
  regionName: string;
  /** Divisions after any movement, tier 1 first. */
  divisions: ClubId[][];
}

/**
 * A competition no ladder runs: the county's cup, or one by invitation.
 *
 * Asked for explicitly rather than inferred. Supplying two pyramids does not mean
 * the county has a county cup — a world with a second ladder and no county cup is
 * a perfectly ordinary world — so the world's own cups are named here or they do
 * not exist. Its entrants come from its declared field and from nothing else.
 */
export interface SeasonCupRequest {
  id: CompetitionId;
  name: string;
  field: CupField;
}

/**
 * The county cups the world runs: one for each county with more than one ladder
 * of its own to run it between.
 *
 * The county cup is the competition a ladder's own cups cannot be: its field is
 * every active club *in its county*, whichever of that county's ladders the club
 * plays on, so it is the one cup a manager can be drawn against a side he will
 * never meet in a league. It exists only where a county has more than one ladder,
 * and that is a rule about the county rather than about the world: in a county
 * with a single ladder the ladder's own cup *is* the county's cup, so a second
 * competition with the same entrants, a different name and its own dates in the
 * calendar would be a duplicate trophy and a fortnight of Sundays taken from
 * nothing. A county with one ladder has no cup even when another county has
 * several — which is what the old rule, counting the world's ladders, could not
 * say, and why a county's own ladder count is what is asked here.
 *
 * Each cup belongs to its own county: it carries that county's name, its field
 * names that county, and its id is built from that county's id, so two counties'
 * cups are two competitions rather than one id requested twice. The founding
 * county keeps the competition its cup has always been, id and name alike. The
 * requests come back in the order the world reads its counties, so the same world
 * asks for the same cups in the same order.
 *
 * A caller may still ask for a world cup by hand — the season builder takes any
 * request it is handed — but this is the answer the game itself uses, so new
 * careers and every season after them get the same cups on the same terms.
 */
export function countyCupRequests(state: GameState): SeasonCupRequest[] {
  const requests: SeasonCupRequest[] = [];
  for (const county of countiesOf(state)) {
    if (pyramidIdsOfCounty(state, county.id).length < 2) continue;
    requests.push({
      id: countyCupId(county.id),
      name: countyCupName(county.name),
      field: { kind: 'county', countyId: county.id },
    });
  }
  return requests;
}

/**
 * What a season is built from.
 *
 * One call builds the whole world: every ladder's divisions and cups, the world's
 * own cups, one set of fixtures and matches, and one calendar. It used to take a
 * single flat ladder and one pyramid id, and replace the world's competition,
 * fixture, match and calendar records wholesale — which is why calling it once per
 * pyramid erased the pyramid before it.
 */
export interface BuildSeasonOptions {
  state: GameState;
  seasonId: string;
  seasonLabel: string;
  /** The first league Sunday. */
  firstLeagueDate: ISODate;
  /** Every ladder this season is built for, the founding pyramid first. */
  pyramids: SeasonPyramidInput[];
  /** The world's own cups, if it has any. Absent means it has none. */
  cups?: SeasonCupRequest[];
  /** Announce the first cup draws as news. */
  announceDraws?: boolean;
  /**
   * Whether the rounds this build asks for are dated in the season calendar.
   *
   * True by default, and true everywhere in the game: a round with no date is a
   * round that can never be drawn, and Phase 0's rule is that a season refuses to
   * start rather than run a competition that can never reach a winner. A caller
   * may turn it off to build the *competitions* of a world it cannot yet date —
   * the calendar gives one cup lane and two ladders need two, which is Stage 3's
   * work — and gets every pyramid's divisions, cups, ownership and fields, leagues
   * drawn into the calendar, and no cup dates at all. It is deliberately one
   * switch for the build rather than one per cup, because a world with half its
   * cups dated is not a state anything should be able to reach.
   */
  dateCupRounds?: boolean;
}

/**
 * A cup round with no date is a cup that can never be drawn, and a competition
 * that can never be drawn is one that never reaches a winner.
 *
 * The calendar used to drop a slot it could not date and say nothing about it.
 * The season then ran to its end with a trophy nobody could win: no error, no
 * warning, and the only symptom a cup with no final. A round is asked for by the
 * competition's own plan, so the count of what was asked for and what was placed
 * can be compared here, where the season is built, while there is still something
 * to be done about it.
 */
function requireCupRoundsPlaced(
  state: GameState,
  placement: CupRoundPlacement,
  owners: readonly CompetitionId[],
  seasonLabel: string,
  ownerNames: ReadonlyMap<CompetitionId, string>,
): void {
  const unplaced = placement.slots
    .map((slot, index) => ({ slot, owner: owners[index] ?? null }))
    .filter((entry) => entry.slot.date === null);
  if (unplaced.length === 0) return;

  const nameOf = (owner: CompetitionId | null): string =>
    (owner ? ownerNames.get(owner) : undefined) ?? 'A cup';
  const listed = unplaced
    .map(
      ({ slot, owner }) =>
        `   - ${nameOf(owner)} round ${slot.round} (before league matchday ${slot.beforeMatchday}): ${
          slot.reason ?? 'no date could be found'
        }`,
    )
    .join('\n');
  const summary = `${unplaced.length} of ${placement.slots.length} cup round(s) could not be given a date in the ${seasonLabel} calendar:\n${listed}`;

  // Development and tests: a season that cannot crown a cup winner is refused
  // where it is built, rather than played through quietly.
  if (import.meta.env?.DEV === true) {
    throw new Error(`The ${seasonLabel} calendar has no room for every cup round.\n${summary}`);
  }

  // A build: the manager is told the way the world tells him anything it has
  // done on its own - a stop on the day it happens, naming the competition and
  // the reason. Never a line in the news he can scroll past, because the
  // competition it names will never reach a final.
  scheduleEvent(state, {
    date: state.date,
    kind: 'season-start',
    priority: 'important',
    source: 'season',
    title: 'The season cannot be completed',
    detail: `${summary}\nThe rounds listed above have no date, so the competitions they belong to cannot be drawn to a finish this season.`,
    data: { unplaced: unplaced.length, requested: placement.slots.length },
  });
}

/**
 * A cup this build is about to create, and everything the record needs.
 *
 * Gathered before anything is written, because the calendar, the ownership lists
 * and the competition records all read the same description of the tournament —
 * how many clubs are in it, which rounds it holds, and where its rounds are
 * numbered from.
 */
interface CupSpec {
  id: CompetitionId;
  name: string;
  /**
   * The name of the Plate this cup feeds, where it has one.
   *
   * Carried per cup rather than read from a constant, because it is named after
   * the ladder that runs it: the county's is the Sunday League Plate and the
   * district's is the `<its region> Sunday League Plate`. Two Plates with one name
   * would file their winners under one honour.
   */
  plateName?: string;
  field: CupField;
  /** Its entrants, in the order the draw seeds them. */
  entrants: ClubId[];
  plan: CupRound[];
  /**
   * How many matchdays its rounds are numbered above the league's.
   *
   * Read off the calendar rather than chosen: a cup's round `r` is played on
   * matchday `leagueMatchdays + offset + r`, and the date for a matchday is the
   * calendar entry with that number, so the offset has to be exactly the number of
   * rounds already laid out before this cup's — which is what keeps two cups' ties
   * off each other's afternoons.
   */
  matchdayOffset: number;
  /**
   * The consolation cup this one feeds, where it has one: a cup that starts with
   * no field at all and is filled from this cup's losers. Its `consolationFor` is
   * written on the cup that is fed, never on the cup that feeds it — a cup naming
   * itself as its own feeder is a cup whose Plate is never drawn.
   */
  consolationRounds: CupRound[];
  consolationId?: CompetitionId;
  consolationOffset?: number;
}

/**
 * Build every competition for a season and put the fixtures in place.
 *
 * One call builds the whole world: every ladder's divisions and cups, the world's
 * own cups, one set of fixtures and matches, and one calendar. It replaces
 * `state.competitions`, `state.fixtures`, `state.matches` and `state.matchOrder`
 * wholesale — a season is a clean sheet, and the archive of what happened in the
 * last one lives on the clubs rather than in the fixture list.
 */
export function buildSeasonStructure(options: BuildSeasonOptions): SeasonStructure {
  const { state, seasonId, seasonLabel, firstLeagueDate, pyramids } = options;
  const dateCups = options.dateCupRounds !== false;

  // Each ladder's clubs as *this* build is writing them, by pyramid id. Read from
  // the divisions being built rather than from `state.competitions`: this function
  // is what writes those, so at game start the old set is empty and a field read
  // from it would be a field of nobody.
  const ladders = new Map<PyramidId, ClubId[]>(
    pyramids.map((input) => [input.pyramidId, input.divisions.flat()]),
  );

  // --- The calendar ---------------------------------------------------------
  // Every division has the same number of matchdays, so the league calendar is
  // sized by one division and the whole county plays it together. It is the first
  // pyramid's that sizes it: the world shares one sequence of Sundays, and
  // per-ladder division sizes are a later stage of the expansion.
  const founding = pyramids[0];
  const clubsPerTier = Math.max(
    2,
    founding?.divisions[0]?.length ?? pyramidOf(state, founding?.pyramidId ?? 'league').config.clubsPerTier,
  );
  const leagueMatchdays = matchdayCount(clubsPerTier);

  const cups: CupSpec[] = [];
  const slots: CupRoundSlot[] = [];
  /** What the calendar made of each slot. Empty for a build that dates nothing. */
  let placedSlots: PlacedCupSlot[] = [];
  const slotOwners: CompetitionId[] = [];

  // --- Each ladder's own cups ------------------------------------------------
  // A cup's field is its own ladder's clubs, and its rounds are numbered after
  // everything already asked for. The consolation cup's rounds come after the
  // League Cup's, so a club knocked out in the opening round has already lost by
  // the time the Plate's first tie is played, and no club is asked for two games
  // on one afternoon.
  for (const input of pyramids) {
    const { pyramidId } = input;
    const config = pyramidOf(state, pyramidId).config;
    const cupId = cupCompetitionId(pyramidId, 'cup');
    const plateId = cupCompetitionId(pyramidId, 'plate');
    const field: CupField = { kind: 'pyramid', pyramidId };
    const ladderClubs = fieldClubs(state, field, ladders);
    const entrants = seedOrder(state, ladderClubs);
    // How many clubs each round holds, fixed here so the draw, the round-advance
    // and the screens all read one description of the tournament. A field of
    // fewer than two clubs is no cup at all.
    const mainPlan = config.leagueCup ? mainCupPlan(entrants.length) : [];
    const plateRounds = config.leagueCup && config.consolationCup ? platePlan(mainPlan) : [];
    const mainOffset = slots.length;
    if (config.leagueCup) {
      // Every round of this ladder's cups carries the ladder's field, which is
      // what lets the *other* ladder's round have the same Sunday: the two fields
      // have no club in common, so no club can be drawn twice on one afternoon.
      // The Plate is given the same field as the cup it is fed from rather than
      // the losers it will actually take, because the draw has not happened when
      // the season is built: a club that could be in either must not be in both,
      // and the Plate's entrants are a subset of the ladder either way.
      // Each slot carries the competition whose round it is, read off the order
      // `allCupRoundSlots` lays them out in: the League Cup's rounds first and the
      // Plate's after them. The calendar uses it to keep a competition's rounds in
      // order when the season is crowded, and nothing else depends on it —
      // `slotOwners` below still says which competition a placed round belongs to.
      slots.push(
        ...allCupRoundSlots(entrants.length, leagueMatchdays, config.consolationCup).map((slot, index) => ({
          ...slot,
          clubs: ladderClubs,
          competitionId: index < mainPlan.length ? cupId : plateId,
        })),
      );
      // Which competition each slot belongs to, read off the order they were laid
      // out in: `allCupRoundSlots` lists the League Cup's rounds first and the
      // Plate's after them, so a slot's position — not its round number, which
      // both competitions start at one — is what says whose round it is.
      slotOwners.push(...mainPlan.map(() => cupId), ...plateRounds.map(() => plateId));
    }
    if (mainPlan.length === 0) continue;
    cups.push({
      id: cupId,
      // Named after the district the ladder draws its clubs from: the county's
      // ladder runs the Alderford Sunday League Cup, and the one next door the
      // Westbrook Valley Sunday League Cup — two trophies, two names, two honours.
      name: cupNameFor(input.regionName, 'cup'),
      plateName: cupNameFor(input.regionName, 'plate'),
      field,
      entrants,
      plan: mainPlan,
      matchdayOffset: mainOffset,
      consolationRounds: plateRounds,
      ...(plateRounds.length > 0 ? { consolationId: plateId, consolationOffset: mainOffset + mainPlan.length } : {}),
    });
  }

  // --- The world's own cups --------------------------------------------------
  // Asked for by name, and drawn from their declared field: a county cup's field
  // is every active club in the county, which is why it is not derived from the
  // ladders above. Their rounds are numbered after every ladder's, by the same
  // rule as any other cup's.
  for (const request of options.cups ?? []) {
    if (cups.some((spec) => spec.id === request.id)) {
      throw new Error(`Two cups want the same competition id, ${request.id}.`);
    }
    const entrants = seedOrder(state, fieldClubs(state, request.field, ladders));
    const plan = mainCupPlan(entrants.length);
    const mainOffset = slots.length;
    // A world cup's rounds carry the field they were drawn from, so a county cup
    // overlapping every ladder's own field can never be given one of their
    // Sundays: there would be clubs in both competitions. Its rounds take the
    // afternoons nobody else can use.
    const fieldClubsOfRequest = fieldClubs(state, request.field, ladders);
    slots.push(
      ...cupRoundSlots(entrants.length, leagueMatchdays).map((slot) => ({
        ...slot,
        clubs: fieldClubsOfRequest,
        competitionId: request.id,
      })),
    );
    slotOwners.push(...plan.map(() => request.id));
    if (plan.length === 0) continue;
    cups.push({
      id: request.id,
      name: request.name,
      field: request.field,
      entrants,
      plan,
      matchdayOffset: mainOffset,
      consolationRounds: [],
    });
  }

  // The calendar is asked for every slot in one call, so a round the season has
  // no room for is refused where the season is built. A build that is proving the
  // world's competitions rather than its dates asks for the league's Sundays
  // alone, and every cup is then declared, seeded, owned and undated.
  let calendar: SeasonCalendarEntry[];
  if (dateCups) {
    const placement = placeCupRounds(firstLeagueDate, leagueMatchdays, slots);
    requireCupRoundsPlaced(
      state,
      placement,
      slotOwners,
      seasonLabel,
      new Map(cups.flatMap((spec) => [
        [spec.id, spec.name] as const,
        ...(spec.consolationId ? [[spec.consolationId, spec.plateName ?? PLATE_NAME] as const] : []),
      ])),
    );
    calendar = placement.calendar;
    placedSlots = placement.slots;
  } else {
    calendar = buildSeasonCalendar(firstLeagueDate, leagueMatchdays);
  }
  // The calendar is ordered by *date*, not by matchday: a cup round sits on the
  // Sunday before the league matchday it precedes, so its matchday number is
  // higher than the league rounds around it. A fixture's date must therefore be
  // read by its own matchday, never by its position in the array — indexing by
  // position dated every league matchday after the first interleaved cup round
  // to the wrong Sunday, landing league fixtures on cup nights and pushing cup
  // rounds onto days already played.
  const dateOfMatchday = new Map<number, ISODate>(calendar.map((entry) => [entry.matchday, entry.date]));

  // --- The competitions -----------------------------------------------------
  const competitions: Record<CompetitionId, Competition> = {};
  // Every ladder's divisions, one ladder after another, tier 1 upwards. Each
  // pyramid's ids are its own, so no ladder can overwrite another's.
  for (const input of pyramids) {
    input.divisions.forEach((clubIds, index) => {
      const tier = index + 1;
      if (clubIds.length === 0) return;
      const competition = divisionCompetition(state, input.pyramidId, tier, seasonId, clubIds, input.regionName);
      competitions[competition.id] = competition;
    });
  }

  // Then the cups, each with the field its entrants were taken from.
  for (const spec of cups) {
    competitions[spec.id] = cupCompetition(
        spec.id,
        spec.name,
        seasonId,
        spec.entrants,
        newCupState(spec.plan, undefined, spec.matchdayOffset),
        spec.field,
      );
    if (spec.consolationId) {
      competitions[spec.consolationId] = cupCompetition(
        spec.consolationId,
        spec.plateName ?? PLATE_NAME,
        seasonId,
        [],
        newCupState(spec.consolationRounds, spec.id, spec.consolationOffset ?? 0),
        spec.field,
      );
    }
  }

  // Each pyramid's own list of what it owns, written where its competitions are
  // made. It is the source of truth the lookups read, so it is kept here rather
  // than derived later: one writer, and no way for the record and the world to
  // disagree about which ladder a division belongs to. A world-level cup is on no
  // pyramid's list — it belongs to the county — which is what makes `pyramidIdOf`
  // answer null for it rather than pointing at a ladder that does not run it.
  for (const input of pyramids) {
    const pyramid = pyramidOf(state, input.pyramidId);
    pyramid.competitionIds = input.divisions
      .map((_, index) => divisionCompetitionId(input.pyramidId, index + 1))
      .filter((id) => Boolean(competitions[id]));
    pyramid.cupIds = [cupCompetitionId(input.pyramidId, 'cup'), cupCompetitionId(input.pyramidId, 'plate')].filter(
      (id) => Boolean(competitions[id]),
    );
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
      const date = dateOfMatchday.get(fixture.matchday);
      if (!date) continue;
      matches[id] = createMatchRecord({
        state,
        id,
        matchday: fixture.matchday,
        date,
        homeClubId: fixture.homeClubId,
        awayClubId: fixture.awayClubId,
        competitionId: competition.id,
        competitionName: competition.name,
        kickOff: kickOffTimeFor(date),
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

  // --- The first cup draws --------------------------------------------------
  // Drawn here rather than on the day: a cup draw is an announcement, and a draw
  // that happened on the morning of the tie would be an announcement nobody had
  // heard. A consolation cup is not drawn here — it has no field until the cup
  // above it knocks clubs out of itself, and the day loop feeds it.
  if (dateCups) {
    for (const spec of cups) {
      drawCupRound(state, competitions[spec.id]!, {
        seasonId,
        seasonLabel,
        leagueMatchdays,
        announce: options.announceDraws ?? false,
      });
    }
  }

  // The slots are the ones the calendar was actually asked for: a build that
  // dates nothing has no cup rounds to report, and says so rather than reporting
  // rounds that do not exist.
  return { calendar, leagueMatchdays, cupSlots: placedSlots };
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
  pyramidId: PyramidId,
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
    const competition = state.competitions[divisionCompetitionId(pyramidId, index + 1)];
    if (competition) competition.clubIds = [...next[index]!];
  });
}
