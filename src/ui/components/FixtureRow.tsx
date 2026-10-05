import type { ReactNode } from 'react';
import type { ClubId } from '@/domain/ids';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { isPostponed } from '@/simulation/cup';
import { formatDayMonth } from '@/simulation/calendar';
import { ClubLink } from './Links';

/**
 * One fixture, laid out the way a fixture is read.
 *
 * Crest and name on the left, the `v` dead centre, name and crest on the right,
 * and the kick-off time or the score after that — so the two club crests sit
 * either side of the middle of the row and both names point outwards, which is
 * how a manager scans a fixture list for his own club.
 *
 * The centre column and the two side columns are the same width, which is what
 * keeps the `v` on the centre of the row rather than wherever the longest club
 * name happens to end.
 */
export function FixtureRow({
  meta,
  homeClubId,
  awayClubId,
  result,
  mine = false,
  note,
  match,
  state,
  children,
}: {
  /** The date or the attendance, in the margin on the left. */
  meta?: ReactNode;
  homeClubId: ClubId;
  awayClubId: ClubId;
  /** The score. Absent for a fixture not yet played, when the kick-off goes here. */
  result?: ReactNode;
  /** The manager's own club: marked the way his league games are. */
  mine?: boolean;
  /** Anything that belongs beside the result, such as a giant-killing note. */
  note?: ReactNode;
  /**
   * The fixture itself, when it can be called off.
   *
   * A game that was postponed stays in the list it was drawn for, marked P-P,
   * with the reason underneath and the date the replay has been moved to — a
   * manager looking at a fixture list needs to see both the game that did not
   * happen and the one that will.
   */
  match?: Match;
  /** The world, so the replay of a postponed fixture can be read back out. */
  state?: GameState;
  /** Extra content after the result. */
  children?: ReactNode;
}) {
  const calledOff = match && isPostponed(match);
  // `replacedByMatchId` is an id, so the replay is read back out of the world:
  // the fixture list wants the new date, not just the fact of one.
  const replay =
    calledOff && match.replacedByMatchId && state
      ? state.matches[match.replacedByMatchId] ?? null
      : null;
  return (
    <li className={`fixrow${mine ? ' fixrow--mine' : ''}${calledOff ? ' fixrow--postponed' : ''}`}>
      <span className="fixrow__meta muted small">{meta}</span>
      <span className="fixrow__side fixrow__side--home">
        <ClubLink clubId={homeClubId} />
      </span>
      <span className="fixrow__v muted small" aria-hidden="true">
        v
      </span>
      <span className="fixrow__side fixrow__side--away">
        <ClubLink clubId={awayClubId} reverse />
      </span>
      <span className="fixrow__result">
        {calledOff ? (
          <span className="fixrow__pp">
            <span className="fixrow__pp-score">P-P</span>
            {match.postponementReason ? (
              <span className="muted small">{match.postponementReason}</span>
            ) : null}
          </span>
        ) : (
          result ?? (children ? <span className="muted small">{children}</span> : null)
        )}
        {note}
      </span>
      {calledOff ? (
        <span className="fixrow__replay muted small">
          {replay
            ? `Rearranged for ${formatDayMonth(replay.date)}`
            : 'No room left to replay it — the fixture is abandoned'}
        </span>
      ) : null}
    </li>
  );
}