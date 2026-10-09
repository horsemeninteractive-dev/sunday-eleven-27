import type { ReactNode } from 'react';
import type { SponsorTrade } from './sponsorMark';

/**
 * The devices a sponsor's logo can carry.
 *
 * Every one is drawn in its own 32x32 box, so the mark can put it where it needs
 * to and scale it to whatever room is left — the full lockup, the square panel
 * of a `panel` layout, the print across a shirt's chest. They are read as
 * silhouettes far more often than as drawings: a sponsor board on the finances
 * page is 40px wide and the same device is a dozen units across on a shirt, so
 * each is a shape first and a picture second.
 *
 * **Every trade has three drawings, not one.** A world where the pub trade has a
 * pint and nothing else is a world where the twenty pubs in a county wear one
 * logo between them, and the user's complaint about the marks was exactly that:
 * they "get very repetitive". So a pub's sign is a glass, a bottle or a barrel,
 * a builder's is a van, a tipper or a wheelbarrow, and the stream the business's
 * own id runs down (`deviceVariantFor`) decides which without anything being
 * stored. The three of a trade are deliberately unlike each other in silhouette
 * — a tall glass against a wide barrel — because a device that only differs from
 * its cousin in detail is a copy at the size these are read at.
 *
 * Two colours are available: `ink` is the device itself, drawn against the board
 * (or, on a shirt, printed against the cloth), and `field` is what shows through
 * the lines cut into it. Unlike the badge's devices these are not centred by
 * measurement — each is drawn to fill its box deliberately, the way the kit
 * firm's marks are, so there is no table of measured boxes to keep in step.
 */

export interface SponsorTradeColours {
  /** The device itself, drawn against the board. */
  ink: string;
  /** The board's colour, for cutting detail into the shape. */
  field: string;
}

/** A spanner, drawn as one shape so two of them can be crossed. */
function spannerBody(c: SponsorTradeColours): ReactNode {
  return (
    <>
      <path d="M11.6 6.4 H20.4 V9.2 H17.4 V12 H14.6 V9.2 H11.6 Z" fill={c.ink} />
      <path d="M14.4 11.4 H17.6 V23.6 H14.4 Z" fill={c.ink} />
      <path d="M11.2 23.2 H20.8 V27.4 A4.8 4.8 0 0 1 11.2 27.4 Z" fill={c.ink} />
      <circle cx={16} cy={26} r={2.1} fill={c.field} />
    </>
  );
}

/** A knife, drawn as one shape so two of them can be crossed. */
function knifeBody(c: SponsorTradeColours): ReactNode {
  return (
    <>
      <path d="M14.6 3.4 L18.4 5.4 L9.2 22.4 L6.2 21 Z" fill={c.ink} />
      <path d="M6.2 21 L9.2 22.4 L5.4 29 L2.4 27.6 Z" fill={c.ink} />
    </>
  );
}

const DRAWINGS: Record<SponsorTrade, Array<(colours: SponsorTradeColours) => ReactNode>> = {
  /** The pub: a glass, a bottle, a barrel. */
  pint: [
    // The glass: a conical pint with its handle and its level marked.
    (c) => (
      <>
        <path
          d="M21.8 9.6 C27.6 10.2 27.2 20.8 22.2 21.2"
          fill="none"
          stroke={c.ink}
          strokeWidth={2.8}
          strokeLinecap="round"
        />
        <path d="M8.4 5.4 H22.6 L20.8 28.4 A2.1 2.1 0 0 1 18.7 30.4 H12.3 A2.1 2.1 0 0 1 10.2 28.4 Z" fill={c.ink} />
        <path d="M9.6 11 H21.4 L20.7 16.6 H10.3 Z" fill={c.field} />
      </>
    ),
    // The bottle: a long neck, a shoulder and a label.
    (c) => (
      <>
        <path d="M12.6 3 H19.4 V5.8 H12.6 Z" fill={c.ink} />
        <path
          d="M14 5.8 H18 V9.6 Q21.6 10.8 21.6 13.6 V27.4 A2.6 2.6 0 0 1 19 30 H13 A2.6 2.6 0 0 1 10.4 27.4 V13.6 Q10.4 10.8 14 9.6 Z"
          fill={c.ink}
        />
        <path d="M12.6 16.4 H19.4 V23.6 H12.6 Z" fill={c.field} />
      </>
    ),
    // The barrel: two hoops and a bulge, which is the one round shape in the set.
    (c) => (
      <>
        <path d="M10.6 4.6 H21.4 Q25.4 16 21.4 27.4 H10.6 Q6.6 16 10.6 4.6 Z" fill={c.ink} />
        <path d="M9.2 10 Q16 12.6 22.8 10 V13 Q16 15.6 9.2 13 Z" fill={c.field} />
        <path d="M9.2 19 Q16 21.6 22.8 19 V22 Q16 24.6 9.2 22 Z" fill={c.field} />
      </>
    ),
  ],

  /** The social club: a banner over the door, a pennant on a pole, a hanging cloth. */
  banner: [
    // A banner on its pole, with two tails.
    (c) => (
      <>
        <path d="M6.4 1.8 H9.4 V30.2 H6.4 Z" fill={c.ink} />
        <path d="M9.4 4.6 H28.8 L24.2 11 L28.8 17.4 H9.4 Z" fill={c.ink} />
        <path d="M13.2 8 H23.4 L20.8 11 L23.4 14 H13.2 Z" fill={c.field} />
      </>
    ),
    // A pennant: the same pole, a triangular flag instead of a cloth.
    (c) => (
      <>
        <path d="M7.6 1.8 H10.6 V30.2 H7.6 Z" fill={c.ink} />
        <path d="M10.6 3.8 L29.4 10.4 L10.6 17 Z" fill={c.ink} />
        <path d="M14 7.6 L22.6 10.4 L14 13.2 Z" fill={c.field} />
      </>
    ),
    // A cloth hung from a rod: the club's own board over the door.
    (c) => (
      <>
        <path d="M2.6 3.6 H29.4 V6.2 H2.6 Z" fill={c.ink} />
        <path d="M5.4 6.2 H26.6 V22.4 Q21.4 26.6 16 22.4 Q10.6 26.6 5.4 22.4 Z" fill={c.ink} />
        <path d="M9.4 9.4 H13.8 V19.4 H9.4 Z" fill={c.field} />
        <path d="M18.2 9.4 H22.6 V19.4 H18.2 Z" fill={c.field} />
      </>
    ),
  ],

  /** The builder: a box van, a tipper, a wheelbarrow. */
  van: [
    (c) => (
      <>
        <path d="M3 12.4 H19.6 V21.6 H3 A1.8 1.8 0 0 1 1.2 19.8 V14.2 A1.8 1.8 0 0 1 3 12.4 Z" fill={c.ink} />
        <path d="M19.6 14.2 H25.2 L29.8 19.4 V21.6 H19.6 Z" fill={c.ink} />
        <circle cx={8.2} cy={23.4} r={3.6} fill={c.ink} />
        <circle cx={24.2} cy={23.4} r={3.6} fill={c.ink} />
        <circle cx={8.2} cy={23.4} r={1.3} fill={c.field} />
        <circle cx={24.2} cy={23.4} r={1.3} fill={c.field} />
        <rect x={4.2} y={14.8} width={8.4} height={4.4} fill={c.field} />
        <path d="M21.6 15.8 H24.8 L27.4 19.2 H21.6 Z" fill={c.field} />
      </>
    ),
    // A tipper: the bed raised at the front, which is the shape a builder's own
    // yard is full of.
    (c) => (
      <>
        <path d="M12.4 6.6 L30.4 11 L30.4 14.6 L12.4 10.2 Z" fill={c.ink} />
        <path d="M4 12 H10.6 V20 H4 A1.8 1.8 0 0 1 2.2 18.2 V13.8 A1.8 1.8 0 0 1 4 12 Z" fill={c.ink} />
        <path d="M1.8 19.4 H30.2 V21.4 H1.8 Z" fill={c.ink} />
        <circle cx={8.4} cy={24.6} r={3.6} fill={c.ink} />
        <circle cx={23.6} cy={24.6} r={3.6} fill={c.ink} />
        <circle cx={8.4} cy={24.6} r={1.3} fill={c.field} />
        <circle cx={23.6} cy={24.6} r={1.3} fill={c.field} />
        <path d="M5.6 14 H9.4 V17.6 H5.6 Z" fill={c.field} />
      </>
    ),
    // A wheelbarrow: one wheel, two handles, a tray with a load in it.
    (c) => (
      <>
        <path d="M3.4 11.4 H31 L27.2 21.4 H7.2 Z" fill={c.ink} />
        <path d="M7.2 21.4 L4.4 27.6" fill="none" stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M27.2 21.4 L30.2 26.6" fill="none" stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" />
        <circle cx={6.8} cy={25.4} r={3.8} fill={c.ink} />
        <circle cx={6.8} cy={25.4} r={1.4} fill={c.field} />
        <path d="M8.6 14.4 H25.8 L23.8 18.8 H10.2 Z" fill={c.field} />
      </>
    ),
  ],

  /** The garage: an open spanner, a pair of them crossed, a tyre. */
  spanner: [
    (c) => <g transform="rotate(-36 16 16)">{spannerBody(c)}</g>,
    (c) => (
      <>
        <g transform="rotate(-42 16 16)">
          <path d="M11.6 4 H20.4 V6.8 H17.4 V9.6 H14.6 V6.8 H11.6 Z" fill={c.ink} />
          <path d="M14.4 9 H17.6 V22 H14.4 Z" fill={c.ink} />
          <path d="M11.4 22 H20.6 V26.2 A4.6 4.6 0 0 1 11.4 26.2 Z" fill={c.ink} />
        </g>
        <g transform="rotate(42 16 16)">
          <path d="M11.6 4 H20.4 V6.8 H17.4 V9.6 H14.6 V6.8 H11.6 Z" fill={c.ink} />
          <path d="M14.4 9 H17.6 V22 H14.4 Z" fill={c.ink} />
          <path d="M11.4 22 H20.6 V26.2 A4.6 4.6 0 0 1 11.4 26.2 Z" fill={c.ink} />
        </g>
        <circle cx={16} cy={16} r={3} fill={c.field} />
      </>
    ),
    // A tyre: the one round device in the set, read at any size by its tread.
    (c) => (
      <>
        <circle cx={16} cy={16} r={13.4} fill="none" stroke={c.ink} strokeWidth={5.2} strokeDasharray="2.4 2.4" />
        <circle cx={16} cy={16} r={10.4} fill="none" stroke={c.ink} strokeWidth={2.6} />
        <circle cx={16} cy={16} r={4.6} fill={c.ink} />
        <circle cx={16} cy={16} r={1.8} fill={c.field} />
      </>
    ),
  ],

  /** The butcher: a cleaver, two knives crossed, the block. */
  cleaver: [
    (c) => (
      <>
        <path d="M13.8 5.8 H19.6 V25.4 H13.8 Z" fill={c.ink} />
        <path d="M2.6 5.8 H13.8 V19.6 Q8.2 24.4 2.6 19.6 Z" fill={c.ink} />
        <circle cx={16.7} cy={9} r={1.4} fill={c.field} />
        <circle cx={16.7} cy={15.6} r={1.4} fill={c.field} />
      </>
    ),
    (c) => (
      <>
        {knifeBody(c)}
        <g transform="translate(32 0) scale(-1 1)">{knifeBody(c)}</g>
      </>
    ),
    // The block: the cleaver standing in it, which is what a butcher's window is.
    (c) => (
      <>
        <path d="M11.6 2.4 H20.4 V19.6 H11.6 Z" fill={c.ink} />
        <path d="M9 8.4 H23 V11 H9 Z" fill={c.field} />
        <path d="M3.4 19.6 H28.6 V27 A2 2 0 0 1 26.6 29 H5.4 A2 2 0 0 1 3.4 27 Z" fill={c.ink} />
        <path d="M5.4 22.6 H26.6 V24.4 H5.4 Z" fill={c.field} />
      </>
    ),
  ],

  /** The café: a cup on its saucer, a teapot, a coffee bean. */
  cup: [
    (c) => (
      <>
        <path
          d="M23.6 12.8 C29.6 13.4 29.2 20.6 23.6 21"
          fill="none"
          stroke={c.ink}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        <path d="M5.6 10.4 H23.2 L21.4 22.4 A2.6 2.6 0 0 1 18.8 24.4 H10 A2.6 2.6 0 0 1 7.4 22.4 Z" fill={c.ink} />
        <path d="M9.4 13.6 H20.4 L19.6 18.6 H10.2 Z" fill={c.field} />
        <path d="M3.2 26.6 H25.4 V28.8 A1.6 1.6 0 0 1 23.8 30.4 H4.8 A1.6 1.6 0 0 1 3.2 28.8 Z" fill={c.ink} />
        <path d="M11.8 2.6 Q14 5.4 11.8 8.2" fill="none" stroke={c.ink} strokeWidth={1.9} strokeLinecap="round" />
        <path d="M17.6 2.6 Q19.8 5.4 17.6 8.2" fill="none" stroke={c.ink} strokeWidth={1.9} strokeLinecap="round" />
      </>
    ),
    // A teapot: a spout one side, a handle the other, a lid on top.
    (c) => (
      <>
        <path d="M8.8 15.4 L2.4 12 V18 L8.8 17 Z" fill={c.ink} />
        <path
          d="M8.4 13 Q8.4 9 12.6 9 H21.4 Q25.6 9 25.6 13 V19.6 A5 5 0 0 1 20.6 24.6 H13.4 A5 5 0 0 1 8.4 19.6 Z"
          fill={c.ink}
        />
        <path d="M9.4 6.4 H24.6 A1.7 1.7 0 0 1 24.6 9.8 H9.4 A1.7 1.7 0 0 1 9.4 6.4 Z" fill={c.ink} />
        <circle cx={17} cy={5.2} r={2.2} fill={c.ink} />
        <path
          d="M25.6 13.6 C31.2 14.6 30.8 21.6 25.6 22"
          fill="none"
          stroke={c.ink}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        <path d="M11.4 14.6 H22.6 V19.4 H11.4 Z" fill={c.field} />
      </>
    ),
    // A coffee bean: two halves and the crease, which is the trade's own symbol.
    (c) => (
      <>
        <ellipse cx={16} cy={16} rx={9.6} ry={13.4} fill={c.ink} transform="rotate(-28 16 16)" />
        <path
          d="M9.4 9.6 C16.6 13.4 15.4 18.6 22.6 22.4"
          fill="none"
          stroke={c.field}
          strokeWidth={2.6}
          strokeLinecap="round"
          transform="rotate(-28 16 16)"
        />
      </>
    ),
  ],

  /** The plumbers: the drop, the tap, the shower head. */
  drop: [
    (c) => (
      <>
        <path
          d="M16 1.6 C22.4 9.6 26.6 14.6 26.6 19.4 A10.6 10.6 0 0 1 5.4 19.4 C5.4 14.6 9.6 9.6 16 1.6 Z"
          fill={c.ink}
        />
        <path
          d="M11.6 17.4 C11.6 14.6 13.6 11.8 16 8.8"
          fill="none"
          stroke={c.field}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </>
    ),
    // A tap: the cross handle, the body and the spout, dripping.
    (c) => (
      <>
        <path d="M9.6 1.6 H22.4 V4.4 H9.6 Z" fill={c.ink} />
        <path d="M13.9 4.4 H18.1 V9 H13.9 Z" fill={c.ink} />
        <path d="M4.4 12.2 H18.1 V16.6 H6.6 A2.2 2.2 0 0 1 4.4 14.4 Z" fill={c.ink} />
        <path d="M12.4 9 H18.1 V22.6 A3 3 0 0 1 12.1 22.6 Z" fill={c.ink} />
        <path d="M10 12.4 H16 V15.4 H10 Z" fill={c.field} />
        <path
          d="M7.6 24.4 C9.4 27 10.4 28.2 10.4 29.6 A2.4 2.4 0 0 1 5.6 29.6 C5.6 28.2 6.6 27 7.6 24.4 Z"
          fill={c.ink}
        />
      </>
    ),
    // A shower head: the trade's other sign, and the one that says "water" by
    // showing it fall rather than by being a drop.
    (c) => (
      <>
        <path d="M14.4 1.6 H17.6 V6.4 H14.4 Z" fill={c.ink} />
        <path d="M5.6 6.4 H26.4 L23.2 14 H8.8 Z" fill={c.ink} />
        <path d="M9.4 8.8 H22.6 V11.4 H9.4 Z" fill={c.field} />
        <path d="M10.4 17.4 C12.2 20 13.2 21.2 13.2 22.6 A2.4 2.4 0 0 1 8.4 22.6 C8.4 21.2 9.4 20 10.4 17.4 Z" fill={c.ink} />
        <path d="M16 20 C17.8 22.6 18.8 23.8 18.8 25.2 A2.4 2.4 0 0 1 14 25.2 C14 23.8 15 22.6 16 20 Z" fill={c.ink} />
        <path d="M21.6 17.4 C23.4 20 24.4 21.2 24.4 22.6 A2.4 2.4 0 0 1 19.6 22.6 C19.6 21.2 20.6 20 21.6 17.4 Z" fill={c.ink} />
      </>
    ),
  ],

  /** The farm shop: a basket, a sheaf, a churn. */
  basket: [
    (c) => (
      <>
        <path d="M9.8 6 Q16 0.2 22.2 6" fill="none" stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M4.8 12 H27.2 L24.2 27.6 A1.8 1.8 0 0 1 22.4 29.2 H9.6 A1.8 1.8 0 0 1 7.8 27.6 Z" fill={c.ink} />
        <g fill={c.field}>
          <rect x={5.4} y={11.2} width={21.2} height={1.9} />
          <rect x={10.6} y={15.6} width={1.7} height={10.4} />
          <rect x={15.1} y={15.6} width={1.7} height={10.4} />
          <rect x={19.6} y={15.6} width={1.7} height={10.4} />
        </g>
      </>
    ),
    // A sheaf: the stalks fanning out of the band that binds them.
    (c) => (
      <>
        <g fill="none" stroke={c.ink} strokeWidth={2} strokeLinecap="round">
          <path d="M16 22.6 V3.4" />
          <path d="M16 22.6 L9.6 6.4" />
          <path d="M16 22.6 L22.4 6.4" />
          <path d="M16 22.6 L4.6 12.4" />
          <path d="M16 22.6 L27.4 12.4" />
        </g>
        <g fill={c.ink}>
          <ellipse cx={16} cy={3.4} rx={2.2} ry={2.8} />
          <ellipse cx={9.6} cy={6.4} rx={2.2} ry={2.8} transform="rotate(-14 9.6 6.4)" />
          <ellipse cx={22.4} cy={6.4} rx={2.2} ry={2.8} transform="rotate(14 22.4 6.4)" />
          <ellipse cx={4.6} cy={12.4} rx={2.2} ry={2.8} transform="rotate(-30 4.6 12.4)" />
          <ellipse cx={27.4} cy={12.4} rx={2.2} ry={2.8} transform="rotate(30 27.4 12.4)" />
        </g>
        <path d="M10.8 19.6 H21.2 V24 H10.8 Z" fill={c.ink} />
        <path d="M12.6 20.9 H19.4 V22.7 H12.6 Z" fill={c.field} />
      </>
    ),
    // A churn: what the milk comes in, and the shape the trade is drawn by.
    (c) => (
      <>
        <path d="M14 2.6 H18 V5.8 H14 Z" fill={c.ink} />
        <path d="M10.4 5.8 H21.6 V10.4 H10.4 Z" fill={c.ink} />
        <path d="M8.6 10.4 H23.4 V24.4 A4 4 0 0 1 19.4 28.4 H12.6 A4 4 0 0 1 8.6 24.4 Z" fill={c.ink} />
        <path
          d="M8.6 13.4 C4.8 14 4.8 18.4 8.6 18.8"
          fill="none"
          stroke={c.ink}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        <path
          d="M23.4 13.4 C27.2 14 27.2 18.4 23.4 18.8"
          fill="none"
          stroke={c.ink}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        <path d="M9.8 20.6 H22.2 V23 H9.8 Z" fill={c.field} />
      </>
    ),
  ],
};

/**
 * The devices a sponsor's logo draws, keyed by trade.
 *
 * An array per trade, indexed by `deviceVariantFor(business.id, list.length)` so
 * the count and the drawings can never drift apart.
 */
export const SPONSOR_TRADE_DEVICES: Record<SponsorTrade, Array<(colours: SponsorTradeColours) => ReactNode>> =
  DRAWINGS;
