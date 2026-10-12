/**
 * A picture for every kind of story the paper prints.
 *
 * The news screen was a page of type: a headline, a paragraph, and a wall of
 * words in six colours of label. A paper is not made of type alone — a match
 * report has a picture above it — and the first pass at this drew six of them,
 * one per *column*: a pitch for a match, men for the squad, a stand for the
 * club, a trophy for the league, a globe for the world, money for the money.
 *
 * Six columns turned out to be the wrong grain. Everything the game writes is
 * filed into one of those six, so a **cup final**, a **postponement** and a
 * routine league result all arrived wearing the same pitch, and a signing, a
 * release and a hamstring were one drawing between them. A paper whose cup tie
 * and whose Tuesday-night result are the same picture has told the manager
 * nothing by drawing it.
 *
 * So the sheet is keyed on the **story** rather than on the column. Thirteen
 * pictures cover the thirty-one kinds of event this game publishes — a knockout
 * competition, a player arriving or leaving, a man unavailable, a training
 * night, an achievement, a fixture called off, and a conversation — and the six
 * the first pass drew are still here, so nothing that used to have a picture
 * lost one. Which event wears which drawing is `ui/newsStory.ts`'s decision, and
 * it is made in one table rather than here: this file draws, and nothing else.
 *
 * Seven pictures for thirty-one events rather than thirty-one is the point
 * rather than a shortcut. Two stories that are the same kind of story should be
 * drawn the same way — a signing and a release are both a player arriving or
 * leaving, and the words beside the picture say which — and a set of drawings
 * that could not be told apart at 64 pixels wide would be a set of drawings
 * nobody could read.
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
 * beside them, in the label the paper prints above the headline, so they carry
 * their meaning to the eye and nothing at all to a screen reader.
 */

/**
 * The picture a story wears.
 *
 * The first six are the columns, and remain the fallback for a story that does
 * not know what it is — an item from a career saved before the event type
 * travelled with it. The rest are the kinds of thing that happen, which is what
 * the paper is actually about.
 */
export type NewsPlateKey =
  /** A result, on a pitch from above. */
  | 'Match'
  /** The squad: men, three abreast. */
  | 'Squad'
  /** The club as a place: a stand with people in it. */
  | 'Club'
  /** A competition and who is winning it: the trophy. */
  | 'League'
  /** Somewhere that is not here: a globe. */
  | 'World'
  /** Money in or money out: a note and its coins. */
  | 'Finances'
  /** A knockout competition: the cup itself, won, with the ribbons still on it. */
  | 'Cup'
  /** A player arriving or leaving: a shirt on a hanger. */
  | 'Transfer'
  /** A man who cannot play: the physio's room. */
  | 'Absence'
  /** A Thursday night: cones, a ball and a line to work along. */
  | 'Training'
  /** Something achieved: a medal, with the ribbon still on it. */
  | 'Milestone'
  /** Football that did not happen: a date with a line through it. */
  | 'CalledOff'
  /** Something said between two people: two bubbles, overlapping. */
  | 'Rows';

/** The sheet every picture is drawn on. */
export const NEWS_PLATE_WIDTH = 64;
export const NEWS_PLATE_HEIGHT = 40;

export const NEWS_PLATE_PATHS: Record<NewsPlateKey, readonly string[]> = {
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
  // An open bowl on a plinth: the league, and the table that decides it. It is
  // deliberately *not* the cup below — the league is a long season and the cup
  // is a knockout, and a manager reading two identical trophies would have to
  // open the story to find out which competition it was about.
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
  // The cup, with its lid on and its ribbons still flying. A cup competition is
  // decided in one afternoon rather than over a season, and the picture says so:
  // where the league's trophy is an open bowl waiting to be won, this one is
  // shut, decorated and dressed, which is what a cup looks like the moment it is
  // handed over. It serves a draw, a final and a giant-killing alike — the words
  // above the headline say which of the three it is.
  Cup: [
    'M20 16 H44 V22 C44 28.5 39 32.5 32 32.5 C25 32.5 20 28.5 20 22 Z',
    'M24 12 H40',
    'M30 9 A2 2 0 1 0 34 9 A2 2 0 1 0 30 9',
    'M20 18 H15 C11 18 11 25 15 25 H18',
    'M44 18 H49 C53 18 53 25 49 25 H46',
    'M32 32.5 V36',
    'M24 36 H40',
    'M28 12 C24 8 20 6.5 16 5',
    'M36 12 C40 8 44 6.5 48 5',
  ],
  // A shirt on a hanger: a player arriving or leaving. The shirt is the one
  // shape in this game that means *a footballer* without meaning a particular
  // man — every face is drawn, and drawing one here would be claiming a signing
  // the save has not made — and the hanger is what says he is moving rather than
  // playing. One picture for arrivals and departures both, because they are the
  // same kind of story: a name in the squad list changed. The label says which
  // way.
  Transfer: [
    'M22 14 L16 17 L13.5 24 L19 26.5 V36 H45 V26.5 L50.5 24 L48 17 L42 14',
    'M22 14 C24 17 27 18.5 32 18.5 C37 18.5 40 17 42 14',
    'M32 9.5 C29.5 9.5 29.5 6 32 6 C34.5 6 34.5 9.5 32 9.5',
    'M32 9.5 V17.5',
  ],
  // A man who cannot play: the room he is in instead. A cross on a badge is the
  // oldest way of drawing "the physio" there is, it needs no anatomy to read at
  // this size, and it is deliberately *not* a broken leg — an injury, a week's
  // unavailability and a thin squad are one story to the manager, which is who
  // he has, not what precisely is wrong with him.
  Absence: [
    'M32 4 A13 13 0 1 0 32 30 A13 13 0 1 0 32 4',
    'M32 11 V23',
    'M26 17 H38',
    'M20 34 H44',
  ],
  // A Thursday night at the training ground: the cones in their lines and the
  // ball beside them. The line under both is the ground they are on — the same
  // trick the pitch uses — so three shapes and a rule read as a session rather
  // than as three triangles.
  Training: [
    'M4 32 H60',
    'M8 32 H16 L12 22 Z',
    'M22 32 H30 L26 22 Z',
    'M35 27 A5 5 0 1 0 45 27 A5 5 0 1 0 35 27',
    'M36.5 24 C39 25.5 41 27 43.5 29',
  ],
  // A medal on its ribbon: something achieved. A ribbon rather than a plinth is
  // what separates it from the two trophies — a trophy is a competition, and
  // this is a man who got to fifty goals — and the star inside it is the mark a
  // grassroots club actually has printed on the tin one in the cabinet.
  Milestone: [
    'M26 6 L22 20',
    'M38 6 L42 20',
    'M24 26 A8 8 0 1 0 40 26 A8 8 0 1 0 24 26',
    'M32 20.5 L33.7 24.4 L38 24.8 L34.8 27.5 L35.7 31.7 L32 29.5 L28.3 31.7 L29.2 27.5 L26 24.8 L30.3 24.4 Z',
  ],
  // Football that did not happen: a fixture page with a line through it. It is
  // the only picture in the set that is *struck out*, which is why a
  // postponement is the one story a manager can pick out of the board at a
  // glance — and a forfeit wears it too, because a game nobody played is a game
  // nobody played.
  CalledOff: [
    'M10 6 L54 38',
    'M14 10 H50 V34 H14 Z',
    'M14 17 H50',
    'M22 6 V13',
    'M42 6 V13',
  ],
  // Two bubbles, the second overlapping the first: something said between two
  // people. The game already draws a conversation this way in the inbox and in
  // the negotiation, so the picture is the same grammar rather than a new
  // symbol — a dressing room, a committee and a player asking about a game are
  // all one of these, and the label says which.
  Rows: [
    'M8 8 H40 V22 H18 L12 27 V22 H8 Z',
    'M14 12.5 H34',
    'M14 17 H28',
    'M30 17 H56 V31 H44 L38 36 V31 H30 Z',
    'M36 21.5 H50',
    'M36 26 H46',
  ],
};

export function NewsPlate({ plate, className }: { plate: NewsPlateKey; className?: string }) {
  return (
    <svg
      className={`news-plate${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${NEWS_PLATE_WIDTH} ${NEWS_PLATE_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      {NEWS_PLATE_PATHS[plate].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
