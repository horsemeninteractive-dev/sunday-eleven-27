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

## Further reading

- [`CHANGELOG.md`](CHANGELOG.md) — what has changed, and what this build is
- [`MATCH_ENGINE.md`](MATCH_ENGINE.md) — where the match actually happens
- [`SE27_Design_Document.md`](SE27_Design_Document.md) — the design, in full
- [`SOAK.md`](SOAK.md) — long runs, and what they are for

## Licence

[MIT](LICENSE) © 2026 Sunday Eleven 27.

Every club, player and town in the game is generated from a seed. There are no
real leagues, clubs or competitions in it.
