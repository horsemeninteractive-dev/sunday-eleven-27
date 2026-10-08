import type { ReactNode } from 'react';
import type { Person } from '@/domain/person';
import { isPlayer, personDisplayName } from '@/domain/person';
import { useGame } from '../hooks';
import { PlayerLink } from './Links';
import { Portrait } from './Portrait';

/**
 * A person's name, with his portrait beside it.
 *
 * Every list of people in the game comes through here — the committee, the
 * staff, the squad — so the drawing beside a name is decided once, in one place,
 * rather than by each screen inventing its own. See `Portrait.tsx` for what the
 * drawing is, and whose shirt is on it.
 *
 * `detail` is the second line, which is what a roster wants: the office a man
 * holds, the job he does. A screen that wants the drawing and the name and
 * nothing else wants `PersonLine`, below.
 *
 * The words are the man's own name unless a screen needs them said differently —
 * a column that already says his position, a name that carries a nickname after
 * the surname. `children` is that, and it is the same escape hatch `PlayerLink`
 * has always had.
 */
export function PersonIdentity({
  person,
  detail,
  children,
}: {
  person: Person;
  detail?: string;
  children?: ReactNode;
}) {
  return <span className="person-identity">
    <Portrait person={person} />
    <span className="person-identity__text">
      <PlayerLink personId={person.id}>{children ?? personDisplayName(person)}</PlayerLink>
      <span className="muted small">{detail ?? (isPlayer(person) ? `${person.preferredPosition} · ${person.age}` : person.occupation)}</span>
    </span>
  </span>;
}

/**
 * A person on one line: his drawing, and his name, and nothing else.
 *
 * `PersonIdentity` is the same idiom with a second line about him, which is what
 * a roster wants and what a leaderboard of twelve goalscorers does not. This is
 * the short spelling, for the tables and the lists where the row already says
 * everything else — the record books, the subs book, the match report, the
 * people a story is about.
 *
 * It takes an id rather than a person, for the same reason `PlayerLink` does: a
 * screen holding an id should not have to look the man up to draw him — and so
 * that the one case that cannot be drawn, a man the save no longer holds, falls
 * back to exactly the link the name used to be. A name is still a name when
 * there is nobody to put beside it.
 */
export function PersonLine({ personId, children }: { personId: string; children?: ReactNode }) {
  const game = useGame();
  const person = game?.people[personId];
  if (!person) return <PlayerLink personId={personId}>{children}</PlayerLink>;
  return <PersonLineArt person={person}>{children}</PersonLineArt>;
}

/**
 * The line itself, from a man and no store.
 *
 * Split out of `PersonLine` for the same reason `PortraitArt` is split out of
 * `Portrait`: a component that reads the career cannot be rendered in a test at
 * all — a server render is handed zustand's *initial* state, so there would be
 * no game in it and every name would come out flat. What is drawn is this, and
 * what looks the man up is one function above it.
 */
export function PersonLineArt({ person, children }: { person: Person; children?: ReactNode }) {
  return (
    <span className="person-line">
      <Portrait person={person} />
      <PlayerLink personId={person.id}>{children ?? personDisplayName(person)}</PlayerLink>
    </span>
  );
}
