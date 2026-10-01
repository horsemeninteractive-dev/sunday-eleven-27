import type { BusinessId, ClubId, GroundId, ISODate, TownId, WorldId } from './ids';

export type SettlementKind = 'town' | 'small-town' | 'village' | 'hamlet';

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
  regionName: string;
  countyName: string;
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
