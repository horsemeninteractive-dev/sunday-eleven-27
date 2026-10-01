import { useId } from 'react';
import type { Club } from '@/domain/club';
import { BADGE_SHAPE_PATHS, badgePlan, type BadgePattern } from '../badge';
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
 * A thin edge behind the lettering, so the name survives whatever pattern it
 * lands on. It has to stay thin: a heavy halo eats into the letters themselves
 * and a name that was legible becomes a smear.
 */
function haloFor(ink: string): string {
  return ink === LIGHT_INK ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.6)';
}

/** The halo's width, as a share of the letter size. */
const HALO_WIDTH = 0.13;

function patternNodes(pattern: BadgePattern, colour: string) {
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
  const uid = `badge-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
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
        {patternNodes(plan.pattern, plan.secondary)}

        {/* The name, either in a chief across the top or around the badge. */}
        {plan.nameLayout === 'chief' && (
          <>
            {plan.bandFill !== 'none' && (
              <rect x={0} y={plan.bandTop} width={64} height={plan.bandBottom - plan.bandTop} fill={plan.bandFill} />
            )}
            <rect x={0} y={plan.bandBottom} width={64} height={0.9} fill={plan.ink} opacity={0.5} />
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
          <path
            d={shape}
            transform="translate(32 32) scale(0.9) translate(-32 -32)"
            fill="none"
            stroke={plan.ink}
            strokeOpacity={0.45}
            strokeWidth={0.9}
          />
        )}
      </g>

      <path d={shape} fill="none" stroke="rgba(0, 0, 0, 0.45)" strokeWidth={2.4} />
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
