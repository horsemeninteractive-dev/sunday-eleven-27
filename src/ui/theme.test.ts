import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { systemBarStyleFor } from '@/platform/systemBars';
import { COLOUR_PAIRS } from '@/simulation/generation/names';
import { DEFAULT_PREFERENCES, THEME_COLOUR } from '@/state/preferences';
import { CLUB_TEXT_SURFACE, TEXT_CONTRAST_FLOOR, clubStyle, contrastRatio } from './colour';

/**
 * The lights.
 *
 * The game was drawn in one palette, and the second one is not a repaint: it is
 * the same building with the lights on. These tests are what "the same" means —
 * that the two palettes are the same *set* of tokens, that the light one clears
 * the same floors of legibility, that it keeps the ramp the whole sheet is
 * written against, and that the one wash which reverses is the only thing that
 * does: nothing that is a picture, a pitch or a kit changed.
 *
 * They are read off the stylesheet rather than from a copy of the palette, so a
 * colour edited into the sheet and not into a test — or the other way about —
 * shows up here.
 */

const sheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
/** Comments stripped, so an assertion can never be satisfied by prose. */
const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/** The declarations of the one rule with this exact selector. */
function declarations(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

const DARK = declarations(':root');
const LIGHT = declarations(":root[data-theme='light']");

/** A token's value in one of the two palettes. */
function token(block: string, name: string): string {
  const found = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(found, `no ${name} in the palette`).toBeTruthy();
  return found![1]!.trim();
}

/**
 * Every token the light theme has to answer for.
 *
 * The surfaces and their rules, the five inks, the status tones, the two washes
 * that are not colours on their own, and the club's text ink — which is the one
 * value in this block that is *the same token* with a different answer, because
 * `clubStyle` mixes it against whichever surface it will be read on.
 */
const PALETTE = [
  '--bg', '--bg-2', '--panel', '--panel-2', '--panel-3', '--line', '--line-soft',
  '--text', '--text-dim', '--text-faint', '--text-bright',
  '--accent', '--accent-dim', '--warn', '--bad', '--ok', '--info',
  '--goal-ink', '--whistle-ink', '--focus',
  '--lift', '--raise', '--line-hover',
  '--shadow-float', '--scroll-thumb', '--scroll-thumb-hover', '--club-text',
];

/** The three surfaces anything can be written on, worst first. */
const SURFACES = ['--bg', '--panel', '--panel-3'] as const;

/**
 * The inks that are read as words.
 *
 * `--accent-dim` is deliberately not here: it is a segment in a bar and a tint
 * on an edge, never a sentence, and it is chosen to be *seen* beside `--accent`
 * rather than to be read.
 */
const INKS = [
  '--text', '--text-dim', '--text-faint', '--accent', '--warn',
  '--bad', '--ok', '--info', '--goal-ink', '--whistle-ink',
];

describe('the second palette', () => {
  it('is the same palette defined twice, and squares for every token', () => {
    for (const name of PALETTE) expect(token(LIGHT, name), `${name} unanswered`).toBeTruthy();

    // And it invents nothing: a token that existed only with the lights on has
    // no dark value to fall back to if the attribute is ever missing, which is
    // exactly the case the un-attributed `:root` has to cover.
    const names = (block: string) => [...block.matchAll(/(--[a-z0-9-]+):/g)].map((match) => match[1]!);
    const dark = new Set(names(DARK));
    const invented = names(LIGHT).filter((name) => !dark.has(name));
    expect(invented).toEqual([]);
  });

  it('tells the browser which way the lights are on, both ways', () => {
    expect(DARK).toContain('color-scheme: dark');
    expect(LIGHT).toContain('color-scheme: light');
    // And it is the attribute `applyTheme` writes, spelled the same, so the two
    // halves of one decision cannot disagree about its name.
    expect(css).toContain(":root[data-theme='light'] {");
  });

  it('keeps every ink above the floor, on every surface it is written on', () => {
    for (const [name, block] of [['dark', DARK], ['light', LIGHT]] as const) {
      for (const ink of INKS) {
        for (const surface of SURFACES) {
          const ratio = contrastRatio(token(block, ink), token(block, surface));
          expect(
            ratio,
            `${name}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
        }
      }
    }
  });

  it('keeps the ramp the whole sheet is written against', () => {
    // Light comes from above and a raised surface is lit by the same run from a
    // lighter tone to its own — so the five tones are in the same order in both
    // palettes, and a step between two of them can still be seen. Contrast
    // against black rises with luminance, which is how the order is read here.
    const luminance = (hex: string) => contrastRatio(hex, '#000000');
    for (const [name, block] of [['dark', DARK], ['light', LIGHT]] as const) {
      const ramp = ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3'].map((surface) =>
        luminance(token(block, surface)),
      );
      for (let step = 1; step < ramp.length; step += 1) {
        expect(ramp[step]!, `${name}: ${step} of the ramp is not above the one before it`).toBeGreaterThan(
          ramp[step - 1]!,
        );
      }
      // A palette whose surfaces are all the same colour is not lit at all.
      expect(luminance(token(block, '--panel')) / luminance(token(block, '--bg'))).toBeGreaterThan(1.05);
      expect(contrastRatio(token(block, '--line'), token(block, '--panel'))).toBeGreaterThan(1.2);
    }
  });

  it('reverses the one wash that lifts a surface, at the same alphas', () => {
    expect(token(DARK, '--lift')).toBe('255, 255, 255');
    expect(token(LIGHT, '--lift')).toBe('0, 0, 0');
    // The two hover tones move the way the lift does: away from the panel.
    const luminance = (hex: string) => contrastRatio(hex, '#000000');
    expect(luminance(token(LIGHT, '--raise'))).toBeLessThan(luminance(token(LIGHT, '--panel')));
    expect(luminance(token(DARK, '--raise'))).toBeGreaterThan(luminance(token(DARK, '--panel')));
  });

  it('takes every white lift in the dark sheet through that token', () => {
    // A lift in this game is white because a surface is raised out of the dark.
    // What is left white in the sheet above the light block is what is drawn *on*
    // something rather than painted as a surface: the grass and its chalk, the
    // men and the ball, the scorecard that sits over the picture, and the
    // scrollbar thumb, which the light block answers for itself. The light block
    // is exempt by construction: stating a white is its whole job.
    const drawing = ['.pitch', '.posmap', '.tvboard', '.pitchfull'];
    const dark = css.slice(0, css.indexOf(':root[data-theme=\'light\']'));
    const offenders: string[] = [];
    for (const chunk of dark.split('}')) {
      const open = chunk.lastIndexOf('{');
      if (open < 0) continue;
      const body = chunk.slice(open + 1);
      if (!/rgba\(255, 255, 255/.test(body)) continue;
      const selector = chunk.slice(0, open).split('{').pop()!.trim().split('\n').pop()!.trim();
      // The registrations that make the palette fade are not rules that paint
      // anything: a white in their `initial-value` is the dark palette's own
      // value for a token the light block answers for in its own turn.
      if (selector === ':root' || selector.startsWith('@property')) continue;
      if (drawing.some((scope) => selector.includes(scope))) continue;
      offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });

  it('repaints surfaces, and never a drawing', () => {
    // The other half of the same idea. What is *drawn* rather than built — the
    // grass and its chalk, the picture of a pitch on the substitution board, the
    // two shirts, a crest, a face — is lit by the sheet's own rules, and the
    // light block has no rule that paints one of them.
    //
    // It may still *name* one, and one of them it has to: the energy chip on the
    // board's own shirts is a chip over grass, so the block pins the three tones
    // it is written in there and paints nothing at all. A rule that declares no
    // property — only tokens — is not a repaint, which is the distinction this
    // assertion makes.
    const block = css.slice(css.indexOf(":root[data-theme='light']"));
    const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      selector: match[1]!.trim().split('\n').pop()!.trim(),
      tokens: match[2]!.split(';').filter((declaration) => declaration.trim().startsWith('--')).length,
      paints: match[2]!
        .split(';')
        .filter((declaration) => declaration.trim() && !declaration.trim().startsWith('--')).length,
    }));
    expect(rules.length).toBeGreaterThan(10);
    const drawings = ['pitch', 'grass', 'chalk', 'shirt', 'crest', 'portrait', 'ball', 'posmap', 'tvboard'];
    const repainted = rules
      .filter((rule) => rule.paints > 0)
      .filter((rule) => drawings.some((word) => rule.selector.includes(word)))
      .map((rule) => rule.selector);
    expect(repainted).toEqual([]);
    // And the pin it does make is a pin, not a repaint.
    const grassy = rules.filter((rule) => rule.selector.includes('pitch'));
    expect(grassy.length).toBeGreaterThan(0);
    expect(grassy.every((rule) => rule.paints === 0 && rule.tokens > 0)).toBe(true);
    // Neither does it answer for a token that belongs to the pitch itself: the
    // grass tones and the mow ink are declared where the grass is painted, per
    // surface and per wear, and a light-theme value for any of them would be a
    // pitch pretending to be a surface.
    expect(block).not.toMatch(/--(grass|mow)/);
  });

  it('answers for the two surfaces that ask the manager for something', () => {
    // The card that offers to put the game on a home screen and the bar that says
    // a new build is waiting are the only two pieces of the game that interrupt
    // him, and both of them were painted for the dark sheet — one as a glass of
    // its own over the menu's photograph, the other with a shadow of its own
    // nearly three times the weight the light palette gives a floating surface.
    // So both of them read, with the lights on, as a piece of the dark game
    // sitting on a light page: the card a near-black box on a screen whose other
    // glass had gone pale, the bar a black smudge round a panel that was itself
    // perfectly legible. Neither is a drawing, so neither is exempt.
    const block = css.slice(css.indexOf(":root[data-theme='light']"));

    /**
     * The declarations of the light block's rule for this selector.
     *
     * Read from the selector rather than from a `selector {`, because two of the
     * rules this reads share one declaration with the surface beside them — the
     * card is the same glass as the saved careers, the bar the same shadow as the
     * half-time card — and a comma group is how the sheet states that.
     */
    function lightRule(selector: string): string {
      const at = block.indexOf(`:root[data-theme='light'] ${selector}`);
      expect(at, `${selector} is unanswered in the light block`).toBeGreaterThan(-1);
      const open = block.indexOf('{', at);
      return block.slice(open + 1, block.indexOf('}', open));
    }

    /** What a rule paints its background with, if it paints one. */
    function painted(rule: string): string {
      const found = /background: ([^;]+);/.exec(rule);
      expect(found, `nothing painted in ${rule.split('\n')[0]}`).toBeTruthy();
      return found![1]!.trim();
    }

    // The card is the menu's glass, and it is the *same* glass as the saved
    // careers beside it rather than a third shade nobody chose.
    expect(painted(lightRule('.installcard'))).toBe(painted(lightRule('.start__saves')));

    // The bar's background was never the problem: it is the page's own panel,
    // painted from the token rather than from a colour of its own, so it had
    // travelled with every other surface. What had not was its shadow — a shadow
    // on a light page is read as depth rather than as darkness — which is the one
    // thing the light block has to say about it.
    const bar = css.slice(css.indexOf('.updatebar {'));
    expect(bar.slice(0, bar.indexOf('}'))).toContain('background: var(--panel)');
    const shadow = /box-shadow: ([^;]+);/.exec(lightRule('.updatebar'))?.[1] ?? '';
    const alpha = Number(/rgba\(0, 0, 0, ([\d.]+)\)/.exec(shadow)?.[1]);
    expect(alpha, `the bar's light shadow is ${shadow}`).toBeGreaterThan(0);
    expect(alpha).toBeLessThanOrEqual(0.3);
  });
});

describe('a club with the lights on', () => {
  it('mixes the club\u2019s text ink against the surface it will be read on', () => {
    // The surface is the worst one each palette has rather than a typical one:
    // a colour lightened for the dark theme fails on the light one and the other
    // way about, which is why `clubStyle` is handed the theme at all.
    for (const colours of COLOUR_PAIRS) {
      for (const theme of ['dark', 'light'] as const) {
        const text = clubStyle(colours, theme)['--club-text']!;
        const ratio = contrastRatio(text, CLUB_TEXT_SURFACE[theme]);
        expect(
          ratio,
          `${colours.primary} as text in the ${theme} theme is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
      }
    }
  });

  it('names the surfaces the stylesheet actually paints', () => {
    // Two places write these down — the sheet, because that is what a panel is
    // painted from, and `colour.ts`, because contrast has to be computed against
    // a colour rather than a token. This is what keeps them the same colour.
    expect(CLUB_TEXT_SURFACE.dark).toBe(token(DARK, '--panel-3'));
    expect(CLUB_TEXT_SURFACE.light).toBe(token(LIGHT, '--bg'));
  });

  it('gives the same club a different ink in each theme, and not the same one', () => {
    // A club in white and red is the case that proves it: on a near-black panel
    // its colour has to be lightened, and on a light one darkened.
    const light = clubStyle({ primary: '#ffffff', secondary: '#c62828' }, 'light')['--club-text'];
    const dark = clubStyle({ primary: '#ffffff', secondary: '#c62828' }, 'dark')['--club-text'];
    expect(light).not.toBe(dark);
    expect(contrastRatio(light!, '#ffffff')).toBeLessThan(contrastRatio(dark!, '#000000'));
  });
});

describe('changing the lights', () => {
  /**
   * The tokens a theme change has to *travel* between rather than snap at.
   *
   * Every colour in the palette, which is all of it but the shadow (a shadow is
   * not a colour, and one that snapped under a fade nobody can see is not worth
   * a registration) and the club's text ink (mixed in JavaScript against the
   * surface it will be read on, so it is not declared on this element at all).
   */
  const TRAVELS = PALETTE.filter((name) => name !== '--shadow-float' && name !== '--club-text');

  it('makes every colour in the palette a value the browser can interpolate', () => {
    // A custom property is a string until `@property` gives it a type, and only
    // a typed colour moves. So the registrations are the mechanism, and this is
    // the list of them: a token added to the palette and left out here would be
    // the one thing on the screen that jumped.
    const registered = [...sheet.matchAll(/@property (--[a-z0-9-]+) \{ syntax: '([^']+)'/g)].map(
      (match) => [match[1]!, match[2]!] as const,
    );
    const typed = registered.filter(([, syntax]) => syntax === '<color>').map(([name]) => name);
    expect(typed.slice().sort()).toEqual(
      TRAVELS.filter((name) => name !== '--lift').slice().sort(),
    );
    // The one that is not a colour is the wash that reverses: three channels, so
    // it is registered as the list of numbers it is rather than as a colour.
    expect(registered).toContainEqual(['--lift', '<number>#']);
  });

  it('transitions them on the one element they are set on', () => {
    const transition = /:root \{\s*transition-property:([\s\S]*?);/.exec(css);
    expect(transition, 'nothing transitions').toBeTruthy();
    const properties = transition![1]!.split(/[,\n]/).map((name) => name.trim()).filter(Boolean);
    expect(properties.slice().sort()).toEqual(TRAVELS.slice().sort());
    // A duration, and one short enough to be a fade rather than a transition the
    // manager watches: the lights coming up, not an effect.
    const duration = /transition-duration: (\d+)ms/.exec(css);
    expect(Number(duration?.[1] ?? 0)).toBeGreaterThan(80);
    expect(Number(duration?.[1] ?? 0)).toBeLessThanOrEqual(400);
  });

  it('is held still for a manager who asked for that', () => {
    // The same two rules the rest of the sheet cancels motion with, for the same
    // reason: this is the first thing in the game to move on its own account,
    // and it has no business moving when it has been told not to.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition-duration: 0s/);
    expect(css).toMatch(/html\[data-motion='reduced'\] \{\s*transition-duration: 0s;\s*\}/);
  });
});

describe('the first paint', () => {
  it('opens dark before anything has been chosen', () => {
    expect(DEFAULT_PREFERENCES.theme).toBe('dark');
    expect(THEME_COLOUR.dark.toLowerCase()).toBe(token(DARK, '--bg').toLowerCase());
  });

  it('paints the placeholder in the colours the stylesheet will use', () => {
    // The placeholder is in the document before the bundle is, so its two
    // palettes are written out in literals in `index.html` — and a literal that
    // drifts from the sheet is a flash of one palette inside the other.
    expect(THEME_COLOUR.light.toLowerCase()).toBe(token(LIGHT, '--bg').toLowerCase());
    expect(page).toContain(`background: ${THEME_COLOUR.light};`);
    expect(page).not.toContain(`background: ${THEME_COLOUR.light};\n      }`);
  });

  it('settles the theme before the first paint, from the same preference', () => {
    // The answer is read out of the browser and written on the document element
    // in the page itself, which is the only thing that can run early enough;
    // `main.tsx` writes the same attribute again once the bundle lands.
    expect(page).toContain("localStorage.getItem('slfm26.preferences')");
    expect(page).toContain("setAttribute('data-theme', theme)");
    expect(page).toContain("matchMedia('(prefers-color-scheme: light)')");
    // And it resolves `system` rather than passing it on: the stylesheet has two
    // palettes and no third answer for "whatever the machine says".
    expect(page).not.toContain("setAttribute('data-theme', chosen)");
  });

  it('opens the phone bars on the side the game itself opens on', () => {
    // The shell's own answer — `plugins.SystemBars.style` — is the one frame the
    // page cannot correct in time: it is what the status bar and the gesture bar
    // wear before the bundle has landed. The game opens dark, so it has to be the
    // dark theme's answer; the page takes it from there (`applyTheme`), and a
    // preference changed later is a change the bars are told about. Written down
    // twice, therefore checked here.
    const config = readFileSync(new URL('../../capacitor.config.ts', import.meta.url), 'utf8');
    // The default preference is a real answer already, never `system` — which is
    // what makes it the one the static value can be written from.
    const opening: 'dark' | 'light' = DEFAULT_PREFERENCES.theme === 'light' ? 'light' : 'dark';
    expect(config).toContain(`style: '${systemBarStyleFor(opening)}'`);
  });
});
