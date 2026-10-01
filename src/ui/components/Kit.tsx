import { useId, type ReactNode } from 'react';
import type { Club } from '@/domain/club';
import {
  designFor,
  KIT_COLLAR_LABEL,
  KIT_PATTERN_LABEL,
  KIT_ROLE_LABEL,
  type KitDesign,
  type KitPattern,
  type KitRole,
  type KitSet,
} from '@/domain/kit';
import { balanceLines, fitSize } from '../badge';
import { LIGHT_INK } from '../colour';
import { KitMarkGlyph } from '../kitMarks';
import { BadgeArt } from './Badge';

/**
 * A club's kit, drawn.
 *
 * One strip — shirt, shorts, socks — in a 120x158 box, so the same drawing is a
 * 40px thumbnail in a list and a 120px strip on the club's own page. Sizes come
 * from the wrapper, exactly as they do for a badge.
 *
 * Everything on the shirt is on a real shirt: the club's crest and the kit
 * firm's mark on the chest, the sponsor's name across it, the pattern in the
 * club's second colour. The crest sits on the *right* of the picture because it
 * is worn over the heart: a shirt facing you wears its wearer's left on yours.
 */

const SHIRT = 'M42 4 L48 1 Q60 11 72 1 L78 4 L114 26 L104 44 L90 36 L90 76 Q60 84 30 76 L30 36 L16 44 L6 26 Z';

const SHORTS = 'M30 88 H90 L94 116 L64 116 L60 106 L56 116 L26 116 Z';

const SOCK_LEFT = 'M34 124 H54 L52 152 Q44 156 36 152 Z';
const SOCK_RIGHT = 'M66 124 H86 L84 152 Q76 156 68 152 Z';

/** A faint edge, so a white strip still reads on a white panel. */
const OUTLINE = { fill: 'none', stroke: 'rgba(0, 0, 0, 0.32)', strokeWidth: 0.9 } as const;

/** Where the pattern lives: the shirt body, and nothing outside it. */
function patternNodes(pattern: KitPattern, colour: string): ReactNode {
  switch (pattern) {
    case 'stripes':
      return [28, 48, 68, 88].map((x) => <rect key={x} x={x} y={-12} width={10} height={110} fill={colour} />);
    case 'pinstripes':
      return [30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90].map((x) => (
        <rect key={x} x={x} y={-12} width={1.9} height={110} fill={colour} />
      ));
    case 'hoops':
      return [6, 28, 50, 72].map((y) => <rect key={y} x={-12} y={y} width={144} height={11} fill={colour} />);
    case 'halves':
      return <rect x={60} y={-12} width={74} height={110} fill={colour} />;
    case 'quarters':
      return (
        <>
          <rect x={30} y={4} width={30} height={36} fill={colour} />
          <rect x={60} y={40} width={30} height={60} fill={colour} />
        </>
      );
    case 'sash':
      return <rect x={44} y={-40} width={14} height={170} transform="rotate(28 60 40)" fill={colour} />;
    case 'chevron':
      return <path d="M60 16 L98 48 H80 L60 30 L40 48 H22 Z" fill={colour} />;
    case 'yoke':
      return <path d="M30 32 L30 4 L90 4 L90 32 Q60 42 30 32 Z" fill={colour} />;
    case 'plain':
    default:
      return null;
  }
}

/** Where the collar sits. The same band on every shirt, drawn three ways. */
function collarNode(design: KitDesign): ReactNode {
  const shared = {
    fill: 'none',
    stroke: design.trim,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (design.collar === 'v') return <path d="M46 1.4 L60 15 L74 1.4" strokeWidth={4.2} {...shared} />;
  if (design.collar === 'grandad') {
    return (
      <>
        <path d="M47 1.6 Q60 9.5 73 1.6" strokeWidth={3.4} {...shared} />
        <path d="M60 6 L60 24" strokeWidth={2.6} {...shared} />
      </>
    );
  }
  return <path d="M46 1.4 Q60 13 74 1.4" strokeWidth={4.6} {...shared} />;
}

/** A line behind the lettering, so the name survives the pattern it lands on. */
function haloFor(ink: string): string {
  return ink === LIGHT_INK ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.65)';
}

/**
 * The sponsor's name across the chest.
 *
 * Fitted to the shirt rather than set at one size, so a shirt carrying "The Old
 * White Hart" and one carrying "Colney Sport" both look like shirts. A long
 * name gets a second line before it gets unreadably small.
 */
function SponsorText({ name, ink }: { name: string; ink: string }) {
  const words = name.split(/\s+/).filter(Boolean);
  const lines = words.length > 2 || name.length > 15 ? balanceLines(words, 2) : [name];
  const size = fitSize(Math.max(...lines.map((line) => line.length)), 56, 8.4);
  return (
    <text
      textAnchor="middle"
      fontSize={size}
      fontWeight={800}
      fill={ink}
      stroke={haloFor(ink)}
      strokeWidth={size * 0.16}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {lines.map((line, index) => (
        <tspan key={line} x={60} y={56 + index * size * 1.16}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function KitStrip({ club, kit, role }: { club: Club; kit: KitSet; role: KitRole }) {
  const design = designFor(kit, role);
  // One id per drawn strip: a page can show a dozen of these, and two clips
  // sharing an id would paint one club's pattern onto another club's shirt.
  const uid = `kit${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg className="kitstrip" viewBox="0 0 120 158" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={uid}>
          <path d={SHIRT} />
        </clipPath>
      </defs>

      {/* Shirt: body colour first, then the pattern in the second colour. */}
      <path d={SHIRT} fill={design.primary} />
      <g clipPath={`url(#${uid})`}>{patternNodes(design.pattern, design.secondary)}</g>

      {/* Shirt details that have to sit above the pattern. */}
      {collarNode(design)}
      <path d="M6 26 L16 44" stroke={design.trim} strokeWidth={4.6} strokeLinecap="round" />
      <path d="M114 26 L104 44" stroke={design.trim} strokeWidth={4.6} strokeLinecap="round" />

      {/* Shorts and socks. */}
      <path d={SHORTS} fill={design.shorts} />
      <rect x={30} y={88} width={60} height={5} fill={design.shortsTrim} />
      <path d={SOCK_LEFT} fill={design.socks} />
      <path d={SOCK_RIGHT} fill={design.socks} />
      <rect x={34} y={124} width={20} height={4.6} fill={design.socksTrim} />
      <rect x={66} y={124} width={20} height={4.6} fill={design.socksTrim} />

      {/* The three things on the chest: the maker, the club, the sponsor. Both
          marks sit in off the seams — a badge that touches the edge of a shirt
          looks printed onto it rather than sewn on. */}
      <g transform="translate(38 28) scale(0.82)" style={{ color: design.ink }}>
        <KitMarkGlyph mark={kit.maker.mark} size={16} />
      </g>
      {/* The crest, drawn into the shirt rather than laid on top of it: a
          nested <svg> would take a viewport of its own and swamp the shirt. */}
      <g transform="translate(66 24) scale(0.25)">
        <BadgeArt club={club} />
      </g>
      {kit.sponsor ? (
        <SponsorText name={kit.sponsor.name} ink={design.ink} />
      ) : (
        <rect x={46} y={52} width={28} height={2.2} rx={1.1} fill={design.ink} opacity={0.22} />
      )}

      {/* The kit firm is on the shorts too, as it is in real life. */}
      <g transform="translate(38 99) scale(0.62)" style={{ color: design.shortsTrim }}>
        <KitMarkGlyph mark={kit.maker.mark} size={16} />
      </g>

      {/* Outlines last, so the whole strip has one edge. */}
      <path d={SHIRT} {...OUTLINE} />
      <path d={SHORTS} {...OUTLINE} />
      <path d={SOCK_LEFT} {...OUTLINE} />
      <path d={SOCK_RIGHT} {...OUTLINE} />
    </svg>
  );
}

/**
 * The three strips side by side, which is how a kit is always shown: a club
 * does not have a shirt, it has a set.
 */
export function KitSetRow({
  club,
  kit,
  size = 92,
  roles = ['home', 'away', 'goalkeeper'] as KitRole[],
}: {
  club: Club;
  kit: KitSet;
  size?: number;
  roles?: KitRole[];
}) {
  return (
    <div className="kitrow">
      {roles.map((role) => {
        const design = designFor(kit, role);
        return (
          <figure className="kitrow__item" style={{ width: size }} key={role}>
            <KitStrip club={club} kit={kit} role={role} />
            <figcaption>
              <strong>{KIT_ROLE_LABEL[role]}</strong>
              <span className="small muted">
                {KIT_PATTERN_LABEL[design.pattern]}, {KIT_COLLAR_LABEL[design.collar]}
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
