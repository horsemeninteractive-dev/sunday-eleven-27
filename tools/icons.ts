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
 * Requires sharp, which is a development dependency and nothing more: the icons
 * are committed, and the only time this runs is when the mark itself changes.
 *
 *     npm run icons
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const iconDir = `${publicDir}icons/`;
const FAVICON = `${publicDir}favicon.svg`;

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
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
