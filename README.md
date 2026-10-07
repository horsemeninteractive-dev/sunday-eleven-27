# Sunday Eleven 27

A Sunday league football management game. A whole county of local clubs, players
with jobs and families, and a season that carries on whether you are watching it
or not.

Play it at **[sundayeleven.pages.dev](https://sundayeleven.pages.dev)** — it runs
entirely in the browser, saves as you play, and installs offline.

> **One match. One engine. One authoritative state.** The football happens in one
> place. Everything else — the view, the commentary, the statistics — observes
> what the engine has already decided.

## What it is

You take charge of one club in a three-tier pyramid of 36 clubs. The season runs
fortnightly from September, the cups take the Sundays in between, and a winter
morning can take your fixture off you. Nothing waits for you: the world advances
whether you are looking at it or not, and the inbox tells you what happened while
you were away.

- **A calendar, not a fixture list.** League matchdays are a fortnight apart, so
  a season lasts the year rather than finishing in February. Cup rounds are
  spread through it with the finals at the back.
- **Two cups that finish.** The League Cup runs a preliminary of eight, a round of
  thirty-two, then down to a final; the Plate is fed from both opening rounds.
  Every club plays at least twice before it can be knocked out.
- **Postponements that mean something.** A waterlogged pitch is P-P with the
  reason and the rearranged date, and a fixture that cannot be placed three times
  is abandoned rather than shuffled around for ever.
- **A match engine worth looking at.** Roughly 24,000 lines simulating one clock
  — players hold shape, the ball has to be won, goals come from something a
  person would recognise. See [`MATCH_ENGINE.md`](MATCH_ENGINE.md).
- **Touchline, named.** The simulation underneath the game has a name: the first
  launch with nothing saved introduces it, briefly and only once, and the credits
  say what it is. See
  [`TOUCHLINE_ARCHITECTURE.md`](TOUCHLINE_ARCHITECTURE.md).

## Running it

```bash
npm install
npm run dev        # http://localhost:5273
```

| command | what it does |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | typecheck, then build to `dist/` |
| `npm run preview` | serve the built game |
| `npm test` | the test suite |
| `npm run soak` | play out long runs and report on them |
| `npm run benchmark` | time the two match simulation modes, and compare their fingerprints |
| `npm run release` | cut a release: version, changelog, build, deploy, tag |

Releasing is one command, and it insists on the order:

```bash
npm run release -- --minor --title="the people who run the club"
```

The number that moves is said with `--major`, `--minor` or `--patch`, or as an
exact version (`npm run release -- 0.8.0 --title="…"`). Below 1.0.0 the project
reads the rule in the way the changelog says it does: features arrive in the
minor number, fixes in the patch, and the major is the one that makes it 1.0.0.

Write the notes under `## [Unreleased]` in `CHANGELOG.md` first, then run it. It
bumps `package.json`, folds those notes into a dated heading, runs the guard on
the changelog, builds, checks the built bundle carries the new number, commits,
deploys to Cloudflare Pages and tags the commit — stopping, with the tree put
back exactly as it was, at the first thing that does not check out. Add
`--dry-run` to rehearse, `--push` to send the branch and tag on, or `--no-deploy`
to stop after the commit.

There are also read-out tools for inspecting a single match, a season's timeline
and the balance of the world:

```bash
npm run match-readout
npm run timeline-readout
npm run balance
```

## How it is put together

```
src/
  domain/       types and rules that do not depend on anything else
  simulation/   the world: calendar, competitions, players, and the match engine
  state/        the store, and saving to IndexedDB
  ui/           React components and styles
```

The simulation is deterministic: a seed produces the same county every time, and
saves carry that seed forward. A season simulated twice from the same seed is the
same season.

The match engine is deliberately separate from everything that watches it, so the
same engine can drive a 2D view, a list of events, or something not built yet.

There are two ways to play a fixture. The manager's own match runs on the full
engine — the spatial simulation he watches — and so does every other game the
world would otherwise need him to look at; the remaining fixtures of a matchday,
and every other club's season, run through a lightweight background mode that
writes the same result, the same goalscorers and the same player record without
moving anybody or drawing anything. A whole division's Sunday costs a few tens of
milliseconds that way rather than a minute. Both modes are documented in
[`MATCH_ENGINE.md`](MATCH_ENGINE.md#0-the-two-modes--read-this-first).

## Further reading

- [`CHANGELOG.md`](CHANGELOG.md) — what has changed, and what this build is
- [`TOUCHLINE_ARCHITECTURE.md`](TOUCHLINE_ARCHITECTURE.md) — the football simulation: what owns what
- [`MATCH_ENGINE.md`](MATCH_ENGINE.md) — where the match actually happens
- [`SE27_Design_Document.md`](SE27_Design_Document.md) — the design, in full
- [`SOAK.md`](SOAK.md) — long runs, and what they are for

## Licence

[MIT](LICENSE) © 2026 Sunday Eleven 27.

Every club, player and town in the game is generated from a seed. There are no
real leagues, clubs or competitions in it.
