import type { Club, StandingRow } from '@/domain/club';
import type { Competition, FixtureList, PyramidConfig } from '@/domain/competition';
import { DEFAULT_PYRAMID, emptyFixtureList, isCup, isLeague } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { computeStandings } from './league';
import { createEvent } from './news';

/**
 * The local pyramid.
 *
 * A division is not a special kind of competition — it is a competition with a
 * tier, a set of clubs and a table — so most of the work here is not about the
 * ladder itself but about the handful of questions the rest of the simulation
 * used to answer by taking the first competition it could find:
 *
 *   - which division is this club in?
 *   - which division is this club's *next* fixture in?
 *   - whose subs are being collected on Friday?
 *
 * Every one of them is a question about a club, not about a competition, and
 * answering it by club is what lets three divisions share one calendar, one
 * matchday counter and one day loop.
 */

/** The ladder this career was generated with. */
export function pyramidOf(state: GameState): PyramidConfig {
  return state.pyramid ?? DEFAULT_PYRAMID;
}

/** Every competition with a table, in tier order (1 first). */
export function leagueCompetitions(state: GameState): Competition[] {
  return Object.values(state.competitions)
    .filter(isLeague)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

/** Every knockout in the pyramid, in draw order. */
export function cupCompetitions(state: GameState): Competition[] {
  return Object.values(state.competitions)
    .filter(isCup)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A competition by id, or undefined when the world has never heard of it. */
export function competitionOf(state: GameState, competitionId: CompetitionId | null | undefined): Competition | undefined {
  return competitionId ? state.competitions[competitionId] : undefined;
}

/** The division a club is in this season, or undefined if it is in no league. */
export function divisionOf(state: GameState, clubId: ClubId): Competition | undefined {
  return leagueCompetitions(state).find((competition) => competition.clubIds.includes(clubId));
}

/** Which tier a club is in: 1 is the top. Null when it is in no league. */
export function tierOf(state: GameState, clubId: ClubId): number | null {
  return divisionOf(state, clubId)?.tier ?? null;
}

/** The division one tier below (numerically higher) — where a relegated club goes. */
export function divisionBelow(state: GameState, competition: Competition): Competition | undefined {
  return leagueCompetitions(state).find((entry) => entry.tier === competition.tier + 1);
}

/** The division one tier above — where a promoted club goes. */
export function divisionAbove(state: GameState, competition: Competition): Competition | undefined {
  return leagueCompetitions(state).find((entry) => entry.tier === competition.tier - 1);
}

/** Every club playing in any league, de-duplicated and in tier order. */
export function leagueClubIds(state: GameState): ClubId[] {
  const seen = new Set<ClubId>();
  const ids: ClubId[] = [];
  for (const competition of leagueCompetitions(state)) {
    for (const clubId of competition.clubIds) {
      if (seen.has(clubId)) continue;
      seen.add(clubId);
      ids.push(clubId);
    }
  }
  return ids;
}

/** Every club that is playing anything at all this season. */
export function activeClubIds(state: GameState): ClubId[] {
  const ids = new Set<ClubId>(leagueClubIds(state));
  for (const cup of cupCompetitions(state)) for (const clubId of cup.clubIds) ids.add(clubId);
  return [...ids].filter((clubId) => state.clubs[clubId]?.active);
}

/**
 * The competition the manager's own club plays in, and the one every screen
 * should open on when it has not been told otherwise.
 */
export function userCompetition(state: GameState): Competition | undefined {
  return divisionOf(state, state.userClubId) ?? leagueCompetitions(state)[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The fixture list for a competition, created empty if it has none.
 *
 * Every competition in the world has one from the moment it exists — a club that
 * folds and a draw that has not happened yet are both just an empty list, so
 * there is no "is this competition drawn?" branch anywhere else.
 */
export function fixtureListFor(state: GameState, competitionId: CompetitionId): FixtureList {
  const existing = state.fixtures?.[competitionId];
  if (existing) return existing;
  if (!state.fixtures) state.fixtures = {};
  const created = emptyFixtureList(competitionId);
  state.fixtures[competitionId] = created;
  return created;
}

/** A competition's fixture list without creating one. */
export function readFixtureList(state: GameState, competitionId: CompetitionId): FixtureList | undefined {
  return state.fixtures?.[competitionId];
}

/** Every fixture on a matchday, across every competition that has one. */
export function fixtureIdsOnMatchday(state: GameState, matchday: number): string[] {
  const ids: string[] = [];
  for (const list of Object.values(state.fixtures ?? {})) {
    ids.push(...(list.byMatchday[matchday] ?? []));
  }
  return ids;
}

/** The fixture ids for a matchday in one competition. */
export function fixtureIdsFor(state: GameState, competitionId: CompetitionId, matchday: number): string[] {
  return readFixtureList(state, competitionId)?.byMatchday[matchday] ?? [];
}

/** Put a match on the calendar of the competition it belongs to. */
export function registerFixture(state: GameState, competitionId: CompetitionId, matchId: string, matchday: number): void {
  const list = fixtureListFor(state, competitionId);
  list.byMatchday[matchday] = [...(list.byMatchday[matchday] ?? []), matchId];
  list.matchdayOf[matchId] = matchday;
  if (!state.matchOrder.includes(matchId)) state.matchOrder.push(matchId);
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/** One division's table, derived from its own played matches. */
export function standingsFor(state: GameState, competition: Competition): StandingRow[] {
  return computeStandings({
    clubIds: competition.clubIds,
    matches: Object.values(state.matches),
    competitionId: competition.id,
    clubName: (id) => state.clubs[id]?.identity.name ?? id,
  });
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const ORDINALS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** "Wyre Valley Sunday League Division Two". */
export function divisionNameFor(regionName: string, tier: number): string {
  const ordinal = ORDINALS[tier] ?? String(tier);
  return `${regionName} Sunday League Division ${ordinal}`;
}

/** The competition id for a division, stable across seasons of a career. */
export function divisionCompetitionId(tier: number): CompetitionId {
  return `comp_league_t${tier}`;
}

export const LEAGUE_CUP_ID: CompetitionId = 'comp_league_cup';
export const LEAGUE_CUP_NAME = 'Sunday League Cup';
export const PLATE_ID: CompetitionId = 'comp_plate';
export const PLATE_NAME = 'Sunday League Plate';

// ---------------------------------------------------------------------------
// Promotion and relegation
// ---------------------------------------------------------------------------

/**
 * Whether a club may be admitted to the division above.
 *
 * Two rules, and both are the ones a real committee enforces: you must have a
 * ground to play on that is fit to host league football, and you must not be a
 * club in administration. A club that fails either is not promoted — the
 * boundary promotes the next club down instead, so the division above never
 * runs a club short and the ladder never has a hole in it.
 */
export interface Eligibility {
  eligible: boolean;
  reason: string | null;
}

export function promotionEligibility(state: GameState, club: Club): Eligibility {
  if (!club.active) return { eligible: false, reason: 'the club has folded' };

  const ground = state.world.grounds[club.groundId];
  if (!ground) return { eligible: false, reason: 'the club has no ground' };
  if (ground.quality < PROMOTION_ELIGIBILITY.minimumGroundQuality) {
    return {
      eligible: false,
      reason: `the ground does not meet the standard for the division above (quality ${ground.quality})`,
    };
  }
  const inAdministration = (club.finances.administrationSeasons ?? 0) > 0;
  if (inAdministration) {
    return { eligible: false, reason: 'the club is still in administration' };
  }
  return { eligible: true, reason: null };
}

export const PROMOTION_ELIGIBILITY = {
  /**
   * A 1-20 pitch standard. At 9 the surface is good enough for the division
   * above; below it, the committee will not admit the club.
   */
  minimumGroundQuality: 9,
} as const;

export interface MovementRecord {
  seasonId: string;
  seasonLabel: string;
  competitionId: CompetitionId;
  divisionName: string;
  tier: number;
  clubId: ClubId;
  clubName: string;
  direction: 'promoted' | 'relegated';
  /** Set when promotion was refused; the club stayed where it was. */
  blockedReason?: string;
}

/** Where a club ends up after a season, and why. */
export function moveWithinTier(
  state: GameState,
  competition: Competition,
  seasonId: string,
  seasonLabel: string,
): MovementRecord[] {
  const standings = standingsFor(state, competition);
  const promotionPlaces = competition.promotionPlaces ?? 0;
  const relegationPlaces = competition.relegationPlaces ?? 0;
  const records: MovementRecord[] = [];

  const describe = (clubId: ClubId): string => state.clubs[clubId]?.identity.name ?? clubId;

  const promote = standings.slice(0, promotionPlaces).reverse();
  for (const row of promote) {
    const club = state.clubs[row.clubId];
    if (!club) continue;
    const check = promotionEligibility(state, club);
    records.push({
      seasonId,
      seasonLabel,
      competitionId: competition.id,
      divisionName: competition.name,
      tier: competition.tier,
      clubId: club.id,
      clubName: describe(club.id),
      direction: 'promoted',
      ...(check.eligible ? {} : { blockedReason: check.reason ?? 'not eligible' }),
    });
  }

  for (const row of standings.slice(Math.max(0, standings.length - relegationPlaces))) {
    records.push({
      seasonId,
      seasonLabel,
      competitionId: competition.id,
      divisionName: competition.name,
      tier: competition.tier,
      clubId: row.clubId,
      clubName: describe(row.clubId),
      direction: 'relegated',
    });
  }

  return records;
}

export interface PromotionOutcome {
  events: GameEvent[];
  movements: MovementRecord[];
}

/**
 * Settle every boundary in the ladder.
 *
 * Each boundary is solved on its own: the clubs that finished in the promotion
 * places at the top of the lower division, and the clubs in the relegation
 * places at the bottom of the upper one. Where a promoted club turns out to be
 * ineligible the boundary walks down the table until it finds one that is, so
 * the same number of clubs crosses in each direction and the divisions above and
 * below come out exactly the size they went in.
 *
 * Nothing is written to the ladder here — this decides and reports. The move
 * itself happens when the next season is built, because that is the moment the
 * competitions are rebuilt anyway.
 */
export function resolvePromotionAndRelegation(
  state: GameState,
  context: { seasonId: string; seasonLabel: string; competitionIds?: CompetitionId[] },
): PromotionOutcome {
  const events: GameEvent[] = [];
  const movements: MovementRecord[] = [];
  const divisions = leagueCompetitions(state).filter(
    (competition) => !context.competitionIds || context.competitionIds.includes(competition.id),
  );

  // --- Relegation: the bottom of each division that has somewhere to go ----
  for (const division of divisions) {
    const standings = standingsFor(state, division);
    const relegationPlaces = division.relegationPlaces ?? 0;
    if (relegationPlaces <= 0) continue;
    for (const row of standings.slice(Math.max(0, standings.length - relegationPlaces))) {
      movements.push({
        seasonId: context.seasonId,
        seasonLabel: context.seasonLabel,
        competitionId: division.id,
        divisionName: division.name,
        tier: division.tier,
        clubId: row.clubId,
        clubName: state.clubs[row.clubId]?.identity.name ?? row.clubId,
        direction: 'relegated',
      });
    }
  }

  // --- Promotion: the top of each division that has somewhere to go up -----
  for (const division of divisions) {
    const promotionPlaces = division.promotionPlaces ?? 0;
    if (promotionPlaces <= 0) continue;
    const standings = standingsFor(state, division);
    // Walk the promotion places downwards, so a refused club is replaced by the
    // one that finished immediately behind it rather than leaving a hole.
    let taken = 0;
    for (const row of standings) {
      if (taken >= promotionPlaces) break;
      const club = state.clubs[row.clubId];
      if (!club) continue;
      const check = promotionEligibility(state, club);
      if (!check.eligible) {
        movements.push({
          seasonId: context.seasonId,
          seasonLabel: context.seasonLabel,
          competitionId: division.id,
          divisionName: division.name,
          tier: division.tier,
          clubId: club.id,
          clubName: club.identity.name,
          direction: 'promoted',
          blockedReason: check.reason ?? 'not eligible',
        });
        continue;
      }
      taken += 1;
      movements.push({
        seasonId: context.seasonId,
        seasonLabel: context.seasonLabel,
        competitionId: division.id,
        divisionName: division.name,
        tier: division.tier,
        clubId: club.id,
        clubName: club.identity.name,
        direction: 'promoted',
      });
    }
  }

  events.push(...promotionNews(state, movements));
  return { events, movements };
}

/**
 * What a boundary does to a club, said the way a local paper says it.
 *
 * The player's own club gets a proper story; the rest of the ladder is news the
 * manager reads about other people, which is the point — a pyramid he is not in
 * the middle of still has to be a pyramid he can hear about.
 */
export function promotionNews(state: GameState, movements: readonly MovementRecord[]): GameEvent[] {
  const events: GameEvent[] = [];
  for (const movement of movements) {
    if (movement.blockedReason) {
      events.push(
        createEvent(state, {
          type: 'league-movement',
          importance: 2,
          clubIds: [movement.clubId],
          data: {
            headline: `${movement.clubName} stay put`,
            body: `${movement.clubName} have won promotion from ${movement.divisionName} but cannot take it up — ${movement.blockedReason}. The place passes to the club behind them.`,
            competition: movement.divisionName,
            movement: 'blocked',
          },
        }),
      );
      continue;
    }
    const isUser = movement.clubId === state.userClubId;
    const body =
      movement.direction === 'promoted'
        ? `${movement.clubName} have finished in the promotion places of ${movement.divisionName} and go up a division. A bigger pitch, bigger gates and a committee that expects more.`
        : `${movement.clubName} have finished in the relegation places of ${movement.divisionName} and go down a division. It will be a long season.`;
    events.push(
      createEvent(state, {
        type: 'league-movement',
        importance: isUser ? 3 : 1,
        clubIds: [movement.clubId],
        data: {
          headline:
            movement.direction === 'promoted'
              ? `${movement.clubName} are promoted`
              : `${movement.clubName} are relegated`,
          body,
          competition: movement.divisionName,
          movement: movement.direction,
        },
      }),
    );
  }
  return events;
}

/** Write the outcome onto the clubs' own season records, for the archive. */
export function recordMovementsOnClubs(state: GameState, movements: readonly MovementRecord[]): void {
  for (const movement of movements) {
    if (movement.blockedReason) continue;
    const record = state.clubs[movement.clubId]?.history.seasons.find(
      (entry) => entry.seasonId === movement.seasonId,
    );
    if (record) record.movement = movement.direction;
  }
}

// ---------------------------------------------------------------------------
// Tier-scaled money
// ---------------------------------------------------------------------------

/**
 * What a division pays out.
 *
 * Prize money is the honest reason a club wants to go up: the top division's
 * champions are paid, the bottom division's are not, and the gap between them is
 * what a committee is promising when it asks a manager to get a team out of the
 * bottom two. Set against a weekly wage bill of a few hundred pounds it is
 * small, which is exactly right for this level of football.
 */
export const TIER_PRIZE_MONEY = {
  /** Paid to the champions of each tier, 1 = top. */
  champion: [900, 350, 120] as const,
  /** Paid to the runners-up of each tier. */
  runnerUp: [250, 90, 30] as const,
} as const;

/** How much a crowd is worth, and what a sponsor will pay, by division. */
export const TIER_EXPECTATIONS = {
  /** Multiplier on gate money for the home club, by tier. */
  gate: [1.35, 1.0, 0.8] as const,
  /** Multiplier applied to a sponsor's weekly instalment, by tier. */
  sponsor: [1.4, 1.0, 0.75] as const,
  /** How many places below expectations a finish has to be to worry anyone. */
  slack: [3, 4, 5] as const,
} as const;

/** A multiplier for a tier, clamped to the ends of the table. */
export function tierFactor(table: readonly number[], tier: number | null): number {
  if (tier === null || tier < 1) return table[table.length - 1] ?? 1;
  return table[Math.min(tier, table.length) - 1] ?? 1;
}

/** The prize a club has earned by finishing where it finished. */
export function tierPrizeMoney(tier: number | null, position: number): number {
  if (position === 1) return tierFactor(TIER_PRIZE_MONEY.champion, tier);
  if (position === 2) return tierFactor(TIER_PRIZE_MONEY.runnerUp, tier);
  return 0;
}

/** How far below its own division a finish has to fall to worry a manager. */
export function sackingSlackFor(state: GameState, clubId: ClubId): number {
  const tier = tierOf(state, clubId);
  return tierFactor(TIER_EXPECTATIONS.slack, tier);
}

/** The officials a club should remember it has to work with. */
export function officialsOf(club: Club): { managerId: PersonId | null; chairmanId: PersonId | null } {
  return { managerId: club.managerId, chairmanId: club.chairmanId };
}
