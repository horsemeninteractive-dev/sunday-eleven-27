import { useMemo } from 'react';
import type { Match } from '@/domain/match';
import { getFormation, POSITIONS } from '@/domain/positions';
import type { Player } from '@/domain/person';
import { playerName } from '../format';

/**
 * The match visualisation.
 *
 * Deliberately a leaf: it takes the match and draws what is happening on the
 * pitch, and knows nothing about the score, the clock, the feed or the
 * manager's controls. The 3D renderer goes in this slot and nothing else has to
 * change — the shell asks for a match and gets a picture back.
 */

export function MatchPitch({
  match,
  side,
  playerById,
}: {
  match: Match;
  side: 'home' | 'away';
  playerById: (id: string) => Player | undefined;
}) {
  const lastEvent = match.events[match.events.length - 1];
  const ball = lastEvent ? { x: lastEvent.x, y: lastEvent.y } : { x: 0.5, y: 0.5 };

  return (
    <div className="pitch pitch--live matchpitch" data-renderer="2d">
      <span className="pitch__halfway" />
      <span className="pitch__circle" />
      <span className="pitch__box pitch__box--left" />
      <span className="pitch__box pitch__box--right" />
      {(['home', 'away'] as const).map((teamSide) => (
        <TeamOnPitch
          key={teamSide}
          side={teamSide}
          match={match}
          ball={ball}
          playerById={playerById}
          isUserSide={side === teamSide}
        />
      ))}
      <span className="pitch__ball" style={{ left: `${ball.x * 100}%`, top: `${ball.y * 100}%` }} />
    </div>
  );
}

function TeamOnPitch({
  side,
  match,
  ball,
  playerById,
  isUserSide,
}: {
  side: 'home' | 'away';
  match: Match;
  ball: { x: number; y: number };
  playerById: (id: string) => Player | undefined;
  isUserSide: boolean;
}) {
  const lineup = match.lineups[side];
  const formation = getFormation(lineup.tactics.formation);
  const positions = useMemo(
    () =>
      lineup.starting.map((slot, index) => {
        const formationSlot = formation.slots[index] ?? formation.slots[0]!;
        // Position bases are written for a side attacking left to right. The
        // away side attacks the other way, so its shape is turned right round —
        // both axes — or a right back would be drawn where a left back stands.
        const isHomeSide = side === 'home';
        const baseX = isHomeSide ? formationSlot.x : 1 - formationSlot.x;
        const baseY = isHomeSide ? formationSlot.y : 1 - formationSlot.y;
        return {
          slot,
          player: playerById(slot.playerId),
          x: Math.max(0.02, Math.min(0.98, baseX * 0.8 + ball.x * 0.2)),
          y: Math.max(0.04, Math.min(0.96, baseY * 0.84 + ball.y * 0.16)),
        };
      }),
    [lineup.starting, formation, side, ball.x, ball.y, playerById],
  );

  return (
    <>
      {positions.map((entry, index) => (
        <span
          key={`${side}-${entry.slot.playerId}-${index}`}
          className={`pitch__dot${isUserSide ? ' pitch__dot--mine' : ''}`}
          style={{ left: `${entry.x * 100}%`, top: `${entry.y * 100}%` }}
          title={
            entry.player
              ? `${playerName(entry.player)} — ${POSITIONS[entry.slot.position].label}`
              : entry.slot.position
          }
        >
          <span className="pitch__dot-ball">{entry.slot.position}</span>
          <span className="pitch__dot-name">{entry.player?.surname ?? ''}</span>
        </span>
      ))}
    </>
  );
}
