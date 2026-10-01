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
  | 'finances'
  | 'history'
  | 'kit'
  | 'world'
  | 'match'
  | 'more'
  | 'save'
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
    id: 'team',
    label: 'Team',
    icon: 'squad',
    leaves: [
      { id: 'squad', label: 'Squad', icon: 'squad', hint: 'Everyone registered, and how they are' },
      { id: 'team', label: 'Team selection', short: 'Team', icon: 'team', hint: 'Pick the XI, the bench and the captain' },
      { id: 'tactics', label: 'Tactics', icon: 'tactics', hint: 'How you want to play' },
      { id: 'training', label: 'Training', icon: 'training', hint: "Thursday night's session" },
    ],
  },
  {
    id: 'recruitment',
    label: 'Recruitment',
    icon: 'recruitment',
    direct: true,
    leaves: [
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
    leaves: [
      { id: 'league', label: 'League table', short: 'League', icon: 'league', hint: 'The table and results elsewhere' },
      { id: 'fixtures', label: 'Schedule', short: 'Matches', icon: 'fixtures', hint: 'The season, week by week' },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    icon: 'news',
    direct: true,
    leaves: [{ id: 'news', label: 'News', short: 'News', icon: 'news', hint: 'Everything the local game has to say' }],
  },
  {
    id: 'club',
    label: 'Club',
    icon: 'finances',
    // The kit is deliberately not a place in the navigation: a club picks its
    // strip once, in pre-season, when the new shirts turn up. The screen still
    // exists, and the overview offers it in the weeks before the season starts.
    leaves: [
      { id: 'finances', label: 'Finances', icon: 'finances', hint: 'The treasurer’s book' },
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
  news: 'News',
  finances: 'Finances',
  kit: 'The kit',
  history: 'History',
  world: 'The local game',
  match: 'Match',
};

/** Screens reached from a flow rather than the navigation. */
const OFF_NAV: ViewId[] = ['start', 'profile', 'select-club', 'create-club', 'match'];

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

/** The More sheet: every remaining destination, grouped, plus the utilities. */
export const MOBILE_MORE_SECTIONS: NavSection[] = NAV_SECTIONS.map((section) => ({
  ...section,
  direct: false,
  leaves: section.leaves.filter((leaf) => !MOBILE_PRIMARY.some((destination) => destination.id === leaf.id)),
})).filter((section) => section.leaves.length > 0);
