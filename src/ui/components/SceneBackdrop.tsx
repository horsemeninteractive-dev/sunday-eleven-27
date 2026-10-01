import { SCENE_INK, sceneFade, stripeTiles } from '../colour';
import { StripeField } from './StripeField';

/**
 * The ground behind every screen before a career starts.
 *
 * A photograph of a Sunday league pitch — treeline at the far end, mown grass,
 * a goal over on the left — washed into the game's greens, with the club's own
 * stripe laid over it in the mark's green: the same bands, at the same size, as
 * the command bar wears in the club's colours once a career begins, so the game
 * looks like itself before the manager has a club to wear.
 *
 * The bands are almost opaque at the left edge and gone by the right, so the
 * screen reads as a pitch the game's colours have been laid over. That fade,
 * and the drift, belong to the shared `StripeField`.
 *
 * Every pre-game screen wears this, from the menu to the club designer, because
 * they are one flow: who the manager is, which club he takes, or the club he
 * builds. It is decoration and marked as such — there is nothing here to read.
 */
const BANDS = stripeTiles(SCENE_INK);
const FADE = sceneFade();

export function SceneBackdrop() {
  return (
    <div className="scene" aria-hidden="true">
      <StripeField className="scene__field" pattern={BANDS} fade={FADE} />
    </div>
  );
}
