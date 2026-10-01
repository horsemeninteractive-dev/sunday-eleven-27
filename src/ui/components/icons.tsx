import type { NavIcon } from '../navigation';

/**
 * A small hand-drawn icon set. One stroke weight, one grid, currentColor only.
 * Icons exist to make a destination recognisable, not to decorate.
 */
const PATHS: Record<NavIcon, string[]> = {
  home: ['M4 11.2 12 4l8 7.2', 'M6.5 10v9.5h11V10', 'M10.4 19.5v-5h3.2v5'],
  manager: [
    'M12 11.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8',
    'M5.2 20c0-3.4 2.9-5.6 6.8-5.6s6.8 2.2 6.8 5.6',
  ],
  squad: [
    'M9 11.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8',
    'M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6',
    'M16 6.2a2.7 2.7 0 1 1 0 5.4',
    'M16.6 14.6c2.5.5 4.3 2.4 4.6 5.2',
  ],
  team: ['M9 4.2 5 5.8 3.6 9.9l2.7 1.2v9.2h11.4v-9.2l2.7-1.2-1.4-4.1-4-1.6', 'M9 4.2c0 1.7 1.3 3 3 3s3-1.3 3-3'],
  tactics: ['M5.4 4.6h13.2v15.2H5.4z', 'M9 3.2h6v2.8H9z', 'M8.6 11.6h6.8', 'M8.6 15.4h4.2'],
  training: ['M12 4.4 18.4 19H5.6z', 'M3.6 19h16.8', 'M9.4 12.6h5.2'],
  recruitment: [
    'M10.6 17.4a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6',
    'M15.5 15.5 20.6 20.6',
    'M7.9 12.2a2.7 2.7 0 1 1 5.4 0',
    'M7 15.1c.7-1.3 2-2 3.6-2s2.9.7 3.6 2',
  ],
  fixtures: ['M4 6.2h16v14H4z', 'M4 10.6h16', 'M8 3.6v4', 'M16 3.6v4'],
  league: [
    'M8 4.2h8v4.4a4 4 0 0 1-8 0z',
    'M12 12.6V16',
    'M8.6 20h6.8',
    'M12 16v4',
    'M8 5.4H5.4v1.6A3.2 3.2 0 0 0 8.4 10.2',
    'M16 5.4h2.6v1.6a3.2 3.2 0 0 1-3 3.2',
  ],
  news: ['M6 3.6h8.4L18.6 8v12.4H6z', 'M14.2 3.6V8h4.4', 'M8.6 12.4h6.8', 'M8.6 15.8h4.6'],
  finances: ['M2.8 7h18.4v10H2.8z', 'M12 14.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8', 'M6 9.4v5.2', 'M18 9.4v5.2'],
  history: ['M3.4 12a8.6 8.6 0 1 0 2.9-6.4', 'M3.2 4.4v4.6h4.6', 'M12 8.2v4.2l3 1.8'],
  kit: [
    'M9 4.2 5 5.8 3.6 9.9l2.7 1.2v9.2h11.4v-9.2l2.7-1.2-1.4-4.1-4-1.6',
    'M9.2 4.6c.6 1.1 1.5 1.7 2.8 1.7s2.2-.6 2.8-1.7',
    'M9.8 11.8v8.5',
    'M14.2 11.8v8.5',
  ],
  world: [
    'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2',
    'M3.6 12h16.8',
    'M12 3.4c2.4 2.5 3.6 5.4 3.6 8.6s-1.2 6.1-3.6 8.6c-2.4-2.5-3.6-5.4-3.6-8.6S9.6 5.9 12 3.4',
  ],
  match: [
    'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2',
    'M12 8.2l3.4 2.4-1.3 4h-4.2l-1.3-4z',
    'M12 3.6v4.6',
    'M4.4 9.6l4.2 2.2',
    'M19.6 9.6l-4.2 2.2',
    'M7.4 20.2l1.8-5.6',
    'M16.6 20.2l-1.8-5.6',
  ],
  more: [
    'M6.6 11.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3',
    'M12 11.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3',
    'M17.4 11.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3',
  ],
  calendar: ['M4 6.2h16v14H4z', 'M4 10.6h16', 'M8 3.6v4', 'M16 3.6v4', 'M8.4 14.2h3.2v3.2H8.4z'],
  search: ['M10.5 17.4a6.9 6.9 0 1 0 0-13.8 6.9 6.9 0 0 0 0 13.8', 'M15.5 15.5 20.6 20.6'],
  chevron: ['M9.6 5.4 16.2 12l-6.6 6.6'],
  play: ['M8 5.4 19 12 8 18.6z'],
  pause: ['M9.2 5.4v13.2', 'M14.8 5.4v13.2'],
  skip: ['M6 5.4 15 12 6 18.6z', 'M18 5.4v13.2'],
  save: ['M12 3.6v10.6', 'M7.8 10.2 12 14.4l4.2-4.2', 'M4.6 19.6h14.8'],
  exit: ['M14.4 4.6h5v14.8h-5', 'M3.6 12h9.6', 'M9.8 8.4 13.4 12l-3.6 3.6'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  settings: ['M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4', 'M12 3.4v2.4', 'M12 18.2v2.4', 'M4.6 7.7 6.7 8.9', 'M17.3 15.1l2.1 1.2', 'M4.6 16.3l2.1-1.2', 'M17.3 8.9l2.1-1.2'],
};

/**
 * Icons for the interface rather than for a destination: what a table heading
 * is doing with the rows underneath it.
 */
export type UIGlyphName = 'sort-none' | 'sort-asc' | 'sort-desc';

const UI_PATHS: Record<UIGlyphName, string[]> = {
  'sort-none': ['M8.6 10.6 12 7.2l3.4 3.4', 'M8.6 13.4 12 16.8l3.4-3.4'],
  'sort-asc': ['M8.6 14.6 12 11.2l3.4 3.4'],
  'sort-desc': ['M8.6 9.4 12 12.8l3.4-3.4'],
};

function GlyphSvg({ paths, className }: { paths: readonly string[]; className?: string }) {
  return (
    <svg
      className={`glyph${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

export function Glyph({ name, className }: { name: NavIcon; className?: string }) {
  return <GlyphSvg paths={PATHS[name]} className={className} />;
}

export function UIGlyph({ name, className }: { name: UIGlyphName; className?: string }) {
  return <GlyphSvg paths={UI_PATHS[name]} className={className} />;
}
