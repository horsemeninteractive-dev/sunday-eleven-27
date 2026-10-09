# Sunday Eleven 27 on iOS

How the same game becomes an iOS application, what Apple requires of it, and
what has and has not been done.

> **Status.** There is **no `ios/` project in this repository, no iOS build has
> been made, and nothing has been run on an iPhone or an iPad simulator.** Xcode
> only runs on macOS and this stage was prepared on Windows, so a directory
> created here would be a project nobody had ever built — worse than the honest
> absence of one, because it would look finished. Everything below is the
> process, the configuration that already exists, and the parts that are Apple's
> to give. `ANDROID.md` is the same document for the other store, and is the one
> with verified results in it.

The game itself needs nothing new: the iOS shell consumes the *same* native
bundle Android does (`npm run build:native`), the application id and display name
are already declared once in [`capacitor.config.ts`](capacitor.config.ts), and
the simulation, the rules and the save format are shared with the website and
with Android, because there is still only one of them.

## What Apple requires, and since when

| requirement | since | where it is stated |
| --- | --- | --- |
| Uploads must be built with **Xcode 26 or later**, using the **iOS 26 SDK** or later | **28 April 2026** | [Apple Developer — Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/) |
| App Store privacy details ("App Privacy") for every app | long-standing | [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) |
| A **privacy manifest** with declarations for required-reason APIs | 1 May 2024 (enforced from 12 February 2025) | [Describing use of required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) |
| **Age rating** questionnaire under Apple's new rating system | 31 January 2026 | [Apple Developer — Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/) |
| Screenshots **must not have alpha channels or transparencies**; at least one for iPhone with Dynamic Island (medium display), and one for the 13-inch iPad if the app supports iPadOS | current | [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) |
| From **April 2027**: screenshots required for any app using the iOS 27.1 SDK or later | announced | same page |

Capacitor 8's own floor is **Xcode 26.0+, iOS 15.0 deployment target**, which is
inside Apple's requirements rather than in tension with them — see
[Updating to Capacitor 8](https://capacitorjs.com/docs/updating/8-0).

## What has to be on the Mac

* macOS with **Xcode 26 or later** and the command line tools selected
  (`xcode-select -p`)
* **CocoaPods** (`sudo gem install cocoapods`) — what Capacitor 8 uses to
  resolve its iOS plugins by default
* an **Apple Developer Program** membership (paid, annual) — this is an
  account-owner task and cannot be worked around
* a **Team ID** and, for a device run, the device registered to that team

Nothing about the web build changes: Node 22+ and `npm install`, as on any
machine.

## Building it for the first time

```bash
npm install
npm run build:native        # the game, without the browser's plumbing
npm i @capacitor/ios@8      # the iOS platform, version-matched to core
npx cap add ios             # creates ios/App, with the identifier already set
npx cap sync ios            # copies dist/ in and runs pod install
npx cap open ios            # Xcode
```

Then, in Xcode, once:

1. **Signing and Capabilities → Team**: choose the team. Automatic signing is
   the right default for a solo project; it creates the certificate and the
   provisioning profile from the account rather than from a file in a folder.
2. **App icon**: Xcode 26 takes a single 1024 × 1024 image and generates the
   rest. Use [`store/apple-icon-1024.png`](store/apple-icon-1024.png) — it is
   generated from the same favicon as everything else and it has **no alpha
   channel**, which is the one thing the App Store checks about an icon.
3. **Display name** and **bundle identifier**: already declared in
   `capacitor.config.ts` as `Sunday Eleven 27` and `com.sundayeleven.se27`, and
   `cap add ios` writes both into the project. They must not be edited in Xcode
   alone: the identifier is immutable once published, and a project whose
   identifier disagrees with `capacitor.config.ts` is a second application.
4. **Info.plist — export compliance**: add
   `ITSAppUsesNonExemptEncryption = NO`. The game makes **no network requests at
   all** (see [`RELEASE_READINESS.md`](RELEASE_READINESS.md#passed): the native
   bundle asks its own origin for files and nothing else), it implements no
   cryptography of its own, and the WebView's TLS belongs to the operating
   system. Declaring it avoids being asked the same question on every upload.
5. **Privacy manifest**: add `ios/App/App/PrivacyInfo.xcprivacy` to the app
   target, with the shape below. Apple's checker (`ITMS-91053`, `ITMS-91054`)
   scans the app and the SDKs inside it for *required-reason API* use; the two
   categories a WebView-based application is normally asked about are user
   defaults and file timestamps, because that is how the WebView and Capacitor
   keep their own state.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyTracking</key>
    <false/>
    <key>NSPrivacyTrackingDomains</key>
    <array/>
    <!-- No data is collected and none leaves the device: the game has no
         accounts, no analytics, no advertising and no network requests. -->
    <key>NSPrivacyCollectedDataTypes</key>
    <array/>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array><string>CA92.1</string></array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array><string>C617.1</string></array>
        </dict>
    </array>
</dict>
</plist>
```

If a submission comes back naming a category this does not cover, add that
category with the reason Apple lists for it — the reasons are in
[Describing use of required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
and each one is a short code (`CA92.1` is "accessing user defaults in your own
app", `C617.1` is "accessing timestamps of files inside the app container").

## Signing, and what must never be committed

Automatic signing is the recommendation for this project: one account, one team,
no certificate files to keep. Whatever the method, the material is the same kind
of secret as Android's upload key and is treated the same way — the root
`.gitignore` already refuses `*.p12`, `*.p8`, `*.mobileprovision` and
`play-service-account.json`, and `npm run android:preflight` fails if any of it
has ever been tracked.

For a machine that has to do it without a human in Xcode (a CI runner, later):

```bash
# A development build on a connected device
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -configuration Debug -destination 'generic/platform=iOS' build

# An App Store archive, and then the upload
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -configuration Release -archivePath build/App.xcarchive archive
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/
xcrun altool --upload-app --type ios --file build/App.ipa \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
```

The distribution certificate and the App Store Connect API key are the account
owner's, and belong in a keychain and a CI secret store rather than anywhere in
this repository.

## Testing it on a device

Nothing below can be done on this machine, and none of it has been done:

1. **Launch and cold start.** Fresh install, first run: the booting placeholder,
   then the main menu, with the status bar clear of the mark.
2. **A career.** Create one, play a matchday, save, force-quit from the app
   switcher, relaunch: the career must come back (IndexedDB inside the WebView's
   container is retained per application).
3. **The keyboard.** The message composer and the search field: the field must
   stay visible when the keyboard opens and the send button must stay reachable.
   This is the check a WKWebView most often fails, and it cannot be simulated in
   a desktop browser.
4. **Safe areas.** A notched iPhone and an iPad: nothing under the home
   indicator, nothing under the status bar or a cutout, portrait and landscape.
5. **Background and foreground.** Mid-match, swipe home, come back: the match is
   paused rather than racing, and no second clock starts.
6. **Offline.** Aeroplane mode from a cold start, and a whole match.
7. **The edge swipe.** iOS keeps its own back gesture; nothing here overrides it,
   so what to check is that it does not do something surprising inside the game.
8. **TestFlight.** An internal build on at least two people's devices, then the
   Beta App Review for anything external.

## What is Apple's, and the owner's

* Apple Developer Program enrolment (paid) and the agreements, tax and banking
  forms in App Store Connect
* the App Store Connect record and the Team ID
* the App Privacy answers ("Data Not Collected") and the age rating
  questionnaire
* screenshots — see [`store/README.md`](store/README.md) for the sizes Apple
  accepts and the "no alpha" rule
* an App Store distribution certificate and provisioning profile, if signing is
  not left automatic
