import type { BenchSlot, LineupSlot, MatchLineup } from '@/domain/match';
import { defaultRoleFor } from '@/simulation/match/roles';
import type { Player } from '@/domain/person';
import { getFormation, type FormationId } from '@/domain/positions';
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
  const formation = getFormation(formationId);
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
  formation.slots.forEach((slot, index) => {
    const current = lineup.starting[index];
    const currentPlayer = current ? byId.get(current.playerId) : undefined;
    if (currentPlayer && !used.has(currentPlayer.id) && positionScore(currentPlayer, slot.position) >= 0.5) {
      used.add(currentPlayer.id);
      starting.push({
        playerId: currentPlayer.id,
        position: slot.position,
        role: current.role ?? defaultRoleFor(slot.position),
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
    formation: formationId,
    starting: starting.slice(0, 11),
    bench,
    captainId: captainStillIn ? lineup.captainId : starting[0]?.playerId ?? null,
    tactics: { ...lineup.tactics, formation: formationId },
  };
}
