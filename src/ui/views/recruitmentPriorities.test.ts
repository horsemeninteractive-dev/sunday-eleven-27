import { describe, expect, it } from 'vitest';
import type { PositionCode, PositionGroup } from '@/domain/positions';
import type { SigningPriority } from '@/simulation/recruitment/needs';
import { priorityRows } from './RecruitmentView';

/**
 * What the recruitment screen says the squad is short of.
 *
 * The simulation decides this — `squadAssessment` reads the shape the club plays
 * and the jobs that shape asks of each position, and writes one sentence about
 * the worst of it. What is pinned here is only the short step from that reading
 * to the rows at the top of the screen, because it is the step a manager would be
 * misled by if it were wrong: an urgent shortfall listed under a mild one, the
 * same area of the squad reported twice as if it were two problems, or the
 * simulation's sentence rewritten into a softer one by the view.
 *
 * The sentence itself is deliberately not paraphrased anywhere in the chain. The
 * screen prints what the simulation said, so a reason that reads wrong is a bug
 * in one place rather than two.
 */

function priority(
  group: PositionGroup,
  position: PositionCode,
  weight: number,
  reason: string,
): SigningPriority {
  return { group, position, roles: [], roleLabel: 'Defender', weight, reason };
}

describe('the shortfalls the recruitment screen leads with', () => {
  it('puts the most urgent first, whatever order they arrive in', () => {
    const rows = priorityRows([
      priority('DEF', 'LB', 0.3, 'Reasonable cover at left back.'),
      priority('GK', 'GK', 0.95, 'Short at goalkeeper.'),
      priority('FWD', 'ST', 0.5, 'Short at striker.'),
    ]);

    expect(rows.map((row) => row.area)).toEqual(['Goalkeeper', 'Forward', 'Defender']);
    expect(rows[0]!.position).toBe('Goalkeeper');
  });

  it('reports an area of the squad once, with the position that hurts most', () => {
    const rows = priorityRows([
      priority('DEF', 'CB', 0.4, 'Covered at centre back.'),
      priority('DEF', 'LB', 0.8, 'Short at left back.'),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('DEF');
    expect(rows[0]!.position).toBe('Left back');
    expect(rows[0]!.reason).toBe('Short at left back.');
  });

  it('says nothing rather than inventing a shortfall for a squad that has none', () => {
    expect(priorityRows([])).toEqual([]);
  });

  it('prints the simulation’s own sentence word for word', () => {
    const reason = 'Short at centre back — nobody in the squad does the ball-playing defender job.';
    expect(priorityRows([priority('DEF', 'CB', 0.9, reason)])[0]!.reason).toBe(reason);
  });

  it('marks how serious each shortfall is, without exposing a number', () => {
    const rows = priorityRows([
      priority('DEF', 'CB', 0.9, 'Short at centre back.'),
      priority('MID', 'CM', 0.45, 'Covered at central midfield.'),
      priority('FWD', 'ST', 0.25, 'Well covered at striker.'),
    ]);

    expect(rows.map((row) => row.tone)).toEqual(['warn', 'default', 'muted']);
    // A row carries a heading, a position and a sentence — no score, no rating
    // and no hidden attribute, because the manager is not meant to have them.
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['area', 'key', 'position', 'reason', 'tone']);
  });
});
