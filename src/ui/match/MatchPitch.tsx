import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import type { Player } from '@/domain/person';
import { playerName } from '../format';
import { inkForColour } from '../colour';
import type { MatchRendererProps } from '@/presentation/renderContract';
import {
  facingRadians,
  interpolatedX,
  interpolatedY,
  involvementOf,
  isMoving,
} from '@/presentation/matchPresentation';

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
 * sixty renders a second, so positions are written straight to the DOM.
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
  /** The strip this side is wearing, so both teams are drawn in their own colour. */
  colour: string;
}

export function MatchPitch({ state, side, playerById }: MatchRendererProps) {
  const dotRefs = useRef(new Map<string, HTMLSpanElement>());
  const ballRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
        colour: state.teams[node.side].colours.primary,
      })),
    [state, state.revision, side, playerById],
  );

  // The render loop: read the authoritative state, draw it, do nothing else.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const alpha = state.alpha();
      const involvement = involvementOf(state);

      for (const node of state.players) {
        const element = dotRefs.current.get(node.playerId);
        if (!element) continue;
        element.style.left = `${interpolatedX(node, alpha) * 100}%`;
        element.style.top = `${interpolatedY(node, alpha) * 100}%`;

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
          element.style.setProperty('--facing', `${facingRadians(vx, vy)}rad`);
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
        ball.style.left = `${interpolatedX(state.ball, alpha) * 100}%`;
        ball.style.top = `${interpolatedY(state.ball, alpha) * 100}%`;
        ball.dataset.status = state.ball.status;
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  const ball = { x: state.ball.x, y: state.ball.y };

  return (
    <div ref={rootRef} className="pitch pitch--live matchpitch" data-renderer="2d" data-celebrating="false" data-possession="none">
      <span className="pitch__halfway" />
      <span className="pitch__circle" />
      <span className="pitch__box pitch__box--left" />
      <span className="pitch__box pitch__box--right" />
      {/* Which way the manager's side is attacking, in the fixed frame the match
          uses: the home side always attacks toward x = 1. */}
      <span className="pitch__attack" data-dir={side === 'home' ? 'right' : 'left'} aria-hidden="true" />
      {nodes.map((node) => (
        <span
          key={node.key}
          ref={(element) => {
            if (element) dotRefs.current.set(node.key, element);
            else dotRefs.current.delete(node.key);
          }}
          className={`pitch__dot${node.mine ? ' pitch__dot--mine' : ''}${node.action === 'carrying' ? ' pitch__dot--carrying' : ''}${node.position === 'GK' ? ' pitch__dot--keeper pitch__dot--named' : ''}`}
          style={
            {
              left: `${node.x * 100}%`,
              top: `${node.y * 100}%`,
              '--dot-club': node.colour,
              '--dot-ink': inkForColour(node.colour),
            } as CSSProperties
          }
          title={node.player ? `${playerName(node.player)} — ${POSITIONS[node.position].label}` : node.position}
        >
          <span className="pitch__dot-ball">{node.position}</span>
          <span className="pitch__dot-face" aria-hidden="true" />
          <span className="pitch__dot-name">{node.player?.surname ?? ''}</span>
        </span>
      ))}
      <span ref={ballRef} className="pitch__ball" style={{ left: `${ball.x * 100}%`, top: `${ball.y * 100}%` }} />
    </div>
  );
}
