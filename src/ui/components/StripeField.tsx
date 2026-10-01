import type { CSSProperties } from 'react';
import { STRIPE_LOOP_SECONDS, stripeTile } from '../colour';

/**
 * The drifting stripe, wherever the game wears one.
 *
 * Two things share it: the ground behind the screens before a career starts,
 * and the command bar of a club in its own colours. They are the same stripe at
 * the same size on the same angle, moving the same way, so they are the same
 * two elements here — a box that carries the fade and never moves, and the
 * banded layer inside it that does.
 *
 * The fade has to be on the still box rather than on the banded layer. A mask
 * travels with the element it is set on, so a fade on the layer that drifts
 * would slide across the screen and snap back once a loop — which is the exact
 * artefact the tiling exists to remove. The banded layer is also drawn one tile
 * wider than the box *and hung a tile off its left edge*, because it moves
 * right: were the spare tile on the right its left edge would walk in and open
 * a bare strip down the side of every loop.
 *
 * Everything about the pattern — its angle, its width, and how far it travels
 * in a loop — comes from `stripeTiles` and `stripeTile`, so the two users
 * cannot fall out of step with each other or with the stylesheet.
 *
 * It is decoration, and marked as such: there is nothing here to read.
 */
export function StripeField({ pattern, fade, className }: { pattern: string; fade: string; className?: string }) {
  return (
    <span
      className={className ? `stripefield ${className}` : 'stripefield'}
      aria-hidden="true"
      style={
        {
          '--stripe-pattern': pattern,
          '--stripe-fade': fade,
          '--stripe-tile': stripeTile(),
          '--stripe-loop': `${STRIPE_LOOP_SECONDS}s`,
        } as CSSProperties
      }
    >
      <span className="stripefield__bands" />
    </span>
  );
}
