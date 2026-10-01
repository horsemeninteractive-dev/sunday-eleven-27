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
