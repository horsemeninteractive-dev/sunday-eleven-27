# Sunday Eleven 27 — post-UI checkpoint & gameplay readiness

Checked against the working tree at `main` (`9056c31`, v0.11.1), 10 October 2026.
Every figure below was produced by a command run against the current code; nothing
was inferred from an older report. **No gameplay system was modified.**

## 1. Fresh validation results

| Check | Command | Result |
| --- | --- | --- |
| Fast test suite | `npm test` | **81 files, 1044 tests, all passing** (61.3 s) |
| Type-check + production build | `npm run build` | **exit 0** (`tsc --noEmit` clean, Vite built) |
| Slow suite | `npm run test:slow` | **4 failed / 624 passed / 2 skipped** (41 files, 403.6 s) |
| Benchmark (FULL vs FAST) | `npm run benchmark -- --fixtures=18 --seasons=1` | see §2 |
| Multi-season soak | `npm run soak -- --seasons=3` | **held up, 0 failures, 18 warnings** (club-in-the-red) |
| UI smoke | `npx vite` + browser | boots, career generates, dashboard renders, console clean |

### Slow-suite failures, triaged

1. `src/simulation/training.test.ts` → *"banks the work done in the block that was run"*.
   **Genuine and deterministic** — fails when the file is run alone. With seed
   `training-development-blocks`, the chosen attendee banks no keys. The banking
   path (`accrueDevelopment` → `headroom`) returns nothing for that man, so either
   the test's seed is now stale against the headroom gate or the gate is
   mis-computed for him. Pre-existing (recorded in `RELEASE_READINESS.md`, Gate 3).
2. `src/simulation/communication/playerConversation.test.ts` → 2 failures
   (reply state `grumbling` vs `/available/`; two men give the identical line).
   Pre-existing, documented.
3. `src/ui/saveTransfer.test.ts` → *"replaces the autosave…"* — **fails only inside
   the full slow run; passes 13/13 in isolation** (verified). A test-isolation
   leak, not a product failure.

No failure was introduced by recent UI work; the UI files are not among the
failing ones, and the fast suite (which includes the UI tests) is green.

## 2. Simulation performance and mode consistency

`npm run benchmark`, seed `bench`, 18 fixtures, one season through the real
`processDay` loop:

| | FULL | FAST |
| --- | --- | --- |
| one match | **953.6 ms** | **2.26 ms** |
| speed-up | — | **422×** |
| 18-fixture card | 17.2 s | 40.7 ms |

- **A whole 453-fixture season plays in 40.2 s** (422 fast + 31 full fixtures).
  The honest counterfactual — every fixture at full cost — is **432 s**, so FAST
  is worth ~10.7× on a season.
- **Mode consistency (same fixtures, both modes):** goals 2.67 vs 2.56, shots 18.8
  vs 17.5, on-target 9.1 vs 9.7, fouls 47 vs 49, home possession 52.0% vs 50.7%,
  mean rating 6.75 vs 6.78, subs 6.0 vs 5.7. The two resolutions agree on the
  record the season reads.
- **Known abstraction gap:** FAST produces no `corner` or `offside` events (the
  benchmark prints `—`). This is by design (`fastMatch/simulate.ts`), and
  corners/offsides are only read from the watched match's statistics panel, so no
  season table undercounts — but it means those two statistics exist only for
  fixtures the manager watched.
- **Open calibration question:** the season's *full* fixtures read 4.65 goals/match
  vs 2.61 for its fast fixtures. The head-to-head (auto-managed, matchday-1) reads
  2.67, so the head-to-head understates the watched engine's real season output —
  most likely the user club's strength plus cup ties with extra time. Worth a
  second look, not a proven defect.

## 3. 36-team world stability

`npm run soak -- --seasons=3`: three seasons, each **357 days**, all archived, a
champion crowned every year, **0 hard failures**, 18 `club-in-the-red` warnings
(the intended administration signal). Drift is stable: squad mean 22.4 → 24.5,
median age 27, goals/match 2.52 → 2.60, unattached pool flat at 55 (the pool is
now a two-sided market thanks to `aiClubs.ts`), balance mean rising 1727 → 3539
(the known "money only ever goes in" drift).

## 4. What is genuinely complete

- **Touchline, both resolutions** (`src/simulation/touchline/`): one boundary,
  two resolutions, shared judgement (`teamStrength`, `tacticsModel`, `laws`,
  `roles`), shared seeded RNG, identical `Match` contract. The architecture tests
  pass.
- **Football intelligence (Phase 2, `PHASE2_FOOTBALL_INTELLIGENCE.md`)**: AI
  manager (`ai/manager.ts`), club identity (`ai/style.ts`), role-aware selection
  (`selection.ts` + `roleCandidates`/`betterRoleFor`), purposeful substitutions,
  and tactical changes written into the record. This is exactly roadmap item 2 and
  it is **done** — do not re-do it.
- **AI club agency**: `aiClubs.ts` releases men to the pool and signs from it;
  squads refresh, managers retire/move (`managers.ts`), clubs fold and reform
  (`clubLifecycle.ts`).
- **Communication, relationships and governance**: `communication/*`,
  `relationships.ts`, `governance.ts` with chairman expectations, concerns and
  committee standing, all running through existing systems.
- **Finances**: ledger with an audit invariant, subs as a matchday liability,
  sponsorship deals, treasurer/secretary desks.

## 5. Verified outstanding gameplay gaps

1. **No player-manager career loop.** `governanceCanDismiss` /
   `applyGovernanceDismissal` exist in `governance.ts` but are called **only from
   their test** — nothing in the game or `gameStore` invokes them. The board
   "canDismiss" only paints a warning callout in `StaffView`. There is no sacking,
   no unemployed state, no job market, and `managers.ts` explicitly protects the
   player's own manager. (Design §37; Phase 2 lists it as deferred.)
2. **Fundraising is a label, not a loop.** `fundraising` exists as a ledger
   category, a `finances` view label and a schedule event kind, but no simulation
   function raises funds or generates the income of design §30 (quiz nights,
   raffles, matches, pub events).
3. **No ground/facility improvement.** Capacity, surface and floodlights are set
   at generation and never changed by play. Design §7's improvements and their
   financial consequences are unimplemented.
4. **No player/club transfer between clubs for football reasons** beyond the
   AI's gap-filling in `aiClubs.ts`; clubs do not react to a rival's strength or
   change how they play mid-career.
5. **Brittle/slow-suite reds** (§1) — small, but they must be cleared before the
   suite can be trusted as a release gate.

## 6. Recommended next task and why it outranks the alternatives

**Recommended: the player-manager career loop — dismissal, unemployment and the
job market (§5.1).**

It outranks everything else because it is the only gap that makes the *core loop*
fail at the highest-consequence moment. Every failure state the game builds up to
— a bad winter, an unhappy chairman, a squad in the red — currently ends in a
warning banner and nothing else, so the pressure the governance layer simulates
has no teeth and the career has no way to continue after it. Its foundations
already exist and are tested (`governance.ts` dismissal + standing, `managers.ts`
market with a `protectedManagerIds` hook, `managerProfiles`, `managerCareerRecord`,
the archive), so it is wiring and one new market for the player, not a new system.
It is also the dependency for the transfer/recruitment and club-agency phases that
follow: a career that can end is what makes those loops matter.

Fundraising (§5.2) is the runner-up: it is smaller, self-contained, and closes a
design pillar entirely absent from the game, but it does not unblock other phases.

## 7. Sequenced roadmap

| Phase | Gameplay outcome | Reuse | Verified gap to implement | Depends on / risk | Tests to prove completion |
| --- | --- | --- | --- | --- | --- |
| **A. Clear the reds** | The suite is a trustworthy gate. | `training.test.ts`, `playerConversation.test.ts`, slow-config isolation. | Re-pin or fix the training banking test; fix the conversation determinism; isolate `saveTransfer` state. | None. Risk: masking a real banking bug — must fix the cause, not the assertion. | The three files green in isolation **and** in the full slow run. |
| **B. Player career loop** | A manager can be sacked, spend time out of work, and be appointed elsewhere; other managers compete for the same jobs. | `governance.ts` (dismissal/standing), `managers.ts` (market, pool, `protectedManagerIds`), `managerProfiles`, `managerCareerRecord`, archive, inbox. | Wire `applyGovernanceDismissal` into the season boundary; an unemployed career state; a job-market view; appointments into vacant AI posts. | Needs a save-format bump and a UI surface. Risk: the world must not dead-end a career. | End-to-end: a bad finish dismisses the user; the career continues unemployed; a later appointment restores play; two careers stay isolated; save round-trips. |
| **C. Fundraising & consequences** | The manager can organise quiz nights/raffles/events whose return depends on reputation, attendance and relationships, and the money has a visible effect. | `finance.ts` (`addLedgerEntry`, ledger categories), `schedule.ts` event kinds, `relationships.ts`, `governance.ts`, `Inbox`. | The fundraising mechanic itself and its outcome model. | Independent of B. | A fundraiser raises a reputation/attendance-dependent sum, books one ledger line, and a poor club's event returns less. |
| **D. Ground improvements** | Facilities can be improved and cost the club; capacity/quality change what the world reads. | `domain/club.ts` ground model, `finance.ts`, `attendance.ts`, `postponement.ts` (floodlights/drainage). | The improvement action and its cost/benefit. | After C (money must have somewhere to go). | An improvement changes capacity/surface and its ledger effect reconciles. |
| **E. Club agency depth** | Clubs buy/sell for football reasons and change their approach over a career. | `aiClubs.ts`, `ai/style.ts`, `managers.ts`, `season.ts`. | Football-driven movement and style evolution. | After B (the player must have somewhere to go). | A rival visibly strengthens after a good season in both resolutions. |
| **F. World expansion / 3D** | Bigger calendars and a 3D pitch. | — | — | **Defer.** Both need A–E stable; the 2D renderer already reads the authoritative state. | — |

The existing 36-team, three-division, two-cup world was left exactly as it is. Do
not expand the calendar or world generation in the next task — it would build on
systems whose career-level consequence (§5.1) is still missing.
