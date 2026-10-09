import type { BusinessKind } from '@/domain/world';
import { hashString } from '@/simulation/rng';
import { balanceLines } from './badge';
import { inkForColour } from './colour';

/**
 * The logo a local business wears.
 *
 * A club's badge is drawn for it by the badge generator; its sponsor is a real
 * business in the world — the pub the club is named after, the garage on the
 * corner, the butcher that puts a tenner behind the under-11s — and a business
 * at this level has a logo of its own, because somebody painted one on the side
 * of a van. This is where those logos are decided.
 *
 * It is the same shape of idea as `badge.ts`, drawn on the same principles:
 *
 *  - **The trade is the device.** A badge reads its symbol off the club's name;
 *    a sponsor reads its own off what the business *does*. A pint for the pub, a
 *    spanner for the garage, a cleaver for the butcher — and then one of several
 *    drawings of that thing, because two garages in one county do not have the
 *    same sign, and a world where every pub wears the identical pint is a world
 *    of fifty copies of one logo (`sponsorTrades.tsx`).
 *  - **The name is on it.** A grassroots sponsor board is a shape with the
 *    business's name across it. Initials tell a manager nothing, so the mark
 *    carries the whole name, fitted rather than set at one size.
 *  - **A logo, not a letterhead.** Real marks are not all "symbol left, words
 *    right": some are a name alone, some are a device stacked over the words,
 *    some are a block with the device knocked out of it. The layout is drawn
 *    from the business's id along with its board, its colours and its lettering,
 *    so two pubs called The Plough carry two different logos.
 *  - **Nothing is stored.** The business already exists in the world, so the
 *    mark is derived from it — no field is added to a save, and a career written
 *    before any of this existed draws exactly the same marks.
 *
 * Everything here is pure geometry in a 132x64 box; `components/SponsorMark.tsx`
 * only turns it into SVG. The same plan is drawn three ways — as a board, as a
 * print across a shirt's chest, and as a bare emblem for a list row — which is
 * what makes the mark on the finances page the mark on the shirt.
 */

/**
 * The drawn device on a sponsor's logo. One per kind of local business.
 *
 * Eight kinds of business exist in the world and eight trades cover them. They
 * are deliberately unlike each other in silhouette — a pint, a van, a cleaver —
 * because the mark is seen at 20px in a list far more often than at its full
 * size, and two shapes that read alike waste the one thing a device is for.
 * `sponsorTrades.tsx` draws several of each.
 */
export type SponsorTrade = 'pint' | 'banner' | 'van' | 'spanner' | 'cleaver' | 'cup' | 'drop' | 'basket';

/** Every trade, in a fixed order, for tests and for anything that lists them. */
export const SPONSOR_TRADES: SponsorTrade[] = ['pint', 'banner', 'van', 'spanner', 'cleaver', 'cup', 'drop', 'basket'];

/** What a business does, read as a device. */
export const TRADE_FOR_KIND: Record<BusinessKind, SponsorTrade> = {
  pub: 'pint',
  // A social club is a members' club: its sign is a banner over the door, not
  // the pint its members are drinking.
  'social-club': 'banner',
  builder: 'van',
  garage: 'spanner',
  butcher: 'cleaver',
  cafe: 'cup',
  // A plumber's sign is the drop, which is the one shape that says "water" at
  // any size.
  plumbers: 'drop',
  'farm-shop': 'basket',
};

/**
 * The shape the logo is cut to. A sponsor board, not a crest.
 *
 * The badge's silhouettes are heraldic because a crest is; a business's mark is
 * painted, printed or nailed up, so these are boards: a plate, a pub sign with
 * its corners cut, a roundel, a banner with two tails, a shield-backed board, a
 * capsule and a tag. Seven of them, because the shape is the first thing a
 * manager sees at a glance down a list of forty sponsors.
 */
export type SponsorShape = 'plate' | 'sign' | 'roundel' | 'banner' | 'shield' | 'capsule' | 'tag';

export const SPONSOR_SHAPES: SponsorShape[] = ['plate', 'sign', 'roundel', 'banner', 'shield', 'capsule', 'tag'];

/**
 * How the inside of a logo is arranged. The part that makes it look like a logo.
 *
 *  - `bar` — the device on the left, the name beside it. The commonest sign.
 *  - `stack` — the device above the name, both centred. A printed logo.
 *  - `panel` — the device in a solid block on the left, the name beside it.
 *  - `rule` — the name on the left over a rule, the device on the right.
 *  - `wordmark` — the name alone, set large. The rarest, because a business with
 *    no device on its logo is a business that paid for a typewriter.
 *
 * The bag is weighted rather than uniform: a county of forty businesses should
 * look like a county of boards, not like an exercise in four-way symmetry.
 */
export type SponsorLayout = 'bar' | 'stack' | 'panel' | 'rule' | 'wordmark';

export const SPONSOR_LAYOUTS: SponsorLayout[] = ['bar', 'stack', 'panel', 'rule', 'wordmark'];

/** The bag the layout is cut from, so a county is mostly signs and few wordmarks. */
const LAYOUT_BAG: SponsorLayout[] = [
  'bar',
  'bar',
  'bar',
  'stack',
  'stack',
  'panel',
  'panel',
  'rule',
  'rule',
  'wordmark',
];

/**
 * How a business sets its name.
 *
 * Every mark used to be set in one typeface at one weight, which is what a page
 * of them reads as: the same logo fifty times with the words changed. A trade
 * has a voice — a butcher's board is serif, a plumber's is stencilled, a
 * builder's is the widest thing that will fit — so the lettering is a third
 * stream off the business's own id, independent of the board and the colours.
 *
 * The families are the ones every platform this game runs on has: the app's own
 * sans, a serif, a narrow face and a monospace. Nothing is fetched, so a mark
 * drawn in a webview with no network still reads as the right kind of sign.
 */
export interface SponsorType {
  /** The family stack to set the name in. */
  family: string;
  weight: number;
  /** Letter-spacing in em, as a share of the size it is set at. */
  tracking: number;
  /** Whether the name is set in capitals, whatever case it was written in. */
  caps: boolean;
}

const SANS = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
const SERIF = "Georgia, 'Times New Roman', 'Noto Serif', serif";
const NARROW = "'Arial Narrow', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif";
const MONO = "ui-monospace, Consolas, 'Courier New', monospace";

export const SPONSOR_TYPES: SponsorType[] = [
  { family: SANS, weight: 800, tracking: 0.02, caps: true },
  { family: SANS, weight: 700, tracking: 0, caps: false },
  { family: SERIF, weight: 700, tracking: 0.04, caps: true },
  { family: NARROW, weight: 900, tracking: 0.03, caps: true },
  { family: MONO, weight: 700, tracking: 0.02, caps: true },
];

/**
 * The colourways a trade can be painted in.
 *
 * A business in this world has no colours of its own — nothing about the pub
 * records what colour its sign is — so the mark gives it a pair that the trade
 * makes believable, and the business's own id picks between them: a county full
 * of garages has more than one shade of garage blue, and a manager recognises
 * his own sponsor's board rather than a generic one.
 *
 * `field` is the board, `accent` is the device on it, and the name is set in
 * whatever reads on the field. Half the bag for each trade is dark and half is a
 * painted board in cream or white, because a street of signs is not all one
 * brightness — a butcher's shop has a white board with red on it as often as it
 * has a red board, and a mark that is never light is a mark that disappears in a
 * list of dark ones.
 */
export const SPONSOR_PALETTES: Record<BusinessKind, Array<{ field: string; accent: string }>> = {
  pub: [
    { field: '#14342b', accent: '#d9a03c' },
    { field: '#2a1a12', accent: '#e0b25f' },
    { field: '#3a1420', accent: '#e6c07b' },
    { field: '#f0e3c8', accent: '#1f4a38' },
    { field: '#1a2a44', accent: '#e8c86a' },
  ],
  'social-club': [
    { field: '#1d2f52', accent: '#d4b25a' },
    { field: '#2b1f3a', accent: '#cfa64a' },
    { field: '#40203a', accent: '#e0b96a' },
    { field: '#f2e8d2', accent: '#243b6b' },
    { field: '#123c40', accent: '#e0c469' },
  ],
  builder: [
    { field: '#a8451f', accent: '#f4d04a' },
    { field: '#2b3a2b', accent: '#e6cf4a' },
    { field: '#37362f', accent: '#ffd54f' },
    { field: '#f4d43c', accent: '#22262b' },
    { field: '#f2ede2', accent: '#c2471c' },
  ],
  garage: [
    { field: '#17304a', accent: '#e2604a' },
    { field: '#26303a', accent: '#f0b23a' },
    { field: '#1a2740', accent: '#d4604a' },
    { field: '#f0f2f4', accent: '#1b3d66' },
    { field: '#3a2430', accent: '#f0c24a' },
  ],
  butcher: [
    { field: '#7a1620', accent: '#f2e2c0' },
    { field: '#8a2030', accent: '#f6e8cf' },
    { field: '#6d1420', accent: '#e8d7b0' },
    { field: '#f4efe2', accent: '#8c1a24' },
    { field: '#1e3a2c', accent: '#f2e6c6' },
  ],
  cafe: [
    { field: '#5a3a22', accent: '#f0d9a8' },
    { field: '#3f2a1c', accent: '#e8c98f' },
    { field: '#6b4530', accent: '#f5e0b8' },
    { field: '#f6ecd8', accent: '#6a4326' },
    { field: '#24524c', accent: '#f2ddaa' },
  ],
  plumbers: [
    { field: '#123a5a', accent: '#6fd0ea' },
    { field: '#1b3f4a', accent: '#74ccc8' },
    { field: '#142f4a', accent: '#86cfee' },
    { field: '#eef3f6', accent: '#14496f' },
    { field: '#2e3a46', accent: '#7fd4ec' },
  ],
  'farm-shop': [
    { field: '#3c5a20', accent: '#e8d07a' },
    { field: '#2f4a1c', accent: '#dcc46a' },
    { field: '#4a5a24', accent: '#f0d98a' },
    { field: '#f3f0e0', accent: '#3d6b22' },
    { field: '#6b4a1e', accent: '#f0e0a8' },
  ],
};

/** The box a mark is planned in: a lockup is wider than it is tall. */
export const SPONSOR_MARK = { width: 132, height: 64 } as const;

/**
 * The height below which the name comes off the mark.
 *
 * A mark is drawn at whatever height the surface gives it — a finances card
 * gives it room, a list row gives it a line. Past this the lockup's name is set
 * at four units of a sixty-four, which is a smear rather than a name, and a
 * smear is worse than an emblem: the device alone still says which pub it is to
 * anyone who has met it once. Below the line the mark is drawn as an emblem,
 * which is the same board, the same colourway and the same trade, with no name
 * on it.
 */
export const SPONSOR_NAME_MIN_HEIGHT = 46;

/** How the inside of the board is keylined, as a share of the box. */
const INSET = 0.06;

const PAD = 6;

/** The room each layout gives its parts, in the plan's own box. */
const BAR_DEVICE = 40;
const BAR_CAPS: [number, number] = [15, 12.6];
const STACK_DEVICE = 26;
const STACK_CAPS: [number, number] = [14, 11.5];
const PANEL_SIZE = 52;
const PANEL_DEVICE = 34;
const PANEL_CAPS: [number, number] = [14, 11.5];
const RULE_DEVICE = 28;
const RULE_CAPS: [number, number] = [14, 12];
const WORDMARK_CAPS: [number, number] = [19, 15];

/**
 * The largest a name is set in each arrangement, on one line and on two.
 *
 * A wordmark is the name's own mark, so it is set larger than a name that is
 * sharing a board with a device.
 */
const NAME_CAPS: Record<SponsorLayout, [number, number]> = {
  bar: BAR_CAPS,
  stack: STACK_CAPS,
  panel: PANEL_CAPS,
  rule: RULE_CAPS,
  wordmark: WORDMARK_CAPS,
};

/**
 * The longest name each layout will set on one line.
 *
 * A wordmark is the name's own mark, so it breaks later than a bar does: two
 * lines of a name is a sign, a wordmark split in two is a paragraph.
 */
const ONE_LINE_UPTO: Record<SponsorLayout, number> = {
  bar: 16,
  stack: 10,
  panel: 12,
  rule: 12,
  wordmark: 10,
};

/** Inter's average glyph width at these weights, as `badge.ts` has it. */
const GLYPH_WIDTH = 0.68;
/** Capitals run about this much wider than the mixed-case average. */
const CAPS_EXTRA = 1.06;
/** Below this the name is a smear, and an emblem is drawn instead. */
const NAME_SIZE_FLOOR = 4.2;

const LINE_HEIGHT = 1.14;

/** A part of the mark, placed in the plan's box. */
export interface SponsorPart {
  x: number;
  y: number;
  size: number;
}

export interface SponsorPlan {
  /** The board's silhouette. */
  shape: SponsorShape;
  /** How the parts are arranged on it. */
  layout: SponsorLayout;
  /** The device that says what the business does. */
  trade: SponsorTrade;
  /** How the name is set. */
  type: SponsorType;
  /** The business's own name, exactly as the business is called. */
  name: string;
  /** The name, broken into the lines the board has room for. */
  nameLines: string[];
  /** The lines as they are actually set, which is where `caps` shows. */
  displayLines: string[];
  /** Font size in the plan's own box. */
  nameSize: number;
  /** Baselines for the lines of the name. */
  nameBaselines: number[];
  /** The centre of the room the name has, and how much of it there is. */
  nameX: number;
  nameWidth: number;
  /** The device's own box, centred in the space the layout gives it. */
  device: SponsorPart | null;
  /** The solid block a `panel` layout knocks its device out of. */
  panel: SponsorPart | null;
  /** The rule a `rule` layout sets under its name, and the ink under the name. */
  rule: { x1: number; x2: number; y: number } | null;
  /** The board, the device on it, and the name across it. */
  field: string;
  accent: string;
  ink: string;
}

/**
 * The board a logo is painted on, as a path in a box of the given size.
 *
 * The shapes are built to the box rather than written as constants because the
 * same mark is drawn at two sizes and in two proportions: the lockup is wide
 * because it carries a name beside its device, and the emblem is nearly square
 * and carries only the device. A board that was a fixed path could only be one
 * of those.
 */
export function boardPath(shape: SponsorShape, width: number, height: number): string {
  const m = 1;
  const w = width - m;
  const h = height - m;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(6, height / 6);
  switch (shape) {
    case 'roundel':
      return `M${m} ${cy} A${cx - m} ${cy - m} 0 1 0 ${w} ${cy} A${cx - m} ${cy - m} 0 1 0 ${m} ${cy} Z`;
    case 'banner': {
      // Two tails, cut in from each end to a point at the middle.
      const tail = Math.min(10, width / 8);
      return `M${m + tail} ${m} H${w - tail} L${w} ${cy} L${w - tail} ${h} H${m + tail} L${m} ${cy} Z`;
    }
    case 'shield':
      return (
        `M${m + r} ${m} H${w - r} A${r} ${r} 0 0 1 ${w} ${m + r} V${h - r - 4} ` +
        `Q${cx} ${h + 3} ${m} ${h - r - 4} V${m + r} A${r} ${r} 0 0 1 ${m + r} ${m} Z`
      );
    case 'sign': {
      // A pub sign board: a plate with its top two corners cut away.
      const cut = Math.min(11, height / 4);
      return `M${m + cut} ${m} H${w - cut} L${w} ${m + cut} V${h} H${m} V${m + cut} Z`;
    }
    case 'capsule': {
      // A pill: the rounded end of everything drawn by a sign shop in 1974.
      const cap = (height - m) / 2;
      return `M${m + cap} ${m} H${w - cap} A${cap} ${cap} 0 0 1 ${w - cap} ${h} H${m + cap} A${cap} ${cap} 0 0 1 ${m + cap} ${m} Z`;
    }
    case 'tag': {
      // A price tag: one corner taken off at forty-five degrees.
      const cut = Math.min(16, height / 3);
      return `M${m} ${m} H${w - cut} L${w} ${m + cut} V${h} H${m} Z`;
    }
    case 'plate':
    default:
      return (
        `M${m + r} ${m} H${w - r} A${r} ${r} 0 0 1 ${w} ${m + r} V${h - r} ` +
        `A${r} ${r} 0 0 1 ${w - r} ${h} H${m + r} A${r} ${r} 0 0 1 ${m} ${h - r} V${m + r} ` +
        `A${r} ${r} 0 0 1 ${m + r} ${m} Z`
      );
  }
}

/**
 * The transform that pulls a board's own path inwards, so it can be drawn again
 * as a keyline just inside the edge — which is what every painted board has.
 */
export function insetTransform(width: number, height: number, amount = INSET): string {
  const scale = (1 - amount * 2).toFixed(4);
  return `translate(${width / 2} ${height / 2}) scale(${scale}) translate(${-width / 2} ${-height / 2})`;
}

/** Just enough of a business to draw its logo. */
export interface SponsorBrand {
  id: string;
  name: string;
  kind: BusinessKind;
}

/**
 * Which of a trade's drawings this business uses.
 *
 * The stream is the business's own id, so the same garage always has the same
 * sign and two garages in one town do not. The count comes from the drawing
 * table rather than a constant, so a trade that gains a fourth drawing spreads
 * its businesses over four without anybody editing this.
 */
export function deviceVariantFor(id: string, count: number): number {
  return count <= 1 ? 0 : hashString(`${id}:device`) % count;
}

/** How wide a run of lettering of this length comes out, tracking included. */
export function letteringWidth(longest: number, size: number, type: SponsorType): number {
  return longest * size * (GLYPH_WIDTH * (type.caps ? CAPS_EXTRA : 1) + type.tracking);
}

/**
 * The size that makes the longest line fit the room it has been given.
 *
 * `badge.ts`'s own `fitSize` measures a name in one plain face; a mark's name
 * can be set in capitals with letter-spacing, both of which widen it, so the
 * fit is done here against the treatment's own glyph width. Everything the plan
 * then draws is inside the box it was fitted to.
 *
 * The floor is a floor only while it fits: where the floor and the room
 * disagree, the room wins, because a name that runs off its board is a fault
 * while a name set small is only a shame — and the arrangements are chosen so
 * that the disagreement almost never arises (`layoutFor`).
 */
export function fitNameSize(longest: number, width: number, cap: number, type: SponsorType): number {
  const perGlyph = GLYPH_WIDTH * (type.caps ? CAPS_EXTRA : 1) + type.tracking;
  const fitted = width / (perGlyph * Math.max(1, longest));
  return fitted >= NAME_SIZE_FLOOR ? Math.min(cap, fitted) : fitted;
}

/** The lines of a name, and the baselines they sit on in a column's middle. */
function setLines(
  lines: string[],
  type: SponsorType,
  width: number,
  caps: [number, number],
  centreY: number,
): { size: number; baselines: number[] } {
  const longest = Math.max(...lines.map((line) => line.length));
  const size = fitNameSize(longest, width, caps[lines.length - 1] ?? caps[0]!, type);
  const lineHeight = size * LINE_HEIGHT;
  // The name is centred on its own block, not hung from its top: a one-line name
  // and a two-line name are the same mark, differently wrapped.
  const first = centreY - ((lines.length - 1) * lineHeight) / 2 + size * 0.32;
  return { size, baselines: lines.map((_, index) => first + index * lineHeight) };
}

/**
 * The room each arrangement gives its name, before the name is fitted into it.
 *
 * One place, because two things ask: the plan, to place the name, and the choice
 * of arrangement, to know whether a name can be set in it at all.
 */
function nameRoom(layout: SponsorLayout): { x: number; width: number } {
  const { width } = SPONSOR_MARK;
  switch (layout) {
    case 'stack':
    case 'wordmark':
      return { x: width / 2, width: width - PAD * 2 };
    case 'panel': {
      const left = PAD + PANEL_SIZE + 8;
      const column = width - PAD - left;
      return { x: left + column / 2, width: column };
    }
    case 'rule': {
      const column = width - PAD * 2 - RULE_DEVICE - 10;
      return { x: PAD + column / 2, width: column };
    }
    case 'bar':
    default: {
      const left = PAD + BAR_DEVICE + 8;
      const column = width - PAD - left;
      return { x: left + column / 2, width: column };
    }
  }
}

/**
 * The arrangement a business's logo takes, and the name's own say in it.
 *
 * The stream off the id picks it, as everything else here is picked, with one
 * correction: a long name cannot be set in a column beside a device or a block.
 * No sign-writer would try — "Thimfleet Builders Merchants" goes across a wide
 * board, it does not go down a column beside a pint — and a name that is not
 * given room for it is set at the floor, which is a smear on the board. So a
 * name that cannot be set at its own arrangement's floor moves to the stacked
 * one, which gives the name the whole board and still keeps the device above it.
 * Only if even that cannot hold the name does it become a wordmark, which has no
 * device on it at all.
 */
function layoutFor(business: SponsorBrand, type: SponsorType): SponsorLayout {
  const picked = LAYOUT_BAG[hashString(`${business.id}:layout`) % LAYOUT_BAG.length]!;
  const words = business.name.split(/\s+/).filter(Boolean);
  const fits = (layout: SponsorLayout): boolean => {
    const lines = balanceLines(words, business.name.length <= ONE_LINE_UPTO[layout] ? 1 : 2);
    const longest = Math.max(...lines.map((line) => line.length));
    const caps = NAME_CAPS[layout];
    const room = nameRoom(layout).width;
    return fitNameSize(longest, room, caps[lines.length - 1] ?? caps[0]!, type) >= NAME_SIZE_FLOOR;
  };
  if (fits(picked)) return picked;
  return fits('stack') ? 'stack' : 'wordmark';
}

/**
 * The logo a business wears.
 *
 * Five separate streams off the business's own id, the way every other unrelated
 * draw in the game is taken: the board, the colourway, the arrangement, the
 * lettering and the drawing of the device. One hash cut into fifths does not
 * spread — businesses generated in a run have near-identical ids, and the low
 * bits of their hashes are near-identical too, which is how forty pubs in one
 * county ended up wearing one pint between them. The trade is the one thing that
 * is not drawn: it is a fact about what the business does.
 */
/**
 * The parts of a business's logo that every drawing of it shares.
 *
 * The board and the shirt's patch are the same brand — the same silhouette, the
 * same colours, the same lettering and the same trade — because a manager sees
 * the pub on his finances page and the pub on his shirt, and two logos for one
 * business is not a logo. Only the arrangement differs, so only the arrangement
 * is decided separately.
 */
function brandFor(business: SponsorBrand): {
  shape: SponsorShape;
  palette: { field: string; accent: string };
  type: SponsorType;
} {
  const palettes = SPONSOR_PALETTES[business.kind];
  return {
    shape: SPONSOR_SHAPES[hashString(`${business.id}:board`) % SPONSOR_SHAPES.length]!,
    palette: palettes[hashString(`${business.id}:colour`) % palettes.length]!,
    type: SPONSOR_TYPES[hashString(`${business.id}:face`) % SPONSOR_TYPES.length]!,
  };
}

export function sponsorPlan(business: SponsorBrand): SponsorPlan {
  const { width, height } = SPONSOR_MARK;
  const cy = height / 2;
  const { shape, palette, type } = brandFor(business);
  const layout = layoutFor(business, type);

  const words = business.name.split(/\s+/).filter(Boolean);
  const lines = balanceLines(words, business.name.length <= ONE_LINE_UPTO[layout] ? 1 : 2);
  const { x: nameX, width: nameWidth } = nameRoom(layout);
  const caps = NAME_CAPS[layout];

  let centreY = cy;
  let device: SponsorPart | null = null;
  let panel: SponsorPart | null = null;
  let rule: SponsorPlan['rule'] = null;

  switch (layout) {
    case 'stack': {
      // The device over the name, both on the middle line: a printed logo.
      device = { x: width / 2, y: PAD + STACK_DEVICE / 2, size: STACK_DEVICE };
      centreY = 44;
      break;
    }
    case 'panel': {
      // A solid block of the device's colour, with the device knocked out of it.
      panel = { x: PAD, y: (height - PANEL_SIZE) / 2, size: PANEL_SIZE };
      device = { x: PAD + PANEL_SIZE / 2, y: cy, size: PANEL_DEVICE };
      break;
    }
    case 'rule': {
      // The name over a rule, the device on the other side of it.
      device = { x: width - PAD - RULE_DEVICE / 2, y: cy, size: RULE_DEVICE };
      break;
    }
    case 'wordmark': {
      // No device at all: the name, large, and the board around it.
      break;
    }
    case 'bar':
    default: {
      device = { x: PAD + BAR_DEVICE / 2, y: cy, size: BAR_DEVICE };
      break;
    }
  }

  const { size, baselines } = setLines(lines, type, nameWidth, caps, centreY);
  if (layout === 'rule') {
    // The rule sits under the last line, as a sign-writer would rule it off, and
    // runs a little past the name to the edge of the device's column.
    const last = baselines[baselines.length - 1]!;
    rule = { x1: PAD, x2: nameX + nameWidth / 2 + 8, y: Math.min(height - 3, last + size * 0.8) };
  }

  return {
    shape,
    layout,
    trade: TRADE_FOR_KIND[business.kind],
    type,
    name: business.name,
    nameLines: lines,
    displayLines: type.caps ? lines.map((line) => line.toUpperCase()) : lines,
    nameSize: size,
    nameBaselines: baselines,
    nameX,
    nameWidth,
    device,
    panel,
    rule,
    field: palette.field,
    accent: palette.accent,
    ink: inkForColour(palette.field),
  };
}

/**
 * The box a logo is printed in on a shirt: smaller than a board, and squarer.
 *
 * A shirt has less room than a board and the print has to leave the crest and
 * the kit firm's mark where they are, so a sponsor's patch is a patch and not a
 * hoarding. It is planned in the shirt's own units rather than reduced from the
 * lockup, because a lockup scaled down to this size sets its name at three units
 * of the shirt's hundred and twenty — which is not a name, it is a smudge — and
 * the whole point of the patch is that the name on it can be read.
 */
export const SPONSOR_CHEST = { width: 42, height: 26 } as const;

/** The margin between the patch's own edge and what is printed on it. */
const CHEST_PAD = 2;

/** The device on a patch, and the gap under it. */
const CHEST_DEVICE = 12;
const CHEST_DEVICE_GAP = 1.5;

/** The largest a name is set on a patch. */
const CHEST_NAME_CAP = 9.5;

/**
 * The smallest a one-line name may be and still share its patch with the device.
 *
 * A patch is the size of the chest, so there are two ways to spend it: a device
 * with a smaller name under it, or the name alone, set large. A name that could
 * only be set at five units with the device on the patch is a name nobody reads,
 * and the board the patch is cut to, its colours and its lettering say which
 * business it is from across a table anyway.
 */
const CHEST_NAME_SHARED_MIN = 7;

/** A sponsor's logo as it is printed on a shirt. */
export interface SponsorChestPlan {
  shape: SponsorShape;
  trade: SponsorTrade;
  type: SponsorType;
  name: string;
  nameLines: string[];
  displayLines: string[];
  nameSize: number;
  nameBaselines: number[];
  nameX: number;
  nameWidth: number;
  device: SponsorPart | null;
  field: string;
  accent: string;
  ink: string;
}

/**
 * The same logo, arranged for the chest of a shirt.
 *
 * The trade, the board, the colours and the lettering come off the business's id
 * exactly as they do on a board, so the patch is the business's own mark; what
 * is arranged here is only where its parts sit in a box this small.
 */
export function sponsorChestPlan(business: SponsorBrand): SponsorChestPlan {
  const { shape, palette, type } = brandFor(business);
  const { width, height } = SPONSOR_CHEST;
  const inner = width - CHEST_PAD * 2;
  const words = business.name.split(/\s+/).filter(Boolean);
  // Whether the name can share the patch: one line, set large enough to read.
  const shared = fitNameSize(business.name.length, inner, CHEST_NAME_CAP, type) >= CHEST_NAME_SHARED_MIN;
  // A long name gets three lines rather than two, because two lines of a long
  // name on a patch this small is a name set at four units — which is the
  // problem the patch exists to solve.
  const wanted = shared || words.length <= 1 ? 1 : words.length >= 3 ? 3 : 2;
  const lines = balanceLines(words, wanted);

  const device: SponsorPart | null = shared
    ? { x: width / 2, y: CHEST_PAD + 0.5 + CHEST_DEVICE / 2, size: CHEST_DEVICE }
    : null;
  const top = device ? device.y + CHEST_DEVICE / 2 + CHEST_DEVICE_GAP : CHEST_PAD;
  const centreY = (top + (height - CHEST_PAD)) / 2;
  const { size, baselines } = setLines(lines, type, inner, [CHEST_NAME_CAP, CHEST_NAME_CAP], centreY);

  return {
    shape,
    trade: TRADE_FOR_KIND[business.kind],
    type,
    name: business.name,
    nameLines: lines,
    displayLines: type.caps ? lines.map((line) => line.toUpperCase()) : lines,
    nameSize: size,
    nameBaselines: baselines,
    nameX: width / 2,
    nameWidth: inner,
    device,
    field: palette.field,
    accent: palette.accent,
    ink: inkForColour(palette.field),
  };
}

/**
 * A sponsor as a mark needs it, or nothing.
 *
 * Most sponsors are real businesses in the world, but the game allows one with
 * nobody behind it — a name on the chest and no trade to draw. That one has no
 * mark, and this is the single place that decides so, rather than each screen
 * asking the same question.
 */
export function sponsorBrand(sponsor: {
  id: string;
  name: string;
  kind: BusinessKind | null;
}): SponsorBrand | null {
  return sponsor.kind ? { id: sponsor.id, name: sponsor.name, kind: sponsor.kind } : null;
}

/** The name the plan fits, never a truncation: a board says the whole thing. */
export function planNameFits(plan: SponsorPlan): boolean {
  return plan.nameLines.join(' ') === plan.name && plan.nameSize >= NAME_SIZE_FLOOR;
}
