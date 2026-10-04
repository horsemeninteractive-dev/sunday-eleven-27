import type { Match, MatchConditions } from '@/domain/match';
import type { Side } from './core';
import type { SetPieceRoutines, Tactics } from '@/domain/tactics';

/**
 * Tactics are translated into multipliers rather than "correct answers".
 *
 * Every aggressive setting buys something and pays for it elsewhere, so there
 * is no universally best setup: pressing high wins the ball higher but drains
 * legs and leaves space in behind, and so on. Conditions interact with the
 * choices — a muddy pitch punishes short passing and a high tempo.
 */
export interface TacticalProfile {
  attackMultiplier: number;
  defenceMultiplier: number;
  controlMultiplier: number;
  /** How many attempts a side creates. */
  shotRateMultiplier: number;
  /** How good each attempt is. */
  shotQualityMultiplier: number;
  /** Chance of a misplaced pass / turnover event per minute. */
  errorRate: number;
  /** Multiplier on stamina drain. */
  fatigueRate: number;
  foulRate: number;
  cardRate: number;
  /** How exposed the side is to pace in behind. */
  counterVulnerability: number;
  /** 0..1: relative weighting of crosses vs through balls. */
  wideBias: number;
  /** Set-piece/aerial threat multiplier. */
  aerialMultiplier: number;
  /** Risk of shipping a chance while pressing high. */
  pressExposure: number;
}

interface ConditionEffects {
  errorRate: number;
  fatigueRate: number;
  injuryRate: number;
  passControlPenalty: number;
  shotQualityPenalty: number;
}

export function conditionEffects(conditions: MatchConditions): ConditionEffects {
  const pitchPenalty = Math.max(0, (12 - conditions.pitchQuality) * 0.012);
  let errorRate = 1 + pitchPenalty;
  let fatigueRate = 1 + pitchPenalty * 0.5;
  let injuryRate = 1 + pitchPenalty * 1.4;
  let passControlPenalty = pitchPenalty;
  let shotQualityPenalty = 0;

  switch (conditions.pitch) {
    case 'muddy':
      fatigueRate += 0.18;
      errorRate += 0.05;
      passControlPenalty += 0.04;
      injuryRate += 0.15;
      break;
    case 'waterlogged':
      errorRate += 0.12;
      fatigueRate += 0.12;
      passControlPenalty += 0.08;
      shotQualityPenalty += 0.01;
      break;
    case 'frozen':
      errorRate += 0.18;
      injuryRate += 0.6;
      shotQualityPenalty += 0.03;
      break;
    case 'worn':
      passControlPenalty += 0.03;
      break;
    default:
      break;
  }

  switch (conditions.weather) {
    case 'heavy-rain':
      errorRate += 0.08;
      fatigueRate += 0.06;
      passControlPenalty += 0.03;
      break;
    case 'light-rain':
      errorRate += 0.03;
      break;
    case 'windy':
      errorRate += 0.06;
      shotQualityPenalty += 0.015;
      break;
    case 'frozen':
    case 'cold':
      errorRate += 0.02;
      break;
    default:
      break;
  }

  if (conditions.temperatureC <= 3) fatigueRate += 0.03;

  return { errorRate, fatigueRate, injuryRate, passControlPenalty, shotQualityPenalty };
}

/**
 * The set pieces a side has worked on, as the set-piece code needs them.
 *
 * Optional all the way down, because that is the honest default: a club with no
 * routines block has *no routines*, and every choice here falls back to the
 * untrained answer rather than to a well-drilled one it never asked for. The
 * fallback is written once, here, so no caller has to remember to ask.
 */
export function setPieceRoutinesFor(match: Match, side: Side): Required<Pick<SetPieceRoutines, 'corner' | 'freeKick'>> &
  Pick<SetPieceRoutines, 'penaltyTakerId'> {
  const tactics = match.lineups[side].tactics;
  const routines = tactics?.setPieceRoutines;
  return {
    corner: routines?.corner ?? 'untrained',
    freeKick: routines?.freeKick ?? 'untrained',
    penaltyTakerId: routines?.penaltyTakerId ?? undefined,
  };
}

export function tacticalProfile(tactics: Tactics, conditions: MatchConditions): TacticalProfile {
  const conditionsFx = conditionEffects(conditions);
  const profile: TacticalProfile = {
    attackMultiplier: 1,
    defenceMultiplier: 1,
    controlMultiplier: 1,
    shotRateMultiplier: 1,
    shotQualityMultiplier: 1,
    errorRate: 1,
    fatigueRate: 1,
    foulRate: 1,
    cardRate: 1,
    counterVulnerability: 1,
    wideBias: 0.5,
    aerialMultiplier: 1,
    pressExposure: 1,
  };

  switch (tactics.mentality) {
    case 'very-defensive':
      profile.attackMultiplier = 0.86;
      profile.defenceMultiplier = 1.1;
      profile.shotRateMultiplier *= 0.85;
      break;
    case 'defensive':
      profile.attackMultiplier = 0.93;
      profile.defenceMultiplier = 1.05;
      profile.shotRateMultiplier *= 0.93;
      break;
    case 'attacking':
      profile.attackMultiplier = 1.07;
      profile.defenceMultiplier = 0.95;
      profile.shotRateMultiplier *= 1.08;
      break;
    case 'very-attacking':
      profile.attackMultiplier = 1.15;
      profile.defenceMultiplier = 0.87;
      profile.shotRateMultiplier *= 1.16;
      profile.counterVulnerability *= 1.18;
      break;
    default:
      break;
  }

  switch (tactics.passingStyle) {
    case 'short':
      // Short passing is control-positive on a decent pitch and a liability on
      // a muddy one — the groundstaff matter as much as the midfield.
      profile.controlMultiplier *= 1.08 - conditionsFx.passControlPenalty * 1.6;
      profile.errorRate *= 1 + conditionsFx.passControlPenalty * 2.2;
      profile.shotQualityMultiplier *= 1.03;
      profile.shotRateMultiplier *= 0.95;
      break;
    case 'direct':
      profile.attackMultiplier *= 1.04;
      profile.controlMultiplier *= 0.94;
      profile.shotRateMultiplier *= 1.04;
      profile.shotQualityMultiplier *= 0.96;
      profile.wideBias += 0.05;
      profile.aerialMultiplier *= 1.08;
      profile.errorRate *= 1.02;
      break;
    default:
      break;
  }

  switch (tactics.tempo) {
    case 'slow':
      profile.shotRateMultiplier *= 0.9;
      profile.fatigueRate *= 0.9;
      profile.errorRate *= 0.96;
      profile.shotQualityMultiplier *= 1.03;
      break;
    case 'high':
      profile.shotRateMultiplier *= 1.12;
      profile.fatigueRate *= 1.16;
      profile.errorRate *= 1.1;
      profile.shotQualityMultiplier *= 0.97;
      break;
    default:
      break;
  }

  switch (tactics.pressing) {
    case 'low':
      profile.defenceMultiplier *= 0.96;
      profile.fatigueRate *= 0.9;
      profile.foulRate *= 0.9;
      profile.pressExposure *= 0.85;
      break;
    case 'high':
      profile.defenceMultiplier *= 1.06;
      profile.fatigueRate *= 1.2;
      profile.foulRate *= 1.18;
      profile.cardRate *= 1.12;
      profile.pressExposure *= 1.2;
      break;
    default:
      break;
  }

  switch (tactics.defensiveLine) {
    case 'deep':
      profile.defenceMultiplier *= 1.05;
      profile.counterVulnerability *= 0.85;
      profile.attackMultiplier *= 0.95;
      profile.wideBias -= 0.03;
      break;
    case 'high':
      profile.attackMultiplier *= 1.05;
      profile.counterVulnerability *= 1.22;
      profile.defenceMultiplier *= 0.98;
      profile.wideBias += 0.03;
      break;
    default:
      break;
  }

  switch (tactics.attackingFocus) {
    case 'wide':
      profile.wideBias += 0.2;
      profile.aerialMultiplier *= 1.12;
      profile.shotQualityMultiplier *= 0.99;
      break;
    case 'central':
      profile.wideBias -= 0.2;
      profile.controlMultiplier *= 1.03;
      profile.shotQualityMultiplier *= 1.02;
      break;
    default:
      break;
  }

  // Conditions apply on top of everything the manager has chosen.
  profile.errorRate *= conditionsFx.errorRate;
  profile.fatigueRate *= conditionsFx.fatigueRate;
  profile.shotQualityMultiplier *= 1 - conditionsFx.shotQualityPenalty;

  return profile;
}
