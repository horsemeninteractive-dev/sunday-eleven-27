# Changelog

All notable changes to Sunday Eleven 27 are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [semantic versioning](https://semver.org/spec/v2.0.0.html).

The game is a **beta**: while the version starts with `0`, features arrive in
the minor number, fixes in the patch, and the save format is still allowed to
move (any save from an older build is migrated forward on load). `1.0.0` means
it is finished. This file is also the changelog inside the game, reachable from
the main menu.

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
