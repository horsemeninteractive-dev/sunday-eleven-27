import type { Match, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';
import { FORMATIONS, formationSlots, type FormationId, type FormationSlot } from '@/domain/positions';
import type { MatchEnvironment } from '../core';
import { sideClubId } from '../core';
import { defaultRoleFor, roleProfile, type Role } from '../roles';
import { lineSlotFor, progressOf } from '../field';
import type { BallNode, EngineIndex, MatchEngineState, PlayerMatchState, Side } from './types';
import { emptyStats } from './types';

/**
 * Building the engine's state from a fixture.
 *
 * A football match starts with eleven men in a shape and the ball on the centre
 * spot. Everything the engine needs to know about who they are — their role,
 * their pace, their stamina, whether they can kick with the foot they have — is
 * read from the player and the lineup here, once, and then carried on the state
 * so the football never has to go looking for it.
 */

export const SIDES: Side[] = ['home', 'away'];

/**
 * A player's top speed, in pitch-lengths per simulation second.
 *
 * A Sunday League pitch is around a hundred yards. An ordinary player covers a
 * length of it in about twelve seconds at a jog and four at a sprint; the range
 * here is deliberately narrow, because the difference between the quickest and
 * the slowest man on a Sunday morning is real but not enormous, and a pitch on
 * which one player simply cannot be caught is not a football match.
 */
export function topSpeedFor(player: Player): number {
  const pace = Math.max(1, Math.min(20, player.attributes.physical.pace));
  return 0.03 + (pace / 20) * 0.055;
}

/** The base position of a formation slot, in the engine's fixed frame. */
function slotBase(side: Side, x: number, y: number): { x: number; y: number } {
  return side === 'home' ? { x, y } : { x: 1 - x, y: 1 - y };
}

/** How much a role's depth nudge moves a slot, per unit of bias. */
const ROLE_DEPTH_SCALE = 0.6;
/** How much a role's width nudge moves a slot, per unit of bias. */
const ROLE_WIDTH_SCALE = 0.14;

/**
 * A player's fixed place in the shape.
 *
 * The line his slot belongs to and his role's offsets do not depend on the ball,
 * the score or the clock — only on the formation, his role and his side — so
 * they are worked out once, when he takes the field, and read from then on. The
 * live `shapeTargetFor` adds the moving parts (the current line heights, the
 * current width, the lean toward the ball) to these fixed ones.
 */
function slotGeometry(
  side: Side,
  baseX: number,
  baseY: number,
  role: Role,
): Pick<PlayerMatchState, 'slotLine' | 'slotDepthOffset' | 'slotLateral'> {
  const profile = roleProfile(role);
  const { line, offset } = lineSlotFor(progressOf(side, baseX));
  const facing = side === 'home' ? 1 : -1;
  // Depth is forward/back, which flips with the side; width is left/right, which
  // does not. A wide role widens a man toward *his own* touchline, home or away,
  // so the sign is the flank's, not the team's. Signing it by `facing` pushed
  // every wide role the same way — a left back drifted toward the middle while a
  // right back went wider, and the away side mirrored the same lopsided shape.
  const lateralSign = Math.sign(baseY - 0.5);
  return {
    slotLine: line,
    slotDepthOffset: offset + facing * profile.depthBias * ROLE_DEPTH_SCALE,
    slotLateral: baseY - 0.5 + lateralSign * profile.widthBias * ROLE_WIDTH_SCALE,
  };
}

/** A player, laid out in his formation slot, ready to play. */
function createPlayer(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  slotIndex: number,
  playerId: string,
  position: Match['lineups']['home']['starting'][number]['position'],
  role: Match['lineups']['home']['starting'][number]['role'],
): PlayerMatchState {
  // The shape the manager set, not the name he set it from: a side whose dots
  // have been moved is laid out where he put them.
  const slot = formationSlots(match.lineups[side].formation, match.lineups[side].tactics.shape)[slotIndex] ?? { x: 0.5, y: 0.5 };
  const base = slotBase(side, slot.x, slot.y);
  const person = env.getPlayer(playerId);
  const speed = person ? topSpeedFor(person) : 0.05;
  const stamina = match.performances[playerId]?.energy ?? person?.fitness ?? 100;
  const resolvedRole = role ?? defaultRoleFor(position);
  const profile = roleProfile(resolvedRole);
  const geometry = slotGeometry(side, base.x, base.y, resolvedRole);
  return {
    playerId,
    side,
    position,
    role: resolvedRole,
    ...geometry,
    pressBehaviour: profile.pressBehaviour,
    runsInBehind: profile.runsInBehind,
    baseX: base.x,
    baseY: base.y,
    x: base.x,
    y: base.y,
    px: base.x,
    py: base.y,
    tx: base.x,
    ty: base.y,
    speed,
    action: 'shape',
    vx: 0,
    vy: 0,
    actionKind: null,
    actionStartedAt: null,
    actionEndsAt: null,
    possession: false,
    slotIndex,
    baseSpeed: speed,
    stamina,
    booked: false,
    sentOff: false,
    intent: 'hold',
    committedUntil: 0,
    performance: match.performances[playerId],
  };
}

/**
 * Recompute a player's fixed shape geometry after his slot anchor moved.
 *
 * Called when a formation change shifts his base position: the slot he belongs
 * to and the offsets his role gives him are fixed, but they are fixed *to his
 * anchor*, and the anchor has just changed.
 */
export function refreshSlotGeometry(player: PlayerMatchState): void {
  const geometry = slotGeometry(player.side, player.baseX, player.baseY, player.role ?? defaultRoleFor(player.position));
  player.slotLine = geometry.slotLine;
  player.slotDepthOffset = geometry.slotDepthOffset;
  player.slotLateral = geometry.slotLateral;
}

/**
 * A replacement player, built for a slot.
 *
 * Used when a substitute comes on: he inherits the slot, the position and the
 * role of the man he replaces, so the shape and the decision model treat him as
 * the same job and nothing else in the engine has to know a change happened.
 */
export function makePlayerForSlot(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  slotIndex: number,
  playerId: string,
  position: Match['lineups']['home']['starting'][number]['position'],
  role: Match['lineups']['home']['starting'][number]['role'],
): PlayerMatchState {
  return createPlayer(match, env, side, slotIndex, playerId, position, role);
}

/** The formation base of a slot, in the engine's fixed frame. */
export function formationBase(
  side: Side,
  formation: string,
  slotIndex: number,
  shape?: readonly FormationSlot[],
): { x: number; y: number } {
  const slots = formationSlots(formation, shape);
  const slot = slots[slotIndex] ?? { x: 0.5, y: 0.5 };
  return slotBase(side, slot.x, slot.y);
}

/** A fresh ball, dead on the centre spot, waiting for the kick-off. */
function createBall(): BallNode {
  return {
    x: 0.5,
    y: 0.5,
    px: 0.5,
    py: 0.5,
    status: 'loose',
    ownerId: null,
    targetId: null,
    tx: 0.5,
    ty: 0.5,
    speed: 0,
    height: 0,
    touchedAt: 0,
    lastTouchId: null,
    vx: 0,
    vy: 0,
    vz: 0,
    intendedSide: null,
    kind: null,
    shotOutcome: null,
    offsidePlayerId: null,
    penaltyShot: false,
    attempted: [],
  };
}

/**
 * The authoritative state for a fixture that has not kicked off yet.
 *
 * Both sides are arranged in their formation, at their slots, and the ball sits
 * on the centre spot. The caller starts the football by beginning a kick-off.
 */
export function createEngineState(match: Match, env: MatchEnvironment): MatchEngineState {
  const players: PlayerMatchState[] = [];
  for (const side of SIDES) {
    const lineup = match.lineups[side];
    lineup.starting.forEach((slot, index) => {
      players.push(createPlayer(match, env, side, index, slot.playerId, slot.position, slot.role));
    });
  }

  return {
    matchId: match.id,
    seed: match.seed,
    clock: 0,
    stepSeconds: 1 / 30,
    residual: 0,
    nextOffBallDecision: 0,
    period: 'first-half',
    phase: 'kickoff',
    phaseElapsed: 0,
    stoppedSeconds: { first: 0, second: 0 },
    score: { home: 0, away: 0 },
    concedingSide: null,
    celebration: null,
    possession: null,
    lastPass: null,
    players,
    ball: createBall(),
    actions: [],
    setPiece: null,
    stats: { home: emptyStats(), away: emptyStats() },
    pendingEvents: [],
    finished: false,
    setPiecesEnabled: true,
  };
}

/**
 * The match's record of what each player did.
 *
 * The engine writes into these as the football happens, so the statistics and
 * the ratings are a reading of the match rather than a second account of it. A
 * caller that has already built them (a replayed save, say) keeps what it had.
 */
export function ensurePerformances(match: Match, env: MatchEnvironment): void {
  const make = (playerId: string, clubId: string, position: PositionCode, started: boolean, cameOnMinute: number | null): PlayerPerformance => ({
    playerId,
    clubId,
    started,
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
    cameOnMinute,
    wentOffMinute: null,
    energy: env.getPlayer(playerId)?.fitness ?? 100,
    injuryDetail: null,
    sentOff: false,
  });

  for (const side of SIDES) {
    const clubId = sideClubId(match, side);
    for (const slot of match.lineups[side].starting) {
      if (!match.performances[slot.playerId]) match.performances[slot.playerId] = make(slot.playerId, clubId, slot.position, true, null);
    }
    for (const bench of match.lineups[side].bench) {
      if (!match.performances[bench.playerId]) match.performances[bench.playerId] = make(bench.playerId, clubId, bench.position, false, null);
    }
  }
}

/**
 * The derived lookups for the current pitch, rebuilding them if stale.
 *
 * Rebuilt lazily rather than eagerly: a substitution or a sending off marks the
 * index dirty, and the next question pays for it. Reading it in between is a Map
 * lookup and two array reads, which is the whole point.
 */
export function ensureIndex(state: MatchEngineState): EngineIndex {
  const existing = state.index;
  if (existing && !existing.dirty) return existing;
  const byId = existing?.byId ?? new Map<string, PlayerMatchState>();
  byId.clear();
  const active: Record<Side, PlayerMatchState[]> = { home: [], away: [] };
  const keepers: Record<Side, PlayerMatchState | undefined> = { home: undefined, away: undefined };
  for (const player of state.players) {
    byId.set(player.playerId, player);
    if (player.sentOff) continue;
    active[player.side].push(player);
    if (player.position === 'GK' && !keepers[player.side]) keepers[player.side] = player;
  }
  const index: EngineIndex = { byId, active, keepers, dirty: false };
  state.index = index;
  return index;
}

/** Note that the pitch has changed, so the derived lookups must be rebuilt. */
export function invalidateIndex(state: MatchEngineState): void {
  if (state.index) state.index.dirty = true;
}

/** A player on the pitch, by id. */
export function playerOf(state: MatchEngineState, playerId: string | null | undefined): PlayerMatchState | undefined {
  if (!playerId) return undefined;
  return ensureIndex(state).byId.get(playerId);
}

/** The players of a side who are still on the pitch. */
export function activePlayers(state: MatchEngineState, side: Side): PlayerMatchState[] {
  return ensureIndex(state).active[side];
}

/** The goalkeeper of a side. */
export function keeperOf(state: MatchEngineState, side: Side): PlayerMatchState | undefined {
  return ensureIndex(state).keepers[side];
}

/** Every formation slot 0..10 is on the pitch; a safety valve for empty lineups. */
export function formationSlotCount(formation: string): number {
  return (FORMATIONS[formation as FormationId] ?? FORMATIONS['4-4-2']).slots.length;
}
