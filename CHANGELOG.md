# Changelog

All notable changes to Sunday Eleven 27 are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [semantic versioning](https://semver.org/spec/v2.0.0.html).

The game is a **beta**: while the version starts with `0`, features arrive in
the minor number, fixes in the patch, and the save format is still allowed to
move (any save from an older build is migrated forward on load). `1.0.0` means
it is finished. This file is also the changelog inside the game, reachable from
the main menu.

## [0.1.0] - 2026-10-01 — first beta

The first build worth playing a season in: a generated Sunday league world, a
calendar that runs continuously, a match engine that plays it out, and a
management game wrapped around both.

### The world

- **Procedural Sunday league England.** One seed generates the towns, the
  grounds, the clubs, their histories, their rivalries and every player in them;
  the same seed always makes the same world.
- **Fourteen clubs a division**, with reputations, finances, squads, kits,
  badges, grounds and standing that follow from the names on the sign.
- **Players with lives outside the game.** Jobs, families, transport, hangovers,
  injuries, doubts and disappearances — availability is a rumour rather than a
  number, and a Sunday morning can take a man out of the side.
- **Relationships.** Players know each other: brothers, old teammates, grudges,
  neighbours, and the local game that gossips about all of it.
- **A local ecosystem of gossip, news and social media**, written from what the
  simulation actually did rather than from templates alone.

### Managing

- **Two ways in**: take over a club that already exists, or build your own —
  name, badge, kit, ground, standing — and take the weakest club's place.
- **A manager of your own**: name, age, birthday, day job, hometown, and it is
  remembered so a new career does not ask twice.
- **Training is a week, not a button.** Plans, blocks, venues, turnout,
  development, familiarity and cohesion, on the Thursday the league trains.
- **Tactics**, team selection, positional suitability, and a squad that reacts
  to what you say to it.
- **Recruitment**: recommendations, open sessions, five-a-side scouting, trials,
  negotiations and registration, in a world where players say no.
- **Money**: income, expenses, fundraising, sponsorship and a bank balance that
  punishes a squad you cannot afford.
- **Finances, history, world, news and squad screens**, with the whole world
  simulated whether or not it is being watched.

### Matchday

- **Matchday is a day, not a mode.** The calendar is the clock: the day arrives,
  you prepare, the whistle starts it, half time stops it, full time gives the
  week back, and the calendar carries on.
- **A dressing room before kick-off**: the fixture, the weather, the pitch, the
  officials, an impression of the opposition, selection warnings, a team talk
  and a warm-up.
- **A live match screen that fits the viewport and never scrolls**: score and
  clock, the pitch, a bounded live commentary feed whose newest line is always in
  view, live statistics, and controls always in reach.
- **Half time as a real fifteen minutes** — what happened, who is running on
  empty, the full statistics and a second team talk — with substitutions and
  shape changes without leaving the match.
- **Full time as a decision**: the result, the goals, the bookings, how every man
  played, the statistics, and the last word you choose to say to them. It lands
  on each of them differently, and what you are told back is how it landed, not
  what the numbers were.
- **Postponements, late calls, abandoned pitches, missing officials** and the
  rest of Sunday morning.

### Around the edges

- **Autosave as you play**, three manual slots, and saves migrated forward from
  older builds rather than orphaned.
- **A preferences menu**: motion (reduced, from your system or off), fullscreen,
  and the speed a match starts at.
- **A settings menu in the header** for saving, loading, preferences and
  returning to the main menu.
- **Credits and this changelog**, both from the main menu.
- **One mark, one stripe.** The wordmark settles into place when the menu
  appears, and the same drifting stripe runs through the screens before a career
  and the header bars of the game itself — all of it respecting reduced motion.
