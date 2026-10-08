import type { Match, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';
import type { Rng } from '../../rng';
// How many changes a side is allowed is a law of the game, shared with the
// background resolution, which used to cap the same allowance with a constant.
import { changesAllowed } from '../laws';
import { defaultRoleFor, type Role } from '../roles';
import { otherSide } from '../core';
import { familiarityFor } from '../teamStrength';
import { roleFitScore } from '../../selection';
import {
  attackingWeightOf,
  matchReaction,
  pickBenchMan,
  pickOutgoing,
  type BenchCandidate,
  type MatchSituation,
  type PlayerCondition,
  type Reaction,
} from '../../ai/manager';
import { clubStyle as styleForClub, type ClubStyle } from '../../ai/style';
import type { ClubId } from '@/domain/ids';
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
/**
 * The chance a change made only to freshen the side up is actually made.
 *
 * Sunday sides are reluctant, and that is part of the football. A manager does
 * not make his last change the moment a winger's legs go; he makes it when he
 * has to. Chasing a game and protecting a lead are decisions and are never
 * rolled for — only the ordinary business of giving a tired man fresh legs is.
 */
const REFRESH_CHANCE = 0.45;

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

/** Own quality against the opposition's, from the strength both sides already have. */
function strengthRatioFor(world: DecisionWorld, side: Side): number {
  const own = world.context[side].strength;
  const other = world.context[otherSide(side)].strength;
  const mine = (own.attack + own.defence + own.control) / 3;
  const theirs = (other.attack + other.defence + other.control) / 3;
  return mine / Math.max(0.05, theirs);
}

/** How many more men the opposition has on the pitch than this side does. */
function menDown(state: MatchEngineState, side: Side): number {
  const off = (which: Side) => state.players.filter((player) => player.side === which && player.sentOff).length;
  return Math.max(0, off(side) - off(otherSide(side)));
}

/**
 * The football a club plays.
 *
 * The world can always answer this. A caller that built its own environment —
 * a test, a friendly — cannot, and gets the club's own instructions read as its
 * identity instead, which is the same answer for every club the world generated.
 */
function styleOf(world: DecisionWorld, side: Side, clubId: ClubId): ClubStyle {
  return (
    world.env.clubStyle?.(clubId) ??
    styleForClub({ id: clubId, reputation: 50, tactics: world.match.lineups[side].tactics })
  );
}

/** Everything the manager can see from the touchline, in the AI layer's terms. */
function situationFor(state: MatchEngineState, world: DecisionWorld, side: Side): MatchSituation {
  const env = world.env;
  const match = world.match;
  const score = state.score;
  return {
    minute: match.minute,
    scoreFor: side === 'home' ? score.home : score.away,
    scoreAgainst: side === 'home' ? score.away : score.home,
    strengthRatio: strengthRatioFor(world, side),
    menDown: menDown(state, side),
    changesLeft: Math.max(0, changesAllowed(env.substitutionsAllowed) - match.substitutions[side]),
    benchSize: match.lineups[side].bench.length,
    home: side === 'home',
  };
}

/**
 * Read the afternoon and send the instructions on.
 *
 * This is the one place a match-state decision reaches the engine's lineup, and
 * it is deliberately the *tactics* it changes and nothing else: the engine
 * already recomputes what a side is worth from its instructions every minute, so
 * a side told to sit deeper plays deeper from the next step rather than from the
 * next kick-off. The shape on the pitch follows the same instructions, because
 * the block the engine plays is read from the tactics too.
 */
function applyReaction(state: MatchEngineState, world: DecisionWorld, side: Side, clubId: ClubId): Reaction {
  const match = world.match;
  const reaction = matchReaction(styleOf(world, side, clubId), situationFor(state, world, side), match.lineups[side].tactics);
  // The human's instructions are his own. He may have handed the afternoon over
  // — an instant result, the whole-week shortcut — and then the bench is managed
  // for him, but nobody rewrites his plan on his behalf.
  if (world.env.userClubId === clubId) return reaction;
  if (Object.keys(reaction.tactics).length === 0) return reaction;
  match.lineups[side].tactics = { ...match.lineups[side].tactics, ...reaction.tactics };
  // The change belongs in the record: it is the reason everything that happens
  // next looks different, and a side that has just dropped deep should be able
  // to say so on the way past.
  if (reaction.reason) {
    emitEvent(state, match, {
      type: 'note',
      side,
      text: `${world.env.clubShortName(clubId)} ${reaction.reason}.`,
      x: 0.5,
      y: 0.5,
      importance: 1,
    });
  }
  return reaction;
}

/** The men on the pitch, as a manager reads them from the touchline. */
function playerConditionsFor(state: MatchEngineState, world: DecisionWorld, side: Side): PlayerCondition[] {
  return state.players
    .filter((player) => player.side === side && !player.sentOff)
    .map((player) => {
      const performance = world.match.performances[player.playerId];
      return {
        playerId: player.playerId,
        position: player.position,
        energy: player.stamina,
        rating: performance?.rating ?? 6,
        booked: player.booked,
        attacking: attackingWeightOf(player.position),
        injured: Boolean(performance?.injuryDetail),
      };
    });
}

/** The bench, as candidates for one particular job on the pitch. */
function benchCandidatesFor(world: DecisionWorld, side: Side, slot: { position: PositionCode; role: Role }): BenchCandidate[] {
  return world.match.lineups[side].bench.map((bench) => {
    const player = world.env.getPlayer(bench.playerId);
    return {
      playerId: bench.playerId,
      position: bench.position,
      familiarity: player ? familiarityFor(player, slot.position) : 0,
      energy: player ? (world.match.performances[bench.playerId]?.energy ?? player.fitness) : 60,
      attacking: attackingWeightOf(bench.position),
      fit: player ? roleFitScore(player, slot.position, slot.role) : 0,
    };
  });
}

/**
 * The AI's afternoon, for a side nobody is managing.
 *
 * Four things happen here, in the order a manager would do them. He reads the
 * game and changes his instructions if the afternoon has turned. Somebody hurt
 * comes off, whatever the minute and without a roll. Somebody out of legs, out of
 * the game on his rating, or in a job the new plan no longer wants comes off —
 * and then only when the manager has a reason and a man who can do the job. And
 * the change he makes is the right *kind* of change: chasing a game is a forward,
 * protecting one is a defender, and a side that is merely tired gets the best
 * like-for-like man on the bench.
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

  // The manager reads the afternoon before he changes who is playing in it.
  const reaction = applyReaction(state, world, side, clubId);
  const conditions = playerConditionsFor(state, world, side);
  const outgoingSlot = (playerId: string) => match.lineups[side].starting.find((entry) => entry.playerId === playerId);

  // An injured man is answered first: he cannot run it off, so he comes off.
  const hurt = conditions.find((player) => player.injured);
  if (hurt && match.minute > 2) {
    const slot = outgoingSlot(hurt.playerId);
    if (slot) {
      const replacement = pickBenchMan('refresh', { position: slot.position, role: slot.role }, benchCandidatesFor(world, side, slot));
      if (replacement && substitute(state, world, side, hurt.playerId, replacement)) return;
    }
  }

  const intent = reaction.benchIntent;
  if (intent === 'none') return;
  // A change made only to freshen the side up is a chance, not a certainty.
  if (intent === 'refresh' && !rng.chance(REFRESH_CHANCE)) return;

  const outgoingId = pickOutgoing(intent, conditions, match.minute);
  if (!outgoingId) return;
  const slot = outgoingSlot(outgoingId);
  if (!slot) return;
  const incomingId = pickBenchMan(intent, { position: slot.position, role: slot.role }, benchCandidatesFor(world, side, slot));
  if (!incomingId) return;
  substitute(state, world, side, outgoingId, incomingId);
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
