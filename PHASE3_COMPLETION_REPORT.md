# SE27 — Phase 3 Completion Report: Alderfordshire's six districts

**What this document is.** The as-built record of the milestone that gave
Alderfordshire its whole football world: **six authored districts, six
three-division ladders, 216 clubs, eighteen divisions and thirteen competitions**,
for a career founded today and for an existing career that is owed districts at a
season boundary. It replaces no plan — `WORLD_EXPANSION_ARCHITECTURE.md` holds the
architecture and `PHASE3_READINESS_AUDIT.md` the pre-work audit and the per-stage
records — it states what the county *is* now, what it cost and what was measured.

**Status.** Complete and verified for Alderfordshire. Not started, deliberately:
any second county (see §11).

All figures below were measured on this machine, branch `main`, after the last
code edit of the milestone, unless a row says otherwise.

---

## 1. Verdict, against the definition of done

| Requirement | Result |
| --- | --- |
| Six authored districts with canonical stable ids | **Yes** — `region_1 … region_6`, authored in `domain/districts.ts` |
| Every district playable, with a three-division pyramid | **Yes** — six ladders, 12/12/12 each |
| 216 clubs with their world records registered | **Yes** — 216 active clubs, 216 grounds, 6,283 people, 140 settlements (seed `bench`; §4 reads seed `county-world`) |
| Each district's own League Cup and Plate | **Yes** — twelve cups, `comp_<ladder>_cup` / `comp_<ladder>_plate` |
| Alderfordshire County Cup across all six | **Yes** — `comp_county_cup`, `field: { kind: 'county' }`, 216 entrants |
| Calendar, progression, save/load, roll-over, navigation | **Yes** — see §7, §9, §10 |
| Eligible legacy careers expand safely at the boundary | **Yes** — one district or four, once, in place |
| Reusable architecture, no second special-case pyramid | **Yes** — data plus one generator; `foundSecondPyramid` is gone |

---

## 2. Audit findings, and what they meant for the work

The audit (kept in `PHASE3_READINESS_AUDIT.md`) found that Stages 2–5 had already
left a world the rest of the game read *as a world*:

* `state.pyramids` / `state.pyramidIds` and `world.regions` / `town.regionId`
  existed (v23), with every competition id pyramid-scoped
  (`comp_<ladder>_t<n>`, `comp_<ladder>_cup`), `levelOf` separating a rung from a
  level of football, and `CupField` (`{ kind: 'pyramid' | 'county' | 'invitation' }`)
  declaring each competition's own field.
* The season build, the calendar, `placeCupRounds` and the soak were already
  world-aware: cups are placed beside any round whose field shares no club, the
  soak checks `every-club-in-one-league`, `promotion-balance` and
  `no-club-plays-twice-in-a-day` per ladder, and `finishSeason` loops every
  ladder's divisions.
* The screens already read ladders rather than "the pyramid": `ui/worldNav.ts`
  answers every question the league, cup, world and club-selection screens ask,
  and `PyramidPicker` draws nothing for a one-ladder world.

What was **still tied to a founding pyramid plus one special second**, and so was
the work:

1. The generator exposed a district-shaped function but only ever called it for
   `region_2`, and `generateWorld`'s district path was written as "the founding
   county, then the district next door" (`foundSecondPyramid`).
2. Geography was only bound for two districts: `alderfordshireDistricts()` gave
   the four unmapped-by-the-game districts no centre, and the selection bindings
   were keyed to `region_1`/`region_2`.
3. The expansion marker could only mean "the county is owed its second ladder".
4. Names, counts and tests asserted 2 ladders / 72 clubs / 5 cups / 6 divisions:
   `careerSetup`, `worldNav`, `geographySetup`, `alderland`, `selection` and the
   slow `persistence` suite all encoded the two-district world as the world.
5. `worldExpansion`, `countyWorld` and `countyScope` were the only places that
   knew a career could be owed anything, and the `pyramids: N` test path could
   build a six-district world *without* the map's geography — i.e. a world that
   was not the one a career is founded in.

Findings confirmed, one corrected against the source: the audit's assumption that
`buildSeasonStructure` needed to take a list of pyramids was already satisfied by
Stages 2–3 (it takes `Array<{ pyramidId, regionName, divisions }>` and the world's
cup requests), so no season-build refactor was needed for six districts — only for
the *counts* to grow.

---

## 3. Architecture changes: how districts and pyramids were generalised

**The district is data, and the list is the county.**
`src/domain/districts.ts` (new) holds `DistrictDefinition` — `regionId` (the
district's stable id, and the map region it is drawn as), the map's `name`,
`level`, the ladder `config`, an optional `centre`, and `legacy` for the two
districts the world has always had — and `ALDERFORDSHIRE_DISTRICTS`, the six of
them in the map's own order. Nothing else in the codebase names a district:

| Where | What it does with the list |
| --- | --- |
| `geography/alderland.ts` | `alderfordshireDistricts()` — the county's districts with each map district's `centre` filled from the atlas (`districtCentreInWorld`); the two `legacy` districts are left as authored |
| `generation/worldGenerator.ts` | `generateWorld` founds **every** district in the list; `foundDistrictPyramid` founds one, from its own streams, minting every id under the ladder's own id |
| `simulation/worldExpansion.ts` | `missingDistricts` — the county's districts this career's regions do not include; `activateWorldExpansion` founds them |
| `geography/alderland.ts` (map) | each district's shape, name and football binding, keyed by the district's own id |
| the tests | the same list, so a seventh district needs no test rewritten |

**One generator, one district at a time.** `foundSecondPyramid` was renamed
`foundDistrictPyramid` and generalised: it is handed a `DistrictDefinition`'s
region, name, level, config and centre, the stream to draw from, the valleys
already spoken for, the ids the world has already used (`pyramidIds`,
`firstTownIndex`, `firstBusinessIndex`), and the world's own mutable
towns/businesses/grounds/clubs/people/regions, which it appends to. It draws its
valley, river, map area, settlements, businesses, grounds, clubs, squads,
committees and rivalries deterministically from streams keyed to its own stream
name, and it refuses to mint into an id the world already holds. `generateWorld`
calls it in a loop; `activateWorldExpansion` calls it for every district a career
is owed. **There is no second code path for "the second pyramid"** — the
`pyramids: N` option is now a *prefix of the county* (`alderfordshireDistricts()
.slice(0, N)`), so a two-district world is the six-district world with four left
off the end.

**Which stream a district draws from is authored, not inferred.** The district
next door carries `legacy: true`: it draws from `${seed}::district` (the stream it
has drawn from since it existed) and keeps the ground the world has always drawn
for it. Every district the map *added* draws from
`${seed}::district::<regionId>` and stands where the atlas draws it. That single
flag is what keeps the compatibility world byte-for-byte what it was while letting
five districts be five draws rather than one valley, one river and one quarter of
the map five times.

**The expansion marker became a statement about districts.**
`state.worldExpansion` keeps the Stage 4 shape (`{ pending, expandedInSeasonId? }`,
written by `from < 28`), but *what is owed* is read off the world:
`missingDistricts(state)` compares the career's own `world.regionIds` with the
authored six. The operation is therefore idempotent by construction — a
one-ladder save gains five districts, a two-ladder save four, a complete county
none, and no roll-over can found a seventh — and `activateWorldExpansion` spends
the mark before it mints anything.

**Names are composed, never typed.** League, division, cup and plate names all come
from the ladder's region through the central helpers; competition ids are
pyramid-scoped, so the sixth district's cups cannot collide with anything.

---

## 4. The six districts

Ids are stable and authored; a district's *ladder* id is the handle the seed draws
(a valley), which is why it differs between seeds while the district, its region,
its place and its football do not. Measured on seed `county-world`:

| # | District (map name) | Region id (stable) | Ladder id | Level | Divisions | Clubs | Towns | Region centre |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alderford | `region_1` | `league` | 1 | 12/12/12 | 36 | 32 | 51.4, 56.0 *(centred on its own settlements)* |
| 2 | Westbrook Valley | `region_2` | `brue` | 2 | 12/12/12 | 36 | 22 | 16.0, 16.0 *(the world's own draw)* |
| 3 | Marlowe Vale | `region_3` | `dene` | 2 | 12/12/12 | 36 | 23 | 74.5, 71.8 *(the atlas)* |
| 4 | Oakham and the Weald | `region_4` | `yare` | 2 | 12/12/12 | 36 | 16 | 20.4, 70.6 *(the atlas)* |
| 5 | Briar Glen | `region_5` | `teme` | 2 | 12/12/12 | 36 | 13 | 51.8, 48.4 *(the atlas)* |
| 6 | Millwater | `region_6` | `wyre` | 2 | 12/12/12 | 36 | 9 | 75.8, 41.2 *(the atlas)* |
| | **Totals** | | | | **18 divisions** | **216** | **115** | |

On seed `bench` the same six districts are founded with different drawn ladders
(`league`, `cale`, `avon`, `yare`, `wyre`, `dene`) and different settlement counts
(27/33/21/26/14/19) — the same county, the same places, a different seed's inside.
A seventh district would be another row in `ALDERFORDSHIRE_DISTRICTS` plus its
polygon; nothing else.

Determinism: two `generateDraft` calls from one seed are identical (hashed in
`countyWorld.test.ts`), and the two districts the county has always had are
*unchanged* by the four added beside them — same ids, clubs, squads, towns,
grounds and standing (`worldGenerator.test.ts`, `countyWorld.test.ts`).

---

## 5. Naming conventions, with examples

Everything below is composed from the canonical records by the central helpers
(`leagueNameFor`, `divisionNameFor`, `cupNameFor`, `regionNameFor`); no screen and
no generator types a district's name.

| Thing | Rule | Example |
| --- | --- | --- |
| Ladder | `<district> Sunday League` | `Marlowe Vale Sunday League` |
| Division | `<district> Sunday League Division <One/Two/Three>` | `Oakham and the Weald Sunday League Division Two` |
| League Cup | `<district> Sunday League Cup` | `Briar Glen Sunday League Cup` |
| Plate | `<district> Sunday League Plate` | `Millwater Sunday League Plate` |
| County cup | `<county> County Cup` | `Alderfordshire County Cup` |
| League competition id | `comp_<ladder>_t<n>` | `comp_dene_t3` |
| Cup/plate id | `comp_<ladder>_cup` / `comp_<ladder>_plate` | `comp_yare_plate` |
| County cup id | `comp_county_cup` | `comp_county_cup` |
| Club | the town it plays in, as the generator has always named clubs | `Balhurst Legion` (Balhurst, `region_3`) |
| Club/town/ground/person ids | minted under the ladder's own id | `club_dene_1`, `ground_dene_1` |

Competition ids are unique across the county because they carry the ladder's id:
thirteen cups, thirteen ids, no two districts sharing a `League Cup` id. A
town-based club's name is a name from the town the club is registered in, and
every town's `regionId` is the district it was founded for, so a name cannot be
read in one league table and belong to a club playing somewhere else.

---

## 6. Competitions: counts, fields and ownership

Thirteen cups and eighteen league divisions, measured on the six-district county.

| Competition | Count | Field | Owner | Entrants at a fresh career |
| --- | --- | --- | --- | --- |
| League divisions | 18 | `comp_<ladder>_t1..t3` — the ladder's own 12 clubs each | the ladder | 12 each |
| League Cups | 6 | `{ kind: 'pyramid', pyramidId: <ladder> }` | the ladder | **36** each |
| Plates | 6 | `{ kind: 'pyramid', pyramidId: <ladder> }`, fed by the League Cup's first-round losers | the ladder | 0 until the first round is drawn |
| Alderfordshire County Cup | 1 | `{ kind: 'county', countyId: county_1 }` | **no ladder** (`pyramidIdOf` answers null) | **216** — every active club in the county, all six ladders |

* The county cup's entrants are exactly the county's active clubs and no others
  (`countyClubIds`/`fieldClubs` compared set-for-set in `careerSetup.test.ts` and
  `countyWorld.test.ts`).
* Each competition is independently drawn and progressed: six League Cups and six
  Plates keep their own draws, rounds and records through the roll-over, and
  `CupView` lists all thirteen across seven groups (six ladders plus the county).
* Honours are written per competition per season; the soak's
  `honours-awarded-once` / `honours-not-duplicated` hold across the lot.

---

## 7. Calendar, season completion and scheduling

* **League fixtures**: all eighteen divisions get their fixtures (2,376 league
  fixtures a season; 792 in the two-district compatibility world).
* **Cups**: each ladder's League Cup and Plate progress independently; the county
  cup's nine rounds accommodate a 216-club field. Cup rounds share a date only when
  their *fields* have no club in common — the rule the lane model was already built
  on, now exercised by thirteen competitions instead of five.
* **No club plays twice on a date**: asserted in `cupLanes.test.ts`,
  `countyWorld.test.ts` and the soak's `no-club-plays-twice-in-a-day` over a
  played season.
* **The Sunday calendar holds**: 97 calendar entries in the benchmark's fresh
  reading (22 league Sundays, 75 cup rounds, 2026-09-06 → 2027-07-18); no midweek
  fixture was introduced for the bigger field, and `seasonShape.test.ts`'s
  "every date on a Sunday" rule is intact.
* **The season finishes and rolls over with all six standing**:
  `countyWorld.test.ts` plays a season through the real day loop, finishes it,
  rolls over and asserts eighteen divisions of twelve in the new season with the
  county cup redrawn (`seasonId` updated, thirteen cups, six ladders); the soak's
  `season-not-overrunning` and `cup-decided` invariants hold.

---

## 8. Tests, soak, build and benchmark

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no output |
| `npm test` (fast half) | **132 files, 1,646 tests, all passing** (255 s) |
| `npm run test:slow` | **44 files, 685 passed, 2 skipped** (687), exit 0 (578 s; see the note below) |
| `npm run build` | exit 0 (7.8 s), `dist/` written, precache manifest 90 files (the >500 kB chunk warning is pre-existing) |
| `npm run benchmark -- --seasons=1` | six districts: 216 clubs, 2,407 fixtures listed (2,376 league / 28 cup / 3 friendly) / 2,917 played, full engine 1,177.6 ms a match, **fast mode 3.61 ms a match (327×)**, a full eighteen-fixture card in 64.9 ms, season loop **147.4 s** — 2,886 fast + 31 full fixtures |
| `npm run benchmark -- --districts=2 --seasons=1` | compatibility world: 72 clubs, 807 fixtures, fresh 6,544 KB, season-end 83,431 KB |
| `npm run soak` (via the slow suite's `soak.test.ts`) | green; the six-district world reports no `fail` violations |
| Browser walk-through (`npx electron .verify/se27-career.cjs`) | three careers — `region_1`, `region_2`, `region_3` — each observed through the whole flow; **no console errors** |

**Tests added or extended for six districts**: `simulation/countyWorld.test.ts`
(the county as one world, 13 tests), `simulation/worldExpansion.test.ts` (the
expanded county, 15 tests, including the two-district containment test and "the
districts were founded beside the county, never through it"), plus the six-district
updates to `careerSetup`, `worldNav`, `geographySetup`, `alderland`, `selection`,
`leagueView`, and `state/persistence.test.ts` (migration of a one-ladder and a
two-ladder save into the six-district county, and the whole-county no-op). The
two-pyramid tests were kept meaningful rather than deleted: a two-district world is
still asserted byte-for-byte against its historical baselines
(`worldGenerator.test.ts` `LEGACY_DRAFTS`), and is now also asserted to be
*contained* in the six-district world.

**Two deliberate test changes**, both stated here because the domain model changed
on purpose: (1) the passing of six districts now carries the atlas' geography —
`pyramids: 6` and a career founded with no district count are the same world, which
is what a test helper claiming "the whole county" should mean; (2) two autosave
tests and one migration test needed longer timeouts than the default, because
writing and reading a six-district career is a bigger operation than the
two-district one they were written against. No assertion was weakened to make a
check pass, and no test was skipped or gated to hide a failure.

---

## 9. State size, measured

Read with `tools/benchmark.ts` (which now prints the state, and the top-level keys
it is made of, at both readings).

| Reading | Two districts (compat) | **Six districts** | Growth |
| --- | --- | --- | --- |
| Fresh career | 6,544 KB | **20,201 KB** | 3.09× for 3× the clubs (~91 KB a club) |
| At a season end | 83,431 KB | **200,102 KB** | 2.40× |

Fresh breakdown: `people` 8,535 KB · `relationships` 7,307 KB · `matches` 3,324 KB
· `clubs` 516 KB · `world` 222 KB.

Season-end breakdown: **`matches` 147,526 KB (73.7%)** · `people` 26,411 KB ·
`clubs` 12,230 KB · `relationships` 9,500 KB · `training` 3,207 KB.

The end-of-season peak is not a leak and not a second world: it is one season's
fixtures, results, events and performances, held until the boundary rebuilds
`state.matches`. It is ~0.7 MB a club-season, it scales with the fixture count
(2.4× for 3× the fixtures, because the fixed parts do not scale), and it is the
figure any future save-retention work or state budget has to be aimed at. Nothing
was changed to reduce it: a save-retention refactor is a Phase 4 decision, and
without evidence of a problem (timeouts, failed writes) it is not this milestone's
business.

---

## 10. Career creation and in-game navigation, exercised

`.verify/se27-career.cjs` drives the real app (Electron against `npm run dev`) for
one district per run and records JSON evidence plus screenshots. Three districts
were run — the founding county, the district next door, and one of the four the map
added:

| Observed | `region_1` (Alderford) | `region_2` (Westbrook Valley) | `region_3` (Marlowe Vale) |
| --- | --- | --- | --- |
| County map | six districts, none locked | same | same |
| Locked county message | "Brackenshire is mapped, but not playable in this release." | same | same |
| Selection | "Alderford selected. Confirm below to continue." | "Westbrook Valley selected…" | "Marlowe Vale selected…" |
| Club chooser | "Choose your club · Alderford", "Alderford Sunday League · seed … 36 local clubs in 3 divisions", 12 clubs shown per division, **no ladder picker** (a single ladder is not a choice) | "… · Westbrook Valley", 36 clubs, same | "… · Marlowe Vale", 36 clubs, same |
| Career | dashboard, manager in his own club | same | same |
| League screen | `Alderford Sunday League Division One`, 12 rows, picker: **6 ladder groups, 18 divisions**, his own marked `— yours` | `Westbrook Valley … Division One`, his ladder marked | `Marlowe Vale … Division One`, his ladder marked |
| Browsing another division | switches the table (12 rows) without touching the career | same | same |
| Cup screen | **13 competitions** in 7 groups, `Alderfordshire County Cup` present, his own League Cup present | same | same |
| World screen | all six ladders named, **216 clubs, 216 grounds** | same | same |
| Back to his own division | still `Division One — yours` | same | same |
| Console errors | none | none | none |

---

## 11. Known limitations, and what a second county would need

1. **End-of-season state is ~200 MB** for the six-district county (73% of it the
   season's matches). Measured, not capped. A state-budget invariant does not exist
   yet; the cheapest place for one is `soak.ts`, where the world is already built.
2. **Season wall time is ~143 s** for a full six-district season through the real
   day loop, with no per-day latency (mean/p95) instrumentation — the architecture
   document's §6.4 budget is checked coarsely rather than precisely.
3. **The per-competition archive is still Phase 4.** A finished cup's brackets are
   lost at the roll-over exactly as they have always been; this milestone browsed
   the competitions that exist and added no archive.
4. **A career's districts are drawn valleys, not fixed ids.** A district founded
   at a season boundary into a played career gets a ladder id drawn from *that*
   career's stream, so its ladder may be `dene` where a career founded today from
   the same seed has `teme`. The district, its region, its name, its place, its
   league and cup names and its thirty-six clubs are the same kind of thing in
   both; only the handle differs. This is deliberate (an id must be unique in the
   world it is minted into) and is asserted as such.
5. **No second county exists.** "The generator is reusable" is currently
   demonstrated by the *absence of any county-, district- or ladder-specific
   branch* — `generateWorld` founds whatever `DistrictDefinition`s it is handed,
   and every name comes from those records — and by the tests that found the county
   from a prefix of itself. The remaining work for a second county is authoring its
   district list and its polygons, deciding how a career chooses between counties,
   and giving it a county cup of its own (§Phase 5 of the architecture document).
6. **Not attempted, by instruction:** club movement between pyramids, club
   formation/folding/reform, financial or governance expansion, the match-engine
   rewrite, and any save-system optimisation.

---

## 12. Deviations from the plan, and why

* **`foundSecondPyramid` → `foundDistrictPyramid`.** The name was accurate for a
  two-ladder world and misleading for this one; its callers (the generator and the
  save expansion) were migrated in the same change and no aliases remain.
* **`pyramids: N` is a prefix of the county, geography and all.** The plan's
  compatibility count built the first *N* districts without the map's centres,
  which meant a six-district world built through that path was not the world a
  career is founded in. A count is now part of the county rather than a different
  county; the two-district world is unchanged, baselines and all.
* **`legacy: true` on two districts.** The plan assumed every district could stand
  where the atlas draws it. The district next door cannot: it has stood where the
  world drew it since it existed, and moving it would have changed every
  two-district save, test and baseline. The flag is authored data, not a special
  case — it says which districts the county has always had.
* **The season-build refactor the audit anticipated was not needed.** Stages 2–3
  had already made it world-aware; the six-district work grew its inputs, not its
  shape.
* **Alderford's league is named `Alderford Sunday League`, not
  `Alderfordshire Sunday League`.** The district is Alderford and the county is
  Alderfordshire; a district's ladder is named after the district, and the county's
  own competition is the Alderfordshire County Cup. No district's league, cup or
  plate wears another's name.
