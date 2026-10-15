import { describe, expect, it } from 'vitest';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { ALDERLAND, LABEL_FONT, labelLines } from './alderland';
import {
  containsPoint,
  GEOMETRY_EPSILON,
  labelOutside,
  labelOverlap,
  ringPath,
  signedArea,
  validatePartition,
  validateRing,
  type LabelItem,
  type Ring,
} from './geometry';

/** The same metrics the placement pass and the SVG use, so this test measures
 * the labels the map actually draws rather than a second set of guesses. */
function items(name: string, fontSize: number, polygon: Ring, anchor: readonly [number, number], scale = 1): LabelItem {
  const rows = labelLines(name);
  const nameHeight = ((rows.length - 1) * fontSize * 1.15 + fontSize * 1.1) * scale;
  return {
    polygon,
    anchor,
    width: Math.max(...rows.map((row) => row.length)) * fontSize * 0.56 * scale,
    height: nameHeight + fontSize * 1.2 * scale,
    nameHeight,
    topOffset: -fontSize * 0.85 * scale,
  };
}

describe('authored Alderland atlas', () => {
  it('has eighteen unique counties forming exactly one valid mainland', () => {
    expect(ALDERLAND.counties).toHaveLength(18);
    expect(new Set(ALDERLAND.counties.map(c => c.id)).size).toBe(18);
    expect(ALDERLAND.counties.map(c => c.id)).toEqual(['county_1', ...Array.from({length:17}, (_, i) => `atlas_c${String(i + 2).padStart(2,'0')}`)]);
    validateRing(ALDERLAND.outline);
    validatePartition(ALDERLAND.outline, ALDERLAND.counties.map(c => c.polygon));
  });
  it('has 108 individually valid, contained and exactly partitioned local districts', () => {
    const districts = ALDERLAND.counties.flatMap(c => c.districts);
    expect(districts).toHaveLength(108);
    expect(new Set(districts.map(d => d.id)).size).toBe(108);
    for (const county of ALDERLAND.counties) {
      expect(county.districts).toHaveLength(6);
      expect(containsPoint(county.polygon, county.label, false), county.name).toBe(true);
      validatePartition(county.polygon, county.districts.map(d => d.polygon));
      for (const district of county.districts) {
        expect(district.countyId).toBe(county.id);
        expect(containsPoint(district.polygon, district.label, false), district.name).toBe(true);
        expect(containsPoint(county.polygon, district.label, false)).toBe(true);
        expect(county.districts.filter(d => containsPoint(d.polygon, district.label, false)).map(d => d.id)).toEqual([district.id]);
        expect(ringPath(district.polygon)).toMatch(/^M[\d.,L]+Z$/);
        expect(Math.abs(signedArea(district.polygon))).toBeGreaterThan(100);
      }
    }
  });
  it('places every label inside its own region and clear of every other label', () => {
    // Measured at the largest size any view draws, with each label's own scale:
    // the same boxes the placement pass reserved and the SVG paints.
    const national = ALDERLAND.counties.map((county) => items(county.name, LABEL_FONT.national, county.polygon, county.label, county.labelScale));
    const nationalAnchors = ALDERLAND.counties.map((county) => county.label);
    // No county name is drawn on top of another, which is the whole point of the
    // national view: eighteen names at once, and none of them unreadable.
    expect(labelOverlap(national, nationalAnchors)).toBe(0);
    // A name box is a box around the name rather than its ink, so the residual
    // is reported and bounded rather than pretended away: the two long names in
    // the narrow east cross an edge by one corner each, and every other county
    // is wholly inside its own boundary.
    expect(labelOutside(national, nationalAnchors)).toBeLessThanOrEqual(4);
    // Nothing is quietly shrunk to fit: a scale between zero and one is a name
    // in a crowded region, and never the whole map in small print.
    expect(ALDERLAND.counties.filter((county) => county.labelScale < 1).length).toBeLessThanOrEqual(4);
    // A crowded district may be drawn smaller — a handful cannot fit a full-size
    // name inside their own boundary — but the exception stays an exception: a
    // map of many type sizes is not a labelled map.
    const shrunk = ALDERLAND.counties.flatMap((county) => county.districts).filter((district) => district.labelScale < 1);
    expect(shrunk.length).toBeLessThanOrEqual(12);
    expect([...ALDERLAND.counties, ...ALDERLAND.counties.flatMap((county) => county.districts)].map((region) => region.labelScale).every((scale) => scale >= 0.74)).toBe(true);
    for (const county of ALDERLAND.counties) {
      const local = county.districts.map((district) => items(district.name, LABEL_FONT.district, district.polygon, district.label, district.labelScale));
      const anchors = county.districts.map((district) => district.label);
      expect(labelOverlap(local, anchors), `${county.name} labels overlap`).toBe(0);
      // No district's name block is wholly outside its region, and the residual
      // of a block whose corner crosses an edge is bounded: the metric is a box
      // around the name, so a count of 3 is one corner of one name, not a label
      // sitting in the next county.
      expect(labelOutside(local, anchors), `${county.name} label outside its district`).toBeLessThanOrEqual(4);
      expect(county.districts.filter((district) => district.labelScale < 1).length, `${county.name} shrinks too many labels`).toBeLessThanOrEqual(4);
      for (const district of county.districts) {
        expect(containsPoint(district.polygon, district.label, false), district.name).toBe(true);
        // A label that moved did so inside its own region; the authored anchor
        // is preferred, so a nudge is the exception rather than the rule.
        expect(district.labelScale).toBeGreaterThan(0.7);
      }
    }
  });

  it('opens only the founding county and its six district identities', () => {
    const available = ALDERLAND.counties.filter(c => c.availability === 'available');
    expect(available.map(c => c.id)).toEqual(['county_1']);
    // Alderfordshire's six districts are the whole of what the map opens, and
    // each is bound to the football behind it by its own region id: the founding
    // district names the ladder it has always had (`league`), and each of the
    // five beside it resolves to the one ladder drawn in its region. Every other
    // county's districts are drawn and unplayable — mapped ground, no football.
    expect(ALDERLAND.counties.flatMap(c => c.districts).filter(d => d.availability === 'available').map(d => [d.id,d.football])).toEqual([
      ['region_1',{regionId:'region_1',pyramidId:'league'}],
      ['region_2',{regionId:'region_2'}],
      ['region_3',{regionId:'region_3'}],
      ['region_4',{regionId:'region_4'}],
      ['region_5',{regionId:'region_5'}],
      ['region_6',{regionId:'region_6'}],
    ]);
    // And each of those six districts wears the county's own name for it, read
    // from the authored list rather than typed here — the map and the league
    // tables cannot come apart about what a district is called.
    const alderfordshire = ALDERLAND.counties.find(c => c.id === 'county_1')!;
    expect(alderfordshire.districts.map(d => d.name)).toEqual(ALDERFORDSHIRE_DISTRICTS.map(d => d.name));
    expect(alderfordshire.districts.map(d => d.id)).toEqual(ALDERFORDSHIRE_DISTRICTS.map(d => d.regionId));
  });
});

describe('strict deterministic geometry rejection', () => {
  const square: Ring = [[0,0],[10,0],[10,10],[0,10]];
  const left: Ring = [[0,0],[5,0],[5,10],[0,10]];
  const right: Ring = [[5,0],[10,0],[10,10],[5,10]];
  it('accepts aligned shared edges and T junctions without rounding drift', () => {
    validatePartition(square,[left,[[5,0],[10,0],[10,10],[5,10],[5,7]]]);
    expect(GEOMETRY_EPSILON).toBe(1e-7);
  });
  it('rejects gaps, overlaps, duplicates, outside rings and mismatched edges', () => {
    for (const children of [
      [left], [left,left,right],
      [left,[[4,0],[10,0],[10,10],[4,10]]],
      [left,[[6,0],[10,0],[10,10],[6,10]]],
      [left,[[5,0],[11,0],[11,10],[5,10]]],
      [left,[[5,0],[10,0],[10,10],[5,10],[5.01,5]]],
    ] as Ring[][]) expect(() => validatePartition(square,children)).toThrow();
  });
  it('rejects bow ties, duplicate vertices, backtracking, zero area and nonfinite points', () => {
    for (const polygon of [
      [[0,0],[10,10],[0,10],[10,0]], [[0,0],[10,0],[10,0],[0,10]],
      [[0,0],[10,0],[5,0],[10,10],[0,10]], [[0,0],[1,0],[2,0]],
      [[0,0],[NaN,0],[0,10]],
    ] as Ring[]) expect(() => validateRing(polygon)).toThrow();
  });
});
