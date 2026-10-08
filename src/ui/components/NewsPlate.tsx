import type { NewsCategory } from '@/domain/news';

/**
 * A picture for every kind of story the paper prints.
 *
 * The news screen was a page of type: a headline, a paragraph, and a wall of
 * words in six colours of label. A paper is not made of type alone — a match
 * report has a photograph of the pitch above it — and the six kinds of story
 * this game writes are six recognisable places rather than six words: a match
 * happens on a pitch, the squad is men, the club is a ground with a stand on it,
 * the league is a trophy, the world is a globe, and the money is money.
 *
 * They are *drawings*, not photographs, and that is deliberate. A photograph
 * would be the only photograph in the interface — the game draws its faces, its
 * badges, its kits and its pitches — and one photograph among all that ink reads
 * as an advertisement, which is what the news screen must not become. One sheet,
 * one stroke weight, one hand: the same rules the icons follow, 64 wide by 40
 * high, which is the shape a picture takes when it sits across a column of type
 * rather than in a square the size of a glyph.
 *
 * Everything is drawn in *absolute* commands only, and every arc is drawn across
 * a diameter of its own circle. That is not a style preference: it is what makes
 * the drawings checkable, because then every number in the file is a position on
 * the sheet and the whole picture's extent can be computed rather than trusted —
 * see `newsPlate.test.ts`, which walks these paths and holds the pictures inside
 * the frame they are drawn on.
 *
 * The pictures are decorative. The kind of story is already written in words
 * beside them, in the category the paper prints above the headline, so they
 * carry their meaning to the eye and nothing at all to a screen reader.
 */

/** The sheet every picture is drawn on. */
export const NEWS_PLATE_WIDTH = 64;
export const NEWS_PLATE_HEIGHT = 40;

export const NEWS_PLATE_PATHS: Record<NewsCategory, readonly string[]> = {
  // The pitch from above: touchline, halfway line, centre circle, two penalty
  // areas, two goals, and the centre spot. It is the shape of the place a
  // result happened in, and it is the one picture in the set that most managers
  // would recognise from a bad photocopy on a dressing-room wall.
  Match: [
    'M6 3 H58 V37 H6 Z',
    'M32 3 V37',
    'M32 13.5 A6.5 6.5 0 1 0 32 26.5 A6.5 6.5 0 1 0 32 13.5',
    'M6 11 H15 V29 H6',
    'M58 11 H49 V29 H58',
    'M4 16 V24 H6',
    'M60 16 V24 H58',
    'M31.8 20 H32.2',
  ],
  // Three of the men, standing on the ground: the squad is people, and this is
  // the game's own way of drawing a person at this size — the same head-and-
  // shoulders that stands in the sidebar, drawn three abreast because a squad
  // is never one man.
  Squad: [
    'M16 9.6 A3.4 3.4 0 1 0 16 16.4 A3.4 3.4 0 1 0 16 9.6',
    'M32 9.6 A3.4 3.4 0 1 0 32 16.4 A3.4 3.4 0 1 0 32 9.6',
    'M48 9.6 A3.4 3.4 0 1 0 48 16.4 A3.4 3.4 0 1 0 48 9.6',
    'M8.4 34 C8.4 29.2 11.8 26.6 16 26.6 C20.2 26.6 23.6 29.2 23.6 34',
    'M24.4 34 C24.4 29.2 27.8 26.6 32 26.6 C36.2 26.6 39.6 29.2 39.6 34',
    'M40.4 34 C40.4 29.2 43.8 26.6 48 26.6 C52.2 26.6 55.6 29.2 55.6 34',
    'M3 34 H61',
  ],
  // The ground: a covered stand with people in it, seen from the front. Not a
  // building and deliberately not a house — Home is already a house, which is
  // why the club's own icon is a shield — but a stand is unmistakably the place
  // the club exists, and it is where the AGM, the committee, the fundraising and
  // the socials all happen.
  Club: [
    'M5 15 L10 5 H54 L59 15 Z',
    'M5 15 V33',
    'M59 15 V33',
    'M12 18.6 A1.5 1.5 0 1 0 12 21.6 A1.5 1.5 0 1 0 12 18.6',
    'M22 18.6 A1.5 1.5 0 1 0 22 21.6 A1.5 1.5 0 1 0 22 18.6',
    'M32 18.6 A1.5 1.5 0 1 0 32 21.6 A1.5 1.5 0 1 0 32 18.6',
    'M42 18.6 A1.5 1.5 0 1 0 42 21.6 A1.5 1.5 0 1 0 42 18.6',
    'M52 18.6 A1.5 1.5 0 1 0 52 21.6 A1.5 1.5 0 1 0 52 18.6',
    'M5 27 H59',
    'M2 36 H62',
  ],
  // The cup: bowl, two handles, stem, plinth and base. The league table's own
  // icon is the same trophy, because a competition with a winner is what both
  // the table and the draw are about — and a draw, a result elsewhere and a
  // promotion are all one story: who is winning what.
  League: [
    'M22 6 H42 V15 C42 20.5 37.5 25 32 25 C26.5 25 22 20.5 22 15 Z',
    'M22 9.5 H18 C14.5 9.5 14.5 17.5 18 17.5 H20',
    'M42 9.5 H46 C49.5 9.5 49.5 17.5 46 17.5 H44',
    'M32 25 V29',
    'M25 29 H39 V34 H25 Z',
    'M20 34 H44',
  ],
  // The world: a globe with its equator and its two meridians. Somebody else's
  // season, a job moving on, a rumour worth hearing — all of it is somewhere
  // that is not here.
  World: [
    'M32 7 A11.5 11.5 0 1 0 32 30 A11.5 11.5 0 1 0 32 7',
    'M20.5 18.5 H43.5',
    'M32 7 C37.5 11.5 37.5 25.5 32 30',
    'M32 7 C26.5 11.5 26.5 25.5 32 30',
  ],
  // The money: a note with the value mark stamped on it, and a stack of coins
  // under it. The gate, the wage bill, a warning from the bank — one picture
  // says all three, and it is the one picture in the set nobody needs telling.
  Finances: [
    'M8 8 H56 V24 H8 Z',
    'M32 11.8 A4.2 4.2 0 1 0 32 20.2 A4.2 4.2 0 1 0 32 11.8',
    'M14 12.5 V19.5',
    'M50 12.5 V19.5',
    'M23 30 A9 3.6 0 1 0 41 30 A9 3.6 0 1 0 23 30',
    'M23 33.5 A9 3.6 0 1 0 41 33.5 A9 3.6 0 1 0 23 33.5',
  ],
};

export function NewsPlate({ category, className }: { category: NewsCategory; className?: string }) {
  return (
    <svg
      className={`news-plate${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${NEWS_PLATE_WIDTH} ${NEWS_PLATE_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      {NEWS_PLATE_PATHS[category].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
