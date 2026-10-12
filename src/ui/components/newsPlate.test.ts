import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NewsCategory } from '@/domain/news';
import { NEWS_PLATE_HEIGHT, NEWS_PLATE_PATHS, NEWS_PLATE_WIDTH, NewsPlate, type NewsPlateKey } from './NewsPlate';

/**
 * The picture on a story.
 *
 * What is pinned here is not what a drawing of a stand looks like — that is a
 * judgement, and it is made by looking at the contact sheet — but the three
 * things a picture on a sheet of fixed size can be *wrong* about: that it runs
 * off the edge of the sheet it is drawn on, that it is not actually a drawing of
 * the thing it claims to be, and that two kinds of story end up wearing one
 * picture between them.
 *
 * The set is keyed on the *story* rather than on the column, so there are two
 * things to hold down as well: that the six columns are all still here — a career
 * saved before a story knew what it was draws the column's picture and must not
 * lose it — and that the drawing a story wears is chosen from the event rather
 * than from the column, which is `newsStory.test.ts`'s job rather than this
 * one's.
 */

/** Every picture in the set, and nothing else. */
const PLATES: NewsPlateKey[] = [
  'Match', 'Squad', 'Club', 'League', 'World', 'Finances',
  'Cup', 'Transfer', 'Absence', 'Training', 'Milestone', 'CalledOff', 'Rows',
];

/** The columns, which every story has whether or not it knows what it is. */
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
    expect(Object.keys(NEWS_PLATE_PATHS).sort()).toEqual([...PLATES].sort());
    for (const plate of PLATES) {
      // A picture rather than a glyph: one or two strokes are a symbol, and
      // these are meant to be places.
      expect(NEWS_PLATE_PATHS[plate].length, plate).toBeGreaterThanOrEqual(4);
    }
    // Thirteen kinds of story in thirteen drawings. A paper whose cup tie and
    // whose training night wore the same picture would have told the manager
    // nothing by drawing it, and the *point* of drawing more than the six
    // columns was that a cup final and a routine result are not one story.
    const drawn = PLATES.map((plate) => JSON.stringify(NEWS_PLATE_PATHS[plate]));
    expect(new Set(drawn).size).toBe(PLATES.length);
  });

  it('keeps the column a story is filed under, for a story that does not know what it is', () => {
    // Every item written before the event type travelled with it has a category
    // and nothing else. Those stories draw the column's picture, so all six have
    // to still be in the set: a fallback removed is a fallback that throws.
    for (const category of CATEGORIES) {
      expect(NEWS_PLATE_PATHS[category], category).toBeDefined();
    }
  });

  it('keeps every picture on its own sheet', () => {
    // A picture that runs off its sheet is clipped, and a clipped drawing reads
    // as a mistake rather than as anything. One unit in from every edge, because
    // the line itself has weight.
    for (const plate of PLATES) {
      for (const d of NEWS_PLATE_PATHS[plate]) {
        for (const point of reach(d)) {
          expect(point.x, `${plate} draws off the left or right of the sheet: ${d}`).toBeGreaterThanOrEqual(1);
          expect(point.x, `${plate} draws off the left or right of the sheet: ${d}`).toBeLessThanOrEqual(NEWS_PLATE_WIDTH - 1);
          expect(point.y, `${plate} draws off the top or bottom of the sheet: ${d}`).toBeGreaterThanOrEqual(1);
          expect(point.y, `${plate} draws off the top or bottom of the sheet: ${d}`).toBeLessThanOrEqual(NEWS_PLATE_HEIGHT - 1);
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
    const markup = renderToStaticMarkup(createElement(NewsPlate, { plate: 'Match' }));
    expect(markup).toContain(`viewBox="0 0 ${NEWS_PLATE_WIDTH} ${NEWS_PLATE_HEIGHT}"`);
    expect(markup).toContain('class="news-plate"');
    expect(markup).toContain('aria-hidden="true"');
    expect((markup.match(/<path/g) ?? []).length).toBe(NEWS_PLATE_PATHS.Match.length);
    // The wider lead story draws the same picture, bigger, through a class — and
    // so does a story given a column of its own, at a size between the two.
    const lead = renderToStaticMarkup(createElement(NewsPlate, { plate: 'Club', className: 'news-plate--lead' }));
    expect(lead).toContain('class="news-plate news-plate--lead"');
    const feature = renderToStaticMarkup(createElement(NewsPlate, { plate: 'Cup', className: 'news-plate--feature' }));
    expect(feature).toContain('class="news-plate news-plate--feature"');
    expect((feature.match(/<path/g) ?? []).length).toBe(NEWS_PLATE_PATHS.Cup.length);
  });
});
