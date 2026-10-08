import type { PositionCode } from '@/domain/positions';
import type { RenderTeamColours } from '@/presentation/renderContract';

/**
 * The shirt a man is drawn in, from the colours his side turned out in.
 *
 * Twenty-one of the twenty-two are in the strip their side is wearing and the
 * keeper is in the third strip, because the laws ask him to be told from the ten
 * in front of him and from the keeper at the other end. That is one rule about a
 * football match, so it is written once and every drawing asks it: the pitch asks
 * it through `shirtOf` for a dot, and the two team sheets — the written version of
 * the same eleven — ask it for a row.
 *
 * It is deliberately not a component: it takes the colours and a job and answers
 * with a shirt, so the picture and the list beside it cannot come to disagree
 * about which of the eleven is the man in goal.
 */
export function shirtFor(colours: RenderTeamColours, position: PositionCode): string {
  return isKeeper(position) ? colours.keeper : colours.primary;
}

/**
 * Whether a job is the one that wears the third strip.
 *
 * Split out because a drawing needs to say *that* he is the keeper as well as
 * which shirt he is in — the pitch marks his dot and the sheet marks his row —
 * and a second `position === 'GK'` written at either of those places would be a
 * second answer to the question this file exists to answer once.
 */
export function isKeeper(position: PositionCode): boolean {
  return position === 'GK';
}
