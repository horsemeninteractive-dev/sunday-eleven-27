import { useState } from 'react';
import type { StandingRow } from '@/domain/club';
import { formatDayMonth } from '@/simulation/calendar';
import { currentMatchday } from '@/simulation/queries';
import { ordinal } from '@/simulation/news';
import { gameActions, useGame, useStandings } from '../hooks';
import { Button, FormPips, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { ClubLink } from '../components/Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

/** A standing row that still knows where it sits, whatever the table is sorted by. */
type PositionedRow = StandingRow & { position: number; name: string };

type TableSortKey =
  | 'position'
  | 'club'
  | 'played'
  | 'won'
  | 'drawn'
  | 'lost'
  | 'goalsFor'
  | 'goalsAgainst'
  | 'goalDifference'
  | 'points'
  | 'form';

const TABLE_SORT: SortAccessors<PositionedRow, TableSortKey> = {
  position: (row) => row.position,
  club: (row) => row.name,
  played: (row) => row.played,
  won: (row) => row.won,
  drawn: (row) => row.drawn,
  lost: (row) => row.lost,
  goalsFor: (row) => row.goalsFor,
  goalsAgainst: (row) => row.goalsAgainst,
  goalDifference: (row) => row.goalDifference,
  points: (row) => row.points,
  // The last few results, counted as points won.
  form: (row) => row.form.reduce((total, result) => total + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0),
};

/**
 * The league table.
 *
 * Scannable first: position, club, played, goal difference, points. The extra
 * columns are there on a laptop and step aside on a phone rather than being
 * squeezed into something nobody can read.
 *
 * Sorting never moves anybody: the row carries the place it holds in the
 * division with it, so the promotion and relegation marks stay on the clubs
 * they belong to however the table is read.
 */
export function LeagueView() {
  const game = useGame();
  const standings = useStandings();
  const [sort, setSort] = useState<SortState<TableSortKey>>(UNSORTED);
  if (!game) return null;

  const competition = Object.values(game.competitions)[0]!;
  const club = game.clubs[game.userClubId]!;
  const matchday = currentMatchday(game);
  const myPosition = standings.findIndex((row) => row.clubId === club.id) + 1;
  const myRow = standings[myPosition - 1];
  const playerCount = competition.clubIds.length;
  const thisWeek = game.fixtures.byMatchday[matchday] ?? [];
  const lastWeek = game.fixtures.byMatchday[matchday - 1] ?? [];
  const rows: PositionedRow[] = standings.map((row, index) => ({
    ...row,
    position: index + 1,
    name: game.clubs[row.clubId]?.identity.name ?? '',
  }));
  const sortedRows = applySort(rows, sort, TABLE_SORT);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Competition"
        title={competition.name}
        subtitle={`${playerCount} clubs · one promotion place · two relegated · up to ${game.season.calendar.length} matchdays`}
        meta={
          <>
            <span className="small muted">
              {myPosition > 0
                ? `${club.identity.shortName} are ${ordinal(myPosition)}, ${myRow?.points ?? 0} points from ${myRow?.played ?? 0} played`
                : 'The season has not started yet'}
            </span>
            <span className="small muted">Matchday {matchday}</span>
          </>
        }
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('fixtures')}>
            Your fixtures
          </Button>
        }
      />

      <Panel level="primary" title="The table" subtitle="Where everyone stands right now">
        <div className="table-wrapper">
          <table className="table table--league">
            <thead>
              <tr>
                <SortTh label="#" sortKey="position" title="Sort by league position" sort={sort} onSort={setSort} />
                <SortTh label="Club" sortKey="club" sort={sort} onSort={setSort} />
                <SortTh label="P" title="Sort by played" sortKey="played" sort={sort} onSort={setSort} />
                <SortTh label="W" title="Sort by won" sortKey="won" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="D" title="Sort by drawn" sortKey="drawn" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="L" title="Sort by lost" sortKey="lost" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="GF" title="Sort by goals for" sortKey="goalsFor" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="GA" title="Sort by goals against" sortKey="goalsAgainst" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="GD" title="Sort by goal difference" sortKey="goalDifference" sort={sort} onSort={setSort} />
                <SortTh label="Pts" title="Sort by points" sortKey="points" sort={sort} onSort={setSort} />
                <SortTh label="Form" title="Sort by recent form" sortKey="form" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isMine = row.clubId === club.id;
                const zone = row.position === 1 ? 'promotion' : row.position > rows.length - 2 ? 'relegation' : 'mid';
                const rival = game.clubs[row.clubId]?.rivalries[club.id];
                return (
                  <tr key={row.clubId} className={isMine ? 'table__row--mine' : undefined}>
                    <td>
                      <span
                        className={`zone zone--${zone}`}
                        title={
                          zone === 'promotion'
                            ? 'Promotion place'
                            : zone === 'relegation'
                              ? 'Relegation place'
                              : undefined
                        }
                      >
                        {row.position}
                      </span>
                    </td>
                    <td>
                      <ClubLink clubId={row.clubId} />
                      {isMine && <Pill tone="accent">you</Pill>}
                      {rival && !isMine && (
                        <span className="muted small" title={rival.note}>
                          {' '}
                          derby
                        </span>
                      )}
                    </td>
                    <td>{row.played}</td>
                    <td className="col--opt">{row.won}</td>
                    <td className="col--opt">{row.drawn}</td>
                    <td className="col--opt">{row.lost}</td>
                    <td className="col--opt">{row.goalsFor}</td>
                    <td className="col--opt">{row.goalsAgainst}</td>
                    <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                    <td>
                      <strong>{row.points}</strong>
                    </td>
                    <td>
                      <FormPips form={row.form} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="split">
        <Panel title="This week" subtitle={`Matchday ${matchday}`}>
          {thisWeek.length === 0 && <p className="empty">No fixtures listed for this matchday.</p>}
          <ul className="fixture-list">
            {thisWeek.map((id) => {
              const match = game.matches[id];
              if (!match) return null;
              const home = game.clubs[match.homeClubId]!;
              const away = game.clubs[match.awayClubId]!;
              const involvesUser = match.homeClubId === club.id || match.awayClubId === club.id;
              return (
                <li key={id} className={`result-row${involvesUser ? ' result-row--mine' : ''}`}>
                  <span className="muted small">{formatDayMonth(match.date)}</span>
                  <span>
                    {home.identity.shortName} <span className="muted">v</span> {away.identity.shortName}
                  </span>
                  <span>
                    {match.result ? (
                      <strong>
                        {match.result.homeGoals}–{match.result.awayGoals}
                      </strong>
                    ) : (
                      <span className="muted small">{match.kickOff}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel level="quiet" title="Last week" subtitle="Results elsewhere in the division">
          {matchday <= 1 && <p className="empty">First week of the season — no previous results yet.</p>}
          <ul className="fixture-list">
            {lastWeek.map((id) => {
              const match = game.matches[id];
              if (!match || !match.result) return null;
              const home = game.clubs[match.homeClubId]!;
              const away = game.clubs[match.awayClubId]!;
              const involvesUser = match.homeClubId === club.id || match.awayClubId === club.id;
              return (
                <li key={id} className={`result-row${involvesUser ? ' result-row--mine' : ''}`}>
                  <span className="muted small">{match.result.attendance} att.</span>
                  <span>
                    {home.identity.shortName} v {away.identity.shortName}
                  </span>
                  <span>
                    <strong>
                      {match.result.homeGoals}–{match.result.awayGoals}
                    </strong>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
