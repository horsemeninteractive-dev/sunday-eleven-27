import type { FormationId } from './positions';

export type Mentality = 'very-defensive' | 'defensive' | 'balanced' | 'attacking' | 'very-attacking';
export type PassingStyle = 'short' | 'mixed' | 'direct';
export type Tempo = 'slow' | 'standard' | 'high';
export type PressingIntensity = 'low' | 'medium' | 'high';
export type DefensiveLine = 'deep' | 'standard' | 'high';
export type AttackingFocus = 'wide' | 'balanced' | 'central';

/**
 * The first slice exposes a deliberately small tactical surface. Individual
 * instructions, set pieces and transitions plug into `Tactics` later as
 * additional optional fields — nothing here assumes these are the only knobs.
 */
export interface Tactics {
  formation: FormationId;
  mentality: Mentality;
  passingStyle: PassingStyle;
  tempo: Tempo;
  pressing: PressingIntensity;
  defensiveLine: DefensiveLine;
  attackingFocus: AttackingFocus;
  /**
   * The set pieces this side has actually worked on.
   *
   * Optional, and optional *forwards*: a club that has never drilled a corner
   * simply has no routine, and its corners are then aimed at whoever happens to
   * be nearest rather than at a rehearsed run. That is the honest state of most
   * grassroots football, and it is why this is here as a block a manager fills
   * in rather than as six tactics every side is assumed to own.
   *
   * It decides *where* a delivery goes and *who* takes it. It never decides
   * whether it worked — that belongs to the possession model, and a drilled
   * routine is not a better roll.
   */
  setPieceRoutines?: SetPieceRoutines;
}

/**
 * What a side has drilled.
 *
 * Each field is a named choice rather than a number, because the difference
 * between a corner routine that finds the near post and one that finds nobody in
 * particular is not a percentage — it is a different idea about where the ball
 * should go.
 */
export interface SetPieceRoutines {
  /**
   * Where a corner is aimed.
   *
   * `near-post` is the six-yard header; `far-post` is the far side of the goal
   * and the harder ball; `short` is played to a team-mate at the edge of the
   * area to keep possession; `central` is a delivery to the penalty spot for a
   * shot or a lay-off. A side with no routine aims at the middle of the box.
   */
  corner?: 'near-post' | 'far-post' | 'short' | 'central' | 'untrained';
  /** Where a free kick is aimed: straight at goal, into the box, or short. */
  freeKick?: 'direct' | 'into-box' | 'short' | 'untrained';
  /**
   * Who steps up to take a penalty, by player id.
   *
   * Absent means "let the model choose", which is what an untrained side wants;
   * naming somebody is a manager saying this one is our penalty taker.
   */
  penaltyTakerId?: string;
}

export const MENTALITY_LABEL: Record<Mentality, string> = {
  'very-defensive': 'Very defensive',
  defensive: 'Defensive',
  balanced: 'Balanced',
  attacking: 'Attacking',
  'very-attacking': 'Very attacking',
};

export const PASSING_LABEL: Record<PassingStyle, string> = {
  short: 'Short passing',
  mixed: 'Mixed',
  direct: 'Direct',
};

export const TEMPO_LABEL: Record<Tempo, string> = {
  slow: 'Slow',
  standard: 'Standard',
  high: 'High tempo',
};

export const PRESSING_LABEL: Record<PressingIntensity, string> = {
  low: 'Sit off',
  medium: 'Medium',
  high: 'Press high',
};

export const LINE_LABEL: Record<DefensiveLine, string> = {
  deep: 'Deep',
  standard: 'Standard',
  high: 'High',
};

export const FOCUS_LABEL: Record<AttackingFocus, string> = {
  wide: 'Get it wide',
  balanced: 'Mixed',
  central: 'Through the middle',
};

export const MENTALITY_ORDER: Mentality[] = ['very-defensive', 'defensive', 'balanced', 'attacking', 'very-attacking'];
export const PASSING_ORDER: PassingStyle[] = ['short', 'mixed', 'direct'];
export const TEMPO_ORDER: Tempo[] = ['slow', 'standard', 'high'];
export const PRESSING_ORDER: PressingIntensity[] = ['low', 'medium', 'high'];
export const LINE_ORDER: DefensiveLine[] = ['deep', 'standard', 'high'];
export const FOCUS_ORDER: AttackingFocus[] = ['wide', 'balanced', 'central'];

export function defaultTactics(formation: FormationId = '4-4-2'): Tactics {
  return {
    formation,
    mentality: 'balanced',
    passingStyle: 'mixed',
    tempo: 'standard',
    pressing: 'medium',
    defensiveLine: 'standard',
    attackingFocus: 'balanced',
  };
}

export function describeTactics(tactics: Tactics): string {
  return [
    tactics.formation,
    MENTALITY_LABEL[tactics.mentality],
    PASSING_LABEL[tactics.passingStyle],
    TEMPO_LABEL[tactics.tempo],
    PRESSING_LABEL[tactics.pressing],
  ].join(' · ');
}
