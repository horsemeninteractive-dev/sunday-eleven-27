import { FULL_SIDE, MIN_SIDE, type BenchSlot, type LineupSlot } from '@/domain/match';
import type { Player } from '@/domain/person';
import { formationSlots, positionalSimilarity, POSITIONS, type FormationId, type FormationSlot, type PositionCode } from '@/domain/positions';
import { defaultRoleFor, roleProfile, type Role } from '@/simulation/match/roles';
import type { Tactics } from '@/domain/tactics';
import { roleCandidates } from './ai/style';

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

/**
 * How well a player suits a *job* at a position, rather than merely the position.
 *
 * This is the half of selection the game was missing. `positionScore` answers
 * "can this man play right back", which is a question about where he stands;
 * this answers "is this man a *supporting* right back or a defensive one",
 * which is a question about what the manager is asking him to do. The weights
 * come from the role's own `attributeFocus`, so the table that decides who a man
 * is in the engine is the same table that decides whether he is picked for it —
 * one opinion about a role, not two.
 */
export function roleFitScore(player: Player, position: PositionCode, role: Role): number {
  const focus = roleProfile(role).attributeFocus as Record<string, number>;
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(focus)) {
    if (!weight || weight <= 0) continue;
    total += (attributeValue(player, key) / 20) * weight;
    weightSum += weight;
  }
  const focusScore = weightSum > 0 ? total / weightSum : 0.4;
  // Suitability for the position still gates it: the best poacher alive is not
  // a poacher while he is standing at centre half.
  return Math.max(0, Math.min(1, focusScore * (0.55 + 0.45 * positionScore(player, position))));
}

/**
 * The job a manager would give this man in this position, for these
 * instructions.
 *
 * The system offers the ordinary version of the position first and its
 * specialisations after it, and a specialisation has to fit the man *better*
 * than the ordinary job before it is used. So a balanced side still turns out a
 * side of ordinary footballers, a direct side picks the target man it has, and
 * the manager can always overrule the assistant by naming a role himself.
 */
export function bestRoleFor(player: Player, position: PositionCode, tactics?: Tactics): Role {
  const fallback = defaultRoleFor(position);
  if (!tactics) return fallback;
  const candidates = roleCandidates(position, tactics);
  let best = fallback;
  let bestScore = roleFitScore(player, position, fallback) + 0.012;
  for (const role of candidates) {
    if (role === fallback) continue;
    const score = roleFitScore(player, position, role);
    if (score > bestScore) {
      best = role;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How much a Sunday afternoon wobbles a selection, 0..1 per player.
 *
 * Deterministic from the player and the seed, because the alternative — a
 * manager picking a different eleven every time the screen is drawn — is not
 * unpredictability, it is a bug. It is small on purpose: it decides which of two
 * similar players gets the shirt, never whether a good one is left out.
 */
const SELECTION_WOBBLE = 0.04;

function wobble(seed: number | undefined, playerId: string): number {
  if (seed === undefined) return 1;
  let hash = seed | 0;
  for (let index = 0; index < playerId.length; index += 1) hash = (hash * 31 + playerId.charCodeAt(index)) % 1000003;
  return 1 + ((hash % 1000) / 1000 - 0.5) * 2 * SELECTION_WOBBLE;
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
  /**
   * The instructions the XI is being picked for.
   *
   * With them the assistant picks for the *system* — a direct side sends out a
   * target man, a possession side sends out a deeper midfield — and without them
   * it picks the ordinary version of every position, which is what a caller
   * asking a neutral question wants.
   */
  tactics?: Tactics;
}

function pickScore(player: Player, position: PositionCode, role?: Role, options: PickOptions = {}): number {
  const condition = 0.82 + 0.18 * (player.fitness / 100);
  const form = 0.94 + 0.12 * (player.form / 100);
  // Suitability for the *job* moves a selection, but it never outweighs being
  // the better footballer: the range here is ±7 %, which is enough to put a good
  // fit ahead of a slightly better player who does not suit the system.
  const fit = role ? 0.86 + 0.14 * roleFitScore(player, position, role) : 1;
  return positionScore(player, position) * fit * condition * form * wobble(options.seed, player.id) - availabilityPenalty(player);
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
      .map((player) => {
        // The job the manager's instructions imply for this man in this slot,
        // and then the score of picking him *to do it* — the two questions are
        // asked in this order because a role a man cannot play is worth nothing
        // however well he would play it.
        const role = bestRoleFor(player, slot.position, options.tactics);
        return { player, role, score: pickScore(player, slot.position, role, options) };
      })
      .sort((a, b) => b.score - a.score);
    const chosen = candidates[0];
    if (!chosen) continue;
    used.add(chosen.player.id);
    starting[index] = {
      playerId: chosen.player.id,
      position: slot.position,
      role: chosen.role,
      outOfPosition: positionScore(chosen.player, slot.position) < 0.55,
    };
  }

  const remaining = eligible
    .filter((player) => !used.has(player.id))
    .map((player) => ({ player, score: bestScoreAnywhere(player, slots.map((s) => s.position), options) }))
    .sort((a, b) => b.score - a.score);

  // The bench covers the shape the side is actually playing — a back three
  // wants a spare centre half before it wants a fourth forward — and each place
  // is filled by the best man for that job rather than by whoever happens to be
  // left. The keeper is always named: a Sunday side without one on the bench is
  // one injury from an outfield man in goal, and that is not a plan.
  const bench: BenchSlot[] = [];
  const benchTarget = 5;
  const counts = new Map<PositionCode, number>();
  for (const slot of slots) counts.set(slot.position, (counts.get(slot.position) ?? 0) + 1);
  const needs: PositionCode[] = [
    'GK',
    ...[...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || slotPriority(b) - slotPriority(a)),
  ];
  for (const need of needs) {
    if (bench.length >= benchTarget) break;
    const scored = remaining
      .filter((entry) => !bench.some((b) => b.playerId === entry.player.id))
      .map((entry) => {
        const role = bestRoleFor(entry.player, need, options.tactics);
        return { entry, role, score: pickScore(entry.player, need, role, options) };
      })
      .filter((candidate) => candidate.score > 0.3)
      .sort((a, b) => b.score - a.score);
    const candidate = scored[0];
    if (candidate) bench.push({ playerId: candidate.entry.player.id, position: need, role: candidate.role });
  }
  for (const entry of remaining) {
    if (bench.length >= benchTarget) break;
    if (bench.some((b) => b.playerId === entry.player.id)) continue;
    const position = entry.player.preferredPosition;
    bench.push({ playerId: entry.player.id, position, role: bestRoleFor(entry.player, position, options.tactics) });
  }

  return { starting: starting.filter(Boolean), bench };
}

function bestScoreAnywhere(player: Player, positions: readonly PositionCode[], options: PickOptions = {}): number {
  return positions.reduce(
    (best, position) => Math.max(best, pickScore(player, position, bestRoleFor(player, position, options.tactics), options)),
    0,
  );
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
