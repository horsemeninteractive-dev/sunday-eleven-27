# Touchline Architecture

> **Touchline decides what happens. Presentation shows what happened.**
>
> Touchline is the authoritative football simulation of Sunday Eleven 27. It is not
> the renderer, not the match screen, not the commentary, and not a second visual
> simulation. Everything that decides a football outcome lives inside it, once, and
> everything else — the 2D pitch, a future 3D view, the text, the statistics, the
> post-match report — reads what Touchline already decided.

This is the system document: what Touchline is, what it owns, how a match flows
through it, what the consolidation pass actually changed, and the honest list of
what still violates the architecture. [`MATCH_ENGINE.md`](MATCH_ENGINE.md) is the
detailed resolution's own design.

---

## Current authoritative simulation

The single chain, and where each link lives:

```text
MATCH INPUT            MatchEnvironment  (simulation/matchday.ts)
      ↓
TOUCHLINE              src/simulation/touchline/     ← the one boundary a consumer imports
      │
      ├── detailed     MatchEngine            src/simulation/match/matchEngine/engine.ts
      │                owns MatchEngineState  src/simulation/match/matchEngine/types.ts
      │
      └── abstract     simulateMatchFast      src/simulation/fastMatch/simulate.ts
                       owns a private FastContext
      ↓
AUTHORITATIVE STATE    MatchEngineState (live)   ·   Match (the record, once played)
      ↓
EVENTS / STATE CHANGES matchEngine/events.ts :: emitEvent   ·   fastMatch's own emit
      ↓
PRESENTATION           src/presentation/ · src/ui/match/   — readers, all of them
```

| | Detailed resolution | Abstract resolution |
| --- | --- | --- |
| **What it is** | the authoritative engine a manager watches, plays at speed, or sends to the bench | the background model every other fixture is decided by |
| **Authoritative state** | `MatchEngineState`, owned by `MatchEngine`, built by `createEngineState` | a private `FastContext` inside `simulateMatchFast` |
| **Fixed step** | `SIMULATION_STEP_SECONDS` (1/30 s), seeded by step index | one minute at a time |
| **Entry point** | `createMatchEngine(match, env, options?)` → `MatchEngine` | `simulateMatchFast(match, env)` |
| **Also reachable as** | `simulateMatchFull`, `simulateMatchHeadless`, `simulateMatchEngine`, `engine.runToCompletion()` | `simulateFixture(match, env, 'fast')` |
| **The one door** | `simulateFixture(match, env, simulationModeFor(state, match))` — `day.ts::applyFixturesSteps` | same |
| **The one policy** | `simulationModeFor`: `involvesUser ? 'full' : 'fast'` (`fastMatch/mode.ts`) | same |
| **What it writes** | `match.result`, `match.events`, `match.performances`, `match.possessionTicks`, `match.stoppage`, `match.substitutions`, `match.simulationMode`, `match.status/played/minute/half/period`, `match.shootoutWinnerId` | the same fields, at a higher level of abstraction |
| **Names in the code** | `matchEngine/`, `MatchEngine`, `MatchEngineState` — deliberately **not** renamed | `fastMatch/`; the mode strings stay `'full'` / `'fast'` |

Both resolutions obey one set of **laws** — `src/simulation/match/laws.ts`: which
restarts exist, where each is placed, how long each is given, who takes it, what a
strike from one is worth, what a foul becomes, and how many changes a side may
make. What is *measured* rather than *lawed* stays with the resolution that
measured it (`FAST_CALIBRATION`).

`src/simulation/touchline/index.ts` is the boundary: the vocabulary
(`TouchlineState`, `TouchlineEvent`, `TouchlineMatch`, `TouchlineResult`,
`TouchlineResolution`), the door, both resolutions, the state-reading helpers and
the laws. It is a surface, not a wrapper — nothing in it does work.

---

## Simulation lifecycle

How a match progresses, in the order the code runs it.

### Choosing a resolution

```text
day.ts :: applyFixturesSteps                        gameStore.ts / liveEngine.ts
        │                                                     │
        └─ simulateFixture(match, env, …)          simulateMatchFull / createMatchEngine
        │        │                                            │
        │        └─ simulationModeFor(state, match)            │
        │                involvesUser ? 'full' : 'fast'       │
        ▼        ▼                                            ▼
   fastMatch/simulate.ts                          matchEngine/engine.ts
   (abstract resolution)                          (detailed resolution)
```

### A step of the detailed resolution

```text
MatchEngine.step(dt)  →  advanceStep(dt)                    dt = state.stepSeconds (1/30 s)
  1. track the time the ball is dead (added time is measured, not guessed)
  2. refresh the tactical reading every 12 s; review benches every 30 s; roll knocks on their own cadence
  3. the step's own RNG, seeded from the step index — so the football at step n is the same however it was driven
  4. non-football phases: goal hold · interval · final whistle
  5. else: if a set piece is arranged → advanceSetPiece
          otherwise                    → updateDecisions
  6. stepMovement(state, dt)        players and ball, one fixed step
  7. resolveInteractions(state, …)  control · tackles · fouls · shots · goals · the ball leaving play
  8. stepStamina(dt) → advanceClock(dt) → advancePossessionClock(dt, open play only) → afterStep → checkPeriodEnd()
```

Every outcome is settled by that loop; nothing outside it contributes a fact.

### A match, end to end

```text
kick-off (a set piece)              engine.setStatePiece('kickoff', …) → beginSetPiece
      ↓
open play                           updateDecisions → stepMovement → resolveInteractions
      ↓
an event: the ball leaves play, a foul, offside, a shot that beats the keeper
      ↓
set piece, or the goal phase        beginSetPiece(…)  ·  scoreGoal → phase 'goal' → hold → kick-off
      ↓
half-time                           checkPeriodEnd → phase 'half-time'; the clock waits for startSecondHalf()
      ↓
second half                         beginPeriod('second-half') → kick-off on the same unbroken clock
      ↓
full-time                           finish(): status/played/minute/half/period, result, possessionTicks,
                                    per-player energy, ratePerformances()
```

`architecture.test.ts` drives exactly that sequence, step by step, over three
seeds, and asserts it — see **How this is verified**.

### The abstract resolution's lifecycle

```text
simulateMatchFast(match, env)
  ensurePerformances → per side: computeTeamStrength + tacticalProfile
  walk the match a minute at a time:
      a shot · a foul · a booking · a knock · a substitution · (rarely) a penalty
  a shot is settled from the attacker's quality against the keeper's
  a level knockout tie plays extra time, then penalties
  write the record: result · events · performances · possessionTicks · stoppage · substitutions
```

### One clock

The football clock is `MatchEngineState.clock`, advanced only by `advanceClock` in
the engine's fixed step. The presentation decides **how much football is asked
for**, never the time itself: `MatchView`'s `requestAnimationFrame` pump calls
`gameActions().advanceSpatial(delta)`, which asks the engine to have played exactly
as far as the playback cursor has reached (`engine.advance(need, …)`), and the
engine converts real seconds into whole fixed steps and a carried remainder. The
clock is displayed at whatever visual rate the manager chooses; the football is the
same at 1×, at 8×, or skipped entirely.

```text
Touchline:   state.clock = 89:58.4
Renderer:    draws the interpolated 89:59.5 → 90:00 with simulationAlpha(state) = residual / stepSeconds
```

### Randomness

Random outcomes originate in the simulation, never in an animation:

- both resolutions draw from `stream(seed, label…)` (`simulation/rng.ts`), seeded
  from `match.seed`; there is no `Math.random` in either resolution;
- the detailed resolution reseeds **per step** from the step index
  (`engineStepSeed`), which is why the football at step *n* does not depend on how
  it was driven;
- management decisions, injuries and the shootout each have their own labelled
  stream, so one of them can never perturb the football's draws;
- the presentation rolls nothing at all — verified by a source guard in
  `architecture.test.ts`, and there is no replay-from-seed system, because the
  record and the optional recording already carry the afternoon.

---

## State ownership

**One authoritative state per match, and the simulation is its only writer.**

| State | Where it lives | Who writes it |
| --- | --- | --- |
| A match being played | `MatchEngineState` (`matchEngine/types.ts`), owned by `MatchEngine`, reached read-only through `engine.getState()` | the engine's own step loop, and nothing else |
| The record | `Match` (`domain/match.ts`) | the resolutions, at the whistle and at every drain |
| The clock, the phase, possession, the ball, the players, cards, set pieces, stamina, stats | fields **of** `MatchEngineState` | the step loop, through the modules below it |

The same `MatchEngineState` object is carried from the kick-off to the final
whistle: a set piece does not get its own state, a goal is a phase of the same
state, and a renderer is handed that state (or a *window* onto it) rather than a
copy. `architecture.test.ts` asserts the identity of `engine.getState()` on every
step of three whole matches.

**`match.possessionTicks` has one writer.** It is written by `MatchEngine` — at the
whistle in `finish()`, and mid-match in `mirrorPossession()`, which runs inside
`drain()` because draining *is* the hand-over: it is the moment the engine gives
the outside world everything it has decided. The store used to mirror the running
total onto the match after every drain; that second writer is gone, and a source
guard in `architecture.test.ts` fails if the store or the presentation ever writes
`possessionTicks` or `match.result` again. In the abstract resolution the record
*is* the state, and it is written once, at the end, by `simulateMatchFast`.

Two pieces of state deliberately live beside the match rather than inside it, and
both are presentation:

- `LivePlayback` (`state/liveEngine.ts`) — the cursor in simulation seconds and
  whether a skip is running;
- the viewing mode, the speed and the chosen renderer — the manager's, on the
  session and in preferences.

---

## Event ownership

**One vocabulary, one writer, many readers.**

- The detailed resolution writes every event through
  `matchEngine/events.ts::emitEvent`, which pushes onto `match.events` (the record
  the whole game reads) *and* onto `state.pendingEvents` (the feed a running match
  drains). The minute it stamps is the one the clock *reads* — rebased per period,
  with added time measured — not the raw count of seconds.
- The abstract resolution writes them through its own `emit`, which uses the same
  `makeEvent` constructor, so the id scheme, the `clubId` resolution and the
  `scoreAfter` field mean exactly the same thing in both.
- Nothing else creates an event. The presentation turns events into commentary,
  animation, indicators and statistics, and `presentation/matchSignals.ts` projects
  the one stream into the shared signal vocabulary — a projection, never a second
  account.
- `MatchEventType` is the shared vocabulary: goals and penalties, shots, fouls and
  cards, offside, injuries, substitutions, the restarts (corner, throw-in goal
  kick), the period whistles, and the ordinary texture (pass, carry, tackle) that
  the detailed resolution alone produces.

Draining is also where the record is reconciled with the engine's own clock (see
**State ownership**), so a reader that drains gets a state and a record that agree.

---

## Set pieces

A set piece is **a phase of the same match**, not a mini-game and not a second
engine. `MatchPhase` and `SetPieceState` are states of `MatchEngineState`, so the
match state continues throughout:

```text
                     OPEN PLAY  (phase: 'open-play')
                          │
              an event occurs — the ball leaves play, a foul, offside, a goal
                          │
             beginSetPiece(state, kind, side, spot, order)
                          │
                 SET PIECE STATE   phase: 'kickoff' | 'corner' | 'throw-in'
                 ┌──────────────────────────────────────────────┐  | 'goal-kick' | 'free-kick' | 'penalty'
                 │ setup      ball dead on its spot; the men walk into place │
                 │ delivery   the taker plays it; the ball travels          │
                 │ resolution the ordinary control/aerial/shot rules apply  │
                 └──────────────────────────────────────────────┘
                          │
                     return to OPEN PLAY
```

| Restart | Begins in | Notes |
| --- | --- | --- |
| kick-off | `MatchEngine.setStatePiece`, `beginPeriod` | every period opens with one; the restart after a goal goes to the side that conceded |
| throw-in | `resolve.ts::checkOutOfPlay` | taken from the line by a named thrower |
| goal kick | `resolve.ts::checkOutOfPlay` | ball over the goal line off an attacker |
| corner | `resolve.ts`, and off a blocked shot | off a defender; some blocks ricochet instead |
| free kick | `resolve.ts`, `offside.ts` | one phase carrying a `direct` flag — see the debt below |
| penalty | `resolve.ts::commitFoul` | a foul in the defending side's own box; keeper on his line, everyone else out |
| half-time | `engine.ts::endPeriod` | the one phase where the clock deliberately waits |
| full-time | `engine.ts::finish` | a set piece cannot outlive the whistle |
| extra time | `periods.ts` (`extra-first`, `extra-second`) | an `extra-time` *event*, but not a phase — see the debt below |

Everything is arranged, delivered and resolved inside the same `step(dt)` loop, and
possession is **not** counted while a restart is being arranged — a corner being
walked up to is not football being played.

### The catalogue is shared (`laws.ts`)

The consolidation moved the *knowledge of the restarts* into one module both
resolutions read, so the abstract one is no longer ignorant of anything but
penalties:

| In `laws.ts` | Value |
| --- | --- |
| `RESTART_KINDS` | kickoff · throw-in · goal-kick · corner · free-kick · penalty |
| `RESTART_SETUP_SECONDS` | how long each is given to arrange (`matchEngine/setPieces.ts` reads it) |
| `restartSpotFor` | the geometry — the engine re-exports it as `spotFor`, and `resolve.ts` is untouched |
| `RESTART_TAKER` | the taker rule per restart: keeper for a goal kick, nomination-or-best for a penalty, nearest otherwise |
| `RESTART_STRIKES` | what a strike directly at goal is worth, walked as a ladder of shares |
| `penaltyTaker` | the nomination wins; each resolution supplies only its own reading of "best available" |

The manager's nominated penalty taker is now honoured by the **detailed**
resolution too (`SetPieceOrder.takerId` from `setPieceRoutinesFor`), which used to
be a promise the tactics screen made and only the background model kept.

What stayed in the engine is what is genuinely the engine's: the arrangement (who
stands where while the ball is dead), the delivery, and the resolution. The laws say
what a restart *is*; the engine plays it.

---

## Presentation

**Verified: the presentation decides no football, and writes none of the record.**

`presentation/matchEnginePresentation.ts` is the seam:

```text
MatchEngine.getState()  →  buildEngineRenderState(engine, match, game)  →  MatchRenderState
                            (a window, not a fork)                          (renderContract.ts)
```

- Every array in `MatchRenderState` is the engine's own — the players, the ball, the
  actions — so a renderer cannot hold a divergent copy.
- `alpha: () => simulationAlpha(state)` is a closure over the engine's `residual`:
  the only piece of maths a renderer is allowed is the interpolation between the
  step a thing was at and the step it is at, and it costs no React render.
- `celebrationOf` reads the goal that is already on the record; `signalsOf` projects
  the events into the shared vocabulary.

`presentation/matchPresentation.ts` builds the same shape for the cases with no live
engine, and reads exactly two authorities, in this order:

| Source | When | What it gives |
| --- | --- | --- |
| the record the cursor reveals | a replay | events so far, a focus point, and the real movement if the match was watched |
| the match's own record | neither — before kick-off, an unwatched fixture, an old save | `phaseFromRecord` (over, or waiting to start) and `possessionFromRecord` (the engine's ticks) |

There used to be a third: the match's own continuous state, read off `match.spatial`.
Nothing produced it, so the row was dead — and the phase was read from `match.field`,
which was never written on a match the real engine played, so it silently fell back
to `'kickoff'` every time. Both are gone with the legacy family. A watched match does
not come through this file at all: it has an engine, and reads it through
`matchEnginePresentation`. Nothing in the presentation reads dead state now, and
nothing writes `possessionTicks` or `match.result` — both guarded by tests.

`liveEngine.ts` creates the engine, hands it the real time the match view has spent,
stamps `match.simulationMode = 'full'` at the one place the engine is chosen, and
drains events into the commentary. It writes nothing onto the match's record.

Both files import the simulation **through the boundary**
(`@/simulation/touchline`), so the surface a reader may use is one reviewed list.

---

## Fast simulation

The abstract resolution exists so the ~40 fixtures a week nobody watches cost ~2 ms
each instead of ~1 030 ms. It is a **different resolution of the same football, not
a different football universe**.

### Shared today

| Shared concept | The shared symbol |
| --- | --- |
| The inputs | `MatchLineup`, `Player`, `Tactics`, `MatchConditions`, referee, crowd — assembled by `matchEnvironment` (`simulation/matchday.ts`) |
| Team quality | `computeTeamStrength` (`match/teamStrength.ts`) |
| A player's real output | `playerEffectiveness`, `positionRoleWeights`, `conditionFactor` |
| Tactics, pitch and weather | `tacticalProfile`, `conditionEffects`, `setPieceRoutinesFor` (`match/tacticsModel.ts`) |
| Injuries | `pickInjury`, `BASE_INJURY_RATE`, `INJURY_CHECK_SECONDS` (`matchEngine/injuries.ts`) |
| Action judgement | `weighActions` (`match/actions.ts`) |
| Randomness | `stream(seed, label…)` (`simulation/rng.ts`); no `Math.random` in either resolution |
| Record construction | `makeEvent`, `attackingCoordinates` (`match/core.ts`); `ensurePerformances` (`matchEngine/state.ts`) |
| The result contract | `Match` — `result`, `events`, `performances`, `possessionTicks`, `stoppage`, `substitutions`, `shootoutWinnerId` |
| Competition rules | `league.ts`, `cup.ts`, `forfeit.ts`, `applyMatchConsequences` — they read the record and never know the mode |
| **The laws** | **`match/laws.ts`** — the restarts (kinds, geometry, timing, taker), the penalty's own ladder, the card ladder, and the changes allowed |

### Still parallel, deliberately

The two resolutions model **outcome probabilities separately**, and this pass did
not pretend otherwise:

```text
  shared:    inputs · judgement · randomness · contract · rules · the laws
  measured:  the chance-quality → conversion model (FAST_CALIBRATION)
             the open-play save/block/off-target shares
             the shots, fouls and bench cadence constants
```

`FAST_CALIBRATION` is a hand-calibrated parallel of something the detailed
resolution produces emergently. `npm run benchmark` prints both fingerprints side
by side, so drift is visible rather than argued about — see **How this is
verified**.

### What the abstract resolution still does not model

Corners, throw-ins and goal kicks as events or statistics (it knows the *laws* of
them now, but a background fixture still produces no restart events), player and
ball movement, the step loop, renderer state, the replay recording, the commentary,
and the ordinary-play texture (~2 400 pass/carry/tackle events a watched match
against ~80 meaningful ones in the abstract). Every one of those exists for a
**watcher**, and no watcher ever opens a background fixture; producing them would
bloat every save to say nothing to anybody. They are listed as debt, not as design.

---

## The ownership audit — all fourteen questions

Traced call paths, not filenames. Line numbers drift; symbol names are the stable
pointers.

| # | Question | Answer |
| --- | --- | --- |
| 1 | Authoritative match state | `MatchEngineState` (`matchEngine/types.ts`), owned by `MatchEngine`, built by `createEngineState` — detailed. A private `FastContext` inside `simulateMatchFast` — abstract. The persisted contract is `Match` |
| 2 | Advances simulation time | `MatchEngine.advanceStep` ← `step` ← `advance` ← `runToCompletion`; fixed `state.stepSeconds`, seeded by step index. Abstract: the minute loop in `simulateMatchFast`. **Presentation never advances time** |
| 3 | Decides possession | `resolve.ts` (`checkArrival`, `checkInterception`, `checkKeeperCollects`, `pickUpLooseBall`, `checkTackles`) through `ball.ts` (`giveBallTo`, `releaseBall`); counted by `advancePossessionClock`, open play only, mirrored onto `match.possessionTicks` by `MatchEngine.drain`/`finish`. Abstract: derived from `TeamStrength` → `match.possessionTicks` |
| 4 | Decides player actions | `decisions.ts` (`updateDecisions`, `decideOnBall`, `decideKeeper`, `shapeTargetFor`), consulting the shared `weighActions` |
| 5 | Determines ball movement | `movement.ts` (`stepPlayers`, `stepBall`, `stepMovement`) with geometry from `pitch.ts`; the ball is a first-class `BallNode` |
| 6 | Resolves challenges/tackles | `resolve.ts::checkTackles` → `commitFoul`, reading `playerEffectiveness` for both men |
| 7 | Resolves shots/goals | `decisions.ts::recordShot` sets the `ShotOutcome`; `resolve.ts` carries it out (`checkGoal` → `scoreGoal`, `checkSavedShot`, `checkBlock`, `checkWoodwork`). Abstract: the shot roll from `FAST_CALIBRATION` |
| 8 | Resolves fouls/cards | `resolve.ts::commitFoul` → `judgeFoul` → the shared `cardForFoul` (booking, second booking, straight red). Abstract: `resolveFoul` through the same shared law with its own chances |
| 9 | Handles set pieces | Detailed: **first-class phases** — `setPieces.ts::beginSetPiece`/`advanceSetPiece`, entered from `resolve.ts`, `offside.ts`, `engine.ts`. Abstract: penalties only, through the shared ladder |
| 10 | Handles substitutions | `management.ts` (`substitute`, `reviewBenches`, `autoManageBench`), the human's change from `gameStore.makeSubstitution`, AI on its own stream; the allowance is the shared `changesAllowed`. Abstract: the bench check |
| 11 | Generates match events | `events.ts::emitEvent` → `match.events` + `pendingEvents`, drained by `drainEvents`. Abstract: `simulateMatchFast`'s `emit`. One vocabulary: `MatchEventType` |
| 12 | Produces statistics | `TeamMatchStats` accumulated by `events.ts::statsFor`; per-player `match.performances`, rated at the whistle in `ratePerformances`. Abstract: written by `simulateMatchFast` |
| 13 | Determines the final result | `MatchEngine.buildResult()` → `match.result` (detailed); `simulateMatchFast` (abstract); `forfeit.ts` (no ball kicked). Three writers, all of them Touchline's, all of them live. Shootouts in `resolveShootout` |
| 14 | Merely displays state | `presentation/*` (render contract, engine presentation, signals, timeline, playback, replay, renderers) and `ui/*` (pitch, feed, stats, phases, MatchView), plus `matchEngine/narrate.ts` + `match/passages.ts` for the words |

---

## Future 3D

3D must be **another renderer over the same simulation**, never another engine. The
contract for that already exists and is deliberately renderer-neutral:

- `presentation/renderContract.ts` declares `RendererKind = '2d' | '3d'`, and
  `MatchRendererDefinition.available` lets a chosen-but-unbuilt renderer fall back
  to 2D instead of showing a hole.
- `presentation/matchRenderers.tsx` is the registry; `MatchPitch.tsx` is the only
  implementation today.
- Switching renderer changes **which component is mounted** and nothing else: the
  clock, positions, possession, events, commentary, speed and result are held above
  the renderer, so a swap is a paint, not a restart.
- `MatchRenderState` says where people are and what they are doing — not whether
  they become dots on a pitch or meshes in a scene. If a 3D view needs something the
  state does not carry, **the state grows a field**; the renderer does not start
  inferring football.

---

## Naming: what is and is not renamed

> **Do not blindly rename `matchEngine` to Touchline.**

- **`Touchline` is the name of the system**, used in prose, in this document, at the
  top of the two resolutions, and as the name of one module:
  `src/simulation/touchline/` — the boundary described above.
- **`matchEngine/`, `MatchEngine`, `MatchEngineState` keep their names.** They are
  read by dozens of tests and tools, and the directory names the *detailed
  resolution*, not the system.
- **`Match.simulationMode` values stay `'full'` / `'fast'`** — they are written into
  saves. The resolutions are described in prose as the **detailed** and **abstract**
  resolutions.
- **`MatchPhase` is two types, and that is still true after the deletion**: the
  engine's (`matchEngine/types.ts` — `'kickoff' | 'open-play' | …`, what the football
  is doing) and the domain's (`domain/match.ts` — `'build-up' | 'progression' | …`,
  what a renderer is told). The engine's phase is cast onto the domain's in
  `matchEnginePresentation.ts`; the vocabulary is thinner than the football and is
  listed as debt (D8).
- **`TOUCHLINE_Y` is gone, and its geometry is now the engine's own.**
  `laws.ts::TOUCHLINE` states where a ball on the touchline sits — `pitch.ts`'s
  `MIN_Y`/`MAX_Y`, which is also where a player is clamped — and both the throw-in
  and the corner are placed by it. The retired constant lived in the legacy
  `restarts.ts` and placed a throw a fraction differently from the way the engine
  clamps a man.
- New names added by the two Touchline passes, rather than renames:
  `src/simulation/touchline/` (the boundary) and `src/simulation/match/laws.ts`
  (the shared laws).

---

## First boot, startup and branding — what was built

Two separate things, which the brief requires stay separate. The save-loading
placeholder was not touched at all; the first boot is a screen of its own.

### The two boot concepts, kept apart

| | Existing: loading a save | New: first launch, no save |
| --- | --- | --- |
| What it is | storage opens and old careers migrate before the first frame | a short branded startup introducing Touchline |
| Where it lives | `index.html`'s inline `#booting` placeholder (with its own literal styles, because it paints before the bundle), `src/main.tsx` (`bootStore().finally(… remove '#booting')`), and `App.tsx`'s `booting--inline` fallback for `!ready` | `src/ui/views/FirstBootView.tsx`, reached from `App.tsx`'s `if (!game)` seam |
| Why it exists | the store must know whether there is a career before it can honestly show a menu | a first impression |
| Rule | **kept, and still honest** — not a splash, not repurposed, and shown only while there is something to open | not a loading screen: there is nothing being waited for, and it is shown once |

### Where the first-boot sequence lives

`App.tsx::screen()`'s `if (!game)` branch, in front of `<StartView />`. The decision
is one call to a function that exists in order to be read and tested —
`shouldShowFirstBoot({ seen, hasSaves, atMenu })`, in `src/state/firstBoot.ts`:

```text
store ready · nothing reopened · nothing saved here · sequence not yet seen · on the menu
        → FirstBootView (Touchline, then the game)
        → SE27 mark / main menu (StartView)
```

- **`seen`** is one `localStorage` key of its own — `slfm26.firstBoot`, read and
  written by `src/state/firstBoot.ts` with the same defensive storage pattern as
  `preferences.ts` and `managerProfiles.ts`. It is deliberately *not* a field on
  `Preferences`: nothing about it is a choice the manager made, and the settings
  screen has no business offering to switch it on or off. It is written when the
  sequence ends, however it ends — it running out, **Skip intro**, or Escape.
- **`hasSaves`** is published by `bootStore` beside `ready`. The two answer
  different questions: `game` says whether a career was **reopened**, and
  `hasSaves` says whether there is one **on disk**. Quitting to the menu clears the
  resume mark and keeps the whole season, so a menu that asked only the mark would
  say "nothing saved" to a manager with a season saved — and would introduce him to
  Touchline as though he had never played.
- **`atMenu`** keeps the sequence out of the way of a setup already under way. The
  profile step and the club designer are reached *from* the menu, and nothing should
  pull a manager back to the beginning of a flow he is in the middle of.
- The view is imported **eagerly** by `App.tsx`, beside `StartView` and for the same
  reason: it is painted before anything else can be, so it cannot be allowed to wait
  for a chunk. It is the one deliberate exception to the lazy view registry.

It ends on its own — 2.9 s at full motion, 0.9 s with motion reduced, because
nothing is moving in that case and there is only a line to read — and it can be
ended early: **Skip intro** is a real `<button>` in the tab order with a name, and
Escape does the same thing. All three routes run the same guarded `finish`, so
"seen" means seen, skipped or dismissed, and the sequence cannot come back.

Nothing about the first boot touches the save flow. It runs *after* the store has
already opened and decided there was nothing to reopen, and it hands over to the
menu the save list was read for.

### Where a future Touchline logo asset belongs

The project already has a clear asset convention, so nothing has to be invented:

- **The source asset** goes in `assets/`, *outside* `public/`, exactly as
  `assets/scene-ground.png` does — `public/` is copied verbatim into the build, so
  sources live beside it and derived files are produced by a tool.
- **Derived raster variants**, if any are needed, come from a tool beside
  `tools/icons.ts` (which generates the PNG icons *from* `public/favicon.svg`) and
  `tools/og.ts` (which composes the social card), writing into `public/`.
- **In-app, an SVG component** beside `src/ui/components/BrandMark.tsx` (the SE27
  wordmark) and `src/ui/components/icons.tsx` (the hand-drawn glyph set).
- **Where it would be shown:** the first-boot sequence above, the credits dialog
  (`src/ui/credits.ts` + `src/ui/dialogs/CreditsDialog.tsx`, reached from
  `StartView`'s utilities row), and an about/technical section.

### The Touchline mark

Built to that convention: the drawing is `public/touchline-mark.svg` and the lockup
that shows it is `src/ui/components/TouchlineMark.tsx` — used by both places the
technology appears, with the line under the name handed in by the caller (*Match
Simulation Engine* on the first boot, *Authoritative Football Simulation System* in
the credits).

**The mark is the touchline itself:** the side line of the pitch running the length
of the mark and arriving at its corner, with the goal line turning up out of it and
the corner arc curving into the field of play where the two meet. One line, one
corner, and the quarter circle that exists in no other game — no ball, no boot, no
whistle, and nothing lifted from a clip-art set. It is drawn to the game's own rule
for a mark, which is the icon set's: three strokes, one weight, one colour, the
accent green the wordmark's year, the favicon and the stripe all use.

**The proportions were arrived at by drawing them and looking**, which is the only
way this decision is ever really made. 4:1 turned the corner into a bracket; an arc
as tall as the goal line turned it into a hooked foot; and a pitch in plan — the two
touchlines with the halfway line and centre circle — read as a barbell. At 10:3, a
long touchline, a short goal line and an arc about half the goal line's length, the
corner still reads as a corner at 32px, the smallest it is ever shown. The shape and
the reasoning are recorded in the file itself, where the next person to touch it
will find them.

The lockup measures the mark **from the wordmark** rather than from the viewport:
`2.5 × var(--touchline-word)` puts the artwork within a few per cent of the name's
own measure at every width, so the two share both edges instead of merely starting
at the same place, and the compact-height block tightens both on a short screen.

What the component falls back to when there is no artwork at all — a build with the
file missing — is a *marked* placeholder rather than a substitute: a dashed frame
reading "Touchline mark / artwork pending". A substitute that looked like a mark
would be a mark nobody chose, and it would have to be found and deleted rather than
simply replaced. `onError` rather than a build-time switch, because a flag would have
to be flipped by hand and would be forgotten, and a missing image that falls back is
self-healing.

The name itself is set in type rather than left to the artwork, for the reason
`BrandMark.tsx` gives for the game's own mark: the world is full of generated
crests, and this one has to be obviously not one of them.

### The credits

`src/ui/credits.ts` gained `TOUCHLINE_TAGLINE` and `TOUCHLINE_NOTE`, and
`CreditsDialog.tsx` renders a band of its own between the game's own lockup and the
list of who did what: the mark, **TOUCHLINE**, and *Authoritative Football
Simulation System*, ruled off above and below so it reads as the simulation
underneath the game rather than as another row of credits. The wording is narrow on
purpose and has to stay true — Touchline is this project's own code, and nothing
there calls it AI, a model, a physics engine or third-party middleware.

### What changed in the branding pass

| File | What it is |
| --- | --- |
| `src/state/firstBoot.ts` *(new)* | the `slfm26.firstBoot` flag, and `shouldShowFirstBoot` — the routing decision, on its own |
| `src/state/firstBoot.test.ts` *(new)* | the flag under a hostile `localStorage`, and every combination of the routing decision |
| `public/touchline-mark.svg` *(new)* | the mark itself: the touchline arriving at its corner, with the corner arc |
| `src/ui/components/TouchlineMark.tsx` *(new)* | `TouchlineMark` / `TouchlineLockup`, and the marked placeholder a build with no artwork falls back to |
| `src/ui/views/FirstBootView.tsx` *(new)* | the sequence: Touchline → the rule down → SE27, with the skip control, Escape and the reduced-motion holding time |
| `src/ui/views/firstBootView.test.ts` *(new)* | the screen as it is actually drawn: what it says, in what order, and the way out of it |
| `src/ui/App.tsx` | one call to `shouldShowFirstBoot` in the `if (!game)` seam, and the view imported eagerly |
| `src/state/gameStore.ts` | `bootStore` publishes `hasSaves` — the slot list, not the resume mark |
| `src/ui/credits.ts`, `src/ui/dialogs/CreditsDialog.tsx` | the Touchline band and its wording |
| `src/ui/styles.css` | `.firstboot*`, `.touchline*`, `.credits__game`, `.credits__touchline*`, each with its own reduced-motion block |
| **not touched** | `index.html`, `src/main.tsx`, `App.tsx`'s `booting--inline` fallback, `src/state/persistence.ts`, the save format, and the whole of `src/simulation/` |

---

## How this is verified

Nothing in this section is a claim about intent; each line is a command that was
run and an output that was read.

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | exit 0 |
| The fast half of the suite | `npm test` | 46 files, 476 tests, exit 0 |
| The engine, both resolutions and the boundary | `npx vitest run --config vitest.slow.config.ts src/simulation/match/matchEngine src/simulation/fastMatch src/simulation/touchline src/simulation/engineMigration.test.ts src/presentation/matchEngine*` | passes |
| Save/load and the match session | `npx vitest run --config vitest.slow.config.ts src/state/persistence.test.ts src/state/gameStore.test.ts` | 69 tests, exit 0 |
| The routing and the sequence, as code | `npx vitest run src/state/firstBoot.test.ts src/ui/views/firstBootView.test.ts` | 17 tests, exit 0 |
| The sequence, in a browser | `npm run dev`, then the sequence played on its own, **skipped by clicking the button**, dismissed with **Escape**, and activated by **Tab → Enter** — the last three with the sequence's own timer stubbed out in the page, so the handover could only have come from the control being tested | all four reach the menu and write the flag |
| The four ways in | the same browser, no account and no fixture data: no save and no flag → the sequence → the menu · a career on disk with the flag cleared → **straight to the menu, the flag untouched** · `loadGame` → reload → resumed into the career · `quitToMenu` → reload → the menu with the save still listed | passes |
| The sequence fits | the same browser at 433 × 937: `documentElement.scrollWidth === clientWidth` and `scrollHeight === clientHeight`, the stage centred (17 px either side) and the skip control above the fold | no scrolling, nothing clipped |
| No football moved | `npm run benchmark` before and after the consolidation, same seed | the **full engine's fingerprint is identical** (goals 2.89, on target 9.94, saves 7.17, blocked 5.22, fouls 48.67, yellows 3.00, passes, completion, tackles, interceptions, ratings, minutes, events all unchanged); over 1 269 fast matches the abstract resolution's figures move within sampling noise (goals 2.87 → 2.83, ±0.06 at one standard deviation) |
| Cost | the same benchmark | 1 010 ms per detailed match, 2.09 ms per background match — unchanged |

`src/simulation/touchline/architecture.test.ts` is the architectural half of that
table, and it checks the claims this document makes rather than the football:

1. **The lifecycle through one state** — a whole match driven step by step over
   three seeds: the same `MatchEngineState` object throughout, the clock never going
   backwards, every phase one of the legal ten, a set piece arranged *and* delivered,
   a goal followed by a kick-off, the interval released into a second half, the final
   whistle with the score equal to the goal events on the record, and
   `match.possessionTicks` **exactly** equal to the engine's own possession seconds.
2. **Presentation independence** — the same fixture and seed played three ways: a
   screen reading and interpolating between steps at a mix of frame lengths, a
   jittering feed of tiny frames and seconds-long ones, and a straight run to the
   whistle with nobody watching. The full event record, the result and the
   possession ticks are identical in all three.
3. **The shared laws** — each restart stated once, every strike ladder summing to
   one and walked from the top, the card ladder's law (a booking on a booked man is
   the sending off, a straight red decided first, the one deliberate softening the
   abstract resolution passes), the changes allowance capped, and the nominated
   penalty taker honoured by the detailed engine.
4. **The boundary** — the mode policy sends the manager to the detailed resolution
   and everyone else to the abstract one, nothing under `src/state/` or
   `src/presentation/` writes the match record, and no file under
   `src/presentation/` or `src/ui/match/` rolls a dice.

---

## Remaining technical debt

Explicitly, and without pretending the architecture is finished. Items closed by
this pass are kept in the list, marked, so the history is readable.

| # | Debt | Kind | Severity |
| --- | --- | --- | --- |
| D1 | ~~**The legacy minute engine is still in the tree.**~~ **Closed:** the whole family is deleted — `engine.ts`, `possession.ts`, `spatial.ts`, `continuousPossession.ts`, `shot.ts`, `restarts.ts`, `discipline.ts`, `setPieces.ts`, `actionTimeline.ts`, `trace.ts`, `commentary.ts`, `passages.ts` and the field state they drove — together with the sixteen suites that covered them. `src/simulation/match/` now holds the engine's field model, its shared laws, its statistics and its movement, and nothing else | — | ~~highest~~ |
| D2 | **The outcome models are still parallel.** The *laws* are shared now (the penalty ladder, the card ladder, the changes allowance), but the open-play chance-quality → conversion model is not: `FAST_CALIBRATION` remains a calibrated parallel of the detailed resolution's emergent behaviour. Only `npm run benchmark` would notice it drift — and now, in the abstract resolution, a foul that walks the card ladder but is declined still produces a foul event where the old code returned silently, which is why the two foul counts sit slightly closer together than they used to | duplicated model | high |
| D3 | ~~**The set-piece catalogue is not shared.**~~ **Closed:** `match/laws.ts` holds the restarts and both resolutions read them | — | ~~high~~ |
| D4 | ~~**Restart geometry is shared for the live engine, duplicated for the dead one.**~~ **Closed:** there is one geometry. `laws.restartSpotFor` places every restart for both resolutions, and `laws.TOUCHLINE` names the line the legacy copy had of its own | — | ~~medium~~ |
| D5 | ~~**`presentation/matchPresentation.ts` reads `match.field`.**~~ **Closed:** the fallback reads the record (`phaseFromRecord`, `possessionFromRecord`), the cursor may name a phase, and no presentation file reads `match.field` | — | ~~medium~~ |
| D6 | ~~**`match.possessionTicks` has two writers.**~~ **Closed:** `MatchEngine` is the only writer (`drain`, `finish`), `syncEnginePossession` is deleted, and a source guard keeps it that way | — | ~~medium~~ |
| D7 | **Two statistics paths**: `events.ts::statsFor` (the engine's own tally) and `simulation/match/stats.ts` (re-read for the panel). Neither decides anything, but the panel's numbers are a second reading | duplication (benign) | low |
| D8 | **Set-piece vocabulary gaps.** `'free-kick'` carries a `direct: boolean` rather than two states, so an *indirect* free kick is not a state; extra time is a period and an event but not a `MatchPhase`; the raw match phase carries a `boolean`, not a `laws.ts` kind | vocabulary | low |
| D9 | **Commentary generation lives under `src/simulation/`** (`matchEngine/narrate.ts`, which now also owns `recordCommentary` — the one writer of `match.commentary`) although it is presentation. It decides nothing, but its home implies otherwise | layering | low |
| D10 | ~~**`TOUCHLINE_Y`** in `restarts.ts` collides in name with the system.~~ **Closed:** the constant is gone; the geometry is `laws.TOUCHLINE`, named for what it is | — | ~~low~~ |
| D11 | ~~**The legacy spatial suites are excluded from the default test run** (8 pre-existing failures).~~ **Closed:** the suites went with the engine they tested. What `state.test.ts` covered that is still live — the clock reading and the movement integrator — was rewritten against `state.ts` and passes | — | ~~low~~ |
| D12 | **`SOAK.md` carries a stale inflation diagnosis** (pre-existing, unrelated to Touchline) | documentation | trivial |
| D13 | **The abstract resolution still models no restart but the penalty.** It knows the catalogue now, but a background fixture produces no corner, throw-in or goal-kick event, so its statistics cannot be compared with a watched match's on those lines (`corners / match fast —` in the benchmark) | capability gap | medium |
| D14 | **The drilled set-piece routines are half-honoured.** The manager's nominated penalty taker now takes penalties in both resolutions, but `setPieceRoutines.corner` and `freeKick` are read by nothing at all: the legacy engine that honoured them is deleted, so every drilled routine of that kind is currently inert | feature gap | medium |
| D15 | **One lexical field remains on `Match` for the renderer**: `Match.recording` is presentation data written through the engine's `observe` hook. It decides nothing and never feeds the football, but it is the one thing the presentation stores on the record | boundary (benign) | low |

---

## What changed in this task

The consolidation pass, after the audit pass. **No football changed**: the detailed
resolution's fingerprint is identical, the abstract resolution's is statistically
unchanged, and no save format, UI, boot screen or service worker was touched.

### The one writer, and the leak that is gone

| File | Change |
| --- | --- |
| `src/simulation/match/matchEngine/engine.ts` | `drain()` now reconciles `match.possessionTicks` with the engine's own possession seconds (`mirrorPossession`). The engine is the field's only writer |
| `src/state/liveEngine.ts` | `syncEnginePossession` **deleted**; the module doc says it writes nothing onto the record |
| `src/state/gameStore.ts` | the four `syncEnginePossession` calls removed (the bench path, the watched pump, the skip-to-the-whistle, and kick-off) |
| `src/presentation/matchPresentation.ts` | reads no dead state: `phaseFromRecord` / `possessionFromRecord` for a picture with no live state, and an optional `phase`/`possession` on the replay cursor |

### The shared laws

| File | Change |
| --- | --- |
| `src/simulation/match/laws.ts` | **new** — the restarts (kinds, geometry, setup seconds, taker rules), the strike ladders, the card ladder, the changes allowance |
| `src/simulation/match/matchEngine/setPieces.ts` | `SETUP_SECONDS` and `spotFor` moved out (the latter re-exported under its old name); `beginSetPiece` takes a `SetPieceOrder` instead of a bare `direct` boolean; the penalty taker rule and both strike ladders come from the laws |
| `src/simulation/match/matchEngine/resolve.ts` | `judgeFoul` walks the shared card ladder (`cardForFoul`) with its own chances; a penalty is awarded to the club's nominated taker |
| `src/simulation/match/matchEngine/management.ts` | the changes allowance comes from `changesAllowed` |
| `src/simulation/fastMatch/simulate.ts` | `resolveFoul` walks the same card ladder with its own chances; `resolvePenalty` uses the shared taker rule and the shared ladder (`penaltyConversion` and `substitutionsPerSide` left `FAST_CALIBRATION` for `laws.ts`), and a penalty put wide is no longer credited to the keeper as a save |
| `src/simulation/touchline/index.ts` | the laws are exported through the boundary, so the whole vocabulary of the game is one import |

### The tests that hold it up

| File | Change |
| --- | --- |
| `src/simulation/touchline/architecture.test.ts` | **new** — the lifecycle over one authoritative state, presentation independence across three driving patterns, the shared laws, and the two source guards |
| `vitest.patterns.ts` | `src/simulation/touchline/**/*.test.ts` added to the slow half, so both configs agree about which file belongs where |

### The deletion pass: the legacy family is gone

The pass this section records is the one that closed D1. Nothing about the football
moved: the detailed resolution's benchmark fingerprint is **bit-identical** to the
commit before it, the abstract resolution's distribution is unchanged over 1 500
fixtures, and no save format, UI or boot screen was touched.

| File | Change |
| --- | --- |
| `src/simulation/match/{engine,possession,spatial,continuousPossession,shot,restarts,discipline,setPieces,actionTimeline,trace,commentary,passages}.ts` | **deleted** — the second football implementation and its word bank. `recordCommentary` (the one live piece of `passages.ts`) moved into `matchEngine/narrate.ts`, which already wrote the words |
| `src/simulation/match/{calibration,commentarySync,continuous,continuousPossession,continuousShot,engine,jitter,movement,oneClock,passages,possession,realism,restarts,shape,spatial}.test.ts` | **deleted** with the code they covered; `state.test.ts` was rewritten around what is still live (the clock reading and `advanceMovement`) |
| `src/simulation/match/state.ts` | cut to the two things it still does — the fixed step and the movement integrator; the action-timing machinery went with the continuous field it existed for |
| `src/simulation/match/core.ts` | the shared vocabulary only: the sides, the environment, the event writer and the team-strength context. The developer trace hook, `MinuteResult`, `halfEndMinute`, `textContext` and `eventCoords` are gone with their callers |
| `src/simulation/match/field.ts` | the small working model the *decisions* are made from; the `MatchFieldState` half went with the field state |
| `src/domain/match.ts`, `src/domain/matchState.ts` | `Match.spatial`, `Match.field`, `MatchSpatial`, `MatchFieldState`, `BallState`, `PossessionPlan`, `RestartState`, `Passage*` and the `MatchState` contract object are deleted. What remains is the vocabulary the engine's own state extends |
| `src/simulation/match/laws.ts` | `TOUCHLINE` states the line, and the throw-in and the corner are placed by it |
| `src/presentation/matchPresentation.ts` | the dead `match.spatial` branch removed with the field it read from |
| `src/ui/matchPace.ts`, `src/ui/views/ReplayView.tsx` | `spatialSecondsPerRealSecond` → `matchSecondsPerRealSecond`, which is what it measures; `SECONDS_PER_MINUTE` exported rather than borrowed from a deleted module |
| `tools/balance.ts` | `simulateMatchHeadless`; the "actions chosen" census is read from the record's own play (passes, carries, tackles) rather than the retired possession model's trace |
| `tools/matchReadout.ts` | rewritten against `MatchEngine`: it steps the engine one frame at a time and measures `MatchEngineState`, and it reads shots off the record rather than off a spatial action list |
| `src/state/gameStore.test.ts`, `src/simulation/relationships.test.ts` | repointed at the live engine and the shared `core` reader |
| `src/simulation/match/matchEngine/events.ts` | one real fix, found by a repointed test: an event's point is clamped to the pitch, because a shot that crosses the line is resolved a fraction beyond it and the record should keep the place the thing happened — the line — rather than a coordinate off the edge every renderer draws |

### Files deliberately left unchanged, and why

| Left alone | Why |
| --- | --- |
| `src/simulation/match/matchEngine/**` football logic | it *is* the authoritative engine; the brief forbids replacing working systems for stylistic reasons. Its own test suite (including the seed-identical replay) passes untouched |
| `src/simulation/fastMatch/**` movement and texture | the brief forbids adding detailed movement to background matches |
| `src/presentation/**` other than the phase/possession reads | the brief forbids rewriting the visual presentation |
| `src/ui/**` other than the pace helper's name | no UI redesign |
| `index.html` (`#booting`), `src/main.tsx`, `App.tsx`'s `booting--inline` fallback | the save-loading boot screen is kept exactly as it is. The first boot was built *beside* it, as a screen of its own, without editing any of the three — which is what the brief asks for, and the reason the two cannot be confused |
| `src/state/persistence.ts`, the save format | not redesigned; `Match.simulationMode` values preserved as `'full'` / `'fast'`, and the save/load suites pass |
| `SOAK.md` | pre-existing staleness, unrelated (D12) |

---

## Recommended next steps

Ordered smallest-first. Steps 1–3 of the previous list are done; what remains:

| # | Step | Closes | Risk |
| --- | --- | --- | --- |
| 1 | Move the commentary writer out of `src/simulation/`, or rename it to say it is a reader. Half done: `passages.ts` is deleted and its one live function now sits in `matchEngine/narrate.ts` beside the words it files | D9 | low |
| 2 | Give `matchPresentation.ts` its phase from the cursor everywhere a caller knows it (the replay already may), and complete the phase vocabulary: direct/indirect free kick, an `'extra-time'` phase | D8 | moderate |
| 3 | Let the abstract resolution emit the restarts it now knows about (corner, throw-in, goal kick) as events and statistics, so the two resolutions can be compared on those lines | D13 | moderate |
| 4 | Share the chance-quality → conversion model, so `FAST_CALIBRATION` becomes a calibration of shared code rather than a parallel of it | D2 | moderate |
| 5 | Honour `setPieceRoutines.corner` and `freeKick` in the live engine, as the taker nomination now is | D14 | moderate |
| 6 | ~~Repoint or retire `tools/balance.ts` and `tools/matchReadout.ts`, then delete the legacy family and fold `TOUCHLINE_Y` into the engine's geometry~~ **Done** — see "The deletion pass" above | ~~D1, D4, D10, D11~~ | — |
| 7 | ~~Add the Touchline logo asset and the first-boot sequence~~ **Done, except the artwork itself**, which is a design task rather than an engineering one: the slot is `public/touchline-mark.svg` and dropping the file in is the whole change (see the branding section above) | — | — |
