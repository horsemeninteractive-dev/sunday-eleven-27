import { describe, expect, it } from 'vitest';
import type { MatchRenderState } from '@/presentation/renderContract';
import type { PositionCode } from '@/domain/positions';
import { shirtOf } from './MatchPitch';
import { isKeeper, shirtFor } from './shirt';

/**
 * The shirt a man on the pitch is drawn in.
 *
 * A keeper is the one player out of the twenty-two who is not in his side's
 * outfield strip. The laws have always asked the two keepers to be told from the
 * ten in front of them and from each other, and a Sunday side answers it the only
 * way it can: the loudest shirt on the rack, worn by nobody else. So the picture
 * paints him from `colours.keeper` and the other ten from `colours.primary`,
 * which is the shirt the two sides actually turned out in.
 *
 * The rest of the renderer is measured in a browser — where the dots sit, how
 * they interpolate, which way the pitch is turned — but this decision is a rule
 * rather than a drawing, so it is pinned here.
 */

describe('the shirt a man is drawn in', () => {
  const pitch = (
    home: { primary: string; keeper: string },
    away: { primary: string; keeper: string },
  ) => ({ teams: { home: { colours: home }, away: { colours: away } } }) as unknown as MatchRenderState;

  it('gives both keepers the third strip and every other job the outfield shirt', () => {
    const state = pitch(
      { primary: '#c62828', keeper: '#fdd835' },
      { primary: '#ffffff', keeper: '#00897b' },
    );
    expect(shirtOf(state, { side: 'home', position: 'GK' })).toBe('#fdd835');
    expect(shirtOf(state, { side: 'away', position: 'GK' })).toBe('#00897b');

    // A keeper is a position and not a side, so it is the position that decides:
    // every other job wears the strip its own side turned out in, at both ends,
    // whatever the keeper at that end happens to be wearing.
    const outfield: PositionCode[] = ['RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST'];
    for (const position of outfield) {
      expect(shirtOf(state, { side: 'home', position })).toBe('#c62828');
      expect(shirtOf(state, { side: 'away', position })).toBe('#ffffff');
    }
  });

  it('draws the keeper from the keeper colour even when it matches the outfield one', () => {
    // The picture does not own the rule that keeps the two apart — the kit
    // generator does, by measuring the third strip off the club's own colour.
    // The renderer draws whichever shirt the career holds, so a save from before
    // those colours were drawn still paints the men it has rather than deciding
    // for itself that a shirt is wrong.
    const state = pitch(
      { primary: '#00897b', keeper: '#00897b' },
      { primary: '#111111', keeper: '#222222' },
    );
    expect(shirtOf(state, { side: 'home', position: 'GK' })).toBe('#00897b');
    expect(shirtOf(state, { side: 'home', position: 'CB' })).toBe('#00897b');
  });
});

/**
 * The same rule, asked of the colours on their own.
 *
 * The pitch asks it about a dot and the two team sheets ask it about a row, so it
 * is written down once — in `shirt.ts` — and the three of them cannot come to
 * disagree about which of the eleven is the man in goal. The sheets' own drawing
 * is pinned in `teamsheet.test.ts`; this is the rule they both stand on.
 */
describe('the shirt a man is in, from the colours of his side', () => {
  const colours = { primary: '#c62828', secondary: '#ffffff', keeper: '#fdd835' };
  const outfield: PositionCode[] = ['RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST'];

  it('gives every job but one the side’s strip, and the keeper the third strip', () => {
    for (const position of outfield) {
      expect(shirtFor(colours, position)).toBe('#c62828');
      expect(isKeeper(position)).toBe(false);
    }
    expect(shirtFor(colours, 'GK')).toBe('#fdd835');
    expect(isKeeper('GK')).toBe(true);
  });

  it('does not decide for itself that a keeper’s shirt is wrong', () => {
    // The kit generator is what keeps the two apart, by measuring the third strip
    // off the club's own colour. A save from before those colours were drawn still
    // draws the man it has, in the shirt it has, rather than overruling him.
    const same = { ...colours, primary: '#00897b', keeper: '#00897b' };
    expect(shirtFor(same, 'GK')).toBe('#00897b');
    expect(shirtFor(same, 'CB')).toBe('#00897b');
  });
});
