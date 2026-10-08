# The multi-season soak

The match engine has a balance bench. The season loop has a soak.

`tools/balance.ts` asks whether one match looks like football. The soak asks the
harder question: **does one career look like a career?** It plays the game
forward with nobody at the controls — no signings, no team talks, no transfers —
and reads the world at the end of every season, so drift is found in a report
rather than in year twelve of somebody's save.

It is a developer harness. Nothing in the game imports it (same status as
`src/simulation/match/trace.ts`), and it is deliberately **outside** `npm test`: a
season is minutes of football now that every fixture runs on the new engine.

The normal suite carries a two-season smoke test (`src/simulation/soak.test.ts`)
that checks the season loop, but it is a deliberate check rather than a commit
tax: it is **skipped unless asked for**, because a season through the new engine
is minutes rather than seconds and would otherwise block every test run.

## Running it

```
npm run test:soak                         # the two-season smoke test, on demand
SOAK=1 npx vitest run src/simulation/soak.test.ts   # the same, by hand
npm run soak                              # 10 seasons, seed "soak"
npm run soak -- --seasons=20              # longer
npm run soak -- --seed=soak-scratch       # a specific world
npm run soak -- --club=3                  # take over the fourth club, not the first
npm run soak -- --json=soak-reports/run.json   # write the full report
npm run soak -- --quiet                   # one line a season, no tables
```

Reports written with `--json` go to `soak-reports/`, which is gitignored.

## What it drives

The soak does not reach into internals. It walks the same paths the game walks:

| What | Call | Who else uses it |
| --- | --- | --- |
| One day | `processDay(state, state.date, { resolveUserMatch: true })` | `advanceDays`, `continueTime`, `jumpToDate` (the store) |
| Season close | inside `processDay` → `applySeasonBoundary` → `finishSeason` | the daily engine; nothing calls it directly |
| New season | `startNextSeason(state)` + `publishEvents(state, …)` | `useGameStore.rollOverSeason` (the "start next season" action) |

`resolveUserMatch: true` is the "send it to the bench" path: the XI is picked by
the real selection code (`prepareMatchday` → `buildLineupForClub` →
`autoPickLineup`), the football is the real engine, and the consequences,
finances and news are the real ones. Training runs itself. No recruitment
decision is ever taken — the manager signs nobody — so the squad only moves when
the game moves it. That is exactly what "autopilot" means, and it is why the
soak is a fair reading of the world rather than of the harness.

The one thing it does **not** copy is the store's habit of stopping the clock for
anything that needs the manager. It records those days (`noticedDays`) and keeps
going, because the point is to see the decade; the report says how often the real
Continue button would have stopped.

## What it checks

Each season, at the moment it closes, the world is read and held against the
bands in `SOAK_BANDS` (`src/simulation/soak.ts`). The bands are deliberately
loose: a soak is a drift detector, not a change detector. Season one is the
reference, because season one is the world as generated — the question is never
"is this number right" but "is this number still the number it was".

Failures (`fail`) mean the world is broken: a season that will not close, squads
that cannot field a side, attributes off the 1–20 scale, a save that does not
round-trip, the clock going backwards, the archive written twice, a fixture or
performance pointing at a club, ground or person that has gone.

Warnings (`warn`) mean the world is drifting in a way the *design* has not yet
decided about — a negative balance nobody reacts to, a social link to somebody
who has left. The report prints the failures first, then the warnings, and caps
each invariant at a handful of examples (the full list is in the JSON).

## Reading the report

- **trend** — one row a season across the numbers that matter: squad size,
  ability, age, money, the unattached pool, goals, cards, injuries, days, and
  postponements. A drift is a lean across rows, not a footnote.
- **drift** — season one against the last season, as a sentence. This is the
  headline: what changed over the run.
- **violations** — every invariant that broke, worst first.
- **summary** — how many of each invariant broke.

A run exits non-zero if any `fail` occurred, so it can be wired into CI later if
a nightly soak is ever wanted.

## What the long runs found

### The current build, measured over fifteen seasons

Two seeds, `soak-scratch` and `soak`, both 36 clubs in three divisions of twelve,
450 competitive fixtures a season, both taking over club 3. A fifteen-season run
is **about nine minutes** now (564 s and 536 s; the later pair, run in parallel,
took 597 s and 628 s each, which is contention rather than the world growing): the
county is three times the size it was when this section was first written, and
every fixture runs on the new engine.

**The season loop holds.** In both runs every season closed in 357–364 days, the
ladder kept its size and its shape (36 clubs, 12/12/12) through 32 and 33 folds,
no club ever failed to put eleven fit men out, no squad fell outside 20–30, no
attribute left the 1–20 scale, nobody played twice in a day, and no season ran
past 400 days. Age drift is gone: the median ends at 25–26 and the 90th percentile
at 33 in both runs, against 27 → 35 and 33 → 39 before the youth intake.
Postponements are 20–57 a season, i.e. 4–13% of fixtures, not the 25–30% the
unbounded rearrangement used to produce. The managers' market, the youth intake,
the squad cap and the fold-and-reform cycle all appear in the trend table doing
what they were added to do — `mgrpool` stayed small (0–10), `plgmgr` went 3 → 0 as
the generated player-managers aged out, squads settled at 25–26 under the cap, and
the ladder held its 36 clubs while 32–33 of them folded and reformed.

**What is still failing is the pool's opening size, and nothing else**: three
failures in `soak-scratch` and two in `soak`, every one of them
`unattached-pool-holds` and every one on the low side. Nothing was structurally
broken in either run except the two defects fixed below, and the readings that
matter — the ladder's size, its shape, its separation and its rungs, the age
structure, the clock, the saves — all stand up.

**Fixed in this change**

- **Unbounded fixture rearrangement.** A revised replacement rolled its own
  conditions from its own id, so a game called off in a bad winter could be
  rearranged into the same bad weather and called off again, indefinitely. One
  seed ran a single fixture through twenty-one rearrangements, took the season
  five months past its own calendar and never closed it — which cost the *next*
  season too, because a season that does not end never archives a champion.
  `rescheduleDateFor` now takes a deadline (the last scheduled Sunday plus
  `REARRANGEMENT_GRACE_DAYS = 56`), and a fixture with nowhere to go is
  abandoned on the record with a reason. Over fifteen seasons every season now
  closes in 224–273 days, and there are no `season-closes` failures.
  Regression tests: `src/simulation/postponement.test.ts`.
- **Player-managers left a dangling `managerId`.** A minority of clubs (~18%) are
  run by a player-manager, with `club.managerId` pointing at a squad player. When
  that player retired, `startNextSeason` cleared his club and squad but never
  updated `club.managerId`; `refreshUnattachedPool` then deleted him from the
  world and the club was left pointing at somebody who no longer existed — 16
  cases over fifteen seasons. A player-manager now has no reason to stop
  managing when he stops playing: retirement converts him into the club's
  ordinary (non-playing) manager, an official who keeps his id, so every
  relationship and record still names him and `club.managerId` always names a
  living person. `club-official-exists` failures: 16 → 0.
  Regression test: `progression.test.ts`.
- **The social graph kept links to people who had gone.** `refreshUnattachedPool`
  deleted departed free agents but did not clean their relationships, so the
  in-memory graph accumulated dangling links (2,813 over fifteen seasons) and a
  **reloaded career differed from a running one**, because `rebuildRelationshipIndex`
  prunes them on load. A departure now removes every relationship that named the
  man. `relationship-outlives-person` warnings: 2,813 → 0, and the save-round-trip
  invariant no longer needs the loader's repair accounted for.
  Regression test: `relationships.test.ts`.
- **Two clubs folding in one town in one summer shared a chairman.** The
  replacement *club* id and its random stream were keyed on the club being
  replaced — that fix is in, and its comment says why: two clubs in one town can go
  under in the same summer, and a town-keyed id minted the same club twice. But the
  chairman minted beside it was still keyed on the season and the town. The second
  replacement therefore overwrote the first's chairman in `state.people`, both clubs
  named one man, and the day either club folded again the fold deleted the officials
  it owned and left the other club naming a chairman who no longer existed: six
  `club-official-exists` failures over four seasons of `soak-scratch`, with
  `club_new_season_2029_30_club_13` and `club_new_season_2029_30_club_22` both
  pointing at the same absent man. His id is keyed on the club being replaced now,
  like the club's own, and a regression test folds two clubs in one town and holds
  that the two chairmen are distinct men who are both still in the world.
  `club-official-exists` failures: 6 → 0. Regression test: `clubLifecycle.test.ts`.
- **A newly formed club was minted at its town's standard, not its division's.**
  The replacement club's squad, finances and standing all come from one number —
  its `reputation` — and that number was a fresh draw on the **town**
  (`reputationForTown`), with no reference to the division the club was stepping
  into. Measured on a generated county: the bottom division's clubs stand at 24–38
  with a median of 33, while the town draws for those same clubs run 25–41. A club
  folding in Division Three was therefore routinely replaced by a side of Division
  Two's standard, and a new club could arrive above or below the rung it had
  joined. The rung that churns hardest is the one that climbed. The standing is
  read off the division now — `divisionStanding()` takes the median of the clubs
  already in it, the roll is small and the result is clamped to that division's own
  band, so a replacement can never arrive outside the rung it is joining. The town
  draw survives only as the fallback for a division emptied in one pass; the town
  still decides the new club's name, ground and place.

  Measured over fifteen seasons on both seeds, before and after:

  | reading | `soak-scratch` before | after | `soak` before | after |
  | --- | --- | --- | --- | --- |
  | division 1 drift | +1.2% | +2.2% | 0.0% | 0.0% |
  | division 2 drift | +2.2% | +1.6% | +4.1% | +2.9% |
  | division 3 drift | +6.1% | +2.3% | +3.1% | +2.8% |
  | narrowest gap, top two rungs | 0.140 | 0.280 | 0.230 | 0.350 |
  | tier invariant failures | 2 | 0 | 0 | 0 |
  | county ability drift | +3.0% | +2.0% | +2.4% | +1.9% |

  A gap under 1.5% of the top rung's ability — 0.159 in these worlds — is what
  `tier-stratification` calls a pyramid that is no longer a pyramid. **The top two
  divisions stop converging**: neither seed breaches the separation or the per-tier
  band any more, the narrowest gap between the top two rungs roughly doubled, and
  the bottom rung's climb, which was the whole of the flattening, is gone. In
  `soak-scratch` the top two rungs now move *apart* over the career (0.31 → 0.38);
  in `soak` a slow narrowing remains but from twice as far out, and it never comes
  near the band. Drift between the rungs is now the same size as drift within the
  county, which is what a ladder held up by its own members should look like.
  Regression tests: `clubLifecycle.test.ts` — a rung set to a single standard hands
  its replacement that standard, and `divisionStanding` reads the median, the band,
  and only the living.

**Needs a design decision** (reported, not changed)

- **Squads shrink and the world ages in lockstep — fixed, see below.** This was
  the finding that most shaped the pyramid question: `startNextSeason` only
  topped a squad up while it was *below* 20, every survivor gained a year, and
  there was no youth intake, so the median age rose 27 → 35 and the 90th
  percentile 33 → 39 over fifteen seasons. It is now fixed by the youth intake
  and the squad cap below, and the age distribution settles instead of springing.
- **The pool no longer only grows — it now opens too full.** A summer trims the
  pool to the cap (`POOL_PER_CLUB = 0.8` — 29 men for these 36 clubs) and then adds
  that summer's arrivals back (17 of them, measured), which is what holds the
  settled pool at 42–54; over fifteen seasons there is no lean either way, which is
  what the ±35% band was asking for. What fails is season **one**. The world is
  *generated* with 74 men — 3.36 a town, because the setup call takes
  `generateUnattachedPlayers`' default `perTown: [2, 4]` — while every summer
  refresh arrives at `perTown: [0, 2]`, 0.77 a town. So the first summer sheds a
  third of the pool (74 → 46 in one refresh, measured) and every season after it is
  read against a number the world never returns to. The pool is the only recurring
  failure in both runs (three of `soak-scratch`'s twelve, and both of `soak`'s
  two), and every case is on the low side, at −36% to −40%. This is not a band that
  should be widened: either the world should be generated at the level it settles
  at, or the invariant should read a settled reference. Both change the world a
  manager plays in — a smaller opening pool is a smaller market for recruitment —
  so it is reported rather than changed. `POOL_PER_CLUB`'s own comment still says
  the first season opens with thirty-seven men, which is out of date by a factor of
  two.
- **Money: the strong get rich, the weak die, and the cycle runs hot.** Mean
  balance went 1,483–1,588 → 12,230–17,517 over fifteen seasons and the largest
  balance 4,633 → 88,745, while 4–11 clubs sat in the red *every* season (7 and 5
  of them at generation, before a ball was kicked) and 29–33 clubs folded — about
  two a season, one club in seventeen. The design decision behind the cycle
  (`clubLifecycle.ts`) is sound and the ladder never lost its size, but this is a
  much hotter churn than the three-folds-in-fifteen-seasons it was first measured
  at, and it is the largest single source of noise in the world: it is also what
  re-stocks the bottom tier (see the ladder finding below). Worth reading beside
  the finance tuning rather than changing here.
- **The ladder is held by its rungs now; what is left of it is money.** Before the
  rung fix the county's drift was all *between* the divisions — division 3 climbed
  while division 1 stood still — and county-wide ability was the smaller story
  (+2.4% to +3.0%, against the +8–9% this section used to report, most of it taken
  out by the youth intake and the arrival curve). That is fixed above. What the fix
  leaves behind is money: a replacement now takes its division's standard, and
  `buildFinances` is scaled by standing, so the bottom rung's new clubs are poorer
  than the town average they used to be minted at. `club-in-the-red` warnings went
  110 → 112 and 96 → 108, and folds 32 → 32 and 29 → 33. That is the fold cycle
  working from a truer picture rather than a new fault, but it is the same knob as
  the finance bullet above, and the two should be read together.
- **Postponements are no longer a problem.** 20–57 a season across the four runs,
  i.e. 4–13% of fixtures, against the 25–30% of the run-away era and against the
  5–10% a real Sunday league sees. The tallest season (57) is still nearly three
  times the quietest (20), which is what a winter should do to a fixture list.

**Defects found and fixed**

Every structural defect the soak has found is fixed (details above): the
player-manager's dangling `managerId`, the relationships that outlived the person
they named, and the chairman two replacement clubs shared.

The chairman fix was measured as a clean A/B — the same seed, the same fifteen
seasons, before and after. All fifteen season snapshots are identical apart from
their timings (squad size, ability, age, money, the pool, goals, cards, days,
postponements, folds), and the only thing that changed in the report is that
`club-official-exists` went from six failures to none. The defect was a dangling
reference and nothing else, which is what it looked like in the code and is now
what the run says.

So twelve failures became six, and all six are the drift bands:

| Invariant | `soak-scratch` before | after | `soak` |
| --- | --- | --- | --- |
| `club-official-exists` | 6 | — | — |
| `unattached-pool-holds` | 3 | 3 | 2 |
| `tier-stratification` | 1 | 1 | — |
| `tier-ability-stable` | 1 | 1 | — |
| `goals-stable` | 1 | 1 | — |
| `club-in-the-red` (warn) | 110 | 110 | 96 |

Then the rung fix (above) took the two tier failures with it, and the two seeds now
report the pool and nothing else:

| | `soak-scratch` | `soak` |
| --- | --- | --- |
| failures | 3, all `unattached-pool-holds` | 2, both `unattached-pool-holds` |
| warnings | 112, all clubs in the red | 108, all clubs in the red |

Against 67 failures and 2,813 warnings when this section was written, with age
drift gone entirely and the one open question above — the pool's opening size —
being a generation decision rather than a fault.

**And the headline answer to the pyramid question:** other clubs make almost **no
between-season decisions**. They have results, money, injuries, cards and history
simulated, and they age, retire, take on youths, release their oldest and receive
top-ups, fold if the money runs out, and change manager once a season. What they
still do not do is *sign* anyone: there is no transfer market, no tactics changes
and no reaction to a rival's strength. What is left of the long-run drift traces
back to that — and the rung fix above is the useful lesson in it. Tying a new
club's standard to the division it enters was enough to stop the bottom rung
climbing, and it needed no transfer market at all: it needed the world to hold a
club to the standard of the rung it plays on. The rest of the pyramid slice is the
same shape of question.

**Now added: the managers' market.** `src/simulation/managers.ts` runs at the
season boundary and gives managers a life: they age, retire at 68, step down
from 60 or after a long stint, are sacked when a finish falls far below what the
club's reputation expects, and are poached by a better local club. Vacancies are
filled from a pool of men between jobs, from the assistant or coach already in
the building, or by a player-manager — and, if none of those, by a generated
manager, so a post is never left empty. Careers ending (men leave the world at
68) and a pool that is both refilled and trimmed (4–12) are what stop a long
career filling up with managers; the trend table now shows `mgrpool` steady at
the floor and `plgmgr` (players running their own side) ticking down as the
generated player-managers age out.

The player's **own** manager is deliberately held out of the market for now
(`protectedManagerIds`). Making results cost *him* his job is a career-level
decision — a new club, a spell in the pool, or the end of the career — and is
left for its own change rather than guessed at here.

**Now added: the youth intake and the squad cap.** Every summer each club takes on
one or two teenagers (aged 16–18) at a quality a shade below the senior standard,
and no club carries more than 26 players, so the oldest surplus is released.
That two-sided flow is what stops the median age springing upward: the median now
rises 27 → 28, then settles at 25–26 for the rest of the career, and the 90th
percentile comes back from 35 to 31–33. The `age-distribution-stable` invariant
had to be told the difference between drift and design — the 10th percentile
*should* drop when teenagers arrive — so p10 now has a wider band (`ageP10Tolerance`)
while p50 and p90 keep the tight one. See `SQUAD_REFRESH` in `season.ts`; the
youth intake is guarded by the two-season smoke test and the fifteen-season soak.

**Now added: clubs can fold and reform.** `src/simulation/clubLifecycle.ts` runs
also at the season boundary. A club that ends the season in the red goes into
administration — a standing hit, a news item, and a warning that the clock is
running — and a club still in the red after three seasons (or catastrophically
in debt) folds: its players and committee leave the world, its ground falls
vacant, and it moves to the archive with `active: false`. A new club forms in the
same town, on the same pitch, with a fresh squad and committee, and takes the
place in the division. The old finding — that no club was ever in the red — is
gone, and the new `division-size-stable` invariant holds the whole point
of the cycle: the league keeps its size however long the career runs. On the
fifteen-season scratch run three clubs fold and are replaced, and the `folded`
column in the trend table shows it.

**Phase 2 changed what a club is told to do in August, so the football baselines
move.** The football-intelligence layer (`src/simulation/ai/`) gives every AI club
an identity derived from its standing and a manager who reads the afternoon, and
opening instructions are now drawn from standing rather than from an even scatter
across the county: the sides with the players have a go, and the sides without them
sit deep and get it forward. Anything below that reads world *content* rather than
structure — goals, shots, cards, the football columns of the trend table — was
measured on a world of a different shape and should be re-baselined from a fresh run.
The invariants themselves are untouched, and the two-season smoke test and the
season-boundary suites pass on the new world. The fifteen-season soak was **not**
re-run for this phase: `npm run benchmark` is what caught the one real problem here
(an opening instruction mix that took the watched engine to 25 shots a match against
the background model's 17) and what measured the answer to it.
