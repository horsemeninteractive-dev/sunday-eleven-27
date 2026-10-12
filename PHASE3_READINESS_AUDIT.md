# SE27 — Phase 3 Readiness Audit: the Second Pyramid and the Local Football Ecosystem

**Scope of this document.** A read-only implementation-readiness audit for **Phase 3 — "Found the second pyramid (Stage A)"** of `WORLD_EXPANSION_ARCHITECTURE.md`. Nothing in `src/`, `tools/`, `worker/` or any configuration was modified. Every claim below is grounded in the code as it stands today, checked against the architecture document's own wording.

**Code state audited:** branch `main`, `GAME_STATE_VERSION = 23` (`src/domain/game.ts`), 115 fast test files / 1,482 tests passing, typecheck clean.

---

## 1. Executive verdict

**Ready after specific prerequisites.**

Phase 2 is genuinely present and coherent, and Phase 0/Phase 1 (the two phases the document makes prerequisites of any second cup) are also present. The blockers for Phase 3 are not data-model gaps but **three single-pyramid assumptions in the season build, the calendar placement and the soak**, plus **two missing abstractions** the architecture names (`CupField`, and a region-aware world generator). Each is small, localised and named below with its file and function.

Nothing in the audit suggests Phase 2 must be reopened. One Phase 2 item the document lists (`CupField`) was not built; one document/roadmap conflict (§7.4(3)) needs a decision before the plan is frozen.

The critical path is:

1. `buildSeasonStructure` must build a **world** (all pyramids + the county cup) rather than one pyramid destructively.
2. `placeCupRounds` must be able to place **two disjoint-field rounds on one date** (the document's "lanes"), which is safe only because Phase 1's `match.cupRound` already exists.
3. The second pyramid must be founded **at the season boundary**, never mid-season, which today's `startNextSeason` already is the natural home for.

Everything else — generation of the new clubs, cups, migration, UI — follows the patterns the codebase already has.

---

## 2. Architecture compliance: what Phase 2 actually left behind

### 2.1 Present and correct

| Phase 2 requirement | Where it lives now | State |
| --- | --- | --- |
| `Region`, `Town.regionId`, `World.regions`/`regionIds`, `FOUNDING_REGION_ID` | `src/domain/world.ts` | ✓ present |
| `Pyramid` (with `level`), `PyramidConfig`, `DEFAULT_PYRAMID`, `FOUNDING_PYRAMID_ID` | `src/domain/competition.ts` | ✓ present |
| `pyramids` / `pyramidIds` on the save | `src/domain/game.ts` (`pyramidIds` at line 240) | ✓ present |
| Pyramid-scoped competition ids | `divisionCompetitionId(pyramidId, tier)` (`pyramid.ts:304`), `cupCompetitionId(pyramidId, 'cup' \| 'plate')` (`pyramid.ts:324`) | ✓ present, with `LEAGUE_CUP_ID = comp_league_cup` / `PLATE_ID = comp_plate` kept as founding aliases so no existing id or match moved |
| Ownership, not id shape, decides whose a competition is | `pyramidForCompetition`, `pyramidIdOf` | ✓ present |
| Pyramid-scoped ladder steps | `divisionAbove`/`divisionBelow` → `adjacentDivision` walks `divisionsOf(state, pyramid.id)` | ✓ present — the one concrete bug §3.2 warned about is fixed |
| Rung vs level | `tierOf` (rung) and `levelOf` (pyramid level + tier) | ✓ both present |
| Per-pyramid promotion/relegation | `resolvePromotionAndRelegation` loops `pyramidsOf(state)`; `applyMovements(state, pyramidId, divisions, config)` writes only that pyramid's competitions | ✓ present |
| Migration to the current schema | `migrateToPyramid` (v7), `migrateToRegionsAndPyramids` (`from < 23`), `backfillCupRounds` (`from < 22`) | ✓ present |
| Phase 0 hard failure for an unplaceable cup round | `placeCupRounds` reports `unplaced`; `requireCupRoundsPlaced` in `seasonStructure.ts` throws in dev and writes a stop notice in a build | ✓ present |
| Phase 1 round identity | `Match.cupRound` written by `drawCupRound`, read by `cupRoundOf` with arithmetic fallback; `cupStructure.test.ts` has "keeps two cups apart on one matchday" | ✓ present |
| Phase 0 soak invariants | `cup-decided`, `cup-round-has-date`, `every-fixture-in-a-competition` (`CALENDAR_INVARIANTS`, `checkCalendarIntegrity`) | ✓ present |

No `state.pyramid` singular reference remains outside the legacy migration path (`migrateSave` reads it and deletes it). No `userPyramidId` exists — the code answers "whose pyramid?" club-first (`divisionOf(clubId)` → `pyramidForCompetition`), which is better than the document's `pyramidOf(state, state.userPyramidId)` suggestion and needs no change.

### 2.2 Remaining single-pyramid assumptions (must be fixed in Phase 3)

| # | Assumption | Evidence | Why it blocks a second pyramid |
| --- | --- | --- | --- |
| **S1** | The season builder builds **one** pyramid and replaces the world's records wholesale | `buildSeasonStructure` sets `state.competitions`, `state.fixtures`, `state.matches`, `state.matchOrder` and `state.season.calendar` at its end, and returns a single `SeasonStructure` with one `cupSlots` list | Calling it twice erases the first pyramid. It must become a world build (or accumulate into the state) |
| **S2** | The season builder is handed a **flat** `divisions: ClubId[][]` and one `pyramidId` | `startNextSeason` (`season.ts`, the `buildSeasonStructure({ …, pyramidId: foundingPyramidId(state) })` call) passes `divisions` produced by `pyramidsOf(state).flatMap(…)` | With two pyramids the flat 6-entry list would be cut into a single six-tier ladder. The option must take `Array<{ pyramidId, regionName, divisions }>` |
| **S3** | Cup slots are placed **one round per Sunday**, numbered from a per-call base | `placeCupRounds` `taken` set and `nextMatchday = league.length` | Two pyramids' cup rounds collide on the same Sundays and there are only ~10 spare Sundays for 22+ rounds — §4.2's finding, confirmed in code |
| **S4** | Soak `promotion-balance` assumes one ladder | `checkPyramid`: `boundaries = divisions.length - 1` and `pyramidOf(state).config.promotionPlaces` | Two 3-tier pyramids give six divisions, so the check would expect 5 boundaries × 2 places = 10 promotions, against the 8 that two ladders of two boundaries each actually produce: **it would fail as soon as the second pyramid exists** (a prediction from reading the check, not something that can be measured until the second pyramid is built). Must be summed per pyramid |
| **S5** | Soak's per-tier readings are positional over all divisions | `snapshotSeason` builds `tierSizes`/`tierAbility` from `leagueCompetitions(state)` (tier-then-name order) | Deterministic, so it will not crash, but "tier 1" stops meaning one pyramid's top division. Should become per-pyramid (the document's §9.1 "per pyramid" column) |
| **S6** | Cup seeding and giant-killing read bare **tier** | `seedOrder` (`cup.ts:258`) sorts by `tierOf`; `isGiantKilling` (`cup.ts:715`) compares `tierOf` of both clubs | In a county cup, tier 1 of two pyramids seed as equals and a second-pyramid tier-1 beating the founding tier-1 is not a giant-killing. Both must read `levelOf` |
| **S7** | The legacy cup-plan fallback sizes the field by the **whole world** | `day.ts advanceCups` → `allCupRoundSlots(leagueCupField(state), …)` where `leagueCupField` = `leagueClubIds(state).length` | With 72 clubs a pre-plan save would be given a 72-club plan for the founding cup. Only reached when `cup.plan` is absent, but it becomes wrong the moment a second pyramid exists |
| **S8** | Division names come from one region name | `divisionNameFor(regionName, tier)`, fed `state.world.regionName` / `draft.world.regionName` in both `startNextSeason` and `startGameFromDraft` | The second pyramid's divisions would be named after the founding region. The name must come from `world.regions[pyramid.regionId].name` |
| **S9** | Fold/re-form is handed a flat list of divisions | `reviewClubFinances(state, { divisions })` in `startNextSeason` | It refills a folded club's division in place, so it survives a flat list *only if the flat list's pyramid/tier mapping is preserved*; the document's own risk register wants per-pyramid divisions so a replacement is minted into the folded club's own pyramid |
| **S10** | The world generator knows one region | `generateWorld` builds `regions = { [region.id]: region }`, `regionIds: [region.id]` and calls `generateTowns(rng, river, FOUNDING_REGION_ID)` | Phase 3 needs regions drawn **before** towns and towns assigned by nearest centre (document §3.1). Today towns are all assigned to `region_1` after the fact |
| **S11** | `CupField` does not exist | No `CupField` type or `Competition.cup.field` anywhere in `src/` | Phase 3's county cup has nowhere to declare that its field is the county |
| **S12** | No expansion marker | `grep` for `pendingWorldExpansion` finds nothing | §7.2(3)'s "stamp a pending operation" has no home yet |

### 2.3 Explicitly **not** Phase 3 work (deferred, and it is correct to defer it)

The following still read a bare tier and the document assigns them to **Phase 4** (§3.4/§8 "`levelOf` switches the level-meaning readers"). They are listed so they are not "fixed" early and cannot be mistaken for blockers:

* `tierPrizeMoney(competition.tier, …)` — `season.ts` in `finishSeason`.
* `AI_CHURN_BY_TIER` indexed by `tierOf(state, club.id)` — `clubChurn` in `season.ts`.
* `tierFactor` / `TIER_EXPECTATIONS` (gate, sponsor, slack) — `sponsorship.ts`, `sackingSlackFor` (`pyramid.ts:634`), `governance.ts:687`.
* `applySeasonStanding` and the `standing.ts` layer.
* The soak's own tier readings (`tierAbility`), which the document says should **keep** reading tier.

Consequence to accept knowingly for Stage A: a second pyramid's tier-1 club is paid, churned and judged sponsorship-wise as though it were the founding tier-1. That is the document's own Phase 4 line, not an oversight introduced here.

---

## 3. Phase 3 requirements matrix

| # | Requirement (document) | Current state | Gap | Files / functions | Phase | Test strategy |
| --- | --- | --- | --- | --- | --- | --- |
| **R1** | Regions generated **before** towns; towns assigned by nearest centre with seeded tie-break; names from the existing river list | One region created **after** towns, covering all of them, in `generateWorld` | Region partitioning | `generation/worldGenerator.ts` (`generateWorld`, `generateTowns`, `regionCentreFor`), `gameSetup.ts` (`generateDraft`) | **3** | Extend `worldGenerator.test.ts` "draws one region…" to: N regions, every town in exactly one, same seed → same partition, region names distinct |
| **R2** | Second pyramid's 72 clubs minted into club-less settlements, new settlements if the county runs out | Not started; `generateLowerTierClubs` (v8 migration) is the working technique but ignores club-less preference and regions | The generator itself | `generation/worldGenerator.ts`, `gameSetup.ts` `startGameFromDraft`, `persistence.ts` (`generateLowerTierClubs` as model) | **3** | New test: same seed → identical second pyramid (clubs, ids, squads, reputations); no club id collides; every new club's town is in the new region |
| **R3** | Second pyramid's divisions, ids and ownership | `divisionCompetitionId`/`cupCompetitionId` already pyramid-scoped and collision-free (`comp_vale_t1`, `comp_vale_cup`) | Only the season build (S1/S2) | `seasonStructure.ts`, `pyramid.ts` | **3** | `pyramid.test.ts` already covers id shape by hand; add a built-world assertion that both pyramids own their own competitions |
| **R4** | Founding pyramid unchanged, id for id, fixture for fixture | Holds today by construction | Prove it across the change | `persistence.test.ts`, `soak.test.ts` | **3** | Expansion-in-place test (§9.2): pre-expansion save → migrate → founding pyramid's club ids and its season-1 fixtures identical |
| **R5** | County cup spanning both pyramids | No county cup; no `CupField` | Type + build + calendar | `domain/competition.ts` (`CupField`, `Competition.cup.field`), `seasonStructure.ts`, `calendar.ts` | **3** | Cup is drawn, plays to a winner, includes clubs of both pyramids, and its finalists come from two pyramids at least once in five seasons |
| **R6** | Cups in different pyramids may share Sundays; every field is disjoint from each other | Impossible today (S3) | Lanes in `placeCupRounds` | `calendar.ts` (`placeCupRounds`, `CupRoundSlot`), `seasonStructure.ts`, `timeline.ts` (`matchdayOnDate`), `day.ts` (`prepareToday`) | **3** | `seasonShape.test.ts` invariant re-stated: two rounds may share a date **only if** their fields are disjoint; soak `no-club-plays-twice-in-a-day` unchanged and green over 5 seasons |
| **R7** | A slot the calendar cannot place must fail loudly | Done (Phase 0) | — | `calendar.ts`, `seasonStructure.ts`, `soak.ts` | **0 (done)** | Keep `seasonShape.test.ts` "throws when the season has no room" and the three soak invariants |
| **R8** | Expansion activated at the season boundary, never mid-season | Nothing exists | Marker + consumption | `persistence.ts` (`migrateSave` `from < 24`), `season.ts` (`startNextSeason`), `state/gameStore.ts` (`rollOverSeason`) | **3** | Save immediately before, at, and after the roll-over; the pre-rollover save resumes on the old world; the post-rollover save has two pyramids and a full calendar |
| **R9** | Same-seed determinism | Test exists (`soak.test.ts`, slow half) | Extend to the new streams | `soak.test.ts`, `persistence.test.ts` | **3** | Two independent runs snapshot-for-snapshot equal with the expanded world; two migrations from the same save equal |
| **R10** | New clubs keep their own id prefixes so a migration cannot collide | Convention documented; v8 uses `club_py…` | Use per-pyramid prefixes | `persistence.ts`, `generation/worldGenerator.ts` | **3** | Assert `club_vale_*`-style ids, no overlap with `club_${n}` or `club_py${n}`, and `grounds`/`mgr`/`chm` likewise |
| **R11** | World screen shows the two pyramids and a club's region | `WorldView.tsx` shows only `world.regionName` in one section title; no UI file reads `regions`/`regionIds` | All of it | `ui/views/WorldView.tsx`, `simulation/queries.ts`, `ui/views/LeagueView.tsx`, `ui/views/ClubView.tsx` | **3 (UI)** | A rendering/unit test over a two-pyramid state: both ladders listed, each club's region named |
| **R12** | Performance and state-size budgets (§6.4) | No state-size assertion exists anywhere | The assertion itself | `soak.ts` (new invariant), `tools/benchmark.ts` | **3** | State ≤ 7 MB at Stage A; season ≤ 60 s; full 967 ms / fast 2.55 ms per match unchanged within ±10% |
| **R13** | Archive one entry per competition per season | Absent; `state.matches` is rebuilt each season and `standingHistory` is overwritten | §7.4 lists it as a prerequisite, §8 Phase 4 as the work | `season.ts` (`finishSeason`), `history`/`queries.ts`/`HistoryView.tsx` | **conflict — see §9** | If built: honours count per season equals divisions + cups (`honours-awarded-once` generalised) |
| **R14** | Cross-pyramid club movement | Absent | `resolveCrossPyramidMovements` | `pyramid.ts`, `season.ts` | **4** | A club that moves pyramid keeps honours, records, county-cup eligibility, rivalries |
| **R15** | Four pyramids, abstract neighbouring counties | Absent | Everything | — | **5** | 144 clubs, 10-season soak clean, state ≤ 14 MB |

---

## 4. World generation and club identity

### 4.1 How the world is generated today (`generation/worldGenerator.ts`)

1. `generateWorld` picks the region name from the river list (`Wyre`, `Cale`, … + "Valley"), calls `generateTowns(rng, river, FOUNDING_REGION_ID)`, then builds one `Region` whose centre is `regionCentreFor(towns)` — the map's mean position.
2. `generateTowns` builds `Town`s with `x`/`y`, `kind`, `population`, `businessId`s and **a hard-wired `regionId` argument**.
3. Clubs are drawn from a *shuffled* list of settlement slots sized by `CLUB_DENSITY` (a town supports 4–9), taking `wanted = tiers * clubsPerDivision` = 36. That is why some settlements have no club at all (the document measured 4 of 21 on seed `soak`).
4. Each club gets `club_${index+1}`, `ground_${n}`, a manager, a chairman, a squad (own stream `${seed}::squad::${clubId}`), style tactics, rivalries from geography, and occasional ground sharing.
5. `divisions` and `divisionClubIds` are cut by reputation downstream in `gameSetup`/`seasonStructure`.

### 4.2 What Phase 3 must add here

* **Regions first, then towns.** Draw the region set (≥ 2) from the rivers before `generateTowns`, assign each town to the nearest centre with a seeded tie-break, and keep `world.regionName` and `world.countyName` untouched (division naming for the founding pyramid reads them today).
* **The second pyramid's clubs come from club-less settlements in its own region.** The generator's club-slot list already knows which settlements got none; the smallest change is to keep that knowledge (today it is discarded after `rng.shuffle(tasks).slice(0, wanted)`).
* **New settlements only if the county runs out**, using the same `generateTowns` machinery and the same rivers.
* **Id prefixes of their own** (`club_vale_1`, `ground_vale_1`, and per-pyramid person ids), because `club_1…club_36` belong to the generator and `club_py1…` to the v8 migration. §7.3 is explicit that a migration must never be able to collide with a generated id.
* **Reputation/level.** §3.4 suggests deriving the second pyramid's `level` from the mean reputation its region can support. `reputationForTown`, `clubQualityFromReputation` and `clubStandardQuality` already exist and are the right inputs; the result is one deterministic number written onto the `Pyramid`.

### 4.3 Identity guarantees, and how each is enforced

| Guarantee | Mechanism already in the code |
| --- | --- |
| Existing clubs keep identity and history | Clubs are never re-created; division membership is `competition.clubIds`, written only at a season build and by `applyMovements` |
| New clubs cannot replace or duplicate existing ones | New prefixes + `usedNames`/`usedNicknames` sets passed into `buildClubName` |
| Every club in exactly one division of one pyramid | `checkPyramid`'s `every-club-in-one-league`, already world-wide over `leagueCompetitions(state)` |
| Competitions cannot include unrelated clubs | Ownership is `Pyramid.competitionIds`/`cupIds`, written by the season builder; `divisionOf` finds the one league a club is in |
| A county cup cannot corrupt division membership | A cup is its own `Competition`; `drawCupRound`/`readCupRound`/`advanceCups` write only `cup.clubIds` and `state.matches` |
| Other pyramids cannot leak into the founding pyramid's ladder | `adjacentDivision` is pyramid-scoped; `resolvePromotionAndRelegation` solves each boundary from that pyramid's own divisions; standings and finances are per club |

### 4.4 The one structural rule to hold

**Membership is only ever written at the season boundary.** Today that is true: `applyMovements` (boundary) and `buildSeasonStructure` (season build) are the only writers of `competition.clubIds`. Phase 3 must not add a third writer, including for the county cup — its field is *derived* from active clubs, and it must be re-derived by the same season build, not mutated mid-season.

---

## 5. County cup: ownership and eligibility

### 5.1 What exists

* `Pyramid.cupIds` lists the cups a ladder runs, and `pyramidForCompetition` reads ownership from those lists rather than from the shape of an id.
* `cupCompetitionId(pyramidId, kind)` already produces a second pyramid's ids (`comp_vale_cup`, `comp_vale_plate`) and keeps the founding ids byte-identical.
* `drawCupRound`, `pairUp`, `readCupRound`, `matchesForRound`, `cupRoundOf`, `newCupState`, `mainCupPlan`, `platePlan` are **all generic over `competition.clubIds`**: the only place a field is chosen is what the season builder writes into the competition.
* `advanceCups` in `day.ts` iterates `cupCompetitions(state)` — every cup — and its Plate feeding runs only for a cup with `cup.consolationFor`. A county cup needs no new advance path.

### 5.2 What is missing

1. **`CupField` and `Competition.cup.field?`** (document §3.5), absent from `src/`. Absent must read as `{ kind: 'pyramid', pyramidId: 'league' }` so every existing save keeps its meaning.
2. **A field chooser in the season build.** Today `buildSeasonStructure` computes `cupField = divisions.flat().length` and seeds the cup with `seedOrder(state, ladderClubs)`. A county cup's entry list is `Object.values(state.clubs).filter(c => c.active)` — a one-line change *once the field is declared*, exactly as the document says.
3. **Seeding across ladders** (S6): `seedOrder` must rank by `levelOf`, not `tierOf`, or the county cup's opening rounds are seeded as though both pyramids' top divisions were the same football. `isGiantKilling` needs the same treatment for its news.
4. **Ownership of a county cup.** It belongs to no pyramid's `cupIds`: `pyramidForCompetition` returns undefined for it, and `pyramidIdOf` returns null. That is *correct* (it is the county's, not a ladder's) but every reader of `pyramidIdOf(...)!` must tolerate null. `adjacentDivision` already falls back to the founding pyramid for a competition no pyramid claims — harmless for a cup, since a cup is never stepped between.
5. **The county cup's winner has no home in `honours`.** `finishSeason` archives honours per division, and cup winners via the cup records; a county cup winner needs the same `history.honours` line to be truthful. `checkPyramid`'s `perSeason = tierSizes.length + cupCompetitions(state).length` already counts *every* cup in the world, so the soak will police this as soon as the county cup exists — a useful, free check.

### 5.3 Eligibility

Eligibility is geography read through the town (`club.townId → town.regionId`), never through the division. Consequences the code already supports:

* A club keeps county-cup eligibility if it ever changes pyramid, because nothing writes `club.townId` outside the generator.
* A folded club is `active === false` and drops out of both the county cup field and `leagueClubIds`/`activeClubIds`.
* The county cup's participants are not "members" in the `clubIds`-as-membership sense used by a division: `advanceCups` overwrites `cup.clubIds` with survivors each round, which is the existing cup semantics and must not be confused with membership.

---

## 6. Calendar and scheduling

### 6.1 The budget, confirmed in code

`placeCupRounds(startDate, matchdays, slots)` builds the league calendar, then places one slot per free Sunday using a `taken` set, numbering cup matchdays from `league.length + 1`. Today: 22 league Sundays + 11 cup rounds = 33 calendar entries, `CUP_KICKOFF = '7:45pm'`, cup rounds on the Sunday before a league matchday (`cupRoundDate = −7 days`), stepping over the Christmas fortnight. Two pyramids' league cups need 22 cup slots; the free Sundays are about ten. §4.2's arithmetic is exactly right.

### 6.2 What "lanes" means in this codebase (the crux of the phase)

The document says the calendar must be *told* which lane a slot belongs to. The code makes that concrete, and the choice matters:

* **A matchday number is a shared namespace, not a per-competition one.** `cupRoundMatchday = leagueMatchdays + matchdayOffset + round`, `playDateFor` looks the date up by matchday, `prepareMatchday(n)` prepares every tie numbered `n`, and each competition keeps its own `fixtures[competitionId].byMatchday`. So **two cups of different pyramids can share the same matchday number and the same Sunday with no new concept at all** — which is precisely what the document means by disjoint fields sharing a Sunday.
* **Two entries with one date would be new territory.** `state.season.calendar` is `{ matchday, date }[]`; `matchdayOnDate` returns the *first* entry for a date, and `day.ts prepareToday` prepares that one matchday before falling back to a per-fixture loop over matches dated today. Two matchday numbers on one date is therefore survivable but subtle, and it would make `matchday X of N` ambiguous for the day.
* **Recommendation:** give the pyramid cups and the county cup **separate slot groups whose numbers may coincide**, i.e. extend `placeCupRounds` with a lane/group parameter that (a) keeps `taken` per lane, allowing two lanes to use the same Sunday, and (b) numbers each lane's rounds from the same base so the two ladders' cup rounds line up on the same midweek. This is the smallest change that satisfies §4.2(4) and it adds no second calendar, no second matchday namespace and no change to `timeline.ts`.
* **The county cup must not share a Sunday with anything its field overlaps** — the same club would be drawn in both. Its early rounds take the Sundays the pyramid cups are not using and its later rounds may take Wednesday evenings: `NO_GAME_WEEKDAYS` excludes only Thursday and Saturday, `canPlayOnWeekday(3)` is true, and `postponeFixture`/`kickOffForReplay` already produce 6:45pm Wednesday football. The calendar only needs a way to *ask* for a weekday on purpose.

### 6.3 What must not change

* **One calendar, one league matchday namespace, one opener per year, and the `while` loop in `startNextSeason` that pushes the opener rather than stretching the season.** `leagueEntries` reads league Sundays by scanning `state.fixtures` for non-cup lists, so a cup round can never be mistaken for a league matchday; that property must survive.
* **Every fixture is resolved by `applyFixturesSteps` alone.** No second loop for other pyramids (document §6.3).
* **Per-pyramid `clubsPerTier` stays deferred** (§4.4): it is what `matchdayCount(clubsPerTier)`, `leagueMatchdayCount`, `sessionKeyFor` and the whole UI's "matchday X of N" depend on. Stage A keeps 12-a-division for both ladders.

### 6.4 Failure detection

Phase 0's reporting is in place: `placeCupRounds` returns `unplaced` with a reason ("every Sunday within eight weeks of X is already taken…"), and `requireCupRoundsPlaced` refuses the season (throw in dev, a stop notice in a build). Phase 3 should extend the *reporting* to name the lane and the competition contending for the date, because with two ladders a collision will be between two named rounds rather than with "another cup round".

---

## 7. Season-boundary activation and persistence

### 7.1 The chain today

* `gameStore.rollOverSeason()` clones the state and calls `startNextSeason(state)` — the single, user-visible roll-over point.
* `startNextSeason`: computes the opener from the calendar year with the `while` guard; applies movements **per pyramid**; ages/retires/intakes/churns every club via `leagueClubIds(state)` (world-wide, so it already covers a second pyramid); runs `reviewClubFinances`; writes the new `season`; calls `buildSeasonStructure` for **one** pyramid (S1/S2); arranges pre-season; resets training; opens season records; applies annual costs.
* `finishSeason` loops `pyramidsOf(state).flatMap(divisionsOf)` and archives per division — already world-aware. `standings[0]` per competition is the champion.
* `migrateSave` is an incremental `if (from < N)` chain ending at `GAME_STATE_VERSION = 23`; `migrateToRegionsAndPyramids` handles `from < 23`; `backfillCupRounds` `from < 22`. Since a rollout would add a version, the chain is ready for `from < 24`.

### 7.2 The Phase 3 mechanism

1. **Migration `from < 24`** stamps a single marker on the state (nothing else), bumping `GAME_STATE_VERSION` to 24. Additive and idempotent.
2. **`startNextSeason` consumes it** at the top of the roll-over: generate the second region/pyramid and its clubs, register them in `state.pyramids`/`pyramidIds`/`world.regions`, clear the marker, and let the ordinary season build give every pyramid its divisions and the world its county cup from day one.
3. **A fresh career does the same thing without the marker**: `generateDraft`/`startGameFromDraft` build both pyramids from the start. Stage A should probably make the *new-career* path the default and the migration the path for existing saves (open question 9.4).

### 7.3 Save behaviour around activation

| Moment | Behaviour |
| --- | --- |
| Save before the roll-over, resume on new code | Marker present, one pyramid. Resumes; the next roll-over founds the second pyramid. `state.matches` for the in-flight season are untouched |
| Save before the roll-over, resume on **old** code | Refused: `readSaveFile` rejects a save whose version is newer than `GAME_STATE_VERSION`. This is the safe, honest failure |
| Roll over, save, resume | Two pyramids, a full calendar, no half-played season. `checkSave`'s round trip must hold |
| Roll over twice | The marker is consumed and cleared, so a second roll-over cannot found a third pyramid |

**Refinement worth recording.** The document's rollback story ("restore the pre-roll-over autosave") is not quite the whole story: **the migration is the one-way door, not the roll-over.** The moment the new build loads an old save, the marker makes it a v24 save that a v23 build refuses. So the operational rollback point is the last save written *before the new version was ever run*, which is why the save manager's manual slots matter here.

---

## 8. Test and performance baseline

### 8.1 Measured during this audit (today, this machine, branch `main`)

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (the **fast** half only) | **115 files, 1,482 tests, all passing**, 104.5 s wall |
| `npm run benchmark -- --seasons=1` | full engine **967.2 ms/match** (18 matches in 17.41 s); fast mode **2.55 ms/match**; speed-up **380×**; a full 18-fixture fast card **45.9 ms**; season loop **39.7 s** (420 days, 423 fast + 30 full fixtures); total wall 57.2 s |
| `npm run soak -- --seasons=2 --seed=soak` | exit 0, **zero `fail` violations**, 13 `club-in-the-red` warnings; 404 fixtures a season; 42 then 39 postponements; 0 abandoned; 357 days a season; 81.3 s for two seasons |
| `npm run test:slow` (the **slow** half: engine batches, season loops, `persistence.test.ts`, `gameStore.test.ts`) | exit 0, **41 files, 645 passed, 2 skipped**, 368.7 s |

The Phase 0 invariants are reported with zero counts, which is the evidence that they ran: `cup-decided 0`, `cup-round-has-date 0`, `every-fixture-in-a-competition 0`.

Together the two halves are 156 files and 2,127 passing tests (2 skipped).

### 8.2 Historical figures carried in the document (not re-verified here)

* 1,471 tests / 115 files (Task 10's report) — today's fast half is 1,482 / 115, i.e. eleven tests have been added since.
* State size ≈ 3,213 KB for 36 clubs; full 982.0 ms / fast 2.65 ms a match; 39.3 s a season. Today's measurements agree within a few per cent, which is a useful sanity check rather than a reproduction.

### 8.3 Gated tests, run separately

* **Nothing else.** The gated multi-season soak was run separately: see the row below. The Phase 0 invariants, including the negative tests that prove each one fires, ran and passed inside `npm run test:slow`.

| Command | Result |
| --- | --- |
| `npm run test:soak` (the gated block inside `soak.test.ts`) | exit 0, **12 tests, all passing**: "plays two seasons from a fixed seed and the world holds up" (87.6 s) and **"the same seed is the same career" (84.6 s)** — the determinism gate the architecture document calls the acceptance criterion for every phase, green on the Phase 2 code as it stands |

### 8.4 Not measured

* State size (the document's ~3,213 KB for 36 clubs is historical; no tool exists, §9.4 recommends adding one).
* `--seasons=10` soaks on three seeds, and the per-day latency (mean/p95) instrumentation §6.4 asks for.
* Any preview/browser verification.

### 8.5 What Phase 3 needs, as tests

1. **Two pyramids** — 72 active clubs, each in exactly one division of exactly one pyramid (extend `checkPyramid`), both ladders' competitions owned correctly, `leagueCompetitions(state)` seen as six.
2. **Founding-pyramid continuity** — an expansion-in-place test: pre-expansion save → migrate → club ids, honours, season records and season-1 fixtures identical; the same migration run twice is identical.
3. **Ownership and eligibility** — a competition's pyramid is read from `competitionIds`/`cupIds`; the county cup's field is every active club and nothing else.
4. **County cup** — drawn, played to a winner, finalists from two different pyramids at least once in five seasons; `honours-awarded-once` still exactly right.
5. **Calendar and round integrity** — two rounds on one date only where the fields are disjoint; no club in two fixtures on one date; every cup round dated; `seasonShape.test.ts`'s "one round a Sunday" re-stated as "one round a Sunday **per lane**".
6. **Season-boundary activation** — save/load immediately before, at and after the roll-over; the marker consumed once.
7. **Save compatibility** — v23 load → v24, current-schema round trip, and the `from < 24` migration being idempotent.
8. **Determinism** — the existing snapshot comparison extended to the new streams (`region`, the second pyramid, its squads and its cup draws).
9. **Soak stability** — `npm run soak -- --seasons=5` on the seeds the document suggests (`vale-1`, `vale-2`), zero failures.
10. **Performance** — state ≤ 7 MB, a season within the Stage A budget, and per-match cost unchanged within ±10%.

---

## 9. Ordered implementation plan

Each stage is independently testable and independently revertible. Ordering is by dependency, not by size.

### Stage 0 — Freeze the baseline *(no code)*
Record the §8.1 numbers in `SOAK.md`/`CHANGELOG`-adjacent prose so every later stage has a before-picture. Acceptance: the four commands above run and their numbers are written down. Risk: none.

### Stage 1 — `CupField` and a world-aware season build
* **Objective.** One season build produces every pyramid's competitions and the world's cups.
* **Files.** `domain/competition.ts` (`CupField`, `Competition.cup.field?`, absent reads as the founding pyramid's), `seasonStructure.ts` (`BuildSeasonOptions` takes `Array<{ pyramidId, regionName, divisions }>`; ownership written per pyramid; a county cup when a field of `kind: 'county'` is requested), `season.ts` (`startNextSeason` builds the world once), `gameSetup.ts` (`startGameFromDraft`).
* **Dependencies.** None. Carries S1, S2, S8, S11.
* **Tests.** The existing suite must stay green **with one pyramid** — this stage is a refactor for a world of one; the *new* behaviour is proven by passing the founding pyramid twice in a test-only build.
* **Acceptance.** `npm test` green, `npm run soak -- --seasons=2` produces the same trend table as the baseline, determinism unchanged.
* **Regression risk.** The highest of the phase: the season build is the spine. Mitigation: keep the model-with-one-pyramid path byte-identical, and gate the change on the soak's trend table matching.
* **Persistence.** None.

### Stage 2 — Regions before towns, and the second pyramid's generator
* **Objective.** A generated world has ≥ 2 regions, towns partitioned by nearest centre, and the machinery to mint a second pyramid's clubs into club-less settlements in its region.
* **Files.** `generation/worldGenerator.ts` (`generateWorld`, `generateTowns`, `regionCentreFor`, a new region partition + the settlement-slot knowledge), `gameSetup.ts` (`generateDraft` returns both pyramids' divisions), `persistence.ts` (reuse `generateLowerTierClubs`' technique with per-pyramid id prefixes).
* **Dependencies.** Stage 1 (for a world build to consume it).
* **Tests.** Same seed → identical partition and identical second pyramid; every town in exactly one region; every new club's id unique and prefixed; `world regions` test extended.
* **Acceptance.** `worldGenerator.test.ts` extended and green; a fresh two-pyramid career builds and plays.
* **Risk.** Changing region assignment could move the *founding* pyramid's towns — it must not: with one region nothing may change, and the founding pyramid's club ids and fixtures must be identical to the baseline.
* **Persistence.** None yet (fresh careers only).

### Stage 3 — Calendar lanes and the county cup
* **Objective.** Two pyramids' cups share Sundays where their fields are disjoint; a county cup gets dates of its own; every round is placed or the season is refused.
* **Files.** `calendar.ts` (`placeCupRounds` lane/group parameter; a way to request a Wednesday on purpose), `seasonStructure.ts` (place all lanes together, name the contending competition in the report), `timeline.ts` (`matchdayOnDate` revisited if any two lanes share a date they should not), `day.ts` (`prepareToday`), `cup.ts` (`seedOrder`/`isGiantKilling` by `levelOf`).
* **Dependencies.** Stages 1–2.
* **Tests.** Two rounds on one date only with disjoint fields; no club twice on a date over 5 seasons; a cup round that cannot be placed still throws; the county cup is decided every season.
* **Acceptance.** `npm run soak -- --seasons=5 --seed=vale-1` and `vale-2`: zero failures; `cup-decided`, `cup-round-has-date` both zero.
* **Risk.** Booking a club twice across lanes — guarded by `fieldIsFree`/`clubBusyOn` and by `no-club-plays-twice-in-a-day`, which is the phase's true backstop.
* **Persistence.** None (calendar and competitions are rebuilt each season).

### Stage 4 — Season-boundary activation and migration
* **Objective.** An existing career gains the second pyramid at its next roll-over, once.
* **Files.** `domain/game.ts` (the marker), `persistence.ts` (`from < 24`, bump to 24), `season.ts` (`startNextSeason` consumes it), `state/gameStore.ts` (`rollOverSeason` notice).
* **Dependencies.** Stages 1–3.
* **Tests.** Save before/at/after the roll-over; the marker consumed once; two migrations identical; v23 save loads, plays a season, rolls over, plays another.
* **Acceptance.** The §9.3 acceptance list of the architecture document, items 4–6.
* **Risk.** The one-way door: a v24 save cannot be opened by a v23 build. Mitigation: document it in the version note and make the marker's effect minimal and idempotent.
* **Persistence.** **Yes — `GAME_STATE_VERSION` 23 → 24**, additive only.

### Stage 5 — Per-pyramid invariants, budgets and the World screen
* **Objective.** The soak watches each ladder; the state-size budget is a test; the world screen shows what changed.
* **Files.** `soak.ts` (`checkPyramid` per pyramid, `tierSizes`/`tierAbility` per pyramid, a state-size invariant), `tools/soak.ts` (print it), `WorldView.tsx`, `queries.ts`, `LeagueView.tsx`, `ClubView.tsx`, `CupView.tsx` (the Plate photo keyed by id).
* **Dependencies.** Stage 4.
* **Tests.** `promotion-balance` summed per pyramid; `tier-sizes-constant` per pyramid; state ≤ 7 MB.
* **Acceptance.** Five-season soak on three seeds with zero failures; the world screen lists two ladders and a club's region.
* **Risk.** An over-strict new invariant firing on the current world — investigate, do not relax (Phase 0's own guidance).
* **Persistence.** None.

**Explicitly not in these stages:** cross-pyramid movement, the per-competition archive, `levelOf`-switching the money/churn/sponsorship readers, four pyramids, neighbouring counties. All are Phase 4/5 in the document and must stay there.

---

## 10. Open questions and architectural decisions

1. **§7.4(3) versus §8 Phase 4 — the per-competition archive.** §7.4 lists "an archive entry per competition per season" as something that "must be introduced before the expansion can ship", while §8 puts it in Phase 4. **Decision needed.** Recommendation: leave it in Phase 4 for Stage A, because the founding pyramid already loses its brackets the same way and Stage A introduces no *new* class of loss; record it as a documented Stage A limitation. If the intended reading is "prerequisite", it is a cheap add-on to Stage 1 (one entry per competition at `finishSeason`, optional array, so no schema break).
2. **§3.5 annotates `{ kind: 'county' }` as "(Stage B)" but §8 Phase 3 requires the county cup at Stage A**, and §2.1's Stage A rationale lists "a county-wide cup" among the mechanisms Stage A must exercise. The roadmap is the operative text (the phases are what ship). Treat the §3.5 annotation as stale; flag for a document fix.
3. **§2.1's Stage A rationale also claims "movement between pyramids at a season boundary"**, which §8 assigns to Phase 4. Stage A does **not** need cross-pyramid movement to be playable; confirm this reading before Stage 5.
4. **Fresh careers**: does Phase 3 make the two-pyramid world the default for a *new* career, or only reachable by migrating an existing save? The document's §11 task is written for an existing career. Recommendation: both, with the marker path for existing saves — but the new-career path needs `generateDraft` to carry two pyramids, which is a visible change to every new game and to the club-select screen.
5. **Region assignment under migration.** For a career that has already been migrated to one region (`migrateToRegions` puts every town in `region_1`), which towns belong to the new pyramid's region? The document says a town's region is written "once at generation and never rewritten", yet the expansion migration must create a second region and give it a geography. Options: (a) put the new pyramid's *new* settlements (and only those) in the new region; (b) reassign club-less existing towns to it, which violates the "never rewritten" rule but is the only way to get two geographically distinct ladders in an old county; (c) declare the second pyramid's region to be the founding region's neighbour in name only. **This needs the author's decision** — it is the single most load-bearing ambiguity in Phase 3.
6. **`pyramidOf`'s default is the *founding* pyramid**, whereas §3.2 proposes `state.userPyramidId`. The code is club-first and needs no such field; confirm the document should be amended rather than the code.
7. **A county cup's `matchdayOffset` and its interaction with the Plate.** `feedPlate`/`plateFeedRound` are inert for a cup without `consolationFor`, so a county cup needs no plate — but if Phase 5 gives it one, its `matchdayOffset` must be expressed in the shared numbering. Not a Phase 3 problem; noted so it is not designed accidentally.
8. **Weekday cup rounds.** §4.2(5) suggests Wednesdays for the county cup's later rounds. `canPlayOnWeekday(3)` is true and `kickOffForReplay` gives 6:45pm, so this is available — but the calendar has no way to *ask* for a weekday yet, and `seasonShape.test.ts`'s "holds every date on a Sunday, whatever the round" test encodes the opposite. Confirm the county cup is allowed to break that test's rule (and amend the test deliberately, not incidentally).

---

## 11. Recommended next prompt (Stage 1, ready to hand to a coding agent)

> Refactor the season build so one call builds a whole world rather than one pyramid: `BuildSeasonOptions` should take a list of pyramids (each with its own divisions and region name) plus the world's cup requests, `buildSeasonStructure` should write every pyramid's competitions, fixtures and matches in a single pass and set ownership on every `Pyramid` record, and the calendar should still be placed once. Add a `CupField` to the competition model (`{ kind: 'pyramid', pyramidId }` | `{ kind: 'county' }` | `{ kind: 'invitation', clubIds }`), defaulting to the founding pyramid when absent, and make the season build honour a county field by entering every active club. Keep a one-pyramid world byte-identical: the existing test suite, the same-seed determinism test and a two-season soak must all show the same trend table as before. Do not add the second pyramid, do not change the save schema, and do not introduce the county cup into any real season yet — a test-only build with two pyramids and a county cup is the proof.
