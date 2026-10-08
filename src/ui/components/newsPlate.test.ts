import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NewsCategory } from '@/domain/news';
import { NEWS_PLATE_HEIGHT, NEWS_PLATE_PATHS, NEWS_PLATE_WIDTH, NewsPlate } from './NewsPlate';

/**
 * The picture on a story.
 *
 * What is pinned here is not what a drawing of a stand looks like — that is a
 * judgement, and it is made by looking at the contact sheet of all six — but the
 * three things a picture on a sheet of fixed size can be *wrong* about: that it
 * runs off the edge of the sheet it is drawn on, that it is not actually a
 * drawing of the thing it claims to be, and that six kinds of story end up
 * wearing one picture between them.
 */

const CATEGORIES: NewsCategory[] = ['Match', 'Squad', 'Club', 'League', 'World', 'Finances'];

/** How many numbers each command carries. Uppercase only: every coordinate in
 *  this file is absolute, which is what makes the numbers positions. */
const NUMBERS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, A: 7, Z: 0 };

interface Point {
  x: number;
  y: number;
}

/**
 * Every point a path reaches, so a picture can be measured rather than trusted.
 *
 * An arc is the only command whose curve leaves the points that name it, and
 * every arc here is drawn across a diameter of its own circle, so it bulges by
 * its own radius on the axis its two ends do not share. An arc drawn any other
 * way would leave this measurement short without saying so, which is why that
 * assumption is asserted below rather than assumed.
 */
function reach(d: string): Point[] {
  const found: Point[] = [];
  let from: Point = { x: 0, y: 0 };

  for (const command of d.match(/[A-Z][^A-Z]*/g) ?? []) {
    const letter = command[0]!;
    const size = NUMBERS[letter];
    expect(size, `no rule for the ${letter} command in ${d}`).toBeDefined();
    if (size === 0) continue;

    const numbers = (command.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(numbers.length % size!, `${letter} in ${d} is not a whole shape`).toBe(0);

    for (let index = 0; index < numbers.length; index += size!) {
      const group = numbers.slice(index, index + size!);
      const next: Point =
        letter === 'H'
          ? { x: group[0]!, y: from.y }
          : letter === 'V'
            ? { x: from.x, y: group[0]! }
            : { x: group[group.length - 2]!, y: group[group.length - 1]! };

      if (letter === 'A') {
        const [rx, ry] = group as [number, number];
        expect(
          from.x === next.x || from.y === next.y,
          `an arc not drawn across a diameter, in ${d}`,
        ).toBe(true);
        found.push(
          from.x === next.x
            ? { x: from.x - rx, y: (from.y + next.y) / 2 }
            : { x: from.x, y: from.y - ry },
        );
        found.push(
          from.x === next.x
            ? { x: from.x + rx, y: (from.y + next.y) / 2 }
            : { x: from.x, y: from.y + ry },
        );
      }

      found.push(next);
      from = next;
    }
  }

  return found;
}

function spans(d: string): { x: number; y: number } {
  const points = reach(d);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

describe('a story carries a picture of what kind of story it is', () => {
  it('draws one for every kind of story the paper prints, and a different one each time', () => {
    expect(Object.keys(NEWS_PLATE_PATHS).sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES) {
      // A picture rather than a glyph: one or two strokes are a symbol, and
      // these are meant to be places.
      expect(NEWS_PLATE_PATHS[category].length, category).toBeGreaterThanOrEqual(4);
    }
    // Six kinds of story in six drawings. A paper whose match report and whose
    // finance warning wore the same picture would have told the manager nothing
    // by drawing it.
    const drawn = CATEGORIES.map((category) => JSON.stringify(NEWS_PLATE_PATHS[category]));
    expect(new Set(drawn).size).toBe(CATEGORIES.length);
  });

  it('keeps every picture on its own sheet', () => {
    // A picture that runs off its sheet is clipped, and a clipped drawing reads
    // as a mistake rather than as anything. One unit in from every edge, because
    // the line itself has weight.
    for (const category of CATEGORIES) {
      for (const d of NEWS_PLATE_PATHS[category]) {
        for (const point of reach(d)) {
          expect(point.x, `${category} draws off the left or right of the sheet: ${d}`).toBeGreaterThanOrEqual(1);
          expect(point.x, `${category} draws off the left or right of the sheet: ${d}`).toBeLessThanOrEqual(NEWS_PLATE_WIDTH - 1);
          expect(point.y, `${category} draws off the top or bottom of the sheet: ${d}`).toBeGreaterThanOrEqual(1);
          expect(point.y, `${category} draws off the top or bottom of the sheet: ${d}`).toBeLessThanOrEqual(NEWS_PLATE_HEIGHT - 1);
        }
      }
    }
  });

  it('draws a football pitch for a match, and not a box', () => {
    const pitch = NEWS_PLATE_PATHS.Match;
    // The halfway line: one straight line down the middle of the sheet, from
    // touchline to touchline. It is the thing that makes a rectangle a pitch.
    const down = pitch.filter((d) => reach(d).every((point) => point.x === NEWS_PLATE_WIDTH / 2));
    expect(down.filter((d) => spans(d).y > NEWS_PLATE_HEIGHT * 0.7)).toHaveLength(1);
    // The centre circle, round, and centred on the middle of that line.
    const round = pitch.filter((d) => {
      const box = spans(d);
      return box.x > 4 && Math.abs(box.x - box.y) < 0.001;
    });
    expect(round).toHaveLength(1);
    const circle = reach(round[0]!);
    const middle = (values: number[]): number => (Math.min(...values) + Math.max(...values)) / 2;
    expect(middle(circle.map((point) => point.x))).toBe(NEWS_PLATE_WIDTH / 2);
    expect(middle(circle.map((point) => point.y))).toBe(NEWS_PLATE_HEIGHT / 2);
  });

  it('draws it as a drawing, and leaves the reading to the words beside it', () => {
    const markup = renderToStaticMarkup(createElement(NewsPlate, { category: 'Match' }));
    expect(markup).toContain(`viewBox="0 0 ${NEWS_PLATE_WIDTH} ${NEWS_PLATE_HEIGHT}"`);
    expect(markup).toContain('class="news-plate"');
    expect(markup).toContain('aria-hidden="true"');
    expect((markup.match(/<path/g) ?? []).length).toBe(NEWS_PLATE_PATHS.Match.length);
    // The wider lead story draws the same picture, bigger, through a class.
    const lead = renderToStaticMarkup(createElement(NewsPlate, { category: 'Club', className: 'news-plate--lead' }));
    expect(lead).toContain('class="news-plate news-plate--lead"');
  });
});
