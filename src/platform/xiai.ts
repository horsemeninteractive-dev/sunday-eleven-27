/**
 * XIAI: what the community's bot knows, and how it decides what a question is
 * about.
 *
 * The bot in the Discord server answers questions about the game, and it answers
 * them **from this repository rather than from a language model** — because the
 * thing being asked about is a game almost nobody has heard of, and a model asked
 * to explain it will invent mechanics in the tone of somebody who has played it
 * for years. Every answer here is a sentence the project has already written
 * down, with the file it came from next to it, so a wrong answer is traceable to
 * a doc rather than argued with. The matcher is a function of two strings; it is
 * tested in `src/platform/xiai.test.ts` and it needs no token, no service and no
 * network.
 *
 * What is deliberately *not* here:
 *
 *   - **no invented facts.** An entry exists because a document says it. Where
 *     the answer depends on something only the owner knows (a price that has not
 *     been set, a platform that has not shipped), the entry says that instead of
 *     guessing;
 *   - **no answer at all when the question is not recognised.** `answerFor`
 *     returns `null` and the bot tells the person to ask in `#general`. A bot
 *     that always answers is a bot that is sometimes wrong in public.
 *
 * The split is the same one the rest of `src/platform/` uses: this module decides
 * what an answer is, `tools/xiai.ts` is the part that talks to Discord.
 */

/** The entry a question with nothing to match on falls back to. */
export const HELP_FACT_ID = 'help';

export interface Fact {
  /** A stable name, so a test can name the answer it means. */
  id: string;
  /** The heading the bot prints above the answer. */
  title: string;
  /**
   * What a question about this looks like. A multi-word phrase scores higher
   * than a single word, so "how do promotions work" beats a stray "work".
   */
  triggers: readonly string[];
  /** The answer itself, ready to post. */
  body: string;
  /** Where it came from — a file, and the thing in it that says so. */
  source: string;
}

/**
 * The answers, in no particular order.
 *
 * They are written to be read in a chat window: short, no markup a Discord
 * message cannot render, and no link where the name of a file will do.
 */
export const KNOWLEDGE: readonly Fact[] = [
  {
    id: 'what-is-it',
    title: 'What is Sunday Eleven 27?',
    triggers: [
      'what is the game',
      'what is this game',
      'about the game',
      'what kind of game',
      'what is sunday eleven',
      'what is sunday eleven 27',
      // The project's own shorthand for itself, in the design document, the soak
      // reports and half the file names. It was the first question the bot was
      // ever asked in the server, and it did not know it — which is exactly why
      // the knowledge base is a file somebody can add a line to.
      'se27',
      'what does se27 mean',
    ],
    body: [
      'A Sunday league football management game. A whole county of local clubs, players with jobs and',
      'families, and a season that carries on whether you are watching it or not.',
      '',
      'You take charge of one club in a three-tier pyramid of 36 clubs. The season runs fortnightly from',
      'September, the cups take the Sundays in between, and a winter morning can take your fixture off you.',
      'Nothing waits for you: the world advances whether you are looking at it or not, and the inbox tells you',
      'what happened while you were away.',
    ].join('\n'),
    source: 'README.md — "What it is"',
  },
  {
    id: 'where-to-play',
    title: 'Where do I play it?',
    triggers: [
      'where do i play',
      'where can i play',
      'how do i play',
      'download',
      'download it',
      'browser',
      'how do i get the game',
      'link to the game',
      'website',
      'install',
    ],
    body: [
      'In a browser, at https://sundayeleven.pages.dev — no account, nothing to buy.',
      '',
      'It saves as you play and it installs for offline use: in Chrome or Edge, the install button in the',
      'address bar; on a phone, Share → Add to Home Screen. An installed copy keeps working with no signal,',
      'which is the point on a touchline.',
    ].join('\n'),
    source: 'README.md — the opening paragraph and "On a phone"',
  },
  {
    id: 'price',
    title: 'What does it cost?',
    triggers: ['how much', 'price', 'cost', 'buy', 'purchase', 'is it free', 'free', 'pay', 'paid', 'store', 'steam', 'steam price'],
    body: [
      'Nothing. It runs in the browser and there is no store release yet, so there is nothing to buy and no',
      'way to pay even if you wanted to.',
      '',
      'There is a Steam seam in the desktop build and no Steam release: no store page, no app record, no',
      'achievements configured. `STEAM.md` is honest about exactly how far that has got.',
    ].join('\n'),
    source: 'README.md; STEAM.md — the status block at the top',
  },
  {
    id: 'season-structure',
    title: 'How a season works',
    triggers: [
      'how long is a season',
      'season structure',
      'how does the season work',
      'how many games',
      'fixture list',
      'matchdays',
      'when is the season',
      'calendar',
    ],
    body: [
      'League matchdays are a fortnight apart, so a season lasts the year rather than finishing in February.',
      'Cup rounds are spread through it with the finals at the back.',
      '',
      'A season runs from September. December to February is where a winter morning can take a fixture off',
      'you, and the rearranged date goes in the calendar with the reason.',
    ].join('\n'),
    source: 'README.md — "A calendar, not a fixture list"',
  },
  {
    id: 'promotion',
    title: 'Promotion and relegation',
    triggers: [
      'promotion',
      'promotions',
      'promoted',
      'relegation',
      'relegated',
      'go up',
      'get promoted',
      'division',
      'divisions',
      'the ladder',
      'tiers',
      'pyramid',
    ],
    body: [
      'Three tiers of twelve, and the ladder reaches the top: the champions and the runners-up go up and the',
      'bottom two come down, with nothing above the top division to be promoted into — that is the county, and',
      'winning it is the end of the road.',
      '',
      'Every promotion and relegation is recorded, so a club carries its own ladder history: the screen for it',
      'is where the `promoted` records in the save live.',
    ].join('\n'),
    source: 'README.md — "What it is"; CHANGELOG.md — 0.10.1, "the ladder reaches the top"',
  },
  {
    id: 'cups',
    title: 'The cups',
    triggers: [
      'cup',
      'cups',
      'league cup',
      'the plate',
      'cup rounds',
      'knocked out',
      'wembley',
      'final',
      'cup run',
    ],
    body: [
      'Two cups that finish. The League Cup runs a preliminary of eight, a round of thirty-two, then down to a',
      'final; the Plate is fed from both opening rounds, so the sides that go out early get a competition of',
      'their own rather than an empty calendar.',
      '',
      'Every club plays at least twice before it can be knocked out.',
    ].join('\n'),
    source: 'README.md — "Two cups that finish"',
  },
  {
    id: 'postponements',
    title: 'Postponed matches',
    triggers: [
      'postponed',
      'postponement',
      'waterlogged',
      'rained off',
      'called off',
      'pitch',
      'weather',
      'abandoned',
    ],
    body: [
      'A waterlogged pitch is P-P: the fixture is off, the reason is recorded, and a rearranged date goes into',
      'the calendar. A fixture that cannot be placed three times is abandoned rather than shuffled around for',
      'ever.',
      '',
      'Pitch quality, drainage and the weather on the day are what decide it, so a club with a good surface',
      'and floodlights loses fewer Sundays.',
    ].join('\n'),
    source: 'README.md — "Postponements that mean something"',
  },
  {
    id: 'saves-where',
    title: 'Where a career is saved',
    triggers: [
      'where is my save',
      'saves',
      'save file',
      'saved game',
      'career file',
      'where are careers',
      'backup',
      'back up',
      'lost my save',
    ],
    body: [
      'In a browser it lives in the browser database for the game, and it saves as you play — there is no save',
      'button to forget.',
      '',
      'In the desktop application the careers are in `%APPDATA%\\Sunday Eleven 27`, and a copy you *export*',
      'goes to `Documents\\Sunday Eleven 27\\careers` as one file per career, named for the club and the',
      'in-game date. Uninstalling the desktop application does not touch either of them.',
    ].join('\n'),
    source: 'DESKTOP.md — "Careers, exports and Steam"',
  },
  {
    id: 'move-a-career',
    title: 'Moving a career between devices',
    triggers: [
      'move a career',
      // `transfer a save` used to be here, and it was the wrong kind of generous:
      // a trigger's *words* are what match, so `transfer` alone was enough, and
      // "is there a transfer window" was answered with how to move a career
      // between machines. A question about transfers is better refused than
      // answered with something else, so the word is gone and the question it
      // was standing in for still works through `save`.
      'move a save',
      'another device',
      'switch device',
      'export',
      'import',
      'share a save',
      'send a save',
      'backup file',
    ],
    body: [
      'Export it from the game and import it on the other machine. The export is a `se27.career` file — one',
      'file, the whole state of the world — and it is the same format everywhere: a career exported on a',
      'desktop imports in the browser build, and the other way round.',
      '',
      'That file is also the thing to attach to a bug report when a career misbehaves, because it is all of it.',
    ].join('\n'),
    source: 'DESKTOP.md; STEAM.md — "The game\'s careers are not files" (the export format)',
  },
  {
    id: 'determinism',
    title: 'Is it random? Seeds, and the same county twice',
    triggers: ['seed', 'seeds', 'random', 'rng', 'same world', 'deterministic', 'roll a new world', 'generate a world'],
    body: [
      'The world is generated from a seed, and the simulation is deterministic: a seed produces the same county',
      'every time, and a save carries that seed forward. A season simulated twice from the same seed is the',
      'same season.',
      '',
      'That is also why a bug report with the seed in it is worth more than a description.',
    ].join('\n'),
    source: 'README.md — "How it is put together"',
  },
  {
    id: 'world-continues',
    title: 'Does the world wait for me?',
    triggers: [
      'does the world continue',
      'while i am away',
      'world advances',
      'simulate',
      'leave it running',
      'idle',
      'other clubs',
      'inbox',
      'notifications',
    ],
    body: [
      'No. The world advances whether you are looking at it or not, and the inbox tells you what happened',
      'while you were away — results, news, and the things a chairman has an opinion about.',
      '',
      'You can play a fixture or let it pass; the rest of the county plays either way.',
    ].join('\n'),
    source: 'README.md — "What it is" and "The world continues without the player"',
  },
  {
    id: 'match-modes',
    title: 'Why other matches are quick',
    triggers: [
      'other matches',
      'background simulation',
      'why is it fast',
      'performance',
      'slow',
      'lag',
      'two modes',
      'full engine',
      'lightweight',
    ],
    body: [
      'Your own match runs on the full engine — the spatial simulation you watch, about 24,000 lines of it',
      'simulating one clock. Every other game of the matchday, and every other club\'s season, runs through a',
      'lightweight background mode that writes the same result, the same goalscorers and the same player',
      'record without moving anybody or drawing anything.',
      '',
      'A whole division\'s Sunday costs a few tens of milliseconds that way rather than a minute.',
    ].join('\n'),
    source: 'README.md — "A match engine worth looking at"; MATCH_ENGINE.md — the two modes',
  },
  {
    id: 'replay',
    title: 'Watching a match again',
    triggers: [
      'replay',
      'watch again',
      'watch a match',
      'watch the match',
      'match again',
      'watch back',
      'highlights',
      'rewind',
    ],
    body: [
      'A match you have played can be watched back through the game\'s own view, and it reveals the record only',
      'as its time comes: the ball is where it was at that moment, not where it ended up.',
      '',
      'The replay is not a recording — it is what the engine already decided, read back.',
    ].join('\n'),
    source: 'src/presentation/matchReplay.test.ts — "watching a replay reveals the record only as its time comes"',
  },
  {
    id: 'what-you-manage',
    title: 'What you actually manage',
    triggers: [
      'what can i manage',
      'features',
      'what is in the game',
      'squad',
      'tactics',
      'training',
      'recruitment',
      'transfers',
      'signings',
      'wages',
      'kit',
      'badge',
    ],
    body: [
      'The squad and the team you pick, tactics, training, the staff you bring in, recruitment, the club\'s',
      'finances and its sponsors, the ground, the inbox, the league and cup tables, the county around you, the',
      'history of every club, and the kit and badge you play in.',
      '',
      'There is no universally optimal tactic, which is a design rule rather than a claim about your squad.',
    ].join('\n'),
    source: 'README.md — the feature list; SE27_Design_Document.md — the design pillars',
  },
  {
    id: 'phone',
    title: 'Playing on a phone',
    triggers: ['phone', 'android', 'mobile', 'tablet', 'ios', 'iphone', 'play store', 'apk', 'on my phone'],
    body: [
      'The same game, packaged for Android, and it runs entirely on the device: no connection, nothing fetched',
      'from the site, and the football, the rules and the save format are the same code as everything else.',
      '',
      'iOS is documented in `IOS.md` and has not shipped — it needs a Mac, an Apple account and Apple\'s own',
      'steps, none of which have been done.',
    ].join('\n'),
    source: 'ANDROID.md; IOS.md; README.md — "On a phone"',
  },
  {
    id: 'desktop',
    title: 'Playing on a desktop',
    triggers: [
      'desktop',
      'windows',
      'installer',
      'exe',
      'mac',
      'linux',
      'steam deck',
      'app',
      'offline',
    ],
    body: [
      'There is a Windows application — an installer, an entry in the Start menu, and the game bundled inside',
      'it rather than loaded from the website, so an installed copy cannot become a bookmark showing whatever',
      'was deployed last. It keeps working with no signal.',
      '',
      'Windows is the only platform it is packaged for. Nothing has been built for Mac, Linux or the Steam',
      'Deck, and `DESKTOP.md` says what has and has not been verified there.',
    ].join('\n'),
    source: 'DESKTOP.md — the architecture; README.md — "On a desktop"',
  },
  {
    id: 'controllers',
    title: 'Gamepad and Steam Deck support',
    triggers: [
      'controller',
      'controllers',
      'gamepad',
      'joypad',
      'steam deck verified',
      'handheld',
      'touch controls',
      'keyboard',
    ],
    body: [
      'No gamepad support, and no Steam Deck Verified claim: keyboard and mouse in the browser and on a',
      'desktop, touch on a phone and tablet. The simulation itself is input-agnostic — it is the interface that',
      'has no controller path.',
      '',
      'The smallest window the game presents is 1024×700, which does fit a Deck\'s screen; that is a',
      'resolution fact and not a comfort claim.',
    ].join('\n'),
    source: 'STEAM.md — "Steam Deck and controller"',
  },
  {
    id: 'real-clubs',
    title: 'Are these real clubs?',
    triggers: [
      'real clubs',
      'real teams',
      'real players',
      'real league',
      'licensed',
      'premier league',
      'real football league',
      'accurate',
    ],
    body: [
      'No. Every club, player and town in the game is generated from a seed. There are no real leagues, clubs',
      'or competitions in it, and nothing is licensed because nothing is real.',
    ].join('\n'),
    source: 'README.md — "Licence"',
  },
  {
    id: 'multiplayer',
    title: 'Multiplayer',
    triggers: ['multiplayer', 'online', 'play with friends', 'co-op', 'against other players', 'pvp', 'server'],
    body: [
      'There is none, and it is not an oversight: the whole world is simulated on your own machine, which is',
      'what makes the game work offline and what stops a season depending on a server being up.',
      '',
      'Every club in the county except yours is run by the game itself.',
    ].join('\n'),
    source: 'README.md — the offline-first packaging; DESKTOP.md — "no server.url"',
  },
  {
    id: 'version',
    title: 'Which version am I playing?',
    triggers: ['version', 'which version', 'update', 'updated', 'new version', 'changelog', 'what is new', 'whats new'],
    body: [
      'The number is on the main menu, and so is the changelog — the same file the project writes releases',
      'into, reachable from the menu rather than posted somewhere you have to find.',
      '',
      'An installed copy updates itself when the browser or the application fetches the new build; the number',
      'on the menu is the one you are actually running.',
    ].join('\n'),
    source: 'CHANGELOG.md — the header; README.md — "It is also the changelog inside the game"',
  },
  {
    id: 'bug',
    title: 'Reporting a bug',
    triggers: [
      'bug',
      'bugs',
      'crash',
      'crashed',
      'broken',
      'error',
      'report',
      'does not work',
      'doesnt work',
      'stuck',
      'freeze',
      'frozen',
      // The phrases that include the word "game" on purpose: "my game crashed"
      // must beat the entry that answers "what is the game", and a phrase that
      // names both words outranks the lone one every time.
      'game crashed',
      'game broke',
      'game broken',
      'game stuck',
      'not loading',
      'wont load',
      'will not load',
    ],
    body: [
      'Post it in `#bug-reports` with the template: what you did, what you expected, what happened instead,',
      'how often, the version from the menu, and whether you were carrying on from a save or starting fresh.',
      '',
      'Two things raise a report above the others: the seed, and an exported career attached to the message —',
      'that file is the whole state of the world, so a save that will not load can be looked at rather than',
      'guessed at.',
    ].join('\n'),
    source: 'The server\'s own `#bug-reports` pinned post (src/platform/discord.ts)',
  },
  {
    id: 'ideas',
    title: 'Suggesting something',
    triggers: ['suggestion', 'suggest', 'idea', 'ideas', 'feature request', 'request a feature', 'would be better', 'feedback'],
    body: [
      '`#ideas` is the place, and it is kept apart from `#bug-reports` on purpose: "this is broken" and "this',
      'could be better" want different answers, and mixing them buries the bugs.',
      '',
      'Saying why it would make the game better is worth more than the idea by itself.',
    ].join('\n'),
    source: 'The server\'s own `#ideas` channel topic (src/platform/discord.ts)',
  },
  {
    id: 'playtesting',
    title: 'Playtesting early builds',
    triggers: ['playtest', 'playtester', 'beta', 'early build', 'test build', 'tester', 'get it early'],
    body: [
      'Ask for the `@Playtester` role and you get `#playtesting` — builds before they are public, and what to',
      'look for in them. The serious one is a save that will not load: say so immediately, and attach the',
      'exported career.',
      '',
      'Saying a build feels worse than the last one is welcome too. That is a bug report about the football.',
    ].join('\n'),
    source: 'The server\'s own `#playtesting` pinned post (src/platform/discord.ts)',
  },
  {
    id: 'cup-draws',
    title: 'A level cup tie',
    triggers: [
      'draw',
      'a draw in the cup',
      'cup tie level',
      'level after ninety',
      'extra time',
      'penalties',
      'penalty shootout',
      'shootout',
      'spot kicks',
      'sudden death',
    ],
    body: [
      'A knockout tie that is level after ninety minutes is not decided by which dressing room it was played',
      'in. Extra time is played — the two fifteen-minute periods the clock model was always built for — and if',
      'it is still level there is a shootout: five kicks each, taken by the men on the pitch, then sudden death',
      'until one side misses.',
      '',
      'The winner is written onto the match and into the result\'s penalty score, so the cup reads who actually',
      'went through.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.5.0, "A level cup tie is settled on the pitch"',
  },
  {
    id: 'cards-and-injuries',
    title: 'Sending offs and injuries',
    triggers: [
      'red card',
      'yellow card',
      'second yellow',
      'sent off',
      'sending off',
      'booked',
      'booking',
      'injury',
      'injured',
      'injuries',
      'hamstring',
      'how long is he out',
      'suspension',
      'suspended',
    ],
    body: [
      'A second yellow is a sending off, and so is a straight red. A sent-off man keeps his place on the team',
      'sheet — the ten who remain keep their shape — but he plays no part: his side is down to ten and weaker',
      'for losing him, and he cannot be replaced.',
      '',
      'A match can also hurt a man. Tired legs on a bad pitch turn an ankle or pull a hamstring, and the injury is',
      'written onto his record, where the season turns it into time out — so the manager hears about it the way he',
      'hears about a card. A man who cannot run it off comes off at the next chance, whoever he is and whatever',
      'the minute, and the best-placed substitute takes his job.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.5.0, "Men leave the pitch: cards and injuries"',
  },
  {
    id: 'the-committee',
    title: 'Who runs the club',
    triggers: [
      'committee',
      'chairman',
      'secretary',
      'who runs the club',
      'who owns the club',
      'the board',
      'the people who run the club',
      'who do i answer to',
    ],
    body: [
      'The club is run by people rather than by a screen: a committee — a chairman, a secretary and the rest —',
      'each with a name, an expectation of the club and things he is worried about. The Staff screen\'s *The',
      'chairman* panel says who he is, what he expects, what is troubling him, and the matters of record.',
      '',
      'The manager can talk to them, and what he says is a conversation: a reply arrives in the inbox as a',
      'message. A message only ever *acts* where the manager has decided something, so nothing about the club',
      'changes by talking alone.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.7.0, "The committee is made of people"; "The manager can talk to the people who run the club"',
  },
  {
    id: 'club-money',
    title: 'Where the money comes from and goes',
    triggers: [
      'money',
      'finances',
      'bank balance',
      'balance',
      'in the red',
      'ledger',
      'weekly costs',
      'running costs',
      'heading for',
      'where does the money come from',
    ],
    body: [
      'Money is a ledger of dated lines, and the books are the only authority on it: a sponsor\'s instalment, a',
      'match\'s subs, a night\'s takings are each one line, written once and dated.',
      '',
      'The outgoings come round every seven days — pitch hire, insurance and the hall — which is why the weeks',
      'left are counted in weeks rather than in matchdays. The Finances screen also carries a *heading for*',
      'figure: the balance carried forward at the club\'s weekly rate to the end of the season. That is a run',
      'rate and it is labelled as one — a cup run, the subs still to be collected and the equipment kitty are',
      'outside it, because none of them is money the club is due on a schedule.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.6.0, "The weeks left, in weeks"; the Finances screen',
  },
  {
    id: 'sponsorship',
    title: 'How a sponsor works',
    triggers: [
      'sponsor',
      'sponsors',
      'sponsorship',
      'sponsor deal',
      'get a sponsor',
      'renewal',
      'backing',
      'a business backing the club',
    ],
    body: [
      'A sponsor is a business that already exists in the world — the same pub, builder or garage a club is named',
      'after — and the deal is real: the club, the start and end dates, the instalment, its terms, and the',
      'sponsor\'s own goodwill toward the club. It runs a lifecycle: the club looks, an offer is accepted, the',
      'deal goes active and pays, it comes up for renewal at the end of its term, and it can lapse or be replaced.',
      'A club can go without one until it finds another.',
      '',
      'Every instalment is **one ledger line**, dated by the agreement and keyed to it, so a day is never paid',
      'twice. A business brings its own cadence with it: a pub, a café or a butcher pays on the Friday, a builder,',
      'garage or plumber on the 28th of the month. A missed payment dents the sponsor\'s goodwill and, if it keeps',
      'happening, ends the deal — and the finances screen shows the current sponsor, the income, the renewal date',
      'and any one pressing issue.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.7.0, "A sponsor is somebody, not a number"; 0.6.0, "A sponsor can pay by the month"',
  },
  {
    id: 'subs-and-match-costs',
    title: 'Subs, and what a match costs a man',
    triggers: [
      'subs',
      'subs money',
      'match fee',
      'match fees',
      'player subs',
      'who pays the players',
      'unused substitute',
      'money from a match',
    ],
    body: [
      'Player subs are a matchday liability rather than a weekly squad tax. A man is charged for the match he',
      'actually played, taken from the match engine\'s own participation record: a starter pays the full starter',
      'rate, a substitute who came on pays the reduced rate, and an unused substitute, an unselected player or an',
      'unavailable one pays nothing. Squad membership on its own creates no debt.',
      '',
      'Each match raises its own liability against the man who played it, so a player can owe from several games',
      'at once and the club can always say which. A payment settles the oldest outstanding debt first and the',
      'history stays. The two rates belong to the club — £5 and £3 by default.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.7.0, "Matchday subs, not a weekly squad tax"',
  },
  {
    id: 'staff-roles',
    title: 'The people at the club',
    triggers: [
      'staff',
      'staff screen',
      'physio',
      'scout',
      'assistant',
      'coach',
      'treasurer',
      'volunteer',
      'who works at the club',
      'what do the staff do',
      'do i need a coach',
    ],
    body: [
      'The club\'s week is run by people in real roles rather than by a list of words: an assistant, a coach, a',
      'physio, a secretary, a treasurer, a scout and a volunteer, each an ordinary person with his own name, age,',
      'day job and reputation. Clubs are staffed *plausibly* rather than professionally — a Sunday club might have',
      'a secretary and nothing else, a bigger one a physio and a scout — and one man can hold two roles: the',
      'chairman who keeps the books, or the secretary who turns out at right back. A player-manager is the same',
      'person on the pitch and in the dugout, never a duplicate record.',
      '',
      'They change what happens in the week. A coach who is around takes Thursday night\'s session, and the',
      'assistant covers when he cannot. A physio improves fitness and gives an estimate of how long a knock will',
      'keep somebody out — closer and more confident the better he is — though he does not touch the injury',
      'itself, so a ten-day injury is ten days wherever the man plays. A scout goes and watches somebody and',
      'reports through the same recruitment knowledge as every other source, landing on the candidate list you',
      'already use: a better scout travels further, watches more often, and comes back with a fuller, truer read.',
      '',
      'Anyone can be unavailable on a given week — a shift, a holiday, a family do — and being a man down never',
      'removes the role or stops the club: it makes the week a little harder. The committee turns over with the',
      'seasons, a few men stepping down or retiring, and the posts they leave behind are filled from the town.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.7.0, "The committee is made of people", "The committee now changes the football"',
  },
  {
    id: 'the-summer',
    title: 'Where each summer\'s squad comes from',
    triggers: [
      'youth intake',
      'summer signings',
      'signings',
      'new players',
      'where do players come from',
      'squad changes',
      'journeyman',
      'why is my squad worse',
    ],
    body: [
      'Every summer brings a club its signings, its youth intake and a journeyman top-up, and all three are',
      'generated against the level the club plays at — read from its standing rather than from the squad it',
      'happens to have. So a club never signs a man better than the club itself is: a side below its standard can',
      'climb back to it, and a side above it cannot keep climbing, because there is nothing above the standard to',
      'sign.',
      '',
      'An arrival is **one player, not an average**. He draws the same roll of the dice the rest of the squad was',
      'drawn with, so the squad that leaves the summer has the spread of the one that was generated — which is',
      'what stops a county ratcheting itself upward season after season while nobody is at the controls.',
    ].join('\n'),
    source: 'CHANGELOG.md — 0.8.0, "an arrival was better than the club it joined"',
  },
  {
    id: HELP_FACT_ID,
    title: 'What XIAI can answer',
    // A greeting has no words to match on at all, so the entry that answers
    // "what can you do" is also what `answerFor` falls back to — see the
    // no-content-words branch below.
    triggers: ['help', 'what can i ask', 'commands', 'how do i use this'],
    body: [
      'Ask about the game and I will answer from what the project has written down: how a season, the cups,',
      'promotion and relegation work; where a career is saved and how to move it between machines; what runs',
      'on a phone, a desktop and in a browser; what is and is not built yet.',
      '',
      'I do not invent mechanics. If I do not know, I will say so, and `#general` is where a person will.',
    ].join('\n'),
    source: 'src/platform/xiai.ts — this module, and the point of it',
  },
];

/**
 * Words that carry no meaning in a question, and never score on their own.
 *
 * A greeting is in this list on purpose: "hi" is a word this bot ignores, so a
 * question made only of words like it falls through to the help entry rather than
 * to a refusal.
 */
const STOPWORDS = new Set([
  'hey', 'hi', 'hello', 'yo',
  'a', 'about', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'get', 'got', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no',
  'not', 'of', 'on', 'or', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'this', 'to', 'up',
  'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
]);

/** A question, as the words worth matching on. Exported so the bot can show its work. */
export function terms(question: string): string[] {
  return question
    .toLowerCase()
    // Apostrophes are dropped rather than kept: "don't work" and "doesnt work"
    // have to be the same words, or half of what people actually type misses.
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

export interface Answer {
  fact: Fact;
  /** How well it matched, for a test to hold the ordering down and the bot to be quiet about. */
  score: number;
  /** The words of the question that did the matching. */
  matched: string[];
}

/**
 * A phrase or a question as plain words, stopwords included, for the phrase test.
 *
 * This is the only place the words a question is *made of* matter rather than the
 * words worth matching on: whether somebody said "what is the game" or "my game
 * crashed" is exactly the difference the stopwords hide.
 */
function rawWords(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter((word) => word !== '');
  return ` ${words.join(' ')} `;
}

/**
 * How many answers list each word, which is all "common" means here.
 *
 * Counted per *answer* rather than per trigger, so an answer that happens to say
 * `cup` in three different ways is not three times as common as one that says it
 * once: the number is about how many things the word could be about.
 */
function wordCounts(facts: readonly Fact[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fact of facts) {
    const seen = new Set<string>();
    for (const trigger of fact.triggers) for (const word of terms(trigger)) seen.add(word);
    for (const word of seen) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

/**
 * A word reduced to the part its own family has in common: `saves` and `save`
 * are the same word, and so are `matches` and `match`.
 *
 * This is the whole of the stemming, and it is deliberately this small. A real
 * stemmer — Porter, Lancaster — is a large amount of code and a set of rules
 * nobody can hold in their head, and what it buys over this is the long tail of
 * English. What the questions in this server actually look like is a plural or a
 * participle: people ask about **cups**, about **saves**, about **postponed**
 * fixtures. Those are the rules below, and nothing else is guessed at.
 *
 * Both sides of a comparison are stemmed the same way, so a rule only has to be
 * *consistent* to help — `saves` reducing to `sav` is fine, because `save`
 * reduces to `sav` too.
 */
export function stemmed(word: string): string {
  if (word.length <= 3) return word;
  let stem = word;
  if (stem.endsWith('ies') && stem.length > 4) stem = `${stem.slice(0, -3)}y`;
  else if (stem.endsWith('sses')) stem = stem.slice(0, -2);
  else if (/(?:ch|sh|x|z|s)es$/.test(stem)) stem = stem.slice(0, -2);
  else if (stem.endsWith('s') && !stem.endsWith('ss')) stem = stem.slice(0, -1);
  if (stem.endsWith('ing') && stem.length > 5) stem = stem.slice(0, -3);
  else if (stem.endsWith('ed') && stem.length > 4) stem = stem.slice(0, -2);
  if (stem.endsWith('e') && stem.length > 3) stem = stem.slice(0, -1);
  return stem;
}

/**
 * How many single-character edits turn one word into another.
 *
 * Plain Levenshtein, plus the one insertion people actually make: a pair of
 * letters the wrong way round — `wrok` for `work` — counts as one edit rather
 * than two, because that is how it was typed. The whole table is computed; the
 * words here are at most twenty characters and there are only ever a handful.
 */
function edits(a: string, b: string): number {
  let above: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
  const before: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(above[j]! + 1, row[j - 1]! + 1, above[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (before[j - 2] ?? Number.POSITIVE_INFINITY) + 1);
      }
      row.push(value);
    }
    before.length = 0;
    before.push(...above);
    above = row;
  }
  return above[b.length]!;
}

/**
 * Whether a word the knowledge base is looking for, and a word somebody typed,
 * are the same word.
 *
 * Three ways to be the same word, and the third one is where the care is:
 *
 *   1. **exactly the same** — the case the matcher has always handled;
 *   2. **the same word, folded** — a plural or a participle of it. A question
 *      that asks about "seasons" is asking about the season;
 *   3. **one slip of the fingers.** The forgiving rule, and the one that needed
 *      thinking about, because one edit away is very close indeed in a short
 *      word: `spare` is one letter from `share`, `team` is one from `term`,
 *      `steam` and `tear`, and `2027` is one digit from `2026` — so a question
 *      about a spare ticket would be answered with how to share a career file,
 *      which is exactly the kind of confident nonsense this bot exists not to
 *      do. So a swapped pair of letters is forgiven from four letters up (`wrok`
 *      is `work`, and a transposition is very rarely another word), and any
 *      other single edit only from six letters up, in words that are nothing but
 *      letters. `promoton` and `relegaton` are still caught; `spare` is not
 *      offered up as `share`; and no number is ever treated as another number.
 */
export function sameWord(wanted: string, asked: string): boolean {
  if (wanted === asked) return true;
  if (stemmed(wanted) === stemmed(asked)) return true;
  if (!/^[a-z]+$/.test(wanted) || !/^[a-z]+$/.test(asked)) return false;
  if (swapped(wanted, asked)) return true;
  if (wanted.length < 6 || asked.length < 6) return false;
  return edits(wanted, asked) <= 1;
}

/**
 * Whether the only difference is two letters the wrong way round — `wrok` for
 * `work`, which is one slip at a keyboard but two edits to Levenshtein.
 */
function swapped(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 4) return false;
  const differs: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differs.push(i);
  const [first, second] = differs;
  return (
    differs.length === 2 &&
    first !== undefined &&
    second === first + 1 &&
    a[first] === b[second] &&
    a[second] === b[first]
  );
}

/**
 * The best answer for a question, or `null` when nothing matches at all.
 *
 * The bar is deliberately low — one recognisable word is enough, because a bot
 * that refuses "how does the cup work" is worse than one that occasionally
 * answers a stray mention of a cup — and the sorting is what keeps that safe:
 * a phrase beats a word, and more matched words beats fewer. Where a question
 * genuinely could be about two things, the longer and more specific match wins.
 *
 * `null` therefore means what it says: none of the words in the question are
 * words this bot knows, and `UNKNOWN` — ask in `#general` — is the honest answer.
 *
 * The one exception is a question with no content words at all — "hi", "what can
 * you do" — where every word is a word this bot ignores. That is not a question
 * it does not understand but a person who has not asked yet, so it gets the help
 * entry rather than a refusal.
 */
export function answerFor(question: string, facts: readonly Fact[] = KNOWLEDGE): Answer | null {
  const words = terms(question);
  if (words.length === 0) {
    const help = facts.find((fact) => fact.id === HELP_FACT_ID);
    return help ? { fact: help, score: 0, matched: [] } : null;
  }
  const asked = rawWords(question);
  const counts = wordCounts(facts);
  let best: Answer | null = null;

  for (const fact of facts) {
    for (const trigger of fact.triggers) {
      const wanted = terms(trigger);
      // A trigger made only of words the matcher ignores could never fire, so it
      // is skipped rather than scored: the knowledge base's own test is what
      // stops one being written in the first place.
      if (wanted.length === 0) continue;
      // A word has to appear as a word: "cup" must not match "cupboard". What
      // counts as the same word is `sameWord`'s business above — itself, a plural
      // or participle of itself, or one slip of the fingers in a long enough word.
      const matched = wanted.filter((word) => words.some((typed) => sameWord(word, typed)));
      if (matched.length === 0) continue;
      // How rare the words are, plus a point for the trigger appearing as the
      // phrase it is written as. **The best trigger decides, not the total:** an
      // answer with six ways of being asked is not six times better than one
      // accurate way, and adding them up is what makes a bot answer "can i play
      // on my phone" with where to play instead of the phone.
      const rarity = matched.reduce((total, word) => total + 1 / (counts.get(word) ?? 1), 0);
      // A word that is really there is worth slightly more than one that had to
      // be forgiven a typo, so an exact answer never loses to a near one.
      const exact = matched.filter((word) => words.includes(word)).length;
      const score = rarity + exact * 0.25 + (asked.includes(rawWords(trigger)) ? 1 : 0);
      // The first fact wins a tie, so the same question always gets the same
      // answer — a bot that answers differently on Tuesday is a bot nobody trusts.
      if (best === null || score > best.score) best = { fact, score, matched };
    }
  }

  return best;
}

/** What the bot says when it does not recognise the question. */
export const UNKNOWN = [
  'I do not know that one, and I would rather say so than guess.',
  '',
  'Try me on the season, the cups, promotion and relegation, saves and moving a career, a phone or a',
  'desktop, or what is not built yet — and if it is a person you need, `#general` has them.',
].join('\n');

/** The help text, which is also the description of the `/ask` command. */
export const HELP =
  'Ask about the game: the season, cups, saves, platforms and what is not built yet.';

/**
 * The two commands, named once.
 *
 * `ask` is the slash command and `Ask XIAI` is the entry in a message's
 * right-click menu. Both names are checked against Discord's own rules by the
 * tests, because a name Discord will not accept fails at registration time,
 * which is a long way from the line that wrote it.
 */
export const ASK_COMMAND = 'ask';
export const MESSAGE_COMMAND = 'Ask XIAI';

/**
 * One answer, as the message Discord is sent.
 *
 * The source line is Discord subtext (`-#`), so it is readable but quiet: the
 * point of printing where an answer came from is that a wrong one can be traced
 * to a document, not that it should compete with the answer for attention.
 */
export function answerText(fact: Fact): string {
  return `**${fact.title}**\n\n${fact.body}\n\n-# ${fact.source}`;
}

/** The fact a name refers to, for the `/ask` topic picker and for a vote. */
export function factById(id: string, facts: readonly Fact[] = KNOWLEDGE): Fact | null {
  return facts.find((fact) => fact.id === id) ?? null;
}

export interface Reply {
  /** What Discord is sent. */
  content: string;
  /** The fact that answered, for the log; `null` when the knowledge base said no. */
  fact: string | null;
}

/**
 * What to send back for a question.
 *
 * Shared by the command line and by the endpoint in the cloud, so an answer can
 * never be worded one way on a laptop and another way in the server — which is
 * the kind of drift nobody notices until somebody posts two screenshots.
 */
export function replyFor(question: string): Reply {
  const answer = answerFor(question);
  if (!answer) return { content: UNKNOWN, fact: null };
  return { content: answerText(answer.fact), fact: answer.fact.id };
}

/**
 * The `/ask` topic picker: which answers it offers, in the order it offers them.
 *
 * The membership is chosen here and the wording is not: a topic's label is the
 * answer's own title, so a menu entry can never describe something different from
 * what it answers with. Membership is deliberately *not* derived from every fact,
 * for two reasons — Discord refuses a command with more than 25 choices, and a
 * menu of thirty entries is a wall. The four that decide where something belongs
 * (`#bug-reports`, `#ideas`, playtesting) and the one that answers "what can you
 * answer" are the ones left out; they are answers to a sentence somebody has
 * already started, not topics anybody browses.
 */
export const PICKER: readonly string[] = [
  'what-is-it',
  'where-to-play',
  'price',
  'season-structure',
  'promotion',
  'cups',
  'cup-draws',
  'cards-and-injuries',
  'postponements',
  'what-you-manage',
  'the-committee',
  'staff-roles',
  'club-money',
  'sponsorship',
  'subs-and-match-costs',
  'saves-where',
  'move-a-career',
  'determinism',
  'world-continues',
  'match-modes',
  'phone',
  'desktop',
  'version',
];

export const TOPICS: ReadonlyArray<{ name: string; factId: string }> = PICKER.flatMap((id) => {
  const fact = factById(id);
  return fact ? [{ name: fact.title.slice(0, 100), factId: fact.id }] : [];
});

/** Which way a manager voted on an answer. */
export type Vote = 'up' | 'down';

/**
 * The buttons' shared id, which is how a click finds the answer it belongs to.
 *
 * It carries the fact's name rather than the question: a button outlives the
 * message that carried it (Discord keeps components clickable for as long as the
 * message is there), so the id has to say what was being rated — and nothing
 * about the person who asked.
 */
const VOTE_PREFIX = 'xiai:vote:1:';

export function voteCustomId(vote: Vote, factId: string): string {
  return `${VOTE_PREFIX}${vote}:${factId}`;
}

/** The vote an id names, or `null` when the id is not one of ours. */
export function parseVote(customId: string): { vote: Vote; factId: string } | null {
  if (!customId.startsWith(VOTE_PREFIX)) return null;
  const rest = customId.slice(VOTE_PREFIX.length);
  const at = rest.indexOf(':');
  if (at <= 0) return null;
  const vote = rest.slice(0, at);
  const factId = rest.slice(at + 1);
  if ((vote !== 'up' && vote !== 'down') || factId === '') return null;
  return { vote, factId };
}
