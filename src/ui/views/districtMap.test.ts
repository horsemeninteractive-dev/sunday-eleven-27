import { describe, expect, it } from 'vitest';
import { districtGeography, type DistrictGeography } from '@/geography/alderland';
import { containsPoint, fitPoints } from '@/geography/geometry';
import { generateDraft } from '@/simulation/gameSetup';
import {
  TOWN_LABEL_PX,
  TOWN_LABEL_PX_SHORT,
  TOWN_LABEL_STEP,
  TOWN_LABEL_TRIES,
  atlasFrame,
  townLabelBox,
  townMarks,
  unitsPerPixel,
  type TownMark,
} from './GeographySelectView';

/**
 * The district page's own drawing, measured rather than looked at.
 *
 * What the page promises is about where things are: a district draws the towns
 * the seed actually put inside it and no others, each dot is on the district's
 * own ground, and no two names are drawn on top of one another — on a wide page
 * and on a phone, and whatever the seed happens to draw.
 */

/** A panel in screen pixels, and the name size the page asks for at it: the sizes
 * a desktop map panel and the two phone layouts are drawn at. */
const PANELS = [
  ['wide', { width: 915, height: 522 }, TOWN_LABEL_PX],
  ['phone', { width: 378, height: 420 }, TOWN_LABEL_PX_SHORT],
  ['small phone', { width: 320, height: 400 }, TOWN_LABEL_PX_SHORT],
] as const;
const SEEDS = ['district-a', 'district-b', 'district-c', 'district-d', 'district-e', 'district-f'];

type Draft = ReturnType<typeof generateDraft>;
const townsIn = (draft: Draft, districtId: string) =>
  draft.world.townIds
    .map((id) => draft.world.towns[id])
    .filter((town): town is NonNullable<typeof town> => Boolean(town) && town.regionId === districtId);

/** The name size the page draws a district with in a panel of this size. */
const sizeFor = (district: DistrictGeography, panel: { width: number; height: number }, px: number) =>
  px * unitsPerPixel(atlasFrame('district', district.polygon), panel);

const overlap = (a: TownMark['box'], b: TownMark['box']) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('the district map', () => {
  it('draws the district’s own towns, on its own ground, with no name on another', () => {
    for (const seed of SEEDS) {
      const draft = generateDraft({ seed });
      for (const districtId of ['region_1', 'region_2']) {
        const district = districtGeography('county_1', districtId)!;
        const towns = townsIn(draft, districtId);
        expect(towns.length).toBeGreaterThan(3);
        // The dots the map fits its settlements to, which the names belong beside.
        const dots = fitPoints(district.polygon, towns, { interior: district.label });
        for (const [pane, panel, px] of PANELS) {
          const size = sizeFor(district, panel, px);
          const marks = townMarks(district.polygon, district.label, towns, size);
          const where = `${seed} · ${district.name} · ${pane}`;
          // Its own towns and nothing else: the district next door's villages are
          // not this district's places to play.
          expect(marks.map((mark) => mark.id).sort(), where).toEqual(towns.map((town) => town.id).sort());
          marks.forEach((mark, index) => {
            const dot = dots[index]!;
            // The mark is the town's own place: fitted into the district, on its
            // own ground, and never moved to make room for its name.
            expect(mark.dot, where).toEqual(dot);
            expect(containsPoint(district.polygon, mark.dot, false), where).toBe(true);
            // Its name sits in the same column, no further from the dot than the
            // search is allowed to walk.
            expect(mark.anchor[0], where).toBeCloseTo(dot[0], 9);
            expect(Math.abs(mark.anchor[1] - dot[1]), where)
              .toBeLessThanOrEqual(TOWN_LABEL_TRIES * TOWN_LABEL_STEP * size + 1e-9);
          });
          // Each name is drawn from the room the placement reserved for it: the
          // page measures no box other than the one the map avoided a collision
          // in, so what is drawn is what was measured.
          const gap = size * 0.9;
          marks.forEach((mark) => {
            const room = townLabelBox(mark.name, size);
            expect(mark.box.right - mark.box.left, where).toBeCloseTo(room.width, 9);
            expect(mark.box.bottom - mark.box.top, where).toBeCloseTo(room.height, 9);
            expect(mark.side === 'right' ? mark.box.left : mark.box.right, where)
              .toBeCloseTo(mark.side === 'right' ? mark.anchor[0] + gap : mark.anchor[0] - gap, 9);
          });
          for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
            expect(overlap(marks[i]!.box, marks[j]!.box), `${where}: ${marks[i]!.name} on ${marks[j]!.name}`).toBe(false);
          }
        }
      }
    }
  }, 120000);

  it('draws the same district twice the same way, so a map is read and not re-rolled', () => {
    const district = districtGeography('county_1', 'region_1')!;
    const towns = townsIn(generateDraft({ seed: SEEDS[0]! }), 'region_1');
    const size = sizeFor(district, PANELS[0]![1], TOWN_LABEL_PX);
    expect(townMarks(district.polygon, district.label, towns, size))
      .toEqual(townMarks(district.polygon, district.label, towns, size));
  });

  it('still draws a knot of settlements that has no room left anywhere', () => {
    const district = districtGeography('county_1', 'region_1')!;
    // Every settlement in one place in the world, so the fitting cannot spread
    // them: there is no clear spot for the second name onwards, and the map has to
    // fall back on the least bad place rather than give up on a town.
    const towns = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `Crowded Town ${i}`, x: 50, y: 50 }));
    const marks = townMarks(district.polygon, district.label, towns, sizeFor(district, PANELS[0]![1], TOWN_LABEL_PX));
    expect(marks.map((mark) => mark.id)).toEqual(towns.map((town) => town.id));
    for (const mark of marks) expect(containsPoint(district.polygon, mark.dot, false)).toBe(true);
  });
});
