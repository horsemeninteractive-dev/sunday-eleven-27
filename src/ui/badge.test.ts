import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Club } from '@/domain/club';
import {
  BADGE_DEVICES,
  BADGE_LETTERING,
  BADGE_PATTERNS,
  BADGE_SHAPE_PATHS,
  BADGE_SHAPES,
  type BadgeLettering,
  badgePlan,
  deviceFor,
  fitLettering,
  letteringWidth,
  patternIsBusy,
} from './badge';
import { BADGE_DEVICE_SHAPES, DEVICE_INK } from './badgeDevices';
import { ClubBadge } from './components/Badge';
import { contrastRatio } from './colour';

/**
 * Badges.
 *
 * A badge is how a manager recognises an opponent in a table, in a fixture list
 * and in a news item, so three things have to hold: the club's own name is on
 * it, the symbol says something about the club, and the same club always wears
 * the same badge.
 */

function club(id: string, name: string, primary: string, secondary: string, nickname = 'the testers'): Club {
  return {
    id,
    identity: {
      name,
      shortName: name.slice(0, 3).toUpperCase(),
      nickname,
      foundedYear: 1974,
      colours: { primary, secondary },
      motto: 'nil satis',
    },
  } as unknown as Club;
}

/** Forty clubs wearing the same colours: everything about them differs by name. */
function crowd(names: string[]): Club[] {
  return names.map((name, index) => club(`club_${String(index).padStart(3, '0')}`, name, '#37474f', '#ffd54f'));
}

describe('badgePlan', () => {
  it('is the same badge for the same club, every time', () => {
    const first = badgePlan(club('club_007', 'Draywick Social Club FC', '#ef6c00', '#212121'));
    const second = badgePlan(club('club_007', 'Draywick Social Club FC', '#ef6c00', '#212121'));
    expect(second).toEqual(first);
  });

  it('carries the club’s own name, never initials', () => {
    const plan = badgePlan(club('club_007', 'Draywick Social Club FC', '#ef6c00', '#212121'));
    expect(plan.name).toBe('Draywick Social Club FC');
    expect(plan.nameLines.join(' ')).toBe('Draywick Social Club FC');
    // Nothing on a badge is ever two letters standing in for a name.
    expect(plan.nameLines.some((line) => line === 'DS')).toBe(false);
  });

  it('keeps every word of a long name, however it is broken up', () => {
    const names = [
      'The Old Waggon and Horses FC',
      'The Old White Hart FC',
      'Woolcroft Social Club FC',
      'Nether Bramford Corinthians',
      'St Mary’s Bricklayers Arms',
    ];
    for (const name of names) {
      const plan = badgePlan(club('club_001', name, '#c62828', '#ffffff'));
      expect(plan.nameLines.join(' ')).toBe(name);
      expect(plan.nameLines.length).toBeLessThanOrEqual(3);
    }
  });

  it('sets the name small enough to fit the room the badge gave it', () => {
    const names = [
      'Draywick Social Club FC',
      'The Old Waggon and Horses FC',
      'Fenmoor Athletic',
      'Haxbridge United',
      'Thornley Club FC',
      'Conservative',
    ];
    for (const name of names) {
      const plan = badgePlan(club('club_002', name, '#1565c0', '#ffffff'));
      const longest = Math.max(...plan.nameLines.map((line) => line.length));
      // 0.54 is the generator's own estimate of a bold glyph's width.
      expect(plan.nameSize * 0.54 * longest).toBeLessThanOrEqual(plan.nameWidth + 0.01);
    }
  });

  it('takes its symbol from what the club is called', () => {
    const cases: Array<[string, string]> = [
      ['The Old White Hart FC', 'stag'],
      ['The Old Stag', 'stag'],
      ['The Red Lion', 'lion'],
      ['The Cross Keys', 'keys'],
      ['The Barley Mow', 'sheaf'],
      ['The Wheatsheaf', 'sheaf'],
      ['The Royal Oak', 'tree'],
      ['Oakley Rovers', 'tree'],
      ['The Old Ship FC', 'ship'],
      ['The Anchor', 'anchor'],
      ['The Bell', 'bell'],
      ['The Plough', 'plough'],
      ['The Three Tuns', 'barrels'],
      ['The Chequers', 'chequers'],
      ['The Sun Inn', 'sun'],
      ['The Black Horse', 'horse'],
      ['The Swan', 'swan'],
      ['The Duke of York', 'crown'],
      ['The Bull', 'bull'],
      ['The Railway Tavern', 'wheel'],
      ['The Waggon and Horses', 'wheel'],
      ['The Station Hotel', 'wheel'],
      ['The George', 'cross'],
      ['Haxbridge United', 'bridge'],
      ['Kirkby Town', 'tower'],
      // The birds that used to be one bird, and the beasts of the pub signs.
      ['The Owls', 'owl'],
      ['The Barn Owls', 'owl'],
      ['Woolcroft Eagles', 'eagle'],
      ['The Buzzards', 'eagle'],
      ['The Gulls', 'bird'],
      ['The Cardinals', 'bird'],
      ['The Peacock', 'peacock'],
      ['The Dolphins', 'dolphin'],
      ['The Blue Boar', 'boar'],
      ['The Brown Bear', 'bear'],
      ['The Unicorn', 'unicorn'],
      ['The Griffin', 'griffin'],
      ['The Green Dragon', 'dragon'],
      ['The Windmill', 'windmill'],
      ['The Fleece', 'fleece'],
      ['The Woolpack', 'fleece'],
      ['The Miners Arms', 'pickaxe'],
      ['The Colliers', 'pickaxe'],
      ['The Pitmen', 'pickaxe'],
    ];
    for (const [name, device] of cases) {
      expect(deviceFor(name), name).toBe(device);
    }
  });

  it('reads the most particular word in the name first', () => {
    // Both of these say two things at once; the badge picks the telling one.
    expect(deviceFor('The Rose and Crown')).toBe('rose');
    expect(deviceFor('The Fox and Hounds')).toBe('fox');
    expect(deviceFor('The Royal Oak')).toBe('tree');
  });

  it('reads a hare before a hound, the way it reads a fox before one', () => {
    // Both signs name two things; the club is the first of them.
    expect(deviceFor('The Hare and Hounds')).toBe('hare');
    expect(deviceFor('The Fox and Hounds')).toBe('fox');
    // And a horse with a horn is not a sheaf of corn, though "corn" is the end
    // of its name.
    expect(deviceFor('The Unicorn')).toBe('unicorn');
    expect(deviceFor('The Wheatsheaf')).toBe('sheaf');
  });

  it('does not take a club’s symbol from the day the league plays on', () => {
    // "Thimfleet Sunday" is not named after the sun. That name shape is one of
    // the commonest in the county, so it used to be a fifth of the world in the
    // same crest; the club now takes one of its own instead.
    expect(deviceFor('Thimfleet Sunday')).toBeNull();
    expect(deviceFor('Thimfleet Sunday FC Reserves')).toBeNull();
    // A club that really is named for the sun still wears one.
    expect(deviceFor('The Sun Inn')).toBe('sun');
    expect(deviceFor('Sunbury Town')).toBe('sun');
  });

  it('does not find a keyword buried in the middle of a word', () => {
    // Bramford is not a ram, and Marston is not a star.
    expect(deviceFor('Bramford United')).not.toBe('ram');
    expect(deviceFor('Marsh End United')).not.toBe('ram');
    expect(deviceFor('Kelston Social Club FC')).toBeNull();
  });

  it('falls back to the nickname when the name says nothing', () => {
    expect(deviceFor('Woolcroft Social Club FC', 'The Pelicans')).toBe('swan');
    expect(deviceFor('Woolcroft Social Club FC', 'The Railwaymen')).toBe('wheel');
    expect(deviceFor('Draywick Social Club FC', 'The Foxes')).toBe('fox');
  });

  it('still gives an anonymous club a varied badge', () => {
    const clubs = crowd(
      Array.from({ length: 30 }, (_, index) => `Woolcroft Social Club FC ${index}`),
    );
    const devices = new Set(clubs.map((entry) => badgePlan(entry).device));
    // No keyword anywhere: the fallback still spreads them across symbols.
    expect(devices.size).toBeGreaterThan(12);
    for (const device of devices) expect(BADGE_DEVICES).toContain(device);
  });

  it('has measured where every symbol puts its ink', () => {
    // The fit that centres a drawing in its box is measured off the rendered
    // drawings, so a symbol added without a measurement would be drawn at
    // whatever size its coordinates happened to allow — the swan at half the
    // size of the dragon beside it, which is the thing that table exists to
    // stop. Every symbol, or the fit for it cannot be worked out.
    expect(Object.keys(DEVICE_INK).sort()).toEqual([...BADGE_DEVICES].sort());
  });

  it('spreads a county across the whole library', () => {
    const clubs = crowd(Array.from({ length: 40 }, (_, index) => `Woolcroft Social Club ${index}`));
    const plans = clubs.map((entry) => badgePlan(entry));
    expect(new Set(plans.map((plan) => plan.shape)).size).toBe(BADGE_SHAPES.length);
    expect(new Set(plans.map((plan) => plan.pattern)).size).toBe(BADGE_PATTERNS.length);
    expect(new Set(plans.map((plan) => plan.device)).size).toBeGreaterThan(20);
    // And no club in the county is wearing another's crest: the shapes, fields
    // and symbols combine rather than each being drawn from its own short list.
    const crests = plans.map((plan) => `${plan.shape}/${plan.pattern}/${plan.device}`);
    expect(new Set(crests).size).toBe(clubs.length);
  });

  it('keeps a library of symbols big enough that a county is not one crest', () => {
    // A badge is the first thing a manager sees of another club, so a world
    // where a third of the sides wear the same one reads smaller than it is.
    expect(new Set(BADGE_DEVICES).size).toBe(BADGE_DEVICES.length);
    expect(BADGE_DEVICES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BADGE_PATTERNS).size).toBe(BADGE_PATTERNS.length);
  });

  it('shows the founding year on some badges and not others', () => {
    const clubs = crowd(Array.from({ length: 40 }, (_, index) => `The Old Ship Inn ${index}`));
    const plans = clubs.map((entry) => badgePlan(entry));
    const withYear = plans.filter((plan) => plan.year !== null);
    expect(withYear.length).toBeGreaterThan(4);
    expect(withYear.length).toBeLessThan(plans.length);
    for (const plan of withYear) expect(plan.year).toBe('1974');
    // A year only ever appears where the symbol still has room to be drawn.
    for (const plan of plans) expect(plan.deviceSize).toBeGreaterThanOrEqual(8);
  });

  it('draws the symbol big enough to be recognised', () => {
    const clubs = crowd([
      'The Old White Hart FC',
      'Draywick Social Club FC',
      'Haxbridge United',
      'Fenmoor Athletic',
      'Conservative Club FC',
    ]);
    for (const entry of clubs) {
      const plan = badgePlan(entry);
      expect(plan.deviceSize).toBeGreaterThan(14);
      // And inside its own silhouette.
      expect(plan.deviceY + plan.deviceSize / 2).toBeLessThanOrEqual(60);
    }
  });

  it('uses the club’s two colours, and an ink that survives them', () => {
    const plan = badgePlan(club('club_012', 'Ashcroft Wanderers', '#1565c0', '#ffeb3b'));
    expect(plan.primary).toBe('#1565c0');
    expect(plan.secondary).toBe('#ffeb3b');
    expect(plan.bandFill).toBe('#ffeb3b');
    // The name sits on the second colour, so it takes that colour's ink.
    expect(contrastRatio(plan.bandInk, plan.bandFill)).toBeGreaterThan(4);
    // The symbol sits on the field, so it takes the field's ink.
    expect(contrastRatio(plan.ink, plan.primary)).toBeGreaterThan(4);
  });

  it('wears what the manager designed, and draws the rest for itself', () => {
    const plain = club('club_021', 'Haxbridge Dockers', '#0d47a1', '#ffd54f');
    const plan = badgePlan({ ...plain, badge: { shape: 'pennant', device: 'ship' } });

    expect(plan.shape).toBe('pennant');
    expect(plan.device).toBe('ship');
    // The pattern was left alone, so it is the one the club would have been
    // given anyway: a half-designed badge falls back for the rest, not for all.
    expect(plan.pattern).toBe(badgePlan(plain).pattern);
    // And everything he did not decide still comes off the club itself.
    expect(plan.name).toBe('Haxbridge Dockers');
    expect(plan.primary).toBe('#0d47a1');
  });

  it('stays plain where a designed pattern has no second colour to be drawn in', () => {
    const oneColour = club('club_004', 'Marsh End United', '#2e7d32', '#2e7d32');
    expect(badgePlan({ ...oneColour, badge: { pattern: 'hoops' } }).pattern).toBe('plain');
  });

  it('leaves the badge plain, and bandless, when both colours are the same', () => {
    const plan = badgePlan(club('club_003', 'Marsh End United', '#2e7d32', '#2e7d32'));
    expect(plan.pattern).toBe('plain');
    expect(plan.bandFill).toBe('none');
  });

  it('has a drawing for every shape it can pick', () => {
    for (const shape of BADGE_SHAPES) {
      expect(BADGE_SHAPE_PATHS[shape].length).toBeGreaterThan(10);
    }
  });
});

/**
 * A round badge is a ring of lettering with a disc in the middle, and the two
 * have to agree about where that middle is: the keyline is the boundary a
 * manager's eye reads, so it goes inside the lettering and the symbol gives way
 * to it rather than the other way round.
 */
describe('the ring of a round badge', () => {
  const names = [
    'The Bell',
    'Haxbridge Dockers',
    'Nether Bramford Corinthians',
    'The Old Waggon and Horses FC',
    // A name with descenders in it, which is what the ring has to clear on the
    // top arc rather than the full height of a capital.
    'Woolcroft Playing Fields FC',
  ];

  it('closes inside the lettering and around the symbol', () => {
    for (const name of names) {
      for (const shape of ['roundel', 'oval', 'ovalWide'] as const) {
        const plan = badgePlan({ ...club('club_012', name, '#1565c0', '#ffffff'), badge: { shape } });
        const where = `${name} as a ${shape}`;
        expect(plan.ringRadius, where).toBeGreaterThan(0);
        // Inside the lettering rather than through it, and what "inside" costs
        // depends on which way up the line is set: a name round the top reaches
        // in with a descender and its halo, anything set on the bottom arc — a
        // year, or the second half of a long name — with the full height of its
        // capitals. The pixel sweep is what proves the ink, this is the number
        // the ring was measured from.
        const inward = Math.max(
          plan.nameSize * 0.45,
          plan.nameLayout === 'ring' ? plan.nameSize * 0.9 : 0,
          plan.yearOnArc ? plan.yearSize * 0.9 : 0,
        );
        expect(plan.ringRadius + inward, where).toBeLessThanOrEqual(plan.arcRadius + 0.01);
        // Around the symbol, corner and all.
        const half = plan.deviceSize / 2;
        const corner = Math.hypot(half, Math.abs(plan.deviceY - 32) + half);
        expect(corner, where).toBeLessThanOrEqual(plan.ringRadius);
        // And the symbol the ring is drawn around is never a smudge: the middle
        // of a round badge is the largest field it has to draw a symbol in, and
        // it is the one place the name used to be allowed to swallow it.
        expect(plan.deviceSize, where).toBeGreaterThanOrEqual(15.99);
      }
    }
  });

  it('leaves a chief open, because the band is carrying the name', () => {
    for (const shape of ['shield', 'arch', 'pennant'] as const) {
      const plan = badgePlan({ ...club('club_012', 'Haxbridge Dockers', '#1565c0', '#ffffff'), badge: { shape } });
      expect(plan.ringRadius, shape).toBe(0);
      expect(plan.ringPlain, shape).toBe(false);
    }
  });

  it('paints the middle plain exactly where the field is patterned there', () => {
    const plain = club('club_012', 'Haxbridge Dockers', '#1565c0', '#ffeb3b');
    for (const pattern of BADGE_PATTERNS) {
      const plan = badgePlan({ ...plain, badge: { shape: 'roundel', pattern } });
      expect(plan.ringPlain, pattern).toBe(patternIsBusy(pattern));
    }
  });
});

/**
 * The plate a symbol stands on. The ink a symbol is drawn in was picked to read
 * against the club's first colour, and the middle of a patterned field is the
 * one place a band of the second colour is guaranteed to be under it.
 */
describe('the plate under a symbol', () => {
  const plain = club('club_014', 'Haxbridge Dockers', '#1565c0', '#ffeb3b');

  it('is there on a patterned field and not on a plain one', () => {
    for (const pattern of BADGE_PATTERNS) {
      const plan = badgePlan({ ...plain, badge: { shape: 'shield', pattern } });
      if (patternIsBusy(pattern)) {
        expect(plan.devicePanel, pattern).not.toBeNull();
        // The plate is the symbol's own box: never smaller, and never eating
        // into the band above it or the year line below.
        const panel = plan.devicePanel!;
        expect(panel.size, pattern).toBeGreaterThanOrEqual(plan.deviceSize);
        expect(plan.deviceY - panel.size / 2, pattern).toBeGreaterThanOrEqual(plan.bandBottom);
        expect(plan.deviceY + panel.size / 2, pattern).toBeLessThanOrEqual(60);
      } else {
        expect(plan.devicePanel, pattern).toBeNull();
      }
    }
  });

  it('is drawn, and drawn to the field colour, wherever it is planned', () => {
    const plan = badgePlan({ ...plain, badge: { shape: 'shield', pattern: 'hoops' } });
    const markup = renderToStaticMarkup(createElement(ClubBadge, { club: { ...plain, badge: { shape: 'shield', pattern: 'hoops' } } }));
    expect(plan.devicePanel).not.toBeNull();
    expect(markup).toContain(`width="${plan.devicePanel!.size}"`);
    expect(markup).toContain(`fill="${plan.primary}"`);
  });
});

/**
 * Every field a club can be given, and every shape it can be given, is a case
 * in the drawing code — and a case nobody wrote is a crest with a hole in it.
 */
describe('drawing a field', () => {
  const plain = club('club_015', 'Haxbridge Dockers', '#1565c0', '#ffeb3b');
  const bare = renderToStaticMarkup(
    createElement(ClubBadge, { club: { ...plain, badge: { shape: 'shield', pattern: 'plain' } } }),
  );

  it('draws every pattern in the library', () => {
    for (const pattern of BADGE_PATTERNS) {
      if (pattern === 'plain') continue;
      const markup = renderToStaticMarkup(
        createElement(ClubBadge, { club: { ...plain, badge: { shape: 'shield', pattern } } }),
      );
      expect(markup, pattern).not.toBe(bare);
      expect(markup.length, pattern).toBeGreaterThan(bare.length);
    }
  });

  it('draws a border that follows the silhouette, not the square it sits in', () => {
    const markup = renderToStaticMarkup(
      createElement(ClubBadge, { club: { ...plain, badge: { shape: 'arch', pattern: 'bordure' } } }),
    );
    // The band is the whole field, with the shape laid over it a little
    // smaller: the only way a band is the same width round every curve.
    expect(markup).toContain(BADGE_SHAPE_PATHS.arch);
    expect(markup).toContain('scale(0.78)');
  });
});

describe('drawing a badge', () => {
  it('renders every symbol in the library', () => {
    for (const device of BADGE_DEVICES) {
      const draw = BADGE_DEVICE_SHAPES[device];
      expect(draw, device).toBeTypeOf('function');
      const markup = renderToStaticMarkup(
        createElement('svg', null, draw({ ink: '#101a14', field: '#ffd54f', accent: '#37474f' })),
      );
      // A symbol that draws nothing is a badge with a blank middle.
      expect(markup.length, device).toBeGreaterThan(30);
    }
  });

  it('renders a badge carrying the club’s name and its symbol', () => {
    const entry = club('club_007', 'The Old White Hart FC', '#ef6c00', '#212121');
    const markup = renderToStaticMarkup(createElement(ClubBadge, { club: entry }));
    const plan = badgePlan(entry);
    expect(markup).toContain('class="badge"');
    // Every line of the name is drawn as text on the badge, in the club's own
    // lettering — which uppercases a crest that is cut in capitals.
    for (const line of plan.nameLines) {
      expect(markup).toContain(`>${plan.lettering.caps ? line.toUpperCase() : line}</text>`);
    }
    // No shorthand standing in for the name.
    expect(markup).not.toContain('>TOW<');
    expect(markup).toMatch(/stroke-width="2\.4"/);
  });

  it('renders every club in a division without repeating an id', () => {
    const clubs = crowd([
      'The Old White Hart FC',
      'The Old Ship FC',
      'The Railway Tavern',
      'Fenmoor Athletic',
      'Haxbridge United',
    ]);
    const markup = renderToStaticMarkup(
      createElement('div', null, ...clubs.map((entry) => createElement(ClubBadge, { club: entry, key: entry.id }))),
    );
    // The clip path is what keeps one club's pattern from landing on another's.
    const ids = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBe(clubs.length);
    expect(new Set(ids).size).toBe(clubs.length);
    // And a name on an arc gets paths of its own, also uniquely identified.
    const textPaths = [...markup.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(textPaths).size).toBe(textPaths.length);
  });
});

/**
 * The lettering a badge is cut in.
 *
 * A club's name is the one thing every badge in the county carries, and for a
 * long time every one of them carried it in the same face — the interface font
 * at weight 800 — so a league of crests read as one crest with different colours
 * in it. Each club is now cut in a treatment of its own. Two things have to hold
 * for that to be a crest and not a poster: no two clubs need wear the same face,
 * and the fitting must still account for the capitals and the spacing a
 * treatment adds, which the plain fitting knows nothing about.
 */
describe('the lettering on a badge', () => {
  function treatmentOf(lettering: BadgeLettering): string {
    return `${lettering.family}|${lettering.weight}|${lettering.caps}|${lettering.tracking}`;
  }

  function county() {
    return Array.from({ length: 40 }, (_, index) =>
      club(`club_${String(index).padStart(3, '0')}`, 'Draywick Social Club FC', '#ef6c00', '#212121'),
    );
  }

  it('does not set a whole county in one face', () => {
    const plans = county().map(badgePlan);
    // Forty sides with near-identical ids: exactly the draw that used to come
    // back with one face for every crest in the league.
    expect(new Set(plans.map((plan) => plan.lettering.family)).size).toBeGreaterThan(2);
    expect(new Set(plans.map((plan) => treatmentOf(plan.lettering))).size).toBeGreaterThan(2);
  });

  it('reaches every treatment there is', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 400; index += 1) {
      seen.add(treatmentOf(badgePlan(club(`club_${String(index).padStart(3, '0')}`, 'Fenmoor Athletic', '#1565c0', '#ffffff')).lettering));
    }
    expect(seen.size).toBe(BADGE_LETTERING.length);
  });

  it('is the same treatment for the same club, every time', () => {
    const entry = club('club_007', 'Draywick Social Club FC', '#ef6c00', '#212121');
    expect(badgePlan(entry).lettering).toEqual(badgePlan(entry).lettering);
  });

  it('keeps a name fitted in that treatment inside the room it was fitted to', () => {
    for (const lettering of BADGE_LETTERING) {
      for (const [longest, width, cap] of [
        [12, 46, 8.6],
        [16, 50, 7.4],
        [24, 42, 6.4],
        [6, 34, 8.6],
      ] as Array<[number, number, number]>) {
        const size = fitLettering(longest, width, cap, lettering);
        expect(size).toBeLessThanOrEqual(cap);
        // The floor is a floor: a name too long for its band is set at the
        // smallest legible size and overruns it, which is the badge giving
        // ground rather than the fitting being wrong.
        if (size > 4.2) expect(letteringWidth(longest, size, lettering)).toBeLessThanOrEqual(width + 0.001);
      }
    }
  });

  it('sets a name in capitals and spacing smaller than the same name plain', () => {
    const plain: BadgeLettering = { family: 'x', weight: 800, tracking: 0, caps: false };
    const others = BADGE_LETTERING.filter((entry) => entry.caps || entry.tracking > 0);
    expect(others.length).toBeGreaterThan(0);
    for (const lettering of others) {
      expect(fitLettering(14, 46, 8.6, lettering)).toBeLessThanOrEqual(fitLettering(14, 46, 8.6, plain));
    }
  });

  it('draws the name the way the club’s own treatment does', () => {
    for (const [index, entry] of county().entries()) {
      const plan = badgePlan(entry);
      const markup = renderToStaticMarkup(createElement(ClubBadge, { club: entry }));
      const line = plan.nameLines[0]!;
      expect(markup, `club ${String(index)}`).toContain(plan.lettering.caps ? line.toUpperCase() : line);
      // The name and the year are set in the club's face rather than the
      // interface's, which is the whole of what this adds.
      expect(markup).toContain('font-family');
      expect(markup).toContain('font-weight');
    }
  });
});
