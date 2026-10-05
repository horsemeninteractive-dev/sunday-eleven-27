import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { PITCH_LABEL, WEATHER_LABEL } from '@/domain/match';
import { isPlayer, type Official } from '@/domain/person';
import { MENTALITY_LABEL, PRESSING_LABEL } from '@/domain/tactics';
import { formatDate, formatKickOff } from '@/simulation/calendar';
import { expectedAttendanceFor } from '@/simulation/matchday';
import { journeyDistanceKm, matchOpponent, matchVenueLabel } from '@/simulation/queries';
import { ordinal } from '@/simulation/news';
import { gameActions, useStandings } from '../hooks';
import { fixtureLabel, playerName } from '../format';
import { Button, FormPips, Panel, Pill, Stat } from './primitives';
import { ClubLink, CompetitionLink, PlayerLink } from './Links';
import { CommentaryTranscript } from '../match/CommentaryTranscript';

/**
 * The manager never has perfect information. Opposition reports are
 * impressions drawn from what is known locally, not a readout of their setting.
 */
function oppositionImpression(state: GameState, opponent: Club): string {
  const tactics = opponent.tactics;
  const parts: string[] = [];
  parts.push(MENTALITY_LABEL[tactics.mentality].toLowerCase());
  if (tactics.pressing === 'high') parts.push(PRESSING_LABEL[tactics.pressing].toLowerCase());
  if (tactics.passingStyle === 'direct') parts.push('gets it forward early');
  if (tactics.attackingFocus === 'wide') parts.push('likes to get it wide');

  const manager = opponent.managerId ? state.people[opponent.managerId] : undefined;
  const managerNote =
    manager && manager.kind === 'official' && manager.role === 'manager'
      ? `${manager.firstName} ${manager.surname} has been around the local game a while.`
      : manager?.kind === 'player'
        ? `${manager.firstName} ${manager.surname} runs the side from the pitch.`
        : '';

  return `${opponent.identity.shortName} are expected to be ${parts.join(', ')}. ${managerNote}`.trim();
}

export function NextFixturePanel({ state, match }: { state: GameState; match: Match }) {
  const standings = useStandings();
  const opponentId = matchOpponent(match, state.userClubId);
  const opponent = state.clubs[opponentId]!;
  const venue = matchVenueLabel(match, state.userClubId);
  const ground = state.world.grounds[match.groundId];
  const referee = match.refereeId ? state.people[match.refereeId] : undefined;
  const opponentRow = standings.find((row) => row.clubId === opponentId);
  const refOfficer = referee && referee.kind === 'official' ? (referee as Official) : undefined;
  const isHome = venue === 'Home';
  const squad = state.clubs[state.userClubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);
  const unavailable = squad.filter((player) => player.availability.status !== 'available');

  return (
    <Panel
      title={`Next: ${opponent.identity.name} (${venue})`}
      subtitle={
        <>
          {formatDate(match.date)} · {formatKickOff(match.kickOff)} · <CompetitionLink>{match.competitionName}</CompetitionLink>
        </>
      }
      tone="accent"
      actions={
        <div className="row">
          <Button variant="primary" onClick={() => gameActions().startUserMatch()}>
            {isHome ? 'Turn up and play' : 'Travel and play'}
          </Button>
          <Button variant="ghost" onClick={() => gameActions().instantResult()}>
            Get someone else to text the result
          </Button>
        </div>
      }
    >
      <div className="stat-grid">
        <Stat label="Venue" value={ground?.name ?? 'Unknown'} hint={ground ? `${ground.surface}, capacity ${ground.capacity}` : undefined} />
        <Stat label="Weather" value={WEATHER_LABEL[match.conditions.weather]} hint={`${match.conditions.temperatureC}°C`} />
        <Stat label="Pitch" value={PITCH_LABEL[match.conditions.pitch]} hint={`Surface quality ${match.conditions.pitchQuality}/20`} />
        <Stat
          label="Expected crowd"
          value={`~${expectedAttendanceFor(state, match)}`}
          hint="Including the two blokes walking their dog behind the far goal"
        />
        <Stat
          label="Referee"
          value={refOfficer ? `${refOfficer.firstName.charAt(0)}. ${refOfficer.surname}` : 'Not appointed'}
          hint={
            refOfficer
              ? `Roughly ${(refOfficer.attributes.strictness ?? 10) >= 14 ? 'card happy' : (refOfficer.attributes.strictness ?? 10) <= 7 ? 'lets things go' : 'steady'} — impressions, not facts`
              : undefined
          }
        />
        <Stat
          label="Travel"
          value={isHome ? 'Home' : `${journeyDistanceKm(state, state.userClubId, opponentId)} km`}
          hint={isHome ? 'Your own ground, your own dressing room' : 'Petrol money and a rushed warm-up'}
        />
      </div>

      <div className="split">
        <div>
          <h4 className="subhead">Opposition</h4>
          <p className="small">
            {opponentRow ? `${ordinal(standings.indexOf(opponentRow) + 1)} in the league` : 'No league position yet'} ·{' '}
            {opponentRow ? `${opponentRow.points} pts from ${opponentRow.played}` : ''}
          </p>
          <FormPips form={opponentRow?.form ?? []} />
          <p className="muted small">{oppositionImpression(state, opponent)}</p>
          <p className="muted small">
            Ground sharing: {ground && ground.sharedWith.length > 0 ? 'yes, tight for parking' : 'no'} · Clubhouse:{' '}
            {ground?.hasClubhouse ? 'open' : 'not open'}
          </p>
        </div>
        <div>
          <h4 className="subhead">Yours</h4>
          <p className="small">
            {unavailable.length === 0
              ? 'Everyone is available as things stand.'
              : `${unavailable.length} of ${squad.length} not fully available:`}
          </p>
          <ul className="tight-list">
            {unavailable.slice(0, 6).map((player) => (
              <li key={player.id}>
                <strong>{playerName(player)}</strong>{' '}
                <span className="muted small">{player.availability.note ?? player.availability.reason}</span>
              </li>
            ))}
          </ul>
          {unavailable.length > 6 && <p className="muted small">…and {unavailable.length - 6} more.</p>}
        </div>
      </div>
    </Panel>
  );
}

export function MatchDetailPanel({ state, match }: { state: GameState; match: Match }) {
  const result = match.result;
  const home = state.clubs[match.homeClubId]!;
  const away = state.clubs[match.awayClubId]!;
  const ground = state.world.grounds[match.groundId];
  const homePerf = Object.values(match.performances)
    .filter((performance) => performance.clubId === match.homeClubId)
    .sort((a, b) => b.rating - a.rating);
  const awayPerf = Object.values(match.performances)
    .filter((performance) => performance.clubId === match.awayClubId)
    .sort((a, b) => b.rating - a.rating);
  const scorers = match.events.filter((event) => event.type === 'goal');
  const cards = match.events.filter((event) => event.type === 'yellow-card' || event.type === 'red-card');
  const injuries = match.events.filter((event) => event.type === 'injury');

  if (!result) {
    return (
      <Panel title="Not played yet" subtitle={formatDate(match.date)}>
        <p className="empty">This fixture has not kicked off.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={fixtureLabel(home.identity.name, away.identity.name, result.homeGoals, result.awayGoals)}
      subtitle={
        <>
          {formatDate(match.date)} · {ground?.name ?? 'Unknown'} · <CompetitionLink>{match.competitionName}</CompetitionLink>
        </>
      }
    >
      <div className="row row--wrap">
        <ClubLink clubId={home.id} />
        <span className="muted small">v</span>
        <ClubLink clubId={away.id} />
      </div>
      <div className="stat-grid">
        <Stat label="Possession" value={`${result.homePossession}% — ${result.awayPossession}%`} />
        <Stat label="Shots" value={`${result.homeShots} — ${result.awayShots}`} />
        <Stat label="Attendance" value={result.attendance} />
        <Stat label="Conditions" value={`${PITCH_LABEL[match.conditions.pitch]}`} hint={`${WEATHER_LABEL[match.conditions.weather]}, ${match.conditions.temperatureC}°C`} />
      </div>

      {match.incidents.length > 0 && (
        <ul className="tight-list">
          {match.incidents.map((incident) => (
            <li key={incident} className="muted small">
              {incident}
            </li>
          ))}
        </ul>
      )}

      <div className="split">
        <div>
          <h4 className="subhead">Goals</h4>
          {scorers.length === 0 && <p className="empty">No goals.</p>}
          <ul className="tight-list">
            {scorers.map((event) => (
              <li key={event.id}>
                <span className="muted small">{event.minute}&#39;</span>{' '}
                {event.playerId ? (
                  <PlayerLink personId={event.playerId}>{shortLabel(state, event.playerId)}</PlayerLink>
                ) : (
                  'Unknown'
                )}
                {event.secondaryPlayerId ? (
                  <span className="muted small">
                    {' '}
                    (assist <PlayerLink personId={event.secondaryPlayerId}>{shortLabel(state, event.secondaryPlayerId)}</PlayerLink>)
                  </span>
                ) : null}
                <Pill tone={event.clubId === match.homeClubId ? 'accent' : 'muted'}>
                  {state.clubs[event.clubId ?? '']?.identity.shortName ?? ''}
                </Pill>
              </li>
            ))}
          </ul>
          <h4 className="subhead">Cards and knocks</h4>
          {cards.length === 0 && injuries.length === 0 && <p className="empty">Nothing to report.</p>}
          <ul className="tight-list">
            {[...cards, ...injuries].map((event) => (
              <li key={event.id}>
                <span className="muted small">{event.minute}&#39;</span> {event.text}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="subhead">Player ratings</h4>
          <div className="split">
            <RatingList state={state} performances={homePerf} title={home.identity.shortName} />
            <RatingList state={state} performances={awayPerf} title={away.identity.shortName} />
          </div>
        </div>
      </div>

      <section className="details">
        <h4 className="subhead">Commentary</h4>
        <CommentaryTranscript match={match} compact />
      </section>
    </Panel>
  );
}

function RatingList({
  state,
  performances,
  title,
}: {
  state: GameState;
  performances: Match['performances'][string][];
  title: string;
}) {
  return (
    <div>
      <p className="muted small">{title}</p>
      <ul className="tight-list">
        {performances.slice(0, 14).map((performance) => {
          const person = state.people[performance.playerId];
          const isUserPlayer = person?.clubId === state.userClubId;
          return (
            <li key={performance.playerId} className={isUserPlayer ? 'rating-row rating-row--mine' : 'rating-row'}>
              <PlayerLink personId={performance.playerId}>
                {person ? `${person.firstName.charAt(0)}. ${person.surname}` : 'Unknown'}
              </PlayerLink>
              <span className="muted small">
                {performance.goals > 0 ? `${performance.goals}⚽ ` : ''}
                {performance.minutesPlayed}&#39;
              </span>
              <Pill tone={performance.rating >= 7.5 ? 'ok' : performance.rating >= 6.3 ? 'accent' : 'bad'}>
                {performance.rating.toFixed(1)}
              </Pill>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shortLabel(state: GameState, personId: string): string {
  const person = state.people[personId];
  if (!person) return 'Unknown';
  return `${person.firstName.charAt(0)}. ${person.surname}`;
}