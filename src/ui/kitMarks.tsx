import type { ReactNode } from 'react';
import type { KitMark } from '@/domain/kit';

/**
 * The marks on a kit firm's logo.
 *
 * A kit maker's mark is a shape and a name: the little swoosh, chevron or bolt
 * that sits on the right breast of every shirt. They are drawn in a 16x16 box
 * in a single colour, so the same mark works on a home shirt in black and a
 * goalkeeper shirt in white, and none of them is anybody's real logo.
 */

const chevron = (
  <path d="M1.6 3.2 L8 12.4 L14.4 3.2 L11.6 1.4 L8 6.6 L4.4 1.4 Z" />
);

const wing = (
  <path d="M1.4 11.6 Q4.2 1.6 14.6 2.2 Q10.2 4.4 7.4 13.4 Q4.6 13.2 1.4 11.6 Z" />
);

const bolt = (
  <path d="M9.4 0.6 L2.2 8.8 H6.6 L5.8 15.4 L14 6.4 H8.8 Z" />
);

const arc = (
  <>
    <path d="M1.6 12.6 A9 9 0 0 1 14.4 12.6" fill="none" strokeWidth={2.6} stroke="currentColor" strokeLinecap="round" />
    <circle cx={8} cy={13.2} r={2} />
  </>
);

const rosette = (
  <>
    <path d="M8 1.4 L12.4 4.4 L14 9.4 L10.6 13.6 L5.4 13.6 L2 9.4 L3.6 4.4 Z" />
    <circle cx={8} cy={8} r={2.1} fill="none" strokeWidth={1.6} stroke="currentColor" />
  </>
);

const pennant = <path d="M2.6 1 H13.4 V10.2 L8 14.6 L2.6 10.2 Z" />;

const tick = (
  <path
    d="M1.8 8.6 L5.6 12.4 L14.4 2.6"
    fill="none"
    strokeWidth={2.8}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

const crown = <path d="M1.6 12.4 H14.4 L13.2 3.4 L9.8 7.2 L8 2.2 L6.2 7.2 L2.8 3.4 Z" />;

const flame = <path d="M8 0.6 C4 5.6 2.6 8.2 4.4 11.6 A4 4 0 0 0 11.6 11.6 C13.4 8.2 12 5.6 8 0.6 Z" />;

const orbit = (
  <>
    <circle cx={8} cy={8} r={5.6} fill="none" strokeWidth={2.2} stroke="currentColor" />
    <ellipse cx={8} cy={8} rx={7.2} ry={3} fill="none" strokeWidth={1.2} stroke="currentColor" transform="rotate(-28 8 8)" />
  </>
);

export const KIT_MARKS: Record<KitMark, ReactNode> = {
  chevron,
  wing,
  bolt,
  arc,
  rosette,
  pennant,
  tick,
  crown,
  flame,
  orbit,
};

/** One mark, sized into whatever box the caller has drawn. */
export function KitMarkGlyph({ mark, size = 16 }: { mark: KitMark; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      {KIT_MARKS[mark]}
    </svg>
  );
}
