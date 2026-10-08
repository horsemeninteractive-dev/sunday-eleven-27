# SE27 — Phase 2: Football Intelligence & Tactical Depth

A record of what was already in the game, what this phase added, what it
measures, and what it deliberately left for later. The single claim being tested
is the one in the brief: **two SE27 teams should now feel like two different
Sunday sides with different managers, squads and approaches** — and that has to
be true in the simulation, not in the settings screen.

---

## 1. Audit — what was already there

Phase 1 left one authoritative football model, resolved two ways, with a shared
vocabulary between them:

| Piece | Where | Notes |
| --- | --- | --- |
| Detailed resolution | `src/simulation/match/matchEngine/` | A watched match: 22 men, a ball, a step loop. |
| Abstract resolution | `src/simulation/fastMatch/` | Every other fixture in the county: ~2 ms a match. |
| Shared judgement | `match/teamStrength.ts`, `match/tacticsModel.ts`, `match/laws.ts`, `match/roles.ts`, `match/core.ts` | One football, two clocks. |
| The door | `fastMatch/index.ts` (`simulateFixture`), re-exported by `touchline/index.ts` | A caller says which resolution plays; nothing infers it. |

What already worked, and was not touched:

* **Tactics bite.** `mentality`, `passingStyle`, `tempo`, `pressing`,
  `defensiveLine` and `attackingFocus` are translated into multipliers by
  `tacticalProfile` (both resolutions), into block geometry by `match/field.ts`
  (the detailed one: line height, compactness, width, ball orientation),
  into action weights by `match/actions.ts` and into passing risk by
  `matchEngine/decisions.ts`. Conditions interact with all of it.
* **Roles exist and are modelled.** 27 roles with action weights, shot-zone
  vetoes, depth and width bias, press behaviour and runs in behind — read by the
  detailed engine's decision model.
* **Substitutions are legal.** `changesAllowed` is a shared law; the detailed
  engine's `substitute()` does the swap, the abstract one its own.
* **Match state is recomputed continuously.** `buildContext` rebuilds both sides
  every minute; the abstract model fixes its rates at kick-off.
* **Measurement exists.** `npm run benchmark` (the two resolutions head to
  head), `npm run balance` (statistical benches), `npm run soak` (long worlds).

The gaps this phase closed:

1. **No AI manager.** A club's instructions were rolled once at generation and
   never reconsidered. Nothing read the scoreline, the clock, the bench or a
   sending-off.
2. **Selection ignored the system.** `autoPickLineup` picked the best positional
   fit and gave every slot `defaultRoleFor(position)`. A direct side and a
   possession side picked the same eleven.
3. **`attributeFocus` was used nowhere.** The table that says what a role
   *values* had no reader, so a role could never decide who was picked for it —
   the one thing roles were declared to be for.
4. **Substitutions were unpurposeful.** Tired legs and injuries only; the
   replacement picked for familiarity and fitness, not for what the game needed.
5. **Tactical changes were invisible.** Nothing in the record said a side had
   changed how it was playing.

---

## 2. Architecture — the minimum that closes them

Two new modules, both pure decision layers with no engine state and no dice:

```
src/simulation/ai/style.ts     a club's football identity, derived from the club
src/simulation/ai/manager.ts   what a manager does about the afternoon
        │
        ├── matchday.ts / core.ts   handed to both resolutions through MatchEnvironment.clubStyle
        ├── selection.ts            role candidates and role fit (how the XI is picked)
        ├── matchEngine/management.ts   the detailed resolution's manager
        └── fastMatch/simulate.ts       the abstract resolution's manager
```

* `style.ts` — `ClubStyle` (the football, plus `ambition` and `flexibility`),
  derived from standing and the club's own instructions; `styleTactics` for
  world generation; `roleCandidates(position, tactics)` — the jobs a system asks
  of a position, ordinary version first.
* `manager.ts` — `matchReaction(style, situation, current)` → the instructions to
  send on, a bench intent and a reason; `pickOutgoing` and `pickBenchMan` for the
  change itself. Deterministic: the same state always produces the same decision,
  which is what keeps the two resolutions from drifting apart.

Nothing was rewritten. The engine's step loop, the set-piece engine, the
renderer, the statistics, the tables, the calendar, the finances and the
messaging are untouched. There is still exactly one authoritative simulation and
one AI manager, called twice.

---

## 3. Files

**Created**

| File | What it holds |
| --- | --- |
| `src/simulation/ai/style.ts` | Club identity, opening instructions, role plan per position. |
| `src/simulation/ai/manager.ts` | Match-state reactions, substitution decisions. |
| `src/simulation/ai/manager.test.ts` | 19 unit tests: identity, reactions, bench, role fit. |
| `src/simulation/ai/behaviour.test.ts` | 9 end-to-end tests: reactions reaching the pitch, style differences in both resolutions. |
| `PHASE2_FOOTBALL_INTELLIGENCE.md` | This document. |

**Modified**

| File | Change |
| --- | --- |
| `src/simulation/match/core.ts` | `MatchEnvironment.clubStyle` — the AI identity, handed to whichever resolution plays. |
| `src/simulation/matchday.ts` | Supplies the identity; picks the XI for the *system* with a seeded wobble. |
| `src/simulation/selection.ts` | `roleFitScore`, `bestRoleFor`, tactics-aware greedy pick, shape-aware bench. |
| `src/simulation/match/matchEngine/management.ts` | The detailed engine's manager: reaction, note in the record, purposeful changes. |
| `src/simulation/fastMatch/simulate.ts` | The same manager; rates and possession recomputed when he changes his mind; roles read for who shoots. |
| `src/simulation/gameSetup.ts`, `src/simulation/clubLifecycle.ts` | Opening instructions drawn from standing, including a club formed to replace a folded one. |
| `src/ui/match/MatchControls.tsx` | Defensive line and attacking focus added to the matchday drawer (six controls, no prose). |
| `src/ui/views/TacticsView.tsx` | One line on how the opposition play. |
| `src/simulation/match/roles.test.ts` | The AI-roles test now asserts what it meant to. |
| `CHANGELOG.md` | The phase, in the game's own voice. |

---

## 4. The architecture, end to end

**Manager decisions → team tactical state → authoritative simulation → events →
renderer.** Unchanged, with the missing box filled in:

```
ClubStyle (derived from the club)
   ↓ identity
matchReaction(style, situation, current tactics)          ← scoreline, clock,
   ↓ tactics patch, bench intent, reason                     relative strength,
match.lineups[side].tactics  ──► buildContext (recomputed every minute)          men down,
                              ──► fastMatch rates (recomputed on change)         bench left
   ↓
the football — one engine, two clocks
   ↓
events (including a `note` when the instructions change), performances, result
   ↓
commentary, statistics, replay, report
```

**Match-state adaptation.** The rules are few and they are a manager's: nothing
before the half-hour (the interval is the exception, and the most valuable three
minutes he gets); behind late, one or two rungs up the mentality ladder, a higher
line, a faster tempo and a press — further and sooner when he is ambitious, and
hardly at all when he is cautious; ahead late, deeper, slower, less pressing, and
two up he takes the game where he wants it; level with ten minutes left, he goes
for it if he is the better side and takes the point if he is not; and a man down
he drops the line, stops pressing and defends what he has, whatever the clock
says. Escalation converges: asked again a minute later, the same manager finds
his instructions already match his decision and changes nothing.

**Substitutions.** Four reasons, in the order a manager uses them: a hurt man
comes off whenever it happens; a man out of legs or out of the game on his rating
comes off; when the plan has changed, the man who no longer has a job comes off
(chasing takes off a defender, protecting takes off a forward); and the player
who comes *on* is chosen for the job — `pickBenchMan` weighs fit and familiarity
first, then the intent, and a keeper's shirt only goes to somebody who can keep.
A change made only to freshen the side up is a chance rather than a certainty, in
both resolutions, because a Sunday manager often just lets a tired player get on
with it. The human's own instructions are never rewritten, even when he hands the
afternoon over: the bench is managed for him, the plan stays his.

**Roles and attributes.** `roleCandidates` reads the instructions and offers the
ordinary version of the position first, its specialisations after it.
`bestRoleFor` gives the job to the man it fits, and `roleFitScore` reads the
role's own `attributeFocus` — so the table that describes a job to the engine is
the table that decides who is picked for it. Suitability moves a selection by
about ±7 %, never more than being the better footballer, and a seeded wobble
(±4 %, stable per club per day) keeps a Sunday side from being a spreadsheet. The
abstract resolution reads the same role table for who shoots, normalised to a
mean of one across the XI, so a role changes *who* gets on the end of a move and
never how many chances a side makes.

---

## 5. Does it produce different football?

Yes, and it is measured rather than asserted.

**In the abstract resolution** (24–30 seeds of the same fixture, only the
instructions changing):

* the same eleven told to go for it take **about 40 % more shots** than the same
  eleven told to sit on it (`behaviour.test.ts`);
* a side that passes it short keeps **more of the ball**;
* the same centre forward takes **more of his side's shots as a poacher than as
  a target man** — roles change the football in the background model too.

**In the detailed resolution:** the same fixture played by the real engine, once
with a side going for it and once with the same side sitting on it, produces more
shots for the aggressive side — the assertion runs two fixtures and passes.

**On the touchline:** an AI side two goals up with ten minutes left ends the
match deeper than it started, with the change written into the record; a side a
man down drops its line and stops pressing within a minute of the sending-off;
and a human manager's instructions are never touched.

---

## 6. Tests

Two new files, 28 new tests (the suite went from 60 files / 716 tests to
62 files / 744):

* `manager.test.ts` — identity is stable and derived, better sides are more
  ambitious, a generated county plays to its standing; no reaction before the
  half-hour; behind late goes forward, ahead late drops off; an ambitious manager
  pushes further than a cautious one and neither walks off the end of the ladder;
  a man down rearranges everything; a level, outclassed side takes the point; no
  bench intent with no changes left; chase sends a forward on and protect a
  defender; a keeper's slot takes a keeper or nobody; the hurt man comes off at
  any minute and nobody else before the hour; tired legs and the plan decide who
  goes off; every role handed out is legal for its position and comes from the
  system's own candidate list; a balanced side keeps the ordinary job; a direct
  side gets its target man and a positive one its poacher; unavailable men are
  still never picked.
* `behaviour.test.ts` — the wiring tests above, the style comparisons in both
  resolutions, the substitution count and legality, and the role effect on who
  shoots (this file's four full-engine matches cost about five seconds).

**Results (final files).** `npx tsc --noEmit` — clean. `npm test` — 62 files,
744 tests, all passing. Slow suites: `test:slow` on `src/simulation/match`,
`src/simulation/fastMatch`, `src/simulation/touchline`, `progression`,
`finance.audit`, `tables`, `forfeit`, `treasurer` and the two-season soak smoke
under `SOAK=1` — see §8 for the outcome.

---

## 7. Benchmark — AI simulation before and after

`npm run benchmark`, seed `bench`, matchday 1, 18 fixtures, both resolutions
playing the same matches:

| Per match | full before | fast before | full after | fast after |
| --- | --- | --- | --- | --- |
| goals | 2.72 | 2.28 | 2.67 | 2.56 |
| shots | 16.67 | 18.94 | 18.78 | 17.50 |
| on target | 10.00 | 9.28 | 9.06 | 9.67 |
| saves | 7.61 | 7.00 | 6.39 | 7.11 |
| fouls | 59.89 | 50.67 | 47.00 | 49.06 |
| yellows | 3.78 | 3.39 | 2.06 | 3.17 |
| subs | 6.00 | 5.94 | 6.00 | 5.67 |
| passes | 1616 | 1543 | 1465 | 1544 |
| home possession | 50.4 % | 51.3 % | 52.0 % | 50.7 % |
| mean rating (>20 min) | 6.781 | 6.770 | 6.745 | 6.783 |

| Timing | before | after |
| --- | --- | --- |
| full engine, one match | 1141.9 ms | 919.1 ms |
| fast mode, one match | 2.07 ms | 2.23 ms |
| speed-up per match | 552× | 412× |
| fast, an 18-fixture card | 37.2 ms | 40.2 ms |

The two resolutions are **closer together than they were**: shots 18.8 against
17.5 where they were 16.7 against 18.9, and goals 2.67 against 2.56 where they
were 2.72 against 2.28. The intelligence layer itself costs about eight per cent
per background match — three milliseconds on a card of eighteen fixtures, and the
first cut cost seventeen per cent until the identity was derived once per match
instead of on every review.

**The number worth reporting is the one that was rejected.** The first version of
`styleTactics` let a quarter of the best sides set out very attacking, high and
fast from the first whistle. Measured, that took the watched engine to **25.1
shots a match** against the background model's 16.8 — two resolutions of one
football coming apart, which is the one thing this project does not do. The
extremes were trimmed (the most extreme instructions are now something a manager
reaches for *during* a match, not something half a division wears to kick-off),
and the numbers above are the result.

---

## 8. Verification status

Everything below was run against the final files, after the last edit.

* `npx tsc --noEmit` — clean.
* `npm test` — **62 files, 744 tests, all passing** (60 files and 716 tests before
  this phase).
* Manually run slow suites — the engine batches
  (`src/simulation/match`, `src/simulation/fastMatch`), the Touchline boundary
  (`src/simulation/touchline`) and the season-loop suites (`progression`,
  `finance.audit`, `tables`, `forfeit`, `treasurer`) — **21 files, 183 tests, all
  passing**. This includes `touchline/architecture.test.ts`, which holds down
  exactly what the brief asks for here: one authoritative simulation, one owner of
  the engine state, the renderer downstream of it.
* The two-season soak smoke under `SOAK=1` — **2 tests passing** (`.freebuff/phase2/slow.log`).
* `npm run benchmark` — the table in §7, re-run after every change to the identity
  table. Baseline and all three runs are kept in `.freebuff/phase2/`.
* `npm run balance` — the final run's own output, kept in
  `.freebuff/phase2/balance-after.log`. There is no saved *before* for this bench,
  so it is a plausibility read rather than a comparison, and only part of it is
  relevant to this phase: the bench sets both sides' instructions itself, so what
  reaches it is the *roles* the XI was picked with rather than the identity. On it,
  an even-quality match reads 2.82 goals, 19.2 shots and 35 % draws; a real
  generated fixture reads 3.58 goals, 20.6 shots, home 43 % / draw 27 % / away
  30 %, with 1-1 the most common scoreline — Sunday football, not a formality. It
  ran all 660 matches through the watched engine (`EXIT: 0`) and its tactical
  scenarios move the way this phase says they do: pressing high against a side that
  sits off takes 55.5 % of the ball to 44.5 %, an attacking side against a low block
  takes 63.1 % to 36.9 % and wins 53 % of the matches, and a high line against an
  aggressive one produces 83 offsides a match. That last figure is the bench pushing
  two synthetic extremes at each other rather than a claim about football — a real
  fixture reads 10.2 — and it is the one number in this phase that cannot be
  attributed either way, because the offside geometry and the line heights it reads
  are untouched by this work while the *roles* that carry a man beyond the ball are
  not. There is no pre-change balance baseline to settle it against, which is the
  cost of that bench being run for the first time here.

One flag from `npm run balance` is recorded rather than smoothed over: in the "a
real fixture (generated)" scenario the home side ends with **47.7 % of the ball**,
a tenth of a point under the bench's 48–56 band, and it is the only line in that
run that is not `ok`. That scenario is the one that plays the world's *generated*
instructions, so it is the one the new identities reach; the benchmark's own
eighteen fixtures moved the other way over the same change (50.4 % → 52.0 %), and
at sixty matches a possession share carries roughly two points of sampling error,
which is why this is read as noise around the floor rather than as a regression —
but it is written down as a flag, not argued away.

Stated plainly: the AI-match cost is a real eight per cent on the abstract
resolution, the watched engine's own statistics moved with the new instruction
mix (shots 16.7 → 18.8 a match, goals 2.72 → 2.67, fouls 59.9 → 47.0, passes
1616 → 1465), and the background model is now *closer* to the watched one than it
was rather than further from it.

---

## 9. Remaining limitations

* **Two resolutions, one model — but not identical numbers.** They never were;
  the tactical identity work narrowed the gap in this fixture set rather than
  closing it, and the abstract model cannot see a rating during a match (its
  substitutions are made for legs and for the plan, never for who is playing
  badly).
* **The detailed engine's ratings are the only per-minute performance reading.**
  A poor afternoon is a reason to substitute in a watched match and not in a
  background one.
* **Reactions are per-minute-driven, not continuous.** The detailed engine
  reviews on a 30-second cadence, the abstract one nine times a match; both
  escalate monotonically to a bounded ceiling, so a manager never oscillates, but
  neither is a real-time touchline.
* **Formation is chosen once, at generation.** A side short of centre halves
  plays its 4-4-2 with a full-back in the middle rather than switching to a back
  three.
* **`styleTactics` changes world content.** Careers generated from now on have
  different opening instructions from careers generated before, and the soak's
  own numbers move with them.
* **The scouting line is one dimension.** The tactics screen says how the
  opposition play, from the same derived identity the simulation uses; the
  matchday briefing screen does not yet.

## 10. Deliberately deferred

* A positional reshuffle after a sending-off (the approach adapts; the shape is
  left to the engine, which already plays the ten men it has).
* A manager who picks his formation from the players available to him.
* Individual set-piece takers and routines beyond what `setPieceRoutines`
  already exposes.
* Manager personalities, reputations, job security and the job market — the
  identity layer is the foundation they would sit on.
* A full set-piece editor, expanded pyramids, media, and everything else the
  brief lists as belonging to later phases.
