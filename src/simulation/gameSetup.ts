import { DEFAULT_PYRAMID, FOUNDING_PYRAMID_ID, type Pyramid, type PyramidConfig } from '@/domain/competition';
import type { DistrictDefinition } from '@/domain/districts';
import { FOUNDING_REGION_ID } from '@/domain/world';
import type { GameState, StandingSnapshot } from '@/domain/game';
import { GAME_STATE_VERSION } from '@/domain/game';
import { emptyAdminState } from '@/domain/admin';
import { emptyGovernanceState } from '@/domain/governance';
import { emptyCareerState } from '@/domain/career';
import { emptyFacilitiesState } from '@/domain/facilities';
import { emptyFundraisingState } from '@/domain/fundraising';
import { emptySponsorshipState } from '@/domain/sponsorship';
import { seedInitialSponsorship } from './sponsorship';
import { emptyCommunicationStore } from '@/domain/communication';
import { emptyRecruitmentStore } from '@/domain/recruitment';
import { emptyTrainingStore } from '@/domain/training';
import type { ClubId, GroundId, ISODate, PersonId, PyramidId, RegionId, TownId } from '@/domain/ids';
import type { Club, ClubStructure, LedgerCategory } from '@/domain/club';
import { compactBadge, type BadgeChoice } from '@/domain/badge';
import type { GroundSurface } from '@/domain/world';
import { ageOn, birthdayForAge, type ManagerProfile } from '@/domain/manager';
import { isPlayer, type Official, type Person, type Player } from '@/domain/person';
import { defaultTactics } from '@/domain/tactics';
import { styleTactics } from './ai/style';
import { preSeasonStart, seasonLabelFor, toDate, toISO, addDays } from './calendar';
import { weekStartOf } from './timeline';
import { emptyScheduleState } from '@/domain/events';
import { prepareMatchday } from './matchday';
import { arrangePreSeason } from './preseason';
import { buildSeasonStructure, countyCupRequests, openSeasonRecords } from './seasonStructure';
import { divisionOf, leagueCompetitions, standingsFor, userCompetition } from './pyramid';
import { generateReferees, generateWorld, reputationFromQuality } from './generation/worldGenerator';
import { generateSquad } from './generation/playerGenerator';
import { drawBeats, generatePress } from './press';
import { emptyPressState } from '@/domain/press';
import { generateInitialRelationships, linkManagerToClub } from './generation/relationshipGenerator';
import { generateUnattachedPlayers } from './generation/unattachedPlayers';
import { relationshipStore } from './relationships';
import { maybeNickname, occupation, personFirstName, personSurname } from './generation/names';
import { createEvent, publishEvents } from './news';
import { rollAvailability, rollWeeklyStaffAvailabilityForAll } from './availability';
import { ensureTrainingState } from './training/store';
import { abilityMean } from './queries';
import { positionOf } from './league';
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
  /** Clubs in each division, tier 1 first, strongest first within a division. */
  divisions: ClubId[][];
  /** The clubs of the top division, strongest first. */
  divisionClubIds: ClubId[];
  leagueName: string;
  /**
   * Every ladder the world was founded with, the founding pyramid first.
   *
   * A draft carries the ladders rather than a flat list of divisions, because a
   * flat list cannot say which divisions are whose — and the second district's
   * clubs are not a fourth, fifth and sixth tier of the county's ladder, they are
   * a ladder of their own that happens to sit next to it.
   */
  pyramids: DraftPyramid[];
  seed: string;
  startYear: number;
  /** The Monday pre-season begins: the day every career starts. */
  seasonStart: ISODate;
}

/**
 * One ladder as a draft carries it: the world's description of a pyramid, before
 * a career exists to hold it as a record.
 */
export interface DraftPyramid {
  id: PyramidId;
  name: string;
  regionId: RegionId;
  level: number;
  config: PyramidConfig;
  /** Its divisions, tier 1 first, strongest first within a division. */
  divisions: ClubId[][];
}

export interface NewGameOptions {
  seed: string;
  startYear?: number;
  createdAt?: ISODate;
  /**
   * The districts the county is founded with, in the map's own order.
   *
   * Left out, it is the county itself: every district Alderfordshire has — six,
   * which is what a new career starts with. See `generateWorld`.
   */
  districts?: readonly DistrictDefinition[];
  /**
   * How many of the county's districts to found, in the map's order. The
   * compatibility count the worlds already written ask by: `1` is the
   * one-ladder county every career founded before the district next door has,
   * and `2` is the two-ladder world every career since reads. Superseded by
   * `districts` when both are given.
   */
  pyramids?: number;
}

export function firstSundayOfSeptember(year: number): ISODate {
  const first = toDate(`${year}-09-01`);
  const day = first.getUTCDay();
  const offset = day === 0 ? 0 : 7 - day;
  first.setUTCDate(first.getUTCDate() + offset);
  return toISO(first);
}

/**
 * The year a new career begins in.
 *
 * One number, because four places were each writing their own: the draft's own
 * default, the store's call that opens one, and the two screens that tell a
 * manager what the coming season will make of him — the profile's preview of how
 * old he will be on the opening day, and the year the club he is founding cannot
 * have been founded after. A build that moves its opening season should move it
 * once.
 */
export const CAREER_START_YEAR = 2026;

/**
 * The day a career starts: the Monday pre-season begins.
 *
 * `generateDraft` works its whole world out from this date, and the profile
 * preview asks for it to work out the age the manager will be on that morning,
 * so the two cannot come to different answers about when the season starts.
 */
export function careerSeasonStart(startYear: number = CAREER_START_YEAR): ISODate {
  return weekStartOf(preSeasonStart(firstSundayOfSeptember(startYear)));
}

/** The earliest year a club in this county was founded in. */
export const EARLIEST_FOUNDED_YEAR = 1850;

/**
 * A founding year the world can hold: no older than the county's own clubs, and
 * no newer than the season the career begins in.
 *
 * The newest year used to be whatever the machine's clock said, which made the
 * same seed build a different club on a different day — and quietly rewrote a
 * year the designer had already been shown. A world set in a season keeps that
 * season's clock and no other, so the bound is the draft's own start year, and
 * the screen that asks for the year asks this same function what it will take.
 */
export function foundedYearWithin(year: number, startYear: number = CAREER_START_YEAR): number {
  return Math.min(startYear, Math.max(EARLIEST_FOUNDED_YEAR, Math.round(year)));
}



/** Generate the world without committing to a club — used by club selection. */
export function generateDraft(options: NewGameOptions): WorldDraft {
  const startYear = options.startYear ?? CAREER_START_YEAR;
  // Everything the world carries that is dated — who knows whom, who is not
  // playing anywhere — is dated from the day the career begins, which is the
  // start of pre-season rather than the first Sunday of the league.
  const seasonStart = careerSeasonStart(startYear);
  const generated = generateWorld({
    seed: options.seed,
    seasonStart,
    currentYear: startYear,
    districts: options.districts,
    pyramids: options.pyramids,
  });

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

  // How a club plays is drawn from who it is: the sides with the players have a
  // go and the sides without them make themselves hard to beat, which is what a
  // real Sunday league looks like and what the old world — an even scatter of
  // instructions across every club, regardless of standing — did not. The club's
  // own stream keeps this from moving anything else in the world.
  for (const club of Object.values(generated.clubs)) {
    club.tactics = styleTactics(new Rng(`${options.seed}::tactics::${club.id}`), club.reputation);
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
    divisions: generated.divisions,
    divisionClubIds: generated.divisionClubIds,
    leagueName: generated.leagueName,
    // Every ladder, founding pyramid first: the county's, and then each district
    // founded beside it in the map's own order. A world founded with a single
    // ladder says so by having a single entry here rather than by being a special
    // case anywhere downstream, and a world founded with six says nothing at all.
    pyramids: [
      {
        id: FOUNDING_PYRAMID_ID,
        name: `${generated.world.regionName} Sunday League`,
        regionId: generated.world.regionIds[0] ?? FOUNDING_REGION_ID,
        level: 1,
        config: { ...DEFAULT_PYRAMID },
        divisions: generated.divisions,
      },
      ...generated.districts.map((district): DraftPyramid => ({
        id: district.id,
        name: district.name,
        regionId: district.region.id,
        level: district.level,
        config: district.config,
        divisions: district.divisions,
      })),
    ],
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
    // The face he chose for himself, if he chose one. Left off entirely for a
    // manager who did not, because absent is the normal case and the drawing
    // already knows what to do with it: see `facePlan`, which falls back to the
    // roll his own name gives him.
    ...(profile?.face ? { face: profile.face } : {}),
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
    // The face is the person's and the profile mirrors it, rather than the other
    // way round: the person is what every screen draws, and the profile is what a
    // returning manager's saved profile hands back. One of them has to be the
    // copy, and it should not be the one on the drawing.
    ...(manager.face ? { face: manager.face } : {}),
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

/**
 * Photograph a division's table.
 *
 * Every division is snapshotted, not just the manager's own: the archive is the
 * county's history, and a snapshot of the third division is what lets the soak
 * ask whether the bottom of the pyramid is stratifying or collapsing.
 */
export function snapshotStandings(state: GameState): StandingSnapshot[] {
  return leagueCompetitions(state).map((competition) => {
    const rows = standingsFor(state, competition);
    return {
      date: state.date,
      matchday: matchdaysPlayed(state) + 1,
      competitionId: competition.id,
      rows,
      playerClubPosition: positionOf(rows, state.userClubId),
    };
  });
}

/** The manager's own division's table, for a screen that only wants one. */
export function snapshotUserStandings(state: GameState): StandingSnapshot {
  const competition = userCompetition(state);
  return {
    date: state.date,
    matchday: matchdaysPlayed(state) + 1,
    competitionId: competition?.id ?? '',
    rows: competition ? standingsFor(state, competition) : [],
    playerClubPosition: null,
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
  /**
   * The ladder the club is registered in, by id.
   *
   * Left out, it is the county's own — which is what every design written before
   * there was a second ladder meant, and where a club built at the foot of the
   * founding pyramid still goes.
   */
  pyramidId?: PyramidId;
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
 * The ladders a draft carries, the founding ladder first.
 *
 * A draft written before ladders existed carries divisions and no ladders at
 * all, and is read as the founding county's, which is what it was. Every reader
 * of a draft's ladders asks this rather than `draft.pyramids` directly, so the
 * world has one answer to "which ladders am I made of" rather than a fallback
 * repeated wherever a ladder happens to be wanted.
 */
export function draftLadders(draft: WorldDraft): DraftPyramid[] {
  if (draft.pyramids?.length) return draft.pyramids;
  const divisions = draft.divisions.length > 0 ? draft.divisions : [draft.divisionClubIds];
  return [
    {
      id: FOUNDING_PYRAMID_ID,
      name: `${draft.world.regionName} Sunday League`,
      regionId: draft.world.regionIds?.[0] ?? FOUNDING_REGION_ID,
      level: 1,
      config: { ...DEFAULT_PYRAMID },
      divisions,
    },
  ];
}

/** One of a draft's ladders by id, or the first it has when the id is not one. */
export function draftLadder(draft: WorldDraft, pyramidId: PyramidId = FOUNDING_PYRAMID_ID): DraftPyramid {
  const ladders = draftLadders(draft);
  return ladders.find((ladder) => ladder.id === pyramidId) ?? ladders[0]!;
}

/**
 * The clubs of a ladder's bottom division.
 *
 * Where a club the manager builds himself is registered: he joins at the foot of
 * the ladder he chose, whichever ladder that is, so the designer, the projection
 * on the screen and the career itself all read the same division.
 */
export function bottomDivisionClubIds(draft: WorldDraft, pyramidId: PyramidId = FOUNDING_PYRAMID_ID): ClubId[] {
  const divisions = draftLadder(draft, pyramidId).divisions;
  return divisions[divisions.length - 1] ?? draft.divisionClubIds;
}

/**
 * The club a new side displaces: the weakest in the bottom division.
 *
 * A club the manager builds himself starts at the bottom of the ladder — the
 * county's own, unless he chose to build it in the district next door — so it
 * takes the place of the weakest club in *that* ladder's lowest division rather
 * than the weakest in the county. Ties are settled by id so the same seed always
 * rebuilds the same world — and so the club designer can name the side being
 * replaced before the manager has committed to replacing it.
 */
export function displacedClubId(draft: WorldDraft, pyramidId: PyramidId = FOUNDING_PYRAMID_ID): ClubId {
  const bottomDivision = bottomDivisionClubIds(draft, pyramidId);
  return [...bottomDivision].sort((a, b) => {
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
  club.finances.openingBalance = 0;
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
  design: Pick<ClubDesign, 'squadStandard' | 'squadSize' | 'townId' | 'pyramidId'>,
): Player[] {
  return buildCustomSquad(
    draft,
    displacedClubId(draft, design.pyramidId),
    design.squadStandard,
    design.squadSize,
    design.townId,
  );
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
  // The ladder he chose to build the club in: the county's own unless he said
  // otherwise, which is where a club built in a world with one ladder goes.
  const baseId = displacedClubId(draft, design.pyramidId);
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
    foundedYear: foundedYearWithin(design.foundedYear, draft.startYear),
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

  // The ladders this career is born with, founding pyramid first. A draft
  // written before ladders existed carries divisions and no ladders at all, and
  // is read as the founding county's, which is what it was.
  const ladders = draftLadders(draft);

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
    // A career starts with no shapes of its own: the first manager to move a
    // dot on the preparation pitch is the one who fills this in.
    customFormations: [],
    admin: emptyAdminState(),
    governance: emptyGovernanceState(),
    // A career begins in work: the club just chosen, and the first spell in
    // charge of it written down so his record has a beginning.
    career: {
      ...emptyCareerState(),
      clubId: options.clubId,
      spells: [{ clubId: options.clubId, from: seasonStart, to: null, ending: null }],
    },
    // The county's press is generated once the world it covers exists — see the
    // end of this function — so a career is born with an empty record and is
    // filled in on the way out of here.
    press: emptyPressState(),
    fundraising: emptyFundraisingState(),
    // A new career has not been anywhere near the ground's pitch yet: the club
    // plays on whatever the world gave it, and what it does about that is the
    // manager's first decision rather than part of the setup.
    facilities: emptyFacilitiesState(),
    sponsorship: emptySponsorshipState(),
    season: {
      id: seasonId,
      label: seasonLabel,
      startDate: seasonStart,
      endDate: firstLeagueDate,
      calendar: [],
      finished: false,
    },
    world: draft.world,
    clubs,
    people,
    relationships: structuredClone(draft.relationships),
    recruitment: emptyRecruitmentStore(),
    training: emptyTrainingStore(),
    communication: emptyCommunicationStore(),
    competitions: {},
    // Every ladder the world was founded with, the founding one first: its id is
    // `league`, which is already the prefix of every competition id this world
    // has ever written, and a district next door carries its own id in the same
    // way. Their divisions and cups are filled in below, where the season is
    // built — this function is what creates them, so a list written here would
    // be a guess.
    pyramids: Object.fromEntries(
      ladders.map((ladder) => [
        ladder.id,
        {
          id: ladder.id,
          name: ladder.name,
          regionId: ladder.regionId,
          level: ladder.level,
          config: ladder.config,
          competitionIds: [],
          cupIds: [],
        } satisfies Pyramid,
      ]),
    ),
    pyramidIds: ladders.map((ladder) => ladder.id),
    fixtures: {},
    matches: {},
    userClubId: options.clubId,
    managerProfile: managerProfileFor(userManager, options.manager, seasonStart),
    matchOrder: [],
    news: [],
    standingHistory: [],
    promotionHistory: [],
    seasonHistory: [],
    settings: { complexity: 'standard', autoAdvanceMatches: false },
    lastMatchId: null,
    pendingMatchId: null,
    counters: {},
  };

  // Every ladder, ranked by reputation and cut into divisions of the configured
  // size, then a whole-pyramid cup drawn on top of each one that runs one. The
  // ladders are passed as ladders rather than as one flat list of divisions, so
  // that nothing about the world build is special-cased for one pyramid — and
  // each carries the name of the region it draws its clubs from, so a district's
  // divisions are named after the district.
  const structure = buildSeasonStructure({
    state,
    seasonId,
    seasonLabel,
    firstLeagueDate,
    pyramids: ladders.map((ladder) => ({
      pyramidId: ladder.id,
      regionName: draft.world.regions?.[ladder.regionId]?.name ?? draft.world.regionName,
      divisions: ladder.divisions,
    })),
    // Each county's own cup, where that county has more than one ladder to run it
    // between. A one-ladder county has no county cup because its ladder's cup is
    // the county's cup — see `countyCupRequests` — which is what keeps a career
    // founded with a single ladder the career it has always been.
    cups: countyCupRequests(state),
    announceDraws: false,
  });
  const calendar = structure.calendar;
  state.season.calendar = calendar;
  state.season.endDate = calendar[calendar.length - 1]!.date;
  // Every club that was named after a business, and had a weekly figure on its
  // books, starts the career with that business as its sponsor — a real
  // agreement rather than a modifier, with the first instalment still to come.
  seedInitialSponsorship(state);
  const competition = divisionOf(state, options.clubId);

  openSeasonRecords(state, seasonId, seasonLabel);

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
  rollWeeklyStaffAvailabilityForAll(state);
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
        body: `${userClub.identity.name} are in ${competition?.name ?? draft.leagueName}. First up: ${
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

  // No settlement happens here. A career begins on the day it begins, and money
  // only moves when a real calendar event causes it: the first Wednesday pays
  // the first week's costs, the first Friday brings the first sponsorship
  // instalment due under the club's agreement, and the first Thursday's session
  // pays for its own pitch. Seeding a whole week of transactions on the Monday
  // the club is created was an artefact of the old weekly tick, not a thing that
  // actually happened.
  prepareMatchday(state, 1);
  state.standingHistory.push(...snapshotStandings(state));

  // The county's papers, stations and fanzines, generated from the world that
  // has just been built: one reporter per paper, each with the clubs nearest
  // his town as his patch. See `simulation/press.ts` — this is the only place a
  // county's press comes into existence, and every other route in (a save that
  // predates it, a world with its record damaged) goes through `ensurePress`.
  state.press = generatePress(state);
  if (state.press.journalists.length > 0) drawBeats(state);

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
