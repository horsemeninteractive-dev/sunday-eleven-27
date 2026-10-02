import type { PlayerId } from '@/domain/ids';
import type { Match, MatchEvent } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { Rng } from '../rng';
import * as C from './commentary';
import {
  eventCoords,
  makeEvent,
  otherSide,
  performanceOf,
  pushEvent,
  textContext,
  type MatchContext,
  type MatchEnvironment,
  type Side,
} from './core';
import { playerEffectiveness, positionRoleWeights } from './teamStrength';

/**
 * Fouls and cards.
 *
 * A foul is not a separate incident that happens alongside the football — it is
 * what happens when a tackle fails. The possession engine asks for one at the
 * moment a defender goes in and does not win the ball, which means fouls now
 * arrive in the games where they belong: a side under pressure in its own third
 * gives them away, and a side that never has the ball cannot foul as much.
 *
 * That also gives the referee something real to judge. The consequence of the
 * foul — a free kick, a penalty, a card — is decided here, from where it happened
 * and who did it, rather than by a per-minute card roll.
 */

export interface FoulResult {
  offenderId: PlayerId;
  victimId: PlayerId | null;
  /** True when it happened in the offender's own penalty area. */
  penalty: boolean;
  /** True when the offender was sent off for it. */
  sentOff: boolean;
}

/** The defender who went into the challenge. */
export function chooseAggressor(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  rng: Rng,
  preferId?: PlayerId | null,
): Player | null {
  const preferred = preferId ? env.getPlayer(preferId) : undefined;
  if (preferred) return preferred;
  const entries = match.lineups[side].starting.map((slot) => {
    const player = env.getPlayer(slot.playerId);
    if (!player) return null;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
    const weight = Math.max(
      0.0001,
      positionRoleWeights(slot.position).def * Math.pow(Math.max(1, eff.effective.aggression), 2),
    );
    return { value: player, weight };
  });
  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

/** The man who was fouled. */
export function chooseVictim(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  rng: Rng,
  preferId?: PlayerId | null,
): Player | null {
  const preferred = preferId ? env.getPlayer(preferId) : undefined;
  if (preferred) return preferred;
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
      const weight = Math.max(0.0001, positionRoleWeights(slot.position).att + 0.4 + eff.effective.pace / 60);
      return { value: player, weight };
    });
  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

/**
 * Did the referee produce a card?
 *
 * A booking is more likely from an offender with poor discipline, in a game the
 * referee is running tightly, on a pitch that produces late tackles, and for a
 * side whose instructions have them flying in. A second booking is a sending
 * off; the straight red remains rare, and rarer still for a disciplined player.
 */
export function judgeChallenge(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  offender: Player,
  rng: Rng,
  sink: MatchEvent[],
  coords: { x: number; y: number },
): { carded: boolean; sentOff: boolean } {
  const performance = performanceOf(match, offender.id);
  if (!performance) return { carded: false, sentOff: false };

  const discipline = offender.attributes.behavioural.discipline;
  const strictness = env.refereeStrictness;
  const cardRate = context[side].profile.cardRate;
  // Roughly one foul in ten becomes a booking for an ordinary player, which is
  // what puts a Sunday League match at two or three cards rather than five.
  const baseCardChance = 0.105 * (1 + (12 - discipline) / 12) * cardRate * (strictness / 11);
  const roll = rng.next();

  if (roll < baseCardChance) {
    performance.yellowCards += 1;
    if (performance.yellowCards >= 2) {
      sendOff(match, env, side, offender, sink, rng, 'second-yellow');
      return { carded: true, sentOff: true };
    }
    pushEvent(
      match,
      makeEvent(match, 'yellow-card', {
        minute: match.minute,
        side,
        playerId: offender.id,
        text: C.writeYellow(textContext(env, match, side, rng, { player: offender })),
        x: coords.x,
        y: coords.y,
        importance: 2,
      }),
      sink,
    );
    return { carded: true, sentOff: false };
  }

  if (roll < baseCardChance + 0.0022 * (1 + (14 - discipline) / 8) * cardRate) {
    sendOff(match, env, side, offender, sink, rng, 'straight-red');
    return { carded: true, sentOff: true };
  }

  return { carded: false, sentOff: false };
}

/** Off he goes. The pitch and the bench are synced by the engine afterwards. */
export function sendOff(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  player: Player,
  sink: MatchEvent[],
  rng: Rng,
  kind: 'second-yellow' | 'straight-red',
): void {
  const performance = performanceOf(match, player.id);
  if (!performance || performance.sentOff) return;
  if (kind === 'straight-red') performance.redCards += 1;
  performance.sentOff = true;
  performance.wentOffMinute = match.minute;

  match.lineups[side].starting = match.lineups[side].starting.filter((slot) => slot.playerId !== player.id);

  const ctx = textContext(env, match, side, rng, { player });
  const text = kind === 'second-yellow' ? C.writeSecondYellow(ctx) : C.writeRed(ctx);
  pushEvent(
    match,
    makeEvent(match, 'red-card', { minute: match.minute, side, playerId: player.id, text, x: 0.5, y: 0.5, importance: 3 }),
    sink,
  );
}

/**
 * A failed challenge, written down.
 *
 * Returns what the referee gave, so the caller can set up the restart: a free
 * kick from where it happened, or a penalty if it was in the box.
 */
export function commitFoul(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  offenderSide: Side,
  offenderId: PlayerId | null,
  victimId: PlayerId | null,
  inBox: boolean,
  rng: Rng,
  sink: MatchEvent[],
): FoulResult | null {
  const offender = chooseAggressor(match, env, offenderSide, rng, offenderId);
  if (!offender) return null;
  const victimSide = otherSide(offenderSide);
  const victim = chooseVictim(match, env, victimSide, rng, victimId);

  const offenderPerf = performanceOf(match, offender.id);
  if (offenderPerf) offenderPerf.fouls += 1;

  const coords = eventCoords(match, inBox ? (offenderSide === 'home' ? 0.06 : 0.94) : match.field?.ball.x ?? 0.5, match.field?.ball.y ?? 0.5);
  pushEvent(
    match,
    makeEvent(match, 'foul', {
      minute: match.minute,
      side: offenderSide,
      playerId: offender.id,
      secondaryPlayerId: victim?.id ?? null,
      text: C.writeFoul(textContext(env, match, offenderSide, rng, { player: offender, partner: victim })),
      x: coords.x,
      y: coords.y,
      importance: 1,
    }),
    sink,
  );

  const judged = judgeChallenge(match, env, context, offenderSide, offender, rng, sink, coords);
  return { offenderId: offender.id, victimId: victim?.id ?? null, penalty: inBox, sentOff: judged.sentOff };
}
