import type { Competition } from '@/domain/competition';
import type { GameState, StandingSnapshot } from '@/domain/game';
import { GAME_STATE_VERSION } from '@/domain/game';
import { emptyRecruitmentStore } from '@/domain/recruitment';
import { emptyTrainingStore } from '@/domain/training';
import type { ClubId, GroundId, ISODate, MatchId, PersonId, TownId } from '@/domain/ids';
import type { Club, ClubStructure, LedgerCategory } from '@/domain/club';
import { compactBadge, type BadgeChoice } from '@/domain/badge';
import type { GroundSurface } from '@/domain/world';
import { ageOn, birthdayForAge, type ManagerProfile } from '@/domain/manager';
import type { Match } from '@/domain/match';
import { isPlayer, type Official, type Person, type Player } from '@/domain/person';
import { defaultTactics } from '@/domain/tactics';
import { buildSeasonCalendar, kickOffTimeFor, preSeasonStart, seasonLabelFor, toDate, toISO, addDays } from './calendar';
import { weekStartOf } from './timeline';
import { emptyScheduleState } from '@/domain/events';
import { createMatchRecord, prepareMatchday } from './matchday';
import { arrangePreSeason } from './preseason';
import { buildFixtureList, generateFixtures, matchdayCount } from './generation/fixtureGenerator';
import { generateReferees, generateWorld, reputationFromQuality } from './generation/worldGenerator';
import { generateSquad } from './generation/playerGenerator';
import { generateInitialRelationships, linkManagerToClub } from './generation/relationshipGenerator';
import { generateUnattachedPlayers } from './generation/unattachedPlayers';
import { relationshipStore } from './relationships';
import { maybeNickname, occupation, personFirstName, personSurname } from './generation/names';
import { createEvent, publishEvents } from './news';
import { rollAvailability } from './availability';
import { applyWeeklyFinances } from './finance';
import { ensureTrainingState } from './training/store';
import { abilityMean } from './queries';
import { computeStandings, positionOf } from './league';
import { matchdaysPlayed } from './timeline';
import { Rng, stream } from './rng';

/**
 * Game setup: generate a world, put one division in it, build a season and
 * hand the player a club to manage. Everything produced here is plain data —
 * no class instances, no functions — so state saves and loads cleanly.
 */

export interface WorldDraft {
  world: GameState['world'];
  clubs: GameState['clubs'];
  people: GameState['people'];
  /** The initial social network, generated with the world. */
  relationships: GameState['relationships'];
  divisionClubIds: ClubId[];
  leagueName: string;
  seed: string;
  startYear: number;
  /** The Monday pre-season begins: the day every career starts. */
  seasonStart: ISODate;
}

export interface NewGameOptions {
  seed: string;
  startYear?: number;
  createdAt?: ISODate;
}

export function firstSundayOfSeptember(year: number): ISODate {
  const first = toDate(`${year}-09-01`);
  const day = first.getUTCDay();
  const offset = day === 0 ? 0 : 7 - day;
  first.setUTCDate(first.getUTCDate() + offset);
  return toISO(first);
}

function randomTactics(rng: Rng) {
  const formations = ['4-4-2', '4-4-1-1', '4-3-3', '4-2-3-1', '4-5-1', '4-1-4-1', '3-5-2', '5-3-2'] as const;
  return {
    ...defaultTactics(rng.pick(formations)),
    mentality: rng.pick(['defensive', 'balanced', 'balanced', 'attacking'] as const),
    passingStyle: rng.pick(['short', 'mixed', 'mixed', 'direct'] as const),
    tempo: rng.pick(['slow', 'standard', 'standard', 'high'] as const),
    pressing: rng.pick(['low', 'medium', 'medium', 'high'] as const),
    defensiveLine: rng.pick(['deep', 'standard', 'standard', 'high'] as const),
    attackingFocus: rng.pick(['wide', 'balanced', 'balanced', 'central'] as const),
  };
}

/** Generate the world without committing to a club — used by club selection. */
export function generateDraft(options: NewGameOptions): WorldDraft {
  const startYear = options.startYear ?? 2026;
  // Everything the world carries that is dated — who knows whom, who is not
  // playing anywhere — is dated from the day the career begins, which is the
  // start of pre-season rather than the first Sunday of the league.
  const seasonStart = weekStartOf(preSeasonStart(firstSundayOfSeptember(startYear)));
  const generated = generateWorld({ seed: options.seed, seasonStart, currentYear: startYear });

  const referees = generateReferees(new Rng(`${options.seed}::referees`), Object.values(generated.world.towns));
  const people: Record<PersonId, Person> = { ...generated.people };
  for (const referee of referees) people[referee.id] = referee;

  // Lads who are not playing this season. They live in the towns, they know
  // people, and they are only ever found through somebody or something.
  const unattached = generateUnattachedPlayers({
    seed: options.seed,
    towns: Object.values(generated.world.towns),
    date: seasonStart,
    idPrefix: 'start',
  });
  for (const player of unattached) people[player.id] = player;

  for (const club of Object.values(generated.clubs)) {
    club.tactics = randomTactics(new Rng(`${options.seed}::tactics::${club.id}`));
  }

  // Nobody starts socially isolated: the world arrives with its own network of
  // teammates, old clubs, workplaces and villages already in place.
  const relationships = generateInitialRelationships({
    seed: options.seed,
    people,
    clubs: generated.clubs,
    date: seasonStart,
  });

  return {
    world: generated.world,
    clubs: generated.clubs,
    people,
    relationships,
    divisionClubIds: generated.divisionClubIds,
    leagueName: generated.leagueName,
    seed: options.seed,
    startYear,
    seasonStart,
  };
}

function createUserManager(
  draft: WorldDraft,
  clubId: ClubId,
  seasonStart: ISODate,
  profile?: ManagerProfile,
): Official {
  const rng = new Rng(`${draft.seed}::user-manager`);
  const club = draft.clubs[clubId]!;
  // A manager who introduced himself by name keeps it; one who did not is given
  // a plausible local identity by the same seeded roll every time.
  const named = Boolean(profile && profile.firstName.trim() && profile.surname.trim());
  const age = profile && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthday)
    ? Math.max(18, Math.min(75, ageOn(profile.birthday, seasonStart)))
    : rng.gaussianInt(38, 8, 24, 62);
  return {
    id: 'user_manager',
    kind: 'official',
    firstName: named ? profile!.firstName.trim() : personFirstName(rng),
    surname: named ? profile!.surname.trim() : personSurname(rng),
    nickname: profile?.nickname.trim() ? profile.nickname.trim() : maybeNickname(rng, 0.15),
    age,
    townId: club.townId,
    occupation: profile?.occupation.trim() ? profile.occupation.trim() : occupation(rng),
    reputation: 20,
    roles: [{ clubId, role: 'manager', since: seasonStart }],
    role: 'manager',
    clubId,
    attributes: {
      coaching: rng.gaussianInt(10, 3, 3, 18),
      manManagement: rng.gaussianInt(10, 3, 3, 18),
      motivation: rng.gaussianInt(10, 3, 3, 18),
      tacticalKnowledge: rng.gaussianInt(10, 3, 3, 18),
      recruitmentEye: rng.gaussianInt(10, 3, 3, 18),
      organisation: rng.gaussianInt(10, 3, 3, 18),
    },
    patience: 12,
    notes: ['First season in charge.'],
  };
}

/**
 * The profile stored on the career.
 *
 * Whatever the manager told us he is wins; anything he left blank is filled in
 * from the official the world just built, so the career always has a complete
 * identity to show and to age.
 */
function managerProfileFor(
  manager: Official,
  provided: ManagerProfile | undefined,
  seasonStart: ISODate,
): ManagerProfile {
  return {
    firstName: manager.firstName,
    surname: manager.surname,
    nickname: manager.nickname ?? provided?.nickname.trim() ?? '',
    birthday:
      provided && /^\d{4}-\d{2}-\d{2}$/.test(provided.birthday)
        ? provided.birthday
        : birthdayForAge(manager.age, seasonStart),
    occupation: manager.occupation,
    hometown: provided?.hometown.trim() ?? '',
  };
}

/** Availability is rolled per player per week from their life circumstances. */
export function rollWeeklyAvailabilityForAll(state: GameState): void {
  for (const person of Object.values(state.people)) {
    if (!isPlayer(person)) continue;
    const player: Player = person;
    if (player.injury && player.injury.daysOut > 0) {
      player.availability = {
        status: 'unavailable',
        reason: 'injury',
        note: `Out with ${player.injury.description}`,
        until: addDays(state.date, player.injury.daysOut),
        discoveredLate: false,
      };
      continue;
    }
    const club = player.clubId ? state.clubs[player.clubId] : undefined;
    const rng = stream(state.seed, 'availability', state.date, player.id);
    player.availability = rollAvailability({
      rng,
      player,
      date: state.date,
      matchDate: null,
      clubOrganisation: club ? 10 : 8,
    });
  }
}

export function snapshotStandings(state: GameState): StandingSnapshot {
  const competition = Object.values(state.competitions)[0]!;
  const rows = computeStandings({
    clubIds: competition.clubIds,
    matches: Object.values(state.matches),
    competitionId: competition.id,
    clubName: (id) => state.clubs[id]?.identity.name ?? id,
  });
  return {
    date: state.date,
    matchday: matchdaysPlayed(state) + 1,
    rows,
    playerClubPosition: positionOf(rows, state.userClubId),
  };
}

export interface StartGameOptions extends NewGameOptions {
  clubId: ClubId;
  saveName: string;
  /** The manager's own identity, defined before he picks a club. */
  manager?: ManagerProfile;
}

/**
 * The backing the manager can put behind a brand-new club.
 *
 * Reputation is the number the rest of the local game judges a club by, and a
 * club cannot award itself one: it earns it with the players it gets on the
 * pitch. What the manager chooses here is therefore not a standing but a pot —
 * what the league, the committee and whatever sponsor he has talked round will
 * put up to form the club. The pot buys the squad, and the squad is what the
 * standing is worked out from.
 *
 * The rungs are sized so each one up the ladder unlocks a standard the one
 * below it cannot reach: a whip-round buys a full squad of mid-table players, a
 * moneyed club can just about stretch to a handful of ringers — but never a
 * full squad of them.
 */
export type ClubBacking = 'whip-round' | 'modest' | 'well-backed' | 'moneyed';

export interface ClubBackingOption {
  id: ClubBacking;
  label: string;
  /** What the club has to put a squad together, in pounds. */
  grant: number;
  blurb: string;
}

export const CLUB_BACKINGS: ClubBackingOption[] = [
  {
    id: 'whip-round',
    label: 'Whip-round',
    grant: 3280,
    blurb: 'A collection in the pub and a lot of goodwill. Every signing has to be a bargain.',
  },
  {
    id: 'modest',
    label: 'Modest backing',
    grant: 3980,
    blurb: 'Enough to put a proper side out, as long as nobody expects a star.',
  },
  {
    id: 'well-backed',
    label: 'Well backed',
    grant: 4680,
    blurb: 'The committee has money behind it, and will want to see it on the pitch.',
  },
  {
    id: 'moneyed',
    label: 'Moneyed',
    grant: 5380,
    blurb: 'A sponsor with deep pockets. The only question left is how you spend it.',
  },
];

/** What the chosen backing puts up; modest if it is unknown. */
export function backingGrant(id: ClubBacking): number {
  return CLUB_BACKINGS.find((option) => option.id === id)?.grant ?? CLUB_BACKINGS[1]!.grant;
}

/**
 * The standard of player the manager is buying.
 *
 * A new club does not inherit a squad, so it has to put one together, and the
 * only real decision is what sort of footballer it is paying for: the lads who
 * play for the game and the pint, or the ringers the whole division is after.
 */
export type SquadStandard = 'pub-side' | 'mid-table' | 'contenders' | 'ringers';

export interface SquadStandardOption {
  id: SquadStandard;
  label: string;
  /** The mean attribute value the players signed at this standard are built around. */
  quality: number;
  /** What one player at this standard costs to bring in. */
  feePerPlayer: number;
  blurb: string;
}

export const SQUAD_STANDARDS: SquadStandardOption[] = [
  {
    id: 'pub-side',
    label: 'Pub side',
    quality: 9.1,
    feePerPlayer: 70,
    blurb: 'Turn up, play, drink up. They will give you everything except a moment of quality.',
  },
  {
    id: 'mid-table',
    label: 'Mid-table',
    quality: 10.1,
    feePerPlayer: 120,
    blurb: 'Proper Sunday footballers. Nobody wins the league with a squad like this, but nobody beats it easily either.',
  },
  {
    id: 'contenders',
    label: 'Contenders',
    quality: 11.1,
    feePerPlayer: 190,
    blurb: 'Good players who decide games on their own. They cost like it, and there are fewer of them.',
  },
  {
    id: 'ringers',
    label: 'Ringers',
    quality: 12.1,
    feePerPlayer: 290,
    blurb: 'The best in the area, and they know it when the money is mentioned. Afford very few of them.',
  },
];

/** A squad needs eleven and a bench; the smallest a Sunday club can run with. */
export const MIN_SQUAD_SIZE = 18;
export const MAX_SQUAD_SIZE = 25;

export function squadStandardOption(id: SquadStandard): SquadStandardOption {
  return SQUAD_STANDARDS.find((option) => option.id === id) ?? SQUAD_STANDARDS[1]!;
}

export function clampSquadSize(size: number): number {
  const rounded = Number.isFinite(size) ? Math.round(size) : MIN_SQUAD_SIZE;
  return Math.max(MIN_SQUAD_SIZE, Math.min(MAX_SQUAD_SIZE, rounded));
}

/** What it costs to bring in that many players at that standard. */
export function squadCost(standard: SquadStandard, size: number): number {
  return squadStandardOption(standard).feePerPlayer * clampSquadSize(size);
}

/**
 * The standing a squad of that quality is worth.
 *
 * Averages are read on the same 1-20 scale the whole world uses for player
 * quality, so the world's own reputation-to-quality curve read backwards is the
 * honest answer to "what sort of club has these players?". A side that ranks
 * bottom of the division cannot be a favourite, however deep its pockets were.
 */
export function reputationFromAbility(mean: number): number {
  return clampReputation(reputationFromQuality(mean));
}

/** The standing the squad the manager actually bought is worth. */
export function squadReputation(players: readonly Player[]): number {
  const signed = players.filter(isPlayer);
  if (signed.length === 0) return clampReputation(0);
  const mean = signed.reduce((sum, player) => sum + abilityMean(player), 0) / signed.length;
  return reputationFromAbility(mean);
}

/**
 * A club the manager builds himself.
 *
 * Sunday League clubs come and go, and a new one appears in the division every
 * so often — usually the pub side that suddenly reforms, or a group of lads
 * who want their own name on the shirts. Rather than a fifteenth club with a
 * bye every week, the new club takes the place of the weakest one, inheriting
 * its registration in the league but assembling everything else for itself.
 */
export interface ClubDesign {
  name: string;
  shortName: string;
  nickname: string;
  motto: string;
  foundedYear: number;
  primary: string;
  secondary: string;
  structure: ClubStructure;
  townId: TownId;
  groundName: string;
  capacity: number;
  surface: GroundSurface;
  /** What the club's backers will put up to form a squad with. */
  backing: ClubBacking;
  /** How the manager chooses to spend that standing's budget on players. */
  squadStandard: SquadStandard;
  /** How many players he signs with it. */
  squadSize: number;
  /**
   * The badge he designed, if he designed one. Left out, the club is drawn the
   * badge the generator would have given any other club in the world.
   */
  badge?: BadgeChoice;
}

/**
 * The club a new side displaces: the weakest in the division.
 *
 * Ties are settled by id so the same seed always rebuilds the same world — and
 * so the club designer can name the side being replaced before the manager has
 * committed to replacing it.
 */
export function displacedClubId(draft: WorldDraft): ClubId {
  return [...draft.divisionClubIds].sort((a, b) => {
    const diff = (draft.clubs[a]?.reputation ?? 0) - (draft.clubs[b]?.reputation ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  })[0]!;
}

/** The standing a new club can actually live with, whatever was asked for. */
export function clampReputation(value: number): number {
  return Math.max(20, Math.min(80, Math.round(value)));
}

/**
 * Hand the new club its pot, then pay for the squad out of it.
 *
 * `addLedgerEntry` in the finance service wants a whole `GameState` — it mints
 * each entry's id from the state's counters — and there is no state yet: the
 * club is being built into a draft that has not become a career. So the same
 * arithmetic is done here, in two lines the manager can read in full in the
 * treasurer's book: the grant came in, the players went out.
 */
function fundFormation(
  club: Club,
  date: ISODate,
  grant: number,
  standard: SquadStandard,
  size: number,
): void {
  const spend = squadCost(standard, size);
  club.finances.balance = 0;
  club.finances.ledger = [];
  recordLedgerLine(club, date, 'Formation grant from the league and the committee.', 'other', grant);
  recordLedgerLine(club, date, `Brought in ${size} players to form the squad.`, 'signing', -spend);
}

function recordLedgerLine(
  club: Club,
  date: ISODate,
  description: string,
  category: LedgerCategory,
  amount: number,
): void {
  club.finances.balance = Math.round((club.finances.balance + amount) * 100) / 100;
  club.finances.ledger.push({
    id: `ledger_${club.finances.ledger.length + 1}_${club.id}`,
    date,
    description,
    category,
    amount,
    balanceAfter: club.finances.balance,
  });
}

/**
 * The squad the manager's money buys him.
 *
 * A club id is asked for rather than worked out here, because by the time the
 * club is being built the weakest side has already been re-rated — and the
 * answer to "which club is this squad for" must not change half way through.
 * Generated from the seed alone, so it is the same squad every time, which is
 * what lets the designer show the manager the players before he takes them on.
 */
function buildCustomSquad(
  draft: WorldDraft,
  clubId: ClubId,
  standard: SquadStandard,
  size: number,
  townId: TownId,
): Player[] {
  const groundId: GroundId = `ground_custom_${clubId}`;
  const wanted = clampSquadSize(size);
  return generateSquad({
    rng: new Rng(`${draft.seed}::custom-squad::${clubId}`),
    clubId,
    townId,
    homeGroundId: groundId,
    // The standard is what was paid for, exactly — the individual players vary
    // around it the way they do in any other squad in the world.
    quality: squadStandardOption(standard).quality,
    seasonStart: draft.seasonStart,
    idSeedPrefix: `${clubId}_new`,
    size: wanted,
  });
}

/**
 * The squad a new club would be given, for a world nobody has changed yet.
 *
 * This is what the club designer reads: the same function the career itself
 * uses, pointed at the same club and the same shopping list, so the squad
 * previewed on the way in is the squad on the teamsheet on the way out.
 */
export function squadForCustomClub(
  draft: WorldDraft,
  design: Pick<ClubDesign, 'squadStandard' | 'squadSize' | 'townId'>,
): Player[] {
  return buildCustomSquad(draft, displacedClubId(draft), design.squadStandard, design.squadSize, design.townId);
}

/**
 * Fold the manager's club into the world and return the id he will manage.
 *
 * The new club takes over the displaced side's registration — the league still
 * needs a club in that slot — but nothing else of it. Its players go with the
 * old name, and a fresh squad is generated to the standard the manager's chosen
 * backing paid for, with its own dressing-room relationships, so he begins with
 * his own players rather than inheriting somebody else's.
 */
export function applyCustomClub(draft: WorldDraft, design: ClubDesign): ClubId {
  const baseId = displacedClubId(draft);
  const club = draft.clubs[baseId]!;

  const groundId: GroundId = `ground_custom_${baseId}`;
  const ground = draft.world.grounds[club.groundId];
  draft.world.grounds[groundId] = {
    ...(ground ?? {
      id: groundId,
      name: design.groundName,
      townId: design.townId,
      tenantClubId: baseId,
      capacity: design.capacity,
      surface: design.surface,
      quality: 9,
      drainage: 9,
      hasFloodlights: false,
      hasChangingRooms: true,
      hasClubhouse: false,
      matchdayCost: 45,
      sharedWith: [],
    }),
    id: groundId,
    name: design.groundName.trim() || `${design.name.trim()} Recreation Ground`,
    townId: design.townId,
    tenantClubId: baseId,
    capacity: Math.max(50, Math.min(20000, Math.round(design.capacity))),
    surface: design.surface,
  };
  if (!draft.world.groundIds.includes(groundId)) draft.world.groundIds.push(groundId);

  club.identity = {
    ...club.identity,
    name: design.name.trim(),
    shortName: design.shortName.trim() || design.name.trim().slice(0, 18),
    nickname: design.nickname.trim() || design.shortName.trim() || design.name.trim(),
    motto: design.motto.trim() || club.identity.motto,
    foundedYear: Math.min(new Date().getUTCFullYear(), Math.max(1850, Math.round(design.foundedYear))),
    colours: { primary: design.primary, secondary: design.secondary },
  };
  // What he drew on the badge, if he drew anything. Anything he left alone is
  // left out rather than stored as a default, so the drawing code still makes
  // that part of it the way it would for any other club.
  const badge = compactBadge(design.badge);
  if (badge) club.badge = badge;
  club.townId = design.townId;
  club.groundId = groundId;
  club.structure = design.structure;
  club.history.founded = club.identity.foundedYear;

  // Out with the old: the displaced club's players go with it rather than being
  // inherited, so the manager starts with his own dressing room. If the side
  // was run by a player-manager he goes with them, and the club is between
  // managers until the career starts.
  for (const playerId of club.squadIds) delete draft.people[playerId];
  if (club.managerId && !draft.people[club.managerId]) club.managerId = null;

  // In with the new: the squad the manager's budget actually bought him, aged
  // and shaped like every other side in the division — the very one the
  // designer showed him before he committed.
  const squad = buildCustomSquad(draft, baseId, design.squadStandard, design.squadSize, design.townId);
  for (const player of squad) draft.people[player.id] = player;
  club.squadIds = squad.map((player) => player.id);

  // And the standing that squad earns. A club is judged on its players rather
  // than on the money that bought them, so a side that spent a fortune on
  // journeymen is a makeweight and one that bought ringers is a favourite —
  // whatever either of them claimed before it went shopping.
  club.reputation = squadReputation(squad);

  // And what it cost him. The pot is the club's starting balance, so a manager
  // who signs fewer, or cheaper, begins the season with money in the bank: the
  // first real decision of the career is made before it starts.
  fundFormation(club, draft.seasonStart, backingGrant(design.backing), design.squadStandard, squad.length);

  // A new dressing room needs a new social network. The relationships are
  // rebuilt from the same seed around the new squad, so the lads know each
  // other, know the committee, and still cross paths with the rest of the
  // league the way any other club's players do.
  draft.relationships = generateInitialRelationships({
    seed: draft.seed,
    people: draft.people,
    clubs: draft.clubs,
    date: draft.seasonStart,
  });

  return baseId;
}

export function startGameFromDraft(draft: WorldDraft, options: StartGameOptions): GameState {
  // The league starts on the first Sunday of September; pre-season begins six
  // Sundays before it, and the manager starts on the Monday of that week.
  const firstLeagueDate = firstSundayOfSeptember(draft.startYear);
  const firstPreSeasonSunday = preSeasonStart(firstLeagueDate);
  const seasonStart = weekStartOf(firstPreSeasonSunday);
  const seasonId = `season_${draft.startYear}_${String((draft.startYear + 1) % 100).padStart(2, '0')}`;
  const seasonLabel = seasonLabelFor(firstLeagueDate);
  const competitionId = 'comp_league_1';

  const divisionClubIds = [...draft.divisionClubIds];
  const competition: Competition = {
    id: competitionId,
    name: draft.leagueName,
    kind: 'league',
    tier: 1,
    seasonId,
    clubIds: divisionClubIds,
    promotionPlaces: 1,
    relegationPlaces: 2,
  };

  const calendar = buildSeasonCalendar(firstLeagueDate, matchdayCount(divisionClubIds.length));
  const fixtureRng = new Rng(`${draft.seed}::fixtures::${seasonId}`);
  const generatedFixtures = generateFixtures(fixtureRng, divisionClubIds);

  const clubs = draft.clubs;
  const people = { ...draft.people };
  const userManager = createUserManager(draft, options.clubId, seasonStart, options.manager);
  people[userManager.id] = userManager;
  const userClub = clubs[options.clubId]!;
  const previousManagerId = userClub.managerId;
  userClub.managerId = userManager.id;
  userClub.history.managers.unshift({
    personId: userManager.id,
    name: `${userManager.firstName} ${userManager.surname}`,
    from: seasonStart,
    to: null,
  });
  userClub.tactics = defaultTactics('4-4-2');

  const state: GameState = {
    version: GAME_STATE_VERSION,
    saveId: `save_${draft.seed}_${options.clubId}`,
    saveName: options.saveName,
    createdAt: options.createdAt ?? toISO(new Date()),
    seed: draft.seed,
    // A career starts on the manager's first Monday, at the beginning of
    // pre-season — not on the morning of the first league game.
    date: seasonStart,
    phase: 'season',
    // The day he arrives is already in front of him: the clock should not stop
    // on it before it has moved at all.
    schedule: { ...emptyScheduleState(), notifiedThrough: seasonStart },
    season: {
      id: seasonId,
      label: seasonLabel,
      startDate: seasonStart,
      endDate: calendar[calendar.length - 1]!.date,
      calendar,
      finished: false,
    },
    world: draft.world,
    clubs,
    people,
    relationships: structuredClone(draft.relationships),
    recruitment: emptyRecruitmentStore(),
    training: emptyTrainingStore(),
    competitions: { [competitionId]: competition },
    fixtures: { competitionId, byMatchday: {}, matchdayOf: {} },
    matches: {},
    userClubId: options.clubId,
    managerProfile: managerProfileFor(userManager, options.manager, seasonStart),
    matchOrder: [],
    news: [],
    standingHistory: [],
    settings: { complexity: 'standard', autoAdvanceMatches: false },
    lastMatchId: null,
    pendingMatchId: null,
    counters: {},
  };

  const matches: Record<MatchId, Match> = {};
  const ordered: MatchId[] = [];
  generatedFixtures.forEach((fixture, index) => {
    const matchId = `match_${index + 1}`;
    const date = calendar[fixture.matchday - 1]!.date;
    matches[matchId] = createMatchRecord({
      state,
      id: matchId,
      matchday: fixture.matchday,
      date,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      competitionId,
      competitionName: competition.name,
      kickOff: kickOffTimeFor(date),
    });
    ordered.push(matchId);
  });

  state.matches = matches;
  state.matchOrder = ordered;
  state.fixtures = buildFixtureList(competitionId, generatedFixtures, (_fixture, index) => ordered[index]!);

  for (const clubId of divisionClubIds) {
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
  }

  // The new manager arrives with no history, so he starts from scratch: he
  // gets to know his own dressing room first and knows nobody else yet.
  const store = relationshipStore(state);
  linkManagerToClub(store, draft.seed, userClub, userManager.id, people, seasonStart);

  // The man who was in charge until last week is now exactly that: a former
  // manager, and the players' relationships with him should read that way.
  if (previousManagerId && previousManagerId !== userManager.id) {
    for (const id of store.byPerson[previousManagerId] ?? []) {
      const relationship = store.byId[id];
      if (!relationship || relationship.origin !== 'player-manager') continue;
      relationship.origin = 'former-manager';
      relationship.context = `Former manager at ${userClub.identity.shortName}`;
    }
  }

  rollWeeklyAvailabilityForAll(state);
  // Thursday nights: every club has a routine, and the manager inherits his.
  ensureTrainingState(state, seasonStart);

  const openingOpponent = opponentOfFirstFixture(state, options.clubId);
  publishEvents(state, [
    createEvent(state, {
      type: 'season-milestone',
      importance: 3,
      clubIds: [options.clubId],
      data: {
        headline: `${seasonLabel} season begins`,
        body: `${userClub.identity.name} are in ${competition.name}. First up: ${
          openingOpponent ? `${openingOpponent.identity.name}` : 'the opening fixture'
        }. The new manager takes charge with ${userClub.squadIds.length} registered players.`,
      },
    }),
    createEvent(state, {
      type: 'club-news',
      importance: 2,
      clubIds: [options.clubId],
      data: {
        headline: `Welcome to ${userClub.identity.name}`,
        body: `${userClub.identity.nickname}, founded ${userClub.identity.foundedYear}. Home games at ${
          state.world.grounds[userClub.groundId]?.name ?? 'the club ground'
        }. Squad of ${userClub.squadIds.length}. ${userClub.identity.motto}`,
      },
    }),
    createEvent(state, {
      type: 'club-news',
      importance: 1,
      clubIds: [options.clubId],
      data: {
        headline: `New kit for ${seasonLabel}`,
        body: 'This summer\u2019s shirts have turned up. Three designs came down with the kit deal \u2014 pick the one the club runs out in before the league starts.',
      },
    }),
  ]);

  // The summer's friendlies: arranged before the manager's first morning, so
  // there is a squad to look at and something to play before the league starts.
  arrangePreSeason(state, options.clubId, firstPreSeasonSunday);

  applyWeeklyFinances(state, options.clubId);
  prepareMatchday(state, 1);
  state.standingHistory.push(snapshotStandings(state));

  return state;
}

function opponentOfFirstFixture(state: GameState, clubId: ClubId) {
  const match = Object.values(state.matches).find(
    (candidate) => candidate.matchday === 1 && (candidate.homeClubId === clubId || candidate.awayClubId === clubId),
  );
  if (!match) return null;
  const opponentId = match.homeClubId === clubId ? match.awayClubId : match.homeClubId;
  return state.clubs[opponentId] ?? null;
}
