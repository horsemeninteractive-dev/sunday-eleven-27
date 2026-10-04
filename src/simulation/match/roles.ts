/**
 * What a player is *for*.
 *
 * A formation says where eleven men stand. Tactics says what the side is trying
 * to do. Neither says what any individual is for, and that is the gap this
 * closes: two sides can set out in the same 4-4-2 with the same instructions
 * and still play football that does not resemble each other, because one has a
 * poacher and one has a false nine. This is the thing the genre is best at, and
 * the engine had no way to express it at all.
 *
 * A role here is deliberately *not* a set of attribute bonuses and not a
 * miniature tactics system. It is four small adjustments to a decision model
 * that already exists:
 *
 *  - **What he is likely to try.** `actionWeights` multiplies the weights
 *    `weighActions` has already computed from zone, pressure and ability. The
 *    base model decides that a ball on the flank in the final third is worth
 *    crossing; the role decides whether *this* man crosses it.
 *  - **Where he may shoot.** `shotZones` is a veto, not a preference: outside
 *    them `shoot` is zero. This is the one place a role can take an option out
 *    of the table entirely, and it is what stops a centre-half volleying the
 *    ball from thirty yards because the base model thought it was a chance.
 *  - **Where he stands.** `depthBias` and `widthBias` nudge his slot, which is
 *    what makes a deep-lying player's side look different in the shape alone.
 *  - **What he does off the ball.** `pressBehaviour` decides who goes and who
 *    holds, and `runsInBehind` decides whether a ball played behind the
 *    defence is even on the menu.
 *
 * Everything is a static table. Roles are not rolled, not saved per player and
 * not learned — a manager picks them, and a save written before roles existed
 * gets the default for each position, which is the same eleven men it already
 * had. That is why the type lives in the simulation rather than on the player:
 * a role is a *matchday* instruction, like the formation and the mentality
 * beside it, not a fact about a man.
 */
import type { FieldZone } from '@/domain/match';
import type { PositionCode } from '@/domain/positions';
import type { MentalAttributes, PhysicalAttributes, TechnicalAttributes } from '@/domain/attributes';
import type { ActionKind } from './actions';

export type Role =
  | 'gk-sweeper'
  | 'gk-shot-stopper'
  | 'cb-defend'
  | 'cb-stopper'
  | 'cb-ball-playing'
  | 'cb-cover'
  | 'fb-defend'
  | 'fb-support'
  | 'fb-attack'
  | 'wb-defend'
  | 'wb-attack'
  | 'dm-anchor'
  | 'dm-ball-winner'
  | 'dm-half-back'
  | 'cm-box-to-box'
  | 'cm-deep-lying'
  | 'cm-mezzala'
  | 'cm-carrilero'
  | 'am-attacking-mid'
  | 'am-shadow-striker'
  | 'w-winger'
  | 'w-inside-forward'
  | 'w-inverted-winger'
  | 'st-poacher'
  | 'st-target-man'
  | 'st-false-nine'
  | 'st-pressing-forward'
  | 'st-complete';

export interface RoleProfile {
  id: Role;
  label: string;
  /** Which positions this role can be assigned to. */
  positions: PositionCode[];
  /** Where he stands relative to the slot's base, -1 (deeper) to +1 (higher). */
  depthBias: number;
  /** Sideways drift, -1 (left) to +1 (right). Ignored for central roles. */
  widthBias: number;
  /**
   * Weight multipliers applied inside `weighActions`, keyed by action kind.
   * Missing kinds are unscaled.
   */
  actionWeights: Partial<Record<ActionKind, number>>;
  /** Extra attribute emphasis when this role is judged (selection, suitability). */
  attributeFocus: Partial<Record<keyof TechnicalAttributes | keyof PhysicalAttributes | keyof MentalAttributes, number>>;
  /** Zones this role is allowed to shoot from. Outside these, `shoot` is 0. */
  shotZones?: FieldZone[];
  /** Whether the role is expected to close down (pressing) or hold position. */
  pressBehaviour: 'hold' | 'press' | 'chase';
  /** Whether the role makes runs beyond the ball. */
  runsInBehind: boolean;
}

/**
 * The table.
 *
 * The multipliers are read as "how much more or less likely is this man, all
 * else being equal", so 1 means "no opinion" and a kind left out means the same
 * thing. They are deliberately small: a 2.4 on a cross is decisive against a
 * 0.6, but neither makes the action inevitable, and the base model's judgement
 * about zone and pressure still decides whether the option exists at all.
 *
 * `shotZones` is the exception and is worth reading twice. Only roles that are
 * *supposed* to score carry it, because it is a veto rather than a nudge. A
 * centre-half, a holding midfielder and a full-back have no business choosing
 * to shoot from their own third, and the base model — which weighs every
 * position's shooting by ability and by nearness to goal — has no way to know
 * that, which is how a third of all shots in the game were being taken from the
 * shooter's own half.
 */
const ROLES: Record<Role, RoleProfile> = {
  // --- Goalkeepers ---------------------------------------------------------
  'gk-sweeper': {
    id: 'gk-sweeper',
    label: 'Sweeper Keeper',
    positions: ['GK'],
    depthBias: 0.06,
    widthBias: 0,
    actionWeights: { pass: 1.35, clear: 0.85, hold: 1.2, shoot: 0 },
    attributeFocus: { passing: 1.2, positioning: 1.1, composure: 1.1, decisions: 1.1 },
    shotZones: [],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },
  'gk-shot-stopper': {
    id: 'gk-shot-stopper',
    label: 'Shot Stopper',
    positions: ['GK'],
    depthBias: -0.05,
    widthBias: 0,
    actionWeights: { pass: 0.85, clear: 1.3, hold: 1.1, shoot: 0 },
    attributeFocus: { goalkeeping: 1.25, positioning: 1.15, composure: 1.1 },
    shotZones: [],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },

  // --- Centre backs -------------------------------------------------------
  'cb-defend': {
    id: 'cb-defend',
    label: 'Defender',
    positions: ['CB'],
    depthBias: -0.03,
    widthBias: 0,
    actionWeights: { clear: 1.2, pass: 0.9, carry: 0.7, shoot: 0, cross: 0.25 },
    attributeFocus: { tackling: 1.2, positioning: 1.2, heading: 1.15, strength: 1.1 },
    shotZones: ['box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'cb-stopper': {
    id: 'cb-stopper',
    label: 'Stopper',
    positions: ['CB'],
    depthBias: 0,
    widthBias: 0,
    actionWeights: { clear: 1.4, pass: 0.75, carry: 0.6, shoot: 0, cross: 0.15 },
    attributeFocus: { tackling: 1.3, strength: 1.25, heading: 1.2, positioning: 1.15 },
    shotZones: ['box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'cb-ball-playing': {
    id: 'cb-ball-playing',
    label: 'Ball-Playing Defender',
    positions: ['CB'],
    depthBias: -0.02,
    widthBias: 0,
    actionWeights: { pass: 1.35, clear: 0.6, carry: 1.2, shoot: 0, cross: 0.3 },
    attributeFocus: { passing: 1.3, ballControl: 1.15, composure: 1.15, tackling: 0.9 },
    shotZones: ['box'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },
  'cb-cover': {
    id: 'cb-cover',
    label: 'Cover Defender',
    positions: ['CB'],
    depthBias: -0.08,
    widthBias: 0,
    actionWeights: { clear: 1.15, pass: 1.05, carry: 0.6, shoot: 0, cross: 0.2 },
    attributeFocus: { positioning: 1.3, tackling: 1.15, decisions: 1.15 },
    shotZones: ['box'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },

  // --- Full backs ---------------------------------------------------------
  'fb-defend': {
    id: 'fb-defend',
    label: 'Defensive Full Back',
    positions: ['RB', 'LB'],
    depthBias: -0.07,
    widthBias: 0.7,
    actionWeights: { clear: 1.25, pass: 0.85, cross: 0.45, carry: 0.7, shoot: 0 },
    attributeFocus: { tackling: 1.25, positioning: 1.2, pace: 1.05 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },
  'fb-support': {
    id: 'fb-support',
    label: 'Supporting Full Back',
    positions: ['RB', 'LB'],
    depthBias: 0,
    widthBias: 0.85,
    actionWeights: { pass: 1.1, carry: 1.1, cross: 1.0, clear: 0.9, shoot: 0.25 },
    attributeFocus: { passing: 1.15, stamina: 1.1, workRate: 1.1 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'fb-attack': {
    id: 'fb-attack',
    label: 'Attacking Full Back',
    positions: ['RB', 'LB'],
    depthBias: 0.09,
    widthBias: 0.8,
    actionWeights: { cross: 1.9, carry: 1.4, pass: 0.9, clear: 0.55, shoot: 0.3 },
    attributeFocus: { crossing: 1.25, pace: 1.2, stamina: 1.2, workRate: 1.15 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'press',
    runsInBehind: true,
  },

  // --- Wing backs ---------------------------------------------------------
  'wb-defend': {
    id: 'wb-defend',
    label: 'Defensive Wing Back',
    positions: ['RB', 'LB', 'RM', 'LM'],
    depthBias: -0.05,
    widthBias: 0.85,
    actionWeights: { clear: 1.15, pass: 0.95, cross: 0.5, carry: 0.8, shoot: 0 },
    attributeFocus: { tackling: 1.2, positioning: 1.2, stamina: 1.15 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },
  'wb-attack': {
    id: 'wb-attack',
    label: 'Attacking Wing Back',
    positions: ['RB', 'LB', 'RM', 'LM'],
    depthBias: 0.11,
    widthBias: 0.75,
    actionWeights: { cross: 1.7, carry: 1.35, pass: 0.95, clear: 0.5, shoot: 0.35 },
    attributeFocus: { crossing: 1.2, pace: 1.2, stamina: 1.25, workRate: 1.15 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'press',
    runsInBehind: true,
  },

  // --- Defensive midfield -------------------------------------------------
  'dm-anchor': {
    id: 'dm-anchor',
    label: 'Anchor',
    positions: ['DM', 'CM'],
    depthBias: -0.06,
    widthBias: 0,
    actionWeights: { pass: 1.15, hold: 1.4, shoot: 0.15, cross: 0.2, clear: 0.9, carry: 0.7 },
    attributeFocus: { positioning: 1.3, tackling: 1.2, decisions: 1.1 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },
  'dm-ball-winner': {
    id: 'dm-ball-winner',
    label: 'Ball Winner',
    positions: ['DM', 'CM'],
    depthBias: -0.03,
    widthBias: 0,
    actionWeights: { clear: 1.15, hold: 1.2, pass: 0.85, shoot: 0.15 },
    attributeFocus: { tackling: 1.35, strength: 1.2, workRate: 1.15, positioning: 1.1 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'chase',
    runsInBehind: false,
  },
  'dm-half-back': {
    id: 'dm-half-back',
    label: 'Half Back',
    positions: ['DM', 'CM'],
    depthBias: 0.05,
    widthBias: 0,
    actionWeights: { pass: 1.2, carry: 1.15, shoot: 0.3, clear: 0.8 },
    attributeFocus: { passing: 1.15, ballControl: 1.15, stamina: 1.15, positioning: 1.05 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },

  // --- Central midfield ---------------------------------------------------
  'cm-box-to-box': {
    id: 'cm-box-to-box',
    label: 'Box to Box',
    positions: ['CM', 'DM'],
    depthBias: 0,
    widthBias: 0,
    actionWeights: { carry: 1.25, shoot: 1.1, pass: 1.05, through: 1.15, clear: 0.8 },
    attributeFocus: { stamina: 1.3, workRate: 1.25, passing: 1.05, pace: 1.1 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'chase',
    runsInBehind: false,
  },
  'cm-deep-lying': {
    id: 'cm-deep-lying',
    label: 'Deep Lying Playmaker',
    positions: ['CM', 'DM'],
    depthBias: -0.07,
    widthBias: 0,
    actionWeights: { pass: 1.45, switch: 1.3, through: 1.25, carry: 0.85, shoot: 0.4, clear: 0.8, cross: 0.5 },
    attributeFocus: { passing: 1.3, composure: 1.2, decisions: 1.2 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },
  'cm-mezzala': {
    id: 'cm-mezzala',
    label: 'Mezzala',
    positions: ['CM', 'AM'],
    depthBias: 0.06,
    widthBias: 0,
    actionWeights: { carry: 1.35, pass: 1.15, shoot: 0.95, dribble: 1.15, through: 1.1 },
    attributeFocus: { ballControl: 1.2, agility: 1.15, passing: 1.15, composure: 1.1 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'cm-carrilero': {
    id: 'cm-carrilero',
    label: 'Carrilero',
    positions: ['CM'],
    depthBias: -0.02,
    widthBias: 0.6,
    actionWeights: { switch: 1.45, cross: 1.25, pass: 1.15, carry: 0.95, shoot: 0.5 },
    attributeFocus: { passing: 1.2, crossing: 1.15, stamina: 1.15, composure: 1.1 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'hold',
    runsInBehind: false,
  },

  // --- Attacking midfield -------------------------------------------------
  'am-attacking-mid': {
    id: 'am-attacking-mid',
    label: 'Attacking Midfielder',
    positions: ['AM', 'CM'],
    depthBias: 0.06,
    widthBias: 0,
    actionWeights: { pass: 1.25, shoot: 1.3, through: 1.35, carry: 1.15, dribble: 1.1, cross: 1.1 },
    attributeFocus: { passing: 1.2, shooting: 1.15, composure: 1.2 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'am-shadow-striker': {
    id: 'am-shadow-striker',
    label: 'Shadow Striker',
    positions: ['AM', 'ST', 'CM'],
    depthBias: 0.11,
    widthBias: 0,
    actionWeights: { shoot: 1.5, through: 1.2, carry: 1.1, pass: 1.05, hold: 0.7 },
    attributeFocus: { shooting: 1.25, composure: 1.15, pace: 1.15 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: true,
  },

  // --- Wide forwards ------------------------------------------------------
  'w-winger': {
    id: 'w-winger',
    label: 'Winger',
    positions: ['RW', 'LW', 'RM', 'LM'],
    depthBias: 0.04,
    widthBias: 0.9,
    actionWeights: { cross: 2.4, dribble: 1.5, carry: 1.3, pass: 0.85, shoot: 0.8 },
    attributeFocus: { crossing: 1.25, pace: 1.2, agility: 1.15, ballControl: 1.1 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'hold',
    runsInBehind: true,
  },
  'w-inside-forward': {
    id: 'w-inside-forward',
    label: 'Inside Forward',
    positions: ['RW', 'LW', 'RM', 'LM'],
    depthBias: 0.02,
    widthBias: 0.55,
    actionWeights: { carry: 1.4, dribble: 1.3, shoot: 1.15, pass: 1.05, cross: 0.35, through: 1.05 },
    attributeFocus: { ballControl: 1.2, agility: 1.15, shooting: 1.15 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'w-inverted-winger': {
    id: 'w-inverted-winger',
    label: 'Inverted Winger',
    positions: ['RW', 'LW', 'RM', 'LM'],
    depthBias: 0.02,
    widthBias: 0.3,
    actionWeights: { shoot: 1.6, through: 1.3, cross: 0.6, carry: 1.05, pass: 1.1 },
    attributeFocus: { shooting: 1.25, passing: 1.15, composure: 1.15 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: true,
  },

  // --- Strikers -----------------------------------------------------------
  'st-poacher': {
    id: 'st-poacher',
    label: 'Poacher',
    positions: ['ST'],
    depthBias: 0.08,
    widthBias: 0,
    actionWeights: { shoot: 2.2, pass: 0.55, carry: 0.4, clear: 0.1, cross: 0.15, hold: 0.6 },
    attributeFocus: { shooting: 1.3, composure: 1.2, positioning: 1.25 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'hold',
    runsInBehind: true,
  },
  'st-target-man': {
    id: 'st-target-man',
    label: 'Target Man',
    positions: ['ST'],
    depthBias: 0.05,
    widthBias: 0,
    actionWeights: { hold: 1.9, shoot: 1.2, cross: 0.2, clear: 0.4, pass: 0.8, carry: 0.5 },
    attributeFocus: { heading: 1.35, strength: 1.3, ballControl: 1.1, positioning: 1.15 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'hold',
    runsInBehind: true,
  },
  'st-false-nine': {
    id: 'st-false-nine',
    label: 'False Nine',
    positions: ['ST', 'AM', 'CM'],
    depthBias: -0.08,
    widthBias: 0,
    actionWeights: { pass: 1.5, through: 1.6, shoot: 0.7, carry: 1.1, clear: 0.2, cross: 0.5 },
    attributeFocus: { passing: 1.3, ballControl: 1.2, composure: 1.2 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'press',
    runsInBehind: false,
  },
  'st-pressing-forward': {
    id: 'st-pressing-forward',
    label: 'Pressing Forward',
    positions: ['ST'],
    depthBias: 0.02,
    widthBias: 0,
    actionWeights: { pass: 1.1, shoot: 1.05, carry: 1.15, hold: 1.1, clear: 0.6 },
    attributeFocus: { workRate: 1.3, pace: 1.2, strength: 1.1, determination: 1.15 },
    shotZones: ['final-third', 'box'],
    pressBehaviour: 'chase',
    runsInBehind: false,
  },
  'st-complete': {
    id: 'st-complete',
    label: 'Complete Forward',
    positions: ['ST'],
    depthBias: 0.03,
    widthBias: 0,
    actionWeights: { shoot: 1.2, pass: 1.2, carry: 1.25, hold: 1.25, cross: 0.7, through: 1.05 },
    attributeFocus: { shooting: 1.15, passing: 1.15, ballControl: 1.2, strength: 1.1, composure: 1.1 },
    shotZones: ['box', 'final-third'],
    pressBehaviour: 'hold',
    runsInBehind: true,
  },
};

export const ALL_ROLES: readonly Role[] = Object.keys(ROLES) as Role[];

/**
 * How much a long-range effort is worth against one from inside the box.
 *
 * Steep on purpose. It has to be far enough below 1 that a shot from thirty
 * yards remains a rarity the base model has to earn, and it was set by the
 * balance bench rather than by taste: the figure that put goals-per-match back
 * inside a few percent of where they were before roles existed.
 */
const LONG_SHOT_DISCOUNT = 0.55;

/** The profile for a role, or the profile for his position if the role is unknown. */
export function roleProfile(role: Role | null | undefined): RoleProfile {
  return (role && ROLES[role]) || defaultRoleProfile('CM');
}

/** Every role that can legally be assigned to a position. */
export function rolesForPosition(position: PositionCode): readonly RoleProfile[] {
  return ALL_ROLES.map((id) => ROLES[id]).filter((profile) => profile.positions.includes(position));
}

/** Whether a role may be assigned to a position at all. */
export function roleFitsPosition(role: Role, position: PositionCode): boolean {
  const profile = ROLES[role];
  return Boolean(profile && profile.positions.includes(position));
}

const CM: PositionCode = 'CM';

/**
 * The role a player is given when nobody has chosen one.
 *
 * This is what makes roles an instruction rather than a fact about a man: a
 * career written before roles existed wakes up with exactly the eleven it had,
 * and a manager who never touches the role screen never notices the feature.
 * The defaults are the most *ordinary* version of each position — the poacher
 * is not the default striker, because a league full of poachers would be a
 * different game, and `npm run balance` is the thing that notices.
 */
const DEFAULT_ROLE_BY_POSITION: Record<PositionCode, Role> = {
  GK: 'gk-shot-stopper',
  CB: 'cb-defend',
  RB: 'fb-support',
  LB: 'fb-support',
  DM: 'dm-anchor',
  CM: 'cm-box-to-box',
  AM: 'am-attacking-mid',
  RM: 'w-inside-forward',
  LM: 'w-inside-forward',
  RW: 'w-winger',
  LW: 'w-winger',
  ST: 'st-complete',
};

/** The role a position defaults to. */
export function defaultRoleFor(position: PositionCode): Role {
  return DEFAULT_ROLE_BY_POSITION[position] ?? 'cm-box-to-box';
}

/** The profile for a position's default role. */
export function defaultRoleProfile(position: PositionCode): RoleProfile {
  return ROLES[DEFAULT_ROLE_BY_POSITION[position]] ?? ROLES[DEFAULT_ROLE_BY_POSITION[CM]];
}

/**
 * The weight a role gives one action.
 *
 * A pure multiplier: the situational veto on shooting lives in
 * {@link mayShootFrom}, which knows which zone the ball is in and this function
 * does not. They were once the same thing, and having the veto here as well
 * meant `weighActions` — which checks the zone first — was handed a zero
 * anyway, so every role with a `shotZones` list never took a shot at all.
 */
export function weightFor(profile: RoleProfile, kind: ActionKind): number {
  return profile.actionWeights[kind] ?? 1;
}

/** Whether a role may choose to shoot from this zone at all. */
export function mayShootFrom(profile: RoleProfile, zone: FieldZone): boolean {
  if (!profile.shotZones) return true;
  if (profile.shotZones.includes(zone)) return true;
  // The one softening in the table, and it is a measured one rather than a
  // preferred one. A hard veto in the middle third was tried and it cost a
  // quarter of all shots and a third of the goals, because "a man may not shoot
  // from thirty yards" turns out to mean "a match contains no shots from thirty
  // yards" — and those are a real and frequent part of football, not a symptom
  // of the bug.
  //
  // What the veto is actually for is shooting from your *own* half, so that is
  // what it still refuses: 'own-box' and 'own-third' are never allowed through
  // for anybody. 'middle' is allowed, at a steep discount applied in
  // `shootWeightFor`, so a long-range effort is still something a man does
  // occasionally and by choice rather than something the engine never considers.
  return zone === 'middle' && profile.shotZones.includes('final-third');
}

/**
 * What a long-range effort is worth, once the veto has let it through.
 *
 * This is a *discount on top of* the role's own `shoot` multiplier rather than
 * a replacement for it, so a shadow striker thirty yards out is still a better
 * prospect for the effort than an anchor, and both are worse than either of
 * them inside the box. The veto itself is not applied here — `weighActions`
 * checks that separately, because a veto has to be able to say no where a
 * discount can only ever say less.
 */
export function longShotPenalty(zone: FieldZone): number {
  return zone === 'middle' ? LONG_SHOT_DISCOUNT : 1;
}
/**
 * Give every slot in a career a role, in place.
 *
 * Used by the save migration. A lineup written before roles existed has a
 * position and nothing else, and the fix is the default for that position — so
 * the migration is total and idempotent: running it twice on the same career
 * changes nothing the second time, and a slot the manager has since given a
 * real role keeps it.
 */
export function ensureLineupRoles(state: {
  matches: Record<string, { lineups: Record<'home' | 'away', { starting: Array<{ role?: Role; position: PositionCode }>; bench: Array<{ role?: Role; position: PositionCode }> }> }>;
}): void {
  for (const match of Object.values(state.matches)) {
    for (const side of ['home', 'away'] as const) {
      const lineup = match.lineups[side];
      if (!lineup) continue;
      for (const slot of lineup.starting) if (!slot.role) slot.role = defaultRoleFor(slot.position);
      for (const slot of lineup.bench) if (!slot.role) slot.role = defaultRoleFor(slot.position);
    }
  }
}
