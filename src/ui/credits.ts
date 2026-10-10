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
    role: 'The photograph on the Home fixture',
    names: ['Sebastian Ballard, via Geograph (CC BY-SA 2.0)'],
    note: 'Community football pitch at Prospect Park, Reading, photographed on a Sunday morning after the games. Resized and compressed for the game; otherwise unaltered.',
  },
  {
    role: 'The photograph on the Training screen',
    names: ['Santeri Viinamäki (CC BY-SA 4.0)'],
    note: 'A goal on a training football field. Resized and compressed for the game; otherwise unaltered.',
  },
  {
    role: 'The photographs on the Cup, Fixtures and Club screens',
    names: [
      'philosophyfootball, FA Cup trophy (CC BY 2.0)',
      'Anthony O’Neil, via Geograph, football stadium (CC BY-SA 2.0)',
      'Bienvenue Tognon, football players (CC BY-SA 4.0)',
    ],
    note: 'Resized and compressed for the game; otherwise unaltered. The Cup photograph shows a professional final, used here for its trophy rather than its match.',
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

/**
 * Touchline, described in one line and one paragraph.
 *
 * Touchline is the football simulation this game is built on: one match engine,
 * one set of laws, and one record that everything downstream — the table, the
 * cup, the finances, the record books — reads instead of reading the simulation
 * itself. It is this project's own code.
 *
 * The wording is deliberately narrow, and it has to stay true: Touchline is not
 * a third-party engine, not middleware, not a physics engine and not a model
 * trained on anything at all. So nothing here says it is, and nothing here
 * promises a capability the game does not have.
 *
 * This is the only place the simulation is *described* rather than named. The
 * first boot introduces it, the game itself never mentions it, and a manager
 * could play a hundred seasons without needing to know that it has a name.
 */
export const TOUCHLINE_TAGLINE = 'Authoritative Football Simulation System';

export const TOUCHLINE_NOTE =
  'Touchline is Sunday Eleven 27’s own football simulation: the engine that plays a fixture, the laws it is played under, and the record the rest of the game reads. Written for this game rather than licensed into it.';

export const CREDITS_NOTE =
  'Any resemblance to a real club, player, referee, ground or pub is a coincidence of naming and nothing more.';
