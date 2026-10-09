# Sunday Eleven 27 on Android

How the game becomes an application you can install on a phone, and what is
actually true about it today.

> **Status.** Built, installed and played on a real phone. The native target
> builds, the bundle it produces *is* the game, and that bundle carries no
> service worker, no install offer and no update bar. The APK has been built
> (`assembleDebug`), its contents checked against `dist/` file by file, and it
> was installed and driven over wireless `adb` on a **Pixel 7a, Android 17
> (API 37)**: cold launch, a career created from scratch, the keyboard over a
> text field, the back gesture at every step of its policy, a match played to
> full time, the career — with the result in it — recovered after a
> `force-stop`, and an exported career actually written into the phone's own
> Downloads folder, which is the one thing a WebView cannot do for itself. See
> [What has been verified](#what-has-been-verified-and-what-has-not) for the
> evidence, and [Toolchain](#toolchain) for what a build host needs — including
> the two traps that cost an afternoon here, a JDK newer than the Gradle wrapper
> can run and a build-tools folder that exists but is empty.
>
> **The release build now exists, and is signed with the owner's key.**
> `npm run android:bundle` runs end to end and produces a correctly signed,
> 3,862,195-byte `.aab` carrying exactly `dist/` — signed by the **upload key**
> created for this application (`CN=Horsemen Interactive`), whose preflight
> fingerprint is `FB:D6:82:69:…:1E:99`. That fingerprint is what the Play record
> names, so the artifact is submittable; earlier gates signed the same machinery
> with a *throwaway rehearsal* key. A **release-variant** APK
> (`assembleRelease`, non-debuggable, no DevTools socket) is installed and
> running on the phone below.
>
> **Still unverified, and not claimed:** any iOS work at all, the interactive
> behaviour *inside* the release variant (a release WebView exposes neither a
> DevTools socket nor an accessibility tree), any device other than the one above
> (so no low-end or low-storage run), and everything that happens in the Play
> Console or App Store Connect.

## One game, two bundles

There is one game and there are two ways of packaging it. `npm run build`
produces the website; `npm run build:native` produces the same game with the
browser-only parts switched off:

```bash
npm run build          # the website and the PWA  → dist/
npm run build:native   # the Android/iOS shell    → dist/
```

Both are `vite build` over the same `src/`, so the simulation, the rules, the
save format and the balance are identical — there is no second copy of the game
and nothing to keep in step. The only difference is
[`VITE_BUILD_TARGET=mobile`](.env.native), read in one place,
[`src/platform/target.ts`](src/platform/target.ts), and asked as one question,
`hasWebShell()`.

For a native build, four things do not happen, and they do not happen because
the code asks `hasWebShell()` rather than because anything was deleted:

| | website | native |
| --- | --- | --- |
| service worker registration | yes | **no** — the assets are already on the device |
| `beforeinstallprompt` capture | yes | **no** — a WebView's user agent looks like iOS, and the install logic would otherwise offer Share → Add to Home Screen from inside the installed application |
| install card in the menu | yes | **no** |
| "a new version is ready" bar | yes | **no** — a store updates a packaged build |

Nothing was removed to achieve that. The service worker, `_headers` and `og.png`
are left out of the *native bundle* (three named files, in
[`vite.config.ts`](vite.config.ts)) because a packaged application never fetches
any of them; the web build still ships all three, and the precache plugin still
runs for both targets and still fails the build if `self.__PRECACHE__` ever
leaves [`public/sw.js`](public/sw.js).

The native bundle is self-contained: no `server.url`, no remote assets, nothing
fetched at runtime.

## Toolchain

| | version | where it is required |
| --- | --- | --- |
| Node.js | **>= 22** | `engines` in [`package.json`](package.json); `@capacitor/cli` requires `>= 22.0.0` too, so the two agree |
| JDK | **21**, and on this host *only* 17–24 | `android/app/capacitor.build.gradle` sets `JavaVersion.VERSION_21`; `AGP 8.13` needs 17 or newer; Gradle 8.14.3 cannot run on 25 — see [the JDK trap](#the-jdk-trap) |
| npm | bundled with Node | |
| Gradle | **8.14.3**, via `android/gradlew` | the wrapper fetches it; nothing to install by hand |
| Android Gradle Plugin | **8.13.0** | `android/build.gradle` |
| Android SDK Build-Tools | **36.0.0** | pinned in [`android/variables.gradle`](android/variables.gradle) and applied to every Android module in [`android/build.gradle`](android/build.gradle) — left unstated, AGP 8.13 would compile with its own default 35.0.0, which is not what this document or `android:preflight` says |
| Android SDK Platform | **android-36** (`compileSdk`/`targetSdk` 36) | `android/variables.gradle` |
| Android `minSdk` | **24** (Android 7.0) | `android/variables.gradle` |
| Android SDK Platform-Tools | current | `adb install`, logcat |
| Android SDK Emulator + system image | optional | only for an emulator instead of a phone |

Set `JAVA_HOME` to a JDK 21 and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to the SDK,
or write the SDK path into `android/local.properties` (`sdk.dir=…`, ignored by
git):

```bash
export JAVA_HOME="$HOME/.jdks/temurin-21"       # or wherever JDK 21 lives
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
```

`android/local.properties` is the other way to say where the SDK is, and it is
what a build without those two variables reads:

```properties
sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk
```

It is ignored by git (`android/.gitignore`), so it is a fact about a machine
rather than about the project.

With the SDK manager already available, the pieces this project needs are:

```bash
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
sdkmanager "emulator" "system-images;android-36;google_apis;x86_64"   # emulator only
```

### The JDK trap

Android Studio ships its own JDK — a JetBrains Runtime — and on Android Studio
2025.x that is **Java 25**, which Gradle 8.14.3 cannot run on: its own build-script
compiler stops at class file 24, so `./gradlew` fails before it configures
anything with

```
BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 69
```

A message that names neither the JDK nor the problem. Point `JAVA_HOME` at a
**JDK 21** (Temurin, or any 17–24) instead — Android Studio's own *Gradle JDK*
setting is a separate thing and does not affect a command-line build.
`npm run android:preflight` reports a JDK newer than 24 as a failure, with this
sentence, because "a JDK is installed" and "this build can use it" are different
questions.

### An SDK the SDK manager cannot fill in

Every SDK package comes from `dl.google.com`, and on the machine this was built
on that host answers nothing at all — the connection is reset or times out,
while `repo.maven.apache.org`, `plugins.gradle.org` and `services.gradle.org`
answer normally. Two consequences, both worth knowing before an afternoon
disappears into them:

* **Gradle's `google()` repository is that host.** `maven.google.com` is only a
  redirect to it. Until a mirror is in front of it, AGP and AndroidX cannot be
  resolved, and *because a failed repository is disabled for the rest of the
  build*, the central artifacts declared after it (kotlin-stdlib, ASM,
  httpmime) fail with it. On this host the fix lives outside the repository, in
  `~/.gradle/init.d/`, and re-points that repository at a mirror; nothing in the
  project depends on it, and a checkout on a normal network is untouched.
* **`sdkmanager` can install nothing.** The platform and the build tools can
  still be put in place by hand: download `platform-36_rNN.zip` and
  `build-tools_r36_windows.zip` (or the `.zip`/`.tar.gz` for the platform), and
  unpack them so the SDK ends up with `platforms/android-36/`,
  `build-tools/36.0.0/` and `platform-tools/` complete — each needs its
  `source.properties` and, for build tools, the `aapt2` binary. A **half**
  unpacked package is the second trap: an interrupted download leaves
  `build-tools/36.0.0/` behind with nothing but a `.installer` file in it, and
  Gradle then reports `Failed to find Build Tools revision 36.0.0` minutes into a
  build. `npm run android:preflight` now says so in one line instead, and names
the directory as a husk.

## Build and launch

The bundled assets are `dist/`, and `cap sync` is what puts them inside the
Android project. After **any** change to the game, in this order:

```bash
npm install                 # once
npm run build:native        # typecheck, then the native build → dist/
npx cap sync android        # copies dist/ into android/app/src/main/assets/public
```

`npx cap sync android` is also available as `npm run android:sync`. The copied
assets are ignored by git (`android/.gitignore`) — `dist/` is the artifact, and
the Android project is a thing that consumes it.

Then build the application and put it on a phone:

```bash
cd android
export JAVA_HOME="$HOME/.jdks/temurin-21"      # 17–24; not Android Studio's JBR
./gradlew assembleDebug                     # Windows: gradlew.bat assembleDebug
"$ANDROID_HOME/platform-tools/adb" install -r app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" shell am start -n com.sundayeleven.se27/.MainActivity
```

That is exactly what was run to produce the APK described below: 183 Gradle
tasks, about three minutes on the first build (everything after it is
incremental), producing a 5.1 MB `app-debug.apk`.

The Java half has its own tests, and they need no device:

```bash
cd android && ./gradlew testDebugUnitTest   # the career file-name rules
``` `adb` is also how the game is
inspected while it runs — a **debug** build leaves its WebView's DevTools socket
open, so `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` puts
the running page's own DOM on loopback and it can be asked what it thinks its
safe-area insets are, or whether a service worker is registered.

Adding `-Pandroid.builder.sdkDownload=false` makes a missing SDK component fail
immediately and by name instead of being downloaded from `dl.google.com` first —
useful on a host that cannot reach it, where the alternative is a build that
appears to hang.

Or let Android Studio drive it:

```bash
npx cap open android
```

and press Run. Android Studio is the friendlier first run *when its SDK manager
can reach `dl.google.com`*, because it will configure the SDK and offer to
install what is missing; on a filtered network it can only report that it
cannot, and the SDK has to be put in place by hand as described above.

### The release build

The debug build is self-signed by the SDK's debug key and is what you install to
test. A release is a different artifact: the same `dist/`, signed with the
*upload* key, as a **bundle** — which is the only thing Google Play accepts.

```bash
npm run android:preflight     # what this machine can and cannot do; builds nothing
npm run android:bundle        # preflight → build:native → cap sync → gradlew bundleRelease
npm run android:apk           # the same, but an .apk to sideload onto a phone
```

`android/keystore.properties` (ignored by git; its shape is
[`keystore.properties.example`](android/keystore.properties.example)) is the only
thing that makes a release signed. Without it, `bundleRelease` still succeeds and
emits an **unsigned** bundle — deliberately, because Play refusing an unsigned
bundle with a message that names the problem is a far better outcome than a build
that quietly signed with a debug key and shipped under it — so the preflight
refuses to start one, and says which of the four values is missing.

**Write `storeFile` with forward slashes on Windows.** The file is loaded by
Gradle with `java.util.Properties`, where a backslash is an escape: `\k` and `\s`
lose their backslash, `\t` becomes a tab, and `\u` in `\upload-keystore.jks` is a
malformed Unicode escape, so `load` throws `Malformed \uxxxx encoding` before
Gradle configures anything. `C:/Users/you/keys/se27/upload-keystore.jks` works,
and so does doubling every backslash. The same applies to a backslash in a
password (`pa\ss` comes back as `pass`). The preflight decodes the file exactly as
Java does and refuses one it cannot read, so this arrives as a named line in its
report rather than a stack trace from Gradle.

**The preflight opens the key, it does not just read the file about it.** Given a
complete `keystore.properties` it reads the store, names the alias it holds and
the certificate's SHA-256, checks that the alias given is one of them, opens the
private key with `-certreq` where the format allows the key a password of its own,
and for PKCS12 — which holds a *single* password and silently ignores a second
one — it checks that `storePassword` and `keyPassword` agree, because `apksigner`
refuses them apart with words that name neither the keystore nor the reason. Every
password is handed to keytool in that one child process's **environment**
(`-storepass:env`), never in an argument list, and every line is scrubbed of it
before it is printed. Two traps it exists to catch are an SDK directory that
*exists* but holds nothing (`build-tools/36.0.0` with only an `.installer` in it,
`platforms/android-36` with no `android.jar`) and a `dist/` that has moved on
since the last `cap sync` — a bundle built from stale assets signs, uploads and
plays last week's game without complaining.

Two traps in the tooling itself, both found the hard way:

* **The wrapper is named by its full path and run from `android/`.** A bare
  `gradlew.bat` is resolved by searching the *current* directory, and
  `NoDefaultCurrentDirectoryInExePath=1` (which Git Bash sets) removes that
directory from the search — so `npm run android:bundle` built everything,
  synced it, and then died with `'gradlew.bat' is not recognized`.
* **The build is run in production mode, explicitly.** Every tool here starts
  under `vite-node`, which sets `NODE_ENV=development` and hands it to its
  children; a bundle built under it is unminified *and* carries
  `react-dom.development` — 956,770 bytes against 771,327 for the same source.
  See [`tools/buildEnv.ts`](tools/buildEnv.ts).

`npm run icons` regenerates the launcher icons, the adaptive icon foregrounds
and the splash screens from `public/favicon.svg` — run it after changing the mark,
not before every build.

Always build through the wrapper (`./gradlew`), not a system Gradle: the version
in [`android/gradle/wrapper/gradle-wrapper.properties`](android/gradle/wrapper/gradle-wrapper.properties)
is part of the configuration being tested.

### On a phone with no signal

The point of bundling rather than pointing at the website is the touchline with
one bar of signal, so the flight-mode check is the one that matters: turn mobile
data and Wi-Fi off, cold-start the application, and play — startup, the menu, a
career, a matchday and a match. Nothing in the native bundle needs a network.

Careers live in the WebView's IndexedDB, which is retained per application the
way a browser retains a site's storage. Opening the game again — including after
the process is killed (`adb shell am force-stop com.sundayeleven.se27`) — offers
the career that was being played.

That storage is the application's own, and clearing the application's data takes
it with it, so the copy that survives is the one the manager keeps: **Export
career to a file** writes a JSON career into the phone's `Downloads` folder (see
[career files](#4-career-files-and-the-download-manager-that-is-not-there)), which
is what the installed app could not do before the plugin in this shell existed.

## Identity, icons and version

| | value | set in |
| --- | --- | --- |
| application id / package | `com.sundayeleven.se27` | [`capacitor.config.ts`](capacitor.config.ts), `applicationId` in `android/app/build.gradle` |
| display name | `Sunday Eleven 27` | `capacitor.config.ts`, `android/app/src/main/res/values/strings.xml` |
| launcher icon | the game's own mark, from `public/favicon.svg` | `npm run icons` writes `mipmap-*/ic_launcher*.png` from the same favicon as the home-screen icon; the adaptive background is `#08090B` in `values/ic_launcher_background.xml` |
| splash | the mark on the game's near-black, at every density and both orientations | `npm run icons` writes `android/app/src/main/res/drawable*/splash.png` |
| `versionName` | the game's version, from `package.json` | `android/app/build.gradle` |
| `versionCode` | derived integer | `android/app/build.gradle` |

The application id is immutable once published — a store treats a new one as a
different application — which is why it is written down here and in
`capacitor.config.ts` rather than derived from anything.

The version is not written down twice. `android/app/build.gradle` reads
`package.json` — the one place the project keeps it, where `tools/release.ts`
bumps it and `vite.config.ts` reads it for the bundle — and takes `versionName`
from it directly. `versionCode` is the number Android will not let anybody else
decide: it is what a store compares to know whether a build is newer, and it may
never go down, so it is derived from the same three numbers in a way that only
ever increases — `major*1000000 + minor*1000 + patch`, which makes `0.10.1`
`10001` and `0.11.0` `11000`.

So a release needs no native step for the version to be right; the cost is that
the Android build now depends on the repository's `package.json` being beside it
(it is, in the same checkout).

## The phone's own questions

A phone asks an application four things a browser never does, and each of them
is answered in a place where it can be read and tested rather than in a listener
buried in the shell: the **back gesture**, being **put away and picked up again**,
the **keyboard** over a text field, and **writing a file** the browser would have
downloaded for it. All of it lives behind one gate —
`Capacitor.isNativePlatform()` in [`src/platform/native.ts`](src/platform/native.ts)
— so the website and the installed PWA behave exactly as they did.

### 1. Back

Android's back gesture closes *the last thing you opened*, and pressing it at the
very beginning is a polite way of asking to leave. The decision is a pure
function of three facts about the shell — what is stacked over the screen, which
screen it is, and whether a match is being played — and it lives in
[`src/ui/back.ts`](src/ui/back.ts) with its tests. The order it answers in:

| | the gesture does |
| --- | --- |
| 1 | puts away whatever is in front — a dialog, the mobile navigation sheet, a match drawer, the card over a league being played out |
| 2 | during a match: at full time, the same "back to the club" the full-time card offers; before it, [a question](#a-match-interrupted) |
| 3 | steps back one screen, in the hierarchy [`src/ui/navigation.ts`](src/ui/navigation.ts) already draws (Tactics → Squad → Home) |
| 4 | from the dashboard with nothing open, `App.minimizeApp()` — the task goes to the recents list, the afternoon is still there, and nothing is killed |

Nothing here invents a second navigation model: step 3 is the section's own first
screen, which is the parent the navigation already describes, and steps 1 and 2
are the states the rest of the game already keeps.

The "what is in front" half is [`src/ui/layers.ts`](src/ui/layers.ts), one stack
that everything layered registers on: a **modal** (a dialog, the mobile sheet)
takes the screen and holds focus, and a **dismissable** (a match drawer) belongs
to the screen under it and is simply put away. Escape, the scrim and the back
gesture all read the same stack, so they cannot disagree about what is on top,
and a close that is already in flight is refused rather than run twice — which is
what stops two rapid presses taking two screens with them.

Listeners are registered once. `startNativeShell()` returns a disposer, keeps only
the first registration if it is somehow called twice, and the `backButton`,
`appStateChange` and `keyboardDidShow` handles are all removed together, so an
application suspended and resumed fifty times has one of each rather than fifty.

### 2. Safe areas and system bars

Android 16 enforces edge-to-edge and no longer lets an application opt out, so
the game is drawn *under* the status bar, the gesture bar and any cutout, and
reserves that room back for itself. Geometry is handed to the page as
`--safe-area-inset-*` by the shell (`SystemBars` in
[`capacitor.config.ts`](capacitor.config.ts), `insetsHandling: 'css'`, which is
Capacitor's supported arrangement) and read once, at the top of
[`src/ui/styles.css`](src/ui/styles.css):

```css
--safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
```

The injected variable first, `env()` second, so iOS and a notched browser are
covered by the same four tokens; `index.html` declares `viewport-fit=cover`,
without which `env()` has no value at all. In a browser with neither — a desktop,
a phone with no notch — both are zero, every rule that reads them is a no-op, and
the web layout is exactly the layout it was. That is the property to keep: this is
a native concern that costs the website nothing.

The room is reserved where the frame is, not by every piece of furniture: the
shell ([`.app`](src/ui/styles.css)) and the match (a full-screen takeover) reserve
all four edges once, and anything fixed to the *viewport* inside them — a dialog,
a bottom sheet, the dressing-room card — reserves its own, because `inset: 0`
resolves against a padding box and would otherwise put `Kick off` under the
gesture bar.

### 3. The keyboard

A soft keyboard is not a browser's problem until it covers the field being typed
in. Android resizes the WebView when it appears (the system-bar handling reserves
its height for the page), so the *layout* needs nothing; what no layout can know
is that the field inside a scrolling dialog body is now below the fold. So the
`Keyboard` plugin's `keyboardDidShow` — after the keyboard has taken its room,
which is the moment a scroll actually keeps a field on screen — scrolls the
focused element back into view, once, and only when it is a field the game is
really showing. Dialogs are capped at `calc(var(--safe-h) - …)` and scroll their
own bodies, so their footers and their submit buttons stay reachable, and Escape
and the scrim still dismiss them.

### 4. Career files, and the download manager that is not there

This is the one that had been got wrong, and it is worth stating plainly, because
the failure was silent in both directions. Capacitor's Android WebView implements
`onShowFileChooser` — which is why *importing* a career file works on a phone —
and registers **no `DownloadListener` at all**. An export that went out as the
browser's own `<a download>` therefore wrote nothing, anywhere: the click returns
normally, nothing catches it, and the page had no way to tell. The installed
application told managers their career had been exported while no file existed.

Three things now keep that from happening again, and each is in the layer that
can be held to account for it:

| layer | what it decides |
| --- | --- |
| [`src/platform/files.ts`](src/platform/files.ts) | whether a download would *work* here (`downloadWouldWork()` — false in a WebView, whatever the page's capabilities look like), and what the host did with the file |
| [`src/platform/nativeFiles.ts`](src/platform/nativeFiles.ts) | the host the shell installs: it never throws, it reports where the file went when the shell says so, and it installs itself only when `isNativePlatform()` |
| [`android/app/src/main/java/com/sundayeleven/se27/Se27FilesPlugin.java`](android/app/src/main/java/com/sundayeleven/se27/Se27FilesPlugin.java) | the write itself: the device's own **Downloads** collection on Android 10+, the application's external folder below that, and an answer of `{ written: true, location }` or `{ written: false, reason }` — **resolved, never rejected**, so a refusal becomes the game's sentence rather than a plugin error |

The name is the only part with real rules, so it is the only part kept free of
Android and tested on the JVM: `CareerFiles.fileName()` takes the last path
segment (a page does not get to choose a folder), replaces characters a file
system may refuse — `\ / : * ? " < > |` — drops control characters, refuses to
produce a hidden file or an empty one, and always ends in the `.json` the game
reads. `./gradlew testDebugUnitTest` runs its eight tests; nothing about it needs
a phone.

The write is also why the shell registers a plugin of its own: `MainActivity`
calls `registerPlugin(Se27FilesPlugin.class)` before `super.onCreate`, because a
plugin written *in the application* is in nobody's generated plugin list.
`src/platform/nativeFiles.test.ts` pins that agreement — one name on both sides
of the bridge, one method, registered before the page can ask for it.

### A match interrupted

The honest answer, and the one the game itself gives in
[`src/ui/match/LeaveMatchDialog.tsx`](src/ui/match/LeaveMatchDialog.tsx) when the
back gesture arrives mid-afternoon:

* **Putting the phone down pauses the match.** A frame loop stops on its own while
  nothing is being drawn, but the store would go on claiming the match was
  running, so the suspension stops it deliberately. Coming back restarts it only
  if this suspension is what stopped it, and only if it is *still* stopped — a
  match the manager paused himself is never overruled, and a second resume never
  starts a second afternoon.
* **A match in progress is not written to disk.** Only the durable `game` is
  saved; the session lives beside it in memory. So if the application is killed
  mid-match — by the task switcher, by a low-memory kill, by `adb shell
  am force-stop` — what is on disk is the fixture *before kick-off*, and the
  afternoon is played again from the start. Nothing about a live match's exact
  in-progress state is recoverable, and the game says so rather than claiming
  otherwise: the leave-match question states it plainly.
* **Pending saves are handed over, and never waited on.** Autosave is a debounce,
  and a phone can be suspended inside it, so both the page's own `pagehide` and
  a hidden `visibilitychange` flush it ([`src/platform/lifecycle.ts`](src/platform/lifecycle.ts)),
  and the native shell says the same thing in its own words on
  `appStateChange`. The flush is deliberately not awaited and nothing is blocked
  on it: an application must not refuse to go away while it writes a file it can
  write a moment later, and the write is idempotent, so being told twice is
  harmless.
* **Coming back adds nothing.** The session, its listeners and its loop are the
  same objects they were before the suspension; only `paused` changes. There is no
  second timer, no second frame loop and no accumulated handler.

## iOS

There is no iOS project in this repository, and no iOS build has been attempted
or claimed. Xcode only runs on macOS, and this stage was prepared on Windows, so
creating `ios/` here would produce a directory that nobody had ever built.

Nothing else has to change to produce one: the app id, the app name and the
version are already declared once in [`capacitor.config.ts`](capacitor.config.ts),
the native bundle it would consume already exists, and the only iOS-specific
work is the bundle identifier (already set) and the app icons and launch screen
in the generated project.

On a machine with macOS, Xcode 16 or newer and CocoaPods:

```bash
npm install
npm run build:native
npm i @capacitor/ios@8     # the iOS platform, version-matched to core
npx cap add ios            # creates ios/App with the identifier already set
npx cap sync ios           # copies dist/ into the project
npx cap open ios           # Xcode; set a signing team, then Run
```

Then check it the same way as Android: launch, create a career, save, reload,
matchday, match playback — and once with the device in aeroplane mode. A store
build additionally needs an Apple Developer account, a distribution
certificate, a provisioning profile and an App Store Connect record.

## What has been verified, and what has not

### On the phone

An installed build was driven from a desktop over wireless `adb`, and the game
was read out of its own WebView over the DevTools protocol. The device and build
under test, as the device itself reports them:

| | |
| --- | --- |
| device | Pixel 7a (`lynx`), `adb-34071JEHN24611` over `_adb-tls-connect` wireless debugging |
| OS | Android 17, API 37 (`ro.build.version.release` 17 / `sdk` 37) |
| display | 1080 × 2400 at density 420 (override 356) — 485 × 1078 CSS pixels |
| build | `com.sundayeleven.se27` `versionName` 0.10.1, `versionCode` 10001, `targetSdk` 36, `compileSdk` 36, signed with the Android Debug key |
| APK (debug) | `app-debug.apk`, 5,338,005 bytes, built with JDK 21.0.12.1 (Temurin) and build-tools 36.0.0 |
| APK (release) | `assembleRelease` → zipaligned → signed with the SDK debug key so it could *replace* the debug install rather than erase the career on the device: 4,054,741 bytes, certificate SHA-256 `7b581895…f0f8df5`, `firstInstallTime` unchanged afterwards (an update, not a fresh install) — that is the install on the phone today |
| **APK (owner's key)** | `npm run android:apk` → `android/app/build/outputs/apk/release/app-release.apk`, **4,015,334 bytes**, `SHA-256 d69bc54e04ac3d5ed22b7e82bbaf89d11808ab61481cee0a6d076939f43d8217`, signed by the upload key (`fbd68269…8c1e99` = the `FB:D6:82:69…1E:99` fingerprint), `versionCode` 10001 / `versionName` 0.10.1 / `targetSdk` 36, **no `application-debuggable`**, `assets/public/` is `dist/` plus Capacitor's two shims and no `sw.js`/`_headers`/`og.png`. **It will not install over the debug-key build on the phone**: different signers, so Android refuses it — uninstall first, and export the career to a file beforehand if it matters |
| AAB (rehearsal) | `npm run android:bundle` → **3,862,207 bytes**, 2026-10-09 08:34:45, signed by `CN=SE27 gate 3 rehearsal, O=throwaway` (`SHA256 00:4A:CE:16…5B:F2`). Its `base/assets/public/` is `dist/` byte for byte — the same machinery as the row below, with a key that must never be uploaded |
| **AAB (owner's key)** | `npm run android:bundle` → **3,862,195 bytes**, 2026-10-09 09:11, `SHA-256 d4aee0c8…5deb64`, signed by `CN=Horsemen Interactive, O=Horsemen Interactive, C=GB` (`SHA256 FB:D6:82:69…1E:99`) — the fingerprint `keytool -list -v` reports for the keystore's `upload` alias, so this is the artifact to upload. Its `base/assets/public/` is `dist/` plus Capacitor's two shims, nothing else |

| check | what was seen |
| --- | --- |
| the APK carries the game | `assets/public/` inside the APK is `dist/` **byte for byte** — 54 files, identical SHA-256, plus Capacitor's own two empty Cordova shims. The APK contains no `sw.js`, no `_headers`, no `og.png` |
| manifest | `aapt2 dump badging`: package `com.sundayeleven.se27`, `versionCode` 10001, `versionName` 0.10.1, `targetSdk` 36, label `Sunday Eleven 27`, `INTERNET` declared; `apksigner` confirms the Android Debug certificate |
| cold launch | `am start` reports `LaunchState: COLD`, 494–517 ms to first frame; the game boots to its main menu with no crash and no exception in `logcat` |
| PWA registration inside the app | `navigator.serviceWorker.getRegistrations()` → **0**, `navigator.serviceWorker.controller` → null; `isNativePlatform()` → true, `getPlatform()` → `android` |
| safe areas on a notched device | the shell's injected `--safe-area-inset-top: 53px` / `bottom: 48px` arrive on `document.documentElement` and resolve through `--safe-top` (52.9986px) — the cutout is 118 device px at 2.225 dpr. `env()` independently gives 53.9958px, so the arrangement holds even if the shell's injection is late (it is: two `Error injecting safe area CSS` lines appear before the document exists, and self-correct) |
| the keyboard over a text field | tapping a field raises the IME (`mInputShown=true`) and **resizes the WebView** — `innerHeight` 1078 → 786 — with the focused field inside the room left over; `adb shell input text` typed into it and the page saw the value |
| the back gesture, step by step | from the create-a-club flow it stepped back a screen; from the career-setup step it returned to the menu; from the menu it put the task aside — the process stayed alive (same pid) and came back to the same screen. Mid-match it asked [the question](src/ui/match/LeaveMatchDialog.tsx) instead of leaving, and a second press closed the question while the match carried on |
| a career, and a matchday | a career was created on the phone (world generated, club chosen, XI picked with *Ask the assistant to pick*), a pre-season friendly played from kick-off to full time — clock, score, commentary and the half-time interval all running, at 1× and at 8× |
| being put away mid-match | pressing Home at 19' and returning 17 seconds later showed 21' — the afternoon had not run on while the app was suspended, and it resumed rather than restarting |
| survival of a kill | `am force-stop` (the harshest case, the one that kills the process outright) then a cold launch: the app reopened straight into the career, with the XI it had picked and the played result (`1–1`, 2 Aug) still in the fixture list |
| exporting a career, through the app's own screen | `Settings → Save or load a career → Export career to a file` wrote `/sdcard/Download/sunday-eleven-27-career-upper-whaltree-working-men-s-club-2026-08-02.json` — **5,360,556 bytes**; MediaStore's own row reads `relative_path=Download/`, `_size=5360556`, `is_pending=0`. The sentence on screen named the file and the place: *"Career written to …-2026-08-02.json in Downloads. Keep it somewhere you will find it again."* Pulled back off the device it parses as `format: se27.career`, `formatVersion: 1`, `app: 0.10.1`, `version: 16`, 36 clubs, 403 matches |
| a host that refuses | with the page's writer replaced by one answering `written: false`, a second export wrote **no** file (Downloads still held one career file), showed *"The game could not write the file to this device, so there is nowhere to put the career. Your career is untouched — nothing was changed."*, and published no *"Career written to"* claim |
| the host bridge is only there in a shell | in the installed app `typeof window.se27Host` is `object` with a `saveTextFile` function; the web build installs no host at all and keeps the browser's download (`src/platform/files.test.ts`) |

### On the build host

Verified on the machine this was prepared on (Windows, Node 24.14.0):

| check | result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 844 tests, 72 files, all passing |
| `./gradlew testDebugUnitTest` | 9 tests, 0 failures — the career file-name rules (8) plus the generated example |
| the native shell's own behaviour | 39 tests over [`src/ui/back.test.ts`](src/ui/back.test.ts), [`src/ui/layers.test.ts`](src/ui/layers.test.ts), [`src/platform/native.test.ts`](src/platform/native.test.ts) and [`src/platform/lifecycle.test.ts`](src/platform/lifecycle.test.ts): the back priority order, the single listener, the pause only on a real suspension and the resume only of this shell's own pause, the flush on leaving |
| `npm run build` (web) | succeeds; `dist/` has `sw.js`, `_headers`, `og.png`; precache manifest written into `sw.js` (55 entries) |
| `npm run build:native` | succeeds and says so (`native-bundle: left out sw.js, _headers, og.png`); `dist/` has none of the three; the precache plugin still ran and the placeholder is still required by the build |
| the game rendered in Chromium at phone sizes, with the insets injected the way the shell injects them | command bar, bottom navigation, dialogs, sheets, the dressing-room card and the match controls all clear the reserved edges; with the insets at zero the layout is byte-for-byte the web layout |
| every screen at a phone's width, and the match in landscape | no control sits under the system bars, no text is clipped and no interactive element is under 44 by 36 pixels. Three exceptions were found and fixed: the match's four speed chips (32×32, now 44×44, which also put them on the height of the transport buttons they sit beside), the training screen's help disclosure (29 tall, now 44) and the dressing room's card (its own `inset: 0` frame left `Kick off` able to run under the gesture bar) |
| the back policy driven against the running game | a dialog and the mobile More sheet each register as a layer and the second back press closes the question rather than the match; at full time the same gesture finishes the afternoon; with nothing open it asks the shell to put the task aside |
| a career played in the browser, reloaded | the career came back from IndexedDB; the flush on `pagehide` is what makes closing inside the debounce safe |
| native bundle served and run in Chromium (the same engine an Android WebView uses) | boots to the main menu; created a career and generated the world; on reload the career came back from IndexedDB |
| service worker, native bundle, same browser and origin | **0 registrations, no controller** |
| service worker, web build, same browser and origin (control) | **1 registration**, scope `http://localhost:4188/`, controller active |
| `npx cap sync android` | succeeds; 55 assets copied into `android/app/src/main/assets/public`; no `sw.js` among them |

Not verified, and not claimed:

* **Submitting to Play, which is a different act from building.** The artifact
  exists and is signed with the owner's upload key (`FB:D6:82:69:…:1E:99`, the row
  above), but **nothing has been uploaded anywhere** — no Play Console account, no
  store listing, no screenshots, no Data safety form, no content rating. The
  earlier rehearsal bundle (`CN=SE27 gate 3 rehearsal, O=throwaway`) must never
  reach Google, and the two are told apart by their fingerprints, not their sizes.
  [`RELEASE_READINESS.md`](RELEASE_READINESS.md) is the list of what the owner has
  to do in the console.
* **The interactive checks inside the release variant.** A release WebView has no
  DevTools socket (0 in `/proc/net/unix`, against 1 in the debug build) and exposes
  no accessibility tree to `uiautomator` (one `android.webkit.WebView` node, no
  text), so nothing on those screens can be read or driven by script. What the
  release variant *was* checked for: install as an in-place update with
  `firstInstallTime` unchanged, `COLD` launch in 240 ms, no `FATAL EXCEPTION` or
  ANR, the same screen the debug build rendered (0.77% of pixels different, with
  the home screen as an 80.99% control), and no network entry for its uid at all.
* **One device, and it is not an ordinary one.** The run above is a Pixel 7a on
  Android 17; there is no second device, no emulator, no Android 16 (the
  `targetSdk` this project ships) and nothing older or cheaper. Nothing here is
  evidence about a low-end phone, a small screen or a slow GPU, and nothing is
  evidence about Android 7–15 at all.
* **No low-storage, save-failure or interrupted-autosave run on a device.**
  Those paths are covered by unit tests against the store and IndexedDB
  (`src/state/persistence.test.ts`, `src/ui/saveTransfer.test.ts`) but were not
  provoked on the phone, where the browser's storage is a real filesystem.
* **No long session and no full season on the phone.** A career was created and a
  friendly was played — one afternoon, not a season; the season loop is tested
  headlessly (`npm run test:slow`, `npm run soak`) rather than on a device.
* **The export's failure arm was provoked rather than encountered.** The refusal
  above came from a host injected at the seam the game documents, which is a
  faithful replay of what the installed app used to do — but the real failures
  (storage full, an unwritable Downloads collection, a volume removed, a write
  interrupted half-way, which is what `IS_PENDING` and the rollback exist for)
  have not happened on a device.
* **Only the modern branch of the writer has run.** `Se27FilesPlugin` writes into
  the application's own external folder below Android 10; the phone is on Android
  17, so only the `MediaStore` path has been exercised and the `minSdk 24` floor
  is still uninstalled.
* **Importing from the phone's file manager, end to end, is still unperformed.**
  The picker button could not be reached reliably by script; the capability
  (`onShowFileChooser`) is why the feature exists at all, and the logic is
  unit-tested, but no career file has been chosen from the device's own picker.
* **Nothing about iOS writing a file.** The page-side bridge is platform-neutral
  and a WKWebView is a different animal: whether it catches an `<a download>` in
  this shell is unknown, and no iOS host implements the bridge yet.
* **No aeroplane-mode run.** The bundle has no remote assets and registers no
  service worker (both verified above), but the flight-mode check proper — the
  radio actually off — has not been performed on the phone.
* **Nothing about iOS has been run**, and no `ios/` project exists. Xcode runs
  only on macOS, so the notched-device `env(safe-area-inset-*)` values, the
  keyboard over a text field in a WKWebView, the swipe-back edge gesture (which
  iOS keeps for itself and which this stage does not override) and the
  app-switcher resume are unperformed here and must not be reported as done. See
  [iOS](#ios) for the steps a macOS machine would take.
* **Nothing in either store has been touched.** No Play Console or App Store
  Connect record, no Data safety form, no privacy policy URL, no content rating,
  no screenshots beyond the assets in [`store/`](store/README.md), no tester
  track. Those are account-owner tasks and are listed in
  [`RELEASE_READINESS.md`](RELEASE_READINESS.md).
* iOS is prepared only in the sense described above: the configuration is ready
  and the steps are written down. No `ios/` project exists.
