import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Club } from '@/domain/club';
import { BADGE_DEVICES, BADGE_SHAPE_PATHS, BADGE_SHAPES, badgePlan, deviceFor } from './badge';
import { BADGE_DEVICE_SHAPES } from './badgeDevices';
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
    expect(devices.size).toBeGreaterThan(5);
    for (const device of devices) expect(BADGE_DEVICES).toContain(device);
  });

  it('spreads clubs across shapes and patterns', () => {
    const clubs = crowd(Array.from({ length: 40 }, (_, index) => `Woolcroft Social Club ${index}`));
    const plans = clubs.map((entry) => badgePlan(entry));
    expect(new Set(plans.map((plan) => plan.shape)).size).toBe(BADGE_SHAPES.length);
    expect(new Set(plans.map((plan) => plan.pattern)).size).toBeGreaterThan(4);
    expect(new Set(plans.map((plan) => plan.device)).size).toBeGreaterThan(15);
  });

  it('keeps a library of symbols big enough that a county is not one crest', () => {
    // A badge is the first thing a manager sees of another club, so a world
    // where a third of the sides wear the same one reads smaller than it is.
    expect(new Set(BADGE_DEVICES).size).toBe(BADGE_DEVICES.length);
    expect(BADGE_DEVICES.length).toBeGreaterThanOrEqual(45);
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
    // Every line of the name is drawn as text on the badge.
    for (const line of plan.nameLines) expect(markup).toContain(`>${line}</text>`);
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
