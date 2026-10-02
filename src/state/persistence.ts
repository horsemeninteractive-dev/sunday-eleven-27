import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import type { Player, PlayerDevelopment } from '@/domain/person';
import { birthdayForAge, type ManagerProfile } from '@/domain/manager';
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
import { ensureTrainingState, pruneTrainingHistory, trainingStore } from '@/simulation/training/store';
import { overallAbility } from '@/simulation/training/development';
import { buildSeasonCalendarWithCups, yearOf } from '@/simulation/calendar';
import { matchdayCount } from '@/simulation/generation/fixtureGenerator';
import { drawCupRound, cupRoundSlots, newCupState, seedOrder } from '@/simulation/cup';
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

/** The competition id a version 7 save used for its one league. */
const OLD_LEAGUE_ID: CompetitionId = 'comp_league_1';

/**
 * Local save slots.
 *
 * The whole simulation state is plain JSON, so saving is a stringify and
 * loading is a parse plus a version check. Presentation state is deliberately
 * never saved: on load the UI is rebuilt from the simulation.
 */

// The storage keys keep their original prefix. They are invisible to the
// manager, and renaming them would orphan every career already in the browser.
const KEY_PREFIX = 'slfm26.save.';
const INDEX_KEY = 'slfm26.saves';
/**
 * The slot the game keeps up to date by itself. It is a slot like any other —
 * the manager can load it, and it is listed alongside his own — but nothing
 * writes to it except the autosave.
 */
export const AUTOSAVE_SLOT = 'autosave';
/** Whether the next page load should open the career rather than the menu. */
const RESUME_KEY = 'slfm26.resume';

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

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
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
 * Write, or say that it did not happen.
 *
 * A full browser quota throws, and a career being autosaved in the background
 * must never throw into whatever the manager was actually doing.
 */
function write(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
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
 *    given an empty record of it.
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

  // A career that predates training has no session history, no plans and no
  // per-player familiarity: all three are rebuilt from the world itself, so the
  // save wakes up with the squad it would have had if training had always been
  // in the build.
  ensureTrainingState(state);
  pruneTrainingHistory(state);
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
      cup: newCupState(),
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
        cup: newCupState(LEAGUE_CUP_ID),
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

/** Write a career to a slot. Returns null if the browser would not store it. */
export function saveGame(
  state: GameState,
  slot: string,
  options: { auto?: boolean } = {},
): SaveSlotInfo | null {
  const file: SaveFile = { version: GAME_STATE_VERSION, savedAt: new Date().toISOString(), state };
  const info: SaveSlotInfo = {
    slot,
    saveName: state.saveName,
    clubName: state.clubs[state.userClubId]?.identity.name ?? 'Unknown club',
    date: state.date,
    seasonLabel: state.season.label,
    savedAt: file.savedAt,
    seed: state.seed,
    ...(options.auto ? { auto: true } : {}),
  };

  const store = storage();
  if (!store) return null;
  if (!write(store, KEY_PREFIX + slot, JSON.stringify(file))) return null;
  const index = listSaveSlots().filter((entry) => entry.slot !== slot);
  index.push(info);
  write(store, INDEX_KEY, JSON.stringify(index));
  return info;
}

/**
 * The career the manager is playing, written as he plays it.
 *
 * A Sunday league season is played in ten-minute bursts between everything
 * else, so needing to remember to save is a way to lose a month. This keeps a
 * copy of the live career and marks it as the one to reopen, while leaving the
 * manager's own slots exactly as he left them.
 */
export function autosave(state: GameState): boolean {
  if (!saveGame(state, AUTOSAVE_SLOT, { auto: true })) return false;
  setResumeSlot(AUTOSAVE_SLOT);
  return true;
}

/** The slot the next page load should open, if any. */
export function resumeSlot(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}

/**
 * Point the next load at a slot, or forget it.
 *
 * Quitting to the menu forgets it — the menu has to stay reachable — but the
 * autosave itself is left alone, so quitting never costs the manager a career.
 */
export function setResumeSlot(slot: string | null): void {
  const store = storage();
  if (!store) return;
  if (slot) write(store, RESUME_KEY, slot);
  else {
    try {
      store.removeItem(RESUME_KEY);
    } catch {
      // Nothing was marked, or the browser refuses to touch it: either way
      // there is nothing left to do.
    }
  }
}

/**
 * The career to open as the game starts.
 *
 * A reload lands the manager back on his own dashboard rather than on the menu.
 * A mark pointing at a save that has gone or will not parse is cleared, so a
 * stale mark cannot lock the game out of its own front door.
 */
export function resumeCareer(): GameState | null {
  const slot = resumeSlot();
  if (!slot) return null;
  const result = loadGame(slot);
  if (!result.state) {
    setResumeSlot(null);
    return null;
  }
  return result.state;
}

export function loadGame(slot: string): { state: GameState | null; error: string | null } {
  const store = storage();
  if (!store) return { state: null, error: 'Local storage is unavailable in this browser.' };
  const raw = store.getItem(KEY_PREFIX + slot);
  if (!raw) return { state: null, error: 'No save found in that slot.' };

  try {
    const file = JSON.parse(raw) as SaveFile;
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

export function listSaveSlots(): SaveSlotInfo[] {
  const store = storage();
  if (!store) return [];
  const raw = store.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SaveSlotInfo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function deleteSave(slot: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY_PREFIX + slot);
  } catch {
    // Nothing stored under that slot to begin with.
  }
  write(store, INDEX_KEY, JSON.stringify(listSaveSlots().filter((entry) => entry.slot !== slot)));
  if (resumeSlot() === slot) setResumeSlot(null);
}

/** Used by tests and by "export save" style features. */
export function serialiseGame(state: GameState): string {
  return JSON.stringify({ version: GAME_STATE_VERSION, savedAt: new Date().toISOString(), state } satisfies SaveFile);
}

export function deserialiseGame(raw: string): { state: GameState | null; error: string | null } {
  try {
    const file = JSON.parse(raw) as SaveFile;
    if (typeof file.version !== 'number' || file.version > GAME_STATE_VERSION) {
      return { state: null, error: 'Version mismatch.' };
    }
    return { state: migrateSave(file).state, error: null };
  } catch {
    return { state: null, error: 'Unreadable save data.' };
  }
}
