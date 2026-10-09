import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Business, BusinessKind } from '@/domain/world';
import { SponsorMark, SponsorPrintArt } from './components/SponsorMark';
import {
  boardPath,
  deviceVariantFor,
  fitNameSize,
  letteringWidth,
  SPONSOR_CHEST,
  SPONSOR_LAYOUTS,
  SPONSOR_MARK,
  SPONSOR_NAME_MIN_HEIGHT,
  SPONSOR_PALETTES,
  SPONSOR_SHAPES,
  SPONSOR_TRADES,
  SPONSOR_TYPES,
  sponsorBrand,
  sponsorChestPlan,
  sponsorPlan,
  TRADE_FOR_KIND,
  type SponsorType,
} from './sponsorMark';
import { SPONSOR_TRADE_DEVICES } from './sponsorTrades';

/**
 * Sponsor marks.
 *
 * A sponsor's logo is how a manager recognises the pub that backs him — on the
 * finances page, in the world's list of businesses and printed across the front
 * of his own shirt — so three things have to hold: the trade is on it, the
 * business's own name is on it, and the same business always wears the same
 * logo. A fourth was added after the marks were first drawn: a county of forty
 * businesses must not be wearing six logos between them.
 */

const KINDS: BusinessKind[] = [
  'pub',
  'social-club',
  'builder',
  'garage',
  'butcher',
  'cafe',
  'plumbers',
  'farm-shop',
];

/** The names a sponsor actually has in this world, from the generator's lists. */
const NAMES = [
  'The Old White Hart',
  'Riverside Garage',
  'Wheatlands Farm shop',
  'Apex Butcher and Partners',
  'Daneway',
  'The Plough',
  'Colney Sport',
  'Thimfleet Builders Merchants',
];

function business(id: string, name: string, kind: BusinessKind = 'pub'): Business {
  return { id, name, kind, townId: 'town_1', wealth: 11, sponsoredClubIds: [] };
}

/** A run of ids like the generator produces: near-identical, in order. */
function run(kind: BusinessKind = 'pub', name = 'The Plough', count = 400): Business[] {
  return Array.from({ length: count }, (_, index) => business(`biz_${String(index).padStart(4, '0')}`, name, kind));
}

function mark(business_: Business, height: number): string {
  return renderToStaticMarkup(createElement(SponsorMark, { business: business_, height }));
}

/**
 * Whether a drawing carries a name, ignoring the case it was set in.
 *
 * A treatment with `caps` sets the name in capitals, which is the point of it, so
 * a check for the name as the business writes it would fail on every sign-writer
 * in the county.
 */
function carries(markup: string, name: string): boolean {
  // A wrapped name is drawn as one tspan per line, so the words are checked
  // rather than the whole name — a two-line name is never one substring.
  const upper = markup.toUpperCase();
  return name
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => upper.includes(word.toUpperCase()));
}

/** What makes two letterings different, since two treatments share a family. */
function typeKey(type: SponsorType): string {
  return `${type.family}|${type.weight}|${type.tracking}|${type.caps}`;
}

function print(business_: Business): string {
  return renderToStaticMarkup(
    createElement(SponsorPrintArt, { business: business_, print: { edge: '#ffffff' } }),
  );
}

describe('the trade on a mark', () => {
  it('gives every kind of business a device', () => {
    for (const kind of KINDS) {
      expect(SPONSOR_TRADES).toContain(TRADE_FOR_KIND[kind]);
    }
  });

  it('draws three or more devices for every trade', () => {
    for (const trade of SPONSOR_TRADES) {
      // One drawing per trade was the complaint: twenty pubs in a county wearing
      // the identical pint. A trade with two drawings is still a county of one.
      expect(SPONSOR_TRADE_DEVICES[trade].length).toBeGreaterThanOrEqual(3);
      for (const draw of SPONSOR_TRADE_DEVICES[trade]) expect(typeof draw).toBe('function');
    }
    // A trade with no drawings is a mark with a hole in it, so the two tables are
    // the same table.
    expect(Object.keys(SPONSOR_TRADE_DEVICES).sort()).toEqual([...SPONSOR_TRADES].sort());
  });

  it('reaches every drawing of a trade across a county of businesses', () => {
    for (const trade of SPONSOR_TRADES) {
      const family = SPONSOR_TRADE_DEVICES[trade];
      const seen = new Set(run().map((biz) => deviceVariantFor(biz.id, family.length)));
      expect(seen.size).toBe(family.length);
    }
  });

  it('reads the device off what the business does, not off how it is named', () => {
    // The same name, four trades, four devices: this is the difference between a
    // sponsor's mark and a club's badge.
    const trades = new Set(
      (['pub', 'garage', 'butcher', 'cafe'] as BusinessKind[]).map(
        (kind) => sponsorPlan(business('biz_1', 'The Old White Hart', kind)).trade,
      ),
    );
    expect(trades.size).toBe(4);
  });
});

describe('sponsorPlan', () => {
  it('is the same mark for the same business, every time', () => {
    const first = sponsorPlan(business('biz_7', 'Riverside Garage', 'garage'));
    const second = sponsorPlan(business('biz_7', 'Riverside Garage', 'garage'));
    expect(second).toEqual(first);
  });

  it('carries the business’s own name, never initials', () => {
    const plan = sponsorPlan(business('biz_7', 'Riverside Garage', 'garage'));
    expect(plan.name).toBe('Riverside Garage');
    expect(plan.nameLines.join(' ')).toBe('Riverside Garage');
  });

  it('sets the name in the case its treatment asks for, and no other', () => {
    for (const biz of run('garage', 'Riverside Garage', 60)) {
      const plan = sponsorPlan(biz);
      expect(plan.displayLines.join(' ')).toBe(
        plan.type.caps ? 'Riverside Garage'.toUpperCase() : 'Riverside Garage',
      );
      if (!plan.type.caps) expect(plan.displayLines).toEqual(plan.nameLines);
    }
  });

  it('fits the name and the device inside the board, whatever the arrangement', () => {
    for (const name of NAMES) {
      for (const kind of KINDS) {
        for (const biz of run(kind, name, 60)) {
          const plan = sponsorPlan(biz);
          const { width, height } = SPONSOR_MARK;
          // Nothing a layout places may overrun the box it was planned in.
          if (plan.device) {
            expect(plan.device.x - plan.device.size / 2).toBeGreaterThanOrEqual(0);
            expect(plan.device.x + plan.device.size / 2).toBeLessThanOrEqual(width);
            expect(plan.device.y - plan.device.size / 2).toBeGreaterThanOrEqual(0);
            expect(plan.device.y + plan.device.size / 2).toBeLessThanOrEqual(height);
          }
          if (plan.panel) {
            expect(plan.panel.x).toBeGreaterThanOrEqual(0);
            expect(plan.panel.x + plan.panel.size).toBeLessThanOrEqual(width);
            expect(plan.panel.y + plan.panel.size).toBeLessThanOrEqual(height);
          }
          expect(plan.nameX - plan.nameWidth / 2).toBeGreaterThanOrEqual(0);
          expect(plan.nameX + plan.nameWidth / 2).toBeLessThanOrEqual(width);
          for (const baseline of plan.nameBaselines) {
            expect(baseline).toBeGreaterThan(0);
            expect(baseline).toBeLessThanOrEqual(height);
          }
          if (plan.rule) {
            expect(plan.rule.y).toBeGreaterThan(0);
            expect(plan.rule.y).toBeLessThanOrEqual(height);
            expect(plan.rule.x1).toBeGreaterThanOrEqual(0);
            expect(plan.rule.x2).toBeLessThanOrEqual(width);
          }
          // And the name it fits is a name that can be read, set inside the room
          // it was given.
          expect(plan.nameSize).toBeGreaterThanOrEqual(4);
          const longest = Math.max(...plan.nameLines.map((line) => line.length));
          expect(letteringWidth(longest, plan.nameSize, plan.type)).toBeLessThanOrEqual(plan.nameWidth + 0.01);
        }
      }
    }
  });

  it('does not paint a county of businesses with one logo between them', () => {
    // The complaint this answers: forty pubs in a county, one pint and three
    // colourways. Board, colour, arrangement, lettering and device are five
    // separate streams off the business's id, so they vary apart from each other.
    const plans = run('pub', 'The Plough', 200).map(sponsorPlan);
    expect(new Set(plans.map((plan) => plan.shape)).size).toBeGreaterThan(3);
    expect(new Set(plans.map((plan) => plan.field)).size).toBeGreaterThan(3);
    expect(new Set(plans.map((plan) => plan.layout)).size).toBe(SPONSOR_LAYOUTS.length);
    expect(new Set(plans.map((plan) => typeKey(plan.type))).size).toBe(SPONSOR_TYPES.length);
    // Two treatments share the app's own sans, so the families alone are fewer
    // than the treatments — but a county is not all one voice either.
    expect(new Set(plans.map((plan) => plan.type.family)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(plans.map((plan) => plan.trade)).size).toBe(1);
  });

  it('reaches every board, arrangement, lettering and colourway there is', () => {
    for (const kind of KINDS) {
      const plans = run(kind, 'The Plough').map(sponsorPlan);
      expect(new Set(plans.map((plan) => plan.shape))).toEqual(new Set(SPONSOR_SHAPES));
      expect(new Set(plans.map((plan) => plan.layout))).toEqual(new Set(SPONSOR_LAYOUTS));
      expect(new Set(plans.map((plan) => typeKey(plan.type)))).toEqual(new Set(SPONSOR_TYPES.map(typeKey)));
      expect(new Set(plans.map((plan) => plan.field))).toEqual(
        new Set(SPONSOR_PALETTES[kind].map((palette) => palette.field)),
      );
    }
  });

  it('gives every colourway a board its accent can be drawn on', () => {
    for (const kind of KINDS) {
      expect(SPONSOR_PALETTES[kind].length).toBeGreaterThanOrEqual(4);
      for (const palette of SPONSOR_PALETTES[kind]) {
        expect(palette.field).toMatch(/^#[0-9a-f]{6}$/i);
        expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
        expect(palette.accent).not.toBe(palette.field);
      }
    }
  });

  it('gives every colourway a name that reads on it', () => {
    for (const kind of KINDS) {
      for (const biz of run(kind, 'The Plough', 200)) {
        const plan = sponsorPlan(biz);
        expect(plan.ink).not.toBe(plan.field);
      }
    }
  });
});

describe('the board', () => {
  it('closes every silhouette at either size it is drawn', () => {
    for (const shape of SPONSOR_SHAPES) {
      for (const [width, height] of [
        [SPONSOR_MARK.width, SPONSOR_MARK.height],
        [32, 32],
      ]) {
        const path = boardPath(shape, width!, height!);
        expect(path.startsWith('M')).toBe(true);
        expect(path.endsWith('Z')).toBe(true);
      }
    }
  });

  it('makes seven different silhouettes', () => {
    const paths = SPONSOR_SHAPES.map((shape) => boardPath(shape, SPONSOR_MARK.width, SPONSOR_MARK.height));
    expect(new Set(paths).size).toBe(SPONSOR_SHAPES.length);
  });
});

describe('the mark as it is displayed', () => {
  it('carries the name and the trade when it is given the room for both', () => {
    const one = business('biz_7', 'Riverside Garage', 'garage');
    const markup = mark(one, 64);
    expect(carries(markup, 'Riverside Garage')).toBe(true);
    // The garage's own colourway, drawn from the business's id.
    expect(markup).toContain(sponsorPlan(one).field);
  });

  it('drops the name and keeps the trade when it is not', () => {
    const markup = mark(business('biz_7', 'Riverside Garage', 'garage'), 20);
    expect(carries(markup, 'Riverside Garage')).toBe(false);
    expect(markup).toContain('<svg');
  });

  it('draws the name for the last height that can carry one, and not below it', () => {
    const one = business('biz_7', 'Riverside Garage', 'garage');
    expect(carries(mark(one, SPONSOR_NAME_MIN_HEIGHT), 'Riverside Garage')).toBe(true);
    expect(carries(mark(one, SPONSOR_NAME_MIN_HEIGHT - 1), 'Riverside Garage')).toBe(false);
  });

  it('hides itself from a screen reader, because the name is always beside it', () => {
    expect(mark(business('biz_7', 'Riverside Garage', 'garage'), 64)).toContain('aria-hidden="true"');
  });

  it('gives forty businesses in a row more than thirty logos between them', () => {
    // The other half of the complaint, measured on what is actually rendered
    // rather than on the plan: a manager scrolling a list of sponsors.
    const drawn = new Set(run('pub', 'The Plough', 40).map((biz) => mark(biz, 64)));
    expect(drawn.size).toBeGreaterThan(30);
  });

  it('prints the same brand on a shirt that it hangs on a board', () => {
    // The patch is arranged for a chest and the board for a shopfront, so the
    // geometry differs — but it is one brand: the same silhouette, the same
    // colourway, the same trade and the same lettering, or the pub on the
    // finances page is not the pub on the shirt.
    for (const biz of run('garage', 'Riverside Garage', 40)) {
      const plan = sponsorPlan(biz);
      const chest = sponsorChestPlan(biz);
      expect(chest.shape).toBe(plan.shape);
      expect(chest.trade).toBe(plan.trade);
      expect(chest.field).toBe(plan.field);
      expect(chest.accent).toBe(plan.accent);
      expect(chest.type).toEqual(plan.type);
    }
  });

  it('prints the patch filled, in the business’s own colours', () => {
    // The complaint this answers: the board on a shirt was drawn as an outline,
    // so the lettering sat on bare cloth and vanished into a stripe.
    const one = business('biz_7', 'Riverside Garage', 'garage');
    const plan = sponsorChestPlan(one);
    const markup = print(one);
    expect(carries(markup, 'Riverside Garage')).toBe(true);
    expect(markup).toContain(`fill="${plan.field}"`);
    // And the name is set in the colour that reads on that fill, not in the
    // shirt's ink.
    expect(markup).toContain(`fill="${plan.ink}"`);
  });
});

describe('the patch on a shirt', () => {
  it('is a patch and not a hoarding: smaller than the board it comes from', () => {
    expect(SPONSOR_CHEST.width * SPONSOR_CHEST.height).toBeLessThan(SPONSOR_MARK.width * SPONSOR_MARK.height / 4);
    // And small enough to leave the crest and the kit firm's mark their room: the
    // shirt it is printed on is 120 units wide.
    expect(SPONSOR_CHEST.width).toBeLessThanOrEqual(44);
  });

  it('keeps everything it prints inside the patch', () => {
    for (const name of NAMES) {
      for (const kind of KINDS) {
        for (const biz of run(kind, name, 20)) {
          const plan = sponsorChestPlan(biz);
          const { width, height } = SPONSOR_CHEST;
          if (plan.device) {
            expect(plan.device.x - plan.device.size / 2).toBeGreaterThanOrEqual(0);
            expect(plan.device.x + plan.device.size / 2).toBeLessThanOrEqual(width);
            expect(plan.device.y + plan.device.size / 2).toBeLessThanOrEqual(height);
          }
          for (const baseline of plan.nameBaselines) {
            expect(baseline).toBeGreaterThan(0);
            expect(baseline).toBeLessThanOrEqual(height);
          }
          const longest = Math.max(...plan.nameLines.map((line) => line.length));
          expect(letteringWidth(longest, plan.nameSize, plan.type)).toBeLessThanOrEqual(plan.nameWidth + 0.01);
        }
      }
    }
  });

  it('sets the name large enough to read, which is what the patch is for', () => {
    for (const name of NAMES) {
      expect(sponsorChestPlan(business('biz_1', name, 'pub')).nameSize).toBeGreaterThanOrEqual(4.2);
    }
  });

  it('gives the device to the names that can share the patch, and the name the patch alone when it cannot', () => {
    const short = sponsorChestPlan(business('biz_1', 'Daneway', 'pub'));
    const long = sponsorChestPlan(business('biz_1', 'Thimfleet Builders Merchants', 'pub'));
    expect(short.device).not.toBeNull();
    expect(long.device).toBeNull();
    // And the long one is still a logo: the board is the business's own, and its
    // name is set across it rather than shrunk into a corner.
    expect(long.nameLines.join(' ')).toBe('Thimfleet Builders Merchants');
    // Wrapping it made it bigger, which is the whole point of wrapping it: set
    // on one line in the same room it would be a smear.
    const onOneLine = fitNameSize(long.name.length, SPONSOR_CHEST.width - 4, 9.5, long.type);
    expect(long.nameSize).toBeGreaterThan(onOneLine);
    expect(long.nameSize).toBeGreaterThanOrEqual(4.2);
  });
});

describe('sponsorBrand', () => {
  it('draws a logo only for a sponsor that is a real business', () => {
    expect(sponsorBrand({ id: 'biz_7', name: 'Riverside Garage', kind: 'garage' })).toEqual({
      id: 'biz_7',
      name: 'Riverside Garage',
      kind: 'garage',
    });
    // A sponsor with nobody behind it has no trade, and so no logo.
    expect(sponsorBrand({ id: 'biz_8', name: 'A Benefactor', kind: null })).toBeNull();
  });
});
