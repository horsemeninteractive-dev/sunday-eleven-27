import type { ReactNode } from 'react';
import type { Person } from '@/domain/person';
import { PersonIdentity } from './PersonIdentity';

/**
 * One person's card, wherever a person is listed.
 *
 * The committee was drawn one way on Club — "Who runs it": a role pill, a name
 * and a Message button strung along one line — and another way on Staff: the
 * office under the name, the state of the person as pills, and the single thing
 * on them underneath. The same four facts, in two shapes, which is what made
 * the Club screen read as though it had been written by somebody else.
 *
 * So the shape is fixed here, and the two screens fill it in:
 *
 *   office  — the job, which is the identity's second line
 *   who     — the person, or the fact that the post is vacant
 *   state   — pills: around, away, how good; whatever the screen knows
 *   action  — the one thing the manager can do about them
 *   detail  — age and occupation
 *   duty    — the last note on them: what they are actually doing
 *   issue   — the one thing the office is carrying right now
 *
 * It renders a `li`, so a screen hands it to `<ul className="staff-roster">`
 * and gets the same grid and the same responsive behaviour as every other list
 * of people in the game.
 */
export function StaffCard({
  office,
  person,
  vacant = 'vacant',
  identityExtra,
  status,
  action,
  detail,
  duty,
  issue,
}: {
  /** What the manager calls the job: "Assistant manager", "Chairman", "Treasurer". */
  office: string;
  person?: Person | null;
  /** What to say when nobody holds the office. */
  vacant?: string;
  /** Anything the identity line needs beyond the name: "also a player", say. */
  identityExtra?: ReactNode;
  /** The state of the person, as pills or a short line. */
  status?: ReactNode;
  /** The one action: usually a Message button, sometimes nothing. */
  action?: ReactNode;
  detail?: ReactNode;
  duty?: ReactNode;
  issue?: ReactNode;
}) {
  // The status and action slots are always in the document, even when empty,
  // because they are placed by the stylesheet: dropping the element would move
  // the rows underneath it into their columns. An empty one costs nothing.
  return (
    <li className="staff-roster__person">
      <div className="staff-roster__identity">
        {person ? (
          <>
            <PersonIdentity person={person} detail={office} />
            {identityExtra}
          </>
        ) : (
          <strong className="muted">{vacant}</strong>
        )}
      </div>
      <div className="staff-roster__status">{status}</div>
      <div className="staff-roster__action">{action}</div>
      {detail && <p className="staff-roster__detail small muted">{detail}</p>}
      {duty && <p className="staff-roster__duty small muted">{duty}</p>}
      {issue && <div className="small tone tone--warn">{issue}</div>}
    </li>
  );
}
