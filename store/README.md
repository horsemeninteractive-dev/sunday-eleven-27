# The artwork a store listing asks for

Nothing in this directory is part of a build. It is the handful of pictures that
are uploaded by hand into a console, kept here so that they are generated from
the same mark as everything else rather than drawn again in an image editor and
slowly drifting from the game.

```bash
npm run icons     # regenerates public/, the Android project's artwork, and this
```

| file | what it is | specification, as the store states it |
| --- | --- | --- |
| `play-icon-512.png` | the icon on the Play listing | **32-bit PNG (with alpha), 512 × 512, max 1024 KB** — [Play Console Help: preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) |
| `feature-graphic-1024x500.png` | the banner across the top of the Play listing | **JPEG or 24-bit PNG (no alpha), 1024 × 500** — same page |
| `apple-icon-1024.png` | the App Store icon | 1024 × 1024, **no alpha** — the App Store rejects an image with an alpha channel |

All three are the game's own mark: the two icons are the maskable variant (full
square, wordmark inside the safe zone, on the club green), because both stores
apply their own corner mask and an icon that had drawn its own corners would
show two roundings at once. The feature graphic is the splash screen's
composition — the mark on the game's near-black — because a listing should look
like the game opening rather than like a poster for it. The channel count is
per file and deliberate: Play asks for alpha on the icon and forbids it on the
feature graphic, and Apple forbids it on the icon.

## What has to be captured by hand

Screenshots, and nothing else here can substitute for them: both stores require
pictures of the running game, and a generated picture of a game is not evidence
of one.

**Google Play** ([preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)):

* a **minimum of two** screenshots across different device types to publish;
  **up to 8** per device type
* JPEG or 24-bit PNG, **no alpha**; shortest side ≥ 320 px, longest ≤ 3840 px,
  and the longest side no more than twice the shortest
* to be eligible for the large-format game placements: **at least three**
  16:9 landscape (≥ 1920 × 1080) **or** three 9:16 portrait (≥ 1080 × 1920),
  showing the in-game experience — the pitch, the match, the squad
* alt text for each one (≤ 140 characters), and no text or device frames that
  are not part of the game
* a preview video is optional; for games it is strongly recommended, and it must
  be a YouTube URL with ads disabled

**The App Store** ([screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)):

* at least one, up to 10 per device size, JPEG or PNG, **no alpha or
  transparency**
* **required:** at least one for *iPhone with Dynamic Island (medium display)* —
  1179 × 2556 or 1206 × 2622 portrait, or the same landscape
* **required if the app supports iPadOS:** at least one for the 13-inch iPad
* App Store Connect scales a large screenshot down to the smaller sizes, so one
  set at the highest required resolution is enough
* a 6.9-inch-class iPhone is what to capture on

## The words, and the forms

Not pictures, but the same kind of hand-written listing asset, and all of them
are checked at upload:

* **short description**, 80 characters, no emoji, no "download now", no "#1"
* **full description**, 4000 characters
* Play's **Data safety** form, **content rating** questionnaire (IARC),
  **target audience**, and a **privacy policy URL** — see
  [`RELEASE_READINESS.md`](../RELEASE_READINESS.md#owner-action-required) for what
  this game's answers are and which of them are the account owner's to give
* Apple's **App Privacy** details ("Data Not Collected" for this game) and the
  **age rating** questionnaire

The recommended starting text for the descriptions is in
[`RELEASE_READINESS.md`](../RELEASE_READINESS.md).
