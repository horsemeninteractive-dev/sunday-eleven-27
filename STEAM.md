# Sunday Eleven 27 on Steam

What has been built for a Steam release, what has been *decided*, what can be
claimed, and what has not been done. Read it with [`DESKTOP.md`](DESKTOP.md),
which is the packaging this builds on.

> **Status.** This stage produces **no store build and no working Steam
> integration**, and it does not claim one. What exists is a desktop-only seam
> (`desktop/steam.ts` + `desktop/steamRules.ts`), the pure half of it tested in the
> game's own suite, a proposed achievement catalogue, a written Steam Cloud policy
> whose conflict rules *are* tested, and this document. **No Steamworks app record
> exists**, `steamworks.js` is not installed, no Steam client was involved in any
> test, and nothing was uploaded, published or paid for.
>
> Everything below is marked as the kind of claim it is. Where a fact comes from
> Valve's own documentation it is cited; where it came from a secondary source it
> says so; and where it could not be checked on this machine at all, it says that
> instead of being quietly asserted.

## 1. The integration approach, and why

Three options were considered, and only one of them is a live one.

| option | what it is | verdict |
| --- | --- | --- |
| **`steamworks.js`** | a Node-API addon that binds the Steamworks flat API, with a JavaScript wrapper (`steamworks.init(appId)`, `client.achievement.activate(...)`, `client.localplayer.getName()`) | **the approach**, with the compatibility caveat below |
| `greenworks` | the older Node addon that most pre-2022 Electron guides use | **rejected**: widely reported to have been unmaintained since 2022 (secondary sources — not a Valve position), and it is built against specific Electron/Node ABI pairs, which is the failure mode this project least wants |
| `steamworks-ffi-node` | a newer zero-compilation FFI wrapper | **considered, not chosen**: newer and less widely used than `steamworks.js`, and choosing it would mean being the one who finds its Electron bugs. Worth revisiting if `steamworks.js` gives trouble |

**Why `steamworks.js` fits this project.**

- **ABI.** It is a Node-API (napi) addon. Node-API is ABI-stable across Node
  versions, which is the property that matters here: the previously common
  bindings are compiled against one Electron build and stop loading when Electron
  moves, and a native addon that fails to load at startup is a game that does not
  open. This project pins `electron 44.7.0` and requires `node >= 22`
  ([`package.json`](package.json)), and it upgrades Electron on purpose.
- **Platform.** Windows x64 is the only target this stage packages
  ([`electron-builder.yml`](electron-builder.yml)), and it is the platform the
  addon is best served on.
- **Licence.** MIT, which is compatible with this project's own MIT
  ([`LICENSE`](LICENSE)). No copyleft obligation is created by using it.
- **Overlay.** It exposes `electronEnableSteamOverlay()`, which has to be called
  before Electron is ready — the reason `startSteam` is invoked before
  `app.whenReady()` rather than after the window exists.
- **The alternative to an add-on is worse.** Driving Steam Cloud with no SDK at
  all is possible — Steam's Auto-Cloud is configured entirely in Steamworks and
  copies directories — and that is in fact the design below. But achievements and
  the overlay genuinely need the SDK, so the seam exists even though nothing
  unlocks anything yet.

**The compatibility caveat, stated plainly.** The repository for `steamworks.js`
could not be fetched while this was written (the request timed out), so the
assessment above rests on search results and the package's own description rather
than on reading its current source, its release notes or its supported-version
matrix. **The first task of whoever picks this up is to install it and check** —
`npm install steamworks.js`, then `npm run desktop:build` and a launch through
Steam — rather than to trust this table. Nothing here should be read as "this
package is verified compatible with Electron 44".

## 2. What is implemented

The seam is two files, and the split between them is the same split
[`desktop/rules.ts`](desktop/rules.ts) and [`desktop/main.ts`](desktop/main.ts)
already use.

| file | what it is | how it is checked |
| --- | --- | --- |
| [`desktop/steamRules.ts`](desktop/steamRules.ts) | every *decision*: is this a Steam launch, is this achievement name one of ours, which of two career files is newer, does the window fit a handheld. Imports nothing, touches no global. | [`src/platform/steamRules.test.ts`](src/platform/steamRules.test.ts) — 23 tests, calling it directly in the game's own suite |
| [`desktop/steam.ts`](desktop/steam.ts) | the *effects*: the optional require, the init, the unlock, the shutdown. Compiles under `tsconfig.desktop.json` only; no file under `src/` imports it as a module, because the game's `tsconfig.json` has no Node types. | source-level assertions in the same test file — the failure modes here are "does it fail gracefully", which cannot be run without a Steam client |

**Fail gracefully, structurally.** `steamworks.js` is deliberately **not** a
dependency of this project, so the ordinary case on any developer machine is
"the addon is not there". That is not an error path: it is the normal one, and it
is a status object rather than a stack trace. The addon is loaded through
`module.require('steamworks.js')` — a *value*, not an import — because a static
import of a package that is not installed is a compile error, and a compile error
here is a shell that will not build at all. Every call into the native side (the
require, the overlay hook, the `init`, the persona name, the achievement, the
shutdown) is inside its own `try`, and the test asserts there are at least five
of them rather than trusting the author to remember.

**Never blocks startup.** `startSteam()` is synchronous, total, and returns a
status on every path:

```
[se27] steam: not running through Steam — this build was not started by Steam
[se27] steam: not running through Steam — steamworks.js is not installed in this build
[se27] steam: running through Steam as <persona> (app <id>)
```

That line is the entire visible difference between a Steam launch and any other
launch. It is called in the single-instance branch of
[`desktop/main.ts`](desktop/main.ts) **before** `app.whenReady()`, because the
overlay is loaded into the process and attaches to a window it must be loaded
ahead of, and the window is created either way. `steam.shutdown()` runs on
`will-quit`, guarded like everything else: a game that would not close because
Steam would not is the worst possible version of this feature.

**Keep Steam behind a desktop-only adapter.** No file under `src/` imports
`desktop/steam.ts` as a module (the test reads it as raw text instead), the preload
exposes no Steam member, and the renderer's bridge is still the same three
channels it was before. A test asserts the preload does
not mention Steam at all, so the web build, the PWA and the two mobile packages
are untouched by any of this and cannot accidentally acquire a dependency on it.

**Where the app id comes from.** Not from this repository. Steam sets
`SteamGameId` / `SteamAppId` on the processes it launches, and the adapter reads
those; a `steam_appid.txt` beside the executable is the dev-build fallback, and
it is the *last* thing consulted so that a file left over from an afternoon of
testing cannot overrule the client that actually started the game. An id invented
in the source would be worse than none, because it would attach to whichever app
already owns that number. A test asserts `main.ts` carries no app id literal.

**Playtime** is not implemented here and no call makes it happen: Steam records
playtime for the processes its client launches, and this stage adds nothing to
that. Nothing in this repository has verified how a Steam-launched Electron
process appears in the client's own playtime, and it is listed as untested at the
end of this document.

## 3. Achievements

Six, proposed, in [`PROPOSED_ACHIEVEMENTS`](desktop/steamRules.ts), and **none of
them is wired, configured or unlockable**. Each one reads state the simulation
already keeps, which is the test an achievement has to pass before it is worth
having — an achievement whose trigger had to be invented is a checkbox:

| API name | title | what a trigger would read |
| --- | --- | --- |
| `FIRST_MATCH` | Take Charge | the first fixture played to full time |
| `FIRST_WIN` | Three Points | the first competitive win |
| `SEASON_COMPLETE` | A Full Season | a season that archived, where the champion is crowned |
| `PROMOTED` | Up the Ladder | a `promoted` record in `state.promotionHistory` |
| `CHAMPIONS` | Champions | a league title |
| `CUP_WINNER` | A Trophy for the Cabinet | a cup whose `winnerClubId` is the manager's club |

**Why the triggers are not wired.** An achievement is a promise to the player that
the game noticed something, and the game's own milestones are read off a
simulation that is deliberately unchanged by this stage. Wiring a trigger means
(a) deciding where in the game's own code the milestone is observable without
touching the engine, (b) adding a bridge member so the renderer can tell the shell
— which is a *new capability exposed to a web page*, and the current preload's
whole claim is that there are three — and (c) playing it through. That is a
change that needs a playtest, not a guess, so it is left to a stage that can do
it properly.

What is in place is the seam it would use: `unlockAchievement(apiName)` validates
the name against the catalogue and **refuses anything else rather than sending
it**, so the only names that can ever reach a Steamworks call are the six above.
Nothing calls it yet, and it is documented as such where it is declared.

## 4. Steam Cloud

### The thing that has to be understood first

**The game's careers are not files.** They live in IndexedDB, keyed by the
`app://se27` origin, inside `%APPDATA%\Sunday Eleven 27\`. Steam Cloud — including
Steam's Auto-Cloud, which needs no SDK at all — synchronises *files and
directories*. A browser database is neither, and this was already written down
before this stage began ([`DESKTOP.md`](DESKTOP.md#careers-exports-and-steam)):

> **Nothing here assumes that IndexedDB is compatible with Steam Cloud.**

So the prerequisite for Cloud Saves is not a Steam API call. It is a **file-backed
career store**: the game's canonical save has to become one JSON file per career in
a directory, and IndexedDB has to stop being the only place a career lives.

The format for that already exists and is already tested: the career file, written
by `exportCareer` and read by `parseCareerFile`
([`src/state/careerFile.ts`](src/state/careerFile.ts)). It is `se27.career`,
`formatVersion 1`, carrying the game's own `SaveFile` (`version 16`, `savedAt`,
`state`) unchanged, and it is already the thing that moves a career between the
browser, the phone and the desktop. A cloud save should be *that file*, not a new
dialect — and the migrations stay the ones the database already runs.

### The design

| | |
| --- | --- |
| **canonical location** | `%APPDATA%\Sunday Eleven 27\careers\` — i.e. `app.getPath('userData')/careers`. `userData` is the one directory the application is guaranteed to be able to write, it is already where the application's own state lives, and it sits under a root Steam's Auto-Cloud knows (`WinAppDataRoaming`), so the configuration is a root plus a subdirectory rather than a machine-specific absolute path |
| **what syncs** | only files matching [`isSyncedCareerFile`](desktop/steamRules.ts): the `sunday-eleven-27-career` prefix, a `.json` extension, no path separators, not hidden, and **not the `.part` temporary file** a save is written through. `window-state.json`, logs and everything else the application writes are excluded by that rule rather than by hoping |
| **The exports folder is separate** | `Documents\Sunday Eleven 27\careers\` stays exactly what it is: where a manager *exports* a copy he keeps. Cloud sync is about the career he is playing, and the two must not be conflated |
| **strategy** | Steam **Auto-Cloud**, configured in Steamworks (App Admin → Steam Cloud): Root `WinAppDataRoaming`, Subdirectory `Sunday Eleven 27\careers`. No `ISteamRemoteStorage` calls are made and none are planned: fewer moving parts, and the same files reachable by a manager with a file manager |
| **interrupted writes** | nothing half-written can sync. `writeCareerFile` in [`desktop/main.ts`](desktop/main.ts) writes to `<name>.part` and renames into place, and the sync rule excludes `.part` by name — so the file Steam sees is always a whole career |

### Conflicts, which is the part that can be tested today

[`resolveCloudConflict`](desktop/steamRules.ts) is pure and is tested in
[`src/platform/steamRules.test.ts`](src/platform/steamRules.test.ts). It answers
one question — *which of two copies of the same career do we keep?* — and the rule
it turns on is the one that matters: **a stale autosave never overwrites a newer
career.**

| the two copies | the answer |
| --- | --- |
| only one exists | keep it; nothing to back up |
| local is newer by more than the clock skew | upload local, **back up the remote copy first** |
| remote is newer by more than the clock skew | take remote, **back up the local copy first** |
| the two are within the skew of each other | **change nothing** |
| either timestamp cannot be read | **change nothing** |

Two machines do not share a clock and Steam Cloud copies files rather than ordering
events, so a laptop whose clock is a minute fast would otherwise look newer every
single time — hence the skew window, inside which the copies are *indistinguishable*
and the answer is to touch neither. Every branch that replaces one copy with the
other sets `backup: true`, so the recovery path for the copy that lost is a file on
the disk rather than a hope. And an unreadable timestamp never overwrites anything:
a file that does not say when it was written has told us nothing about which copy
is newer.

**Local play never needs Steam.** The policy's no-evidence answer is `keep-local`,
the game reads and writes local files, and Steam Cloud is a copy step the client
performs around the game rather than something the game waits for. A machine with no
network, no client and no account plays exactly as it does today.

### What this means for the status of Cloud Saves

**Cloud Saves are not complete, and this document does not claim they are.** What
exists is the format decision (the tested career file), the location decision, the
scope rule (what syncs and what does not), and a tested conflict policy. What does
not exist is the file-backed store itself — the change that makes a career on disk
*canonical* instead of a copy of one in a database — and it is deliberately not
attempted here, because it changes the game's own persistence and the requirement
for this stage is that the authoritative simulation and the existing career
migrations are unchanged.

**And the synchronisation itself cannot be tested in this environment at all.**
Two Steam clients, a signed-in account, an app record with a cloud quota, and
Auto-Cloud configured: none of that exists here. Nothing about the client's own
behaviour — how it resolves a conflict, when it uploads, what happens if the
connection drops mid-copy — has been observed. **The policy above is a design that
has been tested; the sync is not.**

## 5. Packaging and uploading

### The build

Unchanged from [`DESKTOP.md`](DESKTOP.md):

```bash
npm run desktop:pack     # typecheck, build the shell and the game, then an installer
# → desktop-release/Sunday-Eleven-27-Setup-0.10.1.exe
```

For Steam the deliverable is not that installer: it is a **depot of the game's
files**, uploaded with Valve's own [SteamCMD](https://partner.steamgames.com/doc/sdk/uploading).
`desktop-release/win-unpacked/` is the directory a depot would be built from — and
note that an NSIS installer is the wrong artifact to hand Steam, which manages the
installation itself.

### What would have to change before a depot exists

This is the packaging gap, stated rather than hidden:

- **The native addon is not in the package.** [`electron-builder.yml`](electron-builder.yml)
  ships exactly five things and excludes `node_modules/**`, so `steamworks.js`, its
  prebuilt `.node` binary and `steam_api64.dll` are not in the installer. Adding
  them is a deliberate change to that list *and* to
  [`src/platform/desktopPackaging.test.ts`](src/platform/desktopPackaging.test.ts),
  which pins the list precisely so that a file cannot reach a package quietly. That
  test was deliberately not weakened here.
- **`steam_appid.txt` must never ship.** It is a dev aid, it names an app id, and it
  belongs beside a developer's executable and nowhere else. A depot containing one
  is a build that ignores the client.
- **The overlay needs the client's own redistributable.** On Windows the SDK's
  `steam_api64.dll` has to be present next to the executable in the depot.

### Uploading, once there is an app record

```
# app_build_<appid>.vdf
"appbuild"
{
  "appid" "<appid>"
  "desc"  "Sunday Eleven 27 0.10.1"
  "buildoutput" "steam-build-output"
  "contentroot" "desktop-release\win-unpacked"
  "setlive" ""                       # nothing goes live without saying so
  "depots"
  {
    "<depotid>" "depot_build_<depotid>.vdf"
  }
}
```

```bash
steamcmd +login <build-account> +run_app_build ..\app_build_<appid>.vdf +quit
```

**Credentials never enter this repository.** SteamCMD logs in as a *build account*
with Steam Guard, and the guard code is a second factor that arrives by email or
app — so a build is never fully unattended, and that is a feature rather than an
obstacle. The account name and any cached credentials belong in the build
machine's own environment or in a CI secret store, exactly as the Android upload
key already does; the repository's `.gitignore` already refuses keystores,
certificates and service-account JSON, and the same rule applies to a Steam build
configuration that carries anything secret. Nothing here is committed, and
`publish: null` in [`electron-builder.yml`](electron-builder.yml) remains true:
electron-builder is not asked to publish anything.

## 6. Store checklist

### Verified from Valve's own documentation

- **Steam Direct fee: $100 USD per app.** Not refundable, and **recoupable** in the
  payment made after the app reaches **$1,000 adjusted gross revenue** —
  <https://partner.steamgames.com/doc/gettingstarted/appfee>
- **A 30-day waiting period** between paying the app fee and being able to release
  the game — <https://partner.steamgames.com/steamdirect>. The clock starts when the
  fee is paid, not when the build is ready.
- **Steam Cloud / Auto-Cloud**: Root Paths and the pattern-based configuration —
  <https://partner.steamgames.com/doc/features/cloud>

### Owner actions, none of which can be done from here

- [ ] A Steamworks partner account; the $100 app fee paid for this app; the 30-day
      clock started the day it is paid.
- [ ] An app record created, with the **achievement API names from §3 typed into it
      exactly as they appear in `PROPOSED_ACHIEVEMENTS`** — a mismatch is an unlock
      that silently does nothing.
- [ ] Steam Cloud switched on for the app, with the Auto-Cloud root and
      subdirectory from §4, and a quota large enough for a career (the exported
      careers measured on this project were several megabytes each).
- [ ] A build account, with Steam Guard, and its credentials kept out of the
      repository.
- [ ] A store page: capsule art, screenshots, a description, a trailer if there is
      one, supported operating systems (Windows only, today), languages.
- [ ] Content disclosures and the age/content questionnaires on the store page.
- [ ] Controller support declared honestly — **none is implemented** (see §7), and
      the store page must not imply otherwise.
- [ ] Nothing uploaded, published, or set live without explicit approval. This stage
      uploads and publishes nothing.

The artwork in [`store/`](store/README.md) is a starting point, not a submission:
Steam's own capsule sizes are specified by Valve and have not been produced here.

## 7. Steam Deck and controller

**No `Steam Deck Verified` claim is made, and no controller support has been
implemented or tested.** Neither can be earned from this machine.

What *can* be said, and is tested: the smallest window the game will ever present
is `MIN_WINDOW_WIDTH` × `MIN_WINDOW_HEIGHT` — 1024 × 700
([`desktop/rules.ts`](desktop/rules.ts)) — and that fits inside a Steam Deck's
1280 × 800 panel, which is what [`windowFitsHandheld`](desktop/steamRules.ts)
asserts. That is a **resolution fact and nothing more**. It is not a comfort
claim, and the things Valve's Verified programme actually asks about are all
unanswered here:

| question | status |
| --- | --- |
| Does the UI render legibly at 1280 × 800 on a 7-inch screen? | **untested.** The layout was checked at phone widths while the mobile shell was built ([`ANDROID.md`](ANDROID.md)), but not at the Deck's, on a Deck |
| Are the touch targets usable? | **untested.** Mobile work set a 44 × 36 minimum for touch, which is evidence about phones, not about the Deck |
| Does text entry work with the on-screen keyboard? | **untested on Deck.** It was exercised in the Android shell; a Deck is a different compositor |
| Does the game work with a gamepad? | **not implemented.** Electron passes gamepad input through to Chromium's Gamepad API, and the game reads none of it: keyboard and mouse are the only inputs, which is exactly why the task says not to touch them without a validated controller path |
| Does the Steam overlay draw over the window? | **untested.** The hook is called in the right place and before `init`, which is all that can be checked without a client |
| Does it suspend and resume? | **untested.** The shell's window lifecycle is Electron's own and the mobile shell's resume behaviour is a different mechanism |

Adding controller support is a change to the game's own input handling, and the
task's condition is explicit: only if it can be validated **without damaging
keyboard and mouse**. Nothing about the current UI has been changed for a
handheld.

## 8. Status

| feature | status |
| --- | --- |
| Integration approach chosen and argued | **done** (with the compatibility caveat in §1) |
| Steam launch detection (app id from the client, dev file fallback) | **implemented, tested** |
| Graceful failure with no Steam / no addon / no client | **implemented, tested** — by construction and by source assertions; the *Steam-present* path has never run |
| Never blocks startup, never touches a career | **implemented, tested** |
| Desktop-only adapter, renderer untouched | **implemented, tested** |
| Playtime | **not implemented.** Steam tracks playtime for the games it launches; nothing here adds to it, and how a Steam-launched Electron process appears in the client is untested |
| Achievement catalogue | **proposed, validated, not configured, not wired** |
| Achievement unlocking | **interface implemented; no trigger calls it** |
| Steam Cloud format, location and scope | **designed**, using the tested career file format |
| Steam Cloud conflict policy | **implemented, tested** |
| File-backed canonical career store | **not implemented** — the prerequisite, deliberately out of this stage's scope |
| Actual cloud synchronisation between two clients | **not tested, and not testable in this environment** |
| Reproducible Windows installer | **done in the previous stage** ([`DESKTOP.md`](DESKTOP.md)); unchanged here |
| Depot + SteamCMD upload pipeline | **documented, not run** |
| Steam Direct fee and waiting period | **verified from Valve's documentation** |
| Store checklist | **written**; every item is an owner action |
| Steam Deck resolution fit | **tested** (1024 × 700 inside 1280 × 800) |
| Steam Deck comfort, touch, on-screen keyboard, overlay | **not tested**; no Verified claim |
| Controller support | **not implemented, not tested** |

### What was run for this stage

| check | result |
| --- | --- |
| `npx tsc --noEmit` (the game, including `desktop/steamRules.ts`) | clean |
| `npx tsc -p tsconfig.desktop.json --noEmit` (the shell, including `desktop/steam.ts`) | clean |
| `npm test` — the whole suite | **923 passed, 76 files, 0 failed** — including the 23 new Steam tests and every existing desktop, packaging, release, persistence and simulation test |
| `npm run build` (the website and the PWA) | succeeds; `dist/` carries `sw.js`, `_headers` and `og.png`, and the precache manifest lists 55 files — unchanged by this stage |
| `npm run build:native` (the mobile bundle) | succeeds and says so (`native-bundle: left out sw.js, _headers, og.png`), so the phone build is independent of Steam |
| `npm run desktop:build` (typecheck, shell, renderer) | succeeds; the shell emits `steam.js` and `steamRules.js` into `desktop/build`, which the existing `files` list already carries, so the packaging configuration and the test that pins it are untouched |
| The renderer cannot reach Steam | no file under `src/` imports the adapter as a module, the preload exposes no Steam member, and a source assertion holds both down |
| The simulation and the career migrations | unchanged: no file under `src/domain`, `src/simulation` or `src/state` was edited by this stage |

**Not run, and not claimed:** `npm run desktop:pack` and `npm run desktop:smoke`
were not repeated, because this stage changes nothing the installer consumes beyond
two files in an already-shipped directory — the packaging was verified in the
previous stage ([`DESKTOP.md`](DESKTOP.md#what-has-been-verified)) and no native
addon exists to package yet. And nothing at all was run against a Steam client,
because there is none on this machine: **every Steam-present path in this document
is unexecuted.**
