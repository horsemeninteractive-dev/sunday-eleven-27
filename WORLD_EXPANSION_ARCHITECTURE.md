# SE27 — World & Calendar Expansion: Architecture and Phased Plan

Planning document. **No simulation code was changed to produce it.** It is the
result of reading the current implementation end to end and of running the
project's own instruments against a generated world. Every claim below is either
a code path that was read (module and function named) or a measurement that was
taken (command and figure given). Where something is an inference rather than a
reading, it says so.

The brief was to find out what SE27 can honestly support today, and to design a
safe route from one 36-club county to a broader, geographically real Sunday
football world without breaking the calendar, the competitions, the saves or the
match architecture.

---

## 0. Method, and what was measured

Read in full or in the parts named: `domain/world.ts`, `domain/competition.ts`,
`domain/game.ts`, `domain/match.ts`, `simulation/generation/worldGenerator.ts`,
`generation/fixtureGenerator.ts`, `gameSetup.ts`, `calendar.ts`, `timeline.ts`,
`matchday.ts`, `seasonStructure.ts`, `season.ts`, `pyramid.ts`, `cup.ts`,
`postponement.ts`, `schedule.ts`, `day.ts`, `fastMatch/mode.ts`, `training/plan.ts`,
`clubLifecycle.ts`, `soak.ts`, `state/persistence.ts`.

Run:

| Command | What it measured |
| --- | --- |
| `npm run soak -- --seasons=2` (seed `soak`) | 2 seasons in 91.4 s; 357 days a season; 404 matches a season; 39–42 postponements |
| `npm run benchmark -- --seasons=1` (seed `bench`) | full engine 982.0 ms/match, fast mode 2.65 ms/match (370×); a 1-season day loop in 39.3 s |
| `npx vite-node tools/scratchWorldAudit.ts <seed>` (temporary tool, deleted) | world size, calendar shape, fixture counts, save size for seeds `soak`, `alpha`, `bravo` |

The scratch tool is not part of the deliverable; its shape is reproduced in §9.4
so the same readings can be taken again.

---

## 1. Verified current state

### 1.1 The world as it actually is

Measured, `seed = "soak"`, career year 2026:

| Reading | Value |
| --- | --- |
| Settlements | **21** — 4 town, 4 small-town, 9 village, 4 hamlet |
| Settlements with a club | **17**; **4 have none** (one of them a town) |
| Clubs | **36** (3 divisions × 12) |
| Grounds / businesses / people | 36 / 120 / **1,035** (of whom **873** are players) |
| League matches in a season | **396** (18 a matchday, 22 matchdays) |
| All fixtures in a season | **403** (7 friendlies) |
| League matchdays | **22** — `matchdayCount(12)`, fortnightly (`MATCHDAY_INTERVAL_DAYS = 14`) |
| Calendar entries | **33** (22 league Sundays + 11 cup rounds) |
| Calendar span | first Sunday **2026-09-06** → last date **2027-07-11**; season start **2026-07-20** |
| Cups | League Cup: 36 entrants, 6 rounds · Plate: 5 rounds (11 slots — the whole cup budget) |
| State as JSON | **3,213 KB** (≈ 90 KB a club) |

Seeds `alpha` and `bravo` agree on 36 clubs, 403 fixtures and 33 calendar
entries, with 17 and 20 settlements respectively (13 and 19 of them with a club).
**So the county already generates more plausible club sites than the ladder
uses, and every career leaves whole towns without a football club in them.**

### 1.2 Fully implemented and working

| System | Where | Verified behaviour |
| --- | --- | --- |
| Day-granular clock | `simulation/day.ts` | `processDaySteps` runs one day in a fixed order: prepare → availability → money → recovery → life → training → fixtures → cups → world → career → fundraising → ground → comms/press → standings → season boundary |
| Pyramid, 3 divisions | `domain/competition.ts` `DEFAULT_PYRAMID`, `pyramid.ts`, `seasonStructure.ts` | `state.pyramid: PyramidConfig` is stored per save; every division is a `Competition` with `tier`, `clubIds` and its own table |
| Fixture generation | `generation/fixtureGenerator.ts` | Seeded double round robin per division, its own RNG stream per division; byes for odd fields |
| One calendar for the whole world | `calendar.ts` | League Sundays fortnightly with the Christmas fortnight stepped over; cup rounds sit on the Sunday of the week before a league matchday |
| Calendar derives everything | `timeline.ts` | No stored matchday counter. `matchdaysPlayed`, `nextMatchday`, `leagueMatchdayCount`, `isMatchdayDate`, `seasonCalendarExhausted` are all read from `state.date` + `state.season.calendar` |
| Promotion / relegation | `pyramid.ts` `resolvePromotionAndRelegation`, `seasonStructure.ts` `applyMovements` | Decided at the season boundary, archived on the club, applied when the next season is built; a refused promotion walks down the table so each boundary swaps equal numbers |
| Whole-pyramid League Cup + Plate | `cup.ts`, `seasonStructure.ts` | Cup field is `divisions.flat()` — **the League Cup is already a whole-county knockout**; byes, a preliminary, a Plate fed by the main cup's losers, distinct `matchdayOffset` per cup |
| Postponement and rearrangement | `postponement.ts` | Call-off reasons from weather/pitch/referee/short side; a replacement match per rearrangement (`_r1`, `_r2`…), dated on a free Sunday then a Wednesday, bounded by `MAX_REARRANGEMENTS = 3` and `REARRANGEMENT_GRACE_DAYS = 56` past the last calendar date; no fixture can be arranged into the past |
| Double-booking prevention | `cup.ts` `fieldIsFree`/`clubBusyOn`, `postponement.ts` `clubBusyOn` | A cup round moves to the next free Sunday rather than booking a club twice; a rearranged fixture skips a date either club is already playing on |
| Season roll-over | `season.ts` `startNextSeason` | Ageing, retirement, youth intake, squad cap, AI churn, club finance review (administration → fold → reformation/successor), then a fresh calendar and fresh competitions |
| Two simulation modes | `fastMatch/mode.ts` | **One rule**: a fixture the manager's club is in runs `full`, everything else runs `fast`; while he is between jobs, the whole county runs `fast`. Nothing else infers a mode |
| Save versioning | `state/persistence.ts`, `domain/game.ts` | `GAME_STATE_VERSION = 21`, with an incremental `migrateSave` and one precedent for adding clubs to an existing career (v8) |
| Multi-season harness | `simulation/soak.ts`, `tools/soak.ts` | 11 invariant checks over 10–20 season runs, a trend table, and a determinism check |

### 1.3 Partially implemented

1. **Geography is one level deep.** A club has a permanent `townId` and a ground,
   and a town has `x`/`y`, `kind` and `population` — but there is **no region, no
   county entity and no club-level geographic identity beyond the town**. The
   county and the region are two strings on `World` (`countyName`, `regionName`),
   used for naming divisions and seeding the press.
2. **One pyramid, and everything is keyed to one global tier.** Competition ids
   come from `divisionCompetitionId(tier)` → `comp_league_t1..t3`; `divisionOf`,
   `tierOf`, `divisionAbove`/`divisionBelow`, `tierPrizeMoney`,
   `AI_CHURN_BY_TIER`, `sponsorship.tierFactor`, `standing.ts` and the soak's
   `tierAbility` all read a bare tier number. Tier is doing two jobs at once —
   *rung in this ladder* and *level of football* — and with one pyramid those
   happen to be the same thing.
3. **Cups are one per world (plus its Plate).** `LEAGUE_CUP_ID` and `PLATE_ID`
   are constants, and a cup's field is hardcoded to "every division in the
   pyramid". There is no notion of a cup whose entrants are chosen by geography.
4. **Round identity is derived from the matchday number.**
   `cupRoundOf(state, competition, match)` = `match.matchday − (leagueMatchdays +
   cup.matchdayOffset)`, and `cupRoundMatchday()` is its inverse. This only works
   if **every cup in the world has a distinct offset**, which in turn only works
   while the number of cup rounds fits the free Sundays (§4.2).
5. **The archive keeps less than the design document asks for.** A finished
   season survives as one line per club (`history.seasons`), honours, and
   `notableEvents`. There is no per-season competition archive: `state.matches`
   is rebuilt from scratch each season (`buildSeasonStructure` assigns
   `state.matches = matches`), `standingHistory` is overwritten with the final
   tables and cleared at roll-over, and a cup's bracket is read back out of
   `state.matches`, so once the season turns the bracket is gone and only the
   winner's honour remains.
6. **Folding is money-only.** `clubLifecycle.ts` handles administration, appeal,
   fold and re-formation/successor, and it is written for one division array
   passed in from `startNextSeason`. Ground loss, player shortage, mergers and
   reformations *between* seasons are not modelled.
7. **The soak does not check that a cup finishes.** `checkPyramid` has
   `cup-bracket-complete` (a round with no ties) and a check that no survivor has
   left the world, but nothing asserts that a cup that drew a round was decided.
   Grep for `decided` / `winnerClubId` in `soak.ts` returns nothing.

### 1.4 Planned in the design document, not built

Multiple pyramids, county cups with physical county eligibility, inter-county
competition, a champions competition, grounds lost and clubs relocating, mergers,
medium-detail neighbouring ecosystems, abstract other counties (§4, §26, §39,
§40, §42). None of these exist in any form.

### 1.5 The constraints that must be resolved before expansion

These are the real blockers, in dependency order.

| # | Constraint | Evidence |
| --- | --- | --- |
| **C1** | **One pyramid, one id namespace.** Division ids and every tier-keyed rule assume a single ladder | `divisionCompetitionId(tier)`, `divisionOf`, `tierOf`, `tierPrizeMoney`, `AI_CHURN_BY_TIER`, `tierFactor`, `applyMovements(divisions)` |
| **C2** | **Matchday numbers are a single global sequence.** `fixtureIdsOnMatchday` walks every fixture list; `prepareMatchday(n)` prepares every tie numbered `n`; cup rounds are numbered `leagueMatchdays + offset + round` | `pyramid.ts`, `calendar.ts cupMatchdayFor`, `day.ts prepareToday` |
| **C3** | **Round identity is the matchday number** (1.3.4), so two cups cannot share numbering | `cup.ts cupRoundOf`, `cupRoundMatchday`, `matchesForRound` |
| **C4** | **The calendar's free-Sunday budget is nearly spent.** 22 league Sundays + 11 cup rounds fill 33 of the ~45 Sundays in the season; the season ends 2027-07-11 and the next pre-season starts 2027-07-19 — **eight days of slack in the year** | measured, §1.1; `buildSeasonCalendarWithCups`'s `taken` set |
| **C5** | **A slot that cannot be placed is silently dropped.** `buildSeasonCalendarWithCups` `continue`s past a slot it cannot date; `drawCupRound` then returns `null` forever (`playDateFor` → null), the round is never drawn, `cup.complete` stays false and the competition ends with no winner — and nothing reports it | `calendar.ts`, `cup.ts`, quoted comment in `nextFreeDateFor` records this having actually happened |
| **C6** | **Clubs exist only where the generator put them, and grounds only where clubs are.** 4 of 21 settlements have no club and therefore no ground | `worldGenerator.generateWorld` calls `generateGround` inside the club loop |
| **C7** | **State size is ~90 KB a club** (3,213 KB for 36). It scales linearly with clubs, and the whole state is written on every save | measured, §1.1; `persistence.saveGame` |
| **C8** | **Nothing keeps a played fixture beyond the season**, so a bigger world's history has to be written deliberately or it is lost | `buildSeasonStructure` replaces `state.matches`; 1.3.5 |

Two things that are *not* constraints, and are worth stating because they were
the first suspicions:

* **The match architecture does not need to change at all.** `simulateFixture`
  resolves one entry of `state.matches` by date; the mode is one documented rule
  (`simulationModeFor`), keyed off the manager's club. It is already
  competition-agnostic and world-size-agnostic.
* **The day loop does not need to change either.** `applyFixturesSteps` takes
  *every* match dated today, whatever competition it belongs to, so a new
  competition is invisible to it as long as its fixtures live in `state.matches`
  with a date.

---

## 2. Recommended target world

### 2.1 The scale, and why

Proposed progression, each stage shippable on its own:

| Stage | World | Clubs | Divisions | Rationale |
| --- | --- | --- | --- | --- |
| **A** | Two pyramids, one county | **72** (2 × 3 × 12) | 6 | Exactly doubles today. Both pyramids have the same shape, so the one shared calendar, the global matchday numbering and every tier-keyed rule keep working unchanged. Foundable mostly from the settlements that already exist and have no club (measured: 4 of 21 settlements club-less on seed `soak`, 4 of 17 on `alpha`, 1 of 20 on `bravo`) |
| **B** | Four pyramids, one county | **144** (4 × 3 × 12) | 12 | The county the design document describes as detailed (§4: "roughly 150–300 plausible clubs"). Requires the pyramid-scoped tier work of §3.4, the county cup of §3.5, the cross-pyramid movement of §3.3 and the calendar lanes of §4.2 |
| **C** | The player's county plus an abstract wider world | county + neighbours | — | Other counties are **not** modelled as clubs with squads. A champion, a few notable names and a result a season is all the design document's §39 asks for |

Twelve clubs a division is the anchor, not a preference: it is what makes
`matchdayCount(12) = 22`, and 22 is what makes the league fortnightly and the
calendar fit. **A pyramid may have two, three or four divisions without moving
that number** — so local pyramids can differ in *shape* (a big town's four-tier
ladder beside a valley's two-tier one) while every club in the world still plays
the same twenty-two Sundays of league football, which is the property that keeps
one calendar honest. Differing *clubs per division* is deliberately deferred: see
§4.4.

**Stage A is the recommended first expansion.** It is the smallest world that
demonstrably has two geographically distinct pyramids, it doubles the data
without changing a single id or tier rule, and it exercises every mechanism the
later stages depend on (region assignment, a county-wide cup, cross-pyramid
county eligibility, movement between pyramids at a season boundary).

### 2.2 Full detail versus the wider world

The design document asks for the player's pyramid in full detail and the rest of
the world more cheaply (§39). The measurement says the cheapness is already
available and does not need a second class of club:

* fast mode is **2.65 ms a match** against **982.0 ms** for the watched engine — a
  370× difference, and the *same* `Match` record, statistics and consequences;
* a season of 423 background fixtures costs **~1.1 s** of match resolution,
  while the 30 fixtures that involve the manager cost **~29.5 s**;
* so doubling the world's *clubs* adds roughly a second of match work a season,
  and the dominant new cost is elsewhere (the day loop, and state size — §6).

**Recommendation: every club in the player's county keeps a real squad.** The
abstraction belongs to *other counties* (Stage C), where nothing needs a squad
because nobody there will ever be watched, signed or played against. Introducing
squad-less clubs inside the county would create a second kind of club that every
existing system (selection, recruitment, finances, relationships, the press, the
soak) would have to branch on, to save two milliseconds a match. That is the
wrong trade.

---

## 3. Proposed data model

The guiding principle is that **the only genuinely new concepts are a region and a
pyramid**; everything else already exists and must not be replaced.

### 3.1 Geographic identity (new, and small)

```ts
// domain/world.ts
export interface Region {
  id: RegionId;                    // 'region_1'
  name: string;                    // 'Wyre Valley'
  centre: { x: number; y: number }; // normalised 0..100, same space as Town.x/y
}

export interface Town {
  /* …as today… */
  regionId: RegionId;              // NEW — the town's home region
}

export interface World {
  /* …as today, minus nothing… */
  regionName: string;              // kept: the founding region's league name
  countyName: string;              // kept: the county's name
  regions: Record<RegionId, Region>;
  regionIds: RegionId[];
}
```

* `Town.regionId` is written once at generation and **never rewritten**. A club's
  region is therefore `clubs[c].townId → towns[t].regionId` — a club cannot lose
  its geography by changing league, because no code writes a town's region except
  the generator.
* Regions are generated **before** towns and are assigned by nearest centre with a
  seeded tie-break, so the same seed always produces the same partition. Region
  names come from the river list the generator already carries (`['Wyre','Cale',
  'Stour','Dene','Teme','Brue','Avon','Yare']` in `worldGenerator.generateWorld`) —
  eight candidates, so four distinct regions are available without a new word list.
* `world.regionName` and `world.countyName` stay as they are, so nothing that
  reads them (division naming, the press seed, `WorldView`) has to change.

**No `County` entity in Stage A or B.** With one county, county eligibility is
"every club in the world", and inventing a container to hold one thing would be
the kind of abstraction the brief warns against. The county becomes an entity only
in Stage C, when there is a second one — at which point `Town.countyId` is added
and defaults every existing town to the founding county.

### 3.2 Pyramids (new, and the heart of the change)

```ts
// domain/competition.ts
export interface Pyramid {
  /** Also the id prefix of every competition it owns: 'league' → comp_league_t1. */
  id: PyramidId;
  name: string;                    // 'Wyre Valley Sunday League'
  regionId: RegionId;              // where it draws its clubs from
  config: PyramidConfig;           // tiers, clubsPerTier, places, cups — as today
  competitionIds: CompetitionId[]; // its divisions, tier order
  cupIds: CompetitionId[];         // its own cups
}
```

```ts
// domain/game.ts — replaces `pyramid: PyramidConfig`
pyramids: Record<PyramidId, Pyramid>;
pyramidIds: PyramidId[];           // tier order of the world, founding first
```

**The founding pyramid's id is `league`.** That single choice means
`divisionCompetitionId(pyramidId, tier)` returns

* `comp_league_t1 … comp_league_t3` for the pyramid that exists today — byte-identical
  to the current ids, and `comp_league_cup` / `comp_plate` likewise — and
* `comp_vale_t1 …` , `comp_vale_cup` for the second pyramid,

so **no competition id in any existing save changes, and no match has to be
re-homed.** `divisionCompetitionId` becomes:

```ts
export function divisionCompetitionId(pyramidId: PyramidId, tier: number): CompetitionId {
  return `comp_${pyramidId}_t${tier}`;
}
```

with `pyramidId: 'league'` for the founding pyramid and `PLATE_ID` generalised to
`cupCompetitionId(pyramidId, 'plate')`.

Every existing reader becomes pyramid-scoped but keeps its meaning:

| Today | After |
| --- | --- |
| `pyramidOf(state)` → `state.pyramid` | `pyramidOf(state, pyramidId = state.userPyramidId)` |
| `leagueCompetitions(state)` | `leagueCompetitions(state)` (all) + `divisionsOf(state, pyramidId)` |
| `divisionOf(state, clubId)` | unchanged signature — a club is in one division in one pyramid |
| `tierOf(state, clubId)` | unchanged (rung within its own pyramid) |
| `divisionAbove/Below(state, competition)` | must become same-pyramid lookups (they currently find "the competition with tier ± 1" across the whole world, which with two pyramids would return the *other* pyramid's division) |

That last row is the one concrete bug the change introduces if it is done
carelessly, and it is the reason this is a phase of its own.

### 3.3 Membership, and why it can move without damaging history

Membership is already `competition.clubIds` and nothing else. A club's history is
`club.history.seasons[]` with `competitionName` and `tier` **stamped at the time**
(`openSeasonRecords`, and `finishSeason` writing `record.tier`), and
`promotionHistory` keeps every movement for the whole career. So moving a club
from one pyramid's bottom division to another pyramid's is:

1. decide it at `finishSeason` as a `MovementRecord` (already the shape used),
2. apply it in `applyMovements` when the next season is built (already the only
   place `clubIds` is written),

and nothing else changes: last season's table is still the archive's, the cup
brackets that have been played are untouched, and the club's own page reads its
own stamped records. **The rule to hold to: membership is only ever written at the
season boundary, by `applyMovements`.**

### 3.4 `levelOf` — separating "rung" from "level of football"

Tier currently means two things. With two pyramids of different standing, the
second pyramid's tier 1 must not be paid, recruited for or judged as the first
pyramid's tier 1. The smallest fix that keeps every reader honest:

```ts
// pyramid.ts — new: `pyramidIdOf(competition)` and `levelOf(clubId)`
/** The rung of a club in the world's ladder: the pyramid's level plus its tier. */
export function levelOf(state: GameState, clubId: ClubId): number | null {
  const division = divisionOf(state, clubId);
  if (!division) return null;
  return (pyramidOf(state, pyramidIdOf(division))?.level ?? 1) + division.tier - 1;
}
```

with `level: number` (1 = the county's strongest) on each `Pyramid`. Readers that
mean *level* switch to `levelOf`; readers that mean *rung within the ladder* keep
`tier`. The readers to switch, verified by reading them: `tierPrizeMoney`
(`season.ts`), `AI_CHURN_BY_TIER` indexing (`season.ts clubChurn`), `tierFactor`
(`sponsorship.ts`), the standing layer (`standing.ts`), and the soak's tier
readings (which should keep reading *tier*, since they are watching each ladder).

A second pyramid's `level` can be derived at generation rather than chosen: the
mean reputation of the clubs its region can support, compared with the founding
pyramid's. That is one number, it is deterministic, and it is what makes the
county feel like it has a big league and a small one.

### 3.5 Cups that span pyramids

The one thing a cup needs to learn is where its field comes from:

```ts
export type CupField =
  | { kind: 'pyramid'; pyramidId: PyramidId }     // the League Cup, as today
  | { kind: 'county' }                            // every club in the county (Stage B)
  | { kind: 'invitation'; clubIds: ClubId[] };    // champions, inter-county (Stage C)
```

stored as `Competition.cup.field?: CupField` — absent reads as
`{ kind: 'pyramid', pyramidId: 'league' }`, so every existing save keeps its
meaning. `mainCupPlan`, `platePlan`, `drawCupRound`, `readCupRound` and the
round-advance in `day.ts advanceCups` are **all already generic over a list of
club ids**: `BuildSeasonOptions.divisions` and `drawCupRound`'s `field` variable
are the only places the field is chosen. So a county cup is a competition whose
entry list is `Object.values(state.clubs).filter(c => c.active)` instead of
`divisions.flat()`.

Cup eligibility by geography then follows from §3.1 for free — a county cup
includes every active club in the county *whatever pyramid it plays in*, and a
club playing in a neighbouring pyramid is still eligible for its own county's cup
because eligibility is read from the town, never from the division.

### 3.6 Round identity, decoupled from the matchday number

Add one optional field, in the style of `Match.originalDate` / `Match.knockout`:

```ts
/** The round of its cup this tie belongs to, set when it is drawn. */
cupRound?: number;
```

`drawCupRound` already knows the round it is drawing, so it writes it;
`cupRoundOf` reads it and falls back to today's arithmetic for a legacy save
(which is exact, because a legacy save has exactly one cup numbering). This is
the change that lets two cups share a Sunday — see §4.2 — and it removes a whole
class of silent failure: a tie's round stops depending on a global counter.

---

## 4. Calendar architecture

### 4.1 The source of truth, stated once

| Fact | Held by | Written by |
| --- | --- | --- |
| **Which dates the season has, and which matchday number each date is** | `state.season.calendar` (`{matchday, date}[]`) | `buildSeasonStructure` → `buildSeasonCalendarWithCups`, at season build |
| **Which competition a fixture belongs to, and its matchday number** | `state.fixtures[competitionId]` | `registerFixture` |
| **When a fixture is actually played** | `match.date` | `createMatchRecord`; only `postponeFixture` moves a *new* record, never the old one |
| **Who is in what competition** | `competition.clubIds` | `applyMovements`, only at a season boundary |
| **Where we are in the season** | *nothing* — derived from `state.date` and the calendar | `timeline.ts` |

The day loop's authority is the date: `applyFixturesSteps` selects
`state.matches` with `date === today && status === 'scheduled'`, and the season
ends when the calendar is exhausted **and** `everyFixtureSettled(state)` — which
counts a postponed fixture as settled only when it has a replacement. Every one
of the design document's consistency fears (UI, tables, news, saved state
disagreeing) is answered by this one table: they all read the same three records.

### 4.2 The calendar's real budget (the finding that shapes everything)

Measured: 22 league Sundays + 11 cup rounds = **33 of the ~45 Sundays** between
the first Sunday of September and the last date in July. The season ends
2027-07-11; the next pre-season starts 2027-07-19. **There are eight days of slack
in the year, and about ten free Sundays inside it** (the ones a fortnightly league
leaves free that no cup round is using, less the Christmas fortnight).

Consequences, and they are not optional:

1. **A second cup set cannot have its own eleven slots.** `cupRoundSlots` and
   `buildSeasonCalendarWithCups` date one round per free Sunday
   (`taken` is a set, so one slot a Sunday). Two pyramids × (6 + 5) rounds needs
   22 Sundays and there are ~10.
2. Therefore **cups in different pyramids must share Sundays.** That is legal for
   clubs — `fieldIsFree` and `clubBusyOn` already refuse to book a club twice —
   but it is not legal for the *numbering*, because round identity is
   `matchday − (leagueMatchdays + offset)` (C3). Hence §3.6's `match.cupRound`
   must land **before** any second cup is added.
3. **A slot the calendar cannot place is currently dropped in silence** (C5). With
   one cup that never happened; with two it will. `buildSeasonStructure` must
   compare the slots it asked for with the entries it got and fail loudly —
   at minimum a news item and a soak `fail`, better a thrown error in dev builds.
4. **Different competitions must therefore own different *lanes*, and the county cup
   is in a lane of its own.** Two pyramids' league cups can share a Sunday because
   their fields are disjoint — no club is in both — but a cup whose field is the
   *whole county* overlaps every pyramid's, so it cannot share a Sunday with a
   pyramid cup round: the same club would be drawn in both, and `fieldIsFree`
   would then push one round off its slot. The three ways to give it its own
   dates, in order of preference: (a) the county cup's early rounds take the
   Sundays the pyramid cups are not using and its later rounds take Wednesday
   evenings; (b) the county cup's rounds are spread across the season on a
   different rhythm from the pyramid cups; (c) the county cup is played in
   midweeks throughout. All three are scheduling decisions, not new laws — but
   the calendar has to be *told* which lane a slot belongs to, which is the one
   new idea `buildSeasonCalendarWithCups` needs.
5. **The season cannot grow to fit new competitions.** The opener is pinned to the
   first Sunday of the next September (`season.ts startNextSeason`:
   `firstSundayOfSeptember(yearOf(previousSeason.startDate) + 1)`), so a longer
   season does not push the next one later — it eats the eight days of slack and
   then starts hitting the rearrangement deadline. Every added competition must
   fit *inside* the fixed window.
6. **Wednesday is the pressure valve, and it is nearly untouched.** `NO_GAME_WEEKDAYS`
   excludes only Thursday (training) and Saturday (other football), and
   `canPlayOnWeekday(3)` is true; `postponeFixture` already falls back to a
   Wednesday and `kickOffForReplay` already gives it a 6:45pm kick-off. The last
   four rounds of a large county cup on Wednesday evenings is the realistic answer,
   and it needs no new law — only a way for the calendar to place a round on a
   weekday on purpose rather than as a rearrangement.

### 4.3 Why the calendar cannot drift, and the invariant that must survive

`startNextSeason` does **not** advance the clock by a year. It recomputes the
opener from the calendar year:

```
nextYear     = yearOf(previousSeason.startDate) + 1
firstSunday  = firstSundayOfSeptember(nextYear)
while (weekStartOf(preSeasonStart(firstSunday)) <= previousClosedOn) firstSunday += 7
```

where `previousClosedOn` is the later of today's date and the previous season's
own end. So a season that overran its calendar pushes the *next* opener on a week
at a time — and the season after that is pinned to September again regardless.
**Drift is bounded within one season and self-correcting across seasons**; the
clock can move later but can never move backwards, and there is no accumulation.
The soak checks both ends (`clock-never-rewinds`, and a `warn` for a season that
overruns its calendar by more than the rearrangement grace).

That is a property worth protecting explicitly, because it is not obvious from the
code and it is exactly what a second calendar would break. **Any expansion must
keep: one calendar, one matchday namespace, one opener per year, and the
`while` loop that pushes it rather than stretches it.**

### 4.4 The one thing that should *not* be attempted yet

**Per-pyramid `clubsPerTier`.** Letting one pyramid run 10 clubs a division and
another 14 would give them 18 and 26 league matchdays — two calendars, two
matchday namespaces, and every one of these breaks: `fixtureIdsOnMatchday`
(a matchday number would no longer mean one date), `prepareToday` (one matchday
per date), `nextMatchday`/`leagueMatchdayCount` (the "matchday X of N" the whole
UI reads), `cupRoundSlots` (numbered above *the* league matchdays), and
`sessionKeyFor` (a training week is keyed by a league matchday number). It is
possible, and it is the natural next dimension after Stage B — but it is a
calendar rewrite, not a data-model change, and the design document's own
requirement ("scaled sensibly to local population and club density") is already
satisfied by varying **the number of divisions** per pyramid.

### 4.5 Worked examples

**A normal season (founding pyramid, today's numbers).** 2026-07-20 Monday,
pre-season begins. Six pre-season Sundays of friendlies. First league Sunday
2026-09-06; league matchdays are fortnightly to 2027-06-27, stepped over the
Christmas fortnight to 2027-07-11. Eleven cup rounds fall on the Sundays of the
weeks before league matchdays 2, 4, 6 … numbering 23–33. The season closes the day
after 2027-07-11 with every fixture settled.

**A cup run.** League Cup round 1 (matchday 23, 2026-09-13) → round 2 (25,
2026-10-11) → … The draw for a round happens when the previous round is read back
complete (`day.ts advanceCups` → `readCupRound` → `drawCupRound`), so a round is
only drawn once its predecessor has been settled, and `playDateFor` moves a round
to the next free Sunday if its own slot has gone. A tie that goes to extra time
and penalties is a normal `full`-engine match with `match.knockout = true`.

**A postponed match, end to end.** Sunday: `prepareToday` rolls the weather and
the pitch from the fixture's own id → `decidePostponement` says waterlogged →
`postponeFixture` marks the original `status: 'postponed'` with its reason and
date, finds the next free Sunday **after** today at least three days out, skipping
the Christmas fortnight and any date either club is already booked for, creates a
replacement dated there with `originalDate` set and registers it in the same
competition, and the original points at it (`replacedByMatchId`). The league
table does not move. The season cannot close until the *replacement* is settled
(`everyFixtureSettled`). If the replacement is called off too, the chain continues
(`_r2`, `_r3`); at the fourth attempt, or if no date precedes
`rearrangementDeadlineFor` (last calendar date + 56 days), the fixture is
abandoned and stays on the record as a game that was never played. Measured
frequency today: **39–42 postponements a season out of 404 fixtures** (≈ 10%),
with zero abandoned over two seasons.

---

## 5. Competition lifecycle

The lifecycle already exists; the expansion adds pyramids to it, not stages to it.

| Moment | Today | With several pyramids |
| --- | --- | --- |
| **Season close** | `finishSeason` archives every division's table onto each club's season record, awards honours and prize money, resolves promotion/relegation into `MovementRecord`s, applies the standing layer, sets `phase = 'complete'` | unchanged, looped over every pyramid's divisions. `resolvePromotionAndRelegation` is already given `competitionIds` and solves each boundary on its own, so it works per pyramid |
| **Roll-over** | `startNextSeason`: ageing/retirement/intake/churn per club → `reviewClubFinances(divisions)` → new season id, label, dates → `buildSeasonStructure` → `arrangePreSeason` | the same, with `divisions` becoming per pyramid, and the finance review (fold, re-formation, successor) filtering a club's replacement into **its own** pyramid |
| **Season build** | `buildSeasonStructure({divisions, regionName, firstLeagueDate})` writes `state.competitions`, `state.fixtures`, `state.matches`, `state.matchOrder`, and the calendar | takes `pyramids: Array<{pyramid, divisions}>`, builds every division's fixtures, then every pyramid's cups, then the world's cups (county), all against **one** calendar |
| **Mid-season** | `advanceCups` each day reads back every cup's round and draws the next | unchanged, and now also draws a county cup whose field is the whole county |
| **Movement** | `applyMovements(divisions, {promotionPlaces, relegationPlaces})` rebuilds `clubIds` from movements | unchanged per pyramid; a separate, deliberate step moves a club *between* pyramids (see §3.3) |

The archive is the part that needs new work, not the machinery (gap 1.3.5):

* **Per-season competition archive.** At `finishSeason`, write one
  `SeasonArchiveEntry` per competition — champion/winner, runner-up, a club count
  and (for cups) the final's score — alongside the existing honours. This is the
  cheap half of the design document's §27 and it is what makes a 40-season career
  read like a local football Wikipedia.
* **Do not keep fixtures forever.** `state.matches` being rebuilt each season is a
  *feature*: it is what keeps a career's state from growing without bound. With
  four pyramids there are ~1,700 matches a season — four times today's — and
  keeping every one of them, with its events and player performances, would add
  megabytes to the state every year. Archive the *results that matter* (finals,
  title deciders, giant-killings, records) and let the rest go.

---

## 6. Simulation and performance boundaries

### 6.1 The boundaries, as measured

| Path | Cost | When it runs |
| --- | --- | --- |
| Watched / manager's own fixture (`full`) | **982.0 ms a match** | Only fixtures the manager's club is in (`simulationModeFor`) |
| Background fixture (`fast`) | **2.65 ms a match** | Every other fixture in the county |
| A full 18-fixture matchday card, background | **47.7 ms** | Every other Sunday |
| The whole day loop, one season | **39.3 s** (420 days) for 36 clubs | 30 full + 423 fast fixtures |

Derived (arithmetic on the benchmark's own figures, not separately instrumented):
of that 39.3 s, about **30.6 s is match resolution** — 29.5 s of it the manager's
own 30 fixtures — leaving roughly **8.7 s for 420 days of world upkeep**, about
**21 ms a day** at 36 clubs. If all 453 fixtures ran the full engine the season
would take **445 s**, which is the number that shows why the fast path is load
bearing rather than an optimisation.

### 6.2 What expansion costs

Working from those figures and the linear scaling of everything in the day loop
(clubs × players × days):

| World | Matches a season | Match resolution | Day loop (est.) | Season (est.) | State |
| --- | --- | --- | --- | --- | --- |
| 36 clubs (today) | 404 | ~30.6 s | ~8.7 s | **39.3 s measured** | 3.2 MB |
| **72 clubs (Stage A)** | ~810 | ~31.7 s | ~17.4 s | **~49 s** | **~6.4 MB** |
| 144 clubs (Stage B) | ~1,700 | ~33.9 s | ~34.8 s | **~69 s** | **~12.8 MB** |

**As built, and measured** (`tools/benchmark.ts`, seed `bench`, this machine; the
six-district county is 216 clubs, three times the Stage A figure and half again
the Stage B one):

| World | Fixtures a season | Season through the day loop | Fast-match season | State, fresh | State, at a season end |
| --- | --- | --- | --- | --- | --- |
| 6 districts, 216 clubs (built) | 2,407 listed, 2,917 played | **142.8 s** | 2.79 ms a match, 398× the engine | **19.7 MB** | **195.4 MB** |
| 2 districts, 72 clubs (compat) | 807 listed, 974 played | — | — | 6.5 MB | 83.4 MB |

The season time scaled as this section predicted it would (~0.5 s a club-season,
against ~0.7 s estimated) and the fresh state scaled at ~91 KB a club, exactly the
figure above. What the estimates did *not* anticipate is the **end-of-season**
state, which is 2.4× the two-district world rather than 3× because it is not a
function of the club count alone: 73% of it is `state.matches` — a whole season's
fixtures, results and events, held until the boundary rebuilds them. That is the
real cost of a bigger county and it is named as such in
`PHASE3_COMPLETION_REPORT.md` §9 rather than estimated away.

The estimates are labelled as estimates on purpose. The conclusion does not
depend on their precision: **the world doubles for about a second more of
football a season, and four times the world costs about thirty seconds more a
season — while the manager's own thirty matches cost half a minute of every
season whatever the world's size is.** The binding constraint is not the match
engine at all; it is (a) the per-club day loop and (b) **state size, ~90 KB a
club, written in full on every save**, which at 144 clubs is a ~13 MB IndexedDB
write per autosave.

### 6.3 What the boundaries must keep

* **One fixture, one resolution.** `simulationModeFor` stays the only place a mode
  is decided. A new competition declares nothing about how it is played.
* **No fixture may be reachable by two paths.** `applyFixturesSteps` already picks
  up every match dated today by status, so new competitions need no new
  processing; the danger is a *second* loop that also plays matches (a background
  "world tick" for other pyramids would be exactly that mistake). Every pyramid
  goes through `applyFixturesSteps`.
* **The manager's own match stays `full`, whatever pyramid it is in.** Whether his
  fixture is a League Cup tie or a county cup tie is irrelevant to the rule.
* **Cup rounds provide the pressure valve for a bigger world**: `advanceCups` runs
  once a day over every cup, so adding cups adds work proportional to their ties,
  not to their field — 11 extra ties a round is 29 ms of background football.

### 6.4 Performance test plan

1. **`npm run benchmark -- --seasons=1`** before and after each phase; the
   season-loop split (`fast matches`, `full matches`, wall time) is the regression
   signal. Target: **no change to full-match or fast-match per-match cost**
   (982 ms / 2.65 ms within ±10%), and a season loop within the phase's budget.
2. **`npm run soak -- --seasons=5` on three seeds** (Stage A: target ≤ 60 s a
   season; Stage B: ≤ 90 s a season on this machine). The trend table already
   prints `days`, `post`, `abandoned`, `cup`, `tier` and `up/down` columns per
   season.
3. **State size**: assert the serialised state is under **7 MB at Stage A** and
   **14 MB at Stage B**, measured the way §1.1 was. This is a *test*, not a
   report — a career that quietly doubles its save size is a career that stops
   autosaving on a phone.
4. **Per-day latency** (the number the Continue button feels): instrument the
   soak to record the mean and p95 of `processDay`, target **≤ 250 ms mean** at
   Stage A. Today's equivalent is ~21 ms of world upkeep plus ~1 s on each of the
   manager's matchdays.

---

## 7. Save migration and determinism

### 7.1 What the expansion would change in the save

| Change | Kind |
| --- | --- |
| `game.pyramid: PyramidConfig` → `game.pyramids: Record<PyramidId, Pyramid>` | schema |
| `world.regions`, `world.regionIds`, `town.regionId` | additive |
| `competition.cup.field?` | additive, optional |
| `match.cupRound?` | additive, optional |
| New clubs, grounds, people in the second pyramid | **generated**, deterministically |

### 7.2 The migration, following the v8 precedent

`persistence.migrateSave` already has exactly the right shape for this: an
incremental `if (from < N)` chain, and `migrateToPyramid` as the worked example of
adding clubs to a live career. The plan, in the same voice:

1. **`from < 22` — pyramids.** Replace `state.pyramid` with a single-entry
   `state.pyramids = { league: { id: 'league', name: \`${regionName} Sunday League\`,
   config: state.pyramid, regionId: region_1, competitionIds: [comp_league_t1..tN],
   cupIds: [comp_league_cup, comp_plate], level: 1 } }`, and give every existing
   club/division its obvious membership. **No ids change, no matches are re-homed**
   — which is the whole reason for the `league` prefix convention.
2. **`from < 22` — regions.** Generate one `Region` covering the map
   (`region_1`, named from `world.regionName`) and assign **every existing town**
   to it. A career's towns do not move; a second region is only ever created by
   the *expansion* migration below.
3. **`from < 23` — the second pyramid (the expansion proper).** Generate it with
   the same technique as `generateLowerTierClubs`: a stream of its own
   (`stream(state.seed, 'pyramid-expansion', state.season.id)`), ids of its own
   (`club_vale_1`, `ground_vale_1`), minted **into settlements that have no club**
   and, where the county has run out, into new settlements generated from the
   same `generateTowns` machinery. Reputation, squad, staff, ground and tactics
   read from exactly the functions the v8 migration already calls
   (`buildClubName`, `buildFinances`, `emptyHistory`, `generateChairman`,
   `clubQualityFromReputation`, `generateManager`).
4. **Do not touch a season in flight.** The v8 migration re-cut the *current*
   season; a second pyramid cannot be spliced into a season whose fixtures are
   already half played without inventing results. **Add the pyramid at the season
   boundary**: the migration stamps a   pending operation on the save (a `state.pendingWorldExpansion` marker) and
   `startNextSeason` founds it as part of the roll-over, so the new pyramid starts
   with a calendar of its own from day one. This is the single most important
   safety decision in the plan and it should be documented in the version note in
   the manner of v21.

**As built.** The chain landed as `from < 23` (regions and pyramids — one
migration, not the two this plan lists, because a pyramid without a region has no
region id to stand in), `from < 26` (the county is named rather than drawn),
`from < 27` (`counties` as records, with `countyIds`), and `from < 28`
(`markWorldExpansion`: *is this career owed districts it does not have?*). None of
it generates anything on load: the districts are founded by
`activateWorldExpansion`, which `startNextSeason` calls as its first act, so a
season in flight is never touched. Two things changed from the plan and are worth
naming: the expansion founds **every** district the career is missing rather than
one, and it is `missingDistricts` — read off the world's own regions — rather than
the marker that decides which, so running it twice is a no-op by construction. The
as-built record is `PHASE3_COMPLETION_REPORT.md` §7.

### 7.3 Determinism

* Everything new is drawn from **new streams**: `stream(seed, 'region', …)`,
  `stream(seed, 'pyramid', pyramidId, seasonId)`, `stream(seed, 'squad', clubId)`.
  The existing fixture stream is already per-competition
  (`${seed}::fixtures::${seasonId}::${competitionId}`), so a new division cannot
  perturb an old one's fixtures — and mutatis mutandis for the cup draw
  (`stream(seed, 'cup-draw', seasonId, competitionId, round)`).
* **The determinism test is the acceptance criterion for every phase**:
  `soak.test.ts`'s "the same seed is the same career" (two runs compared snapshot
  by snapshot, wall-clock seconds excluded). A refactor that changes a founding
  pyramid's world by a single attribute has broken something and must not ship.
* Ids: `nextId(state, prefix)` counters live in the save; match ids are
  `match_${seasonId}_${n}`; generated people are `${clubId}_y${seasonId}_${i}` /
  `_n${n}`. New pyramids must mint their own prefixes (`club_vale_…`) rather than
  continue `club_py…`, so a migration can never collide with a generated id.

### 7.4 What must be introduced *before* the expansion can ship

1. `match.cupRound` (or the second cup cannot be numbered correctly) — §3.6.
2. Pyramid-scoped competition ids and pyramid-aware `divisionAbove`/`divisionBelow`.
3. An archive entry per competition per season, or a second pyramid's history is
   lost the moment the season turns.
4. A hard failure when a cup round cannot be dated (C5), because the second cup is
   the thing that will actually hit that path.

---

## 8. Dependency-ordered roadmap

Each phase is independently shippable and independently revertible. "Files" are
named from the current tree, not invented.

### Phase 0 — Make the calendar's promises testable *(no player-visible change)*

**Outcome.** The failure modes that expansion depends on are caught by a test
rather than by a report: a cup round that cannot be dated, and a cup that is never
decided.

**Reuses.** `soak.ts`'s violation framework, `tools/soak.ts`, `cup.ts`,
`calendar.ts`.

**Work.**
* `soak.ts`: new invariants `cup-decided` (every cup that drew a round 1 has a
  winner by the close), `cup-round-has-date` (no competition holds a tie whose
  date is not on the calendar or later than the rearrangement deadline), and
  `every-fixture-in-a-competition`.
* `seasonStructure.ts`: `buildSeasonStructure` compares `cupSlots.length` against
  the cup entries the calendar produced and reports a mismatch (news item +
  soak failure; a thrown error behind a dev flag).
* `tools/soak.ts`/`SOAK.md`: print the new invariants.

**Schema/migration.** None.

**Acceptance.** A hand-built state with a cup round deliberately dropped fails the
soak with the new invariant named; `npm run soak -- --seasons=2` on the current
world reports **zero failures for the new invariants**; `npm test` unchanged.

**Risks/rollback.** A new invariant that is too strict will fire on the current
world — that is the point, and it must be investigated rather than relaxed. Revert
is deleting the checks.

### Phase 1 — Decouple round identity from the matchday number

**Outcome.** Two cups can be numbered independently of each other.

**Work.** `domain/match.ts`: `cupRound?: number`. `cup.ts`: `drawCupRound` writes
it; `cupRoundOf` reads it with today's arithmetic as the fallback;
`cupRoundMatchday` unchanged (it is a *scheduling* function). `day.ts
advanceCups`, `CupView.tsx`, `FixturesView.tsx` read the new field.
`persistence.migrateSave`: back-fill `cupRound` from the old arithmetic for the
current season's ties.

**Acceptance.** Existing save loads and every cup tie's round is what it was;
`cupStructure.test.ts` extended with a state holding two cups whose rounds share a
matchday number, asserting both report their own round; `npm run test:soak` clean.

**Risks.** A tie whose round cannot be back-filled (a cup with no plan in a very
old save) — falls back to the arithmetic, which is exact for one cup.

### Phase 2 — Regions and pyramids, with one pyramid *(pure refactor)*

**Outcome.** The data model of §3.1–3.2 exists, the founding pyramid keeps every
id it has, and the world is otherwise unchanged.

**Work.** `domain/world.ts` (`Region`, `Town.regionId`), `domain/game.ts`
(`pyramids`, `pyramidIds`), `domain/competition.ts` (`Pyramid`, `CupField`),
`pyramid.ts` (`divisionCompetitionId(pyramidId, tier)`, `levelOf`,
pyramid-scoped `divisionAbove`/`divisionBelow`), `seasonStructure.ts`
(`BuildSeasonOptions` takes pyramids), `season.ts` (loops pyramids),
`persistence.ts` (migration `from < 22`), `gameSetup.ts`.

**Acceptance.**
* **`npm run soak` produces the same trend table as before the change**, and the
  determinism test passes — the strongest available proof that a refactor did not
  move the world.
* A save written before the change loads, plays a season and rolls over.
* `world.regions` has one entry and every town points at it.
* `divisionAbove(tier1) === undefined` and `divisionAbove(comp_league_t2) ===
  comp_league_t1` still hold.

**Rollback.** The migration is one-way, so keep the branch's `migrateSave` behind
the version number; a career saved after Phase 2 needs the new code.

### Phase 3 — Found the county's districts (Stages A and B)

**Outcome as planned (Stage A).** 72 clubs, two pyramids, one calendar, a county
cup that spans both.

**Outcome as built (Stage B).** **Alderfordshire's six authored districts, 216
clubs in eighteen divisions, thirteen competitions** — each district's League Cup
and Plate, and one Alderfordshire County Cup across the lot — with the map,
the league tables, the cups, the roll-over, the save and the career-creation
screens all reading the one generated world. An existing career that is missing
districts is given them at its next season boundary; a career founded today
starts with all six and never waits for one. Nothing in the county's world is
special-cased to two ladders any more: `generateWorld` founds *every* district
`domain/districts.ts` lists, and the list is the county's whole geography as data
(the commissioning brief is the `SE27 Phase 3` task; the measured results, the
district table and the naming rules are in `PHASE3_COMPLETION_REPORT.md`).

**Stage B's own record.** Five things changed beyond "four more pyramids":

* **The district list is the source of truth.** `domain/districts.ts` holds six
  `DistrictDefinition`s — `regionId`, the map's `name`, `level`, the ladder
  `config`, an optional `centre`, and `legacy` for the two districts the world has
  always had. `alderfordshireDistricts()` fills each map district's `centre` from
  the atlas (`districtCentreInWorld`), so a district a manager chose on the map is
  a district founded in the place the map drew — except the founding county and
  the district next door, which keep the ground the world has always drawn for
  them, which is what keeps every two-district save, test and baseline exactly the
  world it was (`worldGenerator.test.ts`'s `LEGACY_DRAFTS` baselines are the
  proof).
* **`foundSecondPyramid` became `foundDistrictPyramid`.** The old name was an
  accurate description of a two-pyramid world and a misleading one for this one:
  one function founds one district — its region, settlements, businesses, grounds,
  clubs, squads, committees and rivalries — from a stream of its own, minting every
  id under the ladder's own id (`club_<ladder>_<n>`, `ground_<ladder>_<n>`) so a
  district can never collide with the county or with a neighbour. The caller passes
  the definition, the stream key, and the id counts the world it is joining has
  already used; `generateWorld` and the save expansion call the same function.
* **Cup lanes generalised without changing.** A cup round is placed beside any
  other round whose *field* shares no club (`CupField`), which was already a
  property of the entries rather than a list of named lanes: six League Cups and
  six Plates share the Sundays in pairs, and the County Cup — whose field is the
  whole county — keeps afternoons of its own. Thirteen competitions, one calendar,
  no club twice on a date (asserted in `cupLanes.test.ts`, `countyWorld.test.ts`
  and the soak).
* **The marker became a statement about districts, not about a second ladder.**
  `state.worldExpansion: { pending, expandedInSeasonId? }` keeps its shape, but
  *what is owed* is now read off the world rather than off the marker
  (`missingDistricts` compares the career's regions against the authored six), so
  the operation is idempotent by construction: a one-ladder save gains five
districts at its next boundary, a two-ladder save gains four, a career with all
  six gains none, and no roll-over can found a seventh.
* **The screens were already reading a world.** `worldNav.ts` asks for every
  ladder of a career (`pyramidOptions`) and for the division the manager chose
  inside it; the league and cup pickers are built from those lists, so six
  districts cost no screen a special case.

**Built (Stages 2 and 3 of the task series).** The second region and its ladder
exist and play: a new career is founded with `region_1` and `region_2`, 72 clubs,
two ladders of three divisions, and the county's own calendar is untouched. The
generator founds the district from its own streams (`foundDistrictPyramid`), so the
founding county's clubs, towns, grounds, squads, rivalries and fixtures are
identical to what they were before a second region existed — proved in
`worldGenerator.test.ts` by building the same seed both ways. The cup half is in
too: each ladder runs its own League Cup and Plate, a **County Cup** with
`field: { kind: 'county' }` is drawn from every active club in the county and
owned by no ladder, and `placeCupRounds` lays the rounds out in lanes so that the
two ladders' cups share the Sundays between them while the county cup — whose
field overlaps both — takes afternoons of its own. What remains of this phase is
the season-boundary activation of an existing career (Stage 4) and the cross-
pyramid movement that follows it. See `PHASE3_READINESS_AUDIT.md` §"Delivered
(Stage 2)" and §"Delivered (Stage 3)" for the as-built records, and the same
sections for the two documented deviations (which towns the map may reassign; the
county cup's extra Sundays).

**Built (Stage 4 of the task series).** An existing one-pyramid career now gains
the district at its next season boundary, once. `GAME_STATE_VERSION` 24 adds one
field — `state.worldExpansion` — which `migrateSave` writes when a save from
before the district is opened (`{ pending: true }` for a one-ladder career,
`{ pending: false }` for one that already has both ladders) and which
`startNextSeason` consumes as its first act: the region, its settlements, its
clubs and its ladder are founded, and the season is then built for both pyramids
in the one call. Nothing the career already holds moves, the season in flight is
never touched, and the marker is spent before anything is generated, so a second
roll-over cannot found a second district. §7.2(3) in other words, with §7.2(4)'s
timing kept exactly; the as-built record, including the three decisions Stage 4
had to take for itself, is in `PHASE3_READINESS_AUDIT.md` §"Delivered (Stage 4)".

A note on the calendar, because it is the part of this plan that changed. The
document proposed sharing a Sunday in *lanes* and dating later cup rounds on
Wednesdays. What was built shares the Sunday for **any two rounds whose fields
have no club in common**, which is a property of the entries rather than a list of
named lanes — and no Wednesday was needed: with the two ladders' rounds sharing,
the county cup's eight rounds fall on the off-week Sundays the league leaves free
and the season ends where the county cup's final falls. See the audit's Stage 3
section for the arithmetic.

**Built (Stage 5 of the task series) — the world a manager can see.** The
simulation has held two ladders since Stage 2, but until now the screens showed
only the founding one: a new career could not take over a club in the district,
and no league table or cup other than the founding ladder's could be read. Career
creation now chooses from **every ladder the draft was generated with** — the
region each draws its clubs from, its divisions by name, its clubs with the
league and division they belong to named on the card before the career is
confirmed — and a club built by hand joins the foot of the ladder the manager
chose. Inside a career, the league screen opens on his own ladder and his own
rung wherever he is managing and browses any other without the screen reverting
on him, and the cup screen offers all **five** competitions the county holds:
both ladders' League Cups and Plates, each named after the region that runs it,
and the County Cup that spans them. The ladder is the unit every one of those
screens reads (`src/ui/worldNav.ts`), the scope of every cup is read off the
field the competition itself declares (`cupFieldOf`) rather than inferred from a
name, and a world with one ladder draws no picker at all. Browsing is a reading
of the career, never a move in it: no club, membership, fixture or competition is
written by any of it, and a career that has not been given the district still
shows the one ladder it has. The as-built record is in
`PHASE3_READINESS_AUDIT.md` §"Delivered (Stage 5)".

**Work as it was done.** `domain/districts.ts`: the county's six districts as
authored data. `geography/alderland.ts`: `alderfordshireDistricts()`, each map
district standing where the atlas draws it. `simulation/generation/worldGenerator.ts`:
`foundDistrictPyramid` (generalised from `foundSecondPyramid`) and a `generateWorld`
that founds every district in the list. `simulation/worldExpansion.ts`: the
expansion itself — `missingDistricts`, `activateWorldExpansion`,
`markWorldExpansion`. `state/persistence.ts`: `from < 28` writes the mark.
`simulation/season.ts`: the expansion runs as the first act of `startNextSeason`,
and the season that follows is built for every ladder at once.
`seasonStructure.ts`/`calendar.ts`: the cups and their lanes, unchanged in shape
because they were already field-driven. `ui/worldNav.ts` + the league, cup and
world screens: every ladder, every division, thirteen competitions.
`ui/views/GeographySelectView.tsx`: the map, with all six districts playable and
each district's own towns drawn inside its own ground.

**Acceptance.**
* 216 active clubs, each in exactly one division of exactly one pyramid — six
  pyramids, eighteen divisions, twelve clubs in each (`countyWorld.test.ts`).
* A full season plays with **no club in two fixtures on one date**, over six
  ladders and thirteen competitions (`cupLanes.test.ts`, the soak's
  `no-club-plays-twice-in-a-day`).
* The county cup runs to a winner, its field is every active club in the county and
  no other club, and it belongs to no ladder.
* Promotion and relegation inside each pyramid, and the promotion balance check
  per pyramid (the soak's `promotion-balance`, per ladder).
* Fold/re-form inside a pyramid leaves that pyramid's division sizes constant.
* Two fresh careers from the same seed are identical (determinism), and a
  two-district world is byte-for-byte the world it has always been.
* Performance and state size: measured for the six-district world in
  `PHASE3_COMPLETION_REPORT.md` §8–9 — ~19.7 MB fresh, ~195 MB at a season end,
  a season through the real day loop in ~143 s, and every background fixture
  simulated in `fastmatch`.

**Rollback.** The expansion is a season-boundary operation, so a save that has not
rolled over can be resumed on the old code; after the roll-over the state carries
clubs the old code cannot build a pyramid from, so rollback is "restore the
pre-roll-over autosave", which the save manager already keeps.

### Phase 4 — Movement, eligibility and the archive

**Outcome.** Clubs can change pyramid at a season boundary; a county cup's
eligibility is genuinely geographic; a career's history survives several pyramids.

**Work.** `pyramid.ts`: a `resolveCrossPyramidMovements` pass at `finishSeason`
(only where the world has a reason — a pyramid that has shrunk below its minimum
field, or a club whose region changed under it), written as `MovementRecord`s and
applied by `applyMovements`. `season.ts`: archive entries per competition
(§5). `history`/`queries.ts`/`HistoryView.tsx`: read the archive. `levelOf`
switches the level-meaning readers (§3.4).

**Acceptance.** A club that moves pyramid keeps its honours, its season records,
its county-cup eligibility and its rivalries; `promotionHistory` reads as one
career; the archive's honours count per season equals divisions + cups
(the existing `honours-awarded-once` invariant generalised).

### Phase 5 — A second county, and the abstract wider world

The plan called this phase "four pyramids"; Alderfordshire has six, so the phase
is now about the *next county* rather than about more districts in this one.

**Outcome.** Another county with football of its own — mapped, authored as a
district list, and generated by the same code that generates Alderfordshire — and
then Stage C's abstract neighbours.

**Work.** A second authored district list and its atlas polygons (the map already
draws eighteen counties, seventeen of them locked); a county cup per county; the
career's county choice becoming a real choice rather than a one-item list; a
`DistantCounty` record and a season-boundary roll for its champions, if the
design still wants one. No squads or fixtures for the abstract neighbours — only
names, a champion and a line of news.

**Acceptance.** A second county generates, plays, rolls over and saves through the
same paths as the first with no branch anywhere that names either county; 432
clubs if it is authored at Alderfordshire's size; a 10-season soak with zero
failures; every cup decided every season; each county cup's field is every active
club of its own county and no other. Nothing in this phase may be a special case
for a county, a district or a ladder: what exists today is data plus one general
generator, and that must stay true.

---

## 9. Testing strategy

### 9.1 Invariants to hold (and where each lives today)

| Invariant | Today | Needed |
| --- | --- | --- |
| Every active club is in exactly one division | `soak` `every-club-in-one-league` | per pyramid |
| Division sizes constant across seasons | `soak` `tier-sizes-constant` | per pyramid |
| Promotion balanced across every boundary | `soak` `promotion-balance` | per pyramid, plus cross-pyramid movement |
| No club plays twice in a day | `soak` `no-club-plays-twice-in-a-day` | extend to "no club in two competitions on one date", already its real meaning |
| Honours awarded once, never duplicated | `soak` `honours-awarded-once`, `honours-not-duplicated` | per competition per season |
| The clock never rewinds; seasons do not overrun | `soak` `clock-never-rewinds`, `season-not-overrunning` | unchanged, and the guard on the whole design |
| Cup bracket complete, survivors exist | `soak` `cup-bracket-complete` | — |
| **Every cup that drew a round is decided** | **absent** | **Phase 0** |
| **Every cup round has a date** | **absent** | **Phase 0** |
| **Every fixture names a competition that exists** | **absent** | **Phase 0** |
| **A club's town has a region, and its region is stable across seasons** | **absent** | Phase 2 |
| **Every club is county-cup eligible exactly when it is in the county** | **absent** | Phase 4 |
| Save/load continuity | `soak` `checkSave`, `persistence.test.ts` | plus the new schema |

### 9.2 Automated multi-season checks

The harness exists and is the right shape; use it rather than inventing a second:

```bash
npm run soak -- --seasons=10 --seed=vale-1        # trend table + violations
npm run soak -- --seasons=10 --seed=vale-2
npm run test:soak                                  # gated, 2 seasons, fast
npm run benchmark -- --seasons=1                   # match cost + season loop
```

Add: **a "save the season, roll it over, load it, play another" round-trip** at
each phase (the soak's `checkSave` already serialises and deserialises; it needs
the roll-over variant), and **an expansion-in-place test**: take a pre-expansion
save, run the migration, assert the founding pyramid's clubs are untouched,
fixture-for-fixture, and that the new pyramid is generated identically twice from
the same seed.

### 9.3 Minimum acceptance before the first expanded world is playable

Stage A is playable when **all** of these hold on a clean checkout:

1. `npm run typecheck` clean, `npm test` green.
2. `npm run soak -- --seasons=5 --seed=<three different seeds>` — **zero `fail`
   violations**, no unaddressed `warn` beyond the existing `club-in-the-red`.
3. The determinism run agrees snapshot for snapshot.
4. A pre-expansion save migrates, plays a season, rolls over into the expanded
   world and plays a second season.
5. Every club is in exactly one division; no club has two fixtures on one date
   across 5 seasons; every cup is decided every season.
6. A by-hand career: play one full season at a club in the new pyramid, see its
   table, its cup, the county cup, the two pyramids on the world screen, promotion
   working, and a postponed fixture rearranged.
7. Performance and state size inside the §6.4 budgets.

### 9.4 Taking the same measurements again

The world audit of §1.1 was taken with a throwaway script. Recreate it as a
short-lived tool under `tools/` (or a `--json` extension of `tools/benchmark.ts`,
which is the better home) reporting: settlements and their kinds, settlements
without a club, clubs per division, fixtures a season, calendar entries and span,
cup fields and rounds, people/players, and `JSON.stringify(state).length`. Growing
the world without a number attached to it is how a career quietly becomes
unloadable.

---

## 10. Risk register

| Risk | Why it happens | Prevention |
| --- | --- | --- |
| **A cup round is silently never drawn; the competition ends with no winner** | `buildSeasonCalendarWithCups` drops a slot it cannot date; `drawCupRound` then returns null for ever | Phase 0's hard failure + `cup-decided` invariant; the calendar must be shown to have room *before* a cup is added |
| **Two cups come to the same round number** | `cupRoundOf` subtracts a global base and a per-cup offset | Phase 1's `match.cupRound`; `cupStructure.test.ts` case with two cups sharing a Sunday |
| **A club plays twice on one Sunday across pyramids** | The day a round wants is already taken by another pyramid's round for the same club (its own pyramid's cup and the county cup) | `fieldIsFree` is already the right rule; the new work is to make the calendar place the rounds so it does not have to move them, and to keep `checkDoubleBookings` as the backstop |
| **The season grows past its calendar and pushes the next one** | More competitions than the eight days of slack allow | Calendar budget check at season build; the soak's `season-not-overrunning` warn becomes a `fail` for the expanded world |
| **The world's state outgrows the browser's save** | ~90 KB a club, whole state written per save | Hard state-size assertion in the soak (§6.4), archive-per-season rather than keeping fixtures, and honest targets at each stage |
| **A club ends up in two divisions, or none** | Two ladders, and `divisionOf`/`tierOf`/`divisionAbove` searching by tier across the world | Pyramid-scoped ids and lookups (Phase 2); `checkPyramid` is the assertion |
| **History is lost at the roll-over** | `state.matches` is rebuilt every season | Per-competition archive written at `finishSeason` (§5) |
| **A fold leaves a hole in one pyramid** | `reviewClubFinances` is handed one division array | Pass per-pyramid divisions; a replacement is minted into the folded club's own pyramid |
| **The refactor moves the world** | 21 versions of accumulated behaviour, much of it seeded | The determinism test is the gate on every phase; a phase that changes a founding-pyramid snapshot must be fixed, not accepted |
| **Two simulation paths for one fixture** | A tempting "world tick" for pyramids the player is not in | Forbidden by design: every fixture goes through `applyFixturesSteps` and `simulationModeFor` |
| **New pyramids inflate the county's football** | More clubs ⇒ a bigger pool of players, and the soak already watches ability/reputation for drift | The existing `ability-stable`, `goals-stable`, `tier-ability-stable` and standing bands; the bounds are per level via `levelOf`, not per tier |
| **A migration duplicates clubs, fixtures or cup entries** | Generated ids colliding with a save's own | New id prefixes per pyramid; the expansion runs once, marked on the state and consumed at the season boundary (§7.2) |

---

## 11. The recommended first implementation task

**Task: make the calendar's promises provable, and decouple a cup round from the
matchday number — Phases 0 and 1 together.**

They are one task because the second is what gives the first something to test:
Phase 0's new invariants can only be shown to work on a world where two cups share
a numbering, and Phase 1 cannot be trusted without them. Neither changes anything
a manager can see.

### Deliverables

1. `soak.ts` gains `cup-decided`, `cup-round-has-date` and
   `every-fixture-in-a-competition`, wired into `runSoak` beside the existing
   checks and printed by `tools/soak.ts`.
2. `buildSeasonStructure` compares the cup slots it asked for with the cup
   entries the calendar placed, and reports a shortfall loudly rather than
   dropping the round.
3. `domain/match.ts` gains `cupRound?: number`; `cup.ts drawCupRound` writes it and
   `cupRoundOf` reads it with today's arithmetic as the fallback;
   `persistence.migrateSave` back-fills it for the current season's ties.
4. `cupStructure.test.ts` gains the two-cups-one-Sunday case;
   `seasonShape.test.ts` gains the dropped-slot case;
   `soak.test.ts` or a new focused test covers the three new invariants.

### Acceptance criteria

* `npm test` green and `npm run typecheck` clean.
* `npm run test:soak` green (no new failures, the determinism run still agrees).
* `npm run soak -- --seasons=2` on the unmodified world reports **zero violations
  for the three new invariants**, and the trend table is otherwise unchanged.
* A deliberately damaged state — a cup slot the calendar cannot place, and a cup
  whose last round is never drawn — fails the soak with `cup-round-has-date` and
  `cup-decided` respectively, named in the output.
* A tie's round read from `match.cupRound` equals the round read from
  `cupRoundOf`'s arithmetic for every tie in a season, for both the League Cup and
  the Plate (this is the migration's correctness proof).
* A career saved before the change loads, and its played cup ties report their
  original rounds.

### Explicitly not in this task

No second pyramid, no region assignment, no county cup, no new competitions, no
calendar lanes, no change to `state.pyramid`, no change to any match's date, and
no change to the match engine.
