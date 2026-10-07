import { FULL_SIDE, MIN_SIDE, type BenchSlot, type LineupSlot } from '@/domain/match';
import type { Player } from '@/domain/person';
import { formationSlots, positionalSimilarity, POSITIONS, type FormationId, type FormationSlot, type PositionCode } from '@/domain/positions';
import { defaultRoleFor } from '@/simulation/match/roles';

/**
 * Selection support shared by the human manager's UI and by AI clubs.
 *
 * Nothing here hard-penalises a player for being "out of position": scores are
 * built from attributes and positional familiarity, and the consequences of a
 * poor fit are worked out by the match engine.
 */

const POSITION_ATTRIBUTE_WEIGHTS: Record<PositionCode, Record<string, number>> = {
  GK: { goalkeeping: 3.2, positioning: 0.8, agility: 0.8, composure: 0.5, decisions: 0.4 },
  CB: { tackling: 1.8, heading: 1.4, positioning: 1.5, strength: 1.2, decisions: 0.8, physical: 0.2, passing: 0.4 },
  RB: { tackling: 1.3, stamina: 1.2, positioning: 1.1, pace: 1, crossing: 0.8, workRate: 0.7 },
  LB: { tackling: 1.3, stamina: 1.2, positioning: 1.1, pace: 1, crossing: 0.8, workRate: 0.7 },
  DM: { tackling: 1.6, positioning: 1.4, decisions: 1, passing: 0.9, workRate: 0.9, strength: 0.7 },
  CM: { passing: 1.5, ballControl: 1.2, decisions: 1.1, workRate: 0.9, stamina: 0.9, composure: 0.6 },
  RM: { pace: 1.3, crossing: 1.2, stamina: 1.1, ballControl: 0.9, workRate: 0.8, tackling: 0.5 },
  LM: { pace: 1.3, crossing: 1.2, stamina: 1.1, ballControl: 0.9, workRate: 0.8, tackling: 0.5 },
  AM: { ballControl: 1.4, passing: 1.3, decisions: 1, composure: 0.9, shooting: 0.8, pace: 0.6 },
  RW: { pace: 1.5, ballControl: 1.3, crossing: 1.1, shooting: 0.9, agility: 1, composure: 0.5 },
  LW: { pace: 1.5, ballControl: 1.3, crossing: 1.1, shooting: 0.9, agility: 1, composure: 0.5 },
  ST: { shooting: 1.8, positioning: 1.4, composure: 1.1, pace: 1, strength: 0.8, heading: 0.8 },
};

function attributeValue(player: Player, key: string): number {
  const merged: Record<string, number> = {
    ...(player.attributes.technical as unknown as Record<string, number>),
    ...(player.attributes.physical as unknown as Record<string, number>),
    ...(player.attributes.mental as unknown as Record<string, number>),
    ...(player.attributes.behavioural as unknown as Record<string, number>),
  };
  return merged[key] ?? 8;
}

/** 0..1 suitability of a player for a position, from attributes and familiarity. */
export function positionScore(player: Player, position: PositionCode): number {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position];
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (key === 'physical') continue;
    total += (attributeValue(player, key) / 20) * weight;
    weightSum += weight;
  }
  const attributeScore = weightSum > 0 ? total / weightSum : 0.4;

  const stored = player.positionalFamiliarity[position];
  const familiarity = typeof stored === 'number' ? stored / 20 : positionalSimilarity(player.preferredPosition, position);
  const groupBonus = POSITIONS[player.preferredPosition].group === POSITIONS[position].group ? 0.06 : 0;

  return Math.max(0, Math.min(1, attributeScore * (0.62 + 0.38 * familiarity) + groupBonus));
}

export function canPlay(player: Player): boolean {
  return player.availability.status !== 'unavailable';
}

export function availabilityPenalty(player: Player): number {
  return player.availability.status === 'doubtful' ? 0.14 : 0;
}

export interface PickOptions {
  /** Players that may be selected (defaults to all available squad members). */
  eligible?: (player: Player) => boolean;
  /** Score multiplier per slot index, used for weaker preferred selections. */
  seed?: number;
  /**
   * The eleven positions to pick for, when the manager has set a shape himself.
   * Without it the named formation is used, which is every side until somebody
   * moves a dot — and then the assistant has to pick for the shape on the pitch,
   * or he would hand back a 4-4-2 while the screen shows a back three.
   */
  shape?: readonly FormationSlot[];
}

function pickScore(player: Player, position: PositionCode): number {
  const condition = 0.82 + 0.18 * (player.fitness / 100);
  const form = 0.94 + 0.12 * (player.form / 100);
  return positionScore(player, position) * condition * form - availabilityPenalty(player);
}

export interface Selection {
  starting: LineupSlot[];
  bench: BenchSlot[];
}

/**
 * Greedy auto-pick: strongest sensible XI for the formation, then a bench that
 * covers each area of the pitch. AI clubs use the same routine.
 */
export function autoPickLineup(
  squad: readonly Player[],
  formationId: FormationId,
  options: PickOptions = {},
): Selection {
  const eligible = squad.filter((player) => canPlay(player) && (options.eligible ? options.eligible(player) : true));
  const slots = formationSlots(formationId, options.shape);
  const used = new Set<string>();
  const starting: LineupSlot[] = [];

  // Fill the most specialised roles first (keeper, centre backs, striker).
  const slotOrder = slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => slotPriority(b.slot.position) - slotPriority(a.slot.position));

  for (const { slot, index } of slotOrder) {
    const candidates = eligible
      .filter((player) => !used.has(player.id))
      .map((player) => ({ player, score: pickScore(player, slot.position) }))
      .sort((a, b) => b.score - a.score);
    const chosen = candidates[0];
    if (!chosen) continue;
    used.add(chosen.player.id);
    starting[index] = {
      playerId: chosen.player.id,
      position: slot.position,
      // AI clubs get the default role for the slot, never an exotic one: a 4-4-2
      // should still be a 4-4-2 with sensible jobs, and the balance bench is
      // the thing that notices if the league starts playing a different game.
      role: defaultRoleFor(slot.position),
      outOfPosition: positionScore(chosen.player, slot.position) < 0.55,
    };
  }

  const remaining = eligible
    .filter((player) => !used.has(player.id))
    .map((player) => ({ player, score: bestScoreAnywhere(player, slots.map((s) => s.position)) }))
    .sort((a, b) => b.score - a.score);

  const bench: BenchSlot[] = [];
  const benchTarget = 5;
  const needs: PositionCode[] = ['GK', 'CB', 'CM', 'ST', 'RB'];
  for (const need of needs) {
    if (bench.length >= benchTarget) break;
    const candidate = remaining.find((entry) => !bench.some((b) => b.playerId === entry.player.id) && positionScore(entry.player, need) > 0.5);
    if (candidate) {
      bench.push({ playerId: candidate.player.id, position: need, role: defaultRoleFor(need) });
    }
  }
  for (const entry of remaining) {
    if (bench.length >= benchTarget) break;
    if (bench.some((b) => b.playerId === entry.player.id)) continue;
    bench.push({ playerId: entry.player.id, position: entry.player.preferredPosition, role: defaultRoleFor(entry.player.preferredPosition) });
  }

  return { starting: starting.filter(Boolean), bench };
}

function bestScoreAnywhere(player: Player, positions: readonly PositionCode[]): number {
  return positions.reduce((best, position) => Math.max(best, pickScore(player, position)), 0);
}

function slotPriority(position: PositionCode): number {
  switch (position) {
    case 'GK':
      return 100;
    case 'CB':
      return 80;
    case 'ST':
      return 70;
    case 'CM':
    case 'DM':
      return 60;
    case 'AM':
      return 50;
    case 'RB':
    case 'LB':
      return 45;
    case 'RM':
    case 'LM':
      return 40;
    default:
      return 30;
  }
}

export interface LineupProblem {
  severity: 'error' | 'warning';
  message: string;
}

/** Validation used by the selection screen and before kick-off. */
export function validateLineup(
  starting: readonly LineupSlot[],
  bench: readonly BenchSlot[],
  players: (id: string) => Player | undefined,
): LineupProblem[] {
  const problems: LineupProblem[] = [];

  if (starting.length < MIN_SIDE) {
    problems.push({
      severity: 'error',
      message: `A side needs at least ${MIN_SIDE} players — you have ${starting.length}. Without a team there is no match.`,
    });
  } else if (starting.length > FULL_SIDE) {
    problems.push({ severity: 'error', message: `A side is ${FULL_SIDE} — you have ${starting.length}.` });
  } else if (starting.length < FULL_SIDE) {
    // Legal, and worth saying: a manager going short should know he is doing it.
    problems.push({
      severity: 'warning',
      message: `Short-handed: ${starting.length} players, not a full ${FULL_SIDE}.`,
    });
  }
  if (bench.length === 0) {
    problems.push({ severity: 'warning', message: 'No substitutes named. A late injury would leave you short.' });
  }
  if (bench.length > 5) {
    problems.push({ severity: 'error', message: 'You can only name five substitutes.' });
  }
  if (!starting.some((slot) => slot.position === 'GK')) {
    problems.push({ severity: 'error', message: 'No goalkeeper selected.' });
  }

  const seen = new Set<string>();
  for (const slot of [...starting, ...bench]) {
    if (seen.has(slot.playerId)) {
      problems.push({ severity: 'error', message: 'The same player is selected twice.' });
      break;
    }
    seen.add(slot.playerId);
  }

  for (const slot of starting) {
    const player = players(slot.playerId);
    if (!player) continue;
    if (player.availability.status === 'unavailable') {
      problems.push({ severity: 'error', message: `${player.surname} is unavailable this week.` });
    } else if (player.availability.status === 'doubtful') {
      problems.push({ severity: 'warning', message: `${player.surname} is doubtful — ${player.availability.note ?? 'unclear'}.` });
    }
    if (player.fitness < 55) {
      problems.push({ severity: 'warning', message: `${player.surname} is short of fitness (${Math.round(player.fitness)}%).` });
    }
    if (positionScore(player, slot.position) < 0.5) {
      problems.push({
        severity: 'warning',
        message: `${player.surname} looks out of place at ${POSITIONS[slot.position].label.toLowerCase()}.`,
      });
    }
  }

  return problems;
}
