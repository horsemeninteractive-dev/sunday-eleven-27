import type { ViewId } from '@/state/gameStore';

/**
 * Which room of the game a screen is in.
 *
 * The game has one design language and five kinds of screen, and the point of
 * naming them is that the difference between a squad screen and a finance screen
 * should be a difference of *place* rather than of content in the same frame.
 * Every screen used to resolve to the same header, the same 44-pixel club rule
 * above every section and the same boxed surface — measured on all eighteen
 * career screens, every frame value identical — so a manager moving from the
 * table to the treasurer's book was looking at the same room twice.
 *
 * The archetype is attached to the content column as `data-archetype` and the
 * stylesheet does the rest (`styles.css`, "Five rooms in one building"). It is a
 * presentational fact only: nothing in the simulation reads it, and no screen
 * behaves differently because of it.
 *
 *  - `workspace`   the manager's own desk: what needs him, and what he has.
 *  - `football`    working with footballers. The screens with a picture on them.
 *  - `club`        the club's own paperwork: who runs it, what it owes.
 *  - `competition` the season as it unfolds: fixtures, tables, cups, honours.
 *  - `world`       the local game around him, read rather than operated.
 *
 * The pre-game and matchday screens are not in here by accident: they are
 * rendered *outside* the application shell, so they have no content column to be
 * given an archetype. They are already their own world — a photographed pitch,
 * or a takeover screen with no navigation on it — and the entry below is only
 * there so that the map is total and a future move into the shell cannot quietly
 * land a screen in the wrong room.
 */
export type ViewArchetype = 'workspace' | 'football' | 'club' | 'competition' | 'world';

export const ARCHETYPES: ViewArchetype[] = ['workspace', 'football', 'club', 'competition', 'world'];

/** How each room is described, for the design document and the tests. */
export const ARCHETYPE_LABEL: Record<ViewArchetype, string> = {
  workspace: 'The manager’s desk',
  football: 'The board',
  club: 'The club’s paperwork',
  competition: 'The season',
  world: 'The local paper',
};

const BY_VIEW: Record<ViewId, ViewArchetype> = {
  // The desk. Home is the screen the other four report back to.
  dashboard: 'workspace',
  manager: 'workspace',
  inbox: 'workspace',

  // The football itself. Recruitment is deliberately not here: it is the club
  // spending its money on players, and it is filed with the money.
  squad: 'football',
  team: 'football',
  tactics: 'football',
  training: 'football',

  // The club as an institution.
  club: 'club',
  staff: 'club',
  finances: 'club',
  recruitment: 'club',
  kit: 'club',

  // The season, read as a season rather than as a dataset.
  fixtures: 'competition',
  league: 'competition',
  cup: 'competition',
  history: 'competition',

  // The local game beyond the club gate.
  world: 'world',
  news: 'world',

  // Their own world, outside the shell: see the note above.
  start: 'world',
  profile: 'world',
  'select-club': 'world',
  'create-club': 'world',
  match: 'football',
  replay: 'football',
};

export function viewArchetype(view: ViewId): ViewArchetype {
  return BY_VIEW[view] ?? 'workspace';
}
