import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MatchSurface, PitchCondition } from '@/domain/match';
import type { GroundSurface } from '@/domain/world';
import { patchBox, pitchSurfaceLook, surfaceToneOf, type SurfaceTone } from './pitchSurface';

/**
 * The grass on the match screen.
 *
 * A pitch used to be one flat green whatever the afternoon was, so a February
 * league game on a pudding looked exactly like a July friendly on a lawn. What
 * makes the drawing worth having is that every part of it is a *reading*: the day
 * decides what the surface is like, the ground's own quality decides how much
 * grass is left on it, and the football played since anybody last looked decides
 * how cut up it is.
 *
 * So these tests are about those three joins, and about the one thing a picture
 * can get wrong that a number cannot: the marks have to be on the pitch, in the
 * right half of it, whichever way round the box is drawn.
 */

/** A surface as the day leaves it, with everything overridable. */
function aSurface(patch: Partial<MatchSurface> = {}): MatchSurface {
  return { surface: 'grass', condition: 'good', quality: 14, scuff: 0, ...patch };
}

const CONDITIONS: PitchCondition[] = ['excellent', 'good', 'worn', 'muddy', 'waterlogged', 'frozen'];
const SURFACES: GroundSurface[] = ['grass', 'grass (uneven)', '3G', 'cinder'];
const TONES: SurfaceTone[] = ['lush', 'fair', 'thin', 'heavy', 'flooded', 'frozen', 'artificial', 'cinder'];

const sheet = readFileSync('src/ui/styles.css', 'utf8');

describe('the surface, as the picture reads it', () => {
  it('lets the day name the surface, and the ground decide the rest', () => {
    // Mud, standing water and frost are what the *afternoon* is like, whatever
    // the quality and whatever the surface: a cinder pitch in a downpour has
    // water lying on it, and drawing it grey and dry would be a lie about the
    // game being played on it.
    expect(surfaceToneOf(aSurface({ condition: 'muddy', quality: 18 }))).toBe('heavy');
    expect(surfaceToneOf(aSurface({ condition: 'waterlogged', quality: 18 }))).toBe('flooded');
    expect(surfaceToneOf(aSurface({ condition: 'frozen', quality: 18 }))).toBe('frozen');
    expect(surfaceToneOf(aSurface({ condition: 'waterlogged', surface: 'cinder' }))).toBe('flooded');

    // Below that the surface's own kind comes first — nothing is mown on 3G or
    // cinder — and only then the verdict among grass.
    expect(surfaceToneOf(aSurface({ surface: '3G', condition: 'excellent' }))).toBe('artificial');
    expect(surfaceToneOf(aSurface({ surface: 'cinder', condition: 'worn' }))).toBe('cinder');
    expect(surfaceToneOf(aSurface({ condition: 'excellent' }))).toBe('lush');
    expect(surfaceToneOf(aSurface({ condition: 'good' }))).toBe('fair');
    expect(surfaceToneOf(aSurface({ condition: 'worn', quality: 11 }))).toBe('thin');
  });

  it('takes the mow off a surface there is no grass on', () => {
    // A pitch cut this morning shows its bands; a wet one has them flattened out
    // of it; a 3G and a cinder pitch have nothing to mow at all.
    const lush = pitchSurfaceLook(aSurface({ condition: 'excellent' }));
    const wet = pitchSurfaceLook(aSurface({ condition: 'muddy' }));
    expect(lush.mowInk).toBeGreaterThan(wet.mowInk);
    expect(pitchSurfaceLook(aSurface({ surface: '3G' })).mowInk).toBe(0);
    expect(pitchSurfaceLook(aSurface({ surface: 'cinder' })).mowInk).toBe(0);
  });

  it('counts the bald grass off the ground’s own quality, goalmouths first', () => {
    // The number the club's own work moves is the number of patches: a pitch
    // re-laid in October has grass in the goalmouths in November and the one
    // beside it does not. That is the whole visible payoff of a £980 job.
    const good = pitchSurfaceLook(aSurface({ quality: 18 }));
    const going = pitchSurfaceLook(aSurface({ quality: 11 }));
    const bare = pitchSurfaceLook(aSurface({ quality: 6 }));
    expect(good.patches).toHaveLength(0);
    expect(going.patches.length).toBeGreaterThan(0);
    expect(bare.patches.length).toBeGreaterThan(going.patches.length);

    // And they arrive in the order football wears a pitch: the first mark a
    // surface gets is always in a six-yard box, never out on a flank nobody has
    // run on since August.
    for (const look of [going, bare]) {
      expect(look.patches[0]!.x).toBeLessThan(0.15);
      expect(look.patches[0]!.y).toBeGreaterThan(0.2);
      expect(look.patches[0]!.y).toBeLessThan(0.8);
    }
  });

  it('draws the upkeep: a pitch nobody is looking after is a pitch being cut up', () => {
    // Scuff is nought while the club pays for the ground to be looked after and
    // grows with the football played when it does not, so the £9 a week is
    // visible on the one screen the manager is standing on the pitch for.
    const cut = pitchSurfaceLook(aSurface({ quality: 18, scuff: 0 }));
    const half = pitchSurfaceLook(aSurface({ quality: 18, scuff: 0.5 }));
    const worn = pitchSurfaceLook(aSurface({ quality: 18, scuff: 1 }));
    expect(cut.patches).toHaveLength(0);
    expect(half.patches.length).toBeGreaterThan(cut.patches.length);
    expect(worn.patches.length).toBeGreaterThan(half.patches.length);
    // Mud on a muddy pitch, bare grass on a dry one: the wear takes what is there
    // to take, which is football's own order of business.
    expect(pitchSurfaceLook(aSurface({ condition: 'muddy', scuff: 1 })).patches.some((patch) => patch.mark === 'mud')).toBe(
      true,
    );
    expect(pitchSurfaceLook(aSurface({ condition: 'good', quality: 18, scuff: 1 })).patches.every((p) => p.mark === 'bare')).toBe(
      true,
    );
  });

  it('gives an uneven pitch one more place the grass has gone', () => {
    const true_pitch = pitchSurfaceLook(aSurface({ surface: 'grass', quality: 15 }));
    const uneven = pitchSurfaceLook(aSurface({ surface: 'grass (uneven)', quality: 15 }));
    expect(true_pitch.patches).toHaveLength(0);
    expect(uneven.patches).toHaveLength(1);
    expect(uneven.patches[0]!.mark).toBe('bare');
  });

  it('never takes grass off a surface that has none', () => {
    // Water lies on a 3G pitch and frost gets into a cinder one, so neither is
    // spared a bad day — but a surface that never had grass cannot lose it, and a
    // 3G pitch drawn as going bald in February is the drawing being more
    // pessimistic than the ground ever is.
    for (const surface of ['3G', 'cinder'] as GroundSurface[]) {
      for (const condition of CONDITIONS) {
        const look = pitchSurfaceLook(aSurface({ surface, condition, quality: 4, scuff: 1 }));
        const grassMarks = look.patches.filter((patch) => patch.mark === 'bare' || patch.mark === 'mud');
        expect(grassMarks, `${surface} in ${condition}`).toHaveLength(0);
      }
    }
    // And a 3G pitch in the rain is still a 3G pitch: the marks it does carry are
    // the weather lying on it rather than grass gone.
    const wetArtificial = pitchSurfaceLook(aSurface({ surface: '3G', condition: 'waterlogged', quality: 4, scuff: 1 }));
    expect(wetArtificial.patches.length).toBeGreaterThan(0);
    expect(wetArtificial.patches.every((patch) => patch.mark === 'water')).toBe(true);
    // The whole catalogue of marks stays a picture rather than a map.
    expect(pitchSurfaceLook(aSurface({ condition: 'muddy', quality: 3, scuff: 1 })).patches.length).toBeLessThanOrEqual(6);
  });

  it('never draws a mark off the grass, in either frame', () => {
    // The marks are placed in the pitch's own coordinates and turned with
    // everything else on it, so the one thing that must hold is that the turn
    // keeps them on the field: a patch of mud in the ground behind a goal line is
    // a picture gone wrong rather than a pitch gone wrong.
    for (const condition of CONDITIONS) {
      for (const surface of SURFACES) {
        const look = pitchSurfaceLook(aSurface({ surface, condition, quality: 4, scuff: 1 }));
        for (const frame of ['landscape', 'portrait'] as const) {
          for (const patch of look.patches) {
            const box = patchBox(patch, frame);
            const name = `${surface} / ${condition} / ${frame}`;
            expect(box.left, name).toBeGreaterThanOrEqual(0);
            expect(box.top, name).toBeGreaterThanOrEqual(0);
            expect(box.left + box.width, name).toBeLessThanOrEqual(1);
            expect(box.top + box.height, name).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('puts the goalmouths at the left of a landscape pitch and the foot of a portrait one', () => {
    // The home goal is at the left of a landscape picture and at the foot of a
    // portrait one — the same turn the men and the ball come round by — so a mark
    // in the home six-yard box has to come round with it.
    const goalmouth = pitchSurfaceLook(aSurface({ quality: 6 })).patches[0]!;
    const wide = patchBox(goalmouth, 'landscape');
    const tall = patchBox(goalmouth, 'portrait');

    expect(wide.left).toBeLessThan(0.1);
    expect(wide.top).toBeGreaterThan(0.2);
    expect(wide.top).toBeLessThan(0.5);
    // The patch is longer along the pitch than across it, which is what a
    // six-yard box is.
    expect(wide.height / wide.width).toBeCloseTo(goalmouth.ry / goalmouth.rx, 6);
    // Turned: against the foot of the picture, with the two radii swapped with
    // it, so the same patch is now wider across the screen than it is tall.
    expect(tall.top).toBeGreaterThan(0.8);
    expect(tall.height / tall.width).toBeCloseTo(goalmouth.rx / goalmouth.ry, 6);
  });

  it('paints every tone it can name, and only the tones it can name', () => {
    // The renderer speaks in eight words and the stylesheet answers to them. A
    // tone with no rule is a surface silently drawn as the default green, which is
    // exactly the bug this whole module exists to fix — so the sheet is read here
    // rather than trusted.
    for (const tone of TONES) {
      expect(sheet, `${tone} has no paint`).toContain(`.pitch[data-surface='${tone}'] .pitch__surface`);
    }
    // And every tone the reading can produce is one of them.
    const produced = new Set<SurfaceTone>();
    for (const condition of CONDITIONS) {
      for (const surface of SURFACES) {
        produced.add(surfaceToneOf(aSurface({ surface, condition })));
      }
    }
    for (const tone of produced) expect(TONES).toContain(tone);
    // Each mark the reading can leave has a paint of its own, too.
    for (const mark of ['bare', 'mud', 'water', 'frost']) {
      expect(sheet, `${mark} has no paint`).toContain(`.pitch__patch--${mark}`);
    }
  });
});
