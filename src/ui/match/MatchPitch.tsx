import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import type { Side } from '@/domain/matchState';
import type { Player } from '@/domain/person';
import { playerName } from '../format';
import { flatClubInk } from '../colour';
import type { MatchRendererProps, MatchRenderState } from '@/presentation/renderContract';
import { interpolatedX, interpolatedY, involvementOf, isMoving } from '@/presentation/matchPresentation';
import { attackDirection, facingIn, frameForBox, pitchPoint, type PitchFrame } from './pitchFrame';
import { patchBox, pitchSurfaceLook } from './pitchSurface';
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
 * (`ball.targetId`), what is being played out (`actions`), the dead ball being
 * taken and the spot it is played from (`restart`), and the one moment the
 * picture is allowed to shout (`celebration`) — is the simulation's own. A
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
  const spotRef = useRef<HTMLSpanElement | null>(null);
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

  // What the grass is painted with, read once per surface rather than per frame:
  // the ground does not change during an afternoon, and a picture that re-read it
  // sixty times a second would be doing arithmetic to draw the same field.
  const look = useMemo(() => pitchSurfaceLook(state.surface), [state.surface]);

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
      // The dead ball being taken, read live once a frame: a throw-in begins and
      // ends *between* two events, so anything worked out once per render would
      // arrive long after the throw had been taken.
      const restart = state.restart();
      const takerId = restart?.takerId ?? null;

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
        element.classList.toggle(
          'pitch__dot--named',
          involvement.involved.has(node.playerId) || takerId === node.playerId,
        );
        element.classList.toggle('pitch__dot--taker', takerId === node.playerId);
        // A dot's name hangs under it, and the one man this picture draws off the
        // bottom of it is the thrower on the far touchline: his mark is the
        // ground beyond the line, so a name under his feet would be the part of
        // him that leaves the picture. Above his head it stays inside the strip.
        // Read from the drawn point rather than the side, so it is true in either
        // frame: only the far touchline puts a man past `top = 1`.
        element.dataset.label = takerId === node.playerId && at.top > 1 ? 'up' : 'down';
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
      // And the spot the dead ball is played from, which is the engine's own and
      // not the ball's: a throw-in leaves the ball in the thrower's hands off the
      // pitch while the throw comes back in from the spot on the line. The mark
      // is drawn only while a restart is being taken, so it appears with the
      // whistle and goes the moment the ball is live again.
      const mark = spotRef.current;
      if (mark) {
        mark.hidden = restart === null;
        if (restart) {
          const at = pitchPoint(restart.spot.x, restart.spot.y, frame);
          mark.style.left = `${at.left * 100}%`;
          mark.style.top = `${at.top * 100}%`;
          mark.dataset.kind = restart.kind;
        }
      }
      tick = window.requestAnimationFrame(draw);
    };
    tick = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(tick);
  }, [state, frame]);

  const ball = pitchPoint(state.ball.x, state.ball.y, frame);
  // The dead ball being taken, as the engine spells it: who is over it, and
  // where it is played from. A picture cannot work out which of twenty-two men
  // is over the ball from positions alone — that is a decision, not a reading —
  // and it cannot work out where the ball is played from either, because for a
  // throw-in the ball is in the thrower's hands and the spot is on the line. So
  // it draws the man the engine named, and chalks the spot the engine gave it;
  // the draw loop keeps both true for the seconds the restart lasts.
  const restart = state.restart();
  const takerId = restart?.takerId ?? null;
  const spot = restart ? pitchPoint(restart.spot.x, restart.spot.y, frame) : null;

  return (
    <div
      ref={rootRef}
      className="pitch pitch--live matchpitch"
      data-renderer="2d"
      data-celebrating="false"
      data-possession="none"
      data-shape={frame}
      /* What the grass is like this afternoon, for the stylesheet to paint the
         surface with — the ground's own reading of itself, handed over by the
         render contract rather than guessed at from the football. */
      data-surface={look.tone}
      style={{ '--mow-ink': look.mowInk } as CSSProperties}
    >
      {/* The playing surface: the grass, the lines painted on it, and everybody
          standing on it.

          The surface is inset inside the box rather than filling it, because the
          box the renderer is handed is a *picture* rather than a pitch — and
          what is left over is the ground a goal stands on, and the ground a
          throw-in is taken from. The men and the ball are placed in this
          element's own coordinates, so a point outside the pitch is drawn on
          that ground rather than clipped at the line: the surface clips nothing,
          which is the whole reason a net can be drawn behind a goal at all, and
          a thrower off the touchline at all. How much ground there is belongs to
          the picture's own shape, and is set with the grass, in `pitch--live`. */}
      <div className="pitch__surface">
        {/* What the winter has done to the grass, painted on it before anything
            else: the goalmouths cut up by the football, the centre spot, the
            touchline the benches stand behind. They arrive in the order football
            wears a pitch, so the first one is always in a six-yard box — and they
            turn with the picture, because a goalmouth is at the left of a
            landscape pitch and at the foot of a portrait one.

            Under the markings, deliberately. A mud patch is a state of the
            grass, not a thing standing on the pitch: the paint, the men and the
            ball all belong on top of it. */}
        {look.patches.map((patch, index) => {
          const box = patchBox(patch, frame);
          return (
            <span
              key={`${patch.mark}-${index}`}
              className={`pitch__patch pitch__patch--${patch.mark}`}
              aria-hidden="true"
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          );
        })}
        <span className="pitch__halfway" />
        <span className="pitch__circle" />
        <span className="pitch__box pitch__box--left" />
        <span className="pitch__box pitch__box--right" />
        {/* The two goals: the home goal at x = 0 and the away goal at x = 1, for
            the whole afternoon. Their mouths are on the goal lines and their nets
            hang off the surface, in the ground the surface does not cover. */}
        <span className="pitch__goal pitch__goal--left" aria-hidden="true" />
        <span className="pitch__goal pitch__goal--right" aria-hidden="true" />
        {/* The four corner flags, standing in the ground at the corners.

            They are the one piece of a football ground that stands off the pitch
            at all four of its corners — the flag a corner is taken from, planted
            just outside the lines. They are named by the corner of the *picture*
            they stand at rather than by the corner of the pitch, because those
            four points are the four corners of the pitch whichever way round the
            picture is drawn: the surface is inset by the same two margins in
            both, so only the pairing changes. */}
        <span className="pitch__flag pitch__flag--tl" aria-hidden="true" />
        <span className="pitch__flag pitch__flag--tr" aria-hidden="true" />
        <span className="pitch__flag pitch__flag--bl" aria-hidden="true" />
        <span className="pitch__flag pitch__flag--br" aria-hidden="true" />
        {/* The spot a dead ball is played from: chalked on the grass, at the
            engine's own spot, and drawn for any restart being taken. It is not
            the ball's shadow — for a throw-in those are two different places —
            and it is the whole reason the mark moved off the ball when the
            thrower started standing off the pitch with the ball in his hands.
            It is drawn over the markings rather than under them, because the
            mark is the one thing on the grass the picture is being told about. */}
        <span
          ref={spotRef}
          className="pitch__spot"
          data-kind={restart?.kind}
          hidden={restart === null}
          style={spot ? { left: `${spot.left * 100}%`, top: `${spot.top * 100}%` } : undefined}
        />
        {nodes.map((node) => {
          const at = pitchPoint(node.x, node.y, frame);
          return (
            <span
              key={node.key}
              ref={(element) => {
                if (element) dotRefs.current.set(node.key, element);
                else dotRefs.current.delete(node.key);
              }}
              className={[
                'pitch__dot',
                node.mine && 'pitch__dot--mine',
                node.action === 'carrying' && 'pitch__dot--carrying',
                node.position === 'GK' && 'pitch__dot--keeper',
                // Named when he is part of the move, and always when he is the
                // man over a dead ball: a throw-in nobody can put a name to is
                // only a ball on a line.
                (node.position === 'GK' || takerId === node.key) && 'pitch__dot--named',
                takerId === node.key && 'pitch__dot--taker',
              ]
                .filter(Boolean)
                .join(' ')}
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
        <span
          ref={ballRef}
          className="pitch__ball"
          data-status={state.ball.status}
          style={{ left: `${ball.left * 100}%`, top: `${ball.top * 100}%` }}
        />
        {/* Which way the manager's side is attacking, in the fixed frame the
            match uses: the home side always attacks toward x = 1 — the right of
            a landscape pitch, the top of a portrait one. It sits just inside the
            goal line it points at, where it is read as football rather than as a
            mark on the ground beyond the pitch. */}
        <span className="pitch__attack" data-dir={attackDirection(frame, side)} aria-hidden="true" />
      </div>
    </div>
  );
}
