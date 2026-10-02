import { useState } from 'react';
import type { StandingRow } from '@/domain/club';
import type { Competition } from '@/domain/competition';
import { formatDayMonth } from '@/simulation/calendar';
import { currentMatchday, userClub } from '@/simulation/queries';
import { divisionOf, fixtureIdsFor, leagueCompetitions, standingsFor } from '@/simulation/pyramid';
import { ordinal } from '@/simulation/news';
import { gameActions, useGame, useStandings } from '../hooks';
import { Button, FormPips, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { ClubLink } from '../components/Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

/**
 * Which part of the table a row is in.
 *
 * Read off the competition's own promotion and relegation places rather than off
 * the length of the table, so the top division's two promoted clubs and the
 * bottom division's two relegated ones are marked correctly without any of the
 * three being told it is the top.
 */
function zoneFor(position: number, size: number, competition: Competition): 'title' | 'promotion' | 'mid' | 'relegation' {
  const promotionPlaces = competition.promotionPlaces ?? 0;
  const relegationPlaces = competition.relegationPlaces ?? 0;
  if (position === 1) return 'title';
  if (promotionPlaces > 0 && position <= promotionPlaces) return 'promotion';
  if (relegationPlaces > 0 && position > size - relegationPlaces) return 'relegation';
  return 'mid';
}

function promotionLabel(competition: Competition): string {
  const places = competition.promotionPlaces ?? 0;
  return places === 0 ? 'no promotion place' : places === 1 ? 'one promotion place' : `${places} promoted`;
}

function relegationLabel(competition: Competition): string {
  const places = competition.relegationPlaces ?? 0;
  return places === 0 ? 'nothing to lose' : places === 1 ? 'one relegated' : `${places} relegated`;
}

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
  const ownStandings = useStandings();
  const [sort, setSort] = useState<SortState<TableSortKey>>(UNSORTED);
  // The manager opens on their own division; the rest of the ladder is a door
  // away rather than a separate screen, because a pyramid you have to go and
  // look at is not a pyramid.
  const [tier, setTier] = useState<number | null>(null);
  if (!game) return null;

  const divisions = leagueCompetitions(game);
  const clubRow = userClub(game);
  const ownDivision = divisionOf(game, clubRow.id);
  const competition = divisions.find((entry) => entry.tier === (tier ?? ownDivision?.tier)) ?? divisions[0];
  if (!competition) return null;
  const standings = competition.id === ownDivision?.id ? ownStandings : standingsFor(game, competition);

  const matchday = currentMatchday(game);
  const myPosition = standings.findIndex((row) => row.clubId === clubRow.id) + 1;
  const myRow = standings[myPosition - 1];
  const playerCount = competition.clubIds.length;
  const thisWeek = fixtureIdsFor(game, competition.id, matchday);
  const lastWeek = fixtureIdsFor(game, competition.id, matchday - 1);
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
        subtitle={`${playerCount} clubs · ${promotionLabel(competition)} · ${relegationLabel(competition)}`}
        meta={
          <>
            <span className="small muted">
              {myPosition > 0 && competition.id === ownDivision?.id
                ? `${clubRow.identity.shortName} are ${ordinal(myPosition)}, ${myRow?.points ?? 0} points from ${myRow?.played ?? 0} played`
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

      {divisions.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Divisions">
          {divisions.map((division) => (
            <button
              key={division.id}
              type="button"
              role="tab"
              aria-selected={division.id === competition.id}
              className={`segmented__item${division.id === competition.id ? ' segmented__item--active' : ''}`}
              onClick={() => setTier(division.tier)}
            >
              {division.name.replace(/^.*Sunday League /, '')}
            </button>
          ))}
        </div>
      )}

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
                const isMine = row.clubId === clubRow.id;
                const zone = zoneFor(row.position, rows.length, competition);
                const rival = game.clubs[row.clubId]?.rivalries[clubRow.id];
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
                              : zone === 'title'
                                ? 'Champions'
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
              const involvesUser = match.homeClubId === clubRow.id || match.awayClubId === clubRow.id;
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
            const involvesUser = match.homeClubId === clubRow.id || match.awayClubId === clubRow.id;
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
