import { describe, expect, it } from 'vitest';
import { ALDERLAND } from './alderland';
import { NATIONAL_SELECTION, resolveGeographySelection, selectAtlasCounty, selectAtlasDistrict } from './selection';
import { generateDraft } from '@/simulation/gameSetup';

describe('atlas selection policy and compatibility bindings', () => {
  it('locks seventeen counties and 106 districts regardless of order or names', () => {
    const draft = generateDraft({seed:'atlas-policy'});
    for (const county of ALDERLAND.counties) for (const district of county.districts) {
      const resolved = resolveGeographySelection(draft,county.id,district.id);
      expect(Boolean(resolved)).toBe(county.availability === 'available' && district.availability === 'available');
    }
    expect(resolveGeographySelection(draft,'county_1','Westbrook Valley')).toBeNull();
    expect(resolveGeographySelection(draft,'atlas_c02','region_1')).toBeNull();
  });
  it('resolves league and the actual region_2 ladder without changing generation', () => {
    const secondIds = new Set<string>();
    for (const seed of ['atlas-a','atlas-b','atlas-c','atlas-d']) {
      const draft = generateDraft({seed});
      const before = JSON.stringify(draft);
      draft.pyramids.reverse();
      const first = resolveGeographySelection(draft,'county_1','region_1')!;
      const second = resolveGeographySelection(draft,'county_1','region_2')!;
      expect(first.pyramidId).toBe('league');
      expect(second.pyramidId).toBe(draft.pyramids.find(p => p.regionId === 'region_2')!.id);
      secondIds.add(second.pyramidId);
      draft.pyramids.reverse();
      expect(JSON.stringify(draft)).toBe(before);
    }
    expect(secondIds.size).toBeGreaterThan(1);
  });
  it('fails closed on missing, ambiguous or foreign county football ownership', () => {
    const draft = generateDraft({seed:'atlas-invalid'});
    draft.world.regions.region_2!.countyId = 'foreign';
    expect(resolveGeographySelection(draft,'county_1','region_2')).toBeNull();
    draft.world.regions.region_2!.countyId = 'county_1';
    draft.pyramids.push({...draft.pyramids.find(p=>p.regionId==='region_2')!,id:'duplicate'});
    expect(resolveGeographySelection(draft,'county_1','region_2')).toBeNull();
  });
  it('keeps locks informative and clears district selection on county entry and back', () => {
    const county = selectAtlasCounty(NATIONAL_SELECTION,'county_1');
    expect(county.message).toContain('All six');
    const selected = selectAtlasDistrict(county,'region_2');
    expect(selected.districtId).toBe('region_2');
    // The lock the map can still show is a county's: seventeen of the eighteen
    // are drawn and unplayable, and choosing one says so without moving the
    // manager off the county he was reading.
    const lockedCounty = selectAtlasCounty(NATIONAL_SELECTION,'atlas_c02');
    expect(lockedCounty.countyId).toBeNull();
    expect(lockedCounty.message).toContain('not playable');
    // A district id that is not one of the county's own is not a district at all:
    // the selection stands, unchanged and un-invented, rather than being cleared
    // or replaced by something the map never drew. (Every one of Alderfordshire's
    // six districts is playable, so there is no locked district left to click.)
    const stray = selectAtlasDistrict(selected,'county_1_d3');
    expect(stray).toBe(selected);
    expect(selectAtlasCounty(selected,'county_1').districtId).toBeNull();
    expect(NATIONAL_SELECTION.districtId).toBeNull();
  });
});
