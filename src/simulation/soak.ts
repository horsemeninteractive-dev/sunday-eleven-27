import { MANAGER_PERSON_ID } from '@/domain/communication';
import { FRIENDLY_COMPETITION_ID } from '@/domain/competition';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { isOfficial, isPlayer, type Player } from '@/domain/person';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import type { GameState } from '@/domain/game';
import { SEASON_HISTORY_LIMIT } from '@/domain/history';
import type { ISODate } from '@/domain/ids';
import { daysBetween } from './calendar';
import { CLUB_LIFECYCLE } from './clubLifecycle';
import { cupRoundMatchday, tiesOnMatchday } from './cup';
import { processDay, currentAttention } from './day';
import { REARRANGEMENT_GRACE_DAYS, rearrangementDeadlineFor } from './postponement';
import { startNextSeason } from './season';
import { seasonHistoryOf } from './seasonHistory';
import { cupCompetitions, divisionsOf, leagueCompetitions, pyramidsOf, tierOf } from './pyramid';
import { publishEvents } from './news';
import { createTestGame } from './testSupport';
import { serialiseGame, deserialiseGame } from '@/state/persistence';

/**
 * The multi-season soak.
 *
 * The match engine has a bench and a test suite. The *season loop* has neither:
 * everything above it is asserted one fixture or one season at a time, and the
 * interesting failures only appear after a decade of summers. This plays the game
 * forward with nobody at the controls and reads the world afterwards, so drift is
 * found in a report rather than in year twelve of somebody's career.
 *
 * It is a developer harness. Nothing in the game imports it — same status as
 * `match/trace.ts` — and `npm run soak` is deliberately outside `npm test`,
 * because fifteen seasons is about a minute of football.
 *
 * **It drives the game the way the game drives itself**, not by reaching into
 * internals:
 *
 *  - one day, `processDay(state, state.date, { resolveUserMatch: true })` — the
 *    same call `advanceDays`, `continueTime` and `jumpToDate` make. Resolving the
 *    user's own match is the "send it to the bench" path: the XI is picked by the
 *    real selection code (`prepareMatchday` → `buildLineupForClub` →
 *    `autoPickLineup`), the football is the real engine, and the consequences,
 *    finances and news are the real ones. Training runs itself, and no
 *    recruitment decision is ever taken, which is exactly what "autopilot" means
 *    — the manager signs nobody, so the squad only moves when the game moves it.
 *  - the season closes inside that call (`applySeasonBoundary` → `finishSeason`),
 *    so nothing here closes a season by hand.
 *  - a new season is `startNextSeason` + `publishEvents`, which is precisely what
 *    the manager's "start next season" action (`rollOverSeason`) does.
 *
 * The one thing it does *not* copy is the store's habit of stopping the clock for
 * anything that needs the manager. It records those days instead and keeps going,
 * because the point is to see the decade, and the report says how often the real
 * Continue button would have stopped.
 */

// ---------------------------------------------------------------------------
// Measuring the state
// ---------------------------------------------------------------------------

/**
 * How big a career is: the size of its state, in bytes.
 *
 * One definition, in one place, because two readings of "the size of the game"
 * that disagree are worse than no reading at all: the benchmark's world audit
 * measures the world with this and the soak's `state-bounded` invariant holds the
 * close of a season to it, so a growth that trips one of them is a growth both of
 * them see.
 *
 * It is `JSON.stringify(state).length`: the bytes the game is, before the version
 * header and the timestamp a save file adds, and before whatever a storage layer
 * does to them. It is deliberately not the length of a compressed database row —
 * that is a property of the storage, not of the career — and not the in-memory
 * footprint either, which moves with the engine's own object shapes.
 *
 * It costs what serialising the state costs, which on a full county is a couple of
 * seconds and the size of the state in memory, so it is read at the checkpoints
 * that matter — the close of a season, the benchmark's audit — rather than on a
 * timer or a screen.
 *
 * It takes any value rather than a `GameState` because the same reading of a
 * *part* of the state is what says where the bytes are, and a breakdown of the
 * whole has to be measured the same way the whole is.
 */
export function stateSizeBytes(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

/** `204904153` → `204,904,153`, so a size reads at a glance in a failure. */
function group(value: number): string {
  return value.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/**
 * What "healthy" means.
 *
 * These are deliberately loose. A soak is a drift detector, not a change
 * detector: it should catch a world that is slowly inflating, ageing or draining,
 * and stay quiet about the ordinary variance of a season. The tolerances are
 * relative to season one, because season one is the world as generated — the
 * question is never "is this number right" but "is this number still the number
 * it was".
 */
export const SOAK_BANDS = {
  /** Registered squad size, from the design document: typically 20–30. */
  squadMin: 20,
  squadMax: 30,
  /** Bodies a club needs to actually field a side. */
  eligibleForAFixture: 11,
  /** Ability and goals may wander this far from season one before it is drift. */
  abilityTolerance: 0.08,
  goalsTolerance: 0.15,
  /** The unattached pool arrives and departs on the same clock, so it should hold. */
  poolTolerance: 0.35,
  /** Age percentiles may wander this many years, and nobody plays past this. */
  ageTolerance: 3,
  /**
   * The 10th percentile is deliberately pulled down by the youth intake — a
   * league with teenagers in it should have a lower p10 than one without. The
   * median and the 90th are what must not spring upward, so they keep the
   * tighter band while p10 gets room for the intake.
   */
  ageP10Tolerance: 6,
  maxAge: 42,
  /** Nobody may be booked into stardom: attributes live on a 1–20 scale. */
  attributeMin: 1,
  attributeMax: 20,
  /** A season that needs longer than this has stopped being a season. */
  daysPerSeason: 400,
  /**
   * News is capped at 300 and a club's ledger at 400; the archive should be too.
   *
   * One snapshot per division per matchday, so a three-division season of
   * twenty-two matchdays plus a handful of cup rounds is around eighty.
   */
  standingHistoryMax: 140,
  /**
   * The archive of finished seasons, which is capped at `SEASON_HISTORY_LIMIT`.
   *
   * One season is six divisions' final tables and every cup's rounds — the
   * county's five competitions and both ladders' — so the whole archive is a few
   * hundred rows and a few thousand ties at the very most, and it stops there
   * rather than growing with the career.
   */
  seasonHistoryMax: SEASON_HISTORY_LIMIT,
  /**
   * How far a single tier's mean ability may wander from its own season one.
   *
   * Deliberately tighter than the county-wide band: a pyramid that has
   * stratified should hold each of its rungs, and the failure this catches is
   * the top division inflating while the bottom collapses — which averages out
   * to nothing and is invisible on the league-wide figure.
   */
  tierAbilityTolerance: 0.06,
  /**
   * The gap a tier must keep from the one below it, as a fraction of the top
   * tier's ability. Without promotion and recruitment the bottom of the ladder
   * and the top of it drift towards each other and the pyramid flattens.
   */
  tierSeparation: 0.015,
  /**
   * The most a career's state may serialise to at the close of a season.
   *
   * The baseline is the verified six-district county: 204,904,153 bytes
   * (200,102 KB) at the end of its first season — 2,917 fixtures, about three
   * quarters of it the season's retained match records — measured by
   * `npm run benchmark --districts=6` on seed `bench` and recorded in
   * `reports/benchmark-se27-phase3.json`. The soak reads the same number on the
   * same world, to the byte.
   *
   * That reading is not flat, and a budget written for season one alone would
   * fail the game as it stands. A ten-season run of the county — seed `soak`,
   * 2026/27 to 2035/36 — closes at 203,456 → 207,949 → 208,219 → 216,229 →
   * 224,655 → 222,779 → 226,445 → 228,716 → 233,753 → 236,238 KB. The growth that
   * was left is the subs book: the settled matchday charges and payments of closed
   * seasons, which used to be kept for ever and are now folded away at each
   * boundary (`pruneSubsHistory`, and `foldSubsBook` when a carried debt is paid),
   * so the county grows about 3,600 KB a season on average. Before that fold the
   * same run closed at 333,330 KB.
   *
   * Hence **400,000 KB**: twice what the county writes in its first season, and
   * the room the tool's own run needs — `npm run soak` plays ten seasons of the
   * county, which peak at 236,238 KB, 163,762 KB (40.9%) under the budget. The
   * budget is not lowered for that, because a ceiling is meant to leave room for a
   * seed that draws a fuller county, a longer career, or a season with more
   * rearranged fixtures.
   *
   * What it still catches is what it is for: a world that keeps a season's match
   * records twice (about +150,000 KB, at any season), a per-season structure that
   * grows faster than the county's own people do, a retention or archive change
   * that adds a fifth to the state. Raising it is a decision to make on purpose,
   * with a fresh measurement in hand — and lengthening the soak's default run is
   * a reason to revisit it, which the failure itself says.
   */
  stateBudgetBytes: 409_600_000,
} as const;

/**
 * What the county thinks of its clubs, as one reading.
 *
 * Reputation is the ladder made visible: it is what the divisions were built
 * from, what a summer's arrivals are generated at, and — since the standing
 * layer — what a season of results moves. The soak watches it for the same
 * reason it watches ability: a mean that climbs every year is a county inflating
 * itself, and a spread that collapses is a pyramid whose rungs have stopped
 * meaning anything.
 */
function standingStats(state: GameState): { standingMin: number; standingMean: number; standingSpread: number } {
  const values = Object.values(state.clubs)
    .filter((club) => club.active)
    .map((club) => club.reputation);
  if (values.length === 0) return { standingMin: 0, standingMean: 0, standingSpread: 0 };
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return { standingMin: Math.min(...values), standingMean: round(average), standingSpread: round(Math.sqrt(variance)) };
}

const ATTRIBUTE_GROUPS = ['technical', 'physical', 'mental', 'behavioural'] as const;
/** The groups the match engine actually reads, for the ability reading. */
const ABILITY_GROUPS = ['technical', 'physical', 'mental'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SoakSeverity = 'fail' | 'warn';

export interface SoakViolation {
  season: number;
  seasonLabel: string;
  severity: SoakSeverity;
  invariant: string;
  /** The club, player or match it concerns, where there is one. */
  subject: string | null;
  detail: string;
}

/** One season's reading of the world, taken the moment the season closes. */
export interface SoakSnapshot {    season: number;
  seasonId: string;
  label: string;
  endDate: ISODate;
  days: number;
  seconds: number;
  /** Days on which the real Continue button would have stopped for something. */
  noticedDays: number;

  clubs: number;
  /** Clubs in the ladder — must not shrink as clubs fold and re-form. */
  divisionSize: number;
  /** Clubs in each division, tier 1 first. Must not change. */
  tierSizes: number[];
  /** Clubs that have folded over the career, still kept in the archive. */
  foldedClubs: number;
  /** Clubs playing on that have come back as themselves since the world began. */
  reformedClubs: number;
  /** Clubs playing on that were minted in a folded club's place — a new name. */
  successorClubs: number;
  /** Clubs in the red and still inside the grace period. */
  inAdministration: number;
  /** Spells on the manager's career record: one per run in charge of a club. */
  careerSpells: number;
  /** Distinct clubs his record names, which is what "clubs managed" means. */
  careerClubs: number;
  /** 1 while he is in work at the close of the season, 0 while he is not. */
  employed: number;
  championClubId: string | null;
  championName: string | null;
  userClubId: string;
  /** Division the manager's club is in: 1 is the top. */
  userTier: number | null;
  userPosition: number | null;
  userPoints: number;
  /** Clubs promoted and relegated across all boundaries this season. */
  promoted: number;
  relegated: number;
  /** Promotion places refused on eligibility grounds. */
  promotionsBlocked: number;

  squadMin: number;
  squadMean: number;
  squadMax: number;
  registered: number;
  /** Mean of the technical/physical/mental attributes of every registered player. */
  abilityMean: number;
  /** Standard deviation of the same, across players — the spread of the league. */
  abilitySpread: number;
  maxAttribute: number;

  ageP10: number;
  ageP50: number;
  ageP90: number;
  ageMax: number;

  balanceMin: number;
  balanceMean: number;
  balanceMax: number;
  clubsInTheRed: number;

  /** What the county thinks of its clubs: the standing the ladder is made of. */
  standingMin: number;
  standingMean: number;
  standingSpread: number;

  unattached: number;
  unattachedAbility: number;

  /** Managers between jobs — the pool the market both fills and drains. */
  managerPool: number;
  /** Players running their own side. */
  playerManagers: number;

  matchesPlayed: number;
  goalsPerMatch: number;
  injuries: number;
  yellowCards: number;
  redCards: number;
  newsEvents: number;
  /** Mean ability of the registered players in each division, tier 1 first. */
  tierAbility: number[];
  /** Cup ties played this season, across both competitions. */
  cupTies: number;

  honoursTotal: number;
  seasonRecordsMax: number;
  standingHistoryMax: number;
  seasonHistoryMax: number;
  postponements: number;
  rearrangements: number;
  abandoned: number;
  /**
   * `stateSizeBytes(state)` at the moment this season closed — what the game
   * writes on every save, and the reading `state-bounded` holds to the budget.
   *
   * Read here rather than on a fresh career because here is where the state
   * peaks: the season's football is all retained, the boundary that rolls the
   * fixtures over has not run yet, and nothing in the days between makes the
   * game smaller.
   */
  stateBytes: number;
}

export interface SoakOptions {
  seed: string;
  seasons: number;
  /** Which club in the division the manager takes over. */
  clubIndex?: number;
  /**
   * How many of the county's districts the soaked career is founded with.
   *
   * Left out, it is the whole county — the six districts, 216 clubs and 2,376
   * league fixtures a career founded today gets, which is also the world the
   * state budget is measured against. `tools/benchmark.ts` makes the same choice
   * for the same reason. `1` and `2` are the smaller worlds the earlier soaks
   * were measured on.
   */
  districts?: number;
  /**
   * The state budget this run is held to, in bytes. Left out, the band
   * (`SOAK_BANDS.stateBudgetBytes`), which is what every ordinary run uses; it is
   * here so a deliberate adjustment can be tried without editing the band, and so
   * a test can hold a run to a budget it chooses.
   */
  stateBudgetBytes?: number;
  /** Called as each season closes, for a progress line. */
  onSeason?: (snapshot: SoakSnapshot) => void;
}

export interface SoakResult {
  seed: string;
  clubId: string;
  seasons: number;
  /** The districts the career was founded with. */
  districts: number;
  seconds: number;
  /** The state as the career opened: a season of football has not been played yet. */
  stateBytesFresh: number;
  /** The largest any season closed at, in bytes; 0 when no season was played. */
  stateBytesAtSeasonEnd: number;
  /** The budget this run was held to, in bytes. */
  stateBudgetBytes: number;
  snapshots: SoakSnapshot[];
  violations: SoakViolation[];
}

// ---------------------------------------------------------------------------
// Reading the world
// ---------------------------------------------------------------------------

function playersOf(state: GameState): Player[] {
  return Object.values(state.people).filter(isPlayer);
}

function attributeValues(player: Player, groups: readonly (typeof ATTRIBUTE_GROUPS)[number][]): number[] {
  const values: number[] = [];
  for (const group of groups) {
    for (const value of Object.values(player.attributes[group])) values.push(value as number);
  }
  return values;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted: readonly number[], at: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * at)));
  return sorted[index]!;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function seasonMatchList(state: GameState): Match[] {
  return Object.values(state.matches).filter((match) => match.played && match.result);
}

function countMatchEvents(state: GameState, types: readonly string[]): number {
  let count = 0;
  for (const match of Object.values(state.matches)) {
    for (const event of match.events) if (types.includes(event.type)) count += 1;
  }
  return count;
}

function snapshotSeason(
  state: GameState,
  season: number,
  days: number,
  seconds: number,
  noticedDays: number,
): SoakSnapshot {
  const allClubs = Object.values(state.clubs);
  // A folded club stays in the archive but is no longer part of the world: it
  // has no squad, no money worth reading and no season to archive. Every
  // reading of "the league" is a reading of the clubs that are still playing.
  const clubs = allClubs.filter((club) => club.active);
  // Every division in the world, each ladder's own together and in tier order,
  // the founding ladder first.
  //
  // The readings below are rungs of a ladder, and a county with a district next
  // door has two ladders in it. `[county 1, county 2, county 3, district 1,
  // district 2, district 3]` is a list whose neighbours are comparable; ordering
  // the lot by tier number instead puts two different ladders' top divisions side
  // by side, and the check that asks whether each rung is above the one below it
  // then reads the district's top division as a step down from the county's — as
  // does the count of boundaries a season's promotions cross.
  const divisions = pyramidsOf(state).flatMap((pyramid) => divisionsOf(state, pyramid.id));
  const competition = divisions[0];
  const registered = clubs.flatMap((club) => club.squadIds.map((id) => state.people[id]).filter(isPlayer));
  const unattached = playersOf(state).filter((player) => player.clubId === null);

  const perPlayerAbility = registered.map((player) => mean(attributeValues(player, ABILITY_GROUPS)));
  const abilityMean = mean(perPlayerAbility);
  const abilitySpread = Math.sqrt(mean(perPlayerAbility.map((value) => (value - abilityMean) ** 2)));

  const allAttributes = registered.flatMap((player) => attributeValues(player, ATTRIBUTE_GROUPS));
  const squadSizes = clubs.map((club) => club.squadIds.length).sort((a, b) => a - b);
  const balances = clubs.map((club) => club.finances.balance);
  const ages = registered.map((player) => player.age).sort((a, b) => a - b);

  const played = seasonMatchList(state);
  const competitive = played.filter((match) => isCompetitiveMatch(state, match));
  const goals = competitive.reduce((sum, match) => sum + match.result!.homeGoals + match.result!.awayGoals, 0);

  const standings = competition
    ? standingsOrder(state, competition.clubIds)
    : [];
  const position = standings.indexOf(state.userClubId);
  const championId = standings[0] ?? null;
  const userRecord = state.clubs[state.userClubId]?.history.seasons.find(
    (record) => record.seasonId === state.season.id,
  );

  // Per tier: the clubs in it, their size, and the ability of their players. The
  // last of those is the measurement the whole pyramid exists to produce — a
  // ladder that does not hold its rungs is just three leagues.
  const tierSizes: number[] = [];
  const tierAbility: number[] = [];
  for (const division of divisions) {
    tierSizes.push(division.clubIds.length);
    const players = division.clubIds.flatMap((clubId) =>
      (state.clubs[clubId]?.squadIds ?? []).map((id) => state.people[id]).filter(isPlayer),
    );
    tierAbility.push(round(mean(players.map((player) => mean(attributeValues(player, ABILITY_GROUPS))))));
  }

  const seasonMovements = (state.promotionHistory ?? []).filter(
    (movement) => movement.seasonId === state.season.id,
  );
  const cupTies = Object.values(state.matches).filter(
    (match) => match.played && Boolean(state.competitions[match.competitionId]?.cup),
  ).length;

  return {
    season,
    seasonId: state.season.id,
    label: state.season.label,
    endDate: state.date,
    days,
    seconds: round(seconds, 1),
    noticedDays,
    clubs: clubs.length,
    divisionSize: divisions.reduce((sum, division) => sum + division.clubIds.length, 0),
    tierSizes,
    foldedClubs: allClubs.filter((club) => !club.active).length,
    reformedClubs: clubs.filter((club) => club.heritage?.kind === 'reformed').length,
    successorClubs: clubs.filter((club) => club.heritage?.kind === 'successor').length,
    inAdministration: clubs.filter((club) => (club.finances.administrationSeasons ?? 0) > 0).length,
    careerSpells: state.career?.spells.length ?? 0,
    careerClubs: new Set((state.career?.spells ?? []).map((spell) => spell.clubId)).size,
    employed: state.career?.status === 'employed' ? 1 : 0,
    championClubId: championId,
    championName: championId ? state.clubs[championId]?.identity.name ?? null : null,
    userClubId: state.userClubId,
    userTier: tierOf(state, state.userClubId),
    userPosition: position >= 0 ? position + 1 : null,
    userPoints: userRecord?.points ?? 0,
    promoted: seasonMovements.filter((movement) => movement.direction === 'promoted' && !movement.blockedReason).length,
    relegated: seasonMovements.filter((movement) => movement.direction === 'relegated').length,
    promotionsBlocked: seasonMovements.filter((movement) => movement.blockedReason).length,
    squadMin: squadSizes[0] ?? 0,
    squadMean: round(mean(squadSizes), 1),
    squadMax: squadSizes[squadSizes.length - 1] ?? 0,
    registered: registered.length,
    abilityMean: round(abilityMean),
    abilitySpread: round(abilitySpread),
    maxAttribute: allAttributes.length > 0 ? Math.max(...allAttributes) : 0,
    ageP10: percentile(ages, 0.1),
    ageP50: percentile(ages, 0.5),
    ageP90: percentile(ages, 0.9),
    ageMax: ages[ages.length - 1] ?? 0,
    balanceMin: Math.round(Math.min(...balances)),
    balanceMean: Math.round(mean(balances)),
    balanceMax: Math.round(Math.max(...balances)),
    clubsInTheRed: balances.filter((balance) => balance < 0).length,
    ...standingStats(state),
    unattached: unattached.length,
    unattachedAbility: round(mean(unattached.map((player) => mean(attributeValues(player, ABILITY_GROUPS))))),
    managerPool: Object.values(state.people).filter(
      (person) => isOfficial(person) && person.clubId === null && person.role === 'manager',
    ).length,
    playerManagers: playersOf(state).filter((player) => player.isPlayerManager).length,
    matchesPlayed: competitive.length,
    goalsPerMatch: competitive.length === 0 ? 0 : round(goals / competitive.length),
    injuries: countMatchEvents(state, ['injury']),
    yellowCards: countMatchEvents(state, ['yellow-card']),
    redCards: countMatchEvents(state, ['red-card']),
    newsEvents: 0,
    tierAbility,
    cupTies,
    honoursTotal: allClubs.reduce((sum, club) => sum + club.history.honours.length, 0),
    seasonRecordsMax: Math.max(...allClubs.map((club) => club.history.seasons.length)),
    standingHistoryMax: state.standingHistory.length,
    seasonHistoryMax: seasonHistoryOf(state).length,
    postponements: Object.values(state.matches).filter((match) => match.postponementReason).length,
    rearrangements: Object.values(state.matches).filter((match) => match.originalDate !== null).length,
    abandoned: Object.values(state.matches).filter((match) => match.status === 'abandoned').length,
    stateBytes: stateSizeBytes(state),
  };
}

/** The season's table, best first — read off the archived records the season just wrote. */
function standingsOrder(state: GameState, clubIds: readonly string[]): string[] {
  return [...clubIds]
    .map((clubId) => {
      const record = state.clubs[clubId]?.history.seasons.find((entry) => entry.seasonId === state.season.id);
      return { clubId, points: record?.points ?? 0, goalDifference: (record?.goalsFor ?? 0) - (record?.goalsAgainst ?? 0) };
    })
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || a.clubId.localeCompare(b.clubId))
    .map((row) => row.clubId);
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

function violation(
  snapshot: SoakSnapshot,
  severity: SoakSeverity,
  invariant: string,
  detail: string,
  subject: string | null = null,
): SoakViolation {
  return { season: snapshot.season, seasonLabel: snapshot.label, severity, invariant, subject, detail };
}

/** Every number that is on a 1–20 scale, and every number that must exist at all. */
function checkNumbers(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  for (const player of playersOf(state)) {
    for (const [group, bucket] of Object.entries(player.attributes)) {
      for (const [key, value] of Object.entries(bucket as Record<string, number>)) {
        if (!Number.isFinite(value)) {
          out.push(violation(snapshot, 'fail', 'numbers-finite', `${group}.${key} is ${value}`, player.id));
          continue;
        }
        if (value < SOAK_BANDS.attributeMin || value > SOAK_BANDS.attributeMax) {
          out.push(
            violation(
              snapshot,
              'fail',
              'attributes-in-range',
              `${group}.${key} is ${value}, outside ${SOAK_BANDS.attributeMin}–${SOAK_BANDS.attributeMax}`,
              player.id,
            ),
          );
        }
      }
    }
    if (!Number.isFinite(player.age) || player.age < 15 || player.age > 60) {
      out.push(violation(snapshot, 'fail', 'age-sane', `age is ${player.age}`, player.id));
    }
    if (!Number.isFinite(player.morale)) {
      out.push(violation(snapshot, 'fail', 'numbers-finite', `morale is ${player.morale}`, player.id));
    }
  }
  for (const club of Object.values(state.clubs)) {
    const finances = club.finances;
    for (const [key, value] of Object.entries(finances)) {
      if (typeof value !== 'number') continue;
      if (!Number.isFinite(value)) {
        out.push(violation(snapshot, 'fail', 'numbers-finite', `finances.${key} is ${value}`, club.id));
      }
    }
    for (const line of finances.ledger) {
      if (!Number.isFinite(line.amount) || !Number.isFinite(line.balanceAfter)) {
        out.push(violation(snapshot, 'fail', 'numbers-finite', `ledger line ${line.id} is not a number`, club.id));
      }
    }
    if (club.active && finances.balance < 0) {
      // A club in the red is now a club in administration: the board reacts, the
      // sponsor may walk, and a club that cannot recover folds. It is still worth
      // reporting, but it is a state of the world rather than a design hole.
      out.push(
        violation(
          snapshot,
          'warn',
          'club-in-the-red',
          `balance ${Math.round(finances.balance)} — in administration (folds if it cannot recover)`,
          club.id,
        ),
      );
    }
  }
  return out;
}

/** Squads that are legal, and squads that could actually put a team out. */
function checkSquads(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  for (const club of Object.values(state.clubs)) {
    if (!club.active) continue;
    const size = club.squadIds.length;
    if (size < SOAK_BANDS.squadMin || size > SOAK_BANDS.squadMax) {
      out.push(
        violation(
          snapshot,
          'fail',
          'legal-squad',
          `${size} registered, outside ${SOAK_BANDS.squadMin}–${SOAK_BANDS.squadMax}`,
          club.id,
        ),
      );
    }
    const eligible = club.squadIds
      .map((id) => state.people[id])
      .filter((person): person is Player => isPlayer(person))
      .filter((player) => player.availability.status !== 'unavailable' && !player.injury).length;
    if (eligible < SOAK_BANDS.eligibleForAFixture) {
      out.push(
        violation(
          snapshot,
          'fail',
          'can-field-a-side',
          `only ${eligible} available and fit, needs ${SOAK_BANDS.eligibleForAFixture}`,
          club.id,
        ),
      );
    }
  }
  return out;
}

/**
 * The ladder holds its shape.
 *
 * Four things about the pyramid that a decade of seasons will quietly break if
 * it can, and that a single season's tests cannot see:
 *
 *  - a club is in exactly one division. Two is a duplicated fixture; none is a
 *    club that has fallen out of the world without folding.
 *  - every division is the size it was configured to be. Promotion and
 *    relegation swap equal numbers, and the fold-and-reform cycle replaces a
 *    club in its own division, so this should never move.
 *  - the same number of clubs crosses each boundary in each direction.
 *  - the honours list holds one line per champion and one per cup winner per
 *    season, and no two clubs hold the same line for the same season.
 */
function checkPyramid(state: GameState, snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const divisions = leagueCompetitions(state);

  // --- Exactly one division each -------------------------------------------
  const memberships = new Map<string, number>();
  for (const division of divisions) {
    for (const clubId of division.clubIds) {
      memberships.set(clubId, (memberships.get(clubId) ?? 0) + 1);
    }
  }
  for (const club of Object.values(state.clubs)) {
    if (!club.active) continue;
    const count = memberships.get(club.id) ?? 0;
    if (count !== 1) {
      out.push(
        violation(
          snapshot,
          'fail',
          'every-club-in-one-league',
          `is in ${count} divisions`,
          club.id,
        ),
      );
    }
  }

  // --- Division sizes -------------------------------------------------------
  const sizes = snapshot.tierSizes.join('/');
  if (sizes !== baseline.tierSizes.join('/')) {
    out.push(
      violation(
        snapshot,
        'fail',
        'tier-sizes-constant',
        `divisions hold ${sizes} clubs, against ${baseline.tierSizes.join('/')} in season 1`,
      ),
    );
  }

  // --- Movement balances ----------------------------------------------------
  if (snapshot.promoted !== snapshot.relegated) {
    out.push(
      violation(
        snapshot,
        'fail',
        'promotion-balance',
        `${snapshot.promoted} promoted and ${snapshot.relegated} relegated`,
      ),
    );
  }
  // Every boundary in the county, each counted on its own ladder and paid at that
  // ladder's own rate: six divisions are not five boundaries when they are two
  // ladders of three, and the district's places are the district's.
  let boundaries = 0;
  let expected = 0;
  for (const pyramid of pyramidsOf(state)) {
    const rungs = divisionsOf(state, pyramid.id).length;
    if (rungs < 2) continue;
    boundaries += rungs - 1;
    expected += (rungs - 1) * (pyramid.config.promotionPlaces || 0);
  }
  if (boundaries > 0) {
    if (snapshot.promoted !== expected) {
      out.push(
        violation(
          snapshot,
          'fail',
          'promotion-balance',
          `${snapshot.promoted} promoted, expected ${expected} across ${boundaries} boundaries`,
        ),
      );
    }
  }

  // --- Honours --------------------------------------------------------------
  // One champion a season per division and one winner a season per cup. A
  // missing archive shows up here as a shortfall; a double archive shows up as a
  // count that is one too high, which a count alone cannot tell apart from the
  // shortfall in the other direction.
  // `baseline` is the end-of-season-1 snapshot, so it already carries season one's
  // honours. Every season after that adds one champion a division and one winner
  // a cup.
  const perSeason = snapshot.tierSizes.length + cupCompetitions(state).length;
  const expectedHonours = baseline.honoursTotal + perSeason * (snapshot.season - 1);
  if (snapshot.honoursTotal !== expectedHonours) {
    out.push(
      violation(
        snapshot,
        'fail',
        'honours-awarded-once',
        `${snapshot.honoursTotal} honours, expected ${expectedHonours} after ${snapshot.season - 1} further season(s) at ${perSeason} a season`,
      ),
    );
  }
  // Only honours the game itself awarded are checked: every club starts with a
  // randomly drawn pre-game honour from a short list, and two of those colliding
  // says nothing about the pyramid. A season label the game has actually played
  // is what makes an honour the game's own business.
  const playedLabels = new Set<string>();
  for (const club of Object.values(state.clubs)) {
    for (const record of club.history.seasons) playedLabels.add(record.seasonLabel);
  }
  const seen = new Map<string, string>();
  for (const club of Object.values(state.clubs)) {
    for (const honour of club.history.honours) {
      if (![...playedLabels].some((label) => honour.startsWith(label))) continue;
      const other = seen.get(honour);
      if (other && other !== club.id) {
        out.push(
          violation(
            snapshot,
            'fail',
            'honours-not-duplicated',
            `"${honour}" is on both ${other} and ${club.id}`,
            club.id,
          ),
        );
      }
      seen.set(honour, club.id);
    }
  }

  // --- Cups -----------------------------------------------------------------
  for (const cup of cupCompetitions(state)) {
    const round = cup.cup?.round ?? 0;
    const ties = Object.values(state.matches).filter(
      (match) => match.competitionId === cup.id && match.played,
    );
    // Every club still in the cup must have played this round, and no club may
    // have played a round it was knocked out of.
    const survivors = new Set(cup.clubIds);
    const everPlayed = new Set(ties.flatMap((match) => [match.homeClubId, match.awayClubId]));
    if (round > 1 && everPlayed.size === 0 && !cup.cup?.complete) {
      out.push(
        violation(snapshot, 'fail', 'cup-bracket-complete', `${cup.name} round ${round} has no ties`, cup.id),
      );
    }
    for (const clubId of survivors) {
      if (!state.clubs[clubId]) {
        out.push(violation(snapshot, 'fail', 'cup-bracket-complete', `${clubId} has left the world`, cup.id));
      }
    }
  }

  return out;
}

/**
 * Nobody plays twice in a day.
 *
 * Cheap to check and the classic failure of a multi-competition calendar: a cup
 * round that lands on a league Sunday, or a rearranged fixture that is put back
 * on a date the club is already booked for, and a club is quietly fielding two
 * sides in a week.
 */
function checkDoubleBookings(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const byDate = new Map<string, Set<string>>();
  for (const match of Object.values(state.matches)) {
    if (match.status === 'abandoned') continue;
    const clubs = byDate.get(match.date) ?? new Set<string>();
    for (const clubId of [match.homeClubId, match.awayClubId]) {
      if (clubs.has(clubId)) {
        out.push(
          violation(
            snapshot,
            'fail',
            'no-club-plays-twice-in-a-day',
            `${clubId} is in two fixtures on ${match.date} (${match.id})`,
            clubId,
          ),
        );
      }
      clubs.add(clubId);
    }
    byDate.set(match.date, clubs);
  }
  return out;
}

/**
 * Every cup that began the season reaches a winner.
 *
 * Read at the close of a season, which is what "by the end of the season" means
 * and where the soak does its reading. A cup that was never drawn is not stuck —
 * the Plate exists from the moment the season is built and is drawn only when the
 * main cup has knocked out the clubs that feed it — so the two cases are told
 * apart here rather than being counted together.
 *
 * Three things are wrong, and they are different failures:
 *
 *  - **superficially complete.** A bracket marked finished that crowns nobody is
 *    worse than one that plainly ran out: every screen that reads a winner has a
 *    null to deal with, and the honours list is short by a trophy nobody was told
 *    was missing.
 *  - **ran out.** A cup that drew a round and never reached a final leaves a
 *    competition that cannot be won, which is the failure a silently dropped cup
 *    slot produces.
 *  - **a round that was never drawn.** A cup can be closed up by the round
 *    arithmetic — no round left to play — while a round of its own plan has no
 *    ties at all. That is a final that was never played, and the "winner" of it
 *    is whoever happened to be left standing.
 */
function checkCupDecided(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  for (const cup of cupCompetitions(state)) {
    const cupState = cup.cup;
    if (!cupState) continue;

    const roundsDrawn = new Set<number>();
    let anyTie = false;
    for (const match of Object.values(state.matches)) {
      if (match.competitionId !== cup.id) continue;
      anyTie = true;
      if (typeof match.cupRound === 'number') roundsDrawn.add(match.cupRound);
    }

    // A competition whose draw has never been made has not started. The Plate is
    // in that state for most of the season: it is built with no clubs and is
    // drawn from the main cup's losers when they are known.
    const began = anyTie || cupState.round > 1 || cupState.complete || cup.clubIds.length > 0;
    if (!began) continue;

    const winner = cupState.winnerClubId;
    if (cupState.complete && !winner) {
      out.push(violation(snapshot, 'fail', 'cup-decided', 'is marked complete but crowns nobody', cup.id));
      continue;
    }
    if (winner && !state.clubs[winner]) {
      out.push(
        violation(snapshot, 'fail', 'cup-decided', `crowns ${winner}, which is not in the world`, cup.id),
      );
      continue;
    }
    if (!cupState.complete || !winner) {
      out.push(
        violation(
          snapshot,
          'fail',
          'cup-decided',
          `began the season but reached no winner: round ${cupState.round}, ${cup.clubIds.length} club(s) still in, ${roundsDrawn.size} round(s) drawn`,
          cup.id,
        ),
      );
      continue;
    }
    for (const entry of cupState.plan ?? []) {
      if (roundsDrawn.has(entry.round)) continue;
      out.push(
        violation(
          snapshot,
          'fail',
          'cup-decided',
          `crowns ${winner} but round ${entry.round} of its plan was never drawn`,
          cup.id,
        ),
      );
    }
  }
  return out;
}

/** A date a fixture could actually be played on. */
function usableDate(value: unknown): value is ISODate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Every cup tie that is still to be played has a date it can be played on, and
 * every drawn round has a slot in the calendar.
 *
 * The two failures are one failure seen twice. A round whose slot the calendar
 * dropped can never be drawn, and a tie whose date never made it onto the
 * fixture is a fixture nothing will pick up — either way the competition stops
 * with ties outstanding and no winner, and the season will not close.
 *
 * What is *not* a failure is a record of something that already happened: a tie
 * that was played, one that was called off and abandoned, and the original of a
 * fixture that has been rearranged all keep the date they were due, and none of
 * them is waiting to be played. Only the one live record of a tie is read, and
 * it is read against the same bounds the game itself uses: inside the season, and
 * no later than the rearrangement deadline.
 */
function checkCupDates(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const calendarDates = new Set(state.season.calendar.map((entry) => entry.date));
  const knownMatchdays = new Set(state.season.calendar.map((entry) => entry.matchday));
  const seasonStart = state.season.calendar[0]?.date ?? state.season.startDate;
  const deadline = rearrangementDeadlineFor(state);

  for (const cup of cupCompetitions(state)) {
    if (!cup.cup) continue;
    // Every round drawn so far, including the one in hand: a round that has been
    // drawn is a round whose ties somebody is waiting to play.
    for (let round = 1; round <= cup.cup.round; round += 1) {
      const matchday = cupRoundMatchday(state, cup, round);
      const ties = tiesOnMatchday(state, cup, matchday);
      if (ties.length === 0) continue;

      // The round is numbered on a matchday, and that matchday has to be a day
      // the calendar actually has. A round numbered on a day the season does not
      // contain is the slot that was lost when the season was built.
      if (!knownMatchdays.has(matchday)) {
        out.push(
          violation(
            snapshot,
            'fail',
            'cup-round-has-date',
            `round ${round} is numbered on matchday ${matchday}, which is not in the season calendar`,
            cup.id,
          ),
        );
      }

      for (const tie of ties) {
        // Everything that has already happened is history: played, called off for
        // good, or replaced by the rearranged game that is now the live record of
        // this tie. Only a fixture still to be played needs a date still to come.
        if (tie.played || tie.status === 'abandoned' || tie.replacedByMatchId) continue;
        if (!usableDate(tie.date)) {
          out.push(
            violation(
              snapshot,
              'fail',
              'cup-round-has-date',
              `round ${round}'s tie ${tie.id} has no usable date ("${String(tie.date)}")`,
              tie.id,
            ),
          );
        } else if (tie.date < seasonStart) {
          out.push(
            violation(
              snapshot,
              'fail',
              'cup-round-has-date',
              `round ${round}'s tie ${tie.id} is dated ${tie.date}, before the season began on ${seasonStart}`,
              tie.id,
            ),
          );
        } else if (tie.date > deadline) {
          out.push(
            violation(
              snapshot,
              'fail',
              'cup-round-has-date',
              `round ${round}'s tie ${tie.id} is dated ${tie.date}, past the rearrangement deadline of ${deadline}`,
              tie.id,
            ),
          );
        }
      }
    }
  }

  // A calendar date nobody plays on is a slot that was handed out and then lost.
  for (const date of calendarDates) {
    if (!usableDate(date)) {
      out.push(violation(snapshot, 'fail', 'cup-round-has-date', `the calendar holds the date "${String(date)}"`, 'calendar'));
    }
  }
  return out;
}

/**
 * Every fixture is in a competition, and every competition's list is the truth
 * about its own fixtures.
 *
 * The fixture list is what the day loop walks — `fixtureIdsOnMatchday` reads it
 * to know what to prepare, play and settle — and `state.matches` is what the
 * world is made of. A match in one and not the other is a fixture that is either
 * never going to be played (in the world, not on the list) or a fixture that
 * cannot be played at all (on the list, not in the world), and both survive a
 * single season's tests and fail a decade's.
 *
 * A postponed tie is two records of one tie on purpose — the original, off, and
 * the rearranged game — and both are on the list under the same matchday number,
 * so nothing here treats that as a duplicate. Friendlies are the one competition
 * the world deliberately does not carry, which is why they are skipped by name
 * rather than being called an orphan.
 */
function checkFixtureRegistration(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const push = (detail: string, subject: string): void => {
    out.push(violation(snapshot, 'fail', 'every-fixture-in-a-competition', detail, subject));
  };

  for (const match of Object.values(state.matches)) {
    if (match.competitionId === FRIENDLY_COMPETITION_ID) continue;
    if (!state.competitions[match.competitionId]) {
      push(`is in ${match.competitionId}, which is not a competition in the world`, match.id);
    }
  }

  const registeredTo = new Map<string, string>();
  for (const [competitionId, list] of Object.entries(state.fixtures ?? {})) {
    if (list.competitionId !== competitionId) {
      push(`the fixture list filed under ${competitionId} says it is ${list.competitionId}`, competitionId);
    }
    for (const [matchId, matchday] of Object.entries(list.matchdayOf)) {
      const match = state.matches[matchId];
      if (!match) {
        push(`the ${competitionId} fixture list names ${matchId}, which is not a match`, matchId);
        continue;
      }
      if (match.competitionId !== competitionId) {
        push(`is registered to ${competitionId} but belongs to ${match.competitionId}`, matchId);
      }
      if (match.matchday !== matchday) {
        push(`is filed under matchday ${matchday} of ${competitionId} but is played on matchday ${match.matchday}`, matchId);
      }
      if (!(list.byMatchday[matchday] ?? []).includes(matchId)) {
        push(`is in the ${competitionId} list but not in its matchday ${matchday} bucket`, matchId);
      }
      const other = registeredTo.get(matchId);
      if (other && other !== competitionId) {
        push(`is registered to two competitions, ${other} and ${competitionId}`, matchId);
      }
      registeredTo.set(matchId, competitionId);
    }
    for (const [matchday, ids] of Object.entries(list.byMatchday)) {
      for (const id of ids) {
        if (list.matchdayOf[id] !== Number(matchday)) {
          push(`is in the matchday ${matchday} bucket of ${competitionId} but filed under matchday ${list.matchdayOf[id] ?? 'nothing'}`, id);
        }
      }
    }
  }

  for (const match of Object.values(state.matches)) {
    if (match.competitionId === FRIENDLY_COMPETITION_ID) continue;
    if (!registeredTo.has(match.id)) {
      push(`is in the world but on no competition's fixture list (${match.competitionId})`, match.id);
    }
  }
  return out;
}

/**
 * The invariants the calendar and competition checks own, by name.
 *
 * Named here so the soak's own report can list them whether or not they fired: a
 * run that says nothing about them should be a run that checked them and found
 * them clean, not one that never ran them at all.
 */
export const CALENDAR_INVARIANTS = [
  'cup-decided',
  'cup-round-has-date',
  'every-fixture-in-a-competition',
] as const;

/** The calendar and competition checks together, over one world. */
export function checkCalendarIntegrity(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  return [
    ...checkCupDecided(state, snapshot),
    ...checkCupDates(state, snapshot),
    ...checkFixtureRegistration(state, snapshot),
  ];
}

/**
 * A snapshot of the world as it stands, for a caller that has one of its own.
 *
 * `runSoak` takes this at every season's close; a test that has built a world by
 * hand and wants to read it with the same invariants takes it whenever it likes.
 * The season number and the clock readings are the caller's to supply, and are
 * only labels: nothing below them is measured.
 */
export function seasonSnapshot(state: GameState, season = 1): SoakSnapshot {
  return snapshotSeason(state, season, 0, 0, 0);
}

/**
 * The ladder stays stratified.
 *
 * Two readings, and they pull in opposite directions on purpose: each tier must
 * hold its own season-one standard (so nothing inflates or collapses anywhere),
 * *and* the top must stay ahead of the one below it (so the pyramid is still a
 * pyramid rather than thirty-six clubs of the same sort of football).
 */
function checkTierStratification(state: GameState, snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const now = snapshot.tierAbility;
  const then = baseline.tierAbility;

  for (let tier = 0; tier < Math.min(now.length, then.length); tier += 1) {
    const current = now[tier] ?? 0;
    const start = then[tier] ?? 0;
    if (start === 0) continue;
    const drift = (current - start) / start;
    if (Math.abs(drift) > SOAK_BANDS.tierAbilityTolerance) {
      out.push(
        violation(
          snapshot,
          'fail',
          'tier-ability-stable',
          `division ${tier + 1} is at ${current}, against ${start} in season 1 (${(drift * 100).toFixed(1)}%, band ±${SOAK_BANDS.tierAbilityTolerance * 100}%)`,
        ),
      );
    }
  }

  // Rungs are read inside one ladder at a time. A ladder's bottom rung is not
  // below another ladder's top one: a district next door plays at a level beneath
  // the county, and its own Division One is still the top of its own ladder, so
  // the pairings are the county's rungs against each other and then the
  // district's. (Where two ladders' *levels* meet is a Stage 4 question about
  // movement between them, not a promise the world generator makes.)
  let offset = 0;
  for (const pyramid of pyramidsOf(state)) {
    const rungs = divisionsOf(state, pyramid.id).length;
    for (let tier = offset; tier + 1 < offset + rungs; tier += 1) {
      const top = now[tier] ?? 0;
      const bottom = now[tier + 1] ?? 0;
      if (top === 0) continue;
      if (top - bottom >= SOAK_BANDS.tierSeparation * top) continue;
      out.push(
        violation(
          snapshot,
          'fail',
          'tier-stratification',
          `${pyramid.id} division ${tier - offset + 1} (${top}) is not clearly ahead of division ${tier - offset + 2} (${bottom})`,
        ),
      );
    }
    offset += rungs;
  }
  return out;
}

/** Drift, measured against the world as it was generated. */
function checkDrift(snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const relative = (now: number, then: number): number => (then === 0 ? 0 : (now - then) / then);

  const abilityDrift = relative(snapshot.abilityMean, baseline.abilityMean);
  if (Math.abs(abilityDrift) > SOAK_BANDS.abilityTolerance) {
    out.push(
      violation(
        snapshot,
        'fail',
        'ability-stable',
        `${snapshot.abilityMean} against ${baseline.abilityMean} in season 1 (${(abilityDrift * 100).toFixed(1)}%, band ±${SOAK_BANDS.abilityTolerance * 100}%)`,
      ),
    );
  }

  const goalDrift = relative(snapshot.goalsPerMatch, baseline.goalsPerMatch);
  if (Math.abs(goalDrift) > SOAK_BANDS.goalsTolerance) {
    out.push(
      violation(
        snapshot,
        'fail',
        'goals-stable',
        `${snapshot.goalsPerMatch} a match against ${baseline.goalsPerMatch} in season 1 (${(goalDrift * 100).toFixed(1)}%, band ±${SOAK_BANDS.goalsTolerance * 100}%)`,
      ),
    );
  }

  const poolDrift = relative(snapshot.unattached, baseline.unattached);
  if (snapshot.unattached === 0 || Math.abs(poolDrift) > SOAK_BANDS.poolTolerance) {
    out.push(
      violation(
        snapshot,
        'fail',
        'unattached-pool-holds',
        `${snapshot.unattached} unattached against ${baseline.unattached} in season 1 (${(poolDrift * 100).toFixed(1)}%, band ±${SOAK_BANDS.poolTolerance * 100}%)`,
      ),
    );
  }
  return out;
}

function checkAges(state: GameState, snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  for (const [key, now, then, tolerance] of [
    ['p10', snapshot.ageP10, baseline.ageP10, SOAK_BANDS.ageP10Tolerance],
    ['p50', snapshot.ageP50, baseline.ageP50, SOAK_BANDS.ageTolerance],
    ['p90', snapshot.ageP90, baseline.ageP90, SOAK_BANDS.ageTolerance],
  ] as const) {
    if (Math.abs(now - then) > tolerance) {
      out.push(
        violation(
          snapshot,
          'fail',
          'age-distribution-stable',
          `${key} is ${now}, against ${then} in season 1 (band ±${tolerance} years)`,
        ),
      );
    }
  }
  for (const player of playersOf(state)) {
    if (player.clubId && player.age > SOAK_BANDS.maxAge) {
      out.push(violation(snapshot, 'fail', 'nobody-plays-forever', `age ${player.age} and still registered`, player.id));
    }
  }
  return out;
}

/**
 * Ids point at things, and things point back.
 *
 * A dangling reference is the classic long-run failure: it survives every
 * single-season test, and the first thing that reads it — a table, a team sheet,
 * the archive — throws a decade into somebody's career.
 */
function checkReferences(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const push = (invariant: string, detail: string, subject: string): void => {
    out.push(violation(snapshot, 'fail', invariant, detail, subject));
  };

  for (const [id, person] of Object.entries(state.people)) {
    if (person.kind !== 'player') continue;
    if (person.clubId === null) continue;
    const club = state.clubs[person.clubId];
    if (!club) push('player-club-exists', `points at missing club ${person.clubId}`, id);
    else if (!club.squadIds.includes(id)) push('club-lists-player', `not in ${club.id}'s squad list`, id);
  }

  for (const club of Object.values(state.clubs)) {
    if (!club.active) continue;
    const seen = new Set<string>();
    for (const id of club.squadIds) {
      if (seen.has(id)) push('squad-ids-unique', `${id} appears twice`, club.id);
      seen.add(id);
      const person = state.people[id];
      if (!person) push('squad-player-exists', `${id} is in the squad but not in the world`, club.id);
      else if (person.kind === 'player' && person.clubId !== club.id) {
        push('squad-player-agrees', `${id} is in the squad but belongs to ${person.clubId ?? 'nobody'}`, club.id);
      }
    }
    for (const field of ['managerId', 'chairmanId'] as const) {
      const id = club[field];
      if (id && !state.people[id]) push('club-official-exists', `${field} ${id} is missing`, club.id);
    }
    // The committee: every slot the club claims must name somebody who is still
    // in the world.
    const staffIds = [
      club.staff?.assistantId,
      club.staff?.physioId,
      club.staff?.secretaryId,
      club.staff?.treasurerId,
      ...(club.staff?.coachIds ?? []),
      ...(club.staff?.scoutIds ?? []),
      ...(club.staff?.volunteerIds ?? []),
    ];
    for (const id of staffIds) {
      if (id && !state.people[id]) push('club-staff-exists', `staff ${id} is missing`, club.id);
    }
    if (!state.world.grounds[club.groundId]) push('club-ground-exists', `ground ${club.groundId} is missing`, club.id);
  }

  for (const match of Object.values(state.matches)) {
    if (!state.clubs[match.homeClubId]) push('fixture-home-exists', `home ${match.homeClubId} is missing`, match.id);
    if (!state.clubs[match.awayClubId]) push('fixture-away-exists', `away ${match.awayClubId} is missing`, match.id);
    if (!state.world.grounds[match.groundId]) push('fixture-ground-exists', `ground ${match.groundId} is missing`, match.id);
    if (match.refereeId && !state.people[match.refereeId]) {
      push('fixture-referee-exists', `referee ${match.refereeId} is missing`, match.id);
    }
    for (const performance of Object.values(match.performances)) {
      if (!state.people[performance.playerId]) {
        push('performance-player-exists', `performance for missing ${performance.playerId}`, match.id);
      }
      if (!state.clubs[performance.clubId]) {
        push('performance-club-exists', `performance for missing club ${performance.clubId}`, match.id);
      }
    }
    for (const side of ['home', 'away'] as const) {
      for (const slot of match.lineups[side].starting) {
        if (!state.people[slot.playerId]) push('lineup-player-exists', `${side} XI has missing ${slot.playerId}`, match.id);
      }
    }
  }

  const order = state.matchOrder;
  if (new Set(order).size !== order.length) push('match-order-unique', 'the season order repeats a fixture', 'matchOrder');
  for (const id of order) if (!state.matches[id]) push('match-order-exists', `${id} is not in the world`, 'matchOrder');

  for (const relationship of Object.values(state.relationships?.byId ?? {})) {
    if (!state.people[relationship.personAId] || !state.people[relationship.personBId]) {
      // A warning, not a failure, because the game already tolerates this: the
      // save loader rebuilds the index and quietly drops links to people who
      // have gone. It is still worth reporting — the drop means a running career
      // and a reloaded one are not the same social world — but it is a known
      // design gap (departed free agents are deleted without cleaning their
      // relationships) rather than a crash waiting to happen.
      out.push(
        violation(
          snapshot,
          'warn',
          'relationship-outlives-person',
          `${relationship.id} points at somebody who has left the world; the save loader will prune it on the next load`,
          relationship.id,
        ),
      );
    }
  }

  for (const personId of Object.keys(state.recruitment?.candidates ?? {})) {
    if (!state.people[personId]) push('candidate-exists', `candidate ${personId} has gone`, personId);
  }

  return out;
}

/**
 * The world's own continuity: clubs that fold, clubs that come back, and the
 * record of the ones the manager has been in charge of.
 *
 * The lifecycle deliberately keeps a folded club in `state.clubs` as archive —
 * inactive, out of the ladder, with its seasons and honours still on it — and
 * mints a replacement that names it in `heritage`. That is a handful of links
 * across the years, and none of them is visible to a single-season test:
 *
 *  - **the archive stays addressable.** A club's heritage names the club it
 *    succeeded, and that club is still in the world — inactive, and never
 *    playing. History pointing at nothing is history that was deleted by
 *    accident.
 *  - **one predecessor, one successor.** A club folds once and one club forms in
 *    its place, so two clubs naming the same predecessor means a boundary was
 *    processed twice and minted a duplicate: a second club in the same town, on
 *    the same ground, in the same division.
 *  - **a folded club is off the ladder.** It keeps its record and loses its
 *    place. An inactive club still listed in a division is a fixture waiting to
 *    be scheduled for a club that no longer exists.
 *  - **administration is a countdown, not a state.** A club may be in the red for
 *    the grace period and no longer; one still playing at the end of it is a
 *    fold that never happened.
 *  - **nobody works for a club that has gone.** The fold deletes the committee
 *    and empties the manager's post, so an official still pointing at an
 *    inactive club is a fold that left somebody behind.
 *  - **his career record only grows.** The spells are the answer to "what has he
 *    done", and a season that shortens that list has lost a piece of a career
 *    rather than ended one. While he is between jobs there is no club he
 *    manages, and while he is in work the club he manages is the one the world
 *    says he is at.
 */
function checkLifecycle(state: GameState, snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];

  // --- Heritage: the link from a club to the one it came out of ----------------
  const claimants = new Map<string, string[]>();
  for (const club of Object.values(state.clubs)) {
    const heritage = club.heritage;
    if (!heritage) continue;
    claimants.set(heritage.predecessorId, [...(claimants.get(heritage.predecessorId) ?? []), club.id]);
    const predecessor = state.clubs[heritage.predecessorId];
    if (!predecessor) {
      out.push(
        violation(
          snapshot,
          'fail',
          'heritage-predecessor-exists',
          `names ${heritage.predecessorId}, which is not in the world`,
          club.id,
        ),
      );
    } else if (predecessor.active) {
      out.push(
        violation(
          snapshot,
          'fail',
          'heritage-predecessor-exists',
          `names ${heritage.predecessorId}, which is still playing`,
          club.id,
        ),
      );
    }
  }
  for (const [predecessorId, clubIds] of claimants) {
    if (clubIds.length > 1) {
      out.push(
        violation(
          snapshot,
          'fail',
          'heritage-one-successor',
          `${clubIds.length} clubs name ${predecessorId} as what they came from (${clubIds.join(', ')})`,
          predecessorId,
        ),
      );
    }
  }

  // --- The ladder: where a folded club is, and where it is not ----------------
  const listed = new Set<string>(leagueCompetitions(state).flatMap((competition) => competition.clubIds));
  for (const club of Object.values(state.clubs)) {
    if (!club.active) {
      if (listed.has(club.id)) {
        out.push(
          violation(snapshot, 'fail', 'folded-stands-aside', 'has folded but is still in a division', club.id),
        );
      }
      continue;
    }
    const admin = club.finances.administrationSeasons ?? 0;
    if (admin >= CLUB_LIFECYCLE.graceSeasons) {
      out.push(
        violation(
          snapshot,
          'fail',
          'administration-bounded',
          `${admin} seasons in the red and still playing, past the ${CLUB_LIFECYCLE.graceSeasons}-season grace`,
          club.id,
        ),
      );
    }
  }

  // --- Employment: the club a man is at has to be one that is playing ----------
  for (const person of Object.values(state.people)) {
    if (!isOfficial(person) || !person.clubId) continue;
    const club = state.clubs[person.clubId];
    if (!club) {
      out.push(
        violation(snapshot, 'fail', 'employer-exists', `is at ${person.clubId}, which is not in the world`, person.id),
      );
    } else if (!club.active) {
      out.push(
        violation(
          snapshot,
          'fail',
          'employer-still-playing',
          `is still at ${club.identity.name}, which has folded`,
          person.id,
        ),
      );
    }
  }

  // --- The manager's own record, which is the career's whole memory -----------
  const career = state.career;
  if (career) {
    if (career.spells.length < baseline.careerSpells) {
      out.push(
        violation(
          snapshot,
          'fail',
          'career-record-keeps',
          `${career.spells.length} spells against ${baseline.careerSpells} after his first season`,
          MANAGER_PERSON_ID,
        ),
      );
    }
    for (const spell of career.spells) {
      if (!state.clubs[spell.clubId]) {
        out.push(
          violation(
            snapshot,
            'fail',
            'career-spells-exist',
            `names a spell at ${spell.clubId}, which is not in the world`,
            MANAGER_PERSON_ID,
          ),
        );
      }
    }
    const manager = state.people[MANAGER_PERSON_ID];
    if (career.status === 'unemployed') {
      if (career.clubId !== null) {
        out.push(
          violation(
            snapshot,
            'fail',
            'unemployed-has-no-club',
            `is out of work and still in charge of ${career.clubId}`,
            MANAGER_PERSON_ID,
          ),
        );
      }
      if (manager?.clubId) {
        out.push(
          violation(
            snapshot,
            'fail',
            'unemployed-has-no-club',
            `is out of work and still on ${manager.clubId}'s staff`,
            MANAGER_PERSON_ID,
          ),
        );
      }
    } else if (manager && manager.clubId !== null && career.clubId !== manager.clubId) {
      out.push(
        violation(
          snapshot,
          'fail',
          'employment-agrees',
          `the career says ${career.clubId ?? 'nobody'} and the world says ${manager.clubId}`,
          MANAGER_PERSON_ID,
        ),
      );
    }
  }

  return out;
}

/** The archive is written once, and a save is the same game twice. */
function checkBookkeeping(state: GameState, snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];

  for (const club of Object.values(state.clubs)) {
    // A folded club played no season, so it archives nothing and keeps nothing.
    if (!club.active) continue;
    const ids = club.history.seasons.map((record) => record.seasonId);
    if (new Set(ids).size !== ids.length) {
      out.push(violation(snapshot, 'fail', 'season-archived-once', 'the same season is archived twice', club.id));
    }
    if (ids.includes(state.season.id) === false) {
      out.push(violation(snapshot, 'fail', 'season-archived', `${state.season.id} was never archived`, club.id));
    }
    if (club.finances.ledger.length > 400) {
      out.push(violation(snapshot, 'fail', 'ledger-bounded', `${club.finances.ledger.length} ledger lines`, club.id));
    }
  }

  // The honours count and the pyramid's own checks live in `checkPyramid`,
  // which knows how many competitions there are.

  // Folding is only survivable because a new club takes the place: the point of
  // the whole cycle is that the division keeps its size however long it runs.
  if (snapshot.divisionSize !== baseline.divisionSize) {
    out.push(
      violation(
        snapshot,
        'fail',
        'division-size-stable',
        `the ladder has ${snapshot.divisionSize} clubs against ${baseline.divisionSize}`,
      ),
    );
  }

  if (state.news.length > 300) {
    out.push(violation(snapshot, 'fail', 'news-bounded', `${state.news.length} news items`, null));
  }
  if (state.standingHistory.length > SOAK_BANDS.standingHistoryMax) {
    out.push(
      violation(snapshot, 'fail', 'standing-history-bounded', `${state.standingHistory.length} snapshots`, null),
    );
  }
  // The subs book is a season's book. Every settled matchday charge and every
  // payment from a season that has closed is folded away at the boundary, and
  // every debt is kept; keeping the settled ones for ever was the whole of the
  // growth `state-bounded` found, 13,000–17,000 KB a season of matchday
  // bookkeeping that nothing in the game reads. A settled charge or a payment
  // dated before the season being played means the boundary — or the loader that
  // applies the same rule — has stopped folding them. See `pruneSubsHistory`.
  let staleCharges = 0;
  let stalePayments = 0;
  for (const person of Object.values(state.people)) {
    if (person.kind !== 'player') continue;
    const subs = person.subs;
    if (!subs) continue;
    for (const liability of subs.liabilities ?? []) {
      if (liability.date < state.season.startDate && liability.paid >= liability.amount) staleCharges += 1;
    }
    for (const payment of subs.payments ?? []) {
      if (payment.date < state.season.startDate) stalePayments += 1;
    }
  }
  if (staleCharges > 0 || stalePayments > 0) {
    out.push(
      violation(
        snapshot,
        'fail',
        'subs-book-closed',
        `${staleCharges} settled matchday charge(s) and ${stalePayments} payment(s) from before ${state.season.startDate} are still in the books`,
      ),
    );
  }

  // The season archive grows by exactly one season a year and is capped, so a
  // career that has played a hundred seasons carries twelve of them.
  const seasons = seasonHistoryOf(state).length;
  if (seasons > SOAK_BANDS.seasonHistoryMax) {
    out.push(violation(snapshot, 'fail', 'season-history-bounded', `${seasons} seasons archived`, null));
  }
  return out;
}

/**
 * The relationships the world can still address: links where both people exist.
 *
 * The save loader rebuilds the relationship index and, in doing so, drops links
 * to people who have gone. That means a round trip is *not* the identity for a
 * state carrying a dangling link — the loader repairs it. Comparing the repaired
 * views on both sides keeps `save-round-trips` about actual data loss, while the
 * repair itself is reported once, as `relationship-outlives-person`.
 */
function liveRelationshipStore(state: GameState): GameState['relationships'] {
  const store = state.relationships;
  if (!store?.byId) return store;
  const byId: GameState['relationships']['byId'] = {};
  for (const [id, relationship] of Object.entries(store.byId)) {
    if (state.people[relationship.personAId] && state.people[relationship.personBId]) byId[id] = relationship;
  }
  const byPerson: GameState['relationships']['byPerson'] = {};
  for (const [personId, ids] of Object.entries(store.byPerson ?? {})) {
    if (!state.people[personId]) continue;
    const live = ids.filter((id) => byId[id]);
    if (live.length > 0) byPerson[personId] = live;
  }
  return { ...store, byId, byPerson };
}

/** A save has to be the same game, and an old save has to become one. */
function checkSave(state: GameState, snapshot: SoakSnapshot): SoakViolation[] {
  const out: SoakViolation[] = [];
  const restored = deserialiseGame(serialiseGame(state));
  if (restored.error || !restored.state) {
    out.push(violation(snapshot, 'fail', 'save-round-trips', restored.error ?? 'no state came back'));
    return out;
  }
  const difference = firstDifference(
    { ...state, relationships: liveRelationshipStore(state) },
    { ...restored.state, relationships: liveRelationshipStore(restored.state) },
    '',
  );
  if (difference) {
    out.push(violation(snapshot, 'fail', 'save-round-trips', `round trip changed the game at ${difference}`));
  }
  return out;
}

/**
 * The size of the save, held to its budget at the close of a season.
 *
 * It is the one reading of a career that nothing else bounds. News is capped at
 * 300, the standings history at 140, the season archive at `SEASON_HISTORY_LIMIT`,
 * a squad at 26 and a ledger at 400 lines — and the state as a whole has never
 * had a ceiling at all. So the way a save grows without bound is a season that
 * keeps one record per fixture, a world that gains a district, or a retention
 * change that holds two seasons of matches at once: all of them quiet, all of
 * them invisible until a career is years old and somebody's phone will not carry
 * it, and all of them growth the world's own invariants are happy with, because a
 * bigger save is a perfectly healthy game.
 *
 * The reading is `stateSizeBytes(state)` — the benchmark's own measurement, in
 * the benchmark's own units — taken at the close of a season, which is where the
 * state peaks: the roll-over at the boundary rebuilds `state.matches`, and the
 * days between two closes only add to it. It is deliberately not read on a fresh
 * career, where the season's football is still absent and the number is a tenth
 * of what it becomes.
 *
 * The comparison is inclusive: a state exactly at the budget holds, because the
 * budget is a ceiling rather than a target. Over it is a `fail`, and the failure
 * names the measurement, the budget, the world it was measured on and the
 * constant to raise. A soak that warned instead would be a soak that reported a
 * save nobody can carry as a world that held up.
 *
 * `state` is read for the failure's context — where the size is, and what the
 * world is — and never written to; the measurement itself is already in
 * `snapshot.stateBytes`.
 */
export function checkStateBudget(
  state: GameState,
  snapshot: SoakSnapshot,
  budgetBytes: number = SOAK_BANDS.stateBudgetBytes,
): SoakViolation[] {
  if (snapshot.stateBytes <= budgetBytes) return [];
  return [violation(snapshot, 'fail', 'state-bounded', stateBudgetDetail(state, snapshot, budgetBytes))];
}

/**
 * What a state over budget is told: what it measured, what it was allowed, where
 * the size is, and which constant to raise when the growth is wanted.
 */
function stateBudgetDetail(state: GameState, snapshot: SoakSnapshot, budgetBytes: number): string {
  const kb = (bytes: number): string => `${group(Math.round(bytes / 1024))} KB`;
  const plural = (count: number, noun: string): string => `${group(count)} ${noun}${count === 1 ? '' : 's'}`;
  const matches = stateSizeBytes(state.matches);
  const clubs = Object.values(state.clubs).filter((club) => club.active).length;
  const fixtures = Object.keys(state.matches).length;
  const share = Math.round((matches / Math.max(1, snapshot.stateBytes)) * 100);
  const overshoot = snapshot.stateBytes - budgetBytes;
  // Under a kilobyte the difference is said in bytes, because "0 KB past the
  // budget" is a failure nobody can act on.
  const past = overshoot < 1024 ? `${group(overshoot)} byte${overshoot === 1 ? '' : 's'}` : kb(overshoot);
  return (
    `the state serialises to ${kb(snapshot.stateBytes)} (${group(snapshot.stateBytes)} bytes) at the close of ${snapshot.label}, ` +
    `${past} past the ${kb(budgetBytes)} budget — the season's match records are ${kb(matches)} of it (${share}%), ` +
    `and the world is ${plural(pyramidsOf(state).length, 'district')}, ${plural(clubs, 'club')} and ${plural(fixtures, 'fixture')}. ` +
    'The county grows about 3,600 KB a season on average as its subs book is folded at each boundary, so the budget ' +
    'is set for the ten-season run `npm run soak` makes: raise SOAK_BANDS.stateBudgetBytes ' +
    '(src/simulation/soak.ts) when the growth is wanted, or when the run is longer.'
  );
}

/**
 * Where two versions of the same object first disagree.
 *
 * A deep equal that says *where* rather than only *that* is the difference
 * between a bug report and a treasure hunt. A key that is absent on one side and
 * `undefined` on the other is not a difference: JSON cannot carry `undefined`, so
 * demanding it would report the format rather than the game.
 */
export function firstDifference(a: unknown, b: unknown, path: string): string | null {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') {
    return Object.is(a, b) ? null : `${path} (${a} vs ${b})`;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a === undefined && b === null) return null;
    if (b === undefined && a === null) return null;
    return `${path} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path} (array vs object)`;
    if (a.length !== b.length) return `${path}.length (${a.length} vs ${b.length})`;
    for (let index = 0; index < a.length; index += 1) {
      const found = firstDifference(a[index], b[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const found = firstDifference(left[key], right[key], path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Play the world forward, one day at a time, and read it at the end of each
 * season. Nothing is cloned and nothing is rolled back: this is the career a
 * manager would have had, with nobody at the keyboard.
 */
export function runSoak(options: SoakOptions): SoakResult {
  const started = Date.now();
  // The world a career founded today is founded in: the whole county, unless a
  // caller asked for a smaller one. It is the world the state budget is measured
  // against, and the same choice the benchmark makes.
  const districts = options.districts ?? ALDERFORDSHIRE_DISTRICTS.length;
  const stateBudgetBytes = options.stateBudgetBytes ?? SOAK_BANDS.stateBudgetBytes;
  const { state } = createTestGame(options.seed, options.clubIndex ?? 0, 2026, districts);
  // What the game is before a season of football is played into it, so the report
  // can say how much of the state a season's retention is.
  const stateBytesFresh = stateSizeBytes(state);
  const snapshots: SoakSnapshot[] = [];
  const violations: SoakViolation[] = [];
  let baseline: SoakSnapshot | null = null;
  let clock = state.date;

  for (let season = 1; season <= options.seasons; season += 1) {
    const seasonStarted = Date.now();
    let days = 0;
    let noticedDays = 0;
    let newsEvents = 0;

    while (state.phase !== 'complete' && days < SOAK_BANDS.daysPerSeason) {
      // What the real Continue button would have stopped for. Recorded, never
      // obeyed: the soak is here to see the decade, not to be managed.
      if (currentAttention(state)) noticedDays += 1;
      const day = processDay(state, state.date, { resolveUserMatch: true });
      newsEvents += day.news.length;
      days += 1;
    }

    const snapshot = snapshotSeason(state, season, days, (Date.now() - seasonStarted) / 1000, noticedDays);
    snapshot.newsEvents = newsEvents;
    snapshots.push(snapshot);

    if (state.phase !== 'complete') {
      violations.push(
        violation(
          snapshot,
          'fail',
          'season-closes',
          `still in ${state.season.label} after ${days} days (the season should have closed by now)`,
        ),
      );
      // Nothing after this is a season any more: stop rather than measure nonsense.
      break;
    }

    if (!baseline) baseline = snapshot;
    violations.push(...checkNumbers(state, snapshot));
    violations.push(...checkSquads(state, snapshot));
    violations.push(...checkDrift(snapshot, baseline));
    violations.push(...checkAges(state, snapshot, baseline));
    violations.push(...checkReferences(state, snapshot));
    violations.push(...checkBookkeeping(state, snapshot, baseline));
    violations.push(...checkLifecycle(state, snapshot, baseline));
    violations.push(...checkPyramid(state, snapshot, baseline));
    violations.push(...checkDoubleBookings(state, snapshot));
    violations.push(...checkCalendarIntegrity(state, snapshot));
    violations.push(...checkTierStratification(state, snapshot, baseline));
    violations.push(...checkSave(state, snapshot));
    // The save's size, read at the close of the season and held to the budget.
    violations.push(...checkStateBudget(state, snapshot, stateBudgetBytes));
    if (state.date <= clock && season > 1) {
      violations.push(
        violation(snapshot, 'fail', 'clock-never-rewinds', `the season closed on ${state.date}, before it started`),
      );
    }
    // A season is as long as its own calendar: six weeks of pre-season, a
    // fortnightly league spread across the year and the Christmas skip come to
    // a full twelve months, and that is the design, not drift. What is worth a
    // warning is a season that runs past the calendar it was given — which is
    // what a backlog of rearranged fixtures can do, up to the rearrangement
    // deadline the postponement system already imposes.
    const calendarDays = daysBetween(state.season.startDate, state.season.endDate);
    if (days > calendarDays + REARRANGEMENT_GRACE_DAYS) {
      violations.push(
        violation(
          snapshot,
          'warn',
          'season-not-overrunning',
          `${days} days for a season whose calendar is ${calendarDays}, past the rearrangement deadline`,
        ),
      );
    }
    clock = state.date;

    options.onSeason?.(snapshot);

    if (season < options.seasons) {
      const before = state.date;
      publishEvents(state, startNextSeason(state));
      if (state.date < before) {
        violations.push(
          violation(
            snapshots[snapshots.length - 1]!,
            'fail',
            'clock-never-rewinds',
            `the new season starts on ${state.date}, before the old one ended on ${before}`,
          ),
        );
      }
    }
  }

  return {
    seed: options.seed,
    clubId: state.userClubId,
    seasons: options.seasons,
    districts,
    seconds: round((Date.now() - started) / 1000, 1),
    stateBytesFresh,
    // The peak, not the last: the question the budget asks is the largest state a
    // run ever wrote, and a season that shrank the game would not excuse it.
    stateBytesAtSeasonEnd: snapshots.reduce((largest, item) => Math.max(largest, item.stateBytes), 0),
    stateBudgetBytes,
    snapshots,
    violations,
  };
}

/** The first way two runs of the same seed disagree, or null when they agree. */
export function firstSnapshotDifference(a: readonly SoakSnapshot[], b: readonly SoakSnapshot[]): string | null {
  if (a.length !== b.length) return `seasons (${a.length} vs ${b.length})`;
  for (let index = 0; index < a.length; index += 1) {
    const found = firstDifference(a[index], b[index], `season ${index + 1}`);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** The columns of the console table, and how to read each one. */
export interface SoakColumn {
  header: string;
  width: number;
  digits: number;
  pick: (snapshot: SoakSnapshot) => number;
}

export const SOAK_TREND_COLUMNS: SoakColumn[] = [
  { header: 'standing', width: 9, digits: 1, pick: (s) => s.standingMean },
  { header: 'standvar', width: 9, digits: 1, pick: (s) => s.standingSpread },
  { header: 'squad', width: 7, digits: 1, pick: (s) => s.squadMean },
  { header: 'ability', width: 8, digits: 2, pick: (s) => s.abilityMean },
  { header: 'tier1', width: 7, digits: 2, pick: (s) => s.tierAbility[0] ?? 0 },
  { header: 'tier2', width: 7, digits: 2, pick: (s) => s.tierAbility[1] ?? 0 },
  { header: 'tier3', width: 7, digits: 2, pick: (s) => s.tierAbility[2] ?? 0 },
  { header: 'spread', width: 7, digits: 2, pick: (s) => s.abilitySpread },
  { header: 'age', width: 7, digits: 0, pick: (s) => s.ageP50 },
  { header: 'age p90', width: 8, digits: 0, pick: (s) => s.ageP90 },
  { header: 'bank', width: 9, digits: 0, pick: (s) => s.balanceMean },
  { header: 'red', width: 5, digits: 0, pick: (s) => s.clubsInTheRed },
  { header: 'free', width: 6, digits: 0, pick: (s) => s.unattached },
  { header: 'folded', width: 6, digits: 0, pick: (s) => s.foldedClubs },
  { header: 'admin', width: 5, digits: 0, pick: (s) => s.inAdministration },
  { header: 'reformed', width: 8, digits: 0, pick: (s) => s.reformedClubs },
  { header: 'new', width: 4, digits: 0, pick: (s) => s.successorClubs },
  { header: 'career', width: 6, digits: 0, pick: (s) => s.careerClubs },
  { header: 'tier', width: 5, digits: 0, pick: (s) => s.userTier ?? 0 },
  { header: 'up/down', width: 8, digits: 0, pick: (s) => s.promoted * 100 + s.relegated },
  { header: 'cup', width: 5, digits: 0, pick: (s) => s.cupTies },
  { header: 'mgrpool', width: 7, digits: 0, pick: (s) => s.managerPool },
  { header: 'goals', width: 7, digits: 2, pick: (s) => s.goalsPerMatch },
  { header: 'card', width: 6, digits: 0, pick: (s) => s.yellowCards + s.redCards },
  { header: 'hurt', width: 6, digits: 0, pick: (s) => s.injuries },
  { header: 'days', width: 6, digits: 0, pick: (s) => s.days },
  { header: 'post', width: 6, digits: 0, pick: (s) => s.postponements },
];

function pad(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padStart(width);
}

function padEnd(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

/** The trend table: one row a season, so a drift is a lean, not a footnote. */
export function formatTrend(snapshots: readonly SoakSnapshot[]): string {
  const header = [
    padEnd('season', 14),
    pad('pos', 4),
    SOAK_TREND_COLUMNS.map((column) => pad(column.header, column.width)).join(' '),
  ].join(' ');
  const lines = snapshots.map((snapshot) =>
    [
      padEnd(`${snapshot.label}`, 14),
      pad(String(snapshot.userPosition ?? '–'), 4),
      SOAK_TREND_COLUMNS.map((column) => pad(column.pick(snapshot).toFixed(column.digits), column.width)).join(' '),
    ].join(' '),
  );
  return [header, ...lines].join('\n');
}

/**
 * Every violation, worst first, with the season and the club it belongs to.
 *
 * A single long-run defect — a social graph that keeps every departed player, a
 * squad that ages in lockstep — fires on every season, so the raw list runs to
 * thousands of lines and buries the other findings. Each invariant therefore
 * gets a handful of examples and a count of the rest; the totals are in the
 * summary and the full list is in the JSON report.
 */
export function formatViolations(violations: readonly SoakViolation[], examples = 4): string {
  if (violations.length === 0) return '   none — the world held up.';
  const order = { fail: 0, warn: 1 } as const;
  const sorted = [...violations].sort(
    (a, b) => order[a.severity] - order[b.severity] || a.season - b.season || a.invariant.localeCompare(b.invariant),
  );

  const lines: string[] = [];
  const seen = new Map<string, number>();
  for (const item of sorted) {
    const count = seen.get(item.invariant) ?? 0;
    seen.set(item.invariant, count + 1);
    if (count >= examples) continue;
    lines.push(line(item));
    if (count === examples - 1) {
      const remaining = sorted.filter((other) => other.invariant === item.invariant).length - examples;
      if (remaining > 0) lines.push(`   ${' '.repeat(6)}${padEnd(item.invariant, 26)} … and ${remaining} more`);
    }
  }
  return lines.join('\n');
}

function line(item: SoakViolation): string {
  return `   ${item.severity === 'fail' ? 'FAIL' : 'warn'}  ${padEnd(item.invariant, 26)} ${item.seasonLabel}  ${
    item.subject ? `${padEnd(item.subject, 18)} ` : ''
  }${item.detail}`;
}

/** How many of each invariant broke, so a long list can be read at a glance. */
export function summariseViolations(violations: readonly SoakViolation[]): Array<{ invariant: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of violations) counts.set(item.invariant, (counts.get(item.invariant) ?? 0) + 1);
  return [...counts.entries()]
    .map(([invariant, count]) => ({ invariant, count }))
    .sort((a, b) => b.count - a.count || a.invariant.localeCompare(b.invariant));
}
