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

function generateTowns(rng: Rng, river: string): { towns: Town[]; businesses: Business[] } {
  const usedNames = new Set<string>();
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
      people,
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


