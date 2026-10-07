import { useState } from 'react';

/**
 * The Touchline mark.
 *
 * Touchline is the football simulation underneath SE27 — the match engine, the
 * laws it plays by and the record the rest of the game reads — and this is the
 * one place its mark is drawn. Everywhere the technology is named uses this
 * component: the first-boot sequence, the credits, and an about or technical
 * section if one is ever added.
 *
 * ---------------------------------------------------------------------------
 * Where the mark comes from
 * ---------------------------------------------------------------------------
 *
 * The artwork is `public/touchline-mark.svg`: the touchline arriving at its
 * corner, drawn once and shown everywhere. The proportions and the reasoning
 * behind the shape live in that file.
 *
 * It is an asset rather than an inline component because it is a *drawing* and
 * not a piece of interface — no state, no colour to inherit, no props — and
 * because the file a designer opens is then the file that ships. It resolves
 * the way every other asset the game has resolves: `public/` is served at the
 * root and the build precaches it verbatim (see the precache plugin in
 * `vite.config.ts`), which is the route `favicon.svg` and the ground photograph
 * take. Masters that exist only to be converted live in `assets/` beside it;
 * this one is hand-drawn, so it has no master to derive from.
 *
 * The placeholder below stands in for a build that has no artwork at all, and
 * it is deliberately *marked* as a placeholder rather than dressed up as a
 * logo: a substitute that looked like a mark would be a mark nobody chose, and
 * it would have to be found and deleted rather than simply replaced. `onError`
 * rather than a build-time switch, because a flag would have to be flipped by
 * hand and would be forgotten, and a missing image that falls back is
 * self-healing. The cost is one request that comes back 404 on a build with no
 * artwork, which is the truth about that build.
 */

/** The vector artwork, served from `public/` at the root of the site. */
export const TOUCHLINE_MARK_SRC = '/touchline-mark.svg';

/** For the placeholder's own title, where there is no artwork to show. */
const SLOT_HINT = `Touchline mark — no artwork at ${TOUCHLINE_MARK_SRC}`;

function outer(className?: string): string {
  return className ? `touchline__mark ${className}` : 'touchline__mark';
}

/**
 * The mark itself, or the marked gap where it will be.
 *
 * The placeholder is a dashed frame with the word *pending* in it, which is
 * intended to be read as a placeholder by anybody who sees it. It is not styled
 * to look like a logo, and there is deliberately nothing here that could be
 * mistaken for one.
 */
export function TouchlineMark({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  if (pending) {
    return (
      <span className={outer(className)} title={SLOT_HINT} aria-hidden="true">
        <span className="touchline__mark-label">Touchline mark</span>
        <span className="touchline__mark-note">artwork pending</span>
      </span>
    );
  }

  return (
    <img
      className={className ? `touchline__art ${className}` : 'touchline__art'}
      src={TOUCHLINE_MARK_SRC}
      // The lockup around it carries the name, so the image itself says nothing
      // a screen reader needs to hear twice.
      alt=""
      aria-hidden="true"
      onError={() => setPending(true)}
    />
  );
}

/**
 * The mark with its name, and the line that says what Touchline is.
 *
 * The name is set in type rather than left to the artwork, which is the same
 * decision the game's own lockup makes: SE27 is a wordmark rather than a crest
 * because the world is full of generated crests and the game's mark has to be
 * obviously not one of them. So Touchline's name is text, and the asset slot
 * beside it is the picture.
 *
 * `detail` is the one line under the name, and it is different in the two places
 * this is used: on the first boot Touchline is introduced as a *match simulation
 * engine*, and in the credits it is described by what it is. Neither is invented
 * here; both are handed in.
 */
export function TouchlineLockup({ detail, className }: { detail?: string; className?: string }) {
  return (
    <div className={className ? `touchline ${className}` : 'touchline'}>
      <TouchlineMark />
      <span className="touchline__name">Touchline</span>
      {detail && <span className="touchline__detail">{detail}</span>}
    </div>
  );
}
