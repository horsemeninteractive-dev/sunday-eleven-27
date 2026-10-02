/**
 * The ground, made small enough to ship.
 *
 * The pitch behind the pre-game screens is a photograph: mown grass, white
 * lines, a goal at the far end. Photographs do not survive PNG. Stored
 * losslessly at 1200x800 it was 2.1 MB — a third of the entire game's download,
 * for one decorative backdrop that most players will see for a few seconds and
 * then never look at again. It was also, once a service worker existed, very
 * nearly the whole offline footprint: everything else in the game is a few
 * hundred kilobytes of code.
 *
 * WebP at quality 85 takes it to roughly 315 KB, an 85% cut, and stays above
 * 37 dB PSNR against the original — well inside the range where a photograph is
 * indistinguishable from itself. The stylesheet already asks for `:has()` and
 * `100dvh`, so the browsers that can run this game are far newer than the ones
 * that can read WebP, and there is no fallback worth carrying.
 *
 * The original photograph lives in `assets/`, outside `public/`, precisely so
 * that Vite does not copy it into the build: it is the source, not something
 * shipped. What ships is `public/scene-ground.webp`, written here.
 *
 *   npm run scene
 *
 * It is a developer tool. Nothing in the game imports it, and it is typechecked
 * with everything else so it cannot rot.
 */
import { statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
// The source is deliberately *not* in public/: anything there is copied into the
// build verbatim, and a 2.1 MB master sitting in the build would undo the point.
const SOURCE = `${repoRoot}assets/scene-ground.png`;
const OUTPUT = `${repoRoot}public/scene-ground.webp`;

/**
 * Chosen by measurement rather than by taste. This is the quality at which the
 * photograph stops being visually lossless and becomes merely very faithful,
 * which for a dimmed backdrop under a fixed gradient is the point at which
 * further compression stops buying anything worth having.
 */
const QUALITY = 85;

/**
 * Below this the photograph is measurably degraded. Above ~40 dB it is
 * indistinguishable from the original; a backdrop under a gradient and a
 * vignette does not need that, and 2.1 MB is not a price worth paying.
 */
const MIN_PSNR = 36;

async function main(): Promise<void> {
  const sourceBytes = statSync(SOURCE).size;

  const original = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const encoded = await sharp(SOURCE).webp({ quality: QUALITY, effort: 6 }).toBuffer();
  const decoded = await sharp(encoded).removeAlpha().raw().toBuffer();

  // A decode that is not the same shape as the original would make the PSNR
  // below meaningless, so that is checked rather than assumed.
  if (decoded.length !== original.data.length) {
    throw new Error(
      `scene-ground.webp decoded to ${decoded.length} bytes, expected ${original.data.length}.`,
    );
  }

  let squared = 0;
  for (let i = 0; i < original.data.length; i += 1) {
    const delta = original.data[i]! - decoded[i]!;
    squared += delta * delta;
  }
  const rmse = Math.sqrt(squared / original.data.length);
  const psnr = 20 * Math.log10(255 / rmse);

  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;
  console.log(`  assets/scene-ground.png    ${kb(sourceBytes).padStart(7)}  source`);
  console.log(`  scene-ground.webp          ${kb(encoded.length).padStart(7)}  q=${QUALITY}, ${psnr.toFixed(1)} dB PSNR`);
  console.log(`                            ${`${((1 - encoded.length / sourceBytes) * 100).toFixed(1)}% smaller`.padStart(7)}`);

  if (psnr < MIN_PSNR) {
    throw new Error(
      `scene-ground.webp is only ${psnr.toFixed(1)} dB, below the ${MIN_PSNR} dB floor. ` +
        'Raise QUALITY rather than shipping a visibly degraded pitch.',
    );
  }

  // The bytes that were measured are written as they are. Handing the buffer
  // back to sharp to save would decode and re-encode it at sharp's *default*
  // quality, which is not the quality that was just verified — the file on disk
  // would not be the file the report described.
  writeFileSync(OUTPUT, encoded);
  console.log('\n  Wrote public/scene-ground.webp.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});