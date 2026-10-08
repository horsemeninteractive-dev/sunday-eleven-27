import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { PITCH_LABEL, WEATHER_LABEL } from '@/domain/match';
import type { ReactNode } from 'react';
import { formatDate, formatKickOff } from '@/simulation/calendar';
import { daysBetween } from '@/simulation/calendar';
import { matchVenueLabel } from '@/simulation/queries';
import { ClubBadge } from './Badge';
import { ClubLink } from './Links';

/**
 * A fixture, set the way a Sunday fixture sheet sets one.
 *
 * The card used to be a row of labelled facts — competition, then two clubs, then
 * a line of small print — which is the shape of a record rather than of a
 * fixture. What it is now is the paper a fixture is printed on: the competition
 * and the round across the club's own band at the top, the two clubs at the size
 * of a name, the score at the size of a score, and the conditions along the foot
 * as the small print everybody reads last.
 *
 * Nothing here is new information. Every line is a field the fixture already
 * carried, moved to where a fixture sheet puts it: which is the whole of what
 * this task asked for, and the reason it can be done without inventing a thing.
 */
export function FixtureCard({ state, match, actions }: { state: GameState; match: Match; actions?: ReactNode }) {
  const home = state.clubs[match.homeClubId]!;
  const away = state.clubs[match.awayClubId]!;
  const ground = state.world.grounds[match.groundId];
  const days = daysBetween(state.date, match.date);
  const result = match.result;
  const ours = state.userClubId;
  const venue = matchVenueLabel(match, ours);

  // How long the manager has. It is the first question a fixture asks, so it is
  // the one thing on the band given a box of its own.
  const countdown = result
    ? 'Full time'
    : days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : days > 1
          ? `In ${days} days`
          : 'Scheduled';

  const side = (club: typeof home) => (
    <div className={`fixture-card__side${club.id === ours ? ' fixture-card__side--ours' : ''}`}>
      <ClubBadge club={club} size={52} />
      <ClubLink clubId={club.id}>{club.identity.name}</ClubLink>
    </div>
  );

  return (
    <section className="fixture-card" aria-label={result ? 'Final result' : 'Next fixture'}>
      <div className="fixture-card__stamp">
        <span className="fixture-card__label">{match.competitionName}</span>
        {match.matchday > 0 && !match.knockout && <span>Matchday {match.matchday}</span>}
        {match.knockout && <span className="fixture-card__label">Cup tie</span>}
        {match.neutralVenue && <span>Neutral ground</span>}
        <span className="fixture-card__days">{countdown}</span>
      </div>

      <div className="fixture-card__body">
        <div className="fixture-card__teams">
          {side(home)}
          <strong className="fixture-card__score">
            {result ? `${result.homeGoals}–${result.awayGoals}` : 'v'}
            {result?.penalties && <small>pens {result.penalties.home}–{result.penalties.away}</small>}
          </strong>
          {side(away)}
        </div>

        {/* The conditions, as the small print: the day and the time, whose ground
            it is, the surface they will be playing on and the weather they will
            be playing it in. This is what a fixture sheet is for. */}
        <div className="fixture-card__conditions">
          <span>
            <b>{formatDate(match.date)}</b> · kick-off {formatKickOff(match.kickOff)}
          </span>
          <span>
            {venue === 'Home' ? 'Our ground' : venue === 'Away' ? 'Away' : venue}
            {ground ? <> · <b>{ground.name}</b></> : ' · ground to confirm'}
          </span>
          <span>
            {PITCH_LABEL[match.conditions.pitch]} pitch · {WEATHER_LABEL[match.conditions.weather].toLowerCase()}, {match.conditions.temperatureC}°C
          </span>
          {ground && <span>{ground.surface} · capacity {ground.capacity}</span>}
        </div>
      </div>

      {(actions || result) && (
        <div className="fixture-card__foot">
          <p>
            {result
              ? `Attendance ${result.attendance}`
              : match.knockout
                ? `${match.competitionName} — a tie, so somebody is going out`
                : `Matchday ${match.matchday} of the season`}
          </p>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
    </section>
  );
}
