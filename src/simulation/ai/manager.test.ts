import { describe, expect, it } from 'vitest';
import type { Club } from '@/domain/club';
import type { Tactics } from '@/domain/tactics';
import { defaultTactics } from '@/domain/tactics';
import { FORMATION_IDS } from '@/domain/positions';
import { isPlayer, type Player } from '@/domain/person';
import { Rng } from '../rng';
import { createTestGame } from '../testSupport';
import { autoPickLineup, bestRoleFor, positionScore, roleFitScore } from '../selection';
import { defaultRoleFor, roleFitsPosition, type Role } from '../match/roles';
import {
  attackingWeightOf,
  matchReaction,
  mentalityIndex,
  pickBenchMan,
  pickOutgoing,
  type BenchCandidate,
  type MatchSituation,
  type PlayerCondition,
} from './manager';
import { clubStyle, roleCandidates, styleTactics, type ClubStyle } from './style';

/**
 * The man in the other dugout, on his own terms.
 *
 * Everything here is a comparison rather than an absolute, because that is the
 * claim being made: not "a losing side attacks" but "a losing side attacks more
 * than a losing side whose manager is cautious", and not "an AI picks a target
 * man" but "a direct side gives its big centre forward the target man's job and
 * its quick one the poacher's". A decision layer that could only be demonstrated
 * by absolute numbers would pass with a dead engine underneath it.
 */

const { state } = createTestGame('ai-manager');
const baseClub: Club = state.clubs[state.userClubId]!;
const squad = baseClub.squadIds.map((id) => state.people[id]).filter(isPlayer);

function club(reputation: number, patch: Partial<Tactics> = {}, id = baseClub.id): Club {
  return { ...baseClub, id, reputation, tactics: { ...defaultTactics('4-4-2'), ...patch } };
}

function styleOf(reputation: number, patch: Partial<Tactics> = {}): ClubStyle {
  return clubStyle(club(reputation, patch));
}

const situation = (patch: Partial<MatchSituation> = {}): MatchSituation => ({
  minute: 70,
  scoreFor: 0,
  scoreAgainst: 1,
  strengthRatio: 1,
  menDown: 0,
  changesLeft: 2,
  benchSize: 5,
  home: true,
  ...patch,
});

const BALANCED: Tactics = { ...defaultTactics('4-4-2') };

describe('a club has a football identity', () => {
  it('derives the same character every time it is asked', () => {
    const one = clubStyle(club(50, { mentality: 'attacking' }));
    const two = clubStyle(club(50, { mentality: 'attacking' }));
    expect(two).toEqual(one);
    // Two clubs with the same standing and the same instructions are still not
    // the same team: the flavour is what stops the county being one personality.
    const other = clubStyle(club(50, { mentality: 'attacking' }, `${baseClub.id}-b`));
    expect(other.ambition).not.toBe(one.ambition);
  });

  it('makes the stronger club the more ambitious one, all else equal', () => {
    const weak = styleOf(22, { mentality: 'defensive', tempo: 'slow', pressing: 'low', defensiveLine: 'deep' });
    const strong = styleOf(78, { mentality: 'attacking', tempo: 'high', pressing: 'high', defensiveLine: 'high' });
    expect(strong.ambition).toBeGreaterThan(weak.ambition);

    // A cautious identity that is also asked to sit deep is a manager who will
    // not throw the game open; an ambitious one is quicker to change his mind.
    expect(strong.flexibility).toBeGreaterThanOrEqual(weak.flexibility);
    // And the label is something a manager would say out loud.
    expect(strong.label.length).toBeGreaterThan(0);
    expect(strong.label).not.toBe(weak.label);
  });

  it('gives a generated world a league whose standing shows in how it plays', () => {
    const weak = Array.from({ length: 40 }, (_, index) => styleTactics(new Rng(`weak-${index}`), 22));
    const strong = Array.from({ length: 40 }, (_, index) => styleTactics(new Rng(`strong-${index}`), 75));
    const cautious = (tactics: Tactics) => tactics.mentality === 'defensive' || tactics.mentality === 'very-defensive';
    const positive = (tactics: Tactics) => tactics.mentality === 'attacking' || tactics.mentality === 'very-attacking';

    // The claim is a comparison rather than a quota: a county read off standing
    // plays more cautious football at the bottom than at the top, not "exactly
    // thirty of forty sides are defensive".
    expect(weak.filter(cautious).length).toBeGreaterThan(20);
    expect(strong.filter(positive).length).toBeGreaterThan(weak.filter(positive).length);
    expect(weak.filter(cautious).length).toBeGreaterThan(strong.filter(cautious).length);
    // The weak sides also get it forward: a Sunday side without the players
    // does not knock it about at the back, and this is the whole reason the
    // opening instructions are drawn from standing rather than at random.
    expect(weak.filter((tactics) => tactics.passingStyle === 'direct').length).toBeGreaterThan(10);
  });
});

describe('an AI manager reads the afternoon', () => {
  it('does nothing at all in the first half-hour', () => {
    const reaction = matchReaction(styleOf(50), situation({ minute: 20 }), BALANCED);
    expect(reaction.tactics).toEqual({});
    expect(reaction.reason).toBeNull();
  });

  it('goes for it when it is losing late', () => {
    const reaction = matchReaction(styleOf(50), situation({ minute: 70 }), BALANCED);
    expect(mentalityIndex(reaction.tactics.mentality!)).toBeGreaterThan(mentalityIndex(BALANCED.mentality));
    expect(reaction.tactics.defensiveLine).toBe('high');
    expect(reaction.tactics.tempo).toBe('high');
    expect(reaction.reason).toBeTruthy();
    expect(reaction.benchIntent).toBe('chase');
  });

  it('shuts it down when it is winning late', () => {
    const reaction = matchReaction(styleOf(50), situation({ minute: 80, scoreFor: 2, scoreAgainst: 0 }), BALANCED);
    expect(mentalityIndex(reaction.tactics.mentality!)).toBeLessThan(mentalityIndex(BALANCED.mentality));
    expect(reaction.tactics.defensiveLine).toBe('deep');
    expect(reaction.tactics.pressing).toBe('low');
    expect(reaction.tactics.tempo).toBe('slow');
    expect(reaction.benchIntent).toBe('protect');
  });

  it('pushes further and sooner when it is ambitious, and never past the end of the ladder', () => {
    const cautious = club(22, { mentality: 'defensive', tempo: 'slow', pressing: 'low', defensiveLine: 'deep' });
    const ambitious = club(78, { mentality: 'attacking', tempo: 'high', pressing: 'high', defensiveLine: 'high' });
    const late = situation({ minute: 78 });
    const cautiousStyle = clubStyle(cautious);
    const ambitiousStyle = clubStyle(ambitious);

    const cautiousMove = matchReaction(cautiousStyle, late, cautious.tactics);
    const ambitiousMove = matchReaction(ambitiousStyle, late, ambitious.tactics);
    expect(mentalityIndex(ambitiousMove.tactics.mentality!)).toBeGreaterThan(
      mentalityIndex(cautiousMove.tactics.mentality!),
    );

    // Asked over and over, he never walks off the top of the ladder: a manager
    // who reacted again on every re-read would end every match at maximum.
    let tactics: Tactics = { ...cautious.tactics };
    const seen: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const reaction = matchReaction(cautiousStyle, situation({ minute: 88, scoreFor: 0, scoreAgainst: 3 }), tactics);
      tactics = { ...tactics, ...reaction.tactics };
      seen.push(mentalityIndex(tactics.mentality));
    }
    expect(seen[seen.length - 1]).toBe(seen[seen.length - 2]);
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(4);
  });

  it('rearranges everything when it is a man down, whatever the clock says', () => {
    const reaction = matchReaction(styleOf(50), situation({ minute: 10, scoreFor: 1, scoreAgainst: 1, menDown: 1 }), BALANCED);
    expect(mentalityIndex(reaction.tactics.mentality!)).toBeLessThan(mentalityIndex(BALANCED.mentality));
    expect(reaction.tactics.defensiveLine).toBe('deep');
    expect(reaction.tactics.pressing).toBe('low');
    expect(reaction.benchIntent).toBe('protect');
  });

  it('takes the point when it is level, outclassed and nearly out of time', () => {
    const reaction = matchReaction(styleOf(40), situation({ minute: 88, scoreFor: 1, scoreAgainst: 1, strengthRatio: 0.8 }), BALANCED);
    expect(mentalityIndex(reaction.tactics.mentality!)).toBeLessThan(mentalityIndex(BALANCED.mentality));
    expect(reaction.reason).toBe('will take the point');
  });

  it('has no bench intent when there is nobody left to bring on', () => {
    const reaction = matchReaction(styleOf(50), situation({ minute: 80, changesLeft: 0 }), BALANCED);
    expect(reaction.benchIntent).toBe('none');
  });
});

describe('an AI manager uses his bench on purpose', () => {
  const defender: BenchCandidate = { playerId: 'd', position: 'CB', familiarity: 1, energy: 90, attacking: attackingWeightOf('CB'), fit: 0.62 };
  const forward: BenchCandidate = { playerId: 'f', position: 'ST', familiarity: 0.6, energy: 90, attacking: attackingWeightOf('ST'), fit: 0.6 };
  const midfielder: BenchCandidate = { playerId: 'm', position: 'CM', familiarity: 0.5, energy: 95, attacking: attackingWeightOf('CM'), fit: 0.6 };
  const bench = [defender, forward, midfielder];
  const slot = { position: 'CB' as const, role: defaultRoleFor('CB') };

  it('sends on a forward to chase a game and a defender to protect one', () => {
    expect(pickBenchMan('chase', slot, bench)).toBe('f');
    expect(pickBenchMan('protect', slot, bench)).toBe('d');
  });

  it('will not send an outfielder on in goal', () => {
    // None of the three can keep: the keeper's slot takes a keeper or nobody.
    const outfield = bench.map((candidate) => ({ ...candidate, familiarity: 0.1 }));
    const keeperSlot = { position: 'GK' as const, role: defaultRoleFor('GK') };
    expect(pickBenchMan('refresh', keeperSlot, outfield)).toBeNull();
    const keeper: BenchCandidate = { playerId: 'gk', position: 'GK', familiarity: 1, energy: 100, attacking: 0, fit: 0.9 };
    expect(pickBenchMan('refresh', keeperSlot, [...outfield, keeper])).toBe('gk');
  });

  it('takes the hurt man off whenever it happens, and nobody else before the hour', () => {
    const fit: PlayerCondition[] = [
      { playerId: 'a', position: 'CM', energy: 95, rating: 7, booked: false, attacking: 0.52, injured: false },
      { playerId: 'b', position: 'CB', energy: 92, rating: 7, booked: false, attacking: 0.08, injured: false },
    ];
    expect(pickOutgoing('refresh', fit, 20)).toBeNull();
    expect(pickOutgoing('refresh', [{ ...fit[0]!, injured: true }, fit[1]!], 5)).toBe('a');
  });

  it('takes off tired legs, and the man the plan no longer wants', () => {
    const legsGone: PlayerCondition[] = [
      { playerId: 'a', position: 'CM', energy: 40, rating: 6, booked: false, attacking: 0.52, injured: false },
      { playerId: 'b', position: 'CB', energy: 88, rating: 7, booked: false, attacking: 0.08, injured: false },
      { playerId: 'c', position: 'ST', energy: 86, rating: 7, booked: false, attacking: 1, injured: false },
    ];
    // The man who cannot run any more is the one who comes off, whoever he is.
    expect(pickOutgoing('refresh', legsGone, 65)).toBe('a');

    // With nobody tired and nobody playing badly, what decides it is the plan:
    // chasing the game takes a defender off, protecting one takes a forward off.
    const fit: PlayerCondition[] = legsGone.map((player) => ({ ...player, energy: 90, rating: 7 }));
    expect(pickOutgoing('chase', fit, 76)).toBe('b');
    expect(pickOutgoing('protect', fit, 76)).toBe('c');
  });
});

describe('selection picks men for jobs, not just for positions', () => {
  it('gives every role it hands out a legal home, whatever the instructions', () => {
    const instructionSets: Tactics[] = [
      BALANCED,
      { ...defaultTactics('4-4-2'), mentality: 'very-attacking', tempo: 'high', pressing: 'high', attackingFocus: 'wide' },
      { ...defaultTactics('4-4-2'), mentality: 'defensive', passingStyle: 'direct', defensiveLine: 'deep', pressing: 'low' },
      { ...defaultTactics('4-4-2'), passingStyle: 'short', attackingFocus: 'central' },
    ];
    for (const tactics of instructionSets) {
      for (const formation of FORMATION_IDS) {
        const selection = autoPickLineup(squad, formation, { tactics });
        for (const slot of [...selection.starting, ...selection.bench]) {
          expect(roleFitsPosition(slot.role, slot.position), `${slot.role} is not legal at ${slot.position}`).toBe(true);
          expect(roleCandidates(slot.position, tactics)).toContain(slot.role);
        }
      }
    }
  });

  it('leaves a side that says nothing in particular on ordinary jobs', () => {
    for (const slot of autoPickLineup(squad, '4-4-2', { tactics: BALANCED }).starting) {
      expect(slot.role).toBe(defaultRoleFor(slot.position));
    }
  });

  it('gives a direct side its target man and a positive one its poacher', () => {
    const striker = squad.find((player) => player.preferredPosition === 'ST')!;
    const big = {
      ...striker,
      attributes: {
        ...striker.attributes,
        technical: { ...striker.attributes.technical, heading: 19, shooting: 10 },
        physical: { ...striker.attributes.physical, strength: 19, pace: 7 },
      },
    };
    const quick = {
      ...striker,
      attributes: {
        ...striker.attributes,
        technical: { ...striker.attributes.technical, heading: 6, shooting: 18 },
        physical: { ...striker.attributes.physical, strength: 9, pace: 18 },
      },
    };
    const direct: Tactics = { ...defaultTactics('4-4-2'), passingStyle: 'direct', attackingFocus: 'wide' };
    const positive: Tactics = { ...defaultTactics('4-4-2'), mentality: 'attacking' };

    expect(bestRoleFor(big, 'ST', direct)).toBe('st-target-man');
    expect(bestRoleFor(quick, 'ST', positive)).toBe('st-poacher');
    // A small, quick finisher is not a target man, and a system that only offers
    // that job leaves him on the ordinary one rather than miscasting him.
    expect(roleCandidates('ST', direct)).toContain(bestRoleFor(quick, 'ST', direct));
    // The fit is a real reading, not a preference: the same man suits the two
    // jobs differently, which is the whole point of picking for a system.
    expect(roleFitScore(big, 'ST', 'st-target-man')).toBeGreaterThan(roleFitScore(big, 'ST', 'st-poacher'));
    expect(roleFitScore(quick, 'ST', 'st-poacher')).toBeGreaterThan(roleFitScore(quick, 'ST', 'st-target-man'));
  });

  it('still refuses to pick a man who is not there', () => {
    const unavailable = squad.map((player, index): Player =>
      index < 14
        ? { ...player, availability: { status: 'unavailable', reason: 'work', note: 'On shift', until: null, discoveredLate: false } }
        : player,
    );
    const selection = autoPickLineup(unavailable, '4-4-2', { tactics: BALANCED });
    const blocked = new Set(unavailable.slice(0, 14).filter((player) => player.availability.status === 'unavailable').map((player) => player.id));
    for (const slot of [...selection.starting, ...selection.bench]) {
      expect(blocked.has(slot.playerId)).toBe(false);
    }
  });

  it('rates a role on the weights the engine reads, not on a second opinion', () => {
    const keeper = squad.find((player) => player.preferredPosition === 'GK')!;
    const role: Role = 'gk-shot-stopper';
    expect(positionScore(keeper, 'GK')).toBeGreaterThan(0.4);
    expect(roleFitScore(keeper, 'GK', role)).toBeGreaterThan(0);
    expect(roleFitScore(keeper, 'GK', role)).toBeLessThanOrEqual(1);
  });
});
