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

/**
 * The goalkeeper's own line, and how far across his goal he may stand.
 *
 * He is the one member of the side with no zone to adapt to — a dot dropped in
 * his box does not make anybody a goalkeeper — so he is not moved to a zone but
 * along his line. Both clamps are named here rather than written into the pitch
 * and the rule separately, because a drawing and a rule that disagree is how a
 * dot ends up somewhere the manager did not put it.
 */
export const KEEPER_LINE = POSITIONS.GK.base.x;
export const KEEPER_ACROSS: readonly [number, number] = [0.26, 0.74];

/**
 * The deepest row a man in front of the keeper may stand in: the six-yard line.
 *
 * A centre half pushed right back is standing on the edge of his own six-yard
 * box and no deeper, and it is a football number rather than a drawing one
 * because the picture is drawn *from* these numbers: a defender moved back is
 * drawn as far back as the pitch can honestly show him, rather than stopping at
 * a line the drawing invented for itself. It has to stay strictly deeper than
 * `KEEPER_LINE`, which is the row the keeper is given behind the defence — if
 * the two met, a defender could be stood, and drawn, on his own goalkeeper.
 */
export const OUTFIELD_LINE = 0.06;

export const ALL_POSITION_CODES = Object.keys(POSITIONS) as PositionCode[];

/** The lines of a team, in the order a team sheet is read: keeper, back, middle, front. */
export const POSITION_GROUP_ORDER: PositionGroup[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * How far up the team sheet a job is.
 *
 * A keeper comes before a right back and a right back before a striker: the
 * order a manager reads his own side in, from his own goal outwards. The squad
 * screen and the selection screen both order a list by it, so the two of them
 * read the same way — see `squadInTeamOrder` in `ui/lineupEditing`.
 */
export function positionRank(position: PositionCode): number {
  return POSITION_GROUP_ORDER.indexOf(POSITIONS[position].group) * 100 + ALL_POSITION_CODES.indexOf(position);
}

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

/** A side is eleven. A stored shape that is not eleven is not a shape. */
const SHAPE_LENGTH = 11;

/**
 * A shape of the manager's own, kept under a name.
 *
 * Once it is applied it is a formation like any other; the difference is where
 * it came from. `base` is the named formation it was built from, which is what
 * a player's familiarity with the system is measured against — a manager who
 * moves a full back five yards has not asked his squad to learn a new game.
 */
export interface CustomFormation {
  id: string;
  name: string;
  base: FormationId;
  slots: FormationSlot[];
}

/**
 * The eleven positions a side is set up in.
 *
 * A manager who has moved anybody on the preparation pitch has a shape of his
 * own, and that shape is what the side plays — the named formation is only what
 * it was built from. Everything that needs to know where a side lines up (the
 * picture before kick-off, the assistant's auto-pick, the engine's own anchors)
 * reads it through here, so a custom shape cannot take effect on one screen and
 * be quietly replaced by a 4-4-2 in the match.
 */
export function formationSlots(formation: string, shape?: readonly FormationSlot[]): FormationSlot[] {
  return shape && shape.length === SHAPE_LENGTH ? [...shape] : getFormation(formation as FormationId).slots;
}

/** Whether a shape is still exactly the named formation it was built from. */
export function isNamedShape(formation: FormationId, shape?: readonly FormationSlot[]): boolean {
  if (!shape || shape.length !== SHAPE_LENGTH) return true;
  const named = getFormation(formation).slots;
  return shape.every((slot, index) => {
    const other = named[index]!;
    return (
      slot.position === other.position &&
      Math.abs(slot.x - other.x) < 0.005 &&
      Math.abs(slot.y - other.y) < 0.005
    );
  });
}

/**
 * The position a man takes when he is dropped here.
 *
 * This is the rule that makes free positioning mean something. The pitch is the
 * manager's — a dot goes wherever he puts it — but the game's football has a
 * fixed vocabulary of positions, and a man dropped in a zone *becomes* the
 * position that zone is for: the nearest position's own spot wins. Drop a
 * centre half on the left touchline and he is a left back.
 *
 * `outfieldOnly` is for the outfield slots: nobody becomes a goalkeeper because
 * a dot was dragged into the six-yard box.
 */
export function positionForPoint(x: number, y: number, options: { outfieldOnly?: boolean } = {}): PositionCode {
  let best: PositionCode = options.outfieldOnly ? 'CB' : 'GK';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const code of ALL_POSITION_CODES) {
    if (options.outfieldOnly && code === 'GK') continue;
    const base = POSITIONS[code].base;
    const distance = (base.x - x) ** 2 + (base.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = code;
    }
  }
  return best;
}

/** Where an outfield position sits vertically (0 = own goal, 1 = opposition goal). */
export function positionAdvancement(position: PositionCode): number {
  return POSITIONS[position].base.x;
}
