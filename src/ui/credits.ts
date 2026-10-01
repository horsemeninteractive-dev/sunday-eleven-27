/**
 * Who to thank.
 *
 * Kept as data rather than as markup so that the credits are a list of things
 * that are true — what the game is built with, where its world comes from, and
 * what it borrowed from the game it is plainly descended from — rather than a
 * screen of names typed once and never looked at again.
 */

export interface Credit {
  /** What this group did. */
  role: string;
  /** The thing or the people being credited. */
  names: string[];
  /** A line of context, where one is worth saying. */
  note?: string;
}

export const CREDITS_INTRO =
  'Sunday Eleven 27 is a Sunday league football management game: a whole world of local clubs, players with jobs and families, and a season that carries on whether you are watching it or not.';

export const CREDITS: Credit[] = [
  {
    role: 'Code, design and the football',
    names: ['Sunday Eleven 27'],
    note: 'Written as one project: the simulation, the calendar, the match engine, the writing and the interface.',
  },
  {
    role: 'Built with',
    names: ['React', 'TypeScript', 'Vite', 'Zustand'],
    note: 'The tools do their jobs and stay out of the way. Type is the machine you already have installed.',
  },
  {
    role: 'The world',
    names: ['Your seed'],
    note: 'Every club, player, ground, badge, pub and rivalry is generated from the seed on the save. None of them are real, and none of them existed before you started.',
  },
  {
    role: 'The interface',
    names: ['One wordmark', 'One icon set', 'One stripe'],
    note: 'One stroke weight, one grid, currentColor only. The icons were drawn for this game rather than borrowed from a library.',
  },
  {
    role: 'The ground behind the menu',
    names: ['A Sunday league pitch'],
    note: 'A photograph of grassroots football, washed into the game’s greens.',
  },
  {
    role: 'Debts',
    names: ['Football Manager', 'Championship Manager'],
    note: 'The idiom of the management game is theirs: the calendar, the attributes a scout will and will not tell you, and the sentence "it is your job to lose".',
  },
  {
    role: 'Everything on the pitch',
    names: ['Sunday league football'],
    note: 'Which is played by people with a hangover, a shift in the morning and a pitch that was never quite fit. That is the game this is trying to be about.',
  },
];

export const CREDITS_NOTE =
  'Any resemblance to a real club, player, referee, ground or pub is a coincidence of naming and nothing more.';
