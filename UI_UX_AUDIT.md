# SE27 product UI/UX audit and delivery checklist

## Boundaries and evidence

Audit date: 6 October 2026. This is a presentation pass: no changes to domain models, simulation, Touchline, generation, calendar/training/finance/competition rules or save schemas. The existing uncommitted Touchline and branding work is preserved. Baseline UI copies are kept locally in ignored `.freebuff/ui-baseline` for review against this pass, not against unrelated historical changes.

Sources inspected: App and the complete lazy-view registry; all 25 view components; all layout components; all dialog components; every components/ and match/ producer; routing/actions and relevant store transitions; existing CSS tokens, responsive and overlay rules; existing UI, colour and first-boot test contracts. Cross-source search for dialog/menu/tab/radio roles, disclosures, local open/error state and browser confirmations found no additional custom context-menu, tooltip, tutorial or delete-save screen. Native `title` hints, selects, date/colour pickers and native `details` are existing secondary interactions. Design-document aspirations are not treated as implemented gameplay.

Baseline typecheck passed. An isolated incognito career was created through actual menu → manager form → generation → club selection → take charge; the user's original The Old Bell save was not loaded or changed. All 18 administrative destinations rendered at desktop 1440×900 and mobile 390×844. No document overflow in this sample, but mobile lists were very long (squad 3413px, fixtures 3899px, world 5414px). Browser renders are baseline evidence, not final verification.

## Screen inventory and hierarchy

P = primary, S = secondary, C = contextual, B = background. Status starts at **audited**; implementation and final browser coverage must be recorded separately.

| Surface / actual entry | P | S | C / B and special states | Intended identity / change |
|---|---|---|---|---|
| Static storage boot + App not-ready fallback | opening storage / saved career | game name | missing storage, resume/no-resume, rejected storage | Neutral startup before the store knows; retain career-opening wording only for actual save loading, distinct from first-boot branding. |
| FirstBootView (outside ViewId) | Touchline then SE27 | Skip / automatic handover | Escape, reduced/full/system motion; seen + hasSaves + atMenu gate | Preserve approved artwork and branded sequence; no save-loader repurposing. |
| start | continue latest career or begin | build own club, save list | refresh, empty/list pending/error, Preferences/Managers/Changelog/Credits, install/manual/no-install, version | Quiet front door; honest save-list/loading/error feedback. |
| profile setup | manager identity → Generate world | seed / saved profiles | optional nickname/job/hometown, validation, disabled action, cancel | Clear setup progress and concise validation; retain required fields, seeds and generation. |
| select-club | choose club → take charge | selected identity, division selector | squad snapshot/sorting, back, no draft; 3 division tabs | Club-led selection; selected club remains apparent on mobile; deeper inherited squad is disclosure. |
| create-club | club identity, budget → register | live badge + ground + squad preview | all badge choices/shuffle/reset, structure, colours, backing/standard/size, affordability and invalid name | Club workshop, not long anonymous form; sticky action and clear validation. |
| dashboard | next fixture + current decisions | weekly preparation, current league/money, recent results | full squad/training/table/ledger/news via doors; no fixture/results/news | Manager's club diary; crests/date/venue, remove duplicate availability; reports open the actual result. |
| manager | identity, job, career record | form, honours | biography and detailed record, first match/no honours | Personal career rather than six repeated number cards. |
| squad | people + position + availability | fitness/form/morale; filters/sorting | appearances/goals, profile, dressing-room groups, no matches | Compact human roster, keyboard names, all data retained in full-list/profile contexts. |
| team | formation XI and bench → match | legality/captain/problems | inline starting/bench picker, clear/remove/swap, assistant auto-pick, unavailable/empty/no fixture | Pitch and selection together; picker appears beside the pitch rather than below the screen. |
| tactics | formation pitch + instructions | selected roles / squad fit | instruction explanations, reset, tactical consequences, no fixture | Currently has **no pitch**. Add real formation/selected players as centre; no invented individual-role system. |
| fixtures | next fixture and month in hand | season diary/results | reports/replays, past/future months, postponed/rearranged/abandoned, no fixture | Football calendar; quick month navigation/current month; keep entire schedule reachable. |
| training | session plan/date/place/attendance | preparation quality + last session | full attendance/sorting, history, development, hall fallback; cancelled/run/thin/invalid/capacity | Session blocks with visible purpose on request, simpler weekly brief. |
| club | club identity/ground/community | committee/current issues | finance/staff/news/history doors, governance record, no concerns | Actual crest/colours/ground/motto above organisation; no fake map or stadium. |
| staff | people + issues + messages | chairman expectations, secretary work | assistant/physio reports, missing roles, away/no staff/at-risk/dismissal | Committee directory; reports progressively disclosed without burying urgent work. |
| kit (off-navigation) | chosen home/away/GK strip | choose existing design | firm/sponsor/colours, catalogue description, return; missing kit | Preserve real SVG artwork; compact details. |
| recruitment | squad gaps → discover/evaluate candidates | source/status/known information | full needs table, closed list, negotiation/profile, pending trials, daily-used actions, empty list | People + local recruitment routes; actual candidate identities, no raw all-player search. |
| finances | actual balance / projection / owed | concerns/upcoming bills, sponsor | collection/full/partial, seek sponsor, category/ledger sort, first entry/no sponsor/no debt | Treasurer's book; primary monetary summary separate from usual weekly detail and ledger. |
| league | selected division table + your position | fixtures/results elsewhere | division tabs, sort, form, promotion/drop marks, scorer/assist/rating/discipline tables, unplayed | Table is appropriate here; competition statistics secondary and scoped as existing queries. |
| cup | own tie + current round | competition selector/survivors/winner | earlier rounds, postponements/replays, giant-killing, statistics, awaiting draw/not entered | Cup run and round progression; secondary records collapsed. |
| history | club story/honours/season record | recent results / managers | notable events, sortable seasons, player record links, first season/no honours/results | Club archive; remove repeated current-season accounting and inaccurate fixed promotion copy. |
| world | local clubs and places | towns/grounds/businesses | club inspector, sort/filter, rivalries/recent seasons, technical seed | Local directory; compact discoverable clubs rather than giant mobile table. |
| news | dated headlines | category/club-person context | full story, linked people/clubs, archive, no stories/filter | Headlines that really expand; remove disconnected daily pile of names. |
| inbox list / thread | who wrote + unread / current conversation | relevant reply suggestions | More/Fewer reply actions, group participants, no threads/messages/actions, mobile back | Preserve distinct list/thread layout; focus and sender hierarchy, no fake composer. |
| match takeover | score/clock/pitch/current moment | transport + decisions | five drawers, options, briefing/HT/FT, commentary-only sheets, signals, 2D/3D unavailable fallback | Keep authoritative renderer/pump unchanged; meaningful match-state/selection controls and consistent contextual overlays. |
| replay takeover | recorded match/clock + transport | seek/speed/close | recorded vs reconstructed, end/start, incident banner, no events | Same visual match family; no resimulation or changing replay records. |

## Every overlay / secondary producer

| Producer | Actual surfaces and special states | Required interaction work |
|---|---|---|
| Dialog + AppDialogs | Preferences, Managers, Changelog, Credits | One header/close/body/footer, bounded scroll, focus enter/trap/restore, topmost Escape/backdrop, mobile widths. |
| PreferencesDialog | Motion radios, fullscreen supported/unsupported, speed radios, 2D + disabled 3D, reset | Keyboard group semantics; concise settings rows, preserve preference schema. |
| ProfilesDialog | saved manager list, Forget, no profiles | Clear removal confirmation, no career deletion. |
| CreditsDialog | SE27 wordmark, Touchline artwork + Authoritative Football Simulation System, real credit list | Same modal system; retain exact attribution and honest technology list. |
| ChangelogDialog | Unreleased and numbered versions, current build, external links | Readable long-document modal; scrolling header remains accessible. |
| PlannerModal | month navigation, day cells/events, match-week strip, jump/one day/Continue/fixture | Calendar-led bounded modal; clear selected day and action footer, no duplicate advance control; context help disclosed. |
| ProfileOverlay | own/opposition/unattached player; missing player; club + missing club; linked-profile back stack | Compact contextual profile with Overview/Attributes/History context; preserve all knowledge visibility and actions. Official links currently say player then show missing — provide actual official profile, not fake player data. |
| ClubProfile inside ProfileOverlay | Season/Squad/Ground/Money tabs; kit/identity/rivalries | Shared keyboard tabs; fewer duplicated quick facts; real club data retained. |
| NegotiationModal | discovered candidate, history/actions/knowledge/interest, joined, not discovered/missing | Consistent modal, action footer; reduce duplicate offer action, disclose detailed reasons/knowledge. |
| MatchReportModal + MatchDetailPanel | played/not played, score/events/ratings/stats/commentary/replay | Football report scoreline first; key goals/cards/knocks and ratings; whole commentary on request, topmost Escape/backdrop. |
| ProcessingModal | current fixture/progress/results, no current/no results, self closes | Non-dismissible focus boundary; actual progress only, no arbitrary loading percentage. |
| MobileNav | More sheet, grouped destinations, live match, calendar, save/load/quit | Explicit close/focus containment; actions don't leak through; unify save-slot UX with utility menu. |
| UtilityMenu | settings popover, three save/load slots, autosave, prefs/changelog/quit | Slot names/empty/loading/failure, overwrite confirmation, honest popover semantics/keyboard and bounded placement. |
| TopBar SearchBox | club/player results, no results, <2 chars, focus/blur | Keyboard results remain available (current 150ms blur timer loses them), Escape/outside; mobile access. |
| MatchControls | Tactics/Subs/Players/Commentary/Stats drawers, options menu, speed/pause/skip | Expanded state and explicit drawer close/Escape, selection semantics; no interaction alters Touchline authority. |
| MatchPhases | pre-match briefing, HT, FT cards; put briefing/HT down and reopen | Focus-managed modal behaviour, consistent bounded header/body/footer, talks expose selection and description on touch/keyboard. |
| TeamSelectionView | starting/bench picker (inline contextual panel, **not** modal) | Focus/scroll into view; keyboard actions retained. |
| WorldView | inline selected-club inspector | Avoid competing duplicate inspector/profile; use shared profile doorway. |
| Native hints / controls | title hints for attributes/status/form/position/conditions/sort; native selects/date/colour; disclosures | Essential explanations visible via details/selected-choice help, never only hover. No custom tooltip library introduced. |
| AppNotice / AppShell error / UpdatePrompt / InstallCard | transient notice, sticky error, update Reload/Later, native/manual install | One visible live announcement; global error reachable on menu/match as well; current dismiss sets notice not error. Update must not cover primary mobile actions. |

No existing browser confirm/alert producers were found. Save overwrites and manager forgetting currently act immediately; presentation confirmations will wrap the existing actions, not change persistence.

## Design system decisions

- Restrained near-black/charcoal with readable neutral ink, grass-green SE27 accent, existing club colours only for identity and selected/action meaning. Improve low-contrast metadata and danger text. Keep approved scene/stripe/artwork, not new decorative imagery.
- Three weights (regular/medium/semibold-bold); readable body/metadata; normal-case buttons/section titles, tabular numerical values. Headlines and scores create hierarchy, not every metric.
- Sections use spacing/rules, not a panel around every fact. Summary metrics become one ruled strip; complex forms/tables retain panels. One shallow radius, one border weight, elevated shadow only for floating surfaces.
- Reuse existing crest/kit/pitch/form artwork. No fake faces, invented roles/momentum, decorative charts, additional gameplay or new dependency needed.
- Shared modal focus boundary with topmost handling, initial heading focus, Tab containment, restored opener, inert background, scroll lock; footer and close remain reachable. Match intervals keep match-specific styling with the same interaction contract.
- Desktop grouped navigation retained; mobile has the same destinations and one persistent progression action. All screen arrivals reset content scroll and move focus to their heading, including contextual navigation.
- Filters and true tabs have correct selected state and keyboard operation. All critical controls meet 44px mobile targets. Tables stay tables where useful; no disappearing data without a reachable details/full view.

## High-priority baseline findings

1. Tactics is form-only; squad is mouse-click-only rows. Mobile tables stack into long databases.
2. Dashboard repeats availability; manager/club/history repeat metrics. Card hierarchy doesn't match decision importance.
3. News claims disclosure in comments but renders all bodies. Reports render full transcripts and duplicate score/team headings.
4. Full report buttons merely navigate to fixture list rather than opening the finished report; Home result report likewise opens list.
5. Dialogs do not trap/restore focus. Escape handlers are scattered and can close multiple stacked surfaces. Profiles/processing/intervals bypass Dialog. Match options lacks outside/Escape dismissal.
6. Search results disappear on a fixed blur timer; incomplete listbox/menu/radio/tab ARIA contracts. Button drops unlisted ARIA props (`aria-pressed`, `aria-label` callers).
7. Error is shown only in shell, invisible after failed menu load or match substitution. Its Dismiss doesn't clear error.
8. Save-slot menus allow empty loads / silent overwrites, have no slot identity and duplicate mobile implementation. Managers Forget has no confirmation.
9. Setup grid has 340px minimum that can overflow narrow screens. Create-club primary action is only at the bottom, with weak invalid-name precheck.
10. Startup's static “Opening your career…” is shown before storage knows whether any career exists. Preserve actual save-loader message but neutralise this unknown state.
11. Match header/meta and transport chips are very small. Post-match has no direct report handoff. Existing replay stats are final-record stats (not live clock stats); do not misrepresent as at-the-replay-instant.
12. CSS has duplicate bubble rules and broken colour token usage (`--s3` used as colour), fixed mobile-footer clearance, dead legacy CommandBar exports and lots of one-off dense labels. Consolidate affected rules rather than blindly delete history.

## Final verification ledger (pending implementation)

- [ ] All 25 screens addressed or explicitly retained with rationale.
- [ ] All overlay families and nested/stacked cases exercised.
- [ ] Desktop/laptop/tablet/mobile and short landscape measured, not just build checked.
- [ ] Keyboard focus, Escape/backdrop, tab/radio/menu operation, contrast and reduced motion checked.
- [ ] Isolated new-manager and create-club flow; match pre/live/HT/FT/report/replay → continue/next day.
- [ ] Established-save copy walkthrough without overwriting user's source save.
- [ ] Baseline simulation/domain/state/persistence source bytes unchanged by this task.
- [ ] Typecheck, relevant fast/slow tests, production build and served build checked after final edits.

This document is a checkpoint and coverage checklist, not a declaration that implementation or verification is complete.

## Correction pass — reported regressions and FM24-style workspaces

Seven specific regressions were reported against an earlier version of this pass. Each is addressed below with the evidence that closes it. The reference for the layout work is Football Manager 24's adaptive panelling: anchored screen identity, one list whose columns change with the selected view, user-arrangeable panels, and graphical (rather than flat) surfaces. Nothing from another product was copied; the principles were applied to SE27's own components and tokens.

| Reported problem | What changed | Evidence |
|---|---|---|
| The whole Messages screen scrolled instead of the thread list and the conversation scrolling individually | `.app__main[data-view='inbox']` no longer scrolls; `.inbox__rows` and `.inbox__log` are each their own scrolling region with `overscroll-behavior: contain`, and the reply bar is capped so it cannot eat the conversation | Harness asserts, at 1440 and 390, that the frame does not scroll, that a real 12-message thread scrolls inside its own pane, and that the thread list is `overflow-y: auto` |
| Player dots on Selection and Tactics were two different designs | Both screens now draw the same `pitch--preparation` markers from one source (`tacticalDiagram.ts`), with the shirt, name label and position vocabulary shared | `workspaces.test.ts` pins the shared helper; the harness clicks all eleven positions at five viewports on the real pitch |
| Tactics did not show how instructions change player positions | The diagram phase is now driven by the instruction tabs themselves (Shape / In possession / Out of possession), so one control moves both the picture and the settings; markers move for defensive line, mentality, focus, pressing and possession | Harness asserts the marker's coordinates literally change when the defensive line changes, and `workspaces.test.ts` covers the geometry, including that tempo does *not* move anyone and the keeper never moves |
| Squad had separate lists rather than one list with different information | One table, one filter row, and an in-place view switch (Selection / Season performance / Key attributes) over the same rows | Harness asserts a single `<table>` whose row count is unchanged across all three views |
| Unnecessary close buttons on the match bottom-tab panels | The drawer head and its "Close panel" button are gone; the tab that opened a panel closes it, and Escape and the opener-focus restoration still work | Harness asserts no `Close panel` control exists and that each tab toggles its own panel |
| Club creation left large empty space | Two balanced columns (identity + ground, badge + squad) with the submit bar as its own band; badge art and picks share a row | Harness checks two columns exist and that a custom club is then actually created through the UI and enters the world with the chosen name |
| The Manager screen was a pile of dropdowns repeating the header | No disclosures left on the screen. Identity is stated once, in a hero band, and job/record/honours are real panels | `workspaces.test.ts` asserts the page has no `<details>` and no "Who you are" panel |
| Staff read as a left-aligned wall of text | Each person is a card (identity, role, availability, competence, duty) in a two-across grid, with the chairman, secretary, assistant and physio as a separate workspace of panels | Rendered and reviewed at 1440 and 390 |

Also corrected while auditing these screens:

- The match stats panel headed its whole-match table "Last 15 minutes". The window belongs to the pressure bar alone and is now labelled with it.
- The stats panel claimed it never invents a number, but possession printed a fabricated 50/50 when the record held no possession ticks. The row is now omitted when the ticks behind it do not exist.
- Club selection listed rivalries by short name, which named nobody ("The Old (91), The Old (64)"); it uses full names.
- The pressure bar carried `aria-label` on a bare `div`, which is prohibited; it is named as an image.

### Club colour is a tint or an edge, never a fading patch

Reported after the pass: "numerous instances of the team colour gradient effect at tops of pages or in panels that have padding … that don't fill the box they are in". They were real, and they came from the visual-interest layer painting the club's colour as a *gradient* rather than as a tint. A gradient that reaches `transparent` part way across a padded box leaves the colour as a patch floating in that box, and because every heading is a different width the fade landed somewhere different in each one — a different fraction of every panel head on the screen was green.

| Where it showed | Before | After |
| --- | --- | --- |
| Every panel head | `linear-gradient(96deg, var(--club-wash), transparent 78%)` | Ordinary heads are neutral, lit from above exactly like table heads (`--panel-3` → `--panel-2`). The club colour is spent once per screen, on the head of the *primary* panel, as a flat `var(--club-soft)` that fills it. |
| The manager hero | `radial-gradient(ellipse at 90% 10%, var(--club-wash), transparent 65%)` layered over the surface | One surface gradient, no club wash. Identity is the 3px club edge and the rule under the header. |
| Staff and squad person marks | club wash fading into white or `--panel-3` diagonally | Flat `var(--club-wash)`, edge to edge in a 28×34 / 44×52 box. |
| Metric strip tone feet | `linear-gradient(90deg, var(--ok), transparent)` and its three siblings | Solid 2px rules the full width of the tile. A foot that faded out two-thirds along was a smudge in the tile's corner. |
| Live commentary bar | club tint fading out at 72% of the bar's width | Flat tint edge to edge. Its `--c-ink` was also dropped: dark ink is chosen for light clubs, and the bar is not that colour, so the label now uses `--text-dim`. |
| Page headers | a wash across the header | No wash at all. On a phone the club-selection and club-creation headers are `position: sticky`, and a translucent header let the form scroll visibly through it; they are painted `var(--bg)`. Identity moved to a 64px club rule under the header and an 18px club bar before the eyebrow. |

What stays: vertical, full-width light from above on surfaces (panels, tiles, table heads, buttons), and the short club rules above sections and under page headers. Those fill what they are on, or stop on an edge.

The rule is now stated in `src/ui/styles.css` itself, next to the token block, and guarded by four tests in `src/ui/workspaces.test.ts` that scan the stylesheet for any club-coloured background declaration containing `transparent` or a gradient. They were mutation-checked: re-adding one fading club wash fails the suite.

### Verification run after these corrections

- `npm run typecheck`: clean.
- `npm test`: 47 files, 490 tests, all passing (includes the new `src/ui/workspaces.test.ts`, now 14 tests).
- Club-colour contract harness (`gradientContract.mjs`): 23 assertions, **0 offenders** — no club-coloured gradient fades anywhere across the manager, staff, dashboard, squad, tactics, club, inbox, league and training screens at 1440 and 390, 7 measured panel heads all filling their panel, the primary head flat and filling, the commentary bar flat edge to edge, and both sticky headers opaque (`rgb(8, 9, 11)`, no background image). 0 axe violations, 0 page errors.
- `npm run build`: succeeds. The 639 kB main-chunk warning is a known, unfixed limitation and is not suppressed.
- Isolated admin audit (`audit.mjs`): 117 screens across six viewports, 128 assertions, **0 axe violations, 0 page errors**.
- Correction harness (`corrections.mjs`): 113 assertions, 33 screens, **0 axe violations, 0 page errors**, including panel customisation persisting across navigation and being restorable, real all-eleven pitch clicks, and a custom club created through the UI.
- Match pipeline (`matchflow.mjs`): completes end to end — kick off, pause and hold, all five drawers with no redundant close control, match options, half time interval, second half, run to the whistle, full time, full report, replay seek, next day, save and reload keeping the played result. No runtime errors.

### Open finding raised by the match probe (not a UI defect, not fixed here)

Running the match through the real interface at the 'key' viewing mode exposed a football-side problem that the UI then reports faithfully: a settled fixture recorded `possessionTicks { home: 13, away: 6561 }` and a result of `homeShots: 0, awayShots: 0`, with the half-time card showing a single side holding the ball and three attempted passes across 90 minutes. That is a statement about the simulation's recorded output, not about this presentation pass, and the brief for this task forbids changing simulation behaviour. It is recorded here with the numbers so it can be investigated on its own terms. The presentation changes above only remove the *invented* figures around it.

### Still not verified

- First-boot branded sequence, credits and changelog after the visual-interest layer. (The two screens that follow it and carry a sticky header — club selection and club creation — are now checked at 390.)
- Save overwrite accepted (the harness confirms the confirmation appears and that Escape closes only the topmost layer, but does not confirm the overwrite itself).
- Manager forgetting, search, and the More sheet, at phone widths.
- Tablet and short-landscape variants of the corrected club-admin screens beyond the sizes already sampled.

## Second correction pass — the reported items, the workspace band, and the mobile frame

Eight problems were reported against the pass above; two arrived while the others were being worked, after the sidebar had become a rail. Each is closed with the evidence that closes it. No simulation, domain, state or save code was touched.

| Reported problem | What changed | Evidence |
| --- | --- | --- |
| The sidebar should collapse (with animation) to icons only unless it is hovered, with the content column taking the space | `--sidebar-rail: 54px` is a token rather than a number; at `min-width: 861px` the frame is `grid-template-columns: var(--sidebar-rail) minmax(0, 1fr)` with a 220ms transition to `var(--sidebar)`. `SideNav` reports open/closed to the shell (`onOpenChange`), which puts `app__body--nav-open` on the frame — the nav owns the pointer and focus, the frame owns its own first column. Labels stay in the DOM at `width: 0` so every item keeps its accessible name. | `rail.mjs`, 46 assertions: 54px at rest, 154px gained (1386 vs 1232 at 1440), opens on hover *and* on keyboard focus, labels still the accessible name at rest, a real unread badge 15×15 inside the rail, the active section marked in the club's colour, and the frame checked at 1440/1024/860/390/320. |
| "Who runs it" looked out of place and formatted poorly | One card for a person, as a component: `components/StaffCard.tsx`, with fixed slots (identity, status, action, detail, duty, issue). Club and Staff both render a `.staff-roster` of it, so the same people are the same kind of object on both screens. | `screens.mjs` asserts the two screens produce cards with an identical slot vocabulary and order and that the slots do not overlap. |
| Media read as left-aligned text rather than as a football news website | News is a paper now: a lead story (26px headline, standfirst, body) over day-grouped `details.news-story` cards in a grid, with the archive as a sticky rail at 1080px and up. A closed card says what it does ("Read the story" / "Close"). The standfirst is only printed when there is a second paragraph, so a one-paragraph item is not introduced as a summary of itself. | `screens.mjs`: lead at 26px, 9 cards over 3 days, a grid, the rail, the lead not duplicated in the feed, and one column at 390. |
| Design elements must be used consistently | The chosen control is painted by its own state (below), one card per person, one sanctioned wash, and the muted tone lifted once per tinted surface (section 3b) rather than at each call site. | `workspaces.test.ts` and `screens.mjs`. |
| The padding on Messages made no sense | The frame stops padding a two-pane workspace (`padding: 0; gap: 0`); each pane owns its padding, and the list header, footnote and reply bar carry the frame's own 16px so nothing sits in a 40px gutter inside a 12px one. | `screens.mjs`: the frame's padding is 0, the panes sit on the frame's edges, and a real 12-message thread is rendered in them. |
| Text tab buttons were unreadable because of a transparent fill, especially pre-game | Measured cause: the visual-interest layer matched bare `.chip, .segmented__item, .tab` and, being later in the sheet at equal specificity, silently replaced the chosen state's club fill with a near-transparent gradient — so `--club-ink` (near-black for a light club) sat on the page background. The surface layer now excludes the chosen state, and a closing block restates the chosen state's paint after every other layer. | `contrast.mjs`'s light-club sweep, which is the only pass that can see it. |
| "The sidebar change broke how the main content panel renders on mobile, everything squashed to the left" | Real, and the cause was the rail's grid track being declared outside a media query: below 861px, where the nav is `display: none`, the content column was auto-placed into the 54px first track. Measured `mainWidth: 54`, `stackWidth: 30` at 780 and 390. The rail rules are scoped to `min-width: 861px` now. | Re-measured: one 780px track, `mainWidth 780`, `stackWidth 756`, no horizontal overflow, at 390/1024/1440; `rail.mjs` covers those widths. |
| "Still no gradient at the top of the main content panel" | See below — it was there in the stylesheet and invisible on the screen. | Below. |

### The band, measured rather than declared

The first version was correct in the stylesheet and invisible on the screen: 16% of the club's colour (`--club-wash`) fading out 132px down the column. Walking the composited pixels down the column's leading edge measured `#2a1113` at the top edge for a club playing in `#c62828` — 26 units of red over a near-black screen, which is not a gradient anybody would call one.

It now starts at `--club-soft` (26%) and fades over 200px, and because the screen header sits at the top of that band, its muted tone is lifted for it (`--text-dim: #b6c1cc` on `.page-head`): a club playing in a light colour puts the page's own muted tone at 4.31:1 against the band's top edge, under the 4.5 a small label needs, and 5.05:1 lifted.

Measured from real screenshots (`band.mjs`) — red club, 1440, down the column's leading edge:

| 1px | 33px | 65px | 97px | 129px | 161px | 193px | 225px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `#3c1415` | `#341315` | `#2c1213` | `#241012` | `#1d1012` | `#150e10` | `#0a090b` | `#08090b` |

26% of the club's colour at the top edge, monotonic all the way down, no step between samples larger than 0.07 of the tint (no seam under the header), finished by its stated 200px reach, and back to the page's own `#08090b`. The same shape and numbers at 1280 — the manager's window — and under a club playing in a light colour. The ink on the band is read from those same pixels: the header's muted label measures 6.35:1 on the band's surface `#41381d` under the light club.

Two things about the manager's screenshot of this are evidence rather than opinion, and both are recorded because they change what to do about it. At the top of the content column it reads `#0c0d0f` — the stripe texture over `#08090b`, neutral, no club tint at all — while the rail and the club-coloured command bar are both present in the same frame. That is CSS from between the texture edit and the band edit, so that window had not taken the band; a hard reload is what delivers it. The band was strengthened regardless, because 16% over near-black was never going to read as a gradient even after arriving.

### The contrast probe now samples a gradient where the text sits

The sweep composited the *first stop* of any gradient onto every element inside that gradient's stated reach, and said so: conservative, so a pass could not be a false one. That conservatism is exactly what argued for a band nobody can see — it measured a band that is 26% at the top edge against text 190px below it, where the paint is 2%. It reads the stops and interpolates now, in premultiplied space so a fade keeps its hue, and keeps the strong-stop reading for anything it cannot sample (an angle, a repeating pattern, stops without positions). Its verdict is then checked against the compositor rather than against itself: `band.mjs` reads the ink's real surface out of a screenshot and asserts the ratio directly.

### Verification run after this pass

- `npm run typecheck`: clean.
- `npm test`: 47 files, **502 tests**, all passing. `src/ui/workspaces.test.ts` is 26 tests, including a floor on the band's own reach (180px), so "a gradient is declared" cannot pass again while the band is invisible.
- `npm run build`: succeeds, 53 precache files.
- `band.mjs` (new pixel harness): **159 assertions**, 18 band measurements and 69 ink-on-band measurements over six screens — a club playing in red at 1440 and at the manager's 1280, and a club playing in a light colour. 0 failures, 0 page errors.
- `contrast.mjs`: 53 screens, **7480 text/surface pairs measured, 0 below requirement**, under both the manager's club and a light one, 0 page errors.
- `gradientContract.mjs`: the band is the only club-coloured fade anywhere, every other club-tinted gradient is flat or clipped, all 748 measured panel heads fill their panel, the primary panel head is flat, the commentary bar is flat and edge to edge, both sticky headers are opaque. 0 offenders, 0 axe violations, 0 page errors.
- `screens.mjs`: 37 assertions — the Messages frame, identical committee cards on Club and Staff, News as a paper, the workspace band. 0 axe violations, 0 errors.
- `rail.mjs`: 46 assertions at 1440/1024/860/390/320. 0 axe violations, 0 errors.
- `audit.mjs`: 117 screens, 128 assertions, **0 axe violations, 0 page errors**.
- `corrections.mjs`: 113 assertions, 33 screens, 0 violations, 0 errors.
- `matchflow.mjs`: the whole match pipeline end to end, 0 violations, 0 errors.

All of it is uncommitted, and no simulation, domain, state or save file was touched by this pass.

### Still not verified, from this pass

- The band as the manager sees it in their own window after a hard reload. The paint is proven from the compositor; the window that produced the screenshots had not taken the CSS at all.
- Reduced motion: the rail's 220ms transition is not asserted to shorten under `prefers-reduced-motion` (the earlier ceiling on transition durations is asserted elsewhere).
- Hover-open for the rail is asserted with a real pointer; a touch device with no hover is covered by the mobile layout (nav hidden, `MobileNav`), but not by the rail itself.


## Third pass — the team sheet, driven the way a manager drives it

The screen the game is played from. Four things were reported and are now the screen's own rules:

1. **A dot can be dragged anywhere, and the job adapts to the zone it lands in.** `moveSlot` writes the point into `tactics.shape` and takes the position from `positionForPoint`; the dot is drawn through the shared `diagramStyle(diagramPosition(slot))` the tactics screen uses, so the two screens are one picture of one shape. The keeper is the one exception and it is a football rule: he keeps his position and stands on his own line (`KEEPER_LINE`), with only his place across the goal his to move.
2. **Players are drag and drop, from the squad list as well as the pitch.** A name dragged onto a shirt puts the man in it; the same through the keyboard with the arrow keys; and a name is draggable by the name itself, including the `playerlink` button that opens his page, because a man is what a manager picks up.
3. **The position list includes the men already in the XI**, with a pill saying which shirt each of them is in, and choosing one swaps the two shirts.
4. **A shape can be built and kept.** It travels in `tactics.shape`/`shapeId`, is saved under a name in `customFormations` (save format v16), survives a reload, and the side is set out in it again in one click from the pitch.

### The layout the screen is now built on

- Desktop: the pitch hugs the left of the content column and is drawn from its height, the substitutes' strip is squared off against its right-hand edge with the surname under each shirt at the same size as a man on the pitch, and the squad list takes every pixel left over. At the manager's 1280×800 window that is a 355×473 pitch and a 715px list showing 9 rows (47px each, down from 99px); at 1440×900, 430×573 and 800px of list.
- The two controls that are not the eleven are on the grass: the selection's state in the top-left corner, kept in the top-right. Each opens a box over the pitch — the problems, and the shape book — and Escape or the same control puts it away. The panel between the pitch and the list is gone, and so are the heading and the two-line explanation that used to sit over twenty names.
- A phone gets the pitch across the screen with the squad list as a sheet over the bottom of it. A window too short for a team sheet at all (320×640) now keeps a 224×320 pitch and scrolls, instead of drawing an 85×113 diagram on which the eleven shirts sat on top of each other.

### Roots found, not symptoms patched

- **Nothing could be dragged at first** because `beginDrag` refused any press whose target sat inside a `button` — and a pitch dot *is* a button, so the shirt inside it took the press. A dot is now the thing being dragged, and a name is draggable even though it is a link to the man's page: a click that never moved still opens his page, and the click that follows a drag is dropped before the name can act on it.
- **Dragging a starter onto the substitutes did nothing** because a full bench refused the drop. It is now the swap a manager writes down: the substitute gets the shirt and the starter takes his place on the bench. A name from the list dropped on a substitute takes that place; a substitute's own name dropped there swaps him out.
- **Two dark rectangles appeared on the grass** because the new overlay was named `.pitch__box`, which is already the penalty area drawn on the pitch. The overlay is `.pitch__panel` now, and a browser check asserts the only two `.pitch__box` elements on the grass have a transparent background.
- **The screen went black once** after the warning glyph was added to `icons.tsx`: the dev server's module cache served the old icon module to a fresh `TeamSelectionView`, so `glyph paths` was `undefined` at render. Touching the file re-invalidated it. The served module and the source now agree; every browser run below reports 0 page errors.

### Verification run after this pass

- `npm run typecheck`: clean. `npm run build`: succeeds, 53 precache files.
- `npm test`: 48 files, **536 tests**, all passing (`teamSelection.test.ts` is 34 of them: the zone rule, the keeper's line, the swaps, the bench place, the shape book, the v16 migration, and the screen's own source contracts).
- `selection.mjs` (the team sheet driven with real pointer input): **212 assertions, 13 screens, 0 axe violations, 0 page errors** — the drag threshold, the keeper's line, the keyboard nudge, every shirt's fits-highlight, the two pitch panels and Escape, the shape book round-trip through a reload, the bench in both directions, five window sizes, and the phone sheet.
- `benchswap.mjs`: **20 assertions** on the bench as the other end of a drag — pitch→sub, starter-from-list→sub, sub→shirt, name-dragged-by-its-own-name carried with the pointer.
- `corrections.mjs`: 113 assertions, 33 screens, 0 violations, 0 errors. `audit.mjs`: 117 screens, 128 assertions, **0 axe violations, 0 page errors**. `screens.mjs` 37, `rail.mjs` 46, `band.mjs` 159, `gradientContract.mjs` 24, `matchflow.mjs` whole pipeline, all 0 violations and 0 errors. `contrast.mjs`: 53 screens, 7674 text/surface pairs, **0 below requirement**.
- `journey.mjs` still fails at the same place it failed before this work began (`getByRole('dialog', { name: 'Half time' })` times out, with the same two axe nodes), which is recorded as pre-existing and unrelated: its stored log from before this pass shows the identical failure.

### Still not verified, from this pass

- The manager's own window after a hard reload at their 1280×800 size: the geometry is measured there, but the visual read is theirs.
- Landscape phones (844×390) take the short-window fallback and scroll rather than showing a pitch and a list side by side.
- Touch dragging on a real phone: the phone checks drive a mouse pointer at phone sizes, not a finger.


## Fourth pass — the header, and the two hands on the clock

Two things were still wrong on the team sheet, and one of them was a rule about the whole game rather than one screen.

### The text under the heading is gone, and the controls are in the header

The band of facts that sat between the heading and the pitch — *Starting XI 11/11*, *Substitutes 5/5*, *Captain*, *Problems* and the phone's *The squad* button — is deleted, from the view and from the sheet. It was the only thing between the heading and the work, and on a phone it was two wrapped rows of chrome above a pitch that is supposed to be the screen. Nothing was actually lost by it: the eleven and the bench are counted by the dots themselves, the substitutes' strip says `Subs (n/5)`, and the state of the selection is the warning icon on the grass, which is where the manager is already looking.

The two dropdowns and the two buttons are now one row in the header's own action slot, at the top right:

- 1280×800 — header `[82..1252]`, `.page-head__text` `[82..263]`, `.page-head__actions` `[760..1252, y 118]`: formation at x 760, captain at 946, *Ask the assistant to pick* at 1080. `The squad` is `display: none` on a desktop, where the list is already on the screen.
- The pitch got the band's height back: **420×560** at 1280×800 (was 355×473) with a 647px squad list, and **495×660** at 1440×900 with 732px. On a 390×844 phone the header is the title plus two rows of controls and the pitch is **286×483** (was 286×417).
- `.fact` and `.fact__label` survive as the captain's label; `.fact__value` and the band's own rule are deleted with it, and `teamSelection.test.ts` asserts the class is gone from both the view and the sheet.

### The clock has exactly two hands, and neither of them is a match button

The rule the manager stated is now the rule the code keeps: **Continue and the calendar move time, and nothing else does.** The `Go to the match` button is gone from the team sheet (it was the old shortcut into `startUserMatch`) *and* from the calendar dialog, where its whole job was `jumpToDate(fixture.date)` — a third way to lose days, next to a day strip and a day jump that already reach the same Sunday.

What is left is the calendar doing its own job: pick the matchday in the month grid, `Go to this day`, and the clock lands on it with the dialog closed. Driven in a browser on a fresh career: the calendar offers no match shortcut, one month forward puts `2 August 2026` on the grid, the calendar's own jump moves the date to `2026-08-02`, and the command bar is then showing **`PLAY THE MATCH`** — the matchday's action, from `commandState`. That is the whole route to a match now, and it is pinned by two new source contracts in `uiTuning.test.ts`: only `src/ui/commandActions.ts` and `src/ui/components/PlannerModal.tsx` may touch `advanceDays`/`jumpToDate`/`continueGame`, and neither the calendar nor the team sheet may carry a `Go to the match`/`startUserMatch` shortcut.

### Verification run after this pass

- `npx tsc --noEmit`: clean. `npm run build`: succeeds, 53 precache files.
- `npm test`: 48 files, **540 tests**, all passing (`teamSelection.test.ts` 36, `uiTuning.test.ts` 19 of them).
- `selection.mjs`: 13 screens, 0 axe violations, 0 page errors. `corrections.mjs` 113 assertions / 33 screens / 0 violations, `contrast.mjs` 53 screens / 7656 pairs / **0 below requirement**, `audit.mjs` 117 screens / 128 assertions / 0 axe violations / 0 page errors.
- `journey.mjs` still fails in the same place it failed before this work began (the half-time dialog times out), recorded as pre-existing.

### Still not verified, from this pass

- The manager's own window: the geometry above is measured in a headless browser at four sizes; the visual read at their size is theirs.
- A phone in landscape, and a real finger rather than a mouse pointer at phone sizes.
