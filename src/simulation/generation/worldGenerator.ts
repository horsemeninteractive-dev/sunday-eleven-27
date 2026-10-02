import type { Club, ClubFinances, ClubHistory, ClubStructure } from '@/domain/club';
import type { Business, Ground, GroundSurface, Town, World } from '@/domain/world';
import type { ClubId, GroundId, ISODate, PersonId, PlayerId, TownId } from '@/domain/ids';
import type { Official, Person, Player } from '@/domain/person';
import { defaultTactics } from '@/domain/tactics';
import { DEFAULT_PYRAMID } from '@/domain/competition';
import { Rng } from '../rng';
import {
  COLOUR_PAIRS,
  businessName,
  capitalise,
  clubNickname,
  generatePlaceName,
  maybeNickname,
  occupation,
  personFirstName,
  personSurname,
  pubName,
  riverName,
} from './names';
import { generateSquad } from './playerGenerator';

export interface GenerateWorldOptions {
  seed: string;
  /** Season start date; used to date founding records and memberships. */
  seasonStart: ISODate;
  /** Override the number of clubs (used by tests). */
  clubCount?: number;
  /** Season the world is created in, used for founding years. */
  currentYear: number;
  /** How many clubs each division should hold. Defaults to the pyramid's. */
  clubsPerDivision?: number;
  /** How many league divisions to build. Defaults to the pyramid's. */
  tiers?: number;
}

export interface GeneratedWorld {
  world: World;
  clubs: Record<ClubId, Club>;
  people: Record<PersonId, Person>;
  /** Clubs in each division, tier 1 first, strongest first within a division. */
  divisions: ClubId[][];
  /** The clubs of the top division, strongest first. */
  divisionClubIds: ClubId[];
  leagueName: string;
}

const POPULATION_RANGES = {
  town: [14000, 34000],
  'small-town': [4500, 13000],
  village: [650, 4200],
  hamlet: [120, 600],
} as const;

type SettlementKind = keyof typeof POPULATION_RANGES;

/** Club density responds to settlement size: towns support a handful. */
const CLUB_DENSITY: Record<SettlementKind, { mean: number; min: number; max: number }> = {
  town: { mean: 6.4, min: 4, max: 9 },
  'small-town': { mean: 4.2, min: 3, max: 6 },
  village: { mean: 2.6, min: 2, max: 4 },
  hamlet: { mean: 1.1, min: 0, max: 2 },
};

const GROUND_NAME_PATTERNS = [
  'Recreation Ground',
  'Playing Fields',
  'Sports Ground',
  'Memorial Ground',
  'Athletic Ground',
  'Meadow',
  'Park',
  'Cricket Club',
];

const STREET_GROUND_NAMES = [
  'Mill Lane',
  'Church Lane',
  'Station Road',
  'Bridge Street End',
  'Long Lane',
  'School Lane',
  'Back Lane',
  'Watery Lane',
  'The Common',
  'Pound Field',
];

const CLUB_MOTTOS = [
  'Anyone who turns up gets a game.',
  'Founded by lads who fancied a kickabout.',
  'Two pitches, one changing room, no complaints.',
  'The clubhouse is the heart of it.',
  'You play for the badge and the pint after.',
  'Never short of volunteers. Never.',
  'Runs on subs, raffle money and goodwill.',
  'Bring your own boots and your own luck.',
];

function pickSettlementKind(rng: Rng): SettlementKind {
  return rng.weighted([
    { value: 'town' as SettlementKind, weight: 1.6 },
    { value: 'small-town' as SettlementKind, weight: 2.2 },
    { value: 'village' as SettlementKind, weight: 4 },
    { value: 'hamlet' as SettlementKind, weight: 2 },
  ]);
}

function clubCountFor(kind: SettlementKind, rng: Rng): number {
  const density = CLUB_DENSITY[kind];
  return rng.gaussianInt(density.mean, 0.8, density.min, density.max);
}

function settlementDescription(rng: Rng, town: Town, river: string): string {
  const patterns = [
    `A market ${town.kind === 'town' ? 'town' : town.kind === 'small-town' ? 'town' : 'village'} on the edge of the county, ${river} running along the south side.`,
    `Roughly ${town.population.toLocaleString('en-GB')} people, a Co-op, two pubs and a bypass.`,
    `Commuter belt territory now, though the football club has been here longer than the new estates.`,
    `Surrounded by farmland; most Sunday mornings you can hear the church bells from the top pitch.`,
    `A high street that has seen better days and a sports field that has not.`,
  ];
  return rng.pick(patterns);
}

function generateTowns(rng: Rng, river: string): { towns: Town[]; businesses: Business[] } {
  const usedNames = new Set<string>();
  const towns: Town[] = [];
  const businesses: Business[] = [];

  // One anchor town, then a spread of smaller settlements. A county that has to
  // hold thirty-six clubs needs more places to put them than a county with
  // twelve, so the spread is wider than a single division would need.
  const settlementPlan: SettlementKind[] = ['town'];
  const extras = rng.int(9, 12);
  for (let i = 0; i < extras; i++) settlementPlan.push(pickSettlementKind(rng));
  settlementPlan.push('village');

  let businessCounter = 0;
  settlementPlan.forEach((kind, index) => {
    const [minPop, maxPop] = POPULATION_RANGES[kind];
    const population = rng.gaussianInt((minPop + maxPop) / 2, (maxPop - minPop) / 4, minPop, maxPop);
    const town: Town = {
      id: `town_${index + 1}`,
      name: generatePlaceName(rng, usedNames),
      kind,
      population,
      x: rng.int(8, 92),
      y: rng.int(8, 92),
      description: '',
      businessIds: [],
    };

    const pubCount = Math.max(1, Math.round(population / 2600) + (kind === 'town' ? 1 : 1));
    const businessTarget = pubCount + (population > 4000 ? rng.int(1, 3) : rng.chance(0.4) ? 1 : 0);
    const kinds: Business['kind'][] = ['pub', 'social-club', 'builder', 'garage', 'butcher', 'cafe', 'plumbers', 'farm-shop'];
    for (let i = 0; i < businessTarget; i++) {
      businessCounter += 1;
      const kindPick = i < pubCount ? (rng.chance(0.72) ? 'pub' : 'social-club') : rng.pick(kinds.slice(2));
      const name =
        kindPick === 'pub' || kindPick === 'social-club'
          ? kindPick === 'social-club'
            ? `${town.name} Social Club`
            : pubName(rng)
          : businessName(rng, capitalise(kindPick.replace('-', ' ')));
      const business: Business = {
        id: `biz_${businessCounter}`,
        name,
        kind: kindPick as Business['kind'],
        townId: town.id,
        wealth: rng.gaussianInt(kindPick === 'pub' ? 11 : 13, 3, 2, 20),
        sponsoredClubIds: [],
      };
      businesses.push(business);
      town.businessIds.push(business.id);
    }

    town.description = settlementDescription(rng, town, river);
    towns.push(town);
  });

  return { towns, businesses };
}

function groundSurface(rng: Rng): GroundSurface {
  if (rng.chance(0.07)) return '3G';
  if (rng.chance(0.06)) return 'cinder';
  return rng.chance(0.45) ? 'grass (uneven)' : 'grass';
}

function generateGround(
  rng: Rng,
  town: Town,
  businesses: Business[],
  clubId: ClubId,
  clubIndex: number,
  usedGroundNames: Set<string>,
): Ground {
  const localBusinesses = businesses.filter((b) => b.townId === town.id);
  const pubBacked = rng.chance(0.3) && localBusinesses.length > 0 ? rng.pick(localBusinesses) : null;
  const candidates = [
    pubBacked ? `${pubBacked.name} Ground` : null,
    ...GROUND_NAME_PATTERNS.map((pattern) => `${town.name} ${pattern}`),
    ...STREET_GROUND_NAMES,
  ].filter((value): value is string => Boolean(value));

  // Ground names only need to be unique within a town — plenty of places have
  // their own Mill Lane.
  const shuffled = rng.shuffle(candidates);
  const ordered = pubBacked ? [candidates[0]!, ...shuffled] : shuffled;
  const name =
    ordered.find((candidate) => !usedGroundNames.has(`${town.id}::${candidate}`)) ??
    `${town.name} Recreation Ground`;
  usedGroundNames.add(`${town.id}::${name}`);

  const surface = groundSurface(rng);
  const quality = rng.gaussianInt(town.kind === 'town' ? 12 : 10, 3, 3, 18);
  return {
    id: `ground_${clubIndex}`,
    name,
    townId: town.id,
    tenantClubId: clubId,
    capacity: rng.gaussianInt(Math.max(25, town.population / 260), 40, 20, 400),
    surface,
    quality,
    drainage: surface === '3G' ? 18 : rng.gaussianInt(9, 3.5, 2, 16),
    hasFloodlights: surface === '3G' || rng.chance(town.kind === 'town' ? 0.55 : 0.2),
    hasChangingRooms: rng.chance(town.kind === 'town' ? 0.95 : 0.8),
    hasClubhouse: rng.chance(town.kind === 'town' ? 0.6 : 0.45),
    matchdayCost: surface === '3G' ? rng.int(70, 120) : rng.int(20, 55),
    sharedWith: [],
  };
}

export function reputationForTown(rng: Rng, town: Town): number {
  const base = 22 + 14 * Math.log10(Math.max(150, town.population) / 200);
  return Math.round(Math.max(18, Math.min(88, base + rng.gaussian(0, 7))));
}

/**
 * The standard of player a club of a given standing tends to attract. Shared
 * with club creation, so a club the manager builds is as good as its standing
 * says it should be rather than being generated to a separate scale.
 *
 * 18 -> ~8.6, 88 -> ~12.4 on the 1-20 scale.
 */
export function clubQualityFromReputation(rng: Rng, reputation: number): number {
  return Math.max(7.2, Math.min(13.5, 8.3 + (reputation / 100) * 4.6 + rng.gaussian(0, 0.4)));
}

/**
 * The standing a squad of a given quality is worth — the same curve read
 * backwards, with the noise left out.
 *
 * A club is judged by the players it can put on the pitch, so a side that has
 * just bought its squad takes the standing that squad implies rather than the
 * one it claimed before it went shopping. Round-tripping a reputation through
 * `clubQualityFromReputation` and back lands within a point or two, which is
 * as close as the two scales ever get.
 */
export function reputationFromQuality(quality: number): number {
  return Math.round(((quality - 8.3) / 4.6) * 100);
}

interface ClubNameResult {
  identity: Club['identity'];
  structure: ClubStructure;
  business: Business | null;
}

/**
 * Club names are generated from a town, a local pub/business or a community
 * pattern. Names are made unique by trying alternative patterns rather than by
 * stapling a number onto a duplicate — two "Holmere Athletic" sides is a world
 * generation bug, not local colour.
 */
export function buildClubName(
  rng: Rng,
  town: Town,
  businesses: Business[],
  usedNames: Set<string>,
  usedNicknames: Set<string>,
  usedBusinesses: Set<string>,
  currentYear: number,
): ClubNameResult {
  const localBusinesses = businesses.filter((b) => b.townId === town.id && !usedBusinesses.has(b.id));
  const pubBusinesses = localBusinesses.filter((b) => b.kind === 'pub' || b.kind === 'social-club');

  const candidateSuffixes = rng
    .shuffle(['Rovers', 'Athletic', 'United', 'Wanderers', 'Rangers', 'Albion', 'Corinthians', 'Sports', 'Town', 'FC', 'Victoria', 'Old Boys'])
    .map((suffix) => (town.kind !== 'town' && suffix === 'Town' ? 'Athletic' : suffix));

  const nameCandidates: Array<{ name: string; structure: ClubStructure; business: Business | null }> = [];

  if (pubBusinesses.length > 0) {
    const pub = rng.pick(pubBusinesses);
    nameCandidates.push({ name: pub.name, structure: 'pub-backed', business: pub });
    nameCandidates.push({ name: `${pub.name} FC`, structure: 'pub-backed', business: pub });
  }
  if (localBusinesses.length > 0) {
    const local = rng.pick(localBusinesses);
    nameCandidates.push({ name: `${local.name} FC`, structure: 'business-backed', business: local });
  }
  nameCandidates.push({ name: `${town.name} Old Boys`, structure: 'members', business: null });
  nameCandidates.push({ name: `${town.name} Sunday`, structure: 'community', business: null });
  for (const suffix of candidateSuffixes) {
    nameCandidates.push({
      name: `${town.name} ${suffix}`,
      structure: rng.weighted([
        { value: 'committee' as ClubStructure, weight: 4 },
        { value: 'members' as ClubStructure, weight: 2 },
        { value: 'community' as ClubStructure, weight: 1.5 },
        { value: 'chairman-led' as ClubStructure, weight: 1.5 },
      ]),
      business: null,
    });
  }

  // Alternate between list order and random picks so different seeds produce
  // different names, then take the first free one.
  const chosen = pickFreeName(nameCandidates, usedNames, rng) ?? nameCandidates[0]!;
  let name = chosen.name;
  if (usedNames.has(name)) name = `${name} Reserves`;
  usedNames.add(name);
  // A pub or business normally only backs one club at a time.
  if (chosen.business) usedBusinesses.add(chosen.business.id);

  const foundedYear = Math.max(1880, currentYear - rng.gaussianInt(46, 26, 1, 116));
  const colours = rng.pick(COLOUR_PAIRS);
  const nickname = pickFreeNickname(rng, usedNicknames);

  return {
    identity: {
      name,
      shortName: abbreviate(name, town.name),
      nickname,
      foundedYear,
      colours,
      motto: rng.pick(CLUB_MOTTOS),
    },
    structure: chosen.structure,
    business: chosen.business,
  };
}

function pickFreeName(
  candidates: Array<{ name: string; structure: ClubStructure; business: Business | null }>,
  usedNames: Set<string>,
  rng: Rng,
): { name: string; structure: ClubStructure; business: Business | null } | null {
  const free = candidates.filter((candidate) => !usedNames.has(candidate.name));
  if (free.length === 0) return null;
  // Weight towards the earlier patterns (pubs, businesses, community names).
  const index = Math.min(free.length - 1, rng.int(0, 2));
  return free[index]!;
}

/**
 * Short display name used in tables, commentary and news. Long names are
 * trimmed the way a local paper would: keep the town, keep the distinguishing
 * word, and abbreviate only if there is still no room.
 */
function abbreviate(name: string, townName: string): string {
  if (name.length <= 20) return name;

  // Try progressively shorter versions that keep the most meaning: the whole
  // town plus the club's distinguishing words first, then the distinctive part
  // of the town on its own. "Upper Oakbridge Old Boys" -> "Oakbridge Old Boys".
  const townWords = townName.split(' ');
  const anchor = townWords[townWords.length - 1]!;
  const rest = name.startsWith(townName) ? name.slice(townName.length).trim().split(' ').filter(Boolean) : [];
  const restWords = rest.slice(-2).join(' ');

  const candidates = rest.length > 0
    ? [
        `${townName} ${restWords}`.trim(),
        `${anchor} ${rest.join(' ')}`.trim(),
        `${anchor} ${restWords}`.trim(),
        `${anchor} ${rest[rest.length - 1]!}`.trim(),
      ]
    : [];
  for (const candidate of candidates) {
    if (candidate.length <= 20 && candidate.length >= 4) return candidate;
  }

  const trimmed = name.replace(/\s+(FC|AFC|Sports|Athletic|United|Reserves)$/i, '').trim();
  if (trimmed.length <= 20) return trimmed;
  return name.split(' ').slice(0, 2).join(' ');
}

function pickFreeNickname(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = clubNickname(rng);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return `${clubNickname(rng)} of ${rng.pick(['the Lane', 'the Rec', 'the Village', 'the Bridge'])}`;
}

export function buildFinances(rng: Rng, town: Town, reputation: number): ClubFinances {
  return {
    balance: rng.gaussianInt(town.kind === 'town' ? 1400 : 650, 450, -250, 4000),
    subscriptionPerPlayer: rng.int(3, 6),
    sponsorIncomePerWeek: reputation > 55 ? rng.int(30, 85) : rng.int(12, 45),
    weeklyGroundCost: rng.int(18, 62),
    // Village sides often train on the same pitch they play on for nothing;
    // town clubs tend to hire a floodlit surface and pay for it.
    trainingCostPerWeek: town.kind === 'village' || town.kind === 'hamlet' ? (rng.chance(0.3) ? rng.int(8, 22) : 0) : rng.int(12, 38),
    insurancePerWeek: rng.int(5, 14),
    annualLeagueFee: rng.int(60, 150),
    ledger: [],
  };
}

export function emptyHistory(rng: Rng, foundedYear: number): ClubHistory {
  return {
    founded: foundedYear,
    seasons: [],
    notableEvents: [
      {
        date: `${Math.min(foundedYear + 1, 2000)}-06-01`,
        seasonLabel: 'archive',
        description: `Club founded in ${foundedYear}.`,
        importance: 1,
      },
    ],
    honours: rng.chance(0.25) ? [rng.pick(['Division Two runners-up (1998)', 'League Cup winners (2011)', 'Division Three champions (2004)'])] : [],
    managers: [],
    records: { recordAppearanceHolderId: null, recordGoalscorerId: null, biggestWin: null },
  };
}

export function generateManager(rng: Rng, clubTownId: TownId, clubReputation: number, index: number): Official {
  const quality = clubQualityFromReputation(rng, clubReputation);
  return {
    id: `mgr_${index}`,
    kind: 'official',
    firstName: personFirstName(rng),
    surname: personSurname(rng),
    nickname: maybeNickname(rng, 0.2),
    age: rng.gaussianInt(44, 8, 27, 68),
    townId: clubTownId,
    occupation: occupation(rng),
    reputation: Math.round(Math.max(5, Math.min(90, clubReputation * 0.8 + rng.gaussian(0, 10)))),
    roles: [],
    role: 'manager',
    clubId: null,
    attributes: {
      coaching: Math.round(quality),
      manManagement: rng.gaussianInt(11, 3, 3, 19),
      motivation: rng.gaussianInt(11, 3, 3, 19),
      tacticalKnowledge: rng.gaussianInt(quality, 3, 3, 19),
      recruitmentEye: rng.gaussianInt(11, 3, 3, 19),
      organisation: rng.gaussianInt(11, 3, 3, 19),
    },
    patience: rng.gaussianInt(11, 3, 3, 19),
    notes: [],
  };
}

export function generateChairman(rng: Rng, townId: TownId, index: number): Official {
  return {
    id: `chm_${index}`,
    kind: 'official',
    firstName: personFirstName(rng),
    surname: personSurname(rng),
    age: rng.gaussianInt(55, 10, 32, 79),
    townId,
    occupation: rng.pick(['Publican', 'Company director', 'Farmer', 'Retired', 'Garage owner', 'Builder', 'Solicitor', 'Accountant', 'Newsagent']),
    reputation: rng.gaussianInt(45, 15, 5, 95),
    roles: [],
    role: 'chairman',
    clubId: null,
    attributes: {
      coaching: rng.int(1, 6),
      manManagement: rng.gaussianInt(11, 4, 2, 19),
      motivation: rng.gaussianInt(11, 4, 2, 19),
      tacticalKnowledge: rng.int(2, 12),
      recruitmentEye: rng.gaussianInt(11, 4, 2, 19),
      organisation: rng.gaussianInt(12, 4, 2, 19),
    },
    patience: rng.gaussianInt(11, 4, 2, 19),
    notes: [],
  };
}

export function generateReferees(rng: Rng, towns: Town[], count = 10): Official[] {
  const referees: Official[] = [];
  for (let i = 0; i < count; i++) {
    const town = rng.pick(towns);
    referees.push({
      id: `ref_${i + 1}`,
      kind: 'official',
      firstName: personFirstName(rng),
      surname: personSurname(rng),
      nickname: maybeNickname(rng, 0.25),
      age: rng.gaussianInt(45, 11, 21, 72),
      townId: town.id,
      occupation: occupation(rng),
      reputation: rng.gaussianInt(50, 16, 8, 95),
      roles: [],
      role: 'referee',
      clubId: null,
      patience: 12,
      attributes: {
        coaching: rng.int(1, 5),
        manManagement: rng.gaussianInt(11, 4, 2, 19),
        motivation: rng.gaussianInt(11, 4, 2, 19),
        tacticalKnowledge: rng.int(3, 12),
        recruitmentEye: rng.int(1, 6),
        organisation: rng.gaussianInt(11, 4, 2, 19),
        strictness: rng.gaussianInt(11, 4, 2, 20),
        consistency: rng.gaussianInt(11, 4, 2, 20),
      },
      notes: [],
    });
  }
  return referees;
}

export function generateWorld(options: GenerateWorldOptions): GeneratedWorld {
  const rng = new Rng(`${options.seed}::world`);
  const river = riverName(rng);
  const countyName = `${capitalise(generatePlaceName(rng, new Set()))}shire`;
  const regionName = `${rng.pick(['Wyre', 'Cale', 'Stour', 'Dene', 'Teme', 'Brue', 'Avon', 'Yare'])} Valley`;

  const { towns, businesses } = generateTowns(rng, river);

  const grounds: Record<GroundId, Ground> = {};
  const tasks: Array<{ town: Town }> = [];
  for (const town of towns) {
    const count = clubCountFor(town.kind, rng);
    for (let i = 0; i < count; i++) tasks.push({ town });
  }

  const tiers = Math.max(1, options.tiers ?? DEFAULT_PYRAMID.tiers);
  const clubsPerDivision = Math.max(2, options.clubsPerDivision ?? DEFAULT_PYRAMID.clubsPerTier);
  const wanted = options.clubCount ?? tiers * clubsPerDivision;
  const clubTasks = rng.shuffle(tasks).slice(0, wanted);

  const clubs: Record<ClubId, Club> = {};
  const people: Record<PersonId, Person> = {};
  const usedNames = new Set<string>();
  const usedNicknames = new Set<string>();
  const usedGroundNames = new Set<string>();
  const usedBusinesses = new Set<string>();

  clubTasks.forEach((task, index) => {
    const clubId: ClubId = `club_${index + 1}`;
    const town = task.town;
    const { identity, structure, business } = buildClubName(
      rng,
      town,
      businesses,
      usedNames,
      usedNicknames,
      usedBusinesses,
      options.currentYear,
    );
    const reputation = reputationForTown(rng, town);
    const ground = generateGround(rng, town, businesses, clubId, index + 1, usedGroundNames);
    ground.tenantClubId = clubId;
    grounds[ground.id] = ground;

    if (business) business.sponsoredClubIds.push(clubId);

    const manager = generateManager(rng, town.id, reputation, index + 1);
    manager.clubId = clubId;
    manager.roles = [{ clubId, role: 'manager', since: options.seasonStart }];
    const chairman = generateChairman(rng, town.id, index + 1);
    chairman.clubId = clubId;
    chairman.roles = [{ clubId, role: 'chairman', since: options.seasonStart }];
    people[manager.id] = manager;
    people[chairman.id] = chairman;

    const squad = generateSquad({
      rng: new Rng(`${options.seed}::squad::${clubId}`),
      clubId,
      townId: town.id,
      homeGroundId: ground.id,
      quality: clubQualityFromReputation(rng, reputation),
      seasonStart: options.seasonStart,
      idSeedPrefix: clubId,
    });
    const squadIds: PlayerId[] = [];
    for (const player of squad) {
      people[player.id] = player;
      squadIds.push(player.id);
    }

    // A minority of grassroots clubs are run by a player-manager who picks
    // themselves every week. Marked here so the world model can carry it.
    const usesPlayerManager = structure !== 'committee' && rng.chance(0.18) && squad.length > 0;
    const candidate = usesPlayerManager ? (squad.find((p) => p.age >= 28) ?? squad[0]!) : null;
    if (candidate) {
      const playerManager = people[candidate.id] as Player;
      playerManager.isPlayerManager = true;
      playerManager.roles = [{ clubId, role: 'player-manager', since: options.seasonStart }];
      people[manager.id] = {
        ...manager,
        role: 'assistant',
        roles: [{ clubId, role: 'assistant', since: options.seasonStart }],
        notes: ['Stepped back to assist a player-manager.'],
      } as Official;
    }

    const club: Club = {
      id: clubId,
      identity,
      townId: town.id,
      groundId: ground.id,
      structure,
      reputation,
      squadIds,
      chairmanId: chairman.id,
      managerId: candidate ? candidate.id : manager.id,
      sponsorIds: business ? [business.id] : [],
      finances: buildFinances(rng, town, reputation),
      history: emptyHistory(rng, identity.foundedYear),
      tactics: defaultTactics('4-4-2'),
      active: true,
      rivalries: {},
    };
    clubs[clubId] = club;
  });

  // Geography creates rivalries: the closest neighbours care most about each other.
  const clubList = Object.values(clubs);
  for (const club of clubList) {
    const town = towns.find((t) => t.id === club.townId)!;
    const distances = clubList
      .filter((other) => other.id !== club.id)
      .map((other) => {
        const otherTown = towns.find((t) => t.id === other.townId)!;
        const distance = Math.hypot(town.x - otherTown.x, town.y - otherTown.y);
        return { other, distance, sameTown: other.townId === club.townId };
      })
      .sort((a, b) => a.distance - b.distance);

    const rivals = distances.slice(0, 2);
    for (const { other, distance, sameTown } of rivals) {
      const intensity = Math.max(
        10,
        Math.min(95, Math.round(70 - distance * 0.9 + (sameTown ? 20 : 0) + rng.gaussian(0, 8))),
      );
      club.rivalries[other.id] = {
        intensity,
        note: sameTown ? 'Neighbours sharing a town and a car park.' : 'Closest away trip on the calendar.',
      };
      other.rivalries[club.id] = club.rivalries[other.id]!;
    }
  }

  // Ground sharing: village clubs often share a pitch.
  for (const club of clubList) {
    if (!rng.chance(0.12)) continue;
    const town = towns.find((t) => t.id === club.townId)!;
    const candidate = clubList.find(
      (other) => other.id !== club.id && other.townId === town.id && other.groundId !== club.groundId,
    );
    if (!candidate) continue;
    const shared = grounds[candidate.groundId];
    if (!shared) continue;
    shared.sharedWith.push(club.id);
    if (rng.chance(0.5)) club.groundId = shared.id;
  }

  const world: World = {
    id: `world_${options.seed}`,
    seed: options.seed,
    regionName,
    countyName,
    towns: Object.fromEntries(towns.map((t) => [t.id, t])),
    townIds: towns.map((t) => t.id),
    grounds,
    groundIds: Object.keys(grounds),
    businesses: Object.fromEntries(businesses.map((b) => [b.id, b])),
  };

  const divisionClubIds = clubList
    .slice()
    .sort((a, b) => b.reputation - a.reputation)
    .map((c) => c.id);

  /**
   * The ladder.
   *
   * Clubs are ranked on reputation, which the generator derived from the size
   * of the town they sit in, and cut into divisions from the top. A club's
   * reputation is also what its squad was generated from, so the top division
   * holds the better squads without anything having to be said about it twice —
   * the pyramid is stratified from the moment the world is built rather than
   * sorted out over the first few seasons.
   *
   * If the county turned out to have fewer plausible club sites than the ladder
   * needs, the divisions are still all created and the short ones are simply
   * smaller. Nothing manufactures a club to hit a number.
   */
  const divisions: ClubId[][] = [];
  for (let tier = 0; tier < tiers; tier += 1) {
    divisions.push(divisionClubIds.slice(tier * clubsPerDivision, (tier + 1) * clubsPerDivision));
  }

  return {
    world,
    clubs,
    people,
    divisions,
    divisionClubIds: divisions[0] ?? [],
    leagueName: `${regionName} Sunday League Division One`,
  };
}


