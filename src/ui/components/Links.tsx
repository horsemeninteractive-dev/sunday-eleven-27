import { createContext, useContext, type ReactNode } from 'react';
import type { Club } from '@/domain/club';
import { gameActions, useGame } from '../hooks';
import { ClubBadge } from './Badge';
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

export function ClubLink({ clubId, children }: { clubId: string; children?: ReactNode }) {
  const game = useGame();
  const openProfile = useOpenProfile();
  const club = game?.clubs[clubId];
  if (!club) return <span>{children ?? 'Unknown club'}</span>;
  return (
    <button
      type="button"
      className="link clubcell"
      title={`${club.identity.name} — ${club.identity.nickname}`}
      onClick={() => openProfile({ kind: 'club', id: clubId })}
    >
      <Crest club={club} />
      <span>{children ?? club.identity.name}</span>
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
