import type { GameState } from '@/domain/game';
import { PITCH_LABEL, WEATHER_LABEL, type Match } from '@/domain/match';
import { currentScore, displayMinute } from '@/simulation/match/engine';
import { expectedAttendanceFor } from '@/simulation/matchday';
import { ClubBadge } from '../components/Badge';

/**
 * The one line the manager never has to look for.
 *
 * Score, clock and who is playing are always in the same place, at the same
 * size, for the whole afternoon — and never take more vertical space than they
 * need, because the match itself is what is on screen.
 */

export function MatchHeader({
  game,
  match,
  side,
  phase,
}: {
  game: GameState;
  match: Match;
  side: 'home' | 'away';
  phase: 'pre-match' | 'in-progress' | 'half-time' | 'full-time';
}) {
  const home = game.clubs[match.homeClubId]!;
  const away = game.clubs[match.awayClubId]!;
  const ground = game.world.grounds[match.groundId];
  const score = currentScore(match);
  const referee = match.refereeId ? game.people[match.refereeId] : undefined;
  const refereeName = referee ? `${referee.firstName} ${referee.surname}` : 'to be confirmed';

  const status =
    phase === 'pre-match'
      ? `Kick-off ${match.kickOff}`
      : phase === 'half-time'
        ? 'Half time'
        : phase === 'full-time'
          ? 'Full time'
          : `${match.half === 1 ? 'First half' : 'Second half'} · ${displayMinute(match)}'`;

  const attendance = match.result
    ? `${match.result.attendance} watching`
    : match.played
      ? 'Attendance to follow'
      : `~${expectedAttendanceFor(game, match)} expected`;

  return (
    <header className="matchhead">
      {/* The line across the top is the two clubs: the home colour on the left,
          the away colour on the right, meeting in the middle. */}
      <span
        className="matchhead__stripe"
        aria-hidden="true"
        style={{
          background: `linear-gradient(90deg, ${home.identity.colours.primary} 0, ${home.identity.colours.primary} 50%, ${away.identity.colours.primary} 50%, ${away.identity.colours.primary} 100%)`,
        }}
      />
      <div className="matchhead__team matchhead__team--home">
        <span className="matchhead__crest">
          <ClubBadge club={home} />
        </span>
        <span className="matchhead__names">
          <strong>{home.identity.name}</strong>
          {side === 'home' && <span className="matchhead__you">You</span>}
        </span>
      </div>

      <div className="matchhead__centre">
        <div className="matchhead__score">
          <span>{score.home}</span>
          <span className="matchhead__dash">–</span>
          <span>{score.away}</span>
        </div>
        <div className="matchhead__clock">{status}</div>
      </div>

      <div className="matchhead__team matchhead__team--away">
        <span className="matchhead__names matchhead__names--right">
          <strong>{away.identity.name}</strong>
          {side === 'away' && <span className="matchhead__you">You</span>}
        </span>
        <span className="matchhead__crest">
          <ClubBadge club={away} />
        </span>
      </div>

      <p className="matchhead__meta">
        <span>{match.competitionName}</span>
        <span>{ground?.name ?? 'Ground to confirm'}</span>
        <span>{attendance}</span>
        <span>
          {WEATHER_LABEL[match.conditions.weather]} · {PITCH_LABEL[match.conditions.pitch]} pitch
        </span>
        <span>Referee: {refereeName}</span>
      </p>
    </header>
  );
}
