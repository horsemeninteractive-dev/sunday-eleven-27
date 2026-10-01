import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import { clampSystemFamiliarity, isPlayer, type SystemFamiliarity, type Player } from '@/domain/person';
import { TRAINING_BLOCKS, tacticsSignature, type TrainingBlockId } from '@/domain/training';
import { stream } from '../rng';
import { relationshipViewsFor } from '../relationships';
import { weeksSince } from './store';

/**
 * What training leaves behind in the squad *as a group*: how well the side
 * knows its own way of playing, and how settled it is.
 *
 * Both are **derived**. Familiarity per player is stored on the player (it is
 * his knowledge of this club's system); cohesion is worked out from the squad
 * every time it is asked for, so there is nothing to keep in step and nothing
 * that can silently drift out of date.
 */

/** Neutral value: what an ordinary squad in a fresh world sits at. */
export const NEUTRAL_FAMILIARITY = 0.5;
export const NEUTRAL_COHESION = 0.5;

/** How much of the week's knowledge is forgotten if nobody trains. */
const WEEKLY_RUST = 0.06;
/** Extra rust for a player who did not turn up at all. */
const ABSENT_RUST = 0.22;

/**
 * Clamped to the 0-1 scale the engine reads. Anything unreadable falls back to
 * neutral rather than poisoning a whole match with a NaN.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL_FAMILIARITY;
  return Math.max(0, Math.min(1, value));
}

/**
 * The squad's knowledge of the shape and the instructions, on a 0-1 scale where
 * 0.5 is "an ordinary Sunday League side". Set pieces are counted separately
 * because a team can be drilled at corners without knowing the shape.
 */
export function clubSystemFamiliarity(state: GameState, clubId: ClubId): number {
  const squad = squadOf(state, clubId);
  if (squad.length === 0) return NEUTRAL_FAMILIARITY;
  const mean =
    squad.reduce((sum, player) => {
      const f = player.systemFamiliarity;
      return sum + (f ? (f.formation + f.instructions) / 2 : 10);
    }, 0) / squad.length;
  return clamp01(mean / 20);
}

export function clubSetPieceFamiliarity(state: GameState, clubId: ClubId): number {
  const squad = squadOf(state, clubId);
  if (squad.length === 0) return NEUTRAL_FAMILIARITY;
  const mean = squad.reduce((sum, player) => sum + (player.systemFamiliarity?.setPieces ?? 10), 0) / squad.length;
  return clamp01(mean / 20);
}

/**
 * Team cohesion: how settled this group is with each other. It comes from the
 * relationships in the dressing room, how long they have been together, how
 * much they have trained, and whether they turn up when they say they will.
 * The match engine takes it as one small input; it never outweighs ability.
 */
export function clubCohesionValue(state: GameState, clubId: ClubId): number {
  // Cohesion is read by the match engine, so it always returns a usable number.
  return safeCohesion(state, clubId);
}

function safeCohesion(state: GameState, clubId: ClubId): number {
  const squad = squadOf(state, clubId);
  if (squad.length === 0) return NEUTRAL_COHESION;

  const familiarity = clubSystemFamiliarity(state, clubId);
  const familiarityComponent = (familiarity - NEUTRAL_FAMILIARITY) * 0.16;

  // How close the group actually is, averaged over the dressing room.
  const squadIds = new Set(squad.map((player) => player.id));
  let closenessTotal = 0;
  let closenessCount = 0;
  for (const player of squad) {
    for (const view of relationshipViewsFor(state, player.id)) {
      if (!squadIds.has(view.otherId)) continue;
      closenessTotal += view.relationship.strength;
      closenessCount += 1;
    }
  }
  // Each pair is counted from both ends, which is harmless for a mean.
  const closeness = closenessCount > 0 ? closenessTotal / closenessCount : 45;
  const closenessComponent = ((closeness - 45) / 55) * 0.18;

  // Tenure: a squad that has been together for months holds together better.
  const meanWeeks = squad.reduce((sum, player) => sum + weeksSince(player.joinedClubOn, state.date), 0) / squad.length;
  const tenure = Math.min(1, meanWeeks / 26);
  const tenureComponent = (tenure - 0.5) * 0.14;

  // Attendance: from the sessions actually recorded, where there is history.
  const store = state.training as { history?: Array<{ clubId: ClubId; attended: number; cancelled: boolean }> } | undefined;
  const recent = (store?.history ?? []).filter((session) => session.clubId === clubId && !session.cancelled).slice(0, 4);
  let attendanceComponent = 0;
  if (recent.length >= 2 && squad.length > 0) {
    const meanAttendance = recent.reduce((sum, session) => sum + session.attended, 0) / recent.length;
    const ratio = Math.min(1, meanAttendance / squad.length);
    attendanceComponent = (ratio - 0.78) * 0.14;
  }

  return clamp01(
    NEUTRAL_COHESION + familiarityComponent + closenessComponent + tenureComponent + attendanceComponent,
  );
}

/**
 * A week passes: shape and instructions go a little rusty for everyone, and
 * more so for the man who did not turn up. Set-piece work was never learned
 * permanently either, but it holds longer.
 */
export function rustSystemFamiliarity(state: GameState, clubId: ClubId, attendees: Set<string>): void {
  const squad = squadOf(state, clubId);
  for (const player of squad) {
    if (!player.systemFamiliarity) {
      player.systemFamiliarity = { formation: 10, instructions: 10, setPieces: 10 };
    }
    const absent = !attendees.has(player.id);
    const rust = WEEKLY_RUST + (absent ? ABSENT_RUST : 0);
    const familiarity = player.systemFamiliarity;
    familiarity.formation = clampSystemFamiliarity(familiarity.formation - rust);
    familiarity.instructions = clampSystemFamiliarity(familiarity.instructions - rust);
    familiarity.setPieces = clampSystemFamiliarity(familiarity.setPieces - rust * 0.5);
  }
}

/**
 * Changing the way the team plays costs something. The lads who were drilled in
 * the old shape have to learn the new one, and a player's knowledge of the
 * instructions survives a change better than the shape itself.
 */
export function rebaseSystemFamiliarity(state: GameState, clubId: ClubId): boolean {
  const club = state.clubs[clubId];
  if (!club) return false;
  const store = state.training as { systemSignatures?: Record<ClubId, string> } | undefined;
  if (!store) return false;
  if (!store.systemSignatures) store.systemSignatures = {};
  const signature = tacticsSignature(club.tactics);
  const previous = store.systemSignatures[clubId];
  store.systemSignatures[clubId] = signature;
  if (previous === undefined || previous === signature) return false;

  for (const player of squadOf(state, clubId)) {
    if (!player.systemFamiliarity) {
      player.systemFamiliarity = { formation: 10, instructions: 10, setPieces: 10 };
      continue;
    }
    const familiarity = player.systemFamiliarity;
    // A new shape is genuinely unfamiliar; the instructions are half-remembered.
    familiarity.formation = clampSystemFamiliarity(Math.max(4, familiarity.formation * 0.5));
    familiarity.instructions = clampSystemFamiliarity(Math.max(5, familiarity.instructions * 0.7));
  }
  return true;
}

/**
 * Knowledge gained from a session, block by block. A good session with lots of
 * bodies teaches more than a poor one with nine; a player who drifts in late
 * and half-hearted takes less away, and one who finds new things difficult
 * (low adaptability) takes longer.
 */
export function gainSystemFamiliarity(
  state: GameState,
  player: Player,
  blocks: readonly TrainingBlockId[],
  qualityFactor: number,
  minutesFactor: number,
  date: ISODate,
): number {
  if (!player.systemFamiliarity) {
    player.systemFamiliarity = { formation: 10, instructions: 10, setPieces: 10 };
  }
  const rng = stream(state.seed, 'familiarity-gain', player.id, date, blocks.join(','));
  const quality = Math.max(0.25, Math.min(1.35, qualityFactor));
  const adaptability = 0.75 + (player.attributes.hidden.adaptability / 20) * 0.5;
  const reliability = 0.8 + (player.attributes.behavioural.commitment / 20) * 0.35;
  let gained = 0;

  for (const blockId of blocks) {
    const block = TRAINING_BLOCKS[blockId];
    if (!block) continue;
    for (const [key, weight] of Object.entries(block.builds) as Array<[keyof SystemFamiliarity, number]>) {
      const amount = weight * quality * minutesFactor * adaptability * reliability * rng.float(0.7, 1.3);
      if (!Number.isFinite(amount)) continue;
      player.systemFamiliarity[key] = clampSystemFamiliarity(player.systemFamiliarity[key] + amount);
      gained += amount;
    }
  }
  return gained;
}

/**
 * Positional knowledge moves too: tactical and defending work is where a lad
 * gets used to a new role. Deliberately slow — nobody becomes a centre half on
 * a Thursday evening.
 */
export function nudgePositionalFamiliarity(
  state: GameState,
  player: Player,
  positionPlayed: string | null,
  blocks: readonly TrainingBlockId[],
  qualityFactor: number,
  date: ISODate,
): boolean {
  if (!positionPlayed || positionPlayed === player.preferredPosition) return false;
  if (!blocks.some((block) => block === 'tactical' || block === 'defending' || block === 'possession')) return false;
  const current = player.positionalFamiliarity[positionPlayed as keyof typeof player.positionalFamiliarity] ?? 0;
  if (current >= 17) return false;
  const rng = stream(state.seed, 'position-familiarity', player.id, positionPlayed, date);
  if (!rng.chance(0.22 * qualityFactor)) return false;
  player.positionalFamiliarity[positionPlayed as keyof typeof player.positionalFamiliarity] = Math.min(
    20,
    Math.round((current + 1) * 10) / 10,
  );
  return true;
}

function squadOf(state: GameState, clubId: ClubId): Player[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  return club.squadIds.map((id) => state.people[id]).filter(isPlayer);
}
