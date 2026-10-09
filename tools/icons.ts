/**
 * The app icons, made from the favicon.
 *
 * Everything the operating system shows for this game — the taskbar icon, the
 * home-screen icon, the splash screen, the icon in a "share" sheet — has to be
 * the same mark, or a game that looks like one thing on a desktop and another
 * thing on a phone reads as two games. The favicon is already the mark, so the
 * icons are generated *from* it rather than drawn again: change the favicon,
 * run this, and every icon follows.
 *
 * Two variants, both derived from the same file:
 *
 *   - the mark exactly as the favicon draws it, rounded corners and all, for
 *     anything that shows the icon on a background of its own;
 *   - the mark prepared for a platform that masks it: bled to the full square,
 *     because transparent pixels become black on iOS and Android crops a
 *     maskable icon to the launcher's own shape, and drawn inside the maskable
 *     safe zone, because a maskable icon may be cropped to a circle as small as
 *     80% of its width and the wordmark must survive that.
 *
 * The sizes are the ones browsers and platforms actually ask for: 192 and 512
 * for the manifest, 512 maskable for Android's adaptive icons, and 180 for the
 * iOS home screen.
 *
 * The native application's own artwork is generated here too. `npx cap add
 * android` creates a project carrying the framework's placeholder launcher icon
 * and a plain white splash screen, which is somebody else's mark in the place a
 * manager looks every morning — so the same favicon is written over them, at the
 * sizes the Android project already asks for. Those sizes are *read from the
 * files being replaced* rather than written down here, because a size written
 * down twice is a size that eventually disagrees with itself, and because the
 * densities a platform wants are that platform's business rather than this
 * tool's.
 *
 * Requires sharp, which is a development dependency and nothing more: the icons
 * are committed, and the only time this runs is when the mark itself changes.
 *
 *     npm run icons
 */
import { readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const iconDir = `${publicDir}icons/`;
const FAVICON = `${publicDir}favicon.svg`;
/** The generated Android project, whose artwork belongs to the game as well. */
const androidRes = fileURLToPath(new URL('../android/app/src/main/res/', import.meta.url));
/** The artwork a store listing asks for, which is not part of any build. */
const storeDir = fileURLToPath(new URL('../store/', import.meta.url));
/** The near-black the game is drawn on: the manifest's theme colour. */
const BACKDROP = { r: 0x08, g: 0x09, b: 0x0b };

interface IconJob {
  /** File name, written where `dir` says. */
  file: string;
  size: number;
  /** The favicon as drawn, or the favicon prepared for a masking platform. */
  variant: 'plain' | 'masked';
  /** Where the file is written, relative to public/. */
  dir?: string;
  note: string;
}

const JOBS: IconJob[] = [
  { file: 'icon-192.png', size: 192, variant: 'plain', note: 'manifest, 1x' },
  { file: 'icon-512.png', size: 512, variant: 'plain', note: 'manifest, 2x and any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'masked', note: 'Android adaptive icon' },
  // iOS looks for this one at the site root by name, and the service worker's
  // shell lists it there too.
  { file: 'apple-touch-icon.png', size: 180, variant: 'masked', dir: '', note: 'iOS home screen' },
];

/**
 * The favicon with its corners squared off.
 *
 * Derived by editing the favicon's own markup rather than by keeping a second
 * copy of the design, because two copies of a mark is how they stop matching.
 */
function bleed(favicon: string): string {
  return favicon.replace(/rx="[^"]*"/, 'rx="0"');
}

/**
 * The wordmark drawn smaller, so it sits inside the maskable safe zone.
 *
 * A maskable icon may be cropped to a circle 80% of its width across, so the
 * mark itself is allowed to reach the edges but the text is not.
 */
function markInSafeZone(favicon: string): string {
  return favicon.replace(
    /(<text[\s\S]*?<\/text>)/,
    '<g transform="translate(16 16) scale(0.78) translate(-16 -16)">$1</g>',
  );
}

async function main(): Promise<void> {
  const favicon = readFileSync(FAVICON, 'utf8');
  mkdirSync(iconDir, { recursive: true });

  for (const job of JOBS) {
    const source =
      job.variant === 'masked' ? markInSafeZone(bleed(favicon)) : favicon;
    const path = `${publicDir}${job.dir ?? 'icons/'}${job.file}`;
    // A high density so librsvg rasterises the text at the target size rather
    // than at 32px and then scaling it up into a blur.
    await sharp(Buffer.from(source), { density: 384 })
      .resize(job.size, job.size)
      .png({ compressionLevel: 9 })
      .toFile(path);
    console.log(`  ${path.replace(publicDir, 'public/').padEnd(38)} ${job.size}x${job.size}  ${job.note}`);
  }

  // A little report, so a blank icon is caught here rather than on a home
  // screen: the mark is a dark word on a green field, so a sane icon has both
  // a lot of green and a meaningful amount of dark.
  const { data, info } = await sharp(`${iconDir}icon-512.png`)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i]! < 70 && data[i + 1]! < 70 && data[i + 2]! < 70) dark += 1;
  }
  const share = (dark / (data.length / info.channels)) * 100;
  console.log(`\n  icon-512.png: ${share.toFixed(1)}% dark pixels`);
  if (share < 4 || share > 30) {
    throw new Error(
      `icon-512.png looks wrong: ${share.toFixed(1)}% dark pixels, expected the "SE27" wordmark. ` +
        'The text has probably failed to render — check that a sans-serif font is available to librsvg.',
    );
  }

  await nativeArtwork(favicon);
  await storeArtwork(favicon);
}

/**
 * The three pictures a store listing asks for, which are uploaded by hand and
 * are therefore part of no build.
 *
 *   - Play's listing icon, 512×512. Every application needs one, and it is the
 *     only icon Play shows: the launcher icons inside the bundle are Android's
 *     business. It is flattened onto the game's near-black so that it is opaque,
 *     because a store's icon is a picture rather than a surface with holes in it.
 *   - The App Store icon, 1024×1024. Apple rejects an icon with an alpha channel
 *     outright, so this is flattened for the same reason and one more.
 *   - Play's feature graphic, 1024×500, which is shown at the top of a listing
 *     and is the one piece of store artwork a game is *seen* through before its
 *     screenshots. It is the splash screen's own composition — the mark on the
 *     near-black, nothing else — because a listing should look like the game
 *     opening rather than like a poster for it.
 *
 * Both store icons are the *masked* variant: full square, with the wordmark
 * inside the safe zone a platform may crop to. Play masks its icon to its own
 * shape and Apple to a squircle, so an icon that had drawn its own rounded
 * corners would be showing two roundings at once.
 *
 * The screenshots Play and Apple also require are deliberately not here: they
 * have to be a real device showing a real career, and a generated picture of a
 * game is not evidence of one. `store/README.md` says what to capture.
 */
async function storeArtwork(favicon: string): Promise<void> {
  mkdirSync(storeDir, { recursive: true });
  const masked = markInSafeZone(bleed(favicon));

  /*
   * `alpha` is per file because the two stores want opposite things and both of
   * them say so in their requirements: Play's listing icon is "32-bit PNG (with
   * alpha)", while Play's feature graphic is "JPEG or 24-bit PNG (no alpha)" and
   * Apple rejects any image with an alpha channel outright. The pixels are
   * opaque either way — the channel is what differs, and it is the channel that
   * is checked.
   */
  const jobs: Array<{ file: string; width: number; height: number; alpha: boolean; note: string }> = [
    { file: 'play-icon-512.png', width: 512, height: 512, alpha: true, note: 'Play listing icon: 32-bit PNG with alpha' },
    { file: 'apple-icon-1024.png', width: 1024, height: 1024, alpha: false, note: 'App Store icon: no alpha' },
    { file: 'feature-graphic-1024x500.png', width: 1024, height: 500, alpha: false, note: 'Play feature graphic: 24-bit PNG, no alpha' },
  ];

  console.log('\n  the store listings:');
  for (const job of jobs) {
    const square = job.width === job.height;
    const inner = square ? job.width : Math.round(job.height * 0.42);
    const mark = await sharp(Buffer.from(square ? masked : favicon), { density: 384 })
      .resize(inner, inner)
      .png()
      .toBuffer();
    // The composite is what decides the output's channels, not the canvas: an
    // overlay with alpha produces a PNG with alpha however the base was created,
    // and "no alpha" is a requirement in two of the three cases here. `flatten`
    // fills the transparency in; `removeAlpha` takes the channel away, which is
    // the part a checker looks at.
    const pipeline = sharp({
      create: { width: job.width, height: job.height, channels: 3, background: BACKDROP },
    })
      .composite([
        {
          input: mark,
          left: Math.round((job.width - inner) / 2),
          top: Math.round((job.height - inner) / 2),
        },
      ])
      .flatten({ background: BACKDROP });
    const png = job.alpha
      ? // Back to four channels: an opaque alpha, because the icon is a picture
        // of a square rather than a square with holes in it, but present.
        pipeline.ensureAlpha()
      : pipeline.removeAlpha();
    await png.png({ compressionLevel: 9 }).toFile(`${storeDir}${job.file}`);
    console.log(`  store/${job.file.padEnd(34)} ${job.width}x${job.height}  ${job.note}`);
  }
}

/**
 * The Android application's launcher icons and splash screens.
 *
 * Three files per density, and the densities are discovered rather than listed:
 *
 *   - `ic_launcher.png` — the mark as drawn, for a launcher that shows it as it
 *     is (Android 7 and older, and anywhere the adaptive icon is not used);
 *   - `ic_launcher_round.png` — the same mark bled to the full square, because a
 *     launcher that crops it to a circle would otherwise cut the corners off an
 *     icon that had drawn them itself;
 *   - `ic_launcher_foreground.png` — the mark inside the safe zone of the
 *     adaptive icon's 108dp canvas, which is what Android crops and animates.
 *
 * The splash screens are the mark on the game's own near-black, at whatever size
 * each density already uses: the white ones the template ships are a screenful of
 * light in a game that is dark everywhere else, shown at the exact moment the
 * manager is waiting for it.
 */
async function nativeArtwork(favicon: string): Promise<void> {
  if (!existsSync(androidRes) || readdirSync(androidRes).every((entry) => !entry.startsWith('mipmap-'))) {
    console.log('\n  android/: no native project here, so nothing to redraw (run `npx cap add android` first)');
    return;
  }

  const densities = readdirSync(androidRes).filter((entry) => entry.startsWith('mipmap-'));
  console.log('\n  the Android application:');
  for (const density of densities.sort()) {
    const dir = `${androidRes}${density}/`;
    const jobs: Array<{ file: string; variant: 'plain' | 'masked'; scale: number; note: string }> = [
      { file: 'ic_launcher.png', variant: 'plain', scale: 1, note: 'as drawn' },
      { file: 'ic_launcher_round.png', variant: 'masked', scale: 1, note: 'cropped to a circle' },
      // 66dp of the adaptive icon's 108dp canvas is the safe zone, and everything
      // outside it is the launcher's to crop: the mark is drawn inside it.
      { file: 'ic_launcher_foreground.png', variant: 'masked', scale: 0.611, note: 'adaptive foreground' },
    ];
    for (const job of jobs) {
      const path = `${dir}${job.file}`;
      if (!existsSync(path)) continue;
      const { width = 0 } = await sharp(path).metadata();
      if (width === 0) continue;
      const source = job.variant === 'masked' ? markInSafeZone(bleed(favicon)) : favicon;
      const inner = Math.round(width * job.scale);
      const mark = await sharp(Buffer.from(source), { density: 384 }).resize(inner, inner).png().toBuffer();
      const offset = Math.round((width - inner) / 2);
      await sharp({ create: { width, height: width, channels: 4, background: { ...BACKDROP, alpha: 0 } } })
        .composite([{ input: mark, left: offset, top: offset }])
        .png({ compressionLevel: 9 })
        .toFile(path);
      console.log(`  ${density}/${job.file.padEnd(30)} ${width}x${width}  ${job.note}`);
    }
  }

  const splashes = [
    `${androidRes}drawable/splash.png`,
    ...readdirSync(androidRes)
      .filter((entry) => entry.startsWith('drawable-'))
      .map((entry) => `${androidRes}${entry}/splash.png`),
  ];
  console.log('\n  the Android splash screens:');
  for (const path of splashes) {
    if (!existsSync(path)) continue;
    const { width = 0, height = 0 } = await sharp(path).metadata();
    if (width === 0 || height === 0) continue;
    // The mark at a little over a quarter of the shorter edge: the size a phone
    // shows a launcher icon at, which is what a splash screen is imitating.
    const inner = Math.round(Math.min(width, height) * 0.28);
    const mark = await sharp(Buffer.from(favicon), { density: 384 }).resize(inner, inner).png().toBuffer();
    await sharp({ create: { width, height, channels: 3, background: BACKDROP } })
      .composite([
        { input: mark, left: Math.round((width - inner) / 2), top: Math.round((height - inner) / 2) },
      ])
      .png({ compressionLevel: 9 })
      .toFile(path);
    console.log(`  ${path.replace(androidRes, 'android/app/src/main/res/').padEnd(52)} ${width}x${height}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
