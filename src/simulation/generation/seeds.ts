/**
 * World seeds, and the words a new one is built from.
 *
 * A seed is the whole world: the county, the towns, every club, every player,
 * every nickname. Which means the list of suggested seeds is the list of worlds
 * a manager can walk into without thinking one up, and four of them is four
 * worlds — the fifth career is the second career.
 *
 * Two ways out of that, and this file is both:
 *
 *  - `SUGGESTED_SEEDS` is a long list of the sort of name a seed should be: a
 *    place, a local institution, a phrase off a park noticeboard, with a number
 *    on the end sometimes because somebody typed one.
 *  - `rollSeed` invents a fresh one from the same vocabulary, so the map is not
 *    limited to the list and "give me another world" is one press.
 *
 * The vocabulary is kept here rather than borrowed from `names.ts` on purpose.
 * The seed picks the words the world will *use*; a seed phrased out of the same
 * pools would be a seed that changes when a pond in Oxfordshire is added to a
 * list, and two managers would think they had shared a world when they had not.
 */

/** The seeds offered to a new manager, on top of the ones they type. */
export const SUGGESTED_SEEDS: string[] = [
  'wychavon-morning',
  'bramley-ford-88',
  'the-crown-railway',
  'muddy-pitch-4',
  'nether-stoke-arms',
  'three-tuns-reserves',
  'old-mill-lane',
  'back-of-the-coop',
  'cricket-club-end',
  'the-barley-mow',
  'kelston-north-side',
  'pedmore-late-ko',
  'whitbourne-green',
  'sixpence-and-a-bag',
  'bishops-itch',
  'the-black-horse',
  'cinder-pitch-77',
  'broomfield-halfway',
  'st-cuthberts-old-boys',
  'down-by-the-weir',
  'sunday-morning-chalk',
  'harrow-hedge',
  'the-wheatsheaf-xi',
  'little-marsh-united',
  'gale-force-five',
  'eelbrook-allotments',
  'the-royal-oak-2',
  'frogmore-end',
  'twenty-two-blokes',
  'pigeon-shed-corner',
  'stony-brook-vale',
  'the-old-forge',
  'half-past-two',
  'marsh-lane-mudbath',
  'chorlton-cross-tackle',
  'the-coach-and-horses',
  'nine-pints-in',
  'long-furlong',
  'the-tally-ho',
  'bottom-of-the-table',
];

/**
 * The parts a rolled seed is made of.
 *
 * Local nouns, local trades and the sort of word a club or a pub in a small
 * county is actually named after. Nothing here is a joke: a seed is the first
 * thing a manager reads about his career, and a world that arrives with a rude
 * name is a world he cannot take seriously in the next sentence.
 */
const SEED_PLACES = [
  'ash',
  'barrow',
  'bexley',
  'bramble',
  'brick',
  'brook',
  'chalk',
  'clay',
  'coal',
  'cobble',
  'corn',
  'cresswell',
  'croft',
  'dray',
  'elm',
  'fern',
  'flint',
  'gale',
  'gorse',
  'gravel',
  'harrow',
  'heather',
  'hedge',
  'hollow',
  'hop',
  'hurdle',
  'ivy',
  'lark',
  'linden',
  'marsh',
  'meadow',
  'mill',
  'moss',
  'nettle',
  'oak',
  'orchard',
  'pebble',
  'quarry',
  'reed',
  'ridge',
  'rush',
  'salt',
  'sallow',
  'slate',
  'sorrel',
  'stony',
  'sycamore',
  'thistle',
  'thorn',
  'timber',
  'tinder',
  'turf',
  'weaver',
  'weir',
  'willow',
  'wych',
  'yarrow',
];

const SEED_NOUNS = [
  'arms',
  'allotments',
  'avenue',
  'barn',
  'bottom',
  'bridge',
  'brook',
  'chase',
  'close',
  'common',
  'corner',
  'cross',
  'croft',
  'end',
  'farm',
  'field',
  'ford',
  'forge',
  'gate',
  'green',
  'grove',
  'hall',
  'hollow',
  'inn',
  'lane',
  'marsh',
  'meadow',
  'mill',
  'moor',
  'oak',
  'park',
  'pastures',
  'pitch',
  'pond',
  'quay',
  'rec',
  'ridge',
  'rise',
  'road',
  'row',
  'shed',
  'side',
  'stile',
  'street',
  'tavern',
  'terrace',
  'vale',
  'walk',
  'way',
  'weir',
  'wharf',
  'wick',
  'wood',
  'yard',
];

const SEED_PREFIXES = ['the', 'old', 'little', 'nether', 'upper', 'lower', 'great', 'long', 'west', 'north', 'east', 'south'];

/** Seeds end in a number often enough that a plain one does not look odd. */
function seedNumber(random: () => number): string {
  return String(Math.floor(random() * 99) + 1);
}

/**
 * A seed nobody has thought of.
 *
 * `random` is injected so a test can pin the roll, and so a manager pressing the
 * button twice cannot possibly get the same world twice by accident. The shapes
 * are the shapes a real seed takes — a place and a thing, a thing and a number,
 * the name of a pub that used to be somewhere — so the result reads like it was
 * chosen rather than generated.
 */
export function rollSeed(random: () => number = Math.random): string {
  const place = SEED_PLACES[Math.floor(random() * SEED_PLACES.length)]!;
  const noun = SEED_NOUNS[Math.floor(random() * SEED_NOUNS.length)]!;
  const prefix = SEED_PREFIXES[Math.floor(random() * SEED_PREFIXES.length)]!;
  const shape = Math.floor(random() * 5);
  switch (shape) {
    case 0:
      return `${place}-${noun}`;
    case 1:
      return `${place}-${noun}-${seedNumber(random)}`;
    case 2:
      return `the-${place}-${noun}`;
    case 3:
      return `${prefix}-${place}-${noun}`;
    default:
      return `${place}-${noun}-${prefix}`;
  }
}

/**
 * A handful of the suggestions, in a fresh order.
 *
 * The screen does not show forty buttons: it shows a few of these and a press
 * that rolls a new one, so the same four worlds are not the whole offer while
 * the panel stays a panel.
 */
export function pickSuggestedSeeds(count: number, random: () => number = Math.random): string[] {
  const pool = [...new Set(SUGGESTED_SEEDS)];
  const picked: string[] = [];
  while (picked.length < Math.min(count, pool.length)) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

/** The shortest seed the form will accept, said once so the form and the test agree. */
export const MIN_SEED_LENGTH = 3;

export function seedIsUsable(seed: string): boolean {
  return seed.trim().length >= MIN_SEED_LENGTH;
}
