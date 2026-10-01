import { describe, expect, it } from 'vitest';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import {
  fullTimeOutcome,
  fullTimeTalkMoraleDelta,
  fullTimeTalkVerdict,
  teamTalkMoraleDelta,
} from '@/simulation/match/preparation';
import { createTestGame } from '@/simulation/testSupport';

/**
 * The last word.
 *
 * A full-time team talk is judged against the result and against how the man
 * himself played, so these tests fix the dressing room in place: a lad who
 * knows he was the best player on the pitch, a lad who knows he had a shocker,
 * and the personality sitting behind each one.
 */

function someone(personality: Player['personality'], options: { determination?: number; composure?: number; morale?: number } = {}) {
  const { state, clubId } = createTestGame('preparation-full-time', 0);
  const player = state.clubs[clubId]!.squadIds
    .map((id) => state.people[id])
    .filter(isPlayer)[0]!;
  player.personality = personality;
  player.morale = options.morale ?? 60;
  player.attributes.mental.determination = options.determination ?? 10;
  player.attributes.mental.composure = options.composure ?? 10;
  return player;
}

const playedWell = { result: 'loss', margin: 1, rating: 7.8 } as const;
const playedBadly = { result: 'loss', margin: 1, rating: 5.2 } as const;
const quietGame = { result: 'loss', margin: 1, rating: 6.5 } as const;

describe('the full-time word', () => {
  it('reads the result from the manager\u2019s own side of the scoreline', () => {
    expect(fullTimeOutcome({ home: 3, away: 1 }, 'home')).toEqual({ result: 'win', margin: 2 });
    expect(fullTimeOutcome({ home: 3, away: 1 }, 'away')).toEqual({ result: 'loss', margin: 2 });
    expect(fullTimeOutcome({ home: 2, away: 2 }, 'away')).toEqual({ result: 'draw', margin: 0 });
  });

  it('praises the man who played well but does not fool the man who did not', () => {
    expect(fullTimeTalkMoraleDelta('praise', someone('Quiet'), playedWell)).toBe(2);
    // Being told you were good when you know you were not does not land.
    expect(fullTimeTalkMoraleDelta('praise', someone('Quiet'), playedBadly)).toBe(-1);
    expect(fullTimeTalkMoraleDelta('praise', someone('Quiet'), quietGame)).toBe(0);
    expect(fullTimeTalkMoraleDelta('praise', someone('Quiet'), { result: 'win', margin: 2, rating: 6.5 })).toBe(1);
  });

  it('shouts at a team that has just won and means nothing by it', () => {
    const win = { result: 'win', margin: 2, rating: 7.5 } as const;
    expect(fullTimeTalkMoraleDelta('blast', someone('Competitive'), win)).toBe(-2);
    expect(fullTimeTalkMoraleDelta('blast', someone('Quiet'), win)).toBe(-2);
  });

  it('splits a beaten dressing room between the ones who need it and the ones who do not', () => {
    // A determined lad takes a bollocking as a challenge; a quiet one shrinks.
    expect(fullTimeTalkMoraleDelta('blast', someone('Competitive', { determination: 15 }), playedBadly)).toBe(1);
    expect(fullTimeTalkMoraleDelta('blast', someone('Quiet', { determination: 8 }), playedBadly)).toBe(-2);
    // And shouting at the best player on the pitch is not aimed at him.
    expect(fullTimeTalkMoraleDelta('blast', someone('Competitive'), playedWell)).toBe(-1);
  });

  it('picks a beaten side up only when there is something to pick up', () => {
    expect(fullTimeTalkMoraleDelta('console', someone('Quiet', { morale: 40 }), quietGame)).toBe(1);
    expect(fullTimeTalkMoraleDelta('console', someone('Quiet', { morale: 70 }), quietGame)).toBe(0);
    expect(fullTimeTalkMoraleDelta('console', someone('Quiet', { morale: 70 }), playedWell)).toBe(1);
    // Patronising a side that has just won.
    expect(fullTimeTalkMoraleDelta('console', someone('Quiet'), { result: 'win', margin: 1, rating: 7 })).toBe(-1);
  });

  it('makes silence after a hiding say something of its own', () => {
    expect(fullTimeTalkMoraleDelta('nothing', someone('Quiet'), { result: 'loss', margin: 3, rating: 5 })).toBe(-1);
    expect(fullTimeTalkMoraleDelta('nothing', someone('Quiet'), { result: 'loss', margin: 1, rating: 5 })).toBe(0);
    expect(fullTimeTalkMoraleDelta('nothing', someone('Quiet'), { result: 'win', margin: 1, rating: 8 })).toBe(0);
  });

  it('tells him how it landed, not what the numbers were', () => {
    expect(fullTimeTalkVerdict('praise', [2, 2, 1], 'win')).toMatch(/^You told them it was good\. It landed well\.$/);
    expect(fullTimeTalkVerdict('blast', [1, -1, -2], 'loss')).toMatch(/split the dressing room/);
    expect(fullTimeTalkVerdict('measured', [0, 0, 0], 'draw')).toMatch(/^You kept it measured\. It went in, and out again\.$/);
    expect(fullTimeTalkVerdict('console', [-1, -1, -1], 'win')).toMatch(/^You picked them up\. A few of them did not want to hear it\.$/);
    expect(fullTimeTalkVerdict('nothing', [0, 0, 0], 'loss')).toMatch(/quiet/);
    expect(fullTimeTalkVerdict('nothing', [0, 0, 0], 'win')).toMatch(/Nobody minded/);
  });

  it('keeps the pre-match talk working the way it always did', () => {
    expect(teamTalkMoraleDelta('aggressive', someone('Competitive', { composure: 12 }))).toBe(2);
    expect(teamTalkMoraleDelta('aggressive', someone('Quiet', { composure: 12 }))).toBe(-2);
  });
});
