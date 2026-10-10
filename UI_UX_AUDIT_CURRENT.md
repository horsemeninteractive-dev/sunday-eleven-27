# SE27 UI/UX audit: current codebase

Scope: all 25 views in `src/ui/views/`, and the overlays and modals in `src/ui/components/`, `src/ui/dialogs/`, `src/ui/layout/` and `src/ui/match/`. Based on the code only; no screenshots were used.

**Coverage, stated honestly**

- **Read line by line:** Squad, Tactics, Match, Finances, Inbox (Messages), Start, News, Home (`DashboardView`), Fixtures, Cup. Modals: `MatchReportModal`, `ProcessingModal`, `NegotiationModal`, `PlannerModal`, `FixtureInfo`, `GlobalFeedback`, `dialogs/Dialog`, `UpdatePrompt`, `layout/MobileNav`.
- **Structure only** (headings, section titles, buttons, dialog triggers): Your profile (`ManagerView`), Club (`ClubView`), Kit, World, History, Replay, Profile setup (`ProfileView`), League, Recruitment, Staff, Training, Team selection, Club select, Create club, First boot.
- **Not read in this pass:** `ProfileOverlay` (852 lines; structure only, with `PlayerProfile` and `ClubProfile`), `TeamSheet`, `MatchPhases` (`PreMatchPanel`, `HalfTimePanel`, `FullTimePanel`), `SaveManager`, the `dialogs/` set (Preferences, Profiles, Changelog, Credits, AppDialogs), `UtilityMenu`, `FaceDesigner`, `CareerFile`.

Findings for the structure-only screens are provisional until read line by line.

## Cross-cutting findings

1. **Photography is confined to pre-game screens.** The only photograph is `public/scene-ground.webp`, used by `SceneBackdrop` in `StartView`, `ProfileView`, `ClubSelectView`, `CreateClubView` and `FirstBootView`. No career screen uses a photograph. Matchday is drawn in SVG.
2. **Two chat-bubble vocabularies.** `InboxView` uses `bubble--mine`, and `NegotiationModal` uses `bubble--you` and `bubble--them`. Both classes exist in `styles.css` (lines 6525, 6528, 8278), so nothing is broken, but one bubble component would serve both.
3. **Quit without confirmation.** `MobileNav` (line 132) has a danger "Quit to menu" that runs immediately. `UtilityMenu` (line 17) does the same under "Return to the main menu", but its copy says the career is saved. The mobile control needs the same reassurance or a confirm.
4. **Error surfaces can overlap.** `Dialog` renders the global error inside itself when it is the top modal (`top === ref.current`). `GlobalFeedback` renders the error elsewhere, unless the top is a non-processing overlay panel. The rule is correct but hard to follow, and a reader may see the error twice or not at all.
5. **Tone of supporting copy.** Some hints are jokes ("the two blokes walking their dog", `FixtureInfo`). The tone suits the Sunday-league premise but is not uniform across screens.
6. **Dense tables on phones.** The Squad attribute table and sortable league and history tables carry many columns. Columns are marked `col--opt` in places, so the pattern exists but is not applied everywhere.

## Screen by screen

### Home (`DashboardView`) — read
- **Finding:** four metric tiles, a decisions grid, results and news all carry equal weight. "Report" correctly opens the match report (`DashboardView.tsx:211`).
- **Plan:** make the next match the hero. Collapse the tiles into one ruled strip. Add a photographic header band.

### Your profile (`ManagerView`) — structure
- **Finding:** five panels (current job, career record, your face, club honours, plus a link to history). Panels repeat header facts.
- **Plan:** an identity band, then the career story. Photograph as a portrait band.

### Start (`StartView`) — read
- **Finding:** strong structure; the photograph is the atmosphere.
- **Plan:** keep. This is the reference for photographic treatment.

### Profile setup (`ProfileView`) — structure
- **Finding:** form plus "The world" seed panel with suggestion chips.
- **Plan:** keep the layout. Check the contrast of placeholder copy over the scene.

### Club select, Create club, First boot — structure
- **Finding:** all three use `SceneBackdrop`. Create club draws kit and crest options.
- **Plan:** keep the flow. These screens are the second-best place for a photograph of the ground.

### Squad (`SquadView`) — read
- **Finding:** three view modes plus filter tabs. A 14-column attribute table is unusable on a phone. "In contention" is a toggle styled as a tab.
- **Plan:** keep one table. Replace the tabs with a single filter control. Surface the dressing room as a photographic band.

### Selection (`TeamSelectionView`) — structure
- **Finding:** pitch with draggable names; the "Close" action appears on the list panel.
- **Plan:** keep. Verify the drag affordance on touch devices. Drag hint is at line 995.

### Tactics (`TacticsView`) — read
- **Finding:** a `FormationBoard` sits beside the instructions (line 113). Effects are hidden in a `<details>` element.
- **Plan:** keep the pitch. Surface effects where the change is made, not behind a disclosure.

### Training (`TrainingView`) — structure
- **Finding:** "Plan the week" opens the planner; session report and attendance are sections. Preparation is in a `<details>` element.
- **Plan:** drawn session plans, and a training-ground photograph as a header band.

### Recruitment (`RecruitmentView`) — structure
- **Finding:** "Get the word out" with four actions; candidate rows open `NegotiationModal`. Dense list.
- **Plan:** keep the list. Raise identity with portraits and a scouting-ground photograph.

### Staff (`StaffView`) — structure
- **Finding:** committee, chairman, secretary's desk, assistant report, physio list. Several `workspace-panel` panels.
- **Plan:** keep. Group the committee into one panel. Photograph of the clubhouse as a band.

### Club (`ClubView`) — structure
- **Finding:** ground name and motto, "Ground, squad and club profile" button, "Who runs it", "What needs you", "Matters of record".
- **Plan:** let the ground lead, with a photograph. Keep "What needs you" above the fold.

### Kit (`KitView`) — structure
- **Finding:** "The strip", "The kit deal", "This season's designs".
- **Plan:** keep. Kit art is already drawn; a photograph of the kit on a pitch would add atmosphere.

### Fixtures (`FixturesView`) — read
- **Finding:** `FixtureRow` is defined locally (`FixturesView.tsx:165`) as a list row with badges. `CupView` uses the shared grid row in `components/FixtureRow.tsx`. The two layouts differ, so they are not merged.
- **Plan:** keep both rows, since they serve different layouts. Photograph the matchday ground as a header.

### Cup (`CupView`) — read
- **Finding:** ties use the shared `FixtureRow`.
- **Plan:** keep. A cup-final photograph would mark the knockout rounds.

### League (`LeagueView`) — structure
- **Finding:** sortable table with nine sort keys; "This week" and "Last week" panels.
- **Plan:** keep the table. On phones, hide columns behind `col--opt` by default.

### History (`HistoryView`) — structure
- **Finding:** honours, recent matches, season-by-season table with eight sort keys.
- **Plan:** a history-wall photograph as a band; keep the table.

### World (`WorldView`) — structure
- **Finding:** "The local game", towns, grounds, and a `<details>` directory of all clubs.
- **Plan:** map-like header, photographed grounds. Keep the directory collapsed.

### Replay (`ReplayView`) — structure
- **Finding:** replay controls with a restart chip and close action.
- **Plan:** keep. Confirm the restart button is reachable by keyboard.

### Finances (`FinancesView`) — read
- **Finding:** the balance is a focal fact; forward-looking tiles are secondary; the week breakdown is in a `<details>` element.
- **Plan:** keep. Photograph would not suit money; keep it plain.

### Messages (`InboxView`) — read
- **Finding:** the reply bar shows three actions and a "More" toggle. Message bubbles use `bubble--mine`.
- **Plan:** keep. Share the bubble component with the negotiation transcript.

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
- **Plan:** confirm the decline, or make it undoable. Share the bubble component with the inbox.

### `PlannerModal` — read
- **Finding:** a calendar with a week strip and a "Next up" panel. The month defaults to `2026-09-01` if no game date is set, which is a hard-coded fallback.
- **Plan:** derive the fallback from the season, not a literal.

### `FixtureInfo` (`NextFixturePanel`, `MatchDetailPanel`) — read
- **Finding:** preparation is in a `<details>` element. Stats use humorous hints. Rating pills use fixed thresholds (7.5, 6.3).
- **Plan:** keep the structure. Make the hint tone consistent.

### `GlobalFeedback` — read
- **Finding:** the logic that hides the error inside a non-processing overlay panel is hard to read.
- **Plan:** simplify so there is one rule for where an error appears.

### `dialogs/Dialog` — read
- **Finding:** shared shell with a `kind` attribute for styling. Renders the error when it is the top modal.
- **Plan:** keep the shell. Resolve the error duplication (cross-cutting finding 4).

### `UpdatePrompt` — read
- **Status: implemented.** The copy now reads "Replaces v{running}".

### `layout/MobileNav` — read
- **Status: implemented.** The sheet heading now reads "All screens", and "Quit to menu" asks first and says the career is saved.

### `ProfileOverlay` — structure
- **Finding:** `PlayerProfile` and `ClubProfile` are the two large sections. Not read line by line.
- **Plan:** read in full in the next pass.

### `dialogs/SaveManager`, `Preferences`, `Profiles`, `Changelog`, `Credits` — not read
- **Plan:** read in the next pass.

### `match/TeamSheet`, `match/MatchPhases` — not read in detail
- **Plan:** read in the next pass. `MatchPhases` exports `PreMatchPanel`, `HalfTimePanel` and `FullTimePanel`.

## Photography plan

Photography is not limited to matchday. Proposed bands, by screen:

- **Home:** the ground, as a header band behind the next-match hero.
- **Squad:** the dressing room.
- **Training:** the training ground.
- **Recruitment:** a scouting ground or the five-a-side pitch.
- **Staff and Club:** the clubhouse.
- **Fixtures and Cup:** the matchday ground; a cup-final image for knockout rounds.
- **League and History:** a history-wall or trophy-room image.
- **World:** a map-like header over the grounds.
- **Kit:** the kit on a pitch.
- **News:** a lead photograph on the lead story.
- **Matchday modals:** a backdrop behind `PreMatchPanel` and `FullTimePanel`.

Keep photographs out of Finances and Inbox.

Treatment, as already used for the scene: desaturated, green-tinted, faded so text stays legible. Every new image needs a measured file size and a precache check. Images stay `aria-hidden`.

Assets are not in the repository yet. Sourcing or generating them is a decision for the user. The code can host them.

## Next steps

1. Read the 14 structure-only views and the unread overlays line by line.
2. Apply the remaining cross-cutting fixes: one bubble component and one error rule.
3. Add photographic bands screen by screen, starting with Home.
4. Verify each change in the browser, including phone width.
