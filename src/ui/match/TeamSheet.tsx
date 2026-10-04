import type { CSSProperties } from 'react';
import type { Club } from '@/domain/club';
import type { Match, MatchLineup } from '@/domain/match';
import type { Player } from '@/domain/person';
import { POSITIONS } from '@/domain/positions';

/**
 * A team's sheet, down the side of the pitch.
 *
 * The shape on the pitch says where the eleven are; this says who they are, in
 * the order they were picked, so the manager can put a name to a dot without
 * leaving the match. It is a list and nothing more — ratings, energy and the
 * bench's order of preference all live in the panels under the pitch, where
 * they can be read at length instead of at a glance.
 */
export function TeamSheet({
  side,
  club,
  lineup,
  match,
  playerById,
  colour,
}: {
  side: 'home' | 'away';
  club: Club;
  lineup: MatchLineup;
  match: Match;
  playerById: (id: string) => Player | undefined;
  /**
   * The first colour of the strip this side is wearing, not the club's own
   * colour — the sheet is headed in the shirt, so a side in a white away strip
   * is headed in white.
   */
  colour: string;
}) {
  const starters = lineup.starting.map((slot, index) => {
    const player = playerById(slot.playerId);
    const performance = match.performances[slot.playerId];
    return { slot, index, player, performance };
  });
  const bench = lineup.bench.map((slot) => ({ slot, player: playerById(slot.playerId) }));

  return (
    <aside
      className={`teamsheet teamsheet--${side}`}
      aria-label={`${club.identity.name} line-up`}
      style={{ '--sheet-colour': colour } as CSSProperties}
    >
      <header className="teamsheet__head">
        <span className="teamsheet__club">{club.identity.shortName}</span>
      </header>

      <ol className="teamsheet__list">
        {starters.map(({ slot, index, player, performance }) => (
          <li key={`${slot.playerId}-${index}`} className="teamsheet__row">
            <span className="teamsheet__pos">{POSITIONS[slot.position].code}</span>
            <span className="teamsheet__player">
              {player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'somebody'}
            </span>
            <span className="teamsheet__marks">
              {performance && performance.goals > 0 && (
                <span className="teamsheet__mark teamsheet__mark--goal" title={`${performance.goals} goal${performance.goals === 1 ? '' : 's'}`}>
                  {performance.goals > 1 ? `⚽${performance.goals}` : '⚽'}
                </span>
              )}
              {performance && performance.yellowCards > 0 && <span className="teamsheet__card teamsheet__card--yellow" title="Booked" />}
              {performance && performance.redCards > 0 && <span className="teamsheet__card teamsheet__card--red" title="Sent off" />}
            </span>
          </li>
        ))}
      </ol>

      {bench.length > 0 && (
        <>
          <p className="teamsheet__sub">Subs</p>
          <ol className="teamsheet__list teamsheet__list--bench">
            {bench.map(({ slot, player }, index) => (
              <li key={`${slot.playerId}-bench-${index}`} className="teamsheet__row">
                <span className="teamsheet__pos">{slot.position}</span>
                <span className="teamsheet__player">{player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'somebody'}</span>
                <span className="teamsheet__marks" />
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
