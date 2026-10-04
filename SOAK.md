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

## What the first long runs found

Measured over **15 seasons**, seed `soak-scratch` (the seed that first exposed
the season-close runaway), 12 clubs, ~185 fixtures a season, ~72 seconds.

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

**Needs a design decision** (reported, not changed)

- **Squads shrink and the world ages in lockstep — fixed, see below.** This was
  the finding that most shaped the pyramid question: `startNextSeason` only
  topped a squad up while it was *below* 20, every survivor gained a year, and
  there was no youth intake, so the median age rose 27 → 35 and the 90th
  percentile 33 → 39 over fifteen seasons. It is now fixed by the youth intake
  and the squad cap below, and the age distribution settles instead of springing.
- **The unattached pool only grows.** Arrivals (`perTown: [0, 2]` a season) outpace
  departures (only at 38–41), and nothing caps it: 28 → 105 unattached, a 2.75×
  rise, monotone. A pool that only fills is a drain on the world and a sign nobody
  is consuming it.
- **Money has a failure state now (added below), but balances still mostly
  rise.** A well-run club earns more than it spends, so the mean balance still
  climbs over a career — the difference is that a badly-run club no longer
  survives forever. The trend table's `bank` column and the `folded` counter are
  the two halves of the same story: profit for the strong, death for the weak.
- **Slow upward drift in ability and goals.** Mean ability +8–9% over fifteen
  seasons (and the spread narrows); goals a match +10–18%. Top-ups are generated
  at `quality = 9 + club.reputation/20`, and reputation only rises, so the world
  inflates. The youth intake made this visible rather than causing it: before the
  intake, ageing squads dragged the average back down and hid the inflation; now
  the league stays young and the drift shows. Lowering youth quality to `8 +
  reputation/20` keeps it near the ±8% band at fifteen seasons, but it still
  creeps past over twenty-five. The root cause is the steady stream of aspirational
  top-ups against a reputation that only rises — the same reputation/quality
  feedback loop as the managers' market. Too slow to matter this season, too fast
  to ignore over a career.
- **Postponements are still frequent.** With the fix in place the rate is roughly
  25–30% of league fixtures, down from the run-away rates but still well above the
  5–10% a real Sunday league sees. The congestion is *bounded* now; whether it is
  *believable* is a tuning question.

**Defects found and fixed**

Both real defects the soak found are fixed (details above): the player-manager's
dangling `managerId` and the relationships that outlived the person they named.
With the managers' market, the fold-and-reform cycle and the youth intake all in,
the same fifteen-season scratch run now reports **13 failures and 1 warning**
(was 67 failures and 2,813 warnings): twelve of the failures are the unattached
pool and one is a single goals season. Age drift is gone entirely, and about the
only remaining unbounded drift is the pool.

**And the headline answer to the pyramid question:** other clubs make almost **no
between-season decisions**. They have results, money, injuries, cards and history
simulated, and they age, retire, take on youths, release their oldest and receive
top-ups, fold if the money runs out, and change manager once a season. What they
still do not do is *sign* anyone: there is no transfer market, no tactics changes
and no reaction to a rival's strength. Every remaining long-run drift above
(the unattached pool, the slow ability inflation) traces back to a world where
clubs never buy and sell, and has no correcting force. The pyramid slice will
need that club agency, not just more clubs.

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
