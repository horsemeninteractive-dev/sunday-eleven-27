# The Match Engine

> **One match. One engine. One authoritative state.**
>
> The football happens in one place. Everything else — the 2D view, the commentary,
> the statistics, a future 3D view — observes what the engine has already decided.

This document is both the audit of the previous implementation (Phase 1) and the
contract for the replacement (Phases 2 onward). It is the single place a reader
should look to answer *"where does the match actually happen?"*

---

## 0. The two modes — read this first

The game has **two ways to play a fixture**, and which one is used is a property
of the fixture itself, written onto its record as `Match.simulationMode` and never
inferred from a call site.

| | **FULL** | **FAST** |
| --- | --- | --- |
| What it is | this engine — the fixed-step spatial simulation | the abstract background model beside it |
| Who plays in it | the manager's own club: watched, played out at speed, or sent to the bench | every other fixture in the world |
| Entry points | `MatchEngine` (watched) · `simulateMatchFull(match, env)` (headless) | `simulateMatchFast(match, env)` |
| Module | `src/simulation/match/matchEngine/` | `src/simulation/fastMatch/` |
| Cost, one match | ~1 030 ms | ~2 ms |
| Renderer state | yes — `MatchEngineState`, `Match.recording` | none |
| Commentary | yes, for the one match somebody reads | none |
| Ordinary-play texture | ~2 400 events (pass, carry, tackle, throw-in, corner…) | ~80 events — the ones the rest of the game reads |

**FULL is not going anywhere and is not simplified.** It remains the authoritative
simulation for a match the manager is watching, and the football he sees is the
football he played. FAST does **not** replace the engine; it is an *abstraction of
the same football world* used for the fixtures nobody watches, and it renders
nothing.

What the two modes **share** is everything that decides what a match *means*:

- the same inputs — `MatchLineup`s, `Player`s, tactics, conditions, referee,
  crowd, supplied by `matchEnvironment`;
- the same football judgement — `computeTeamStrength`, `tacticalProfile`,
  `conditionEffects`, `pickInjury`, `conditionFactor`, `positionScore`;
- the same random principles — `stream(match.seed, 'fast-match')`, and no
  `Math.random()` anywhere;
- the same result contract — `Match.result`, `Match.events`, `Match.performances`,
  `Match.possessionTicks`, `Match.stoppage`, `Match.substitutions`,
  `Match.shootoutWinnerId`;
- the same consumers — `applyMatchConsequences`, `applyMatchdayFinances`, the
  league table, the cup, the record books. **Nothing downstream knows or cares
  which mode played a fixture.**

What FAST **deliberately omits**, and why: player and ball movement, the step
loop, renderer state, the replay recording, the commentary, and the ordinary-play
texture. Every one of those exists for a *watcher* — the 2D pitch, the passage
grouping, the playback pacing, the statistics panel — and no watcher ever opens a
background fixture. Producing ~2 400 events for one would bloat every save to say
nothing to anybody. The events FAST does write are the ones with meaning: the
goals and who scored them, the shots and saves, the fouls and cards, the knocks,
the substitutions and the whistles, plus the per-player record the season
accumulates.

Measured against the full engine over 425 background fixtures of the test world
(`npm run benchmark`), the two agree on what a Sunday League match looks like —
goals 2.75 vs 2.86, shots 18.2 vs 17.6, fouls 50.9 vs 52.1, bookings 3.3 vs 3.7,
knocks 2.0 vs 2.2, substitutions 5.91 vs 5.95, appearances 27.9 vs 28.0, pass
completion 65.9 % vs 66.9 %, mean rating 6.78 vs 6.76. They are not meant to
produce the same match. They are meant to produce the same *football*.

---

## 1. Phase 1 — Audit of the previous implementation

The old match code lived in `src/simulation/match/` and was **fragmented across two
competing authorities**:

| Concern | Where it lived | Problem |
| --- | --- | --- |
| The minute's football ("the decision layer") | `possession.ts` (`runMinuteFootball`) | Decided a whole minute's possessions in bulk, up front, from attribute rolls |
| The continuous picture ("the presentation layer") | `spatial.ts` (2 989 lines) | Did **not** decide anything: it *executed* a plan the decision layer had already written |
| The possession "plan" bridging the two | `continuousPossession.ts`, `MatchSpatial.plan`/`pending` | A serialised list of already-decided steps played back over time |
| Set pieces | `setPieces.ts` + `restarts.ts` | Rolled the outcome in the decision layer, then animated the restart in the spatial layer |
| Shots | `shot.ts` | Rolled an outcome; the spatial layer then *represented* it |
| Fouls / cards | `discipline.ts` | Same split: roll here, animate there |

The fatal result: **two systems, one described the other.** The pitch could not
decide anything (it only replayed a plan), and the engine could not show anything
(it only produced a plan). Set pieces were not simulation phases — they were
planned outcomes replayed as animation. This is exactly the split the rewrite
must remove.

### Files and responsibilities in the old code

- `engine.ts` — minute orchestrator: whistle, clock, fatigue, injuries, bench,
  ratings, narration. Imported `runMinuteFootball` for the football.
- `core.ts` — shared vocabulary: `Side`, `MatchEnvironment`, `MatchContext`,
  event construction, team strength, coordinate flips. **Worth retaining.**
- `possession.ts` (1 399) — the decision layer. Built minutes of `PossessionChain`s
  from attribute rolls. **To be replaced.**
- `spatial.ts` (2 989) — the presentation layer. Executed the plan. **To be
  replaced by the engine's own state.**
- `continuousPossession.ts` — the plan builder. **To be replaced.**
- `shot.ts`, `setPieces.ts`, `discipline.ts`, `passages.ts`, `restarts.ts` — mixed
  roll-here / show-there. **Their football moves into the engine.**
- `field.ts`, `roles.ts`, `tacticsModel.ts`, `teamStrength.ts`, `stats.ts`,
  `commentary.ts`, `attendance.ts` — supporting models. **Worth retaining.**
- `state.ts` — the clock/step/movement primitives and the `MatchState` contract.
  Already clean; the new engine is built on it.
- `role`/formation data in `src/domain/positions.ts`, `src/domain/tactics.ts`,
  player attributes in `src/domain/attributes.ts`. **Retained unchanged.**
- Consumers: `src/state/gameStore.ts` drives `advanceMinute` + `advanceSpatial`;
  `src/ui/match/*` reads `match.spatial`, `match.events`, `match.commentary`.

### What is retained from the old code

- The **domain model**: `Match`, `MatchEvent`, `PlayerPerformance`, lineups,
  formations, `Player` attributes, `Tactics`.
- The **contract types** in `src/domain/matchState.ts` (`MatchState`,
  `PlayerState`, `MatchBallState`, `MatchAction`, `ActionOutcome`,
  `PossessionStep`, `RestartState`). The new engine's state is a superset of
  these, so the 2D renderer keeps rendering.
- `rng.ts` — the seeded, stream-based RNG (`stream(seed, label...)`).
- `roles.ts` (`Role`, `RoleProfile.pressBehaviour`, weights) and
  `tacticsModel.ts` (mentalities, pressing, condition effects).
- `stats.ts` and `commentary.ts` — read by the engine as **downstream consumers**.
- `state.ts` — the fixed-step clock and `advanceMovement`.

---

## 2. The architecture

```text
                 ┌──────────────────────────────────────┐
                 │            MATCH ENGINE              │
                 │                                      │
                 │  MatchEngineState  (authoritative)   │
                 │   clock · phase · players · ball ·   │
                 │   possession · set piece · cards ·   │
                 │   substitutions · stats              │
                 │                                      │
                 │  step(dt)  — one fixed timestep      │
                 │   decisions → movement → ball →      │
                 │   interactions → events → new state  │
                 └───────────────┬──────────────────────┘
                                 │
                         MatchEngineState + MatchEvent[]
                                 │
        ┌────────────────┬───────┴────────┬────────────────┐
        ▼                ▼                ▼                ▼
   2D renderer     commentary        statistics      FUTURE 3D
  (reads state)   (reads events)   (reads events)    renderer
```

**The engine determines what happens. Everything else determines how it looks.**

---

## 3. Module layout

```text
src/simulation/match/matchEngine/
  index.ts      Public API: createMatchEngine, MatchEngine (step/advance/finish)
  types.ts      MatchEngineState, PlayerMatchState, BallNode, MatchPhase, stats
  periods.ts    The parts of a match, and where each one sits on the monotonic clock
  engine.ts     The step loop: clock, periods, stoppage, phases, stamina, ratings
  state.ts      Building the authoritative state from a fixture (ensurePerformances)
  pitch.ts      Geometry: the fixed frame, zones, distances, goal/box helpers
  movement.ts   Continuous player and ball movement, one fixed step at a time
  decisions.ts  The player decision model (on-ball and off-ball)
  ball.ts       Ball travel, control, interception, loose balls, contests
  resolve.ts    Goals, the ball leaving play, control, tackles, shots and saves
  setPieces.ts  Set pieces as real phases of play
  management.ts Substitutions, bench review, tactical changes, sendings off
  events.ts     Structured events as engine output (+ stats accumulation)
  narrate.ts    Turning drained events into commentary lines (a reader)
```

Supporting modules **must not advance the match**. They answer questions the
engine asks; they never move the clock.

---

## 4. The state machine

`MatchPhase` — the kind of football being played right now:

```text
kickoff · open-play · goal-kick · corner · free-kick · throw-in ·
penalty · goal · half-time · full-time
```

A set piece is a **phase**, not an event. The engine spends real seconds of the
clock arranging it, playing the delivery, and resolving the contest, then
returns to `open-play` — all inside the same `step(dt)` loop.

---

## 5. The simulation step

```text
step(dt):
  1. if a set piece is being arranged → advance the arrangement / deliver
  2. else → for each player, make a decision from live spatial state
  3. integrate movement (players and ball) by dt
  4. resolve interactions (control, tackles, interceptions, shots)
  5. if the ball left play → enter the appropriate set-piece phase
  6. if a goal was scored → goal phase → kickoff
  7. advance the clock; emit events
```

Fixed timestep (`SIMULATION_STEP_SECONDS = 1/30`). Renderers interpolate between
`px/py` and `x/y`; frame rate and presentation speed never change an outcome.

---

## 6. Determinism

All randomness comes from `stream(match.seed, 'engine', stepIndex)` — a stream
named by the *step*, not by a mutable generator — so the football at step *n* is
the same whether the caller drove it one step at a time or in a dozen frames.
Two runs of the same fixture with the same seed produce identical events whatever
rate the renderer draws at. `MatchSpatial`-style debug switches are exposed on the
engine (`setPiecesEnabled`) so a test can prove that a presentation-only change
does not alter the result.

---

## 7. Status

The engine exists and plays complete matches. What is done:

- **State and contract** — `engine/types.ts`, `engine/state.ts`; the authoritative
  `MatchEngineState` and its construction from a fixture and its lineups.
- **The step loop** — `engine/engine.ts`: clock, halves, measured stoppage, the phase
  machine, fixed-step advancement, stamina, and the public API
  (`createMatchEngine`, `step`, `advance`, `runToCompletion`).
- **The period model** — `engine/periods.ts`: the clock is monotonic seconds
  since kick-off, and the *period* is the truth the clock is read against. First
  half, second half and the two extra-time periods each carry their nominal span,
  their half number and whether they take added time. The displayed minute is
  derived (rebased) rather than the clock rewound, so an event's `second` is
  always sortable and the model already covers extra time — the engine owns
  `period`, and `match.half` is kept in step for the rest of the game.
  `Match.period` carries it out to the screen, so the header and the shell label
  the part of the game (`periodLabel`) rather than inferring it from the half
  number, which cannot tell the two periods of extra time apart.
- **Measured stoppage time** — the engine counts the seconds the ball spends
  dead in each half (restarts being arranged, goals being celebrated), adds a
  small allowance for what it does not model (fetching the ball, a word with the
  referee), and records the rounded minutes on `Match.stoppage` when the half
  reaches its nominal end. A quiet half gets little; a stop-start one gets
  plenty, bounded by `STOPPAGE_BOUNDS` in `core.ts`.
- **Extra time and shootouts** — a level knockout tie does not end at 90. When
  the second half ends with the scores level and the fixture is a knockout
  (`match.knockout`), the engine emits an `extra-time` event and begins the two
  fifteen-minute periods (`beginPeriod('extra-first')` / `'extra-second'`), which
  the period model already carries. If it is still level after 120, the engine
  resolves a shootout itself (`resolveShootout`): the on-pitch players take five
  kicks each from a fresh `'shootout'` stream, scored from composure and
  technique, then sudden death until one side misses. It writes
  `match.shootoutWinnerId` and `result.penalties`, so `cup.ts`'s `winnerOf` reads
  the real winner and its home-club fallback becomes a last resort rather than a
  routine. The knockout decision never falls back to the home side.
- **Geometry and movement** — `engine/pitch.ts`, `engine/movement.ts`: the fixed
  frame, the ball as a first-class object, continuous player movement. Nobody
  teleports. The `goal` phase is movement too: while the ball rests in the net,
  `celebrateGoal` sends the scoring side running — the scorer for the nearest
  corner, his teammates in a ring after him — and holds the conceding side still.
  It reads and writes no football of its own (no randomness, no events), so the
  restart, not the celebration, decides what happens next and a seed still
  replays identically.
- **Decisions** — `engine/decisions.ts`: off-ball positioning and pressing, keeper
  positioning, and the on-ball action model built from the live state (reusing
  the project's `weighActions` judgement, tempered by the engine's own rates).
  Exactly one man presses the ball — the nearest outfield player — with his role
  deciding only how far out he goes; the rest hold the block. The engine's rate
  damping on a shot is zone-aware, so a man in the area is far more likely to
  have a go than to square it, and the shape never places an outfield player
  behind his own keeper.
- **Interactions** — `engine/resolve.ts`: goals, the ball leaving play, control and
  interception, tackles and fouls, shots and saves.
- **Set pieces as phases** — `engine/setPieces.ts`: kick-off, throw-in, goal kick,
  corner, free kick and penalty are arranged, delivered and resolved inside the
  same step loop, and return to open play. Each is set up to the laws: a throw-in
  is thrown from the touchline by a named man, a penalty stands the keeper on his
  line with everyone else outside the area and behind the ball, and a kick-off
  keeps every player but the taker in his own half and outside the centre circle.
  The kick-off also waits for the pitch to be legal rather than playing with men
  still walking back.
- **Events and statistics** — `engine/events.ts`: the engine writes `MatchEvent`s
  and keeps the per-side tally, both read from the same account. The ordinary
  texture (pass, carry, tackle) is on the record as well as the loud moments, so a
  passage is a move rather than a single event.
- **Discipline and injuries** — `engine/resolve.ts` judges every foul: a booking,
  a second booking (which is a sending off), or, rarely, a straight red. A
  sent-off man keeps his node and his place on the team sheet — his slot must not
  shuffle the shape under the ten who remain — but every rule already skips a man
  marked `sentOff`, so his side plays a man short, and `buildContext` leaves him
  out of the strength so the eleven are weaker for losing him. `engine/injuries.ts`
  rolls a knock, a strain or something worse on a cadence of its own, from the
  man's hidden susceptibility, his tiredness and the conditions' injury rate, and
  writes it to `performance.injuryDetail` — which the season turns into time out.
  The bench answers an injury first and without a roll: a man who cannot run it
  off comes off as soon as somebody is ready to take his place.
- **Tests** — `matchEngine/engine.test.ts`: a full match completes; the scoreline is in
  range; the same seed replays identically; the ball does leave play; extra time
  and a shootout settle a level knockout tie; a knockout tie is always settled
  (never left level). `matchEngine/restarts.test.ts` pins the restart laws — the
  single presser, the throw-in taken from the line by its named thrower, the
  penalty arrangement and the kick-off circle.

Measured over a full matchday (18 fixtures, `engineProbe`): goals ~5/match,
shots ~11, saves ~11, corners ~9, throw-ins ~7, passes ~1 800 at ~65 %,
tackles ~155, fouls ~50. The shape of a match is right; the fine balance is not.

### Wiring — one engine, everywhere

`src/state/liveEngine.ts` holds the live engine beside the session (it is not
serialisable, so it cannot live in the store's saved state) and
`src/state/gameStore.ts` drives it; the 2D view renders
`buildEngineRenderState(engine, match, game)` and no longer reads `match.spatial`.
Substitutions, tactics, warm-up energy and half-time are all the engine's.

**Every fixture now runs on the new code — in one of the two modes.** The
manager's own fixture is the full engine, whether he watches it or sends it to the
bench; every other fixture is the fast background model. `src/simulation/day.ts`
decides which with one call — `simulateFixture(match, env, simulationModeFor(state,
match))` — and the policy that answers it lives in `fastMatch/mode.ts` and nowhere
else. Both modes are handed the same `MatchEnvironment`, and both write the same
record, so a league round, a cup tie and the manager's own match are all decided
by the same authoritative domain and read by the same consequences code.

`simulateMatchHeadless(match, env)` still exists and is still a straight call into
`simulateMatchEngine`: it is the *full* engine, headless, and the tests and tools
that want the real football in bulk still use it. What changed is that the season
no longer uses it for the games nobody sees.

The old minute engine (`match/engine.ts`) and its supporting modules (`spatial.ts`,
`possession.ts`, `continuousPossession.ts`, `shot.ts`, `restarts.ts`,
`discipline.ts`, `actionTimeline.ts`, `trace.ts`, `setPieces.ts`) have **no
production call sites** any more; they are kept only for their tests and the two
developer tools that read them (`tools/balance.ts`, `tools/matchReadout.ts`).
Neither mode reintroduced them — the fast model is new code that shares the
project's *models* (`teamStrength`, `tacticsModel`, `injuries`), never the old
engine's simulation.

`simulateMatchHeadless` returns the same authoritative record as the watched
match, written onto the `Match`: `result` (score, possession percentages,
attendance, penalties), the goal/scorer/assist/card/injury/substitution `events`,
`possessionsTicks`, and the per-player `performances` the season reads for
statistics, injuries, suspensions and development. Nothing outside the engine
decides a football outcome.

### Not done yet

- **Balance**: goals and the event rates are still above a real Sunday league
  (~5 goals a match). The biggest levers are the decision cadence (a possession
  should last longer), the ball's pace, and the goalkeeper's reach. The off-ball
  decision cadence (`OFF_BALL_INTERVAL`) is now a lever here too.
- **Performance**: a headless match takes ~2.5 s at a 1/30 s step, down from
  ~10 s. The step itself has not changed; the cost was the decision layer. Every
  off-ball man used to re-scan the pitch for the nearest player, his side's
  energy and his side's shape on every one of the ~162 000 steps, which is O(n²)
  work done twenty-two times over for the same answers. A step now works those
  out once (`createVision` in `decisions.ts`) and the men share them. On top of
  that, an off-ball man re-decides on a slower cadence than the step
  (`OFF_BALL_INTERVAL`, 1/6 s): a footballer without the ball picks a run and
  goes, and re-aiming thirty times a second was both unlike football and most of
  the bill. The on-ball and ball rules still run every step, so the football the
  manager watches is unchanged (the measured event mix at seed 42 is within a
  few per cent). ~2.5 s  a match is fine for the one fixture a manager watches,
  but a whole division or a multi-season soak wants more. Bulk fixtures now use
  the same engine (there is only one), so a 400-fixture matchday is measured in
  minutes and `soak.test.ts` — four seasons through `processDay` — no longer
  finishes inside the suite. The next lever is to run bulk fixtures off the main
  thread, or to keep a cheap approximation *inside* the engine rather than beside
  it.
- **Event richness**: done for the ordinary play. The engine now writes a `pass`
  (naming the target), a `carry` and a `tackle` as first-class events — ~2 100
  passes, ~600 carries, ~190 tackles a match — so the timeline groups into real
  multi-event passages (a move of a few passes and a carry, not a lone shot).
  They are the lowest importance and are left out of the commentary transcript and
  the feed; the pitch and the passage tell them. The stream is now ~3 300 events a
  match, which the record and the save carry.

### The laws the new engine now plays

An audit of `match/engine.ts`, `possession.ts`, `discipline.ts`, `shot.ts` and
`restarts.ts` against `matchEngine/` found several match-level laws the old
minute engine had and the rewrite had not yet carried over. They are now
implemented **inside the new engine only**, and since every fixture — watched or
headless — runs through that engine, all of a match's football is decided in one
place:

- **Offside.** Detected at the moment the ball is played: an attacker in the
  opponents' half, ahead of the ball, with fewer than two opponents goal-side is
  in an offside position (`matchEngine/offside.ts`). The pass is marked with the
  man it concerns, and the offence is raised when he takes the ball — so an
  offside player who is never found is not flagged. It emits an authoritative
  `offside` event, counts it, and restarts with a free kick to the defenders.
- **Shot outcomes.** A shot is settled when it is struck, from the real context —
  range, angle, the shooter's shooting and composure, the pressure on him and
  the keeper's ability. It can be a **goal**, be **saved**, go **wide**, sail
  **over**, or come off the **woodwork**; each is carried out by the resolution
  rules, so a shot near the goal still has a genuine chance to miss. A
  woodwork shot rebounds into play.
- **Blocks.** Any defender goal-side of a shot can throw himself in front of it
  before the keeper. A block emits `shot-blocked`; it may go behind for a corner
  **or** ricochet away as a loose ball — not every block is a corner.
- **Goal kicks and corners.** A ball over the goal line off an attacker is a
  goal kick (and a missed shot is recorded as `shot-off-target`); off a defender
  it is a corner. Both are written as events and counted, so the record and the
  tally agree.
- **Penalties.** A foul in the defending side's own box can be a penalty — not
  every one is. It is awarded through the ordinary set-piece machinery, taken by
  the side's most advanced outfielder, and resolved as `penalty-scored` or
  `penalty-missed` (a save or a miss). Advantage is **not** modelled.
- **Own goals.** A goal whose last touch is a defender is an `own-goal`, credited
  to the side it helped and named to the man who put it in; the score, the event
  stream and the report all agree.
- **Assists.** A goal scored soon after receiving a completed pass from a
  teammate is credited to that teammate. No assist is invented when the record
  does not show the chain (a penalty or an own goal is never assisted).

**Still not carried over.** *Dressing*: `beginMatch` wrote a weather note and
sometimes a pre-match incident, and varied the gate by a few per cent; the new
engine starts at “Kick-off.” and reports the expected attendance unchanged.

`engine/narrate.ts` already knows how to tell each of these (the `offside` and
`penalty-*` cases were already written), so each was a producer in the engine
rather than a new vocabulary — which is how the red cards and the injuries
arrived: the narration was waiting for them. The full laws are exercised
end-to-end and deterministically in `matchEngine/laws.test.ts`.

---

## 8. Simulation and presentation

> **The simulation determines what happens. The presentation determines how much
> of the simulation the player sees, and how quickly.**

The two are separate systems joined by one record:

```text
  the engine                    the record                 the presentation
  ──────────                    ──────────                 ────────────────
  fixed 1/30 s steps   ──►  Match.events (each with   ──►  passage grouping
  decides everything        a `second` since kick-off)     (matchTimeline.ts)
                                                       ──►  pacing + modes
                                                            (matchPlayback.ts)
                                                       ──►  the viewer
                                                            (MatchView + the 2D pitch)
```

- **`MatchEvent.second`** is the simulation's own clock — seconds of football
  since kick-off, straight through the interval. `minute` stays as the
  whole-minute summary. Every reader of the record reads the same second.
- **`src/presentation/matchTimeline.ts`** groups the flat stream into passages:
  coherent stretches bounded by a lull, a hard break or a goal, each with the
  attacking side, the loudest event and what it came to. It is pure — the same
  events always give the same passages — and it simulates nothing.
- **`src/presentation/matchPlayback.ts`** is the viewing layer: four viewing
  modes (full, extended, key moments, commentary), a cursor in *simulation
  seconds*, and a real-time cost per simulation second that depends on the
  passage — ordinary play is fast-forwarded, a chance is watched close to real
  time. Speed divides the cost; it never changes what is shown or what happens.
- **The engine never runs ahead of the picture.** The cursor is where the
  manager has watched to and the store plays the engine forward to match, so the
  clock, the score and the commentary all describe the second on screen. A skip
  is the presentation spending the football quickly (bounded per tick so it
  cannot overshoot a highlight), not a jump through a pre-played match.
- **Nothing that is not the engine decides football.** The renderer draws
  `MatchRenderState`; the timeline groups; the playback paces; the commentary is
  written from the engine's events. None of them can create an event or an
  outcome.
- **A watched match is recorded, and its replay plays that recording.** The
  engine exposes a read-only per-step observer (`MatchEngine.observe`); while a
  match is watched, `liveEngine.ts` points it at
  `simulation/match/recording.ts`, which samples where everyone is and where the
  ball is — keyed by the same football `second` the events use — into
  `Match.recording`. Watching the match back, `presentation/matchReplay.ts`
  rebuilds the cues from the record (in seconds since kick-off) and
  `matchPresentation.recordedFrame` reads the recording at the exact instant being
  drawn, so the pitch shows the afternoon that was watched rather than a
  formation leaned toward each moment. A match nobody watched has no recording
  and falls back to that reconstruction; either way it is the same render
  contract. Recording at the engine's own step cadence, not the screen's, is what
  makes the playback the same whatever speed the match was watched at — the
  engine's randomness is derived from the step index, so the same afternoon
  produces a byte-for-byte identical recording however it was paced
  (`matchEngineReplay.test.ts`, "records the same afternoon however the watching
  is paced").

  The recording samples every `RECORD_INTERVAL_SECONDS` (0.25) of football and
  holds at most `MAX_KEYFRAMES` (2000) of them. A long match is **thinned, not
  truncated**: the oldest three quarters are decimated while the newest quarter
  is kept whole, so the movement the manager has just watched stays at full rate
  and only the distant past grows coarser — and the replay plays that back
  smoothly (`sampleRecording` interpolates between whatever samples exist, which
  are not evenly spaced once thinned). The playback clock in `ReplayView`
  advances every animation frame by the real time that passed, so the replay runs
  at the manager's chosen speed and never at the frame rate.

`npm run timeline-readout` prints the engine's event stream, the passages it
groups into, and how long each viewing mode would take to watch — the developer's
window onto the split (`npm run match-readout` remains the old spatial trace).

---

## 9. Removing the old engine

With `day.ts` on `simulateMatchHeadless`, the old minute engine has **no
production call sites**. What remains is a small, closed reference set. This is
the map for deleting it.

### Files with no production importer — safe to remove with the engine

All under `src/simulation/match/`, none imported by anything outside this list
and its own tests:

| File | Notes |
| --- | --- |
| `engine.ts` | the old entry (`simulateToCompletion`, `advanceMinute`, `beginMatch`) |
| `possession.ts` | the old decision layer (`runMinuteFootball`) |
| `continuousPossession.ts` | the plan builder |
| `shot.ts` | old shot resolution |
| `restarts.ts` | old restart resolution |
| `discipline.ts` | old foul/card resolution |
| `actionTimeline.ts` | old spatial plan steps |
| `setPieces.ts` | the old 924-line set-piece module (the *new* one is `matchEngine/setPieces.ts`) |
| `trace.ts` | the old spatial trace, referenced only by `possession.test.ts` |

The **old tests** that drive these files go with them: `engine.test.ts`,
`calibration.test.ts`, `passages.test.ts`, `possession.test.ts`, `shot`-adjacent
`continuous*.test.ts`, `commentarySync.test.ts`, `recording.test.ts`,
`restarts.test.ts`, `stats.test.ts`, and the old spatial cluster
(`spatial.test.ts`, `movement.test.ts`, `jitter.test.ts`, `oneClock.test.ts`,
`state.test.ts`, `realism.test.ts`). They already fail on the old engine's own
terms and are not part of the new engine's suite.

### Files that stay, though they live beside the engine

- `core.ts`, `roles.ts`, `field.ts`, `teamStrength.ts`, `actions.ts`,
  `tacticsModel.ts`, `state.ts`, `commentary.ts`, `attendance.ts`,
  `preparation.ts` — **shared**: the new engine imports them too.
- `passages.ts` — **shared**: `matchEngine/narrate.ts` and `liveEngine.ts` use it.
- `stats.ts` — read by production (`ui/match/MatchStats.tsx`) for the stats panel.

### Blockers before a clean delete

- **`spatial.ts` is now test- and tool-only.** The replay used to carry the old
  clock across the seam: `presentation/matchReplay.ts`, `ui/matchPace.ts` and
  `ui/views/ReplayView.tsx` all imported `SPATIAL_SECONDS_PER_MINUTE`. The replay
  now reads `MatchEvent.second` directly and the pace keeps its own constant, so
  no production file imports `spatial.ts` (or calls `advanceSpatial` /
  `ensureSpatial`). Only the old cluster's own tests and the two tools below still
  do.
- **Old-engine tools.** `tools/balance.ts` (`simulateToCompletion`) and
  `tools/matchReadout.ts` (`advanceMinute`, `beginMatch`, `advanceSpatial`,
  `ensureSpatial`) read the old engine directly. They must be repointed at the new
  engine or retired. `tools/timelineReadout.ts` already uses the new engine.
- **Test imports to repoint.** `progression.test.ts` and `relationships.test.ts`
  import `simulateToCompletion`; `state/gameStore.test.ts` imports `currentScore`
  from the old path (it is really `core.ts` — repoint to `matchEngine`).
  `presentation/recordedFrame.test.ts` and `presentation/matchRenderer.test.ts`
  drive the old spatial engine to build recordings; `presentation/matchReplay.test.ts`
  still plays its record with `simulateToCompletion`.
