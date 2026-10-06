import { isOfficial, isPlayer, type Player } from '@/domain/person';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { daysBetween } from './calendar';
import { processDay, currentAttention } from './day';
import { REARRANGEMENT_GRACE_DAYS } from './postponement';
import { startNextSeason } from './season';
import { cupCompetitions, leagueCompetitions, tierOf } from './pyramid';
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
} as const;

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
  postponements: number;
  rearrangements: number;
  abandoned: number;
}

export interface SoakOptions {
  seed: string;
  seasons: number;
  /** Which club in the division the manager takes over. */
  clubIndex?: number;
  /** Called as each season closes, for a progress line. */
  onSeason?: (snapshot: SoakSnapshot) => void;
}

export interface SoakResult {
  seed: string;
  clubId: string;
  seasons: number;
  seconds: number;
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
  const divisions = leagueCompetitions(state);
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
    postponements: Object.values(state.matches).filter((match) => match.postponementReason).length,
    rearrangements: Object.values(state.matches).filter((match) => match.originalDate !== null).length,
    abandoned: Object.values(state.matches).filter((match) => match.status === 'abandoned').length,
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
  const boundaries = Math.max(0, divisions.length - 1);
  if (boundaries > 0) {
    const expected = boundaries * (state.pyramid.promotionPlaces || 0);
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
 * The ladder stays stratified.
 *
 * Two readings, and they pull in opposite directions on purpose: each tier must
 * hold its own season-one standard (so nothing inflates or collapses anywhere),
 * *and* the top must stay ahead of the one below it (so the pyramid is still a
 * pyramid rather than thirty-six clubs of the same sort of football).
 */
function checkTierStratification(snapshot: SoakSnapshot, baseline: SoakSnapshot): SoakViolation[] {
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

  for (let tier = 0; tier + 1 < now.length; tier += 1) {
    const top = now[tier] ?? 0;
    const bottom = now[tier + 1] ?? 0;
    if (top === 0) continue;
    if (top - bottom < SOAK_BANDS.tierSeparation * top) {
      out.push(
        violation(
          snapshot,
          'fail',
          'tier-stratification',
          `division ${tier + 1} (${top}) is not clearly ahead of division ${tier + 2} (${bottom})`,
        ),
      );
    }
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
  const { state } = createTestGame(options.seed, options.clubIndex ?? 0);
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
    violations.push(...checkPyramid(state, snapshot, baseline));
    violations.push(...checkDoubleBookings(state, snapshot));
    violations.push(...checkTierStratification(snapshot, baseline));
    violations.push(...checkSave(state, snapshot));
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
    seconds: round((Date.now() - started) / 1000, 1),
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
