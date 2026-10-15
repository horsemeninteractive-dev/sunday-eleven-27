import type { CountyId, PyramidId } from '@/domain/ids';
import type { WorldDraft } from '@/simulation/gameSetup';
import { districtGeography, countyGeography } from './alderland';

export interface GeographySelection { countyId: CountyId; districtId: string; pyramidId: PyramidId }
/** No positional/name/coordinate inference. The seeded second pyramid keeps its
 * actual id; its explicit region_2 ownership is the compatibility binding. */
export function resolveGeographySelection(draft: WorldDraft, countyId: string, districtId: string): GeographySelection | null {
  const county = countyGeography(countyId);
  const district = districtGeography(countyId, districtId);
  if (county?.availability !== 'available' || district?.availability !== 'available' || !district.football) return null;
  const binding = district.football;
  const region = draft.world.regions[binding.regionId];
  if (region?.countyId !== county.id) return null;
  const matches = draft.pyramids.filter(p => p.regionId === binding.regionId && (!binding.pyramidId || p.id === binding.pyramidId));
  if (matches.length !== 1) return null;
  return { countyId: county.id, districtId: district.id, pyramidId: matches[0]!.id };
}
export interface AtlasSelection { countyId: string | null; districtId: string | null; message: string }
export const NATIONAL_SELECTION: AtlasSelection = { countyId: null, districtId: null, message: 'Choose Alderfordshire to explore its six districts.' };
export function selectAtlasCounty(state: AtlasSelection, id: string): AtlasSelection {
  const county = countyGeography(id);
  if (!county) return state;
  if (county.availability !== 'available') return { ...state, message: `${county.name} is mapped, but not playable in this release.` };
  return { countyId:id, districtId:null, message:'Choose a district. All six have football of their own.' };
}
export function selectAtlasDistrict(state: AtlasSelection, id: string): AtlasSelection {
  const district = state.countyId ? districtGeography(state.countyId,id) : undefined;
  if (!district) return state;
  if (district.availability !== 'available') return { ...state, message:`${district.name} is mapped, but its football is not playable yet.` };
  return { ...state, districtId:id, message:`${district.name} selected. Confirm below to continue.` };
}
