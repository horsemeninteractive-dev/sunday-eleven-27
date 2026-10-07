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

export const BADGE_SHAPES: BadgeShape[] = ['shield', 'roundel', 'oval', 'arch', 'pennant'];

export const BADGE_PATTERNS: BadgePattern[] = [
  'stripes',
  'hoops',
  'halves',
  'quarters',
  'sash',
  'chevron',
  'pinstripes',
  'plain',
];

export const BADGE_SHAPE_PATHS: Record<BadgeShape, string> = {
  shield: 'M32 3 L60 11 V33 C60 46 48.5 55.5 32 61 C15.5 55.5 4 46 4 33 V11 Z',
  roundel: 'M4 32 A28 28 0 1 1 60 32 A28 28 0 1 1 4 32 Z',
  oval: 'M32 3 A22 29 0 1 1 32 61 A22 29 0 1 1 32 3 Z',
  arch: 'M6 62 V20 A26 17 0 0 1 58 20 V62 Z',
  pennant: 'M5 5 H59 V40 L32 60 L5 40 Z',
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
  ['sheaf', ['wheat', 'barley', 'sheaf', 'corn', 'mow', 'harvest', 'farmer', 'farm']],
  ['tree', ['oak', 'elm', 'thorn', 'ash', 'willow', 'birch', 'cedar', 'pine', 'beech', 'hawthorn', 'hazel', 'alder', 'sycamore', 'chestnut', 'poplar', 'aspen', 'holly', 'yew', 'tree', 'wood', 'grove', 'copse', 'forest', 'cottage', 'cottager', 'ranger']],
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
  ['hound', ['hound', 'dog', 'poach', 'greyhound', 'whippet', 'terrier', 'spaniel', 'collie', 'lurcher', 'beagle', 'mastiff']],
  ['badger', ['badger', 'brock']],
  ['swan', ['swan', 'pelican', 'goose', 'duck']],
  ['bird', ['bird', 'robin', 'swift', 'magpie', 'crow', 'lark', 'finch', 'thrush', 'martin', 'dove', 'starling', 'swallow', 'jackdaw', 'heron', 'harrier', 'sparrow', 'wren', 'kestrel', 'falcon', 'hawk', 'owl', 'pigeon']],
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
];

/**
 * The symbol for a club, from its name and its nickname.
 *
 * The name comes first because it is the club's own choice of words; the
 * nickname is what everyone actually calls them, and a "Pelicans" badge is
 * exactly what a real club with that nickname would wear.
 */
export function deviceFor(name: string, nickname = ''): BadgeDevice | null {
  return matchDevice(name) ?? matchDevice(nickname);
}

function matchDevice(text: string): BadgeDevice | null {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
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
  arch: { kind: 'chief', bandTop: 11, nameWidth: 48, fieldBottom: 58, deviceWidth: 36, yearY: 59.5, arcRadius: 0 },
  pennant: { kind: 'chief', bandTop: 9, nameWidth: 46, fieldBottom: 50, deviceWidth: 26, yearY: 52, arcRadius: 0 },
  roundel: { kind: 'round', bandTop: 0, nameWidth: 0, fieldBottom: 47, deviceWidth: 24, yearY: null, arcRadius: 19.5 },
  oval: { kind: 'round', bandTop: 0, nameWidth: 0, fieldBottom: 45.5, deviceWidth: 20, yearY: null, arcRadius: 18 },
};

/** Roughly how wide a bold sans-serif character is, as a fraction of its size. */
const GLYPH_WIDTH = 0.54;
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

  if (frame.kind === 'round' && name.length > ARC_MAX_CHARS) {
    // Too long for one arc: the name wraps round the badge, top and bottom,
    // which is exactly how a real round badge with a long name does it.
    const lines = balanceLines(words, 2);
    const longest = Math.max(...lines.map((line) => line.length));
    const nameSize = fitSize(longest, ARC_SPAN * frame.arcRadius, NAME_SIZE_CAP[1]!);
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
      deviceY: 35.5,
      deviceSize: Math.min(frame.deviceWidth, MIN_DEVICE, frame.fieldBottom - 24.5),
      year: null,
      yearOnArc: false,
      yearY: 0,
      yearSize: YEAR_SIZE,
      inset: (seed >>> 17) % 100 < 62,
    };
  }

  if (frame.kind === 'round') {
    // A short name goes round the top, and the year — if the club shows one —
    // round the bottom, which is the classic round badge.
    const nameSize = fitSize(name.length, ARC_SPAN * frame.arcRadius, NAME_SIZE_CAP[0]!);
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
      deviceY: 35.5,
      deviceSize: Math.min(frame.deviceWidth, MIN_DEVICE, frame.fieldBottom - 24.5),
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
    deviceY: deviceTop + deviceSize / 2,
    deviceSize,
    year: showYear ? year : null,
    yearOnArc: false,
    yearY: frame.yearY ?? 0,
    yearSize: YEAR_SIZE,
    inset: (seed >>> 17) % 100 < 62,
  };
}
