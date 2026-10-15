import type { ViewId } from '@/state/gameStore';

/**
 * The single navigation model.
 *
 * Desktop and mobile both read from this file, so a destination is described
 * exactly once: its label, the section it belongs to and the icon the shell
 * draws for it. Anything that can be reached appears here and nowhere else.
 *
 * The shape is deliberately Football Manager's: a handful of sections down the
 * side, each opening onto a few screens, rather than one wall of equally
 * weighted buttons.
 */

export type NavIcon =
  | 'home'
  | 'manager'
  | 'squad'
  | 'team'
  | 'tactics'
  | 'training'
  | 'recruitment'
  | 'fixtures'
  | 'league'
  | 'news'
  | 'messages'
  | 'finances'
  | 'history'
  | 'club'
  | 'staff'
  | 'kit'
  | 'world'
  | 'match'
  | 'more'
  | 'save'
  | 'settings'
  | 'exit'
  | 'menu'
  | 'calendar'
  | 'search'
  | 'chevron'
  | 'play'
  | 'pause'
  | 'skip';

export interface NavLeaf {
  id: ViewId;
  label: string;
  /** Shorter label for tight spaces such as the mobile bottom bar. */
  short?: string;
  icon: NavIcon;
  hint: string;
}

export interface NavSection {
  id: string;
  label: string;
  icon: NavIcon;
  leaves: NavLeaf[];
  /** A section that is really one screen: drawn as a row, not a group. */
  direct?: boolean;
  /**
   * Drawn at the foot of the desktop sidebar, outside its scrolling list.
   *
   * A pinned destination is one the manager must be able to reach whatever he
   * has scrolled to — the sidebar is a list, and a list that scrolls can hide
   * the thing that was waiting on him. Mobile ignores this: the sheet is short
   * enough to show the lot.
   */
  pinned?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home',
    direct: true,
    leaves: [{ id: 'dashboard', label: 'Home', icon: 'home', hint: 'Messages, results and the week ahead' }],
  },
  {
    id: 'manager',
    label: 'Manager',
    icon: 'manager',
    direct: true,
    leaves: [
      { id: 'manager', label: 'Your profile', short: 'Manager', icon: 'manager', hint: 'Who you are, and how you have done' },
    ],
  },
  {
    id: 'inbox',
    label: 'Messages',
    icon: 'messages',
    // Deliberately not a section with screens inside it. Messages is one screen
    // the manager opens when he wants to write to somebody or read what he has
    // been sent, and it carries its own badge — the number is the point of it.
    //
    // And it is pinned to the foot of the desktop sidebar rather than left in
    // the list: it is the one thing that can be waiting on him without his
    // knowing, so it must not be the one that has scrolled out of reach.
    direct: true,
    pinned: true,
    leaves: [
      {
        id: 'inbox',
        label: 'Messages',
        short: 'Messages',
        icon: 'messages',
        hint: 'What the club has been telling you',
      },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    icon: 'squad',
    // Recruitment is here rather than beside it: finding a player is part of
    // building a side, and a manager looking for a left back is thinking about
    // his team first and the transfer market second.
    leaves: [
      { id: 'squad', label: 'Squad', icon: 'squad', hint: 'Everyone registered, and how they are' },
      { id: 'team', label: 'Selection', short: 'Team', icon: 'team', hint: 'Pick the XI, the bench and the captain' },
      { id: 'tactics', label: 'Tactics', icon: 'tactics', hint: 'How you want to play' },
      { id: 'training', label: 'Training', icon: 'training', hint: "Thursday night's session" },
      {
        id: 'recruitment',
        label: 'Recruitment',
        icon: 'recruitment',
        hint: 'Who you have heard about, and how you heard it',
      },
    ],
  },
  {
    id: 'competitions',
    label: 'Competitions',
    icon: 'league',
    // Fixtures first: the next game is the question a manager opens the game to
    // answer, and the table is where he checks how the answer went.
    leaves: [
      { id: 'fixtures', label: 'Schedule', short: 'Matches', icon: 'fixtures', hint: 'The season, week by week' },
      { id: 'league', label: 'League Table', short: 'League', icon: 'league', hint: 'The table and results elsewhere' },
      { id: 'cup', label: 'Cups', short: 'Cups', icon: 'league', hint: 'Every cup in the county, and each ladder’s own' },
    ],
  },
  {
    id: 'club',
    label: 'Club',
    icon: 'finances',
    // The kit is deliberately not a place in the navigation: a club picks its
    // strip once, in pre-season, when the new shirts turn up. The screen still
    // exists, and the overview offers it in the weeks before the season starts.
    //
    // Media lives here rather than beside the club: what the local game says
    // about this club, its players and its money is the club's own news.
    //
    // Club comes first because it is the question the other four answer: who
    // runs this place, how is it doing, and what needs me. A manager who is not
    // sure where to look starts here and is sent on.
    leaves: [
      { id: 'club', label: 'Clubhouse', icon: 'club', hint: 'Who runs it, where it stands, what needs you' },
      { id: 'staff', label: 'Staff', icon: 'staff', hint: 'Who runs the club off the pitch' },
      { id: 'finances', label: 'Finances', icon: 'finances', hint: 'The treasurer’s book' },
      { id: 'news', label: 'Media', short: 'News', icon: 'news', hint: 'Everything the local game has to say' },
      { id: 'history', label: 'History', icon: 'history', hint: 'Honours, records and past seasons' },
    ],
  },
  {
    id: 'world',
    label: 'World',
    icon: 'world',
    direct: true,
    leaves: [{ id: 'world', label: 'The local game', short: 'World', icon: 'world', hint: 'Towns, grounds, clubs and people' }],
  },
];

export const NAV_LEAVES: NavLeaf[] = NAV_SECTIONS.flatMap((section) => section.leaves);

export function navLeafFor(view: ViewId): NavLeaf | undefined {
  return NAV_LEAVES.find((leaf) => leaf.id === view);
}

/** The section a screen lives in, used for the page eyebrow. */
export function navSectionFor(view: ViewId): NavSection | undefined {
  return NAV_SECTIONS.find((section) => section.leaves.some((leaf) => leaf.id === view));
}

export const VIEW_LABEL: Record<ViewId, string> = {
  start: 'Sunday Eleven 27',
  profile: 'Your profile',
  'select-geography': 'Find your district',
  'select-club': 'Choose your club',
  'create-club': 'Create your club',
  dashboard: 'Home',
  manager: 'Your profile',
  squad: 'Squad',
  team: 'Team selection',
  tactics: 'Tactics',
  training: 'Training',
  recruitment: 'Recruitment',
  fixtures: 'Schedule',
  league: 'League table',
  cup: 'Cups',
  news: 'News',
  inbox: 'Messages',
  finances: 'Finances',
  club: 'Clubhouse',
  staff: 'Staff',
  kit: 'The kit',
  history: 'History',
  world: 'The local game',
  match: 'Match',
  replay: 'Match replay',
};

/** Screens reached from a flow rather than the navigation. */
const OFF_NAV: ViewId[] = ['start', 'profile', 'select-geography', 'select-club', 'create-club', 'match', 'replay'];

export function isNavigable(view: ViewId): boolean {
  return !OFF_NAV.includes(view);
}

/**
 * Mobile: five destinations, then everything else behind More.
 */
export type MobileDestination = { id: ViewId | 'more'; label: string; icon: NavIcon };

export const MOBILE_PRIMARY: MobileDestination[] = [
  { id: 'dashboard', label: 'Home', icon: 'home' },
  { id: 'squad', label: 'Squad', icon: 'squad' },
  { id: 'team', label: 'Team', icon: 'team' },
  { id: 'fixtures', label: 'Matches', icon: 'fixtures' },
  { id: 'more', label: 'More', icon: 'more' },
];

/**
 * What a manager between jobs can still open.
 *
 * A sacked manager has no squad to pick, no tactics sheet and no books — those
 * screens belong to a club that is no longer his, and showing them would be
 * lying to him about where he works. Everything that is *not* about a club he
 * keeps: his own page, his messages, the local paper and the world he is
 * looking for work in. The job board on Home is where he applies.
 *
 * Written down here, in the same file as the navigation, because it is the same
 * question the navigation already answers — which screens exist — asked under a
 * different situation. Anything not on this list falls back to the job board, so
 * there is no destination the manager can reach that would contradict him.
 */
export const OUT_OF_WORK_VIEWS: ViewId[] = ['dashboard', 'manager', 'inbox', 'news', 'world'];

export function isAvailableOutOfWork(view: ViewId): boolean {
  return OUT_OF_WORK_VIEWS.includes(view);
}

/** The sidebar a manager is drawn, which is shorter when he has no club. */
export function navSectionsFor(outOfWork: boolean): NavSection[] {
  if (!outOfWork) return NAV_SECTIONS;
  return NAV_SECTIONS.map((section) => ({
    ...section,
    leaves: section.leaves.filter((leaf) => isAvailableOutOfWork(leaf.id)),
  })).filter((section) => section.leaves.length > 0);
}

/**
 * The phone's five, while he has no club.
 *
 * Messages takes the place the squad and the team had — the two destinations
 * that were about a club have nothing behind them, and the two things a manager
 * out of work actually looks at are who has written to him and who is hiring.
 */
export const MOBILE_PRIMARY_OUT_OF_WORK: MobileDestination[] = [
  { id: 'dashboard', label: 'Home', icon: 'home' },
  { id: 'inbox', label: 'Messages', icon: 'messages' },
  { id: 'world', label: 'World', icon: 'world' },
  { id: 'more', label: 'More', icon: 'more' },
];

export function mobilePrimaryFor(outOfWork: boolean): MobileDestination[] {
  return outOfWork ? MOBILE_PRIMARY_OUT_OF_WORK : MOBILE_PRIMARY;
}

/** The More sheet: every remaining destination, grouped, plus the utilities. */
function moreSections(primary: readonly MobileDestination[], outOfWork: boolean): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    direct: false,
    leaves: section.leaves.filter(
      (leaf) =>
        !primary.some((destination) => destination.id === leaf.id) &&
        (!outOfWork || isAvailableOutOfWork(leaf.id)),
    ),
  })).filter((section) => section.leaves.length > 0);
}

/**
 * The More sheet, as the manager's situation allows it to be drawn.
 *
 * There is no precomputed constant for the employed case any more: the sheet is
 * the rest of the model either way, and the one caller asks with the situation
 * it is drawing for, so there is one answer rather than two that could drift.
 */
export function mobileMoreSectionsFor(outOfWork: boolean): NavSection[] {
  return moreSections(mobilePrimaryFor(outOfWork), outOfWork);
}
