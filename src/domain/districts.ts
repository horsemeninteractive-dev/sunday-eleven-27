import type { RegionId } from './ids';
import { DEFAULT_PYRAMID, SECOND_PYRAMID_CONFIG, type PyramidConfig } from './competition';
import {
  FOUNDING_REGION_ID,
  FOUNDING_REGION_NAME,
  SECOND_REGION_ID,
  SECOND_REGION_NAME,
} from './world';

/**
 * A district of the county: a place on the map, and the football played in it.
 *
 * A district is not a ladder and not a region: it is the *place*, and the two
 * records that describe it — the map region it is drawn as, and the pyramid its
 * clubs play in — are keyed to the district's own id so that neither has to be
 * inferred from the other. The id is the map's region key (`region_2`) and it is
 * authored rather than drawn, because the county is authored: Alderfordshire has
 * six districts in every career, drawn in the same six places under the same six
 * names, and what the seed decides is what is *inside* them.
 *
 * The pyramid's own id is not written here. It is minted by the generator — a
 * valley drawn from the seed (`region_2`'s ladder has been `dene` on one seed and
 * `brue` on another since it existed) — and the map binds a district to its
 * ladder through this id rather than through a name or a position, so a career
 * that gained its districts one at a time reads the same whether they were all
 * founded together or a season apart.
 *
 * `level` is the level of football the district plays at, 1 being the county's
 * strongest ladder. The founding district is the county's own first ladder and
 * every district beside it is a ladder of the same standing as its neighbours —
 * five districts of one level rather than a hierarchy the map does not draw.
 */
export interface DistrictDefinition {
  /** The district's own id: the map region it is drawn as, and its stable key. */
  regionId: RegionId;
  /** The name the map, the league, its cups and its honours all carry. */
  name: string;
  /** 1 = the county's strongest ladder. */
  level: number;
  /** Divisions, clubs per division, places swapped at a boundary, and whether cups run. */
  config: PyramidConfig;
  /**
   * Where the district stands in the world's own 0..100 map space.
   *
   * Left out, the generator draws the district in the emptiest quarter of the
   * map it has as it is founded, which is the rule every district founded before
   * the map named all six was drawn by. Filled in — by `geography/alderland.ts`,
   * from the same polygon the atlas draws — the district is founded where the map
   * says it is, so a manager who chose a district on the map reads the same
   * district in his league table. See `foundDistrictPyramid`.
   */
  centre?: { x: number; y: number };
  /**
   * Whether this is a district the county has always had rather than one the map
   * has added to it.
   *
   * Set on the district next door to the founding county and nowhere else, and it
   * is not a preference but a statement of fact about a world that already
   * exists: that district has been founded from the county's own stream
   * (`${seed}::district`) since it existed, and the world has always drawn the
   * ground it stands on for itself. So a county founded with it beside it is the
   * world it has always been — byte for byte, id for id — a career given it at a
   * season boundary is given the same kind of place, and the districts the map
   * has *added* draw from a stream of their own (`${seed}::district::<regionId>`)
   * and stand where the map draws them. See `foundDistrictPyramid` and
   * `alderfordshireDistricts`.
   */
  legacy?: boolean;
}

/**
 * Alderfordshire's six districts, in the order the map draws them.
 *
 * This is the county's whole authored geography: the first two are the two the
 * game has always had — the founding county, and the valley next door — and the
 * four after them are the districts the map has always drawn and named, now with
 * football in them. The order matters, because it is the order the generator
 * founds them in and the order the map places them in; it is not an order of
 * quality. The founding district is first because it is the one every career is
 * built around; the rest are peers.
 *
 * A definition is data and nothing else: it names a place and a shape of
 * football, and every id, name and record downstream of it is derived from it by
 * the same code that has always built the county. Adding a seventh district, or
 * doing this for a second county, is adding an entry here and authoring the
 * ground it stands on.
 */
export const ALDERFORDSHIRE_DISTRICTS: readonly DistrictDefinition[] = [
  {
    regionId: FOUNDING_REGION_ID,
    name: FOUNDING_REGION_NAME,
    level: 1,
    config: DEFAULT_PYRAMID,
  },
  {
    regionId: SECOND_REGION_ID,
    name: SECOND_REGION_NAME,
    level: 2,
    config: SECOND_PYRAMID_CONFIG,
    legacy: true,
  },
  { regionId: 'region_3', name: 'Marlowe Vale', level: 2, config: SECOND_PYRAMID_CONFIG },
  { regionId: 'region_4', name: 'Oakham and the Weald', level: 2, config: SECOND_PYRAMID_CONFIG },
  { regionId: 'region_5', name: 'Briar Glen', level: 2, config: SECOND_PYRAMID_CONFIG },
  { regionId: 'region_6', name: 'Millwater', level: 2, config: SECOND_PYRAMID_CONFIG },
];

/** The district a region id names, or undefined for a region no district draws. */
export function districtDefinition(regionId: RegionId): DistrictDefinition | undefined {
  return ALDERFORDSHIRE_DISTRICTS.find((district) => district.regionId === regionId);
}

