import { createContext, useContext, type ReactNode } from 'react';
import type { Club } from '@/domain/club';
import { gameActions, useGame } from '../hooks';
import { ClubBadge } from './Badge';
import { clubTown } from '@/simulation/queries';
import type { ProfileTarget } from '@/state/gameStore';

/**
 * Where a profile opens.
 *
 * Normally the store, so a name anywhere in the game pulls up that person. The
 * profile overlay overrides it with its own stack, so following links from one
 * profile to another can be walked back.
 */
export type OpenProfile = (target: ProfileTarget) => void;

const ProfileNavContext = createContext<OpenProfile>((target) => gameActions().openProfile(target));

export function ProfileNavProvider({ open, children }: { open: OpenProfile; children: ReactNode }) {
  return <ProfileNavContext.Provider value={open}>{children}</ProfileNavContext.Provider>;
}

export function useOpenProfile(): OpenProfile {
  return useContext(ProfileNavContext);
}

/**
 * Names are doors.
 *
 * Anywhere a club or a person is named, the manager should be able to open
 * them — that is how a management game is read. These components are the only
 * way the UI draws a club or a player name.
 */

export function Crest({ club, size = 'sm' }: { club: Club; size?: 'sm' | 'lg' }) {
  return (
    <span className={`crest${size === 'lg' ? ' crest--lg' : ''}`} aria-hidden="true">
      <ClubBadge club={club} />
    </span>
  );
}

export function ClubLink({
  clubId,
  children,
  reverse = false,
  town = false,
}: {
  clubId: string;
  children?: ReactNode;
  /**
   * Name before crest rather than crest before name, right-aligned.
   *
   * A fixture reads crest-then-name on the left and name-then-crest on the
   * right, so both crests sit nearest the middle of the row and the two names
   * point away from it.
   */
  reverse?: boolean;
  /**
   * The place the club is registered in, under its name.
   *
   * Where a club is read — a league table, a fixture row, a result — it is read
   * as a name and nothing else, and the town is what a manager learned about it
   * before the career began: the district he picked, and the places drawn on its
   * map. Asking for it here rather than in each screen is what keeps the place a
   * club plays in the same place in every list that names it. Left off by
   * default, because a name in the middle of a sentence ('v Draywick Social
   * Club') is a name, and a club cell that grew a second line wherever it was
   * used would rewrite sentences it has no business in.
   */
  town?: boolean;
}) {
  const game = useGame();
  const openProfile = useOpenProfile();
  const club = game?.clubs[clubId];
  if (!club) return <span>{children ?? 'Unknown club'}</span>;
  const place = town && game ? clubTown(game, clubId) : undefined;
  return (
    <button
      type="button"
      className={`link clubcell${reverse ? ' clubcell--reverse' : ''}`}
      title={`${club.identity.name} — ${club.identity.nickname}${place ? `, ${place.name}` : ''}`}
      onClick={() => openProfile({ kind: 'club', id: clubId })}
    >
      <Crest club={club} />
      <span className="clubcell__name">
        {children ?? club.identity.name}
        {place && <span className="clubcell__town">{place.name}</span>}
      </span>
    </button>
  );
}

/**
 * A competition. There is one division in this world, so it opens the table —
 * the same restrained treatment as every other inline link.
 */
export function CompetitionLink({ children }: { children?: ReactNode }) {
  return (
    <button
      type="button"
      className="link"
      onClick={() => gameActions().setView('league')}
      title="Open the league table"
    >
      {children}
    </button>
  );
}

export function PlayerLink({
  personId,
  children,
  className,
}: {
  personId: string;
  children?: ReactNode;
  className?: string;
}) {
  const game = useGame();
  const openProfile = useOpenProfile();
  const person = game?.people[personId];
  const label = children ?? (person ? `${person.firstName} ${person.surname}` : 'Unknown');
  return (
    <button
      type="button"
      className={`playerlink${className ? ` ${className}` : ''}`}
      onClick={() => openProfile({ kind: 'player', id: personId })}
    >
      {label}
    </button>
  );
}
