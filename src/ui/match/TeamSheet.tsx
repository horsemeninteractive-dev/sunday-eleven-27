import type { CSSProperties } from 'react';
import type { Club } from '@/domain/club';
import type { Match, MatchLineup } from '@/domain/match';
import type { Player } from '@/domain/person';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import type { RenderTeamColours } from '@/presentation/renderContract';
import { flatClubInk } from '../colour';
import { isKeeper, shirtFor } from './shirt';

/**
 * A team's sheet, down the side of the pitch.
 *
 * The shape on the pitch says where the eleven are; this says who they are, in
 * the order they were picked, so the manager can put a name to a dot without
 * leaving the match. It is a list and nothing more — ratings, energy and the
 * bench's order of preference all live in the panels under the pitch, where
 * they can be read at length instead of at a glance.
 *
 * It is also a sheet of shirts, and it did not used to be. A sheet is headed in
 * the strip its side turned out in — `--sheet-colour` was written for exactly
 * that and drew a three-pixel rule above the club's name — but the list under the
 * rule said nothing about what the men in it were wearing, and the one man whose
 * shirt is *not* the side's own, the keeper, was marked as the keeper on the pitch
 * and nowhere in the list beside it. So the head is painted in the strip now, with
 * the club's name on it in an ink measured for that colour, and every row carries
 * that man's shirt down the edge of the list: the side's strip for the ten, and
 * the third strip for the keeper, asked of the same `shirtFor` the pitch asks.
 *
 * Which of the two is drawn where is the only thing here that is not a colour.
 * The ten are the side's strip, so the stylesheet paints them from
 * `--sheet-colour`, exactly as it paints the ten on the formation board; the
 * keeper's is the one shirt that belongs to no side's strip but his club's third,
 * so it is painted here, the way the board and the portrait paint him too. A white
 * away strip is headed in white and its keeper is still in magenta.
 *
 * It is the sheet on every screen a match is put in front of the manager on:
 * down either side of the live pitch, down either side of a replay of the same
 * afternoon, and in the report. One component and one reading of the strips, so
 * the same eleven men are in the same shirts on all three.
 */
export function TeamSheet({
  side,
  club,
  lineup,
  match,
  playerById,
  colours,
  marks = true,
}: {
  side: 'home' | 'away';
  club: Club;
  lineup: MatchLineup;
  match: Match;
  playerById: (id: string) => Player | undefined;
  /**
   * The colours this side turned out in, which are not the club's own: a visiting
   * side in a white away shirt is white, and a keeper is in the third strip in
   * every match. They are the same colours the pitch beside this sheet is drawn
   * from, so the list and the picture cannot disagree.
   */
  colours: RenderTeamColours;
  /**
   * Whether the sheet says what the men in it did, as well as who they are.
   *
   * On by default: a sheet is read while the match is on and long after it, and
   * the marks down the side of it — a goal, a booking, a sending-off — are part
   * of whose line it is. A replay is the one place it is turned off, because a
   * replay exists so the afternoon can be watched back without being told how it
   * ends, and a list of the goals with the clock still in the first half is the
   * whole match given away at a glance.
   */
  marks?: boolean;
}) {
  const starters = lineup.starting.map((slot, index) => {
    const player = playerById(slot.playerId);
    const performance = marks ? match.performances[slot.playerId] : undefined;
    return { slot, index, player, performance };
  });
  const bench = lineup.bench.map((slot) => ({ slot, player: playerById(slot.playerId) }));

  return (
    <aside
      className={`teamsheet teamsheet--${side}`}
      aria-label={`${club.identity.name} line-up`}
      style={
        {
          '--sheet-colour': colours.primary,
          // The ink for the club's name on the strip. Measured rather than
          // guessed, because the strip is any colour a club in the county plays
          // in and the name is read on it.
          '--sheet-ink': flatClubInk(colours.primary),
        } as CSSProperties
      }
    >
      <header className="teamsheet__head">
        <span className="teamsheet__club">{club.identity.shortName}</span>
      </header>

      <ol className="teamsheet__list">
        {starters.map(({ slot, index, player, performance }) => (
          <li key={`${slot.playerId}-${index}`} className="teamsheet__row">
            <ShirtBar colours={colours} position={slot.position} />
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
          {/* A substitute is a shirt on the sheet as well, and a second keeper
              among them is the same shirt as the one in goal: the reserve keeper
              is the one man on the bench a manager recognises without reading. */}
          <ol className="teamsheet__list teamsheet__list--bench">
            {bench.map(({ slot, player }, index) => (
              <li key={`${slot.playerId}-bench-${index}`} className="teamsheet__row">
                <ShirtBar colours={colours} position={slot.position} />
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

/**
 * One man's shirt, as a bar down the edge of the list.
 *
 * A bar rather than a chip: the row already carries a chip for his position, and
 * a second one beside it would be two marks for one line of a sheet that has to
 * fit down the side of a pitch. It is flat and it has no ink on it, because it is
 * a colour rather than a label — the code in the next cell says what he is for,
 * and the shirt says whose he is.
 *
 * The keeper is the one man whose bar is not the side's own shirt, and he is
 * marked as the keeper for the same reason the pitch marks his dot and the
 * formation board marks his shirt: it is the one thing about the eleven a manager
 * looks for by colour rather than by reading.
 */
function ShirtBar({ colours, position }: { colours: RenderTeamColours; position: PositionCode }) {
  if (!isKeeper(position)) return <span className="teamsheet__shirt" aria-hidden="true" />;
  return (
    <span
      className="teamsheet__shirt teamsheet__shirt--keeper"
      style={{ background: shirtFor(colours, position) }}
      aria-hidden="true"
    />
  );
}
