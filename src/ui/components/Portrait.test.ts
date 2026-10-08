import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { designFor } from '@/domain/kit';
import { isOfficial, isPlayer, type Person, type Player } from '@/domain/person';
import { createTestGame } from '@/simulation/testSupport';
import { colourDistance } from '../colour';
import { clubKit, MIN_KIT_DISTANCE } from '../kit';
import { FACE_SHAPES, HAIR_STYLES, HEADS, PORTRAIT_HEIGHT, PORTRAIT_WIDTH, facePlan } from '../face';
import { PortraitArt, hairlineY, outfitFor } from './Portrait';

/**
 * A person's face, and the shirt he is wearing on it.
 *
 * What is pinned here is not what a face looks like — that is a judgement, and it
 * is made by looking at a contact sheet — but the three things a drawing of a
 * person can be *wrong* about in a way nobody notices until it matters: that the
 * same man is the same man everywhere, that a transfer moves his shirt and not his
 * nose, and that a haircut never eats an eye.
 */

type World = ReturnType<typeof createTestGame>['state'];
type Id = ReturnType<typeof createTestGame>['clubId'];

/**
 * One man of a club's squad, outfield or in goal.
 *
 * The two are drawn in different shirts, so a test that wants the ten has to ask
 * for them by name: the first man out of the squad can be the goalkeeper, and a
 * keeper is the one man in the club who is not dressed in its home strip.
 */
function squadOf(state: World, clubId: Id, keeper: boolean): Player {
  const found = Object.values(state.people).find(
    (person) =>
      isPlayer(person) &&
      person.clubId === clubId &&
      (person.preferredPosition === 'GK') === keeper,
  );
  if (!found) throw new Error(`this club has no ${keeper ? 'keeper' : 'outfield player'}`);
  return found as Player;
}

describe('a person has a face', () => {
  it('gives every man in the world one of his own, and the same one every time', () => {
    const { state } = createTestGame('faces-own');
    const people = Object.values(state.people);
    expect(people.length).toBeGreaterThan(500);
    const plans = people.map(facePlan);
    // Two men with the same face would be two rows the eye reads as one record,
    // which is the thing the initials were rejected for being.
    expect(new Set(plans.map((plan) => JSON.stringify(plan))).size).toBe(people.length);
    // And it is not a draw: a face is a fact about the man, so it survives being
    // asked for again.
    for (const who of people.slice(0, 60)) expect(facePlan(who)).toEqual(facePlan(who));
  });

  it('leaves the face alone when he signs for somebody else', () => {
    // The whole point of a transfer being a change of shirt: a man who has just
    // moved is still the man the manager recognised on the other touchline.
    const { state, clubId } = createTestGame('faces-transfer');
    const player = Object.values(state.people).find(
      (person) => isPlayer(person) && person.clubId === clubId,
    ) as Player;
    const other = Object.values(state.clubs).find((club) => club.id !== clubId)!;
    expect(facePlan({ ...player, clubId: other.id } as Player)).toEqual(facePlan(player));
    expect(facePlan({ ...player, clubId: null } as unknown as Player)).toEqual(facePlan(player));
  });

  it("wears the club's home shirt, and nothing at all if he belongs to nobody", () => {
    const { state, clubId } = createTestGame('faces-shirt');
    // Outfield on purpose: the first man out of the squad can be the keeper, and
    // a keeper is the one man in the club who is *not* in the home shirt — that
    // case has its own test below.
    const player = squadOf(state, clubId, false);
    const other = Object.values(state.clubs).find((club) => club.id !== clubId)!;
    const mine = designFor(clubKit(state, clubId)!, 'home');
    const theirs = designFor(clubKit(state, other.id)!, 'home');
    expect(mine.primary).not.toBe(theirs.primary);
    expect(outfitFor(state, player).shirt).toBe(mine.primary);
    // A transfer recolours the shirt and nothing else about the drawing.
    expect(outfitFor(state, { ...player, clubId: other.id } as Player).shirt).toBe(theirs.primary);
    // And a man attached to nobody is drawn plain, not in the last club's colours.
    const free = outfitFor(state, { ...player, clubId: null } as unknown as Player);
    expect(free.shirt).toBeNull();
    expect(free.plain).toBe('shirt');
  });

  it('puts the keeper in the third strip, which is nobody else’s shirt', () => {
    // A keeper is drawn *as* a keeper in the one strip in the kit that is not the
    // club's, because the laws ask him to be told from the ten in front of him and
    // his shirt is the only thing that can tell them. The same keeper moving club
    // keeps his face and changes into somebody else's third strip.
    const { state, clubId } = createTestGame('faces-keeper');
    const keeper = squadOf(state, clubId, true);
    const kit = clubKit(state, clubId)!;
    const third = designFor(kit, 'goalkeeper').primary;
    const home = designFor(kit, 'home').primary;
    expect(outfitFor(state, keeper).shirt).toBe(third);
    // Which is a different shirt from the one the ten are in, and not a shade of
    // it: the kit generator measures the third strip off the club's own colour.
    expect(colourDistance(third, home)).toBeGreaterThanOrEqual(MIN_KIT_DISTANCE);
    const other = Object.values(state.clubs).find((club) => club.id !== clubId)!;
    expect(outfitFor(state, { ...keeper, clubId: other.id } as Player).shirt).toBe(
      designFor(clubKit(state, other.id)!, 'goalkeeper').primary,
    );
  });

  it('puts an official in a coat, because he works for the club rather than plays for it', () => {
    const { state } = createTestGame('faces-coat');
    const official = Object.values(state.people).find(isOfficial) as Person;
    const outfit = outfitFor(state, official);
    expect(outfit.shirt).toBeNull();
    expect(outfit.plain).toBe('coat');
  });

  it('never lets a haircut reach the brow, on any head or any cut', () => {
    // The head is in quarters — hairline at a quarter, eyes at the half, the base
    // of the nose at three quarters — so this is a proportion that has to hold for
    // a round head and a long one at once. Written as a fixed distance from the
    // crown it did not: the round head's hairline landed on the brow and the hair
    // ate the outer end of it.
    for (const shape of FACE_SHAPES) {
      for (const style of HAIR_STYLES) {
        const head = HEADS[shape];
        // The highest an eye is ever drawn, wearing the highest and thickest brow
        // the generator can roll (see `brows` in each of `face.ts` and
        // `Portrait.tsx`).
        const highestEye = head.crown + (head.chin - head.crown) * 0.45;
        const browTop = highestEye - 3.9 - 0.55 - 1.9 / 2;
        expect(hairlineY(head, style), `${shape} with ${style} hair`).toBeLessThan(browTop);
      }
    }
  });

  it('draws every path from a point, on every head and every cut', () => {
    // The one fault a drawing of this kind makes is a path that starts with a
    // curve: a browser refuses it, logs nothing a player would ever see, and draws
    // nothing at all. The jaw's shadow was written that way — a curve lifted out of
    // the head's own outline and used on its own — and every face in the game went
    // without it. Nothing but a real render will tell you, so the rule is checked
    // here instead: every `d` in the markup begins at a point.
    const { state, clubId } = createTestGame('faces-paths');
    const player = Object.values(state.people).find(
      (person) => isPlayer(person) && person.clubId === clubId,
    ) as Player;
    const plan = facePlan(player);
    for (const shape of FACE_SHAPES) {
      for (const style of HAIR_STYLES) {
        for (const beard of ['none', 'stubble', 'moustache', 'goatee', 'beard'] as const) {
          const html = renderToStaticMarkup(
            createElement(PortraitArt, {
              plan: { ...plan, head: HEADS[shape], shape, hairStyle: style, beard, glasses: true },
              outfit: outfitFor(state, player),
              detail: 2,
            }),
          );
          for (const [, data] of html.matchAll(/ d="([^"]*)"/g)) {
            expect(data, `${shape}/${style}/${beard} has a path with no start point`).toMatch(/^M /);
            expect(data, `${shape}/${style}/${beard} has a hole in its path`).not.toMatch(/NaN|undefined/);
          }
        }
      }
    }
  });

  it('is drawn in a box of its own shape, in the markup every screen gets', () => {
    const { state, clubId } = createTestGame('faces-markup');
    const player = Object.values(state.people).find(
      (person) => isPlayer(person) && person.clubId === clubId,
    ) as Player;
    const html = renderToStaticMarkup(
      createElement(PortraitArt, { plan: facePlan(player), outfit: outfitFor(state, player), detail: 2 }),
    );
    expect(html).toContain(`viewBox="0 0 ${PORTRAIT_WIDTH} ${PORTRAIT_HEIGHT}"`);
    // The name is always beside it, so the drawing is not read out twice.
    expect(html).toContain('aria-hidden="true"');
    // A path with a hole in it is a drawing that quietly stops drawing.
    expect(html).not.toMatch(/NaN|undefined/);
    expect(html).not.toContain('person-mark');
    // The stylesheet's four sizes are all this box's proportions, and this is the
    // box: change one and the test that measures the sheet fails too.
    expect(PORTRAIT_WIDTH / PORTRAIT_HEIGHT).toBeCloseTo(0.875, 3);
  });

  it('puts the club shirt on him wherever he is drawn, and the plain one if he has none', () => {
    // `Portrait` reads the career through `useGame`; whether that wiring is there
    // is pinned as a source contract in `workspaces.test.ts`, because a component
    // that reads the store cannot be rendered here at all: the snapshot a server
    // render is handed is zustand's *initial* state, so every screen would be
    // drawn as though no career had been loaded. That is correct for a server, and
    // it is why the game's screens are photographed in a browser. What the look-up
    // then decides is `outfitFor`, which is pure, and that is what is drawn below.
    const { state, clubId } = createTestGame('faces-store');
    const player = squadOf(state, clubId, false);
    const shirt = designFor(clubKit(state, clubId)!, 'home');
    const dressed = renderToStaticMarkup(
      createElement(PortraitArt, { plan: facePlan(player), outfit: outfitFor(state, player), detail: 1 }),
    );
    expect(dressed).toContain(shirt.primary);
    const free = renderToStaticMarkup(
      createElement(PortraitArt, {
        plan: facePlan({ ...player, clubId: null } as unknown as Player),
        outfit: outfitFor(state, { ...player, clubId: null } as unknown as Player),
        detail: 1,
      }),
    );
    expect(free).not.toContain(shirt.primary);
    expect(free).toContain('#454f59');
    expect(dressed).toContain('portrait__art');
  });
});
