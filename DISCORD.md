# Sunday Eleven 27 on Discord

The game's community server, written down: the rooms, who can see what, the words
pinned in them, and the two commands that make a real server match. Read it with
[`DESKTOP.md`](DESKTOP.md) and [`STEAM.md`](STEAM.md), which are the same shape —
a decision written down as data, a small tool that applies it, and a plain
statement of what has been checked and what has not.

> **Status.** This is a **specification and two tools, and the server they
> describe has been configured for real**: the roles, categories, channels,
> overwrites, pinned posts and AutoMod rules are in it, `XIAI` — the bot — has
> `/ask` registered, it has held a gateway connection, and it has answered a
> question in the server. The first one it was ever asked, *what is SE27?*, was one
> it did not know; that is fixed, and it is the argument for the design rather than
> against it — a file somebody can add a line to, instead of a model nobody can
> correct. §7 is what is still unverified.
>
> A community server is Discord's, not this repository's: the one this describes
> is the one whose id goes in `discord.env`, and this document never names it. The
> bot's own name, id and server are in no file here either — `npm run xiai --
> --check` reads them off Discord rather than writing them down.

## 1. What is here, and what is not

| | |
| --- | --- |
| [`src/platform/discord.ts`](src/platform/discord.ts) | **every decision about the server.** The permission bits, the three roles, the four categories, the fourteen channels, who may see and post in each, the six pinned posts, the three AutoMod rules, what a person still has to do, and the planner that compares all of it with a server. Imports nothing and touches nothing. |
| [`src/platform/xiai.ts`](src/platform/xiai.ts) | **every decision about an answer.** What the bot knows, and the matcher that decides which of it a question is about. Also imports nothing: an answer is a fact and a score, and a question it cannot match gets no answer at all. |
| [`tools/xiai.ts`](tools/xiai.ts) | **the bot as a process.** Registers the commands, connects to Discord's gateway, answers there — and answers on the command line with `--ask`, which needs no token at all. What an answer *is* belongs to the two files below; this one no longer keeps a copy. |
| [`worker/xiaiEndpoint.ts`](worker/xiaiEndpoint.ts) | **the bot, always on.** A Discord interactions endpoint as a Cloudflare Worker: the signature check, the three ways to ask (`/ask`, the topic picker, the message command) and the vote buttons. It holds **no bot token** — verification needs the application's public key and a reply needs the interaction's own token — so the one secret any of this needs is the optional feedback webhook. |
| [`worker/index.ts`](worker/index.ts) | **the entry point, and nothing else.** A Worker's export map is its list of entrypoints, so workerd refuses to start a module that exports a *value* as well as a handler — this file re-exports the handler and the tests import the endpoint beside it. |
| [`worker/wrangler.toml`](worker/wrangler.toml) | **where the endpoint is deployed from.** A configuration of its own rather than one in the repository root, which the game's Pages deploy would otherwise read. |
| [`worker/xiai.test.ts`](worker/xiai.test.ts) | the endpoint's tests, and the important one is the boring one: a real Ed25519 signature is accepted, a key that is not the application's is refused, and every answer is built from a real `Request`. |
| [`src/platform/xiaiVerify.ts`](src/platform/xiaiVerify.ts) | **what a check of the deployed endpoint means.** One PING signed the way Discord signs one, and the reading of every answer that can come back from it — including the one that must never be read as a pass: a PONG to a key the endpoint was never given. No network, no token: the signatures are checked against the endpoint's own verifier in the tests. |
| [`tools/discordEnv.ts`](tools/discordEnv.ts) | **the token, in one place**, because the two tools are the same bot. |
| [`src/platform/discord.test.ts`](src/platform/discord.test.ts) | the tests: the permission values against Discord's own hex, the spec's internal consistency, the channel overwrites, the planner's three outcomes, and reading a release out of the changelog. |
| [`tools/discord.ts`](tools/discord.ts) | the *effects*: a token, Discord's REST API, and a report. Decides nothing — every question it asks is answered by the module above. |
| [`discord.env.example`](discord.env.example) | the shape of the file the token goes in. `discord.env` itself is ignored by git. |
| **the server** | **not here.** It is Discord's; the tool is what makes it match. |

The split is the one every other packaging step in this repository uses
([`src/platform/release.ts`](src/platform/release.ts) decides what a release is,
[`tools/release.ts`](tools/release.ts) cuts it), and here it buys the thing that
matters most: **the interesting half can be tested on a machine with no token**,
and it is.

## 2. Putting it on the server

### The bot, which is the one step nobody can do for you

A bot is an application in Discord's Developer Portal, and its token is the only
credential involved. Roughly two minutes:

1. <https://discord.com/developers/applications> → **New Application**, named
   after the game.
2. **Bot → Reset Token**, and copy it.
3. Invite it with **this** link — the permissions in it are
   [`BOT_PERMISSIONS`](src/platform/discord.ts), and a test holds the number below
   against that list, so the link and the code cannot drift apart:

   `https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot%20applications.commands&permissions=2252899593841713`

   which is: View Channels, Send Messages, Embed Links, Read Message History,
   Manage Messages, Pin Messages, Manage Channels, Manage Roles, Manage Server,
   Moderate Members, Create Invite. **Not Administrator** — the tool builds
   channels, roles and rules, and there is no reason for it to be able to do
   anything else. A bot invited without Manage Roles configures a server except
   for its roles, and the mistake arrives as a 403 halfway through a run.
4. `cp discord.env.example discord.env`, and paste the token in. That file is
   ignored by git, and the tool **refuses to run at all** if it has ever been
   *tracked*: a token in git is a token in every clone and every fork, and unlike
   a leaked keystore there is nothing to re-upload afterwards — the only fix is
   to reset the token and invite the bot again. Never paste a token into a chat.

`DISCORD_GUILD` can be left empty while the bot is in exactly one server: the tool
uses that one. Fill it in (right-click the server → Copy Server ID, with Developer
Mode on) once the bot is in more than one, because a tool that picks a server at
random is a tool that configures the wrong community.

### The commands

```bash
npm run discord:plan        # what this would do, and change nothing
npm run discord:apply       # ...then do it
npm run discord:announce    # post a release from CHANGELOG.md into #announcements
npm run xiai                # run the bot as a process, answering while it is running
npm run xiai:dev            # run the always-on endpoint locally, against worker/.dev.vars
npm run xiai:deploy         # put the always-on endpoint live
npm run xiai:logs           # watch what the live endpoint answers
npm run xiai:verify         # check the deployed endpoint, and say what is wrong with it
```

```bash
npm run xiai -- --register   # register or refresh /ask and the message command, then exit
npm run xiai -- --check      # connect to Discord, say who it is, disconnect
npm run xiai -- --ask "how long is a season"   # answer one question here, no bot and no token
npm run xiai -- --verify [url]                 # check an endpoint: the one given, or Discord's own
npm run xiai -- --new-key                      # write the key `--verify` signs with (for a local run)
```

| flag | |
| --- | --- |
| `--apply` | the same as `discord:apply`: without it, nothing is written |
| `--guild <id>` | configure this server rather than the one in `discord.env` |
| `--icon <file.png>` | set the server icon from a PNG (Discord takes up to 256 KB; 512×512 is the size it wants) |
| `--invite` | create a permanent invite to `#welcome` and print it — the link that belongs on the website |
| `--announce [version]` | post that version's entry from `CHANGELOG.md`; with no version, the one `package.json` carries |

The plan is printed before anything is written, and it is the same run either way:
the tool reads the server, works out what differs, and only `--apply` acts on it.

## 3. The design

### The people

| role | colour | what it can do | why |
| --- | --- | --- | --- |
| `@Keeper` | the accent green | view the audit log, manage messages and threads, pin, kick, ban, timeout, mention everyone | the person who runs the place: moderation, nothing structural, and deliberately **no** Administrator |
| `@Playtester` | a muted grey | nothing in particular | a key to one private channel rather than a set of powers |
| `@Release Notes` | none | nothing in particular | exists to be *mentioned*: ask to hear when a version ships without asking to be told everything |

`@everyone` is stated too, rather than left as whatever the server was created
with — Discord's default grants almost everything and the interesting decisions
are the ones it does not make. It gets the ordinary powers of taking part and
**not** `MENTION_EVERYONE`: the @everyone ping in this server is a person's, not a
stranger's.

### The rooms

| channel | kind | who can see it | what it is for |
| --- | --- | --- | --- |
| `WELCOME` | category | everyone | the three things a new arrival reads before saying anything |
| `#welcome` | text, pinned | everyone, **read-only** | what the game is, where to get it, and where to go next |
| `#rules` | text, pinned | everyone, **read-only** | short, and mostly about being decent to each other |
| `#announcements` | announcement, read-only | everyone (needs Community) | release notes, straight out of the changelog, followable into another server |
| `THE GAME` | category | everyone | the football |
| `#general` | text, 5s slow mode | everyone | anything, mostly the football |
| `#career-stories` | **forum** | everyone | one post per save, tagged Promotion / Relegation / Cup run / Disaster / Screenshot |
| `#screenshots-and-clips` | text | everyone | the pictures people take anyway, in a place that leaves `#general` readable |
| `FEEDBACK` | category | everyone | saying something that changes the game |
| `#ask-xiai` | text, pinned | everyone | where the bot's answers live, so a question and its answer can be found by the next person |
| `#touchline` | **voice** | everyone | playing together, or watching somebody else's afternoon — nothing is written down in here |
| `#bug-reports` | text, 10s slow mode, pinned | everyone | opens with the template a useful report has |
| `#known-issues` | text, pinned, **read-only** | everyone | what is already broken and already being fixed, so the same three reports stop arriving |
| `#ideas` | text, 10s slow mode | everyone | “this could be better”, kept apart from “this is broken” |
| `#playtesting` | text, pinned | `@Playtester`, `@Keeper` staff | builds before they are public, and what to look for in them |
| `STAFF` | category | `@Keeper` staff | the moderation log, and what is being worked on |
| `#mod-log` | text | `@Keeper` staff | AutoMod and moderation: what was blocked, and by which rule |
| `#roadmap` | text | `@Keeper` staff | what is being worked on, and what is not |

**Where the channels come from.** `#career-stories` is a *forum* because a season
per thread stays readable where a channel turns a season into a scroll.
`#bug-reports` and `#ideas` are separate because “this is broken” and “this could
be better” want different answers. `#mod-log` exists because a filter nobody can
audit is a filter nobody can trust.

**The two Discord facts this design leans on**, both of which bite silently:

- **`@everyone`'s role id is the guild id.** It is not a role you find by name in
  the role list; it *is* the guild, and PATCHing that id is how a server's base
  permissions are set.
- **a deny for `@everyone` denies the bot too**, because the bot is in
  `@everyone` and a channel overwrite beats a guild-level permission. That is why
  every read-only channel gives the bot's own role the permission back by name:
  without it the bot pins nothing, in the one place the pinned post is the point.

### The pinned posts

Four, and each is a marker line plus a body. `#welcome` says what the game is and
where to go; `#rules` is five lines; `#bug-reports` opens with the template
(what I did, what I expected, what happened, how often, version, save);
`#playtesting` says what to look for and what to say.

Nothing here is written twice by hand. A pinned post is found on a later run by
the first line **of its own text**, so running the tool again corrects a post that
has drifted, leaves one that has not, and never makes a second copy.

### Announcements come out of the changelog

`npm run discord:announce` reads `CHANGELOG.md` — the same file the game shows in
its own changelog dialog — takes the section for one version, and posts it. It is
a release described once: the alternative is a release described twice, and two
descriptions that will disagree. Discord's message limit is 2000 characters and
the 0.10.2 notes are several times that, so the body is trimmed at a paragraph
boundary with a line saying so, and the whole thing is in the changelog anyway.

The announcement mentions `@Release Notes` and nothing else
(`allowed_mentions`), so somebody who wants to hear about releases hears about
them, and a changelog that happens to name a person does not become a
notification for that person. If `#announcements` is a real announcement channel,
the post is crossposted so followers get it in their own servers.

### XIAI answers questions

`XIAI` is the bot in this server, and `npm run xiai` is what makes it answerable.
Somebody types `/ask question: how do promotion and relegation work` and gets an
answer in `#ask-xiai`.

**Where the answers come from.** [`src/platform/xiai.ts`](src/platform/xiai.ts)
holds a set of facts taken from the project's own documentation — the season, the
cups, promotion and relegation, where a career is saved, how to move one between
machines, what runs where, and what is not built yet — each with the file it came
from printed under the answer. There is **no language model involved**: the thing
being asked about is a game almost nobody has heard of, and a model asked to
explain it will invent mechanics in the tone of somebody who has played it for
years. The matcher is a function of two strings, it is tested in
[`src/platform/xiai.test.ts`](src/platform/xiai.test.ts), and a question it cannot
match gets no answer rather than a confident one.

**Why a slash command.** Reading ordinary message content needs Discord's
privileged *Message Content* intent — an application, a review, and the ability to
read every word in every channel the bot can see. A command needs none of it, and
the bot identifies with `intents: 0`: it genuinely cannot read anything anybody
types outside a question addressed to it.

**Answers are public.** The next person with the same question should be able to
find the answer, and a wrong one should be correctable by a person in front of
everybody rather than in a private window. Where the bot is wrong, the fact it
came from is in the message.

**It answers without a machine being on.** XIAI is an **interactions endpoint**:
the application carries an *Interactions Endpoint URL*, Discord POSTs every
interaction to it, and the endpoint is woken only when somebody asks something.
That endpoint is the Cloudflare Worker in [`worker/xiaiEndpoint.ts`](worker/xiaiEndpoint.ts),
and the half that decides an answer has not moved — the same
[`src/platform/xiai.ts`](src/platform/xiai.ts), the same tests, and the same
answers word for word, because the command line and the endpoint share the code
rather than each keeping a copy. `npm run xiai` still runs the bot as a gateway
client, which is how it is tried out before anything is deployed; once the
endpoint URL is set, Discord delivers interactions *there* and the local process
stops being asked anything.

The two properties worth stating plainly, because both of them are Discord's
rules rather than choices:

- **the signature is checked before anything else happens.** The request carries
  `X-Signature-Ed25519` and `X-Signature-Timestamp`, and the signature is over the
  timestamp followed by the **raw body**, so the body is read as bytes and parsed
  only once it has been proved to be Discord's. Anything else is a 401, which is
  what Discord's own periodic bad-signature probe is looking for. A request that
  is signed but *old* is refused too — a genuine signature over something already
  answered is a replay;
- **intents are still zero, and the bot still cannot read a channel.** `/ask`
  carries its own question, and "Ask XIAI" receives the text of the *message it
  was pointed at* and nothing else — which is how a whole sentence can be asked
  without the privileged Message Content intent the bot has never requested.

The deployed half holds **no bot token at all.** Verifying a signature needs the
application's *public* key, and a reply goes back on the interaction's own one-use
token, so the bot token stays on the machine that registers commands. Five steps,
and the last one is a check rather than a change:

1. **Deploy it**: `npm run xiai:deploy`. Wrangler prints the URL it was given.
2. **Give it the key**: `npx wrangler secret put DISCORD_PUBLIC_KEY --config
   worker/wrangler.toml`, then the application's **Public Key** from the Portal's
   General Information page — sixty-four hex characters. It is not a secret (it
   is the verification half of the pair), but it belongs to one application, so it
   lives in Cloudflare and in `worker/.dev.vars` for local runs rather than in the
   repository. `XIAI_FEEDBACK_WEBHOOK` is the one genuinely optional secret: a
   channel webhook, which is the only way the bot can say anything on its own, and
   which a 👍/👎 click reports through. Unset, a vote is still acknowledged and
   just goes no further.
3. **Point Discord at it**: the URL from step 1 goes in the Portal's
   Interactions Endpoint URL. Discord verifies it by sending a PING, which the
   endpoint answers with a PONG — a request it will not accept an answer to being
   unsigned — and the URL is saved only when that round trip works.
4. **Register the commands**: `npm run xiai -- --register`. It is the same run as
   ever, and it replaces the guild's command list, which is why both commands are
   sent together.
5. **Check it from here**: `npm run xiai:verify`. It signs a PING of its own, reads
   the answer, and reads the application back to see whether this is really the
   address Discord is pointed at — which is the mistake worth catching, because an
   endpoint can be deployed, working, and answering nobody.

**What a check from here can and cannot prove.** A PONG can only be *made* by
Discord, because it signs with the private half of the application's key pair and
nobody else has it — which is the point of the signature rather than an obstacle
to be worked around. So `npm run xiai:verify` signs a PING of its own and reads
the answer, and the answer it *wants* from a deployment is a **401**: the endpoint
is up, it holds a public key, and it refused a signature it cannot trust. Against
a local `wrangler dev` run it can do more, because that endpoint's key comes out
of a file on this machine: `npm run xiai -- --new-key` writes down a key, its
public half goes in `worker/.dev.vars`, and the check gets a real `{"type": 1}`
back — the signature, the PING and the Worker runtime, all exercised. The one
answer it reports as a defect rather than a pass is a PONG to a key it has never
been given, because that means the signature was not checked at all — a bot
anybody can post to.

### AutoMod, and the filter deliberately not installed

| rule | trigger | why |
| --- | --- | --- |
| Slurs and hate speech | Discord's `SLURS` preset | the one category of language a Sunday league community is not here for |
| Mention spam | more than 6 mentions in one message | a mention raid starts as one message, and the block is instant |
| Discord invites | `discord.gg/*`, `discord.com/invite/*`, `discordapp.com/invite/*` | the advertising that arrives on its own, blocked before a person sees it |

**There is no profanity filter**, and that is a decision rather than an omission.
This is a Sunday league: the language is part of it, and a rule that deletes “for
fuck's sake, the keeper” would be the most complained-about thing on the server.
`@Keeper` is exempt from all three rules, each rule tells the person who hit it
why in one line, and each logs to `#mod-log`.

## 4. What the bot cannot do

A script can hold every permission Discord offers and still not do these. They are
listed by the tool at the end of every run rather than left to be discovered:

- **Enable Community** (Server Settings → Enable Community). It is what turns on
  announcement channels, the welcome screen and onboarding, and Discord keeps it
  for a person. `#announcements` is *skipped* until it is on, and the run says so;
  run it again afterwards and the channel appears.
- **Drag the bot's role above the roles it manages.** Discord will not let a bot
  edit a role higher than its own, so until that is done the roles are created and
  left alone.
- **Set the server icon** — `--icon` does it, or upload it by hand.
- **Onboarding** — the questions a new member answers. The channels are there to
  be chosen; the wording is yours.
- **Anything store-shaped** — a vanity URL, Discovery, a partner programme. Those
  are Discord's to grant, and need boosts or an application.
- **Satisfy a 2FA requirement, if the server has one.** Discord requires
  two-factor authentication for moderation actions when the server asks for it
  (Server Settings → Safety Setup); if a moderation step is refused with a 403
  mentioning 2FA, that is the reason, and only the account that owns the server
  can turn it on.

## 5. What it will never do

**Nothing is deleted, and there is no `DELETE` request anywhere in
`tools/discord.ts`.** The planner has three outcomes and no fourth: create what is
missing, update what differs in a field the spec actually states, and leave
everything else alone. A channel somebody added, a role somebody reworked, a topic
somebody improved by hand — those are decisions, and the tool is not the place to
overrule them. The run says which channels it left alone and why.

**One exception, said plainly:** a channel *in the spec* is a channel the spec
owns, so its **permission overwrites are replaced** by the designed ones on every
apply. Anybody who has hand-tuned `#general` will hear it from the documentation
rather than discover it in the audit log. A channel **not** in the spec is never
touched at all.

Running it twice changes nothing the second time, because the posts are found by
their own text and the plan compares what the spec states. That is what makes it
safe to run after editing `src/platform/discord.ts`: the edit is the change.

## 6. What has been verified

| check | result |
| --- | --- |
| `npm run typecheck` | clean — the spec, the tool and the tests compile under the project's own `tsconfig.json` |
| `src/platform/discord.test.ts` | the spec's own tests, all passing as part of the game's suite |
| The permission values | held against Discord's published hex for ten of them, so a typo cannot silently grant the wrong power |
| The spec's own consistency | no name used twice; every channel in a real category; every `visibleTo` role real; forum tags only on forums; slow mode only on text; exactly one AutoMod alert target; a `why` for every decision |
| The overwrites | a read-only channel denies `@everyone` and allows the bot back; `#playtesting` hides from `@everyone` and opens to `@Playtesters` and staff; a missing role is skipped rather than naming an id Discord has never seen |
| The planner | creates everything on an empty server; blocks `#announcements` without Community and unblocks it with; keeps what matches, updates a drifted topic / slow mode / type / role permission and says which; never proposes a deletion or a rename |
| The invite link | `DISCORD.md`'s link is rebuilt from `BOT_PERMISSIONS` and compared with the document, so the number you click and the number the code needs cannot disagree |
| The announcement reader | takes one version's section, stops before the next one and before `Unreleased`, cannot invent a version the changelog lacks, and trims at a paragraph boundary — including on a **CRLF** changelog, which is what the file is |
| `npm run discord:plan` with no `discord.env` | exits 1, prints the five setup steps, and names the file the token belongs in |
| `npm run discord:plan` with a token Discord refuses | the API's own answer is reported (`GET /users/@me/guilds → 401 ... 401: Unauthorized`), the usage is printed once, and the process exits **1** |
| `npm run discord:announce 9.9.9` | exits 1 and lists the versions the changelog actually has |
| `npm run discord:announce` with no version | uses the version in `package.json`, and gets as far as the API |
| `src/platform/xiai.test.ts` | **25 tests**: every fact has a title, a body, a source and triggers that can actually fire; the **rendered** answer — title, body and source line together — fits one Discord message; the command description fits Discord's own 100 characters; the picker fits Discord's 25 choices and names every topic after the answer it gives; the button ids fit; and forty-odd questions a person would plausibly type each land on the answer they should, typos and plurals included |
| `worker/xiai.test.ts` | **28 tests**, and the important one is the boring one: a real Ed25519 key pair signs a real `Request`, the application's key is accepted and a second key is refused. Also — a body changed after it was signed is refused; a correct signature over a ten-minute-old timestamp is refused; an *unsigned* body that is not JSON is a 401 while a signed one is a 400, which is the order the endpoint promises; a missing public key is a 503 rather than a 401; `/ask` answers a question, a topic, and neither; the message command answers from the message it was pointed at and says so when there are no words in it; a 👍 is ephemeral and a 👎 is reported to a webhook with a link to the answer it was about; and a GET is a 405 |
| **The endpoint, run in workerd** | **verified end to end.** `npm run xiai:dev` started the Worker on a loopback port and a real signed request, signed by a real key pair held for the purpose, was answered: a PING came back `{"type":1}`; `/ask` answered a question, a topic and neither; the message command answered from the message it was pointed at; a 👍 came back with `flags: 64`; and an unsigned request, a ten-minute-old one, a non-JSON one and a GET answered 401, 401, 400 and 405. `worker/.dev.vars` is read from the config file's own directory, which is what the local workflow assumes. |
| **What workerd found that the tests could not** | a real defect, **fixed**: the entry module exported a *value* beside its handler, and the runtime refuses to start one that does — `Incorrect type for map entry 'NO_WORDS'`. The endpoint now lives in `worker/xiaiEndpoint.ts` and `worker/index.ts` re-exports the handler alone, which is the real reason the two files are split |
| The matcher's rules | a rare word beats a common one, a trigger appearing as the phrase it is written beats its words floating about, and the **best** trigger decides rather than the total — otherwise “can i play on my phone” answers with where to play, which is the case that produced the rule |
| **`npm run discord:apply` against the live server** | **run, exit 0.** `#ask-xiai`, `#touchline` and `#known-issues` were created, their pinned posts written, and the run ended with *the server matches the spec in `src/platform/discord.ts`*. `#announcements` is still skipped, because Community is not enabled yet |
| **`npm run xiai -- --register`** | **run.** `/ask` was registered in the guild and read back in `--check` (`registered commands: /ask`) — guild commands appear at once, which is why it is not global |
| **`npm run xiai -- --check`** | **run.** The bot identified itself, connected to the gateway, and Discord said **READY** — which is every handshake in the protocol succeeding at once |
| **`npm run xiai -- --verify` against the deployed endpoint** | **run, exit 0.** It answered a `GET` the way only this Worker does (405, `Allow: POST`), refused a real Ed25519-signed PING with a **401** — the right answer from a deployment, whose key is the application's — and did it in **73 ms** of the three seconds Discord allows. Discord's own `interactions_endpoint_url` was read back and is that same address |
| **`npm run xiai -- --verify` against a local `wrangler dev` run** | **run, exit 0.** With `worker/.dev.vars` holding the public half of `worker/.verify-key`, the signed PING was answered `{"type":1}` in **14 ms** and the Worker logged *the endpoint was checked: PING answered with PONG*. With that file holding a **different** key: exit **1**, *the local endpoint refused the signature: its key is not the one this check signed with*, naming the key to put in the file |
| **`npm run xiai -- --verify` when there is nothing to check** | **run, exit 1 each time**: a name that does not resolve (`fetch failed: getaddrinfo ENOTFOUND`), a `workers.dev` host with no Worker behind it (**404**), and a socket that accepts a connection and then says nothing — refused after the check's own **10 s** bound, because a bare `fetch` there waits for ever rather than failing |
| `src/platform/xiaiVerify.test.ts` | **23 tests.** A PING signed by the check is accepted by the endpoint's *own* verifier, and refused when the key differs or the timestamp is ten minutes old — without which a signature over the wrong bytes would arrive as a 401 and read exactly like a healthy deployment. Also: a seed survives being written down and comes back as the same key; a PONG to a key that was never given reads as a defect and not a pass; a slow PONG is a warning; and Discord's own setting is compared with the address, trailing slash and all |
| **`npm run xiai -- --ask "…"`** | **run**, with no token and no Discord: “how do promotions work” answers from `promotion`, “is there a steam release” from `price`, both with the file they came from, and “what is the capital of peru” is refused rather than guessed |
| The whole suite | **1,140 tests in 87 files, all passing** |
| **A real `/ask`, answered in the server** | **answered, live.** The question arrived as an `INTERACTION_CREATE` frame, the callback POST was accepted and the reply appeared — no failure was logged. It was `what is SE27?`, and the bot did not know it, which is how the knowledge base found its first gap: the project's own shorthand is a trigger now, with the question kept as a test |
| **Running it twice** | the second apply reported every pinned post as *already right, and pinned* — the idempotency this document claims, demonstrated on the live server rather than asserted |

Four defects were found this way and fixed. `process.exit()` with a `fetch`
connection still in Node's keep-alive pool **aborts inside libuv on Windows** —
the run died with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and an
exit status of **127**, which reads as *command not found* to everything watching.
The tool sets `process.exitCode` now, as `tools/release.ts` already did. And
`--announce <version>` did not consume its argument, so the version was reported
as an unexpected argument; the same exercise showed the changelog parser splitting
paragraphs with `\n\n` on a file whose line endings are `\r\n`, which turned a
whole release into one paragraph and trimmed it to nothing. The two the *tests*
found are about XIAI: a trigger — “where do i get” — written entirely in words the
matcher ignores, so it could never have fired, and a scorer that added up every
trigger of an answer rather than taking the best one, which made “can i play on my
phone” answer with *where to play* because that entry has three ways of being
asked about playing and the phone has one.

## 7. What has not been verified

The server has been configured for real, a question has been answered in it, and
the tool has been run twice without changing anything the second time. What is
left is narrower and more specific than it was, and none of it is a claim this
document makes.

| | |
| --- | --- |
| **The endpoint deployed, and Discord pointed at it** | **done, and checked from here.** `npm run xiai:deploy` put the Worker live, its public key is a Worker secret, and the application's Interactions Endpoint URL is that Worker — read back from Discord's API by the check rather than assumed. `npm run xiai -- --verify` also saw it answer a `GET` with 405 and `Allow: POST` and refuse a signed PING with a **401** in 73 ms. What has not happened is a real interaction answered *by the deployment*: that needs somebody to type `/ask` in the server, and until then the evidence is that Discord is pointed at an endpoint that is up and enforcing signatures |
| **Registering the second command** | **run, and accepted.** `npm run xiai -- --register` reported *registered /ask, Ask XIAI in that server*, so Discord took both names rather than refusing the second with a 400 as this row used to warn. What has still not happened is a person using it: no answer has been given from the right-click menu |
| **The vote webhook** | **never set.** A 👎 has been proved against a stubbed `fetch` and never against a real channel webhook, so what the report looks like in a client is unknown — and unset is a supported state, in which case nothing is sent |
| **The local bot's interaction path, remade** | **not exercised over the gateway.** `npm run xiai` now answers with the endpoint's own decision function rather than a copy of it, which is what stops the two answering differently — and the decision is the same code the 28 endpoint tests cover. What has not been run since the change is an interaction arriving over a socket |
| **What the answers look like in the client** | **not seen by me.** A real question has been answered, so the round trip is proved, but the answer as the *client* renders it — the bold title, the `-# ` source line, whether a long answer reads well in a channel — has only been judged by somebody looking at Discord, not by anything here |
| **The bot left running for a long time** | **not done here.** `--check` connects and disconnects on purpose, and the bot has run for minutes rather than days: no reconnect after a real network drop, no rate limit, no resumed session |
| `--icon` | **never run.** The allow/deny arithmetic is tested; the upload is not |
| `--invite` | **never run** |
| `npm run discord:announce` | **never run.** A release has never been posted or crossposted |
| The welcome screen | **never run** — it needs Community, which this server does not have yet |
| Whether Discord accepts the bodies it has not been sent | **not checked against a client:** the icon upload, the invite creation and the welcome screen. The ones it *has* been sent — roles, categories, channels, overwrites, pinned posts and AutoMod rules — were accepted, which is what the apply run above is evidence of |
| `COMMUNITY` as the feature name | **half checked.** The guild object has been read and reported as *not* having it, which is the negative of the string appearing at all; the positive case is unverified until somebody enables Community and re-runs |
| Rate-limit and 5xx handling | **not exercised.** The retry path exists and reads `retry_after`; nothing has made Discord rate-limit this tool |
| Onboarding, the vanity URL, Discovery | **a person's, by design** — §4 |

## 8. Status

| | |
| --- | --- |
| The server as data, with a reason for every decision | **done, tested** |
| The planner, and its three outcomes | **done, tested** |
| The pinned posts, and reading a release out of the changelog | **done, tested** (both line endings) |
| The bot's permissions, and the invite link | **done, tested against the document** |
| The HTTP layer: credential handling, refusal to run with a tracked token, 429/5xx retries, honest 403/404 hints | **written, partly exercised** — the failure paths were run; the successful ones have not been |
| Applying it to a live server | **run**: roles, categories, channels, overwrites, pinned posts and the three AutoMod rules are in the server, and the run ends by saying it matches the spec. `#announcements` waits for Community |
| `src/platform/discord.ts`'s spec reaching the game's own build | **it does not, and should not:** nothing under `src/` imports this outside the tests, and the game itself has no Discord integration, no presence sharing and no account |
| XIAI: the facts, and the matcher that picks one | **done, tested** — 25 tests, 32 facts, and it answers on the command line today |
| XIAI: the endpoint — the contract, the signature, and the three ways to ask | **done, tested, deployed and checked** — 28 tests, run against the real runtime locally, deployed with `npm run xiai:deploy`, and checked live: 405 to a `GET`, 401 to a signed PING, and Discord pointed at it. No interaction has been answered by the deployment yet |
| Each answer's own buttons, and the picker built from its titles | **done, tested** — a 👍 is ephemeral, a 👎 reports to a webhook when one is set |
| `/ask`, and the bot answering it | **done**: registered, connected, and a real question answered in the server. The command line answers the same questions without a token, which is how the knowledge base can be reviewed |
| `#ask-xiai`, `#touchline`, `#known-issues` | **applied and verified**: created by the run above, with their pinned posts, on the live server |
| The answer text as Discord shows it | **not seen**: everything about it is testable except how it looks in the client |
