import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match, MatchLineup } from '@/domain/match';
import type { Player } from '@/domain/person';
import { FORMATION_IDS, KEEPER_LINE, OUTFIELD_LINE, POSITIONS, formationSlots, getFormation, isNamedShape, positionForPoint, positionRank } from '@/domain/positions';
import { defaultRoleFor } from '@/simulation/match/roles';
import { positionScore } from '@/simulation/selection';
import { ensureUserXi } from '@/simulation/matchday';
import { nextFixtureFor } from '@/simulation/schedule';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { useGameStore } from '@/state/gameStore';
import {
  applyShape,
  clearShape,
  lineupShape,
  moveSlot,
  placeInSlot,
  removeFromBench,
  replaceOnBench,
  swapWithBench,
  squadInTeamOrder,
} from './lineupEditing';
import { SHIRT_REACH, diagramFraction, diagramPosition, diagramStyle, nearestDrawnSlot, onShirt, pitchPointAt, pitchPointerFraction } from './tacticalDiagram';

const source = (file: string) => readFileSync(`src/ui/${file}`, 'utf8');

/**
 * The manager's own XI for the coming fixture.
 *
 * The screen is a set of rules about *his* side, so the tests work on the side
 * the store would hand it: a real career, its real squad, and the lineup the
 * fixture already carries.
 */
function career(seed: string): { game: GameState; match: Match; lineup: MatchLineup; squad: Player[] } {
  const store = useGameStore.getState();
  store.createDraft(seed);
  store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
  const game = useGameStore.getState().game!;
  // The same thing the store does when the screen opens: a fixture a week out
  // would otherwise be an empty pitch, and there would be nothing to move.
  ensureUserXi(game);
  const match = nextFixtureFor(game, game.userClubId, game.date)!;
  const side = match.homeClubId === game.userClubId ? 'home' : 'away';
  const squad = game.clubs[game.userClubId]!.squadIds
    .map((id) => game.people[id])
    .filter((person): person is Player => Boolean(person) && person!.kind === 'player');
  return { game, match, lineup: match.lineups[side], squad };
}

beforeEach(() => {
  useGameStore.getState().quitToMenu();
});

describe('a dot dropped on the pitch takes the job that zone is for', () => {
  it('reads the zone from where the dot landed', () => {
    // The vocabulary is the game's own: twelve jobs, each with a spot it is
    // normally done from, and the nearest one wins.
    expect(positionForPoint(0.2, 0.16)).toBe('LB');
    expect(positionForPoint(0.2, 0.86)).toBe('RB');
    expect(positionForPoint(0.16, 0.5)).toBe('CB');
    expect(positionForPoint(0.44, 0.5)).toBe('CM');
    expect(positionForPoint(0.6, 0.5)).toBe('AM');
    expect(positionForPoint(0.78, 0.5)).toBe('ST');
    expect(positionForPoint(0.7, 0.12)).toBe('LW');
    expect(positionForPoint(0.04, 0.5)).toBe('GK');
  });

  it('never turns an outfielder into a goalkeeper by a mis-drag', () => {
    for (const [x, y] of [[0.04, 0.5], [0.02, 0.55], [0.06, 0.45], [0.01, 0.9]]) {
      expect(positionForPoint(x!, y!, { outfieldOnly: true })).not.toBe('GK');
    }
  });

  it('lets a defender be stood as deep as the six-yard line, and no deeper', () => {
    const box = { left: 0, top: 0, width: 1, height: 1 };
    // The bottom edge of the picture — his own goal line — is as deep as a dot
    // may be *moved* to, and the floor under it is the six-yard line rather than
    // the line the drawing used to stop at: a centre half pushed right back is
    // now drawn standing in his own six-yard box.
    const goalLine = pitchPointAt(box, 0.5, 1);
    expect(goalLine.x).toBeCloseTo(OUTFIELD_LINE, 10);
    expect(pitchPointAt(box, 0.5, 0.5).x).toBeGreaterThan(goalLine.x);
    expect(diagramFraction(goalLine).top).toBeGreaterThan(diagramFraction({ x: 0.13, y: 0.5 }).top);
    // And still in front of the keeper, whose row is his own: the two floors are
    // strictly apart, which is what keeps a defender off the top of him.
    expect(diagramFraction(goalLine).top).toBeLessThan(diagramFraction({ x: KEEPER_LINE, y: 0.5 }).top);
  });

  it("lets a shirt on the keeper's own row be aimed at", () => {
    const slots = getFormation('4-4-2').slots;
    const drawn = diagramFraction(diagramPosition(slots[0]!));
    // He is drawn behind every outfield row, which is exactly why he could never
    // be the nearest shirt to a drop read through the outfield floor.
    expect(drawn.top).toBeGreaterThan(diagramFraction({ x: OUTFIELD_LINE, y: 0.5 }).top);
    const drop = nearestDrawnSlot(drawn, slots);
    expect(drop.index).toBe(0);
    expect(drop.distance).toBeCloseTo(0, 10);
    expect(onShirt(drop)).toBe(true);
    // And a drop a finger's width away from his shirt is beside him, not on him.
    const beside = nearestDrawnSlot({ left: drawn.left + SHIRT_REACH.left * 3, top: drawn.top }, slots);
    expect(onShirt(beside)).toBe(false);
  });

  it('leaves no drop within reach of two shirts at once', () => {
    // The reach is a box around a man, and the swap it asks for has to be
    // unambiguous: if one drop were within reach of two shirts, which man a
    // manager swapped with would come down to which of them he was a hair
    // nearer. So the closest two shirts on any formation are held more than a
    // reach apart on at least one axis — which is also what leaves dropping a
    // man into the space between two of them a move rather than a swap.
    for (const formation of FORMATION_IDS) {
      const slots = getFormation(formation).slots;
      for (let a = 0; a < slots.length; a += 1) {
        for (let b = a + 1; b < slots.length; b += 1) {
          const first = diagramFraction(diagramPosition(slots[a]!));
          const second = diagramFraction(diagramPosition(slots[b]!));
          const apart =
            Math.abs(first.left - second.left) > SHIRT_REACH.left * 2 ||
            Math.abs(first.top - second.top) > SHIRT_REACH.top * 2;
          expect(apart, `${formation}: shirts ${a} and ${b}`).toBe(true);
        }
      }
    }
  });

  it('reads a drop off the picture rather than off the pitch', () => {
    // The same pointer read both ways. The football mapping floors the point
    // into the rows a dot may stand in; the place on the picture is simply where
    // the finger is, which is what lets a shirt be aimed at that is drawn in a
    // row nobody stands in.
    const box = { left: 10, top: 20, width: 100, height: 300 };
    expect(pitchPointerFraction(box, 60, 320)).toEqual({ left: 0.5, top: 1 });
    expect(pitchPointAt(box, 60, 320).x).toBeCloseTo(OUTFIELD_LINE, 10);
  });
});

describe('moving a dot', () => {
  it('keeps the spot it was dropped in and renames the job to suit', () => {
    const { game, lineup } = career('selection-move');
    // The right back in a 4-4-2, dragged infield: he is a centre half now.
    const index = lineup.starting.findIndex((slot) => slot.position === 'RB');
    const player = game.people[lineup.starting[index]!.playerId] as Player;
    const moved = moveSlot(lineup, index, 0.18, 0.55, player);

    expect(moved.starting[index]!.position).toBe('CB');
    expect(moved.starting[index]!.role).toBe(defaultRoleFor('CB'));
    // Whether he is out of position is asked again for where he now stands.
    expect(moved.starting[index]!.outOfPosition).toBe(positionScore(player, 'CB') < 0.55);
    // And a man dragged somewhere he cannot play is marked as such.
    const strikerIndex = lineup.starting.findIndex((slot) => slot.position === 'ST');
    const striker = game.people[lineup.starting[strikerIndex]!.playerId] as Player;
    const stranded = moveSlot(lineup, strikerIndex, 0.16, 0.55, striker);
    expect(stranded.starting[strikerIndex]!.position).toBe('CB');
    expect(stranded.starting[strikerIndex]!.outOfPosition).toBe(positionScore(striker, 'CB') < 0.55);
    // Where he stands is where he was put, and nothing else moved.
    expect(moved.tactics.shape![index]).toEqual({ position: 'CB', x: 0.18, y: 0.55 });
    expect(moved.tactics.shape).toHaveLength(11);
    expect(moved.tactics.shape!.filter((_, slotIndex) => slotIndex !== index)).toEqual(
      lineupShape(lineup).filter((_, slotIndex) => slotIndex !== index),
    );
    // The named formation is still what the squad's familiarity is measured
    // against: moving a dot is not learning a new system.
    expect(moved.tactics.formation).toBe(lineup.tactics.formation);
    expect(moved.starting).toHaveLength(lineup.starting.length);
  });

  it('makes a wide man of a defender pushed up the line', () => {
    const { game, lineup } = career('selection-wide');
    const index = lineup.starting.findIndex((slot) => slot.position === 'LB');
    const player = game.people[lineup.starting[index]!.playerId] as Player;
    expect(moveSlot(lineup, index, 0.45, 0.15, player).starting[index]!.position).toBe('LM');
  });

  it('leaves the goalkeeper a goalkeeper, in his own third', () => {
    const { game, lineup } = career('selection-keeper');
    const index = lineup.starting.findIndex((slot) => slot.position === 'GK');
    const player = game.people[lineup.starting[index]!.playerId] as Player;
    const moved = moveSlot(lineup, index, 0.85, 0.5, player);
    expect(moved.starting[index]!.position).toBe('GK');
    expect(moved.tactics.shape![index]!.x).toBeLessThanOrEqual(0.3);
  });

  it('lets the goalkeeper be moved along his own line, and only along it', () => {
    const { game, lineup } = career('selection-keeper-line');
    const index = lineup.starting.findIndex((slot) => slot.position === 'GK');
    const player = game.people[lineup.starting[index]!.playerId] as Player;

    // The one dot he could not touch at all: a keeper is not adapted to a zone,
    // but he is still his to place, across his goal.
    const pulled = moveSlot(lineup, index, KEEPER_LINE, 0.72, player);
    expect(pulled.starting[index]!.position).toBe('GK');
    expect(pulled.tactics.shape![index]!.x).toBe(KEEPER_LINE);
    expect(pulled.tactics.shape![index]!.y).toBe(0.72);
    // Drawn where the rule put him, from the same numbers: the dot stays under
    // the finger that dropped it instead of springing back to the middle.
    const drawn = diagramStyle(diagramPosition(pulled.tactics.shape![index]!));
    expect(Number.parseFloat(String(drawn['--shape-left' as keyof typeof drawn]))).toBeCloseTo(
      (0.5 + (0.72 - 0.5) * 1.3) * 100,
      5,
    );

    // He cannot be walked out of his own goal, in either direction.
    const strayed = moveSlot(lineup, index, 0.6, 0.02, player);
    expect(strayed.starting[index]!.position).toBe('GK');
    expect(strayed.tactics.shape![index]!.x).toBe(KEEPER_LINE);
    expect(strayed.tactics.shape![index]!.y).toBe(0.26);
    expect(diagramPosition({ position: 'GK', x: 0.9, y: 0.5 })).toEqual({ x: KEEPER_LINE, y: 0.5 });
  });

  it('lets a defender be pushed back to the six-yard line, and keeps him out of goal', () => {
    const { game, lineup } = career('selection-deep');
    const index = lineup.starting.findIndex((slot) => slot.position === 'CB');
    const keeper = lineup.starting.findIndex((slot) => slot.position === 'GK');
    const player = game.people[lineup.starting[index]!.playerId] as Player;
    // Pushed to the very bottom of the picture, which is where the old defensive
    // line used to stop him.
    const moved = moveSlot(lineup, index, KEEPER_LINE, 0.5, player);
    expect(moved.tactics.shape![index]!.x).toBe(OUTFIELD_LINE);
    // He is still a centre half: the deepest row is a place to stand rather than
    // a shirt, and being pushed back does not make him the goalkeeper.
    expect(moved.starting[index]!.position).toBe('CB');
    expect(moved.starting.filter((slot) => slot.position === 'GK')).toHaveLength(1);
    expect(moved.starting[keeper]!.playerId).toBe(lineup.starting[keeper]!.playerId);
    // And he is drawn in front of the keeper rather than on top of him.
    expect(diagramFraction(moved.tactics.shape![index]!).top).toBeLessThan(
      diagramFraction(moved.tactics.shape![keeper]!).top,
    );
  });

  it('does not invent a shape until somebody actually moves', () => {
    const { lineup } = career('selection-untouched');
    expect(lineup.tactics.shape).toBeUndefined();
    expect(isNamedShape(lineup.tactics.formation, lineup.tactics.shape)).toBe(true);
  });
});

describe('dropping a man on a shirt', () => {
  it('swaps two men who are both in the side', () => {
    const { game, lineup } = career('selection-swap');
    const [first, second] = lineup.starting;
    const secondPlayer = game.people[second!.playerId] as Player;
    const swapped = placeInSlot(lineup, 0, second!.playerId, secondPlayer);
    expect(swapped.starting[0]!.playerId).toBe(second!.playerId);
    expect(swapped.starting[1]!.playerId).toBe(first!.playerId);
    expect(new Set(swapped.starting.map((slot) => slot.playerId)).size).toBe(11);
  });

  it("puts a man in the goalkeeper's shirt, and the goalkeeper in his", () => {
    const { game, lineup } = career('selection-keeper-swap');
    const keeperIndex = lineup.starting.findIndex((slot) => slot.position === 'GK');
    const outfieldIndex = lineup.starting.findIndex((slot) => slot.position === 'ST');
    const keeper = game.people[lineup.starting[keeperIndex]!.playerId] as Player;
    const striker = game.people[lineup.starting[outfieldIndex]!.playerId] as Player;
    // The same edit the screen makes when a dot is let go on a shirt, either way
    // round: the man entering the shirt is the one who was dropped on it.
    const after = placeInSlot(lineup, keeperIndex, striker.id, striker);

    expect(after.starting[keeperIndex]!.playerId).toBe(striker.id);
    expect(after.starting[outfieldIndex]!.playerId).toBe(keeper.id);
    // What changed hands is the shirt, not the shape or the positions: the
    // eleven still stand where they were set out, and the side still has a
    // goalkeeper, which is the one thing the selection rules ask for.
    expect(after.starting[keeperIndex]!.position).toBe('GK');
    expect(after.starting[outfieldIndex]!.position).toBe('ST');
    expect(after.starting.filter((slot) => slot.position === 'GK')).toHaveLength(1);
    expect(after.tactics.shape).toBe(lineup.tactics.shape);
    // Both answers are asked of the right man: the man arriving in goal is judged
    // at the job he has taken on, and the keeper keeps his own answer at his own.
    expect(after.starting[keeperIndex]!.outOfPosition).toBe(positionScore(striker, 'GK') < 0.55);
    expect(after.starting[outfieldIndex]!.outOfPosition).toBe(lineup.starting[outfieldIndex]!.outOfPosition);
    expect(new Set(after.starting.map((slot) => slot.playerId)).size).toBe(11);
  });

  it('sends the displaced man to the bench when a substitute comes on', () => {
    const { game, lineup } = career('selection-sub');
    const substitute = lineup.bench[0]!;
    const substitutePlayer = game.people[substitute.playerId] as Player;
    const displaced = lineup.starting[3]!.playerId;
    const after = placeInSlot(lineup, 3, substitute.playerId, substitutePlayer);
    expect(after.starting[3]!.playerId).toBe(substitute.playerId);
    expect(after.bench.some((slot) => slot.playerId === displaced)).toBe(true);
    expect(after.bench.some((slot) => slot.playerId === substitute.playerId)).toBe(false);
    expect(new Set([...after.starting, ...after.bench].map((slot) => slot.playerId)).size).toBe(
      new Set([...lineup.starting, ...lineup.bench].map((slot) => slot.playerId)).size,
    );
  });

  it('gives a shirt to a man who had none, and benches the man he displaces', () => {
    const { game, lineup, squad } = career('selection-new');
    const picked = new Set([...lineup.starting, ...lineup.bench].map((slot) => slot.playerId));
    const spare = squad.find((player) => !picked.has(player.id));
    if (!spare) return;
    const displaced = lineup.starting[5]!.playerId;
    // Room on the bench, made the way a manager makes it.
    const roomy = removeFromBench(lineup, lineup.bench[0]!.playerId);
    const after = placeInSlot(roomy, 5, spare.id, spare);
    expect(after.starting[5]!.playerId).toBe(spare.id);
    expect(after.starting.filter((_, index) => index !== 5)).toEqual(
      lineup.starting.filter((_, index) => index !== 5),
    );
    // Nobody vanishes: the man who lost the shirt is a substitute now.
    expect(after.bench.some((slot) => slot.playerId === displaced)).toBe(true);
    expect(after.bench).toHaveLength(roomy.bench.length + 1);
    // With the bench full he simply drops out of the side, and the side is still
    // a side: eleven different men.
    const crowded = placeInSlot(lineup, 5, spare.id, spare);
    expect(crowded.bench).toHaveLength(lineup.bench.length);
    expect(crowded.starting[5]!.playerId).toBe(spare.id);
    expect(crowded.bench.some((slot) => slot.playerId === displaced)).toBe(false);
    expect(new Set(crowded.starting.map((slot) => slot.playerId)).size).toBe(11);
    expect(game.people[spare.id]).toBeTruthy();
  });
});

describe('a substitute dropped on, or dragged onto, the bench', () => {
  it('swaps a starter and a substitute when one is dropped on the other', () => {
    const { game, lineup } = career('selection-bench-swap');
    const starter = lineup.starting[4]!;
    const substitute = lineup.bench[1]!;
    const substitutePlayer = game.people[substitute.playerId] as Player;
    const after = swapWithBench(lineup, 4, substitute.playerId, substitutePlayer);
    expect(after.starting[4]!.playerId).toBe(substitute.playerId);
    expect(after.bench).toContainEqual(expect.objectContaining({ playerId: starter.playerId }));
    // A full bench is exactly the case the swap is for: five men in, five out.
    expect(after.bench).toHaveLength(5);
    expect(after.starting).toHaveLength(11);
  });

  it('gives a man who was not in the side the place on the bench he was dropped on', () => {
    const { lineup, squad } = career('selection-bench-place');
    const picked = new Set([...lineup.starting, ...lineup.bench].map((slot) => slot.playerId));
    const spare = squad.find((player) => !picked.has(player.id));
    if (!spare) return;
    const out = lineup.bench[3]!;
    const after = replaceOnBench(lineup, out.playerId, spare.id, spare);
    expect(after.bench).toHaveLength(lineup.bench.length);
    expect(after.bench[3]!.playerId).toBe(spare.id);
    expect(after.bench.some((slot) => slot.playerId === out.playerId)).toBe(false);
    expect(after.starting).toEqual(lineup.starting);
    // His own position is what the place is for, so the bench keeps its shape.
    expect(after.bench[3]!.position).toBe(spare.preferredPosition);
  });

  it('never takes a place with a man who is already in the eleven', () => {
    const { game, lineup } = career('selection-bench-guard');
    const starter = lineup.starting[2]!;
    const starterPlayer = game.people[starter.playerId] as Player;
    const out = lineup.bench[0]!;
    const after = replaceOnBench(lineup, out.playerId, starter.playerId, starterPlayer);
    // Taking a bench place without giving up the shirt would be two men in one
    // side, so nothing happens at all.
    expect(after).toBe(lineup);
  });
});

describe('a shape of your own', () => {
  const held = [
    { position: 'GK' as const, x: 0.04, y: 0.5 },
    { position: 'CB' as const, x: 0.16, y: 0.7 },
    { position: 'CB' as const, x: 0.16, y: 0.5 },
    { position: 'CB' as const, x: 0.16, y: 0.3 },
    { position: 'RM' as const, x: 0.5, y: 0.88 },
    { position: 'CM' as const, x: 0.44, y: 0.62 },
    { position: 'DM' as const, x: 0.36, y: 0.5 },
    { position: 'CM' as const, x: 0.44, y: 0.38 },
    { position: 'LM' as const, x: 0.5, y: 0.12 },
    { position: 'ST' as const, x: 0.75, y: 0.42 },
    { position: 'ST' as const, x: 0.75, y: 0.58 },
  ];

  it('is what every reader lays the side out from', () => {
    expect(formationSlots('4-4-2', held).map((slot) => slot.position)).toEqual(held.map((slot) => slot.position));
    // No shape, or a shape that is not a side, falls back to the named eleven.
    expect(formationSlots('4-4-2')).toEqual(getFormation('4-4-2').slots);
    expect(formationSlots('4-4-2', held.slice(0, 5))).toEqual(getFormation('4-4-2').slots);
    expect(isNamedShape('3-5-2', held)).toBe(false);
  });

  it('re-slots the side into it and remembers which shape it is', () => {
    const { lineup, squad } = career('selection-apply');
    const applied = applyShape(lineup, held, squad, { formation: '3-5-2', shapeId: 'shape-1' });
    expect(applied.tactics.formation).toBe('3-5-2');
    expect(applied.tactics.shapeId).toBe('shape-1');
    expect(applied.formation).toBe('3-5-2');
    expect(applied.starting.map((slot) => slot.position)).toEqual(held.map((slot) => slot.position));
    expect(applied.starting.some((slot) => slot.position === 'GK')).toBe(true);
    expect(new Set(applied.starting.map((slot) => slot.playerId)).size).toBe(11);
  });

  it('puts the dots back to the named eleven when it is cleared', () => {
    const { lineup, squad } = career('selection-clear');
    const applied = applyShape(lineup, held, squad, { formation: '3-5-2', shapeId: 'shape-1' });
    const cleared = clearShape(applied, squad);
    expect(cleared.tactics.shape).toBeUndefined();
    expect(cleared.tactics.shapeId).toBeUndefined();
    expect(cleared.starting.map((slot) => slot.position)).toEqual(
      getFormation('3-5-2').slots.map((slot) => slot.position),
    );
  });
});

describe('the shape book', () => {
  const held = getFormation('3-5-2').slots.map((slot) => ({ ...slot }));

  it('keeps a shape under its name and sets the coming side out in it', () => {
    const { game, match } = career('selection-book');
    const side = match.homeClubId === game.userClubId ? 'home' : 'away';
    useGameStore.getState().updateClubTactics({ ...game.clubs[game.userClubId]!.tactics, formation: '3-5-2' });
    useGameStore.getState().saveFormationShape('The five', held);

    const after = useGameStore.getState().game!;
    expect(after.customFormations).toHaveLength(1);
    expect(after.customFormations[0]!.name).toBe('The five');
    expect(after.customFormations[0]!.slots).toHaveLength(11);
    expect(after.clubs[after.userClubId]!.tactics.shapeId).toBe(after.customFormations[0]!.id);
    // It reaches the fixture the engine will be handed, not just the screen.
    const fixture = nextFixtureFor(after, after.userClubId, after.date)!;
    expect(fixture.lineups[side].tactics.shapeId).toBe(after.customFormations[0]!.id);
    expect(fixture.lineups[side].tactics.shape).toHaveLength(11);
  });

  it('travels with the career, and an older career wakes up with an empty book', () => {
    const { game } = career('selection-book-save');
    useGameStore.getState().saveFormationShape('The five', held);
    const saved = useGameStore.getState().game!;
    const restored = deserialiseGame(serialiseGame(saved)).state!;
    expect(restored.customFormations).toHaveLength(1);
    expect(restored.customFormations[0]!.name).toBe('The five');
    expect(restored.customFormations[0]!.slots).toHaveLength(11);

    // A career written before any of this existed: the field is absent, and it
    // is filled in as an empty book rather than as somebody else's shapes.
    const older = JSON.parse(serialiseGame(saved)) as { version: number; state: Record<string, unknown> };
    older.version = 15;
    delete older.state.customFormations;
    const migrated = deserialiseGame(JSON.stringify(older)).state!;
    expect(migrated.customFormations).toEqual([]);
    expect(migrated.version).toBeGreaterThan(15);
    expect(game.customFormations).toHaveLength(0);
  });

  it('replaces a shape of the same name rather than filling the book with it', () => {
    const { game } = career('selection-book-again');
    useGameStore.getState().saveFormationShape('The five', held);
    const moved = held.map((slot, index) => (index === 9 ? { ...slot, x: 0.82 } : slot));
    useGameStore.getState().saveFormationShape('The five', moved);
    const after = useGameStore.getState().game!;
    expect(after.customFormations).toHaveLength(1);
    expect(after.customFormations[0]!.slots[9]!.x).toBe(0.82);
    expect(game.customFormations).toHaveLength(0);
  });

  it('forgets one without moving anybody', () => {
    const { game, match } = career('selection-book-delete');
    const side = match.homeClubId === game.userClubId ? 'home' : 'away';
    useGameStore.getState().saveFormationShape('The five', held);
    const saved = useGameStore.getState().game!.customFormations[0]!;
    const before = nextFixtureFor(useGameStore.getState().game!, game.userClubId, game.date)!.lineups[side];
    useGameStore.getState().deleteFormationShape(saved.id);

    const after = useGameStore.getState().game!;
    expect(after.customFormations).toHaveLength(0);
    const lineup = nextFixtureFor(after, after.userClubId, after.date)!.lineups[side];
    expect(lineup.starting.map((slot) => slot.playerId)).toEqual(before.starting.map((slot) => slot.playerId));
    expect(lineup.tactics.shape).toHaveLength(11);
    expect(lineup.tactics.shapeId).toBeUndefined();
  });
});

describe('the selection screen says what it can do', () => {
  const view = source('views/TeamSelectionView.tsx');

  it('lets a dot be dragged, and says what it will become', () => {
    expect(view).toContain('pitchPointAt');
    expect(view).toContain('onPointerDown');
    expect(view).toContain('onPointerMove');
    expect(view).toContain('pitch__zone');
    expect(view).toContain('pitch__player--target');
  });

  it('swaps two men when a dot is let go on another, keeper included', () => {
    // The gesture the screen was missing. A dot let go *on* a shirt hands that
    // shirt over, which is the only way a keeper is made or unmade by dragging:
    // the zone rule will not make one (`outfieldOnly`) and a keeper let go on
    // grass is pinned back to his line. The shirt aimed at is chosen from where
    // the finger is, because the keeper is drawn in a row of his own that no
    // zone reaches, and it is marked before the manager lets go.
    expect(view).toContain('swapDots');
    expect(view).toContain('nearestDrawnSlot');
    expect(view).toContain('pitchPointerFraction');
    expect(view).toContain('onShirt');
    expect(view).toContain('Swap with');
    expect(view).toContain('pitch__player--target');
    // And both his dot's jobs are said out loud, on the pitch and in the hint.
    expect(view).toContain('onto a teammate to swap');
    expect(view).toContain('drop him on a shirt to swap');
  });

  it('lets the same move be made from the keyboard', () => {
    expect(view).toContain('ArrowUp');
    expect(view).toContain('ArrowLeft');
    expect(view).toContain('visually-hidden');
    expect(view).toContain('role="status"');
    // And the keeper is movable too: he has one line rather than a zone.
    expect(view).toContain('drag him along his line');
  });

  it('never reads a drag as a click, and never loses the click', () => {
    // Playwright clicks the eleven shirts and expects the picker, so the click
    // has to survive the drag that now shares the same button.
    expect(view).toContain('DRAG_THRESHOLD');
    expect(view).toContain('suppressClickRef');
  });

  it('lists the whole squad rather than hiding the men already picked', () => {
    expect(view).not.toContain('const candidates = squad.filter');
    expect(view).toContain('picker__row--xi');
    expect(view).toContain('placeInSlot');
    expect(view).toContain('Swap in');
  });

  it('keeps a shape under a name, and can put the dots back', () => {
    expect(view).toContain('saveFormationShape');
    expect(view).toContain('deleteFormationShape');
    expect(view).toContain('clearShape');
    expect(view).toContain('shape-book');
  });

  it('draws the pitch from the shared diagram, as the tactics screen does', () => {
    // The two screens are one picture of one shape; a second coordinate system
    // on this screen is how they drifted apart the first time.
    expect(view).toContain('diagramStyle(diagramPosition(formationSlot))');
    expect(view).toContain('lineupShape');
  });

  it('dresses the keeper in his own kit, because his shirt is how he is found', () => {
    // The one man on this pitch who is not in the club's colours. The dot the
    // manager drags around is drawn in the third strip the Kit screen drew for
    // him, so the keeper he drops where he wants him is the keeper who will turn
    // out — and his shirt is the only thing telling him from the ten either side
    // of him.
    expect(view).toContain('goalkeeperKitColour(game, clubId)');
    expect(view).toContain('style={keeper ? keeperStyle : undefined}');
    expect(view).toContain('flatClubInk');
  });
});

describe('the two controls that belong on the pitch', () => {
  const view = source('views/TeamSelectionView.tsx');
  const sheet = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('keeps the shape from the corner of the pitch it was drawn on', () => {
    expect(view).toContain('pitch__tools');
    expect(view).toContain('Keep this shape');
    expect(view).toContain('saveFormationShape');
    expect(view).toContain('role="dialog"');
  });

  it('says what is wrong with the selection from the other corner, when asked', () => {
    expect(view).toContain('pitch__tool--bad');
    expect(view).toContain('aria-expanded');
    expect(view).toContain('Selection problems');
  });

  it('has no panel of its own between the pitch and the squad list', () => {
    // The shape and the problems moved onto the grass, so the column beside it
    // is the whole squad and nothing else.
    expect(sheet).not.toContain('.team-selection__side');
    expect(view).not.toContain('team-selection__side');
    expect(sheet).toContain('.pitch__tools');
    // The overlay is not `.pitch__box`: that name is the penalty area.
    expect(sheet).toContain('.pitch__panel {');
    expect(sheet).not.toContain('.pitch__box-head');
  });

  it('writes a substitute under his shirt at the size of a man on the pitch', () => {
    // One size, named once, used by both: the two lists are read together.
    expect(sheet).toContain('--shirt-name-size');
    expect(sheet).toContain('.team-selection .pitch--preparation .pitch__name');
    expect(sheet).toContain('.team-selection .bench-dot__who');
  });

  it('does not ask a substitute to be removed, and does not offer to fill the bench', () => {
    expect(view).not.toContain('bench-dot__out');
    expect(view).not.toContain('Add a substitute');
    expect(sheet).not.toContain('.bench-dot__out');
  });

  it('says the one thing the screen is about in the header and nothing else', () => {
    // The heading, the eyebrow, and then straight to the controls: no subtitle,
    // no line of fixture facts under it, so the formation, the captain and the
    // squad pick sit at the top right of the screen where the work starts.
    const header = view.slice(view.indexOf('<PageHeader'), view.indexOf('actions={'));
    expect(header).not.toContain('subtitle');
    expect(header).not.toContain('meta=');
    expect(header).toContain('title="Team selection"');
    expect(view).toContain('Ask the assistant to pick');
  });

  it('puts the dropdowns and the buttons on the header, and nothing between it and the pitch', () => {
    // The band of facts that used to sit under the heading is gone: the
    // formation, the captain and both buttons are in the header's own action
    // row, at the top right, where the manager's hand is going anyway.
    const header = view.slice(view.lastIndexOf('<PageHeader'), view.indexOf('team-selection__workspace'));
    expect(view).not.toContain('team-selection__facts');
    expect(sheet).not.toContain('.team-selection__facts');
    expect(view).not.toContain('Starting XI');
    expect(header).toContain('aria-label="Formation"');
    expect(header).toContain('aria-label="Captain"');
    expect(header).toContain('Ask the assistant to pick');
    expect(header).toContain('team-selection__list-open');
  });

  it('leaves time and the match to the command bar', () => {
    // Picking the side is not starting the match and it is not moving the clock:
    // Continue and the calendar do that, and the matchday is played from the
    // command bar's own action (see `commandState`).
    expect(view).not.toContain('startUserMatch');
    expect(view).not.toContain('Go to the match');
    expect(view).not.toContain('continueGame');
  });

  it('has an icon for the state of the selection', () => {
    expect(source('components/icons.tsx')).toContain('warn:');
  });
});

describe('the position vocabulary the pitch adapts into', () => {
  it('names every zone it can produce', () => {
    for (const code of ['LB', 'RB', 'CB', 'CM', 'DM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'] as const) {
      expect(POSITIONS[code].label.length).toBeGreaterThan(2);
    }
  });
});


/**
 * The list a side is picked from, in the order it opens in.
 *
 * The screen asks `squadInTeamOrder` for that order rather than sorting the
 * squad itself, so what is pinned here is the rule: the XI as it stands on the
 * pitch, keeper first; then the substitutes, by the job each of them does; then
 * everybody else. It is the order a manager reads a team sheet in, and the
 * reason the screen opens in it is that "who is picked, and where" is the
 * question he came to that screen to ask.
 */
describe('the squad list a side is picked from', () => {
  const view = source('views/TeamSelectionView.tsx');

  it('puts the eleven first, in the order the shape stands them on the pitch', () => {
    const { lineup, squad } = career('selection-order');
    const places = squadInTeamOrder(squad, lineup);

    // Everybody, once. This list is the whole squad, as the picker has always
    // been, and a man missing from it is a man who cannot be picked.
    expect(places).toHaveLength(squad.length);
    expect(new Set(places.map((place) => place.player.id)).size).toBe(squad.length);

    const picked = places.filter((place) => place.slotIndex >= 0);
    expect(picked).toHaveLength(11);
    expect(picked.map((place) => place.player.id)).toEqual(lineup.starting.map((slot) => slot.playerId));
    // Read from the back, the way a teamsheet is drawn: the keeper is first,
    // because his is the first shirt on the pitch.
    expect(POSITIONS[lineup.starting[0]!.position].group).toBe('GK');
    // And the eleven are in the order the pitch draws them, which is the order
    // `lineupShape` hands the diagram.
    expect(picked.map((place) => place.slotIndex)).toEqual([...Array(11).keys()]);
  });

  it('puts the substitutes behind them, and the rest of the squad behind those', () => {
    const { lineup, squad } = career('selection-order-ranks');
    const places = squadInTeamOrder(squad, lineup);
    const inXI = (place: { slotIndex: number }) => place.slotIndex >= 0;

    const benchPlaces = places.filter((place) => !inXI(place) && place.benchIndex >= 0);
    expect(benchPlaces).toHaveLength(lineup.bench.length);
    expect(benchPlaces.map((place) => place.player.id).sort()).toEqual(lineup.bench.map((slot) => slot.playerId).sort());
    // A substitute has no place on a pitch until he comes on, so his job is what
    // puts him in order: keeper first, the front men last.
    const ranks = benchPlaces.map((place) => positionRank(place.player.preferredPosition));
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));

    // Three bands and no interleaving: every member of the XI, then every
    // substitute, then the men who are in neither.
    expect(places.map(inXI).lastIndexOf(true)).toBeLessThan(places.findIndex((place) => !inXI(place)));
    const firstSpare = places.findIndex((place) => !inXI(place) && place.benchIndex < 0);
    const lastBench = places.map((place) => !inXI(place) && place.benchIndex >= 0).lastIndexOf(true);
    expect(firstSpare).toBeGreaterThan(lastBench);
  });

  it('moves a man up the list when he is picked, and the man he replaced down it', () => {
    const { game, lineup, squad } = career('selection-order-swap');
    const reserve = lineup.bench[2]!;
    const reservePlayer = game.people[reserve.playerId] as Player;
    const displaced = lineup.starting[4]!.playerId;
    const after = swapWithBench(lineup, 4, reserve.playerId, reservePlayer);

    const places = squadInTeamOrder(squad, after);
    // The shirt is the place in the list: he is where the man he replaced was.
    expect(places.filter((place) => place.slotIndex >= 0)[4]!.player.id).toBe(reserve.playerId);
    const dropped = places.findIndex((place) => place.player.id === displaced);
    expect(dropped).toBeGreaterThan(10);
    // And he is read as a substitute now, rather than as a member of the XI.
    expect(places[dropped]!.slotIndex).toBe(-1);
    expect(places[dropped]!.benchIndex).toBeGreaterThanOrEqual(0);
  });

  it('sorts on the facts the squad screen sorts on, and offers the same headings', () => {
    // One answer to "sort a squad", in both screens: the values come from the
    // domain (`positionRank`, `availabilityRank`), so the two lists cannot drift
    // apart, and the cycling is `tableSort`'s, so neither can the gesture.
    expect(view).toContain('squadInTeamOrder(squad, lineup)');
    expect(view).toContain('applySort(roster, sort, PICKER_SORT)');
    expect(view).toContain('toggleSort(sort, key)');
    // The headings live with the thing that remembers one, in `selectionSort.ts`,
    // so the list cannot remember a heading it does not offer or offer one it
    // cannot remember.
    expect(view).toContain('SELECTION_SORT_KEYS.map');
    const headings = source('selectionSort.ts');
    for (const heading of ["label: 'Player'", "label: 'Pos'", "label: 'Fitness'", "label: 'Form'", "label: 'Morale'", "label: 'Availability'"]) {
      expect(headings, `the selection list cannot be sorted by ${heading}`).toContain(heading);
    }
    // And the one heading the squad screen has no use for: how well a man plays
    // the shirt being picked for, which is the order this list used to open in.
    expect(headings).toContain("key: 'fit'");
    // Every heading offered is one the screen can actually sort by, and every
    // accessor is a heading a manager can press: two lists that could drift are
    // two lists that will.
    const offered = [...headings.matchAll(/key: '([a-z]+)'/g)].map((match) => match[1]);
    const accessors = view.slice(view.indexOf('const PICKER_SORT'));
    const sorted = [...accessors.slice(0, accessors.indexOf('};')).matchAll(/^ {2}([a-z]+): /gm)].map((match) => match[1]);
    expect(sorted.sort()).toEqual(offered.sort());
    expect(offered).toHaveLength(7);
    // A sorted heading says so, and says which way: the squad table's `th` gets
    // its `aria-sort` from `SortTh`, and a button has no such attribute.
    expect(view).toContain('aria-pressed={direction !== null}');
  });

  it("opens on the heading the manager last left it on, in the career he left it in", () => {
    // Asked for before the first paint, so walking to another screen and coming
    // back does not quietly put the names into the team's order instead — which
    // is the whole of what remembering this is for — and handed the accessors
    // that sort the rows, so the headings it can press and the ones it can
    // remember are one list rather than two.
    expect(view).toContain("useRememberedSort('selection', game?.saveId ?? null, PICKER_SORT)");
    // The writing is the hook's job rather than the screen's, so this screen
    // cannot forget to do it and has no idea where a choice is kept.
    expect(view).not.toContain('rememberSortChoice');
    expect(view).not.toContain('localStorage');
    // Kept per career and per screen, in the browser-local namespace the other
    // screen state uses, and out of the save: it is a reading of a squad rather
    // than a fact about one, so a save handed to somebody else brings no view
    // preferences with it.
    const memory = source('rememberedSort.ts');
    expect(memory).toContain("'se27.ui.sort.'");
    expect(memory).toContain('loadSortChoice<K extends string>(');
  });

  it('says about a man what the squad list says about him', () => {
    // The same row, in the same words, because a manager reads the two lists
    // against each other: who is in the side here, how fit he is there.
    expect(view).toContain('<PersonIdentity person={player} detail={player.occupation} />');
    expect(view).toContain('availabilityTone(player.availability.status)');
    for (const fact of ['Pos', 'Fitness', 'Form', 'Morale', 'Availability']) {
      expect(view, `the selection list says nothing about ${fact}`).toContain(`data-label="${fact}"`);
    }
    // What is still this screen's own: where the man already is.
    expect(view).toContain('whereAbout(slotIndex, onBench)');
  });
});
