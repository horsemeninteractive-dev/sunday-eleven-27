# SE27 — Phase 3 Readiness Audit: the Second Pyramid and the Local Football Ecosystem

**Scope of this document.** A read-only implementation-readiness audit for **Phase 3 — "Found the second pyramid (Stage A)"** of `WORLD_EXPANSION_ARCHITECTURE.md`. Nothing in `src/`, `tools/`, `worker/` or any configuration was modified. Every claim below is grounded in the code as it stands today, checked against the architecture document's own wording.

**Code state audited:** branch `main`, `GAME_STATE_VERSION = 23` (`src/domain/game.ts`), 115 fast test files / 1,482 tests passing, typecheck clean.

**Status of this document.** It is a *historical* record: the audit was written
before the work, for the two-pyramid Stage A. The stages it plans have all been
delivered, and the milestone they were steps towards — **Alderfordshire's six
districts, 216 clubs, thirteen competitions** — has since been implemented and
measured. The audit's plan, assumptions and open questions are kept as written
(the as-built sections at each stage record what actually happened, including
where the implementation disagreed with the plan); the definitive statement of
what the county is today, what it cost and what it was measured at is
**`PHASE3_COMPLETION_REPORT.md`**. Two readings of this document are stale rather
than historical, and are corrected here rather than silently: `GAME_STATE_VERSION`
is **28** (`from < 23` regions and pyramids, `from < 26` the county's name,
`from < 27` counties, `from < 28` the district mark), and the two-district world
this audit calls Stage A's ceiling is **not** a ceiling — the same generator
founds every district the county's authored list holds.

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

### 8.5 Measured after Stage 2 (the second region and its ladder, on this machine today)

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (the **fast** half) | **118 files, 1,505 tests, all passing**, 239.0 s wall |
| `npm run test:slow` | exit 0, **41 files, 645 passed, 2 skipped**, 853.4 s — the run after the last code edit |
| `npm run soak -- --seasons=2 --seed=soak` | exit 0, **zero `fail` violations**, 29 `club-in-the-red` warnings, 71 then 74 postponements, 0 abandoned, 357 then 364 days a season, 208.5 s for two seasons |
| `npm run benchmark` | two ladders of 12/12/12 (`Brue Valley`, level 1 · `Cale Valley`, level 2), 72 active clubs, 799 fixtures a season (792 league, 4 cup, 3 friendly), 33 calendar entries, 2,072 people, state **6,526 KB**; full engine **2,266.1 ms/match**, fast **6.58 ms/match**, season loop **105.9 s** (819 fast + 30 full fixtures) |

The fast half is 2.3× its §8.1 wall time and the soak 2.6×, and both are the **world being twice the size**: a test career founds 72 clubs where it founded 36, and the season plays 808 league fixtures where it played 404. The founding county's own football is unchanged — `worldGenerator.test.ts` builds the same seed both ways and holds the two against each other club by club, town by town and division by division.

The benchmark's per-match figure is **not** a Stage 2 effect. A throwaway probe measured the same fixtures in a one-ladder and a two-ladder world of the same seed, twice each:

| World | Full engine, a match | Fast mode, a match | State |
| --- | --- | --- | --- |
| 36 clubs, one ladder | 2,074.1 – 2,278.0 ms | 3.40 – 6.29 ms | 3,186 KB |
| 72 clubs, two ladders | 2,166.4 – 2,243.2 ms | 3.40 – 3.68 ms | 6,526 KB |

The engine's cost does not move with the size of the world; state size is linear in clubs (3,213 KB historical → 3,186 KB measured at 36 clubs → 6,526 KB at 72). Today's absolute engine times are ~2.2× the §8.1 reading *in a one-ladder world as well*, so §8.1's `967.2 ms/match` is a single reading under different machine conditions rather than a baseline this branch regressed against — the controlled comparison above is the one to carry forward.

The soak's `tier1`/`tier2`/`tier3` columns still read the founding ladder's three divisions, so the trend table is the table §8.1 recorded and stays comparable across the change. The district's divisions are policed by the invariants rather than printed: division sizes are held as six entries, `tier-ability-stable` is read per division index, `tier-stratification` now walks each ladder's rungs on its own, and `promotion-balance` counts each ladder's boundaries (four across two ladders, so eight promoted and eight relegated a season — which is what the run shows).

### 8.6 What Phase 3 needs, as tests

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

**Delivered (Stage 2, as built).** The district next door is founded from its own
streams by `foundSecondPyramid` in `generation/worldGenerator.ts`, called by
`generateWorld` after the county is complete — so nothing the county has already
drawn moves. `generateDraft({ pyramids: 1 })` still produces the county's clubs,
towns, grounds, squads, rivalries and divisions byte for byte, and in a
two-ladder career every match of the county's is the match it was in a one-ladder
one; `worldGenerator.test.ts` and `worldExpansion.test.ts` assert both. The
district is drawn in the emptiest quarter of the map (a seeded maximin over a grid
of candidate centres), its settlements are generated around that centre, and each
new settlement's region is written by `nearestRegion` — nearest centre, ties
broken by the world's own stream.

**The one place this plan and its own risk note disagree.** "Towns partitioned by
nearest centre" cannot be applied to the *founding* county's towns without moving
some of them: a region centred on the mean of its own settlements is never the
nearest centre to every one of them, so any second centre takes a handful — which
is exactly what the risk note forbids, a moved town being a club moved between
ladders. Stage 2 therefore puts new settlements to the test and leaves a town the
county already has in the region it was drawn in, which is what `Town.regionId`
has always promised. Both halves are asserted: every founding town is still in
`region_1`, and every district town is still nearer its own centre.

**Cups were off at Stage 2, on purpose.** `SECOND_PYRAMID_CONFIG` was the founding
shape with `leagueCup` and `consolationCup` false, because two ladders' cups need
the calendar lanes Stage 3 builds, and a ladder with no cup needs no cup dates —
which is why the county's own calendar was identical between a one-ladder and a
two-ladder career at that stage. **Stage 3 turned them on**; see "Delivered
(Stage 3, as built)" below. The continuity claim those tests made is unchanged
and is now the stronger one: the founding ladder's league Sundays *and its own cup
rounds* are still the ones a one-ladder career plays, entry for entry
(`worldExpansion.test.ts`).

### Stage 3 — Calendar lanes and the county cup
* **Objective.** Two pyramids' cups share Sundays where their fields are disjoint; a county cup gets dates of its own; every round is placed or the season is refused.
* **Files.** `calendar.ts` (`placeCupRounds` lane/group parameter; a way to request a Wednesday on purpose), `seasonStructure.ts` (place all lanes together, name the contending competition in the report), `timeline.ts` (`matchdayOnDate` revisited if any two lanes share a date they should not), `day.ts` (`prepareToday`), `cup.ts` (`seedOrder`/`isGiantKilling` by `levelOf`).
* **Dependencies.** Stages 1–2.
* **Tests.** Two rounds on one date only with disjoint fields; no club twice on a date over 5 seasons; a cup round that cannot be placed still throws; the county cup is decided every season.
* **Acceptance.** `npm run soak -- --seasons=5 --seed=vale-1` and `vale-2`: zero failures; `cup-decided`, `cup-round-has-date` both zero.
* **Risk.** Booking a club twice across lanes — guarded by `fieldIsFree`/`clubBusyOn` and by `no-club-plays-twice-in-a-day`, which is the phase's true backstop.
* **Persistence.** None (calendar and competitions are rebuilt each season).

**Delivered (Stage 3, as built).** Three things changed, and one of them is not
what this plan proposed.

*Lanes are a property of the fields, not a list of names.* `placeCupRounds` takes,
per slot, the clubs its round *could* draw (`CupRoundSlot.clubs`) and serves a
Sunday to a round unless the date is already held by a league matchday (which
speaks for the whole world) or by a round whose field overlaps this one's. Two
rounds therefore share a date exactly when no club could be in both — which is the
two ladders' cups, and not the county cup, whose field is the county. Disjointness
is asked of the *entry* field rather than of the ties drawn, because this is
decided when the season is built and the draw has not happened yet. A slot that
says nothing about its field overlaps every other round, which is the
one-round-per-Sunday behaviour every caller had before lanes existed, so a legacy
or hand-built request is unchanged. A round that shares a date carries the rounds
it shares it with in `PlacedCupSlot.shared`, which is what lets the builder's
refusal name the competition it actually collided with.

*The district's own cups are on.* `SECOND_PYRAMID_CONFIG` is the founding shape
again, so a new career founds **five** cups: each ladder's League Cup and Plate —
each drawn from its own ladder's 36 clubs — and a County Cup drawn from the 72
active clubs of both and owned by no ladder (`pyramidIdOf` answers null for it).
`countyCupRequests(ladders)` is the one place that decides whether the county runs
one: it asks for none in a county with a single ladder, where the ladder's own cup
already is the county's cup, which is what keeps a one-ladder career's calendar
and competition list exactly what they were.

*Every round is dated and numbered, and no Wednesday was needed.* The founding
ladder's cups keep matchdays 23–33, the district's take 34–44, and the county cup
takes 45–52. The two ladders' cups play the off-week Sundays the league leaves free
(2026-09-13, 2026-10-11, 2026-11-08, 2026-11-22, 2027-01-17, 2027-01-31 …), and
the county cup's eight rounds take the Sundays neither the league nor either
ladder's cups are using: 2026-09-27, 2026-10-25, 2026-12-06, 2027-02-14,
2027-03-14, 2027-04-11, 2027-05-23 and the final on 2027-07-18, the last date of
the season. **This is the answer to §4.2(5) and to open question 8**: no midweek
round is necessary, so `seasonShape.test.ts`'s "every cup date is a Sunday" still
holds and the calendar keeps its one weekday instead of gaining a weekday request
it did not need. The season is three weeks longer than a one-ladder career's
because the county cup's rounds are afternoons nobody else can use; that is the
county cup's cost and it is the only thing about the county's own season that
moved.

*The day loop prepares a date, not a matchday.* Two rounds can be on one
afternoon, so `prepareToday` walks every calendar entry dated today rather than the
first one the calendar happens to hold (`day.ts`), and `matchdayOnDate` answers
with an entry that really is on the day asked about. Nothing reads a round off a
position in the calendar.

**Ownership, and the legacy fallback (audit §6).** `foundingPyramid(state)` — the
record a career written before ladders existed is read with — now claims a cup
only when its *field* says the founding ladder owns it (a cup with no field at all
is the founding ladder's, which is what every pre-field cup meant) instead of
claiming every cup in the world. A county cup therefore cannot leak into a
ladder's `cupIds`, and from there into a ladder's views or its rollover. Cup
seeding and giant-killing comparisons read `levelOf` rather than the bare tier, so
a county cup tie between the two ladders is seeded and reported as the difference
in football it is: a district top-division side beating the county's third
*division* is not two rungs and a giant killing.

**One deviation from this plan.** It proposed lanes *by name*, and the
architecture document proposed Wednesdays for the county cup's later rounds
(§4.2.5). What was built asks the question the scheduler can actually answer at
build time — do these two rounds have a club in common? — and needed no weekday:
the two ladders' rounds share, which frees enough off-week Sundays for the county
cup's eight. The lane *model* is therefore smaller than planned and the calendar is
unchanged from Stage 2's; the plan's own risk note ("booking a club twice across
lanes") is discharged by the field test rather than by naming the lanes.

### 8.7 Measured after Stage 3 (the lanes and the county cup, on this machine today)

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (the **fast** half) | **119 files, 1,517 tests, all passing**, 192.1 s wall |
| `npm run test:slow` | exit 0, **41 files, 646 passed, 2 skipped**, 732.8 s — the run after the last code edit |
| `npm run soak -- --seasons=2 --seed=soak` | exit 0, **zero `fail` violations**, 26 `club-in-the-red` warnings, 83 then 84 postponements, 0 abandoned, **364 then 364 days** a season, **179 cup ties** a season, 192.7 s for two seasons |
| `npm run build` | exit 0 |
| `npm run benchmark -- --seasons=1` | 72 active clubs in two ladders of 12/12/12 (`Brue Valley` level 1 · `Cale Valley` level 2), **807 fixtures** a season at build (792 league, 12 cup, 3 friendly) and **974 played** over the season (friendly, league and all five cups), **52 calendar entries** (22 league Sundays, 30 cup rounds on 41 distinct dates), span 315 days; full engine **1,618.4 ms/match**, fast **4.38 ms/match** (370×), **364 days** for the season, **89.8 s** for the loop, fresh state **6,541 KB** |

Against §8.5's Stage 2 readings, the world is the same size and the same speed per match, and the football is what changed:

| | Stage 2 | Stage 3 |
| --- | --- | --- |
| Calendar entries | 33 | 52 (41 distinct dates) |
| Fixtures at build | 799 | 807 |
| Matches played in the season | 849 | 974 (+125) |
| Cup ties a season | 54 (one ladder's cup and Plate) | 179 (two ladders' cups and Plates, plus the county cup) |
| Postponements (2 seasons) | 71, 74 | 83, 84 |
| Days a season | 357, 364 | 364, 364 |
| Fresh state | 6,526 KB | 6,541 KB |
| Full engine, a match | 2,266.1 ms | 1,618.4 ms |
| Fast mode, a match | 6.58 ms | 4.38 ms |

The +125 matches are exactly the football the county cup and the district's two cups add (54 + 71), and the +19 calendar entries are the 30 cup rounds minus the 11 dates the two ladders share. **Nothing about the founding ladder's own season moved**: its league Sundays and its own cup rounds are the ones a one-ladder career plays, entry for entry (`worldExpansion.test.ts`).

**The season-end state size is worth reading properly, because it looks alarming and is not.** A season's state reaches **83,396 KB** against 6,541 KB at its start — and 65,878 KB of that is `state.matches`: every match played this season keeps its event record until the roll-over rebuilds the match map, which is what the game has always done. It is proportional to football played (≈65 KB a match, the manager's own 32 full-engine games costing a large multiple of the background ones) rather than to the world, so the five-cup world's +125 matches are why it is 83 MB where a two-cup season's would be about 74 MB. The number the Phase 3 acceptance criterion names — the state the game is *founded* with — is the 6,541 KB above, which is Stage 2's 6,526 KB. **The in-season save size is a real thing to look at, and it is a Phase 4 question about how much of a played match the save keeps, not a Stage 3 regression**; it is recorded here so it is not rediscovered as one.

**One bug the soak caught, and one the benchmark's own arithmetic did not.** `honours-not-duplicated` fired six times on the first Stage 3 run: both ladders' cups were called `Sunday League Cup`, so the district's winner was filed under the county's trophy — an honour is a string, `${season} ${name} winners`. Cups are now named after the ladder that runs them (`cupNameFor`), exactly as divisions are: the county's keep the names they have always had and the district's carry its region. The benchmark's season loop, by contrast, watched `state.season.id` for the end of the season — and the id only changes at `startNextSeason`, which the tool calls between seasons — so it played **420 days** through a season that had ended on day 364 and read the state four hundred days of nothing had grown into as "the state at a season end". It stops on `season.finished` now. Both are fixed, and the numbers above are from the fixed code.

### Stage 4 — Season-boundary activation and migration
* **Objective.** An existing career gains the second pyramid at its next roll-over, once.
* **Files.** `domain/game.ts` (the marker), `persistence.ts` (`from < 24`, bump to 24), `season.ts` (`startNextSeason` consumes it), `state/gameStore.ts` (`rollOverSeason` notice).
* **Dependencies.** Stages 1–3.
* **Tests.** Save before/at/after the roll-over; the marker consumed once; two migrations identical; v23 save loads, plays a season, rolls over, plays another.
* **Acceptance.** The §9.3 acceptance list of the architecture document, items 4–6.
* **Risk.** The one-way door: a v24 save cannot be opened by a v23 build. Mitigation: document it in the version note and make the marker's effect minimal and idempotent.
* **Persistence.** **Yes — `GAME_STATE_VERSION` 23 → 24**, additive only.

**Delivered (Stage 4, as built).** An existing one-ladder career gains the district at its next roll-over, once. §7.2(1)'s `state.pendingWorldExpansion` is realised as **`state.worldExpansion: { pending, expandedInSeasonId? }`** — the state's conventions are records with a shape of their own rather than bare booleans, and the consumed form has to say *which* boundary did it. `GAME_STATE_VERSION` is **24**, and the migration is one line of consequence — `if (from < 24) markWorldExpansion(state)` — which writes `state.worldExpansion = { pending: <the world has one ladder> }` and touches nothing else: no club, region, ground, date or result. The founding itself is a new module, `simulation/worldExpansion.ts`. `activateWorldExpansion` is `startNextSeason`'s **first act**, before last season's movements are settled and before the ladders are read, so the season is built for both pyramids in the one `buildSeasonStructure` call rather than built once and appended to; the district's ladder is handed to that build as its divisions, and `applyMovements` is deliberately *not* run for it — a ladder founded this afternoon has no table to settle, which is §5's "do not apply founding-pyramid movements to the new pyramid before it has completed its first season". Five decisions are worth recording.

1. **The marker is spent before anything is generated.** A failure below it leaves the county with the one ladder it has rather than founding a second district on the next attempt, and a world that already has a second ladder or a second region is left exactly as it is: the marker is cleared and the boundary moves on. Loading a save twice cannot answer the question twice, and the marker travels with the career rather than living in a session.
2. **The second region is populated by its own settlements** — open question 5's option (a). `migrateToRegions` puts every town of an old career in `region_1`, and expanding *that* by reassigning club-less villages would move a town's football, which `Town.regionId` forbids. So the map's emptiest quarter is found and the district's settlements are drawn in it (the Stage 2 generator, unchanged), and its clubs are only ever minted into sites that are already in the district. Some of those drawn settlements land nearer the county and stay in `region_1` with no club of the district's in them — Stage 2's documented deviation, unchanged by this stage.
3. **Ids continue the *save's* own count.** `foundSecondPyramid` gained `firstTownIndex`/`firstBusinessIndex`, read off the ids the career actually holds (the highest number in use, plus one) rather than off the length of the lists it was handed: a played career is not the world a fresh generator would write, and `town_<n>` numbered from the wrong end is a town id that already exists. Club, ground and person ids stay prefixed by the ladder's own id, so nothing a later migration mints can collide with them.
4. **The district's clubs take no part in the summer that is closing.** Activation happens before the ageing, the youth intakes, the transfer business (`runAiClubSummer`) and the finance review, all of which read `leagueClubIds` — which at that point is still *last season's* competitions, and so is the county's alone. The district's clubs were minted minutes earlier with a squad, a committee, a ground and a kitty; their first summer is the season they are about to play. Everything that belongs to the *new* season (annual costs, sponsorship review, the managers' market, the staff lifecycle, season records, standings, matchday one) runs after the build and so covers all six divisions.
5. **The manager is told once, in the news** (`type: 'world'`, dated the first day of the new season), rather than in a store notice or on a screen: it is the channel the world tells him about itself in, and no UI file is touched.

The other half of the migration is what a career that is *already* two-laddered gets: `{ pending: false }`, recorded so that opening the same save twice is the same answer twice — and so that a career expanded by an earlier build can never be expanded again.

**Tests.** `worldExpansion.test.ts` grew a second describe, "a career that is owed the district next door" (nine tests): the county is one ladder through a fortnight of the real day loop and through `finishSeason`, and two the moment `startNextSeason` runs; the district is founded exactly once, at the boundary, and the mark is spent doing it; a mark on a world that already has both ladders founds nothing; rolling the same career twice, once owed and once not, leaves the county identical club for club, honour for honour, competition for competition and fixture for fixture; the district's ids are unique against the career's own, every club of it has a town in the district, a ground on that town, a squad, a committee and a season record, and no club is in two divisions; the same career is founded the same district twice (ids, towns, grounds, identities, squads); the expanded season has the five cups with the right fields and ownership, a Sunday-only calendar with one matchday per entry, every cup tie numbered and every competitive fixture dated, and nobody playing twice in a day; the expanded career plays its first two-ladder season, settles boundaries in *both* ladders at its close and rolls over again without growing a third; and a career born with both ladders is never marked, never expanded and never given a third. `persistence.test.ts` grew "the district next door" (four tests): a version 23 one-ladder save opens marked and otherwise untouched, with `{ pending: true }` surviving a save and a reload; a version 23 two-ladder save opens `{ pending: false }`; and a marked career got its district at the boundary, ran ten weeks of the *real* day loop on the expanded world — until the county cup's opening round had been played out, with league football played in both ladders and nobody booked twice on an afternoon — kept its district across a save and a reload, and rolled over a second time without a third. The pre-existing migration test that rolled a v22 career over expecting one ladder now expects the district, deliberately: a one-ladder career is exactly what a district is owed to, and the test's intent (a migrated career plays its boundary through the pyramids' own records) is unchanged.

**Measured after Stage 4 (this machine, the run after the last code edit).** Stage 4 is designed to change nothing about the world a fresh career is founded with, and it does not — every figure is Stage 3's, within this machine's variance.

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (the **fast** half) | **119 files, 1,526 tests, all passing** (1,517 + the nine above) |
| `npm run test:slow` | exit 0, **41 files, 650 passed, 2 skipped** (560.2 s) |
| `npm run test:soak` (gated) | exit 0, **13 tests, all passing** (236.1 s) |
| `npm run soak -- --seasons=2 --seed=soak` | exit 0, **zero `fail` violations**, 26 `club-in-the-red` warnings, 808 fixtures a season, 179 cup ties, 83 then 84 postponements, 0 abandoned, 364 days a season, 116.9 s |
| `npm run build` | exit 0 |
| `npm run benchmark -- --seasons=1` | 72 active clubs in two ladders of 12/12/12, **807 fixtures** a season, **52 calendar entries** (22 league Sundays, 30 cup rounds), fresh state **6,541 KB**, season-end **83,396 KB**; full engine **991.0 ms/match**, fast **2.58 ms/match** (385×); season loop **52.4 s** (942 fast + 32 full fixtures) |

Against §8.5's Stage 2 and Stage 3 tables, nothing moved: same 72 clubs, same 807 fixtures, same 52 calendar entries, same 6,541 KB fresh state, the same season-end 83 MB a played season has always reached. The per-match times are lower than the Stage 3 reading and in line with §8.1's, which is the same machine-condition variance §8.5 already records — Stage 4 touches a fresh career's world not at all, so it is the wrong change to hang a timing on.

### Stage 5 — Per-pyramid invariants, budgets and the World screen
* **Objective.** The soak watches each ladder; the state-size budget is a test; the world screen shows what changed.
* **Files.** `soak.ts` (`checkPyramid` per pyramid, `tierSizes`/`tierAbility` per pyramid, a state-size invariant), `tools/soak.ts` (print it), `WorldView.tsx`, `queries.ts`, `LeagueView.tsx`, `ClubView.tsx`, `CupView.tsx` (the Plate photo keyed by id).
* **Dependencies.** Stage 4.
* **Tests.** `promotion-balance` summed per pyramid; `tier-sizes-constant` per pyramid; state ≤ 7 MB.
* **Acceptance.** Five-season soak on three seeds with zero failures; the world screen lists two ladders and a club's region.
* **Risk.** An over-strict new invariant firing on the current world — investigate, do not relax (Phase 0's own guidance).
* **Persistence.** None.

**Delivered (Stage 5, as built).** Both halves of the stage are in, and the screens are the larger half — with career creation, which this plan left to open question 4, delivered with them.

*The ladder is now the unit every screen reads.* One module, `src/ui/worldNav.ts`, answers the four questions the screens all ask — which ladders the world has, which one is the manager's, which divisions make up this one, and whose cup is this — so four screens cannot each answer "which ladder is mine" differently. `pyramidOptions` reads `pyramidsOf`/`divisionsOf`/`regionNameFor`; `ownPyramidId` and `defaultPyramidId` answer club-first (`divisionOf` → `pyramidIdOf`), which is the same reading §2.1's `pyramidOf` note settled; `cupOptions` reads each cup's **declared field** through `cupFieldOf` (so a Plate that has not been filled yet is still its ladder's Plate, and the County Cup is nobody's ladder's) and sorts them the way a manager thinks of them: his ladder's, the one next door, then the county's. Nothing in the module writes, and a test holds that: `pyramidOptions`, `cupOptions` and `ladderChoices` on a live career leave `JSON.stringify(state)` byte-identical.

*The picker is one component.* `src/ui/components/PyramidPicker.tsx` is the same tabstrip in all three places a manager chooses which football he is looking at — the club-selection list, the club designer and the league table — labelled by the region the ladder draws its clubs from (the shortest true name it has) with the ladder's own long name, its level and its size in the tooltip behind it. **A world with one ladder draws nothing at all**: a tabstrip with one tab cannot change anything, and that guard lives in the component rather than in each caller, so a career written before the district existed looks exactly as it did.

*Career creation reads the draft, not the county* (open question 4, answered). `ClubSelectView` builds its lists from `draftLadderOptions(draft)` — every ladder the draft was generated with, its own regions, its own divisions by their own names — instead of the founding ladder's flat division list, which had quietly made the district's 36 clubs unplayable. The chosen club's **league and division are named on its own card** before the career is confirmed, and moving the ladder or the division does not drop the club he has chosen: reading somebody else's table is not changing his mind, and a screen that unselected it for him would be deciding for him. `CreateClubView` gained the same picker, and the club he builds joins the foot of the ladder he chose rather than the county's own — `bottomDivisionClubIds(draft, pyramidId)` and `displacedClubId(draft, pyramidId)` decide which club loses its place, and `townChoicesFor(draft, pyramidId)` offers that ladder's region's towns. A design that names no ladder still builds in the county's own: the default is not a new rule, it is every design written before a second ladder existed.

*A completed career can read the whole world without moving in it.* `LeagueView` opens on the manager's own ladder and his own rung wherever he is managing, offers every ladder the county has and, inside one, every rung it has — with "· yours" on his ladder and on his division so a manager browsing next door can see at a glance which football is his. The division tabs wear the name the season gives them without the ladder's own name in front of them (`Division Three`), read from the same `divisionNameFor` the league table is built with. `CupView` offers **five** competitions — each ladder's League Cup and Plate, named after the region that runs them, and the County Cup — each tab's tooltip saying in full whose competition it is, and the header repeating it (`owner` and `kind`) before any bracket, because a ladder's cup and the county's are read differently. `WorldView` lists the county's ladders — name, region, level, clubs, divisions — counts the regions, and names a club's region and its league in its own panel. The founding ladder's cups keep the labels they have always had (`Cup`, `Plate`); a ladder next door's carry its region, which is the same rule its divisions and its competitions' names follow.

*Legacy saves.* No migration was added and none was needed: the browsing reads whatever the career holds. A one-ladder career yields one ladder (`pyramidOptions` has a defensive path for a save whose ladder records went missing, and a test for it), draws no picker, and shows two cups, both its own. A career that has been given the district at its boundary browses both ladders and five cups with no further state. Nothing about browsing can expand a world: the only thing that founds a district is the `worldExpansion` marker at a season boundary, and this milestone does not touch it.

**Measured after Stage 5 (this machine, the run after the last code edit).**

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (the **fast** half) | **122 files, 1,553 tests, all passing**, 197.4 s (the run after the last edit) |
| `npm run test:slow` | exit 0, **41 files, 650 passed, 2 skipped**, 496.9 s |
| `npm run build` | exit 0 (6.5 s, `dist/` written, precache manifest 88 files) |
| `npm run soak -- --seasons=2 --seed=soak` | exit 0, **zero `fail` violations**, 26 `club-in-the-red` warnings, 83 then 84 postponements, 0 abandoned, 364 days a season, 124.1 s |
| `npm run benchmark` | 72 active clubs in two ladders of 12/12/12, **807 fixtures** a season, **52 calendar entries** (22 league Sundays, 30 cup rounds), each ladder's cup 36 entrants and the county cup 72, fresh state **6,541 KB**; full engine **1,006.3 ms/match**, fast **2.78 ms/match** (362×), season loop **55.9 s** (942 fast + 32 full fixtures) |

Against the Stage 4 table nothing moved that this stage could move: the same 72 clubs, the same 807 fixtures, the same 52 calendar entries, the same 6,541 KB, and the same soak line for line — 26 warnings, 83 then 84 postponements, no abandoned match, 364 days a season. The fast half's 122 files and 1,553 tests include the three suites this milestone added (`ui/worldNav.test.ts`, 17 tests — three of them new with the division labels; `ui/components/pyramidPicker.test.ts`, 4; `simulation/careerSetup.test.ts`, 6) and the fast-half count is the same world being browsed rather than simulated differently.

**Browser pass (the real flow, `npm run dev`, Chromium at 1280×900 and 390×844).** On desktop: a new career's club list offered two ladders by region and three divisions each, opened on the founding ladder's top division with its strongest club selected, switched to the second ladder's bottom division without dropping the selection, and took charge of a club there; the career then opened its league table on **that** ladder's third division with the club marked `you`, and its Cup screen on that ladder's own cup. In the founding ladder, a career likewise opened on the county's own Division One with its club marked `you`. Switching ladders changed the table (12 clubs, none of them the manager's) and the division tabs showed `· yours` only inside his own ladder; switching back returned him to his own division. The cup tabs read `Cup`, `Plate`, `<region> Cup`, `<region> Plate`, `County Cup`, with each ladder's cup showing `36 of 36 in the draw` and the County Cup `72 of 72`. On a 390×844 viewport the menu, the club list, both tabstrips, the league table and the five cup tabs (wrapping to two rows) all rendered with **no horizontal overflow** (`scrollWidth === clientWidth`) and every control reachable, and the mobile screens sheet offered League Table, Cups and World. One reading through the cup screen is not a defect: the preliminary round of a 36-club cup is four ties, so 28 clubs — including a newly chosen bottom-division club — have a bye and so no cup fixture until the round they enter is drawn, which is the cup plan's own arithmetic and unchanged by this stage.

**Not done, and known.** Stage 5's other acceptance items are not met by this milestone: there is still no **state-size budget test** (the fastest place for it is `soak.ts`, where the world is already built), and the five-season soak on three seeds has not been run — what ran for this stage is the gated `soak.test.ts` smoke (with the slow suite) and `npm run soak -- --seasons=2 --seed=soak` on one seed, both recorded above. The competition archive is still Phase 4 (open question 1), so a finished cup's brackets are still lost at the roll-over; this stage browsed the competitions that exist and added no archive. Finally, the Fixtures and Results screens remain the *manager's* schedule — browsing another division gives its table and the week's fixtures and results from the league screen, which is what the competition records carry.

**Explicitly not in these stages:** cross-pyramid movement, the per-competition archive, `levelOf`-switching the money/churn/sponsorship readers, and neighbouring counties. All are Phase 4/5 in the document and must stay there. (The plan's "four pyramids" is delivered rather than deferred: Alderfordshire has six — see Stage 6 below.)

### Stage 6 — Alderfordshire's six districts *(the milestone this audit was for)*

* **Objective.** All six authored districts of Alderfordshire play football of their own: six three-division ladders, 216 clubs, eighteen divisions, six League Cups, six Plates and an Alderfordshire County Cup across the lot — for a career founded today and for one that is owed districts at a season boundary.
* **Files.** `domain/districts.ts` (the authored list), `geography/alderland.ts` (`alderfordshireDistricts`, `districtCentreInWorld`), `simulation/generation/worldGenerator.ts` (`foundDistrictPyramid`, and a `generateWorld` that founds every district), `simulation/worldExpansion.ts` (`missingDistricts`, `activateWorldExpansion`, `markWorldExpansion`), `state/persistence.ts` (`from < 28`), `simulation/season.ts` (the expansion as `startNextSeason`'s first act), `ui/` (the map, the ladders, the cups).
* **Dependencies.** Stages 2–5, all of them, including the screens: a district nobody can choose is not a district.
* **Tests.** `simulation/countyWorld.test.ts` (the county as one world: six ladders, thirteen competitions, a full season rolled over, a save round trip, a career begun in any district and named after it), `simulation/worldExpansion.test.ts` (expanded in place: nothing the county held moves, the districts arrive once, repeatedly-rolled careers do not grow a seventh), `generation/worldGenerator.test.ts` (a two-district world is byte-for-byte what it was; the two districts the county has always had are unchanged in a six-district world), `geography/*` and `ui/worldNav.test.ts`/`ui/views/competitionNaming.test.ts` for the map, the names and the screens.
* **Acceptance.** 216 clubs in eighteen divisions of twelve; every one of the thirteen competitions has a field of its own ladder's clubs or of the whole county; no club twice on a date; the season finishes and rolls over with all six standing; a legacy one-ladder save gains five districts at its next boundary and a two-ladder save four, exactly once; the map, the tables and the cups agree about which district is which.
* **Risk.** The world's size (state and season time) and, above all, the temptation to give the sixth district a code path the fifth does not have. Both are measured, not assumed: §8–9 of `PHASE3_COMPLETION_REPORT.md`.
* **Persistence.** `from < 28` marks the career; nothing is generated on load.

**Delivered (Stage 6, as built).** The county is data. `domain/districts.ts` holds six `DistrictDefinition`s (region id, the map's name, level, ladder config, and — for the two districts the world has always had — `legacy`), `alderfordshireDistricts()` fills each map district's centre from the atlas, and `generateWorld` founds every one of them with `foundDistrictPyramid` — the function this audit knew as `foundSecondPyramid`, which is still the whole of the generator's district path. `foundSecondPyramid` is gone as a name because it was a true description of a two-ladder world and a false one of this one; its only callers were the generator and the expansion, and both moved to the district-shaped API in the same change.

The expansion is a statement about districts rather than about a second ladder. `state.worldExpansion: { pending, expandedInSeasonId? }` keeps the shape Stage 4 gave it, and *what is owed* is read off the world — `missingDistricts` compares the career's own regions with the authored six — so a one-ladder save gains five, a two-ladder save four, a complete county none, and no roll-over can found a seventh district. `activateWorldExpansion` spends the mark before it mints anything, founds every owed district in the map's order, and hands the divisions back to the season that is being built; nothing the career already holds moves, and `worldExpansion.test.ts` holds it to that field for field, managers included.

The geography is authoritative. Every town is drawn inside the region of the district it was founded for (`town.regionId` is the district's own id), every club's town is in the district its ladder belongs to, and a town-based club name is therefore a name from the place the club actually plays. The four districts the map added stand where the atlas draws them (`districtCentreInWorld`); the founding county and the district next door keep the ground the world has always drawn for them, which is what keeps a two-district world byte-for-byte the world it was — `worldGenerator.test.ts`'s `LEGACY_DRAFTS` baselines and `countyWorld.test.ts`'s "the two-district county with four districts beside it" are the two halves of that proof.

The names come from the data. A ladder is `<region> Sunday League`, its divisions `<region> Sunday League Division One|Two|Three`, its cups `<region> Sunday League Cup` and `… Plate`, and the county's is **Alderfordshire County Cup** — all composed by the central helpers (`leagueNameFor`/`cupNameFor`/`divisionNameFor`), which is why the sixth district's names needed no code and why two districts cannot share a competition id (`comp_<ladder>_cup`, `comp_<ladder>_plate`, `comp_county_cup`).

**Measured after Stage 6** (the run after the last code edit; this machine, branch `main`).

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (the **fast** half) | **132 files, 1,646 tests, all passing**, 251.4 s |
| `npm run test:slow` | exit 0, **44 files, 679 passed, 2 skipped** (760.6 s) |
| `npm run build` | exit 0 (14.3 s, `dist/` written, precache manifest 90 files) |
| `npm run benchmark -- --seasons=1` | six districts, **216 active clubs** in 18 divisions of 12, **2,407 fixtures** listed a season (2,376 league, 28 cup, 3 friendly), **97 calendar entries** (22 league Sundays, 75 cup rounds), each League Cup 36 entrants, each Plate 0 (filled by the League Cup's losers), the **County Cup 216**; fresh state **20,201 KB**, season-end **200,102 KB**; full engine **1,110.0 ms/match**, fast **2.79 ms/match** (398×), season loop **142.8 s** (2,886 fast + 31 full fixtures) |
| `npm run benchmark -- --districts=2 --seasons=1` (the compatibility world, for comparison) | 72 clubs, **807 fixtures**, fresh state **6,544 KB**, season-end **83,431 KB** |
| Browser walk-through (Electron against `npm run dev`, `.verify/se27-career.cjs`) | three careers — `region_1`, `region_2` and `region_3` — each from the profile step through the county map, district selection, club selection and into the game: six districts offered and none locked, the chosen district's **36 clubs in 3 divisions** and no picker to escape it, a league screen offering **6 ladders / 18 divisions** with the manager's own marked `— yours`, a cup screen offering **13 competitions** across 7 groups, a world screen naming all six ladders and counting **216 clubs, 216 grounds**, browsing another division without the career changing, **no console errors** |

The two halves' counts and the four numbers this milestone turns on — 216 clubs, 2,407 fixtures, 142.8 s a season, 200 MB at a season end — are set out with their breakdowns in `PHASE3_COMPLETION_REPORT.md` §8–9.

**Known limitations after Stage 6**, stated here because they are what a second county would meet first: the end-of-season state is ~200 MB (73% of it `state.matches`), which is measured rather than capped — there is still no state-size budget test in `soak.ts`; the season loop takes ~143 s for the six-district county and no per-day latency instrumentation (mean/p95) exists, so §6.4's budget is checked coarsely; the per-competition archive is still Phase 4, so a finished cup's brackets are still lost at the roll-over; and no second county exists yet, so "the generator is reusable" is demonstrated by the *absence of county-specific branches* rather than by a second county playing.

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
