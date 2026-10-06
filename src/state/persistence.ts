import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import type { Player, PlayerDevelopment } from '@/domain/person';
import { birthdayForAge, type ManagerProfile } from '@/domain/manager';
import { DEFAULT_STARTER_SUB, DEFAULT_SUBSTITUTE_SUB, ensurePlayerSubs } from '@/simulation/finance';
import { ensureClubStaff, generateClubStaff } from '@/simulation/staff';
import { refreshSubSummary } from '@/domain/person';
import { emptyAdminState } from '@/domain/admin';
import { emptyGovernanceState } from '@/domain/governance';
import { emptySponsorshipState } from '@/domain/sponsorship';
import { emptyCommunicationStore } from '@/domain/communication';
import { emptyRecruitmentStore } from '@/domain/recruitment';
import { DEFAULT_PYRAMID, FRIENDLY_COMPETITION_ID, type Competition, type FixtureList, type PyramidConfig } from '@/domain/competition';
import type { ClubId, CompetitionId } from '@/domain/ids';
import type { Ground } from '@/domain/world';
import { defaultTactics } from '@/domain/tactics';
import {
  generateInitialRelationships,
  linkUnattachedPlayersInto,
} from '@/simulation/generation/relationshipGenerator';
import { generateUnattachedPlayers } from '@/simulation/generation/unattachedPlayers';
import { generateSquad, developmentProfileFor } from '@/simulation/generation/playerGenerator';
import {
  buildClubName,
  buildFinances,
  clubQualityFromReputation,
  emptyHistory,
  generateChairman,
  generateManager,
} from '@/simulation/generation/worldGenerator';
import { rebuildRelationshipIndex, relationshipStore } from '@/simulation/relationships';
import { pruneCandidates } from '@/simulation/recruitment/store';
import { pruneCommunication } from '@/simulation/communication/store';
import { ensureTrainingState, pruneTrainingHistory, trainingStore } from '@/simulation/training/store';
import { ensureLineupRoles } from '@/simulation/match/roles';
import { overallAbility } from '@/simulation/training/development';
import { buildSeasonCalendarWithCups, yearOf } from '@/simulation/calendar';
import { matchdayCount } from '@/simulation/generation/fixtureGenerator';
import { drawCupRound, cupRoundSlots, mainCupPlan, newCupState, platePlan, seedOrder } from '@/simulation/cup';
import {
  divisionCompetitionId,
  divisionNameFor,
  leagueClubIds,
  leagueCompetitions,
  LEAGUE_CUP_ID,
  LEAGUE_CUP_NAME,
  PLATE_ID,
  PLATE_NAME,
} from '@/simulation/pyramid';
import { stream } from '@/simulation/rng';
import { emptyScheduleState } from '@/domain/events';
import * as idb from './indexedDb';

/**
 * Where careers used to live before the database.
 *
 * These keys are read and never written. They keep their original names because
 * renaming them would orphan every career already in every manager's browser,
 * and they are still worth something: if the database cannot be opened at all,
 * these are the only copy of a season that exists.
 */
const LEGACY_KEY_PREFIX = 'slfm26.save.';
const LEGACY_INDEX_KEY = 'slfm26.saves';
const LEGACY_RESUME_KEY = 'slfm26.resume';

/** The competition id a version 7 save used for its one league. */
const OLD_LEAGUE_ID: CompetitionId = 'comp_league_1';

/**
 * Local save slots.
 *
 * The whole simulation state is plain JSON, so saving is a stringify and
 * loading is a parse plus a version check. Presentation state is deliberately
 * never saved: on load the UI is rebuilt from the simulation.
 */

/**
 * The slot the game keeps up to date by itself. It is a slot like any other —
 * the manager can load it, and it is listed alongside his own — but nothing
 * writes to it except the autosave.
 */
export const AUTOSAVE_SLOT = 'autosave';

/**
 * The metadata key holding the slot the next page load should open.
 *
 * It lives in the database rather than in a cookie or a storage key because it
 * is part of the career's own bookkeeping: it names a slot in the same store the
 * slot is in, and it is written by the same autosave that writes the slot.
 */
const RESUME_KEY = 'resume';

/**
 * The flag that says the localStorage careers have been brought across.
 *
 * It is written *after* the import succeeds and never before, so a migration
 * interrupted by a closed tab is simply run again next time. The import is
 * written per slot rather than as one transaction on purpose, which is why that
 * is safe: see migrateLegacySaves.
 */
const LEGACY_MIGRATION_FLAG = 'migration.localStorage.v1';

export interface SaveSlotInfo {
  slot: string;
  saveName: string;
  clubName: string;
  date: string;
  seasonLabel: string;
  savedAt: string;
  seed: string;
  /** True for the career the game writes as it is played, not one the manager made. */
  auto?: boolean;
}

export interface SaveFile {
  version: number;
  savedAt: string;
  state: GameState;
}

/**
 * The careers to list, most recently saved first.
 *
 * The order is the manager's own history rather than a ranking of the saves:
 * the one he was playing five minutes ago is the one he wants, and the career
 * the game writes as it is played is simply the most recent of them, not a
 * special case wedged above the others. Slots that were never stamped with a
 * time sort last rather than jumping the queue.
 */
export function orderSaves(saves: readonly SaveSlotInfo[]): SaveSlotInfo[] {
  return [...saves].sort((a, b) => {
    const left = a.savedAt ?? '';
    const right = b.savedAt ?? '';
    if (left === right) return 0;
    return left > right ? -1 : 1;
  });
}

/**
 * The browser's old storage, for reading only.
 *
 * Careers used to live in localStorage as JSON strings. Nothing writes there
 * any more, but the keys are still read — once, at startup — so that a manager
 * who has been playing for months does not open an update and find his season
 * gone. See migrateLegacySaves.
 */
function legacyStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Private browsing, or a browser that has storage switched off entirely.
    return null;
  }
}

/**
 * Serialise writes to one slot so they land in the order they were asked for.
 *
 * IndexedDB made this problem real. localStorage writes were synchronous, so
 * `autosave(A)` had always finished before `autosave(B)` could be called; here
 * both are in flight at once and the database is free to complete them in
 * whatever order it likes, which would leave an older career sitting in the
 * slot after a newer one had already put itself there.
 *
 * The fix is a promise chain per slot rather than a global lock: each write
 * waits for the previous write *to that slot* and nothing else, so the
 * autosave never waits behind a manual save into a different slot, and the
 * manager is never blocked — a write that is queued has already returned to the
 * caller. Autosaving A, B and C in a burst therefore ends with C stored.
 */
const writeChains = new Map<string, Promise<unknown>>();

function enqueueWrite<T>(slot: string, work: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(slot) ?? Promise.resolve();
  // `then(work, work)` rather than `then(work)`: a failed write must not stop
  // the ones behind it, or one quota error would freeze the autosave for the
  // rest of the session.
  const next = previous.then(work, work);
  writeChains.set(
    slot,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * Bring an older save up to date.
 *
 * Each step regenerates deterministically from the world seed, so an old career
 * wakes up with the same social fabric and the same local faces it would have
 * had if it had been started today:
 *
 *  - version 1 predates the social layer, so the relationship network is built;
 *  - version 2 predates recruitment, so the unattached pool arrives with it;
 *  - version 3 predates training, so every player is given a plausible starting
 *    knowledge of his club's system and the Thursday routine begins;
 *  - version 4 predates the day-by-day calendar, so the manager is put at the
 *    start of the week he is in;
 *  - version 5 predates continuous time: its `date` was the coming Sunday and
 *    its cursor was the day the manager actually stood on. The cursor becomes
 *    the date, the matchday counter goes (it is derived from the calendar now),
 *    and every fixture is given the calendar fields postponements need.
 *  - version 7 predates the pyramid: it carries one league and no cups. The
 *    league it already has becomes Division One, the divisions below it are
 *    generated from the world seed, and the cups are drawn on top.
 *  - version 8 predates development curves: its players have no ceiling and no
 *    peak age. Each is given one from the ability and age he already has, on a
 *    stream of his own, and a session that does not say what age took back is
 *    given an empty record of it. *  - version 9 predates communication: it has no conversations. It is given an
 *    empty inbox, which is what it had, rather than one seeded with threads it
 *    never held.
 *  - version 11 predates matchday subs: subs were a weekly squad tax settled
 *    independently of whether a man played. The club's old weekly figure
 *    becomes the matchday rates, and an outstanding per-player balance is kept
 *    as a "carried" liability so it is neither lost nor explained away with a
 *    match the save never recorded.
 *  - version 12 predates the club personnel system: officials were managers,
 *    chairmen or referees, and a club had no staff roster at all. Each club is
 *    given an empty committee rather than an invented one, so the men it already
 *    had stay exactly where they were and the club can be staffed up in play.
 *  - version 13 predates the secretary's desk. It has no administrative events.
 *    It is given an empty desk rather than a seeded one, because a career that
 *    had received no correspondence should not wake up holding any.
 *  - version 14 predates club governance. Its committee has taken no view of the
 *    manager, so it is given the comfortable default rather than an invented
 *    history of warnings it never issued.
 *  - version 15 predates sponsorship agreements. Its clubs have only the old
 *    weekly figure and no deal, so they are given an empty log rather than an
 *    invented agreement; the clubs that were already backed by a business sign
 *    a real one in play, and the season review offers the rest.
 */
function migrateSave(file: SaveFile): SaveFile {
  const state = file.state as GameState & {
    relationships?: GameState['relationships'];
    recruitment?: GameState['recruitment'];
  };
  const from = typeof file.version === 'number' ? file.version : 1;

  if (from < 3 && !Object.keys(state.people).some((id) => id.startsWith('free_migrated_'))) {
    const arrivals = generateUnattachedPlayers({
      seed: state.seed,
      towns: Object.values(state.world.towns),
      date: state.date,
      idPrefix: 'migrated',
    });
    for (const player of arrivals) state.people[player.id] = player;
    if (state.relationships?.byId) {
      // The save already has a social fabric, so the new faces need threading
      // into it rather than replacing it.
      linkUnattachedPlayersInto(relationshipStore(state), state.seed, state.people, state.clubs, state.date);
    }
  }

  if (!state.relationships || !state.relationships.byId) {
    state.relationships = generateInitialRelationships({
      seed: state.seed,
      people: state.people,
      clubs: state.clubs,
      date: state.date,
    });
  }

  if (!state.recruitment || !state.recruitment.candidates) {
    state.recruitment = emptyRecruitmentStore();
  }

  // Communication came after this save was written, so it had no conversations
  // and is given an empty inbox. Nothing is generated: a career that had not
  // been talking to anybody should not wake up with a full one.
  if (!state.communication || typeof state.communication !== 'object' || !state.communication.conversations) {
    state.communication = emptyCommunicationStore();
  }
  pruneCommunication(state);

  // Subs became per-player after this save was written. Every man in it was
  // paying in full, because the ledger said they were, so each is given a
  // clear record rather than an invented debt. A later record that already had
  // a balance keeps it: the migration fills the new liability arrays but never
  // turns one old figure into a pile of would-be match liabilities, because a
  // save carries no participation the game can honestly attribute them to.
  for (const person of Object.values(state.people)) {
    if (person.kind === 'player') ensurePlayerSubs(person);
  }

  // Matchday subs: a club written before them has only the old weekly figure.
  // Give every club the realistic defaults so the book can be kept at all, and
  // keep any balance a man already had as a *carried* liability rather than a
  // bare number — no match is fabricated to explain it, but nothing is lost.
  if (from < 11) {
    for (const club of Object.values(state.clubs)) {
      if (typeof club.finances.starterSubAmount !== 'number') club.finances.starterSubAmount = DEFAULT_STARTER_SUB;
      if (typeof club.finances.substituteSubAmount !== 'number') club.finances.substituteSubAmount = DEFAULT_SUBSTITUTE_SUB;
    }
    for (const person of Object.values(state.people)) {
      if (person.kind !== 'player') continue;
      const subs = person.subs;
      if (!subs) continue;
      if (subs.owed > 0 && (subs.liabilities ?? []).length === 0) {
        subs.liabilities = [
          {
            id: `carried:${person.id}`,
            matchId: 'carried',
            date: state.date,
            category: 'carried',
            amount: Math.round(subs.owed * 100) / 100,
            paid: 0,
            paidOn: null,
          },
        ];
      }
      refreshSubSummary(subs);
    }
  }

  // Club books: an older save has no explicit opening balance, and the ledger it
  // does hold may already have been trimmed. Setting the opening figure to
  // "balance minus what the ledger still shows" makes the two agree exactly
  // without changing the balance the manager already had. Training cost also
  // predates some saves; a missing one is 0 (a club that pays nothing to train).
  for (const club of Object.values(state.clubs)) {
    if (typeof club.finances.trainingCostPerWeek !== 'number') club.finances.trainingCostPerWeek = 0;
    if (typeof club.finances.openingBalance !== 'number') {
      const history = club.finances.ledger.reduce((sum, line) => sum + line.amount, 0);
      club.finances.openingBalance = Math.round((club.finances.balance - history) * 100) / 100;
    }
    // A save written before the personnel system has no staff roster. It is
    // given an empty one rather than an invented committee: the manager and
    // chairman it already had stay exactly where they were, and it can be
    // staffed up in play.
    ensureClubStaff(club);
  }

  // A save written before the secretary's desk has received no administrative
  // events. It is given an empty desk, not a seeded one: correspondence that
  // never arrived is not correspondence, and the secretary will fill it in as
  // the season goes on.
  if (!state.admin || !Array.isArray(state.admin.events)) state.admin = emptyAdminState();

  // A save written before the committee kept a view of the manager is given the
  // comfortable default. Nothing is invented: a career that was never warned
  // should not wake up already under pressure.
  if (!state.governance || !Array.isArray(state.governance.events)) state.governance = emptyGovernanceState();

  // A save written before sponsorship agreements existed has no deals. It is
  // given an empty log, not a seeded one: an agreement that was never signed is
  // not an agreement, and the world will sign its own as the seasons turn.
  if (!state.sponsorship || !Array.isArray(state.sponsorship.deals)) state.sponsorship = emptySponsorshipState();

  // A career that predates training has no session history, no plans and no
  // per-player familiarity: all three are rebuilt from the world itself, so the
  // save wakes up with the squad it would have had if training had always been
  // in the build.
  ensureTrainingState(state);
  pruneTrainingHistory(state);
  // Roles are a matchday instruction, so a career written before they existed
  // is given the default for each position rather than being refused: the same
  // eleven men wake up with exactly the football they had, and nobody has to
  // visit a role screen they never knew existed.
  ensureLineupRoles(state);
  ensurePlayerDevelopment(state);
  ensureSessionDeclines(state);

  // A career from before the manager introduced himself derives his profile
  // from the manager official the world already generated, so nothing is lost
  // and the identity stays stable.
  if (!state.managerProfile) {
    const manager = state.people['user_manager'];
    state.managerProfile = {
      firstName: manager?.firstName ?? 'The',
      surname: manager?.surname ?? 'Manager',
      nickname: manager?.nickname ?? '',
      birthday: birthdayForAge(manager?.age ?? 40, state.date),
      occupation: manager?.occupation ?? 'Volunteer',
      hometown: '',
    } satisfies ManagerProfile;
  }

  // Continuous time: the day the manager was standing on becomes the date, and
  // the two pieces of state that duplicated it go.
  const legacy = state as GameState & { calendarCursor?: string };
  if (legacy.calendarCursor) state.date = legacy.calendarCursor;
  delete legacy.calendarCursor;
  delete (state.season as { currentMatchday?: number }).currentMatchday;
  if (!state.schedule) state.schedule = emptyScheduleState();

  // Fixtures from before the calendar existed need the fields postponement and
  // the late calls rely on. Nothing about the games themselves changes.
  for (const match of Object.values(state.matches)) {
    if (match.status === undefined) match.status = match.played ? 'finished' : 'scheduled';
    if (match.postponementReason === undefined) match.postponementReason = null;
    if (match.postponedOn === undefined) match.postponedOn = null;
    if (match.originalDate === undefined) match.originalDate = null;
    if (match.replacedByMatchId === undefined) match.replacedByMatchId = null;
    if (match.lateCallMade === undefined) match.lateCallMade = false;
  }

  rebuildRelationshipIndex(state);
  pruneCandidates(state);
  migrateToPyramid(state);
  file.version = GAME_STATE_VERSION;
  state.version = GAME_STATE_VERSION;
  return file;
}

/**
 * A session saved before age started taking attributes back has no record of
 * them. It is given an empty one, so nothing that reads the field has to
 * wonder whether this career is old enough to predate it.
 */
function ensureSessionDeclines(state: GameState): void {
  for (const session of trainingStore(state).history) {
    if (!Array.isArray(session.declines)) session.declines = [];
  }
}

/**
 * Give every player the ceiling and the peak that shape his career.
 *
 * A career saved before development curves existed has men in it with no idea
 * how good they are going to get or when. They are given one from the ability
 * they already have and their age — a man of 34 is given no headroom, a
 * teenager a lot — on a stream of their own, so the same save always wakes up
 * with the same careers and no two men are given the same curve by accident.
 */
function ensurePlayerDevelopment(state: GameState): void {
  for (const person of Object.values(state.people)) {
    if (person.kind !== 'player') continue;
    const player = person as Player & { development?: PlayerDevelopment };
    if (player.development && Number.isFinite(player.development.potential)) continue;
    const current = overallAbility(player);
    const rng = stream(state.seed, 'development-curve', player.id);
    const profile = developmentProfileFor(rng, current, player.age);
    // An existing player is given only the headroom his age leaves him, so an
    // old save does not suddenly discover a new talent in its established men.
    const yearsLeft = Math.max(0, profile.peakAge - player.age);
    player.development = {
      potential: Math.round(Math.min(20, current + yearsLeft * 0.16) * 10) / 10,
      peakAge: profile.peakAge,
    };
  }
}

/**
 * A single-league career becomes a pyramid.
 *
 * The league a version 7 save already has is kept exactly as it was and becomes
 * Division One: its clubs, its table, its finished season and its honours are
 * all still true, and the manager's own club does not change division under
 * him on the day he opens the game. The divisions *below* it are new, and are
 * generated — towns, clubs, committees, grounds and squads — from the world seed
 * on a stream of their own, so an old career gains a bottom two-thirds that is
 * as deterministic as the top of it was and no two saves of the same world get
 * a different one.
 *
 * The archive is left alone. A season a club played in "Division One" was played
 * in the only division there was, and the migration says so rather than
 * rewriting history it does not have the context to rewrite.
 */
function migrateToPyramid(state: GameState): void {
  const legacy = state as GameState & { fixtures?: unknown };
  if (state.pyramid && state.pyramid.tiers > 1) return;

  const config = { ...DEFAULT_PYRAMID };
  state.pyramid = config;

  // --- The ladder -----------------------------------------------------------
  const divisions = expandIntoPyramid(state, config);

  // --- The calendar ---------------------------------------------------------
  // The old calendar held league Sundays only. It is rebuilt from the same first
  // Sunday and the same division size, so the dates a manager has already lived
  // through are the dates he keeps — with the cup rounds added around them.
  const firstLeagueDate = state.season.calendar[0]?.date ?? `${state.season.startDate}`;
  const clubsPerTier = Math.max(2, divisions[0]?.length ?? config.clubsPerTier);
  const leagueMatchdays = matchdayCount(clubsPerTier);
  const slots = cupRoundSlots(leagueClubIds(state).length, leagueMatchdays);
  const calendar = buildSeasonCalendarWithCups(firstLeagueDate, leagueMatchdays, slots);
  state.season.calendar = calendar;
  state.season.endDate = calendar[calendar.length - 1]!.date;

  // --- The fixtures ---------------------------------------------------------
  // Only the current season is re-cut; finished seasons live in the club
  // records and would be thrown away by rebuilding them.
  const competitions: Record<string, Competition> = {};
  const fixtures: Record<string, FixtureList> = {};
  divisions.forEach((clubIds, index) => {
    const tier = index + 1;
    if (clubIds.length === 0) return;
    const competition: Competition = {
      id: divisionCompetitionId(tier),
      name: divisionNameFor(state.world.regionName, tier),
      kind: 'league',
      tier,
      seasonId: state.season.id,
      clubIds: [...clubIds],
      ...(tier > 1 ? { promotionPlaces: config.promotionPlaces } : {}),
      ...(tier < config.tiers ? { relegationPlaces: config.relegationPlaces } : {}),
    };
    competitions[competition.id] = competition;
    fixtures[competition.id] = { competitionId: competition.id, byMatchday: {}, matchdayOf: {} };
  });

  const ladderClubs = leagueClubIds(state);
  if (config.leagueCup && slots.length > 0) {
    competitions[LEAGUE_CUP_ID] = {
      id: LEAGUE_CUP_ID,
      name: LEAGUE_CUP_NAME,
      kind: 'cup',
      tier: 0,
      seasonId: state.season.id,
      clubIds: seedOrder(state, ladderClubs),
      cup: newCupState(mainCupPlan(ladderClubs.length)),
    };
    fixtures[LEAGUE_CUP_ID] = { competitionId: LEAGUE_CUP_ID, byMatchday: {}, matchdayOf: {} };
    if (config.consolationCup) {
      competitions[PLATE_ID] = {
        id: PLATE_ID,
        name: PLATE_NAME,
        kind: 'cup',
        tier: 0,
        seasonId: state.season.id,
        clubIds: [],
        cup: newCupState(platePlan(mainCupPlan(ladderClubs.length)), LEAGUE_CUP_ID),
      };
      fixtures[PLATE_ID] = { competitionId: PLATE_ID, byMatchday: {}, matchdayOf: {} };
    }
  }

  state.competitions = competitions;
  state.fixtures = fixtures;

  // The old season's matches keep the competition they were played in. The
  // Division One competition keeps its old id under the new ladder so that a
  // played fixture still belongs to a real competition.
  for (const match of Object.values(state.matches)) {
    if (match.knockout === undefined) match.knockout = false;
    if (match.shootoutWinnerId === undefined) match.shootoutWinnerId = undefined;
    if (match.competitionId === OLD_LEAGUE_ID || !state.competitions[match.competitionId]) {
      match.competitionId = divisionCompetitionId(1);
      match.competitionName = competitions[divisionCompetitionId(1)]?.name ?? match.competitionName;
    }
    if (match.competitionId === FRIENDLY_COMPETITION_ID) {
      fixtures[match.competitionId] ??= { competitionId: match.competitionId, byMatchday: {}, matchdayOf: {} };
      fixtures[match.competitionId]!.byMatchday[match.matchday] = [
        ...(fixtures[match.competitionId]!.byMatchday[match.matchday] ?? []),
        match.id,
      ];
      fixtures[match.competitionId]!.matchdayOf[match.id] = match.matchday;
    }
  }
  // Division One's own played fixtures, from whatever the old list held.
  const oldFixtures = legacy.fixtures as unknown as FixtureList | undefined;
  if (oldFixtures && typeof oldFixtures === 'object' && 'byMatchday' in oldFixtures) {
    const list = fixtures[divisionCompetitionId(1)]!;
    for (const [matchday, ids] of Object.entries(oldFixtures.byMatchday ?? {})) {
      for (const id of ids as string[]) {
        const match = state.matches[id];
        if (!match || match.competitionId !== divisionCompetitionId(1)) continue;
        list.byMatchday[Number(matchday)] = [...(list.byMatchday[Number(matchday)] ?? []), id];
        list.matchdayOf[id] = Number(matchday);
      }
    }
  }

  // --- The first cup draw ---------------------------------------------------
  if (config.leagueCup && slots.length > 0) {
    drawCupRound(state, state.competitions[LEAGUE_CUP_ID]!, {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      leagueMatchdays,
      announce: false,
    });
  }

  // --- The archive ----------------------------------------------------------
  // Every season a club played before the pyramid existed was played in the only
  // division there was, and the history says Division One from now on.
  for (const club of Object.values(state.clubs)) {
    for (const record of club.history.seasons) {
      if (record.tier === undefined) record.tier = 1;
      if (record.competitionName && !record.competitionName.toLowerCase().includes('division')) {
        record.competitionName = `Division One`;
      }
    }
  }
  for (const snapshot of state.standingHistory ?? []) {
    if (snapshot.competitionId === undefined) snapshot.competitionId = divisionCompetitionId(1);
  }
  if (!state.promotionHistory) state.promotionHistory = [];
  if (state.fixtures === undefined) state.fixtures = fixtures;
}

/**
 * Give a single-division world the divisions underneath it.
 *
 * The clubs already in the division keep their places; the rest of the ladder is
 * filled by new clubs, generated in the same towns the county already has and,
 * where the county has run out of plausible places, in new ones. Reputation
 * decides the cut, so the new clubs land below the old ones — the ladder starts
 * stratified rather than sorting itself out over three seasons.
 */
function expandIntoPyramid(state: GameState, config: PyramidConfig): ClubId[][] {
  const existingDivision = leagueCompetitions(state)[0];
  const existing = existingDivision ? [...existingDivision.clubIds] : [];
  const wanted = config.tiers * config.clubsPerTier;
  const needed = Math.max(0, wanted - existing.length);

  const generated = needed > 0 ? generateLowerTierClubs(state, needed) : [];

  const ranked = [...existing, ...generated]
    .filter((id) => state.clubs[id]?.active)
    .sort((a, b) => {
      const repA = state.clubs[a]?.reputation ?? 0;
      const repB = state.clubs[b]?.reputation ?? 0;
      return repB - repA || a.localeCompare(b);
    });

  const divisions: ClubId[][] = [];
  for (let tier = 1; tier <= config.tiers; tier += 1) {
    divisions.push(ranked.slice((tier - 1) * config.clubsPerTier, tier * config.clubsPerTier));
  }
  return divisions;
}

/** New clubs for the divisions below the one a save already has. */
function generateLowerTierClubs(state: GameState, count: number): ClubId[] {
  const rng = stream(state.seed, 'pyramid-expansion', state.season.id);
  const created: ClubId[] = [];
  const towns = Object.values(state.world.towns);
  if (towns.length === 0) return created;

  const usedNames = new Set(Object.values(state.clubs).map((club) => club.identity.name));
  const usedNicknames = new Set(Object.values(state.clubs).map((club) => club.identity.nickname));
  const usedBusinesses = new Set<string>();
  const year = yearOf(state.season.startDate);

  for (let index = 0; index < count; index += 1) {
    const town = towns[index % towns.length]!;
    const clubId: ClubId = `club_py${index + 1}`;
    if (state.clubs[clubId]) continue;
    const groundId = `ground_py${index + 1}`;

    // A club joining a lower division sits in a smaller town than one already at
    // the top of it, which is what makes it a lower-division club rather than a
    // Division One club that happened to lose.
    const reputation = Math.max(18, Math.min(46, Math.round(20 + rng.gaussian(0, 7))));
    const ground: Ground = {
      id: groundId,
      name: `${town.name} ${rng.pick(['Recreation Ground', 'Playing Fields', 'Meadow', 'Sports Ground'])}`,
      townId: town.id,
      tenantClubId: clubId,
      capacity: rng.gaussianInt(Math.max(25, town.population / 300), 30, 20, 300),
      surface: rng.chance(0.1) ? '3G' : rng.chance(0.5) ? 'grass (uneven)' : 'grass',
      quality: rng.gaussianInt(8, 2.4, 4, 15),
      drainage: rng.gaussianInt(7, 3, 2, 14),
      hasFloodlights: rng.chance(0.2),
      hasChangingRooms: rng.chance(0.7),
      hasClubhouse: rng.chance(0.4),
      matchdayCost: rng.int(15, 45),
      sharedWith: [],
    };
    state.world.grounds[groundId] = ground;
    state.world.groundIds.push(groundId);

    const localBusinesses = Object.values(state.world.businesses).filter((business) => business.townId === town.id);
    const { identity, structure, business } = buildClubName(
      rng,
      town,
      localBusinesses,
      usedNames,
      usedNicknames,
      usedBusinesses,
      year,
    );
    if (business) business.sponsoredClubIds.push(clubId);

    const manager = generateManager(rng, town.id, reputation, 900 + index);
    manager.id = `mgr_py${index + 1}`;
    manager.clubId = clubId;
    manager.roles = [{ clubId, role: 'manager', since: state.season.startDate }];
    const chairman = generateChairman(rng, town.id, 900 + index);
    chairman.id = `chm_py${index + 1}`;
    chairman.clubId = clubId;
    chairman.roles = [{ clubId, role: 'chairman', since: state.season.startDate }];
    state.people[manager.id] = manager;
    state.people[chairman.id] = chairman;

    const squad = generateSquad({
      rng,
      clubId,
      townId: town.id,
      homeGroundId: groundId,
      quality: clubQualityFromReputation(rng, reputation),
      seasonStart: state.season.startDate,
      idSeedPrefix: clubId,
    });
    for (const player of squad) state.people[player.id] = player;

    const staff = generateClubStaff({
      seed: state.seed,
      clubId,
      townId: town.id,
      reputation,
      structure,
      seasonStart: state.season.startDate,
      squad,
      people: state.people,
      managerId: manager.id,
      chairmanId: chairman.id,
    });

    state.clubs[clubId] = {
      id: clubId,
      identity,
      townId: town.id,
      groundId,
      structure,
      reputation,
      squadIds: squad.map((player) => player.id),
      chairmanId: chairman.id,
      managerId: manager.id,
      staff,
      sponsorIds: business ? [business.id] : [],
      finances: buildFinances(rng, town, reputation),
      history: { ...emptyHistory(rng, identity.foundedYear), honours: [] },
      tactics: defaultTactics('4-4-2'),
      active: true,
      rivalries: {},
    };
    created.push(clubId);
  }
  return created;
}

/** What the database keeps for one slot. */
export interface IndexedSaveRecord {
  slot: string;
  file: SaveFile;
  info: SaveSlotInfo;
}

/**
 * Open the database and bring any old careers across.
 *
 * Nothing may ask for a career before this has finished, which is why the store
 * awaits it before it builds itself. It is safe to call more than once and safe
 * to call when it fails: a browser that will not give us a database still opens
 * the game, it just cannot remember anything, which is a far better outcome than
 * a manager staring at a broken front door.
 */
export async function initialise(): Promise<void> {
  try {
    await migrateLegacySaves();
  } catch (error) {
    // A migration that cannot run is not a reason to refuse to start. The game
    // works without persistence; what must not happen is the old data being
    // destroyed on the way past, and nothing here deletes it.
    console.warn('Bringing localStorage careers across failed; starting without them.', error);
  }
}

/** Write a career to a slot. Resolves null if the browser would not store it. */
export function saveGame(
  state: GameState,
  slot: string,
  options: { auto?: boolean } = {},
): Promise<SaveSlotInfo | null> {
  const info: SaveSlotInfo = {
    slot,
    saveName: state.saveName,
    clubName: state.clubs[state.userClubId]?.identity.name ?? 'Unknown club',
    date: state.date,
    seasonLabel: state.season.label,
    savedAt: new Date().toISOString(),
    seed: state.seed,
    ...(options.auto ? { auto: true } : {}),
  };

  // The record holds the state by reference and lets the database clone it. The
  // store already clones every career it mutates, so a structured clone of this
  // object is known to work, and it is both faster and more faithful than
  // stringifying a whole world first. Nothing here mutates `state`: cloning
  // happens on the way in.
  const record: IndexedSaveRecord = {
    slot,
    file: { version: GAME_STATE_VERSION, savedAt: info.savedAt, state },
    info,
  };

  return enqueueWrite(slot, async () => {
    try {
      await idb.put(idb.SAVES, record);
      return info;
    } catch (error) {
      // A full disk, a blocked write, a browser that has thrown us out. The
      // career in memory is untouched and the manager keeps playing.
      console.warn(`Saving "${slot}" failed.`, error);
      return null;
    }
  });
}

/**
 * The career the manager is playing, written as he plays it.
 *
 * A Sunday league season is played in ten-minute bursts between everything
 * else, so needing to remember to save is a way to lose a month. This keeps a
 * copy of the live career and marks it as the one to reopen, while leaving the
 * manager's own slots exactly as he left them.
 */
export async function autosave(state: GameState): Promise<boolean> {
  const info = await saveGame(state, AUTOSAVE_SLOT, { auto: true });
  if (!info) return false;
  // The resume mark is written only once the career it points at is actually
  // stored, so a mark never points at a slot that holds nothing.
  await setResumeSlot(AUTOSAVE_SLOT);
  return true;
}

/** The slot the next page load should open, if any. */
export async function resumeSlot(): Promise<string | null> {
  try {
    const record = await idb.get<{ key: string; value: unknown }>(idb.METADATA, RESUME_KEY);
    return typeof record?.value === 'string' ? record.value : null;
  } catch (error) {
    console.warn('Could not read the resume marker.', error);
    return null;
  }
}

/**
 * Point the next load at a slot, or forget it.
 *
 * Quitting to the menu forgets it — the menu has to stay reachable — but the
 * autosave itself is left alone, so quitting never costs the manager a career.
 */
export async function setResumeSlot(slot: string | null): Promise<void> {
  try {
    if (slot) {
      await idb.put(idb.METADATA, { key: RESUME_KEY, value: slot } satisfies { key: string; value: string });
    } else {
      await idb.deleteKey(idb.METADATA, RESUME_KEY);
    }
  } catch (error) {
    console.warn('Could not update the resume marker.', error);
  }
}

/**
 * The career to open as the game starts.
 *
 * A reload lands the manager back on his own dashboard rather than on the menu.
 * A mark pointing at a save that has gone or will not parse is cleared, so a
 * stale mark cannot lock the game out of its own front door.
 */
export async function resumeCareer(): Promise<GameState | null> {
  const slot = await resumeSlot();
  if (!slot) return null;
  const result = await loadGame(slot);
  if (!result.state) {
    await setResumeSlot(null);
    return null;
  }
  return result.state;
}

export async function loadGame(slot: string): Promise<{ state: GameState | null; error: string | null }> {
  let record: IndexedSaveRecord | undefined;
  try {
    record = await idb.get<IndexedSaveRecord>(idb.SAVES, slot);
  } catch (error) {
    // The storage system failed, which is a different thing from the save being
    // broken, and the manager is told so.
    console.warn(`Reading save "${slot}" failed.`, error);
    return { state: null, error: 'This browser would not give the game its stored careers back.' };
  }

  if (!record) return { state: null, error: 'No save found in that slot.' };

  return readSaveFile(record.file);
}

/**
 * Turn a stored save file into a career the game can play.
 *
 * Shared by the database and by `deserialiseGame`, so both go through exactly
 * the same version check and the same migrations and neither can drift from the
 * other.
 */
function readSaveFile(file: SaveFile): { state: GameState | null; error: string | null } {
  try {
    if (!file || typeof file !== 'object' || !file.state) {
      return { state: null, error: 'That save file is unreadable.' };
    }
    if (typeof file.version !== 'number' || file.version > GAME_STATE_VERSION) {
      return {
        state: null,
        error: `That save was made with a newer version of the game (save v${file.version}, game v${GAME_STATE_VERSION}).`,
      };
    }
    const migrated = migrateSave(file);
    const state = migrated.state;
    if (!state.clubs || !state.userClubId || !state.clubs[state.userClubId]) {
      return { state: null, error: 'That save is missing the club it belongs to.' };
    }
    return { state, error: null };
  } catch {
    return { state: null, error: 'That save file is corrupted.' };
  }
}

export async function listSaveSlots(): Promise<SaveSlotInfo[]> {
  try {
    const records = await idb.getAll<IndexedSaveRecord>(idb.SAVES);
    // The list of what is saved is not a separate index that can drift out of
    // step with the careers themselves — it is whatever is in the store, which
    // is the one thing that cannot disagree with itself.
    return records.map((record) => record.info).filter((info): info is SaveSlotInfo => Boolean(info?.slot));
  } catch (error) {
    console.warn('Could not list the saved careers.', error);
    return [];
  }
}

export async function deleteSave(slot: string): Promise<void> {
  try {
    await enqueueWrite(slot, () => idb.deleteKey(idb.SAVES, slot));
    // A mark pointing at a save that has just been deleted would, on the next
    // load, resolve to nothing and be cleared — but clearing it here means the
    // manager is not relying on that to get back to the menu.
    if ((await resumeSlot()) === slot) await setResumeSlot(null);
  } catch (error) {
    console.warn(`Deleting save "${slot}" failed.`, error);
  }
}

/* ------------------------------------------------------------------------ *
 * Bringing localStorage careers across
 * ------------------------------------------------------------------------ */

/** How the import went, for the console and for the tests to read. */
export interface LegacyMigrationReport {
  /** True when there was nothing to do, or it had already been done. */
  skipped: boolean;
  imported: string[];
  /** Slots that were in localStorage but could not be brought across. */
  failed: string[];
  /** True when every old career that could be read is now in the database. */
  complete: boolean;
}

/**
 * Move careers out of localStorage and into the database, exactly once.
 *
 * The rules this follows, and why:
 *
 *  - **Nothing is deleted.** localStorage is left exactly as it was, as a
 *    fallback for a manager whose browser refuses us the database, and so that a
 *    bad migration is recoverable. It costs a few megabytes and is worth every
 *    byte of it.
 *  - **A slot is only imported if that slot is not already here.** This is what
 *    makes the migration idempotent *and* safe to retry: the flag is written
 *    last, so a migration interrupted halfway leaves no flag and runs again, and
 *    on the second run the slots it already brought across are skipped. It also
 *    means a career the manager has played on since can never be overwritten by
 *    the older copy in localStorage.
 *  - **One bad save does not stop the others.** A career that will not parse is
 *    named in the report and left alone in localStorage; every valid career
 *    still comes across.
 *  - **The flag means "I looked", not "I found something".** With no legacy
 *    keys present the migration still records completion, so a player who has
 *    never used the old storage does not pay for the check on every load.
 */
export async function migrateLegacySaves(): Promise<LegacyMigrationReport> {
  try {
    if ((await idb.get<{ key: string; value: unknown }>(idb.METADATA, LEGACY_MIGRATION_FLAG))?.value === 'complete') {
      return { skipped: true, imported: [], failed: [], complete: true };
    }
  } catch (error) {
    // Without a database there is nothing to migrate into. Not an error worth
    // raising: the game simply starts without memory.
    console.warn('Cannot migrate legacy saves without a database.', error);
    return { skipped: true, imported: [], failed: [], complete: false };
  }

  const store = legacyStorage();
  if (!store) {
    await markLegacyMigrationComplete();
    return { skipped: true, imported: [], failed: [], complete: true };
  }

  const imported: string[] = [];
  const failed: string[] = [];

  // Every career the old storage held, whether or not its index still listed it.
  // The index could itself be stale or half-written, and a career the manager
  // can see in the list must not be the one thing left behind.
  const slots = new Set<string>();
  let legacyIndex: SaveSlotInfo[] = [];
  try {
    const raw = store.getItem(LEGACY_INDEX_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        legacyIndex = parsed.filter(
          (entry): entry is SaveSlotInfo => Boolean(entry) && typeof (entry as SaveSlotInfo).slot === 'string',
        );
        for (const entry of legacyIndex) slots.add(entry.slot);
      }
    }
  } catch {
    // A corrupt index costs us the ordering nicety, not the careers.
    legacyIndex = [];
  }
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(LEGACY_KEY_PREFIX)) slots.add(key.slice(LEGACY_KEY_PREFIX.length));
    }
  } catch {
    // As above: keys unlistable, careers still readable by name.
  }

  for (const slot of slots) {
    // Already in the database, so either this migration ran before or the
    // manager has played on since. Either way the copy here is not better.
    if (await idb.has(idb.SAVES, slot)) continue;

    let raw: string | null = null;
    try {
      raw = store.getItem(LEGACY_KEY_PREFIX + slot);
    } catch {
      failed.push(slot);
      continue;
    }
    if (!raw) {
      // Listed in the index but no career behind it. Nothing to bring across.
      failed.push(slot);
      continue;
    }

    let file: SaveFile;
    try {
      file = JSON.parse(raw) as SaveFile;
      if (!file || typeof file !== 'object' || !file.state || typeof file.version !== 'number') {
        throw new Error('not a save file');
      }
      // A save that could never be loaded anyway is not brought across. The
      // same two things `readSaveFile` insists on are checked here, so a
      // career is never imported only to be refused when the manager opens it.
      const state = file.state as Partial<GameState>;
      if (!state.clubs || !state.userClubId || !state.clubs[state.userClubId]) {
        throw new Error('no club of its own');
      }
    } catch {
      // A corrupt career is reported and left where it is, and the rest carry
      // on. This is the case where aborting would cost the manager everything.
      console.warn(`Legacy career "${slot}" could not be read and was left where it was.`);
      failed.push(slot);
      continue;
    }

    const known = legacyIndex.find((entry) => entry.slot === slot);
    const info: SaveSlotInfo = known ?? describeSlot(file, slot, slot === AUTOSAVE_SLOT);
    try {
      await idb.put(idb.SAVES, { slot, file, info } satisfies IndexedSaveRecord);
      imported.push(slot);
    } catch (error) {
      console.warn(`Legacy career "${slot}" could not be written to the database.`, error);
      failed.push(slot);
    }
  }

  // The resume mark is carried across only if the career it names made it. A
  // mark pointing at a save that never arrived would be cleared on the first
  // resume anyway; not carrying it avoids a pointless load of a slot we know is
  // not there.
  try {
    const legacyResume = store.getItem(LEGACY_RESUME_KEY);
    if (legacyResume && (imported.includes(legacyResume) || (await idb.has(idb.SAVES, legacyResume)))) {
      await setResumeSlot(legacyResume);
    }
  } catch (error) {
    console.warn('Could not carry the resume marker across.', error);
  }

  const complete = failed.length === 0;
  if (complete) await markLegacyMigrationComplete();
  return { skipped: false, imported, failed, complete };
}

async function markLegacyMigrationComplete(): Promise<void> {
  try {
    await idb.put(idb.METADATA, { key: LEGACY_MIGRATION_FLAG, value: 'complete' });
  } catch (error) {
    // Without the flag this runs again next time, which is merely slower: the
    // per-slot skip means it imports nothing the second time.
    console.warn('Could not record that the localStorage migration finished.', error);
  }
}

/**
 * The listing a save would get, built from the save itself.
 *
 * Used only when the old index had no entry for this slot, so there is nothing
 * else to describe it from. Every field is read defensively: this is running
 * over data written by an older build of the game, and a save that is shaped
 * wrongly enough to throw here would take the import of every *other* career
 * down with it.
 */
function describeSlot(file: SaveFile, slot: string, auto: boolean): SaveSlotInfo {
  const state = (file.state ?? {}) as Partial<GameState>;
  const clubs = state.clubs ?? {};
  return {
    slot,
    saveName: state.saveName ?? slot,
    clubName: (state.userClubId ? clubs[state.userClubId]?.identity.name : undefined) ?? 'Unknown club',
    date: state.date ?? '',
    seasonLabel: state.season?.label ?? '',
    savedAt: file.savedAt,
    seed: state.seed ?? '',
    ...(auto ? { auto: true } : {}),
  };
}

/** Used by tests and by "export save" style features. */
export function serialiseGame(state: GameState): string {
  return JSON.stringify({ version: GAME_STATE_VERSION, savedAt: new Date().toISOString(), state } satisfies SaveFile);
}

export function deserialiseGame(raw: string): { state: GameState | null; error: string | null } {
  let file: SaveFile;
  try {
    file = JSON.parse(raw) as SaveFile;
  } catch {
    return { state: null, error: 'Unreadable save data.' };
  }
  if (typeof file.version !== 'number' || file.version > GAME_STATE_VERSION) {
    return { state: null, error: 'Version mismatch.' };
  }
  // The same reader the database goes through, so an exported string and a
  // stored career are held to exactly the same version check and migrations.
  return readSaveFile(file);
}
