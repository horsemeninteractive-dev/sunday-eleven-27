import { useState, type ReactNode } from 'react';
import type { Club } from '@/domain/club';
import { BADGE_SHAPE_PATHS, badgePlan, type BadgePattern, type BadgeShape } from '../badge';
import { BADGE_DEVICE_SHAPES } from '../badgeDevices';
import { LIGHT_INK } from '../colour';

/**
 * A club's badge.
 *
 * Sizes come from the box it is dropped into — the wrapper sets the width and
 * height, so the same badge is an 18px chip in a table and a 34px crest in the
 * header without the component knowing anything about either. Everything is
 * drawn from the plan, so the badge a club wears in the league table is the
 * same badge it wears on its own page.
 *
 * The badge is decoration: the club's name is always beside it in the interface,
 * so it is hidden from screen readers rather than reading the name out twice.
 */

/**
 * The number the next badge drawn gets, so no two of them share an id.
 *
 * The ids here are a clip path and a pair of arcs, and they *have* to be unique
 * across the whole document: `url(#…)` resolves to the first element in the
 * page carrying that id, so two badges with the same one are both clipped by
 * the first of them — a sheet of crests that all wear the first crest's
 * silhouette whatever shape each was planned with.
 *
 * A counter rather than `useId`, because `useId` only promises to be unique
 * *within a root*, and a badge is drawn in more roots than the game itself: a
 * contact sheet renders each crest in a root of its own, one render per cell,
 * and every one of them would be handed the same id. A counter cannot collide,
 * whatever is doing the rendering.
 */
let badgesDrawn = 0;

function nextBadgeId(): string {
  badgesDrawn += 1;
  return `badge-${badgesDrawn}`;
}

/**
 * A thin edge behind the lettering, so the name survives whatever pattern it
 * lands on. It has to stay thin: a heavy halo eats into the letters themselves
 * and a name that was legible becomes a smear.
 */
function haloFor(ink: string): string {
  return ink === LIGHT_INK ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.6)';
}

/** The halo's width, as a share of the letter size. */
const HALO_WIDTH = 0.13;

/**
 * A line on a badge that has to read whatever is under it.
 *
 * Every keyline on a crest — the ring of a round badge, the outline inside the
 * silhouette, the panel a symbol stands on — is drawn over the club's own
 * colours, and a club's colours are the one pair of colours on a badge that
 * nobody chose to be legible: half the field is the second colour, and a keyline
 * in the ink of the first disappears the moment it crosses onto it. A line drawn
 * twice, once in the halo colour underneath and once in the ink on top, is the
 * same trick the lettering already uses, and it reads on any field there is.
 */
function Keyline({ ink, fill, children }: { ink: string; fill?: string; children: ReactNode }) {
  return (
    <>
      {fill !== undefined && <g fill={fill}>{children}</g>}
      <g fill="none" stroke={haloFor(ink)} strokeOpacity={0.55} strokeWidth={2.2}>
        {children}
      </g>
      <g fill="none" stroke={ink} strokeOpacity={0.55} strokeWidth={0.9}>
        {children}
      </g>
    </>
  );
}

/**
 * The line round the whole badge, where the field meets whatever is behind it.
 *
 * Two lines for the same reason a keyline is two lines, and for one more: a
 * crest is drawn on panels of every shade the game has, and a dark field on a
 * dark panel with a dark outline has no edge at all — the shape everybody
 * planned is a blob. A pale hairline over a dark line is the trick embroidered
 * badges use, and it means the silhouette reads whether the badge or the panel
 * is the lighter of the two.
 */
const EDGE_DARK = 'rgba(0, 0, 0, 0.5)';
const EDGE_LIGHT = 'rgba(255, 255, 255, 0.55)';
const EDGE_WIDTH = 2.4;
const EDGE_HAIRLINE = 1;

/**
 * The field's pattern, drawn over the first colour and under everything else.
 *
 * `shape` is only needed by the bordure, which is the one pattern that has to
 * follow the silhouette rather than the square the badge is drawn in; it does
 * that by laying the silhouette over a full-bleed band of the second colour a
 * little smaller, which gives a band of even width round every curve.
 */
function patternNodes(pattern: BadgePattern, colour: string, field: string, shape: BadgeShape) {
  switch (pattern) {
    case 'stripes':
      return [0, 16, 32, 48].map((x) => <rect key={x} x={x} y={0} width={8} height={64} fill={colour} />);
    case 'pinstripes':
      return [0, 10, 20, 30, 40, 50].map((x) => <rect key={x} x={x} y={0} width={3} height={64} fill={colour} />);
    case 'hoops':
      return [0, 16, 32, 48].map((y) => <rect key={y} x={0} y={y} width={64} height={8} fill={colour} />);
    case 'halves':
      return <rect x={32} y={0} width={32} height={64} fill={colour} />;
    case 'quarters':
      return [
        <rect key="q1" x={0} y={0} width={32} height={32} fill={colour} />,
        <rect key="q2" x={32} y={32} width={32} height={32} fill={colour} />,
      ];
    case 'sash':
      return <rect x={26} y={-24} width={12} height={112} transform="rotate(40 32 32)" fill={colour} />;
    case 'chevron':
      return <path d="M32 12 L62 40 H46 L32 26 L18 40 H2 Z" fill={colour} />;
    case 'bordure':
      return [
        <rect key="band" width={64} height={64} fill={colour} />,
        <path
          key="field"
          d={BADGE_SHAPE_PATHS[shape]}
          fill={field}
          transform="translate(32 32) scale(0.78) translate(-32 -32)"
        />,
      ];
    case 'perFess':
      return <rect x={0} y={32} width={64} height={32} fill={colour} />;
    case 'saltire':
      // Two bands across the middle, the way the sash is one: the same trick as
      // the club's own sash, mirrored, which is the St Andrew's cross.
      return [45, -45].map((angle) => (
        <rect
          key={angle}
          x={27}
          y={-24}
          width={10}
          height={112}
          transform={`rotate(${angle} 32 32)`}
          fill={colour}
        />
      ));
    case 'plain':
    default:
      return null;
  }
}

/** The club's name, set the way a badge sets it: bold, centred, tightly led. */
function NameText({
  x,
  y,
  size,
  ink,
  children,
}: {
  x: number;
  y: number;
  size: number;
  ink: string;
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={size}
      fontWeight={800}
      fill={ink}
      stroke={haloFor(ink)}
      strokeWidth={size * HALO_WIDTH}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

/**
 * A club's badge as artwork, in a 64x64 box and nothing else.
 *
 * Split out from the `<svg>` wrapper because a badge is drawn in more than one
 * kind of place: on its own in a table or a header, and sewn onto a shirt. A
 * nested `<svg>` inside another `<svg>` is not the same thing as a shape — it
 * takes its own viewport — so the shirt embeds this instead.
 */
export function BadgeArt({ club }: { club: Club }) {
  const plan = badgePlan(club);
  // Clip paths and text paths are per-instance: a table draws dozens of these,
  // and an id collision would repaint other clubs' badges with this one's name.
  // Taken once, on the first render, and never again.
  const [uid] = useState(nextBadgeId);
  const shape = BADGE_SHAPE_PATHS[plan.shape];
  const device = BADGE_DEVICE_SHAPES[plan.device]({ ink: plan.ink, field: plan.primary, accent: plan.secondary });
  const nameInk = plan.bandFill === 'none' ? plan.ink : plan.bandInk;
  const yearHalf = plan.year ? (plan.year.length * plan.yearSize * 0.54) / 2 : 0;

  return (
    <>
      <defs>
        <clipPath id={uid}>
          <path d={shape} />
        </clipPath>
        {plan.nameLayout !== 'chief' && (
          <>
            <path id={`${uid}-top`} d={`M${32 - plan.arcRadius} 32 A${plan.arcRadius} ${plan.arcRadius} 0 0 1 ${32 + plan.arcRadius} 32`} />
            <path id={`${uid}-bottom`} d={`M${32 - plan.arcRadius} 32 A${plan.arcRadius} ${plan.arcRadius} 0 0 0 ${32 + plan.arcRadius} 32`} />
          </>
        )}
      </defs>

      <g clipPath={`url(#${uid})`}>
        <rect width={64} height={64} fill={plan.primary} />
        {patternNodes(plan.pattern, plan.secondary, plan.primary, plan.shape)}

        {/* A round badge closes its ring before the lettering goes on, and
            paints the middle plain where the pattern would have run under the
            symbol — so the pattern reads as a banded ring, which is what a
            round badge with stripes actually looks like. */}
        {plan.ringRadius > 0 && (
          <Keyline ink={plan.ink} fill={plan.ringPlain ? plan.primary : 'none'}>
            <circle cx={32} cy={32} r={plan.ringRadius} />
          </Keyline>
        )}

        {/* The name, either in a chief across the top or around the badge. */}
        {plan.nameLayout === 'chief' && (
          <>
            {plan.bandFill !== 'none' && (
              <rect x={0} y={plan.bandTop} width={64} height={plan.bandBottom - plan.bandTop} fill={plan.bandFill} />
            )}
            {/* The rule under the name band, haloed like every other line: it
                crosses from the band's colour onto the field's, and the two are
                the club's own pair, one of which the ink always matches. */}
            <rect x={0} y={plan.bandBottom - 0.65} width={64} height={2.2} fill={haloFor(plan.ink)} opacity={0.55} />
            <rect x={0} y={plan.bandBottom} width={64} height={0.9} fill={plan.ink} opacity={0.55} />
            {plan.nameLines.map((line, index) => (
              <NameText key={line} x={32} y={plan.nameBaselines[index]!} size={plan.nameSize} ink={nameInk}>
                {line}
              </NameText>
            ))}
          </>
        )}

        {plan.nameLayout !== 'chief' && (
          <text
            fontSize={plan.nameSize}
            fontWeight={800}
            fill={plan.ink}
            stroke={haloFor(plan.ink)}
            strokeWidth={plan.nameSize * HALO_WIDTH}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <textPath href={`#${uid}-top`} startOffset="50%" textAnchor="middle">
              {plan.nameLines[0]}
            </textPath>
          </text>
        )}

        {plan.nameLayout === 'ring' && (
          <text
            fontSize={plan.nameSize}
            fontWeight={800}
            fill={plan.ink}
            stroke={haloFor(plan.ink)}
            strokeWidth={plan.nameSize * HALO_WIDTH}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <textPath href={`#${uid}-bottom`} startOffset="50%" textAnchor="middle">
              {plan.nameLines[1]}
            </textPath>
          </text>
        )}

        {/* The plate the symbol stands on, where the field under it is
            patterned: the field colour again, keylined, so a symbol drawn in
            field ink is never asked to read against a stripe of the other. */}
        {plan.devicePanel && (
          <Keyline ink={plan.ink} fill={plan.primary}>
            <rect
              x={plan.deviceX - plan.devicePanel.size / 2}
              y={plan.deviceY - plan.devicePanel.size / 2}
              width={plan.devicePanel.size}
              height={plan.devicePanel.size}
              rx={plan.devicePanel.radius}
            />
          </Keyline>
        )}

        {/* The club's own symbol, in the middle of the field. */}
        <g
          transform={`translate(${plan.deviceX - plan.deviceSize / 2} ${plan.deviceY - plan.deviceSize / 2}) scale(${
            plan.deviceSize / 32
          })`}
        >
          {device}
        </g>

        {/* The year the club was founded, where the badge has room for it. */}
        {plan.year && plan.nameLayout === 'chief' && (
          <>
            <NameText x={32} y={plan.yearY} size={plan.yearSize} ink={plan.ink}>
              {plan.year}
            </NameText>
            <g fill={plan.ink} opacity={0.75}>
              <rect x={32 - yearHalf - 5} y={plan.yearY - plan.yearSize * 0.34} width={4.2} height={0.9} />
              <rect x={32 + yearHalf + 0.8} y={plan.yearY - plan.yearSize * 0.34} width={4.2} height={0.9} />
            </g>
          </>
        )}

        {plan.year && plan.yearOnArc && (
          <text
            fontSize={plan.yearSize}
            fontWeight={800}
            fill={plan.ink}
            stroke={haloFor(plan.ink)}
            strokeWidth={plan.yearSize * HALO_WIDTH}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <textPath href={`#${uid}-bottom`} startOffset="50%" textAnchor="middle">
              {plan.year}
            </textPath>
          </text>
        )}

        {/* Most real badges have a line just inside the edge. */}
        {plan.inset && (
          <Keyline ink={plan.ink}>
            <path d={shape} transform="translate(32 32) scale(0.9) translate(-32 -32)" />
          </Keyline>
        )}
      </g>

      <path d={shape} fill="none" stroke={EDGE_DARK} strokeWidth={EDGE_WIDTH} />
      <path d={shape} fill="none" stroke={EDGE_LIGHT} strokeWidth={EDGE_HAIRLINE} />
    </>
  );
}

export function ClubBadge({ club, size }: { club: Club; size?: number }) {
  return (
    <svg
      className="badge"
      viewBox="0 0 64 64"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <BadgeArt club={club} />
    </svg>
  );
}
