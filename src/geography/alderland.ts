import { FOUNDING_COUNTY_ID, FOUNDING_REGION_ID, NATION_NAME } from '@/domain/world';
import { ALDERFORDSHIRE_DISTRICTS, type DistrictDefinition } from '@/domain/districts';
import { FOUNDING_PYRAMID_ID } from '@/domain/competition';
import type { CountyId, PyramidId, RegionId } from '@/domain/ids';
import { authoredPartition, bounds, interiorAnchor, placeLabels, type BoundaryCut, type Point, type Ring } from './geometry';
import { DISTRICT_BOUNDARIES } from './districtBoundaries';

export interface DistrictGeography {
  id: string; countyId: CountyId; name: string; polygon: Ring;  label: Point;
  /** The size its name is drawn at, relative to the label size for this zoom:
   * 1 unless the region was too crowded for a full-size label. */
  labelScale: number;
  availability: 'available' | 'locked';
  /**
   * The football this district plays, or nothing at all for a district that is
   * mapped and not playable.
   *
   * A district's own id *is* the region its clubs, grounds and towns are keyed
   * to, so the binding is how a screen turns a shape on the map into the world
   * behind it. The founding district names its ladder's id as well, because
   * `league` is the id it has always had; every other district's ladder id is
   * minted from the seed, so it is found by the region it draws from — the
   * unique ladder carrying this region, never a name and never an ordinal.
   */
  football?: { regionId: RegionId; pyramidId?: PyramidId };
}
export interface CountyGeography {
  id: CountyId; name: string; polygon: Ring; label: Point;
  availability: 'available' | 'locked'; character: string;
  /** The author's first choice; `label` is the placed one the map draws. */
  authoredLabel: Point;
  labelScale: number;
  districts: readonly DistrictGeography[];
}

export const NATIONAL_OUTLINE: Ring = [
  [450,55],[510,65],[540,95],[590,110],[610,155],[655,220],[690,245],[670,280],
  [725,320],[745,380],[720,415],[770,465],[800,510],[790,560],[825,610],[810,660],
  [845,690],[870,750],[850,785],[875,830],[840,860],[820,910],[855,950],[810,995],
  [745,1010],[700,990],[660,1025],[590,1040],[535,1070],[465,1055],[425,1090],
  [355,1080],[315,1110],[235,1120],[190,1090],[135,1105],[95,1075],[70,1035],
  [100,1010],[165,1020],[220,990],[265,940],[240,900],[195,870],[175,820],
  [220,780],[210,735],[235,690],[210,650],[240,610],[225,575],[260,535],
  [245,500],[280,460],[260,415],[300,365],[290,320],[330,280],[340,220],
  [320,190],[365,160],[375,115],[420,95],
];

// Shared routes: high northern watershed, industrial headwaters, lower Calder,
// Alder/Bracken ridge, fen drainage divide and southern chalk escarpment.
const COUNTY_BOUNDARIES: readonly BoundaryCut[] = [
  { parent:'land', children:['north','rest1'], route:[[340,220],[400,235],[470,225],[530,240],[590,230],[655,220]] },
  { parent:'north', children:['thorn','westmor'], route:[[510,65],[495,115],[520,165],[505,200],[530,240]] },
  { parent:'rest1', children:['headwaters','rest2'], route:[[300,365],[370,380],[445,360],[520,390],[610,370],[675,385],[745,380]] },
  { parent:'headwaters', children:['upperEast','dun'], route:[[470,225],[458,270],[475,315],[445,360]] },
  { parent:'upperEast', children:['highmarch','iron'], route:[[590,230],[565,280],[590,315],[610,370]] },
  { parent:'rest2', children:['mills','rest3'], route:[[280,460],[345,485],[420,470],[490,500],[575,480],[650,510],[720,495],[800,510]] },
  { parent:'mills', children:['millEast','bracken'], route:[[445,360],[435,405],[455,435],[420,470]] },
  { parent:'millEast', children:['eastmarch','calder'], route:[[610,370],[590,410],[625,460],[650,510]] },
  { parent:'rest3', children:['basin','rest4'], route:[[240,610],[315,625],[400,600],[490,630],[580,610],[670,650],[745,635],[810,660]] },
  { parent:'basin', children:['basinEast','alder'], route:[[490,500],[475,545],[500,585],[490,630]] },
  { parent:'basinEast', children:['fenwick','caster'], route:[[650,510],[635,565],[660,605],[670,650]] },
  { parent:'rest4', children:['lowlands','rest5'], route:[[220,780],[305,760],[385,790],[480,765],[575,800],[670,780],[775,820],[875,830]] },
  { parent:'lowlands', children:['lowEast','wych'], route:[[400,600],[375,655],[395,715],[365,755],[385,790]] },
  { parent:'lowEast', children:['greymere','redford'], route:[[670,650],[650,685],[680,730],[670,780]] },
  { parent:'rest5', children:['downs','bellamere'], route:[[265,940],[350,920],[440,950],[535,915],[625,940],[720,900],[820,910]] },
  { parent:'downs', children:['downEast','king'], route:[[480,765],[465,820],[485,870],[440,950]] },
  { parent:'downEast', children:['mereford','southam'], route:[[670,780],[655,825],[695,860],[720,900]] },
];

// IDs are deliberately opaque authored keys, not slugs of names. Only county_1
// already exists in simulation; other atlas county keys are not live counties.
const COUNTY_IDENTITIES: readonly [string, CountyId, string, Point, string, readonly string[]][] = [
  // The first two names are the live world's own, read from `domain/world` so the
  // map and the league tables cannot disagree about them; the other four are the
  // atlas's, for districts whose football does not exist yet.
  // Alderfordshire's six names are the authored districts' own — read from
  // `domain/districts` rather than typed here, so the map and every league,
  // cup and honour named after a district cannot come apart.
  ['alder',FOUNDING_COUNTY_ID,'Alderfordshire',[365,555],'Alder crossings, water meadows and the wooded western ridge.', ALDERFORDSHIRE_DISTRICTS.map(d => d.name)],
  ['bracken','atlas_c02','Brackenshire',[365,425],'Pastoral downs beneath the headwater moors.', ['Brackenwell','Northwood','Hatherley Downs','Foxmere Vale','Fernleigh','Crowhurst']],
  ['calder','atlas_c03','Caldershire',[525,440],'The Calder mill corridor and its tributary valleys.', ['Calderwick','Calder Vale','Millford Reach','Southbank','Ashford Mere','Wrenbury']],
  ['iron','atlas_c04','Ironshire',[530,310],'A coal-and-iron basin sheltered below the northern watershed.', ['Ironhaven','Blackridge Moor','Millcaster','Pennwick','Forgeham','Redcliff Vale']],
  ['dun','atlas_c05','Dunshire',[385,305],'Western fell passes and steep tributary denes.', ['Dunbridge','Coalton','Ash Fell','Upper Dene','Bracken Tor','Westcombe Dene']],
  ['eastmarch','atlas_c06','Eastmarchshire',[695,440],'An eastern headland above the wide lower river.', ['Marchford','Eastgate','Rookery Vale','Redbank','Barrowfield','Longmere']],
  ['mereford','atlas_c07','Merefordshire',[770,865],'Sheltered harbours along the southern inlet.', ['Mereport','Seabourne Coast','Estermouth','Northmere','Saltwick','Willowmere']],
  ['bellamere','atlas_c08','Bellamere',[490,1010],'The long southern coastal shelf, tidal creeks and western point.', ['Bellport','Gull Coast','Saltmarsh','Bellwater Reach','East Bell','Waverley Point']],
  ['greymere','atlas_c09','Greymere',[765,720],'The Calder estuary and its low tidal marshes.', ['Greyhaven','Northstrand','Tidewell','Marshfield','Greywick','Eelbrook']],
  ['southam','atlas_c10','Southamshire',[575,865],'Chalk villages, river crossings and sheltered southern vales.', ['Southam','Kingswell Hundred','Ashcombe Vale','Whitestone Heath','Merecross','Southwick Green']],
  ['king','atlas_c11','Kingshire',[335,865],'Old market hundreds on the western chalk foothills.', ['Kingswell','Elmstead','Littlebourne','South Downs','Crownfield','Aldercombe']],
  ['redford','atlas_c12','Redfordshire',[525,710],'The broad Alder basin and three historic bridge routes.', ['Redford','Broadwater','Newmarket Vale','Three Bridges','West Redford','Foxbridge']],
  ['fenwick','atlas_c13','Fenwickshire',[735,580],'Reclaimed eastern fens above the estuary.', ['Fenwick','Merefield Fen','Riverton Reach','Eastfield','Reedham','Fenbridge']],
  ['wych','atlas_c14','Wychshire',[295,700],'Western woodland and the wet Alder headwaters.', ['Wychford','Wychwood','Longmead','Alder Fen','Mossley','Foxhollow']],
  ['caster','atlas_c15','Castershire',[565,560],'Central market towns along the Calder crossing roads.', ['Casterley','Westfield','Stonebridge','Great Mere','Castor End','Brindle Heath']],
  ['highmarch','atlas_c16','Highmarchshire',[650,305],'An eastern forested watershed facing the open sea.', ['Highmarch','Ashdown Forest','Westcombe','Brackenridge Hills','High Fell Gate','Marchwell']],
  ['westmor','atlas_c17','Westmorland',[435,170],'The high western spine and its sheltered lake-side valleys.', ['Westcombe','Fellside','Longridge','Merewood','Greyfell','Westmere Crossing']],
  ['thorn','atlas_c18','Thornshire',[580,180],'Northern quarry country, cliffs and the upper Calder springs.', ['Thornwick','High Fell','Quarry Bank','Lower Vale','Briarstone','Thornebridge']],
];
/** Font sizes the map draws with, in atlas units, at the authored scale.
 * Placement is solved at the largest size a view uses so a narrow screen —
 * where the same atlas units are drawn larger relative to the panel — cannot
 * reintroduce a collision the wide layout had already resolved. */
export const LABEL_FONT = { national: 21, district: 7 } as const;
/**
 * Where a long local name is broken, authored rather than guessed: the map and
 * the placement pass both read this, so the box a name occupies cannot differ
 * between the two.
 */
export function labelLines(name: string): readonly string[] {
  if (name === 'Oakham and the Weald') return ['Oakham and', 'the Weald'];
  if (name === 'Westbrook Valley') return ['Westbrook', 'Valley'];
  return [name];
}
/**
 * The drawn box of a name, from the same line breaks and metrics the SVG uses.
 *
 * Exported because the district view places labels of its own — a district's
 * towns — and a label whose box is measured differently from the one the map
 * reserves is a label that collides with what the map avoided.
 */
export function labelBox(name: string, fontSize: number) {
  const rows = labelLines(name);
  // Measured from the top of the first line to the foot of the last: the text's
  // own block, which is what has to stay inside the region.
  const nameHeight = (rows.length - 1) * fontSize * 1.15 + fontSize * 1.1;
  return {
    width: Math.max(...rows.map((row) => row.length)) * fontSize * 0.56,
    // The name block plus the availability line under it, and the name block
    // alone: the first is what must not collide, the second is what must stay
    // inside the region.
    height: nameHeight + fontSize * 1.2,
    nameHeight,
    topOffset: -fontSize * 0.85,
  };
}

const polygons = authoredPartition(NATIONAL_OUTLINE, COUNTY_BOUNDARIES);
const countyLabels = placeLabels(COUNTY_IDENTITIES.map(([key, , name, anchor]) => ({
  polygon: polygons[key]!, anchor, ...labelBox(name, LABEL_FONT.national),
})));
export const ALDERLAND = {
  id: 'nation_alderland', name: NATION_NAME, outline: NATIONAL_OUTLINE,
  viewBox: { x: 40, y: 25, width: 865, height: 1125 },
  counties: COUNTY_IDENTITIES.map(([key, id, name, authored, character, names], index): CountyGeography => {
    const polygon = polygons[key]!;
    const districts = authoredPartition(polygon, DISTRICT_BOUNDARIES[key]!);
    const districtLabels = placeLabels(names.map((districtName, i) => ({
      polygon: districts[`d${i + 1}`]!, anchor: interiorAnchor(districts[`d${i + 1}`]!), ...labelBox(districtName, LABEL_FONT.district),
    })));
    return {
      // The authored anchor is kept beside the placed one: which names moved is
      // a fact about the map worth reading, and the original is the fallback.
      id, name, polygon, label: countyLabels[index]!.anchor, labelScale: countyLabels[index]!.scale,
      authoredLabel: authored, character,
      availability: id === FOUNDING_COUNTY_ID ? 'available' : 'locked',
      districts: names.map((districtName, i): DistrictGeography => {
        const districtPolygon = districts[`d${i + 1}`]!;
        // Alderfordshire's six districts are the authored ones, by id: the map
        // region a district is drawn as *is* its id, so the shape on the map and
        // the world behind it are keyed to the same thing. Every other county's
        // districts are mapped and unplayable, and are keyed to the county and
        // their place in its list.
        const authored = id === FOUNDING_COUNTY_ID ? ALDERFORDSHIRE_DISTRICTS[i] : undefined;
        const football = authored
          ? { regionId: authored.regionId, ...(i === 0 ? { pyramidId: FOUNDING_PYRAMID_ID } : {}) }
          : undefined;
        return { id: authored?.regionId ?? `${id}_d${i + 1}`, countyId: id, name: districtName,
          polygon: districtPolygon, label: districtLabels[i]!.anchor, labelScale: districtLabels[i]!.scale,
          availability: football ? 'available' : 'locked', ...(football ? { football } : {}) };
      }),
    };
  }),
  features: [
    { id:'calder', name:'River Calder', kind:'river', points:[[555,185],[550,250],[535,310],[550,370],[570,420],[595,465],[590,530],[615,590],[680,640],[740,685],[800,735],[860,765]] },
    { id:'dene', name:'Dene', kind:'river', points:[[420,250],[400,305],[420,350],[470,405],[550,450],[595,465]] },
    { id:'alder', name:'River Alder', kind:'river', points:[[305,650],[340,685],[405,690],[455,710],[515,690],[560,660],[615,590]] },
    { id:'fell', name:'Western Fells', kind:'ridge', points:[[430,130],[410,190],[395,245],[370,290],[365,350]] },
    { id:'chalk', name:'South Downs', kind:'ridge', points:[[315,880],[395,895],[470,910],[535,880],[610,900],[680,890]] },
  ] as readonly { id:string; name:string; kind:'river'|'ridge'; points:Ring }[],
} as const;
export function countyGeography(id: string): CountyGeography | undefined { return ALDERLAND.counties.find(county => county.id === id); }
export function districtGeography(countyId: string, districtId: string): DistrictGeography | undefined { return countyGeography(countyId)?.districts.find(district => district.id === districtId); }

/**
 * Where a district of the atlas stands in the world's own 0..100 map space.
 *
 * The atlas is authored in its own units and the world is generated in a square
 * it draws its own settlements in, and the two have to mean the same places: a
 * district drawn in the north-west of the county is a district in the north-west
 * of the world. The county's own outline is the frame that makes them the same
 * map — its bounding box is the world's map, and a district's own ground inside
 * that box is where its settlements are drawn. The point read here is the
 * district's interior anchor, the same point its name is placed at, so the place
 * a name is written and the place its towns are is one place.
 */
export function districtCentreInWorld(countyId: string, districtId: string): { x: number; y: number } | undefined {
  const county = countyGeography(countyId);
  const district = districtGeography(countyId, districtId);
  if (!county || !district) return undefined;
  const box = bounds(county.polygon);
  const [ax, ay] = interiorAnchor(district.polygon);
  return { x: ((ax - box.x) / box.width) * 100, y: ((ay - box.y) / box.height) * 100 };
}

/**
 * Alderfordshire's districts as the world generator takes them: the authored
 * list, each district standing where the atlas draws it.
 *
 * The districts the county has always had are left exactly as they are authored,
 * without a centre. The founding district is the whole map — its region is
 * centred on its own settlements (`regionCentreFor`) — and the district next door
 * is drawn in the emptiest quarter of the map it joins, which is what it has
 * always been and what every save, test and baseline written before the map named
 * six districts reads. Every district the map has *added* stands where the map
 * draws it, so the district a manager chose is the district his league table is
 * played in.
 *
 * Leaving the two of them alone is also what makes a career founded with the
 * whole county the career a two-district world has always been with four more
 * districts beside it: the same two ladders, in the same two places, from the
 * same seed, however many districts were founded after them.
 */
export function alderfordshireDistricts(): readonly DistrictDefinition[] {
  return ALDERFORDSHIRE_DISTRICTS.map((district) =>
    district.regionId === FOUNDING_REGION_ID || district.legacy || district.centre
      ? district
      : { ...district, centre: districtCentreInWorld(FOUNDING_COUNTY_ID, district.regionId) },
  );
}
