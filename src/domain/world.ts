import type { BusinessId, ClubId, CountyId, GroundId, ISODate, RegionId, TownId, WorldId } from './ids';

export type SettlementKind = 'town' | 'small-town' | 'village' | 'hamlet';

/**
 * The country the game is played in.
 *
 * One nation, made of counties, and a career is played inside one of them: the
 * county is the world a manager knows — its towns, its clubs, its ladders and
 * the cups drawn across them — and the nation is the fact that there are other
 * counties like it, with their own football, which is what a competition between
 * counties would be played for. Nothing draws on it yet; it is named here so that
 * the county a career is played in has somewhere to belong, and so that the name
 * is written down once rather than invented by whichever screen needs it first.
 */
export const NATION_NAME = 'Alderland';

/**
 * The county every career begins in.
 *
 * It has a name of its own rather than one drawn from the seed, because the
 * county is the *setting* rather than a thing generated: a manager's career is
 * played in Alderfordshire whoever he is and whatever seed built the towns, and
 * the cups and honours that outlive a single club are its county's. The places
 * inside it — its valleys, its districts, its villages — are still drawn from the
 * seed, so the county is named the same way in every career and laid out
 * differently in each.
 */
export const FOUNDING_COUNTY_NAME = 'Alderfordshire';

/**
 * The id of the county every career is played in — and, today, the only one.
 *
 * The name above is what the county is called; this is what it *is*. Keeping the
 * two apart is what lets a county be renamed, and a second county be added
 * beside it, without any competition, region or town that belongs to it moving:
 * ownership is read from ids, and every id in a career written before counties
 * existed already means this one.
 */
export const FOUNDING_COUNTY_ID: CountyId = 'county_1';

/**
 * The region the founding county is drawn around: the one every career starts
 * with, and the one every town of a save written before regions existed is
 * placed in.
 */
export const FOUNDING_REGION_ID: RegionId = 'region_1';

/**
 * The region the county's second ladder draws its clubs from.
 *
 * The founding county is `region_1`; a district founded next door is
 * `region_2`, whatever it is called and wherever on the map it is drawn. The id
 * is written once, when the district is drawn, and every town in it carries it —
 * so a ladder's region is a fact about the map rather than about the ladder's
 * name, and a career that gains its second district later gains this id rather
 * than inventing another.
 */
export const SECOND_REGION_ID: RegionId = 'region_2';

/**
 * The names the county's two live regions wear.
 *
 * A region is a district of the map, and the map is authored rather than drawn:
 * the county has two playable districts — Alderford, and Westbrook Valley next
 * door — and they are the same two places in every career. What the seed decides
 * is what is *inside* them, not what they are called, so a manager who chose
 * Alderford on the map reads Alderford on his league table and his cups rather
 * than whatever valley that seed happened to draw.
 *
 * The valley draw itself still happens (see `generateWorld`): the district's
 * clubs, grounds and settlements are keyed to the valley it draws, and the draw
 * is what keeps two seeds' districts different places. It simply no longer names
 * the place.
 *
 * `geography/alderland.ts` reads these for the two playable districts and
 * `geographySetup.test.ts` holds them together, so the name on the map and the
 * name on the league table cannot come apart again.
 */
export const FOUNDING_REGION_NAME = 'Alderford';
export const SECOND_REGION_NAME = 'Westbrook Valley';

/**
 * A county: the football world a career is played in.
 *
 * A county owns the regions its map is drawn from, and a ladder belongs to the
 * county its region is in — so "whose football is this" is answered from the
 * map rather than from a ladder's name or the order the world was drawn in. With
 * one county the county is the world, which is what every career written before
 * counties existed was played in; a second county is a second one of these with
 * its own regions, towns and ladders beside it, and neither county's cups can
 * reach the other's clubs.
 */
export interface County {
  id: CountyId;
  name: string;
  /** Every region of the map this county is drawn from, keyed by id elsewhere. */
  regionIds: RegionId[];
}

/**
 * The region a town belongs to, and so the football a club in it plays.
 *
 * A region is a piece of its county rather than a competition: it says where a
 * town is and nothing about how good its football is. The founding county has
 * one drawn around every town it has, and a district next door has one of its
 * own, and a club's region is read from its town — `clubs[c].townId →
 * towns[t].regionId` — so a club cannot lose its geography by changing division.
 * Its county is read the same way, one step further out.
 */
export interface Region {
  id: RegionId;
  name: string;
  /** The county this region is a piece of. */
  countyId: CountyId;
  /** Normalised 0..100 map coordinates, the same space as `Town.x`/`Town.y`. */
  centre: { x: number; y: number };
}

/**
 * A place in the local football world. Positions are normalised 0..100 map
 * coordinates so travel distance is geometric rather than a lookup table.
 */
export interface Town {
  id: TownId;
  name: string;
  kind: SettlementKind;
  population: number;
  x: number;
  y: number;
  /**
   * The town's home region. Written once when the world is generated and never
   * rewritten: a town does not move county because a club of its changed league.
   */
  regionId: RegionId;
  /**
   * The county the town is in, and so the county its clubs play their football
   * in. Written with the region and never rewritten — a cup a club is eligible
   * for is a fact about where it is from, not about how good it is.
   */
  countyId: CountyId;
  /** Short flavour line, used by the world view and news templates. */
  description: string;
  /** Local pubs/businesses that can lend a club its name and sponsor it. */
  businessIds: BusinessId[];
}

export type GroundSurface = 'grass' | 'grass (uneven)' | '3G' | 'cinder';

export interface Ground {
  id: GroundId;
  name: string;
  townId: TownId;
  /** Club that uses it as its home venue. */
  tenantClubId: ClubId | null;
  capacity: number;
  surface: GroundSurface;
  /** 1-20. Poor quality grounds hammer passing and increase injuries. */
  quality: number;
  /** 1-20; low drainage means more waterlogged Sundays. */
  drainage: number;
  hasFloodlights: boolean;
  hasChangingRooms: boolean;
  hasClubhouse: boolean;
  /** Pitch hire charged per home fixture, in pounds. */
  matchdayCost: number;
  /** Shared grounds are a real feature of grassroots football. */
  sharedWith: ClubId[];
  /**
   * The surface this ground was born with, before anybody worked on it.
   *
   * Written the first time the pitch is worked on or wears, and never moved
   * again. It is the floor a winter can grind an improved surface back down to,
   * so a club can lose what it has bought and never what the world gave it —
   * and it is what stops a county of unimproved pitches from slowly eroding.
   * Absent on a ground nobody has touched, and on a save written before there
   * was anything to improve.
   */
  baseQuality?: number;
  /**
   * Home fixtures played on it since the wear was last counted.
   *
   * The pitch is a physical thing used by whoever plays there, so this is the
   * ground's own count and not any one club's: a shared pitch wears from both
   * tenants' Sundays.
   */
  fixturesSinceAttention?: number;
  /**
   * The last date a fixture on this pitch was counted for wear.
   *
   * The day is counted once, whatever else happens to it: a save resumed on a
   * Sunday, or a day processed twice, must not wear a pitch down twice for the
   * same afternoon's football.
   */
  lastWearOn?: ISODate | null;
}

export type BusinessKind = 'pub' | 'social-club' | 'builder' | 'garage' | 'butcher' | 'cafe' | 'plumbers' | 'farm-shop';

export interface Business {
  id: BusinessId;
  name: string;
  kind: BusinessKind;
  townId: TownId;
  /** 1-20: how much they can put behind a club. */
  wealth: number;
  /** Clubs this business currently backs. */
  sponsoredClubIds: ClubId[];
}

export interface World {
  id: WorldId;
  seed: string;
  /** The founding region's league name, kept for division naming. */
  regionName: string;
  /**
   * The county the career is played in: 'Alderfordshire'.
   *
   * Kept as the career's own single county name — the name the founding county
   * is written under in `counties` — because a career is played in one county
   * and the screens that say so read it from here.
   */
  countyName: string;
  /** Every county of the world, keyed by id, and the order they were drawn in. */
  counties: Record<CountyId, County>;
  countyIds: CountyId[];
  /**
   * The country the county sits in: 'Alderland'.
   *
   * Absent on a save written before the nation was named, and read through
   * `NATION_NAME` where it is missing — see the migration that fills it, which
   * gives the county the nation rather than inventing one per save.
   */
  nationName?: string;
  /** Every region of the map, keyed by id, and the order they were drawn in. */
  regions: Record<RegionId, Region>;
  regionIds: RegionId[];
  towns: Record<TownId, Town>;
  townIds: TownId[];
  grounds: Record<GroundId, Ground>;
  groundIds: GroundId[];
  businesses: Record<BusinessId, Business>;
}

export interface SeasonCalendarEntry {
  matchday: number;
  date: ISODate;
}

export interface SeasonState {
  id: string;
  label: string;
  startDate: ISODate;
  endDate: ISODate;
  /**
   * The season's matchdays and the Sundays they fall on. This is the calendar of
   * the competition, not of the game — where we are in it is derived from the
   * date, never counted (see `simulation/timeline.ts`).
   */
  calendar: SeasonCalendarEntry[];
  finished: boolean;
}
