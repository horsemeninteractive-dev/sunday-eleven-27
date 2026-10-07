import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { ReactNode } from 'react';
import { formatDate, formatKickOff } from '@/simulation/calendar';
import { daysBetween } from '@/simulation/calendar';
import { ClubBadge } from './Badge';
import { ClubLink } from './Links';
import { Pill } from './primitives';

export function FixtureCard({ state, match, actions }: { state: GameState; match: Match; actions?: ReactNode }) {
  const home = state.clubs[match.homeClubId]!;
  const away = state.clubs[match.awayClubId]!;
  const ground = state.world.grounds[match.groundId];
  const days = daysBetween(state.date, match.date);
  const result = match.result;
  return <section className="fixture-card" aria-label={result ? 'Final result' : 'Next fixture'}>
    <div className="fixture-card__when">
      <span className="fixture-card__label">{result ? 'Full time' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 ? `In ${days} days` : 'Scheduled fixture'}</span>
      <span>{formatDate(match.date)}</span>
      <Pill tone="time">{formatKickOff(match.kickOff)}</Pill>
    </div>
    <div className="fixture-card__teams">
      <div className="fixture-card__side"><ClubBadge club={home} size={52} /><ClubLink clubId={home.id}>{home.identity.name}</ClubLink></div>
      <strong className="fixture-card__score">{result ? `${result.homeGoals}–${result.awayGoals}` : 'v'}{result?.penalties && <small>pens {result.penalties.home}–{result.penalties.away}</small>}</strong>
      <div className="fixture-card__side"><ClubBadge club={away} size={52} /><ClubLink clubId={away.id}>{away.identity.name}</ClubLink></div>
    </div>
    <div className="fixture-card__foot"><p>{match.competitionName} · {ground?.name ?? 'Ground to confirm'}</p>{actions && <div className="row">{actions}</div>}</div>
  </section>;
}
