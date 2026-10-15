import { defaultSupporters, type Club, type ClubFinances, type ClubHistory, type ClubStructure, type RivalryKind } from '@/domain/club';
import {
  FOUNDING_COUNTY_ID,
  FOUNDING_COUNTY_NAME,
  FOUNDING_REGION_ID,
  FOUNDING_REGION_NAME,
  NATION_NAME,
  SECOND_REGION_ID,
  type Business,
  type County,
  type Ground,
  type GroundSurface,
  type Region,
  type Town,
  type World,
} from '@/domain/world';
import type { DistrictDefinition } from '@/domain/districts';
import { alderfordshireDistricts } from '@/geography/alderland';
import type { ClubId, CountyId, GroundId, ISODate, PersonId, PlayerId, PyramidId, RegionId, TownId } from '@/domain/ids';
import type { Official, Person, Player } from '@/domain/person';
import { defaultTactics } from '@/domain/tactics';
import { DEFAULT_PYRAMID, FOUNDING_PYRAMID_ID, SECOND_PYRAMID_CONFIG, type PyramidConfig } from '@/domain/competition';
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
import { generateClubStaff } from '../staff';

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
  /**
   * The districts the county is founded with, in the map's own order, the
   * founding district first.
   *
   * This is the county's whole geography handed to the generator as data: each
   * entry says which region the district is drawn as, what it is called, what
   * level its football is and where on the map it stands, and the same code that
   * has always founded the district next door founds every one of them. Left
   * out, the county is founded with every district Alderfordshire has — six —
   * because that is what the county is; a caller that wants part of it asks for
   * part of it.
   */
  districts?: readonly DistrictDefinition[];
  /**
   * How many of the county's districts to found, in the map's own order.
   *
   * The compatibility count, for the worlds the game has already written: one
   * is the one-ladder county every career founded before the district next door
   * existed has, and two is the two-ladder world every career since. It is a
   * *prefix of the county* rather than a different county — the same districts,
   * in the same order, drawn the same way as they are in a career founded with
   * the whole of it — so a caller that asks for two gets the world the game has
   * always produced (see `worldGenerator.test.ts`, whose baselines are the proof
   * of it) and a caller that asks for six gets the county as it is today.
   * Superseded by `districts` when both are given.
   */
  pyramids?: number;
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
  /**
   * Every district founded beside the founding county, in the map's order.
   *
   * A county founded with one ladder has none; a career founded today has five.
   * Its clubs, grounds, people and towns are already merged into the world
   * above; what is kept here is each district's ladder — its region, its shape
   * and its divisions — which the world cannot derive from a club list.
   */
  districts: FoundedDistrict[];
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
  'Recreation Field',
  'Playing Field',
  'Sports Field',
  'Memorial Fields',
  'Athletic Fields',
  'Community Ground',
  'Community Pitch',
  'Village Field',
  'Village Green',
  'Welfare Ground',
  'Miners Welfare',
  'Social Club Field',
  'Showground',
  'Mill Field',
  'Water Meadow',
  'Church Field',
  'Sports and Social Club',
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
  'Church Road',
  'Station Lane',
  'Station Approach',
  'New Road',
  'Green Lane',
  'Park Lane',
  'Park Road',
  'High Street',
  'High Street End',
  'The Green',
  'The Meadow',
  'The Park',
  'Vicarage Lane',
  'Vicarage Road',
  'Manor Lane',
  'Manor Road',
  'Chapel Lane',
  'Chapel Street',
  'Bridge Road',
  'Riverside',
  'Meadow Lane',
  'Orchard Lane',
  'Rookery Lane',
  'Kiln Lane',
  'Marsh Lane',
  'Fen Lane',
  'Pinfold Lane',
  'Turnpike Road',
  'Barn Lane',
  'Hollow Lane',
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
  'Sunday mornings, whatever the weather.',
  'Half the town has played for us at some point.',
  'No egos, no agents, no excuses.',
  'The tea hut does a better trade than the bar.',
  'We were here before the bypass was.',
  'Lose together, drink together.',
  "Somebody's dad has always run the line.",
  'Shirts washed at home, nets up at eight.',
  'If you can play, you play.',
  'Old kit, new season, same lot.',
  'The pitch is flat if you stand at the right angle.',
  'Everyone pays their subs, everyone gets a game.',
  'One club, one town, one raffle a year.',
  'We do not do trials. We do do tea.',
  'The second team is the first team, eventually.',
  'Nobody remembers the league table in July.',
  'The corner flag has been replaced twice this century.',
  'Win or lose, the kit goes in the wash.',
  'Played for the club, married into the town.',
  'Rusty nets, decent lads, proper football.',
  'If it goes in the river, somebody fetches another.',
  'Started with eleven, finished with eleven, just about.',
];

/**
 * The trades a club can borrow a name and a sponsor from, and how ordinary each
 * one is on a local high street. Weighted rather than uniform, because a county
 * in which every settlement has exactly one of each is the same county every
 * time: one town has two garages, the next has a farm shop and no plumber.
 */
const LOCAL_TRADES: Array<{ value: Business['kind']; weight: number }> = [
  { value: 'builder', weight: 3 },
  { value: 'garage', weight: 3 },
  { value: 'butcher', weight: 2.2 },
  { value: 'cafe', weight: 2.2 },
  { value: 'plumbers', weight: 1.8 },
  { value: 'farm-shop', weight: 1.2 },
];

/**
 * What a town calls the institution it drinks in when it is not a pub with a
 * name over the door: the working men's club, the legion, the Catholic club.
 *
 * A town of twelve businesses often holds two or three of these, and they are
 * not all "<town> Social Club" — that is one club, and the second one three
 * doors down is a different one.
 */
const SOCIAL_CLUB_NAMES = [
  'Social Club',
  'Working Men\u2019s Club',
  'British Legion',
  'Conservative Club',
  'Catholic Club',
  'Ex-Servicemen\u2019s Club',
  'Trades and Labour Club',
  'Comrades Club',
  'Conservative and Unionist Club',
  'Royal British Legion',
  'Institute and Social Club',
  'Miners\u2019 Welfare',
  'Bowling and Social Club',
  'Sports and Social Club',
];

/**
 * The parish churches a Sunday side is named after, and the ends of town a club
 * calls home. Both are shapes of name rather than decoration: "St Wilfrid's" and
 * "Haxbridge North End" are what grassroots clubs are actually called, and a
 * world without either of them is a world of thirty-six sides called Athletic.
 */
const SAINT_NAMES = [
  'Aidan',
  'Alban',
  'Anne',
  'Barnabas',
  'Bede',
  'Chad',
  'Cuthbert',
  'Edmund',
  'Etheldreda',
  'George',
  'Guthlac',
  'Hilda',
  'Joseph',
  'Mary',
  'Michael',
  'Oswald',
  'Teresa',
  'Werburgh',
  'Wilfrid',
  'Winifred',
];

const COMPASS_ENDINGS = ['North End', 'South End', 'East End', 'West End'];

/**
 * The valleys the county's leagues are named after.
 *
 * The founding county takes one (`regionName`, drawn first), and a district
 * founded next door takes another: two ladders in a county with the same name is
 * a county with one league in it pretending to be two.
 */
export const REGION_VALLEY_NAMES = ['Wyre', 'Cale', 'Stour', 'Dene', 'Teme', 'Brue', 'Avon', 'Yare'] as const;

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
    `${river} is still the reason the mills were here, and the reason the bottom pitch floods.`,
    `Three new estates, one bus an hour, and a butcher who knows everybody's name.`,
    `A crossroads with a post office, a garage and not a great deal else.`,
    `Half the working population drives out of the county in the morning and back in at six.`,
    `The old railway line is a footpath now, and the station is a garden centre.`,
    `One church, two chapels, and a third chapel that sells carpets.`,
    `Roughly ${town.population.toLocaleString('en-GB')} people, and the football club has most of them on a Sunday.`,
    `Farms either side, a school in the middle, and a playing field behind it.`,
    `A market square that is a car park for six days of the week.`,
    `The sort of place where the pub landlord is also the club treasurer.`,
    `New houses on the old field, and the old field's name on the road sign.`,
    `A village that has more than doubled since the bypass opened.`,
    `Two industries came and went, and the football club outlasted both of them.`,
    `${town.name} is one of the places people drive through on the way to somewhere better.`,
    `A long straggle of a place strung out along one road, with the pitch at the far end of it.`,
  ];
  return rng.pick(patterns);
}

/**
 * The part of the map a region's settlements are drawn inside.
 *
 * Normalised 0..100 coordinates, the same space `Town.x`/`Town.y` live in. The
 * founding county is drawn in the whole map — the county *is* the map — and a
 * district founded next door is drawn in the box its own centre was chosen for.
 */
export interface SettlementArea {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface GenerateTownsOptions {
  rng: Rng;
  /** The river these settlements are described against. */
  river: string;
  /** The region every settlement belongs to unless the map says otherwise. */
  regionId: RegionId;
  /** The county every settlement drawn here is in. Defaults to the founding one. */
  countyId?: CountyId;
  /** Where they are drawn. Defaults to the whole map. */
  area?: SettlementArea;
  /** The first `town_<n>` and `biz_<n>` to write, so a later district continues the county's ids. */
  firstTownIndex?: number;
  firstBusinessIndex?: number;
  /**
   * Settlement names already used in this world.
   *
   * Taken rather than made here, because a world has one place per name and not
   * one per call: a district drawn after the county must not found a second
   * village under a name the county already has.
   */
  usedNames: Set<string>;
}

function generateTowns(options: GenerateTownsOptions): { towns: Town[]; businesses: Business[] } {
  const { rng, river, regionId } = options;
  const countyId = options.countyId ?? FOUNDING_COUNTY_ID;
  const area: SettlementArea = options.area ?? { xMin: 8, xMax: 92, yMin: 8, yMax: 92 };
  const firstTown = options.firstTownIndex ?? 1;
  const usedNames = options.usedNames;
  const towns: Town[] = [];
  const businesses: Business[] = [];

  // One anchor town, then a spread of smaller settlements. The ladder holds
  // thirty-six clubs, and the county offers the sites rather than the other way
  // round: a wider spread means many more places than the pyramid needs, so
  // which thirty-six of them get a club — and which are only a name on the map
  // with a pub and a rec — is different in every career rather than the same
  // eleven villages twice.
  const settlementPlan: SettlementKind[] = ['town'];
  const extras = rng.int(15, 22);
  for (let i = 0; i < extras; i++) settlementPlan.push(pickSettlementKind(rng));
  settlementPlan.push('village');

  let businessCounter = options.firstBusinessIndex ?? 0;
  settlementPlan.forEach((kind, index) => {
    const [minPop, maxPop] = POPULATION_RANGES[kind];
    const population = rng.gaussianInt((minPop + maxPop) / 2, (maxPop - minPop) / 4, minPop, maxPop);
    const town: Town = {
      id: `town_${firstTown + index}`,
      name: generatePlaceName(rng, usedNames),
      kind,
      population,
      x: rng.int(area.xMin, area.xMax),
      y: rng.int(area.yMin, area.yMax),
      // Where the town is decides which football it plays, so this is written
      // here, once, and never touched again for the life of the world. A
      // district's settlements are the one exception, and only while they are
      // being drawn: the map, not the call, has the last word on which region a
      // new settlement is in — see `nearestRegion`.
      regionId,
      countyId,
      description: '',
      businessIds: [],
    };

    const pubCount = Math.max(1, Math.round(population / 2600) + (kind === 'town' ? 1 : 1));
    // A bigger place has more than pubs in it. The high street is where a club
    // finds a sponsor, a name across the shirt and somewhere to hold the
    // presentation night, and the mix of trades is what makes one seed's county
    // different from another's beyond the names of the places: a town with a
    // garage, a butcher and a plumber is not the town with a farm shop and two
    // cafés, even when the two towns are the same size.
    const businessTarget =
      pubCount +
      (population > 4000 ? rng.int(2, 5) : population > 1500 ? rng.int(1, 3) : rng.chance(0.55) ? rng.int(1, 2) : 0);
    // No two businesses in one town share a name. Two towns on opposite sides of
    // a county may each have a Red Lion and always have; one town with three of
    // them is a mistake in the generator rather than local colour.
    const usedInTown = new Set<string>();
    const freeName = (candidate: () => string): string => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const name = candidate();
        if (!usedInTown.has(name)) {
          usedInTown.add(name);
          return name;
        }
      }
      return `${candidate()} No. ${usedInTown.size}`;
    };
    for (let i = 0; i < businessTarget; i++) {
      businessCounter += 1;
      const kindPick = i < pubCount ? (rng.chance(0.72) ? 'pub' : 'social-club') : rng.weighted(LOCAL_TRADES);
      const name =
        kindPick === 'pub'
          ? freeName(() => pubName(rng))
          : kindPick === 'social-club'
            ? freeName(() => `${town.name} ${rng.pick(SOCIAL_CLUB_NAMES)}`)
            : freeName(() => businessName(rng, capitalise(kindPick.replace('-', ' '))));
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

/**
 * A world id, in the county's own convention.
 *
 * The founding county's are plain — `club_1`, `ground_1`, `mgr_1` — because
 * those are the ids every career already has and not one of them may move. A
 * second ladder's carry the ladder's own id as a prefix — `club_cale_1` — which
 * is the same trick the competitions use (`comp_league_t1`, `comp_cale_t1`) and
 * the reason a district can be founded next to a running county without minting
 * a single id that already exists.
 */
function worldId(base: string, index: number, pyramidId?: PyramidId): string {
  return pyramidId ? `${base}_${pyramidId}_${index}` : `${base}_${index}`;
}

function generateGround(
  rng: Rng,
  town: Town,
  businesses: Business[],
  clubId: ClubId,
  clubIndex: number,
  usedGroundNames: Set<string>,
  pyramidId?: PyramidId,
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
    id: worldId('ground', clubIndex, pyramidId),
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
 * A club's standard, without the roll of the dice: the level its standing says
 * it plays at.
 *
 * This is the world's anchor. A squad is generated at this level, a youth intake
 * and a summer signing are generated at it, and a club that has drifted away
 * from it is rebuilt back to it. Every one of those has to read the *same*
 * figure, or the world has no level to come back to: a signing target taken from
 * the squad it is joining only rises with the squad, and thirty-six clubs
 * ratcheting each other upwards is what an inflated county looks like.
 *
 * 18 -> ~9.1, 88 -> ~12.3 on the 1-20 scale.
 */
export function clubStandardQuality(reputation: number): number {
  return Math.max(7.2, Math.min(13.5, 8.3 + (reputation / 100) * 4.6));
}

/**
 * The standard of player a club of a given standing tends to attract. Shared
 * with club creation, so a club the manager builds is as good as its standing
 * says it should be rather than being generated to a separate scale.
 *
 * 18 -> ~8.6, 88 -> ~12.4 on the 1-20 scale.
 */
export function clubQualityFromReputation(rng: Rng, reputation: number): number {
  return Math.max(7.2, Math.min(13.5, clubStandardQuality(reputation) + rng.gaussian(0, 0.4)));
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
    .shuffle([
      'Rovers',
      'Athletic',
      'United',
      'Wanderers',
      'Rangers',
      'Albion',
      'Corinthians',
      'Sports',
      'Town',
      'FC',
      'Victoria',
      'Old Boys',
      'Casuals',
      'Amateurs',
      'Nomads',
      'Crusaders',
      'Conservatives',
      'Conservative Club',
      'Catholic Club',
      "Working Men's Club",
      'British Legion',
      'Legion',
      'Social',
      'Swifts',
      'Juniors',
      'Veterans',
    ])
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

  // The other shapes a Sunday club's name takes, none of which are the town with
  // a suffix stuck on the end: the parish side, the works team, the road the
  // club plays on, the church that founded it, and the two or three lads who put
  // FC in front of the town rather than behind it.
  const saint = rng.pick(SAINT_NAMES);
  nameCandidates.push({ name: `${town.name} St ${saint}'s`, structure: 'community', business: null });
  nameCandidates.push({ name: `St ${saint}'s`, structure: 'community', business: null });
  nameCandidates.push({ name: `FC ${town.name}`, structure: 'community', business: null });
  nameCandidates.push({ name: `${town.name} AFC`, structure: 'members', business: null });
  nameCandidates.push({ name: `${town.name} Working Men's Club`, structure: 'committee', business: null });
  nameCandidates.push({ name: `${town.name} British Legion`, structure: 'committee', business: null });
  for (const ending of COMPASS_ENDINGS) {
    nameCandidates.push({ name: `${town.name} ${ending}`, structure: 'committee', business: null });
  }
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
  // Three tiers, because the list itself is in priority order: a pub or a local
  // business the club is named after, then the community names, then the whole
  // vocabulary of suffixes, which is the longest part of it by far.
  //
  // Drawn from the front three only — which is what this used to do — two clubs
  // in three are "<pub>" and one in three is "<town> Athletic", and every seed's
  // league table looks the same. Drawn uniformly from the whole list, three
  // clubs in four are "<town> <suffix>" and the county stops being the sort of
  // place where the football club is the pub: sponsorship has nobody to sell to,
  // and the shirts have no name across the chest. Weighted, the pub is the
  // ordinary case and the tail still gets a third of the county to itself.
  const weightFor = (index: number): number => (index < 3 ? 14 : index < 5 ? 4 : 1);
  const index = rng.weighted(free.map((_, position) => ({ value: position, weight: weightFor(position) })));
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
  // A club that puts its town last is anchored at the front — "FC Middle
  // Ashworth" is Middle Ashworth's club, and the part worth keeping is the town
  // rather than the FC. Clubs that lead with the town are read as they always
  // were. The distinguishing words of a leading name are those in front of the
  // town, which for `FC <town>` is the FC itself.
  const rest = name.startsWith(townName)
    ? name.slice(townName.length).trim().split(' ').filter(Boolean)
    : name.endsWith(townName)
      ? name.slice(0, name.length - townName.length).trim().split(' ').filter(Boolean)
      : [];
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
  const balance = rng.gaussianInt(town.kind === 'town' ? 1400 : 650, 450, -250, 4000);
  return {
    balance,
    // A generated club starts the world in the black with no history: its
    // opening balance is the whole of its balance.
    openingBalance: balance,
    subscriptionPerPlayer: rng.int(3, 6),
    // Matchday subs: a starter pays a little more than a man who only came on.
    // These are the realistic grassroots defaults, and they are the club's to
    // change — nothing else in the game reads a squad-wide weekly figure.
    starterSubAmount: 5,
    substituteSubAmount: 3,
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

export function generateManager(
  rng: Rng,
  clubTownId: TownId,
  clubReputation: number,
  index: number,
  pyramidId?: PyramidId,
): Official {
  const quality = clubQualityFromReputation(rng, clubReputation);
  return {
    id: worldId('mgr', index, pyramidId),
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

export function generateChairman(rng: Rng, townId: TownId, index: number, pyramidId?: PyramidId): Official {
  return {
    id: worldId('chm', index, pyramidId),
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

/**
 * The middle of a group of towns, in the same normalised space the towns carry.
 *
 * A region's centre is a fact about the map rather than a choice, so it is read
 * off the settlements in it; a county with no settlements at all is the middle
 * of its own map. Shared with the migration, so a region drawn by a migration
 * and one drawn by the generator describe the same place.
 */
export function regionCentreFor(towns: readonly Town[]): { x: number; y: number } {
  if (towns.length === 0) return { x: 50, y: 50 };
  let x = 0;
  let y = 0;
  for (const town of towns) {
    x += town.x;
    y += town.y;
  }
  return { x: x / towns.length, y: y / towns.length };
}

/**
 * Where a district next door is drawn: the centre it is built around, and the
 * box its settlements are generated inside.
 */
export interface DistrictArea extends SettlementArea {
  centre: { x: number; y: number };
}

/** How far from its centre a district's settlements are drawn. */
const DISTRICT_RADIUS = 17;

/**
 * The part of the map a district is drawn in.
 *
 * Told where a district stands, it stands there — the map is authored, and a
 * district's towns being where the manager who chose it on the map was told they
 * are is the whole point of naming the place in `domain/districts.ts`. Left to
 * find its own place, it is the emptiest part of the map: every candidate centre
 * on a coarse grid is scored by the distance to the nearest settlement the county
 * already has *and* the distance to the regions already drawn, and the roomiest
 * of them wins. The score is deliberately the *nearer* of the two rather than
 * their sum — a district wedged between two halves of the county is worse than
 * one out on its own edge, whatever the arithmetic says — and the world's own
 * stream shuffles the field first, so a county with two equally empty corners
 * gets one of them by the seed rather than by the order the grid happens to be
 * walked in. That is how every district founded before the map named all six was
 * placed, and it is what keeps the two districts every existing career has
 * standing exactly where they have always stood.
 */
function districtArea(
  rng: Rng,
  occupied: readonly Town[],
  regions: readonly Region[],
  centre?: { x: number; y: number },
): DistrictArea {
  const box = (at: { x: number; y: number }): DistrictArea => ({
    centre: { x: at.x, y: at.y },
    xMin: Math.max(4, at.x - DISTRICT_RADIUS),
    xMax: Math.min(96, at.x + DISTRICT_RADIUS),
    yMin: Math.max(4, at.y - DISTRICT_RADIUS),
    yMax: Math.min(96, at.y + DISTRICT_RADIUS),
  });
  if (centre) return box(centre);

  const nearestOf = (x: number, y: number, points: ReadonlyArray<{ x: number; y: number }>): number =>
    points.reduce((best, point) => Math.min(best, Math.hypot(point.x - x, point.y - y)), Infinity);

  const settlements = occupied.map((town) => ({ x: town.x, y: town.y }));
  const centres = regions.map((region) => region.centre);
  const candidates: Array<{ x: number; y: number; room: number }> = [];
  for (let x = 16; x <= 84; x += 4) {
    for (let y = 16; y <= 84; y += 4) {
      candidates.push({ x, y, room: Math.min(nearestOf(x, y, settlements), nearestOf(x, y, centres)) });
    }
  }
  const best = rng.shuffle(candidates).reduce((a, b) => (b.room > a.room ? b : a));
  return box(best);
}

/**
 * The region a settlement is in, read off the map.
 *
 * The nearest region centre wins, and a settlement exactly between two is given
 * to whichever the world's own stream names: a seeded tie-break rather than the
 * order the regions happen to be listed in, because a county that grows a third
 * district later must not redraw the second one's boundary by being listed
 * first.
 *
 * It is asked of a settlement that is being *founded*. A town the county already
 * has keeps the region it was drawn in, because a town's region is written once
 * and never rewritten (see `Town.regionId`): the county that is already being
 * played cannot have its towns handed to a district founded next door to it,
 * and the football those towns play is the reason — a club's ladder is read from
 * its town, so moving a town would move a career's clubs between leagues.
 */
export function nearestRegion(
  regions: readonly Region[],
  position: { x: number; y: number },
  rng: Rng,
): Region {
  const [first, ...others] = regions;
  if (!first) throw new Error('nearestRegion called with no regions');
  let best = first;
  let bestDistance = Math.hypot(first.centre.x - position.x, first.centre.y - position.y);
  for (const region of others) {
    const distance = Math.hypot(region.centre.x - position.x, region.centre.y - position.y);
    if (distance < bestDistance) {
      best = region;
      bestDistance = distance;
    } else if (distance === bestDistance && rng.chance(0.5)) {
      best = region;
    }
  }
  return best;
}

interface MintClubOptions {
  rng: Rng;
  seed: string;
  currentYear: number;
  seasonStart: ISODate;
  clubId: ClubId;
  /** 1-based position in its ladder: what its ground, manager and chairman ids count from. */
  index: number;
  town: Town;
  businesses: readonly Business[];
  /** The ladder that owns the club, or nothing at all for the founding county. */
  pyramidId?: PyramidId;
  usedNames: Set<string>;
  usedNicknames: Set<string>;
  usedGroundNames: Set<string>;
  usedBusinesses: Set<string>;
  clubs: Record<ClubId, Club>;
  people: Record<PersonId, Person>;
  grounds: Record<GroundId, Ground>;
}

/**
 * One club, from the name on the shirt to the last name on the committee.
 *
 * This is the county's whole rule for what a club is — its name, its standing,
 * its ground, its manager and chairman, its squad and its books — and it is
 * shared by the founding county and by every district founded after it. A second
 * ladder is not a second kind of club: it is the same club in a different place,
 * with its ladder's own id in front of the ids it mints. Nothing about the
 * football differs by ladder, and nothing should: the day a district's clubs are
 * generated differently is the day the two ladders stop being comparable.
 */
function mintClub(options: MintClubOptions): Club {
  const { rng, town, clubId, pyramidId } = options;
  const businesses = [...options.businesses];
  const { identity, structure, business } = buildClubName(
    rng,
    town,
    businesses,
    options.usedNames,
    options.usedNicknames,
    options.usedBusinesses,
    options.currentYear,
  );
  const reputation = reputationForTown(rng, town);
  const ground = generateGround(rng, town, businesses, clubId, options.index, options.usedGroundNames, pyramidId);
  ground.tenantClubId = clubId;
  options.grounds[ground.id] = ground;

  if (business) business.sponsoredClubIds.push(clubId);

  const manager = generateManager(rng, town.id, reputation, options.index, pyramidId);
  manager.clubId = clubId;
  manager.roles = [{ clubId, role: 'manager', since: options.seasonStart }];
  const chairman = generateChairman(rng, town.id, options.index, pyramidId);
  chairman.clubId = clubId;
  chairman.roles = [{ clubId, role: 'chairman', since: options.seasonStart }];
  options.people[manager.id] = manager;
  options.people[chairman.id] = chairman;

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
    options.people[player.id] = player;
    squadIds.push(player.id);
  }

  // A minority of grassroots clubs are run by a player-manager who picks
  // themselves every week. Marked here so the world model can carry it.
  const usesPlayerManager = structure !== 'committee' && rng.chance(0.18) && squad.length > 0;
  const candidate = usesPlayerManager ? (squad.find((p) => p.age >= 28) ?? squad[0]!) : null;
  if (candidate) {
    const playerManager = options.people[candidate.id] as Player;
    playerManager.isPlayerManager = true;
    playerManager.roles = [{ clubId, role: 'player-manager', since: options.seasonStart }];
    options.people[manager.id] = {
      ...manager,
      role: 'assistant',
      roles: [{ clubId, role: 'assistant', since: options.seasonStart }],
      notes: ['Stepped back to assist a player-manager.'],
    } as Official;
  }

  // The rest of the committee. A Sunday club gets a plausible, partial backroom
  // — a secretary, maybe a coach, often nobody else — drawn from the club's
  // own stream so it never disturbs the football generated around it.
  const staff = generateClubStaff({
    seed: options.seed,
    clubId,
    townId: town.id,
    reputation,
    structure,
    seasonStart: options.seasonStart,
    squad,
    people: options.people,
    managerId: candidate ? candidate.id : manager.id,
    chairmanId: chairman.id,
    assistantId: candidate ? manager.id : null,
  });

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
    staff,
    sponsorIds: business ? [business.id] : [],
    finances: buildFinances(rng, town, reputation),
    history: emptyHistory(rng, identity.foundedYear),
    tactics: defaultTactics('4-4-2'),
    active: true,
    rivalries: {},
    // A crowd since the year the club was founded: nobody invented one, and
    // the game does not need to pretend it watched the first game either.
    supporters: defaultSupporters(`${identity.foundedYear}-08-01`),
  };
  options.clubs[clubId] = club;
  return club;
}

/**
 * Geography creates rivalries: the closest neighbours care most about each other.
 *
 * Asked of one ladder's clubs at a time. A district drawn next door is inside
 * the same county and could in principle have a derby with the county's own
 * clubs — and one day it may, when the two ladders meet in the county cup — but
 * a rivalry is generated here from geography and the count of draws it makes is
 * fixed by the clubs it is asked about, so the county's own rivalries are made
 * from the county's own clubs and nothing else.
 */
function linkRivalries(rng: Rng, clubs: readonly Club[], towns: readonly Town[]): void {
  const clubList = [...clubs];
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
      // Geography is the waterline, not the weather: a relationship that exists
      // before either club has kicked a ball is a derby (or the closest thing
      // to one), and it is the thing that never cools. Everything the seasons
      // add on top of it is heat. See `simulation/rivalries.ts`.
      const rivalry = {
        intensity,
        note: sameTown ? 'Neighbours sharing a town and a car park.' : 'Closest away trip on the calendar.',
        baseline: intensity,
        kind: (intensity >= 55 ? 'derby' : 'competitive') as RivalryKind,
        lastMetOn: null,
        meetings: 0,
        heat: 0,
      };
      club.rivalries[other.id] = rivalry;
      other.rivalries[club.id] = { ...rivalry };
    }
  }
}

/** Ground sharing: village clubs often share a pitch. */
function shareGrounds(rng: Rng, clubs: readonly Club[], towns: readonly Town[], grounds: Record<GroundId, Ground>): void {
  for (const club of clubs) {
    if (!rng.chance(0.12)) continue;
    const town = towns.find((t) => t.id === club.townId)!;
    const candidate = clubs.find(
      (other) => other.id !== club.id && other.townId === town.id && other.groundId !== club.groundId,
    );
    if (!candidate) continue;
    const shared = grounds[candidate.groundId];
    if (!shared) continue;
    shared.sharedWith.push(club.id);
    if (rng.chance(0.5)) club.groundId = shared.id;
  }
}

/**
 * What a district is founded from.
 *
 * The world as it already stands, handed over rather than read from a state:
 * this is the world generator's job, and it is asked to do it at generation for
 * a new career and — when a career already running is given its missing
 * districts — at a season boundary, by `simulation/worldExpansion.ts`.
 * Everything it is given is what the county already has; everything it adds is
 * appended to it. One call founds one district, so founding the county's six is
 * six calls and a district founded a season later is one of them, and the
 * function has no idea which of those it is part of.
 */
export interface FoundDistrictOptions {
  seed: string;
  currentYear: number;
  seasonStart: ISODate;
  /** Every settlement the world already has; the district's are added to it. */
  towns: Town[];
  /** Every business the world already has; the district's are added to it. */
  businesses: Business[];
  /** The world's grounds, clubs and people; the district's are added to them. */
  grounds: Record<GroundId, Ground>;
  clubs: Record<ClubId, Club>;
  people: Record<PersonId, Person>;
  /** Every region already drawn, the founding region included. */
  regions: readonly Region[];
  /**
   * The id the district's ladder is written under, and the prefix of every id it
   * mints — its clubs, their grounds, and the men who run them.
   *
   * Left out, the district is named after the valley it draws, which is what every
   * district founded before a caller could name its own ladder has been called
   * (`cale` → `comp_cale_t1`, `club_cale_1`) and what a career of them still is.
   * Given, it is used exactly as it is and the valley becomes a label: the ladder,
   * its clubs, their grounds and the men who run them are all minted under the id
   * the caller chose, whatever valley the district happens to be drawn in.
   */
  id?: PyramidId;
  /**
   * The ladder's own name. Defaults to `<valley> Valley Sunday League`, which is
   * the name the district's region gives it.
   */
  name?: string;
  /**
   * The district's region's own name — the place the ladder draws its clubs from.
   * Defaults to `<valley> Valley`, the name the valley is called after.
   *
   * Display data either way: nothing reads a region by its name, so a caller that
   * names its own region is naming a place rather than deciding where it is.
   */
  regionName?: string;
  /**
   * The valleys already spoken for, by name.
   *
   * Two ladders in one county never carry the same name, so the district draws a
   * valley the world has not used. A caller that knows the county's valley passes
   * it (`generateWorld` has just drawn one); left out, it is read off the founding
   * region's own name — the only place a world that was written before a caller
   * could be told the valley has it written down. See `valleyOfRegion`.
   */
  takenValleyNames?: readonly string[];
  /**
   * The ladders the world already has, so a district cannot be founded under an id
   * that is in use. Left out, nothing is checked: the function is handed the world
   * but not its ladder records, so a caller that knows them says so — which every
   * production caller does.
   */
  pyramidIds?: readonly PyramidId[];
  /**
   * The id the district's own region is written under. Defaults to
   * {@link SECOND_REGION_ID} — the district next door to the county.
   */
  regionId?: RegionId;
  /**
   * The level of football the district plays at: 1 is the county's strongest
   * ladder. Defaults to 2 — one level below the founding county's own.
   */
  level?: number;
  /**
   * The county the district belongs to, and so the county of every settlement
   * drawn for it. Defaults to the founding county: a district next door is the
   * founding county's own football, one valley over.
   */
  countyId?: CountyId;
  /** The ladder's shape. Defaults to {@link SECOND_PYRAMID_CONFIG}. */
  config?: PyramidConfig;
  /**
   * The first `town_<n>` and `biz_<n>` to write.
   *
   * Left out, the district continues the count of the lists it was handed, which
   * is exactly right for a world being generated in one go. A district founded
   * into a career that has been played for ten seasons is told where that
   * career's own count has got to instead, because the two agree only by
   * accident and a settlement numbered from the wrong end is a settlement id that
   * already belongs to the county.
   */
  firstTownIndex?: number;
  firstBusinessIndex?: number;
  /**
   * Where the district stands in the world's own 0..100 map space.
   *
   * Given, the district is drawn where the map draws it — the place named in
   * `domain/districts.ts` and read off the atlas by
   * `geography/alderland.ts` — which is what makes the district a manager chose
   * on the map the district he manages in. Left out, it is drawn in the emptiest
   * quarter of the map it has as it is founded, which is how every district
   * founded before the map named six was placed.
   */
  centre?: { x: number; y: number };
  /**
   * A stream of its own to draw the district from, appended to the seed.
   *
   * Left out, the district draws from `${seed}::district` — the stream the
   * district next door to the county has drawn from since it existed, kept
   * exactly as it is because a career's second ladder is a world that has
   * already been written down. A county founding several districts beside each
   * other gives each one a stream of its own (`::region_3`), so five districts
   * do not all draw the same valley, the same river and the same quarter of the
   * map.
   */
  stream?: string;
}

/**
 * A district founded beside the county, and the ladder it plays in.
 *
 * Its region, its settlements, its clubs, its grounds and its people are all
 * written into the world it was handed; this is the ladder itself — the region
 * it draws its clubs from, the shape it was founded with, and the divisions its
 * clubs were cut into.
 */
export interface FoundedDistrict {
  /**
   * Its own id, and the prefix of every competition it owns: `cale` → `comp_cale_t1`.
   * The valley's name unless the caller supplied one of its own — see
   * `FoundDistrictOptions.id`.
   */
  id: PyramidId;
  /** 'Cale Valley Sunday League', or the caller's own name for the ladder. */
  name: string;
  /** Its level in the county's football: 2 unless the caller asked for another. */
  level: number;
  config: PyramidConfig;
  /** The region it draws its clubs from — `region_2`, whatever it is called. */
  region: Region;
  /** The settlements drawn for it, the ones the map kept being these included. */
  towns: Town[];
  /** Its divisions, tier 1 first, strongest first within a division. */
  divisions: ClubId[][];
  /**
   * The valley its own stream drew, which its id is made of.
   *
   * Handed back so that whoever founds the next district can pass it on as
   * spoken for (`takenValleyNames`): two ladders in one county under one name is
   * a county with one league in it pretending to be two, and the caller is the
   * only one who knows which valleys the districts it has already founded used.
   */
  valley: string;
}

/**
 * Found a district and the ladder it plays in.
 *
 * A district is a whole world of its own — its own valley, its own settlements,
 * its own town clubs and their grounds, managers and committees — and it is
 * generated by the same rules as the founding county rather than by a second
 * generator, because the county's football is the same football in every place
 * it is played. One call founds one district: the county's six are six calls,
 * a district founded at a season boundary is one of them, and nothing here
 * knows or cares which.
 *
 * Everything is drawn from the district's own streams, which is what makes it
 * safe to found next to a career that is already being played: not one number,
 * name or id the county already has moves because the district exists, and the
 * same world asked for the same district twice gets the same one.
 *
 * Where the district is drawn is either told to it — `centre`, read off the
 * atlas — or read off the world it is handed, because the empty quarter of the
 * map is a fact about the settlements a career actually has. Either way the map
 * has the last word on a settlement's region, and a district founded at a season
 * boundary stands where that career's map puts it.
 */
export function foundDistrictPyramid(options: FoundDistrictOptions): FoundedDistrict {
  const config: PyramidConfig = { ...(options.config ?? SECOND_PYRAMID_CONFIG) };
  const regionId = options.regionId ?? SECOND_REGION_ID;
  const countyId = options.countyId ?? FOUNDING_COUNTY_ID;
  const rng = new Rng(`${options.seed}::district${options.stream ? `::${options.stream}` : ''}`);
  // The county's valley is drawn first and taken; the district takes another, so
  // two ladders in one county never carry the same name. The valley is drawn
  // whether or not the caller named the ladder, because the name of the place is
  // drawn from this stream and the settlements below are drawn after it — a caller
  // that supplies its own id is naming a ladder, not skipping a draw.
  const takenValleys = new Set(options.takenValleyNames ?? [valleyOfRegion(options.regions[0])]);
  const available = REGION_VALLEY_NAMES.filter((name) => !takenValleys.has(name));
  if (available.length === 0) {
    throw new Error('Every valley is taken: there is no name left for another ladder.');
  }
  const valley = rng.pick(available);
  // Identity, then the labels built from it. An id given is an id used, and the
  // valley is a name from here on; left out, the valley is the id, which is
  // exactly what every district founded before this has been called.
  const id: PyramidId = options.id ?? valley.toLowerCase();
  const regionName = options.regionName ?? `${valley} Valley`;
  const name = options.name ?? `${regionName} Sunday League`;
  const level = options.level ?? 2;

  // Nothing is minted into a world that already holds these. A ladder or a region
  // written under an id the world is using would take another's place, so the
  // caller is told rather than the world being quietly rearranged — and it is
  // asked before a single club, ground or person exists, so a refusal leaves the
  // world exactly as it was handed over.
  if (options.pyramidIds?.includes(id)) {
    throw new Error(`The world already has a ladder called ${id}.`);
  }
  if (options.regions.some((region) => region.id === regionId)) {
    throw new Error(`The world already has a region called ${regionId}.`);
  }
  const river = riverName(rng);
  const area = districtArea(rng, options.towns, options.regions, options.centre);
  const region: Region = { id: regionId, name: regionName, centre: area.centre, countyId };
  const regions = [...options.regions, region];

  // --- The district's settlements ------------------------------------------
  const usedTownNames = new Set(options.towns.map((town) => town.name));
  const mine: Town[] = [];
  const businesses: Business[] = [];
  const offered: Town[] = [];
  let nextTown = options.firstTownIndex ?? options.towns.length + 1;
  let nextBusiness = options.firstBusinessIndex ?? options.businesses.length;

  const drawSettlements = (batch: number): void => {
    const drawn = generateTowns({
      rng: new Rng(`${options.seed}::district::${id}::towns::${batch}`),
      river,
      regionId: region.id,
      countyId,
      area,
      firstTownIndex: nextTown,
      firstBusinessIndex: nextBusiness,
      usedNames: usedTownNames,
    });
    for (const town of drawn.towns) {
      // The map has the last word on where a new settlement is: one that lands
      // nearer another region is a village of *that* region's county with no
      // club of the district's in it, rather than a district club standing in
      // the wrong county. Its own region's slots are the only ones the ladder
      // can use, and the county it is in is the county of the region it
      // actually landed in rather than the one it was drawn for.
      const landed = nearestRegion(regions, { x: town.x, y: town.y }, rng);
      town.regionId = landed.id;
      town.countyId = landed.countyId ?? countyId;
      mine.push(town);
      if (town.regionId !== region.id) continue;
      for (let i = 0, count = clubCountFor(town.kind, rng); i < count; i += 1) offered.push(town);
    }
    for (const business of drawn.businesses) businesses.push(business);
    nextTown += drawn.towns.length;
    nextBusiness += drawn.businesses.length;
  };

  // The county offers the sites rather than the ladder asking for them: a spread
  // of settlements, and the ladder takes as many of the clubs they could hold as
  // it has places. A district that cannot hold a ladder at all is drawn again in
  // its own empty quarter rather than being handed clubs it has no town for.
  const wanted = Math.max(1, config.tiers * config.clubsPerTier);
  for (let batch = 0; batch < 6 && offered.length < wanted; batch += 1) drawSettlements(batch);

  options.towns.push(...mine);
  options.businesses.push(...businesses);

  // --- The district's clubs -------------------------------------------------
  // Names are the world's, not the ladder's: a district club cannot be called
  // what a county club is already called, and a pub cannot back one club in each
  // half of the county.
  const usedNames = new Set(Object.values(options.clubs).map((club) => club.identity.name));
  const usedNicknames = new Set(Object.values(options.clubs).map((club) => club.identity.nickname));
  const usedGroundNames = new Set<string>();
  const usedBusinesses = new Set(
    options.businesses.filter((business) => business.sponsoredClubIds.length > 0).map((business) => business.id),
  );

  const clubTasks = rng.shuffle(offered).slice(0, wanted);
  const clubs = clubTasks.map((town, index) =>
    mintClub({
      rng,
      seed: options.seed,
      currentYear: options.currentYear,
      seasonStart: options.seasonStart,
      clubId: worldId('club', index + 1, id),
      index: index + 1,
      town,
      businesses,
      pyramidId: id,
      usedNames,
      usedNicknames,
      usedGroundNames,
      usedBusinesses,
      clubs: options.clubs,
      people: options.people,
      grounds: options.grounds,
    }),
  );

  linkRivalries(rng, clubs, options.towns);
  shareGrounds(rng, clubs, options.towns, options.grounds);

  /** Clubs ranked on reputation, cut into divisions of the configured size. */
  const ranked = clubs
    .slice()
    .sort((a, b) => b.reputation - a.reputation)
    .map((club) => club.id);
  const divisions: ClubId[][] = [];
  for (let tier = 0; tier < config.tiers; tier += 1) {
    divisions.push(ranked.slice(tier * config.clubsPerTier, (tier + 1) * config.clubsPerTier));
  }

  return { id, name, level, config, region, towns: mine, divisions, valley };
}

/**
 * The valley a region's name came from — 'Cale Valley' → 'Cale' — in a world
 * written before the map named the districts.
 *
 * The last place a valley is read rather than handed over, and it is only read
 * because a world's regions are written down by name and by nothing else that says
 * which valley each was drawn from: a district founded into a career that is
 * already being played can only be told which names are spoken for by the names
 * the career holds. A world being generated now has just drawn the county's
 * valley and passes it in (`takenValleyNames`), so nothing built from a definition
 * has to read a label to decide an identity.
 */
function valleyOfRegion(region: Region | undefined): string {
  return region?.name.split(' ')[0] ?? '';
}

export function generateWorld(options: GenerateWorldOptions): GeneratedWorld {
  const rng = new Rng(`${options.seed}::world`);
  const river = riverName(rng);
  // The county is named rather than drawn — it is the setting, not a thing the
  // seed invents (see `FOUNDING_COUNTY_NAME`) — and the draw that used to name
  // it is still taken. Everything inside the county is drawn from this stream
  // after it: the towns, the clubs, the people, their names. Keeping the draw is
  // what makes a seed build the town it always built, so a manager who names the
  // same seed twice gets the same Alderfordshire down to the last publican.
  generatePlaceName(rng, new Set());
  const countyName = FOUNDING_COUNTY_NAME;
  // The valley is still drawn, and the draw is still taken before the towns: it
  // is what the district next door is keyed to, so two seeds hold two different
  // districts. It no longer *names* anything — the two live regions are named by
  // the map a manager chose his district on (`FOUNDING_REGION_NAME`, and
  // `SECOND_REGION_NAME` below) rather than by the valley this seed happened to
  // draw. Read the drawn valley back through `valleyOfRegion` only for a world
  // written before the districts were named.
  const valley = rng.pick(REGION_VALLEY_NAMES);
  const regionName = FOUNDING_REGION_NAME;

  // The county's own settlements, drawn first because everything else in the
  // world is a fact about them: the region they sit in, the ladder cut from
  // their clubs, the river in their descriptions.
  //
  // The founding region is named before the towns and centred after them, and it
  // is the one region for which that is the whole truth: its settlements *are*
  // the county, so where the county is is read off them. A district founded next
  // door is the other way round — see `foundDistrictPyramid`, which chooses where
  // the district is before it draws a single settlement in it.
  //
  // None of this draws anything new from the world's stream, so the county is
  // exactly the county it was before regions existed.
  const { towns, businesses } = generateTowns({
    rng,
    river,
    regionId: FOUNDING_REGION_ID,
    countyId: FOUNDING_COUNTY_ID,
    usedNames: new Set<string>(),
  });
  const region: Region = {
    id: FOUNDING_REGION_ID,
    name: regionName,
    centre: regionCentreFor(towns),
    countyId: FOUNDING_COUNTY_ID,
  };
  const regions: Record<RegionId, Region> = { [region.id]: region };

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
    mintClub({
      rng,
      seed: options.seed,
      currentYear: options.currentYear,
      seasonStart: options.seasonStart,
      clubId: worldId('club', index + 1),
      index: index + 1,
      town: task.town,
      businesses,
      usedNames,
      usedNicknames,
      usedGroundNames,
      usedBusinesses,
      clubs,
      people,
      grounds,
    });
  });

  // Geography creates rivalries and village clubs often share a pitch. Both are
  // asked of the county's own clubs, before any district next door exists, so
  // that what the county's clubs are to each other is exactly what it has always
  // been.
  const clubList = Object.values(clubs);
  linkRivalries(rng, clubList, towns);
  shareGrounds(rng, clubList, towns, grounds);

  // Every district founded after the county rather than beside it: each one's
  // own streams draw its valley, its settlements, its clubs and the people who
  // run them, so nothing the county has already drawn moves because another
  // district exists. The county itself is not founded here — it *is* this
  // function — so the districts are everything in the list after it.
  const districts: FoundedDistrict[] = [];
  const takenValleys: string[] = [valley];
  for (const definition of countyDistricts(options).slice(1)) {
    const district = foundDistrictPyramid({
      seed: options.seed,
      currentYear: options.currentYear,
      seasonStart: options.seasonStart,
      towns,
      businesses,
      grounds,
      clubs,
      people,
      regions: Object.values(regions),
      // The county's valley and the districts already founded, both passed rather
      // than read back: this world knows what it drew, so a district's identity
      // does not depend on another district's name being what it says it is.
      takenValleyNames: takenValleys,
      pyramidIds: [FOUNDING_PYRAMID_ID, ...districts.map((founded) => founded.id)],
      // Where the map puts the district, and what the map calls it. Its id is
      // still the drawn valley's, so its clubs, grounds and settlements are the
      // ones this seed mints for it — see `football` in `geography/alderland.ts`,
      // which binds a ladder to the region the district is drawn as rather than
      // to a name or to a position in a list.
      regionId: definition.regionId,
      regionName: definition.name,
      level: definition.level,
      config: definition.config,
      centre: definition.centre,
      // Which stream the district draws its valley, its river and its quarter of
      // the map from is the district's own business and is authored with it (see
      // `legacy`): a district the county has always had draws from the stream it
      // has always drawn from, so a county founded with it is the world it has
      // always been, id for id, and every district the map has added draws from a
      // stream keyed to the region it is drawn in, so five districts are five
      // draws rather than one valley, one river and one quarter of the map five
      // times.
      ...(definition.legacy ? {} : { stream: definition.regionId }),
      // And every district founded after the county is told where the ids it
      // mints continue, because the count it is joining is this world's and not
      // its own.
      ...(districts.length === 0
        ? {}
        : {
            firstTownIndex: highestIdNumber(towns.map((town) => town.id), 'town_') + 1,
            // The business counter is stepped before its id is written, so the
            // district is told the last number in use rather than the next one.
            firstBusinessIndex: highestIdNumber(businesses.map((business) => business.id), 'biz_'),
          }),
    });
    districts.push(district);
    regions[district.region.id] = district.region;
    takenValleys.push(district.valley);
  }

  // The county, holding every region the world was drawn with. Written after the
  // district rather than before it, because a district next door is a piece of
  // the same county: its settlements are the county's settlements and its ladder
  // is a second ladder of the county's football — which is exactly why one cup
  // can be drawn across both and a club of one can never enter the other's.
  const county: County = { id: FOUNDING_COUNTY_ID, name: countyName, regionIds: Object.keys(regions) };
  const counties: Record<CountyId, County> = { [county.id]: county };

  const world: World = {
    id: `world_${options.seed}`,
    seed: options.seed,
    regionName,
    countyName,
    nationName: NATION_NAME,
    counties,
    countyIds: [county.id],
    regions,
    regionIds: Object.keys(regions),
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
    districts,
  };
}

/**
 * The districts the county is founded with.
 *
 * The caller's own list when it has one — a county is a list of places, and a
 * caller that knows which places is not asked to say it twice — and otherwise
 * the county's authored geography: every district Alderfordshire has, or, when
 * the caller names a compatibility count, the first that many of them, in the
 * map's own order. Part of the county is a prefix of it and never a different
 * county, so a world founded with two districts is the world founded with six
 * with four left off the end.
 */
function countyDistricts(options: GenerateWorldOptions): readonly DistrictDefinition[] {
  if (options.districts) return options.districts;
  const county = alderfordshireDistricts();
  if (options.pyramids === undefined) return county;
  return county.slice(0, Math.max(0, options.pyramids));
}

/**
 * The highest number a world's own id sequence has got to, or 0 for a sequence
 * nothing has used yet.
 *
 * The generator numbers a district's settlements and businesses by continuing
 * the world's own count (`town_<n>`, `biz_<n>`), so a district founded beside a
 * county — or into a career that has been played for ten seasons — has to be told
 * where that count has got to. It is read off the ids the world actually holds
 * rather than taken from how many there are, because a played world is not a
 * freshly generated one and the two only agree by accident.
 */
export function highestIdNumber(ids: readonly string[], prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const value = Number(id.slice(prefix.length));
    if (Number.isInteger(value)) highest = Math.max(highest, value);
  }
  return highest;
}


