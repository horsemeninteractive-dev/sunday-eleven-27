/**
 * Roles, and what they are for.
 *
 * A role is the last thing standing between "the engine knows how to build a
 * move" and "this side builds this kind of move". Everything else in the model —
 * attributes, tactics, the situation — describes the match a man is in; the role
 * describes the man. That is why almost every assertion here is a comparison
 * rather than an absolute: the claim being made is not "a poacher shoots more
 * often" but "a poacher is *more inclined to* shoot than a false nine, given
 * exactly the same man in exactly the same situation". A role that could only
 * ever be demonstrated by absolute numbers would pass just as well with a
 * broken decision model underneath it.
 *
 * The own-half shooting symptom itself is *not* duplicated here. It lives in
 * `realism.test.ts` with the other measured symptoms, because that file is a
 * record of things that were seen on screen and written down so each fix has
 * something to prove itself against. It was watched fail before roles existed,
 * and it is watched again after; keeping one copy of it means there is one place
 * that knows a shot from your own half is a bug.
 */
import { describe, expect, it } from 'vitest';
import type { FieldZone } from '@/domain/match';
import { FORMATION_IDS, type PositionCode } from '@/domain/positions';
import type { ActionContext } from './actions';
import { weighActions } from './actions';
import { ALL_ROLES, roleFitsPosition, roleProfile, type Role } from './roles';
import { autoPickLineup } from '../selection';
import { createTestGame } from '../testSupport';
import { isPlayer } from '@/domain/person';

/** A man of ordinary ability, so nothing here is decided by the ratings. */
const EFFECTIVE = {
  passing: 12,
  shooting: 12,
  tackling: 12,
  ballControl: 12,
  crossing: 12,
  heading: 12,
  goalkeeping: 1,
  pace: 12,
  stamina: 12,
  strength: 12,
  agility: 12,
  positioning: 12,
  decisions: 12,
  composure: 12,
  workRate: 12,
  determination: 12,
  discipline: 12,
  aggression: 12,
};

/** Neutral tactics, so the side's instructions are not what is being measured. */
const TACTICS = {
  formation: '4-4-2',
  mentality: 'balanced',
  passingStyle: 'mixed',
  tempo: 'standard',
  pressing: 'medium',
  defensiveLine: 'standard',
  attackingFocus: 'balanced',
} as const;

const PROFILE = {
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
} as const;

/**
 * The same decision, offered to two different men.
 *
 * Only the role differs. Position, pressure, where the ball is, how much room
 * he has, how good he is, what his side has told him — all identical. Whatever
 * the weights end up saying, it is saying it about the role.
 */
function decide(role: Role, overrides: Partial<ActionContext> = {}) {
  const ctx: ActionContext = {
    position: 'ST' as PositionCode,
    role: roleProfile(role),
    isKeeper: false,
    progress: 0.82,
    y: 0.5,
    zone: 'box' as FieldZone,
    pressure: 0.4,
    optionsTotal: 6,
    optionsAhead: 3,
    runnersAhead: 1,
    optionsWide: 2,
    effective: EFFECTIVE,
    energy: 100,
    profile: PROFILE,
    tactics: TACTICS,
    urgency: 0,
    retaining: false,
    counter: false,
    ...overrides,
  };
  return weighActions(ctx);
}

/** The weight one action was given, or 0 if the role took it off the table. */
function weightOf(role: Role, kind: string, overrides: Partial<ActionContext> = {}): number {
  return decide(role, overrides).find((option) => option.kind === kind)?.weight ?? 0;
}

/** One real club's squad, taken the same way a matchday builds it. */
function leagueSquad(seed: string) {
  const { state, draft } = createTestGame(seed);
  const club = state.clubs[draft.divisionClubIds[0]!]!;
  return club.squadIds.map((id) => state.people[id]).filter(isPlayer);
}

describe('roles', () => {
  // The clearest statement of what a role is: same man, same ball, same
  // everything, and the only reason one is more willing to pull the trigger is
  // that he is paid to stand on the shoulder of the last defender.
  it('makes a poacher a keener shot than a false nine', () => {
    const poacher = weightOf('st-poacher', 'shoot');
    const falseNine = weightOf('st-false-nine', 'shoot');
    expect(poacher, `poacher ${poacher.toFixed(3)} vs false nine ${falseNine.toFixed(3)}`).toBeGreaterThan(falseNine);
  });

  // The mirror image, and the one that matters more in a real season: a
  // ball-playing centre-half is a *better distributor* than a stopper, and that
  // is the whole reason a manager picks one over the other. It has to show up as
  // a weight, not just as a label.
  it('makes a ball-playing centre-half a better passer than a stopper', () => {
    const passing = weightOf('cb-ball-playing', 'pass', { position: 'CB', progress: 0.5, zone: 'own-third' });
    const stopper = weightOf('cb-stopper', 'pass', { position: 'CB', progress: 0.5, zone: 'own-third' });
    expect(passing, `ball-playing ${passing.toFixed(3)} vs stopper ${stopper.toFixed(3)}`).toBeGreaterThan(stopper);
  });

  // Wide men live the same decision differently. A winger crosses it; an
  // inverted winger cuts inside and shoots. Both are wide, both are on the
  // flank, both have the ball in front of them.
  it('makes a winger more inclined to cross than an inverted one', () => {
    const wide = { position: 'RW' as PositionCode, progress: 0.78, zone: 'final-third' as FieldZone, y: 0.86 };
    const winger = weightOf('w-winger', 'cross', wide);
    const inverted = weightOf('w-inverted-winger', 'cross', wide);
    expect(winger, `winger ${winger.toFixed(3)} vs inverted ${inverted.toFixed(3)}`).toBeGreaterThan(inverted);
  });

  // The symmetry of the third test, which is what stops the second from being a
  // trick: the inverted winger has to be *better* at the thing he is for. If a
  // role only ever adds weight and never subtracts it, then every man is simply
  // better at everything, and the feature is a difficulty slider wearing a
  // football shirt.
  it('gives the inverted winger the shot the winger does not take', () => {
    const wide = { position: 'RW' as PositionCode, progress: 0.74, zone: 'final-third' as FieldZone, y: 0.6 };
    expect(weightOf('w-inverted-winger', 'shoot', wide)).toBeGreaterThan(weightOf('w-winger', 'shoot', wide));
  });

  // The veto, which is the one place a role is allowed to remove an option
  // rather than merely reweight it. A centre-half standing in his own third
  // cannot choose to shoot at all, however good the chance looks on paper and
  // however urgently his side is chasing the game.
  it('takes shooting away from a role that is not allowed to shoot there', () => {
    const context: Partial<ActionContext> = { position: 'CB', progress: 0.2, zone: 'own-half' as FieldZone, urgency: 1 };
    expect(weightOf('cb-defend', 'shoot', context)).toBe(0);
    expect(weightOf('cb-defend', 'pass', context)).toBeGreaterThan(0);
  });

  // A through ball into a channel nobody in this side ever runs into is not a
  // decision, it is a hopeful punt with a nice name. It is only on the menu
  // when somebody is actually going to chase it.
  it('offers a through ball only when somebody will run in behind', () => {
    const withRunner = weightOf('cm-deep-lying', 'through', { position: 'CM', progress: 0.5, zone: 'middle', runnersAhead: 1 });
    const withoutRunner = weightOf('cm-deep-lying', 'through', { position: 'CM', progress: 0.5, zone: 'middle', runnersAhead: 0 });
    expect(withRunner).toBeGreaterThan(0);
    expect(withoutRunner).toBe(0);
  });

  // Every role has to be assignable to at least one position, and every position
  // it claims has to be one it is actually allowed there. A table with a typo in
  // it fails here rather than in the manager's drop-down, where nobody would be
  // looking.
  it('gives every role a legal home, and every role a reachable one', () => {
    expect(ALL_ROLES.length).toBe(28);
    for (const role of ALL_ROLES) {
      const profile = roleProfile(role);
      expect(profile.id, `${role} does not resolve to itself`).toBe(role);
      expect(profile.positions.length, `${role} can be played nowhere`).toBeGreaterThan(0);
      for (const position of profile.positions) {
        expect(roleFitsPosition(role, position), `${role} claims ${position} but is not allowed there`).toBe(true);
      }
    }
  });

  // The role an auto-picked XI gets is the position's default, and a default
  // that is illegal for its own position would put a poacher at centre-half.
  // This is the test that says a save written before roles existed wakes up as
  // the same football team it always was.
  it('gives auto-picked lineups a legal default role in every slot, for every formation', () => {
    const squad = leagueSquad('roles-selection');

    for (const formationId of FORMATION_IDS) {
      const selection = autoPickLineup(squad, formationId);
      expect(selection.starting.length, `${formationId} picked ${selection.starting.length} outfielders`).toBe(11);
      for (const slot of selection.starting) {
        expect(slot.role, `${formationId} left ${slot.position} with no role`).toBeTruthy();
        expect(roleFitsPosition(slot.role, slot.position), `${formationId}: ${slot.role} is not legal at ${slot.position}`).toBe(true);
      }
      for (const slot of selection.bench) {
        expect(slot.role, `${formationId} bench slot ${slot.position} has no role`).toBeTruthy();
        expect(roleFitsPosition(slot.role, slot.position), `${formationId}: bench ${slot.role} is not legal at ${slot.position}`).toBe(true);
      }
    }
  });

  // Auto-pick is the *AI's* pick, and the brief was explicit that a 4-4-2 should
  // still be a 4-4-2. Every AI slot taking its position's default is what makes
  // that true, and it is also what keeps `npm run balance` comparable to the
  // run before roles existed.
  it('leaves the AI on the ordinary version of every position', () => {
    const squad = leagueSquad('roles-defaults');
    for (const formationId of FORMATION_IDS) {
      for (const slot of autoPickLineup(squad, formationId).starting) {
        expect(slot.role, `${formationId}: ${slot.position} took an exotic role`).toBe(roleProfile(slot.role).id);
      }
    }
  });
});