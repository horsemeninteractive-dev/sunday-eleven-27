/**
 * Positions are the vocabulary shared by squad generation, team selection,
 * tactics and the match engine. Each position has a "natural" group so the UI
 * can group players without hard-coding anything club specific.
 */
export type PositionCode = 'GK' | 'RB' | 'CB' | 'LB' | 'DM' | 'RM' | 'CM' | 'LM' | 'AM' | 'RW' | 'LW' | 'ST';

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface PositionDefinition {
  code: PositionCode;
  label: string;
  group: PositionGroup;
  /** Normalised pitch coordinates for the *left-to-right attacking* team. */
  base: { x: number; y: number };
}

export const POSITION_GROUP_LABEL: Record<PositionGroup, string> = {
  GK: 'Goalkeeper',
  DEF: 'Defender',
  MID: 'Midfielder',
  FWD: 'Forward',
};

export const POSITIONS: Record<PositionCode, PositionDefinition> = {
  GK: { code: 'GK', label: 'Goalkeeper', group: 'GK', base: { x: 0.04, y: 0.5 } },
  RB: { code: 'RB', label: 'Right back', group: 'DEF', base: { x: 0.2, y: 0.82 } },
  CB: { code: 'CB', label: 'Centre back', group: 'DEF', base: { x: 0.16, y: 0.5 } },
  LB: { code: 'LB', label: 'Left back', group: 'DEF', base: { x: 0.2, y: 0.18 } },
  DM: { code: 'DM', label: 'Defensive midfield', group: 'MID', base: { x: 0.34, y: 0.5 } },
  RM: { code: 'RM', label: 'Right midfield', group: 'MID', base: { x: 0.44, y: 0.85 } },
  CM: { code: 'CM', label: 'Central midfield', group: 'MID', base: { x: 0.44, y: 0.5 } },
  LM: { code: 'LM', label: 'Left midfield', group: 'MID', base: { x: 0.44, y: 0.15 } },
  AM: { code: 'AM', label: 'Attacking midfield', group: 'MID', base: { x: 0.6, y: 0.5 } },
  RW: { code: 'RW', label: 'Right wing', group: 'FWD', base: { x: 0.7, y: 0.85 } },
  LW: { code: 'LW', label: 'Left wing', group: 'FWD', base: { x: 0.7, y: 0.15 } },
  ST: { code: 'ST', label: 'Striker', group: 'FWD', base: { x: 0.78, y: 0.5 } },
};

export const ALL_POSITION_CODES = Object.keys(POSITIONS) as PositionCode[];

/**
 * How closely one position resembles another. Used to derive a player's
 * positional familiarity away from their preferred role, and by the match
 * engine to judge suitability. Values are familiarity kept on a 0..1 scale.
 */
const ADJACENT: Array<[PositionCode, PositionCode, number]> = [
  ['CB', 'RB', 0.75],
  ['CB', 'LB', 0.75],
  ['RB', 'LB', 0.6],
  ['RB', 'RM', 0.7],
  ['LB', 'LM', 0.7],
  ['RM', 'LM', 0.65],
  ['RM', 'RW', 0.8],
  ['LM', 'LW', 0.8],
  ['RW', 'LW', 0.75],
  ['CM', 'DM', 0.8],
  ['CM', 'AM', 0.8],
  ['CM', 'RM', 0.7],
  ['CM', 'LM', 0.7],
  ['DM', 'CB', 0.6],
  ['AM', 'ST', 0.75],
  ['AM', 'RW', 0.7],
  ['AM', 'LW', 0.7],
  ['ST', 'RW', 0.6],
  ['ST', 'LW', 0.6],
  ['ST', 'CM', 0.5],
];

const SIMILARITY: Map<string, number> = (() => {
  const map = new Map<string, number>();
  for (const [a, b, value] of ADJACENT) {
    map.set(`${a}|${b}`, value);
    map.set(`${b}|${a}`, value);
  }
  return map;
})();

/** Familiarity (0..1) for playing `target` when the player's best role is `natural`. */
export function positionalSimilarity(natural: PositionCode, target: PositionCode): number {
  if (natural === target) return 1;
  const direct = SIMILARITY.get(`${natural}|${target}`);
  if (direct !== undefined) return direct;
  const sameGroup = POSITIONS[natural].group === POSITIONS[target].group;
  if (sameGroup) return 0.62;
  // Keepers never plausibly fill outfield roles and vice versa.
  if (natural === 'GK' || target === 'GK') return 0.05;
  const looselyRelated: Array<[PositionGroup, PositionGroup]> = [
    ['DEF', 'MID'],
    ['MID', 'FWD'],
    ['DEF', 'FWD'],
  ];
  const pair = [POSITIONS[natural].group, POSITIONS[target].group].sort().join('|');
  const related = looselyRelated.some(([a, b]) => [a, b].sort().join('|') === pair);
  return related ? 0.45 : 0.35;
}

export interface FormationSlot {
  position: PositionCode;
  x: number;
  y: number;
}

export interface FormationDefinition {
  id: FormationId;
  label: string;
  description: string;
  slots: FormationSlot[];
}

export type FormationId =
  | '4-4-2'
  | '4-4-1-1'
  | '4-3-3'
  | '4-2-3-1'
  | '4-5-1'
  | '3-5-2'
  | '5-3-2'
  | '4-1-4-1';

function slot(position: PositionCode, x: number, y: number): FormationSlot {
  return { position, x, y };
}

export const FORMATIONS: Record<FormationId, FormationDefinition> = {
  '4-4-2': {
    id: '4-4-2',
    label: '4-4-2',
    description: 'The Sunday League default. Two banks of four, two up front.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.82),
      slot('CB', 0.15, 0.6),
      slot('CB', 0.15, 0.4),
      slot('LB', 0.2, 0.18),
      slot('RM', 0.45, 0.85),
      slot('CM', 0.42, 0.58),
      slot('CM', 0.42, 0.42),
      slot('LM', 0.45, 0.15),
      slot('ST', 0.74, 0.42),
      slot('ST', 0.74, 0.58),
    ],
  },
  '4-4-1-1': {
    id: '4-4-1-1',
    label: '4-4-1-1',
    description: 'A withdrawn striker links midfield and attack.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.82),
      slot('CB', 0.15, 0.6),
      slot('CB', 0.15, 0.4),
      slot('LB', 0.2, 0.18),
      slot('RM', 0.45, 0.85),
      slot('CM', 0.42, 0.58),
      slot('CM', 0.42, 0.42),
      slot('LM', 0.45, 0.15),
      slot('AM', 0.6, 0.5),
      slot('ST', 0.78, 0.5),
    ],
  },
  '4-3-3': {
    id: '4-3-3',
    label: '4-3-3',
    description: 'Wide forwards stretch the game. Needs legs in midfield.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.82),
      slot('CB', 0.15, 0.6),
      slot('CB', 0.15, 0.4),
      slot('LB', 0.2, 0.18),
      slot('CM', 0.42, 0.62),
      slot('DM', 0.36, 0.5),
      slot('CM', 0.42, 0.38),
      slot('RW', 0.7, 0.85),
      slot('ST', 0.78, 0.5),
      slot('LW', 0.7, 0.15),
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    label: '4-2-3-1',
    description: 'Double pivot protects the back four, a three supports the striker.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.82),
      slot('CB', 0.15, 0.6),
      slot('CB', 0.15, 0.4),
      slot('LB', 0.2, 0.18),
      slot('DM', 0.35, 0.58),
      slot('DM', 0.35, 0.42),
      slot('RM', 0.56, 0.85),
      slot('AM', 0.58, 0.5),
      slot('LM', 0.56, 0.15),
      slot('ST', 0.78, 0.5),
    ],
  },
  '4-5-1': {
    id: '4-5-1',
    label: '4-5-1',
    description: 'Crowd the middle and hold what you have.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.82),
      slot('CB', 0.15, 0.6),
      slot('CB', 0.15, 0.4),
      slot('LB', 0.2, 0.18),
      slot('RM', 0.48, 0.85),
      slot('CM', 0.42, 0.64),
      slot('DM', 0.36, 0.5),
      slot('CM', 0.42, 0.36),
      slot('LM', 0.48, 0.15),
      slot('ST', 0.76, 0.5),
    ],
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    label: '4-1-4-1',
    description: 'A screen in front of the defence; disciplined and hard to break down.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.82),
      slot('CB', 0.15, 0.6),
      slot('CB', 0.15, 0.4),
      slot('LB', 0.2, 0.18),
      slot('DM', 0.34, 0.5),
      slot('RM', 0.54, 0.85),
      slot('CM', 0.5, 0.6),
      slot('CM', 0.5, 0.4),
      slot('LM', 0.54, 0.15),
      slot('ST', 0.76, 0.5),
    ],
  },
  '3-5-2': {
    id: '3-5-2',
    label: '3-5-2',
    description: 'Three centre backs, wing-backs doing the running.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('CB', 0.16, 0.68),
      slot('CB', 0.14, 0.5),
      slot('CB', 0.16, 0.32),
      slot('RM', 0.5, 0.88),
      slot('CM', 0.44, 0.62),
      slot('DM', 0.36, 0.5),
      slot('CM', 0.44, 0.38),
      slot('LM', 0.5, 0.12),
      slot('ST', 0.75, 0.42),
      slot('ST', 0.75, 0.58),
    ],
  },
  '5-3-2': {
    id: '5-3-2',
    label: '5-3-2',
    description: 'Deep, narrow and hard to get through. Long trips for the strikers.',
    slots: [
      slot('GK', 0.04, 0.5),
      slot('RB', 0.2, 0.88),
      slot('CB', 0.14, 0.66),
      slot('CB', 0.12, 0.5),
      slot('CB', 0.14, 0.34),
      slot('LB', 0.2, 0.12),
      slot('CM', 0.42, 0.64),
      slot('CM', 0.4, 0.5),
      slot('CM', 0.42, 0.36),
      slot('ST', 0.72, 0.42),
      slot('ST', 0.72, 0.58),
    ],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export function getFormation(id: FormationId): FormationDefinition {
  return FORMATIONS[id] ?? FORMATIONS['4-4-2'];
}

export function formationPositions(id: FormationId): PositionCode[] {
  return getFormation(id).slots.map((s) => s.position);
}

/** Where an outfield position sits vertically (0 = own goal, 1 = opposition goal). */
export function positionAdvancement(position: PositionCode): number {
  return POSITIONS[position].base.x;
}
