import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import type { Side } from '@/domain/matchState';
import type { Player } from '@/domain/person';
import { playerName } from '../format';
import { flatClubInk } from '../colour';
import type { MatchRendererProps, MatchRenderState } from '@/presentation/renderContract';
import { interpolatedX, interpolatedY, involvementOf, isMoving } from '@/presentation/matchPresentation';
import { attackDirection, facingIn, frameForBox, pitchPoint, type PitchFrame } from './pitchFrame';
import { shirtFor } from './shirt';

/**
 * The 2D match renderer.
 *
 * A leaf, and deliberately dumb: it draws where the simulation says everybody is
 * and nothing else. It does not decide where a player should stand, where the
 * ball should go, or who is involved — it reads the render state it is handed
 * (`MatchRenderState`, from the shared presentation layer) and places what it
 * finds. What this file owns is only the last inch: reading the state once a
 * frame and moving the sprites, interpolating between the step a player was at
 * and the step he is at with the shared `alpha`, so the football appears
 * continuous rather than a slideshow.
 *
 * It is one implementation of the renderer contract; a 3D renderer would be
 * another, handed the same state and drawing it a different way. Nothing here is
 * football, so nothing here would need to exist twice.
 *
 * All the state it draws — where a player is and which way he moves (`vx/vy`),
 * who is on the ball (`ball.ownerId`), the man a pass is going to
 * (`ball.targetId`), what is being played out (`actions`), and the one moment
 * the picture is allowed to shout (`celebration`) — is the simulation's own. A
 * player is only named when he is part of the move, so twenty-two surnames do
 * not fight each other and the attack reads at a glance.
 *
 * Nothing is React state: a match at sixty frames a second would otherwise be
 * sixty renders a second, so positions are written straight to the DOM. The one
 * thing here that *is* state is which way round the pitch is drawn, because it
 * changes when a phone is turned rather than sixty times a second — see
 * `pitchFrame`, where the rules of the turn live.
 */

interface NodeShape {
  key: string;
  side: 'home' | 'away';
  position: PositionCode;
  player: Player | undefined;
  x: number;
  y: number;
  action: string;
  mine: boolean;
  /**
   * The shirt this man is drawn in: his own side's strip, or the third strip for
   * the keeper. See {@link shirtOf}.
   */
  colour: string;
}

/**
 * The shirt a man on the pitch is drawn in.
 *
 * The rule itself is `shirtFor` in `shirt.ts`, because the two team sheets beside
 * the pitch — the written version of the same eleven — ask it too, and one rule
 * about a football match should not be written out twice. A keeper in a white away
 * shirt is not drawn in white, on the grass or in the list.
 */
export function shirtOf(
  state: MatchRenderState,
  node: { side: Side; position: PositionCode },
): string {
  return shirtFor(state.teams[node.side].colours, node.position);
}

export function MatchPitch({ state, side, playerById }: MatchRendererProps) {
  const dotRefs = useRef(new Map<string, HTMLSpanElement>());
  const ballRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /*
   * Which way round the pitch is drawn: across the box, or up it.
   *
   * Measured off the box the renderer was actually given, because that box is
   * whatever the score, the commentary and the control strip have left over — on
   * a phone held upright it comes out taller than it is wide, and a landscape
   * pitch drawn in it is a pitch nobody can play on.
   *
   * A layout effect rather than an ordinary one, so the measurement is taken
   * before the browser paints: a pitch that flipped the right way round after
   * the manager had already seen it would lurch on every visit to the match.
   * The observer then keeps it honest for the rest of the afternoon, since a
   * handset can be turned and a window can be dragged.
   */
  const [frame, setFrame] = useState<PitchFrame>('landscape');
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setFrame(frameForBox(root.getBoundingClientRect()));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      // No observer: the window is the only thing that can change the box.
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The roster, built once per rendered revision: identity and a first position.
  // The per-frame movement is written to the DOM below, never through React.
  const nodes: NodeShape[] = useMemo(
    () =>
      state.players.map((node) => ({
        key: node.playerId,
        side: node.side,
        position: node.position,
        player: playerById(node.playerId),
        x: node.x,
        y: node.y,
        action: node.action,
        mine: node.side === side,
        colour: shirtOf(state, node),
      })),
    [state, state.revision, side, playerById],
  );

  // The render loop: read the authoritative state, draw it, do nothing else.
  useEffect(() => {
    let tick = 0;
    const draw = () => {
      const alpha = state.alpha();
      const involvement = involvementOf(state);

      for (const node of state.players) {
        const element = dotRefs.current.get(node.playerId);
        if (!element) continue;
        // Where he is, drawn the way round this box is: the frame is a turn of
        // the whole picture, never a stretch of it.
        const at = pitchPoint(interpolatedX(node, alpha), interpolatedY(node, alpha), frame);
        element.style.left = `${at.left * 100}%`;
        element.style.top = `${at.top * 100}%`;

        // Which way he is actually going, from the velocity the simulation owns.
        const vx = node.vx ?? 0;
        const vy = node.vy ?? 0;
        const moving = isMoving(vx, vy);
        // The notch is only pointed while there is a direction to point it in. A
        // player standing still has a velocity of numerical dust rather than of
        // zero, and `atan2` of dust swings right round the compass between one
        // frame and the next. Writing that every frame means the notch is aimed
        // somewhere new each time it fades back in, so a man standing on the
        // spot twitches his way through a whole stop and restart — which is
        // exactly the jitter this is meant to show and never should.
        //
        // So while he is at rest the last real direction is kept, and the notch
        // fades in pointing at where he was actually going rather than at noise.
        if (moving) {
          element.style.setProperty('--facing', `${facingIn(frame, vx, vy)}rad`);
        }
        element.classList.toggle('pitch__dot--moving', moving);

        // What he is involved in, so the picture can pick him out without a
        // label on every man on the pitch.
        element.classList.toggle('pitch__dot--carrying', involvement.carrying.has(node.playerId));
        element.classList.toggle('pitch__dot--receiving', involvement.receiving.has(node.playerId));
        element.classList.toggle('pitch__dot--involved', involvement.involved.has(node.playerId));
        element.classList.toggle('pitch__dot--named', involvement.involved.has(node.playerId));
        element.classList.toggle('pitch__dot--celebrating', involvement.celebrating.has(node.playerId));
        element.classList.toggle(
          'pitch__dot--scorer',
          involvement.scorerId === node.playerId && involvement.celebrating.has(node.playerId),
        );
        element.classList.toggle('pitch__dot--pressing', involvement.pressing.has(node.playerId));
      }

      if (rootRef.current) {
        rootRef.current.dataset.celebrating = state.celebration ? 'true' : 'false';
        rootRef.current.dataset.possession = involvement.possessing ?? 'none';
      }
      const ball = ballRef.current;
      if (ball) {
        const at = pitchPoint(interpolatedX(state.ball, alpha), interpolatedY(state.ball, alpha), frame);
        ball.style.left = `${at.left * 100}%`;
        ball.style.top = `${at.top * 100}%`;
        ball.dataset.status = state.ball.status;
      }
      tick = window.requestAnimationFrame(draw);
    };
    tick = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(tick);
  }, [state, frame]);

  const ball = pitchPoint(state.ball.x, state.ball.y, frame);

  return (
    <div
      ref={rootRef}
      className="pitch pitch--live matchpitch"
      data-renderer="2d"
      data-celebrating="false"
      data-possession="none"
      data-shape={frame}
    >
      <span className="pitch__halfway" />
      <span className="pitch__circle" />
      <span className="pitch__box pitch__box--left" />
      <span className="pitch__box pitch__box--right" />
      {/* Which way the manager's side is attacking, in the fixed frame the match
          uses: the home side always attacks toward x = 1 — the right of a
          landscape pitch, the top of a portrait one. */}
      <span className="pitch__attack" data-dir={attackDirection(frame, side)} aria-hidden="true" />
      {nodes.map((node) => {
        const at = pitchPoint(node.x, node.y, frame);
        return (
          <span
            key={node.key}
            ref={(element) => {
              if (element) dotRefs.current.set(node.key, element);
              else dotRefs.current.delete(node.key);
            }}
            className={`pitch__dot${node.mine ? ' pitch__dot--mine' : ''}${node.action === 'carrying' ? ' pitch__dot--carrying' : ''}${node.position === 'GK' ? ' pitch__dot--keeper pitch__dot--named' : ''}`}
            style={
              {
                left: `${at.left * 100}%`,
                top: `${at.top * 100}%`,
                // A dot is flat paint in whatever colour the strip is, so its
                // ink is chosen for that colour with the floor small text needs:
                // a keeper's shirt is often a mid pink or orange, where an ink
                // picked by brightness alone lands close to 3:1.
                '--dot-club': node.colour,
                '--dot-ink': flatClubInk(node.colour),
              } as CSSProperties
            }
            title={node.player ? `${playerName(node.player)} — ${POSITIONS[node.position].label}` : node.position}
          >
            <span className="pitch__dot-ball">{node.position}</span>
            <span className="pitch__dot-face" aria-hidden="true" />
            <span className="pitch__dot-name">{node.player?.surname ?? ''}</span>
          </span>
        );
      })}
      <span ref={ballRef} className="pitch__ball" style={{ left: `${ball.left * 100}%`, top: `${ball.top * 100}%` }} />
    </div>
  );
}
