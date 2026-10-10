# Sunday Eleven 27 as a desktop application

The game is one application with three packagings. `npm run build` produces the
website; `npm run build:native` produces the Capacitor shell for a phone; and
`npm run desktop:renderer` produces the renderer that goes *inside* an Electron
application, which is the same bundle the website ships, built by the same Vite
config, running the same simulation through the same components.

This is the stage before a store. There is a dependable local build, a reliable
place for a career to live, and a script that opens the installed application and
plays through a career to prove both. There is no updater here, and the Steam
work that exists is a *seam* rather than a feature: no app record has been
created, no achievement unlocks, no cloud save syncs and no Steam client was
involved in any test. [`STEAM.md`](STEAM.md) is where all of that is written
down, including what has and has not been verified about it; nothing in it
changes anything in this document.

## Commands

| command | what it does |
| --- | --- |
| `npm run desktop:art` | draw the installer's own artwork from the favicon → `desktop/resources/installerHeader.bmp` and `installerSidebar.bmp` |
| `npm run desktop:shell` | compile the main process and the preload (`tsc -p tsconfig.desktop.json`) → `desktop/build` |
| `npm run desktop:renderer` | bundle the game for the shell (`vite build --mode desktop --outDir desktop/renderer`) |
| `npm run desktop:build` | typecheck, then both of the above |
| `npm run desktop:dev` | the desktop build, then run it in a window (no installer) |
| `npm run desktop:start` | run what is already built (`electron .`) |
| `npm run desktop:pack` | the desktop build, then an installable Windows `.exe` into `desktop-release` |
| `npm run desktop:smoke` | drive the *installed* application through a career, end to end |

```bash
npm run desktop:dev                 # see the game in the shell
npm run desktop:pack                # → desktop-release/Sunday-Eleven-27-Setup-0.10.2.exe
npm run desktop:smoke               # the installed app, checked from the outside
npm run desktop:smoke -- --exe="desktop-release\win-unpacked\Sunday Eleven 27.exe"
```

Three directories are generated and all three are ignored by git: `desktop/build`
(the compiled shell), `desktop/renderer` (the game), and `desktop-release` (the
installer). None of them is `dist/`, which is what Cloudflare Pages deploys, and
neither build can write into the other's output.

## How it is put together

```
desktop/
  main.ts       the main process: one window, one origin, two messages
  preload.ts    the sandboxed preload: three frozen members on window.se27Desktop
  contract.ts   what crosses the bridge, written down once (types only)
  rules.ts      the decisions, in a module the game's own test suite can read
  package.json  marks desktop/build as CommonJS, which a sandboxed preload must be
  build/        compiled output (ignored)
  renderer/     the game, built for the shell (ignored)
```

**The game is loaded from its own bundled build and nowhere else.** The shell has
no `server.url`, so it cannot load the website even by accident, and the one URL
in `main.ts` is `app://se27/index.html`. It is a *custom scheme* rather than
`file://` because a career lives in IndexedDB, Chromium keys that by origin, and a
`file://` document's origin is opaque — which is a game that cannot reliably find
the careers it saved yesterday. The scheme is registered `standard`, `secure` and
`codeCache` before the application is ready, and every asset request is served
out of the renderer build by a handler that refuses anything resolving outside
it (see `assetRequestPath` and the `resolve`/`startsWith` check in `main.ts`).

**The renderer is a sandbox with no Node in it.** `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. The only thing a
page in it can reach is the preload's `window.se27Desktop`: `platform`,
`saveCareerFile(name, text)`, `onFlushRequested(handler)` and `flushDone()`. There
is no file system, no shell, no arbitrary IPC and no `require` on that side of the
bridge, and the object is frozen.

**Everything crossing the bridge is validated where it lands.** A write is
refused unless the message is exactly `{ name, text }` with no extra fields, the
name is turned into a file name (`careerFileName`: no separators, no control
characters, no leading dot, no other filesystem's refusals), the contents must be
non-empty and under 64 MB, and the sender must be the game's own main frame at
`app://se27`. A refusal is always an answer rather than an exception, because the
game turns answers into sentences and thrown errors into nothing.

**The window shuts the doors the game never opens, out loud.** No new windows, no
navigation off-origin, no webviews, no downloads (a career export goes through
the bridge, which can say where the file went). The session grants two
permissions — `fullscreen`, which is the manager's own preference on the match
screen, and `persistent-storage`, which the game asks for the first time it writes
a career — and logs every other refusal. The second one was found by *running the
packaged application*: refusing it made the save screen tell the manager his
careers were kept "on a best-effort basis and can be cleared", which is true of a
website in a shared browser profile and false of an installed application whose
profile is its own directory.

**Closing waits for the last save.** The game writes the career it is playing on
a debounce; the shell holds the close, asks the game to finish, and waits for its
answer (or five seconds) before the window goes. The log says which happened:

```
[se27] closing: asking the game to finish its last save
[se27] closing: the game confirmed its last save
```

## The installer's own face

The wizard is the game's rather than the framework's, in three pieces:

- **`desktop/resources/installerHeader.bmp`**, 150×57, drawn at the right of the
  header bar on every page that has one — the app's own tile, the name, what game
  it is, and a green rule along its bottom edge;
- **`desktop/resources/installerSidebar.bmp`**, 164×314, the panel MUI paints
  down the left of the welcome and finish pages (and of the uninstaller's
  welcome page, which reads the same file);
- **`desktop/resources/installer.nsh`**, which is included at the top of the
  generated NSIS script and is what says *what* the installer says: a welcome
  page, the finish page's wording and its link to the website, and a question
  before it throws an installation away.

Both bitmaps are generated from `public/favicon.svg` and the game's palette by
`npm run desktop:art` (`tools/installerArt.ts`, which needs `sharp` — a
development dependency; the bitmaps themselves are committed), and the words on
them are set from `assets/fonts` — four subsets of the game's own Archivo, read
by `tools/typeOutline.ts` — so the plate is drawn in the face the installer's
wizard is a notice about rather than in whatever the machine offers. They are the sizes
MUI asks for and they are **BMP** because that is the only format `makensis`
reads: `electron-builder.yml` hands those two paths straight to it. The tool
reads its own output back and counts pixels per band, so a mark that failed to
rasterise or a wordmark too wide for its strip fails there rather than in an
installer somebody is halfway through running.

The chrome is deliberately left as the framework's. MUI's `MUI_BGCOLOR` paints
the header bar and both hero pages, and the game is dark, so a near-black wizard
is the obvious next step — and MUI's own bug #443 refuses it: a **themed check
box ignores the text colour it is given**, and MUI only works around that in
high-contrast mode, so the finish page's "Open Sunday Eleven 27" would be black
on near-black. A dark finish page without the bug means a hand-written page
replacing the framework's, which is a lot of NSIS to own for one screen. So the
pages stay white and the identity is carried by the two pictures and the words.

The icons are already the game's: electron-builder defaults both the installer's
and the uninstaller's to the application icon, which is the same mark. Nothing in
this file code-signs anything — see the note below about SmartScreen.

## Where everything lives

| what | where | notes |
| --- | --- | --- |
| the application | `%LOCALAPPDATA%\Programs\Sunday Eleven 27\` | per-user install; the shortcut is on the desktop and in the Start menu |
| the game's own files | `…\resources\app.asar` | `desktop/build` + `desktop/renderer`, and no `node_modules` |
| **careers** | `%APPDATA%\Sunday Eleven 27\` (IndexedDB, origin `app://se27`) | what the game plays from; nothing else writes here |
| **exported careers** | `Documents\Sunday Eleven 27\careers\` | one JSON file per career, named for the club and the in-game date |
| the window's last position | `%APPDATA%\Sunday Eleven 27\window-state.json` | restored if that screen is still there |

`app.getPath('userData')` is `%APPDATA%\<productName>`, which is why
`package.json` declares `productName: "Sunday Eleven 27"`: the install directory,
the Documents folder, the Start menu entry and the data folder all say the same
words. An earlier development build used the package name as the folder
(`%APPDATA%\sunday-eleven-27`); no released build ever wrote there, and this one
neither migrates nor deletes it.

An uninstall leaves the careers alone. `deleteAppDataOnUninstall: false` in
`electron-builder.yml` states it, and uninstalling and reinstalling was tested
with the career still there afterwards.

## Careers, exports and Steam

A career is written to IndexedDB inside the application's own profile, and the
game already treats that carefully: it asks the browser to keep the storage, it
says on the save screen what the answer means, and it never claims a save landed
when it did not. On a desktop the answer is `granted` because the shell allows
`persistent-storage`, and the sentence the manager reads is the true one.

**Nothing here assumes that IndexedDB is compatible with Steam Cloud.** It is not
a file: it is a browser database inside a profile directory, and a store's cloud
is a different mechanism entirely. What moves a career between machines today is
the *export* — `sunday-eleven-27-career-<club>-<date>.json`, the game's own
`SaveFile` plus three fields saying what it is — and it is the same file in every
package, read by the same reader (`src/state/careerFile.ts`), so a career exported
in the browser imports on a desktop and the other way round. A desktop save is
never silently migrated, deleted or moved: the export is a copy, and restoring a
file becomes the career being played without touching the manager's own slots.

A future Steam build would move that copy into Steam Cloud, or write the careers
as files in the first place — a decision to make deliberately, with the export
format already in place as the thing to write.

## What has been verified

Run on this machine (Windows 10.0.19045, Node 24.14.0, Electron 44.7.0,
electron-builder 26.15.3), against the **installed** application:

| question | how | result |
| --- | --- | --- |
| does a Windows package build reproducibly? | `rm -rf desktop-release && npm run desktop:pack`, three times | succeeds each time; `Sunday-Eleven-27-Setup-0.10.1.exe`, 112 MB |
| is the identity stable? | the executable's own metadata | `ProductName Sunday Eleven 27`, `FileVersion 0.10.1` (the version in `package.json`), `CompanyName Horsemen Interactive`, an icon |
| does it install cleanly? | uninstall silently, then install silently | the install directory is removed and recreated, the shortcut and uninstall entry point at `%LOCALAPPDATA%\Programs\Sunday Eleven 27`, and a career written before the reinstall is still there afterwards |
| does the installed app open the game? | `npm run desktop:smoke` — **34 of 34 checks pass** | it loads `app://se27/index.html`, renders the game's own screens, and the bridge has exactly the four members it claims |
| does it work offline? | the same run | **zero** network requests: every resource the page loaded is `app://se27`, and the renderer bundle contains no hosted address |
| can a career be created in it? | the smoke run clicks the real screens: profile → generate world → take charge | yes, with the seed the script typed on the world it got |
| does a career survive close and reopen? | a real `WM_CLOSE`, then a second launch | the window closes with exit code 0 *after* the shell logs that the game finished its last save; the second launch comes up with the career already resumed, and the menu lists it by club and seed |
| does the export write a real file? | the game's own export screen | `Documents\Sunday Eleven 27\careers\sunday-eleven-27-career-<club>-2026-07-20.json`, 3.1 MB, `format: se27.career`, `version: 16`, `app: 0.10.1` |
| does that file import back in? | `DOM.setFileInputFiles` on the game's own restore input | the game asks before opening it, and the career opens back up |
| does it stay responsive? | frames sampled in the page while the game is running, and the time a screen takes to open | 60 fps (150 frames in 2.5 s); the dashboard → team screen takes 81 ms |
| are the keyboard and Escape handled? | Escape dismisses the dialog stack in the smoke run | yes |
| is the *real* exported file readable by the browser build? | the file the installed app wrote, put through the game's own `parseCareerFile` outside Electron | parses with no error: `Uphcott Veterans`, seed and season intact, `writtenBy 0.10.1`, save version 16, 1 062 people, 36 clubs, 403 fixtures in a 3.3 MB file — so the desktop's export is the browser's import, and the migrations the reader runs are the same ones |
| do multiple careers and the migrations still work? | `npx vitest run --config vitest.slow.config.ts src/state/persistence.test.ts` | 54 passed — slots, the autosave, the resume slot and every stored save version |
| does the installer carry the game's own artwork? | `npm run desktop:art`, then the two bitmaps decoded by a browser | `installerHeader.bmp` reads back as 150×57 and `installerSidebar.bmp` as 164×314 — the sizes MUI draws — and the tool's own checks pass: the accent green where the design puts it, and a line of text rasterised in every band |
| does the wizard actually say the game's words? | the packed setup run on this machine, with the page's own controls read back through Win32 | the window is `Sunday Eleven 27 Setup`, the first page's controls read `Welcome to Sunday Eleven 27` and the two paragraphs written in `installer.nsh`, and the run installs the application and launches it from the finish page |
| is that artwork on the screen? | the welcome page photographed at 1280×800 and counted | 1 606 pixels of exactly the accent green and 8 743 of exactly the artwork's near-black: the sidebar panel, on the real page, at 1:1 |
| has the football changed? | `npm test` (900 tests, 75 files) and `npm run typecheck` | unchanged and green; the desktop shell adds no game code |
| does the web build still work? | `npm run build` | `dist/` is built by the same command as before, with `sw.js`, `_headers` and `og.png` present; the desktop build leaves those three out of *its* output only |

The smoke script is `tools/desktopSmoke.mjs` (`npm run desktop:smoke`). It adds no
dependency: Electron publishes Chromium's DevTools protocol on
`--remote-debugging-port`, and Node speaks HTTP and WebSocket. It exits non-zero
if any check fails and prints a JSON report of every check, and it can be run
against the installed application (the default) or against a build in
`desktop-release/win-unpacked` with `--exe=`.

## What has not been verified, and what is left

- **A machine with no development environment.** The installer was uninstalled,
  reinstalled and run as an end user would (silent install, shortcut, first
  launch, career created and reopened), but this machine also has Node and the
  toolchain on it. Nothing in the package reads them — the runtime is Electron's
  own, bundled, and `files` ships no `node_modules` — and the zero-network check
  above is the evidence that it needs nothing outside itself, but a genuinely
  clean Windows install has not been done.
- **A watched match, end to end, from the installed application.** The match
  screens are the website's own and the smoke script opens the app, creates a
  career and plays through the season's screens, but it does not yet click a
  fixture, watch ninety minutes and stop at full time. The engine's timing is
  measured by `npm run benchmark` on this machine rather than in the shipped
  window.
- **The finish page's own wording, read back from a real run.** The welcome
  page was verified that way and the finish page's copy is set through the same
  kind of define, but the run that would have read it was stopped part-way (the
  wizard had to be answered past an elevation prompt first, and this machine
  already had a per-machine installation). What is verified is that the
  installer builds with those defines in place — `warningsAsErrors` is on, so a
  name MUI did not recognise would have failed the build — and that the run's
  last page works, because it launched the game. The abort warning is in the
  same position: written, compiled, and not yet seen on screen.
- **How the new chrome looks, judged rather than measured.** The welcome page's
  artwork was counted on screen and its text read back; whether the header plate
  sits well on the white header bar of the folder and progress pages is a
  judgement nobody has made yet. `screens/installer-art.html` shows the two
  bitmaps in the mock contexts they are drawn in, which is where to look.
- **Code signing.** The installer is unsigned (electron-builder signs with
  `signtool.exe` only if a certificate is configured), so Windows SmartScreen
  warns on first run. A store release needs a certificate.
- **Auto-update.** There is none, deliberately: `publish: null` and no
  `electron-updater`. This stage produces an installer and stops. Steam is a
  separate document — [`STEAM.md`](STEAM.md) — and the seam it describes ships no
  addon, so this installer is the same installer it was.
- **macOS and Linux.** The configuration targets Windows x64. The shell has no
  Windows-specific code (`desktop/rules.ts` is platform-neutral and the window
  behaviour is Electron's own), but neither target has been built.
- **A second monitor, high DPI and every Windows scaling mode.** The window
  clamps itself to the work area and pulls a remembered position back into view
  when the screen it was on is gone (both are unit-tested in
  `src/platform/desktopRules.test.ts`), but the display arrangements themselves
  were not exercised beyond this machine's two.
