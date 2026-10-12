# SE27 UI/UX audit: current codebase

Scope: all 26 files in `src/ui/views/` (the 25 the passes below list, plus `BetweenJobsView`, which no pass had named), and the overlays and modals in `src/ui/components/`, `src/ui/dialogs/`, `src/ui/layout/` and `src/ui/match/`. Based on the code only; no screenshots were used.

**Coverage, stated honestly**

- **Read line by line:** Squad, Tactics, Match, Finances, Inbox (Messages), Start, News, Home (`DashboardView`), Fixtures, Cup. Modals: `MatchReportModal`, `ProcessingModal`, `NegotiationModal`, `PlannerModal`, `FixtureInfo`, `GlobalFeedback`, `dialogs/Dialog`, `UpdatePrompt`, `layout/MobileNav`.
- **Read line by line in the structure-only pass below:** Your profile (`ManagerView`), Club (`ClubView`), Kit, World, History, Replay, Profile setup (`ProfileView`), League, Recruitment, Staff, Training, Team selection (`TeamSelectionView`), Club select, Create club, First boot — the names on the line that used to say "structure only", which is fifteen screens and was counted as fourteen — and `BetweenJobsView`, found in the same pass to have been left off every list.
- **Read line by line in the overlay pass below:** `ProfileOverlay` (both of its pages, `PlayerProfile` and `ClubProfile`), `match/TeamSheet`, `match/MatchPhases` (`PreMatchPanel`, `HalfTimePanel`, `FullTimePanel`), `dialogs/SaveManager`, the rest of the `dialogs/` set (`Preferences`, `Profiles`, `Changelog`, `Credits`, `AppDialogs`), `layout/UtilityMenu`, `components/FaceDesigner`, `components/CareerFile`.

**Every screen in `src/ui/views/` has now been read line by line, and so has every overlay.** Nothing in this audit is provisional.

## Cross-cutting findings

1. **Photography is on both halves of the game now.** All 21 images in `public/photos/` are used: eighteen files in `src/ui/views/` wear a band through `PageHeader`'s `photo`, `match/MatchPhases` carries the matchday band, the stylesheet gives two more to the game's own furniture (`.home-club` on Home, `.news-lead__front` on the lead story), and `public/scene-ground.webp` is still behind `SceneBackdrop` across the pre-game flow. This finding was written when the only photograph in the game was the scene, and the photography work has passed it by — the section at the foot of this document is the current state of it rather than a proposal.
2. **Two chat-bubble vocabularies.** `InboxView` uses `bubble--mine`, and `NegotiationModal` uses `bubble--you` and `bubble--them`. Both classes exist in `styles.css` (lines 6525, 6528, 8278), so nothing is broken, but one bubble component would serve both.
   **Status: closed.** Both screens render `components/Bubble.tsx`: one vocabulary (`--mine` for the manager's own words, `--them` for everybody else's, and a face only ever on somebody else's), one definition per direction in the sheet, and the dead `.bubble--you` / `.bubble__who` rules deleted. The sentence is drawn by the component too — only the inbox used to wrap its own in `.bubble__body`, so the wrapping rule that keeps a long word inside its bubble was on one screen's messages and not the other's. `ui/auditFindings.test.ts` holds all of it, and `workspaces.test.ts` pins the bubble's markup and geometry.
3. **Quit without confirmation.** `MobileNav` (line 132) has a danger "Quit to menu" that runs immediately. `UtilityMenu` (line 17) does the same under "Return to the main menu", but its copy says the career is saved. The mobile control needs the same reassurance or a confirm.
4. **Error surfaces can overlap.** `Dialog` renders the global error inside itself when it is the top modal (`top === ref.current`). `GlobalFeedback` renders the error elsewhere, unless the top is a non-processing overlay panel. The rule is correct but hard to follow, and a reader may see the error twice or not at all.
   **Status: closed.** One owner: `components/GlobalFeedback.tsx` reads `state.error`, announces it once with one Dismiss, and portals the banner into whatever has the screen — the panel itself, so a long dialog cannot push the sentence off the bottom of the surface it is about — falling back to the corner toast when nothing has it. `Dialog` draws its own content and nothing else. `ui/auditFindings.test.ts` sweeps every file under `src/ui/` and asserts that exactly one of them both reads the error and announces something on it, which is the version of the rule that cannot rot quietly.
   **Kept, and why:** the save screen carries a second voice for one failure — the banner, and `SaveManager`'s own standing callout "This career is not being written to disk" with the same reason under it. That is two lifetimes of one fact rather than two rules: the callout is still true after the banner is dismissed and after the dialog is reopened on another day, and the banner is the only thing that reaches the manager when an autosave fails while he is playing. Removing either loses the announcement or the standing condition.
5. **Tone of supporting copy.** Some hints are jokes ("the two blokes walking their dog", `FixtureInfo`). The tone suits the Sunday-league premise but is not uniform across screens.
6. **Dense tables on phones.** The Squad attribute table and sortable league and history tables carry many columns. Columns are marked `col--opt` in places, so the pattern exists but is not applied everywhere.

### The two closed findings, measured in the running game

The error and the bubble were both watched in the dev server (`window.slfm`, which `main.tsx` exposes in development) with a scratch career in an incognito tab, so no existing save was touched:

- **The error, with nothing in front:** exactly **1** `.global-feedback`, `position: fixed` — the corner toast — carrying the sentence and one `Dismiss error`; pressing it cleared both the banner and `store.error`.
- **The error, with a dialog open** (`credits`): exactly **1** banner, and it is *inside* `.overlay__panel` (`position: static`, `flex: 0 0 auto`) rather than floating over it. One surface, one banner.
- **The bubble in an inbox thread** (a real career, a real thread): 2 bubbles — one `--mine`, one `--them` — 2 `.bubble__body` paragraphs, and 1 face, on the other man's line only. The body measured `overflow-wrap: anywhere`.
- **The bubble in a negotiation transcript** (a candidate put on the list, then the dialog opened): `bubble bubble--them`, 1 `.bubble__body` with `overflow-wrap: anywhere` and `margin: 0`, his face beside his line, `from` reading `Austin Gee · 20 Jul 2026` — and nothing block-level nested inside the body, which is what the old shape would have produced had the wrapper been added twice.

## Screen by screen

### Home (`DashboardView`) — read
- **Finding:** four metric tiles, a decisions grid, results and news all carry equal weight. "Report" correctly opens the match report (`DashboardView.tsx:211`).
- **Plan:** make the next match the hero. Collapse the tiles into one ruled strip. Add a photographic header band.

### Your profile (`ManagerView`) — read
- **Finding:** five panels (current job, career record, your face, club honours, plus a link to history). The header gives the name, the age, the day job and the club; the panels give the job in full, the record, the face and the honours, which is what they are for rather than a repeat of it.
- **Read and kept, nothing found.** The identity band the plan asked for is on the screen: his own drawing at the size the club's page gives its crest, the crest beside it, and `/photos/profile-boots.webp` behind the heading.

### Start (`StartView`) — read
- **Finding:** strong structure; the photograph is the atmosphere.
- **Plan:** keep. This is the reference for photographic treatment.

### Profile setup (`ProfileView`) — read
- **Findings (fixed):** the screen stated the seed rule twice — `seedIsUsable`/`MIN_SEED_LENGTH` decided whether the button was live and `trimmed.length < 3` decided whether the click was refused — and worked the season's opening day out for itself from a year written into the file.
- **Read and kept:** the layout, the face panel, the saved-profiles shortcut and the suggestion chips. **Still open, from the plan:** the contrast of placeholder copy over the scene. Read from the markup, the inputs sit on panel surfaces rather than on the photograph, but that is an argument and not a measurement.

### Club select, Create club, First boot — read
- **Findings (fixed):** Club select drew its own `Fact` row under the shared primitives' one, printed a subs figure of `£5/£3` as the terms of whichever club was being looked at, gave a ground row a capacity of `0` where its name and surface said `—`, and labelled its panel with a tab that is not drawn when the draft has only one division. Create club capped the founding year with a literal `2026` while the simulation clamped it with the machine's clock — so the same seed built a different club on another day, and the year the manager typed was not the year he got — and stated its club-name rule in four places.
- **Read and kept:** the ladder as a tabstrip, the squad snapshot with its own count of what it is showing, the badge drawn twice (small on the card, large in the panel), the budget bar and the standing read off the squad rather than asked for. All three wear `SceneBackdrop`; Create club's crest panel and Club select's band are on `/photos/create-club-crest.webp` and `/photos/club-select-pitches.webp`.

### Squad (`SquadView`) — read
- **Finding:** three view modes plus filter tabs. A 14-column attribute table is unusable on a phone. "In contention" is a toggle styled as a tab.
- **Plan:** keep one table. Replace the tabs with a single filter control. Surface the dressing room as a photographic band.

### Selection (`TeamSelectionView`) — read
- **Finding (fixed):** the bench was five in four places — two guards, the picker's disabled state and the heading's own count — with no name for the number, while the validator that enforces it wrote a fifth.
- **Read and kept:** the drag rules (a dot is picked up anywhere inside it; a name is both a name and a handle; a click that never moved still opens his page), the two tools on the pitch, the shape book, the sort headings over the list, and the announcement the keyboard's drag makes. **Still open, from the plan:** how the drag feels under a finger — the affordance is a pointer capture with a five-pixel threshold, which is read and not felt. The hint is the `lineup__hint` paragraph, as the plan said.

### Tactics (`TacticsView`) — read
- **Finding:** a `FormationBoard` sits beside the instructions (line 113). Effects are hidden in a `<details>` element.
- **Plan:** keep the pitch. Surface effects where the change is made, not behind a disclosure.

### Training (`TrainingView`) — read
- **Findings (fixed):** a thin turnout was measured against a literal `11` rather than the side the laws are built for; the hall was quoted at £20–£30 and charged £18–£32; and the history line counted the club's own sessions twice, so it read "12 sessions · 12 on file".
- **Read and kept:** the plan as buttons over a numbered list of blocks, the attendance table with its notable-only default, the session report card, and the development work behind its own summary. The training ground is behind the heading (`/photos/training-field-goal.webp`).

### Recruitment (`RecruitmentView`) — read
- **Finding (fixed):** the open session was quoted at £20–£40 on the button and again in the sentence under it, and charged at £18–£42 by the simulation.
- **Read and kept:** the needs tiles and the breakdown under them, the four doors with exactly one painted as the next step (`nextRecruitmentStep`), the candidate tiles with a face and what is known about each man, and the men the club decided against behind their own summary. The open count is stated in the header and again in the list's title — left as it is: one is the screen's context and the other is the list's own. Portraits and the trial ground are on the screen (`/photos/recruitment-trial.webp`).

### Staff (`StaffView`) — read
- **Read and kept, nothing found.** The committee is the same `StaffCard` the Club screen draws for the same people; "roles covered" counts the list the unfilled-roles line reads; the chairman's expectations come from `governanceSummary` with one mapping from status to word; and the treasurer line handles its three cases — no treasurer, a treasurer, or the manager keeping the books. The committee is in one panel, as the plan asked, and `/photos/staff-touchline.webp` is behind the heading.

### Club (`ClubView`) — read
- **Read and kept, nothing found.** The ground leads the screen and "What needs you" is above the fold, as the plan asked; "Who runs it" is `clubRoster` and the same cards the Staff screen uses, so the two screens cannot describe one man differently.
- **Noted, left alone:** the header's `founded {identity.foundedYear}` and the departments tile's `Founded {history.founded}` are one number written twice — the generator and `applyCustomClub` each write one field from the other — and both readings are the club's true year.

### Kit (`KitView`) — read
- **Read and kept, nothing found.** The screen is one decision drawn twice — the strip the club wears beside the three it could have worn, each with the button that changes it — with the maker, the sponsor and the colours as facts under it and the three strip descriptions behind their own summary. The kit on a pitch is behind the heading (`/photos/kit-shirts.webp`).

### Fixtures (`FixturesView`) — read
- **Finding:** `FixtureRow` is defined locally (`FixturesView.tsx:165`) as a list row with badges. `CupView` uses the shared grid row in `components/FixtureRow.tsx`. The two layouts differ, so they are not merged.
- **Plan:** keep both rows, since they serve different layouts. Photograph the matchday ground as a header.

### Cup (`CupView`) — read
- **Finding:** ties use the shared `FixtureRow`.
- **Plan:** keep. A cup-final photograph would mark the knockout rounds.

### League (`LeagueView`) — read
- **Findings (fixed):** a club in the bottom three was told it stood "Above the drop" with "0 pts" beside it, because the label was read from the competition rather than from the club's own place; and the table's panel was labelled by a tab that is not drawn when the division has no siblings to move between.
- **Read and kept:** sorted rows that carry their own place (`zoneFor`), promotion and relegation marks taken from the competition's own places, the focal fact and the derby note, "This week" and "Last week". The optional columns were already `col--opt`, which is what the plan asked for.

### History (`HistoryView`) — read
- **Finding (fixed):** "Longest-serving player in the current squad" named the man with the most appearances and printed his joining date under it — a sentence worked out from the wrong fact, which is how a man who joined last week came to be called the longest-serving.
- **Read and kept:** the honours list with the biggest win read off the played matches, the club story on a timeline, the season table with its remembered sort, and the managers list. The history wall is behind the heading (`/photos/history-programmes.webp`).

### World (`WorldView`) — read
- **Finding (fixed):** the business directory showed the first 24 and said nothing about the rest, while the club directory above it says "12 of 24 shown" and offers the remainder.
- **Read and kept:** the search and town filters over a paginated club list, the county in numbers, towns and grounds, the sortable full directory — whose remembered sort is built from its keys alone, so a screen with no world can still name its own columns — and the two technical disclosures. The directory stays collapsed, as the plan asked; the aerial band is `/photos/world-aerial-parks.webp`.
- **Noted, left alone:** the directory's "Squad" column counts the players its `squadIds` resolve to, while the column's sort counts the ids. Equal for every club the game builds.

### Replay (`ReplayView`) — read
- **Read and kept, nothing found.** The transport is three real buttons — play/pause with a name of its own, restart, and the speeds as pressed chips — and a labelled range for the scrub, so the restart the plan asked about is a `<button>` in the tab order. The clock is local to the screen, the score follows only the revealed events, and both sheets carry `marks={false}` so the afternoon is not spoiled on the way in.

### Finances (`FinancesView`) — read
- **Finding:** the balance is a focal fact; forward-looking tiles are secondary; the week breakdown is in a `<details>` element.
- **Plan:** keep. Photograph would not suit money; keep it plain.

### Messages (`InboxView`) — read
- **Finding:** the reply bar shows three actions and a "More" toggle. Message bubbles use `bubble--mine`.
- **Status: implemented.** The reply bar is kept as it was, and the bubble is shared with the negotiation transcript — see cross-cutting finding 2.

### Match (`MatchView`) — read
- **Finding:** a live match takeover; pitch rendered from the engine's render state.
- **Plan:** keep. Matchday photography as a backdrop to the pre-match and full-time panels, not during play.

### News (`NewsView`) — read
- **Finding:** stories are closed `<details>` by default; `LeadStory` leads.
- **Plan:** a lead photograph on the lead story, `NewsPlate` as the illustration system.

## Modals and overlays

### `MatchReportModal` — read
- **Finding:** the headline is the scoreline. "Watch replay" closes the report and opens the replay.
- **Plan:** keep.

### `ProcessingModal` — read
- **Finding:** a progress bar with no close control, by design. Results appear as they land.
- **Plan:** keep. Consider a photograph behind the progress card.

### `NegotiationModal` — read
- **Status: implemented.** "Not for us" now asks first.
- **Finding:** "Not for us" was a danger button with no confirm. Bubbles use a second vocabulary (`bubble--you`).
- **Status: implemented.** The decline asks first, and the transcript draws the inbox's own `Bubble` — see cross-cutting finding 2.

### `PlannerModal` — read
- **Finding:** a calendar with a week strip and a "Next up" panel. The month defaults to `2026-09-01` if no game date is set, which is a hard-coded fallback.
- **Plan:** derive the fallback from the season, not a literal.

### `FixtureInfo` (`NextFixturePanel`, `MatchDetailPanel`) — read
- **Finding:** preparation is in a `<details>` element. Stats use humorous hints. Rating pills use fixed thresholds (7.5, 6.3).
- **Plan:** keep the structure. Make the hint tone consistent.

### `GlobalFeedback` — read
- **Finding:** the logic that hides the error inside a non-processing overlay panel is hard to read.
- **Status: implemented.** The rule is one line and one owner now — it is portaled into whatever has the screen, or drawn in the corner when nothing has — and the dialog shell no longer draws a copy. See cross-cutting finding 4.

### `dialogs/Dialog` — read
- **Finding:** shared shell with a `kind` attribute for styling. Renders the error when it is the top modal.
- **Status: implemented.** The shell keeps the kind and gives up the error: it draws its own content and nothing else, and the error duplication is resolved by leaving `GlobalFeedback` as the only place it is drawn.

### `UpdatePrompt` — read
- **Status: implemented.** The copy now reads "Replaces v{running}".

### `layout/MobileNav` — read
- **Status: implemented.** The sheet heading now reads "All screens", and "Quit to menu" asks first and says the career is saved.

### `ProfileOverlay` — read
- **What it is:** two pages under one overlay. `PlayerProfile` draws a player or an official — a `kind: 'player'` target whose person is an official gets the official's page, which is a head, an age and a standing, his notes, and a way to have a word with him — and a player gets three tabs: Overview (Where he plays, Status & personal, The way we play or Scouting, Actions), Attributes or What you know, and Career & relationships. `ClubProfile` is a head, a quickstat strip and one inspector of four screens: Season, Squad, Ground, Money. Names inside both are doors, the page keeps its own stack of them with a Back control in the header, and the stack is thrown away when something *outside* opens a different profile.
- **Findings (both fixed, in the overlay pass below):** a man without a club was handed a club's subs scheme; the manager's own page offered him a conversation with himself.
- **Also fixed there:** the note a dismissal writes printed a machine date on that page.
- **Kept as it is:** the facts grid, the quickstat strip and the two `<details>` disclosures read as intended, and the club's squad table is the same sortable table the rest of the game uses. The disclosures are focus stops inside the modal's trap — `useModal` counts `summary` as focusable — so nothing is unreachable by keyboard.

### `dialogs/SaveManager`, `Preferences`, `Profiles`, `Changelog`, `Credits`, `AppDialogs` — read
- **Finding (fixed):** the save screen kept saying it was reading the saved careers for the life of the dialog after a rejected `listSaves`, directly under the alert that said they could not be listed.
- **Kept as it is:** one `Dialog` shell with the kind on the overlay, the club's colours restated by `AppDialogs` for the dialogs mounted above the shell (and left alone on the main menu, where there is no club), a nested confirm in `Profiles` and `SaveManager` registered on the same layer stack so Escape closes the one in front, and the changelog and credits as text and links.

### `match/TeamSheet`, `match/MatchPhases` — read
- **Finding (fixed):** the half-time card counted the changes left from a literal `3` rather than from the law the bench obeys.
- **Kept as it is:** a team sheet is a list and nothing more, one reading of the strips (`shirtFor`/`isKeeper`) shared by the pitch, both replay sheets and the report, with the marks switched off in a replay so the afternoon is not spoiled; and the three matchday cards each carry their own way out — Escape on the briefing or the half-time card is "look around", with the control bar's own button as the way back, and full time has no close at all, which is that phase's rule.

## Overlay pass — the twelve nobody had read

Read line by line: `ProfileOverlay` (both of its pages), `match/TeamSheet`,
`match/MatchPhases` (all three cards), `dialogs/SaveManager`,
`PreferencesDialog`, `ProfilesDialog`, `ChangelogDialog`, `CreditsDialog`,
`AppDialogs`, `layout/UtilityMenu`, `components/FaceDesigner`,
`components/CareerFile`.

Five things in them were real. They are fixed, and each one is pinned by a test.

| Where | What was wrong | What changed |
| --- | --- | --- |
| `ProfileOverlay`, an official's page | "Have a word" was decided by `person.id !== game.clubs[game.userClubId]!.managerId` — the club's manager slot rather than the man. A dismissal empties that slot (`dismissUserManager` sets `club.managerId = null`), so out of work every official passed the test, and the manager's own page offered him a conversation with the man holding the phone | The guard is `person.id !== MANAGER_PERSON_ID`: asked of the man, not of a club he may not have |
| `ProfileOverlay`, a player's facts | The Subs row read `club?.finances.starterSubAmount ?? 5` — with no club it printed the game's own defaults as the terms he plays under, beside a head that said "Not playing anywhere" | The row is the club's figures or a dash, the way every other club fact on the page reads (`Home town`'s `?? '—'`) |
| `career.ts`, `managers.ts` — the note under the manager's own head | `Between jobs, ${date}.` is prose kept in the note and printed verbatim on his page, so the one date in the interface nobody reads the game's way was his own dismissal | `formatShortDate`, the form that page uses for every other date; the `startsWith('Between jobs')` bookkeeping still matches |
| `match/MatchPhases`, the half-time card | `const changes = 3 - match.substitutions[session.side]`: the number the engine works to today, but restated beside the law (`laws.ts` → `CHANGES_PER_MATCH`) and able to print a negative | `changesRemaining(match, side)` — the law, with the engine's own clamp at none |
| `dialogs/SaveManager` | `saves === null` was the "reading" test, and the listing catch never set `saves`, so a rejected `listSaves` left "Reading saved careers…" on the screen for the life of the dialog, under the alert saying they could not be listed | `isReadingSaves(saves, failure)`, which is the rule the menu's own list of saves already follows |

Evidence: `npm run typecheck` clean; `npm test` **99 files, 1263 tests**, all
passing. New: `src/ui/components/ProfileOverlay.test.ts` (4 tests),
`src/ui/dialogs/SaveManager.test.ts` (2), and a `changesRemaining` case in
`src/ui/match/scoreline.test.ts`. The profile's four are *renders* rather than
readings of the source: its two pages now take their career as a prop, so a test
can print one a real career produced — a dismissed career for the manager's own
page, a squad player with his club removed for the facts grid — and assert on
what is on it. Nothing else draws either page, so nothing else moved.

### Read and kept

- `match/TeamSheet` — a sheet is a list and nothing else, and it is the same list on the pitch, in a replay and in the report: one `matchTeamColours` reading of the strips, the keeper in the third strip, and `marks` off only in a replay so the afternoon is not spoiled.
- `match/MatchPhases` — the three cards share one scoreline, each carries its own way out, and dismissing the briefing or the half-time card is not a dead end: `showIntervalButton` puts it back from the control bar. Full time offers no Escape at all, which is that phase's rule rather than an omission.
- `dialogs/Dialog` — one shell, `kind` on the overlay for painting only, a scrim and Escape and one focus trap from `useModal`, and focus returned to the control that opened it.
- `PreferencesDialog`, `ProfilesDialog`, `ChangelogDialog`, `CreditsDialog`, `AppDialogs` — nothing found. The preferences reset is instant and three taps to redo by hand, the managers list asks before it forgets one, and the changelog's "this build" badge is taken from the first numbered version heading rather than from the newest heading above it. (Its second condition — `block.version === latest` — is implied by the index that chose the badge; harmless, and left alone rather than churned.)
- `UtilityMenu` — nothing found, and one decision recorded: its "Return to the main menu" is **not** given the phone's confirmation (cross-cutting finding 3). It is a ghost button three clicks deep inside a dialog whose own sentence says the career is saved and waiting under Continue; the phone's is one row of a thumb-reach list, where a mis-tap is the risk. Both say the career is saved; only one of them is easy to hit by accident.
- `FaceDesigner` — the preview is the real drawing (`PortraitArt` from `facePlan`), twelve rows in three tabs with every row in exactly one tab, and it keeps no copy of the face: every change goes straight back to its caller, which is what lets one control edit a profile and a career.
- `CareerFile` — the export button says what it is doing while it writes a whole world out, the file chooser is cleared after each choice so the same file twice is still a change, and a restored career is put to the manager before it takes over, saying what will not be touched.

### Still not verified, from this pass

- None of the twelve was driven in a real browser here. The fixes are pinned by render tests and by the suite; how the screens read at the manager's own window is still his to judge.
- Widths: `ProfileOverlay` was restructured so its two pages take their career as a prop. No markup moved, but the profile's layout at phone and tablet widths was not re-measured after it.
- `TeamSheet`'s bench rows print `slot.position` where the eleven print `POSITIONS[slot.position].code`. The two are the same string for every position in `POSITIONS`, so this is one value written twice rather than a defect; left alone on purpose.

## Structure-only pass — the screens that were left

Read line by line: `ManagerView`, `ClubView`, `KitView`, `WorldView`,
`HistoryView`, `ReplayView`, `ProfileView`, `LeagueView`, `RecruitmentView`,
`StaffView`, `TrainingView`, `TeamSelectionView`, `ClubSelectView`,
`CreateClubView`, `FirstBootView` — and `BetweenJobsView`, which was on no list at
all and was found while checking that the audit's claim to have read every view
was true. (The plan called the structure-only list fourteen; it is fifteen names,
which is why the count is stated that way rather than repeated.)

Sixteen things in them were real. Nearly all of them are the same shape of
finding: **a rule the game already knows, written a second time in a screen.** A
bench of five, a full side of eleven, a price, the year a career starts, the rule
for a seed — each was a second copy that had already drifted, or would have. The
rest are sentences worked out from the wrong fact — the longest-serving player,
the relegation gap, the day he went out of work — and one panel claiming a tab
that was not on the screen.

| Where | What was wrong | What changed |
| --- | --- | --- |
| `TeamSelectionView`, `selection.ts` | The bench was five in four places — two drag guards, the picker's disabled state and the heading's own count — with no name for the number, while `validateLineup`, which enforces it, wrote a fifth | `BENCH_SIZE` in `domain/match.ts` beside `FULL_SIDE` and `MIN_SIDE`, read by the validator, its message, the two guards and the `Subs (n/BENCH_SIZE)` heading |
| `RecruitmentView` | The open session was quoted at £20–£40 on the button and in the sentence under it, and charged at £18–£42 by `holdOpenSession` | `OPEN_SESSION_COST` exported from the simulation, beside the ledger entry that charges it; both places on the screen print `moneyRange(OPEN_SESSION_COST)` |
| `TrainingView` | The hall was quoted at £20–£30 and charged at £18–£32 when the weather moved a session indoors | `HALL_HIRE_COST`, the same shape as the session's |
| `TrainingView` | A thin turnout was measured against a literal `11` while the laws name the side (`FULL_SIDE`) | `FULL_SIDE` |
| `TrainingView` | The history line read "12 sessions · 12 on file": the club's own sessions counted twice, once through `sessionsFor` and once through the store | `historySummary(count, calledOff)` — the second half is now the evenings that were called off |
| `HistoryView` | "Longest-serving player in the current squad" named the man with the most appearances, with his joining date printed under it | `longestServingPlayer(squad)`, by `joinedClubOn` |
| `ProfileView` | The seed rule was stated twice: `seedIsUsable`/`MIN_SEED_LENGTH` for the button's enable-state, `trimmed.length < 3` for the click | `seedIsUsable(trimmed)`, the same test, and the message from `MIN_SEED_LENGTH`. The comment claiming both used one source of truth is now true |
| `ProfileView`, `CreateClubView`, `gameStore`, `gameSetup` | The career's start year was written in four files — the draft's default, the store's call, the profile's age preview and the club designer's cap | `CAREER_START_YEAR` and `careerSeasonStart()`, so the preview and the world cannot disagree about the morning the career begins |
| `CreateClubView`, `gameSetup` | The founding year was capped at a literal `2026` in the input and clamped by `new Date().getUTCFullYear()` in the simulation — so the same seed built a different club on another day, and a year the manager had typed was silently rewritten | `foundedYearWithin(year, startYear)`, bounded by `EARLIEST_FOUNDED_YEAR` and the draft's own year, used by both |
| `CreateClubView` | The club-name rule was written four times: two buttons' enable-state, the check behind them and the sentence under the form | `MIN_CLUB_NAME_LENGTH` and one `canRegister` |
| `ClubSelectView` | A second `Fact` component was defined at the foot of the file, under the shared one it was a copy of, with a narrower type | The shared `Fact` |
| `ClubSelectView`, `ProfileOverlay` | `?? 5` / `?? 3` printed the game's own defaults as a club's subs terms on a screen the manager had just chosen a club from; a club with no ground printed "capacity 0" beside a name and surface that said `—` | The club's own figures — both fields are required, so the fallbacks were dead as well as wrong — and a dash for a club with no ground |
| `LeagueView` | A club in the bottom three was told it stood "Above the drop" with "0 pts" beside it: the label came from the competition rather than from the club's place, and the gap was clamped at nothing | `inDropZone`, `contextLabel` and `contextValue` — "In the drop" and "N pts from safety" — so the sentence and the mark on the row read the same position |
| `LeagueView`, `ClubSelectView` | The table's panel was labelled by a tab id that is not drawn when the division (or the draft) has only one division | The panel is a tab panel only when there is a tabstrip to own it |
| `WorldView` | The business directory showed the first 24 and said nothing about the rest, while the club directory above it says where it stopped and offers the remainder | The same control the club list uses: "More businesses · 24 of 121 shown" in the world it was measured in |
| `BetweenJobsView` | "Out of work since {today}" — the date was the day the manager was reading the screen, so the line was true on the first morning of unemployment and wrong on every morning after it | The end date of the spell he left (`outOfWorkSince`), which is the same date the record below prints beside the club |

### Read and kept

- `ManagerView`, `StaffView`, `ClubView`, `KitView`, `ReplayView`, `FirstBootView` — nothing found beyond the notes recorded below.
- `CreateClubView`'s random badge is dealt from `Math.random`, the only use of it in the interface. Left alone: the pick is a piece of the design the manager then commits, it draws nothing from the world's seed, and the face shuffle uses the seeded rng because a face *is* derived from a seed.
- `WorldView`'s "Squad" column counts the players its ids resolve to while the column's sort counts the ids, and `ClubView` prints the founding year from two fields the generator writes from one. Both are the "one value written twice" shape the audit has left alone elsewhere; neither can disagree.
- **Noted, not changed — the career record is the club's record.** `managerCareerRecord` sums the club's whole season history, and `BetweenJobsView` sums it again per spell, so a spell's row includes seasons played at that club before the manager arrived or after he left — and the profile screen's three tiles, which read as his career, are the club's seasons. The profile's honours panel already carries the honest note ("the club's honours, not a claim that you won them all"); the record has no equivalent, and it is the one finding from this pass that wants a simulation change rather than a screen change: a spell's own record, or the club's seasons filtered to the spell's dates. Left as a finding rather than rewritten, because what "a manager's career record" means is not a UI decision.

### Measured in the running game

The screens whose behaviour changed were driven in the dev server — a scratch
career in an incognito tab, through `window.slfm`, so no existing save was touched.

- **World, the business directory** (a world of 121 businesses): the list opened at 24
  rows with no statement about it, and one press of the control under it grew the list
  to 48 and moved its label to "More businesses · 48 of 121 shown".
- **League, the sentence beside the club's place** (Piddby Men's Club, 7th of 12, a
  division with relegation places and no promotion place): the row carried `zone--mid`
  and the focal fact read "Above the drop · level on points" — the two marks agree,
  which is the invariant the finding was about.
- **Club select, the detail panel:** the ground row reads one ground ("Hollow Lane
  (grass, capacity 178)" — name, surface and capacity from the same record), the
  finances row is the club's own figures, and the table panel is a `tabpanel` labelled
  by the division tab beside it (3 tabs, `aria-labelledby="division-1"`).
- **Create club, the name rule:** both buttons are disabled and the hint reads "at least
  3 characters" for an empty name and for "Ab", and both are enabled for "Abc Rovers" —
  one rule, read twice from one constant.

### Still not verified, from this pass

- The **drop-zone branch** of the League sentence was not seen in a real career; the
  career that was driven was mid-table. The position-by-position agreement between the
  sentence and the row's mark is asserted in `structurePass.test.ts` over a whole table,
  including the 18th-of-20 case that used to read "Above the drop · 0 pts".
- The **between-jobs screen** was not seen in a real unemployment: it takes a career
  the committee has sacked, and the fix is pinned by a source assertion in
  `BetweenJobsView.test.ts` rather than by a dismissal driven in the browser.
- None of the sixteen was read at **phone width**, and the business list is long enough
  that its pagination is the first thing on that screen a phone will feel.
- How the selection screen's drag feels **under a finger** is still read rather than felt.
- How the screens read at the manager's own window is his to judge; this pass measured
  behaviour, not taste.

### Evidence

`npm run typecheck` clean. `npm test` **100 files, 1284 tests**, all passing.
`npm run test:slow` **40 files, 631 tests**, passing, with `src/simulation/soak.test.ts`
skipped as it always is (2 tests, gated behind the soak run). `npm run build` clean.

New: `src/ui/views/structurePass.test.ts` (19 tests), and a case added to
`src/ui/views/BetweenJobsView.test.ts` for the date. Two of the new tests were
falsified
by hand before they were believed: putting the old price back on the Recruitment
button, and putting the appearances sort back under the History sentence, each
failed the test that claims to hold them.


## Photography: what is on the screens, and what the plan still asks for

This section was written when the game had one photograph in it. The work has
since been done, so what follows is the state of it rather than a proposal — read
out of the code, screen by screen:

`public/photos/` holds **21 images**, committed, and every one of them is used.
Eighteen files in `src/ui/views/` wear a band through `PageHeader`'s `photo` (one
of them, `CupView`, switching between two), `match/MatchPhases` carries the
matchday band in its own inline style, and two more are backgrounds the
stylesheet gives to the game's furniture — `.home-club` and `.news-lead__front`.
`public/scene-ground.webp` stays where it was, behind `SceneBackdrop` on every
pre-game screen.

By the plan's own list, brought up to date:

- **Home:** the ground — `prospect-park-sunday.webp`, on the club band rather
  than behind a page header. The plan asked for "a header band behind the
  next-match hero"; what is there is the club read as a place, with the ground
  behind it, which is the same photograph used for the same reason.
- **Squad:** the dressing room — `squad-dressing-room.webp`.
- **Training:** the training ground — `training-field-goal.webp`.
- **Recruitment:** the trial — `recruitment-trial.webp`.
- **Staff and Club:** the clubhouse — `staff-touchline.webp`, `football-club.webp`.
- **Fixtures and Cup:** the matchday ground and the trophies — `stadium-matchday.webp`,
  `cup-trophy.webp`, `plate-trophy.webp`.
- **League and History:** the trophy and the programmes — `league-trophy.webp`,
  `history-programmes.webp`.
- **World:** the aerial over the parks — `world-aerial-parks.webp`.
- **Kit:** the kit on a pitch — `kit-shirts.webp`.
- **News:** the lead story's own front — `news-lead.webp`.
- **Matchday modals:** the matchday band — `prematch-matchday.webp`.
- Beyond the plan: `profile-boots.webp`, `tactics-whiteboard.webp`,
  `club-select-pitches.webp`, `create-club-crest.webp`, `inbox-noticeboard.webp`.

**Two deviations from the plan, for the user to judge rather than for this audit
to reverse:** the plan said to keep photographs out of Finances and Inbox, and
both now carry one (`finances-ledger.webp`, `inbox-noticeboard.webp`) — and the
same noticeboard image is behind `NewsView`'s page header as well, so the inbox
and the paper open on the same photograph while the lead story has its own.

Treatment, as used for the scene: desaturated, green-tinted, faded so text stays
legible. Every new image needs a measured file size and a precache check — the
build reports 85 precached files — and images that are decoration stay
`aria-hidden`.

## Next steps

1. ~~Read the 14 structure-only views line by line.~~ Done — see the structure-only pass above. Every screen in `src/ui/views/` and every overlay has now been read.
2. Decide whether the inbox and the news page should open on the same photograph, and whether Finances and Inbox keep the bands the plan said to leave out.
3. Read the fifteen screens, and the two controls this pass added, at phone width — the one measurement this pass states as missing.

The two cross-cutting fixes that were outstanding — one bubble component, one rule for where the error appears — are closed; see findings 2 and 4.
