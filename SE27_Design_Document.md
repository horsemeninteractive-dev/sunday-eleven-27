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

The engine is simulation-first. It tracks possession, passing, movement, pressure, tackling, interceptions, shooting, goalkeeping, set pieces, refereeing, fatigue, injuries, weather, pitch, tactics and psychology.

**There are two modes, and the fixture decides which one it gets.** The full engine is the football the manager watches: the spatial simulation, the ball, the movement, the set pieces, the commentary and the replay. It is expensive — about a second a match — which is nothing for the one game he is looking at and everything for the forty that he is not. Those run in a second mode: a background abstraction that walks the match a minute at a time, taking a shot, a foul, a booking or a knock from the same team strengths, the same tactics, the same conditions and the same player attributes, and writing the identical record — the score, the goalscorers and assists, the cards, the knocks, the substitutions, and the per-player statistics the season accumulates. It renders nothing, narrates nothing and moves nobody, because nobody is watching it; that is precisely why it is fast.

**The two are an abstraction of one football world, not two games.** They are handed the same lineups and the same environment, they judge a side with the same `computeTeamStrength` and `tacticalProfile`, they roll knocks with the same `pickInjury`, they draw from the same seeded RNG and they write the same `Match` contract — `result`, `events`, `performances`, `possessionTicks`, `substitutions`. Everything downstream is mode-blind: the league table, the cup, the finances, the suspensions, the record books and a player's career all read the record rather than the simulation, so a season does not depend on which fixtures the manager happened to watch. The full engine remains the authority for a watched match and is neither replaced nor simplified; the fast mode is a second way to *play* a fixture, not a second football. `npm run benchmark` times the two against the same fixtures and prints their fingerprints side by side, which is how the calibration is kept honest.

**A minute is a run of possessions, not a question.** The engine used to ask, once a minute, whether a shot happened, and choose a shooter separately from that. The ball was therefore nobody's, and the incidents it produced were not connected to one another — plausible football that was not football. It now plays the game: a minute is divided into *possessions*, each of which is a run of decisions made by a named player, at a place on the pitch, against defenders trying to take the ball off him. How many possessions a minute contains is not fixed. It falls out of how long each one took, which is why a side knocking it about and a side thumping it long do not get through the same amount of game.

**The ball is a decision, then an interaction.** A player with the ball weighs what to do — play it, carry it, take his man on, put it in the box, have a go, switch it, thread it through, shield it, clear it — against where he is standing, how hard he is being closed down, who is available, what he is good at, how tired he is, what the manager has told him to do and what the score is. A centre-back on the edge of his own box with a striker on him very rarely tries to play out; the same man in space in midfield very rarely launches it. The weights are football reasoning rather than probability dials, which is what makes them arguable, and most of them are scaled by the attribute the action actually uses.

**A pass is an attempt with a destination.** Its difficulty is the distance, the angle and the pressure; its ability is the passer's passing, decisions and composure. A ball that does not arrive becomes an interception, a loose ball or a throw-in, and it turns the move around. **A defender is a participant, not a penalty on a probability**: a challenger goes in based on who he is and what he was asked to do, the duel turns on tackling and strength against control and agility, and a mistimed one is a foul. That is where bookings come from — a side that keeps losing the ball gives them away trying to win it back, and a side that never has it cannot foul at all.

**A chance is built, and finishing is three separate things.** A shot is the end of a move that got somewhere. How good the opportunity is comes from the move; what the player does with it comes from his finishing, his composure and the pressure on him; whether it goes in comes from the keeper. A great chance for a poor finisher and a half-chance for a good one are different events with different probabilities, and the statistics follow the football rather than estimating it: goals are always among the shots on target, and the shots on target are always among the shots. Corners, free kicks, penalties, throw-ins and goal kicks are passages of their own, generated by what happened — a blocked shot is a corner, a foul in the box is a penalty, a foul twenty-five yards out is a free kick somebody can have a go at.

**The simulation keeps its own small picture of the game.** A ball with a position and an owner, three lines of shape per side, pressure, the counter-press count and the current phase — build-up, progression, final third, chance, transition, set piece. This is not a second spatial renderer: it is what the next decision is made from, and it exists whether or not anybody is watching. Tactics move it rather than multiplying rates — a direct side clears its lines, a short-passing side recycles, a high line is a high line — and so do fatigue, the scoreline and the clock: a side chasing two goals in the last ten minutes pushes up and leaves space behind it, and tired legs cannot hold a line or close a man down. Home advantage lives here too, as a crowd and a familiar pitch, showing up as a pass finding its man and a fifty-fifty going your way rather than as a thumb on the scoreline.

**Presentation cannot change the football.** The watched match also carries a much richer spatial state — twenty-two players with a position, a previous position, a target, a speed and an action, and a ball that is at somebody's feet, travelling or loose — and that layer is handed the passage the minute produced and nothing else. Players walk toward the target they were given rather than appearing at it, and the ball takes time to go anywhere. It is advanced in fixed steps from real time, carrying the remainder, which is what makes it frame-rate independent without a frame-rate-dependent rule anywhere in it. Only a match somebody is watching gets one; the rest of the division is played out a minute at a time and never needs to know where anybody stood. The state is rebuilt from the lineups if it is missing, so a save written before the pitch existed grows one on load, and it follows substitutions and sendings-off because it is told who is on the pitch rather than assuming.

Everything is drawn from `(match.seed, half, minute)` streams rather than a mutable generator, with the narrator and the spatial layer on streams of their own, so a fixture replays identically from any starting point, a mid-match decision genuinely changes what happens from that minute on, and no sentence or animation can move a shot.

Natural variance includes goalkeeper errors, defensive slips, missed chances, injuries, referee mistakes and substitute impact, and it emerges from the same interactions as everything else — a poor keeper really does concede more, rather than being a modifier on a goal roll. Variance must not overwhelm ability and tactics: a clearly better side wins most matches and almost never all of them.

**The balance is read, not guessed.** `npm run balance` (the tool in `tools/balance.ts`, wired as a script so it cannot rot) builds a scenario, plays a seeded sample of it — hundreds of matches by default — and prints the distribution rather than a scoreline: goals and their spread, shots and how many hit the target, possession, passing and completion, fouls, cards, offsides, corners, tackles and interceptions, the mix of actions players actually chose (read from the simulation trace, so it is what the engine did rather than what it was asked to do), and the common scorelines. Scenarios are normalised — both squads set to the same ordinary rating, both given plain instructions — and then move exactly one thing: even quality, a moderate gap, a wide gap, the gap with the better side away, a neutral venue, and one instruction changed at a time. There is also one untouched generated world, which is the only scenario read against a band of what a real Sunday League afternoon looks like. The bands are deliberately loose and stated as *places to look* rather than targets, because a scenario outside one is a question, not a failure. The first time it was run it did its job: it showed that a quality gap barely moved the scoreline at one or two points and then exploded into a procession at six, and the trace pointed at the reason — the defending side's quality was not in the passing model at all, so a well-organised side took nothing away from a passer. Wiring the defence's rating into pass difficulty flattened that curve: the moderate gap became a real edge and the rout became a game.

### 19. Match Presentation
The match is a workspace, not a page. It fills the window and the page never scrolls: the score and clock hold the top, a team sheet runs down each side of the pitch, the current commentary is a bar directly beneath it, and the statistics and the manager's controls are fixed along the bottom. The two columns the pitch does have are the elevens themselves — who is out there, in the order they were picked — because a name beside a shape is worth more than an empty margin; everything else that used to sit beside the match scrolls inside its own panel or behind a tab. The dressing room, half time and full time are cards over the top of the match rather than columns beside it, so they never cost it a pixel either. At no point should a manager have to move the window to find out what is happening.

Two strips carry the two clubs. The thin line across the top of the header is split down the middle — home colour on the left, away on the right — and the commentary bar is tinted and striped in the colour of whichever club the current line is about, so whose passage it is reads before the sentence does. A line about nobody in particular, a whistle or the weather, is left plain.

The pitch is drawn in two dimensions today; the visualisation is a leaf component that reads the simulation's own positions and ball and does nothing else with them, so a simple/low-poly 3D renderer can replace it later without a line of football changing — the same authoritative state is there for it to draw. The 2D view interpolates between the step a player was at and the step he is at, which is what makes movement look continuous without the simulation having to run once per frame: the renderer smooths, the simulation decides. Default viewing is around 5–10 minutes, with full-length, extended highlights, key highlights and text commentary options. Cameras and speeds: normal, fast, very fast and pause.

**Normal speed is a pace a match can actually be followed at.** It is not a number that felt about right; it is the one pace at which the pitch runs at true speed. A minute of football is played out over a fixed six seconds of movement, so giving that minute six seconds of real time is the setting at which a player's legs move at the speed the simulation gives them, a pass is struck at the speed a pass is struck, and a move can be watched rather than decoded. Everything above it divides that same minute rather than changing it — 2x, 4x and 8x put the same passages through in less real time, and the engine is handed identical football at every setting. A whole afternoon therefore takes about ten minutes at normal, which is what the presentation budget always said it should, and a couple of minutes at the top of the ladder. The pace lives in one place, `src/ui/matchPace.ts`, because two screens need the same answer: the clock that pumps the match, and the commentary bar that paces a minute's lines against it.

**A goal stops being football for a moment, and the pitch says so.** The instant the ball crosses the line the pitch hands over to the celebration: the scorer breaks away toward the corner of the goal he has just scored in, his own team chases him down and rings him one by one, the side that conceded walks back for the kick-off, and the keeper stays where he is because a keeper sprinting the length of the pitch is the one thing that would read as wrong. The ball stays in the net where it belongs, and when the celebration has run its course it is sent back to the centre spot — travelling there, never jumping, because nothing in this layer may cross the park between one step and the next. It is presentation state on the pitch and nothing else: the score was settled by the engine before any of it began, and a minute's move is dropped rather than played into the middle of the huddle, so the picture never lags the words. The narrator says it as well as shows it: a goal is followed in the same minute by the celebration written out — the scorer buried under his own teammates, nobody in a hurry to restart — and those lines claim no outcome of their own, name only the scorer and his own club, and draw from the minute's own commentary stream, which is why a word about a corner flag can never move a shot.

A match is watched, not read. The live screen shows **one** line — the current commentary — and no list at all: the manager looks up from the pitch and sees what is happening now, without a transcript scrolling beside it competing for the same attention. The line is set large and centred in its bar, dressed by how much it matters, and a goal flashes — the one thing in a match that should be impossible to miss. The minute is not repeated in the bar: the clock is already at the top of the screen, and spending the line's room on it buys nothing. The lines a single minute produces are paced out as that minute is played, so a move reads as a move rather than appearing whole. That pacing is presentation only: the clock and the football still come from the engine, and nothing on screen creates a second match time.

Behind the one line there is a whole afternoon. The engine writes a transcript as it plays — the passage each minute actually plays is written out step by step, and the ordinary traffic of the game is told in the minutes between — and it is kept on the match itself, so it survives a save. The live screen consumes it one line at a time; the Commentary tab and the match report read it whole, in order, with goals, cards, injuries and the two whistles picked out and everything else available underneath. The report is deliberately richer than the live screen: what was a single line at the time becomes the passage that produced it when it is read afterwards. Nothing is invented at either end — the engine decides the football, the commentary decides only how to say it, and a line can never announce an outcome the simulation did not reach.

### 20. Match Controls
Everything the manager can do during the match lives in one fixed strip: pause and resume, three speeds, a shortcut to the final whistle, and tabs for tactics, substitutions, players, commentary and statistics. The commentary tab is the deliberate view — the full transcript, and only then. A change of shape or a substitute can be made without leaving the match — the pitch and the score stay where they are while he is in the panel.

Managers can change formation, mentality, tempo, passing, pressing, defensive line, substitutions, individual instructions and quick instructions.

Users can save their own tactical presets such as Normal, Protect Lead, Chasing Game, 10 Men and All-Out Attack.

### 21. Matchday
The match is an appointment in the calendar, not a mode with its own clock: the day arrives, the manager prepares, the whistle starts it, half time stops it, full time gives the week back, and the calendar carries on. The match opens in the dressing room rather than on the pitch — a card over it, with the fixture, the conditions, the officials, an impression of the opposition, a team talk and a warm-up before he sends them out. It behaves like the other two intervals: it can be put down to look around the pitch and brought back, and the whistle is in its own footer.

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

A rearranged match must be played within the season: there is a deadline eight weeks past the last scheduled Sunday, after which the league abandons the fixture on the record rather than shuffling it forwards indefinitely. Without that bound a wet winter can rearrange one game for ever and the season never closes.

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

**Status note (from the multi-season soak).** Club agency is arriving. The
**managers' market** (`src/simulation/managers.ts`) gives managers a life at the
season boundary — they age and retire, step down, lose their jobs to a poor
finish, move to a bigger local club, and are replaced from a pool of men between
jobs, from within the club, or by a player-manager. **Clubs fold and reform**
(`src/simulation/clubLifecycle.ts`) when the money runs out, replaced by a new
club in the same town so the division holds its size. And **squads refresh**
(`startNextSeason`): a youth intake each summer plus a squad cap that releases
the oldest, so the league no longer ages in lockstep — the median age settles in
the mid-twenties instead of rising eight years over fifteen.

What the world still lacks is *buying and selling*: clubs never sign or release
for football reasons, never react to a rival's strength, and never change how
they play. Those are the loops that still leave the unattached pool growing and
ability slowly inflating, and they are the work of §§39–42 — which has to come
*with* the pyramid rather than after it.

### 41. Club Folding and Reform
Clubs can fold through finances, ground loss, player shortage or organisational failure and can later reform. Former identities remain in the archive.

**Status note.** The financial half is in (`src/simulation/clubLifecycle.ts`): a club in the red goes into administration, a club that cannot get out of it folds and leaves the world, and a newly formed club takes its place in the same town so the division holds its size. Ground loss, player shortage and organisational failure as *causes* of folding are not modelled yet, and the new club reuses the old club's ground and a fresh committee rather than being a reformation of the old identity.

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

Commentary is written from the simulation's own facts and never from a second, hidden one. A line may name a player only if he was on the pitch for that side, and may describe an outcome only if the engine reached it. Wording is varied from banks of templates so two matches do not read alike, and the narrator keeps a short memory between lines — the player who receives the ball is the player who carries it next — so a passage stays coherent instead of jumping between unrelated names. The engine draws its prose randomness from a stream of its own, named for the minute: adding a sentence can never move a shot, a card or a goal.

The rule that makes this hold is that the words and the pitch are **the same passage, told twice**. The engine plays the minute's football — a run of possessions, decided by the men on the ball — and then a single *passage* is planned from what those possessions actually did: who already has the ball, who it was played to, and any shot the engine has already resolved. The names in it are the names the possession model used, so the prose, the picture and the statistics are three readings of one afternoon. That plan has two readers. The spatial layer plays it out on the grass; the narrator turns its steps into sentences. There is no second cast and no second story, so a line cannot describe a pass nobody made or a move the pitch is not making. Turning the speed up runs the same passages faster rather than different ones.

Only the move the minute *ends* on is handed over, and only that side's own players may appear in it, so a line can never name an opponent. A pass the ball makes is a pass the record already counts: the men credited with moving the ball on are the men who play it in the passage. Nothing is fabricated in either direction.

### 48. Incident System
Incidents use probability, prerequisites, severity, affected entities, consequences and cooldowns. Rare events should be memorable rather than constant.

### 49. Save Architecture
Saves contain world seed/state, player state, clubs, people, relationships, competitions and history. Autosave should occur at safe points. Simulation state should be serialisable and not rely on one monolithic object.

### 50. Technical Architecture Principles
The renderers are leaves. Nothing in the 2D pitch, and nothing in the 3D pitch that will replace it, decides what happens on the field: both read the same authoritative spatial state, which the simulation alone advances. If a visual effect needs something the state does not carry, the state grows a field — the renderer does not start inferring football.

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

### 56. Presentation and Preferences
The game carries a version number and says so out loud — `Sunday Eleven 27 v0.1.0 beta`. The number is semantic and single-sourced: `package.json` is the only place it is written, Vite hands it to the code as `__APP_VERSION__`, and one small module reads it back, so nothing can drift. A version whose major number is still zero is a beta by definition, and the word is worked out from the number rather than typed beside it — promote the version and "beta" retires on its own. It is shown quietly, as a line under the way in and a line in the settings menu, because it is a fact about the build and not a headline.

The changelog is a file, not a screen. `CHANGELOG.md` is kept in the usual Keep-a-Changelog shape so that it reads well in the repository, and the dialog is given that same file to render rather than a second copy of it. The parser understands only the few marks the changelog actually uses — headings, list items, paragraphs, bold and web links — and leaves everything else as ordinary text, so a link that is not a web link is never turned into one. The first version in the file is marked **this build**, which is the line a manager actually wants: what has changed since he last looked.

Preferences belong to the manager, not the platform. Reduced motion is a three-way choice — follow the system, always reduce, always allow — because someone who has asked his operating system for stillness and someone who wants this one menu to move are both reasonable, and the game must be able to overrule the system in either direction. The choice is written onto the document as an attribute on the root element and the stylesheet keys off that attribute: every `prefers-reduced-motion` block is paired with an equal rule for the explicit setting, and both are written **after** the animations they cancel, because at the same specificity the later rule is the one that lands. Fullscreen is kept honest by listening for the real `fullscreenchange` — Escape leaves it the same way it was entered and the button must follow — and the preferred match speed is clamped to the speeds that exist rather than rejected, so a stored value can only ever resolve to something playable.

A career remembers its manager. The details typed on the way in are kept in the browser under the manager's own name and birthday and offered back as a row of chips, so a second career can begin without retyping them; the most recent details win, the number of careers is counted, and the list is de-duplicated and never throws when the storage it reads has been corrupted. It is a convenience and not a gate: the fields stay editable and nothing must be saved.

The way in is also where the smaller things live. The most recent save is first in the list, because the save a manager wants is almost always the one he just made; the utility row gathers Preferences, Managers, Changelog and Credits beside the game's own version line, so none of them needs a screen of its own. Credits name the people and the debts rather than the software alone, because a grassroots game owes a visible one to the era it is imitating.

Inside a career the header carries a settings control where a save button used to be: one glyph, one menu — save to a local slot, load one, open the preferences, read the changelog, or leave for the main menu, with the version and a reminder that leaving does not cost the career. Save, load and the way out are the same act, and giving them one door leaves the header holding one control instead of three. On a phone the control sits in the head bar and its menu opens **below** its trigger and inside the viewport; the menu is bounded in height and scrolls within itself, so it can never open off the top of a small screen.

### 57. Final Principle
The game should never ask what scripted content happens next.

It should ask:

> **Given everything that has happened, what would plausibly happen next?**

The backbone is:

**Person → Relationship → Club → Place → Competition → Event → History**

Sunday Eleven 27 is a simulation of a living local football community, not a database of football matches.
