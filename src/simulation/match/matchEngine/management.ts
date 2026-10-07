import type { Match, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';
import type { Rng } from '../../rng';
// How many changes a side is allowed is a law of the game, shared with the
// background resolution, which used to cap the same allowance with a constant.
import { changesAllowed } from '../laws';
import { defaultRoleFor } from '../roles';
import { makePlayerForSlot, formationBase, invalidateIndex, refreshSlotGeometry } from './state';
import type { DecisionWorld } from './decisions';
import { emitEvent } from './events';
import type { MatchEngineState, PlayerMatchState, Side } from './types';

/**
 * Managing the bench and the shape, during the match.
 *
 * A substitution is not a football decision the engine's step loop should be
 * making every frame; it is a thing the manager does, and the engine simply
 * carries it out. This module is where that happens: the human's own change, the
 * AI's tired-legs change for a side nobody is managing, and the shape following
 * a tactical switch. None of it decides any football — it changes who is on the
 * pitch and where their slot is, and the ordinary rules play on.
 */

/** How often an unmanaged bench is considered, in football seconds. */
const BENCH_REVIEW_SECONDS = 30;
/** A tired outfield man is worth replacing below this stamina. */
const TIRED_STAMINA = 46;
/** The earliest minute an AI will make a tired-legs change. */
const TIRED_MINUTE = 55;

/** A performance record for a player who has just come on. */
function newPerformance(
  playerId: string,
  player: Player | undefined,
  clubId: string,
  position: PositionCode,
  minute: number,
): PlayerPerformance {
  return {
    playerId,
    clubId,
    started: false,
    minutesPlayed: 0,
    positionPlayed: position,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    saves: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    rating: 6,
    cameOnMinute: minute,
    wentOffMinute: null,
    energy: player?.fitness ?? 100,
    injuryDetail: null,
    sentOff: false,
  };
}

/**
 * Bring a substitute on for a starter.
 *
 * The man coming on inherits the slot's position and role, so he is the same job
 * as the man he replaces; the shape is refreshed from the lineup afterwards in
 * case the formation itself changed. Returns false when the change is not
 * possible — nobody on the bench, no changes left, or the men are not where the
 * caller thinks they are.
 */
export function substitute(
  state: MatchEngineState,
  world: DecisionWorld,
  side: Side,
  outgoingId: string,
  incomingId: string,
): boolean {
  const match = world.match;
  const lineup = match.lineups[side];
  if (match.substitutions[side] >= changesAllowed(world.env.substitutionsAllowed)) return false;

  const slotIndex = lineup.starting.findIndex((slot) => slot.playerId === outgoingId);
  const benchIndex = lineup.bench.findIndex((slot) => slot.playerId === incomingId);
  if (slotIndex < 0 || benchIndex < 0) return false;

  const node = state.players.find((player) => player.playerId === outgoingId && player.side === side);
  if (!node) return false;
  // A sent-off man cannot be replaced: he is off, and his side plays a man short.
  if (node.sentOff) return false;

  const incomingPlayer = world.env.getPlayer(incomingId);
  if (!incomingPlayer) return false;

  const outgoingPlayer = world.env.getPlayer(outgoingId);
  const slot = lineup.starting[slotIndex]!;

  const outgoingPerformance = match.performances[outgoingId];
  if (outgoingPerformance) outgoingPerformance.wentOffMinute = match.minute;

  lineup.bench.splice(benchIndex, 1);
  lineup.starting[slotIndex] = {
    playerId: incomingId,
    position: slot.position,
    role: defaultRoleFor(slot.position),
    outOfPosition: (incomingPlayer.positionalFamiliarity[slot.position] ?? 0) < 12,
  };
  match.performances[incomingId] = newPerformance(
    incomingId,
    incomingPlayer,
    lineup.clubId,
    slot.position,
    match.minute,
  );

  // Swap the node in place, keeping the slot and the role the man came into.
  const replacement = makePlayerForSlot(
    match,
    world.env,
    side,
    slotIndex,
    incomingId,
    slot.position,
    lineup.starting[slotIndex]!.role,
  );
  replacement.x = node.x;
  replacement.y = node.y;
  replacement.px = node.px;
  replacement.py = node.py;
  replacement.tx = node.tx;
  replacement.ty = node.ty;
  const index = state.players.indexOf(node);
  if (index >= 0) state.players[index] = replacement;
  else state.players.push(replacement);
  // The men on the pitch have changed, so the derived lookups are stale.
  invalidateIndex(state);

  match.substitutions[side] += 1;

  const incomingName = `${incomingPlayer.firstName.charAt(0)}. ${incomingPlayer.surname}`;
  const outgoingName = outgoingPlayer ? `${outgoingPlayer.firstName.charAt(0)}. ${outgoingPlayer.surname}` : 'a teammate';
  emitEvent(state, match, {
    type: 'substitution',
    side,
    playerId: incomingId,
    secondaryPlayerId: outgoingId,
    text: `${incomingName} replaces ${outgoingName}.`,
    x: 0.5,
    y: 0.5,
    importance: 2,
  });

  return true;
}

/**
 * Bring a side's shape back into line with the formation it is now set to play.
 *
 * A manager can change shape at any point; the engine reads the lineup's
 * formation each time this is called and moves every starter's slot anchor, so
 * the decision model immediately plays the new shape. The men walk to their new
 * positions under the ordinary movement rules — nothing teleports.
 */
export function refreshFormation(state: MatchEngineState, match: Match, side: Side): void {
  const formation = match.lineups[side].formation;
  // The manager's own shape, when he has moved anybody: re-reading the name
  // alone would drag a side he had just rearranged back to its 4-4-2.
  const shape = match.lineups[side].tactics.shape;
  const starting = match.lineups[side].starting;
  for (const player of state.players) {
    if (player.side !== side || player.sentOff) continue;
    const slotIndex = starting.findIndex((slot) => slot.playerId === player.playerId);
    if (slotIndex < 0) continue;
    const base = formationBase(side, formation, slotIndex, shape);
    player.slotIndex = slotIndex;
    player.baseX = base.x;
    player.baseY = base.y;
    // His anchor moved, so the geometry derived from it must move with it.
    refreshSlotGeometry(player);
  }
}

/**
 * The best man on the bench for a slot: familiar with the job, and fresh.
 *
 * Returns null when there is nobody to bring on — or nobody who can do the job
 * the outgoing man was doing.
 */
function bestBenchId(world: DecisionWorld, side: Side, outgoingId: string): string | null {
  const slot = world.match.lineups[side].starting.find((entry) => entry.playerId === outgoingId);
  if (!slot) return null;
  const ranked = world.match.lineups[side].bench
    .map((bench) => {
      const player = world.env.getPlayer(bench.playerId);
      if (!player) return { id: bench.playerId, score: -1 };
      const familiarity = player.positionalFamiliarity[slot.position] ?? 0;
      const suitability = familiarity / 20 + (player.preferredPosition === slot.position ? 1 : 0);
      return { id: bench.playerId, score: suitability * 2 + player.fitness / 100 };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.id ?? null;
}

/**
 * The AI's bench, for a side nobody is managing.
 *
 * Two things bring a man off. An injury is answered first and without a roll: a
 * man who cannot run it off comes off, whatever the minute, as soon as somebody
 * is ready to take his place. Only once nobody is hurt does it look at tired
 * legs, and only after the hour — and then it is only a chance, because a Sunday
 * side often just lets a tiring player get on with it.
 */
export function autoManageBench(
  state: MatchEngineState,
  world: DecisionWorld,
  side: Side,
  rng: Rng,
): void {
  const env = world.env;
  const match = world.match;
  const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
  // The human manages his own bench unless the match is being run out for him.
  if (env.userClubId === clubId && !env.autoManageAllBenches) return;
  if (match.lineups[side].bench.length === 0) return;
  if (match.substitutions[side] >= changesAllowed(env.substitutionsAllowed)) return;

  // An injured man is answered first: he cannot run it off, so he comes off.
  const injured = state.players.find(
    (player) =>
      player.side === side &&
      !player.sentOff &&
      Boolean(match.performances[player.playerId]?.injuryDetail),
  );
  if (injured && match.minute > 2) {
    const replacement = bestBenchId(world, side, injured.playerId);
    if (replacement && substitute(state, world, side, injured.playerId, replacement)) return;
  }

  if (match.minute < TIRED_MINUTE) return;

  const tired = state.players
    .filter((player) => player.side === side && !player.sentOff && player.position !== 'GK')
    .sort((a, b) => a.stamina - b.stamina)[0];
  if (!tired || tired.stamina > TIRED_STAMINA) return;
  if (!rng.chance(0.3)) return;

  const chosen = bestBenchId(world, side, tired.playerId);
  if (!chosen) return;
  substitute(state, world, side, tired.playerId, chosen);
}

/**
 * Manage both benches on the slow cadence the engine already uses for tactics.
 *
 * Called from the step loop, throttled by the caller, so a bench decision is
 * made a few times a minute rather than thirty times a second. Returns true when
 * the review was due and ran.
 */
export function reviewBenches(
  state: MatchEngineState,
  world: DecisionWorld,
  rng: Rng,
  secondsSinceReview: number,
): boolean {
  if (secondsSinceReview < BENCH_REVIEW_SECONDS) return false;
  for (const side of ['home', 'away'] as const) {
    autoManageBench(state, world, side, rng);
  }
  return true;
}

/** The man the caller believes is on the pitch, for a management action. */
export function onPitch(state: MatchEngineState, side: Side, playerId: string): PlayerMatchState | undefined {
  return state.players.find((player) => player.side === side && player.playerId === playerId);
}
