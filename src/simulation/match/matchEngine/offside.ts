import type { DecisionWorld } from './decisions';
import { emitEvent, statsFor } from './events';
import { progressOf } from './pitch';
import { beginSetPiece } from './setPieces';
import { otherSide } from '../core';
import type { MatchEngineState, PlayerMatchState, Side } from './types';

/**
 * The offside law, decided at the moment the ball is played.
 *
 * Offside is not "ahead of the last man". It is a position *and* an involvement:
 * a player is offside if, at the instant a teammate plays the ball, he is in the
 * opponents' half, ahead of the ball, and with fewer than two opponents between
 * him and the goal — and then becomes involved by playing the ball. This module
 * answers the first half of that at the pass, marks the ball with the man it
 * concerns, and raises the offence when he actually takes it. Nothing is flagged
 * for merely standing upfield, which is exactly the mistake the law exists to
 * avoid.
 */

/**
 * Whether a player is in an offside position at this instant.
 *
 * Three conditions, all of them required: he is in the opponents' half, he is
 * ahead of the ball, and fewer than two opponents are goal-side of him. The
 * second-last opponent is the usual reading of the third; counting the opponents
 * who are ahead of him is the same thing and does not care who is the keeper.
 */
export function inOffsidePosition(state: MatchEngineState, side: Side, player: PlayerMatchState): boolean {
  // His own half can never be offside, however far upfield he wandered.
  if (progressOf(side, player.x) <= 0.5) return false;
  // Behind or level with the ball is onside.
  if (progressOf(side, player.x) <= progressOf(side, state.ball.x)) return false;
  // Fewer than two opponents between him and the goal: offside.
  let goalSide = 0;
  for (const other of state.players) {
    if (other.sentOff || other.side === side) continue;
    if (progressOf(side, other.x) > progressOf(side, player.x)) goalSide += 1;
    if (goalSide >= 2) return false;
  }
  return true;
}

/**
 * Raise the offence: an authoritative offside event and the free kick to the
 * defenders that restarts the game where the attacker strayed.
 *
 * The move is cut dead here — the ball is taken off the offender and set down
 * for the other side — so the attacking sequence cannot carry on as if nothing
 * had happened. The event names the man who was offside, which is what makes the
 * banner and the record say the same thing.
 */
export function raiseOffside(state: MatchEngineState, world: DecisionWorld, player: PlayerMatchState): void {
  const defending = otherSide(player.side);
  statsFor(state, player.side).offsides += 1;
  emitEvent(state, world.match, {
    type: 'offside',
    side: player.side,
    playerId: player.playerId,
    text: 'Offside.',
    x: player.x,
    y: player.y,
    importance: 2,
  });
  beginSetPiece(state, 'free-kick', defending, { x: player.x, y: player.y });
}
