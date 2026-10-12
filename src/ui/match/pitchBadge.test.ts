import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { MatchConditions, PitchCondition } from '@/domain/match';
import { PITCH_LABEL } from '@/domain/match';
import { conditionEffects } from '@/simulation/match/tacticsModel';
import { PitchBadge, pitchSummary, pitchVerdict } from './PitchBadge';

/**
 * The badge is checked where it can be checked without a browser: the drawing
 * (one per surface, and six surfaces are six drawings), the sentence under it
 * against the engine's own numbers, and the line weight in the sheet.
 */

const sheet = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const source = readFileSync('src/ui/match/PitchBadge.tsx', 'utf8');

/** A pitch of that condition at the quality one usually is. */
const QUALITY: Record<PitchCondition, number> = {
  excellent: 18,
  good: 14,
  worn: 10,
  muddy: 8,
  waterlogged: 6,
  frozen: 6,
};

function conditions(pitch: PitchCondition, patch: Partial<MatchConditions> = {}): MatchConditions {
  return { weather: 'overcast', pitch, pitchQuality: QUALITY[pitch], temperatureC: 12, ...patch };
}

const PITCHES = Object.keys(PITCH_LABEL) as PitchCondition[];

function drawingOf(pitch: PitchCondition): string {
  const html = renderToStaticMarkup(createElement(PitchBadge, { conditions: conditions(pitch) }));
  return html.slice(html.indexOf('<rect'), html.indexOf('</svg>'));
}

describe('the pitch badge', () => {
  it('draws a different picture for every surface a pitch can be in', () => {
    const drawings = PITCHES.map(drawingOf);
    for (const drawing of drawings) expect(drawing.length).toBeGreaterThan(60);
    // Six conditions, six drawings: a badge whose muddy pitch looked like its
    // dry one would have said nothing by drawing it.
    expect(new Set(drawings).size).toBe(PITCHES.length);
  });

  it('is a picture of the surface, and the words beside it carry the meaning', () => {
    const html = renderToStaticMarkup(createElement(PitchBadge, { conditions: conditions('muddy') }));
    // Decorative: the condition is printed in words in the fact row, so a screen
    // reader is given the words rather than the picture twice.
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-label');
  });

  it('says what the surface does to the football, in the engine’s own terms', () => {
    for (const pitch of PITCHES) {
      const match = conditions(pitch);
      const effects = conditionEffects(match);
      const { notes } = pitchVerdict(match);

      expect(notes.length, `${pitch} says nothing`).toBeGreaterThan(0);
      // Every line is a threshold on the function the engine itself uses, so the
      // badge cannot promise a dry afternoon while every pass is bobbling.
      expect(notes.includes('Short passing gets harder'), pitch).toBe(effects.passControlPenalty >= 0.12);
      expect(notes.includes('Legs will go sooner'), pitch).toBe(effects.fatigueRate >= 1.15);
      expect(notes.includes('Hard on the legs and the ankles'), pitch).toBe(effects.injuryRate >= 1.5);
      expect(notes.includes('More knocks than usual'), pitch).toBe(effects.injuryRate >= 1.18 && effects.injuryRate < 1.5);
      expect(notes.includes('Shooting is a lottery'), pitch).toBe(effects.shotQualityPenalty >= 0.02);
    }

    // A good pitch is not a warning: it says what it is good for and stops.
    expect(pitchVerdict(conditions('excellent'))).toEqual({ tone: 'ok', notes: ['A pitch to pass it on'] });
    expect(pitchVerdict(conditions('good'))).toEqual({ tone: 'ok', notes: ['A fair surface for a game'] });
    expect(pitchVerdict(conditions('worn')).tone).toBe('warn');
    // Who it will hurt first, then what the ball will do, then how long the
    // afternoon will last: the order a manager would say them in.
    expect(pitchVerdict(conditions('muddy')).notes).toEqual([
      'More knocks than usual',
      'The ball will bobble about a bit',
      'Legs will go sooner',
    ]);
    expect(pitchVerdict(conditions('frozen')).notes).toEqual([
      'Hard on the legs and the ankles',
      'The ball will bobble about a bit',
      'Shooting is a lottery',
    ]);

    // `bad` is kept for the two surfaces a league calls a game off for, and the
    // same two the postponement rules look at.
    expect(pitchVerdict(conditions('waterlogged')).tone).toBe('bad');
    expect(pitchVerdict(conditions('frozen')).tone).toBe('bad');
  });

  it('reads the weather as well as the pitch, because the engine does', () => {
    // A downpour on a good pitch is not a dry afternoon: the same surface under
    // heavy rain carries a heavier penalty, and the badge has to say so.
    const raining = conditions('good', { weather: 'heavy-rain' });
    const dry = pitchVerdict(conditions('good'));
    const wet = pitchVerdict(raining);
    expect(dry.notes).toEqual(['A fair surface for a game']);
    // The note is there because the engine turned the rain into a penalty, and
    // the assertion is written that way round so it cannot pass on a coincidence.
    expect(conditionEffects(raining).passControlPenalty).toBeGreaterThan(0);
    expect(wet.notes).toContain('The ball will bobble about a bit');
    expect(wet.tone).toBe('warn');
  });

  it('is drawn in the same 1.5px line as every other drawing in the game', () => {
    // 32 units shown at 48 wide is a scale of 1.5, so a stroke of 1 lands on the
    // screen as the 1.5px line the news plates and every other picture are made
    // of — one weight of ink for every drawing, at whatever size it is shown.
    expect(source).toContain('viewBox="0 0 32 20"');
    expect(sheet).toMatch(/\.pitch-badge \{[^}]*width: 48px/s);
    expect(sheet).toMatch(/\.pitch-badge \{[^}]*stroke-width: 1;/s);
    for (const tone of ['ok', 'warn', 'bad']) expect(sheet).toContain(`.pitch-badge--${tone}`);
  });

  it('prints the pitch and its consequence as one line', () => {
    expect(pitchSummary(conditions('frozen'))).toBe('Frozen pitch — hard on the legs and the ankles.');
    expect(pitchSummary(conditions('excellent'))).toBe('Excellent pitch — a pitch to pass it on.');
  });
});
