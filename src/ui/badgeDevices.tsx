import type { ReactNode } from 'react';
import type { BadgeDevice } from './badge';

/**
 * The symbols a badge can carry.
 *
 * Every one is drawn in its own 32x32 box so the badge can put it wherever it
 * needs to and scale it to whatever room is left. They are deliberately simple:
 * a badge is seen at 18px in a league table far more often than at 96px on a
 * club page, so each device has to be readable as a silhouette first and a
 * drawing second.
 *
 * Three colours are available for any device: `ink` is the colour that reads
 * against the badge's field (almost always dark), `field` is the field itself,
 * used to cut shapes out, and `accent` is the club's second colour.
 */

export interface DeviceColours {
  ink: string;
  field: string;
  accent: string;
}

/** A point on a circle: 0 degrees is straight up, and angles run clockwise. */
function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/** A star: `points` arms alternating between two radii. Used for manes and suns. */
function starPath(cx: number, cy: number, points: number, outer: number, inner: number, rotation = -90): string {
  const parts: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = ((rotation + (index * 180) / points) * Math.PI) / 180;
    parts.push(`${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))}`);
  }
  return `M${parts.join(' L')} Z`;
}

/** Keep generated path points short: a badge is not a survey. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const HORSE_SHOE =
  'M9 27 C7 24 6 20.5 6 17 C6 11.5 10.5 7 16 7 C21.5 7 26 11.5 26 17 C26 20.5 25 24 23 27 L19.5 25 C21 22.5 21.8 20 21.8 17.4 C21.8 14 19.4 11.6 16 11.6 C12.6 11.6 10.2 14 10.2 17.4 C10.2 20 11 22.5 12.5 25 Z';

const ANTLER =
  'M12.8 14.2 C12.2 10.6 10.4 7.6 7.4 5.2 C9.4 7.6 10 9.2 9.6 10.8 C7.8 9.2 5.8 8.4 3.6 8.2 C5.8 10.2 7 11.6 7.8 13.2 C8.4 14.6 9.2 15.4 10.4 15.8 Z';

export const BADGE_DEVICE_SHAPES: Record<BadgeDevice, (colours: DeviceColours) => ReactNode> = {
  /** The plain one: a ball, for clubs whose name says nothing about them. */
  ball: (c) => (
    <>
      <circle cx={16} cy={16} r={11.5} fill={c.ink} />
      <path d="M16 9.9 L21.8 14.11 L19.59 20.94 L12.41 20.94 L10.2 14.11 Z" fill={c.field} />
      <g stroke={c.field} strokeWidth={1.3} strokeLinecap="round">
        <path d="M16 4.5 V9.9" />
        <path d="M26.94 12.45 L21.8 14.11" />
        <path d="M22.76 25.3 L19.59 20.94" />
        <path d="M9.24 25.3 L12.41 20.94" />
        <path d="M5.06 12.45 L10.2 14.11" />
      </g>
    </>
  ),

  /** A hart: the White Hart, the Stag, the Deer Park. */
  stag: (c) => (
    <>
      <g fill={c.ink}>
        <path d={ANTLER} />
        <g transform="translate(32 0) scale(-1 1)">
          <path d={ANTLER} />
        </g>
      </g>
      <path d="M12.6 15.4 L7.6 14 L11.4 18.6 Z" fill={c.ink} />
      <path d="M19.4 15.4 L24.4 14 L20.6 18.6 Z" fill={c.ink} />
      <path d="M16 14.6 L20.2 19 L18.4 27.4 L16 29.6 L13.6 27.4 L11.8 19 Z" fill={c.ink} />
      <circle cx={14.4} cy={20.4} r={1.05} fill={c.field} />
      <circle cx={17.6} cy={20.4} r={1.05} fill={c.field} />
      <circle cx={16} cy={27.2} r={1.3} fill={c.field} />
    </>
  ),

  /** The Red Lion: a mane and a face. */
  lion: (c) => (
    <>
      <path d={starPath(16, 15.4, 12, 12, 8.6)} fill={c.ink} />
      <circle cx={16} cy={15.6} r={6.6} fill={c.accent} />
      <path d="M16 21.2 C13.6 21.2 12.2 19.8 12.2 18.2 H19.8 C19.8 19.8 18.4 21.2 16 21.2 Z" fill={c.ink} />
      <circle cx={13.6} cy={14.4} r={1} fill={c.ink} />
      <circle cx={18.4} cy={14.4} r={1} fill={c.ink} />
      <path d="M16 22.4 V24.8" stroke={c.ink} strokeWidth={1.3} strokeLinecap="round" />
    </>
  ),

  /** Anything with a horse in it: a shoe, which is what every pub sign uses. */
  horse: (c) => (
    <>
      <path d={HORSE_SHOE} fill={c.ink} />
      <g fill={c.field}>
        <circle cx={8.2} cy={22.4} r={1} />
        <circle cx={6.6} cy={18.6} r={1} />
        <circle cx={7.1} cy={14.6} r={1} />
        <circle cx={23.8} cy={22.4} r={1} />
        <circle cx={25.4} cy={18.6} r={1} />
        <circle cx={24.9} cy={14.6} r={1} />
      </g>
    </>
  ),

  bull: (c) => (
    <>
      <path d="M9.4 15.6 C6.4 14.6 4.2 11.8 4 8.4 C6.4 11.2 8.6 12.6 11.4 13.2 Z" fill={c.ink} />
      <path d="M22.6 15.6 C25.6 14.6 27.8 11.8 28 8.4 C25.6 11.2 23.4 12.6 20.6 13.2 Z" fill={c.ink} />
      <path d="M16 11.4 C11.8 11.4 9 14.2 9 18 C9 24 12.2 28.4 16 30.2 C19.8 28.4 23 24 23 18 C23 14.2 20.2 11.4 16 11.4 Z" fill={c.ink} />
      <circle cx={12.8} cy={18.2} r={1.05} fill={c.field} />
      <circle cx={19.2} cy={18.2} r={1.05} fill={c.field} />
      <path d="M13.4 23.6 C14.6 22.8 17.4 22.8 18.6 23.6 C17.4 25.8 14.6 25.8 13.4 23.6 Z" fill={c.field} />
    </>
  ),

  /** Curled horns: the Rams. */
  ram: (c) => (
    <>
      <path
        d="M10.4 13.6 C6 13 3.4 16.4 4.4 19.8 C5.2 22.4 8 23.6 10 22.2 C11.4 21.2 11.6 19.2 10.6 17.8 C9.8 16.6 8.2 16.6 7.6 17.8"
        fill="none"
        stroke={c.ink}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <path
        d="M21.6 13.6 C26 13 28.6 16.4 27.6 19.8 C26.8 22.4 24 23.6 22 22.2 C20.6 21.2 20.4 19.2 21.4 17.8 C22.2 16.6 23.8 16.6 24.4 17.8"
        fill="none"
        stroke={c.ink}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <path d="M16 13 L20.6 17.4 L19.2 25.6 L16 29.4 L12.8 25.6 L11.4 17.4 Z" fill={c.ink} />
      <circle cx={14.2} cy={19.6} r={1} fill={c.field} />
      <circle cx={17.8} cy={19.6} r={1} fill={c.field} />
    </>
  ),

  fox: (c) => (
    <>
      <path d="M11 6.4 L16 11.6 L21 6.4 L22.6 13.4 L27.4 15.6 L23 21.6 L16 30 L9 21.6 L4.6 15.6 L9.4 13.4 Z" fill={c.ink} />
      <circle cx={12.6} cy={16.4} r={1.05} fill={c.field} />
      <circle cx={19.4} cy={16.4} r={1.05} fill={c.field} />
      <path d="M14.6 26.4 L16 28.6 L17.4 26.4 Z" fill={c.field} />
    </>
  ),

  /** The Fox and Hounds, the Poachers. */
  hound: (c) => (
    <>
      <path d="M8.6 13.6 C5.4 14.4 4.2 18 5.6 21.2 C6.8 24 9.2 25.2 10.4 24.2 C9 21 8.6 17 8.6 13.6 Z" fill={c.ink} />
      <path d="M23.4 13.6 C26.6 14.4 27.8 18 26.4 21.2 C25.2 24 22.8 25.2 21.6 24.2 C23 21 23.4 17 23.4 13.6 Z" fill={c.ink} />
      <path d="M16 11.6 C11.6 11.6 8.8 14.8 8.8 19 C8.8 24.4 12 29.4 16 30.4 C20 29.4 23.2 24.4 23.2 19 C23.2 14.8 20.4 11.6 16 11.6 Z" fill={c.ink} />
      <circle cx={13} cy={17.8} r={1.05} fill={c.field} />
      <circle cx={19} cy={17.8} r={1.05} fill={c.field} />
      <ellipse cx={16} cy={26.6} rx={2.4} ry={1.8} fill={c.field} />
    </>
  ),

  badger: (c) => (
    <>
      <path d="M16 9.6 L22.4 14.6 L21.6 24.4 L16 30.4 L10.4 24.4 L9.6 14.6 Z" fill={c.ink} />
      <path d="M16 10.6 L18.4 13.6 L16 29.4 L13.6 13.6 Z" fill={c.field} />
      <circle cx={12.6} cy={18} r={1.15} fill={c.field} />
      <circle cx={19.4} cy={18} r={1.15} fill={c.field} />
      <circle cx={16} cy={28.2} r={1.5} fill={c.field} />
    </>
  ),

  /** The Robins, the Swifts, the Magpies, the Harriers. */
  bird: (c) => (
    <path
      d="M16 6.4 C15 9.6 13.4 11.2 10.8 11.8 L2.6 16 L10.8 17.4 C13 17.9 14.6 19.4 15.1 22 L16 28.4 L16.9 22 C17.4 19.4 19 17.9 21.2 17.4 L29.4 16 L21.2 11.8 C18.6 11.2 17 9.6 16 6.4 Z"
      fill={c.ink}
    />
  ),

  /** The Swans, the Pelicans. */
  swan: (c) => (
    <>
      <path
        d="M8.4 24.4 C8.4 20.4 11.2 17.4 15.2 16.4 C16.6 13.4 18 10.6 20.6 8.6 L23.4 10.4 L21.6 13 C20.2 15.6 18.6 17.2 17 18.4 C20.6 19 23.4 20.8 24.4 23 C25.2 24.8 23.8 26.6 21.4 26.6 L12.4 26.6 C10 26.6 8.4 25.8 8.4 24.4 Z"
        fill={c.ink}
      />
      <path d="M22.6 9.4 L26.4 10.6 L22.6 12 Z" fill={c.accent} />
      <circle cx={21.4} cy={10.2} r={0.85} fill={c.field} />
      <path d="M9.6 22.8 C12 21.6 15 21.2 18 21.6" fill="none" stroke={c.field} strokeWidth={1.1} strokeLinecap="round" />
    </>
  ),

  /** The Wheatsheaf, the Barley Mow, the Millers' neighbours. */
  sheaf: (c) => (
    <>
      {[-20, -10, 0, 10, 20].map((degrees) => {
        const [x, y] = polar(16, 27, 17.5, degrees);
        return (
          <g key={degrees}>
            <path d={`M16 27 L${round(x)} ${round(y)}`} stroke={c.ink} strokeWidth={1.5} />
            <ellipse
              cx={round(x)}
              cy={round(y)}
              rx={2}
              ry={3.2}
              fill={c.ink}
              transform={`rotate(${degrees} ${round(x)} ${round(y)})`}
            />
          </g>
        );
      })}
      <rect x={12.4} y={20.6} width={7.2} height={3.2} rx={1.2} fill={c.accent} />
    </>
  ),

  /**
   * The Royal Oak, the Oaks, the Cottagers, anywhere named after a tree.
   *
   * A tree is its trunk and its crown, and nothing else reads at badge size: the
   * crown is one mass with the trunk and the branches cut out of it, which is
   * how a carved pub sign does it too.
   */
  tree: (c) => (
    <>
      <rect x={13.4} y={20} width={5.2} height={10.8} rx={1.2} fill={c.ink} />
      <path
        d="M16 3.2 C8.6 3.2 3.4 8.4 3.4 14.6 C3.4 19 5.8 22.2 9.6 23.2 L22.4 23.2 C26.2 22.2 28.6 19 28.6 14.6 C28.6 8.4 23.4 3.2 16 3.2 Z"
        fill={c.ink}
      />
      <g stroke={c.field} strokeWidth={1.2} fill="none" strokeLinecap="round">
        <path d="M16 6 V22.6" />
        <path d="M16 20.6 L10.4 16.4 M16 20.6 L21.6 16.4" />
        <path d="M16 13.4 L11.6 9.6 M16 13.4 L20.4 9.6" />
      </g>
    </>
  ),

  /** The Rose and Crown, and any club that took the rose alone. */
  rose: (c) => (
    <>
      {[0, 72, 144, 216, 288].map((degrees) => {
        const [x, y] = polar(16, 16, 7.4, degrees);
        return <circle key={degrees} cx={round(x)} cy={round(y)} r={5.4} fill={c.ink} />;
      })}
      {[36, 108, 180, 252, 324].map((degrees) => {
        const [x, y] = polar(16, 16, 4.2, degrees);
        return <circle key={degrees} cx={round(x)} cy={round(y)} r={3.6} fill={c.field} />;
      })}
      <circle cx={16} cy={16} r={2.6} fill={c.accent} />
    </>
  ),

  /** The Crown, the Duke of York, Victoria, anything royal. */
  crown: (c) => (
    <>
      <path d="M5.6 23.6 L4.4 10.4 L10.8 15.4 L16 6.6 L21.2 15.4 L27.6 10.4 L26.4 23.6 Z" fill={c.ink} />
      <rect x={5} y={23.4} width={22} height={4.6} rx={1} fill={c.ink} />
      <circle cx={4.4} cy={9.4} r={1.5} fill={c.accent} />
      <circle cx={16} cy={5.6} r={1.6} fill={c.accent} />
      <circle cx={27.6} cy={9.4} r={1.5} fill={c.accent} />
      <g fill={c.field}>
        <circle cx={10.6} cy={21.6} r={1.2} />
        <circle cx={16} cy={21.6} r={1.2} />
        <circle cx={21.4} cy={21.6} r={1.2} />
      </g>
    </>
  ),

  /** The Ship, the Ferrymen, the Dockers, Nelson. */
  ship: (c) => (
    <>
      <rect x={15.2} y={5.6} width={1.6} height={16.8} fill={c.ink} />
      <path d="M14.6 7.6 L6.4 21.4 L14.6 21.4 Z" fill={c.ink} />
      <path d="M17.4 9.6 L25.4 21.4 L17.4 21.4 Z" fill={c.ink} />
      <path d="M4.4 22.4 L27.6 22.4 L23.6 28.8 L8.4 28.8 Z" fill={c.ink} />
    </>
  ),

  /** The Anchors, the Dockers. */
  anchor: (c) => (
    <>
      <circle cx={16} cy={6.6} r={3.2} fill="none" stroke={c.ink} strokeWidth={2} />
      <path d="M16 9.8 V28.6" stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M9.6 13.4 H22.4" stroke={c.ink} strokeWidth={2.2} strokeLinecap="round" />
      <path
        d="M5.6 19.4 C4.8 23 6.8 26.6 10.6 27.8 M26.4 19.4 C27.2 23 25.2 26.6 21.4 27.8"
        fill="none"
        stroke={c.ink}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path
        d="M10.6 27.8 L7.4 25.6 M10.6 27.8 L7.8 30 M21.4 27.8 L24.6 25.6 M21.4 27.8 L24.2 30"
        stroke={c.ink}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </>
  ),

  /** The Cross Keys. */
  keys: (c) => (
    <>
      {[-38, 38].map((degrees) => (
        <g key={degrees} transform={`rotate(${degrees} 16 16)`}>
          <circle cx={16} cy={8.4} r={3.4} fill="none" stroke={c.ink} strokeWidth={2.2} />
          <path d="M16 11.8 V27.6" stroke={c.ink} strokeWidth={2.2} strokeLinecap="round" />
          <path d="M16 20.4 H19.6 M16 24.4 H19.6" stroke={c.ink} strokeWidth={2} strokeLinecap="round" />
        </g>
      ))}
    </>
  ),

  bell: (c) => (
    <>
      <path
        d="M16 5.4 C15 5.4 14.2 6.2 14.2 7.2 C9.6 8.6 7 12.6 7 17.6 C7 21.4 6.2 23.4 5 25.4 L27 25.4 C25.8 23.4 25 21.4 25 17.6 C25 12.6 22.4 8.6 17.8 7.2 C17.8 6.2 17 5.4 16 5.4 Z"
        fill={c.ink}
      />
      <rect x={4.4} y={25.2} width={23.2} height={2.8} rx={1.4} fill={c.ink} />
      <path d="M13.6 28.8 C13.6 30.2 14.7 31.4 16 31.4 C17.3 31.4 18.4 30.2 18.4 28.8 Z" fill={c.ink} />
      <path d="M11.2 19 H20.8" stroke={c.field} strokeWidth={1.2} />
    </>
  ),

  /** The Plough, and the Villagers who farmed the land. */
  plough: (c) => (
    <>
      <path d="M4.6 24.6 L8 20.6 L27.4 20.6 L27.4 24.6 Z" fill={c.ink} />
      <path d="M6.6 20.6 L14 12.6 L19.6 12.6 L19.6 20.6 Z" fill={c.ink} />
      <path d="M13.4 12.6 H19.6 V9.4 H13.4 Z" fill={c.accent} />
      <circle cx={9.4} cy={27.6} r={3} fill="none" stroke={c.ink} strokeWidth={1.8} />
      <path d="M4.6 24.6 L2.4 27.6" stroke={c.ink} strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),

  /** The Three Tuns, and any club named after a barrel. */
  barrels: (c) => (
    <>
      <rect x={9.8} y={6} width={12.4} height={10} rx={2.4} fill={c.ink} />
      <rect x={3.4} y={17} width={12.4} height={12} rx={2.6} fill={c.ink} />
      <rect x={16.2} y={17} width={12.4} height={12} rx={2.6} fill={c.ink} />
      <g stroke={c.field} strokeWidth={1}>
        <path d="M10 9.4 H22" />
        <path d="M10 12.8 H22" />
        <path d="M3.6 21.4 H15.6" />
        <path d="M3.6 25.4 H15.6" />
        <path d="M16.4 21.4 H28.4" />
        <path d="M16.4 25.4 H28.4" />
      </g>
    </>
  ),

  /** The Brewers, the Hop Pole, anything to do with beer. */
  hop: (c) => (
    <>
      <path
        d="M16 4.6 C21.4 7 24.4 11.6 24.4 17.4 C24.4 22.6 20.6 26.4 16 26.4 C11.4 26.4 7.6 22.6 7.6 17.4 C7.6 11.6 10.6 7 16 4.6 Z"
        fill={c.ink}
      />
      <g stroke={c.field} strokeWidth={1.1} fill="none">
        <path d="M16 6.4 V26" />
        <path d="M10.6 9.8 L21.4 22" />
        <path d="M21.4 9.8 L10.6 22" />
      </g>
      <path d="M16 26.4 V30.6" stroke={c.ink} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M16 27.8 C13.4 27.6 11.6 28.6 10.6 30.8 C13 30.2 15 30.2 16 30.4 C17 30.2 19 30.2 21.4 30.8 C20.4 28.6 18.6 27.6 16 27.8 Z" fill={c.ink} />
    </>
  ),

  /** The Railwaymen, the Wheelers, the Millers, the Waggon and Horses. */
  wheel: (c) => (
    <>
      <circle cx={16} cy={16} r={12.4} fill="none" stroke={c.ink} strokeWidth={2.6} />
      <circle cx={16} cy={16} r={9.6} fill="none" stroke={c.ink} strokeWidth={1.2} />
      {[0, 30, 60, 90, 120, 150].map((degrees) => {
        const [x1, y1] = polar(16, 16, 9.4, degrees);
        const [x2, y2] = polar(16, 16, 9.4, degrees + 180);
        return (
          <path key={degrees} d={`M${round(x1)} ${round(y1)} L${round(x2)} ${round(y2)}`} stroke={c.ink} strokeWidth={1.2} />
        );
      })}
      <circle cx={16} cy={16} r={2.6} fill={c.ink} />
    </>
  ),

  /** The Sun Inn and anything else named for the sun. */
  sun: (c) => (
    <>
      {Array.from({ length: 12 }, (_, index) => {
        const degrees = index * 30;
        const [x1, y1] = polar(16, 16, 9.8, degrees);
        const [x2, y2] = polar(16, 16, 14, degrees);
        return (
          <path
            key={degrees}
            d={`M${round(x1)} ${round(y1)} L${round(x2)} ${round(y2)}`}
            stroke={c.ink}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={16} cy={16} r={7.6} fill={c.ink} />
      <circle cx={16} cy={16} r={4.2} fill={c.accent} />
    </>
  ),

  star: (c) => <path d={starPath(16, 16.4, 5, 14, 6.4)} fill={c.ink} />,

  /** The Forgers and any club named after a smithy. */
  anvil: (c) => (
    <>
      <path d="M3.6 12.4 H21.6 C23.2 12.4 24.4 13.4 24.4 14.6 C24.4 15.8 23.2 16.8 21.6 16.8 H17 L15.4 21 L13 21 L14.4 16.8 H10.6 C8 16.8 6.4 15 6.4 12.4 Z" fill={c.ink} />
      <path d="M13 21 H18 L20 25.2 H11 Z" fill={c.ink} />
      <rect x={7.4} y={25} width={17.2} height={4.2} rx={1.2} fill={c.ink} />
    </>
  ),

  /** Kirkby, the Abbey, anywhere a church gave the club its name. */
  tower: (c) => (
    <>
      <path d="M6.4 5.4 H10.6 V7.8 H13.4 V5.4 H18.6 V7.8 H21.4 V5.4 H25.6 V10.6 H6.4 Z" fill={c.ink} />
      <path d="M8.6 10.6 H23.4 V29.6 H8.6 Z" fill={c.ink} />
      <path d="M13.2 16.6 A2.8 2.8 0 0 1 18.8 16.6 V23.4 H13.2 Z" fill={c.field} />
      <rect x={14.8} y={23.4} width={2.4} height={6.2} fill={c.field} />
      <circle cx={16} cy={13.4} r={1.2} fill={c.field} />
    </>
  ),

  /** Haxbridge, Netherford, and every ground on the far side of a river. */
  bridge: (c) => (
    <>
      <path d="M3.4 14.6 H28.6 V17.4 H3.4 Z" fill={c.ink} />
      <path d="M5.6 17.4 C5.6 22.6 9.2 26.4 13.6 26.4 H18.4 C22.8 26.4 26.4 22.6 26.4 17.4" fill="none" stroke={c.ink} strokeWidth={2.4} />
      <path d="M10.6 17.4 C10.6 20.6 12.6 22.8 15.2 22.8 H16.8 C19.4 22.8 21.4 20.6 21.4 17.4" fill="none" stroke={c.ink} strokeWidth={2.4} />
      <path
        d="M1.6 29 C4.8 27.6 8 27.6 11.2 29 C14.4 30.4 17.6 30.4 20.8 29 C24 27.6 27.2 27.6 30.4 29"
        fill="none"
        stroke={c.ink}
        strokeWidth={1.5}
      />
    </>
  ),

  castle: (c) => (
    <>
      <path d="M3.4 13.6 H7.4 V15.8 H9.6 V13.6 H13.4 V29.6 H3.4 Z" fill={c.ink} />
      <path d="M18.6 13.6 H22.4 V15.8 H24.6 V13.6 H28.6 V29.6 H18.6 Z" fill={c.ink} />
      <path d="M11.4 8.4 H15 V10.6 H17 V8.4 H20.6 V29.6 H11.4 Z" fill={c.ink} />
      <path d="M14.2 22.6 A2.4 2.4 0 0 1 19 22.6 V29.6 H14.2 Z" fill={c.field} />
      <g fill={c.field}>
        <rect x={5.4} y={18.4} width={2.4} height={3.6} />
        <rect x={24.2} y={18.4} width={2.4} height={3.6} />
        <rect x={14} y={12.6} width={2} height={3} />
      </g>
    </>
  ),

  /** The Chequers. */
  chequers: (c) => (
    <>
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3].map((column) =>
          (row + column) % 2 === 0 ? (
            <rect key={`${row}-${column}`} x={4 + column * 6} y={4 + row * 6} width={6} height={6} fill={c.ink} />
          ) : null,
        ),
      )}
      <rect x={4} y={4} width={24} height={24} fill="none" stroke={c.ink} strokeWidth={1.4} />
    </>
  ),

  /** The Dynamos. */
  bolt: (c) => <path d="M18.6 3.4 L6.4 18.4 H14.4 L12 28.6 L25.6 12.4 H17.2 Z" fill={c.ink} />,

  /** A wreath for the clubs with no sign of their own: Athletic, Corinthians, the Legion. */
  laurel: (c) => (
    <>
      {[198, 228, 258, 288, 318, 342, 18, 48, 78, 108, 138, 162].map((degrees) => {
        const [x, y] = polar(16, 16, 11.4, degrees);
        return (
          <ellipse
            key={degrees}
            cx={round(x)}
            cy={round(y)}
            rx={3.4}
            ry={1.8}
            fill={c.ink}
            transform={`rotate(${degrees + 90} ${round(x)} ${round(y)})`}
          />
        );
      })}
      <circle cx={16} cy={16} r={3.6} fill={c.accent} />
    </>
  ),

  /** The George, and any club that took the cross for its sign. */
  cross: (c) => <path d="M13 3.6 H19 V11.4 H27.4 V17.4 H19 V28.4 H13 V17.4 H4.6 V11.4 H13 Z" fill={c.ink} />,

  /** The Bricklayers Arms. */
  trowel: (c) => (
    <>
      <path d="M16 29.6 L8.4 16.4 C7 13.8 8.6 10.6 11.4 10.6 H20.6 C23.4 10.6 25 13.8 23.6 16.4 Z" fill={c.ink} />
      <rect x={13.6} y={3.4} width={4.8} height={7.4} rx={1.6} fill={c.accent} />
      <path d="M16 10.6 V5" stroke={c.field} strokeWidth={1.1} />
    </>
  ),

  /** A portcullis: the Gate, the Gatehouse, any town that kept its own gate. */
  gate: (c) => (
    <>
      <path d="M4.6 8.6 H27.4 V23.4 L16 29.8 L4.6 23.4 Z" fill={c.ink} />
      <g stroke={c.field} strokeWidth={1.7} strokeLinecap="round">
        <path d="M10.4 10.8 V25.4" />
        <path d="M16 10.8 V28.4" />
        <path d="M21.6 10.8 V25.4" />
        <path d="M6 15 H26" />
        <path d="M6 20 H26" />
      </g>
    </>
  ),

  /** The village well: Ashwell, Thornwell, the Spring, the Fountain. */
  well: (c) => (
    <>
      <path d="M16 4.4 L26.6 11.8 H5.4 Z" fill={c.ink} />
      <rect x={9.4} y={11.4} width={13.2} height={3.4} rx={1.1} fill={c.ink} />
      <path d="M8.2 15.6 H23.8 L21.8 28.8 H10.2 Z" fill={c.ink} />
      <path d="M12.2 18.2 H19.8 L18.8 25 H13.2 Z" fill={c.field} />
      <rect x={14.4} y={19.2} width={3.2} height={3.4} rx={0.9} fill={c.accent} />
    </>
  ),

  /** The Beehive, the Bees, the Honey Pot. */
  beehive: (c) => (
    <>
      <path
        d="M16 5.6 C22.6 5.6 26.8 10.6 26.8 17.8 C26.8 24.6 22.2 29.6 16 29.6 C9.8 29.6 5.2 24.6 5.2 17.8 C5.2 10.6 9.4 5.6 16 5.6 Z"
        fill={c.ink}
      />
      <g stroke={c.field} strokeWidth={1.5} fill="none">
        <path d="M5.9 13.4 H26.1" />
        <path d="M5.3 19.4 H26.7" />
        <path d="M8.2 25 H23.8" />
      </g>
      <rect x={13} y={26} width={6} height={4} rx={1.2} fill={c.ink} />
    </>
  ),

  /** The Fisherman's Arms, the Trout, anywhere named after the river. */
  fish: (c) => (
    <>
      <path
        d="M3.6 16 C8.2 10.2 14.2 8.6 19.8 11 L26.4 6.4 L24.6 13.2 L28.6 16 L24.6 18.8 L26.4 25.6 L19.8 21 C14.2 23.4 8.2 21.8 3.6 16 Z"
        fill={c.ink}
      />
      <circle cx={9} cy={14.4} r={1.2} fill={c.field} />
      <path d="M13.4 12.6 C15.6 14.6 15.6 17.4 13.4 19.4" fill="none" stroke={c.field} strokeWidth={1.1} />
    </>
  ),

  /** The Archers, the Arrows, the Fletcher's Arms. */
  arrow: (c) => (
    <g transform="rotate(-45 16 16)">
      <rect x={14.4} y={8.4} width={3.2} height={18.6} rx={1.2} fill={c.ink} />
      <path d="M16 2.4 L22.2 12.6 H9.8 Z" fill={c.ink} />
      <path d="M11 25.4 L9.4 30.8 L16 27.8 L22.6 30.8 L21 25.4 Z" fill={c.accent} />
    </g>
  ),

  /** The Beacon, the Lamp, the Lantern. */
  lamp: (c) => (
    <>
      <path d="M9.8 12.4 L11.4 4.4 H20.6 L22.2 12.4 Z" fill={c.ink} />
      <rect x={14.6} y={12.2} width={2.8} height={12.4} rx={1.1} fill={c.ink} />
      <path d="M8.4 29.8 H23.6 L21.2 25.4 H10.8 Z" fill={c.ink} />
      <rect x={12.2} y={7.2} width={7.6} height={3.6} rx={0.9} fill={c.accent} />
    </>
  ),

  /** The Hammers, and the trades that worked the forge's other side. */
  hammer: (c) => (
    <g transform="rotate(-32 16 16)">
      <rect x={14.6} y={9.4} width={2.8} height={19.6} rx={1.1} fill={c.ink} />
      <rect x={7.4} y={4.4} width={17.2} height={5.6} rx={1.6} fill={c.ink} />
      <path d="M7.4 10 L5.4 14.6 L9.6 11.6 Z" fill={c.ink} />
    </g>
  ),

  /** The Joiners Arms, the Carpenters Arms. */
  mallet: (c) => (
    <g transform="rotate(-24 16 16)">
      <rect x={14.6} y={10.6} width={2.8} height={18.4} rx={1.1} fill={c.ink} />
      <rect x={7.6} y={5.4} width={16.8} height={8.2} rx={1.8} fill={c.ink} />
      <g stroke={c.field} strokeWidth={1.1}>
        <path d="M10.8 7.6 V11.4" />
        <path d="M21.2 7.6 V11.4" />
      </g>
    </g>
  ),

  /** The Bishop's Mitre, and the clubs named after the men who wore one. */
  mitre: (c) => (
    <>
      <path d="M16 4.4 C20.8 10.6 22.2 16.6 22.2 21.4 H9.8 C9.8 16.6 11.2 10.6 16 4.4 Z" fill={c.ink} />
      <path d="M16 4.4 C17.6 8.6 17.2 12.8 16 15.8 C14.8 12.8 14.4 8.6 16 4.4 Z" fill={c.field} />
      <rect x={8.2} y={21.2} width={15.6} height={3.4} rx={1} fill={c.ink} />
      <path d="M10.4 24.8 H21.6 L20.2 29 H11.8 Z" fill={c.ink} />
    </>
  ),

  /** The Chalice, the Cup, the Grail, the Tankard. */
  chalice: (c) => (
    <>
      <path d="M8.2 5.4 H23.8 C23.8 13 20.8 17.6 16 17.6 C11.2 17.6 8.2 13 8.2 5.4 Z" fill={c.ink} />
      <rect x={14.6} y={17.4} width={2.8} height={5} fill={c.ink} />
      <path d="M9.2 22.4 H22.8 L20.6 27.2 H11.4 Z" fill={c.ink} />
      <rect x={10.6} y={7.2} width={10.8} height={1.5} rx={0.7} fill={c.accent} />
      <path d="M11.8 9.6 H20.2" stroke={c.field} strokeWidth={1.1} />
    </>
  ),

  /** The Vine, the Vineyard, anywhere the grapes came from. */
  vine: (c) => (
    <>
      <path
        d="M16 4.4 C21.8 6.6 24.2 10.8 23.4 15.2 C22.8 18.8 19.8 21.2 16 21.2 C12.2 21.2 9.2 18.8 8.6 15.2 C7.8 10.8 10.2 6.6 16 4.4 Z"
        fill={c.ink}
      />
      <path d="M16 6.4 V20.4" stroke={c.field} strokeWidth={1.2} />
      <g fill={c.accent}>
        <circle cx={11.4} cy={24.2} r={2.7} />
        <circle cx={16} cy={26.6} r={2.7} />
        <circle cx={20.6} cy={24.2} r={2.7} />
        <circle cx={16} cy={21.4} r={2.7} />
      </g>
    </>
  ),

  /** The Miller's stone: Stoneleigh, the Milestone, anywhere the corn was ground. */
  millstone: (c) => (
    <>
      <circle cx={16} cy={16} r={12.4} fill={c.ink} />
      <circle cx={16} cy={16} r={8.6} fill="none" stroke={c.field} strokeWidth={0.9} />
      <circle cx={16} cy={16} r={4.2} fill={c.field} />
      <g stroke={c.field} strokeWidth={1.5} strokeLinecap="round">
        <path d="M16 4.6 V11" />
        <path d="M16 21 V27.4" />
        <path d="M4.6 16 H11" />
        <path d="M21 16 H27.4" />
      </g>
    </>
  ),

  /** The Gardeners Arms, the Allotment, the Diggers. */
  spade: (c) => (
    <g transform="rotate(-18 16 16)">
      <rect x={14.4} y={6.4} width={3.2} height={13} rx={1.2} fill={c.ink} />
      <path d="M8.6 19.2 H23.4 C23.4 25.4 20.4 29.6 16 29.6 C11.6 29.6 8.6 25.4 8.6 19.2 Z" fill={c.ink} />
      <rect x={11.4} y={3.2} width={9.2} height={3.2} rx={1.2} fill={c.ink} />
      <path d="M16 22 V26.8" stroke={c.field} strokeWidth={1.1} />
    </g>
  ),

  /** The Sword, the Blades, the Cutlers Arms. */
  sword: (c) => (
    <g transform="rotate(-45 16 16)">
      <path d="M16 2.6 L18.6 8.6 V20.6 H13.4 V8.6 Z" fill={c.ink} />
      <rect x={8.4} y={20.4} width={15.2} height={2.8} rx={1} fill={c.ink} />
      <rect x={14.6} y={22.6} width={2.8} height={5.6} rx={1} fill={c.accent} />
      <circle cx={16} cy={29} r={1.8} fill={c.ink} />
    </g>
  ),
};
