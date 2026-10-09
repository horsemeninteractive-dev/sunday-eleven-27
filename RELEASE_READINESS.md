# Sunday Eleven 27 — release readiness

What stands between this repository and a submission to Google Play and the App
Store, as of **9 October 2026**. It is written to be read in four parts — what
passed, what failed, what has not been tried, and what only the account owner can
do — and every claim in it is something that was run, read out of a log, or read
on the store's own documentation.

**Nothing was uploaded to either store, nothing was published, and nothing was
bought.**

**Release Gate 3 changed what is true about the release itself.** A **signed
Android App Bundle now exists**, produced by the documented command from a clean
run. At Gate 3 it was signed with a **throwaway rehearsal key**; at **Gate 4 the
owner created their own upload key**, and the artifact now on disk is signed with
it and is **submittable**. The rehearsal bundle is still what the Gate 3 evidence
below describes, and its rows say so; Gate 4 is the real thing. A
**release-variant APK** — `assembleRelease`, not the debug build — is installed
and running on the phone, signed with the SDK debug key purely so that it could
replace the debug install in place instead of erasing the career on the device.

Companion documents: [`ANDROID.md`](ANDROID.md) for how the Android build works
and what it needs, [`IOS.md`](IOS.md) for the iOS shape,
[`store/README.md`](store/README.md) for the store artwork that already exists,
and [`SOAK.md`](SOAK.md) for the long-run simulation evidence.

## 1. What was actually tested

Android is the platform under test; iOS has no toolchain here at all (it needs
macOS and Xcode, and this machine is Windows).

| | |
| --- | --- |
| device | **Pixel 7a** (`lynx`), attached over wireless debugging (`adb-tls-connect`) |
| OS | **Android 17, API 37** — as the device reports it (`ro.build.version.release` 17, `sdk` 37) |
| display | 1080 × 2400 at density 420 (override 356) = **485 × 1078 CSS px** |
| build | `com.sundayeleven.se27`, `versionName` **0.10.1**, `versionCode` **10001**, `targetSdk` **36**, `compileSdk` **36**, debug-signed |
| artifact | `android/app/build/outputs/apk/debug/app-debug.apk`, 5,338,005 bytes, built 2026-10-09 05:04 |
| host | Windows 11, Node 24.14.0, **JDK 21.0.12.1 (Temurin)**, Gradle **8.14.3** (wrapper), AGP **8.13.0**, Android SDK platform **android-36**, build-tools **36.0.0**, platform-tools **37.0.1** |
| command | `npm run build:native && npx cap sync android && ./gradlew assembleDebug` |

The tests below were driven from the desktop: `adb` for the device, and the
WebView's own DevTools socket (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`)
to read the running page's DOM, its custom properties and its `navigator` state.

## 2. The stores' requirements, as they stand today

**Mandatory** means a submission is refused or a listing is blocked without it.
**Recommended** means nothing is refused, but the store, its reviewers or its
users push back.

### Google Play

| | requirement | state here | source |
| --- | --- | --- | --- |
| **Mandatory** | New apps and updates must target API **36** or higher (since 31 Aug 2026) | `targetSdk 36` ✓ | [target API level requirements](https://developer.android.com/google/play/requirements/target-sdk) |
| **Mandatory** | New apps are published as an **Android App Bundle** (`.aab`) | `npm run android:bundle` produces one, and now does so end to end. The artifact on disk is **3,862,195 bytes** (`SHA-256 d4aee0c8…5deb64`), signed with the **owner's own upload key**, and carries `dist/` exactly (§3, Gate 4) | [App bundle format](https://support.google.com/googleplay/android-developer/answer/9859152) |
| **Mandatory** | **Play App Signing**, with an upload key held by the developer | workflow in place and now *verified against real keystores* — `android:preflight` opens the store, checks the alias and the key password, reports the certificate's fingerprint, and fails if a secret has ever been tracked. **The owner's key exists and the preflight is green against it**: `✓ an upload key is configured (alias upload, PKCS12)`, certificate SHA-256 `FB:D6:82:69:…:1E:99` — the fingerprint to record in the Play Console. The key itself is outside the repository, in `C:\Users\<owner>\keys\se27`, and `android/keystore.properties` is ignored by git | [Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756) |
| **Mandatory** | A **Data safety** form, answered in the console | Declared permissions are `INTERNET` alone; answers are "no data collected, nothing shared" — the form itself is unstarted | [Data safety](https://support.google.com/googleplay/android-developer/answer/10787405) |
| **Mandatory** | Store listing assets: **512 × 512** app icon (PNG/JPEG, ≤ 1 MB), **1024 × 500** feature graphic, at least **2** phone screenshots (320–3840 px, 16:9 or 9:16) | icon and feature graphic exist in [`store/`](store/README.md); **screenshots do not exist yet** | [Store listing assets](https://support.google.com/googleplay/android-developer/answer/9866151) |
| **Mandatory** | **Content rating** questionnaire (IARC) | unstarted | [Content ratings](https://support.google.com/googleplay/android-developer/answer/9859655) |
| **Mandatory** *for some accounts* | Personal developer accounts created after 13 Nov 2023 must run a **closed test with ≥ 12 testers for 14 continuous days** before applying for production access | unstarted; whether it applies depends on how the account is registered | [Testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465) |
| **Mandatory** | A **privacy policy URL** when the app collects personal data or targets children | With no data collected this is not strictly required; a policy is still the safer answer | [Privacy policy requirement](https://support.google.com/googleplay/android-developer/answer/9859455) |
| Not applicable | 16 KB memory-page support for native code (since 1 Nov 2025) | The APK contains **no `lib/` and no `.so`** — nine dex files and the web assets, nothing native. Verified on the built artifact | [Support 16 KB page sizes](https://developer.android.com/guide/practices/page-sizes) |
| Recommended | Pre-launch report, internal/open testing tracks, a crash-free-rate baseline | unstarted | [Pre-launch reports](https://support.google.com/googleplay/android-developer/answer/9844487) |

### Apple App Store

| | requirement | state here | source |
| --- | --- | --- | --- |
| **Mandatory** | Builds uploaded from **28 April 2026** must use the **iOS 26 SDK** (Xcode 26) or later; **from April 2027** the iOS 27 SDK | Nothing built; no macOS here | [Upcoming SDK minimum requirements](https://developer.apple.com/news/?id=ueeok6yw), [submissions for the latest OS releases](https://developer.apple.com/news/?id=k1mtkt1k) |
| **Mandatory** | App icon **1024 × 1024** (no alpha), screenshots for the required device sizes, App Privacy answers, age rating | `store/apple-icon-1024.png` exists; screenshots, App Privacy and the age rating do not | [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) |
| **Mandatory** | An Apple Developer Program membership and an App Store Connect record, with a distribution certificate and profile | unstarted | [Developer Program](https://developer.apple.com/programs/) |
| **Risk, not a rule** | **Guideline 4.2, Minimum Functionality** — a thin wrapper around a website is rejected | The shell loads a bundled, offline, full game with device-integrated behaviour (back, safe areas, keyboard, pause/resume); nothing is fetched at runtime. The argument is strong, but the reviewer is the one who decides | [App Review Guidelines §4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality) |
| Recommended | TestFlight build first, then review notes explaining the offline bundle | unstarted | [TestFlight](https://developer.apple.com/testflight/) |

## 3. Passed

Each line was observed, not inferred. Device lines were read over DevTools or
`adb`; build lines are the commands and their artifacts.

| area | what was verified |
| --- | --- |
| Identity | `applicationId`, Gradle `namespace`, `package_name`, `custom_url_scheme` and `capacitor.config.ts` all state `com.sundayeleven.se27`; the display name is `Sunday Eleven 27` in the shell config and in `strings.xml`. `aapt2 dump badging` on the built APK agrees, and reports `versionCode` 10001 / `versionName` 0.10.1 from `package.json` |
| Versioning | The version is declared once (`package.json`), read by Vite for the bundle, by `android/app/build.gradle` for `versionName`, and turned into a monotonic `versionCode`. A test holds the TypeScript and Groovy derivations together |
| Signing hygiene | No keystore, properties file, `.p12`, provisioning profile or Play service-account JSON is tracked by git; the signing config only exists when `android/keystore.properties` does, so an accidental release build is *unsigned* rather than signed with a debug key; `keystore.properties.example` is committed and holds no secret |
| The bundle carries the game | `assets/public/` inside the APK is `dist/` **byte for byte**: 54 files, identical SHA-256 for every one, plus Capacitor's two empty Cordova shims. No `sw.js`, no `_headers`, no `og.png` |
| Offline by construction | No `server.url` anywhere in `capacitor.config.ts`; no remote asset references in the built bundle; the app boots and plays with everything served from `assets/` — over `https://localhost/`, which the WebView maps to the packaged files |
| PWA features stay off in the app | On the device: `getRegistrations()` → **0**, `controller` → null, `isNativePlatform()` → true, `getPlatform()` → `android`. The install card and the update bar are absent from the menu |
| Cold launch | `am start -W`: `LaunchState: COLD`, 494–517 ms. No crash, no `AndroidRuntime` fatal, no ANR, no unhandled rejection in `logcat` |
| Safe areas on a notched device | Injected `--safe-area-inset-top: 53px` / `bottom: 48px` arrive on `document.documentElement` and resolve through the game's own `--safe-top` (52.9986 px); the device cutout is 118 device px at 2.225 dpr. `env()` independently reports 53.9958 px, so the fallback holds too |
| The keyboard over a text field | Tapping a field raises the IME (`mInputShown=true`) and **resizes the WebView** (1078 → 786 CSS px); the focused field stays inside the room left over; `adb shell input text` typed into it and the page received the value; the form's scroll position followed |
| The back gesture, every step | Stepped back out of the create-a-club flow, back from the career-setup step to the menu, and from the menu put the task aside (process alive, same pid, same screen on return). Mid-match it asked the leave-match question rather than leaving, and a second press closed the question while the match carried on |
| A career, created on the phone | World generated (36 clubs, three divisions), club chosen, XI picked with *Ask the assistant to pick*, dashboard live |
| A match, played to full time | Kick-off, running clock, live score, commentary, the half-time interval with the dressing room and *Resume second half*, speed control at 1× and 8×, and full time. No crash across the whole afternoon |
| Being put away mid-match | Home at 19' and back 17 seconds later showed 21' — the afternoon did **not** run on while suspended, and it resumed instead of restarting |
| Survival of a hard kill | `am force-stop` then cold launch: the app reopened into the career, with the picked XI and the played result (`1–1`, 2 Aug) still in the fixture list |
| Export/import logic, headless | `src/ui/saveTransfer.test.ts` (13 tests) and `src/state/careerFile.test.ts`: export writes the envelope the game reads back and reports the file name *and the place the host put it*, an import is staged and only applied on confirmation, an unstorable import is refused, a newer-version file is refused, cancelling changes nothing — and an export the host refused comes back as a sentence with **no** notice published |
| **A career exported on the phone** | From the installed app, `Settings → Save or load a career → Export career to a file` produced `/sdcard/Download/sunday-eleven-27-career-upper-whaltree-working-men-s-club-2026-08-02.json` — **5,360,556 bytes**, and MediaStore's own row for it reads `relative_path=Download/`, `is_pending=0` (finalised, visible). Pulled back off the device it parses as `format: se27.career`, `formatVersion: 1`, `app: 0.10.1`, `version: 16`, 36 clubs, 403 matches: the game's own export, not a stub. The sentence on screen named the file **and the place** — *"Career written to …-2026-08-02.json in Downloads. Keep it somewhere you will find it again."* |
| **A refusal, on the phone** | With the page's host made to refuse (its writer replaced by one answering `written: false` — the state the installed app was in before this fix): a second export wrote **no** file, Downloads still held exactly **1** career file, and the app showed *"The game could not write the file to this device, so there is nowhere to put the career. Your career is untouched — nothing was changed."* No *"Career written to"* claim appeared. That is the sentence the Android wording is chosen for: the download is not offered in a WebView, so the refusal is the whole answer |
| Where the file goes, and under what name | `Se27FilesPlugin.java` inserts into the device's own **Downloads** collection on Android 10 and later (`MediaStore.Downloads`, `RELATIVE_PATH`, `IS_PENDING` until the bytes are all there) and into the application's external folder below that; the name is sanitised first (`CareerFiles.java`: last path segment only, no separators, no characters a file system may refuse, never empty, never hidden) |
| Legacy saves | `src/state/persistence.test.ts` covers migration of older save versions forward on load |
| The match engine is untouched | `src/simulation/**` was not modified by any of this work — `git status` shows nothing changed under it, and the Android build consumes the same `dist/` the website does. The suites that cover it are run below; the failures found there are named rather than hidden |
| The web build still works | `npm run build` produces the website, `sw.js` (with the generated precache manifest), `_headers` and `og.png`; the native build leaves those three out and prints that it did. Nothing about the Cloudflare Pages deployment changed: no new redirects, no new headers, no new bundle entry points |
| Automated suites, fast | `npx tsc --noEmit` clean (both `tsconfig.json` and, for the desktop shell, `tsconfig.desktop.json`); `npx vitest run` → **76 files, 935 tests, all passing** (83 s). This configuration deliberately excludes the minute-long simulation suites. Twelve of those tests are new in Gates 3–4, all of them over the release preflight, and the last two hold the signing file to `java.util.Properties`'s escape rules |
| Android unit tests, on the JVM | `./gradlew testDebugUnitTest` → **9 tests, 0 failures** (`BUILD SUCCESSFUL`, read out of the JUnit XML: `CareerFilesTest` 8, the generated example 1) — eight of them `CareerFilesTest`, holding the file-name rules (a separator never survives, the extension is the one the game reads, nothing hidden, nothing control-charactered, an empty name falls back to the game's own) without needing a device |
| Automated suites, slow | `npm run test:slow` → **4 failed, 624 passed, 2 skipped (630 tests, 509 s)**, 3 files. The four are the two deterministic `playerConversation` ones, one `training` and the `saveTransfer` that only fails under this configuration — see *Failed*. That run predates the export work: `src/ui/saveTransfer.test.ts` has since gained four tests, and all **13** of that file pass under the slow configuration (`13 passed`, 8.0 s), which is the part of it this report's claims rest on. The run above is from Gate 3, made with nothing else running on the machine, and no failing file is one Gate 3 touched |
| The production web build | `npm run build` succeeds; the precache manifest is written into `dist/sw.js` (55 entries); `_headers` and `og.png` are present, as the website needs |

### Release Gate 3 — the release path itself

Everything below was run on this machine against real keystores and the real
phone. Every *signed* line is signed with the **throwaway rehearsal key** and is
proof that the machinery works, not an artifact anybody may upload.

| area | what was verified |
| --- | --- |
| The signing preflight, failure by failure | 19 cases driven against genuinely malformed inputs: the committed example copied verbatim; a `storeFile` that does not exist; a text file named `.jks`; a zero-byte file; **a directory**; a real PKCS12 keystore with the wrong store password; a real keystore with the wrong alias; a PKCS12 keystore whose two passwords differ; a real JKS keystore with the wrong key password; both keystore formats configured correctly. Every failure names the problem and exits 1; both good keys exit 0. **Not one secret appeared in any run's output** — checked by searching every log for the fixture passwords |
| Blank values in `keystore.properties` | `storePassword=` with nothing after it used to read the *next* line as the password (the pattern around the `=` was `\s`, which counts the newline), so a half-filled file passed the check written to catch it. Fixed, and held by a test that uses that exact file |
| An SDK of empty directories | Against a fake SDK whose `platforms/android-36`, `build-tools/36.0.0` and `build-tools/35.0.0` are empty directories: none is counted as installed, each is named as a husk, and the release is blocked with exit 1. The platform half of this was **new** — the build-tools half was fixed in the previous gate |
| The upload key's fingerprint | The preflight prints the signing certificate's SHA-256, which is the public fact a Play record names — `keytool -list -v`, no secret in it |
| **The bundle, by the documented command** | `npm run android:bundle` → **exit 0**, end to end: preflight, `npm run build:native`, `npx cap sync android`, `gradlew bundleRelease`. `android/app/build/outputs/bundle/release/app-release.aab`, **3,862,207 bytes**, 2026-10-09 08:34:45 |
| The bundle is signed, by the key it was given | `keytool -printcert -jarfile app-release.aab` → `Owner: CN=SE27 gate 3 rehearsal, O=throwaway, C=GB`, `SHA256 00:4A:CE:16:…:5B:F2` — the same fingerprint `keytool -list -v` reports for that keystore's `upload` alias. Without a key the same command emits an **unsigned** bundle (`Not a signed jar file`), which is what Play refuses |
| The bundle carries the game, byte for byte | `base/assets/public/` inside the AAB is `dist/` **byte for byte**: 54 files, identical SHA-256 for every one, plus Capacitor's two Cordova shims. No `sw.js`, no `_headers`, no `og.png` |
| The bundle is the *production* one | The AAB the tool built holds the minified bundle (`index-bl4hH8V-.js`, 771,327 bytes) with React's production build in it. Before this gate the same command produced a 956,770-byte bundle containing `react-dom.development` — see the defects |
| **A release build on the phone** | `assembleRelease` → `app-release-unsigned.apk` (4,007,142 bytes) → zipaligned → signed with the SDK debug key → installed **over** the debug build: `Success`, `firstInstallTime` **unchanged** (2026-10-09 04:05:58) with `lastUpdateTime` advanced, so Android treated it as an *update* and kept the career |
| It is the release variant | `aapt dump badging` reports **no `application-debuggable`**; `adb shell run-as com.sundayeleven.se27` answers `package not debuggable`; `adb shell cat /proc/net/unix` shows **0** `webview_devtools_remote` sockets where the debug build had **1** |
| Launch and rendering | `am start -W`: `COLD`, 240 ms, `Status: ok`; a second launch `HOT`, 44 ms. The screen the release build renders is **the same screen the debug build rendered**: 0.77% of pixels differ (mean channel difference 0.61 out of 255) against 80.99% against the home screen as a control. The debug build's own page, read over its DevTools socket, showed the manager's career — *Upper Whaltree Working Men's Club*, `2026/27 · matchday 1 of 22` |
| No crash, no console noise | 0 `FATAL EXCEPTION`, 0 ANRs and no `beginning of crash` line in logcat across the install, the cold launch, the relaunch and a full-screen play period |
| Nothing comes off a network | `dumpsys netstats` holds **no entry at all** for the application's uid (10373): in every session on this phone it has never sent or received a byte. That is a stronger statement than one flight-mode run, and it does not risk the wireless-debugging link |
| The web build after all of it | `npm run build` succeeds, `dist/` carries `sw.js`, `_headers` and `og.png`, and the precache manifest is still written into `sw.js` (55 entries) |

### Release Gate 4 — the owner's own upload key

Gate 3 proved the machinery with a throwaway key. This gate is the real one: the
owner created the upload key on this Windows host, and everything below was run
against it. Nothing was uploaded anywhere.

| area | what was verified |
| --- | --- |
| The key, made by the documented command | `keytool -genkeypair` → `C:\Users\<owner>\keys\se27\upload-keystore.jks`, **4,344 bytes**, a real PKCS12 store (`30 82 … 02 01 03` on the first bytes), `alias upload`, **RSA 4096** (read off the certificate in the bundle: `Public-Key: (4096 bit)`, `sha384WithRSAEncryption`), valid until **2054**. Outside the repository, and no `.jks`, `.keystore` or `.p12` exists *inside* it |
| The preflight, against the real key | `npm run android:preflight` → **exit 0**, `Nothing in the way of a release build`. `✓ an upload key is configured (alias upload, PKCS12)`; the store password opens the store, the two passwords agree, and the certificate's SHA-256 is printed: `FB:D6:82:69:7E:67:06:86:A7:00:5C:FA:6E:0D:96:69:8E:37:38:4F:91:08:0D:B7:D0:7C:A9:06:FA:8C:1E:99`. Not one secret appeared in the output |
| The build, by the documented command | `npm run android:bundle` → `preflight → npm run build:native → npx cap sync android → gradlew bundleRelease`, producing `android/app/build/outputs/bundle/release/app-release.aab`, **3,862,195 bytes**, 2026-10-09 09:11. `SHA-256 d4aee0c834e5a73aae0e88906f9dd83d888c9716e01696fad9a4383eec5deb64` |
| **It is signed by the owner's key** | `keytool -printcert -jarfile app-release.aab` → `Owner: CN=Horsemen Interactive, O=Horsemen Interactive, C=GB`, `Valid from: Fri Oct 09 09:06:05 BST 2026 until Feb 24 2054`, `SHA256 FB:D6:82:69:…:1E:99` — **the same fingerprint the preflight reported from the keystore**, so the bundle really was signed by the key that was created. `jarsigner -verify` → `jar verified.`, exit 0, with the expected warning and nothing else: an upload certificate is self-signed, which is normal and is why Play App Signing exists |
| It carries the game, and only the game | The set difference between `base/assets/public/` inside the AAB and `dist/` is exactly Capacitor's own `cordova.js` and `cordova_plugins.js`: **56 = 54 + 2**, nothing missing from `dist/` and nothing extra. No `sw.js`, no `_headers`, no `og.png` |
| It is the *production* bundle | The shipped `index-*.js` is **771,327 bytes** and contains **no** `react-dom.development` (the size the docs name for the production build; the `NODE_ENV` defect would have made it 956,770). The string `0.10.1` appears in the shipped JavaScript |
| The two Windows traps, measured | Against a real `keystore.properties` written with Windows separators: a **single** backslash path is refused by name (`holds an escape Java cannot read: storeFile`) — the file Gradle would have failed on with `Malformed \uxxxx encoding`; **forward slashes** and **doubled backslashes** both pass and reach the keystore. Checked by writing the file with two backslashes per separator (confirmed byte by byte with `od`) and running the preflight |

### The defects found and fixed during this work

These are worth naming individually. Several were a *tool* or a *build* lying
about its state and costing the next person an afternoon; one was the game itself
lying about a manager's backup; the last was the release path reading a file with
different rules from the build that consumes it.

1. **The build could not be built at all on this host.** `./gradlew` under
   Android Studio's bundled JetBrains Runtime (JDK 25) dies with
   `Unsupported class file major version 69`, a message naming neither the JDK
   nor the problem. Fixed by building with JDK 21 (Temurin), and by teaching
   `npm run android:preflight` that a JDK *newer than Gradle can run on* is a
   failure rather than a pass (`src/platform/release.ts`, `javaProblem`).
2. **AGP compiled with build tools nobody had installed.** `buildToolsVersion`
   was unstated, so AGP 8.13 defaulted to **35.0.0** — not the 36.0.0 this
   project documents, installs and checks for — and the build failed with
   `Failed to find Build Tools revision 35.0.0`. Fixed by pinning 36.0.0 once,
   in `android/variables.gradle`, and applying it to every Android module from
   the root `android/build.gradle` (the Capacitor library modules are generated
   into `node_modules` and are not ours to edit).
3. **The preflight passed an SDK that could not compile anything.** It read a
   build-tools *directory* name and reported `✓ build-tools 36.0.0` for a folder
   left empty by an interrupted download (`.installer` and nothing else). It now
   counts a revision only when it holds `aapt2` and its `source.properties`,
   names a husk as a husk, and requires the `adb` binary for platform-tools.
   `src/platform/release.test.ts` pins all of it.
4. **The documented release command could not find Gradle, and shipped a
development build.** Two defects in the same ten lines, and both were invisible
   in the way that matters: the command did everything expensive first, then
   failed, or succeeded with the wrong artifact.
   * `gradlew.bat` was invoked by bare name from the repository root, one level
     above the wrapper. `npm run android:bundle` checked everything, built the
     native assets, ran `cap sync`, and then died with `'gradlew.bat' is not
     recognized as an internal or external command`. The wrapper is now named by
     its full path and run from `android/` — both, because a bare name is resolved
     by searching the *current* directory and `NoDefaultCurrentDirectoryInExePath=1`
     (which Git Bash sets) takes that directory out of the search.
   * The bundle the tool built was **not the bundle the same command builds by
     hand**: 956,770 bytes carrying `react-dom.development` against 771,327 bytes
     of production build. Every tool here starts under `vite-node`, which sets
     `NODE_ENV=development` in its own process, and a child inherits it — so Vite
     compiled a development bundle. The Android tool and `npm run release` (which
     built the website it deploys the same way) now state
     `NODE_ENV=production` for the child that builds. This is the first defect
     here that would have reached a *user*: slower, larger, with React's
     development warnings in it.
5. **The keystore checks trusted the file to describe itself.** The preflight
   read `keystore.properties` and stopped there: it never opened the keystore, so
   a wrong store password, a missing alias, a damaged file or a directory named
   `.jks` were all discovered by Gradle minutes later, and a PKCS12 keystore whose
   `keyPassword` differed from its `storePassword` was discovered by `apksigner`
   in words that name neither the keystore nor the reason (`Failed to obtain key
   with alias … Wrong password?`). The preflight now opens the store with the
   password (handed over in the child's environment, never on a command line),
   checks the alias against the aliases the store really holds, opens the *key*
   with `-certreq` where the format allows a second password, and compares the two
   passwords for PKCS12, which holds only one. 19 fixture cases and 26 tests hold
   it.
6. **The platform half of the "empty directory" trap was still open.** The
   build-tools check had been taught to require `aapt2`; the platform check only
   read a directory listing, so `platforms/android-36` left behind by an
   interrupted download counted as an installed SDK platform. Both are now held to
   the files that do the work (`android.jar`, `aapt2`, `source.properties`), in one
   place with tests, and an SDK of husks is shown to block the release.
7. **The installed application told managers their career had been exported when
   nothing had been written.** Capacitor's Android WebView implements
   `onShowFileChooser` — which is why importing a career works on a phone — and
   registers **no `DownloadListener`**, so the blob behind the game's
   `<a download>` was dropped on the floor while the click itself returned
   normally and `saveTextFile` reported `saved`. Fixed in three parts, all of
   them about telling the truth: `src/platform/files.ts` asks the platform
   whether a download would *work* before offering one (and stops pretending in
   a WebView), the native shell installs a host that writes the file itself
   (`src/platform/nativeFiles.ts` → `Se27FilesPlugin.java`, registered by
   `MainActivity`), and the platform's answer — file name **and** place — is what
   the manager is shown. Verified on the phone, both ways round: a real export
   that lands in `Downloads` (5,360,556 bytes, pulled back and parsed), and a
   refusing host that produces a sentence instead of a claim.

8. **The signing file was read by one parser and used by another.**
   `android/keystore.properties` is loaded by **Gradle**, with
   `java.util.Properties`, where a backslash is an escape — so the path Windows
   hands you, `C:\Users\…\se27\upload-keystore.jks`, contains a malformed Unicode
   escape in `\upload` and makes `load` throw `Malformed \uxxxx encoding` before
   Gradle has configured anything. The preflight read that file **literally**, so
   it approved exactly the file that killed the build, and the failure arrived as
   a Gradle stack trace naming neither the file nor the reason. Fixed by decoding
   every value the way Java does (`src/platform/release.ts`,
   `readJavaPropertiesValue`) and having the preflight **refuse** a file whose
   values it cannot decode, with the two working spellings named in the message.
   The readings were taken from `java.util.Properties` on JDK 21 rather than from
   documentation, and two tests hold them.

## 4. Failed

| what | evidence | consequence |
| --- | --- | --- |
| **A PKCS12 keystore holds one password, and the two-file arrangement invites two** | `keytool -genkeypair` writes PKCS12 by default in JDK 9+ and *warns and ignores* a separate `-keypass`. `apksigner` then fails with `Failed to obtain key with alias … Wrong password?` | Caught by the preflight now (`passwordMismatchProblem`), with a sentence that names the format. It remains a trap for anyone who edits `keystore.properties` by hand |
| **iOS has never been built** | No `ios/` project, no macOS, no Xcode | Everything about iOS in this report is a plan, not a result |
| **Copy that says "browser" inside the installed app** | On the device, the start screen's Continue panel reads *"your career is saved as you play, and everything stays in this **browser**"* | Cosmetic, but it is the sort of thing a store reviewer notices. Fix is one string, and it needs a `hasWebShell()` branch like the install card already has |
| **Two console errors at every launch** | `E Capacitor/Console: Error injecting safe area CSS: TypeError: Cannot read properties of null (reading 'style')` — the shell injects the insets before `document.documentElement` exists | No user-visible effect: the values are correct a moment later, and `env()` covers the gap. Left as-is rather than patched around; recorded so nobody spends an hour on it. It is Capacitor's `SystemBars`, not this project's code |
| **The slow test suite does not pass** | `npm run test:slow` this gate: **4 failed, 624 passed, 2 skipped (630 tests, 509 s)**, 3 files — `playerConversation.test.ts` (2), `training.test.ts` (1), `saveTransfer.test.ts` (1). Gate 2 isolated the same set: the two `playerConversation` failures and the `training` one are **deterministic** (they fail with the file run alone) and the `saveTransfer` one passes 13/13 in isolation and only breaks under that configuration — so three of the four are the same kind of load-sensitive failure and one is not. No failing file is one Gate 3 changed | A red suite on a released build is a release risk, and the two deterministic ones are in the simulation, not in the packaging this work touched (`src/simulation/communication/**` is unmodified in this working tree, and the failing case is seeded, so it does not depend on anything changed here). The assertion is exact: an *available* player is expected to answer `available-confident`, and the reply comes back `grumbling`, because `playerConversation.ts` decides on tension/friendship (line 240) before it reaches the availability branch that the test asserts. **Owner action: nobody should ship behind a failing suite** — either the ordering or the test is wrong, and that is a simulation call, not a packaging one, so it was deliberately left alone |

## 5. Untested

Nothing here may be described as working.

* **iOS, in full.** No build, no simulator, no device, no signing, no TestFlight.
  The keyboard in a WKWebView, `env(safe-area-inset-*)` on a notched iPhone, the
  swipe-back edge gesture and the app-switcher resume are all unperformed.
* **Any device other than the Pixel 7a on Android 17.** So: no Android 16 (the
  `targetSdk` actually shipped), no Android 7–15, no low-end or mid-range phone,
  no tablet, no small screen, no landscape, no low-storage device, no device
  with a slow GPU. The `minSdk 24` floor has never been *installed* on a device
  of that age.
* **Aeroplane mode on the device.** The bundle has no remote assets and no
  service worker (both verified), but the radio has never actually been off
  while the game was played.
* **Low storage, save failure and interrupted autosaves on the device.** These
  are covered by tests against `fake-indexeddb`; the real filesystem behaviour
  (quota errors, killed writes) has not been provoked on the phone.
* **An extended session, and a full season, on the device.** One afternoon was
  played. The season loop and the soak run headlessly, on the desktop.
* **Repeated match play on the device** — more than one match, and the pause /
  resume path several times in a session.
* **The release build path beyond signing.** `assembleRelease`, `bundleRelease`
  and signing have now all been run (with throwaway keys), but **R8 is off** and
  has never been tested with it on, no bundle has been uploaded, and Play's own
  pre-launch report has never seen one.
* **Every interactive check in the *release* variant.** The release build exposes
  neither a DevTools socket (0 sockets in `/proc/net/unix`, against 1 in the debug
  build) nor an accessibility tree to `uiautomator` (the hierarchy is a single
  `android.webkit.WebView` node with no text), so a career created or loaded, a
  match played to full time, an export through the app's own screen and an import
  through the Android file picker were **not** driven on the release build. What
  *is* established there is narrower and stated as such: the release variant
  launches, renders the same screen the debug build rendered (0.77% of pixels
  different), does not crash, keeps the career's storage through an in-place
  update, and has never used the network. The interactive behaviour itself was
  verified on the debug build in Gate 2, and the two bundles are byte-identical.
* **The radio actually off.** The offline claim rests on the APK's contents
  (byte-identical to `dist/`, no service worker) and on `dumpsys netstats` having
  no entry at all for the application's uid. The flight-mode check proper was not
  run: the device is attached over **wireless** debugging, so switching the radio
  off would cut the only link to it and could not be undone from here.
* **A career file chosen from the phone's own file manager.** Unchanged from Gate
  2 — the picker could not be reached by script, and the release build has no
  scripting surface at all (see above).
* **Everything in the two consoles**: Data safety, content rating, screenshots,
  pricing, countries, the Play App Signing enrolment, internal/closed testing,
  production access, App Store Connect, App Privacy, TestFlight.
* **Performance and resource figures.** Memory, CPU, frame timing and battery
  were not measured on the device; nothing about a low-end phone's experience is
  known.
* **The import path on a real device, end to end.** The picker button was not
  reached reliably by script; the framework-side capability exists
  (`onShowFileChooser`) and the logic is unit-tested, but a career file has not
  been chosen and opened from the phone's own file manager.
* **The export's failure arm was provoked, not encountered.** The refusal on the
  device came from injecting a host that answers `written: false` at the seam the
  game documents — which is a faithful replay of the state the installed app was
  in, but it is not a *real* device failure. Full storage, an unwritable
  Downloads collection, a storage volume that has gone away, and a write
  interrupted half-way through (the case `IS_PENDING` and the row deletion exist
  for) have not happened.
* **The Android 9-and-older branch of the writer has never run.**
  `Se27FilesPlugin` writes into the application's own external folder below
  Android 10; the phone tested is on Android 17, so only the `MediaStore` path
  has been exercised, and the `minSdk 24` floor is still an uninstalled claim.
* **Export on iOS is unverified, and has no host.** The page-side bridge is
  platform-neutral, but nothing implements it for iOS, and whether a WKWebView
  catches an `<a download>` in this shell is unknown. Until an iOS plugin or a
  verified download delegate exists, the honest answer on iOS is the same
  sentence the Android app used to be owed.
* **Android Studio itself.** The project was built from the command line; the
  IDE's Gradle sync, its device manager and its emulator were not used. No
  system image is installed, so there is no emulator here at all.
* **The soak run was not repeated.** The season loop was exercised by
  `npm run test:slow` above (582 s); the multi-decade evidence in
  [`SOAK.md`](SOAK.md) is from earlier work and was not regenerated for this
  audit. Nothing in this work touched the simulation, so it is quoted rather than
  re-earned.

## 6. Owner action required

### Accounts, keys and decisions only the owner can make

| | task | notes |
| --- | --- | --- |
| 1 | **Register the Play Console account** and choose **personal or organisation** | The personal-account route carries the 12-testers-for-14-days closed test before production access. Organisation accounts have their own verification requirements. Worth deciding *before* the release is prepared |
| 2 | **Create the upload keystore and back it up** — the exact commands are under [Creating the upload key](#creating-the-upload-key) | Free, and about five minutes. Nothing else in this report is blocked on anything but this: `npm run android:bundle` will produce the artifact the moment it exists |
| 3 | **Complete: Data safety, content rating, privacy policy URL, store listing, screenshots** (at least two phone screenshots for Play; the sizes Apple requires for iOS), then **enrol in Play App Signing** | The artwork that exists is in [`store/`](store/README.md). Screenshots can be captured from the device — 1080 × 2400 is inside Play's accepted range |
| 4 | **Decide what to do about career export on iOS**, and re-run the Android export check on the first release candidate | Android is done and verified on the phone: the app writes into Downloads, says where, and refuses out loud (see *Passed*). The owner's part is the other platform — re-verifying it on the next build, and deciding whether iOS ships without a host |
| 5 | **Buy or borrow one ordinary Android phone** — a few years old, mid-range or low-end | The single most valuable thing for this audit: every device claim in this report is about one flagship-adjacent phone on Android 17 |
| 6 | **For iOS: a Mac, Xcode 26 or newer, and an Apple Developer Program membership** (99 USD/year) | Required even for a first TestFlight build. Until then, treat iOS as unstarted |
| 7 | **Decide whether to keep minification off** for the first release | It is off on purpose (`minifyEnabled false`), with a test that stops it being switched on casually: R8 can strip Capacitor's runtime-resolved plugins and the failure mode is a blank screen that every debug build hides |
| 8 | **Get the slow suite green before a release**, or decide it does not block | Two of its five failures are deterministic and in the simulation (`playerConversation`'s availability answer); three are timing-sensitive under that configuration and pass in isolation. Either way, `npm run test:slow` is currently red, and a release should not be cut from a red suite |

### Creating the upload key

This is the one step that cannot be done for you: a password invented here would
be a password in a transcript, and a key made without your knowledge would be a
key to your application. Everything else about it is checked by the tools.

**1. Make the key outside the repository**, in a folder you are going to back up.
On Windows, which is the host this was prepared on, that folder is
`C:\Users\<you>\keys\se27` and the JDK is `C:\Users\<you>\.jdks\temurin-21`. On
this machine it already exists, so the command is one line in **cmd** (`^` is the
line continuation there, so keep it whole):

```bat
"C:\Users\<you>\.jdks\temurin-21\bin\keytool.exe" -genkeypair -v -keystore "C:\Users\<you>\keys\se27\upload-keystore.jks" -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Horsemen Interactive, O=Horsemen Interactive, C=GB"
```

In **PowerShell** it is the same with one character more — a quoted executable
path needs the call operator `&` in front of it:

```powershell
& "C:\Users\<you>\.jdks\temurin-21\bin\keytool.exe" -genkeypair -v -keystore "C:\Users\<you>\keys\se27\upload-keystore.jks" -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Horsemen Interactive, O=Horsemen Interactive, C=GB"
```

The same on a POSIX shell, for anyone building on macOS or Linux:

```bash
mkdir -p "$HOME/keys/se27"
"$HOME/.jdks/temurin-21/bin/keytool" -genkeypair -v \
  -keystore "$HOME/keys/se27/upload-keystore.jks" \
  -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Horsemen Interactive, O=Horsemen Interactive, C=GB"
```

It asks for a store password. **When it asks for the key password, press Enter** —
that reuses the store password, and it is what you want: `keytool` writes PKCS12,
and PKCS12 holds *one* password. Choose a long one and put it in your password
manager; nothing here needs to know it.

A `cmd` window with no `JAVA_HOME` cannot run the Gradle build either — the
preflight says so rather than guessing — so set it once with
`setx JAVA_HOME "C:\Users\<you>\.jdks\temurin-21"`, which applies to new shells,
or per-shell with `set JAVA_HOME=C:\Users\<you>\.jdks\temurin-21` in `cmd` and
`$env:JAVA_HOME = 'C:\Users\<you>\.jdks\temurin-21'` in PowerShell.

**2. Point the build at it.** `android/keystore.properties` is ignored by git —
copy the example and fill in the four values, with `storeFile` as an absolute
path (`storeFile` may also be relative to `android/app/`). The easiest way is
`copy android\keystore.properties.example android\keystore.properties`, then open
it in an editor:

```properties
storeFile=C:/Users/<you>/keys/se27/upload-keystore.jks
storePassword=<the store password>
keyAlias=upload
keyPassword=<the same password>
```

Three Windows traps in that file, all of which the preflight reports rather than
letting Gradle fail obscurely:

* **Write `storeFile` with forward slashes.** Gradle loads this file with
  `java.util.Properties`, where a backslash is an *escape*: `\k` and `\s` lose
  their backslash, `\t` becomes a tab, and `\u` in `\upload-keystore.jks` is a
  malformed Unicode escape, so `load` throws `Malformed \uxxxx encoding` before
  Gradle configures anything. Doubling every backslash also works, because that
  is Java's own way of writing one.
* **Avoid backslashes in the password** for the same reason (`pa\ss` is read back
  as `pass`). Letters, digits, dashes, dots and most symbols are safe, and `=`
  inside a password is fine — only the first one on the line splits the value.
* **Save it without a UTF-8 BOM.** Notepad's default is already BOM-free; if the
  preflight ever says the file *states no storeFile* while you can see one, a BOM
  is the cause.

**3. Ask the preflight whether it is right** — it opens the store, checks the
alias and the key password, and prints the certificate's SHA-256, which is the
fingerprint the Play record will name:

```bash
npm run android:preflight     # → ✓ an upload key is configured (alias upload, PKCS12)
```

**4. Back it up to a second place** — an encrypted archive somewhere that is not
this machine, and not this repository. Losing the *upload* key is recoverable
(Play Console can reset it); losing the **app signing key** is not, and that is
precisely the one Google keeps rather than you.

**5. Then the artifact** is one command, and it does the whole sequence:

```bash
npm run android:bundle        # preflight, build:native, cap sync, gradlew bundleRelease
```

Nothing about the key belongs in this repository, in a chat, or in a log:
`keystore.properties.example` is the committed shape, the preflight reports the
values as present or absent and never prints them, and the file is ignored by git
with a test holding the pattern in place.

### Things that can be downloaded, and what each one is for

* **JDK 21** (Temurin, <https://adoptium.net>) — needed to build at all on this
  host, because Android Studio's bundled JDK 25 cannot run Gradle 8.14.3. Already
  installed at `~/.jdks/temurin-21`.
* **Android SDK platform 36, build-tools 36.0.0 and platform-tools** — already in
  place. `sdkmanager` cannot fetch them from this network (`dl.google.com`), so
  they were placed by hand; [`ANDROID.md`](ANDROID.md#an-sdk-the-sdk-manager-cannot-fill-in)
  says how, and where the same packages are mirrored.
* **An emulator system image** (`system-images;android-36;google_apis;x86_64`,
  ~1.5 GB) plus the `emulator` package — *optional*, and a poor substitute for a
  real second phone. It would at least add a second screen size and a clean
  Android 16 install, and it needs the same download workaround.
* **A screenshot of the game at a store-legible size** — no download: capture it
  from the phone (`adb exec-out screencap -p`).
* **Nothing else.** No purchase, no licence and no service is needed for the
  Android build; the store accounts and the iOS toolchain above are the only
  things that cost money, and neither is needed until a submission is intended.

## 7. What was changed in this repository

Hardening and one product defect, plus documentation. No gameplay, no
simulation, no save format, no web deployment change.

| file | change |
| --- | --- |
| [`src/platform/files.ts`](src/platform/files.ts) | `downloadWouldWork()`: a download is offered only where a browser is actually behind the page; the host write reports *where*, and the file outcome carries it |
| [`src/platform/nativeFiles.ts`](src/platform/nativeFiles.ts) | new: the native host the game writes careers through, installed by the shell |
| [`android/app/src/main/java/com/sundayeleven/se27/Se27FilesPlugin.java`](android/app/src/main/java/com/sundayeleven/se27/Se27FilesPlugin.java) | new: the Capacitor plugin that writes a career into the device's Downloads collection, resolving `{ written, location }` or `{ written: false, reason }` and never rejecting |
| [`android/app/src/main/java/com/sundayeleven/se27/CareerFiles.java`](android/app/src/main/java/com/sundayeleven/se27/CareerFiles.java) | new: the file-name rules, kept free of Android so the JVM can test them |
| [`android/app/src/main/java/com/sundayeleven/se27/MainActivity.java`](android/app/src/main/java/com/sundayeleven/se27/MainActivity.java) | registers that plugin with the bridge before the activity starts |
| [`android/app/src/test/java/com/sundayeleven/se27/CareerFilesTest.java`](android/app/src/test/java/com/sundayeleven/se27/CareerFilesTest.java) | new: eight tests over the name rules, run by `./gradlew testDebugUnitTest` |
| [`src/platform/nativeFiles.test.ts`](src/platform/nativeFiles.test.ts) | new: pins the agreement between the page and the shell — one plugin name on both sides, one method, registered before the page can ask, and a refusal that arrives as a result |
| [`src/ui/saveTransfer.ts`](src/ui/saveTransfer.ts), [`src/ui/components/CareerFile.tsx`](src/ui/components/CareerFile.tsx) | the export's sentence names the place the host used, when it can say |
| [`android/variables.gradle`](android/variables.gradle) | names the build-tools revision (`36.0.0`) instead of leaving it to AGP's default |
| [`android/app/build.gradle`](android/app/build.gradle) | the application module compiles with that revision |
| [`android/build.gradle`](android/build.gradle) | every Android module does — including the Capacitor libraries, which are generated into `node_modules` and cannot be edited |
| [`src/platform/release.ts`](src/platform/release.ts) | `buildToolsVersionFrom`, and `javaProblem`/`GRADLE_JAVA`: a JDK too new for the Gradle wrapper is a failure, not a pass |
| [`tools/androidRelease.ts`](tools/androidRelease.ts) | a build-tools revision is only counted when it holds `aapt2`; husks are named; platform-tools requires `adb`; the build-tools check follows the pinned revision |
| [`src/platform/release.test.ts`](src/platform/release.test.ts) | 16 tests now (was 14), pinning the build-tools revision, its wiring in both Gradle files, and the JDK range |
| [`ANDROID.md`](ANDROID.md) | rewritten for what is now true: the device evidence, the JDK trap, the SDK-download trap, the build commands that were actually run |
| [`tools/buildEnv.ts`](tools/buildEnv.ts) | new: `productionBuildEnv()`, because `vite-node` hands `NODE_ENV=development` to every child and a build under it is a different, unminified application with React's development build inside |
| [`tools/androidRelease.ts`](tools/androidRelease.ts) | the wrapper by full path and from `android/` (the documented bundle command had never reached Gradle); the build child runs in production mode; the signing checks open the keystore, the alias and the key; platform husks are named; every password travels in a child's environment and is scrubbed before printing |
| [`tools/release.ts`](tools/release.ts) | the website build it deploys runs in production mode too, for the same reason |
| [`src/platform/release.ts`](src/platform/release.ts) | the signing properties are read by one parser (which no longer lets an empty value swallow the next line), with `keystoreVerdict`, `keyPasswordProblem`, `passwordMismatchProblem`, `aliasesFrom`, `redactSecret` and the two SDK-package rules |
| [`src/platform/release.test.ts`](src/platform/release.test.ts) | **26 tests** now (was 16): the parser against the half-filled file that used to pass, every keytool answer captured from a real fixture, the PKCS12 rule, the scrubber, the SDK husks, the wrapper's working directory and full path, and the production build environment for both release tools |
| [`RELEASE_READINESS.md`](RELEASE_READINESS.md) | this report |
