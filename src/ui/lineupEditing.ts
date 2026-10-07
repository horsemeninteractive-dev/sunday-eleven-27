import type { BenchSlot, LineupSlot, MatchLineup } from '@/domain/match';
import { defaultRoleFor } from '@/simulation/match/roles';
import type { Player } from '@/domain/person';
import { KEEPER_ACROSS, KEEPER_LINE, formationSlots, positionForPoint, type FormationId, type FormationSlot } from '@/domain/positions';
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
      const displacedPlayer = player;
      return {
        playerId: displaced,
        position: entry.position,
        role: defaultRoleFor(entry.position),
        outOfPosition: isOutOfPosition(displacedPlayer, entry.position),
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
 * cannot lose its keeper to a mis-drag — and nobody becomes one by dragging a
 * striker into the six-yard box (`outfieldOnly`).
 */
export function moveSlot(lineup: MatchLineup, slotIndex: number, x: number, y: number, player?: Player): MatchLineup {
  const slot = lineup.starting[slotIndex];
  if (!slot) return lineup;
  const keeper = slot.position === 'GK';
  const point = keeper
    ? { x: KEEPER_LINE, y: clamp(y, KEEPER_ACROSS[0], KEEPER_ACROSS[1]) }
    : { x: clamp(x, 0.05, 0.92), y: clamp(y, 0.06, 0.94) };
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
