import type { BusinessId, ClubId, GroundId, ISODate, RegionId, TownId, WorldId } from './ids';

export type SettlementKind = 'town' | 'small-town' | 'village' | 'hamlet';

/**
 * The region the founding county is drawn around: the one every career starts
 * with, and the one every town of a save written before regions existed is
 * placed in.
 */
export const FOUNDING_REGION_ID: RegionId = 'region_1';

/**
 * The region a town belongs to, and so the football a club in it plays.
 *
 * A region is a piece of the county rather than a competition: it says where a
 * town is and nothing about how good its football is. The founding county has
 * exactly one, drawn around every town it has, and a club's region is read from
 * its town — `clubs[c].townId → towns[t].regionId` — so a club cannot lose its
 * geography by changing division.
 */
export interface Region {
  id: RegionId;
  name: string;
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
  countyName: string;
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
