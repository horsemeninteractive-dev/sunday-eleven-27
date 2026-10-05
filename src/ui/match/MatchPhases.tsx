import type { GameState } from '@/domain/game';
import { PITCH_LABEL, WEATHER_LABEL, type Match } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { POSITIONS } from '@/domain/positions';
import { formatDayMonth, formatKickOff } from '@/simulation/calendar';
import { expectedAttendanceFor } from '@/simulation/matchday';
import { currentScore } from '@/simulation/match/matchEngine';
import {
  FULL_TIME_TALK_BLURB,
  FULL_TIME_TALK_LABEL,
  FULL_TIME_TALK_ORDER,
  TEAM_TALK_BLURB,
  TEAM_TALK_LABEL,
  TEAM_TALK_ORDER,
  WARM_UP_BLURB,
  WARM_UP_LABEL,
  WARM_UP_ORDER,
  type TeamTalk,
  type WarmUp,
} from '@/simulation/match/preparation';
import type { MatchSession } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { Button } from '../components/primitives';
import { MatchStatsPanel } from './MatchStats';
import type { MatchFeed } from '../matchFeed';

/**
 * Matchday is four screens in one afternoon: the briefing, the match, the
 * fifteen minutes in the changing room, and the result. They all live in the
 * same frame so nothing about the day feels like a different application.
 */

/** What the manager knows before kick-off, and what he says to them. */
export function PreMatchPanel({
  game,
  match,
  session,
  playerById,
  onLookAround,
}: {
  game: GameState;
  match: Match;
  session: MatchSession;
  playerById: (id: string) => Player | undefined;
  /** The manager wants the card out of the way and the pitch in front of him. */
  onLookAround: () => void;
}) {
  const isHome = match.homeClubId === game.userClubId;
  const opponentId = isHome ? match.awayClubId : match.homeClubId;
  const opponent = game.clubs[opponentId]!;
  const ground = game.world.grounds[match.groundId];
  const warnings = selectionWarnings(game, match, session, playerById);
  const opponentForm = recentForm(game, opponentId);

  return (
    <div className="interval" role="dialog" aria-label="Matchday briefing">
      <div className="interval__card">
        <header className="interval__head">
          <h2>Matchday</h2>
          <p className="small muted">
            {formatDayMonth(match.date)} · {match.competitionName}
          </p>
        </header>

        <div className="interval__body">
          <dl className="briefing__facts">
        <div>
          <dt>Kick-off</dt>
          <dd>{formatKickOff(match.kickOff)}</dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd>{ground?.name ?? 'to confirm'}</dd>
        </div>
        <div>
          <dt>Conditions</dt>
          <dd>
            {WEATHER_LABEL[match.conditions.weather]}, {match.conditions.temperatureC}°C
          </dd>
        </div>
        <div>
          <dt>Pitch</dt>
          <dd>{PITCH_LABEL[match.conditions.pitch]}</dd>
        </div>
        <div>
          <dt>Expected</dt>
          <dd>~{expectedAttendanceFor(game, match)}</dd>
        </div>
      </dl>

      <div className="briefing__block">
        <h3>Opposition · {opponent.identity.name}</h3>
        <p className="small muted">
          {opponent.identity.nickname} · {opponentForm || 'no results yet this season'} · likely shape {opponent.tactics.formation}
        </p>
        <ul className="tight-list">
          {keyPlayersOf(game, opponentId).map((player) => (
            <li key={player.id} className="small">
              <strong>
                {player.firstName} {player.surname}
              </strong>{' '}
              <span className="muted">
                {POSITIONS[player.preferredPosition].code}
                {player.injury ? ` · carrying ${player.injury.description}` : ''}
              </span>
            </li>
          ))}
        </ul>

      </div>

      <div className="briefing__block">
        <h3>Warnings</h3>
        {warnings.length === 0 ? (
          <p className="small muted">None.</p>
        ) : (
          <ul className="warnings">
            {warnings.map((warning) => (
              <li key={warning} className="warnings__item">
                ⚠ {warning}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="briefing__block">
        <h3>Team talk</h3>
        <div className="choices">
          {TEAM_TALK_ORDER.map((talk) => (
            <button
              key={talk}
              type="button"
              className={`choice${session.teamTalk === talk ? ' choice--on' : ''}`}
              onClick={() => gameActions().setTeamTalk(talk as TeamTalk)}
              title={TEAM_TALK_BLURB[talk]}
            >
              <strong>{TEAM_TALK_LABEL[talk]}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="briefing__block">
        <h3>Warm-up</h3>
        <div className="choices choices--inline">
          {WARM_UP_ORDER.map((warmUp) => (
            <button
              key={warmUp}
              type="button"
              className={`choice choice--compact${session.warmUp === warmUp ? ' choice--on' : ''}`}
              onClick={() => gameActions().setWarmUp(warmUp as WarmUp)}
              title={WARM_UP_BLURB[warmUp]}
            >
              {WARM_UP_LABEL[warmUp]}
            </button>
          ))}
        </div>
      </div>
        </div>

        <footer className="interval__foot">
          <Button variant="ghost" onClick={onLookAround}>
            Look around
          </Button>
          <Button variant="primary" size="lg" onClick={() => gameActions().kickOff()}>
            Kick off
          </Button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The fifteen minutes that decide the second half.
 *
 * The clock really is stopped here, so the manager can do everything he would
 * do at the ground: look at what happened, look at who is running on empty,
 * change the team, change the shape, and say something. The card carries its
 * own way back out — the control bar is behind it, and a button you cannot
 * reach is worse than no button at all.
 */
export function HalfTimePanel({
  game,
  match,
  session,
  feed,
  playerById,
  onMakeChanges,
}: {
  game: GameState;
  match: Match;
  session: MatchSession;
  feed: MatchFeed;
  playerById: (id: string) => Player | undefined;
  onMakeChanges: () => void;
}) {
  const score = currentScore(match);
  const starters = match.lineups[session.side].starting.map((slot) => ({ slot, player: playerById(slot.playerId) }));
  const tired = starters.filter((entry) => (match.performances[entry.slot.playerId]?.energy ?? 100) < 45);
  const carded = starters.filter((entry) => (match.performances[entry.slot.playerId]?.yellowCards ?? 0) > 0);
  const changes = 3 - match.substitutions[session.side];

  return (
    <div className="interval" role="dialog" aria-label="Half time">
      <div className="interval__card">
        <header className="interval__head">
          <h2>Half time</h2>
          <p className="scoreline">
            {game.clubs[match.homeClubId]!.identity.shortName} {score.home} — {score.away}{' '}
            {game.clubs[match.awayClubId]!.identity.shortName}
          </p>
        </header>

        <div className="interval__body">
          <div>
            <h3>What happened</h3>
            <ol className="feed feed--compact">
              {feed.entries
                .filter((entry) => entry.tone !== 'normal')
                .slice(0, 5)
                .map((entry) => (
                  <li key={entry.id} className={`feed__row feed__row--${entry.tone}`}>
                    <span className="feed__minute">{entry.minute}&#39;</span>
                    <span className="feed__body">
                      {entry.kind && <span className="feed__kind">{entry.kind}</span>}
                      <span className="feed__text">{entry.text}</span>
                    </span>
                  </li>
                ))}
            </ol>
            <h3>In the room</h3>
            <ul className="tight-list">
              {tired.length > 0 ? (
                <li className="small">Running on empty: {shortNames(tired.map((entry) => entry.player))}.</li>
              ) : (
                <li className="small muted">No tired legs.</li>
              )}
              {carded.length > 0 && (
                <li className="small">On a booking: {shortNames(carded.map((entry) => entry.player))}.</li>
              )}
              <li className="small muted">
                {changes} change{changes === 1 ? '' : 's'} left.
              </li>
            </ul>
          </div>

          <div>
            <h3>Team talk</h3>
            <div className="choices choices--inline">
              {TEAM_TALK_ORDER.map((talk) => (
                <button
                  key={talk}
                  type="button"
                  className={`choice choice--compact${session.halfTimeTalk === talk ? ' choice--on' : ''}`}
                  title={TEAM_TALK_BLURB[talk]}
                  onClick={() => gameActions().setHalfTimeTalk(talk as TeamTalk)}
                >
                  {TEAM_TALK_LABEL[talk]}
                </button>
              ))}
            </div>
            <MatchStatsPanel match={match} />
          </div>
        </div>

        <footer className="interval__foot">
          <Button variant="ghost" onClick={onMakeChanges}>
            Tactics &amp; substitutions
          </Button>
          <Button variant="primary" size="lg" onClick={() => gameActions().resumeSecondHalf()}>
            Resume second half
          </Button>
        </footer>
      </div>
    </div>
  );
}

/** "T. Cartwright, J. Cartwright" — two brothers are two people. */
function shortNames(players: Array<Player | undefined>): string {
  return players
    .filter((player): player is Player => Boolean(player))
    .map((player) => `${player.firstName.charAt(0)}. ${player.surname}`)
    .join(', ');
}

/** The result, told properly before he is sent back to the week. */
export function FullTimePanel({
  game,
  match,
  session,
  feed,
  playerById,
  onReport,
  onContinue,
}: {
  game: GameState;
  match: Match;
  session: MatchSession;
  feed: MatchFeed;
  playerById: (id: string) => Player | undefined;
  onReport: () => void;
  onContinue: () => void;
}) {
  const score = currentScore(match);
  const result = match.result;
  const scorers = match.events.filter((event) => event.type === 'goal' || event.type === 'penalty-scored');
  const cards = match.events.filter((event) => event.type === 'yellow-card' || event.type === 'red-card');
  const squad = [...match.lineups[session.side].starting, ...match.lineups[session.side].bench];

  return (
    <div className="interval" role="dialog" aria-label="Full time">
      <div className="interval__card">
        <header className="interval__head">
          <h2>Full time</h2>
          <p className="scoreline">
            {game.clubs[match.homeClubId]!.identity.name} {score.home} — {score.away}{' '}
            {game.clubs[match.awayClubId]!.identity.name}
          </p>
          <p className="small muted">
            {match.competitionName}
            {result ? ` · ${result.attendance} watching` : ''} · {WEATHER_LABEL[match.conditions.weather]}
          </p>
        </header>

        <div className="interval__body">
          <div>
            <h3>The goals</h3>
            {scorers.length === 0 ? (
              <p className="small muted">No goals.</p>
            ) : (
              <ul className="tight-list">
                {scorers.map((event) => (
                  <li key={event.id} className="small">
                    <span className="muted">{event.minute}&#39;</span>{' '}
                    <strong>{playerLabel(game, event.playerId)}</strong>{' '}
                    <span className="muted">
                      {event.clubId ? game.clubs[event.clubId]?.identity.shortName : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {cards.length > 0 && (
              <>
                <h3>Bookings</h3>
                <ul className="tight-list">
                  {cards.map((event) => (
                    <li key={event.id} className="small">
                      <span className="muted">{event.minute}&#39;</span>{' '}
                      {event.type === 'red-card' ? 'Red' : 'Yellow'} — {playerLabel(game, event.playerId)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3>How they played</h3>
            <div className="xilist">
              {squad.map((slot, index) => {
                const performance = match.performances[slot.playerId];
                const player = playerById(slot.playerId);
                return (
                  <div
                    key={slot.playerId}
                    className={`xilist__row${index >= match.lineups[session.side].starting.length ? ' xilist__row--bench' : ''}`}
                  >
                    <span className="xilist__pos">{slot.position}</span>
                    <span className="truncate">
                      {player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'somebody'}
                    </span>
                    <span className="xilist__rating">
                      {performance && (performance.started || performance.cameOnMinute !== null)
                        ? performance.rating.toFixed(1)
                        : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <h3>Team talk</h3>
            <div className="choices choices--inline">
              {FULL_TIME_TALK_ORDER.map((talk) => (
                <button
                  key={talk}
                  type="button"
                  className={`choice choice--compact${session.fullTimeTalk === talk ? ' choice--on' : ''}`}
                  title={FULL_TIME_TALK_BLURB[talk]}
                  onClick={() => gameActions().setFullTimeTalk(talk)}
                >
                  {FULL_TIME_TALK_LABEL[talk]}
                </button>
              ))}
            </div>
            <MatchStatsPanel match={match} />
            <p className="small muted">{feed.entries[0]?.text ?? 'Full time.'}</p>
          </div>
        </div>

        <footer className="interval__foot">
          <Button variant="ghost" onClick={() => gameActions().openReplay(match.id, 'match')}>
            Watch back
          </Button>
          <Button variant="ghost" onClick={onReport}>
            Full report
          </Button>
          <Button variant="primary" size="lg" onClick={onContinue}>
            Back to the club
          </Button>
        </footer>
      </div>
    </div>
  );
}

/** Warnings the manager would notice himself, from what he can see. */
function selectionWarnings(
  game: GameState,
  match: Match,
  session: MatchSession,
  playerById: (id: string) => Player | undefined,
): string[] {
  const warnings: string[] = [];
  const lineup = match.lineups[session.side];
  const thin = lineup.starting.filter((slot) => {
    const player = playerById(slot.playerId);
    return (player?.fitness ?? 100) < 55;
  });
  const outOfPosition = lineup.starting.filter((slot) => slot.outOfPosition);
  const injured = lineup.starting.filter((slot) => playerById(slot.playerId)?.injury);
  const unavailable = lineup.starting.filter((slot) => {
    const status = playerById(slot.playerId)?.availability.status;
    return status === 'unavailable' || status === 'doubtful';
  });

  if (lineup.starting.length < 11) warnings.push(`Only ${lineup.starting.length} in the XI.`);
  if (unavailable.length > 0) {
    warnings.push(
      `${unavailable.map((slot) => playerById(slot.playerId)?.surname ?? 'somebody').join(', ')} ${
        unavailable.length === 1 ? 'is' : 'are'
      } down as unavailable or doubtful.`,
    );
  }
  if (injured.length > 0) {
    warnings.push(`${injured.map((slot) => playerById(slot.playerId)?.surname ?? 'somebody').join(', ')} carrying a knock.`);
  }
  if (outOfPosition.length > 0) {
    warnings.push(
      `${outOfPosition.map((slot) => playerById(slot.playerId)?.surname ?? 'somebody').join(', ')} out of position — familiar with it in name only.`,
    );
  }
  if (thin.length >= 2) warnings.push(`${thin.length} starters are under 55 fitness. They will fade.`);
  if (lineup.bench.length === 0) warnings.push('No substitutes. An injury leaves you short.');
  void game;
  return warnings;
}

/** How the opposition have been going, in the manager's words. */
function recentForm(game: GameState, clubId: string): string {
  const played = Object.values(game.matches)
    .filter((match) => match.played && match.result && (match.homeClubId === clubId || match.awayClubId === clubId))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5);
  if (played.length === 0) return '';
  const results = played.map((match) => {
    const isHome = match.homeClubId === clubId;
    const mine = isHome ? match.result!.homeGoals : match.result!.awayGoals;
    const theirs = isHome ? match.result!.awayGoals : match.result!.homeGoals;
    return mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
  });
  return `last five: ${results.join('')}`;
}

/** The names a local manager would already know. */
function keyPlayersOf(game: GameState, clubId: string): Player[] {
  return game.clubs[clubId]!.squadIds
    .map((id) => game.people[id])
    .filter(isPlayer)
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 3);
}

function playerLabel(game: GameState, playerId: string | null): string {
  if (!playerId) return 'somebody';
  const person = game.people[playerId];
  return person ? `${person.firstName} ${person.surname}` : 'somebody';
}
