import { useEffect, useMemo, useRef } from 'react';
import type { Match } from '@/domain/match';
import { getFormation, POSITIONS, type PositionCode } from '@/domain/positions';
import type { Player } from '@/domain/person';
import { playerName } from '../format';
import { spatialAlpha } from '@/simulation/match/spatial';

/**
 * The match visualisation.
 *
 * Deliberately a leaf, and deliberately dumb: it draws where the simulation
 * says everybody is and nothing else. It does not decide where a player should
 * stand, and it never advances anything — the positions it draws are the
 * simulation's own, and the ball is the simulation's ball. What this file owns
 * is only the last inch: reading the state once a frame and moving the sprites,
 * interpolating between the step a player was at and the step he is at, so the
 * football appears to be continuous rather than a slideshow.
 *
 * A future 3D renderer goes in this slot and replaces this file; the match
 * underneath it does not change. The fallback path is for a match with no
 * spatial state at all — an old save, or somebody else's fixture — where the
 * shape is laid out from the formation as it always was.
 */

interface NodeShape {
  key: string;
  side: 'home' | 'away';
  position: PositionCode;
  player: Player | undefined;
  x: number;
  y: number;
  px: number;
  py: number;
  action: string;
  mine: boolean;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function MatchPitch({
  match,
  side,
  playerById,
}: {
  match: Match;
  side: 'home' | 'away';
  playerById: (id: string) => Player | undefined;
}) {
  const spatial = match.spatial;
  const dotRefs = useRef(new Map<string, HTMLSpanElement>());
  const ballRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const nodes: NodeShape[] = useMemo(() => {
    if (spatial) {
      return spatial.players.map((node) => ({
        key: node.playerId,
        side: node.side,
        position: node.position,
        player: playerById(node.playerId),
        x: node.x,
        y: node.y,
        px: node.px,
        py: node.py,
        action: node.action,
        mine: node.side === side,
      }));
    }
    return shapeFromFormation(match, side, playerById);
    // The spatial array is mutated in place by the simulation; the revision in
    // `match.events` is what tells us a new minute — and a new shape — is here.
  }, [match, match.spatial, match.events.length, side, playerById]);

  // The render loop: read the authoritative state, draw it, do nothing else.
  useEffect(() => {
    if (!spatial) return;
    let frame = 0;
    const draw = () => {
      const alpha = spatialAlpha(spatial);
      // The celebration begins and ends mid-minute, so it can be neither read
      // from a React render nor waited for: it is drawn here, every frame, like
      // the positions themselves.
      const celebration = spatial.celebration ?? null;
      for (const node of spatial.players) {
        const element = dotRefs.current.get(node.playerId);
        if (!element) continue;
        element.style.left = `${lerp(node.px, node.x, alpha) * 100}%`;
        element.style.top = `${lerp(node.py, node.y, alpha) * 100}%`;
        element.dataset.action = node.action;
        // Possession changes between one React render and the next, so the man
        // with the ball is marked here rather than waiting for a minute to pass.
        element.classList.toggle('pitch__dot--carrying', node.action === 'carrying');
        // A goal is the one moment the picture is allowed to shout: the team that
        // scored is marked out from the instant the ball crosses the line, and
        // the man who scored it most of all.
        const onScoringSide = celebration !== null && celebration.side === node.side;
        element.classList.toggle('pitch__dot--celebrating', onScoringSide);
        element.classList.toggle('pitch__dot--scorer', onScoringSide && celebration!.scorerId === node.playerId);
      }
      if (rootRef.current) rootRef.current.dataset.celebrating = celebration ? 'true' : 'false';
      const ball = ballRef.current;
      if (ball) {
        ball.style.left = `${lerp(spatial.ball.px, spatial.ball.x, alpha) * 100}%`;
        ball.style.top = `${lerp(spatial.ball.py, spatial.ball.y, alpha) * 100}%`;
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [spatial]);

  const ball = spatial ? { x: spatial.ball.x, y: spatial.ball.y } : lastEventPoint(match);

  return (
    <div ref={rootRef} className="pitch pitch--live matchpitch" data-renderer="2d" data-celebrating="false">
      <span className="pitch__halfway" />
      <span className="pitch__circle" />
      <span className="pitch__box pitch__box--left" />
      <span className="pitch__box pitch__box--right" />
      {nodes.map((node) => (
        <span
          key={node.key}
          ref={(element) => {
            if (element) dotRefs.current.set(node.key, element);
            else dotRefs.current.delete(node.key);
          }}
          className={`pitch__dot${node.mine ? ' pitch__dot--mine' : ''}${node.action === 'carrying' ? ' pitch__dot--carrying' : ''}`}
          style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
          title={node.player ? `${playerName(node.player)} — ${POSITIONS[node.position].label}` : node.position}
        >
          <span className="pitch__dot-ball">{node.position}</span>
          <span className="pitch__dot-name">{node.player?.surname ?? ''}</span>
        </span>
      ))}
      <span ref={ballRef} className="pitch__ball" style={{ left: `${ball.x * 100}%`, top: `${ball.y * 100}%` }} />
    </div>
  );
}

/** Where the ball was last heard of, for a match with no spatial state. */
function lastEventPoint(match: Match): { x: number; y: number } {
  const last = match.events[match.events.length - 1];
  return last ? { x: last.x, y: last.y } : { x: 0.5, y: 0.5 };
}

/**
 * The old way of drawing a team: the formation, leaned toward the ball. Used
 * only when there is no spatial state to read, so an unwatched match and a save
 * from before the pitch existed still look like a match.
 */
function shapeFromFormation(
  match: Match,
  side: 'home' | 'away',
  playerById: (id: string) => Player | undefined,
): NodeShape[] {
  const ball = lastEventPoint(match);
  const nodes: NodeShape[] = [];
  for (const teamSide of ['home', 'away'] as const) {
    const lineup = match.lineups[teamSide];
    const formation = getFormation(lineup.tactics.formation);
    lineup.starting.forEach((slot, index) => {
      const formationSlot = formation.slots[index] ?? formation.slots[0]!;
      const isHomeSide = teamSide === 'home';
      const baseX = isHomeSide ? formationSlot.x : 1 - formationSlot.x;
      const baseY = isHomeSide ? formationSlot.y : 1 - formationSlot.y;
      const x = Math.max(0.02, Math.min(0.98, baseX * 0.8 + ball.x * 0.2));
      const y = Math.max(0.04, Math.min(0.96, baseY * 0.84 + ball.y * 0.16));
      nodes.push({
        key: `${teamSide}-${slot.playerId}-${index}`,
        side: teamSide,
        position: slot.position,
        player: playerById(slot.playerId),
        x,
        y,
        px: x,
        py: y,
        action: 'shape',
        mine: teamSide === side,
      });
    });
  }
  return nodes;
}
