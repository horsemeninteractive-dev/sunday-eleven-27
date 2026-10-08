# Changelog

All notable changes to Sunday Eleven 27 are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [semantic versioning](https://semver.org/spec/v2.0.0.html).

The game is a **beta**: while the version starts with `0`, features arrive in
the minor number, fixes in the patch, and the save format is still allowed to
move (any save from an older build is migrated forward on load). `1.0.0` means
it is finished. This file is also the changelog inside the game, reachable from
the main menu.

## [0.10.0] - 2026-10-08 — the man in the other dugout and the ladder that pays

### A ladder that pays the clubs that climb it

**Reputation was a fact about the day the world was generated.** Only going into administration could move it,
so a club could be promoted three times and the county's opinion of it would not budge: the rungs of the
ladder were held up by their members' standing, and nothing ever climbed. That is what made a career feel
flat at the top — the football changed division, the club did not.

**A season now moves a club's standing, from three ideas and no more.** `src/simulation/standing.ts` runs at
the season boundary, once the final tables are the archive and the ladder's movements are known. A finish is
read *against expectation*: order the division by standing and that is what the county thought each club was
worth before a ball was kicked, so finishing six places above your own standing is worth a couple of points
and finishing where the county put you moves nothing at all — which is what keeps the model honest, because a
club that keeps winning keeps climbing until its standing catches up with its results and then stops.
Promotion and relegation are worth more than a place or two, because they are not opinions; and a promoted
club whose standing is still far below the division it is joining is lifted towards that division's company,
because a rung of the ladder is a level of football and the club plays there next season whatever the county
used to think. It is bounded and slow — two points from a finish, three from a division, eight from a
promotion summer, clamped to the county's own 8–90 scale — so sixteen seasons of good management build a club
up and one bad season does not undo it.

**And it closes a loop that had been open since the first season.** Standing is what a summer's arrivals are
generated at, what the sponsorship tier reads, what a scout's reach and a manager's quality are drawn from,
and — since the last release — what a club's football identity is derived from. A promotion therefore buys a
better class of player and a different idea of football, not merely a different fixture list, and a club that
slides does the opposite. Nothing new is stored: `club.reputation` is the same field the world generator
wrote, so a career saved before this starts moving from its next boundary. `npm run soak` gained `standing`
and `standvar` columns — the mean and the spread of what the county thinks of its clubs — so the ladder's
widening or closing is a number in the report rather than an impression from year twelve.

### The man in the other dugout, and the jobs his system asks for

**Every AI club had instructions and no manager.** The county went into a season with a tactics block that had
been rolled once in August and was never looked at again: for ninety minutes a side did what it had been told
to do in pre-season and nothing at all about the scoreline, the clock, a sending-off or a tiring midfield.
Selection was the eleven best positional fits — the men with the highest rating for the shirt they were
standing in, whatever the manager had asked them to do — and the table that says what a *role* values,
`attributeFocus`, was read by nothing in the game, so a job could never decide who was picked for it. This is
the layer that puts a man in the other dugout.

**A club's football is derived from the club rather than stored on it.** `simulation/ai/style.ts` reads a
club's standing and its own instructions and returns an identity: the football it plays, how much of the game
its manager wants played in the other half (`ambition`), how readily he abandons a plan that is not working
(`flexibility`), and a phrase for the scouting line. Nothing is saved and nothing is migrated, so a career
written before this wakes up with the personality it always had, while the opening instructions a generated
world hands out are now drawn *from* standing: the sides with the players have a go, and the sides without
them make themselves hard to beat and get it forward. The extremes were trimmed after measuring — the first
cut had a quarter of the best sides setting out very attacking, high and fast from the first whistle and took
the watched engine to twenty-five shots a match against the background model's seventeen, which is two
resolutions of one football drifting apart. The tails of that table stay in the drawer until a manager is
losing and reaches for them.

**The same manager sits in the same dugout whichever resolution plays the fixture.** `simulation/ai/manager.ts`
is judgement and nothing else — no ball, no engine state, no dice — and both resolutions call it. He goes for
it when he is behind late, and further and sooner if he is ambitious; he drops deeper, slows it down and stops
pressing when he is winning; he takes the point when he is outclassed, level and nearly out of time; and a
sending-off rearranges the whole approach whatever the clock says, because ten men do not press high. His
substitutions are his plan: a hurt man comes off whenever it happens, tired legs and a poor afternoon come
off, and the change he makes is the right *kind* — chasing a game is a forward, protecting one is a defender,
a merely tired side gets the best like-for-like man on the bench, and a keeper's shirt only goes to somebody
who can keep. In a watched match the instruction change is written into the record as it happens, so the
commentary can say that a side has dropped deep; in the background model the same review runs nine times a
match and recomputes that side's share of the ball and of the chances, so a decision taken at seventy-two
minutes is felt from that minute rather than from the next kick-off.

**Roles now decide who is picked, and both resolutions read the same table.** A position's ordinary job comes
first and its specialisations after it, and a specialisation has to suit the man *better* than the ordinary
job before it is used — so a balanced side still turns out ordinary footballers, a direct side sends out the
target man it actually has, and a positive one sends out its poacher. Suitability for the job moves a
selection by about seven per cent and never outweighs being the better footballer; the bench covers the shape
the side is really playing rather than a fixed list of positions, with the keeper always named; and the
abstract resolution reads the role table too, normalised to a mean of one, so a role changes *who* gets on
the end of a move and never how many chances a side makes.

**Measured, not asserted.** The suite gained two files and twenty-eight tests: identity, reactions, bench
decisions and role-fit readings at the unit level, and the consequences at the level a manager would notice —
the same eleven told to go for it take about forty per cent more shots than the same eleven told to sit on it
in the background model and more than they did in the watched one; a side that passes it short keeps more of
the ball; the same centre forward scores more often as a poacher than as a target man; an AI side two up with
ten minutes left ends the match deeper than it started, with the change on the record; and a human manager's
own instructions are never rewritten, not even when he has handed the afternoon over. `npm run benchmark`
puts the two resolutions at 18.8 and 17.5 shots a match against 16.7 and 18.9 before, and 2.67 and 2.56 goals
against 2.72 and 2.28 — closer to each other than they were. The whole layer costs about eight per cent per
background match, which is three milliseconds on a card of eighteen fixtures. Deliberately not here yet: a
positional reshuffle when a side goes down to ten (the approach adapts; the shape is left alone), a manager
who picks his formation from the players he has rather than the one he prefers, individual set-piece takers —
and anything resembling a manager personality or a job market, for which this layer is the foundation.

### A fixture printed as a fixture sheet, and one fact a screen at display size

**The largest type in the game was the name of the screen it was on, and nothing on a screen was
larger than the screen itself.** Measured across the nineteen career screens, seventeen of them were
led by the page title at 26 pixels and every other line sat between 13 and 15, so a squad list, the
treasurer's book and a fixture list were read at one size in one voice — and the things a football
game is *about* had no size of their own at all: a scoreline, a league position, the money in the bank
and how many men are turning up on Thursday were the same size as the word beside them, or a tile the
same size as three other tiles.

**There is one display size, and it is spent once a screen.** `--fs-display` is declared once among
the tokens and given its value by the room (`data-archetype`), so a screen cannot invent a sixth size,
and `FocalFact` in `ui/components/hierarchy.tsx` is what spends it: the letterpress label over the
fact, the fact at display size, a line of plain words saying what it means, and all of it on the rule
below the screen's own name. It is deliberately not a tile, because a tile is a small box scanned
among its peers and this is the opposite. Three screens have one — the league position, the balance in
the bank, and who is coming to training — and the rest do not, which is the point of it: a screen whose
fact is a picture, a list or a person does not need a number invented for it to have a focal point.

**A fixture is printed the way a fixture sheet prints one.** `FixtureCard` was a row of labelled facts
— the competition, two clubs, and a line of small print — which is the shape of a record rather than
of a fixture, and it is now the paper a fixture is printed on: the competition and the round as a
letterpress across the club's own band (the same `--club-band` the top bar's fixture already wears),
the two clubs at the size of a name with their own badges, our own half named in the club's readable
ink, the score at the size of a score, and the conditions — the day, the kick-off, whose ground it is,
the surface, the weather, the capacity — as the small print under a rule at the foot. Nothing was
added to it. Every line is a field the fixture already carried, put where a fixture sheet puts it,
which is the whole difference between a fixture and a row of data about one. The same board is drawn on
the dashboard, in the cup and on the match screens, so a fixture looks like a fixture wherever the
manager meets it.

**A month of fixtures is a page of a fixture list**, so its summary is set in caps and tracked out with
what has been played and what is to come beside it, and the month the manager is in — the one holding
the next game — is painted with the season's own club edge. That edge had no meaning in the
competition rooms at all before: `level="primary"` answered nothing on Fixtures, the League or the Cup,
and now it paints the one panel that matters with the same 2px rule the football rooms already used.

**The squad list is a team sheet.** `squadOf` sorted a squad by the four group *codes* compared as
strings — DEF, FWD, GK, MID — which put the goalkeepers third in a list of a football team, scattered
the lines, and agreed with no other screen in the game. A squad now reads keeper, back, middle, front,
by the same `positionRank` the selection screen has always read one by, so the two lists cannot
disagree about what order a squad is in. The list is ruled off in four letterpress bands —
Goalkeepers, Defence, Midfield, Attack — drawn only while it is in the side's own order, because
sorted by goals the bands would scatter keepers through the attack and a band that lies about the list
is worse than no band at all.

**Tactics has this week written under the board.** The most visual screen in the game had nothing to
say about the match it was preparing for. The caption under the picture names the opponent and where
the game is, the day and the kick-off, and the pitch and the weather the instructions are answering —
a deep line is a decision *for* a heavy pitch — so the two now sit on one line rather than three
scrolls apart.

**Verified in the browser rather than described:** fifty-nine checks across eighteen screens and the
match report, with the type read off the layout the browser actually produced. The dashboard's largest line is the score on the
board at 40 pixels; the league position and the balance are 36 and the training attendance 40, each the
largest thing on its own screen and the only thing at display size on it; the board's stamp is the
club's own band (`rgb(0, 82, 72)` for the club measured); the squad bands come out Goalkeepers,
Defence, Midfield, Attack in the side's own order, and go away when a column is sorted; the tactics
caption reads the fixture's own conditions; a month of fixtures reads `August 2026 · 0 played · 3 to
come` with the next game marked in the club's colour. On a 390-pixel phone the board stacks its two
clubs, the score comes down to 26 pixels and a focal fact to 26, and the dashboard scrolls sideways by
nothing at all; and four screens — the dashboard, the squad, the tactics and the fixtures — are clean
to axe at the same time.

### The goalkeeper's shirt can be dropped on, and a defender can be stood deeper

**The one dot on the pitch that could not be aimed at was the goalkeeper's, and the one direction a
defender could not be moved in was backwards.** Both were the same mistake in the picture. The mapping
that turns a drop into a pitch position floored the point into the deepest row an outfield man may
stand in, and the keeper does not stand in a row of the outfield at all: he is drawn on the goal line,
behind the defence, in a row of his own. So a drop read through that floor could never be nearer his
shirt than a centre half's, and the bottom of the pitch had no rows left for a defender to be pushed
into.

**A drop is now read off the picture rather than off the pitch.** Where the finger is, as fractions of
the pitch box, is compared with where each shirt is actually drawn (`pitchPointerFraction` and
`nearestDrawnSlot` in `ui/tacticalDiagram.ts`) — the space the manager is looking at, and the only
space the keeper is reachable in. A dot let go *on* another man's shirt is the two of them swapping:
the arriving man takes the shirt and the man in it takes his, with the roles and the shape untouched,
and the shirt being aimed at is marked while the dot is still in the air, with the label over the
grass naming the man — `Swap with Sheldon`. It is deliberately the same edit the squad list makes when
a name is picked for a shirt, so the two ways of asking are one rule rather than two that can drift;
and the departing man keeps his own answer to whether he is out of position where he already stands,
instead of being marked for the job the other man left.

**The reach is short on purpose, about the footprint of the dot.** A drop that lands in the goalmouth
but not on the keeper still only moves a defender, and `outfieldOnly` still means no zone in front of
goal makes anybody a goalkeeper — so a keeper is still never lost to a mis-drag, only to a deliberate
drop on his own shirt, in either direction. A name dragged out of the squad list reaches him the same
way.

**A defender can be stood on the six-yard line.** `OUTFIELD_LINE` in `domain/positions.ts` is the
deepest row a man in front of the keeper may hold, and the picture draws it and every rule clamps to
it, so a centre half dragged right back is drawn standing in his own six-yard box — 82.1% down the
picture rather than the 76.3% the drawing used to stop at — while staying strictly in front of the
keeper's own row at 93.9%. The floors inside `moveSlot` are now those picture numbers rather than a
second set, which is what keeps the rule and the drawing from disagreeing again, and it closes a bug
the old pair hid: a defender nudged past the outfield floor was clamped to a point the picture drew on
the keeper's row, so two presses of the down arrow stood him on top of his own goalkeeper.

**Measured in the browser**, on a career picked by the assistant. A dot carried over the keeper's
shirt marks it, names him and swaps the two on release, in both directions, with the shape untouched
and exactly one goalkeeper in the side throughout; a name dragged out of the list onto his shirt puts
that man in goal; a defender let go on the goal line stands on the six-yard line as a centre half with
the keeper untouched; and three presses of the down arrow leave him there rather than on the keeper's
row. The picture's own numbers are held by tests, including one that walks every formation and holds
the two closest shirts further apart than a reach: a drop that could land within reach of two men
would make a swap depend on which of them the manager happened to be nearer.

### Every table in the game opens on the column it was left sorted by

**Every table here sorted by its columns and forgot the moment the manager walked to another screen.**
Nine screens, several times a day, the same small tax each time — and it was worth fixing on the list a
side is picked from first, because that is the list a manager looks at most. This is that fix applied
to all of them at once, and to the ones that come next.

**The remembering is done once, in `ui/rememberedSort.ts`, and every table asks for it.** A screen says
which screen it is — a name in the module's own register — and which career it is in, hands over the
accessor map it already sorts with, and gets back the same `[sort, setSort]` pair it would have had
from `useState`, except that the first value is read before the first paint and every value written is
written down. Handing the hook the map rather than a list of column names is what makes the columns a
table can sort by and the columns it can remember one list: there is one mapping, and it is the one
`applySort` is handed.

**A screen that sorts a table and does not remember it is now a test failure.** The register is a
closed list of names, held against the sources by `rememberedSort.test.ts`, so two screens cannot end
up sharing a key and a new table cannot quietly go on forgetting. `ClubSelectView` is deliberately
absent: it sorts clubs while a manager is choosing one, which is before there is a career to keep the
choice under, and it is the only table left in the game holding its own sort state.

**Kept in the browser, per screen and per career, and out of the save** — the same reasoning as the
selection list's own, written once for all of them: a sort is a reading of a table rather than a fact
about the world, so a save handed to somebody else arrives carrying none of the last manager's view of
it, and nothing that is only about how a screen looks is worth a save-format version. A career that is
not open, storage switched off, storage that throws, and a column renamed since the choice was made all
open the table in the order the screen chose for its rows. Where a screen builds its accessors out of
the world — the club list, the training forecast — the map can now be built without one, because the
keys are wanted before a career exists to read them from; its values are only ever read with a world in
hand.

**Measured in the browser**, on a career three weeks in. A heading was tapped on seven screens, the
manager walked to another screen and came back, and all seven returned showing the same column the same
way round: the squad on Player, the league table on `#`, the ledger on Date, the club list on Club, the
needs list on Area, the attendance forecast on Player, and the list a side is picked from on Player.
Seven keys, one per screen and career — `se27.ui.sort.squad.save_table-memory-1_club_14` and its
siblings — and after a full reload of the page the squad, the league table and the selection list were
still on theirs. No table folded away behind a disclosure is reachable without unfolding it, which is
what the probe does; the history screen had no seasons to list yet, so there was nothing there to
check, and the two sorts inside a man's profile are held down by the register test rather than by the
probe.

### The list a side is picked from opens on the heading it was left on

**The seven headings over the selection list sorted the squad until the manager walked to another
screen.** He decides he reads his squad by name, taps Player, goes to look at the league table, comes
back — and the names are in the side's own order again. The reading he had chosen had to be chosen
again every few minutes, which is the sort of small tax that makes a feature not worth having, and it
was the one thing the headings did not do that every table in the game already does with its columns.

**The list is now built on the heading it was last left on, and the choice is written as it is
tapped.** Not on the way out of the screen: a screen is left by closing the tab as often as by walking
away from it, and only one of those is a moment in which anything can be written down. The third tap
is written down like the other two, because on this list "not sorted" is an answer rather than the
absence of one — the side's own order — and a manager who has decided he reads his squad that way
should get it back.

**The headings and the memory of one now live together, in `ui/selectionSort.ts`.** They were a private
list in the view, which was fine while all they did was sort and nothing else; the moment their keys
had to be written down and read back, a list in one file and a reader in another could disagree — a
heading offered and not remembered, or remembered and no longer offered — so `SELECTION_SORT_KEYS` sits
beside the reader that cleans its input, and `teamSelection.test.ts` holds the two of them together:
every heading offered is one the screen has an accessor for, and every accessor is a heading that can
be pressed.

**It is kept per career, and outside the save.** Under `se27.ui.selectionSort.<career>` in browser
storage, which is where the panel layout already lives, rather than in the career's own file: this is
a reading of a squad rather than a fact about one, so a save handed to somebody else should not arrive
carrying the last manager's view of it, and nothing that is only about how a screen looks is worth a
save-format version. Two careers keep two choices, because two saves usually hold two different squads,
and a manager reading one of them by fitness is not necessarily reading the other that way.

**A browser that will not remember gets the screen anyway.** A career that is not open, storage that is
switched off, and storage that throws all open the list in the side's own order, and a tap still sorts
for the visit: the promise is not worth a squad list that will not open, and a note about browser
storage would cost more room than the sort does. Measured in the browser: one tap on Player sorted the
squad by surname and wrote `{"key":"player","direction":"asc"}` under
`se27.ui.selectionSort.save_selection-memory-1_club_3`; walking to the squad screen and back opened the
list on Player ascending in the same order; the second tap turned it round and the third put the side
back into its own order and wrote that down as `{"key":null,...}`; and after a full reload of the page,
reopening the career and the selection screen opened the list on Form ascending, which was the heading
it had been left on. 24 rows, seven headings, nothing on the screen pressed before the first tap.

### Every story in the paper carries a picture of the kind of story it is

**The news screen was a page of type.** A headline, a paragraph, and six colours of label, all of it
words: a paper with no pictures in it, which is the one thing a paper is not.

**Every story now carries a drawing of the kind of story it is.** A match is drawn as a pitch seen
from above — touchline, halfway line, centre circle, two penalty areas, two goals and the centre
spot — the squad as three of the men standing in a row, the club as a covered stand with people in
it, the league as a cup, the world as a globe, and the money as a note with a stack of coins under
it. The lead story carries its picture at 128 by 80, every card in the feed at 64 by 40 beside the
headline it belongs to, and all of them are drawn on one sheet (`components/NewsPlate.tsx`) at one
stroke weight, so the picture on a finance warning is drawn in the same hand as the picture on a
match report.

**They are drawn rather than photographed, and that is the whole of the decision.** This game draws
its faces, its badges, its kits and its pitches, and one photograph among all that ink would read as
an advertisement, which is the last thing a news screen should become. The six are shaped like the
places they name rather than like six icons, and the file is arranged so that this can be checked
rather than admired: every path is written in absolute commands and every arc is drawn across a
diameter of its own circle, which is what lets `components/newsPlate.test.ts` walk the drawings and
hold each one inside the sheet it is drawn on. A picture that ran off its own edge, or that turned
out to be a box rather than a pitch, fails there instead of looking nearly right on the screen.

**The pictures say nothing a screen reader has to hear.** The kind of story is already written in
words in the meta line beside them, so the drawings are `aria-hidden` and the screen audits clean.

**The six were read off the screen rather than trusted.** Over a career's first three weeks the paper
printed World, Club, League and Squad stories, each wearing the strokes of its own kind — the globe,
the stand, the cup, the men — and the two kinds that career never printed at all, a match report and
a finance warning, were written into its news and drawn on the screen to check in the same way. What
the browser measured: the lead picture 128 by 80 drawn at a 0.75 stroke and a card's 64 by 40 at 1.5,
which is the same 1.5px line on screen for both; a card's summary a 64px picture column with the
words in the column after it and "Read the story" still underneath the words; and nothing running off
the side of the page, on a desktop or on a 390px phone.

### The team sheet opens with the side, and says about a man what the squad list says

**The list a manager picks his side from was twenty-four names in an order nobody had asked for.**
It was sorted by how well each man fitted the shirt being picked, which answers one question well
and not the one a manager arrives with. Its rows said a position, an age, a day job and a form
figure squeezed into one grey line, while the screen next door in the same tab said the same things
in a row that a manager had already learnt to read.

**It now opens in the side's own order: the eleven as they stand on the pitch, keeper first, then
the substitutes, then the rest of the squad.** `squadInTeamOrder` in `ui/lineupEditing.ts` is that
rule, and it is kept out of the view because it is a rule about a lineup and a squad rather than
about drawing one. A man dropped from the XI falls down the list and the man who took his shirt
rises to where the shirt is, so the list reads as the team sheet rather than having to be re-read
every time the side changes.

**Every row now carries what the squad screen carries.** The portrait, the name and the day job come
from `PersonIdentity` — the same row the squad screen uses — and beside them are the same facts in
the same order: the position, the condition and the form as meters with their numbers on them, the
morale, and the availability pill with its reason on it. What belongs to this screen is kept: where
the man already is ("In the XI at RB", "On the bench", "Not selected") and how well he fits the
shirt being picked, which is the one fact the squad screen has no use for. The labels these facts
would carry as columns are written into the rows, because this is a list rather than a table, and
the availability pill needs no label at all: the word in it is the fact.

**Seven headings over the list sort it, with the same sorting as every other table in the game.**
One tap on Player, Pos, Fitness, Form, Morale, Availability or Fit sorts by that fact, the second
tap turns the sort round, and the third puts the side's own order back — `tableSort`'s own cycle,
which is why `UNSORTED` means something here rather than nothing. The two of them that need a rank
rather than a number now ask the domain: `positionRank` joins `POSITION_GROUP_ORDER` in
`domain/positions.ts` and `availabilityRank` joins the availability type in `domain/person.ts`, and
the squad table's own two headings ask the same two functions, so the two lists cannot drift into
two ideas of what order a squad is in. The headings sit above the scrolling pane rather than inside
it, so the names move under headings that stay where they are.

**All of it is taller than the four words a row used to be**, and that is the price of it, so it is
worth naming: measured in the browser at 1440×900 a row is 81px, so about seven names are in the
pane at once, and on a 390px phone the same row stacks to 183px.

### The report and the replay wear the shirts too

**The two views a manager opens after the whistle drew the clubs' own colours, not the shirts they
played in.** The replay was the worse of the two: its pitch painted every man in the colour in his
club's identity, so a visiting side that had changed into a white away strip was drawn in its own
blue on the replay of the afternoon it did not wear it, and both keepers were in the outfield shirt,
which is the one thing the third strip exists to prevent. The report had no line-up at all: it
carried the scoreline, the figures, the goals and a list of ratings, and the men who played were
never drawn in the shirt they played in. The live match had already answered the question, so the
two views now read that answer rather than each arriving at one of their own.

**One function says which shirts a fixture is drawn in, and all three screens ask it.**
`matchTeamColours` in `ui/kit.ts` returns the whole answer in the shape the renderer holds it — each
side's outfield strip and each keeper's third strip — built from `matchKitColours` and
`matchKeeperColours`, so there is still one reading of the kits underneath it. `MatchView` hands the
two objects to its render state rather than assembling the same spread itself, the replay does the
same to the state it builds from the record, and the report passes them straight to the sheets. The
report gained a *The teams* section holding the two `TeamSheet`s — the same component the live pitch
stands beside it — under the ratings, so the line-up as it was picked is in the document and not only
the marks for it, drawn whenever both sides were actually picked. The replay stands the same two
sheets down either side of its pitch, which is where the live match puts them. `TeamSheet` gained one
prop for it: a replay passes `marks={false}`, because a replay exists so that an afternoon can be
watched back without being told how it ends, and a list of the goals with the clock still in the
first half gives the ending away at a glance. A live sheet and a report keep the marks, which is what
a live sheet and a report are for.

**Measured in the browser, on both views, in an afternoon played out in one press.** A match that
finished 1-1 with seven bookings and two sendings-off: on the report and on the replay alike both
sheets are headed in the strips the sides played in — `#37474f` and `#6200ea`, the second of which is
the visitors' spare set rather than the blue in their identity, because their blue clashed with the
home shirt — with the club's name reading on each at 9.7:1 and 10.4:1; every outfield row is in its
side's strip, and the two keeper rows a side are in the clubs' own third strips, `#cddc39` and
`#6200ea`, read from the kit each club's own page draws rather than from the sheet; the replay's dots
are in the same shirts as the sheets beside them, keeper included, and its sheets are in the same two
strips as the report's; the report lists the afternoon's two goals, exactly the number the record
credits, and the replay lists none of them; and the sheets on both views are clean to axe. A report
opened on a phone still draws both lists, stacked: the live match stands its sheets down at that
width because there is no room for them beside a pitch, and a report has no pitch to make room for.

### The team sheets wear the shirts

**The two team sheets named eleven men and could not tell you the shirt any of them was in.** A
teamsheet is a list of footballers, and a footballer is a shirt: whose he is, and which of them is
the man in goal. The old sheet answered the first question with a single three-pixel rule above the
club's name — the strip the side turned out in, drawn once, over sixteen rows all in the same ink —
and the second not at all, because the keeper was a row like any other row: marked `GK`, and nothing
else, in a list whose whole point is who is playing where. The prop it was handed already said the
right thing — `colour` was documented as *the first colour of the strip this side is wearing, not
the club's own colour*, a distinction that matters because a visiting side in a white away shirt is
playing in a shirt its own colours do not describe — and that distinction had exactly one place to
go, and a hairline is not a place.

**One rule now decides which shirt a footballer is in, and everything that draws one asks it.**
`shirtFor(colours, position)` in `ui/match/shirt.ts` returns the third strip for a keeper and the
side's outfield shirt for everybody else. The match pitch already had that rule, written inline as
`shirtOf`, so the module is that rule moved rather than a second version of it, and the pitch now
delegates to it — one rule about a football match, asked by the grass and by both lists beside it.
The sheets are handed the whole `RenderTeamColours` in place of the single `colour` they used to
take, and `MatchView` passes `renderState.teams.home.colours` and `.away`, the same colours the
pitch is drawn from. The head band is the strip itself, painted flat in `--sheet-colour` with its
ink measured for that colour by `flatClubInk` and inherited by the club's name, so the club's own
shirt is what the sheet is headed in. Every row then carries a three-pixel bar down its outer
edge: the ten are painted from `--sheet-colour` by the stylesheet, because a sheet's strip is
stated once and not ten times, and the keeper's is painted inline in his side's third strip,
because his is the one row of the sixteen that is not the side's. The bar is `aria-hidden`, since
the `GK` beside it already says the position and a colour is no use to a screen reader; the home
sheet puts it on the left edge and the away sheet on the right, so the two mirror one another down
either side of the pitch, and the row runs on from it to the man's name.

**Measured in the browser, on the match screen, against the pitch beside it.** In a career whose
matchday put Fordholm South End in `#283593` against Charlgreen Nomads in `#f0b8bd`: both sheets
are headed in that strip, the full width of the sheet, with the club's name at 9.70:1 and 10.42:1
on it; all fourteen outfield rows a side are in the side's own shirt; and the two keeper rows —
the starter and the man on the bench — are in the third strip, `#4caf50` and `#d50000`, neither of
which is the outfield colour, on the rows that say `GK`, on the man actually in goal. The two
sheets are checked against the picture rather than against a colour copied out of the source: the
ten rows and the ten dots beside them are the same shirt, so a sheet handed the club's own colours
instead of the strip it turned out in is the case that fails. Each bar sits on the outer edge of
its row, three pixels wide and as tall as the row, painted flat, and axe reports nothing on either
sheet.

### The manager picks his own face

**The one man in the game whose name is typed rather than rolled was the one man who could not
choose the face it draws.** A face is seeded from a name on purpose — the manager’s id is the fixed
`user_manager` whoever he turns out to be, so an id-seeded face would hand every manager of every
career the same head — and that made him the only person in the world whose seed is the player’s own
typing. He is also the only person who has to look at that face every week. Nothing about the
drawing was wrong; what was missing was the offer.

**`FaceChoices` is the vocabulary and `facePlan` honours it without moving a single roll.** Twelve
named features — head shape, skin tone, hair style, hair colour, beard, glasses, eye colour, eye
shape, brow weight, brow height, nose and mouth — live in `domain/face.ts`, so a career can hold
them beside the details the manager typed, and as names rather than indices, so a palette can be
reordered without handing a man somebody else’s jaw. The drawing reads them in `ui/face.ts`: the
roll happens first and in full, so a man who chooses nothing is drawn by exactly the numbers his
name drew him by before any of this existed, and a man who chooses one feature moves that feature
and nothing else — choosing a beard cannot shift a nose, because no draw is ever skipped. What no
choice can override is his age: hair that was going to grey greys, over the colour he picked rather
than the one he did not. How far apart his eyes are and how high they sit are rolled, and stay
rolled, because they are the two things nobody picks about his own face and everybody notices
about somebody else’s.

**One control, on the two screens that need it, drawing the same face every other screen gets.**
`components/FaceDesigner.tsx` renders the real `PortraitArt` from the real `facePlan`, at the
profile’s own 105-by-120 and in the coat an official wears, so what a manager sets is exactly what
he is shown next week; a preview drawn by a second code path is a preview that can lie. It opens on
the face his name already draws — a way of changing a face rather than of building one out of
nothing — with a shuffle that hands him somebody else’s and one press back to his own. It is a
panel on the pre-game screen beside the details it belongs with, and a panel on his own page
afterwards; `setManagerFace` writes to the person every screen draws and mirrors it onto the
profile a saved profile remembers.

**Measured in the browser, on four surfaces.** In a career whose manager chose the deepest skin
tone and a pair of glasses: the panel opens with twelve labelled rows, one button pressed on each,
23 colour chips, and its preview in a 105-by-120 box; pressing a row redraws it, and the two hexes
only that choice can produce — `#4f2c19` and the `#262c31` frame — are on the drawing. The career
then starts with those twelve features on the man and on the profile both; his own page draws him
once in the profile box and in markup identical to the panel’s own preview, character for
character; and the club screen and the staff screen draw the same face on the same man, so the two
committees cannot disagree about him. The way back takes it off both. Twelve of the tactics
screen’s option groups in one panel would have been three rules a row, so inside the designer a row
keeps one and above 1280 pixels they go two across — and axe reports nothing on the panel, which it
did while the row labels were an `h4` under a panel’s `h2`.

### The keeper is the one man who is not in the club's shirt

**A keeper wears the third kit, and the game was dressing him in the club's colours.** The laws
have always asked the two goalkeepers to be told from the ten in front of them and from each other,
and a Sunday side answers it the only way it can: the loudest shirt on the rack, worn by nobody
else. `kitPlanFor` already drew that shirt — it picks a goalkeeper colour at least
`MIN_KIT_DISTANCE` from the club's own — and the Kit screen already showed it. Nothing else did.
His portrait was drawn in the home strip, and his dot on the selection pitch, the tactics pitch and
the match pitch was his side's outfield colour, so a club in red fielded a red goalkeeper in a pitch
of red shirts: the one man the third strip exists to pick out was the one man it could not.

**`goalkeeperKitColour` is now the one place that question is answered, and everything that draws a
keeper asks it.** It reads the club's third strip from the same `clubKit` the Kit screen draws, and
falls back to the club's own first colour for a save written before kits existed;
`matchKeeperColours` reads both ends of a fixture with it; the portrait gets it from `outfitFor`,
which now asks for `designFor(kit, preferredPosition === 'GK' ? 'goalkeeper' : 'home')`. The match
pitch asks `shirtOf`, which returns `colours.keeper` for a keeper and `colours.primary` for the
other ten, so a side whose away shirt is white still has a keeper who is not. The selection and
tactics pitches paint the goalkeeper's shirt in it, with the ink measured against that colour by
`flatClubInk` rather than picked by brightness, because a third strip is often exactly the mid pink
or orange where the two disagree.

**The render contract carries the third strip now.** `RenderTeamColours` gained a required `keeper`
field beside `primary` and `secondary`. The builders read a club's identity rather than its kit —
the strips live in the career, which a match does not carry — so it starts at the club's own first
colour, and `MatchView` replaces it with the third strip exactly as it already replaced `primary`
with the shirt the side actually turned out in. A keeper never changes into the away kit: he is in
the third strip in every match, home and away, which is the one thing about a shirt that is the same
every week.

**Measured in the browser on all four surfaces.** In a career whose club plays in pink `#ec407a` and
whose goalkeeper strip is magenta `#e040fb`, the keeper's shirt on both preparation pitches is
`#e040fb` carrying `#101a14` — 5.34:1 — while the ten outfield shirts are left to the stylesheet,
and the keeper's portrait holds `#e040fb` where an outfield player's does not. On the match pitch
the manager's keeper is painted `#e040fb` and the visitors' `#ad1457`, each club's own third strip,
neither falling back to the neutral grey and both position codes legible on their dots: twenty-one
checks, no page errors.

### The club's colour is painted in an ink of its own

**A career blue had no legible ink on it, and every screen said so.** Axe reported the same two
things wherever a career was open: a primary button at 3.84:1 and the next-match label at 4.09:1,
both measured against the 4.5 that text of their size needs. Neither was one rule gone wrong. Both
came from one idea used one surface too far. `--club-ink` is chosen across the *stripes* a club's
shirt is made of, so that the second colour fading through the header never swallows the text on it
— and that is a compromise: it makes the ink the best it can be over several colours at once. Every
button, chip, tab, badge, dot and count in the game then wrote with it, on a surface that is not
several colours at all. Flat paint is one colour, and an ink chosen for six of them can be wrong on
it. Measured over the generator's own palette, ten of its fifty-three pairs and the blue a career
is started in had no ink that cleared 4.5 on the flat colour: that blue measured 4.33 with the
light ink and 3.84 with the dark one.

**So the flat paint gets an ink of its own, and it is a guarantee rather than an improvement.**
`flatClubInk` tries the game's two inks first, so a club keeps the house ink wherever it works, and
for a mid-toned colour that neither can carry it reaches past them to pure white or pure black.
That is always available: the ratios of white and black against any colour multiply to 21, so the
better of the two can never be below 4.58. The answer reaches CSS as `--club-flat-ink` and is used
by everything that paints the club's colour flat — `.btn--primary`, both `--active` segmented
states and both `.chip--on` blocks, the active inspector tab, the position dots, the armband, the
inbox's unread count, the navigation badge, the skip link and the match header's "You" tag — while
`--club-ink` is left to the two striped bars, which is the only thing it was ever chosen for.
Across the whole palette the flat ink runs from 4.60 to 17.8, and it leaves the house palette for
only four colours: the two inks and the two ends of the scale.

**The fixture band's ink is chosen for the band, and its labels stopped being faded.** The band is
a flat shade of the club's colour, so it now takes the same treatment (`--club-band-ink` through
the same helper, 4.50 at its worst across the palette, and a structural guarantee rather than a
happy coincidence). The label and the facts beside it were then dimmed to 72% and 85%, and a faded
ink is the ink mixed with its own background, which no floor survives: the label measured 4.09
where the band clears 6.35 at full strength. They go quiet by size and tracking instead, the club's
nickname and the date's second line lose the same fade, and one opacity written inline in
`MobileTopBar` went with them. A fade of ink into its own colour is also exactly what the sheet's
own law forbids, so this was two rules disagreeing about the same pixel.
**Where this was measured, and what it does not cover.** `contrast.mjs` composites the real
background behind every piece of text and reports the number: 53 screens, 7,499 samples, none below
its requirement, on the club the world dealt and on a light one. `contrast-club.mjs` now sweeps the
generator’s whole list rather than only the clubs this county happens to contain — 54 colours, the
career’s blue included, repainted on a live career and audited with axe on two screens each — for
zero `color-contrast` violations, and the standing allowance in the list audit is now a
zero-tolerance rule over all 227 of its checks. What none of that can see is the header bar itself:
axe cannot resolve a text background under the shell’s band gradient and reports the whole bar as
*incomplete*, so the bar’s ink is argued rather than measured. On the career above it reads 3.84:1
— dark ink on the blue, which is the compromise the stripes asked for — where the same colour
painted flat beside it is now 4.63. It is under 4.5 on eleven of the colours this change was made
for (ten of the generator’s pairs and the blue a career starts in) and on most of the palette’s
stripe bands, because the bar’s ink is held to the 3.5 the stripes are drawn back for. Holding its
small print to 4.5 instead means the stripes give way on the colours they cannot survive, which is
a change to the shirt itself rather than to an ink, and it is not made here.

### Every list of people draws the man in it

**The audit went looking for names and found a handful of lists nobody had thought of as lists.**
Eleven surfaces named a man and drew nothing beside him: the squad table, the attendance sheet, the
record books, the subs a player still owes, a story about a man, a club's squad on its own page, the
ratings in a match report, the search dropdown, a rival club's manager and its chairman, the eleven
the tactics board lists, and the men who cannot play. They were missed for the same reason — each is
a list of *something else*, of attendances, of debts, of fixtures, of results, with a man's name in
it rather than a list of men. A name in a row is a name in a row whether the row is a table or a
sentence about a Saturday.

**The drawing is one component, and now so is the row.** `components/PersonIdentity.tsx` is the one
place a person in a list is spelled, and it gained `PersonLine`: a man's drawing and his name on one
line, and nothing else, for the rows a leaderboard makes rather than a roster. It takes an id rather
than a man for the same reason `PlayerLink` always has, so the one case that cannot be drawn — a
name the save no longer holds — falls back to exactly the link it used to be. The pure half is split
off as `PersonLineArt`, because a component that reads the career cannot be rendered in a test at
all. Nothing about the drawing itself changed: `Portrait` still decides what a man looks like, and
the list still decides how big he is — 28×32, the box the squad table already gave him.

**What is left as a word is left deliberately, and the rule is exact.** A list of people is drawn; a
sentence is not. The pitch and the formation board draw a man by where he stands, and a shirt on a
pitch is not a name that has lost its face. The team sheet, the touchline controls and the incident
banner are read in seconds while a match is running, and a column of drawings there is noise rather
than information. A goal is a sentence about an afternoon rather than a list about men, so the
scorers and the assists in the report stay words, and a story that names a man in its sentence stays
a sentence. Everything else — every row whose job is to say *who* — now says it twice.

**The audit is a program now rather than a promise.** A probe walks every screen in the game — all
eighteen rooms, both profile overlays, the search dropdown, the inbox, the tactics board's own list
of the eleven, and an afternoon played through to the whistle — and measures 61 surfaces at a desk
and on a phone. It asserts that no row anywhere names a man without drawing him, that every drawing
sits to the left of the name it belongs to, and that no list draws him smaller than the squad
table's 28×32. The handful of rows that stay words are named in the probe, one rule at a time and
with the reason written beside it, so the next screen that lists people either draws them or says
why it does not. The contract suite pins the other end of the same rule: eleven surfaces must come
through `PersonLine`, and the four that are allowed to keep a man as a word must not have a drawing
in them at all.

### The message list is a list of people

**A row in the inbox was a name and a sentence, which is what a spreadsheet is.** The thread and
the dialog that talks terms with a man were given his face in the entry below, and the list he is
found in was left as text: eleven conversations, eleven names, and a man you have never met as a
string. It is the one screen a manager scans rather than reads, and it was the last place in the
game where a person was still only a word.

**Every row now carries the man it is with.** `InboxRow` gained `face`, worked out by the same
`threadFace()` that decides what a thread is headed with, so a row and the thread it opens cannot
disagree about who is in it: one man, drawn at 28×32 — the box the squad table already draws him
in, decided by the list's own rule rather than by the drawing, because only the list knows how
tall its rows are. A room full of people has no single face and is drawn with its name alone; not
one thread the simulation opens has several people in it, so that case is the exception rather
than the shape of the screen.

**Nothing about the row's density changed.** The face sits at the left of the two lines the row is
already made of and is centred on them, so a row is exactly as tall as it was and a phone shows
the same number of conversations. It is the fuller drawing rather than the reduction a message
bubble gets, and deliberately: a bubble is a trace of something said, and the list is where the
manager finds the same man again.

### Talking to a man puts his face on the page

**A conversation was a heading and a list of sentences, and nothing on the page said the sentences
had come out of anybody.** The inbox thread and the transfer conversation are the two screens where
this game is something the manager *says*, and both named the man they were about and then stopped:
an `h2`, a run of message bubbles, and the words "Haroon Reynolds" in small caps above one of them.
Everybody in the game is drawn now — the face generator arrived in the pass below — so there was no
reason left for the one place a man talks to you to be the one place he is not.

**The thread is headed with him, and his own lines carry him.** `threadFace()` in `inboxState.ts`
answers one question of a conversation — who is the single man in it? — and returns nobody for a
group, a committee, or a person the save no longer holds, so a one-to-one is headed with a 35×40
drawing of him beside his name, and a room full of people keeps its name alone. Every message now
carries the id of the man who wrote it (`ThreadMessage.senderId`), so the log draws the writer’s own
face at 28×32 beside his sentence rather than guessing him back out of the words. The manager’s own
messages carry none: he is the man reading, and he does not need a picture of himself beside his own
question.

**The dialog that talks terms with him opens on him rather than on a heading.** `NegotiationModal`
used to begin with the words "Talk terms" and go into a transcript attributed with a name in small
caps. It opens with his face — 42×48, `lg` rather than the profile’s `xl`, because this is not his
page, the page about him is a dialog away, and what is being read here is a conversation with him —
his name, and the one thing worth knowing while you are talking to him, ruled off from the
transcript beneath. His lines in the transcript carry the same small face his own messages carry in
the inbox, and the opening line, which is the game talking rather than him, has none.

**One message, two screens.** A bubble is the same shape in both places now — a face on the left,
the words taking the rest — because both are a person saying something, and both wrap the sentence
in `.bubble__words` so a long message takes the room it needs from the face rather than squeezing
it. The face is `sm` wherever a trace of a conversation is drawn, and its wrapper never resizes the
drawing. Nothing in the simulation moved: the face is a reader of `game.people`, and the transcript
is a reader of the record it already had.
### Half time, full time and the report are drawn in the match's own marks

**Half time, full time and the post-match report were the only three screens in the game that
spelled a result out in a sentence.** The header at the top of the afternoon has always shown a
match the way this game knows how to show one — a crest, a name, the score, a name, a crest, and
the two strips the sides actually turned out in, drawn as one hard line across the top — but the
moments the match *stops* for the manager said "Northolt 2 - 1 Hanwell" in body text in a plain
box, and the report opened on the words "Match report". Three screens in one afternoon read a match
differently from the screen above them.

**They read it from one drawing now.** `match/MatchScoreline.tsx` is the crests, the two names, the
score and the two shirts, and it has three callers: the half-time card, the full-time card, and the
report's headline. It takes the career and the match as props and reads nothing else, so it is the
same drawing over the pitch and inside a dialog — the minute the whistle stops play, the manager is
reading the thing he was already reading. The line itself is `shirtLine()` in `kit.ts`, which the
match header now uses as well, so "the two shirts as one hard line" has one definition instead of
four, and the visitors' half is the shirt they are wearing rather than the colour in their club's
record. On a phone the crests stay, because they are the identity, and the names and the size give
way instead.

**And the figures the two moments put underneath it are painted in the two strips on the pitch.**
`MatchStatsPanel` — what half time and full time deliberately put in front of the manager — painted
the home half of every bar in `--club`, which is the *manager's* colour, and the away half in a
grey. Read from the away dug-out that showed the visitors wearing his shirt and his own side
wearing nothing, which is the exact fault the commentary bar, the swing bars under the pitch and
the case for drawing people all exist to avoid. Every bar is two halves now, one in each side's own
first colour, meeting where that side's share of the figure lands; the pressure bar above them is
the same two shirts. Measured on a real afternoon, every row of the panel is painted in precisely
the colours the swing bars under the pitch are, and the home side in that match was in **grey** —
the colour the panel used to overwrite with the manager's own.

**The report keeps the ruled head it earned and gains a headline.** A match report is a document,
and the `report` dialog kind already gave it a ruled head and a headline's type; the document now
opens on the result rather than on a caption. A fixture nobody has played has no result to
headline, so its report goes straight to the panel underneath that says so.

**Nothing moved in the other direction.** The scoreline, the line and the figures are all under
`src/ui`, and the new `match/scoreline.test.ts` walks the whole of `src/simulation` to prove that
not one of those names has a home there: Touchline decides what happens, and this layer shows what
happened.

### Every person in the game is drawn, and every player is in the club’s shirt

**A pair of initials in a square is the visual grammar of a database, and it made the game look
more like a dashboard rather than less.** The entry below replaced one bust glyph worn by
everybody with the man’s initials, on the reasoning that the game does not generate faces and
a fabricated one would be a drawing of somebody who does not exist. The reasoning was wrong at
the first step. This game does not generate photographs, but it generates drawings all day — a
crest is a generated drawing of a club, a kit is a generated drawing of a shirt, a kit firm’s
mark is a generated drawing of a factory’s logo — and a person is not a special case.
Initials were the one thing in the game that said “record” rather than “person”, and they said
it on every screen at once.

**Every person is drawn now: a face, and the top of a body.** `face.ts` is the plan and
`components/Portrait.tsx` is the drawing, which is the same split the crests and the kits
already use. The plan decides the skin (nine tones, weighted toward the middle of a broad
range), the shape of the skull (six, from a long face to a boxer’s), the hair (nine cuts, the
hairline a quarter of the way down the head, grey arriving from the late thirties), facial hair
(five kinds), eye colour and shape and spacing, brows, nose, mouth, and whether he wears
glasses. It is seeded with the man’s **name**, so he is the same man in the squad, in the
committee, in the training list and in a name found through the local game. Measured over a
generated world: 1045 people, 1045 distinct faces, and no two alike.

**A footballer is drawn wearing the club’s shirt, and a transfer changes the shirt and nothing
else.** The strip is read from the same kit the Kit screen draws — the club’s home colours, its
pattern, its collar and its cuffs — so a club in red and white stripes has men in red and white
stripes, and the sleeve seams are the kit’s own. A man attached to nobody is drawn in a plain
top, and an official is drawn in a coat, because the chairman and the treasurer work for the
club rather than play for it; that is said with a *shape* rather than with a colour, so it reads
for everybody. `face.ts` reads nothing about the club at all — the drawing is a pure function of
the plan and an outfit, and the outfit is the only thing a club supplies. Measured live: one
man’s head outline is byte-identical in his squad row at 28 pixels and on his profile at 105;
moving him to another club replaces `#1f6feb` with `#4a148c` and leaves the outline identical;
attached to nobody he is drawn in `#454f59` with the same head; an official is drawn in the
`#333b44` coat. And every one of the fifteen hundred drawings in a career was rasterised and
sampled: no eye missing, no eye under hair, no forehead without skin, and no chest that is not
the club’s shirt.

**The profile is where the drawing is allowed to be the point of the page.** A person’s page
opens with a 105x120 portrait where it opened with a 34-pixel crest, in the same chip every list
uses, and the manager screen draws his own face in the frame that held a bust glyph — 88x100,
with the arch on that frame gone, because an arch that suited a silhouette cut the top off a
head.

**Two faults were found by measuring rather than by looking.** The hairline was written as a
fixed distance below the crown, which put it six units too low: every man in the game had a low
brow and a small face under a heavy head of hair. It is a proportion now — the head in
quarters, the hairline at the quarter, the eyes at the half, the base of the nose at three
quarters — which lands correctly on all six skulls at once, and is pinned by a test that walks
every head against every cut. And the jaw’s shadow was drawn from a path made only of curves,
with no point to start from: a browser refuses a path like that and quietly draws nothing, so
every face in the game had gone without the shadow that separates the jaw from the neck. A test
now renders every head, every cut and every beard and asserts that every path in every drawing
begins at a point, which catches the whole class of fault rather than the one instance of it.

### Five rooms, one stated law, and people who look like people

**Every screen in the game was the same screen with different words on it.** Measured
across all eighteen career screens at 1440, the frame was identical: the same 64-pixel
club rule under the header, the same 44-pixel club bar over every section, the same lit
panel surface, the same 3-pixel corner and the same `rgb(35, 42, 49)` border. A squad
screen, the treasurer’s book and the league table were one page. Which room a screen is
in is now decided once — `src/ui/archetype.ts` gives every view one of five rooms and the
shell wears it on the content column as `data-archetype` — and the stylesheet paints the
difference: **the desk** (boxed surfaces, the club rule as a 64-pixel stub), **the board**
(no boxes at all, which leaves the pitch and the men as the only objects in the room),
**the club’s paperwork** (a letterhead: the club’s rule runs the full width of the header
and a section carries a 72-pixel bar), **the season** (no boxes, tabular figures, and table
heads ruled top and bottom like a printed column), and **the local paper** (a masthead-sized
title, a 68-character measure, sentence-case headings). Measured afterwards: five distinct
frames where there had been one — a 26-pixel title and a 64-pixel rule on the desk and the
board, the club’s colour running the whole width of the column on the paperwork and the
season, and a 32-pixel title on the paper.

**The sheet said "flat and dark, no gradients" at the top of itself and then lit five things
from a corner.** `.create-club__column .panel` lifted at 150 degrees, `.workspace-panel` at
155, `.manager-identity` at 135, its portrait at 160 and `.staff-roster__person` at 145 —
five subtly different rooms in what is supposed to be one building, because light does not
come from the top-left of a box. They are all vertical now (178 or 180 degrees), and the law
is stated once at the head of the stylesheet where the next rule can read it: light comes
from above in a straight vertical line; the club’s colour is flat, one full-width band excepted;
structure is a rule rather than a box; nothing floats unless it is over the page; one corner
and one size. Light on a *drawing* is not the same thing as light on a surface, which is why
the two shirts and the portrait keep their own.

**Every person in the game was the same bust glyph in the same grey box.** Four identical marks
on the staff screen, eighteen identical marks in a squad, and a list of names found through the
local game drawn the same way — which is a database with names in it rather than a list of
people, and there was nothing on a row to find a man by except reading the name beside it. The
mark is the man himself now: a generated drawing of a face, wearing the club’s own shirt
(`components/Portrait.tsx`, whose plan is `face.ts`) — see the entry above for what that is and
for why the initials that stood here first were rejected. Measured on a club whose colour is
`#1f6feb`: all 18 squad portraits in the club’s own shirt, 18 distinct drawings, and four
committee portraits in the plain coat. A candidate found through the local game was the one list
that drew the mark above the name rather than beside it — measured, its foot sat 2 pixels clear
of the name underneath — and it is a 10-pixel gap inside the same row now, which is how every
other list of people in the game already read.

**Every dialog wore the same head.** A man’s dossier, the club’s own page, a match report and a
question with two answers all opened as the same panel with a different title in it. The
mechanics stay one system — the scrim, the escape key, the trap, where focus lands — and the
head is now told which of the four it is holding: a person or a club gets the club’s tint on the
head, a match report gets a rule and a headline, and a confirmation gets none of the club’s
colour at all and a smaller title, because "are you sure" is not part of the club’s identity.
Measured: a 15-pixel title and a `1px rgb(35, 42, 49)` border on a question, against 17 pixels
and a 2-pixel club rule on the rest. A dialog with no kind is a utility and keeps the plain head
it always had.

**And the four dialogs that mount outside the shell were drawing a green that belonged to no
club in the save.** Preferences, the changelog, the credits and the managers are mounted above
`AppShell`, and the club’s colours are set on the shell. Measured on the same club: the "The
game" menu wore the club’s blue `#1f6feb` and "Preferences", opened from inside that menu, wore
`rgb(76, 175, 125)` — the default. The colours are restated around them when there is a career to
take them from; on the main menu there is no club yet, and the game’s own green is correct there.

**Motion was in the places it was hard to do without and nowhere the manager touches all day.**
A navigation item is how he gets anywhere, and it snapped between two states with no relationship
between them; a tile went straight to its hover tone, which reads as the screen flinching rather
than as the tile answering. There is one speed now — 120ms, the speed the rest of the sheet
already uses — spent on four things only: the navigation, the thing under the pointer, the
selection, and a row of a table. Nothing loops, nothing animates on arrival, and the reduced-motion
rule that already zeroes every transition in the sheet covers all of it.

### The black box comes off, the crest comes up, and two screens lose their holes

**The club designer and club selection both wore a black rectangle over the pitch
photograph, and it was one rule in the wrong place.** Those screens put the header
straight on the scene — the stylesheet says so, and scopes a drop shadow onto the
heading for exactly that reason, because small green capitals over grass read as mud.
A later rule then gave both headers `background: var(--bg)` with no condition attached,
which measured as **`rgb(8, 9, 11)` across the top of both screens at 1024, 1280, 1440
and 1920 pixels**: a box painted over the photograph the header was drawn to sit on. On
a phone the same header goes sticky and the page scrolls under it, where an opaque
header is not a mistake but the thing that keeps the words readable, so the rule was not
deleted — it was moved into the one media query that needs it. Measured after the
change: **transparent at every desktop width, still `rgb(8, 9, 11)` at 390**.

**The crest in the match header was sized like a bullet point.** It was 30 pixels
square, and the club's name beside it is 22 pixels tall, so the badge read as the dot at
the front of a line rather than as the club. It is now **44** — the size at which a
silhouette, a pattern and a symbol are all still legible at a glance — and it costs the
header nothing, because the score and the clock in the middle of that row were already
taller than it. On a phone it is 28 rather than 22, for the same reason at a smaller
size. The header is 95 pixels tall at 1440 either way.

**The club designer was two columns of about 570 pixels with a 260 pixel hole at the
foot of one of them.** Identity and Ground came to 862 pixels against the Badge and
Squad panels' 1122, and nothing was ever going to fill the difference: two columns can
only be balanced if what is in them is the same height, and a form's panels are not.
Wide enough for three, the designer now stops being two columns at all — the column
wrappers hand their panels to the grid, which places **Identity, Ground and Badge across
at 482, 380 and 429 pixels** and the squad beneath them at the full width, which is what
the squad panel's own `grid-column: 1 / -1` was always meant to do and could never do
while it lived inside a flex column. The page measured **1443 → 1200** at 1440×900,
**1630 → 1219** at 1280, **1416 → 1357** at 1024 — and the designer is 1440 wide rather
than 1180, where it used to leave 370 pixels of nothing at each side of a 1920 screen.

**The move found a rule that had never once applied.** The badge panel carries
`grid-column: 1 / -1`, written for a panel in the grid and harmless for as long as the
panel was a flex item in a column — which is to say, always. The moment the columns
handed their children up, it took the whole top row and pushed the other two panels out
of it, and the page came out **taller** than the two columns it had replaced. The release
is therefore scoped to the grid so that it outranks that rule rather than relying on
being written after it; the arithmetic is in the comment above it, and the assertion is in
the test suite.

**The kit screen was the decision the wrong way round.** It drew the kit the club wears
in a full width section, and then the three designs it could have worn as three cards
**across** the screen — at 1440, three 438 pixel columns each holding a strip 230 pixels
wide, two thirds of every card empty, with the thing being compared against scrolled off
the top before the comparison. It is now two columns: **the kit the club wears on the
left, the three it could have worn down the right**, each design read across as its name,
its button and the three shirts it would put the club in. The left column carries the
chosen strip at 168 pixels a shirt and, underneath it, the kit deal — sponsor, maker,
colours — which used to be behind a door at the foot of the page; the three strip
descriptions that went there instead only repeated, in 28 pixel type, the captions the
shirts above them already carry, so they went back behind a door. The strip that filled
the column ended at **63 pixels** short of the designs at 1440 rather than 108.

**Three shirts stay on one row, because a kit is a set.** Left to wrap, three shirts 150
wide need 482 pixels of column, and a column of 401 folded the third one onto a line of
its own — a measured 487 pixel strip where the designs beside it were 551, which is the
hole again, inside the column this time. They shrink as a row instead, exactly as they do
on a phone, where the same figures have been capped at 96 pixels all along.

**And the header rule can now fail rather than being noticed.** `uiTuning`'s neighbours
in `src/ui/workspaces.test.ts` read the stylesheet as text; the new block reads it rule by
rule, keeping each rule's media context, so "a pre-game header paints only where it is
sticky", "the crest is 44 pixels and its phone figure is 28", "the designer is three
across above 1024 with the badge panel released" and "three shirts do not wrap" are
things a future edit can break loudly. Each of them was checked by reintroducing the
fault it is meant to catch.

### The crest, drawn like a badge rather than a diagram

A badge is the first thing a manager sees of an opponent, so a county where a
fifth of the sides wear the same crest reads smaller than it is. Three things
changed here, and each of them was found by measuring crests rather than by
looking at them.

**The libraries grew by a third.** **Thirteen new symbols**, taking the set to
**61 drawings**, each with the word that finds it: an eagle, an owl and a peacock,
so the county’s birds are no longer one bird; a dolphin, a hare, a boar, a bear, a
unicorn, a griffin, a dragon, a windmill, a fleece and a pickaxe. **Three new
fields**, taking it to **11** — a bordure, which is the band round the edge that
every real badge has and this generator did not, a split across, and a saltire.
Measured on a generated county of 36 clubs: **22 different symbols across 35
different crests**, and **77 of the 108 nicknames** the world draws from now name
the thing the club is called rather than falling back on a football.

**The words a name is read against gained the fixed phrases a name is made of.**
The day the league plays on is not the sun, so “… Sunday” — one of the
commonest name shapes in the county — no longer has a fifth of the world in one
crest. “Hare and Hounds” is a hare before it is a hound, the way “Fox and
Hounds” was always a fox. The Colliers work the coal and do not wear a collie, and
a horse with a horn is not a sheaf, though “corn” is the end of its name.

**A round badge closes a ring, and a patterned field gives the symbol a plate.**
The keyline that turns a circle of lettering into a badge is measured off the
lettering itself, and the symbol is fitted into the disc the ring leaves, so the
ring, the name and the drawing are one object rather than three that happen to
overlap. Where the field runs under the symbol — stripes, hoops, a sash, a
saltire — the symbol now stands on a plate of the field colour, because its ink
was chosen to read against the club’s first colour, and the middle of a patterned
field is the one place a band of the second colour is guaranteed to be beneath it.

**The lettering is set to the size it actually renders.** `GLYPH_WIDTH`, the
generator’s estimate of how wide a bold character is, was 0.54 — which is what a
*regular* weight measures at. On a crest sheet in a real browser, a run fitted to
46 units came out at 57, so the longest names were reaching the edge of their
silhouette and being clipped by it. At 0.68 a name fitted to its band lands at
101% of it: **every crest in a 205-crest sweep now sits inside its own shape**,
and a pixel sweep of 20 round badges finds no lettering drawn inside a ring.

Two drawings that spilled out of the 32-unit box the badge scales them from — a
hammer, and the new pickaxe, both of them drawn on an angle — were pulled in a
shade, so the invariant the symbol library is built on now holds for all of them.

Crests are generated from the club’s own id, so a career saved before this wears
its clubs’ crests redrawn. A badge the manager designed himself is stored on the
club, part by part, and is untouched by any of it.

### Ten silhouettes, a symbol that fills its box, and a sheet that was lying

**The crest sheet was itself the first fault.** The harness draws each crest in a
React root of its own, and `useId` only promises an id that is unique *within* a
root — so all **385 badges** on the sheet were handed the same clip path, every
`url(#…)` resolved to the first of them, and each crest on the page was clipped by
the first crest’s silhouette. The first crest happened to be an oval, which is why
a county of shields, arches and pennants read as a page of ovals whatever shape had
been planned — and why the symbols on it looked misplaced. A badge now numbers
itself from a counter, which cannot collide whatever renders it; `useId` is right
for a component drawn once in a page and wrong for anything a tool draws in cells.
The game itself was never affected: the sheet that judges the game was.

**Ten silhouettes rather than five.** An octagon, a plaque, a banner with two
tails, a gable with a shallow peak, and a wide oval join the shield, the roundel,
the oval, the arch and the pennant, and a county of forty clubs now wears ten
between them rather than five. Each is drawn so that the name band is still the
full width of the badge at the height the letters sit — a silhouette that eats a
club’s name is a fault, not a shape. A diamond was drawn as well and taken back
out again: its sides cut in at forty-five degrees, which is exactly where a run of
lettering passes, and fitting a name and a sixteen-unit symbol inside one left the
name at three and a half units of the sixty-four. The octagon is its roomy cousin
and is here instead.

**Every symbol now fills the box the badge gives it.** Each of the 61 drawings was
measured on the renderer — its ink sits where the renderer says, not where the
coordinates suggest, because curves overshoot and a stroke is in no bounding box —
and the drawings were not the same size within their own box or even in the middle
of it: the swan’s ink covered **56%** of the box and the dragon’s **98%**, so one
crest drew the swan at half the size of the other, and the ram, the hound, the
anvil, the badger and the gate sat between three and five units off centre, which
put them along one edge of every crest they were on. All of them are now centred
and grown to nine tenths of the box, measured back at **0.01 units off centre or
less**. That table is checked by the test suite, so a new symbol cannot be added
without being measured.

**A round badge’s symbol has a floor.** The ring was measured against the full
height of a capital for a line of lettering that only ever reaches *in* with a
descender — a name round the top of a badge stands its capitals up at the edge, so
the only thing it takes out of the middle is a tail and the halo round it. Holding
that much room back left a bare annulus of field and a symbol small enough to miss:
**the worst round badge drew its symbol at 13 units of 64**, a fifth of the crest.
The ring now holds a symbol of **16 units or more** whatever the name does, and the
20 round badges of the pixel sweep show 16.3 to 19.5 units with no ink inside their
rings. Where a silhouette is too narrow for the arcs to carry a large name — the
oval, the wide oval — the lettering is capped to what that shape can actually hold.

**A name is set to the size its own silhouette allows, and the sweep asks the
renderer rather than a box.** Lettering on an arc stands up outwards, so the ends
of a long run reach the narrow part of a shape; the sweep now puts every point the
ink is meant to occupy to the renderer’s own `isPointInFill` — **14,639 points** —
and it found 31 crests whose names were being quietly cropped by their silhouette.
A name cut off by the edge of its own badge looks like a mistake rather than a
fault in the generator, which is why it went unfound for so long.

**Every line on a badge is now drawn twice.** A keyline in the field’s ink
disappears the moment it crosses onto the club’s second colour, which is half of a
patterned field, and the outline round the whole crest was one dark line — so a
dark badge had no edge against a dark panel at all, and the shape that was planned
was a blob. A pale hairline over a dark line, and a halo under every keyline, reads
on any field and against any panel: the same trick the lettering has used all
along, now used by the ring, the plate, the outline inside the silhouette and the
rule under the name.

A shape is dealt from the club’s own id, so a career saved before this one has its
silhouettes re-dealt: there are ten in the bag where there were five, and a club can
only keep its crest if its shape came out of the half that did not change.

### The pitch turns with the phone, and the bench stays open

**A phone held upright was showing a football pitch squeezed into a letterbox.** The live
pitch was drawn across whatever box the score, the commentary and the control strip left it,
and on a handset held upright that box is taller than it is wide — so a sixteen-by-ten pitch
was stretched into it, the halfway line ran up the screen, and the two goals sat one on the
left of a portrait page and one on the right. The renderer now measures the box it has
actually been given and, when that box comes out portrait, draws the same picture turned a
quarter turn: the length of the pitch runs up the screen, the home goal is at the foot of it,
and the two sides attack up and down. On a 390×844 handset the pitch now fills **372×564 — an
aspect of 0.66 against a real pitch’s 0.65** — where the same afternoon on the same phone used
to be played out in a box 826×178. The box is measured rather than asked of a media query,
because what a phone gives the pitch depends on what else is on the screen and on whether the
game is installed, and a window can be dragged as well as turned.

**The turn is a rotation, so the picture cannot disagree with itself.** Where a man stands,
which way he is running and which end his side is attacking are three readings of one turn,
and `src/ui/match/pitchFrame.ts` holds all three in one place: a point of the pitch lands at
`(y, 1 − x)`, which puts the home goal at the foot of the screen and keeps the touchline on a
home player’s left on his left, and a man running at the away goal in a landscape box — a
velocity drawn at an angle of zero — is drawn a quarter turn the other way. A mirror was the
easy thing to write and was thrown away for the same reason the arrows exist: it would have
shown a manager his own side the wrong way round, his right winger on the left and every shape
he built reflected. The rules are pure functions with nothing of the browser in them, and the
tests diff them against the mirrors they are not — a rotation keeps the shape of a triangle
the same way round where a mirror reverses it — and against the drawn positions themselves, so
a heading and a pair of coordinates cannot part company. The markings turn with the picture: a
halfway line across the screen, the circle, the two penalty areas hanging off the top and the
bottom, and an arrow that now says *up*. They are the markings the preparation pitch has been
drawn with since the first day, because a vertical pitch is a vertical pitch whichever screen
asked for it. A browser harness drives a real match on a 390×844 phone, reads what the
renderer actually wrote to the DOM, turns the phone over and requires every one of the
twenty-two men, and the ball, to be exactly where the turn says they are: **worst drift
0.5 px**, which is a percentage rounded to a whole offset and nothing else.

**The bench no longer closes itself after every change.** A manager does not make one
substitution; he makes two or three in a single visit, thinking about the whole of it at once
— who is tiring, who he has left, and which of the fourteen he most wants on the pitch. The
panel used to shut the instant a change was made, so a second change meant a second journey
through the tabs and the list he had been reading was gone. It now stays open where it is: the
man who came on is off the bench, each select goes back to its placeholder ready for the next
change, the tab counts up from `Subs (0/3)` to `Subs (3/3)` without being reopened, and the
changes still left are counted at the foot of the panel until the bench is spent and says so.
The tab is still how the panel is closed, and Escape is still the other way.

A phone on its side is untouched: the box is wider than it is tall, so the pitch is drawn
across it exactly as it always was.

### A fifteen-season soak, and the chairman two clubs shared

**The soak was run over fifteen seasons on two seeds, 36 clubs in three divisions of twelve, 450
competitive fixtures a season — about nine minutes a run.** The point of it is the slow stuff, and
the slow stuff is in decent order: every season closed in 357–364 days in both runs, the ladder kept
its size and its shape through 29 and 32 folds, no club ever failed to put eleven fit men out, no
squad fell outside 20–30, no attribute left the 1–20 scale, nobody played twice in a day, and age
drift is gone — p50 27 → 26 and p90 33 → 32 where it used to climb 27 → 35 and 33 → 39. Postponements
are 4–12% of fixtures rather than the 25–30% the unbounded rearrangement used to produce. The manager's
week would have stopped for something on roughly sixty days a season (55–73), which is the Continue
button working.

**It found one real defect, and it was the same shape as the last one.** Two clubs in one town can
fold in the same summer. The replacement club's id and its random stream were already keyed on the
club being replaced — that fix is in, and its comment explains why — but the **chairman** minted
beside it was still keyed on the season and the town. The second replacement therefore overwrote the
first's chairman, both clubs named one man, and when either club folded again the fold deleted the
officials it owned and left the other naming a chairman who had gone: six `club-official-exists`
failures across four seasons of the scratch seed, with two clubs pointing at the same absent
`chm_season_2029_30_town_2`. His id is keyed on the club being replaced now, like the club's own.

The fix was measured as a clean A/B rather than a hope: the same seed, the same fifteen seasons, and
all fifteen season snapshots identical apart from their timings — squad size, ability, age, money, the
pool, goals, cards, days, postponements and folds all unchanged — with `club-official-exists` going
from six failures to none. A regression test folds two clubs in one town and holds that the two
chairmen are distinct men who are both still in the world.

**What the runs leave open is drift, and it is the design's to answer.** Three things, each measured
and each reported rather than patched, because every one of them would change the world a manager
plays in and none of them is obviously wrong:

- **The unattached pool opens too full.** A summer trims the pool to the cap (0.8 a club — 29 men for
  36 clubs) and then adds that summer's arrivals back, which holds the settled pool at 42–54 with no
  lean either way over fifteen seasons. But the world is *generated* with 74 men — 3.36 a town, from
  a default of two to four — while the summer refresh arrives at 0.77 a town, so the first summer
  sheds a third of the pool and every season after it is read against a number the world never
  returns to. It is the only recurring failure in both runs, and every case is on the low side.
- **The ladder flattens.** County-wide ability barely moves now (+2.4% to +3.0% over fifteen seasons,
  against the +8–9% it used to), but division 3 rose 6.1% in one seed and 3.1% in the other while
  division 1 was flat, the spread narrowed across both runs, and the top two
  divisions once came within 0.14 of each other — under the separation the pyramid is asked to keep.
  The reason is legible: the ladder is stratified by *sorting* the generated clubs on reputation and
  cutting from the top, and nothing afterwards treats the divisions differently — reputation only
  falls (in administration) or is set from the squad, finishing higher earns nothing, and the club
  that replaces a folded club is given a reputation drawn from its **town** rather than from the
  division it is entering, so the rung that churns hardest is the rung that climbs.
- **Money churns hard.** Mean balance 1,483–1,588 → 12,230–17,517 and the largest balance 4,633 →
  88,745, while 4–11 clubs sat in the red every season and 29–32 clubs folded — about two a season,
  one club in seventeen. The cycle is working as designed and the ladder never lost its size, but it
  is the largest single source of noise in the world, and it is also what re-stocks the bottom tier
  above.

Everything the soak measures, and how to read the report, is in `SOAK.md`.

### A new club plays at the standard of the division it enters

**A replacement club was minted at its town's standard rather than its division's.** A newly formed
club's squad, its finances and its standing all come out of one number — its `reputation` — and that
number was a fresh draw on the *town* it stood in (`reputationForTown`), with no reference at all to
the division whose place it was taking. Measured on a generated county, the gap that opens is not a
nicety: the bottom division's clubs stand at 24–38 with a median of 33, while the town draws for
those same clubs run 25–41. A club folding in Division Three was routinely replaced by a side of
Division Two's standard, and a new club could arrive above or below the rung it had joined. Since
the bottom rung is the one that churns — it is the rung with the least money in it — the rung that
churned hardest was the rung that climbed: over fifteen seasons of the soak, division 3 rose 6.1%
and 3.1% in the two seeds while division 1 was flat, the spread narrowed every season, and the top
two divisions once came within 0.14 of each other when the pyramid is asked to keep them at least
0.159 apart.

**The standard is read off the division now.** `divisionStanding()` takes the median of the clubs
already in the division the new club is stepping into, the roll around that median is small, and the
result is clamped to that division's own band, so a replacement can never arrive outside the rung it
is joining. The town draw survives only as the fallback for a division emptied in one pass; the town
still decides the new club's name, its ground and its place.

**The top two divisions stop converging** — which is the question the soak was asked, on both seeds.
Neither seed breaks `tier-stratification` or `tier-ability-stable` any more (two tier failures became
none), the narrowest gap between the top two rungs roughly doubled (0.140 → 0.280, and 0.230 →
0.350), and the bottom rung's climb, which was the whole of the flattening, is gone: division 3 went
from +6.1% to +2.3% in one seed and from +3.1% to +2.8% in the other, with the county-wide drift
falling from +3.0% to +2.0% and from +2.4% to +1.9% behind it. In `soak-scratch` the top two rungs now
move *apart* over the career (0.31 → 0.38); in `soak` a slow narrowing remains, from twice as far out,
and it never comes near the band. Drift between the divisions is now the same size as drift within
the county, which is what a ladder held up by its own members should look like. With this in, the
only thing either seed still fails is the unattached pool's opening size — a generation baseline
rather than a fault, and a decision of its own.

**One side effect worth knowing.** A replacement now takes its division's *finances* as well as its
football: `buildFinances` is scaled by standing, so the bottom rung's new clubs are poorer than the
town average they used to be minted at. Clubs in the red went from 110 to 112 warnings in one seed
and from 96 to 108 in the other, and folds from 32 to 32 and from 29 to 33. That is the fold cycle
working from a truer picture rather than a new fault, but it is the same knob the finance tuning is
about.

Regression tests: `clubLifecycle.test.ts` — a rung set to a single standard hands its replacement
exactly that standard, and `divisionStanding` reads the median, the band, and only the living.

## [0.9.0] - 2026-10-07 — a county worth believing in

### Touchline, and the first boot

The football simulation underneath the game has a name, and the game says it once.
**Touchline** is this project's own match engine — one set of laws, one record the
rest of the game reads — and it is introduced on a short startup sequence the first
time the game is opened with nothing saved: the mark, the name, what it is, then the
SE27 wordmark, then the menu.

**It is a startup rather than a loading screen, and it cannot become one.** It is
shown once and never again, it can be skipped with a button or dismissed with Escape,
and a manager who already has a career saved does not see it at all — somebody with a
season on disk has met the game already. Nothing is being loaded while it is on
screen, and opening an existing career still goes through exactly the same
save-loading screen it always did.

**Touchline has a mark, and it is the thing itself.** The touchline — the side line
of the pitch — runs the length of it and arrives at its corner, where the goal line
turns up out of it and the corner arc curves into the field of play: one line, one
corner, and the quarter circle that exists in no other game. No ball, no boot and no
whistle, which is the point of it. It is drawn to the game’s own rule for a mark —
three strokes, one weight, one colour, the same green as the icons and the wordmark —
and the name is set in the game’s own type beneath it, so the two read as one lockup
rather than as a logo with a caption.

The credits gained a band of their own for it, between the game’s mark and the
list of who did what: the mark, the name, and "Authoritative Football Simulation
System". Touchline is this project’s own simulation rather than a third-party
engine, and the credits say only that. With reduced motion on, the sequence holds for
a beat with nothing moving, as everything else in the game does.

### Forty worlds, and a county with room for one of them

The seed line at world generation used to offer four worlds, all of them the same
four. It now opens on a seed rolled for the visit, offers **nine** picked from a
list of **forty**, and carries an **Another one** button that invents a fresh one
and puts it straight in the box — a roller of its own, built from a local
vocabulary of places, nouns and prefixes that is deliberately kept apart from the
game's own name pools, so a seed never changes meaning when a name list does.

A county has room for all of it: **18–24 towns instead of a dozen**, and
**100–170 businesses** to fill them, with the trades weighted the way a place
actually has them rather than drawn from a flat list. Club names gain real shapes
— `{town} Working Men's Club`, `British Legion`, `FC {town}`, `{town} North End`,
`St Aldhelm's` — and grounds, mottos, settlement descriptions and the
abbreviations a team sheet prints all grew with them. A county can be read as a
place in its own right: a county name, a region, a market town and eighteen
others that do not rhyme with the last county you played in.

### A county of strangers

The pools behind a player stopped being a small cast with a few variations. There
are now **340 first names, 1172 surnames, 99 nicknames and 174 day jobs**, with
the place-name stems alone numbering 692. Measured on a generated county, a
single world produces **more than 300 distinct first names and 600 distinct
surnames** across its players — two counties built from two seeds shared almost
nothing.

### The kit, the crest and the colour

**32 kit makers**, up from ten, over 46 change colours and 38 goalkeeper colours,
with the pattern weights rebalanced. A new rule makes the away kit honest: when a
club's colours are too close to play against the home side, the visitors are
handed the strip furthest from the host rather than falling back on a
goalkeeper's. All 35 shirt pairings now clear the minimum colour distance, and
33 of 35 put the away side in its away strip.

**48 badge devices**, up from 34, each with a drawing and the keyword that finds
it, plus 24 generic devices for a club with no story to tell. **53 club colour
pairs** — one of which was a literal duplicate of another, so one combination was
never reachable; it is replaced, and the pool is now under a test that the pairs
are all distinct.

Crests were clustering, and the reason was worth finding: the plan read low bits
of a club's id (`seed % n`, `seed >>> 9`), and those bits are correlated across
forty sequential ids — so forty anonymous clubs wore fourteen different crests.
Three independent hashes on the club's own key put that at twenty-plus.

### News and commentary, said every way the facts allow

Every news writer now has **three to six phrasings** of its headline and of its
body, with sub-pools for the timescale, the scorers, the crowd, the opener, the
closer, the reason and the rearrangement. Commentary has **22 phrasing pools**
covering every event type, so a throw-in, a foul, a tackle, an offside, a save and
a block are each said several ways across a match rather than once.

**The prose is deterministic, and that is deliberate.** News and commentary are
written more than once for the same fact — on a replay, and again on the way into
the inbox — so each choice is a hash of the *identity of the fact* (the event's
id, plus which slot it is filling) instead of a dice roll: same fact, same
sentence, whenever it is read. The rule lives in one place, `src/simulation/prose.ts`.
A template that asks for a fact it was not given now throws rather than writing a
sentence that has quietly lost a number, and a headline is capitalised on the way
out, which is how "a rolled ankle for Gaz Thorne" stopped leading the news.

### The ledger news, and four things that were only going to get worse

Each of these was found by measuring the generator rather than by reading it.

- **Businesses repeated inside one town** — three "Mapside Social Club"s in a
  place of eight thousand. A town now holds its own used set, and a name it has
  already spent is refused and redrawn.
- **Club backing collapsed** when the free-name window widened: pub- and
  business-backed clubs fell to a quarter of the county, and the staff and
  sponsorship tests caught it. Backing is a weighted draw again, at just over half
  the clubs, with the chairmen who own their own club still a minority.
- **A player's manager had no relationships.** The manager you take into a career
  replaces the generated one at the moment the career starts — after the links had
  already been made, and against a man who is no longer there — so your committee
  began the season with no ties to you. It is linked at the point of replacement
  now.
- **Finance news printed `£-42.75`,** and a hand-written `£` in a template meant
  the number carried its own sign. Money formats its own symbol, and the
  templates stop adding one.

### The team sheet, driven the way a manager drives it

The team sheet was rebuilt around the pitch. The layout is now one column that
answers to the window: the grass hugs the left of the content column and is drawn
from its height, the substitutes' strip squares off against its right-hand edge
with each man's surname at the size of a man on the pitch, and the squad list
takes everything left over. A phone gets the pitch across the screen with the
list as a sheet over it, and a window too short for a team sheet at all now keeps
a usable pitch and scrolls instead of drawing one where eleven shirts sit on top
of each other. The panel between the pitch and the list — and the heading and the
two-line explanation that sat over twenty names — are gone.

Dragging is the way a team is picked, and four things it could not do are fixed
at the root: a press on a shirt was being eaten by the button around it (the dot
being dragged is the dot now); a starter dropped on a full bench did nothing,
when the substitution the manager writes down is exactly that; an overlay named
`.pitch__box` was rendering two black rectangles over the penalty areas (the
overlay is `.pitch__panel`, and a browser check pins it); and a click that
followed a drag still opened the man's page.

**Selection and Tactics now draw the same pitch.** The player markers on both
screens come from one diagram helper, so the shirt, the name label and the
position vocabulary cannot drift apart between two screens that mean the same
thing — and the tactics diagram is driven by the instruction tabs themselves, so
one control moves the picture and the settings together. The Manager screen lost
its disclosures and its repeated dropdowns: identity is stated once in a hero
band, and job, record and honours are real panels.

### The header, and two hands on the clock

The band of facts between the team sheet's heading and the pitch — *Starting XI*,
*Substitutes*, *Captain*, *Problems*, the phone's *The squad* — is deleted, from
the view and from the sheet. It was the only thing between the heading and the
work, and on a phone it was two wrapped rows of chrome above a pitch that is
supposed to be the screen. Nothing was lost: the eleven and the bench are counted
by the dots, the strip says `Subs (n/5)`, and the state of the selection is the
warning icon on the grass, where the manager is already looking. Formation,
captain and *Ask the assistant to pick* are one row in the header's action slot,
and the pitch gets the band's height back.

**Continue and the calendar move time, and nothing else does.** *Go to the match*
is gone from the team sheet and from the calendar dialog, where its whole job was
a third way to lose days beside a day strip and a day jump that already reach the
same Sunday. What is left is the calendar doing its own job: pick the matchday,
`Go to this day`, and the clock lands on it — after which the command bar is
showing `PLAY THE MATCH`, which is the whole route to a match now. Two source
contracts in the tuning tests pin it: only the command actions and the calendar
dialog may move the clock, and neither the calendar nor the team sheet may carry
the shortcut.

## [0.8.0] - 2026-10-06 — two engines, one football

### Two ways to play a fixture

A fixture nobody watches no longer costs what a fixture somebody watches costs.
Every match the manager's club is not involved in — the rest of his own matchday,
and every other club's season — is now decided by a **background mode**: an
abstract model that walks the match a minute at a time from the same team
strengths, the same tactics, the same conditions and the same player attributes as
the full engine, and writes the identical record — the score, the goalscorers and
assists, the cards, the knocks, the substitutions and the per-player statistics the
season accumulates. It renders nothing, narrates nothing and moves nobody, because
nobody is watching it; that is exactly why it is fast. A whole division's Sunday
costs a few tens of milliseconds rather than a minute.

**Which mode plays a fixture is a property of the fixture, decided in one place.**
A match the manager's club is involved in is the full engine, always — watched,
played out at speed, or sent to the bench — and every other match is the
background model. The mode is stamped onto the match record, so nobody has to
infer it, and an old save that carries none loads as the full engine, which is
what played it.

**Nothing downstream knows or cares which mode decided a game.** The league
table, the cup, the finances, the suspensions, the record books and a player's
career all read the match record rather than the simulation, so a season does not
depend on which fixtures the manager happened to watch. The full engine is neither
replaced nor simplified: it remains the football he sees. `npm run benchmark` times
the two against the same fixtures and prints their fingerprints side by side —
goals, shots, fouls, bookings, knocks, substitutions, appearances, pass completion,
mean rating — which is how the calibration is kept honest, and `MATCH_ENGINE.md`
now opens with the two modes.

### Ability and goals stop creeping over a career

The fifteen-season soak had been flagging the same thing for a while: the longer a
career ran, the better the county got and the more prolific its matches — about
eight or nine per cent of ability and ten to eighteen per cent more goals, with the
spread of the league narrowing as it went. Two leaks, and they were the same
mistake twice: **an arrival was better than the club it joined.**

**A club now knows the level it plays at, and it is read from its standing rather
than from the squad it happens to have.** The summer's signings, the youth intake
and the journeyman top-up are all generated against that one figure, and a club
never signs a man better than the club itself is. A side below its standard can
climb back to it; a side above it cannot keep climbing, because there is nothing
above the standard to sign — so thirty-six clubs can no longer ratchet each other
upward every summer, which is what an inflated county looked like.

**An arrival is one player, not an average.** A squad the world generator built
drew every man at the club's level *plus his own roll of the dice*; an arrival
generated at the average with no roll had none, so a side topped up through the
summer quietly lost its top end — and its keeper, the one man who is not a team
average, first. Arrivals draw the same roll now, and the squad that leaves the
summer has the spread of the one that was generated.

Over the same fifteen seasons, ability drift falls from eight or nine per cent to
one to three, the spread holds instead of collapsing, and goals are flat on two of
the three soak seeds; the third still creeps by about nine per cent between the
first half of a career and the second, and that is the outstanding item.

### Four ways a season failed to finish

Each of these was found by playing careers forward rather than by reading the code.

**League fixtures landed on the wrong Sunday.** The season calendar is ordered by
*date*, and a cup round sits on the Sunday before the league matchday that follows
it, so its matchday number is out of order in the list. Fixtures were dated by
their position in that list, which put every league matchday after the first
interleaved cup round on the wrong day — league games on cup nights, and cup rounds
onto days already played. A fixture now reads its date by its own matchday.

**A cup round could be drawn for the very day it was meant to be played, and so
never played at all,** because a round is drawn in the same day's processing as the
tie that completed the round before it. A slot has to be genuinely ahead of today
now, not merely today.

**A congested spring could silently lose a round.** The search for a free field
gave up after thirty days, and a round that needed thirty-two was never drawn: the
competition stopped, with a winner nobody named and an honour nobody collected. The
search now runs to the rearrangement deadline the season already imposes.

**A season could open before the season before it had closed.** A year carrying a
back-log of rearranged fixtures ends a week or two past its calendar, and the next
pre-season opened on a fixed date regardless — winding the clock backwards. The
opener steps on a week at a time until it is genuinely after the football already
played.

The pitch is no longer a weekly standing cost, either. A club pays for a ground on
the days it actually plays at home — its own when it is at home, somebody else's
when it is borrowing — so a week without a home fixture no longer bills it for a
pitch nobody used.

### The pyramid folds all the way down, and one club is replaced by one club

**Administration and folding ran on the top division only,** so a club in the
third tier could lose money for ever and never be wound up. Every division is
reviewed now. A newly formed club is also shaped in the ladder the new season is
actually built from, rather than pushed into last season's competition records —
which is how a replacement once ended up in no division at all and with no season
record to archive.

A replacement is keyed on **the club it replaces rather than the town**: a town can
hold more than one club, and when two of them folded in the same summer the game
minted the same replacement twice — one id pushed into the division twice, one club
booked into two fixtures on the same day, and both replacements sharing a name
because they drew from one stream.

### A man who leaves the world leaves his threads too

Deleting somebody now clears them from the communication threads that named them,
the twin of what already happened to their relationships. The save loader pruned
participants on load, so a running career and a reloaded one disagreed about who
was in a conversation; they agree now. A thread the manager is left holding still
reads, and keeps its messages, but goes quiet.

### A sponsorship figure follows the business and the division

The tier factor is a **level** — what a first-division backer is worth against a
third-division one — not a growth rate, and a renewal now re-derives the instalment
from the business and the club's division instead of multiplying the last one by
the factor: a well-run club's deal moves with its standing rather than compounding
by forty per cent a summer. **A payment that arrives clears the run of missed
payments,** which is what "if it keeps happening" always meant — never resetting it
accumulated to three and a half misses a season, so nearly every weekly sponsor
walked within a year whatever the club did. And a club without a sponsor looks
harder for one: the old odds were low enough that coverage decayed season on
season, and a club with no backer runs at a loss it cannot close.

### Cutting a release is one command that insists on the order

`npm run release` does the six steps that only work in one order — each of which
has a way of being half-done: it bumps the version, folds `## [Unreleased]` into a
dated heading, runs the guard that the changelog's first version is the one being
built, builds, reads the number back out of the built bundle so a stale build
cannot ship under a new one, commits before deploying so Cloudflare records the
commit it is serving, deploys, and tags the commit that shipped. It stops at the
first thing that does not check out, leaving the tree exactly as it found it.
`--dry-run` rehearses it, `--no-deploy` stops after the commit, and `--push` sends
the branch and tag on.

The test suite is split in two, named once in `vitest.patterns.ts` so neither half
can drift: `npm test` is the fast check a person runs on every change, `npm run
test:slow` is the match-engine and season-loop suites that are minutes of football,
and `npm run test:all` is both.

## [0.7.0] - 2026-10-06 — the people who run the club

### A Club screen, and one answer to "what needs me"

The **Club** area now opens with a **Club** screen that answers the three
questions a manager actually has about the organisation he has joined: who runs
this place, where does it stand, and what needs him. It reads the committee out
of the staff records — a role, a name, whether they are around, one word for how
good they are at that job, and only where there is one, the single thing they are
currently carrying — and it lists the club's standing as four numbers pulled
from the league, the squad, the ledger and the sponsorship agreement.

**Home and Club now share one list of what matters,** so they cannot disagree
about it. Every card is a door: it opens the thread that is already waiting, the
conversation with the man responsible, or the screen where the fact is dealt
with — scrolled to the relevant part and with focus handed to it, so a keyboard
or screen-reader user is taken there too. Only `urgent` and `important` messages
ever earn a card, and the list is capped, because a dashboard that shows
everything shows nothing.

The **Finances** screen gained **The outlook**: the warnings the treasurer is
carrying and the next six weeks of known commitments side by side. The figures
come from a read-only projection over the calendar's own recurring rules and the
club's configured costs, sharing its arithmetic with the ledger itself, so what
the club is told it will owe is what it is actually billed. **Staff** gained the
same per-person issue line, so an office that is carrying something says so in
one sentence rather than hiding it in a section of its own.

No attributes were added to any screen. A manager still learns a physio is
strong with ankles, not that his coaching is 12.

### Events reach the manager through the person responsible

**Communication is now the consequence layer over the rest of the club.** An
event that happens in another system — a fixture the league has moved, a sub
liability raised by a match, a club sliding into the red, a sponsor whose deal is
running out, a physio who cannot come in — is noticed by whoever is responsible
for it, and the manager hears about it from that person. Nobody new answers a
question: the treasurer still reads the ledger, the secretary the desk, the
chairman the committee. What is new is that they now speak up on their own when
the systems they keep actually change.

This is deliberately not a feed. A busy week can be silent, and a quiet one can
bring one message that matters; the coach no longer texts the same sentence every
Thursday, and "nothing out of the ordinary" is no longer news. Every announcement
carries the key of the fact that caused it, and a save reloaded on the same day
writes nothing — the keys live on the messages themselves, so there is no second
index to keep in step.

**Only significant moments become club history.** An overdraft, a serious word
from the committee, a sponsor arriving or walking out are written into the club's
permanent record beside its promotions; a knock, a doubt or a note about subs
stays in the thread where it was said. The sponsor moments are recorded by the
sponsorship system itself, where the deal actually changes, exactly as every
other consequence in the game is.

### The manager can talk to the people who run the club

The **Communication system now reaches the club's own officers**. The treasurer,
the secretary, the chairman, the assistant, the coach, the physio and the scout
all have a thread, and what they say is read out of the system that already owns
the fact — the manager can ask the treasurer how the books look and get the real
balance, ask the secretary what the league has sent and get the actual letter,
ask the chairman what he expects and get the committee's own view. It is the
*same* inbox, the same threads and the same message shape as talking to a player;
no separate screens, and no second messaging system.

Nobody in this layer invents anything. Every answer is a reading of the ledger,
the secretary's desk, the chairman's expectations, the physio's report or the
sponsorship record, and a message only ever *acts* where the manager has
explicitly invoked a domain action — asking the chairman to back the club runs
the existing backing mechanism, and asking the treasurer about the bills settles
the invoice through the ledger. A man saying he will pay still does not pay.

Incoming messages are **event-driven and rare**: the treasurer raises a worry
once a season, the chairman writes when a concern is real, the secretary passes
on what actually needs the manager, and the staff speak when there is something
to say. Each is keyed to the fact that caused it, so a reloaded save or a day
visited twice writes nothing new. Messages now carry a **priority** —
`urgent`, `important`, `normal` or `social` — and only the first two are allowed
to push their way to the top of the inbox.

### A sponsor is somebody, not a number

Sponsorship is a **relationship** now, not the `sponsorIncomePerWeek` modifier it
used to be. A deal is real: it names a business that already exists in the world
— the same pub, builder or garage a club is named after — and records the club,
the start and end dates, the instalment, its terms, a status, a reputation fit
and the sponsor's goodwill toward the club. A business can back a club without
the club carrying a sponsor at all, and a club that loses one can go without
until it finds another.

It runs through a lifecycle: a club looks for a sponsor, accepts an offer, the
deal goes active and pays, comes up for renewal at the end of its term, and can
lapse or be replaced. The manager can see all of it from the Club's finances —
the current sponsor, the income, the renewal date and any single pressing issue
— without a commercial dashboard.

Every instalment is **one ledger line**, dated by the agreement and keyed to it,
so a day is never paid twice and the books stay the only authority on money. The
old weekly `rec_sponsor` calendar rule and the `applySponsorship` weekly charge
are gone: the agreement decides when a payment is due. A payment can be missed,
which dents the sponsor's goodwill and, if it keeps happening, ends the deal. The
sponsor's goodwill moves through the existing relationship service between the
manager and the chairman who own the decision, and nothing else.

### Matchday subs, not a weekly squad tax

Player subs are a **matchday liability** now. A man is charged for the match he
actually played, from the Match Engine's own participation record — a starter
pays the full starter rate, a substitute who came on pays the reduced rate, and
an unused substitute, an unselected player or an unavailable one pays nothing.
Squad membership on its own no longer creates a debt.

Each match raises its own liability against the player who played it, so a man
can owe from several games at once and the club can always say why: £5 from the
Saturday cup tie, £3 from Sunday. Payment is applied to the oldest outstanding
liability first, so a part payment settles one match and leaves the rest
standing, and the history stays.

The Friday squad-wide settlement is gone, along with the weekly subs line and
the `rec_subs` calendar rule: the calendar can no longer generate player sub
income on its own. Club finances carry configurable `starterSubAmount` and
`substituteSubAmount` (£5 / £3 by default). Old saves migrate to the matchday
rates and keep any balance they already had, without inventing participation
they never recorded.

### The club's books now add up

Finance has been corrected so that every displayed figure is a real ledger
line, dated by the calendar event that caused it, and no balance is calculated
anywhere but in the ledger.

- **Training is a real cost.** `trainingCostPerWeek` is charged on the night the
  session is actually held — never by a UI projection, and never when the
  session is cancelled or moved into a hall the club already paid for.
- **Sponsorship has one schedule.** It is weekly, on the calendar's own Friday,
  everywhere: the rule, the ledger and the UI. The stray monthly rule is gone.
- **No settlement at kick-off of a career.** A new club no longer pays a whole
  week of costs and takes a week of sponsorship on the Monday it is created;
  money moves only when its calendar events actually fall due.
- **The ledger is the balance.** `openingBalance + sum(ledger)` always equals
  the stored balance, even after the oldest lines are folded away, and an old
  save is given an opening balance that makes its existing book add up.

### The committee is made of people

The club has a **personnel system** now. Assistant, coach, physio, secretary,
treasurer, scout and volunteer are real roles held by real people, not a list of
words in the data. A staff member is an ordinary `Person` — his own name, age,
day job, reputation and notes — carrying only the few attributes his role
actually cares about, and his relationship with you runs through the same
relationship system as everybody else's.

Clubs are staffed *plausibly*, not professionally. A Sunday club might have a
secretary and nothing else; another a player-manager with a volunteer coach; a
bigger one a physio and a scout. One man can hold two roles — the chairman who
keeps the books, the secretary who turns out at right back — and a player-manager
is the same person on the pitch and in the dugout, never a duplicate record.

The committee turns over with the seasons: a year on everybody's clock, a few men
stepping down or retiring, and the posts they leave behind filled from the town —
never leaving the club pointing at somebody who has gone. There is a new
**Staff** screen under **Club** showing who is on the committee, what role they
hold, how good they are in it, whether they are around, and how you get on.

Board and governance are deliberately left as vocabulary for now: the people
and the structure exist, their gameplay does not yet.

### The committee now changes the football

Staff are not just names on a screen any more. They feed the systems that were
already running, and nothing they do re-implements one of them.

- **The coach runs the session.** If a club has a coach who is around, he takes
  Thursday night; the assistant covers when he cannot, and the manager does it
  himself when there is nobody else. The session's quality — the number the whole
  training system already turns on — moves with whoever ends up with the bibs.
- **The assistant gives you a read.** Advice you can act on: knocks, fitness,
  form, and where the squad is thin. A better assistant sees more of it. It is
  advice, and it never acts on its own.
- **The physio gets men back quicker.** His competence speeds up the *fitness* a
  man regains, and he gives you an estimate of how long a knock will keep
  somebody out — closer and more confident the better he is. He does not touch
  the injury itself: the countdown stays the body's, so a ten-day injury is still
  ten days wherever the man plays.
- **The scout brings back names.** A scout goes and watches somebody and reports
  through the same recruitment knowledge graph as every other source, landing on
  the candidate list you already use. A better scout travels further, watches
  more often, and comes back with a fuller, truer read.
- **The committee has its own week.** Staff can be unavailable — a shift, a
  holiday, a family do — on the same weekly roll that already runs for players.
  Being a man down never removes the role or stops the club: it just makes the
  week a little harder.

Honest boundary: the injury clock is deliberately left alone, so a physio
improves fitness and diagnosis rather than shortening an injury's length.

### The treasurer keeps the book

The committee had a treasurer on it and nothing for him to do. He has the job now,
and it is deliberately small: money still moves only through Finance.

- **The book has a name on it.** The club can say who is responsible for its
  money — the appointed treasurer, or the manager when the club is too small to
  have both, which is the ordinary Sunday case. A man who does both jobs is shown
  as exactly that, and a club with nobody in the role still trades.
- **Owed is not income, and it shows.** The finance screen keeps the money players
  *owe* visibly apart from the money the club *has*: an outstanding total beside
  the balance, per-man arrears with the match each goes back to, and the
  treasurer's own worries — an overdrawn account, a thin one, arrears — put into
  words rather than left buried in the ledger.
- **Collecting is one press.** A man who owes can be taken in full or in part, and
  the money is booked through the one door that turns a debt into income. The
  amount is clamped to what he actually owes, a part payment settles his oldest
  match first, and taking the same sub twice cannot book the same pound twice.
- **The bills stay where they were.** Pitch hire, insurance, referees, league fees
  and fines are still calculated and paid by Finance on their own dates. The
  treasurer operates those costs; he does not duplicate a single one of them.

### The secretary keeps the paperwork

Every club has administration nobody watches: registrations, league deadlines,
AGMs, cup entry forms, a suspension the county has confirmed, a fixture the
league has moved. The secretary now handles it, and — more importantly — decides
what is worth putting in front of the manager.

- **An inbox, not a second rulebook.** Correspondence lives on the club's own
desk, kept with the career. A fixture change is still read out of the fixture
record and an AGM off the season's dates: the secretary writes the letter, and
never a fixture, a result or a calendar entry.
- **The noise is filtered.** A competent secretary files the routine bulletins
himself and leaves only what the manager genuinely has to decide. A poor one lets
it all pile up, which is exactly the extra work the role exists to prevent.
- **Good men give you warning.** Competence buys lead time: a strong secretary
puts the registration deadline, the league AGM and the club AGM in front of the
manager days early, while a poor one — or a club with nobody in the post —
delivers them on the day. An absent secretary receives nothing until he is back,
and then the post arrives late.
- **Deadlines bite, but never the save.** An item whose date passes untouched is
marked missed and reported. Nothing a bad secretary does can move a fixture,
change a table or touch the books: the worst he can cost is the manager's time.

### The chairman takes a view

The man in the chair has an opinion now, and it is built entirely from things
the game already knows. No hidden approval percentage, no confidence meter, no
second relationship system: the chairman is a real official with a real
relationship to the manager, and governance is the small layer that lets him
use it.

- **Expectations are read off the club, not stored.** League position against
  the club's own standing, staying solvent, a settled dressing room, enough
  players, holding the club's reputation, a cup run where there is one. Change
  the club and the expectations change with it; nothing drifts out of step.
- **Standing is a handful of words.** *Behind you*, *content*, *concerned*, a
  *warning*, *under pressure* — reviewed at the season boundary from the finish,
  the books, the chairman's relationship with the manager and his own patience.
  One bad result is never a referendum, and dismissal takes a sustained run below
  expectation or years in the red.
- **He reacts through the relationship he already has.** Praise and concern are
  ordinary relationship events with the chairman as the actor, so the relationship
  the manager and chairman share is the same one everybody else has.
- **The AGM runs through the secretary's desk.** The governance record reads the
  club AGM the secretary already holds, dated off the calendar's own last fixture,
  rather than inventing a second meeting or a second calendar.
- **Rare, bounded intervention.** A chairman deep in his own patience may put
  money in to clear a debt — once a season, bounded by what is owed and the club's
  scale, and only through the treasurer's ledger. There is no free money.
- **History keeps only what matters.** A warning, formal pressure, a refusal, a
  dismissal: the serious ones are written into the club's own history. A quiet
  word stays a conversation.

The manager sees all of it in the Staff screen's *The chairman* panel:
who he is, what he expects, what is worrying him, and the matters of record.

### Matchdays counted against the league

The header no longer calls a twenty-two-matchday league "thirty-three
matchdays". The season calendar counts the cup rounds as well as the league's
Sundays, and every **matchday X of N** — the command bar, the Club screen and
the overview — was reading the whole calendar, so the season looked half again
as long as it is. They all count the league's matchdays now.

The game's own wording about the cups has been put right as well: a round is
played on the free Sunday of the off-week, not midweek. Only a rearranged tie
moves to an evening in the week.

### The weeks left, in weeks

The weeks remaining on the books is a count of calendar weeks now, not of
matchdays. A manager's net is a weekly figure — pitch hire, insurance and the
hall come round every seven days, and a weekly sponsor pays on the same beat —
so the number he multiplies it by has to be weeks. The league's twenty-two
Sundays sit inside a season of more than thirty weeks, and counting them left
the budget short by every week between fixtures.

### Messages stays in reach

Messages is pinned to the foot of the sidebar on a desktop, below the sections
that scroll. It used to sit high in the list, which was fine until the list grew
long enough to scroll: the one destination that can be waiting on the manager
without his knowing would then be the one that had scrolled out of reach. The
badge rides with it, so the count is visible from wherever he is on the page.

### No badge on the thread he is reading

Writing to a player with his thread already open left the reply unread, so the
conversation on screen carried a count the manager could only clear by opening
the thread he was already in — which opening it again cannot do. A thread the
manager is reading is read now: writing in it leaves no badge, and neither does
a reply that lands in it while he sits there, which is how a promised answer
turns up days after he asked for it.

### Where the book is heading

The weeks left are no longer just a number: the money tile on the overview and a
new **Heading for** figure on the Finances screen carry the balance forward at
the club's weekly rate, to the end of the season. It is a run rate and it is
labelled as one — a cup run, the subs still to be collected and the equipment
kitty are all outside it, because none of them is money the club is due on a
schedule.

### A sponsor can pay by the month

A business now brings its own cadence to a sponsorship. A builder, a garage or a
plumber runs on invoices and pays on the 28th; a pub, a café or a butcher pays on
the Friday, as before. The club takes what it is offered — it cannot ask a trade
to start paying weekly — and every prospect on the club screen now says which it
would be before the manager approaches it.

A monthly deal is the same money over a year as a weekly one, in twelve
instalments instead of fifty-two, and the instalment it agrees lands through the
ordinary payment path: the same ledger line, on the agreed payday, once and only
once. The club's weekly figures — the money tiles, the Finances screen and the
kit — now average a monthly instalment to a week, so a monthly sponsor no longer
looks four times richer one day a month and absent the rest.

## [0.6.0] - 2026-10-05 — two cups that finish, and a season that lasts the year

### Two cups that actually finish

The knockout structure is rebuilt around the two competitions sharing one set of
losers, so that a tie always has a winner and a round always completes.

- **The Main Cup opens with a preliminary.** Thirty-six clubs do not fit a
  knockout without byes, and pairing them blind produced a round of nine and
  then a round of five. The bottom of the ladder now plays a preliminary of
  eight; the four who win join the other twenty-eight on a bye to make a round of
  thirty-two, and it runs clean from there — 32, 16, 8, 4, 2 — for **35 ties**,
  with every club playing at least twice before it can be knocked out.
- **The Plate is fed from both opening rounds.** The four who lose the
  preliminary and the sixteen who lose the round of thirty-two are twenty clubs;
  eight of them play a Plate preliminary — the preliminary losers have to be in
  it, or they walk into the second round without playing for it — and the other
  twelve take a bye into a round of sixteen. **19 ties**, and **54 across both**.
- **Rounds are named, not numbered.** *Preliminary Round*, *Round of 32*, *Last
  16*, *Quarter-finals*, *Semi-finals*, *Final*, read off the competition's own
  plan rather than counted off ties — the same eight clubs are the quarter-finals
  in one round and the preliminary in another, and only the plan knows which.
- **Three bugs that stopped a round ever finishing**, all found in one real
  career where a single tie went unplayed from September to November:
  - The season calendar was sorted by matchday number rather than by date, so
    the cup rounds — numbered above the league's — read as though February came
    before September, and fixture lists met cup ties dated in the past. Nothing
    ever plays a fixture that has already been.
  - A round drawn during pre-season fell back to "the next free Wednesday from
    today", which could be before the season had even started.
  - The guard that decides whether a round keeps its own date demanded three
    clear days, which a slot ten days away never satisfied — so the round settled
    for a Saturday the clock then stepped straight over.
- **A postponed fixture now shows as P-P**, in the cup, the league table and the
  schedule alike: the reason it was called off, the date the replay has been
  moved to, and the replay listed as a fixture in its own right. It used to be
  dropped from the round entirely, which made a round waiting on one look
  identical to a round the simulation had forgotten.
- **A pitch can be bad without being unplayable.** Ground quality used to be
  subtracted from the flood risk as a flat offset, so the worst pitches in the
  county computed as waterlogged *in clear weather* — there was no date on which
  those fixtures could ever be played. Drainage now scales the wetness rather
  than inventing water, and a fixture called off three times is abandoned instead
  of being rearranged for the fourth.
- **And the P-P row did not break the other ones.** Naming a grid area on the
  shared fixture row applied it to *every* fixture, and a row with no
  `grid-template-areas` to resolve the name against collapses its children into
  one cell — so the moment postponements went in, every league and cup fixture
  that had not been called off rendered its two club names on top of each other.
  The areas are scoped to the row that declares the template.
### The header, put back together

Three things in the bar across the top, all of them visible the moment the game
opens.

- **The next match is one line.** The opponent, the date and kick-off, the
  competition and the venue sat on two lines, which cost a whole extra row of
  the bar for no reason — the band was 895 pixels wide holding about 570 pixels of
  text. It is now a single line and the bar is 18 pixels shorter, which is a row
  of the screen given back to the game. The comment in the stylesheet claimed the
  facts needed their own line "so they were not squeezed"; measuring them showed
  they never were.
- **And that line is centred, with the facts against the right-hand edge.** The
  band aligned its contents on their *baselines*, which is right for reading and
  wrong for the box — the shorter row of facts sat high in it. They are centred
  now, and the fixture takes the slack between itself and the facts so the facts
  end against the edge rather than trailing the club name.
- **The gap between the search box and the date is gone.** Both used to claim
  `margin-left: auto`, and two auto margins in one flex row split the free space
  between them rather than pushing a group to one end — a hole as wide as the
  club badge. Only the search box owns the slack now, which is where it belongs.

### A season that is actually a season

- **The league plays fortnightly, September to June.** The calendar was
  consecutive Sundays, which crammed a twenty-two matchday double round robin
  into September to February and then left **March to May with nothing in it at
  all** — the back half of the season, when the title is being won, was simply
  not written. League matchdays are now a fortnight apart, so the same fixtures
  spread across the months a season really has.
- **The cups take the Sundays in between.** A round is played on the free Sunday
  in the off-week rather than on a Wednesday night, so there is no midweek game
  in the middle of every working week, and the rounds are spread right down the
  season with the finals at the back of it rather than finished by February.
- **Nothing is played on a Thursday or a Saturday.** Thursday is training
  night; Saturday has other football on. Stated once in `NO_GAME_WEEKDAYS` and
  applied to every search for a date to play on — a rearranged fixture, a cup
  round that has to move. Saturday used to be offered as the last resort for a
  fixture with nowhere else to go, which is exactly how a quiet exception
  becomes the normal case.
- **Two bugs the new calendar exposed, both found by the tests rather than by
  playing:**
  - A round whose slot fell in the Christmas fortnight was **dropped**, leaving
    it with no date at all — and a knockout tie that is never drawn is a tie
    nobody is ever waiting for, so the competition could never finish. It now
    moves to the next Sunday clear of the break.
  - Moving that round forward by seven days landed it **straight back on a league
    matchday**, putting a last-sixteen tie and a quarter-final on the same
    afternoon with every club in both playing twice. A round now claims a Sunday
    nobody is already playing on.

- **Kick-off times are written the same way everywhere.** Cup ties said `19:45`
  and rearranged replays `18:45`, while every league fixture said `10:30am` —
  two spellings of one thing, often in the same list. Times are now stored and
  shown as a manager reads them, `7:45pm`, and the ones already sitting in a
  save are converted on the way out rather than needing the career to be
  restarted.

### Small screens, put right

Four things that made the game feel unfinished rather than unfinished. None of
them add anything; all of them remove something in the way.

- **One list of clubs, not three.** Choosing a club showed every club in the
  league, all thirty-six of them, in one column. There is now a division
  tabstrip above the list — the same one the league table uses — and it shows
  one division at a time. The whole ladder is still two taps away.
- **The button that matters is in the header.** *Generate world* on the manager
  profile and *Take charge of {club}* on the club screen now sit in the page
  header, to the right of *Back*, where the thing you came to do is. They were
  at the bottom of a long panel, below a squad table, which is the last place to
  put them. *Generate world* stays disabled until the profile is actually
  complete, and says so.
- **The kit is reachable again.** Pre-season had no way to reach the kit screen
  at all. It is offered from the home screen in the weeks before the first
  league game, and once a design is confirmed the offer disappears — it comes
  back at the start of the following summer, and not before. Confirming the design the
  club was already wearing now counts as confirming a kit, which it never did:
  the action used to give up because there was nothing to change, and the prompt
  never cleared.
- **The sidebar is one column.** Section headings and their screens had two
  different left edges, so their icons sat in two columns. Both now share the
  same padding, type size and left rule.
- **The sidebar in the order a manager thinks in it.** Home, Manager, Messages,
  then Team, Competitions, Club and the World — with Recruitment moved inside
  Team, because finding a player is part of building a side, and Media moved
  inside Club, because the news is mostly about his club. The schedule now sits
  above the league table, since the next game is the question the screen is
  opened to answer. Messages stays a single row rather than a group, because
  that is what lets it carry its unread count.

### The rest of the league, being played out

Press Continue after a game and the division finishes its Sunday around you —
every other club, run through the same match engine the manager watches, one at
a time. That is several seconds of work with nothing on screen to say so, and it
read as a freeze. There is now a dialog for it.

- **It appears when there is football to wait for, and not otherwise.** The bar
  comes up on the first match of the day and closes itself when the last one is
  in. A Tuesday with nothing on it moves the clock exactly as before and shows
  nothing at all.
- **It says what it is doing.** A progress bar across the day's fixtures, *Now
  playing: The Wheatsheaf v The Bull FC*, and every result as it lands, so the
  wait is something to read rather than something to sit through.
- **It cannot be dismissed.** There is no close button, because the only way past
  it is for the football to finish, and a dismissible one would let a second
  Continue run the same day twice.
- **The same for the calendar.** Advancing days by hand or jumping to a date
  crosses the same football, so it gets the same dialog — and the same silence
  when there is nothing to play.
- **Nothing about the simulation changed.** The loop that shows the manager the
  match being calculated is the loop that decided it, and one test plays the same
  matchday both ways and checks the two careers come out identical.

### Fixtures read like fixtures, and the record books

Two things the league table and the cups were missing: a fixture line that reads
like a fixture, and any idea of who in the competition is actually doing
something.

- **A fixture is crest, name, v, name, crest.** The home club reads crest then
  name from the left; the away club reads name then crest at the far right; the
  `v` sits on the centre of the row; and the kick-off time or the score is the
  last thing in the line, to the right of both clubs. The two crests now face
  each other across the middle and the two names point outwards, which is how a
  manager scans a fixture list for his own club. The same line is drawn on the
  league table's fixtures and on every cup tie.
- **Statistics, for the division and for the cup.** Top scorers, top assists,
  highest rated, and the two card books — read straight out of the performances
  the match engine already recorded, so a chart of goals cannot disagree with the
  results it was built from. The ratings chart leaves out anybody with fewer than
  three appearances, because one game is a swing and not an average, and it prints
  the competition's average beside the chart.
- **A chart is only made of men who are in it.** No zeroes: a red-card chart
  padded with players who have never been sent off is a list of the division's
  luckiest men, so an empty one says "nobody has been sent off" instead. The
  whole block says so when a competition has not been played yet.
- **Scoped to what you are looking at.** The league page charts the division on
  screen and the cup page charts that competition's entrants, so nothing from
  another division or another cup leaks in, and a pre-season friendly never
  reaches the league scoring charts.

### Messages — the inbox you actually read

The communication system could hold a conversation but had no way to show one.
There is now a Messages screen: the people involved in the club, what they have
said, and a way to say something back.

- **One screen, two shapes.** On a phone the list and the conversation are one
  column, and opening a thread replaces the list with a back bar. From a desktop
  width they sit side by side, so a message can be read without losing sight of
  what else is waiting. No horizontal scrolling at any width.
- **People first.** A row is a name, what was last said, when, and an unread
  count. The conversation type is shown only where it earns its place — a group
  or a committee — and left off the ordinary one-to-one, which is most of them.
- **Unread goes first.** Threads with something waiting are sorted above read
  ones however old they are; read threads fall back into plain recency. Opening a
  thread marks it read, because a message the manager has looked at has been
  read whether or not he went back to the list.
- **No internal vocabulary on the buttons.** The simulation's eleven intents are
  never shown as they are stored. They appear as what a manager would say — *Are
  you free?*, *How are you feeling?*, *Remind about subs*, *Give him a lift* —
  with the intent travelling underneath where no screen displays it. The three
  a message has suggested come first, and the rest are one tap behind *More*.
- **Dates in the words you would use them in.** Today, Yesterday, then a weekday,
  then a date. The year is compared against the game's own calendar rather than
  the wall clock, so a career set in 2026 does not start printing years because
  the player's real one moved on.
- **A badge, not a dashboard.** Messages is a navigation destination like any
  other and carries an unread count; it is not a panel of messages on the home
  screen, and it is not one of the five phone destinations.

### Communication — the manager can be written to

The game had news, relationships, availability, subs and a calendar, and no way
for any of them to *speak*. Everything the manager is told arrived as a headline
or a number; nothing arrived as a message from a person who wanted something.
There is now one system for conversations, and it is a game system rather than a
screen: the stores and services live with the simulation and survive a save.

- **Conversations are first-class.** A thread has participants, a type — player,
  staff, board, club, league, recruitment, general or group — a title, its
  messages, when it was last active, how much of it is unread and whether it is
  still open. Closing a thread keeps its history; nothing is deleted.
- **Messages carry structure, not just prose.** Every message records who sent
  it, who it went to, when (on the game's own date, with a sequence number so two
  messages on one day still have a defined order after a reload), its type, the
  thing it is about, and what it expects to cause.
- **Manager messages carry an intent.** `ASK_AVAILABILITY`, `ASK_FITNESS`,
  `REMIND_PAYMENT`, `WARN_PAYMENT`, `PRAISE`, `CRITICISE`, `INVITE_TO_TRAINING`,
  `INVITE_TO_TRIAL`, `OFFER_ROLE`, `ASK_ADVICE`, `GENERAL_CHECK_IN`. Intents are
  data, not buttons: an inbound message lists the intents that would make sense
  there, each carrying the person it would apply to, so a later screen offers
  what the conversation can actually answer rather than a fixed menu.
- **Replies are generated, not scripted.** A reply is written from personality,
  the relationship the manager has with that person, their role and their
  circumstances — a man rolled `unavailable` answers the way he is, not the way a
  template would like. Every draw comes from a named stream off the world seed,
  so the same career produces the same words; there is no `Math.random()` anywhere
  in the system and no dialogue tree.
- **Consequences are anticipated but not yet wired.** A message records the intent
  it was sent with and stays unresolved until something acts on it. Systems claim
  an intent by registering a handler, so availability, money, relationships and
  the calendar can each attach later without the conversation layer knowing they
  exist.
- **It survives a reload.** Conversations, messages, ordering and read state are
  held on the game state and saved with everything else (save format 10). A save
  written before any of this gets an empty inbox rather than an invented one, and
  people who have left the world are swept out of threads without erasing the
  messages they were in.

### Players answer for themselves

A manager could ask a question into the void. Now a squad member can be written
to, and answers as himself: the thread is opened from his profile, and what he
says back is written from the state he is actually in rather than from a line
picked at random.

- **Six things worth saying to a player.** *Are you free?*, *How are you
  feeling?*, *How are you?*, well done, where you sit, and a request for his
  opinion. Selection talks only use the states the selection system already has
  — in the eleven, on the bench, left out, or not yet decided because the team
  has not been picked.
- **The answer matches the man.** An injured player says the knee is still
  playing him; one who has picked up a late shift says he cannot make it; one the
  game has flagged doubtful says he thinks so but will know by Saturday; one who
  is fit and does not much rate the manager says he will be there and leaves it
  there. A player is never told he is out while the availability system has him
  available, and the doubt is deliberate wording, not a different record.
- **Wording varies, structure does not.** Each answer is chosen from variants
  written for that exact situation, so the words differ between two managers
  asking the same question, but the underlying state behind them is the same.
  There is no dialogue tree, and every draw comes off the world seed.
- **"I'll let you know Saturday" is kept.** An answer that does not settle
  anything says so on the message, and the day it lands is scheduled through the
  game's own calendar rather than a second scheduler. When that day arrives the
  unresolved answer resolves and may produce the follow-up itself.
- **Saying something changes something, gently.** Praise and criticism go
  through the relationship service that already existed, using its own
  `manager-praise` and `manager-criticism` events, so a man who has been told
  well of himself carries it into the next conversation. The effects are the
  existing small ones — no second set of feelings is kept anywhere.
- **Relationships are read in the right direction.** What a reply is made of is
  the player's own side of the relationship, and the profile knows who the
  manager is, so a cold man with the player and a cold manager with the player
  are not the same conversation.
- **Nothing here is invented twice.** Player data, availability, injuries,
  personality, morale, the team sheet and the calendar are all read from the
  systems already in place; the communication layer adds conversation on top and
  keeps none of it.

### Availability speaks for itself

The roll that decides who can play has always been the record, and it stays
the record. What it could not do was speak: a man rolled doubtful was a word in
a list, and the manager had no way of asking him about it without a phone call
that the game did not model. Communication now wraps the availability system in
a human layer — and the wrap reads the record, never writes to it.

- **The roll decides; the conversation explains.** Availability is written
  exactly as before, in exactly the same place, and the announcement is made
  *after* it. Nothing in this layer can move a player between available,
  doubtful and unavailable, and a man saying "I think I will be alright" does
  not become available because he said so. What the message changes is how sure
  everybody is.
- **Players write when their Sunday changes.** A man who has just lost his
  morning to a late shift tells the manager; a man whose knee has gone again
  tells the manager; and they talk about the thing that actually happened,
  because the message is written from the reason the roll gave rather than from
  a generic pool of availability wording.
- **It does not spam.** Only the manager's own squad, only on a genuine change,
  only once per event — a reloaded save or a twice-visited day finds the message
  already there and writes nothing. A doubt that clears and comes back a week
  later is a different event and does produce a second message, because it is
  one.
- **Four words, one of them new.** *Available*, *Doubtful — player says they
  expect to play*, *Awaiting player confirmation*, *Confirmed unavailable*. The
  fourth state is the one the simulation does not have and a manager genuinely
  is in: a doubt nobody has yet asked about. It is derived from the record and
  the thread rather than stored, so it cannot disagree with the roll.
- **A man can be chased.** *Can you confirm?* and *Any news?* are now
  intentions of their own, and the chase appears at the front of the options
  exactly when there is something to press him about. A chase with nothing
  outstanding sends nothing.
- **One Saturday, not three.** A man who stays vague books one day on the
  calendar however often he is asked, so the manager's week shows a single
  thing to do rather than a pile of duplicates.
- **Selection stays the manager's.** Nothing here picks anybody. A doubtful man
  is told, and whether to take him on a bad knee is the manager's judgement,
  made on the selection screen from the record this layer only reports.

### The subs book, per man

A player who has not paid could not be told, because the game had never worked
out whether he had. Subs settled weekly for the whole squad at once, so the
ledger could say what came in and never who it did not come from. The money
still moves exactly where it always did; what is new is that the ledger can now
say whose it was.

- **Money is still finance's business.** The balance, the ledger line and the
  date all come from the finance system and from nothing else. What did not
  arrive is *not* income and is not on the ledger — a club that books money it
  has not been given is a club that never folds.
- **A promise is not a payment.** "I'll bring it Sunday" is recorded as a
  promise, on the message that carried it, and it moves the conversation and
  nothing else. On Friday the debt is exactly where it was, and the test suite
  says so out loud. The treasurer taking cash on a Sunday is the only other
  thing in the game that can clear a debt, and it goes through the ledger.
- **Four ways to say it.** A reminder, a straight ask, a word about how he is
  managing, and a warning — and the warning says how far behind he is, because
  a warning without a figure is a threat. The first three are available early;
  the warning only to a man well behind, because offering it over one missed
  week is the screen making a decision that is not its to make.
- **Nobody rolls over.** A man who is annoyed stays annoyed, and a man whose
  trust in the manager has gone can be spoken to twice running and bristle both
  times. What decides it is how he already feels about the man asking, read in
  the direction that matters, and asking him moves that same side — so chasing
  a man is something he notices and remembers.
- **The treasurer says it once.** A man falling further behind is a threshold
  crossing, not a weekly update: the message is written when he goes from paid
  up to behind, or from behind to several weeks, and not again until that
  changes. A man five weeks in arrears does not get a fifth reminder.
- **Selection is still the manager's, and the gap is named.** The selection
  screen validates availability, fitness, position and duplicates, and has
  never been told anything about money. Rather than add a second gate or fail
  men quietly, the choices are offered — leave it, chase him, warn him, keep an
  eye on his selection — and the manager takes one. Wiring it to selection needs
  a decision about whether it is a warning or a bar, and that is not one to
  make silently inside a communications feature.

## [0.5.0] - 2026-10-04 — the match simulation and the thing watching it are two systems

The match used to be watched at a fixed compression: one minute of football was
six seconds on screen, whether it was a throw-in or a goal. It is now two
separate systems joined by one record.

### The simulation decides what happens

- **The match clock is real football time.** An event carries the second it
  happened on — seconds since kick-off, straight through the interval — so the
  clock, the commentary and the statistics all describe the same moment instead
  of a minute rounded to something that fits the frame loop.
- **The clock no longer rewinds at half time.** It used to drop back to 45:00 for
  the second half, which meant a second-half event could be stamped *before* the
  half-time whistle that preceded it. The displayed minute is still rebased so a
  manager reads the second half as starting at 45.
- **A match knows which part of the game it is.** The engine's clock is one
  unbroken count of seconds since kick-off, and the half it belongs to — first
  half, second half, or either period of extra time — is a thing of its own. That
  is what lets the second half open at 45 on the screen while the clock never
  moves backwards, and it is the same model that extra time will need, rather
  than a special case for two halves.
- **Added time is earned, not rolled.** The referee's board used to be a number
  drawn from the seed before kick-off, so every half got minutes whether anything
  had happened or not. The engine now counts the time the ball actually spends
  dead — restarts being arranged, goals being celebrated — plus a small allowance
  for the stoppages it does not model, and plays exactly that much. A quiet half
  gets little; a stop-start one gets plenty. It is recorded on the match, so the
  half-time and full-time whistles are the moment the football reached, not a
  guess made in advance.

### A level cup tie is settled on the pitch

- **Extra time is played.** A knockout tie that is level after ninety minutes
  used to end there, and the cup would send the home club through on no evidence
  at all. The engine now plays the two fifteen-minute periods the clock model was
  always built for: it announces extra time, plays 90 to 120, and keeps the
  record straight through.
- **If it is still level, there is a shootout.** Five kicks each, taken by the
  men on the pitch, then sudden death until one side misses. The winner is
  written onto the match and into the result's penalty score, so the cup reads
  who actually went through. A knockout tie can no longer be decided by which
  dressing room it was played in.

### Men leave the pitch: cards and injuries

- **A second yellow is a sending off.** The engine used to book a man and stop
  there, so a second booking cost nothing. It now sends him off, and so does the
  rare straight red. A sent-off player keeps his place on the team sheet — the
  ten who remain keep their shape — but he plays no part: his side is down to ten
  and weaker for losing him, and he cannot be replaced.
- **A match can hurt a man.** Tired legs on a bad pitch turn an ankle or pull a
  hamstring, and the injury is written onto his record, where the season turns it
  into time out — so a manager hears about it the way he hears about a card.
- **The bench answers an injury.** A man who cannot run it off comes off at the
  next chance, whoever he is and whatever the minute, and the best-placed
  substitute takes his job.

### The laws of football, played in the new engine

- **Offside.** A player who is in the opponents' half, ahead of the ball and past
  the second-last defender when it is played, and who then takes it, is offside.
  The whistle goes, the move is cut dead, and the defending side restarts with a
  free kick — and the record and the statistics both say so.
- **A shot can miss.** A shot is settled from where it is taken and by whom: it
  can be a goal, be saved, go wide, sail over the bar or come off the woodwork.
  Before this a shot was only ever a goal or a save, so a goal kick barely
  existed.
- **A defender can block one.** A defender in the way can throw himself in front
  of a shot before it reaches the keeper — sometimes behind for a corner,
  sometimes away as a loose ball.
- **A foul in the box can be a penalty.** Not every one is, but when it is, it is
  taken like any other restart and comes to a goal or a miss.
- **Own goals and assists.** A defensive touch that ends up in his own net is an
  own goal, credited to the other side and named to him; a goal scored soon after
  a teammate's pass credits that teammate with the assist.
- **Proved by tests.** Every one of these has a deterministic acceptance test in
  `matchEngine/laws.test.ts`, from a clear offside and an onside run to a saved
  penalty and a shot off the bar.

### What the playtest found, and what changed

A playtesting pass over the new engine turned up six pieces of football that did
not look like football. Each is now the rule it should have been.

- **A deep line no longer stands on its own goal line.** A deep defence,
  defending its own third, was being driven to progress ~0 — literally behind the
  goalkeeper — because the own-third retreat was subtracted from an already-deep
  base and a defensive slot's offset could undercut the line again. The back line
  is now floored so an outfield man always stands in front of his keeper, and no
  shape position is placed deeper than the six-yard box.
- **One man closes down the ball, and only one.** A side used to send three or
  four at the carrier — every ``press`` role plus anybody near the ball in his own
  half — which pulled the block apart. It is now the single nearest outfield man
  who goes, with his role deciding only how far out he will travel.
- **A striker shoots or holds up, rather than squaring it.** The engine damped
  every shot to a tenth of its weight, in the box and on the halfway line alike,
  so a poacher on the spot was as reluctant as a centre-back. The damping is now
  zone-aware — a shot in the area is far more likely than one from range — the
  hold-up option is a real option rather than a last resort, and a man already
  high up the pitch no longer treats the square or backward ball as his first
  choice.
- **A throw-in is thrown by a named player, from the touchline.** The ball is
  placed on the edge of the playing surface, the taker stands on it, the delivery
  is a throw and never a cross, and the record names the thrower.
- **A penalty is set up to the laws.** The keeper stands on his line and every
  other player — both sides — waits outside the area and behind the ball, rather
  than filling the six-yard box in the taker's path.
- **A kick-off is a kick-off.** Only the taker is at the ball; everybody else is
  in his own half and outside the centre circle before it may be played. The
  restart waits for the pitch to be legal instead of crowding the spot.
- **Proved by tests.** `matchEngine/restarts.test.ts` pins the press, the throw-in,
  the penalty arrangement and the kick-off; the shape floor and the advanced-pass
  preference have their own tests in `shape.test.ts` and `passing.test.ts`.

### The screen says which part of the game it is

- **The period is labelled, not guessed.** The header and the shell used to read
  "First half" or "Second half" off the half number — so extra time came out as a
  second half. The engine now records the period it is playing, and the UI names
  it: First half, Second half, Extra time.

### The record is the football, not only its loudest moments

- **Passes, carries and tackles are events.** The engine used to write down the
  goals, the cards and the whistles, and count the rest. It now records the
  ordinary play too — each pass naming the man it found, each carry, each tackle
  won — so the match is a move rather than a list of incidents.
- **The timeline groups them into real passages.** With the ordinary play on the
  record, a passage is a possession: the run of passes and carries that ended in
  a shot, a tackle or the touchline. Passages used to be mostly one event each.
- **The commentary tells the ordinary play too.** Every event is narrated, not
  only the loud ones: each pass names the man it found ("B. Oakes finds W.
  Aldridge"), each carry the man it beat, each tackle. The commentary bar and the
  transcript read as a move building rather than a list of incidents. The bar
  still shows one line at a time and skips to the newest, so the detail never
  buries a goal; the full transcript is a tab away for anyone who wants it all.

### The presentation decides how much of it you see

- **Four ways to watch.** Full match, extended, key moments and commentary.
  Full match shows every passage with ordinary play accelerated and the big
  moments slowed; the others skip the quiet spells entirely and stop only for
  the football worth stopping for.
- **The pace follows the football, not a multiplier.** Ordinary play is spent
  quickly; a chance is watched close to real time; a goal is not compressed at
  all. The speed chips still exist, but they divide the cost of watching — they
  never change what is shown or what happens.
- **Skip ahead** fast-forwards to the next moment worth watching and stops on
  its first second, so nothing is missed. It is the *presentation* skipping;
  every second of the match is still played and written down.
- **The engine never runs ahead of the picture.** There is one record and one
  clock, so the pitch, the score and the commentary always agree — no watching a
  goal before the clock reaches it, and no second account of the match anywhere.
- **A replay is as smooth as the match was live.** The movement of a watched
  match is now sampled twice as often, and a long afternoon is thinned from the
  *back*: the newest quarter of the recording is always kept whole, so the
  football just watched plays back at full rate and only the distant past grows
  coarser. The replay clock also advances every animation frame by the real time
  that passed, instead of a handful of times a second, so the recorded movement
  is interpolated smoothly and runs at the pace chosen rather than at the frame
  rate. The whole path is pinned by a test that watches the same match at
  different pacings and finds the recordings byte-for-byte identical.
- **The match screen, tidied.** How much of the match to watch is a setting, not
  a transport control: the four viewing modes now sit in a menu behind a settings
  button at the bottom right, next to the button that runs the match to the
  whistle, instead of a row of chips fighting the speed for the same strip. The
  "skip ahead" button is gone — the viewing modes already decide how much is
  watched. Choosing **Commentary** takes the pitch away altogether: with the
  words carrying the match there is nothing to draw, so the two team sheets take
  the space and the afternoon is told rather than shown. On a phone the sheets
  stand up in its place, one above the other. The panel tabs also moved to their
  own full-width line above the speed and match buttons, each sharing it equally,
  so every panel is a thumb's-width target instead of a strip that scrolls off
  the edge. The run-to-the-whistle button drops its words on a phone too (it
  keeps its glyph, title and aria-label), so it sits beside the options button
  rather than stacking above it.
- **Both teams wear their own colours on the pitch.** The dots used to be the
  manager's club colour for his own side and a default grey for everybody else,
  so one team was always "the coloured one". Every dot now carries the strip the
  side is actually in, from the same colours the team sheets and the commentary
  bar use.
- **A goal is celebrated with movement, not a frozen pulse.** The hold after a
  goal used to keep every man exactly where he stood while the dots on the pitch
  pulsed. The scoring side now genuinely runs — the scorer for the corner nearest
  where the ball crossed the line, his teammates setting off after him — while
  the conceding side holds its ground and the ball lies in the net. It is staged
  from the same authoritative state and decides no football of its own, so the
  picture interpolates a real run rather than a shudder and no result changes.
- **A replay shows the match you watched, not a drawing of it.** While a match is
  watched, the engine now records the real movement — every player and the ball,
  at the engine's own step cadence rather than the screen's — and the replay
  plays that recording back against the football second it was taken on. It is
  the same afternoon at any speed it was watched: a man who was substituted off is
  still drawn where he played, and a match nobody watched falls back to the old
  reconstruction through the same picture. The replay no longer borrows the
  retired spatial engine's clock for any of this.

### Fixed

- **A side that cannot field seven players forfeits instead of stalling the
  week.** A manager who arrived on a Sunday with only ten fit players was stuck:
  the game asked for eleven, would not accept fewer, and would not let the clock
  past the fixture. Seven is now the line the laws set. A club with seven to ten
  available plays short-handed; a club below seven has no team to put out, so
  playing the fixture abandons it and the opposition is awarded a 3-0 win — for
  the manager's club and for every AI club alike.
- **Training is on the Thursday, and only the Thursday.** A session was worked
  out as "three days before the next match", so when the calendar put a midweek
  cup tie on a Wednesday the session landed on the Sunday morning — a week with
  two sessions in it. Only league matchdays carry a session now: the cup tie is
  prepared for by the same Thursday that builds towards Sunday.
- **The Thursday after a cup tie is no longer marked trained before it
  happens.** Going to a midweek cup game ran the club's weekly session on the
  spot, banking the evening that had not happened yet and showing it as done on
  the calendar. The session is only conducted once its Thursday has been and
  gone.
- **Pre-season stops on its training nights like the season proper does.**
  Once a training day had been shown once, the command bar fell through to
  Continue; pressing it ran the session in the background and moved the clock
  on. A session that has not been run is still waiting for the manager, so the
  bar offers "Run the session" whether or not he has read the notice.
- **The loading screen is styled from the first frame.** The placeholder shown
  while a career opens carried class names but no rules until the stylesheet
  arrived with the bundle, so it flashed as unstyled text on a white page. It
  now carries its own styles in the document head, before anything is drawn.
- **The shape is no longer lopsided.** A wide role widens a man toward *his own*
  touchline, but the width bias was signed by the team's attacking direction
  rather than the player's flank. On both sides a left back therefore drifted
  toward the middle while a right back went wider, so a side's left was squeezed
  and its right stretched — the gap between a right back and the centre back
  beside him never matched the gap on the left. The bias is now signed by the
  flank, so a side's left and right mirror each other.
- **A goal no longer makes the picture shudder.** After a goal the ball bounced
  between the goal line and the centre spot and every player twitched. The goal
  hold did not step the movement, so the drawn position (`px/py`) was left where
  the last step put it while the real position had moved on — and the pitch,
  interpolating between the two as its frame clock ticked, slid the ball and the
  players back and forth across that gap. The held phases (the interval, the
  final whistle, and the last step of the goal hold as the kick-off is arranged)
  now settle the drawn position onto the real one, so there is nothing left to
  interpolate.
- **The ball stays in the net for a goal.** It used to be placed straight onto
  the centre spot the instant it crossed the line, so the celebration showed a
  ball already back at the middle. It now remains where it crossed, and the
  kick-off that follows the hold is what returns it to the centre spot.

### Every fixture plays the same football

- **There is one match engine, and the whole world runs on it.** The fixtures the
  manager does not watch — every other league match, every cup tie — used to be
  decided by the older minute engine, so the same Sunday could be played two
  different ways depending on whose match it was. They now go through the new
  engine too, through a headless path (`simulateMatchHeadless`) that is the same
  call the watched match makes: identical football, no picture.
- **The world's results come from the pitch.** A goal nobody watched is an
  engine goal, an injury is an engine injury, and the league table, the cup, the
  scorer lists, the suspensions and the training effects all read the same
  record the manager's own match writes. There is no simplified model behind the
  scenes — a fixture is a fixture whether or not anybody is looking at it.

### For developers

- **`simulateMatchHeadless(match, env)` is the only headless entry point.** It
  runs the engine to completion and writes the authoritative record onto the
  `Match`: result and score, goals, scorers and assists, cards, injuries,
  substitutions, possession ticks, event history and per-player performances.
  `src/simulation/day.ts` calls it for every AI fixture, so no production code
  imports the old engine any more.
- **The old engine has no production call sites.** `match/engine.ts` and its
  supporting modules remain only for their tests and for `tools/balance.ts` and
  `tools/matchReadout.ts`, which read it directly to audit a single match. They
  are the last reference to it and can be removed with it.
- **Bulk fixtures are expensive, so the soak is opt-in.** A headless match is
  about a second of engine time, so a full matchday is tens of seconds and a
  season runs into minutes. The multi-season smoke test
  (`src/simulation/soak.test.ts`) is therefore **skipped by default** and run on
  demand with `npm run test:soak` (or `SOAK=1`), so a season on the new engine no
  longer blocks every test run. One engine is the correct end state; a cheaper
  *bulk* path — off the main thread, or a coarser step inside the same engine —
  is the next piece of work.

- **A match simulates about four times faster than it did.** The engine used to
  ask all twenty-two players to re-scan the pitch — the nearest man, the side's
  energy, the side's shape — on every one of a hundred and sixty thousand steps,
  and the men without the ball were re-deciding where to stand thirty times a
  second. The shared answers are now worked out once a step, and the off-ball men
  re-decide on their own slower cadence. The football a manager watches is
  unchanged (measured within a few per cent at a fixed seed); a headless match
  dropped from about ten seconds to about two and a half.
- `npm run timeline-readout` prints the engine's event stream, the passages it
  groups into, and how long each viewing mode would take to watch — the budget
  check that simulation speed and presentation speed are independent.

## [0.4.2] - 2026-10-02 — careers, somewhere with room

The place a season is kept has changed. Nothing about the season has.

### A bigger cupboard

- **Careers are stored in IndexedDB, not in local storage.** A full county is
  thirty-six clubs, nine hundred-odd people, four hundred matches and the whole
  social network between them — around three megabytes of JSON. That is a great
  deal to ask of local storage, which the browser caps at about five megabytes
  *in total*, quotes as a string on every write, and does on the main thread
  while the game is trying to do something else. The database stores it as
  structured data, asynchronously, with room to grow well past what local
  storage could ever hold.
- **The whole world still travels together.** It is one career record, not a
  table of players and clubs and matches, because nothing here needs to ask the
  database a question it cannot answer by reading one record.
- **Nothing about the simulation moved.** `GameState` is still the career, still
  the source of truth, and still the only thing that is saved. The save format is
  unchanged at version 9, so an existing career is the same career afterwards.
- **The save list can no longer fall out of step with the careers.** It used to
  be a separate index that had to be rewritten on every save and could disagree
  with what was actually stored. It is now whatever is in the store, which is
  the one thing that cannot disagree with itself.

### Coming across

- **Existing careers are brought across on the first launch, automatically.** A
  manager who has been playing for months opens this build and finds his season
  where he left it. It happens before the menu is drawn, so there is never a
  moment where the game has told him he has no careers and then changed its
  mind.
- **The old careers are not deleted.** They are left exactly where they were, as
  a fallback if the browser ever refuses the database, and so that a bad
  migration is recoverable. It costs a few megabytes and is worth every byte.
- **One bad career does not cost him the rest.** A save that will not parse is
  named in the console, left untouched, and every other career still comes
  across.
- **Doing it twice is harmless.** A slot is only imported if it is not already
  in the database, so a migration interrupted by a closed tab simply runs again,
  and a career the manager has played on since can never be overwritten by the
  older copy.

### Fixed

- **A rapid burst of saves could leave the wrong one on disk.** local storage
  writes were synchronous, so `autosave(A)` had always finished before
  `autosave(B)` could be called. Asynchronous writes are not so obliging, and the
  database is free to complete two in flight in either order — which would have
  put an older career on top of a newer one. Writes are now queued per slot, so
  three saves in a burst leave the newest one stored, a failed write no longer
  freezes the ones behind it, and the manager is never blocked waiting for any
  of it.
- **A database the browser refuses no longer stops the game opening.** A missing
  database, a full disk, a refused write: the game still starts and is still
  playable, and says so rather than throwing. An autosave that fails leaves the
  career in memory exactly as it was.
- **Storage failure and a broken save are no longer the same error.** A browser
  that will not give the careers back says the browser would not; a save that
  will not parse says that save is broken. They are different problems with
  different fixes.
- **The menu no longer says "nothing saved yet" while the game is still
  looking.** The store knows whether it has finished asking, and the menu waits
  for it rather than guessing.

### For developers

- **`src/state/indexedDb.ts`** is the whole of the raw browser-database
  plumbing, in about two hundred lines. It is a wrapper rather than a dependency
  on purpose: there was no IndexedDB library here already, and one would be a
  larger thing to reason about than the thing it replaced. It is careful about
  two things that are easy to get wrong — a transaction is closed by its event
  loop rather than by its callback, and a transaction-level error reports
  `AbortError` rather than the quota error that actually happened.
- **A `se27` database at version 1**, with a `saves` store keyed by slot and a
  `metadata` store keyed by name. The database version is its own number and has
  nothing to do with `GAME_STATE_VERSION`, which is the version of a career's
  contents: they are different facts, and using one for both would make a
  simulation change look like a schema upgrade.
- **`migrateSave()` is untouched** and still runs on every load, exactly as
  before. A version 7 career with one league and no cups still becomes a
  pyramid; the change of address is invisible to it.
- **`serialiseGame()` and `deserialiseGame()` still work** and still operate
  entirely in memory, and now go through the same reader the database does, so
  an exported string and a stored career cannot drift apart. They are ready for
  an export/import screen whenever there is one.
- **`fake-indexeddb` is a development dependency**, and only that. The
  persistence tests run against a real transaction implementation rather than a
  stub that returns success for everything — every bug in this migration was
  transaction behaviour, and a stub would have passed while all of them were
  broken.

## [0.4.1] - 2026-10-02 — a home screen, and a lighter download

The game can be put on a home screen, played with no signal, and told when
there is a new one to load. It also now takes rather less than half of what it
used to, which turns out to be mostly one photograph.

### On a home screen

- **The game can be installed.** A manifest, a service worker and a set of icons
  make it a Progressive Web App: added to a phone's home screen or a desktop's
  app list, it opens in its own window with no browser chrome, and it keeps
  working with no signal at all once it has been opened once. The worker caches
  the hashed bundles (whose names carry their own version, so they can never be
  stale) and falls back to the last good shell only when the network is gone, so
  a deploy still reaches the player on their next connection.
- **Every icon is the same mark.** The taskbar, home screen, splash screen and
  share sheet icons are all generated from `public/favicon.svg` rather than drawn
  separately, so there is one mark to change and no way for the icons to drift
  away from it. The platform-masked variants are prepared properly: bled to the
  edges, with the wordmark inside the safe zone, because Android may crop a
  maskable icon to a circle and iOS paints transparent pixels black.
- **The worker is never served stale.** `sw.js` is sent `must-revalidate` at the
  edge. It is the one file that decides what is cached, so a cached copy of it
  would outlive the deploy it was written for and pin the game to that build.

### Keeping the game, and being told about a new one

- **The main menu offers the install.** The browser decides *once* whether to
  let a game be installed, offers it in a strip most people dismiss unread, and
  never asks again. The game now catches that offer and spends it in the one
  place a manager is looking, in the game's own words and on their own time. It
  asks quietly, and "Not now" is genuinely never now.
- **iOS is told how, rather than given a button that cannot work.** There is no
  install event on an iPhone, so the card explains the way in — Share, then Add
  to Home Screen. A browser with no way to install at all is shown nothing,
  because a card offering what the browser has already refused is worse than no
  card.
- **A new build now waits to be let in, and says so.** The service worker used
  to take over the moment a deploy finished, which swapped the code out from
  under a half-played match with nothing on screen to explain it — and the
  reload would land on the *previous* deploy, so the update could never actually
  be applied. A new build now installs and sits, the game says a new version is
  ready, and it applies when the manager chooses. The career is saved on the way
  out, so reloading is safe.
- **Deploys are noticed while the page is open**, when the manager comes back to
  the tab and hourly after that, rather than only on the next visit.

### Smaller, and faster to open

- **The pitch is a third of its old size.** The photograph behind the pre-game
  screens was a 2.1 MB PNG, which was most of what the game had to download and
  most of what it had to keep for offline play. It is now a 315 KB WebP, cut by
  85% at a measured 37 dB PSNR against the original — visually faithful, and the
  only copy of it that ships.
- **You download the game you are playing, not the game you might.** The twenty
  screens are fetched the first time they are shown rather than all up front, so
  opening the game to look at your inbox no longer costs you the recruitment
  screen, the finances and the match commentary. The main menu is the deliberate
  exception: it is the first thing painted, and is worth 4 KB to never wait for.
- **React is chunked separately**, so a release of the game no longer
  invalidates 145 KB of framework that has not changed.
- **Offline play is now guaranteed rather than hoped for.** The service worker
  precaches every file the build produces, from a list written in at build time
  rather than kept by hand. That is what makes splitting the bundle safe: a
  screen whose code has not been fetched yet can still run with no signal,
  because the chunk is already in the cache before anyone clicks.

### For developers

- `npm run icons` regenerates every app icon from the favicon. It needs `sharp`,
  which is a development dependency only: the PNGs are committed, and the script
  runs when the mark changes, not on every build.
- `npm run scene` rebuilds the pitch photograph as WebP from the master kept in
  `assets/`, which sits outside `public/` precisely so the build does not copy
  it. It measures the result and refuses to write it below 36 dB PSNR.
- A `precacheManifest` plugin writes the build's own file list into `sw.js`. If
  the placeholder it replaces is ever missing, the build fails rather than
  quietly shipping a game that caches nothing.
- `public/sw.js` keeps a `self.__PRECACHE__` placeholder for that list. The
  built copy has it replaced; the source must always still contain it.

## [0.4.0] - 2026-10-02 — a pyramid, and time passing

There were twelve clubs, forever. There are now thirty-six in three divisions,
two up and two down at every boundary, two cups, and a world that ages.

### The ladder

- **The county is a pyramid.** Three divisions of twelve, cut from the top down
  by reputation, so the top division holds the better squads from the moment
  the world is built rather than sorting itself out over the first few seasons.
  The size and the number of rungs are data, not a constant, so a two-division
  world or a sixteen-club one is a configuration change rather than a rewrite.
- **Two clubs go up and two come down at every boundary.** Ties are settled by
  the standings the table already uses. A club that cannot be promoted — no
  ground, or money that will not stand it — is told so in the news, with the
  reason, and the club below it is promoted in its place, so a division never
  ends a season the wrong size.
- **Moving tier moves everything that hangs off it.** Prize money, crowds,
  sponsorship and what the board expects all differ by division; rivalries are
  struck and dissolved when clubs end up on the same level or stop being on it;
  and a club's history records the tier of every season it played, so an old
  season in Division One still reads as Division One.
- **The manager's own club can be in any of them.** Career mode lists every
  club in the county by division, and a club he builds himself displaces the
  weakest in Division Three and starts there.

### The cups

- **A League Cup, open to every club in the county.** Single legs, extra time and
  penalties, seeded so the field does not need to be a power of two. It is drawn
  on a Wednesday night, numbered after the league's matchdays but dated inside
  the season, so a cup tie is a real midweek commitment rather than a Sunday
  everybody was already playing.
- **A Plate for the clubs that go out in the first round**, as the design
  document always said there would be. It is fed by the League Cup's first round
  and interleaved with the main competition's rounds, so a season's cup football
  is spread across eleven midweeks instead of arriving all at once at the end.
- **A draw is an event.** It is a news item, it is on the cup screen, and the
  rounds, results, giant-killings and finals all feed news, history, honours and
  rivalries like a league season does.
- **No club plays twice in a day, and no cup round lands on a rearranged league
  replay.** Cup ties are drawn onto a date that is actually free, falling
  forward if the first one is taken, and a postponed cup game is rearranged to a
  midweek slot rather than onto the Sunday the league fixture is already on.

### The world turning over

- **Other clubs now do something between seasons.** They release a man, sign
  another, keep a legal squad, cut wages or fundraise when they are in the red,
  and change manager when the board has seen enough. A released player joins the
  unattached pool and is signed by somebody else, which is what keeps the pool
  turning instead of growing: it was measured at 37 men in season one and 371 by
  season eight, and now oscillates in the twenties and forties.
- **Every player has a ceiling and a peak.** Training used to raise a man until
  he hit the top of the scale, so every player in the world got a little better
  every year and the county's football never stopped improving. Each player now
  has his own potential and his own age to reach it: a teenager has a long way to
  travel, a man of thirty is closing in on what he has, and a man of thirty-four
  has stopped getting better and started losing it. Physical attributes go
  first, know-how barely at all. The world's mean ability now moves **+2.9%**
  across ten seasons, down from +10.2%.
- **Everyone trains, in every division.** See below; this one was a real bug.

### Fixed

- **Two thirds of the county had never held a training session.** The weekly
  routine ran for "the first competition's clubs", which before the pyramid meant
  the whole league and afterwards meant Division One and nothing else.
  Divisions Two and Three were silently frozen: their men never improved, never
  tired, and never appeared in a session. It was invisible because the code's own
  comment said it ran for every club.
- **An extra-time tie could never finish.** From minute 105 the branch deciding a
  half had ended matched its own condition again and reset the clock to minute
  90, burning the loop's safety net and leaving the tie in progress for ever.
  A cup tie that went to penalties could therefore never be decided, and the
  round that contained it never completed.
- **A cup round was never treated as settled.** "Decided" meant the competition
  had a winner, so only the final round advanced; and a postponed original was
  counted as a live tie, so a round with a rearrangement in it could never close.
- **The Plate was never fed.** The consolation draw sat on the Plate's own loop
  instead of on the League Cup's first round completing, so no club was ever
  knocked out into it.
- **A match history counted the wrong matches.** Cup tie dates sit inside the
  league season but are numbered after its matchdays, so "matchdays elapsed" was
  no longer a coherent index and a season could be declared finished early.
  Anything asking how far through the season the world is now filters to league
  matchdays only.

### For developers

- The save format is **version 9**. Version 7 saves become a pyramid with the
  league they already had kept as Division One; version 8 saves are given each
  player's development profile from the ability and age he already has, on a
  stream of his own, so an old career does not discover a new talent in its
  established men.
- The multi-season **soak** gained pyramid invariants: every club in exactly one
  division, division sizes constant, promotions and relegations balancing, no
  club playing twice on one day, cup brackets completing, honours neither
  duplicated nor skipped, and ability stratified by tier without inflating.

## [0.3.0] - 2026-10-01 — the football, decided

The match engine was rebuilt. It used to ask, once a minute, whether a shot
happened; it now plays football, and everything else follows from that.

### The football

- **A match is a run of possessions, not a list of incidents.** Each minute is
  divided into passages in which somebody has the ball, at a place on the pitch,
  with defenders trying to take it off him. How many there are is not fixed: it
  falls out of how long each one takes, which is why a side knocking it about
  and a side thumping it long do not get through the same amount of game.
- **A player decides what to do with the ball.** Play it, carry it, take his man
  on, put it in the box, have a go, switch it, thread it through, shield it, or
  get rid of it — and which he chooses follows from where he is standing, how
  hard he is being closed down, who is available, what he is good at, how tired
  he is, what the manager has told him to do and what the score is. A
  centre-back on the edge of his own box with a striker on him very rarely tries
  to play out; the same man in space in midfield very rarely launches it.
- **Passes go somewhere, and sometimes they do not arrive.** A pass is an
  attempt with a destination: the difficulty is the distance, the angle and the
  pressure, and the ability is the passer's — so a good passer under pressure and
  a poor passer in space are both possible, and both matter. A ball that does not
  arrive is an interception, a loose ball or a throw-in, and it turns the move
  around.
- **Defenders change what happens.** A challenger goes in based on who he is and
  what the manager asked for; the duel turns on tackling and strength against
  control and agility, and a mistimed one is a foul. That is where bookings come
  from now — a side that keeps losing the ball gives them away trying to win it
  back, and a side that never has it cannot foul at all.
- **Chances are built rather than rolled for.** A shot is the end of a move that
  got somewhere. How good the chance is comes from the move; what the player does
  with it comes from his finishing, his composure and the pressure on him; and
  whether it goes in comes from the keeper. A great chance for a poor finisher
  and a half-chance for a good one are now different things, and the statistics
  agree with the football — goals are always among the shots on target, and the
  shots on target are always among the shots.
- **Set pieces come out of the game.** A blocked shot is a corner. A foul in the
  box is a penalty, and a foul twenty-five yards out is a free kick somebody can
  have a go at. Corners, throws and goal kicks are played out as passages of their
  own rather than announced and forgotten.
- **Home advantage is in the football.** It is a crowd and a familiar pitch, so
  it shows up as a pass finding its man and a fifty-fifty going your way, not as a
  thumb on the scoreline.
- **Tactics change what players attempt.** A direct side clears its lines and
  stops passing for the sake of it; a short-passing side keeps the ball and
  recycles; a high line is a high line. Instructions still have their effects on
  the balance, but they are now expressed as behaviour.
- **The score, the clock and tired legs change behaviour.** A side chasing two
  goals in the last ten minutes pushes up and leaves space behind; a side
  protecting a lead in the same ten minutes sits in. Tired players close down
  less, misplace more and cannot hold a high line.

### Reporting

- **Passes, tackles and interceptions** now appear on the match statistics
  panel, all read from what the players actually did — passes as completed of
  attempted, so a figure that says a side kept the ball well is visible as one.
- **The commentary is the football, described.** It is still written from a
  single passage that the pitch plays and the narrator reads, and it can no
  longer name a man from the other team, describe a pass nobody made, or report
  an outcome the match did not produce.

### Watching the match

- **A match is played at a pace you can follow.** Normal speed no longer runs
  four times faster than the picture: it is now the one setting where the pitch
  runs at true speed, so a player's legs move at the speed the simulation gives
  them and a pass looks like a pass. The speed ladder gained a rung above it —
  1x, 2x, 4x and 8x — and every one of them divides the same minute rather than
  changing it, so the engine plays identical football however fast it is
  watched. An afternoon takes about ten minutes at normal and about a minute and
  a half flat out.
- **Goals are celebrated, on the pitch and in the words.** When the ball goes
  in, football stops for a moment: the scorer breaks away to the corner, his own
  team chases him down and rings him, the side that conceded walks back, and the
  ball is returned to the centre spot for the restart. The pitch is picked out
  for it — the scorers marked, the man who scored most of all — and the narrator
  describes it in the same minute, right after the finish. It changes nothing:
  the score was settled the instant the ball crossed the line, and the
  celebration is only what the pitch does about it.

### Under the hood

- **A balance bench** (`npm run balance`) plays hundreds of seeded matches a
  scenario and reports the *distribution* — goals and their spread, shots and
  shots on target, possession, passing and completion, fouls, cards, offsides,
  corners, the duels won and the mix of actions players actually chose — rather
  than a single scoreline, so the engine is tuned from data instead of
  guesswork. Its first finding was a real one: the defending side's quality was
  absent from the passing model, so a quality gap barely showed at one or two
  points and ran away with the game at six. Reading the distribution led to the
  fix, and a better side now wins about seven in ten of the moderate-gap
  fixtures it should rather than half.

### The world

- **Squads are refreshed each summer, so the league stops ageing in lockstep.**
  Every club now takes on one or two teenagers before the season, and carries no
  more than twenty-six players, so the oldest surplus moves on. Without it the
  world could only get older: every other arrival was a grown man and every
  survivor gained a year, so the median age marched from 27 to 35 in fifteen
  seasons. Now it settles in the mid-twenties and stays there.
- **Money can now fail.** A club that ends the season in the red goes into
  administration, and one that cannot get out of it folds. Sponsors walk after a
  bad winter, the winter's pitch repairs and the cost of running a squad bite,
  and a club with a thin squad and an expensive ground can be brought down. When
  a club folds its players and committee go with it and its ground falls vacant;
  a new club forms in the same town to take its place, so the division keeps its
  size however long the career runs. Money is no longer a scoreboard that only
  rises.
- **Managers have careers of their own.** A season is no longer only players
  getting older: the men who run the clubs age, retire, step down, lose their
  jobs after a winter that fell short, and get taken by a bigger club down the
  road. A vacancy is filled by a man between jobs, by the coach already in the
  building, or by a player who fancies running it himself — and never left empty.
  A player-manager who hangs up his boots no longer vanishes from the job: he
  stays on in the dugout as the club's ordinary manager.

### For developers

- **A simulation trace.** Attach a collector to a match and every decision the
  simulation makes — the man, the place on the pitch, the pressure, the actions
  it weighed and the one it chose — comes back as prose, minute by minute. It is
  for balancing the engine rather than for playing the game, and a normal match
  pays nothing for it.
- **The multi-season soak** (`npm run soak`). A headless harness that plays the
  game forward ten to twenty seasons with nobody at the controls — no signings,
  no team talks, no transfers — and reads the world at the end of every season.
  It walks the same paths the game walks (one day via `processDay` with the
  user's match resolved, the season close inside it, and `startNextSeason`
  between seasons), so it measures the game rather than the harness. It reports
  drift in squads, ages, ability, money, the unattached pool, goals and fixture
  rearrangement, and checks the invariants a decade exposes: ids still resolve,
  the archive is written once, a save round-trips, the same seed is the same
  career, and a season actually ends. `SOAK.md` explains how to run and read it,
  and what its first long runs found.
- A two-season **smoke test** (`src/simulation/soak.test.ts`) so the season loop
  is guarded on every commit without paying for fifteen seasons in the suite.

### Fixed

- **A bad winter can no longer swallow a season.** A rearranged fixture rolls
  fresh conditions from its own id, so a game called off in a wet autumn could be
  moved into the same weather, called off again, and rearranged again without
  end. One seed carried a single fixture through twenty-one rearrangements and
  five months past the season's own calendar, and never closed the season — which
  damaged the next one too, because a season that does not end never archives a
  champion. A rearranged game must now be played before a deadline (the last
  scheduled Sunday plus eight weeks), and a fixture with nowhere to go is
  abandoned on the record rather than shuffled for ever.
- **A retiring player-manager no longer leaves the club pointing at nobody.**
  A minority of clubs are run by a player-manager, and when he retired the
  season rollover cleared his squad place but left `club.managerId` naming him;
  the unattached pool then deleted him from the world, so the club's manager was
  a man who did not exist. Stopping playing is not stopping managing: he now
  stays on as the club's ordinary (non-playing) manager, keeping his identity,
  his relationships and his notes.
- **Relationships no longer outlive the people in them.** A free agent who left
  the world was deleted from `state.people` without his relationships being
  cleared, so the social graph slowly filled with links to people who had gone.
  The save loader pruned them, which meant a reloaded career was not quite the
  same social world as a running one. A departure now removes every relationship
  that named the man.

## [0.2.0] - 2026-10-01 — matchday, told

### Matchday

- **The match is watched, not read.** During play the screen shows one line of
  commentary — the moment happening right now — rather than a scrolling feed.
  The full transcript is a tab, and the match report, away: it is written to be
  richer than anything on the live screen, with possession, passing, movement
  and chances building in front of every shot, so a goal reads as the end of a
  passage rather than arriving out of nowhere.
- **The words and the pitch are the same move, told twice.** Each minute the
  engine decides its football exactly as it always did, and a single *passage*
  is planned from the names it used. The pitch plays that passage out; the
  commentary describes it, step by step. There is no second cast and no second
  story, so a line can no longer describe a player carrying the ball while a
  different one has it, or a pass nobody made. When the engine decides a side
  has given possession away, the passage turns around with it.
- **Nothing is invented for it.** Every line comes from what the simulation
  actually did — the same record behind the statistics and the report — and the
  prose draws its randomness from a stream of its own, so a sentence can never
  move a shot, a card or a goal. A pass the ball makes on screen is a pass the
  record already counts.
- **The match happens in space, not as a list of events.** Players and the
  ball carry positions the simulation owns: players walk to the target the
  engine has chosen for them instead of appearing at it, and a pass or a shot
  travels to its destination rather than resolving instantly. Players hold their
  shape, the nearest defender closes the man on the ball down and the side in
  possession spreads to give him options; the ball only ever changes hands to
  somebody near it, so nothing crosses the park in a single step. The football
  is decided exactly as it was — a minute at a time, from the match seed — so the
  result can never depend on the machine it was watched on, and the pitch now
  draws the simulation's state rather than working out a picture of its own.
- **The match screen is shaped around watching it.** The pitch takes the room,
  with each side's team sheet down the side of it; the current commentary is a
  bar beneath the pitch rather than a column beside it; the dressing room, half
  time and full time are cards over the match instead of panels that cost it
  space. The bar is tinted in the colour of the club the line is about and
  flashes when a goal goes in.

## [0.1.0] - 2026-10-01 — first beta

The first build worth playing a season in: a generated Sunday league world, a
calendar that runs continuously, a match engine that plays it out, and a
management game wrapped around both.

### The world

- **Procedural Sunday league England.** One seed generates the towns, the
  grounds, the clubs, their histories, their rivalries and every player in them;
  the same seed always makes the same world.
- **Fourteen clubs a division**, with reputations, finances, squads, kits,
  badges, grounds and standing that follow from the names on the sign.
- **Players with lives outside the game.** Jobs, families, transport, hangovers,
  injuries, doubts and disappearances — availability is a rumour rather than a
  number, and a Sunday morning can take a man out of the side.
- **Relationships.** Players know each other: brothers, old teammates, grudges,
  neighbours, and the local game that gossips about all of it.
- **A local ecosystem of gossip, news and social media**, written from what the
  simulation actually did rather than from templates alone.

### Managing

- **Two ways in**: take over a club that already exists, or build your own —
  name, badge, kit, ground, standing — and take the weakest club's place.
- **A manager of your own**: name, age, birthday, day job, hometown, and it is
  remembered so a new career does not ask twice.
- **Training is a week, not a button.** Plans, blocks, venues, turnout,
  development, familiarity and cohesion, on the Thursday the league trains.
- **Tactics**, team selection, positional suitability, and a squad that reacts
  to what you say to it.
- **Recruitment**: recommendations, open sessions, five-a-side scouting, trials,
  negotiations and registration, in a world where players say no.
- **Money**: income, expenses, fundraising, sponsorship and a bank balance that
  punishes a squad you cannot afford.
- **Finances, history, world, news and squad screens**, with the whole world
  simulated whether or not it is being watched.

### Matchday

- **Matchday is a day, not a mode.** The calendar is the clock: the day arrives,
  you prepare, the whistle starts it, half time stops it, full time gives the
  week back, and the calendar carries on.
- **A dressing room before kick-off**: the fixture, the weather, the pitch, the
  officials, an impression of the opposition, selection warnings, a team talk
  and a warm-up.
- **A live match screen that fits the viewport and never scrolls**: score and
  clock, the pitch, a bounded live commentary feed whose newest line is always in
  view, live statistics, and controls always in reach.
- **Half time as a real fifteen minutes** — what happened, who is running on
  empty, the full statistics and a second team talk — with substitutions and
  shape changes without leaving the match.
- **Full time as a decision**: the result, the goals, the bookings, how every man
  played, the statistics, and the last word you choose to say to them. It lands
  on each of them differently, and what you are told back is how it landed, not
  what the numbers were.
- **Postponements, late calls, abandoned pitches, missing officials** and the
  rest of Sunday morning.

### Around the edges

- **Autosave as you play**, three manual slots, and saves migrated forward from
  older builds rather than orphaned.
- **A preferences menu**: motion (reduced, from your system or off), fullscreen,
  and the speed a match starts at.
- **A settings menu in the header** for saving, loading, preferences and
  returning to the main menu.
- **Credits and this changelog**, both from the main menu.
- **One mark, one stripe.** The wordmark settles into place when the menu
  appears, and the same drifting stripe runs through the screens before a career
  and the header bars of the game itself — all of it respecting reduced motion.
