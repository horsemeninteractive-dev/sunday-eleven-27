import type { Person } from '@/domain/person';
import { isPlayer, personDisplayName } from '@/domain/person';
import { PlayerLink } from './Links';
import { Glyph } from './icons';

/** An honest silhouette, not a generated likeness of a person. */
export function PersonIdentity({ person, detail }: { person: Person; detail?: string }) {
  return <span className="person-identity">
    <span className="person-mark" aria-hidden="true"><Glyph name="manager" /></span>
    <span className="person-identity__text">
      <PlayerLink personId={person.id}>{personDisplayName(person)}</PlayerLink>
      <span className="muted small">{detail ?? (isPlayer(person) ? `${person.preferredPosition} · ${person.age}` : person.occupation)}</span>
    </span>
  </span>;
}
