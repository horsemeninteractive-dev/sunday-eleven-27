import type { GameState } from '@/domain/game';
import { PITCH_LABEL, WEATHER_LABEL, periodLabel, type Match } from '@/domain/match';
import { currentScore, displayMinute } from '@/simulation/match/matchEngine';
import { expectedAttendanceFor } from '@/simulation/matchday';
import { matchKitColours, shirtLine } from '../kit';
import { ClubBadge } from '../components/Badge';
import { formatKickOff } from '@/simulation/calendar';

/**
 * The one line the manager never has to look for.
 *
 * Score, clock and who is playing are always in the same place, at the same
 * size, for the whole afternoon — and never take more vertical space than they
 * need, because the match itself is what is on screen.
 */

export type MatchPhase = 'pre-match' | 'in-progress' | 'half-time' | 'full-time';

/**
 * The clock, in the header's own words.
 *
 * Exported because the full-pitch view prints the same sentence over the grass:
 * a board reading `72'` while the header it replaced said something else would
 * be two accounts of one afternoon. Before the whistle it is the kick-off time,
 * at the whistle it is the phase, and in between it is the minute the engine is
 * actually playing — `displayMinute`, the same clock the pitch is drawn from.
 */
export function matchStatus(match: Match, phase: MatchPhase): string {
  return phase === 'pre-match'
    ? `Kick-off ${formatKickOff(match.kickOff)}`
    : phase === 'half-time'
      ? 'Half time'
      : phase === 'full-time'
        ? 'Full time'
        : `${periodLabel(match)} · ${displayMinute(match)}'`;
}

/**
 * The clock as a scorecard says it: the minute alone while the football is being
 * played, and the header's phrase at the three moments it is not.
 *
 * The header has the room for `Second half · 72'`, and on a line of its own that
 * is the right sentence. A broadcast bar has the room for one number, and the
 * number is the minute — kick-off, half time and full time are the cases where
 * there is no minute to give and the phrase is the whole of the answer. The
 * minute comes from the same `displayMinute` the header reads, so the bar and the
 * header are never a minute apart.
 */
export function matchClock(match: Match, phase: MatchPhase): string {
  return phase === 'in-progress' ? `${displayMinute(match)}'` : matchStatus(match, phase);
}

export function MatchHeader({
  game,
  match,
  side,
  phase,
}: {
  game: GameState;
  match: Match;
  side: 'home' | 'away';
  phase: MatchPhase;
}) {
  const home = game.clubs[match.homeClubId]!;
  const away = game.clubs[match.awayClubId]!;
  // The bar is the two *shirts*, not the two clubs. A side that has changed into
  // a white away strip is white here, because that is what the manager is
  // looking at when he glances up to see who is who.
  const kits = matchKitColours(game, match.homeClubId, match.awayClubId);
  const ground = game.world.grounds[match.groundId];
  const score = currentScore(match);
  const referee = match.refereeId ? game.people[match.refereeId] : undefined;
  const refereeName = referee ? `${referee.firstName} ${referee.surname}` : 'to be confirmed';

  const status = matchStatus(match, phase);

  const attendance = match.result
    ? `${match.result.attendance} watching`
    : match.played
      ? 'Attendance to follow'
      : `~${expectedAttendanceFor(game, match)} expected`;

  return (
    <header className="matchhead">
      {/* The line across the top is the two shirts: the home strip on the left,
          the away strip on the right, meeting in the middle. */}
      <span
        className="matchhead__stripe"
        aria-hidden="true"
        style={{ background: shirtLine(kits) }}
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
