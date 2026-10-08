import type { Club } from '@/domain/club';
import type { BadgeChoice, BadgeDevice, BadgePattern, BadgeShape } from '@/domain/badge';
// The vocabulary of a badge belongs to the club, not to the drawing of it, so
// the types live in the domain and are re-exported here for the screens that
// only ever meet them alongside the artwork.
export type { BadgeChoice, BadgeDevice, BadgePattern, BadgeShape } from '@/domain/badge';
import { hashString } from '@/simulation/rng';
import { inkForColour, secondaryColour, type ClubColours } from './colour';

/**
 * Club badges, drawn rather than illustrated.
 *
 * No club in this world has a crest designed by a human, so every club gets one
 * from the same deterministic generator. A real grassroots badge is three
 * things at once:
 *
 *  - a silhouette, usually a shield, an arch or a roundel;
 *  - the club's own two colours, carried as a chief, a band or a pattern;
 *  - a device that *means* something — a hart for the White Hart, a sheaf for
 *    the Barley Mow, a wheel for the Railwaymen — with the club's name around
 *    it and, where there is room, the year it was founded.
 *
 * The name is the club's actual name, not initials: a manager reads a badge the
 * way he reads a pub sign, and "TOTT" tells him nothing.
 *
 * Everything here is pure geometry in a 64x64 box; `components/Badge.tsx` only
 * turns it into SVG.
 */

export const BADGE_SHAPES: BadgeShape[] = [
  'shield',
  'roundel',
  'oval',
  'arch',
  'pennant',
  // The silhouettes added when the county turned out to be five badges between
  // them: a county of forty clubs wears ten shapes now rather than five, which is
  // the difference between recognising an opponent and recognising a colour.
  // Appended, so the five the generator already dealt keep their places — a club
  // that wore a shield still wears one; a club whose shape came out of the new
  // half of the list may wake up in a different one, because there are more
  // shapes in the bag than the five it was drawn from.
  //
  // A diamond was drawn as well and taken back out again, which is worth
  // recording: it is the most distinctive silhouette of the lot, and it cannot
  // carry a badge. A name runs round the top of a crest and a symbol stands in
  // the middle, and a diamond's sides cut in at forty-five degrees — the one
  // place a run of lettering is guaranteed to pass through. Fitting a name and a
  // sixteen-unit symbol inside one left the name at three and a half units of
  // the sixty-four, a smudge on the page, and a crest nobody can read is not more
  // variety, it is a worse crest. The octagon is the diamond's roomy cousin and
  // it is here instead.
  'octagon',
  'plaque',
  'swallowtail',
  'gable',
  'ovalWide',
];

export const BADGE_PATTERNS: BadgePattern[] = [
  'stripes',
  'hoops',
  'halves',
  'quarters',
  'sash',
  'chevron',
  'pinstripes',
  'plain',
  'bordure',
  'perFess',
  'saltire',
];

/**
 * The patterns that run across the middle of the field, where the symbol is.
 *
 * A symbol on one of these needs a plate of its own to stand on: its ink was
 * picked to read against the club's first colour, and the middle of the field
 * is the one place a pattern is guaranteed to be sitting under it.
 * `components/Badge.tsx` draws that plate, and the ring of a round badge closes
 * over the same area for the same reason.
 */
const BUSY_PATTERNS: BadgePattern[] = [
  'stripes',
  'pinstripes',
  'hoops',
  'halves',
  'quarters',
  'sash',
  'chevron',
  'perFess',
  'saltire',
];

export function patternIsBusy(pattern: BadgePattern): boolean {
  return BUSY_PATTERNS.includes(pattern);
}

export const BADGE_SHAPE_PATHS: Record<BadgeShape, string> = {
  shield: 'M32 3 L60 11 V33 C60 46 48.5 55.5 32 61 C15.5 55.5 4 46 4 33 V11 Z',
  roundel: 'M4 32 A28 28 0 1 1 60 32 A28 28 0 1 1 4 32 Z',
  // A shade wider than it used to be: lettering set on an arc reaches outwards
  // from it, and the narrow sides of a thin oval left the ends of a name with
  // nowhere to stand but through the edge.
  oval: 'M32 3 A24 29 0 1 1 32 61 A24 29 0 1 1 32 3 Z',
  arch: 'M6 62 V20 A26 17 0 0 1 58 20 V62 Z',
  pennant: 'M5 5 H59 V40 L32 60 L5 40 Z',
  // Every one of these five keeps the whole width of the badge at the height the
  // name is set, so a long name is not squeezed into a point: a club's name is
  // the one thing a crest must carry, and a silhouette that eats it is not a
  // shape, it is a fault. Each is a different silhouette at 18px — eight sides, a
  // square with cut corners, two tails, a shallow peak and a diamond.
  octagon: 'M22 5 H42 L59 22 V42 L42 59 H22 L5 42 V22 Z',
  plaque: 'M8 5 H56 A4 4 0 0 1 60 9 V55 A4 4 0 0 1 56 59 H8 A4 4 0 0 1 4 55 V9 A4 4 0 0 1 8 5 Z',
  swallowtail: 'M5 5 H59 V60 L32 47 L5 60 Z',
  gable: 'M6 61 V14 L32 6 L58 14 V61 Z',
  ovalWide: 'M3 32 A29 25 0 1 1 61 32 A29 25 0 1 1 3 32 Z',
};

export const BADGE_DEVICES: BadgeDevice[] = [
  'ball',
  'stag',
  'lion',
  'horse',
  'bull',
  'ram',
  'fox',
  'hound',
  'badger',
  'bird',
  'swan',
  'sheaf',
  'tree',
  'rose',
  'crown',
  'ship',
  'anchor',
  'keys',
  'bell',
  'plough',
  'barrels',
  'hop',
  'wheel',
  'sun',
  'star',
  'anvil',
  'tower',
  'bridge',
  'castle',
  'chequers',
  'bolt',
  'laurel',
  'cross',
  'trowel',
  // The second wave: things a local club is genuinely named after and the
  // library had no symbol for. Appended rather than inserted, so no club in an
  // existing career wakes up wearing a different crest because the library grew.
  'gate',
  'well',
  'beehive',
  'fish',
  'arrow',
  'lamp',
  'hammer',
  'mallet',
  'mitre',
  'chalice',
  'vine',
  'millstone',
  'spade',
  'sword',
  // The third wave. Same rule as the second: appended, so a club whose name
  // they do not catch wears exactly the crest it wore yesterday.
  'eagle',
  'owl',
  'peacock',
  'dolphin',
  'hare',
  'boar',
  'bear',
  'unicorn',
  'griffin',
  'dragon',
  'windmill',
  'fleece',
  'pickaxe',
];

/**
 * What a club's symbol is, read off what it is called.
 *
 * This is the heart of the badge: a club called the White Hart carries a stag,
 * the Dockers carry an anchor, the Barley Mow carries a sheaf. The order of the
 * table is the rule where a name says two things — "Rose and Crown" is a rose
 * and not a crown, "Fox and Hounds" is a fox, "Cross Keys" is a pair of keys —
 * so the most particular word in the name is the one that wins.
 *
 * A word matches when it starts or ends with the keyword, because place names
 * put the meaningful part at either end: Oakley is an oak, Haxbridge is a
 * bridge, Kirkby is a church. A keyword buried in the middle of a word is never
 * a match, so Bramford is not a ram.
 */
/**
 * How much of an arc a name may run round, as a multiple of its radius.
 *
 * A full half circle would take the lettering right out to the widest point of
 * the shape, where a round badge is at its narrowest at the height the letters
 * actually sit. 2.4 keeps the ends of the run clear of the edge.
 */
const ARC_SPAN = 2.4;

const DEVICE_WORDS: Array<[BadgeDevice, string[]]> = [
  ['stag', ['hart', 'stag', 'deer', 'buck', 'roebuck', 'doe']],
  ['keys', ['key', 'latch', 'lock', 'lockyer']],
  ['rose', ['rose', 'rosette', 'briar']],
  ['barrels', ['tun', 'barrel', 'cask', 'cooper', 'coopers']],
  /* The one symbol that has to be read before the sheaf.

     "corn" is one of the sheaf's words and it matches the end of "unicorn",
     which is the only way a horse with a horn was ever going to be a sheaf of
     corn. Nothing else moves: a club called the Unicorn was wearing a sheaf,
     and no name that says corn means anything but corn. */
  ['unicorn', ['unicorn', 'unicorns']],
  ['sheaf', ['wheat', 'barley', 'sheaf', 'corn', 'mow', 'harvest', 'farmer', 'farm']],
  ['tree', ['oak', 'elm', 'thorn', 'ash', 'willow', 'birch', 'cedar', 'pine', 'beech', 'hawthorn', 'hazel', 'alder', 'sycamore', 'chestnut', 'poplar', 'aspen', 'holly', 'yew', 'tree', 'wood', 'grove', 'copse', 'forest', 'cottage', 'cottager', 'ranger']],
  // The mill is its own club, and it was wearing a waggon wheel: a name the
  // sign says plainly, so it is read before the wheel that would have taken it.
  ['windmill', ['windmill', 'windmills']],
  ['wheel', ['wheel', 'mill', 'waggon', 'wagon', 'coach', 'cart', 'railway', 'rail', 'rails', 'locomotive', 'station', 'signal', 'junction', 'siding', 'traction']],
  ['hop', ['hop', 'brewer', 'brewery', 'ale', 'malt', 'malthouse', 'beer', 'bitters']],
  ['anvil', ['forge', 'smith', 'anvil', 'nail']],
  ['trowel', ['bricklayer', 'mason', 'builder']],
  ['plough', ['plough', 'plow', 'tillage', 'furrow', 'tractor']],
  ['anchor', ['anchor', 'docker', 'dock']],
  ['ship', ['ship', 'ferry', 'ferryman', 'nelson', 'sailor', 'mariner', 'boat', 'quay', 'barge', 'trawler', 'ketch', 'sloop', 'harbour', 'marina']],
  ['bell', ['bell', 'peal', 'carillon']],
  ['chequers', ['chequer', 'chequerboard']],
  ['sun', ['sun', 'sol']],
  ['star', ['star', 'north', 'pole', 'astro']],
  ['crown', ['crown', 'royal', 'king', 'queen', 'duke', 'earl', 'prince', 'princess', 'imperial', 'coronet', 'regina', 'majesty', 'victoria', 'regal']],
  ['lion', ['lion', 'lioness', 'albion', 'rampant']],
  ['bull', ['bull', 'cow', 'cattle', 'heifer']],
  ['ram', ['ram', 'sheep', 'lamb']],
  ['fox', ['fox', 'vixen']],
  // A hare before a hound, for the same reason a fox is: "Hare and Hounds" is a
  // hare first, and the sign says so.
  ['hare', ['hare', 'hares', 'harebell', 'leveret']],
  /* The other one that has to be read before the hound.

     "colliers" begins with the name of a sheepdog, so the pit village's side
     was wearing a collie. A club called the Colliers works the coal, and no
     name that says collie means anything but the dog. */
  ['pickaxe', ['pickaxe', 'miner', 'miners', 'collier', 'colliers', 'pitman', 'pitmen', 'coal']],
  ['hound', ['hound', 'dog', 'poach', 'greyhound', 'whippet', 'terrier', 'spaniel', 'collie', 'lurcher', 'beagle', 'mastiff']],
  ['badger', ['badger', 'brock']],
  ['swan', ['swan', 'pelican', 'goose', 'duck']],
  /* The birds that used to be one bird.

     Every club named for a bird wore the same drawing, so the Owls, the
     Eagles and the Robins of a county were one crest between them. Each of
     these is a different *silhouette*, not a different keyword, which is the
     only thing that tells at 18px. They sit above the general bird because a
     name that says "owl" says more than one that says "owl" only in the
     sense that an owl is a bird. */
  ['owl', ['owl', 'owls']],
  ['eagle', ['eagle', 'eagles', 'buzzard', 'buzzards', 'kite', 'kites']],
  ['peacock', ['peacock', 'peacocks']],
  ['dolphin', ['dolphin', 'dolphins', 'porpoise']],
  ['bird', ['bird', 'robin', 'swift', 'magpie', 'crow', 'rook', 'lark', 'finch', 'thrush', 'martin', 'dove', 'starling', 'swallow', 'jackdaw', 'heron', 'harrier', 'sparrow', 'wren', 'kestrel', 'falcon', 'hawk', 'pigeon', 'cardinal', 'chough', 'cormorant', 'curlew', 'gull', 'merlin', 'nightjar', 'plover', 'snipe']],
  ['horse', ['horse', 'pony', 'stallion', 'mare', 'groom', 'stirrup', 'saddle', 'harness', 'farrier', 'galloway']],
  ['bridge', ['bridge', 'ford']],
  ['tower', ['kirk', 'church', 'abbey', 'priory', 'minster', 'tower', 'steeple', 'chapel', 'st mary', 'st peter']],
  ['castle', ['castle', 'fort', 'keep', 'united', 'barbican', 'motte', 'bailey', 'donjon', 'town', 'city']],
  ['cross', ['cross', 'george', 'st george', 'crusader']],
  ['laurel', ['laurel', 'legion', 'corinthian', 'athletic', 'olympic', 'victor', 'victory', 'wreath']],
  ['bolt', ['dynamo', 'bolt', 'lightning', 'electric']],

  /* The newer symbols. These are appended rather than folded into the table
     above because the table's order is its rule: an entry only ever takes a
     name from the entries below it, so adding these at the bottom cannot move
     a crest that clubs already wear. */
  ['gate', ['gate', 'gates', 'gatehouse', 'portcullis', 'turnpike']],
  ['well', ['well', 'wells', 'spring', 'fountain', 'font']],
  ['beehive', ['bee', 'bees', 'beehive', 'hive', 'apiary', 'honey']],
  ['fish', ['fish', 'fisher', 'fisherman', 'fishermen', 'trout', 'salmon', 'pike', 'tench', 'eel', 'eels', 'otter']],
  ['arrow', ['arrow', 'arrows', 'archer', 'archers', 'bow', 'bowman', 'bowmen', 'fletcher', 'quiver']],
  ['lamp', ['lamp', 'lamps', 'lantern', 'beacon', 'light', 'lights']],
  ['hammer', ['hammer', 'hammers', 'sledge', 'smiddy']],
  ['mallet', ['mallet', 'joiner', 'joiners', 'carpenter', 'carpenters']],
  ['mitre', ['mitre', 'bishop', 'bishops', 'bishopric', 'canon']],
  ['chalice', ['chalice', 'cup', 'goblet', 'grail', 'tankard']],
  ['vine', ['vine', 'vines', 'vineyard', 'grape', 'grapes']],
  ['millstone', ['millstone', 'millstones', 'stone', 'stones', 'quarry', 'quarries']],
  ['spade', ['spade', 'spades', 'gardener', 'gardeners', 'allotment', 'digger', 'diggers']],
  ['sword', ['sword', 'swords', 'blade', 'blades', 'sabre', 'cutler', 'cutlers']],

  /* The third wave: the beasts of the pub signs and the trades the county is
     named after. Appended, like the second wave, so nothing already drawn
     moves — a name these catch was wearing a generic symbol before, and now
     wears its own. */
  ['boar', ['boar', 'boars']],
  ['bear', ['bear', 'bears', 'bruin']],
  ['griffin', ['griffin', 'griffins', 'gryphon']],
  ['dragon', ['dragon', 'dragons', 'wyvern']],
  // Not "wool" on its own: a keyword that matches the front of a word takes
  // every place name that begins with it, and the county is full of Woolcrofts
  // and Woolstons that are named for the place and not for the fleece. The
  // word has to be the whole of what the club is called.
  ['fleece', ['fleece', 'woolpack', 'comber', 'combers', 'shearer', 'shearers']],
];

/** Devices for clubs whose name says nothing at all: still varied, still theirs. */
const GENERIC_DEVICES: BadgeDevice[] = [
  'ball',
  'laurel',
  'star',
  'castle',
  'tower',
  'cross',
  'crown',
  'tree',
  'ship',
  'lion',
  'gate',
  'well',
  'beehive',
  'fish',
  'arrow',
  'lamp',
  'hammer',
  'mallet',
  'mitre',
  'chalice',
  'vine',
  'millstone',
  'spade',
  'sword',
  // Appended so a club with nothing in its name still gets a look at the
  // newest drawings — a county of anonymous Social Clubs was wearing the same
  // two dozen crests whatever else the library held.
  'eagle',
  'owl',
  'peacock',
  'dolphin',
  'hare',
  'boar',
  'bear',
  'unicorn',
  'griffin',
  'dragon',
  'windmill',
  'fleece',
  'pickaxe',
];

/**
 * The symbol for a club, from its name and its nickname.
 *
 * The name comes first because it is the club's own choice of words; the
 * nickname is what everyone actually calls them, and a "Pelicans" badge is
 * exactly what a real club with that nickname would wear.
 */
/**
 * Words that say when a club plays rather than what it is called.
 *
 * A name takes only a handful of shapes and a few of the words in them belong
 * to the league rather than to the club: the day it plays on, and what kind of
 * side it is. "Thimfleet Sunday" is not named after the sun, but it was wearing
 * one — and because that name shape is one of the commonest in the county, a
 * fifth of the world was wearing the same crest. A club with a Sunday in its
 * name and nothing in its weather now takes a symbol of its own.
 */
const NOT_SYMBOLS = new Set(['sunday', 'reserves', 'sfc']);

export function deviceFor(name: string, nickname = ''): BadgeDevice | null {
  return matchDevice(name) ?? matchDevice(nickname);
}

function matchDevice(text: string): BadgeDevice | null {
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0 && !NOT_SYMBOLS.has(word));
  for (const [device, keywords] of DEVICE_WORDS) {
    for (const word of words) {
      for (const keyword of keywords) {
        if (word.startsWith(keyword) || word.endsWith(keyword)) return device;
      }
    }
  }
  return null;
}

interface BadgeFrame {
  /** How the name is carried: a band across the top, or arcs around a round badge. */
  kind: 'chief' | 'round';
  /** The top of the chief band. */
  bandTop: number;
  /** The width the name has to fit into. */
  nameWidth: number;
  /** The lowest point the symbol may reach when the badge carries no year. */
  fieldBottom: number;
  /** The widest the symbol may be. */
  deviceWidth: number;
  /** The baseline for the year line, or null where the shape has no room for one. */
  yearY: number | null;
  /** The baseline radius for text on an arc. */
  arcRadius: number;
}

/**
 * How much room each silhouette gives.
 *
 * The arc radii are the awkward ones: text set on an arc of radius R reaches R
 * plus a capital letter's height, and it has to do that inside a shape whose
 * widest point is not where the ends of the arc are. These numbers are the
 * largest radius that still leaves the lettering inside the edge with the halo
 * behind it — measured on the real badges rather than guessed at.
 */
const BADGE_FRAMES: Record<BadgeShape, BadgeFrame> = {
  shield: { kind: 'chief', bandTop: 9, nameWidth: 50, fieldBottom: 56, deviceWidth: 34, yearY: 57.5, arcRadius: 0 },
  arch: { kind: 'chief', bandTop: 12, nameWidth: 46, fieldBottom: 58, deviceWidth: 36, yearY: 59.5, arcRadius: 0 },
  pennant: { kind: 'chief', bandTop: 9, nameWidth: 46, fieldBottom: 48, deviceWidth: 26, yearY: 50, arcRadius: 0 },
  roundel: { kind: 'round', bandTop: 0, nameWidth: 0, fieldBottom: 47, deviceWidth: 24, yearY: null, arcRadius: 19.5 },
  oval: { kind: 'round', bandTop: 0, nameWidth: 0, fieldBottom: 45.5, deviceWidth: 20, yearY: null, arcRadius: 18 },
  // Where the band may start, and how wide the name's slot is at that height: an
  // octagon is still narrowing where its band begins, and a diamond is a diamond
  // the whole way down, so both of those give the name less width than a shield
  // does. `yearY` is null on the swallowtail because its tails have taken the
  // bottom corners, and there is nowhere left for a year to sit.
  octagon: { kind: 'chief', bandTop: 12, nameWidth: 34, fieldBottom: 52, deviceWidth: 34, yearY: 55.5, arcRadius: 0 },
  plaque: { kind: 'chief', bandTop: 10, nameWidth: 50, fieldBottom: 50, deviceWidth: 34, yearY: 52, arcRadius: 0 },
  swallowtail: { kind: 'chief', bandTop: 9, nameWidth: 46, fieldBottom: 44, deviceWidth: 30, yearY: null, arcRadius: 0 },
  gable: { kind: 'chief', bandTop: 13, nameWidth: 42, fieldBottom: 57, deviceWidth: 34, yearY: 58.5, arcRadius: 0 },
  // The other way up from the oval: a badge whose widest stretch is across the
  // middle, so its arcs have the room a tall oval cannot give them.
  ovalWide: { kind: 'round', bandTop: 0, nameWidth: 0, fieldBottom: 44, deviceWidth: 20, yearY: null, arcRadius: 18 },
};

/**
 * The largest lettering a round badge's arcs may carry, by silhouette.
 *
 * A circle is the same distance from the middle in every direction, so a name
 * set on an arc of a roundel can be as large as its band could ever make it. No
 * other shape is: lettering on an arc stands up *outwards* from it, so the ends
 * of a name run out towards the narrow part of the shape, and on a thin oval or
 * a diamond the outermost letters of a large run are through the edge — cropped
 * by the silhouette, which is a crest with a letter missing rather than a crest
 * that is too full. This is the largest a line can be set on each shape and still
 * stand inside it, with the halo behind it, measured on the rendered badges by
 * `isPointInFill` rather than worked out on paper.
 *
 * The number for a shape is worked out from the point on the run that is worst
 * for it, which is not the end of the run: a circle round the top of a badge is
 * closest to the edge at the top, and a diamond is closest to the edge at 45
 * degrees, where its two sides have both cut in. A run of two and a half radians
 * covers both, so every shape between them has to be measured rather than
 * reasoned about.
 *
 * Where a shape is missing from the table its arcs are as roomy as a roundel's
 * and the ordinary cap applies. Chief shapes are not here at all: their lettering
 * is a straight run in a band, measured against the band's width instead.
 */
const ARC_NAME_CAP: Partial<Record<BadgeShape, number>> = {
  oval: 6.5,
  ovalWide: 6.5,
};

/**
 * Roughly how wide a bold sans-serif character is, as a fraction of its size.
 *
 * It is used to decide how large a name can be set, so being on the low side is
 * the one mistake that shows: the name is fitted to the band, then rendered
 * wider than the fitting believed and either pushed out through the silhouette
 * or clipped by it. This was 0.54 for a long time, which is what a *regular*
 * weight measures at; the lettering on a badge is set at weight 800, and a
 * browser asked for 800 in a stack of system faces gives it a wide or synthetic
 * bold. Measured against the real thing on a crest sheet — a run fitted to 46
 * units coming out at 57 — and rounded up to leave a little air. */
const GLYPH_WIDTH = 0.68;
/** A line of name text costs this much height for every point of its size. */
const LINE_HEIGHT = 1.14;
/** The most a line of name text may be drawn at, by how many lines there are. */
const NAME_SIZE_CAP = [8.6, 7.4, 6.4];
const NAME_SIZE_FLOOR = 4.2;
/** Long names go around a round badge instead of across it. */
const ARC_MAX_CHARS = 17;
const YEAR_SIZE = 4.6;
/** Space above and below the name inside its band. */
const BAND_PAD_TOP = 3.4;
const BAND_PAD_BOTTOM = 2.2;
/**
 * The smallest the symbol is ever drawn.
 *
 * A badge carries two things, and the name does not get to swallow the other
 * one: where a long name would leave the symbol a smudge, the name gives ground
 * instead.
 */
const MIN_DEVICE = 16;

/** Air between the symbol's box and the keyline round it. */
const SYMBOL_GAP = 1.1;

/**
 * The smallest box a round badge's symbol is ever drawn in.
 *
 * A round badge used to let the lettering take whatever it liked and hand the
 * symbol what was left over, which for a short name was thirteen units of the
 * sixty-four the badge is drawn in — a fifth of the crest, and a smudge on the
 * page. The ring is what the symbol stands in, so the ring is what has a floor.
 */
const MIN_SYMBOL_BOX = 16;

/**
 * The smallest ring a round badge may close.
 *
 * Derived rather than picked: the ring holds the symbol, corner and all, and the
 * corner of a square is its side times the root of two — so this is the ring that
 * exactly holds `MIN_SYMBOL_BOX`, with the air between box and keyline.
 */
const MIN_RING = MIN_SYMBOL_BOX / Math.SQRT2 + SYMBOL_GAP;

/**
 * How far *in* from its arc a line of lettering reaches, as a share of its size.
 *
 * This is what the ring is measured against, and it depends on which way up the
 * line is set. A name goes round the *top* of a round badge with its capitals
 * pointing out at the edge — outward is where a capital reaches, and the only
 * thing such a line takes inward is a descender, with the halo round it. A year,
 * or the second line of a long name, goes round the *bottom*, where the capitals
 * point in at the middle of the badge and the whole height of the letters is
 * taken out of the field the symbol stands in.
 *
 * The two numbers are not interchangeable, and treating them as one is why a
 * round badge's ring used to close a long way inside its lettering: it held back
 * the full height of a capital for a line of letters that only ever reached in
 * with a tail, leaving a bare annulus of field and a symbol small enough to miss.
 * The fractions are measured on the pixel sweep, which counts the ink actually
 * drawn inside the ring rather than the ink the metrics claim.
 */
const INWARD_DESCENDER = 0.45;
const INWARD_CAPS = 0.9;

/**
 * The plate a symbol stands on, where the field under it is patterned.
 *
 * The ink a symbol is drawn in was picked to read against the club's first
 * colour, and the middle of a patterned field is the one place a band of the
 * second colour is guaranteed to be sitting under it. So the symbol gets a
 * plate of its own — the field colour again, with a keyline round it, which is
 * exactly what the real badges that carry a device on a striped field do.
 */
function plateFor(deviceSize: number, room: number): { size: number; radius: number } | null {
  const size = Math.min(deviceSize * 1.14, room);
  // Two thirds of a box is not a plate, it is a smudge behind the corners: a
  // field too tight for one leaves the symbol standing on the field as before.
  if (size < deviceSize * 0.9) return null;
  return { size, radius: size * 0.22 };
}

/**
 * The largest a line of lettering may be set on this silhouette's arcs.
 *
 * The shape's own room where it has less than a roundel's, and the ordinary cap
 * where it has no entry: a circle's arcs are the roomiest a round badge can have.
 */
function arcNameCapFor(shape: BadgeShape): number {
  return ARC_NAME_CAP[shape] ?? NAME_SIZE_CAP[0]!;
}

/**
 * The circle the lettering of a round badge is drawn around.
 *
 * It is measured off the lettering and nothing else, because the ring is the
 * boundary the eye reads: it has to sit inside the name above it and inside the
 * year below it, or it cuts through the letters and looks like a mistake. What
 * "inside" means depends on which line it is — see the two shares above — and the
 * symbol in the middle is then the ring's business, not the lettering's.
 */
function ringRadiusFor(arcRadius: number, lines: Array<{ size: number; side: 'top' | 'bottom' }>): number {
  const inward = Math.max(
    ...lines.map((line) => line.size * (line.side === 'top' ? INWARD_DESCENDER : INWARD_CAPS)),
  );
  return Math.max(MIN_RING, arcRadius - inward - 1.2);
}

/**
 * The largest box the symbol can stand in inside that ring, centred in it.
 *
 * The box is a square and the ring is a circle, so the corner is what decides:
 * half a side times the root of two has to stay inside the keyline with a hair
 * of field left between them. A short name leaves a smaller ring, which means a
 * smaller symbol — the one place on a badge where the name wins outright.
 */
function symbolBoxFor(ringRadius: number): number {
  return (ringRadius - SYMBOL_GAP) * Math.SQRT2;
}

export interface BadgePlan {
  shape: BadgeShape;
  pattern: BadgePattern;
  device: BadgeDevice;
  /** The club's own name, exactly as the club is called. */
  name: string;
  /** The name, broken into the lines the badge has room for. */
  nameLines: string[];
  /** How the name is carried: a chief band, a top arc, or both arcs. */
  nameLayout: 'chief' | 'arc' | 'ring';
  /** Font size in the badge's own 64-unit box. */
  nameSize: number;
  /** The width the name had to fit into. */
  nameWidth: number;
  /** Baselines for the lines of a chief band. */
  nameBaselines: number[];
  bandTop: number;
  bandBottom: number;
  /** The baseline radius for text on an arc. */
  arcRadius: number;
  primary: string;
  secondary: string;
  /** Ink for anything drawn straight onto the field — the symbol and the year. */
  ink: string;
  /** The band behind the name, or 'none' where both colours are the same. */
  bandFill: string;
  bandInk: string;
  deviceX: number;
  deviceY: number;
  deviceSize: number;
  /**
   * The plate behind the symbol, where the field under it carries a pattern.
   *
   * Null wherever the symbol stands on a plain field colour, which is most
   * badges: a plate there would be a rectangle of the colour already behind it.
   */
  devicePanel: { size: number; radius: number } | null;
  /** The keyline inside the lettering of a round badge. Zero on a chief. */
  ringRadius: number;
  /**
   * Whether the middle of a round badge is painted plain, leaving the pattern
   * in the ring — which is what a round badge with a striped band looks like.
   */
  ringPlain: boolean;
  /** The year the club was founded, where the badge shows one. */
  year: string | null;
  yearOnArc: boolean;
  yearY: number;
  yearSize: number;
  /** A thin line just inside the silhouette, which most real badges have. */
  inset: boolean;
}

/**
 * Break a name into lines that suit the badge it is going on.
 *
 * Words stay whole — a badge that splits a word looks like a mistake — and the
 * lines are balanced, because "Draywick Social / Club FC" reads better than
 * "Draywick / Social Club FC".
 */
export function balanceLines(words: string[], count: number): string[] {
  if (count <= 1 || words.length <= 1) return [words.join(' ')];
  const wanted = Math.min(count, words.length);
  let best = [words.join(' ')];
  let bestLongest = Infinity;
  const walk = (start: number, left: number, lines: string[]): void => {
    if (left === 1) {
      const candidate = [...lines, words.slice(start).join(' ')];
      const longest = Math.max(...candidate.map((line) => line.length));
      if (longest < bestLongest) {
        bestLongest = longest;
        best = candidate;
      }
      return;
    }
    for (let end = start + 1; end <= words.length - left + 1; end += 1) {
      walk(end, left - 1, [...lines, words.slice(start, end).join(' ')]);
    }
  };
  walk(0, wanted, []);
  return best;
}

/** How many lines a name of this length is worth breaking into. */
function lineCountFor(length: number): number {
  if (length <= 13) return 1;
  if (length <= 26) return 2;
  return 3;
}

/** The size that makes the longest line fit the width it has been given. */
export function fitSize(longest: number, width: number, cap: number): number {
  return Math.max(NAME_SIZE_FLOOR, Math.min(cap, width / (GLYPH_WIDTH * Math.max(1, longest))));
}

export function badgePlan(
  club: Pick<Club, 'id' | 'identity'> & { badge?: BadgeChoice },
): BadgePlan {
  const identity = club.identity;
  const colours: ClubColours = identity.colours;
  const primary = colours.primary;
  const secondary = secondaryColour(colours);
  const seed = hashString(club.id);
  // A club that designed its own badge wears that; anything it left alone it
  // takes from the generator, exactly as every other club in the world does.
  const choice = club.badge;
  // Three separate streams off the club's own id, the way every other unrelated
  // draw in the game is taken. One hash cut into thirds does not spread: clubs
  // generated in a run have near-identical ids, and the low bits of their hashes
  // are near-identical too — which is why forty anonymous sides used to wear
  // fourteen crests out of a library of thirty-four.
  const shape = choice?.shape ?? BADGE_SHAPES[hashString(`${club.id}:shape`) % BADGE_SHAPES.length]!;
  const frame = BADGE_FRAMES[shape];
  const sameColours = secondary.toLowerCase() === primary.toLowerCase();

  // A pattern is drawn in the second colour, so a club wearing one colour has
  // nothing for it to be drawn in and stays plain whatever was asked for.
  const pattern: BadgePattern = sameColours
    ? 'plain'
    : choice?.pattern ?? BADGE_PATTERNS[hashString(`${club.id}:pattern`) % BADGE_PATTERNS.length]!;
  const device =
    choice?.device ??
    deviceFor(identity.name, identity.nickname) ??
    GENERIC_DEVICES[hashString(`${club.id}:device`) % GENERIC_DEVICES.length]!;

  // The symbol is drawn over the primary colour, so it takes that colour's ink.
  const ink = inkForColour(primary);
  const bandFill = sameColours ? 'none' : secondary;
  const bandInk = sameColours ? ink : inkForColour(secondary);

  // Roughly two thirds of badges show when the club was founded — and a badge
  // only shows it when the name has left it somewhere to go.
  const year = seed % 100 < 64 ? String(identity.foundedYear) : null;

  const name = identity.name;
  const words = name.split(/\s+/).filter(Boolean);

  if (frame.kind === 'round') {
    // A round badge is built outwards from its ring: the lettering goes round
    // the outside of it, the symbol stands inside it, and the keyline between
    // the two is the line the whole crest is read against. The symbol is
    // centred in the ring, which is also the middle of the shape — the arcs of
    // lettering above and below it are the same distance away.
    const deviceY = 32;
    // A patterned ring with a plain middle is a round badge's oldest trick, and
    // it is also what keeps the symbol off the stripes.
    const ringPlain = patternIsBusy(pattern);

    if (name.length > ARC_MAX_CHARS) {
      // Too long for one arc: the name wraps round the badge, top and bottom,
      // which is exactly how a real round badge with a long name does it.
      const lines = balanceLines(words, 2);
      const longest = Math.max(...lines.map((line) => line.length));
      const nameSize = fitSize(
        longest,
        ARC_SPAN * frame.arcRadius,
        Math.min(NAME_SIZE_CAP[1]!, arcNameCapFor(shape)),
      );
      // Both lines of a long name are the name: one round the top, one round the
      // bottom, so the ring clears whichever of them reaches furthest in.
      const ringRadius = ringRadiusFor(frame.arcRadius, [
        { size: nameSize, side: 'top' },
        { size: nameSize, side: 'bottom' },
      ]);
      return {
        shape,
        pattern,
        device,
        name,
        nameLines: lines,
        nameLayout: 'ring',
        nameSize,
        nameWidth: ARC_SPAN * frame.arcRadius,
        nameBaselines: [],
        bandTop: 0,
        bandBottom: 0,
        arcRadius: frame.arcRadius,
        primary,
        secondary,
        ink,
        bandFill,
        bandInk,
        deviceX: 32,
        deviceY,
        deviceSize: symbolBoxFor(ringRadius),
        devicePanel: null,
        ringRadius,
        ringPlain,
        year: null,
        yearOnArc: false,
        yearY: 0,
        yearSize: YEAR_SIZE,
        inset: (seed >>> 17) % 100 < 62,
      };
    }

    // A short name goes round the top, and the year — if the club shows one —
    // round the bottom, which is the classic round badge.
    const nameSize = fitSize(name.length, ARC_SPAN * frame.arcRadius, arcNameCapFor(shape));
    // The name above, the year below, and the ring inside whichever of the two
    // reaches nearest the middle.
    const ringRadius = ringRadiusFor(frame.arcRadius, [
      { size: nameSize, side: 'top' },
      ...(year !== null ? [{ size: YEAR_SIZE, side: 'bottom' as const }] : []),
    ]);
    return {
      shape,
      pattern,
      device,
      name,
      nameLines: [name],
      nameLayout: 'arc',
      nameSize,
      nameWidth: ARC_SPAN * frame.arcRadius,
      nameBaselines: [],
      bandTop: 0,
      bandBottom: 0,
      arcRadius: frame.arcRadius,
      primary,
      secondary,
      ink,
      bandFill,
      bandInk,
      deviceX: 32,
      deviceY,
      deviceSize: symbolBoxFor(ringRadius),
      devicePanel: null,
      ringRadius,
      ringPlain,
      year,
      yearOnArc: year !== null,
      yearY: 0,
      yearSize: YEAR_SIZE,
      inset: (seed >>> 17) % 100 < 62,
    };
  }

  // A chief: the name in a band across the top, the symbol beneath it, and the
  // year along the base when the name has not used all the room.
  const lines = balanceLines(words, lineCountFor(name.length));
  const longest = Math.max(...lines.map((line) => line.length));
  const floorDevice = Math.min(frame.deviceWidth, MIN_DEVICE);

  // The name is set as large as the badge allows, then given ground — a little
  // at a time — until the symbol has a box it can actually be drawn in.
  let nameSize = fitSize(longest, frame.nameWidth, NAME_SIZE_CAP[lines.length - 1]!);
  let lineHeight = nameSize * LINE_HEIGHT;
  let bandBottom = frame.bandTop + BAND_PAD_TOP + lines.length * lineHeight + BAND_PAD_BOTTOM;
  while (frame.fieldBottom - (bandBottom + 1.5) < floorDevice && nameSize > NAME_SIZE_FLOOR + 0.001) {
    nameSize = Math.max(NAME_SIZE_FLOOR, nameSize * 0.96);
    lineHeight = nameSize * LINE_HEIGHT;
    bandBottom = frame.bandTop + BAND_PAD_TOP + lines.length * lineHeight + BAND_PAD_BOTTOM;
  }
  const nameBaselines = lines.map(
    (_, index) => frame.bandTop + BAND_PAD_TOP + index * lineHeight + nameSize * 0.8,
  );

  const deviceTop = bandBottom + 1.5;
  const yearRoom = frame.yearY === null ? null : frame.yearY - YEAR_SIZE - 1.5;
  // A year is a luxury: it only goes on a badge that can still show its symbol.
  const showYear = year !== null && yearRoom !== null && yearRoom - deviceTop >= floorDevice;
  const deviceBottom = showYear && yearRoom !== null ? yearRoom : frame.fieldBottom;
  const deviceSize = Math.max(8, Math.min(frame.deviceWidth, deviceBottom - deviceTop));
  const deviceY = deviceTop + deviceSize / 2;
  // The plate stops at the band above it and at the year line below, so it can
  // never eat into either — and where a year has taken the room, the plate is
  // the symbol's own box, because that is all the field there is.
  const plateRoom = Math.min(deviceY - bandBottom - 1.2, frame.fieldBottom - deviceY) * 2;

  return {
    shape,
    pattern,
    device,
    name,
    nameLines: lines,
    nameLayout: 'chief',
    nameSize,
    nameWidth: frame.nameWidth,
    nameBaselines,
    bandTop: frame.bandTop,
    bandBottom,
    arcRadius: 0,
    primary,
    secondary,
    ink,
    bandFill,
    bandInk,
    deviceX: 32,
    deviceY,
    deviceSize,
    devicePanel: patternIsBusy(pattern) ? plateFor(deviceSize, plateRoom) : null,
    // A chief has no ring: the band carries the name, so there is nothing for a
    // keyline to close.
    ringRadius: 0,
    ringPlain: false,
    year: showYear ? year : null,
    yearOnArc: false,
    yearY: frame.yearY ?? 0,
    yearSize: YEAR_SIZE,
    inset: (seed >>> 17) % 100 < 62,
  };
}
