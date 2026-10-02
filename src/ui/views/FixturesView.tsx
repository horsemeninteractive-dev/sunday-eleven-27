import { useState } from 'react';
import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { formatDayMonth } from '@/simulation/calendar';
import { cupRoundOf } from '@/simulation/cup';
import { ordinal } from '@/simulation/news';
import { clubMatches, matchVenueLabel } from '@/simulation/queries';
import { NextFixturePanel } from '../components/FixtureInfo';
import { MatchReportModal } from '../components/MatchReportModal';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { Button, PageHeader, Panel, Pill } from '../components/primitives';

/**
 * What a fixture is for.
 *
 * A club's season is no longer one list of Sundays. It is twenty-two league
 * games, eleven midweek cup ties — each of which is a round of something — and
 * whatever friendlies somebody arranged in July. A schedule that only said
 * "MD 27" was asking the manager to work out all of that themselves, and the
 * matchday numbers are worse than useless on a cup tie because the two
 * competitions are numbered off different bases.
 */
function fixtureKind(
  state: GameState,
  match: Match,
): { label: string; detail: string; tone: 'accent' | 'ok' | 'muted' } {
  const competition: Competition | undefined = state.competitions[match.competitionId];
  // A friendly is arranged between two clubs and belongs to no competition, so
  // it never touches a table, a record or a career appearance.
  if (!competition) {
    return { label: 'Friendly', detail: 'pre-season', tone: 'muted' };
  }
  if (competition.kind === 'cup' && competition.cup) {
    const round = cupRoundOf(state, competition, match);
    const name = competition.name.replace(/^.*Sunday League /, '');
    return {
      label: round > 0 ? `${name} · ${ordinal(round)} round` : name,
      detail: 'midweek cup tie',
      tone: 'accent',
    };
  }
  return {
    label: competition.name.replace(/^.*Sunday League /, ''),
    detail: 'league',
    tone: 'ok',
  };
}

/**
 * The schedule.
 *
 * One list, in the order a fixture list is printed: a month at a time, the games
 * already settled and the games still to come in the same run, with the results
 * sitting in the list where the manager left them. Nothing is split into a
 * "results" panel — reading a season means reading it straight through.
 *
 * The list is one column. A fixture is a line of text and a score, and putting
 * two of them side by side on a page of dates makes the manager read across
 * rather than down, which is the wrong way round for a season diary.
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
  // By date, not by matchday. League matchdays are 1..22 and a cup round is
  // numbered above all of them, so a midweek tie in September sorted on its
  // matchday lands in November's month and at the end of the list. The list is
  // a season diary: it runs in the order the days do.
  const matches = clubMatches(game, club.id).sort(
    (a, b) => a.date.localeCompare(b.date) || a.matchday - b.matchday,
  );
  const played = matches.filter((match) => match.played);
  const upcoming = matches.filter((match) => !match.played);
  const months = groupByMonth(matches);
  const monthInHand = monthLabel((nextFixture ?? matches[matches.length - 1])?.date ?? game.date);
  const report = reportId ? (game.matches[reportId] ?? null) : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Competition"
        title="Fixtures"
        subtitle={`${game.season.label} · ${matches.length} fixtures, ${played.length} played, ${upcoming.length} to come`}
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

      <div className="stack">
        {/* The next game first, at full width: it is the one fixture the manager
            came to this screen for, and it used to sit beside the list in a
            column that made the list itself read two-up. */}
        {nextFixture && <NextFixturePanel state={game} match={nextFixture} />}

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
                    isCurrent={match.id === nextFixture?.id}
                    onOpenReport={match.played ? () => setReportId(match.id) : undefined}
                  />
                ))}
              </ul>
            </Panel>
          );
        })}
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
  const kind = fixtureKind(state, match);

  const row = (
    <>
      <span className="fixture__when">
        <strong>{formatDayMonth(match.date)}</strong>
        <span className="muted small">{match.kickOff}</span>
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
      <span className="fixture__kind">
        <Pill tone={kind.tone}>{kind.label}</Pill>
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
