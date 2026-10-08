import type { ReactNode } from 'react';
import type { GameState } from '@/domain/game';
import { designFor, type KitCollar, type KitPattern } from '@/domain/kit';
import { isPlayer, type Person } from '@/domain/person';
import { clubKit } from '../kit';
import { inkForColour, mixColours, secondaryColour, withAlpha } from '../colour';
import {
  FACE_CENTRE_X,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  facePlan,
  type FacePlan,
  type HairStyle,
  type HeadGeometry,
} from '../face';
import { useGame } from '../hooks';

/**
 * A person, drawn.
 *
 * Every list of people in the game — the squad, the committee, the staff, the
 * names found through the local game, a candidate on the recruitment list — used
 * to be the same item repeated: one bust glyph in one grey box. A squad of
 * eighteen was one drawing eighteen times, and the only thing separating two
 * rows was reading the name. That is a database with names in it.
 *
 * So this is the drawing that replaced it, and it is the same split the rest of
 * the game's artwork uses: `face.ts` decides what the man looks like and this
 * file turns the decision into SVG, exactly as `badge.ts` and `Badge.tsx` divide
 * the same work for a crest. A crest is a club's identity; this is a person's.
 *
 * Two things about a person can be known from a list row, and they are the two
 * this drawing spends its ink on:
 *
 *   - Who he is. The face in `face.ts` — his jaw, his hairline, his fringe, his
 *     forty years of thinning — drawn once and drawn identically everywhere he
 *     appears, so the eye can find the same man twice without reading a word.
 *
 *   - Whether he is ours. A footballer wears the club's shirt: the club's own
 *     colour, its pattern, its collar, all of it read from the same kit the
 *     Kit screen shows, so a transfer changes the shirt and never the face. A
 *     man attached to nobody wears nothing in particular. An official wears a
 *     coat, because the chairman, the treasurer and the other manager in the
 *     other dugout work for the club rather than play for it — and that is said
 *     with a *shape* rather than with a colour, so it reads for everybody.
 *
 * The drawing is decoration: the name is always beside it, so it is hidden from
 * screen readers rather than reading the man out twice.
 */

/** `sm` in a table, `md` in a row, `lg` on a card, `xl` on the profile. */
export type PortraitSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * How much of a face there is room for.
 *
 * The same drawing at four sizes would put a mouth and a pair of eyebrows on a
 * 28-pixel square, where they are a smear, and the man would be *harder* to
 * recognise in the squad table than he is on his own page. So the smallest size
 * keeps what reads at that size — the silhouette, the hair, the jaw, the eyes,
 * the shirt — and gives up the rest. It is a reduction, not a different man:
 * every level draws the same head from the same plan.
 */
const DETAIL: Record<PortraitSize, 0 | 1 | 2> = { sm: 0, md: 1, lg: 1, xl: 2 };

/* ------------------------------------------------------------------ geometry */

/** Two decimal places: a portrait is not a survey, and it keeps the markup short. */
const r = (value: number): number => Math.round(value * 100) / 100;

/** The widest point of the skull, where the ears hang and the hair sits. */
const templeY = (g: HeadGeometry): number => g.crown + 9;
/** The cheekbone, which is where a face stops being a rectangle. */
const cheekY = (g: HeadGeometry): number => g.crown + 18;
/** Where the jaw turns the corner, in front of the ear. */
const jawY = (g: HeadGeometry): number => g.chin - 6;
/** The jaw corner's x, on both sides of the centre. */
const jawHalf = (g: HeadGeometry): number => g.half * g.jaw + 0.6;

/**
 * The chin and the jaw, from the left corner to the right one.
 *
 * Factored out because the beard is drawn from exactly this arc: a beard that
 * followed its own idea of where a jaw is would sit outside a square face and
 * float off a narrow one. `chinFlat` is what makes a jaw a jaw rather than a
 * point — at 0 the curve falls away to the chin, at 1 it walks almost straight
 * along the bottom and turns, which is the difference between a long face and a
 * boxer's.
 */
function chinArc(g: HeadGeometry): string {
  const cx = FACE_CENTRE_X;
  const jw = g.half * g.jaw;
  const jy = jawY(g);
  const deep = jy + (g.chin - jy) * (0.46 + 0.42 * g.chinFlat);
  const wide = 0.86 - 0.16 * g.chinFlat;
  const narrow = 0.42 + 0.18 * g.chinFlat;
  return [
    `C ${r(cx - jw * wide)} ${r(deep)} ${r(cx - jw * narrow)} ${r(g.chin)} ${cx} ${r(g.chin)}`,
    `C ${r(cx + jw * narrow)} ${r(g.chin)} ${r(cx + jw * wide)} ${r(deep)} ${r(cx + jw + 0.6)} ${r(jy)}`,
  ].join(' ');
}

/**
 * The jaw and the chin as a path in its own right.
 *
 * `chinArc` is only the curves — its first command expects the pen to be sitting
 * on the left corner of the jaw, which is what it is when it is spliced into the
 * head and into a beard. Drawn on its own it has to be given the corner to start
 * from, and without one the browser refuses the path outright and quietly draws
 * nothing: the jaw's shadow was missing from every face in the game until a real
 * render complained about it in the console.
 */
function jawPath(g: HeadGeometry): string {
  return `M ${r(FACE_CENTRE_X - jawHalf(g))} ${r(jawY(g))} ${chinArc(g)}`;
}

/** The skull, from the top of the head round the temples, jaw and chin and back. */
function headPath(g: HeadGeometry): string {
  const cx = FACE_CENTRE_X;
  const left = cx - g.half;
  const right = cx + g.half;
  const ty = templeY(g);
  const cy = cheekY(g);
  return [
    `M ${cx} ${r(g.crown)}`,
    // Over the crown and down the left side of the skull to the temple.
    `C ${r(cx - g.half * 0.58)} ${r(g.crown - 0.8)} ${r(left + 0.4)} ${r(g.crown + 2.6)} ${r(left)} ${r(ty)}`,
    // The cheekbone: out to the widest part of the face, then in to the jaw.
    `C ${r(left)} ${r(ty + (cy - ty) * 0.9)} ${r(cx - g.half * 0.99)} ${r(cy + 1)} ${r(cx - jawHalf(g))} ${r(jawY(g))}`,
    chinArc(g),
    `C ${r(cx + g.half * 0.99)} ${r(cy + 1)} ${r(right)} ${r(ty + (cy - ty) * 0.9)} ${r(right)} ${r(ty)}`,
    `C ${r(right - 0.4)} ${r(g.crown + 2.6)} ${r(cx + g.half * 0.58)} ${r(g.crown - 0.8)} ${cx} ${r(g.crown)}`,
    'Z',
  ].join(' ');
}

/* ---------------------------------------------------------------------- hair */

/**
 * How each cut sits on the head, in four numbers, so one cap can be ten haircuts.
 *
 * `lift` is how far the hair stands above the skull — a fifth of a unit is a
 * buzz cut and three is an afro. `hairline` is how far down the head the hair
 * comes, **as a share of crown-to-chin**, which is the whole difference between
 * a schoolboy and a man who is losing it, and which has to be proportional
 * because a round head and a long one do not wear the same hairline a fixed
 * number of units down. `dip` is how much lower the hairline falls in the middle,
 * and it is the one that earns its keep: at a third of a unit it is a normal
 * hairline, at three and a half it is the widow's peak of a receding one.
 * `temple` is how far the side of the hair comes down past the temple.
 *
 * The hairline's height is not taste, it is the oldest proportion there is. The
 * head is in quarters: the hairline a quarter of the way down from the crown,
 * the eyes — and the brows, which sit on the same line — at the half, the base of
 * the nose at three quarters, and the chin at the bottom. Written first as a
 * fixed distance it put the hairline six units too low, and every man in the game
 * wore a low brow with a small face under a heavy head of hair; written as a
 * share of the head it lands on the quarter for all six skulls at once.
 */
export const HAIR_FITS: Record<HairStyle, { lift: number; hairline: number; dip: number; temple: number }> = {
  buzz: { lift: 0.2, hairline: 0.24, dip: 0.3, temple: 2.4 },
  crop: { lift: 1.6, hairline: 0.245, dip: 0.4, temple: 3.4 },
  fringe: { lift: 2.3, hairline: 0.19, dip: 2.4, temple: 3 },
  side: { lift: 1.9, hairline: 0.225, dip: 1.2, temple: 4.4 },
  curls: { lift: 2.7, hairline: 0.232, dip: 0.7, temple: 3.6 },
  afro: { lift: 3.1, hairline: 0.238, dip: 0.8, temple: 6 },
  long: { lift: 2.5, hairline: 0.238, dip: 1, temple: 7 },
  receding: { lift: 1, hairline: 0.125, dip: 3.6, temple: 1 },
  bald: { lift: 0, hairline: 0, dip: 0, temple: 0 },
};

/** Where the hairline falls on a head, in the drawing's own units. */
export function hairlineY(g: HeadGeometry, style: HairStyle): number {
  return r(g.crown + (g.chin - g.crown) * HAIR_FITS[style].hairline);
}

/**
 * The rest of the quarters: the base of the nose, and the line of the mouth.
 *
 * On the head's own scale rather than on a number of units, for the same reason
 * the hairline is — a long face and a round one wear their features in different
 * places and both in the same proportions.
 */
export const NOSE_BASE = 0.75;
export const MOUTH_LINE = 0.83;

/** The cap of hair: over the crown, down past the temples, closed along the hairline. */
function capPath(g: HeadGeometry, style: HairStyle): string {
  const cx = FACE_CENTRE_X;
  const fit = HAIR_FITS[style];
  const left = cx - g.half;
  const right = cx + g.half;
  const front = hairlineY(g, style);
  const top = g.crown - fit.lift;
  const side = templeY(g) + fit.temple;
  return [
    `M ${r(left - 0.5)} ${r(side)}`,
    `C ${r(left - 1.7)} ${r(top + 3.2)} ${r(cx - g.half * 0.6)} ${r(top)} ${cx} ${r(top)}`,
    `C ${r(cx + g.half * 0.6)} ${r(top)} ${r(right + 1.7)} ${r(top + 3.2)} ${r(right + 0.5)} ${r(side)}`,
    // Down the right temple into the forehead, then across it, then back up the
    // left. The two halves of the forehead meet lower than the temples, which is
    // the shape of every hairline there has ever been.
    `C ${r(right + 0.2)} ${r(front - 1)} ${r(cx + g.half * 0.78)} ${r(front - 0.6)} ${r(cx + g.half * 0.26)} ${r(front + fit.dip)}`,
    `C ${r(cx + g.half * 0.1)} ${r(front + fit.dip + 0.7)} ${r(cx - g.half * 0.1)} ${r(front + fit.dip + 0.7)} ${r(cx - g.half * 0.26)} ${r(front + fit.dip)}`,
    `C ${r(cx - g.half * 0.78)} ${r(front - 0.6)} ${r(left + 0.2)} ${r(front - 1)} ${r(left + 0.5)} ${r(side)}`,
    'Z',
  ].join(' ');
}

/** The underside of the hair, along the hairline: one tone darker. */
function hairlineShadow(g: HeadGeometry, style: HairStyle): string {
  const cx = FACE_CENTRE_X;
  const fit = HAIR_FITS[style];
  const front = hairlineY(g, style);
  return [
    `M ${r(cx - g.half * 0.78)} ${r(front - 0.4)}`,
    `C ${r(cx - g.half * 0.5)} ${r(front - 0.1)} ${r(cx - g.half * 0.26)} ${r(front + fit.dip)} ${r(cx - g.half * 0.06)} ${r(front + fit.dip + 0.5)}`,
    `C ${r(cx + g.half * 0.16)} ${r(front + fit.dip + 0.2)} ${r(cx + g.half * 0.5)} ${r(front + 0.6)} ${r(cx + g.half * 0.78)} ${r(front - 0.4)}`,
  ].join(' ');
}

/**
 * The hair that belongs behind the head: an afro's mass and a long cut's length.
 *
 * A silhouette that only ever sat in front of the face would be a helmet. These
 * are drawn first, so the face covers their inner edge and the hair reads as
 * hair around a head rather than as a shape stuck onto one.
 */
function hairBehind(g: HeadGeometry, plan: FacePlan): ReactNode {
  const cx = FACE_CENTRE_X;
  const { fill, shade } = plan.hair;
  if (plan.hairStyle === 'afro') {
    return <ellipse cx={cx} cy={g.crown + 8} rx={g.half + 4.6} ry={13} fill={fill} />;
  }
  if (plan.hairStyle === 'long') {
    const side = (flip: number) => {
      const outer = cx + flip * (g.half + 2.6);
      const inner = cx + flip * (g.half - 1.2);
      return `M ${r(inner)} ${r(templeY(g) - 4)} C ${r(outer - flip * 2.4)} ${r(templeY(g) + 6)} ${r(outer)} ${r(jawY(g))} ${r(outer - flip * 0.6)} ${r(g.chin + 3.4)} C ${r(inner - flip * 1.6)} ${r(g.chin + 2)} ${r(inner)} ${r(jawY(g))} ${r(inner)} ${r(templeY(g) - 4)} Z`;
    };
    return (
      <>
        <path d={side(-1)} fill={shade} />
        <path d={side(1)} fill={shade} />
      </>
    );
  }
  return null;
}

/** The hair that belongs in front: the cut itself, and the weight it hangs with. */
function hairFront(g: HeadGeometry, plan: FacePlan): ReactNode {
  const cx = FACE_CENTRE_X;
  const { fill, shade } = plan.hair;
  const style = plan.hairStyle;
  const front = hairlineY(g, style);

  if (style === 'bald') {
    // The rim above and behind the ears: what is left when the top has gone.
    const rim = (flip: number) => {
      const x = cx + flip * g.half;
      return `M ${r(x + flip * 0.5)} ${r(templeY(g) - 1.4)} C ${r(x - flip * 1.4)} ${r(templeY(g) + 2.4)} ${r(x - flip * 1.2)} ${r(eyeYOf(g, plan) + 3)} ${r(x + flip * 1.2)} ${r(eyeYOf(g, plan) + 2.6)} C ${r(x + flip * 1.9)} ${r(eyeYOf(g, plan) - 1.6)} ${r(x + flip * 1.8)} ${r(templeY(g) + 0.8)} ${r(x + flip * 0.5)} ${r(templeY(g) - 1.4)} Z`;
    };
    return (
      <>
        <path d={rim(-1)} fill={fill} />
        <path d={rim(1)} fill={fill} />
      </>
    );
  }

  const extra: ReactNode[] = [];
  if (style === 'fringe') {
    // A fringe is the one cut that is a shape of its own: it has a bottom edge,
    // and the bottom edge is ragged, because hair cut straight across the eyes
    // by a man himself is never straight.
    const span = g.half * 0.86;
    const points: string[] = [];
    for (let index = 0; index <= 5; index += 1) {
      const x = cx - span + (2 * span * index) / 5;
      points.push(`${r(x)} ${r(eyeYOf(g, plan) - (index % 2 === 0 ? 10.2 : 6.4))}`);
    }
    extra.push(
      <path
        key="fringe"
        d={`M ${r(cx - span)} ${r(front - 1)} L ${points.join(' L ')} L ${r(cx + span)} ${r(front - 1)} Z`}
        fill={fill}
      />,
    );
  }
  if (style === 'curls') {
    // A round cut is a ring of lumps round the skull rather than a smooth cap.
    const lumps: ReactNode[] = [];
    for (let index = 0; index <= 11; index += 1) {
      const theta = Math.PI + (index / 11) * Math.PI;
      lumps.push(
        <circle
          key={index}
          cx={r(cx + (g.half + 1.2) * Math.cos(theta))}
          cy={r(g.crown + 8 - 10 * -Math.sin(theta))}
          r={r(2.5 + (index % 3) * 0.3)}
          fill={index % 4 === 0 ? shade : fill}
        />,
      );
    }
    extra.push(<g key="curls">{lumps}</g>);
  }
  if (style === 'side') {
    // The parting: a sweep falling to one side of the forehead, drawn as one
    // lump rather than as a gradient, because the sheet does flat hair.
    extra.push(
      <path
        key="sweep"
        d={`M ${r(cx - g.half * 0.9)} ${r(front + 1)} C ${r(cx - g.half * 1.35)} ${r(g.crown + 2)} ${r(cx - g.half * 0.5)} ${r(g.crown - 3.6)} ${r(cx + g.half * 0.1)} ${r(g.crown - 0.6)} C ${r(cx - g.half * 0.4)} ${r(g.crown + 2.6)} ${r(cx - g.half * 0.62)} ${r(front - 2)} ${r(cx - g.half * 0.42)} ${r(front + 0.4)} Z`}
        fill={fill}
      />,
    );
  }
  if (style === 'long') {
    extra.push(
      <path
        key="over"
        d={`M ${r(cx - g.half - 1.6)} ${r(templeY(g) + 1)} C ${r(cx - g.half - 2.4)} ${r(templeY(g) + 10)} ${r(cx - g.half - 2)} ${r(jawY(g))} ${r(cx - g.half + 0.4)} ${r(g.chin + 1)} L ${r(cx - g.half + 2)} ${r(g.chin - 1)} C ${r(cx - g.half + 0.6)} ${r(jawY(g) - 2)} ${r(cx - g.half + 0.2)} ${r(templeY(g) + 6)} ${r(cx - g.half + 1.4)} ${r(templeY(g) + 1)} Z`}
        fill={fill}
      />,
      <path
        key="over-right"
        d={`M ${r(cx + g.half + 1.6)} ${r(templeY(g) + 1)} C ${r(cx + g.half + 2.4)} ${r(templeY(g) + 10)} ${r(cx + g.half + 2)} ${r(jawY(g))} ${r(cx + g.half - 0.4)} ${r(g.chin + 1)} L ${r(cx + g.half - 2)} ${r(g.chin - 1)} C ${r(cx + g.half - 0.6)} ${r(jawY(g) - 2)} ${r(cx + g.half - 0.2)} ${r(templeY(g) + 6)} ${r(cx + g.half - 1.4)} ${r(templeY(g) + 1)} Z`}
        fill={fill}
      />,
    );
  }

  return (
    <>
      <path d={capPath(g, style)} fill={fill} />
      <path d={hairlineShadow(g, style)} stroke={shade} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.45} />
      {extra}
    </>
  );
}

/* -------------------------------------------------------------------- the face */

function eyeYOf(g: HeadGeometry, plan: FacePlan): number {
  return r(g.crown + (g.chin - g.crown) * plan.eyes.height);
}

/** The eyes, which are the only feature a 28-pixel portrait has room for. */
function eyes(g: HeadGeometry, plan: FacePlan, detail: number): ReactNode {
  const cx = FACE_CENTRE_X;
  const y = eyeYOf(g, plan);
  const dx = g.half * plan.eyes.spacing;
  const ry = plan.eyes.shape === 'round' ? 1.95 : plan.eyes.shape === 'narrow' ? 1 : 1.45;
  const out: ReactNode[] = [];
  for (const flip of [-1, 1]) {
    const x = cx + flip * dx;
    if (detail === 0) {
      // Too small for a white: one dark dot, which is what the eye is at this size.
      out.push(<circle key={`dot${flip}`} cx={r(x)} cy={y} r={1.25} fill="#2a211a" />);
      continue;
    }
    out.push(<ellipse key={`white${flip}`} cx={r(x)} cy={y} rx={2.1} ry={ry} fill="#f2ece5" />);
    out.push(<circle key={`iris${flip}`} cx={r(x)} cy={y} r={Math.min(1.15, ry)} fill={plan.eyes.colour} />);
    if (detail >= 2) {
      // The lid, and one catch of light in the eye. Two lines, and the face stops
      // being a drawing of a face.
      out.push(
        <path
          key={`lid${flip}`}
          d={`M ${r(x - 2.2)} ${r(y - ry - 0.2)} Q ${r(x)} ${r(y - ry - 1.5)} ${r(x + 2.2)} ${r(y - ry - 0.2)}`}
          stroke={plan.hair.shade}
          strokeWidth={0.8}
          strokeLinecap="round"
          fill="none"
          opacity={0.75}
        />,
      );
      out.push(<circle key={`glint${flip}`} cx={r(x - 0.4)} cy={r(y - 0.5)} r={0.42} fill="#fdfaf6" opacity={0.85} />);
    }
  }
  return <>{out}</>;
}

/** The eyebrows, which are most of what a face is doing at a glance. */
function brows(g: HeadGeometry, plan: FacePlan): ReactNode {
  const cx = FACE_CENTRE_X;
  const dx = g.half * plan.eyes.spacing;
  // A brow sits above the eye and never above the hairline. On a round head with
  // a heavy brow the two would otherwise collide and the hair would eat the outer
  // end of it, which is why the clamp is here rather than in the generator: every
  // head can wear every cut because the drawing makes room for it.
  const front = hairlineY(g, plan.hairStyle);
  const y = r(Math.max(eyeYOf(g, plan) - 3.9 - plan.brows.lift, front + plan.brows.weight / 2 + 0.4));
  return (
    <>
      {[-1, 1].map((flip) => (
        <path
          key={flip}
          d={`M ${r(cx + flip * (dx + 2.9))} ${r(y + 0.5)} Q ${r(cx + flip * dx)} ${r(y - 1.5)} ${r(cx + flip * (dx - 2.6))} ${r(y + 0.3)}`}
          stroke={plan.hair.fill}
          strokeWidth={plan.brows.weight}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </>
  );
}

/** The nose: a bridge, a tip and, at the largest size, two nostrils. */
function nose(g: HeadGeometry, plan: FacePlan, detail: number): ReactNode {
  const cx = FACE_CENTRE_X;
  const y = r(g.crown + (g.chin - g.crown) * (NOSE_BASE + (plan.nose === 'long' ? 0.03 : plan.nose === 'small' ? -0.03 : 0)));
  const wing = plan.nose === 'broad' ? 3 : plan.nose === 'small' ? 2 : 2.5;
  return (
    <>
      <path
        d={`M ${cx} ${r(eyeYOf(g, plan) + 1.8)} L ${r(cx - 0.6)} ${r(y - 1.6)} M ${r(cx - wing)} ${r(y)} Q ${cx} ${r(y + 1.2)} ${r(cx + wing)} ${r(y)}`}
        stroke={plan.skin.shade}
        strokeWidth={0.9}
        strokeLinecap="round"
        fill="none"
        opacity={0.9}
      />
      {detail >= 2 && (
        <g fill={plan.skin.shade} opacity={0.65}>
          <ellipse cx={r(cx - wing + 0.7)} cy={r(y + 0.3)} rx={0.62} ry={0.42} />
          <ellipse cx={r(cx + wing - 0.7)} cy={r(y + 0.3)} rx={0.62} ry={0.42} />
        </g>
      )}
    </>
  );
}

/** The mouth, drawn in the tone the man's own lips would be. */
function mouth(g: HeadGeometry, plan: FacePlan, detail: number): ReactNode {
  const cx = FACE_CENTRE_X;
  const y = r(g.crown + (g.chin - g.crown) * MOUTH_LINE);
  const wide = g.half * 0.34;
  const lip = mixColours(plan.skin.fill, '#7c2b2b', 0.45);
  const dark = mixColours(plan.skin.fill, '#5a1c1c', 0.5);
  if (plan.mouth === 'full') {
    return (
      <>
        <path
          d={`M ${r(cx - wide)} ${y} Q ${cx} ${r(y - 3.4)} ${r(cx + wide)} ${y} Q ${cx} ${r(y + 3.6)} ${r(cx - wide)} ${y} Z`}
          fill={lip}
        />
        {detail >= 1 && <path d={`M ${r(cx - wide + 0.6)} ${y} Q ${cx} ${r(y + 0.5)} ${r(cx + wide - 0.6)} ${y}`} stroke={dark} strokeWidth={0.7} fill="none" strokeLinecap="round" />}
      </>
    );
  }
  const curve = plan.mouth === 'smile' ? -1.5 : plan.mouth === 'thin' ? 0.5 : 0.4;
  return (
    <path
      d={`M ${r(cx - wide)} ${r(y - curve)} Q ${cx} ${r(y + curve + 0.6)} ${r(cx + wide)} ${r(y - curve)}`}
      stroke={dark}
      strokeWidth={plan.mouth === 'thin' ? 0.75 : 1.1}
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** The beard, grown from the jaw line rather than stuck on in front of it. */
function beard(g: HeadGeometry, plan: FacePlan): ReactNode {
  const cx = FACE_CENTRE_X;
  const jw = g.half * g.jaw;
  // A beard grows from the cheekbones down; a goatee only on the chin.
  const top = r(g.crown + (g.chin - g.crown) * (plan.beard === 'goatee' ? 0.78 : 0.62));
  const lip = r(g.crown + (g.chin - g.crown) * MOUTH_LINE);
  const cover = (half: number, from: number) =>
    [
      `M ${r(cx - half)} ${from}`,
      `L ${r(cx - jw - 0.6)} ${r(jawY(g))}`,
      chinArc(g),
      `L ${r(cx + half)} ${from}`,
      'Z',
    ].join(' ');
  const moustache = (
    <path
      key="tache"
      d={`M ${r(cx - 3.5)} ${r(lip - 3.6)} Q ${r(cx - 1.8)} ${r(lip - 5.6)} ${cx} ${r(lip - 4)} Q ${r(cx + 1.8)} ${r(lip - 5.6)} ${r(cx + 3.5)} ${r(lip - 3.6)} Q ${r(cx + 1.8)} ${r(lip - 2.3)} ${cx} ${r(lip - 2.8)} Q ${r(cx - 1.8)} ${r(lip - 2.3)} ${r(cx - 3.5)} ${r(lip - 3.6)} Z`}
      fill={plan.hair.fill}
    />
  );
  if (plan.beard === 'none') return null;
  if (plan.beard === 'stubble') {
    return (
      <>
        <path d={cover(jw * 0.98, top)} fill={plan.hair.shade} opacity={0.26} />
        <path d={cover(jw * 0.92, r(top + 0.6))} fill={plan.hair.shade} opacity={0.16} />
      </>
    );
  }
  if (plan.beard === 'moustache') return moustache;
  if (plan.beard === 'goatee') {
    return (
      <>
        <path d={cover(jw * 0.44, top)} fill={plan.hair.fill} />
        {moustache}
      </>
    );
  }
  return (
    <>
      <path d={cover(jw * 1.02, top)} fill={plan.hair.fill} />
      <path d={cover(jw * 0.82, r(top + 0.8))} fill={plan.hair.shade} opacity={0.5} />
      {moustache}
    </>
  );
}

/** Glasses: two frames and a bridge, drawn thin enough to survive 28 pixels. */
function glasses(g: HeadGeometry, plan: FacePlan): ReactNode {
  if (!plan.glasses) return null;
  const cx = FACE_CENTRE_X;
  const y = eyeYOf(g, plan);
  const dx = g.half * plan.eyes.spacing;
  const frame = '#262c31';
  return (
    <g fill="none" stroke={frame} strokeWidth={0.85} opacity={0.95}>
      {[-1, 1].map((flip) => (
        <rect
          key={flip}
          x={r(cx + flip * dx - 3.7)}
          y={r(y - 2.7)}
          width={7.4}
          height={5.4}
          rx={1.6}
          fill="rgba(220, 235, 245, 0.06)"
        />
      ))}
      <path d={`M ${r(cx - dx + 3.7)} ${r(y - 0.6)} L ${r(cx + dx - 3.7)} ${r(y - 0.6)}`} />
      <path d={`M ${r(cx - dx - 3.7)} ${r(y - 1.4)} L ${r(cx - g.half - 0.4)} ${r(y - 2.6)}`} />
      <path d={`M ${r(cx + dx + 3.7)} ${r(y - 1.4)} L ${r(cx + g.half + 0.4)} ${r(y - 2.6)}`} />
    </g>
  );
}

/* ------------------------------------------------------------------- the body */

/**
 * What the man is wearing, which is the one part of the drawing a transfer can
 * change.
 *
 * A footballer wears the club's own strip — the same designs the Kit screen
 * draws in full, so the shirt on a list row and the shirt on the club's own page
 * are the same shirt. Everybody wears the *home* shirt except the keeper, who
 * wears the third strip: a keeper is the one man on the pitch whose shirt is not
 * his club's, and he keeps it in every match, so he wears it wherever he is
 * drawn. A man attached to nobody wears a plain top. An official wears a coat,
 * because he does not play.
 */
export interface Outfit {
  /** The shirt's own colour, or null when the top belongs to no club. */
  shirt: string | null;
  /** The pattern, and the collar, are drawn in the second colour. */
  secondary: string | null;
  pattern: KitPattern;
  collar: KitCollar | null;
  /** A hairline round the shoulders, so a dark shirt still has an edge. */
  edge: string;
  /** Nobody's top, in one of the two kinds a person can be wearing. */
  plain: 'shirt' | 'coat';
}

/**
 * The plain tops. Two flat greys rather than a club colour, and measured to read
 * against every surface a portrait is dropped onto — a panel, the club's own
 * wash, and the near-black of an overlay. A coat is a shade darker than a shirt,
 * which is the only thing telling an official from an unattached player and is
 * enough, because it is a silhouette and not a puzzle.
 */
const PLAIN_SHIRT = '#454f59';
const PLAIN_COAT = '#333b44';

/**
 * The coat an official is drawn in.
 *
 * One of the two plain tops, and the one the manager wears: he works for the
 * club rather than plays for it, and that is said with a *shape* rather than
 * with a colour, so it reads for everybody. It is exported because the
 * manager's face is chosen on a screen that runs before there is a club to put
 * him in — see `components/FaceDesigner.tsx` — and a preview of him in
 * somebody's shirt would be a preview of somebody else.
 */
export function officialOutfit(): Outfit {
  return { shirt: null, secondary: null, pattern: 'plain', collar: null, edge: 'rgba(255, 255, 255, 0.16)', plain: 'coat' };
}

export function outfitFor(game: GameState | null, person: Person): Outfit {
  if (!isPlayer(person)) return officialOutfit();
  const club = person.clubId && game ? game.clubs[person.clubId] : undefined;
  if (!club) return { shirt: null, secondary: null, pattern: 'plain', collar: null, edge: 'rgba(255, 255, 255, 0.16)', plain: 'shirt' };
  const kit = game ? clubKit(game, club.id) : null;
  if (kit) {
    const design = designFor(kit, person.preferredPosition === 'GK' ? 'goalkeeper' : 'home');
    return {
      shirt: design.primary,
      secondary: design.secondary,
      pattern: design.pattern,
      collar: design.collar,
      edge: withAlpha(inkForColour(design.primary), 0.45),
      plain: 'shirt',
    };
  }
  // A club whose kit has not been generated — a save written before kits, or a
  // club the kit system has never reached — still wears its own two colours.
  const primary = club.identity.colours.primary;
  return {
    shirt: primary,
    secondary: secondaryColour(club.identity.colours),
    pattern: 'plain',
    collar: 'crew',
    edge: withAlpha(inkForColour(primary), 0.45),
    plain: 'shirt',
  };
}

/** Where the shoulders cross the neck, and how deep the neckline bites. */
const SHOULDER_Y = 48;
const NECK_HALF = 6.4;

/** The neckline, in one of the three collars a kit is made with. */
function neckline(collar: KitCollar | null, drop: number): string {
  const cx = FACE_CENTRE_X;
  const left = cx - NECK_HALF - 0.4;
  const right = cx + NECK_HALF + 0.4;
  const top = SHOULDER_Y + 1.6;
  if (collar === 'v') return `M ${left} ${top} L ${cx} ${top + drop + 4} L ${right} ${top}`;
  if (collar === 'grandad') return `M ${left} ${top} Q ${cx} ${top + drop} ${right} ${top}`;
  return `M ${left} ${top} Q ${cx} ${top + drop + 1.4} ${right} ${top}`;
}

/**
 * The top: a pair of shoulders with a neck in it, cut open by the neckline.
 *
 * Drawn as one closed path rather than as a shirt with a collar laid over it,
 * because the neck has to be *behind* the shirt and a shirt with a hole in it is
 * the only way the throat stops showing through the collar.
 */
function torsoPath(collar: KitCollar | null, drop: number): string {
  const cx = FACE_CENTRE_X;
  const left = cx - NECK_HALF - 0.4;
  const right = cx + NECK_HALF + 0.4;
  const top = SHOULDER_Y + 1.6;
  const throat = collar === 'v' ? top + drop + 4 : top + drop + 1.4;
  return [
    `M 1.8 ${PORTRAIT_HEIGHT}`,
    'C 1.8 55 6.6 50.2 15.8 48.1',
    `C 19.2 47.3 ${r(left - 0.6)} 47.6 ${r(left)} ${r(top)}`,
    `L ${cx} ${r(throat)}`,
    `L ${right} ${top}`,
    `C ${r(right + 0.6)} 47.6 38.8 47.3 42.2 48.1`,
    `C 51.4 50.2 56.2 55 56.2 ${PORTRAIT_HEIGHT}`,
    'Z',
  ].join(' ');
}

/** The pattern on the shirt, in the club's second colour, cut to the shirt. */
function chestPattern(pattern: KitPattern, colour: string): ReactNode {
  switch (pattern) {
    case 'stripes':
      return [0, 11, 22, 33, 44].map((x) => <rect key={x} x={x} y={-6} width={5.5} height={80} fill={colour} />);
    case 'pinstripes':
      return [0, 4.4, 8.8, 13.2, 17.6, 22, 26.4, 30.8, 35.2, 39.6, 44, 48.4, 52.8].map((x) => (
        <rect key={x} x={x} y={-6} width={1.6} height={80} fill={colour} />
      ));
    case 'hoops':
      return [44, 55, 66].map((y) => <rect key={y} x={-6} y={y} width={68} height={5.5} fill={colour} />);
    case 'halves':
      return <rect x={28} y={-6} width={40} height={80} fill={colour} />;
    case 'quarters':
      return (
        <>
          <rect x={-6} y={-6} width={34} height={34} fill={colour} />
          <rect x={28} y={28} width={34} height={34} fill={colour} />
        </>
      );
    case 'sash':
      return <rect x={22} y={-34} width={7.5} height={130} transform="rotate(26 28 42)" fill={colour} />;
    case 'chevron':
      return <path d="M 28 33 L 52 50 H 42 L 28 41 L 14 50 H 4 Z" fill={colour} />;
    case 'yoke':
      return <path d="M -8 34 L -8 26 L 64 26 L 64 34 Q 28 44 -8 34 Z" fill={colour} />;
    case 'plain':
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ the whole */

let portraitsDrawn = 0;

/**
 * The number the next portrait gets, so no two share an id.
 *
 * A counter rather than `useId`, for the reason a badge uses one: the ids here
 * are clip paths, `url(#…)` resolves to the first element in the document with
 * that id, and a portrait is drawn in more roots than the game itself — a
 * contact sheet of forty faces is forty roots, one render each, and `useId`
 * would hand every one of them the same id and clip every shirt with the first
 * shirt's pattern.
 */
function nextPortraitId(): string {
  portraitsDrawn += 1;
  return `portrait-${portraitsDrawn}`;
}

/**
 * A face and the top of the body beneath it, drawn from a plan and an outfit.
 *
 * No hooks and no store: the plan is `face.ts`'s decision and the outfit is the
 * caller's, which is what makes the drawing testable and what lets a contact
 * sheet of forty men be rendered without a career to render them in.
 */
export function PortraitArt({
  plan,
  outfit,
  detail = 1,
}: {
  plan: FacePlan;
  outfit: Outfit;
  detail?: 0 | 1 | 2;
}) {
  const g = plan.head;
  const cx = FACE_CENTRE_X;
  const skin = plan.skin;
  const neckHalf = g.half * 0.46;
  const top = outfit.shirt ?? (outfit.plain === 'coat' ? PLAIN_COAT : PLAIN_SHIRT);
  const trimmed = outfit.shirt !== null;
  const clip = outfit.pattern === 'plain' || detail === 0 ? null : nextPortraitId();

  return (
    <svg
      className="portrait__art"
      viewBox={`0 0 ${PORTRAIT_WIDTH} ${PORTRAIT_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      {clip && (
        <defs>
          <clipPath id={clip}>
            <path d={torsoPath(outfit.collar, 3)} />
          </clipPath>
        </defs>
      )}

      {hairBehind(g, plan)}

      {/* The ears go on before the head: the head covers their inner half, which
          is the only way a pair of ears stops looking stuck on. */}
      {detail >= 1 && (
        <g fill={skin.fill}>
          <ellipse cx={r(cx - g.half + 0.3)} cy={r(eyeYOf(g, plan) + 2.6)} rx={2.4} ry={3.6} />
          <ellipse cx={r(cx + g.half - 0.3)} cy={r(eyeYOf(g, plan) + 2.6)} rx={2.4} ry={3.6} />
        </g>
      )}

      {/* Neck, and the shadow the jaw casts on it. */}
      <path
        d={`M ${r(cx - neckHalf)} ${r(g.chin - 6)} L ${r(cx - neckHalf - 1.4)} 53 L ${r(cx + neckHalf + 1.4)} 53 L ${r(cx + neckHalf)} ${r(g.chin - 6)} Z`}
        fill={skin.fill}
      />
      <path
        d={`M ${r(cx - neckHalf)} ${r(g.chin - 6)} L ${r(cx - neckHalf)} ${r(g.chin + 1.6)} Q ${cx} ${r(g.chin + 4.8)} ${r(cx + neckHalf)} ${r(g.chin + 1.6)} L ${r(cx + neckHalf)} ${r(g.chin - 6)} Z`}
        fill={skin.shade}
      />

      {/* The top. Flat colour, a collar, and a pattern if the club has one. */}
      <path d={torsoPath(outfit.collar, 3)} fill={top} />
      {clip && <g clipPath={`url(#${clip})`}>{chestPattern(outfit.pattern, outfit.secondary ?? top)}</g>}
      {detail >= 1 && trimmed && (
        // The sleeve seams, which is what makes the shoulders read as a shirt
        // with arms in it rather than as a hill.
        <g stroke={outfit.secondary ?? top} strokeWidth={1.1} strokeLinecap="round" opacity={0.5}>
          <path d={`M 17.4 49.6 L 15.6 ${PORTRAIT_HEIGHT}`} />
          <path d={`M 38.6 49.6 L 40.4 ${PORTRAIT_HEIGHT}`} />
        </g>
      )}
      <path
        d={neckline(outfit.collar, 3)}
        stroke={trimmed ? (outfit.secondary ?? top) : 'rgba(255, 255, 255, 0.13)'}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      {outfit.collar === 'grandad' && trimmed && (
        <path d={`M ${cx} ${r(SHOULDER_Y + 5)} L ${cx} ${r(SHOULDER_Y + 9)}`} stroke={outfit.secondary ?? top} strokeWidth={1.4} strokeLinecap="round" />
      )}
      {/* An edge round the shoulders: a shirt in the club's own near-black would
          otherwise have no outline at all against a dark panel. */}
      <path d={torsoPath(outfit.collar, 3)} fill="none" stroke={outfit.edge} strokeWidth={0.9} />
      {!trimmed && (
        // A collar on nobody's top, so a coat still has a lapel and a plain shirt
        // still has a neck.
        <path
          d={`M ${r(cx - NECK_HALF - 3.4)} ${r(SHOULDER_Y + 2.4)} L ${r(cx - NECK_HALF + 0.4)} ${r(SHOULDER_Y + 6.4)} M ${r(cx + NECK_HALF + 3.4)} ${r(SHOULDER_Y + 2.4)} L ${r(cx + NECK_HALF - 0.4)} ${r(SHOULDER_Y + 6.4)}`}
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth={1.3}
          strokeLinecap="round"
          fill="none"
        />
      )}

      {/* The head, then everything that is on the face. */}
      <path d={headPath(g)} fill={skin.fill} />
      {beard(g, plan)}
      {/* The jaw's own shadow on the jaw: light comes from above, so the chin
          sits a shade down from the forehead. */}
      <path d={jawPath(g)} fill="none" stroke={skin.shade} strokeWidth={1.4} opacity={0.5} />
      {mouth(g, plan, detail)}
      {detail >= 1 && nose(g, plan, detail)}
      {eyes(g, plan, detail)}
      {detail >= 1 && brows(g, plan)}
      {glasses(g, plan)}

      {hairFront(g, plan)}
    </svg>
  );
}

/**
 * A person's portrait, sized for wherever it is going.
 *
 * The club is looked up here rather than passed in, so every list in the game
 * gets a man in the right shirt by writing his name and nothing else — and a man
 * who has just signed for somebody else is drawn in the new shirt on the next
 * render, with the same face he has always had.
 */
export function Portrait({ person, size = 'md' }: { person: Person; size?: PortraitSize }) {
  const game = useGame();
  return (
    <span className={`portrait portrait--${size}`} aria-hidden="true">
      <PortraitArt plan={facePlan(person)} outfit={outfitFor(game, person)} detail={DETAIL[size]} />
    </span>
  );
}
