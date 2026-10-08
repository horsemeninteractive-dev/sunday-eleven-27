import type { BenchSlot, LineupSlot, MatchLineup } from '@/domain/match';
import { defaultRoleFor } from '@/simulation/match/roles';
import type { Player } from '@/domain/person';
import { KEEPER_ACROSS, KEEPER_LINE, OUTFIELD_LINE, formationSlots, positionForPoint, positionRank, type FormationId, type FormationSlot } from '@/domain/positions';
import { positionScore } from '@/simulation/selection';

/**
 * Pure lineup edits used by the selection screen. Keeping these out of the
 * components means the UI only describes *intent* ("put him at left back"),
 * while the rules for slots, duplicates and bench limits live in one place.
 */

export function isOutOfPosition(player: Player, position: string): boolean {
  return positionScore(player, position as never) < 0.55;
}

export function assignToStarting(lineup: MatchLineup, slotIndex: number, playerId: string, player: Player): MatchLineup {
  const slot = lineup.starting[slotIndex];
  if (!slot) return lineup;

  const displaced = slot.playerId;
  const starting = lineup.starting.map((entry, index) => {
    if (index === slotIndex) {
      return { playerId, position: entry.position, role: defaultRoleFor(entry.position), outOfPosition: isOutOfPosition(player, entry.position) };
    }
    if (entry.playerId === playerId) {
      // Dragged from another slot: swap the two players rather than duplicating.
      // The man who leaves keeps the slot he was already standing in, and with it
      // his own answer to whether he is out of position there: asking that
      // question of the man arriving marks one man for the other man's job.
      return {
        playerId: displaced,
        position: entry.position,
        role: defaultRoleFor(entry.position),
        outOfPosition: entry.outOfPosition,
      };
    }
    return entry;
  });

  const bench = lineup.bench.filter((benchSlot) => benchSlot.playerId !== playerId);
  return { ...lineup, starting, bench };
}

export function assignToBench(lineup: MatchLineup, playerId: string, player: Player, limit = 5): MatchLineup {
  if (lineup.bench.some((slot) => slot.playerId === playerId)) return lineup;
  if (lineup.bench.length >= limit) return lineup;
  const starting = lineup.starting.filter((slot) => slot.playerId !== playerId);
  const bench: BenchSlot[] = [...lineup.bench, { playerId, position: player.preferredPosition, role: defaultRoleFor(player.preferredPosition) }];
  return { ...lineup, starting, bench };
}

export function swapWithBench(lineup: MatchLineup, slotIndex: number, benchPlayerId: string, player: Player): MatchLineup {
  const slot = lineup.starting[slotIndex];
  if (!slot) return lineup;
  const benchIndex = lineup.bench.findIndex((entry) => entry.playerId === benchPlayerId);
  if (benchIndex < 0) return lineup;

  const displaced = slot.playerId;
  const starting: LineupSlot[] = lineup.starting.map((entry, index) =>
    index === slotIndex
      ? { playerId: benchPlayerId, position: entry.position, role: defaultRoleFor(entry.position), outOfPosition: isOutOfPosition(player, entry.position) }
      : entry,
  );
  const bench = lineup.bench.filter((_, index) => index !== benchIndex);
  if (displaced) bench.push({ playerId: displaced, position: slot.position, role: defaultRoleFor(slot.position) });
  return { ...lineup, starting, bench };
}

/**
 * Put a man in a substitute's place.
 *
 * Dropping a name from the squad onto a particular substitute is asking for
 * *that* place on the bench, and a bench that is already full is the normal case
 * on a matchday: taking the place is what the gesture means, so the man who held
 * it drops out of the selection rather than the drop being refused.
 */
export function replaceOnBench(lineup: MatchLineup, benchPlayerId: string, playerId: string, player: Player): MatchLineup {
  const index = lineup.bench.findIndex((slot) => slot.playerId === benchPlayerId);
  if (index < 0 || lineup.starting.some((slot) => slot.playerId === playerId)) return lineup;
  const bench = lineup.bench.map((slot, at) =>
    at === index
      ? { playerId, position: player.preferredPosition, role: defaultRoleFor(player.preferredPosition) }
      : slot,
  );
  return { ...lineup, bench };
}

export function clearSlot(lineup: MatchLineup, slotIndex: number): MatchLineup {
  return {
    ...lineup,
    starting: lineup.starting.filter((_, index) => index !== slotIndex),
  };
}

export function removeFromBench(lineup: MatchLineup, playerId: string): MatchLineup {
  return { ...lineup, bench: lineup.bench.filter((slot) => slot.playerId !== playerId) };
}

export function setCaptain(lineup: MatchLineup, playerId: string | null): MatchLineup {
  return { ...lineup, captainId: playerId };
}

/**
 * Change formation while keeping as many current players as possible. Players
 * are re-slotted to the positions they fit best; the rest of the XI is filled
 * from the squad so the lineup is always playable.
 */
export function applyFormation(lineup: MatchLineup, formationId: FormationId, squad: readonly Player[]): MatchLineup {
  return applySlots(lineup, formationSlots(formationId), squad, { formation: formationId });
}

/**
 * Apply a shape the manager built himself.
 *
 * The same rules as a named formation — keep the men who already fit where they
 * stand, fill the rest from the squad, never leave the side short — but the
 * eleven positions are his own, and they travel with the tactics so the match is
 * played in the shape that was picked rather than in its nearest name.
 */
export function applyShape(
  lineup: MatchLineup,
  shape: readonly FormationSlot[],
  squad: readonly Player[],
  options: { formation?: FormationId; shapeId?: string } = {},
): MatchLineup {
  return applySlots(lineup, shape, squad, {
    formation: options.formation ?? lineup.tactics.formation,
    shape: shape.map((slot) => ({ ...slot })),
    shapeId: options.shapeId,
  });
}

/** Go back to the named formation's own eleven, forgetting the custom shape. */
export function clearShape(lineup: MatchLineup, squad: readonly Player[]): MatchLineup {
  return applyFormation(lineup, lineup.tactics.formation, squad);
}

/** A pitch point, clamped to somewhere a dot is allowed to sit. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Move a slot to a point on the pitch.
 *
 * This is the whole of "move a dot anywhere and the position adapts". The dot
 * stays where it was dropped and the *position* becomes the one that zone is for
 * (`positionForPoint`), so a right back dragged infield is a centre half and one
 * dragged forward is a right midfielder, without the manager having to find that
 * in a list. The role follows the position, because a role is what a man is
 * *for*, and that is the thing that has changed.
 *
 * His new position is written into the shape as well as into the slot, so the
 * pitch, the picture before kick-off and the engine's own anchors all agree.
 *
 * The goalkeeper is the one exception, and it is a football rule rather than a
 * technical one: he stays the goalkeeper and stays on his own line, so a side
 * cannot lose its keeper by pushing his dot around — and a striker dragged into
 * the six-yard box does not become one (`outfieldOnly`). The way in and out of
 * that shirt is a swap rather than a move: a man is made the keeper by being put
 * *in* it, which is `placeInSlot`, and the same gesture takes the keeper out of
 * it by putting the other man in.
 *
 * The floors are the picture's own, so a man cannot be held somewhere the pitch
 * cannot draw him: the deepest row is the six-yard line (`OUTFIELD_LINE`),
 * because the row behind it belongs to the keeper, and a defender pushed past it
 * used to be drawn standing on top of his own goalkeeper.
 */
export function moveSlot(lineup: MatchLineup, slotIndex: number, x: number, y: number, player?: Player): MatchLineup {
  const slot = lineup.starting[slotIndex];
  if (!slot) return lineup;
  const keeper = slot.position === 'GK';
  const point = keeper
    ? { x: KEEPER_LINE, y: clamp(y, KEEPER_ACROSS[0], KEEPER_ACROSS[1]) }
    : { x: clamp(x, OUTFIELD_LINE, 0.88), y: clamp(y, 0.1, 0.9) };
  const position = keeper ? 'GK' : positionForPoint(point.x, point.y, { outfieldOnly: true });
  const shape = formationSlots(lineup.tactics.formation, lineup.tactics.shape).map((entry, index) =>
    index === slotIndex ? { position, x: point.x, y: point.y } : entry,
  );
  return {
    ...lineup,
    starting: lineup.starting.map((entry, index) =>
      index === slotIndex
        ? {
            ...entry,
            position,
            role: defaultRoleFor(position),
            outOfPosition: player ? isOutOfPosition(player, position) : entry.outOfPosition,
          }
        : entry,
    ),
    tactics: { ...lineup.tactics, shape },
  };
}

/**
 * Put a man in a slot, whatever he was doing before.
 *
 * One rule for every way a manager can express it — picked from the list,
 * dropped in from the squad, dropped in off the bench — because they are the
 * same act. Two starters swap, a substitute coming on sends the displaced man
 * to the bench, and a man who was not selected takes the shirt while the man he
 * displaces drops to the bench if there is a space for him.
 */
export function placeInSlot(
  lineup: MatchLineup,
  slotIndex: number,
  playerId: string,
  player: Player,
  limit = 5,
): MatchLineup {
  if (lineup.starting.some((slot) => slot.playerId === playerId)) {
    return assignToStarting(lineup, slotIndex, playerId, player);
  }
  if (lineup.bench.some((slot) => slot.playerId === playerId)) {
    return swapWithBench(lineup, slotIndex, playerId, player);
  }
  const slot = lineup.starting[slotIndex];
  const after = assignToStarting(lineup, slotIndex, playerId, player);
  // A man who was not in the side takes the shirt, and the man he displaces
  // goes to the bench if there is room. Dropping a name onto a shirt is not a
  // request for the other man to disappear, and a bench with room on it is
  // where a Sunday manager would put him.
  if (!slot?.playerId || after.bench.length >= limit) return after;
  if (after.bench.some((entry) => entry.playerId === slot.playerId)) return after;
  return { ...after, bench: [...after.bench, { playerId: slot.playerId, position: slot.position, role: slot.role }] };
}

/**
 * The eleven positions this lineup is set up in: the manager's shape if he has
 * one, otherwise the named formation's own.
 */
export function lineupShape(lineup: MatchLineup): FormationSlot[] {
  return formationSlots(lineup.tactics.formation, lineup.tactics.shape);
}

function applySlots(
  lineup: MatchLineup,
  slots: readonly FormationSlot[],
  squad: readonly Player[],
  tactics: { formation: FormationId; shape?: FormationSlot[]; shapeId?: string },
): MatchLineup {
  const byId = new Map(squad.map((player) => [player.id, player]));
  const available = [...lineup.starting.map((slot) => byId.get(slot.playerId)).filter((player): player is Player => Boolean(player))];
  const benchIds = new Set(lineup.bench.map((slot) => slot.playerId));
  for (const player of squad) {
    if (!available.some((entry) => entry.id === player.id) && !benchIds.has(player.id) && player.availability.status !== 'unavailable') {
      available.push(player);
    }
  }

  const used = new Set<string>();
  const starting: LineupSlot[] = [];
  slots.forEach((slot, index) => {
    const current = lineup.starting[index];
    const currentPlayer = current ? byId.get(current.playerId) : undefined;
    if (currentPlayer && !used.has(currentPlayer.id) && positionScore(currentPlayer, slot.position) >= 0.5) {
      used.add(currentPlayer.id);
      starting.push({
        playerId: currentPlayer.id,
        position: slot.position,
        role: defaultRoleFor(slot.position),
        outOfPosition: isOutOfPosition(currentPlayer, slot.position),
      });
      return;
    }
    const best = available
      .filter((player) => !used.has(player.id))
      .map((player) => ({ player, score: positionScore(player, slot.position) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best) return;
    used.add(best.player.id);
    starting.push({
      playerId: best.player.id,
      position: slot.position,
      role: defaultRoleFor(slot.position),
      outOfPosition: isOutOfPosition(best.player, slot.position),
    });
  });

  const bench = lineup.bench.filter((slot) => !used.has(slot.playerId));
  for (const player of available) {
    if (used.has(player.id)) continue;
    if (bench.length >= 5) break;
    bench.push({ playerId: player.id, position: player.preferredPosition, role: defaultRoleFor(player.preferredPosition) });
  }

  const captainStillIn = starting.some((slot) => slot.playerId === lineup.captainId);
  return {
    ...lineup,
    formation: tactics.formation,
    starting: starting.slice(0, 11),
    bench,
    captainId: captainStillIn ? lineup.captainId : starting[0]?.playerId ?? null,
    tactics: { ...lineup.tactics, formation: tactics.formation, shape: tactics.shape, shapeId: tactics.shapeId },
  };
}

/**
 * The squad as a manager reads it off a team sheet.
 *
 * Three answers in one order: the eleven who are picked, in the order the shape
 * stands them on the pitch — keeper first, the front men last — then the
 * substitutes, keeper first again, and then everybody else, by the job he
 * plays. It is the order the selection screen's list opens in, so the question
 * a manager came to that screen with is answered by the top of the list rather
 * than by scrolling it: who is in the side, and where on the pitch he is.
 *
 * Pure, and out here rather than in the view, because it is a rule about a
 * lineup and a squad rather than about a drawing of them — which is why it can
 * be asked directly what order it puts a side in.
 */
export interface SquadPlace {
  player: Player;
  /** His place in the XI, in the order the shape reads it: keeper first. -1 if he is not in it. */
  slotIndex: number;
  /** His place on the bench, in the order it is written. -1 if he is not on it. */
  benchIndex: number;
}

/** The bands `squadInTeamOrder` sorts in. Wide enough apart that the ranking
 *  inside one band can never reach into the next: no position outranks being
 *  in the side. */
const XI_BAND = 0;
const BENCH_BAND = 1000;
const REST_BAND = 2000;

export function squadInTeamOrder(squad: readonly Player[], lineup: MatchLineup): SquadPlace[] {
  const places: SquadPlace[] = squad.map((player) => ({
    player,
    slotIndex: lineup.starting.findIndex((slot) => slot.playerId === player.id),
    benchIndex: lineup.bench.findIndex((slot) => slot.playerId === player.id),
  }));
  // The XI's own order is the shape's: `lineupShape` lays the eleven out from
  // the keeper forwards, and the list is drawn from the same array. Where the
  // men behind them fall is by job, because a substitute has no place on a
  // pitch until he comes on — his position is all the sheet can say about him.
  const band = (place: SquadPlace) => {
    if (place.slotIndex >= 0) return XI_BAND + place.slotIndex;
    if (place.benchIndex >= 0) return BENCH_BAND + positionRank(place.player.preferredPosition);
    return REST_BAND + positionRank(place.player.preferredPosition);
  };
  return places.sort((left, right) => band(left) - band(right));
}
