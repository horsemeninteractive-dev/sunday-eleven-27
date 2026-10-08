import type { Club } from '@/domain/club';
import type { FormationId, PositionCode } from '@/domain/positions';
import type {
  AttackingFocus,
  DefensiveLine,
  Mentality,
  PassingStyle,
  PressingIntensity,
  Tactics,
  Tempo,
} from '@/domain/tactics';
import { defaultTactics } from '@/domain/tactics';
import type { Role } from '../match/roles';
import type { Rng } from '../rng';

/**
 * What a club's football *is*.
 *
 * Until now an AI club had a tactics block and nothing else: a set of
 * instructions that happened to have been rolled when the world was made, and
 * which never changed again. That is a formation, not a manager. This is the
 * missing half — the character behind the instructions, which is what lets a
 * Sunday side be *recognisable*: the same eleven lining up the same way every
 * week, doing the same things on purpose.
 *
 * It is deliberately derived rather than stored. A club's identity is a
 * function of the club it belongs to — its standing in the county, the
 * instructions it holds — so an old save wakes up with a personality it always
 * had, nothing has to be migrated, and two runs of the same seed produce the
 * same league. The `Tactics` block stays the single source of truth for *how*
 * the side sets up; this says how far the man in charge will go with it.
 *
 * Read it as a manager, not a slider: `ambition` is how much of the game he
 * wants played in the other half, `flexibility` is how quickly he will abandon
 * a plan that is not working. Both are used only by {@link ../ai/manager} —
 * nothing here decides any football.
 */
export interface ClubStyle {
  /** The instructions he sends them out with, which is where selection starts. */
  mentality: Mentality;
  formation: FormationId;
  passingStyle: PassingStyle;
  tempo: Tempo;
  pressing: PressingIntensity;
  defensiveLine: DefensiveLine;
  attackingFocus: AttackingFocus;
  /** 0..1 — how much of the game this manager wants in the opposition half. */
  ambition: number;
  /** 0..1 — how readily he changes his plan when the afternoon turns. */
  flexibility: number;
  /** A short phrase for the scouting line on the other manager's screen. */
  label: string;
}

const MENTALITY_STEPS: Mentality[] = ['very-defensive', 'defensive', 'balanced', 'attacking', 'very-attacking'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * A stable 0..1 from a club's id.
 *
 * The only input here that is not football: two clubs with the same standing
 * and the same instructions should still not be the same team, and this is what
 * stops them being one. It is a hash rather than a roll so it is the same every
 * time anybody asks — a club's character cannot change because it was read
 * twice.
 */
function flavour(id: string): number {
  let hash = 7;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 100003;
  return (hash % 997) / 997;
}

/** How far a club's standing says it should be on the front foot, 0..1. */
function standingTier(reputation: number): number {
  return clamp((reputation - 25) / 45, 0, 1);
}

/**
 * How aggressive a set of instructions is, 0..1, from the instructions alone.
 *
 * This is what stops a club being described as ambitious while sitting on its
 * own eighteen-yard line: the identity's appetite is read partly off what the
 * side is actually being asked to do, and partly off the standing the county
 * gives it.
 */
function tacticalAggression(tactics: Tactics): number {
  let score = 0.5 + (MENTALITY_STEPS.indexOf(tactics.mentality) - 2) * 0.09;
  if (tactics.defensiveLine === 'high') score += 0.08;
  if (tactics.defensiveLine === 'deep') score -= 0.08;
  if (tactics.pressing === 'high') score += 0.08;
  if (tactics.pressing === 'low') score -= 0.06;
  if (tactics.tempo === 'high') score += 0.05;
  if (tactics.tempo === 'slow') score -= 0.05;
  if (tactics.attackingFocus === 'wide') score += 0.03;
  return clamp(score, 0, 1);
}

/** A phrase a manager would recognise, from the two most distinctive choices. */
function styleLabel(tactics: Tactics): string {
  const parts: string[] = [];
  if (tactics.mentality === 'very-attacking' || tactics.mentality === 'attacking') parts.push('Positive');
  else if (tactics.mentality === 'very-defensive' || tactics.mentality === 'defensive') parts.push('Cagey');
  if (tactics.pressing === 'high') parts.push('press high');
  else if (tactics.pressing === 'low') parts.push('sit off');
  if (tactics.passingStyle === 'direct') parts.push('get it forward early');
  else if (tactics.passingStyle === 'short') parts.push('keep it on the deck');
  if (tactics.attackingFocus === 'wide') parts.push('work it wide');
  else if (tactics.attackingFocus === 'central') parts.push('play through the middle');
  if (parts.length < 2) {
    if (tactics.tempo === 'high') parts.push('high tempo');
    else if (tactics.tempo === 'slow') parts.push('slow build-up');
  }
  return parts.slice(0, 2).join(', ') || 'Ordinary Sunday football';
}

/** The football a club plays, derived from the club itself. */
export function clubStyle(club: Pick<Club, 'id' | 'reputation' | 'tactics'>): ClubStyle {
  const tactics = club.tactics ?? defaultTactics();
  const tier = standingTier(club.reputation);
  const flavourSeed = flavour(club.id);
  // A club's appetite is mostly its standing and its own instructions, and a
  // little bit just it: two sides with equal standing and equal ideas are still
  // not the same club, and one of them plays a shade further up the pitch.
  const ambition = clamp(
    0.5 * tacticalAggression(tactics) + 0.5 * tier + (flavourSeed - 0.5) * 0.16,
    0.08,
    0.96,
  );
  const flexibility = clamp(
    0.28 +
      flavourSeed * 0.3 +
      (tactics.tempo === 'high' ? 0.14 : tactics.tempo === 'slow' ? -0.06 : 0) +
      (tactics.pressing === 'high' ? 0.12 : tactics.pressing === 'low' ? -0.06 : 0) +
      (ambition > 0.6 ? 0.08 : 0),
    0.15,
    0.9,
  );
  return {
    mentality: tactics.mentality,
    formation: tactics.formation,
    passingStyle: tactics.passingStyle,
    tempo: tactics.tempo,
    pressing: tactics.pressing,
    defensiveLine: tactics.defensiveLine,
    attackingFocus: tactics.attackingFocus,
    ambition,
    flexibility,
    label: styleLabel(tactics),
  };
}

/** The instructions a style sets out with, as a plain `Tactics` block. */
export function tacticsForStyle(style: ClubStyle, formation: FormationId = style.formation): Tactics {
  return {
    ...defaultTactics(formation),
    mentality: style.mentality,
    passingStyle: style.passingStyle,
    tempo: style.tempo,
    pressing: style.pressing,
    defensiveLine: style.defensiveLine,
    attackingFocus: style.attackingFocus,
  };
}

/**
 * The opening instructions a club is given when the world is generated.
 *
 * The old world handed every club an independent roll of the same dice, which
 * meant the county contained roughly equal numbers of pressing sides and of
 * sides who never left their own half, with no relationship to who was any
 * good. A Sunday league is not like that and never has been: the sides with the
 * players have a go, and the sides without them make themselves hard to beat and
 * get it forward. Standing decides the odds; the roll decides the club.
 */
export function styleTactics(rng: Rng, reputation: number): Tactics {
  const tier = standingTier(reputation);
  const positive = tier > 0.62;
  const negative = tier < 0.36;

  const formations: FormationId[] = negative
    ? ['4-5-1', '4-4-2', '5-3-2', '4-1-4-1', '4-4-1-1']
    : positive
      ? ['4-4-2', '4-3-3', '4-2-3-1', '4-4-1-1', '3-5-2']
      : ['4-4-2', '4-4-2', '4-4-1-1', '4-1-4-1', '4-2-3-1', '3-5-2'];

  // The dice are deliberately *not* thrown as widely as the identity table could
  // take: the most extreme instruction available to a manager is a decision he
  // makes during a match, not the shirt he puts on in August. A world in which a
  // quarter of the best sides set out very attacking, high and fast from the
  // first whistle was measured at twenty-five shots a match against a background
  // model of seventeen — two resolutions of one football drifting apart, which is
  // the one thing this project does not do. So the standing decides the odds and
  // the roll decides the club, and the tails of both stay in the drawer until a
  // manager is losing and reaches for them.
  const mentality: Mentality = positive
    ? rng.pick(['attacking', 'attacking', 'balanced', 'balanced'] as const)
    : negative
      ? rng.pick(['defensive', 'defensive', 'defensive', 'balanced'] as const)
      : rng.pick(['balanced', 'balanced', 'defensive', 'attacking'] as const);

  const passingStyle: PassingStyle = negative
    ? rng.pick(['direct', 'direct', 'mixed'] as const)
    : positive
      ? rng.pick(['mixed', 'short', 'mixed', 'short'] as const)
      : rng.pick(['mixed', 'mixed', 'short', 'direct'] as const);

  const tempo: Tempo = positive
    ? rng.pick(['standard', 'standard', 'high'] as const)
    : negative
      ? rng.pick(['slow', 'standard', 'standard'] as const)
      : rng.pick(['standard', 'standard', 'slow', 'high'] as const);

  const pressing: PressingIntensity = positive
    ? rng.pick(['medium', 'medium', 'high'] as const)
    : negative
      ? rng.pick(['low', 'medium', 'medium'] as const)
      : rng.pick(['medium', 'medium', 'low', 'high'] as const);

  const defensiveLine: DefensiveLine = positive
    ? rng.pick(['standard', 'standard', 'high'] as const)
    : negative
      ? rng.pick(['deep', 'deep', 'standard'] as const)
      : rng.pick(['standard', 'standard', 'deep', 'high'] as const);

  const attackingFocus: AttackingFocus =
    passingStyle === 'direct'
      ? rng.pick(['wide', 'wide', 'balanced'] as const)
      : positive
        ? rng.pick(['balanced', 'central', 'wide'] as const)
        : rng.pick(['balanced', 'balanced', 'central'] as const);

  return { ...defaultTactics(rng.pick(formations)), mentality, passingStyle, tempo, pressing, defensiveLine, attackingFocus };
}

/**
 * The jobs a system asks of each position, best-fitting first.
 *
 * The first entry is always the *ordinary* version of the position — the job
 * `defaultRoleFor` gives it — and everything after it is a specialisation the
 * instructions call for. Order is the tie-break: a system that says nothing in
 * particular gets the ordinary job, and a specialisation has to be a genuinely
 * better fit for the man than the ordinary one before it is used. That is what
 * keeps a balanced league playing recognisable football while a direct,
 * physical side sends out a target man.
 */
export function roleCandidates(position: PositionCode, tactics: Tactics): Role[] {
  const positive = tactics.mentality === 'attacking' || tactics.mentality === 'very-attacking';
  const negative = tactics.mentality === 'defensive' || tactics.mentality === 'very-defensive';
  const possession = tactics.passingStyle === 'short';
  const direct = tactics.passingStyle === 'direct';
  const press = tactics.pressing === 'high';
  const sitsOff = tactics.pressing === 'low';
  const wide = tactics.attackingFocus === 'wide';
  const central = tactics.attackingFocus === 'central';
  const highLine = tactics.defensiveLine === 'high';
  const deepLine = tactics.defensiveLine === 'deep';

  switch (position) {
    case 'GK':
      return possession || highLine ? ['gk-shot-stopper', 'gk-sweeper'] : ['gk-shot-stopper'];
    case 'CB': {
      const roles: Role[] = ['cb-defend'];
      if (direct || sitsOff || deepLine) roles.push('cb-stopper');
      if (possession || highLine) roles.push('cb-ball-playing');
      if (deepLine && negative) roles.push('cb-cover');
      return roles;
    }
    case 'RB':
    case 'LB': {
      const roles: Role[] = ['fb-support'];
      if (negative || sitsOff || deepLine) roles.push('fb-defend');
      if (positive || wide || press) roles.push('fb-attack');
      return roles;
    }
    case 'DM': {
      const roles: Role[] = ['dm-anchor'];
      if (press || direct) roles.push('dm-ball-winner');
      if (possession) roles.push('dm-half-back');
      return roles;
    }
    case 'CM': {
      const roles: Role[] = ['cm-box-to-box'];
      if (possession) roles.push('cm-deep-lying');
      if (central || positive) roles.push('cm-mezzala');
      return roles;
    }
    case 'AM': {
      const roles: Role[] = ['am-attacking-mid'];
      if (positive) roles.push('am-shadow-striker');
      return roles;
    }
    case 'RM':
    case 'LM': {
      const roles: Role[] = ['w-inside-forward'];
      if (wide || direct) roles.push('w-winger');
      if (central || possession) roles.push('w-inverted-winger');
      return roles;
    }
    case 'RW':
    case 'LW': {
      const roles: Role[] = ['w-winger'];
      if (central || possession) roles.push('w-inside-forward');
      if (positive && central) roles.push('w-inverted-winger');
      return roles;
    }
    case 'ST': {
      const roles: Role[] = ['st-complete'];
      if (direct || wide) roles.push('st-target-man');
      if (positive) roles.push('st-poacher');
      if (possession || central) roles.push('st-false-nine');
      return roles;
    }
    default:
      return ['cm-box-to-box'];
  }
}
