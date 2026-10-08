import { facingRadians } from '@/presentation/matchPresentation';

/**
 * Which way round the pitch is drawn, and where a point of it lands.
 *
 * A football pitch is a wide thing and a telephone is a tall one. Stretched to
 * fill a portrait box a landscape pitch is not a pitch: the halfway line runs up
 * the screen, both goals are on the left and right of a portrait page, and the
 * football is squeezed into a space shaped nothing like the game. So when the box
 * the renderer has been given comes out portrait, the same picture is turned a
 * quarter turn — the length of the pitch runs up the screen, the two sides attack
 * up and down, and a phone held upright shows more football than a landscape
 * pitch letterboxed into it ever could.
 *
 * It is a *rotation* of one picture rather than a second drawing, which is what
 * these functions exist to keep true. The shape of a side, the way a man is
 * running and the end his side is attacking are three readings of one turn, and
 * they have to agree with each other: a defence drawn upside down with its
 * arrow pointing the other way is worse than no turn at all. One place, three
 * functions, and no pixels anywhere: everything is a fraction of the box the
 * renderer was handed.
 *
 * Deliberately free of the renderer: the maths is the part worth testing, and
 * `MatchPitch` is the part that has to run inside a browser.
 */

export type PitchFrame = 'landscape' | 'portrait';

/**
 * Which frame a box of this shape calls for.
 *
 * Measured rather than asked of a media query, because what tells the truth is
 * the box the renderer was actually given. On a phone that box is what the
 * score, the commentary and the control strip have left over — the same handset
 * gives it a different shape depending on what else is on the screen, and an
 * installed app with no browser chrome gives it another. A square box is a
 * landscape pitch: a pitch wider than it is long does not exist, and one drawn
 * across a square box still reads as football.
 */
export function frameForBox(box: { width: number; height: number }): PitchFrame {
  return box.height > box.width ? 'portrait' : 'landscape';
}

/**
 * Where a point of the pitch is drawn, in the frame the box is in.
 *
 * The simulation's own frame is always the landscape one: `x` runs along the
 * length of the pitch from the home goal, `y` runs across it from one touchline.
 * A portrait box is that picture on its side: the length of the pitch runs up the
 * screen, the home goal sits at the foot of it, and the home side — which attacks
 * toward `x = 1` for the whole afternoon — attacks up the screen.
 *
 * It is a turn rather than a swap of the two numbers, and the difference is the
 * whole of it. Either swap is a mirror, and a mirrored pitch would show a manager
 * his own side the wrong way round — his right winger on the left, every shape he
 * built reflected. A turn keeps a touchline where it belongs, and which turn this
 * is is stated by the corners: the pitch's own left-hand touchline (`y = 0`),
 * the one a home player has on his left as he runs at the away goal, is drawn
 * down the left of a portrait screen, while the home goal goes to the foot of it.
 * The other quarter turn would have had his side attacking away from him, down
 * the screen, and no football game has ever drawn it that way.
 */
export function pitchPoint(x: number, y: number, frame: PitchFrame): { left: number; top: number } {
  return frame === 'portrait' ? { left: y, top: 1 - x } : { left: x, top: y };
}

/**
 * The angle to point a man's arrow in, in the frame he is drawn in.
 *
 * `facingRadians` reads a velocity in the simulation's frame, which is the angle
 * in a landscape box and nothing else. A portrait pitch is that picture turned a
 * quarter turn, so every direction on it turns with it: a man running at the away
 * goal — a man the landscape box draws running to the right, at an angle of zero
 * — is a man running up the screen, which is a quarter turn that way.
 */
export function facingIn(frame: PitchFrame, vx: number, vy: number): number {
  return facingRadians(vx, vy) + (frame === 'portrait' ? -Math.PI / 2 : 0);
}

/**
 * Which way the manager's side is attacking, as a direction in the box.
 *
 * The home side always attacks toward `x = 1`, which is the right-hand touchline
 * of a landscape pitch and the top of a portrait one. This is the one reading of
 * the turn that the stylesheet needs by name rather than as a coordinate, since
 * the arrow is a border on an empty box.
 */
export function attackDirection(frame: PitchFrame, side: 'home' | 'away'): 'left' | 'right' | 'up' | 'down' {
  if (frame === 'portrait') return side === 'home' ? 'up' : 'down';
  return side === 'home' ? 'right' : 'left';
}
