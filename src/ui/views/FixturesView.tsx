import { useState } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { formatDayMonth } from '@/simulation/calendar';
import { clubMatches, currentMatchday as currentMatchdayNumber, matchVenueLabel } from '@/simulation/queries';
import { NextFixturePanel } from '../components/FixtureInfo';
import { MatchReportModal } from '../components/MatchReportModal';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { Button, PageHeader, Panel, Pill } from '../components/primitives';

/**
 * The schedule.
 *
 * One list, in the order a fixture list is printed: a month at a time, the games
 * already settled and the games still to come in the same run, with the results
 * sitting in the list where the manager left them. Nothing is split into a
 * "results" panel — reading a season means reading it straight through.
 *
 * Opening a report is a detour rather than a destination, so it opens over the
 * top of the page and the list is exactly where it was when it closes.
 */
export function FixturesView() {
  const game = useGame();
  const nextFixture = useNextFixture();
  const [reportId, setReportId] = useState<string | null>(null);

  if (!game) return null;
  const club = game.clubs[game.userClubId]!;
  const matches = clubMatches(game, club.id).sort((a, b) => a.matchday - b.matchday);
  const played = matches.filter((match) => match.played);
  const upcoming = matches.filter((match) => !match.played);
  const currentMatchday = currentMatchdayNumber(game);
  const months = groupByMonth(matches);
  const monthInHand = monthLabel((nextFixture ?? matches[matches.length - 1])?.date ?? game.date);
  const report = reportId ? (game.matches[reportId] ?? null) : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Competition"
        title="Fixtures"
        subtitle={`${game.season.label} · ${matches.length} league fixtures, ${played.length} played, ${upcoming.length} to come`}
        meta={
          nextFixture ? (
            <span className="small muted">
              Next: {matchVenueLabel(nextFixture, club.id)} against{' '}
              {game.clubs[nextFixture.homeClubId === club.id ? nextFixture.awayClubId : nextFixture.homeClubId]!.identity.name}{' '}
              · {formatDayMonth(nextFixture.date)}, {nextFixture.kickOff}
            </span>
          ) : (
            <span className="small muted">Nothing left this season.</span>
          )
        }
        actions={
          nextFixture ? (
            <Button variant="ghost" onClick={() => gameActions().setView('team')}>
              Team selection
            </Button>
          ) : undefined
        }
      />

      <div className="flow">
        {months.map(({ label, matches: monthMatches }) => {
          const monthPlayed = monthMatches.filter((match) => match.played).length;
          const monthToCome = monthMatches.length - monthPlayed;
          return (
            <Panel
              key={label}
              level={label === monthInHand ? 'primary' : 'default'}
              title={label}
              subtitle={
                monthToCome === 0
                  ? `${monthPlayed} played`
                  : monthPlayed === 0
                    ? `${monthToCome} to come`
                    : `${monthPlayed} played · ${monthToCome} to come`
              }
            >
              <ul className="fixture-list">
                {monthMatches.map((match) => (
                  <FixtureRow
                    key={match.id}
                    state={game}
                    match={match}
                    isCurrent={!match.played && match.matchday === currentMatchday}
                    onOpenReport={match.played ? () => setReportId(match.id) : undefined}
                  />
                ))}
              </ul>
            </Panel>
          );
        })}

        {/* The next game, with everything known about it, so the space beside
            the schedule is the most useful thing on the screen rather than an
            empty column. */}
        {nextFixture && <NextFixturePanel state={game} match={nextFixture} />}
      </div>

      {report && <MatchReportModal state={game} match={report} onClose={() => setReportId(null)} />}
    </div>
  );
}

/**
 * One fixture in the list.
 *
 * A game that has been played opens its report; a game that has not has nothing
 * to open, so it is not a button and does not pretend to be.
 */
function FixtureRow({
  state,
  match,
  isCurrent,
  onOpenReport,
}: {
  state: GameState;
  match: Match;
  isCurrent: boolean;
  onOpenReport?: () => void;
}) {
  const venue = matchVenueLabel(match, state.userClubId);
  const opponentId = match.homeClubId === state.userClubId ? match.awayClubId : match.homeClubId;
  const opponent = state.clubs[opponentId]!;
  const result = match.result;
  const ground = state.world.grounds[match.groundId];

  const row = (
    <>
      <span className="fixture__when">
        <strong>{formatDayMonth(match.date)}</strong>
        <span className="muted small">MD {match.matchday}</span>
      </span>
      <span className="fixture__teams">
        <strong>
          {venue === 'Home' ? 'v ' : 'at '}
          {opponent.identity.name}
        </strong>
        <span className="muted small">
          {venue} · {ground?.name}
          {isCurrent ? ' · next up' : ''}
        </span>
      </span>
      <span className="fixture__score">
        {result ? (
          <Pill tone={outcomeTone(state, match)}>
            {result.homeGoals}–{result.awayGoals}
          </Pill>
        ) : (
          <Pill tone={isCurrent ? 'accent' : 'muted'}>{match.kickOff}</Pill>
        )}
      </span>
    </>
  );

  return (
    <li>
      {onOpenReport ? (
        <button
          type="button"
          className="fixture fixture--played"
          onClick={onOpenReport}
          aria-current={isCurrent ? 'true' : undefined}
          title="Open the match report"
        >
          {row}
        </button>
      ) : (
        <div className={`fixture fixture--static${isCurrent ? ' fixture--current' : ''}`} aria-current={isCurrent ? 'true' : undefined}>
          {row}
        </div>
      )}
    </li>
  );
}

function outcomeTone(state: GameState, match: Match): 'ok' | 'bad' | 'warn' | 'muted' {
  if (!match.result) return 'muted';
  const isHome = match.homeClubId === state.userClubId;
  const own = isHome ? match.result.homeGoals : match.result.awayGoals;
  const other = isHome ? match.result.awayGoals : match.result.homeGoals;
  if (own > other) return 'ok';
  if (own === other) return 'warn';
  return 'bad';
}

function groupByMonth(matches: Match[]): Array<{ label: string; matches: Match[] }> {
  const groups: Array<{ label: string; matches: Match[] }> = [];
  for (const match of matches) {
    const label = monthLabel(match.date);
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.matches.push(match);
    else groups.push({ label, matches: [match] });
  }
  return groups;
}

function monthLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
