# Sunday Eleven 27 (SE27)
## Full Game Design Document — Version 1.0

### 1. Vision
Sunday Eleven 27 is a web-based football management simulation set in a procedurally generated English grassroots Sunday League ecosystem. The player is a person embedded in a persistent local football community, not merely an abstract manager.

The simulation covers clubs, players, managers, volunteers, referees, sponsors, businesses, pubs, grounds, leagues, cups, journalists, supporters, workplaces, relationships, geography, finances, administration and decades of history.

**Core promise:** create a living local football world in which believable stories emerge naturally from interconnected systems.

### 2. Design Pillars
- Authentic English Sunday League football.
- Deep simulation with optional management complexity.
- No universally optimal tactic.
- Emergent stories rather than scripted campaigns.
- The world continues without the player.
- History permanently matters.

### 3. Starting Modes
**Create a Club:** create a new grassroots club with control over identity, locality, structure and initial situation. The club takes the registration and division place of the weakest existing side but not its players. Nobody hands a new club a squad, so the manager assembles one from a starting budget: the backing the club can put up is chosen first, and he spends it on how many players to sign and roughly what standard they are — the first real decision of the career, made before it starts. Whatever is left is in the bank on day one. Reputation is not chosen but derived: it is read off the squad the money actually bought, on the same reputation-to-quality curve the rest of the world is generated from, so a club built on journeymen is a makeweight side however deep its pockets were and never a favourite with a squad that ranks bottom. The squad is generated to exactly that shopping list, with its own dressing-room relationships, and is previewed live in the designer — players and the standing they earn both — so what the manager is shown is what he signs. The badge is drawn the same way: the manager may pick the silhouette, the pattern and the symbol, and whatever he leaves alone the club is given the way any other club in the world is. The name, the year and the two colours on it come from what he has already typed.

**Take Over Existing Club:** inherit a generated club's squad, finances, leadership, ground, history, sponsors, rivalries, relationships and current circumstances.

### 4. Geography and World
The player chooses a town/village. Population and geography determine club density. A detailed county-scale ecosystem may contain roughly 150–300 plausible clubs.

Local pyramids form geographically but clubs may play in neighbouring county structures. Travel uses distance and contextual Sunday traffic and affects cost, willingness, lateness, attendance and fatigue.

Leagues can form, fold, split, merge, rename and move clubs.

### 5. Clubs
Generated clubs have coherent identities, names, histories, grounds, sponsors, people and relationships. Naming can use United, Athletic, Rovers, Town, Albion, Corinthians, Wanderers, Victoria, Rangers, FC, pubs, businesses, communities and local geography.

Club identity has inertia. Existing clubs resist arbitrary change; create-a-club provides greater control.

Persistent club history includes founding, managers, players, titles, cups, records, grounds, sponsors, rivalries and notable matches.

### 6. Governance
Club structures include chairman-led, committee, members' club, pub-backed, business-backed and community clubs.

Chairmen are persistent characters with personalities, ambitions, finances, opinions, relationships and patience. Depending on structure they may influence recruitment, tactics, finances, targets and managerial employment.

Annual AGMs cover finances, management, sponsorship, ground, volunteers, players and future plans. Leadership can change. The player may eventually become chairman where appropriate.

### 7. Grounds and Facilities
Facilities are real places rather than generic upgrade levels: home pitch, training pitch, changing rooms, clubhouse/pub, storage, floodlights, parking, equipment and pitch maintenance.

Grounds have location, ownership, surface, quality, dimensions, drainage, changing facilities, floodlights, availability, cost, capacity and weather resilience.

Ground sharing is common. Clubs can lose grounds, relocate, share, face eligibility problems or fold.

### 8. People
All significant people use persistent character data covering attributes, personality, occupation, reputation, relationships, location, history, ambitions and availability.

People include players, managers, coaches, referees, chairmen, volunteers, journalists, sponsors, supporters and officials.

### 9. Players
Typical registered squad size is 20–30.

Attributes use an underlying 1–20 scale.

Technical: passing, shooting, tackling, ball control, crossing, heading.

Physical: pace, stamina, strength, agility.

Mental: positioning, decisions, composure, work rate, determination.

Behavioural: commitment, discipline, ambition, loyalty, reliability and personality.

Hidden characteristics can include consistency, adaptability, pressure response, tactical intelligence, injury susceptibility and temperament.

Exact ability is not automatically known. Information progresses from unknown/impression through increasingly reliable estimates.

### 10. Player Life
Players have jobs and lives outside football. Occupations include trades, healthcare, education, warehousing, delivery, hospitality, office work, self-employment, study and unemployment.

Life events include work changes, holidays, weddings, stag/hen events, birthdays, family events, moving house and relationship changes.

Five-a-side is a persistent social/recruitment ecosystem. Saturday football is visible and players can move between Sunday and Saturday football.

Players can retire gradually or become coaches, managers, referees, volunteers or chairmen. Former players remain in the ecosystem.

### 11. Relationships
Relationships include friendship, best mates, respect, rivalry, feuds, resentment, manager loyalty and player loyalty. They can cross club boundaries.

Dressing-room factions include old guard, new players and social groups. They affect morale, acceptance, leadership and conflict.

Captaincy is a social role. Informal leaders and troublemakers exist.

Managers can make promises about starts, minutes, position, set pieces, captaincy, fitness support and future opportunities. Breaking promises damages trust and can spread socially.

### 12. Recruitment
Recruitment is ecosystem-driven rather than based on a giant professional-style free-agent database.

Discovery comes from word of mouth, local reputation, unattached players, trials, open training, five-a-side, recommendations, friendlies, scouting, watching matches, former players and other managers.

Trials may be single sessions, multiple sessions or friendly appearances. Trialists can surprise positively or negatively.

Poaching can create player unrest, rivalry, refusal to deal, retaliation and media stories.

### 13. Scouting
Scouts have geographic reach, specialities, reliability, relationships and reputation. Reports are opinions, not absolute truth. Personal observation provides different information from reports.

### 14. Staff
Staff include assistants, coaches, physios, scouts, secretaries, treasurers and groundskeepers. They have skills, personalities, ambitions, relationships and histories and can move between clubs.

### 15. Training
Most teams train approximately once per week for 1–2 hours. Training is built from warm-up, tactical, attacking, defending, set pieces, possession, fitness and teamwork blocks. Training affects development without magically creating ability and can be delegated.

A session belongs to a week, not to a fixture. Each week is keyed by the matchday it builds towards — and, in pre-season, by a negative week counted back from the opening fixture — so every Thursday has its own session even when the next matchday is still number one. The same key decides which session is in hand, whether it is already run, and how the plan and forecast are labelled.

### 16. Tactics
Detailed tactics are available but optional.

In possession: width, passing style, tempo, directness, crossing, build-up and attacking focus.

Out of possession: defensive line, pressing intensity, triggers, tackling aggression, compactness and offside trap.

Transitions: counter, counter-press, regroup and goalkeeper distribution.

Roles include centre-back, central midfield and striker variants such as Central Defender, Ball Playing Defender, Stopper, Cover, Deep Lying Playmaker, Box-to-Box, Ball Winner, Advanced Playmaker, Target Man, Poacher, Pressing Forward and Complete Forward.

Individual instructions and set-piece routines are supported.

### 17. Opposition Scouting
Information comes from watching, scouts, managers, players, journalists and gossip. Information is imperfect. Opponents can adapt based on observed history.

### 18. Match Engine
The engine is simulation-first. It tracks positions, possession, passing, movement, marking, pressure, tackling, interceptions, shooting, goalkeeping, set pieces, refereeing, fatigue, injuries, weather, pitch, tactics and psychology.

Players consider instructions, attributes, position, tactical intelligence, experience, confidence, fatigue, pressure, personality, relationships and match context.

Natural variance includes goalkeeper errors, defensive slips, missed chances, injuries, referee mistakes and substitute impact. Variance must not overwhelm ability and tactics.

### 19. Match Presentation
The match is a workspace, not a page. It fills the window and the page never scrolls: the score and clock hold the top, the pitch and the live feed share the middle, the statistics and the manager's controls are fixed along the bottom, and anything that needs more room — the feed, the substitution list, a squad — scrolls inside its own panel. At no point should a manager have to move the window to find out what is happening.

The pitch is drawn in two dimensions today; the visualisation is a leaf component so a simple/low-poly 3D renderer can replace it later without the shell, the feed, the stats or the controls knowing it happened. Default viewing is around 5–10 minutes, with full-length, extended highlights, key highlights and text commentary options. Cameras and speeds: normal, fast, very fast and pause.

The commentary is a presentation layer, not a transcript. The engine produces the incidents; the feed decides which of them the manager needs, gives goals, penalties, red cards and the two whistles their own treatment, drops the ordinary business behind a "key incidents" filter, and keeps a bounded window with the newest line always in view. An incident is reported exactly once: the newest is the strip across the top of the panel — the line he is meant to read without looking for it — and the list underneath carries on from there. Nothing is invented for the feed, and nothing about the match is decided by how it is drawn.

### 20. Match Controls
Everything the manager can do during the match lives in one fixed strip: pause and resume, three speeds, a shortcut to the final whistle, and tabs for tactics, substitutions, players and statistics. A change of shape or a substitute can be made without leaving the match — the pitch and the score stay where they are while he is in the panel.

Managers can change formation, mentality, tempo, passing, pressing, defensive line, substitutions, individual instructions and quick instructions.

Users can save their own tactical presets such as Normal, Protect Lead, Chasing Game, 10 Men and All-Out Attack.

### 21. Matchday
The match is an appointment in the calendar, not a mode with its own clock: the day arrives, the manager prepares, the whistle starts it, half time stops it, full time gives the week back, and the calendar carries on. The match opens in the dressing room rather than on the pitch, with the fixture, the conditions, the officials, an impression of the opposition, a team talk and a warm-up before he sends them out.

The opposition briefing is what a local manager could reasonably know — recent results, a likely shape, the names everyone knows — and is presented as an impression rather than a scout's report. Selection warnings surface what he can see for himself: a knock, a man out of position, a thin bench, tired legs. Before kick-off the XI can be changed freely, because that is selection and not a substitution.

A team talk and a warm-up are small, contextual and personal: the words land differently depending on the man hearing them, the warm-up decides what is in their legs at the start, and none of it is reported to the manager as a number.

Half time stops the clock for real. The manager gets the score, what happened, who is running on empty, who is on a booking, the full statistics, and a second team talk — the fifteen minutes are his, and he can change the team and the shape in them. The card carries its own way back out: the control bar sits behind it, and a button you cannot reach is worse than no button at all. The card is bounded by the viewport rather than by its own content, so it never runs off the foot of a phone with its buttons out of reach.

Full time is the last management decision of the day, not the delivery of a result. He sees the result, the goals, the bookings, how every man in the matchday squad played, and the statistics — and then he chooses what to say to them: praise, a measured word, a blast, an arm round the shoulder, or nothing at all. It is not a buff: it is judged against the result and against the man himself, so praising a lad who knows he had a shocker rings hollow, a bollocking after a win baffles everyone, and silence after a hiding curdles of its own accord. A couple of points of morale either way, the whole squad hears it, substitutes included, and it is said as he leaves them. What he is told afterwards is how it landed, not what the numbers were.

Matchday incorporates availability, selection, late withdrawals, opposition information, weather, pitch, attendance, referee, warm-up, team talk and kit.

Last-minute problems can require replacements.

Injuries range from knocks and strains to concussion and serious injury; severity is not always immediately obvious.

Referees are persistent characters with strictness, advantage, card frequency, consistency, fitness, communication and reputation. They can make mistakes.

Each team may provide an assistant/linesman whose competence varies.

### 22. Weather and Pitch
Weather affects pitch, ball movement, stamina, passing, injuries, attendance and postponement.

Pitch conditions include excellent, good, worn, muddy, waterlogged and frozen. Characteristics include narrow/wide, hard/soft, bumpy and poor drainage.

### 23. Match Incidents
Meaningful but uncommon incidents include missing referees, pitch inspections, missing nets/corner flags, late players, warm-up injuries, wrong kits, floodlight failure, ball over hedge, dogs on pitches, spectator confrontation, manager dismissal and substitution disputes.

### 24. Match Consequences
Matches affect league position, cups, finances, morale, relationships, reputation, recruitment and history.

### 25. Season
Calendars are league-specific. Most matches are Sunday mornings, with occasional Saturday/evening and midweek games.

Postponements arise from weather, pitches, referees, grounds, team issues and local events, producing genuine fixture congestion.

Preseason includes friendlies, trials, training, recruitment, fundraising, sponsorship, kits, AGM, registration and ground preparation.

### 26. Competitions
Leagues normally use home-and-away formats with dynamic division sizes, generally around 10–16 clubs but without manufacturing clubs to hit targets.

Promotion/relegation rules vary. Playoffs are possible where appropriate.

The League Cup is a whole-pyramid knockout. First-round losers enter a repechage/consolation cup.

County Cups use physical county eligibility. Inter-county competition provides a distinct higher-level competition. A champions competition can bring together champions of relevant local pyramids.

Cup draws are primarily random with sensible geographic weighting. Finals normally use neutral grounds and should feel like community events. Giant-killings are possible.

Cup prioritisation is expressed through selection, tactics, rotation and player management rather than a single priority button.

### 27. Competition History
Permanent records include winners, runners-up, finals, major matches, giant-killings, records, attendance, top scorers, players and managers. Defunct competitions retain their history.

### 28. Finances
Moderate financial depth.

Income: player subs, sponsorship, match income, clubhouse, fundraising, tournaments, donations, chairman investment and community support.

Expenses: pitch hire, referee fees, league fees, insurance, equipment, kits, balls, changing rooms, floodlights, transport, food, clubhouse, repairs and fines.

Clubs may use weekly, match or monthly subs, exemptions or club-funded arrangements.

Debt can cause unpaid fees, sponsor pressure, player departures, fundraising, chairman intervention, ground problems and eventually folding.

### 29. Sponsorship
Sponsors are persistent businesses and people. They can sponsor shirts, boards, clubhouse, matches and tournaments. Relationships evolve; sponsors can renew, increase, reduce, leave or move to another club.

### 30. Fundraising
Fundraising includes quiz nights, raffles, sponsored events, tournaments, BBQs, club nights, charity matches and pub events. Outcomes depend on organisation, attendance, support, reputation and relationships.

### 31. Local Ecosystem
The simulation includes pubs, workplaces, schools, five-a-side venues, businesses, Saturday clubs, Sunday clubs, supporters, journalists, referees and sponsors.

Relationships can connect player ↔ player, player ↔ manager, manager ↔ manager, manager ↔ club, club ↔ club and people ↔ workplaces/pubs/sponsors/officials.

### 32. Reputation and Gossip
Reputation is contextual, not a single global score. A manager can be known locally for recruitment, tactics, loyalty, reliability, man-management or development.

Gossip is a genuine information layer. Sources have different reliability. Rumours can be wrong.

### 33. Journalism and Social Media
Persistent journalists can attend matches, report results, interview people, cover finals and investigate controversies. Media can affect visibility, attendance, player interest, sponsorship and reputation.

Social media is a lightweight information/reaction layer, not a separate social network simulator.

### 34. Supporters
Most spectators are aggregate. Important recurring supporters, families, sponsors, former players, journalists and scouts can be persistent characters.

Attendance depends on rivalry, league position, weather, competition, local interest, reputation and kickoff. Away support follows contextual factors.

### 35. Rivalries and Friendships
Rivalries emerge from events such as repeated close games, controversies, poaching, cup eliminations and title races. Geography creates potential, not automatic rivalry.

Rivalries can intensify, fade, disappear and return.

Clubs can also form positive relationships through shared grounds, friendlies, manager friendships, player exchanges and mutual help.

### 36. Local Events
The world generates charity matches, six-a-side tournaments, preseason tournaments, memorial matches, testimonials, fundraising events, awards, club dinners, community days and pub competitions, including events the player's club does not attend.

### 37. Career
The player can remain at one club, move, apply for jobs, be approached, be sacked, become an assistant, become chairman or return to management. Other managers actively participate in the job market.

### 38. Procedural Generation
Generation must create coherent histories rather than isolated random entities. Clubs have histories, founders, grounds, sponsors, rivalries, people, achievements and problems. People have relationships, occupations, histories and connections before the player meets them.

### 39. Background Simulation
The player's pyramid receives full simulation. Nearby ecosystems receive medium detail. Other counties receive abstract simulation sufficient to maintain champions, notable clubs, results and major events.

### 40. Long-Term Evolution
Across decades clubs form, fold, reform and merge; grounds change; leagues restructure; managers move; players retire; people become staff; competitions evolve; rivalries change; sponsors change.

The world must not remain frozen around the player.

### 41. Club Folding and Reform
Clubs can fold through finances, ground loss, player shortage or organisational failure and can later reform. Former identities remain in the archive.

### 42. Mergers
Mergers preserve relevant histories of both original clubs while creating a distinct resulting club.

### 43. Archive
The archive covers clubs, players, managers, competitions, grounds, rivalries, notable matches and records. It should remain useful after decades and function like a generated local football Wikipedia.

### 44. UI/UX
The game's mark is a wordmark rather than a crest: **Sunday** and **Eleven** stacked, with **27** to the right of both words, because the world is already full of generated club badges and the game must not look like one of them. The favicon is the shorthand, **SE27**. It is the largest thing on the way in, and carries one strapline under it — **Sunday League Management** — set in caps and letter-spaced rather than written as a sentence, because it labels the game rather than describing it. The mark and the strapline are one object: the block is as wide as the mark and the strapline is spread across that same measure, so the two share both edges rather than merely starting in the same place. The strapline has no size of its own — it is four tenths of the mark's, and every other dimension of it is a share of the mark as well, which is what keeps the pair in proportion from a phone upwards and lets it hug the mark closely rather than sitting away from it at one size and colliding at another.

It is set to fill its measure almost exactly in type alone, and only then spread: whatever width the line does not use ends up in the gaps between the words, so a line that nearly fills the mark by itself leaves about a word space between SUNDAY, LEAGUE and MANAGEMENT instead of a chasm. Its line box is trimmed below the height of the type for the same reason it hugs the mark — a line box carries as much space above the caps as below the descenders, and a line of capitals has no descenders, so the strapline would float a cap's worth of nothing under the wordmark however small the gap between the two boxes is.

The **27** stands exactly as tall as the two words together, and this is measured rather than eyeballed: it is sat on the text's own baseline and dropped by exactly one line box, which is one word-size. Both of those are free of the font's metrics, which matters — line boxes at 56px and at 135px leave different amounts of room above the caps, and centring the boxes by their edges is what left the 27 sitting low.

The mark settles when the menu appears, and it arrives the way the stripe travels: drifting in from the left, one letter at a time, the season following from the right, and the strapline's words after them. The way in fills up underneath it in the same drift — the first door, the second door, the careers already saved — each following the one before by a beat, a tenth of a second apart, and that is the last of the motion. About a second in total, once, then still.

Under reduced motion nothing moves and nothing is missing: every part of the screen is simply already as it settles. That is why the reduced-motion rule is written after the animations it cancels rather than before them — at the same specificity the later rule is the one that lands, and a guard written in the wrong place cancels nothing at all.

The cards settle with `backwards` fill rather than `both`: it holds a door out of sight while it waits its turn, then lets go of it, so the hover nudge on the card is not being overruled by an animation that has already finished. Primary navigation should centre on Club, Squad, Tactics, Fixtures, World, People, Recruitment, Finances, Clubhouse and History.

One stripe runs through the game: the command bar of a club in its own two colours, and the ground behind every screen before a career starts — a photograph of a Sunday league pitch, washed into the game's greens, with that same stripe laid over it in the mark's green, the colour of the 27 beside the words. It is the same bands at the same size on the same angle in both places, and in both places it drifts steadily right by exactly its own period, one loop taking the same time on a bar as on a whole screen. The band is one `STRIPE_COUNT`th of a `STRIPE_SPAN` run, so the stripe is the same share of whatever it is drawn across and a phone gets the stripe its own bar deserves.

The dissolve is a mask, not a gradient. A run of bands that thinned and faded as it went could only loop by starting again at full width somewhere in the middle of the bar, and the eye finds that at once; so the bands are a repeating pattern held at one size, and the fade that takes them out — `STRIPE_FADE` of the strength per band, nothing left by the end of the span — is laid over the top on a box that never moves. Nothing is lost by it: the strength of the stripe at any point along the bar is the strength it always had. The same two boxes carry it everywhere, and the banded layer is drawn one period wider than its box and hung one period off the left edge, so its own edge can never walk in and open a bare strip down the side of a loop. On the pre-game screens the fade is the screen's rather than the pattern's: almost opaque at the left edge and gone by the right, so the eye starts on the game's colours and finishes on the pitch, where the cards carry their own background. It stands still for anybody who has asked for less motion. A club wears its badge wherever it is named: in the club list, the league table, its own page and the designer, so an opponent is recognised before the name is read.

The dashboard answers **What matters right now?** It should not expose every statistic at once.

Information should be drillable, for example: News → person → club → match → history.

Every table in the game sorts by any of its columns: tapping a heading orders the rows by it, tapping again reverses it, and a third tap returns the rows to the order the screen chose — which is the only useful order for some of them, such as the league table or the ledger. Sorting never changes a row's identity: a club carries its league position with it however the table is read, and empty values always sink to the bottom. On a phone the stacked cards are preceded by a strip of the same sort controls.

### 45. Delegation
Systems such as scouting, training, administration, recruitment, finances and tactical suggestions can be delegated. Delegation changes who makes decisions, not the underlying simulation.

### 46. Complexity
Simple, Standard and Deep management modes can expose different levels of control while using the same underlying simulation.

### 47. Procedural Writing
Generated news and commentary should be based on structured event data and contextual templates rather than unrestricted generic AI prose.

### 48. Incident System
Incidents use probability, prerequisites, severity, affected entities, consequences and cooldowns. Rare events should be memorable rather than constant.

### 49. Save Architecture
Saves contain world seed/state, player state, clubs, people, relationships, competitions and history. Autosave should occur at safe points. Simulation state should be serialisable and not rely on one monolithic object.

### 50. Technical Architecture Principles
Keep domain logic separate from UI.

Conceptual layers:
- World: geography, places, towns, grounds, businesses
- People: players, managers, staff, officials
- Clubs: identity, governance, finances, squads, facilities
- Football: tactics, matches, training, competitions
- Social: relationships, reputation, gossip, networks
- Simulation: time, AI decisions, world events
- History: permanent records
- Presentation: React UI, 3D match view, maps and notifications

Prefer composable services and reusable domain models. Avoid hard-coded club-specific mechanics and unnecessary rewrites.

### 51. Non-Goals
Sunday Eleven 27 is not a professional Football Manager clone, financial spreadsheet, RPG skill-tree game, card collector, social-media simulator, scripted career story, arcade football game or constant comedy simulator.

### 52. Core Loop
**Observe → Decide → Act → Match → Consequences → Relationships → History**

A typical week is free-form: review the situation, manage availability, talk to people, recruit, train, scout, select, play, react, manage consequences and continue. There is no mandatory checklist.

Time moves in exactly two places: the command bar's advance button, which always names what it will actually do — continue the week, run the session, play the match — and the calendar, where the manager can pick a day himself. Those are the only controls that move the game on. Every other button in the game is a door to a screen: the overview above all, which may describe what is happening but never offers a second way to continue, run the session or kick off. A screen can therefore never be the thing that quietly advanced the week.

The game speaks from the corner of the footer. What just happened — the session was run, the day moved on, a player is back in training — arrives as a small bubble off the game's own mark, the same favicon the browser tab wears, so a line reads as coming from the game rather than from the page it lands on. It says its piece and goes of its own accord, on a clock that scales with how much there is to read, because a message you have to dismiss has become work. Errors are the exception: something that has gone wrong is not a passing remark, and it stays in the page until it has been acknowledged.

### 53. Emergent Story Target
A player recommendation can lead to a signing, friendship, injury, replacement performance, dressing-room conflict, media story, chairman intervention and later historical significance. The systems should produce such chains without scripting them.

### 54. Development Strategy
The full game must be built as validated vertical slices rather than one enormous implementation.

Recommended order:
1. Technical foundation
2. World/geography
3. Club generation
4. People/relationships
5. Squad/player simulation
6. Match simulation
7. Tactics
8. 3D match presentation
9. Weekly/season progression
10. Competitions
11. Finances
12. Recruitment/scouting
13. Social ecosystem
14. Governance
15. History/archive
16. UI refinement
17. Background simulation
18. Long-term evolution
19. Edge cases
20. QA/balance

Each stage must preserve working systems and be tested before the next layer.

### 55. Prototype Target
The first playable prototype should prove the central fantasy with a generated local area, several fictional clubs, players with attributes and relationships, one playable club, squad selection, basic training, basic recruitment, one league, fixtures, basic tactics, simulated/playable matches, simple 3D presentation, weekly progression, basic finances, basic news/events and persistent history.

It should prove that believable grassroots stories can emerge before the broader ecosystem is added.

### 56. Final Principle
The game should never ask what scripted content happens next.

It should ask:

> **Given everything that has happened, what would plausibly happen next?**

The backbone is:

**Person → Relationship → Club → Place → Competition → Event → History**

Sunday Eleven 27 is a simulation of a living local football community, not a database of football matches.
