# Changelog

All notable changes to Sunday Eleven 27 are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [semantic versioning](https://semver.org/spec/v2.0.0.html).

The game is a **beta**: while the version starts with `0`, features arrive in
the minor number, fixes in the patch, and the save format is still allowed to
move (any save from an older build is migrated forward on load). `1.0.0` means
it is finished. This file is also the changelog inside the game, reachable from
the main menu.

## [0.5.0] - 2026-10-04 — the match simulation and the thing watching it are two systems

The match used to be watched at a fixed compression: one minute of football was
six seconds on screen, whether it was a throw-in or a goal. It is now two
separate systems joined by one record.

### The simulation decides what happens

- **The match clock is real football time.** An event carries the second it
  happened on — seconds since kick-off, straight through the interval — so the
  clock, the commentary and the statistics all describe the same moment instead
  of a minute rounded to something that fits the frame loop.
- **The clock no longer rewinds at half time.** It used to drop back to 45:00 for
  the second half, which meant a second-half event could be stamped *before* the
  half-time whistle that preceded it. The displayed minute is still rebased so a
  manager reads the second half as starting at 45.
- **A match knows which part of the game it is.** The engine's clock is one
  unbroken count of seconds since kick-off, and the half it belongs to — first
  half, second half, or either period of extra time — is a thing of its own. That
  is what lets the second half open at 45 on the screen while the clock never
  moves backwards, and it is the same model that extra time will need, rather
  than a special case for two halves.
- **Added time is earned, not rolled.** The referee's board used to be a number
  drawn from the seed before kick-off, so every half got minutes whether anything
  had happened or not. The engine now counts the time the ball actually spends
  dead — restarts being arranged, goals being celebrated — plus a small allowance
  for the stoppages it does not model, and plays exactly that much. A quiet half
  gets little; a stop-start one gets plenty. It is recorded on the match, so the
  half-time and full-time whistles are the moment the football reached, not a
  guess made in advance.

### A level cup tie is settled on the pitch

- **Extra time is played.** A knockout tie that is level after ninety minutes
  used to end there, and the cup would send the home club through on no evidence
  at all. The engine now plays the two fifteen-minute periods the clock model was
  always built for: it announces extra time, plays 90 to 120, and keeps the
  record straight through.
- **If it is still level, there is a shootout.** Five kicks each, taken by the
  men on the pitch, then sudden death until one side misses. The winner is
  written onto the match and into the result's penalty score, so the cup reads
  who actually went through. A knockout tie can no longer be decided by which
  dressing room it was played in.

### Men leave the pitch: cards and injuries

- **A second yellow is a sending off.** The engine used to book a man and stop
  there, so a second booking cost nothing. It now sends him off, and so does the
  rare straight red. A sent-off player keeps his place on the team sheet — the
  ten who remain keep their shape — but he plays no part: his side is down to ten
  and weaker for losing him, and he cannot be replaced.
- **A match can hurt a man.** Tired legs on a bad pitch turn an ankle or pull a
  hamstring, and the injury is written onto his record, where the season turns it
  into time out — so a manager hears about it the way he hears about a card.
- **The bench answers an injury.** A man who cannot run it off comes off at the
  next chance, whoever he is and whatever the minute, and the best-placed
  substitute takes his job.

### The laws of football, played in the new engine

- **Offside.** A player who is in the opponents' half, ahead of the ball and past
  the second-last defender when it is played, and who then takes it, is offside.
  The whistle goes, the move is cut dead, and the defending side restarts with a
  free kick — and the record and the statistics both say so.
- **A shot can miss.** A shot is settled from where it is taken and by whom: it
  can be a goal, be saved, go wide, sail over the bar or come off the woodwork.
  Before this a shot was only ever a goal or a save, so a goal kick barely
  existed.
- **A defender can block one.** A defender in the way can throw himself in front
  of a shot before it reaches the keeper — sometimes behind for a corner,
  sometimes away as a loose ball.
- **A foul in the box can be a penalty.** Not every one is, but when it is, it is
  taken like any other restart and comes to a goal or a miss.
- **Own goals and assists.** A defensive touch that ends up in his own net is an
  own goal, credited to the other side and named to him; a goal scored soon after
  a teammate's pass credits that teammate with the assist.
- **Proved by tests.** Every one of these has a deterministic acceptance test in
  `matchEngine/laws.test.ts`, from a clear offside and an onside run to a saved
  penalty and a shot off the bar.

### What the playtest found, and what changed

A playtesting pass over the new engine turned up six pieces of football that did
not look like football. Each is now the rule it should have been.

- **A deep line no longer stands on its own goal line.** A deep defence,
  defending its own third, was being driven to progress ~0 — literally behind the
  goalkeeper — because the own-third retreat was subtracted from an already-deep
  base and a defensive slot's offset could undercut the line again. The back line
  is now floored so an outfield man always stands in front of his keeper, and no
  shape position is placed deeper than the six-yard box.
- **One man closes down the ball, and only one.** A side used to send three or
  four at the carrier — every ``press`` role plus anybody near the ball in his own
  half — which pulled the block apart. It is now the single nearest outfield man
  who goes, with his role deciding only how far out he will travel.
- **A striker shoots or holds up, rather than squaring it.** The engine damped
  every shot to a tenth of its weight, in the box and on the halfway line alike,
  so a poacher on the spot was as reluctant as a centre-back. The damping is now
  zone-aware — a shot in the area is far more likely than one from range — the
  hold-up option is a real option rather than a last resort, and a man already
  high up the pitch no longer treats the square or backward ball as his first
  choice.
- **A throw-in is thrown by a named player, from the touchline.** The ball is
  placed on the edge of the playing surface, the taker stands on it, the delivery
  is a throw and never a cross, and the record names the thrower.
- **A penalty is set up to the laws.** The keeper stands on his line and every
  other player — both sides — waits outside the area and behind the ball, rather
  than filling the six-yard box in the taker's path.
- **A kick-off is a kick-off.** Only the taker is at the ball; everybody else is
  in his own half and outside the centre circle before it may be played. The
  restart waits for the pitch to be legal instead of crowding the spot.
- **Proved by tests.** `matchEngine/restarts.test.ts` pins the press, the throw-in,
  the penalty arrangement and the kick-off; the shape floor and the advanced-pass
  preference have their own tests in `shape.test.ts` and `passing.test.ts`.

### The screen says which part of the game it is

- **The period is labelled, not guessed.** The header and the shell used to read
  "First half" or "Second half" off the half number — so extra time came out as a
  second half. The engine now records the period it is playing, and the UI names
  it: First half, Second half, Extra time.

### The record is the football, not only its loudest moments

- **Passes, carries and tackles are events.** The engine used to write down the
  goals, the cards and the whistles, and count the rest. It now records the
  ordinary play too — each pass naming the man it found, each carry, each tackle
  won — so the match is a move rather than a list of incidents.
- **The timeline groups them into real passages.** With the ordinary play on the
  record, a passage is a possession: the run of passes and carries that ended in
  a shot, a tackle or the touchline. Passages used to be mostly one event each.
- **The commentary tells the ordinary play too.** Every event is narrated, not
  only the loud ones: each pass names the man it found ("B. Oakes finds W.
  Aldridge"), each carry the man it beat, each tackle. The commentary bar and the
  transcript read as a move building rather than a list of incidents. The bar
  still shows one line at a time and skips to the newest, so the detail never
  buries a goal; the full transcript is a tab away for anyone who wants it all.

### The presentation decides how much of it you see

- **Four ways to watch.** Full match, extended, key moments and commentary.
  Full match shows every passage with ordinary play accelerated and the big
  moments slowed; the others skip the quiet spells entirely and stop only for
  the football worth stopping for.
- **The pace follows the football, not a multiplier.** Ordinary play is spent
  quickly; a chance is watched close to real time; a goal is not compressed at
  all. The speed chips still exist, but they divide the cost of watching — they
  never change what is shown or what happens.
- **Skip ahead** fast-forwards to the next moment worth watching and stops on
  its first second, so nothing is missed. It is the *presentation* skipping;
  every second of the match is still played and written down.
- **The engine never runs ahead of the picture.** There is one record and one
  clock, so the pitch, the score and the commentary always agree — no watching a
  goal before the clock reaches it, and no second account of the match anywhere.
- **A replay is as smooth as the match was live.** The movement of a watched
  match is now sampled twice as often, and a long afternoon is thinned from the
  *back*: the newest quarter of the recording is always kept whole, so the
  football just watched plays back at full rate and only the distant past grows
  coarser. The replay clock also advances every animation frame by the real time
  that passed, instead of a handful of times a second, so the recorded movement
  is interpolated smoothly and runs at the pace chosen rather than at the frame
  rate. The whole path is pinned by a test that watches the same match at
  different pacings and finds the recordings byte-for-byte identical.
- **The match screen, tidied.** How much of the match to watch is a setting, not
  a transport control: the four viewing modes now sit in a menu behind a settings
  button at the bottom right, next to the button that runs the match to the
  whistle, instead of a row of chips fighting the speed for the same strip. The
  "skip ahead" button is gone — the viewing modes already decide how much is
  watched. Choosing **Commentary** takes the pitch away altogether: with the
  words carrying the match there is nothing to draw, so the two team sheets take
  the space and the afternoon is told rather than shown. On a phone the sheets
  stand up in its place, one above the other. The panel tabs also moved to their
  own full-width line above the speed and match buttons, each sharing it equally,
  so every panel is a thumb's-width target instead of a strip that scrolls off
  the edge. The run-to-the-whistle button drops its words on a phone too (it
  keeps its glyph, title and aria-label), so it sits beside the options button
  rather than stacking above it.
- **Both teams wear their own colours on the pitch.** The dots used to be the
  manager's club colour for his own side and a default grey for everybody else,
  so one team was always "the coloured one". Every dot now carries the strip the
  side is actually in, from the same colours the team sheets and the commentary
  bar use.
- **A goal is celebrated with movement, not a frozen pulse.** The hold after a
  goal used to keep every man exactly where he stood while the dots on the pitch
  pulsed. The scoring side now genuinely runs — the scorer for the corner nearest
  where the ball crossed the line, his teammates setting off after him — while
  the conceding side holds its ground and the ball lies in the net. It is staged
  from the same authoritative state and decides no football of its own, so the
  picture interpolates a real run rather than a shudder and no result changes.
- **A replay shows the match you watched, not a drawing of it.** While a match is
  watched, the engine now records the real movement — every player and the ball,
  at the engine's own step cadence rather than the screen's — and the replay
  plays that recording back against the football second it was taken on. It is
  the same afternoon at any speed it was watched: a man who was substituted off is
  still drawn where he played, and a match nobody watched falls back to the old
  reconstruction through the same picture. The replay no longer borrows the
  retired spatial engine's clock for any of this.

### Fixed

- **A side that cannot field seven players forfeits instead of stalling the
  week.** A manager who arrived on a Sunday with only ten fit players was stuck:
  the game asked for eleven, would not accept fewer, and would not let the clock
  past the fixture. Seven is now the line the laws set. A club with seven to ten
  available plays short-handed; a club below seven has no team to put out, so
  playing the fixture abandons it and the opposition is awarded a 3-0 win — for
  the manager's club and for every AI club alike.
- **Training is on the Thursday, and only the Thursday.** A session was worked
  out as "three days before the next match", so when the calendar put a midweek
  cup tie on a Wednesday the session landed on the Sunday morning — a week with
  two sessions in it. Only league matchdays carry a session now: the cup tie is
  prepared for by the same Thursday that builds towards Sunday.
- **The Thursday after a cup tie is no longer marked trained before it
  happens.** Going to a midweek cup game ran the club's weekly session on the
  spot, banking the evening that had not happened yet and showing it as done on
  the calendar. The session is only conducted once its Thursday has been and
  gone.
- **Pre-season stops on its training nights like the season proper does.**
  Once a training day had been shown once, the command bar fell through to
  Continue; pressing it ran the session in the background and moved the clock
  on. A session that has not been run is still waiting for the manager, so the
  bar offers "Run the session" whether or not he has read the notice.
- **The loading screen is styled from the first frame.** The placeholder shown
  while a career opens carried class names but no rules until the stylesheet
  arrived with the bundle, so it flashed as unstyled text on a white page. It
  now carries its own styles in the document head, before anything is drawn.
- **The shape is no longer lopsided.** A wide role widens a man toward *his own*
  touchline, but the width bias was signed by the team's attacking direction
  rather than the player's flank. On both sides a left back therefore drifted
  toward the middle while a right back went wider, so a side's left was squeezed
  and its right stretched — the gap between a right back and the centre back
  beside him never matched the gap on the left. The bias is now signed by the
  flank, so a side's left and right mirror each other.
- **A goal no longer makes the picture shudder.** After a goal the ball bounced
  between the goal line and the centre spot and every player twitched. The goal
  hold did not step the movement, so the drawn position (`px/py`) was left where
  the last step put it while the real position had moved on — and the pitch,
  interpolating between the two as its frame clock ticked, slid the ball and the
  players back and forth across that gap. The held phases (the interval, the
  final whistle, and the last step of the goal hold as the kick-off is arranged)
  now settle the drawn position onto the real one, so there is nothing left to
  interpolate.
- **The ball stays in the net for a goal.** It used to be placed straight onto
  the centre spot the instant it crossed the line, so the celebration showed a
  ball already back at the middle. It now remains where it crossed, and the
  kick-off that follows the hold is what returns it to the centre spot.

### Every fixture plays the same football

- **There is one match engine, and the whole world runs on it.** The fixtures the
  manager does not watch — every other league match, every cup tie — used to be
  decided by the older minute engine, so the same Sunday could be played two
  different ways depending on whose match it was. They now go through the new
  engine too, through a headless path (`simulateMatchHeadless`) that is the same
  call the watched match makes: identical football, no picture.
- **The world's results come from the pitch.** A goal nobody watched is an
  engine goal, an injury is an engine injury, and the league table, the cup, the
  scorer lists, the suspensions and the training effects all read the same
  record the manager's own match writes. There is no simplified model behind the
  scenes — a fixture is a fixture whether or not anybody is looking at it.

### For developers

- **`simulateMatchHeadless(match, env)` is the only headless entry point.** It
  runs the engine to completion and writes the authoritative record onto the
  `Match`: result and score, goals, scorers and assists, cards, injuries,
  substitutions, possession ticks, event history and per-player performances.
  `src/simulation/day.ts` calls it for every AI fixture, so no production code
  imports the old engine any more.
- **The old engine has no production call sites.** `match/engine.ts` and its
  supporting modules remain only for their tests and for `tools/balance.ts` and
  `tools/matchReadout.ts`, which read it directly to audit a single match. They
  are the last reference to it and can be removed with it.
- **Bulk fixtures are expensive, so the soak is opt-in.** A headless match is
  about a second of engine time, so a full matchday is tens of seconds and a
  season runs into minutes. The multi-season smoke test
  (`src/simulation/soak.test.ts`) is therefore **skipped by default** and run on
  demand with `npm run test:soak` (or `SOAK=1`), so a season on the new engine no
  longer blocks every test run. One engine is the correct end state; a cheaper
  *bulk* path — off the main thread, or a coarser step inside the same engine —
  is the next piece of work.

- **A match simulates about four times faster than it did.** The engine used to
  ask all twenty-two players to re-scan the pitch — the nearest man, the side's
  energy, the side's shape — on every one of a hundred and sixty thousand steps,
  and the men without the ball were re-deciding where to stand thirty times a
  second. The shared answers are now worked out once a step, and the off-ball men
  re-decide on their own slower cadence. The football a manager watches is
  unchanged (measured within a few per cent at a fixed seed); a headless match
  dropped from about ten seconds to about two and a half.
- `npm run timeline-readout` prints the engine's event stream, the passages it
  groups into, and how long each viewing mode would take to watch — the budget
  check that simulation speed and presentation speed are independent.

## [0.4.2] - 2026-10-02 — careers, somewhere with room

The place a season is kept has changed. Nothing about the season has.

### A bigger cupboard

- **Careers are stored in IndexedDB, not in local storage.** A full county is
  thirty-six clubs, nine hundred-odd people, four hundred matches and the whole
  social network between them — around three megabytes of JSON. That is a great
  deal to ask of local storage, which the browser caps at about five megabytes
  *in total*, quotes as a string on every write, and does on the main thread
  while the game is trying to do something else. The database stores it as
  structured data, asynchronously, with room to grow well past what local
  storage could ever hold.
- **The whole world still travels together.** It is one career record, not a
  table of players and clubs and matches, because nothing here needs to ask the
  database a question it cannot answer by reading one record.
- **Nothing about the simulation moved.** `GameState` is still the career, still
  the source of truth, and still the only thing that is saved. The save format is
  unchanged at version 9, so an existing career is the same career afterwards.
- **The save list can no longer fall out of step with the careers.** It used to
  be a separate index that had to be rewritten on every save and could disagree
  with what was actually stored. It is now whatever is in the store, which is
  the one thing that cannot disagree with itself.

### Coming across

- **Existing careers are brought across on the first launch, automatically.** A
  manager who has been playing for months opens this build and finds his season
  where he left it. It happens before the menu is drawn, so there is never a
  moment where the game has told him he has no careers and then changed its
  mind.
- **The old careers are not deleted.** They are left exactly where they were, as
  a fallback if the browser ever refuses the database, and so that a bad
  migration is recoverable. It costs a few megabytes and is worth every byte.
- **One bad career does not cost him the rest.** A save that will not parse is
  named in the console, left untouched, and every other career still comes
  across.
- **Doing it twice is harmless.** A slot is only imported if it is not already
  in the database, so a migration interrupted by a closed tab simply runs again,
  and a career the manager has played on since can never be overwritten by the
  older copy.

### Fixed

- **A rapid burst of saves could leave the wrong one on disk.** local storage
  writes were synchronous, so `autosave(A)` had always finished before
  `autosave(B)` could be called. Asynchronous writes are not so obliging, and the
  database is free to complete two in flight in either order — which would have
  put an older career on top of a newer one. Writes are now queued per slot, so
  three saves in a burst leave the newest one stored, a failed write no longer
  freezes the ones behind it, and the manager is never blocked waiting for any
  of it.
- **A database the browser refuses no longer stops the game opening.** A missing
  database, a full disk, a refused write: the game still starts and is still
  playable, and says so rather than throwing. An autosave that fails leaves the
  career in memory exactly as it was.
- **Storage failure and a broken save are no longer the same error.** A browser
  that will not give the careers back says the browser would not; a save that
  will not parse says that save is broken. They are different problems with
  different fixes.
- **The menu no longer says "nothing saved yet" while the game is still
  looking.** The store knows whether it has finished asking, and the menu waits
  for it rather than guessing.

### For developers

- **`src/state/indexedDb.ts`** is the whole of the raw browser-database
  plumbing, in about two hundred lines. It is a wrapper rather than a dependency
  on purpose: there was no IndexedDB library here already, and one would be a
  larger thing to reason about than the thing it replaced. It is careful about
  two things that are easy to get wrong — a transaction is closed by its event
  loop rather than by its callback, and a transaction-level error reports
  `AbortError` rather than the quota error that actually happened.
- **A `se27` database at version 1**, with a `saves` store keyed by slot and a
  `metadata` store keyed by name. The database version is its own number and has
  nothing to do with `GAME_STATE_VERSION`, which is the version of a career's
  contents: they are different facts, and using one for both would make a
  simulation change look like a schema upgrade.
- **`migrateSave()` is untouched** and still runs on every load, exactly as
  before. A version 7 career with one league and no cups still becomes a
  pyramid; the change of address is invisible to it.
- **`serialiseGame()` and `deserialiseGame()` still work** and still operate
  entirely in memory, and now go through the same reader the database does, so
  an exported string and a stored career cannot drift apart. They are ready for
  an export/import screen whenever there is one.
- **`fake-indexeddb` is a development dependency**, and only that. The
  persistence tests run against a real transaction implementation rather than a
  stub that returns success for everything — every bug in this migration was
  transaction behaviour, and a stub would have passed while all of them were
  broken.

## [0.4.1] - 2026-10-02 — a home screen, and a lighter download

The game can be put on a home screen, played with no signal, and told when
there is a new one to load. It also now takes rather less than half of what it
used to, which turns out to be mostly one photograph.

### On a home screen

- **The game can be installed.** A manifest, a service worker and a set of icons
  make it a Progressive Web App: added to a phone's home screen or a desktop's
  app list, it opens in its own window with no browser chrome, and it keeps
  working with no signal at all once it has been opened once. The worker caches
  the hashed bundles (whose names carry their own version, so they can never be
  stale) and falls back to the last good shell only when the network is gone, so
  a deploy still reaches the player on their next connection.
- **Every icon is the same mark.** The taskbar, home screen, splash screen and
  share sheet icons are all generated from `public/favicon.svg` rather than drawn
  separately, so there is one mark to change and no way for the icons to drift
  away from it. The platform-masked variants are prepared properly: bled to the
  edges, with the wordmark inside the safe zone, because Android may crop a
  maskable icon to a circle and iOS paints transparent pixels black.
- **The worker is never served stale.** `sw.js` is sent `must-revalidate` at the
  edge. It is the one file that decides what is cached, so a cached copy of it
  would outlive the deploy it was written for and pin the game to that build.

### Keeping the game, and being told about a new one

- **The main menu offers the install.** The browser decides *once* whether to
  let a game be installed, offers it in a strip most people dismiss unread, and
  never asks again. The game now catches that offer and spends it in the one
  place a manager is looking, in the game's own words and on their own time. It
  asks quietly, and "Not now" is genuinely never now.
- **iOS is told how, rather than given a button that cannot work.** There is no
  install event on an iPhone, so the card explains the way in — Share, then Add
  to Home Screen. A browser with no way to install at all is shown nothing,
  because a card offering what the browser has already refused is worse than no
  card.
- **A new build now waits to be let in, and says so.** The service worker used
  to take over the moment a deploy finished, which swapped the code out from
  under a half-played match with nothing on screen to explain it — and the
  reload would land on the *previous* deploy, so the update could never actually
  be applied. A new build now installs and sits, the game says a new version is
  ready, and it applies when the manager chooses. The career is saved on the way
  out, so reloading is safe.
- **Deploys are noticed while the page is open**, when the manager comes back to
  the tab and hourly after that, rather than only on the next visit.

### Smaller, and faster to open

- **The pitch is a third of its old size.** The photograph behind the pre-game
  screens was a 2.1 MB PNG, which was most of what the game had to download and
  most of what it had to keep for offline play. It is now a 315 KB WebP, cut by
  85% at a measured 37 dB PSNR against the original — visually faithful, and the
  only copy of it that ships.
- **You download the game you are playing, not the game you might.** The twenty
  screens are fetched the first time they are shown rather than all up front, so
  opening the game to look at your inbox no longer costs you the recruitment
  screen, the finances and the match commentary. The main menu is the deliberate
  exception: it is the first thing painted, and is worth 4 KB to never wait for.
- **React is chunked separately**, so a release of the game no longer
  invalidates 145 KB of framework that has not changed.
- **Offline play is now guaranteed rather than hoped for.** The service worker
  precaches every file the build produces, from a list written in at build time
  rather than kept by hand. That is what makes splitting the bundle safe: a
  screen whose code has not been fetched yet can still run with no signal,
  because the chunk is already in the cache before anyone clicks.

### For developers

- `npm run icons` regenerates every app icon from the favicon. It needs `sharp`,
  which is a development dependency only: the PNGs are committed, and the script
  runs when the mark changes, not on every build.
- `npm run scene` rebuilds the pitch photograph as WebP from the master kept in
  `assets/`, which sits outside `public/` precisely so the build does not copy
  it. It measures the result and refuses to write it below 36 dB PSNR.
- A `precacheManifest` plugin writes the build's own file list into `sw.js`. If
  the placeholder it replaces is ever missing, the build fails rather than
  quietly shipping a game that caches nothing.
- `public/sw.js` keeps a `self.__PRECACHE__` placeholder for that list. The
  built copy has it replaced; the source must always still contain it.

## [0.4.0] - 2026-10-02 — a pyramid, and time passing

There were twelve clubs, forever. There are now thirty-six in three divisions,
two up and two down at every boundary, two cups, and a world that ages.

### The ladder

- **The county is a pyramid.** Three divisions of twelve, cut from the top down
  by reputation, so the top division holds the better squads from the moment
  the world is built rather than sorting itself out over the first few seasons.
  The size and the number of rungs are data, not a constant, so a two-division
  world or a sixteen-club one is a configuration change rather than a rewrite.
- **Two clubs go up and two come down at every boundary.** Ties are settled by
  the standings the table already uses. A club that cannot be promoted — no
  ground, or money that will not stand it — is told so in the news, with the
  reason, and the club below it is promoted in its place, so a division never
  ends a season the wrong size.
- **Moving tier moves everything that hangs off it.** Prize money, crowds,
  sponsorship and what the board expects all differ by division; rivalries are
  struck and dissolved when clubs end up on the same level or stop being on it;
  and a club's history records the tier of every season it played, so an old
  season in Division One still reads as Division One.
- **The manager's own club can be in any of them.** Career mode lists every
  club in the county by division, and a club he builds himself displaces the
  weakest in Division Three and starts there.

### The cups

- **A League Cup, open to every club in the county.** Single legs, extra time and
  penalties, seeded so the field does not need to be a power of two. It is drawn
  on a Wednesday night, numbered after the league's matchdays but dated inside
  the season, so a cup tie is a real midweek commitment rather than a Sunday
  everybody was already playing.
- **A Plate for the clubs that go out in the first round**, as the design
  document always said there would be. It is fed by the League Cup's first round
  and interleaved with the main competition's rounds, so a season's cup football
  is spread across eleven midweeks instead of arriving all at once at the end.
- **A draw is an event.** It is a news item, it is on the cup screen, and the
  rounds, results, giant-killings and finals all feed news, history, honours and
  rivalries like a league season does.
- **No club plays twice in a day, and no cup round lands on a rearranged league
  replay.** Cup ties are drawn onto a date that is actually free, falling
  forward if the first one is taken, and a postponed cup game is rearranged to a
  midweek slot rather than onto the Sunday the league fixture is already on.

### The world turning over

- **Other clubs now do something between seasons.** They release a man, sign
  another, keep a legal squad, cut wages or fundraise when they are in the red,
  and change manager when the board has seen enough. A released player joins the
  unattached pool and is signed by somebody else, which is what keeps the pool
  turning instead of growing: it was measured at 37 men in season one and 371 by
  season eight, and now oscillates in the twenties and forties.
- **Every player has a ceiling and a peak.** Training used to raise a man until
  he hit the top of the scale, so every player in the world got a little better
  every year and the county's football never stopped improving. Each player now
  has his own potential and his own age to reach it: a teenager has a long way to
  travel, a man of thirty is closing in on what he has, and a man of thirty-four
  has stopped getting better and started losing it. Physical attributes go
  first, know-how barely at all. The world's mean ability now moves **+2.9%**
  across ten seasons, down from +10.2%.
- **Everyone trains, in every division.** See below; this one was a real bug.

### Fixed

- **Two thirds of the county had never held a training session.** The weekly
  routine ran for "the first competition's clubs", which before the pyramid meant
  the whole league and afterwards meant Division One and nothing else.
  Divisions Two and Three were silently frozen: their men never improved, never
  tired, and never appeared in a session. It was invisible because the code's own
  comment said it ran for every club.
- **An extra-time tie could never finish.** From minute 105 the branch deciding a
  half had ended matched its own condition again and reset the clock to minute
  90, burning the loop's safety net and leaving the tie in progress for ever.
  A cup tie that went to penalties could therefore never be decided, and the
  round that contained it never completed.
- **A cup round was never treated as settled.** "Decided" meant the competition
  had a winner, so only the final round advanced; and a postponed original was
  counted as a live tie, so a round with a rearrangement in it could never close.
- **The Plate was never fed.** The consolation draw sat on the Plate's own loop
  instead of on the League Cup's first round completing, so no club was ever
  knocked out into it.
- **A match history counted the wrong matches.** Cup tie dates sit inside the
  league season but are numbered after its matchdays, so "matchdays elapsed" was
  no longer a coherent index and a season could be declared finished early.
  Anything asking how far through the season the world is now filters to league
  matchdays only.

### For developers

- The save format is **version 9**. Version 7 saves become a pyramid with the
  league they already had kept as Division One; version 8 saves are given each
  player's development profile from the ability and age he already has, on a
  stream of his own, so an old career does not discover a new talent in its
  established men.
- The multi-season **soak** gained pyramid invariants: every club in exactly one
  division, division sizes constant, promotions and relegations balancing, no
  club playing twice on one day, cup brackets completing, honours neither
  duplicated nor skipped, and ability stratified by tier without inflating.

## [0.3.0] - 2026-10-01 — the football, decided

The match engine was rebuilt. It used to ask, once a minute, whether a shot
happened; it now plays football, and everything else follows from that.

### The football

- **A match is a run of possessions, not a list of incidents.** Each minute is
  divided into passages in which somebody has the ball, at a place on the pitch,
  with defenders trying to take it off him. How many there are is not fixed: it
  falls out of how long each one takes, which is why a side knocking it about
  and a side thumping it long do not get through the same amount of game.
- **A player decides what to do with the ball.** Play it, carry it, take his man
  on, put it in the box, have a go, switch it, thread it through, shield it, or
  get rid of it — and which he chooses follows from where he is standing, how
  hard he is being closed down, who is available, what he is good at, how tired
  he is, what the manager has told him to do and what the score is. A
  centre-back on the edge of his own box with a striker on him very rarely tries
  to play out; the same man in space in midfield very rarely launches it.
- **Passes go somewhere, and sometimes they do not arrive.** A pass is an
  attempt with a destination: the difficulty is the distance, the angle and the
  pressure, and the ability is the passer's — so a good passer under pressure and
  a poor passer in space are both possible, and both matter. A ball that does not
  arrive is an interception, a loose ball or a throw-in, and it turns the move
  around.
- **Defenders change what happens.** A challenger goes in based on who he is and
  what the manager asked for; the duel turns on tackling and strength against
  control and agility, and a mistimed one is a foul. That is where bookings come
  from now — a side that keeps losing the ball gives them away trying to win it
  back, and a side that never has it cannot foul at all.
- **Chances are built rather than rolled for.** A shot is the end of a move that
  got somewhere. How good the chance is comes from the move; what the player does
  with it comes from his finishing, his composure and the pressure on him; and
  whether it goes in comes from the keeper. A great chance for a poor finisher
  and a half-chance for a good one are now different things, and the statistics
  agree with the football — goals are always among the shots on target, and the
  shots on target are always among the shots.
- **Set pieces come out of the game.** A blocked shot is a corner. A foul in the
  box is a penalty, and a foul twenty-five yards out is a free kick somebody can
  have a go at. Corners, throws and goal kicks are played out as passages of their
  own rather than announced and forgotten.
- **Home advantage is in the football.** It is a crowd and a familiar pitch, so
  it shows up as a pass finding its man and a fifty-fifty going your way, not as a
  thumb on the scoreline.
- **Tactics change what players attempt.** A direct side clears its lines and
  stops passing for the sake of it; a short-passing side keeps the ball and
  recycles; a high line is a high line. Instructions still have their effects on
  the balance, but they are now expressed as behaviour.
- **The score, the clock and tired legs change behaviour.** A side chasing two
  goals in the last ten minutes pushes up and leaves space behind; a side
  protecting a lead in the same ten minutes sits in. Tired players close down
  less, misplace more and cannot hold a high line.

### Reporting

- **Passes, tackles and interceptions** now appear on the match statistics
  panel, all read from what the players actually did — passes as completed of
  attempted, so a figure that says a side kept the ball well is visible as one.
- **The commentary is the football, described.** It is still written from a
  single passage that the pitch plays and the narrator reads, and it can no
  longer name a man from the other team, describe a pass nobody made, or report
  an outcome the match did not produce.

### Watching the match

- **A match is played at a pace you can follow.** Normal speed no longer runs
  four times faster than the picture: it is now the one setting where the pitch
  runs at true speed, so a player's legs move at the speed the simulation gives
  them and a pass looks like a pass. The speed ladder gained a rung above it —
  1x, 2x, 4x and 8x — and every one of them divides the same minute rather than
  changing it, so the engine plays identical football however fast it is
  watched. An afternoon takes about ten minutes at normal and about a minute and
  a half flat out.
- **Goals are celebrated, on the pitch and in the words.** When the ball goes
  in, football stops for a moment: the scorer breaks away to the corner, his own
  team chases him down and rings him, the side that conceded walks back, and the
  ball is returned to the centre spot for the restart. The pitch is picked out
  for it — the scorers marked, the man who scored most of all — and the narrator
  describes it in the same minute, right after the finish. It changes nothing:
  the score was settled the instant the ball crossed the line, and the
  celebration is only what the pitch does about it.

### Under the hood

- **A balance bench** (`npm run balance`) plays hundreds of seeded matches a
  scenario and reports the *distribution* — goals and their spread, shots and
  shots on target, possession, passing and completion, fouls, cards, offsides,
  corners, the duels won and the mix of actions players actually chose — rather
  than a single scoreline, so the engine is tuned from data instead of
  guesswork. Its first finding was a real one: the defending side's quality was
  absent from the passing model, so a quality gap barely showed at one or two
  points and ran away with the game at six. Reading the distribution led to the
  fix, and a better side now wins about seven in ten of the moderate-gap
  fixtures it should rather than half.

### The world

- **Squads are refreshed each summer, so the league stops ageing in lockstep.**
  Every club now takes on one or two teenagers before the season, and carries no
  more than twenty-six players, so the oldest surplus moves on. Without it the
  world could only get older: every other arrival was a grown man and every
  survivor gained a year, so the median age marched from 27 to 35 in fifteen
  seasons. Now it settles in the mid-twenties and stays there.
- **Money can now fail.** A club that ends the season in the red goes into
  administration, and one that cannot get out of it folds. Sponsors walk after a
  bad winter, the winter's pitch repairs and the cost of running a squad bite,
  and a club with a thin squad and an expensive ground can be brought down. When
  a club folds its players and committee go with it and its ground falls vacant;
  a new club forms in the same town to take its place, so the division keeps its
  size however long the career runs. Money is no longer a scoreboard that only
  rises.
- **Managers have careers of their own.** A season is no longer only players
  getting older: the men who run the clubs age, retire, step down, lose their
  jobs after a winter that fell short, and get taken by a bigger club down the
  road. A vacancy is filled by a man between jobs, by the coach already in the
  building, or by a player who fancies running it himself — and never left empty.
  A player-manager who hangs up his boots no longer vanishes from the job: he
  stays on in the dugout as the club's ordinary manager.

### For developers

- **A simulation trace.** Attach a collector to a match and every decision the
  simulation makes — the man, the place on the pitch, the pressure, the actions
  it weighed and the one it chose — comes back as prose, minute by minute. It is
  for balancing the engine rather than for playing the game, and a normal match
  pays nothing for it.
- **The multi-season soak** (`npm run soak`). A headless harness that plays the
  game forward ten to twenty seasons with nobody at the controls — no signings,
  no team talks, no transfers — and reads the world at the end of every season.
  It walks the same paths the game walks (one day via `processDay` with the
  user's match resolved, the season close inside it, and `startNextSeason`
  between seasons), so it measures the game rather than the harness. It reports
  drift in squads, ages, ability, money, the unattached pool, goals and fixture
  rearrangement, and checks the invariants a decade exposes: ids still resolve,
  the archive is written once, a save round-trips, the same seed is the same
  career, and a season actually ends. `SOAK.md` explains how to run and read it,
  and what its first long runs found.
- A two-season **smoke test** (`src/simulation/soak.test.ts`) so the season loop
  is guarded on every commit without paying for fifteen seasons in the suite.

### Fixed

- **A bad winter can no longer swallow a season.** A rearranged fixture rolls
  fresh conditions from its own id, so a game called off in a wet autumn could be
  moved into the same weather, called off again, and rearranged again without
  end. One seed carried a single fixture through twenty-one rearrangements and
  five months past the season's own calendar, and never closed the season — which
  damaged the next one too, because a season that does not end never archives a
  champion. A rearranged game must now be played before a deadline (the last
  scheduled Sunday plus eight weeks), and a fixture with nowhere to go is
  abandoned on the record rather than shuffled for ever.
- **A retiring player-manager no longer leaves the club pointing at nobody.**
  A minority of clubs are run by a player-manager, and when he retired the
  season rollover cleared his squad place but left `club.managerId` naming him;
  the unattached pool then deleted him from the world, so the club's manager was
  a man who did not exist. Stopping playing is not stopping managing: he now
  stays on as the club's ordinary (non-playing) manager, keeping his identity,
  his relationships and his notes.
- **Relationships no longer outlive the people in them.** A free agent who left
  the world was deleted from `state.people` without his relationships being
  cleared, so the social graph slowly filled with links to people who had gone.
  The save loader pruned them, which meant a reloaded career was not quite the
  same social world as a running one. A departure now removes every relationship
  that named the man.

## [0.2.0] - 2026-10-01 — matchday, told

### Matchday

- **The match is watched, not read.** During play the screen shows one line of
  commentary — the moment happening right now — rather than a scrolling feed.
  The full transcript is a tab, and the match report, away: it is written to be
  richer than anything on the live screen, with possession, passing, movement
  and chances building in front of every shot, so a goal reads as the end of a
  passage rather than arriving out of nowhere.
- **The words and the pitch are the same move, told twice.** Each minute the
  engine decides its football exactly as it always did, and a single *passage*
  is planned from the names it used. The pitch plays that passage out; the
  commentary describes it, step by step. There is no second cast and no second
  story, so a line can no longer describe a player carrying the ball while a
  different one has it, or a pass nobody made. When the engine decides a side
  has given possession away, the passage turns around with it.
- **Nothing is invented for it.** Every line comes from what the simulation
  actually did — the same record behind the statistics and the report — and the
  prose draws its randomness from a stream of its own, so a sentence can never
  move a shot, a card or a goal. A pass the ball makes on screen is a pass the
  record already counts.
- **The match happens in space, not as a list of events.** Players and the
  ball carry positions the simulation owns: players walk to the target the
  engine has chosen for them instead of appearing at it, and a pass or a shot
  travels to its destination rather than resolving instantly. Players hold their
  shape, the nearest defender closes the man on the ball down and the side in
  possession spreads to give him options; the ball only ever changes hands to
  somebody near it, so nothing crosses the park in a single step. The football
  is decided exactly as it was — a minute at a time, from the match seed — so the
  result can never depend on the machine it was watched on, and the pitch now
  draws the simulation's state rather than working out a picture of its own.
- **The match screen is shaped around watching it.** The pitch takes the room,
  with each side's team sheet down the side of it; the current commentary is a
  bar beneath the pitch rather than a column beside it; the dressing room, half
  time and full time are cards over the match instead of panels that cost it
  space. The bar is tinted in the colour of the club the line is about and
  flashes when a goal goes in.

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
