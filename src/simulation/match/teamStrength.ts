import type { Player } from '@/domain/person';
import type { LineupSlot } from '@/domain/match';
import type { PositionCode } from '@/domain/positions';
import { positionalSimilarity } from '@/domain/positions';
import type { Tactics } from '@/domain/tactics';
import type { MatchConditions } from '@/domain/match';

/**
 * Team strength is *derived*, never stored: it is recomputed from the current
 * lineup, the players' condition and the tactics in force, so a half-time
 * tactical change or a substitution immediately changes the balance.
 */
export interface TeamStrength {
  attack: number;
  control: number;
  defence: number;
  keeper: number;
  /** Ability to cope with balls in behind / running. */
  pace: number;
  /** How physical and aggressive the side is (fouls, duels). */
  aggression: number;
  discipline: number;
  /** How well drilled the side is (training, familiarity, cohesion): ~1 is neutral. */
  organisation: number;
  /** Mean remaining stamina, drives late-game fade. */
  stamina: number;
  /** Mean positional suitability of the XI (0..1). */
  familiarity: number;
  outOfPositionCount: number;
}

export interface PlayerEffectiveness {
  /** Multiplier applied to every attribute (condition + suitability). */
  condition: number;
  suitability: number;
  effective: {
    passing: number;
    shooting: number;
    tackling: number;
    ballControl: number;
    crossing: number;
    heading: number;
    goalkeeping: number;
    pace: number;
    stamina: number;
    strength: number;
    agility: number;
    positioning: number;
    decisions: number;
    composure: number;
    workRate: number;
    determination: number;
    discipline: number;
    aggression: number;
  };
}

export function familiarityFor(player: Player, position: PositionCode): number {
  const stored = player.positionalFamiliarity[position];
  if (typeof stored === 'number') return Math.max(0, Math.min(1, stored / 20));
  return positionalSimilarity(player.preferredPosition, position);
}

/**
 * Fitness and form scale every attribute: tired or off-colour players are
 * worse. During a match the caller passes the in-match `energy` instead of the
 * weekly fitness value.
 */
export function conditionFactor(player: Player, energy = player.fitness): number {
  const clamped = Math.max(0, Math.min(100, energy));
  const fitnessFactor = 0.76 + 0.24 * (clamped / 100);
  const formFactor = 0.93 + 0.14 * (player.form / 100);
  return fitnessFactor * formFactor;
}

/** A player far from any familiar role is downgraded, but not absurdly so. */
export function suitabilityFactor(familiarity: number): number {
  return 0.78 + 0.22 * familiarity;
}

export interface EffectivenessOptions {
  /** In-match energy (0-100). Defaults to the player's weekly fitness. */
  energy?: number;
  /** Extra penalty applied to a player carrying an injury. */
  carryingInjury?: boolean;
}

export function playerEffectiveness(
  player: Player,
  position: PositionCode,
  options: EffectivenessOptions = {},
): PlayerEffectiveness {
  const suitability = familiarityFor(player, position);
  const condition = conditionFactor(player, options.energy);
  const factor = condition * suitabilityFactor(suitability) * (options.carryingInjury ? 0.78 : 1);
  const a = player.attributes;
  const scale = (value: number) => value * factor;
  return {
    condition,
    suitability,
    effective: {
      passing: scale(a.technical.passing),
      shooting: scale(a.technical.shooting),
      tackling: scale(a.technical.tackling),
      ballControl: scale(a.technical.ballControl),
      crossing: scale(a.technical.crossing),
      heading: scale(a.technical.heading),
      goalkeeping: scale(a.technical.goalkeeping),
      pace: scale(a.physical.pace),
      stamina: scale(a.physical.stamina),
      strength: scale(a.physical.strength),
      agility: scale(a.physical.agility),
      positioning: scale(a.mental.positioning),
      decisions: scale(a.mental.decisions),
      composure: scale(a.mental.composure),
      workRate: scale(a.mental.workRate),
      determination: scale(a.mental.determination),
      discipline: scale(a.behavioural.discipline),
      aggression: scale(a.behavioural.commitment * 0.6 + (20 - a.behavioural.discipline) * 0.4),
    },
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface SlotEvaluation {
  slot: LineupSlot;
  player: Player;
  effective: PlayerEffectiveness['effective'];
  suitability: number;
  defensiveWeight: number;
  controlWeight: number;
  attackingWeight: number;
  keeperWeight: number;
}

/** How much a position contributes to each phase of the game. */
export function positionRoleWeights(position: PositionCode): { def: number; ctrl: number; att: number; keeper: number } {
  switch (position) {
    case 'GK':
      return { def: 0.3, ctrl: 0, att: 0, keeper: 1 };
    case 'CB':
      return { def: 1.2, ctrl: 0.15, att: 0, keeper: 0 };
    case 'RB':
    case 'LB':
      return { def: 0.9, ctrl: 0.2, att: 0.15, keeper: 0 };
    case 'DM':
      return { def: 0.7, ctrl: 0.9, att: 0.1, keeper: 0 };
    case 'CM':
      return { def: 0.45, ctrl: 1.1, att: 0.35, keeper: 0 };
    case 'RM':
    case 'LM':
      return { def: 0.4, ctrl: 0.75, att: 0.5, keeper: 0 };
    case 'AM':
      return { def: 0.15, ctrl: 0.8, att: 0.8, keeper: 0 };
    case 'RW':
    case 'LW':
      return { def: 0.15, ctrl: 0.5, att: 0.9, keeper: 0 };
    case 'ST':
      return { def: 0.1, ctrl: 0.25, att: 1.2, keeper: 0 };
    default:
      return { def: 0.5, ctrl: 0.5, att: 0.5, keeper: 0 };
  }
}

export interface TeamStrengthInput {
  slots: readonly LineupSlot[];
  players: (id: string) => Player | undefined;
  tactics: Tactics;
  conditions: MatchConditions;
  /** In-match energy per player (0-100). */
  energy: (id: string) => number;
  /** Whether a player is carrying an injury. */
  carryingInjury: (id: string) => boolean;
  /**
   * Whether a player has been sent off and is no longer on the pitch.
   *
   * A side down to ten men is weaker because it has ten men, not because the
   * average of the survivors moved: leaving the sent-off man in the XI would let
   * him go on strengthening a side he is no longer playing for.
   */
  sentOff?: (id: string) => boolean;
  /**
   * 0-1: how well the XI knows the system it is being asked to play. 0.5 is
   * "an ordinary Sunday League side"; training and continuity push it up.
   */
  tacticalFamiliarity?: number;
  /** 0-1: how settled the group is with each other. 0.5 is neutral. */
  cohesion?: number;
}

/**
 * Ratings are normalised so that ~1.0 is an average Sunday League side at the
 * level this world generates. The engine compares the two teams' ratings, so
 * only the ratio matters for outcomes.
 */
export function computeTeamStrength(input: TeamStrengthInput): TeamStrength {
  const evaluations: SlotEvaluation[] = [];
  for (const slot of input.slots) {
    const player = input.players(slot.playerId);
    if (!player) continue;
    if (input.sentOff?.(slot.playerId)) continue;
    const effectiveness = playerEffectiveness(player, slot.position, {
      energy: input.energy(slot.playerId),
      carryingInjury: input.carryingInjury(slot.playerId),
    });
    const weights = positionRoleWeights(slot.position);
    evaluations.push({
      slot,
      player,
      effective: effectiveness.effective,
      suitability: effectiveness.suitability,
      defensiveWeight: weights.def,
      controlWeight: weights.ctrl,
      attackingWeight: weights.att,
      keeperWeight: weights.keeper,
    });
  }

  const weightedMean = (pick: (e: SlotEvaluation) => number, weight: (e: SlotEvaluation) => number): number => {
    const totalWeight = evaluations.reduce((sum, e) => sum + weight(e), 0);
    if (totalWeight <= 0) return 0;
    return evaluations.reduce((sum, e) => sum + pick(e) * weight(e), 0) / totalWeight;
  };

  const defensiveScore = weightedMean(
    (e) => e.effective.tackling * 0.34 + e.effective.positioning * 0.26 + e.effective.strength * 0.2 + e.effective.heading * 0.2,
    (e) => e.defensiveWeight,
  );

  const controlScore = weightedMean(
    (e) =>
      e.effective.passing * 0.3 +
      e.effective.ballControl * 0.25 +
      e.effective.decisions * 0.25 +
      e.effective.workRate * 0.2,
    (e) => e.controlWeight,
  );

  const attackScore = weightedMean(
    (e) =>
      e.effective.shooting * 0.3 +
      e.effective.composure * 0.2 +
      e.effective.ballControl * 0.2 +
      e.effective.positioning * 0.15 +
      e.effective.pace * 0.15,
    (e) => e.attackingWeight,
  );

  const keeperScore = weightedMean(
    (e) => e.effective.goalkeeping * 0.8 + e.effective.positioning * 0.2 + e.effective.agility * 0.0,
    (e) => e.keeperWeight,
  );

  const paceScore = weightedMean((e) => e.effective.pace, (e) => Math.max(0.1, e.defensiveWeight + e.attackingWeight));
  const aggression = average(evaluations.filter((e) => e.slot.position !== 'GK').map((e) => e.effective.aggression));
  const discipline = average(evaluations.filter((e) => e.slot.position !== 'GK').map((e) => e.effective.discipline));
  const stamina = average(evaluations.map((e) => e.effective.stamina));
  const familiarity = average(evaluations.map((e) => e.suitability));

  // Ratings are expressed per 10 attribute points so ~1.0 is an average player.
  const normalise = (score: number) => score / 10;

  // Knowing the shape and knowing each other is worth a few per cent — enough
  // to notice over a season, never enough to beat a much better side. Both
  // inputs are centred on "ordinary", so a fresh squad is unchanged.
  const familiarityInput = clamp01(input.tacticalFamiliarity ?? 0.5);
  const cohesionInput = clamp01(input.cohesion ?? 0.5);
  const organisation = 1 + (familiarityInput - 0.5) * 0.07 + (cohesionInput - 0.5) * 0.05;

  return {
    attack: (normalise(evaluations.length ? attackScore : 10) + 0.15 * normalise(controlScore)) * (1 + (organisation - 1) * 0.4),
    control: normalise(controlScore) * organisation,
    defence: (normalise(defensiveScore) + 0.1 * normalise(keeperScore)) * (1 + (organisation - 1) * 0.5),
    organisation,
    keeper: normalise(keeperScore || 10),
    pace: normalise(paceScore),
    aggression: normalise(aggression),
    discipline: normalise(discipline),
    stamina: normalise(stamina),
    familiarity,
    outOfPositionCount: evaluations.filter((e) => e.suitability < 0.6).length,
  };
}
