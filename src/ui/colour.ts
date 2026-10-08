/**
 * Club colours come from the generated world, so they can be anything. Anything
 * drawn *on top* of a club colour needs to know whether to use light or dark
 * ink rather than assuming.
 *
 * A club has two colours, and the second one is not decoration: it is what
 * makes the crest readable at a glance and what gives the header its stripes.
 */
export interface ClubColours {
  primary: string;
  secondary?: string;
}

export const LIGHT_INK = '#f4f8f6';
export const DARK_INK = '#101a14';

function channelsOf(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function hexOf(channels: [number, number, number]): string {
  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function inkForColour(hex: string): string {
  const [r, g, b] = channelsOf(hex);
  // Perceived brightness (ITU-R BT.601), decided on the 0-255 scale.
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 145 ? DARK_INK : LIGHT_INK;
}

/** A translucent version of a colour, for washes and fills. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channelsOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** One colour laid over another, as the eye will see it. */
export function mixColours(base: string, over: string, amount: number): string {
  const a = channelsOf(base);
  const b = channelsOf(over);
  const t = Math.max(0, Math.min(1, amount));
  return hexOf([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channelsOf(hex);
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * How different two colours look, 0 (identical) to about 441 (black vs white).
 *
 * Contrast ratios say whether text is readable; this says whether two shirts
 * are telling each other apart. Those are different questions: a red and a
 * green can be equally bright and still be two completely different kits, so
 * the channels are compared directly and the green-red axis is trusted most.
 */
export function colourDistance(a: string, b: string): number {
  const [r1, g1, b1] = channelsOf(a);
  const [r2, g2, b2] = channelsOf(b);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}

/**
 * Ink for text that sits on more than one colour — a header, a striped badge.
 * Both options are tried and the one that is never badly wrong wins.
 */
export function inkForColours(...colours: string[]): string {
  const present = colours.filter(Boolean);
  if (present.length === 0) return LIGHT_INK;
  let best = LIGHT_INK;
  let bestScore = -1;
  for (const ink of [LIGHT_INK, DARK_INK]) {
    const score = Math.min(...present.map((colour) => contrastRatio(ink, colour)));
    if (score > bestScore) {
      bestScore = score;
      best = ink;
    }
  }
  return best;
}

/**
 * The contrast every scrap of small text needs: the WCAG's own floor for body
 * text, and the number this sheet has always quoted by hand.
 */
export const TEXT_CONTRAST_FLOOR = 4.5;

/** Club-coloured text needs a different ink from paint on a crest or shirt. */
export function readableClubColour(primary: string): string {
  for (let step = 0; step <= 20; step += 1) {
    const ink = mixColours(primary, LIGHT_INK, step / 20);
    if (contrastRatio(ink, '#1f252c') >= TEXT_CONTRAST_FLOOR) return ink;
  }
  return LIGHT_INK;
}

/**
 * The ink a club's colour is *painted* in — a button, a chip, a badge, a dot.
 *
 * Paint is the one place the game cannot choose its surface: the club's colour
 * is a free variable and it goes on flat. The header's ink is not the answer
 * here, because it is chosen across the *stripes* the club's two colours make,
 * and a compromise that keeps a faded band readable can be wrong for the flat
 * colour underneath — a career blue took the ink its stripes had picked and
 * measured 3.84:1 on its own buttons, which axe catches on every screen. Flat
 * paint is one colour, so it gets one answer, and that answer is never below
 * the floor small text needs.
 *
 * The app's two inks are tried first, so a club keeps the house ink wherever it
 * works. A mid-toned colour that neither of them clears needs the far end of the
 * scale — white or black — and one of those always works: their ratios against
 * any colour multiply to 21, so the better of the two can never be below 4.58.
 * That is what makes this a guarantee rather than an improvement.
 */
export function flatClubInk(primary: string): string {
  for (const ink of [LIGHT_INK, DARK_INK]) {
    if (contrastRatio(ink, primary) >= TEXT_CONTRAST_FLOOR) return ink;
  }
  return contrastRatio('#ffffff', primary) >= contrastRatio('#000000', primary)
    ? '#ffffff'
    : '#000000';
}

/** The second colour, or the first when a club only has one. */
export function secondaryColour(colours: ClubColours): string {
  return colours.secondary && colours.secondary.trim() ? colours.secondary : colours.primary;
}

/* Diagonal stripes ---------------------------------------------------------
 *
 * The club wears its shirt on the header: diagonal bands of its second colour
 * over its first, strongest at the left edge and fainter the further right they
 * walk, until by the middle of the bar only the club's colour is left.
 *
 * Two pieces make that up, and both of them are needed because the stripes
 * move. The bands themselves are a *repeating* pattern of one size — a thing
 * that can slide for ever with nothing to show at the join — and the fade is a
 * separate mask laid over the top, carrying the run's own decay: each band
 * `STRIPE_FADE` of the strength of the one before it, gone by the end of the
 * span. A run that thinned as it went could not do that; it would have to start
 * again at full width somewhere, and the eye finds that in a moment.
 *
 * The stripes on the screens before a career starts are the same pattern and
 * the same motion, in the mark's green over a photograph instead of over a
 * club's colour.
 */

export const STRIPE_ANGLE = 112;
/** Bands and gaps together in one run; the run is half bands. */
export const STRIPE_COUNT = 14;
/** How much of the bar the stripes cover; the rest is the flat club colour. */
export const STRIPE_SPAN = 0.46;
/** Each band keeps this much of the strength of the band before it. */
export const STRIPE_FADE = 0.86;
/** The strongest a stripe band is ever allowed to be. */
export const STRIPE_ALPHA_MAX = 0.45;
/** Below this, the second colour has effectively vanished. */
export const STRIPE_ALPHA_MIN = 0.14;
/** Bold header text: the contrast every band has to keep. */
export const STRIPE_CONTRAST_FLOOR = 3.5;

function roundAlpha(alpha: number): number {
  return Math.round(alpha * 1000) / 1000;
}

/** How much of the strongest band each band keeps, counting bands only. */
export function stripeWeights(count = STRIPE_COUNT, fade = STRIPE_FADE): number[] {
  const bands = Math.ceil(count / 2);
  return Array.from({ length: bands }, (_, index) => Math.pow(fade, index));
}

/** How strong each band is drawn when the boldest one is drawn at `alpha`. */
function bandAlphas(alpha: number, weights = stripeWeights()): number[] {
  return weights.map((weight) => roundAlpha(alpha * weight));
}

/** The flat colour each band settles into when drawn at `alpha`. */
function bandSurfaces(
  primary: string,
  secondary: string,
  alpha: number,
  weights = stripeWeights(),
): string[] {
  return bandAlphas(alpha, weights).map((bandAlpha) =>
    mixColours(primary, secondary, bandAlpha),
  );
}

/**
 * How strong the stripes can be before they cost legibility.
 *
 * The second colour is laid over the first at a reduced alpha, and every band
 * that produces has to keep reading as text background: a dark second colour
 * over a mid orange turns the band brown, and brown takes the same white ink
 * the orange needed. So the stripes are drawn as strongly as the club's own
 * colours allow, and no more — from the maximum down until the worst band is
 * back inside the contrast floor.
 */
export function stripeAlpha(colours: ClubColours): number {
  const primary = colours.primary;
  const secondary = secondaryColour(colours);
  if (secondary.toLowerCase() === primary.toLowerCase()) return 0;
  const weights = stripeWeights();
  let fallback = STRIPE_ALPHA_MIN;
  let fallbackScore = -1;
  for (let alpha = STRIPE_ALPHA_MAX; alpha >= STRIPE_ALPHA_MIN; alpha -= 0.02) {
    // Every band is checked, not just the boldest one: the faded tail of the
    // gradient passes through colours neither end of it shows.
    const surfaces = [primary, ...bandSurfaces(primary, secondary, alpha, weights)];
    const score = Math.max(
      Math.min(...surfaces.map((surface) => contrastRatio(LIGHT_INK, surface))),
      Math.min(...surfaces.map((surface) => contrastRatio(DARK_INK, surface))),
    );
    if (score >= STRIPE_CONTRAST_FLOOR) return roundAlpha(alpha);
    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = alpha;
    }
  }
  return roundAlpha(fallback);
}

/**
 * The header's stripe, as a pattern that can slide.
 *
 * Bands of the club's second colour at the alpha its own colours can take,
 * laid out as the repeating field rather than as one run that gives up: the bar
 * wears the same stripe as the screens before a career starts, in the club's
 * colours instead of the mark's green. A club wearing two colours the same has
 * nothing to draw a band in, and is left flat.
 */
export function barStripes(colours: ClubColours): string {
  const alpha = stripeAlpha(colours);
  if (alpha <= 0) return 'none';
  return stripeTiles(secondaryColour(colours), { alpha });
}

/**
 * The fade that runs the header's stripe out to nothing.
 *
 * This is the run's own decay, moved from the gradient's stops into a mask: a
 * band is `STRIPE_FADE` of the strength of the one before it, and by the end of
 * the span the bar is the club's flat colour. It has to be a mask because the
 * stripes beneath it move — a decay written into their stops would travel with
 * them, and would have to start again bold somewhere on the bar.
 *
 * The stops are placed where the bands themselves fall, so the strength of the
 * stripe at any point along the bar is the strength it has always had.
 */
export function barFade(
  {
    angle = STRIPE_ANGLE,
    count = STRIPE_COUNT,
    span = STRIPE_SPAN,
    fade = STRIPE_FADE,
  }: { angle?: number; count?: number; span?: number; fade?: number } = {},
): string {
  const clear = 'rgba(255, 255, 255, 0)';
  const stops = Array.from(
    { length: count },
    (_, index) => `rgba(255, 255, 255, ${roundAlpha(Math.pow(fade, index))}) ${(((index / count) * span) * 100).toFixed(2)}%`,
  );
  stops.push(`${clear} ${(span * 100).toFixed(2)}%`, `${clear} 100%`);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/* The drifting stripe ------------------------------------------------------
 *
 * The header of every in-game screen and the ground of every screen before one
 * carry the same thing: diagonal bands on the same angle, at the same size,
 * drifting steadily right. A band is one `STRIPE_COUNT`th of a `STRIPE_SPAN`
 * run — the width a band would have if the run crossed its surface in equal
 * steps — and what moves is that band and the gap after it, repeating for as
 * long as the element it is drawn on.
 *
 * A pattern can only travel for ever if it repeats, which is the honest reason
 * the bars no longer thin as they go. A run of bands that shrank and faded
 * could only loop by starting again at full width somewhere in the middle of
 * the bar, and the eye finds that in a moment. So the dissolve moved into a
 * mask that does not travel with the pattern — `barFade` for a club's colours,
 * `sceneFade` for the green the pre-game screens wear — and nothing is lost by
 * it: the strength of the stripe at any point along the bar is the strength it
 * has always had.
 *
 * The sizes are in `vw` for the same reason: a band is a share of whatever it
 * is drawn across, so a phone gets the stripe its own bar deserves.
 */
/**
 * One band, as a share of whatever the stripe is drawn across.
 *
 * The run crosses `STRIPE_SPAN` of the bar in `STRIPE_COUNT` steps, so this is
 * the width a band would have if those steps were all the same size — which,
 * now that the pattern has to repeat, is what they are. The header's bar and
 * the pre-game window are then striped at the same scale in proportion to their
 * own widths, within a per cent or two: the bar's height counts towards the
 * length its stripes are laid out along, and the field's length is only ever the
 * window's width.
 */
export const STRIPE_BAND_SHARE = STRIPE_SPAN / STRIPE_COUNT;
/**
 * The green the field is drawn in: the mark's own season green, the colour of
 * the 27 beside the words. It is `--accent` in the stylesheet, and a test reads
 * the stylesheet to keep the two the same green.
 */
export const SCENE_INK = '#4caf7d';
/**
 * How strong a band is drawn where the fade lets it be at full strength.
 *
 * The header's own bands run from 0.21 to 0.45 depending on how much contrast
 * the club's two colours can carry. The field is bolder than any of them: it is
 * the mark's green rather than an ink, it is meant to be read as a colour in
 * its own right, and the fade is what keeps it from taking over the screen.
 */
export const SCENE_ALPHA = 0.9;

/**
 * The pre-game fade, across the window, left to right.
 *
 * The field is almost opaque at the left edge and has gone by the far right, so
 * the screen reads as a pitch that the game's own colours have been laid over:
 * strong where the eye starts and nothing where the cards are. It is applied to
 * the layer's *parent*, which never moves — a fade on the drifting layer itself
 * would travel with it and snap back once a loop, which is the one thing the
 * tiling exists to avoid.
 */
export function sceneFade(ink = '255, 255, 255'): string {
  return `linear-gradient(90deg, rgba(${ink}, 1) 0%, rgba(${ink}, 0.94) 14%, rgba(${ink}, 0.66) 36%, rgba(${ink}, 0.34) 58%, rgba(${ink}, 0.11) 79%, rgba(${ink}, 0) 96%)`;
}
/**
 * How far the pattern runs across its surface before it repeats: two bands,
 * because a band and the gap after it are one whole period of it.
 */
export const STRIPE_TILE_SHARE = STRIPE_BAND_SHARE * 2;
/** The width the drift's speed is quoted at. */
export const STRIPE_REFERENCE_WIDTH = 1280;
/** How fast the stripe travels, in pixels a second, at that width. */
export const STRIPE_SPEED = 19;
/**
 * How long one loop takes, so that the drift has an honest speed at every size.
 *
 * The stylesheet is handed this rather than a duration of its own: the tile and
 * the loop are two views of one number, and a pattern that moved a tile in
 * something other than a tile's worth of time would have to be kept in step by
 * hand.
 */
export const STRIPE_LOOP_SECONDS = (STRIPE_TILE_SHARE * STRIPE_REFERENCE_WIDTH) / STRIPE_SPEED;

/**
 * The stripe itself, as one repeating gradient, in whatever colour it is given.
 *
 * Every length is in `vw`, so a band is the same share of the surface at
 * whatever width the window happens to be without anything having to read the
 * window. The stops are absolute rather than proportional because they have to
 * agree with the stylesheet: see `stripeTile` for the arithmetic that makes the
 * loop invisible. A club's colours go in the same way the mark's green does.
 */
export function stripeTiles(
  ink = SCENE_INK,
  {
    angle = STRIPE_ANGLE,
    alpha = SCENE_ALPHA,
    share = STRIPE_BAND_SHARE,
  }: { angle?: number; alpha?: number; share?: number } = {},
): string {
  // A band is `share` of the window *across* it, and the gradient measures along
  // its own axis, which is a longer way round: hence the sine of the angle.
  const band = share * Math.sin((angle * Math.PI) / 180) * 100;
  const clear = 'rgba(0, 0, 0, 0)';
  const edge = band.toFixed(3);
  return `repeating-linear-gradient(${angle}deg, ${withAlpha(ink, alpha)} 0 ${edge}vw, ${clear} ${edge}vw ${(
    band * 2
  ).toFixed(3)}vw)`;
}

/**
 * How far the stripe travels in one loop, as a `vw` length.
 *
 * This is the number the whole loop hangs on. The pattern's period is measured
 * along the gradient's axis, and moving the layer sideways by `d` slides the
 * pattern `d × sin(angle)` along that axis. So the distance that lands the
 * pattern exactly where it started is one period divided by the sine — two band
 * widths across the surface — and the stylesheet both moves the layer by this
 * and sizes it by this, so its own edge can never walk into view.
 */
export function stripeTile(): string {
  return `${(STRIPE_TILE_SHARE * 100).toFixed(3)}vw`;
}

/** The flat colours a striped surface settles into — the first colour, plus every band. */
export function stripeColours(colours: ClubColours): string[] {
  const primary = colours.primary;
  const alpha = stripeAlpha(colours);
  if (alpha <= 0) return [primary];
  const surfaces = [primary, ...bandSurfaces(primary, secondaryColour(colours), alpha)];
  return [...new Set(surfaces)];
}

/**
 * The club's colours, handed to CSS once for the whole shell. Lives here rather
 * than in a component file so hot reloading stays honest about what is a
 * component and what is a helper.
 */
export function clubStyle(colours: ClubColours): Record<string, string> {
  const primary = colours.primary;
  const secondary = secondaryColour(colours);
  // The fixture band is a shade of the club's colour rather than a hole cut in
  // it: the date and the venue have to be read at a glance, and the club's
  // second colour passing behind them is exactly what stops that happening. Its
  // ink is chosen for the shade itself, so it is always legible.
  const band = mixColours(primary, '#000000', 0.22);
  return {
    '--club': primary,
    '--club-text': readableClubColour(primary),
    '--club-2': secondary,
    '--club-band': band,
    // The band is flat paint too, so its ink is chosen the same way: for that
    // colour alone, with the floor small text needs. The fixture's date, its
    // competition and its venue are all read in it.
    '--club-band-ink': flatClubInk(band),
    // Ink is chosen for the two colours the header actually shows, not just for
    // the flat one, so the stripes never swallow the text on top of them. This
    // is the *striped bar's* ink and only the bar's — it is a compromise across
    // the bands, which is why nothing painted flat may borrow it.
    '--club-ink': inkForColours(...stripeColours(colours)),
    // The ink for the club's colour painted flat, chosen for that colour alone.
    '--club-flat-ink': flatClubInk(primary),
    '--club-2-ink': inkForColour(secondary),
    '--club-wash': withAlpha(primary, 0.16),
    '--club-soft': withAlpha(primary, 0.26),
    // The header's stripe and the fade that carries it off, both handled by the
    // shared `StripeField` so that the bars move exactly as the pre-game
    // screens do. A club with one colour gets `none` and a bar with no bands.
    '--club-stripes': barStripes(colours),
    '--club-bar-fade': barFade(),
  };
}
