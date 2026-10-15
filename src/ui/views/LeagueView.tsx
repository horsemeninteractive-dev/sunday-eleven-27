import { useMemo, useState } from 'react';
import type { StandingRow } from '@/domain/club';
import type { Competition, MovementRecord } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { SeasonLeagueRecord } from '@/domain/history';
import type { ClubId, CompetitionId } from '@/domain/ids';
import { formatDayMonth, formatKickOff } from '@/simulation/calendar';
import { currentMatchday, userClub } from '@/simulation/queries';
import { divisionOf, fixtureIdsFor, standingsFor } from '@/simulation/pyramid';
import { lastFinalTable, lastSeasonRecord, movementsFor } from '@/simulation/seasonHistory';
import { ordinal } from '@/simulation/news';
import { gameActions, useGame, useStandings } from '../hooks';
import { divisionShortName, pyramidOptions } from '../worldNav';
import { Button, FormPips, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { FocalFact, MetricTile, Section, TileGrid } from '../components/hierarchy';
import { ClubLink } from '../components/Links';
import { FixtureRow } from '../components/FixtureRow';
import { Statistics } from '../components/Statistics';
import { competitionStats } from '@/simulation/tables';
import { useRememberedSort } from '../rememberedSort';
import { applySort, type SortAccessors } from '../tableSort';

/**
 * Which part of the table a row is in.
 *
 * Read off the competition's own promotion and relegation places rather than off
 * the length of the table, so the top division's two promoted clubs and the
 * bottom division's two relegated ones are marked correctly without any of the
 * three being told it is the top.
 */
export function zoneFor(position: number, size: number, competition: Competition): 'title' | 'promotion' | 'mid' | 'relegation' {
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

/**
 * Whether the club is in the relegation places.
 *
 * Asked of the position in the table, the same way the mark on the row is
 * (`zoneFor`), because the sentence in the focal fact and the colour of the
 * number in the table are about one fact and cannot be allowed two answers.
 */
export function inDropZone(standings: readonly StandingRow[], myPosition: number, competition: Competition): boolean {
  const relegationPlaces = competition.relegationPlaces ?? 0;
  return relegationPlaces > 0 && myPosition > standings.length - relegationPlaces;
}

/**
 * The name of the gap that matters: promotion, survival, or nothing at all.
 *
 * It is told which side of the line the club is on rather than working it out
 * from the competition alone. Read from the competition, a club sitting 19th of
 * 20 was told it stood "Above the drop" — with `0 pts` beside it, because the gap
 * to the last safe club is negative and clamped. The one club the sentence is
 * most about was the one it was least true for.
 */
export function contextLabel(competition: Competition, inDrop: boolean): string {
  if ((competition.promotionPlaces ?? 0) > 0) return 'To promotion';
  if ((competition.relegationPlaces ?? 0) > 0) return inDrop ? 'In the drop' : 'Above the drop';
  return 'Mid-table';
}

/**
 * How far it is to the place that counts, said from whichever side of it the
 * club is on: a cushion when it is safe, and the points that close the gap when
 * it is not.
 */
export function contextValue(
  standings: readonly StandingRow[],
  myPosition: number,
  competition: Competition,
  inDrop: boolean,
): string {
  const promotionPlaces = competition.promotionPlaces ?? 0;
  const relegationPlaces = competition.relegationPlaces ?? 0;
  const mine = standings[myPosition - 1]?.points ?? 0;
  if (promotionPlaces > 0) {
    if (myPosition <= promotionPlaces) return 'in the places';
    const target = standings[promotionPlaces - 1]?.points ?? 0;
    return `${Math.max(0, target - mine + 1)} pts`;
  }
  if (relegationPlaces > 0) {
    const safeIndex = standings.length - relegationPlaces - 1;
    const lastSafe = standings[safeIndex]?.points ?? 0;
    if (inDrop) return `${Math.max(1, lastSafe - mine + 1)} pts from safety`;
    const cushion = mine - lastSafe;
    return cushion > 0 ? `${cushion} pts clear` : 'level on points';
  }
  return '—';
}

/** A standing row that still knows where it sits, whatever the table is sorted by. */
type PositionedRow = StandingRow & { position: number; name: string };

/**
 * Which mark a row of a *finished* table wears.
 *
 * Not `zoneFor`, which reads the competition as it stands this afternoon: the
 * promotion places in a table that was settled last April are a fact about that
 * season, and the ladder's own record of its boundary — the movements written on
 * the save when the season closed — is the only honest way to say who went up
 * and who went down out of it. A club that has since folded or been relegated
 * again still wears the mark it earned; a club that has moved divisions since is
 * shown in the table it actually played in.
 */
export function archivedZone(
  position: number,
  direction: MovementRecord['direction'] | undefined,
): 'title' | 'promotion' | 'relegation' | 'mid' {
  if (position === 1) return 'title';
  if (direction === 'promoted') return 'promotion';
  if (direction === 'relegated') return 'relegation';
  return 'mid';
}

/**
 * A division's final table, from a season that has closed.
 *
 * Read out of the season archive rather than out of the world, because the world
 * has moved on: the clubs in this table have been promoted, relegated, folded or
 * rebuilt since the last Sunday of that season, and the competition it belonged to
 * has been cut again from a different field. It is drawn in its own final order
 * and cannot be sorted — a final table has one shape, and it is the shape it
 * ended in — and it carries no form column, because last season's last five
 * results are of no use to anybody this afternoon.
 *
 * Exported for the same reason the other screens' pieces are: a layout that reads
 * nothing but its props can be printed and checked without a browser.
 */
export function FinalTable({
  game,
  league,
  seasonLabel,
  movements,
  ownClubId,
}: {
  game: GameState;
  league: SeasonLeagueRecord;
  seasonLabel: string;
  movements: readonly MovementRecord[];
  ownClubId: ClubId;
}) {
  const moved = new Map(movements.map((movement) => [movement.clubId, movement.direction]));
  const up = movements.filter((movement) => movement.direction === 'promoted').length;
  const down = movements.filter((movement) => movement.direction === 'relegated').length;
  const champion = league.rows[0] ? game.clubs[league.rows[0].clubId] : undefined;
  const mine = league.rows.findIndex((row) => row.clubId === ownClubId);

  return (
    <>
      <div className="table-wrapper">
        <table className="table table--league">
          <thead>
            <tr>
              <th>#</th>
              <th>Club</th>
              <th>P</th>
              <th className="col--opt">W</th>
              <th className="col--opt">D</th>
              <th className="col--opt">L</th>
              <th className="col--opt">GF</th>
              <th className="col--opt">GA</th>
              <th>GD</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {league.rows.map((row, index) => {
              const direction = moved.get(row.clubId);
              const isMine = row.clubId === ownClubId;
              const zone = archivedZone(index + 1, direction);
              return (
                <tr key={row.clubId} className={isMine ? 'table__row--mine' : undefined}>
                  <td>
                    <span
                      className={`zone zone--${zone}`}
                      title={
                        zone === 'promotion'
                          ? 'Promoted that season'
                          : zone === 'relegation'
                            ? 'Relegated that season'
                            : zone === 'title'
                              ? 'Champions'
                              : undefined
                      }
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td>
                    <ClubLink clubId={row.clubId} town />
                    {isMine && <Pill tone="accent">you</Pill>}
                    {direction === 'promoted' && <Pill tone="ok">promoted</Pill>}
                    {direction === 'relegated' && <Pill tone="bad">relegated</Pill>}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {league.name} in {seasonLabel}, as it stood when the last Sunday was played
        {champion ? ` · won by ${champion.identity.name}` : ''}
        {mine >= 0 ? ` · you finished ${ordinal(mine + 1)}` : ''}.
      </p>
      {/* The boundary, said out loud: the marks in the position column are the
          ladder's own record of who moved, and a manager promoted out of this
          table should be able to read why his old row is lit. */}
      <p className="small muted">
        {up > 0 ? `${up} club${up === 1 ? '' : 's'} went up out of it` : 'Nobody went up out of it'}
        {down > 0 ? ` and ${down} went down.` : '.'}
      </p>
    </>
  );
}


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
  const [sort, setSort] = useRememberedSort('league', game?.saveId ?? null, TABLE_SORT);
  // Which ladder he is looking at, and which division of it. Both are this
  // screen's own view state: a manager reading the district's table has not
  // changed club, and nothing here writes to the world at all.
  const ladders = useMemo(() => (game ? pyramidOptions(game) : []), [game]);
  // Which division he is reading. One piece of view state rather than two,
  // because the choice is one: a rung means nothing without the ladder it is a
  // rung *of* — the district has a Division One of its own — so the ladders are
  // the groups of the selector and the divisions are the options inside them.
  const [picked, setPicked] = useState<CompetitionId | null>(null);
  if (!game) return null;

  const clubRow = userClub(game);
  const ownDivision = divisionOf(game, clubRow.id);
  // Every division of every ladder, each with the ladder it belongs to, in the
  // order the ladders are read in. The county's football as a whole is never the
  // list read here: every district has a Division One at the same rung, and
  // looking up "tier 1" across six ladders would hand a manager a neighbour's
  // table under his own heading.
  const everyDivision = ladders.flatMap((entry) =>
    entry.divisions.map((division) => ({ ladder: entry, division })),
  );
  // The manager opens on his own division; the rest of the ladder is a door away
  // rather than a separate screen, because a pyramid you have to go and look at is
  // not a pyramid. Anywhere else opens where the ladders do — his own first if he
  // is in one, the top of the founding ladder if he is between jobs.
  const shown =
    everyDivision.find((entry) => entry.division.id === picked) ??
    everyDivision.find((entry) => entry.division.id === ownDivision?.id) ??
    everyDivision.find((entry) => entry.ladder.mine) ??
    everyDivision[0];
  if (!shown) return null;
  const { ladder } = shown;
  const competition = shown.division;
  // A selector is only drawn when there is a choice to make: one division in one
  // ladder is not one, and a control that cannot change anything is noise.
  const selectable = ladders.length > 1 || ladder.divisions.length > 1;
  const standings = competition.id === ownDivision?.id ? ownStandings : standingsFor(game, competition);
  // The last season this career finished, and this division's own table from it.
  // The world was rebuilt at the boundary — the divisions cut again, the cups
  // redrawn from the field that came out of it — so the archive is the only place
  // last season's table still exists. A division that did not play that season
  // (the county's second ladder, in its first year) has no record, and says so
  // rather than showing a table from somewhere else.
  const past = lastSeasonRecord(game);
  const final = lastFinalTable(game, competition.id);
  const movements = final ? movementsFor(game, final.season.seasonId, competition.id) : [];

  const matchday = currentMatchday(game);
  const myPosition = standings.findIndex((row) => row.clubId === clubRow.id) + 1;
  const myRow = standings[myPosition - 1];
  const playerCount = competition.clubIds.length;
  const thisWeek = fixtureIdsFor(game, competition.id, matchday);
  const lastWeek = fixtureIdsFor(game, competition.id, matchday - 1);
  // Scoped to this division's clubs, so the charts answer "who is scoring in my
  // division" rather than "who is scoring anywhere in the world".
  const stats = competitionStats(game, competition.clubIds);
  const rows: PositionedRow[] = standings.map((row, index) => ({
    ...row,
    position: index + 1,
    name: game.clubs[row.clubId]?.identity.name ?? '',
  }));
  const sortedRows = applySort(rows, sort, TABLE_SORT);
  const inDrop = inDropZone(standings, myPosition, competition);

  return (
    <div className="stack">
      {/* Whose division this is, said under its own name: a manager browsing one
          of the county's other districts has to be able to see which league he is
          reading before he reads a table off it. */}
      <PageHeader
        eyebrow="Competition"
        title={competition.name}
        photo="/photos/league-trophy.webp"
        subtitle={`${ladder.name} · ${playerCount} clubs · ${promotionLabel(competition)} · ${relegationLabel(competition)}`}
        meta={
          <>
            <span className="small muted">
              {myPosition > 0 && competition.id === ownDivision?.id
                ? `${clubRow.identity.shortName} are ${ordinal(myPosition)}, ${myRow?.points ?? 0} points from ${myRow?.played ?? 0} played`
                : `Viewing ${competition.name}`}
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

      {/* The county's ladders and the divisions inside them, in one control.
          A manager has to be able to reach the league next door — and to leave it
          again — without the screen deciding for him which one he meant, and a
          rung is only meaningful inside a ladder: there is a Division One in the
          district as well as in the county. The ladders are the groups, so the
          county/district choice and the division within it are the same choice
          rather than two rows of tabs — a row that grows with the world, and one
          that wrapped onto a second line on a phone the moment a fifth
          competition existed. */}
      {selectable && (
        <label className="field competition-picker">
          <span className="field__label">Division</span>
          <select className="input" value={competition.id} onChange={(event) => setPicked(event.target.value)}>
            {ladders.map((entry) => (
              <optgroup key={entry.id} label={`${entry.name}${entry.mine ? ' — yours' : ''}`}>
                {entry.divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {divisionShortName(division, entry)}
                    {/* His own division is marked on the option as well as in the
                        table: the whole ladder is somebody's, and only one rung
                        of it is his. */}
                    {division.id === ownDivision?.id ? ' — yours' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      {myPosition > 0 && (
        <>
        {/* The one fact this screen is about: where we are. It was a tile among
            three others, drawn the same size as the goal difference, which is a
            strange way to draw the answer to the only question a table asks. */}
        <FocalFact
          label="Our position"
          value={ordinal(myPosition)}
          note={`${myRow?.points ?? 0} points from ${myRow?.played ?? 0} played`}
          tone="accent"
          aside={
            <span className="small muted">
              {contextLabel(competition, inDrop)} · {contextValue(standings, myPosition, competition, inDrop)}
            </span>
          }
        />
        <TileGrid min={170}>
          <MetricTile
            label="Goal difference"
            value={(myRow?.goalDifference ?? 0) > 0 ? `+${myRow?.goalDifference}` : (myRow?.goalDifference ?? 0)}
            note="For and against"
          />
          <MetricTile label="Form" value={<FormPips form={myRow?.form ?? []} />} note="Last five" />
        </TileGrid>
        </>
      )}

      <p className="small muted">{(competition.promotionPlaces ?? 0) > 0 ? `Top ${competition.promotionPlaces} go up. ` : ''}{(competition.relegationPlaces ?? 0) > 0 ? `Bottom ${competition.relegationPlaces} go down. ` : ''}Coloured position marks follow the club's league place, even when you sort.</p>
      <Section title="The table">
      <Panel level="primary">
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
                      {/* The club and the place it plays in. A table is a list of
                          names a manager meets for the first time here, and the
                          town is the half of that he read off the district map
                          before he picked a club at all. */}
                      <ClubLink clubId={row.clubId} town />
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
      </Section>

      {/* Last season, one click under this one: a manager reads the table he is
          in, and the table he left, without going anywhere else for it. */}
      {final && (
        <details className="more">
          <summary>
            {final.season.seasonLabel} · the final table
            {final.league.rows[0]
              ? ` · won by ${game.clubs[final.league.rows[0].clubId]?.identity.shortName ?? '—'}`
              : ''}
          </summary>
          <FinalTable
            game={game}
            league={final.league}
            seasonLabel={final.season.seasonLabel}
            movements={movements}
            ownClubId={clubRow.id}
          />
        </details>
      )}
      {!final && past && (
        <p className="small muted">
          {competition.name} was not played in {past.seasonLabel}: it is younger than that season.
        </p>
      )}

      <div className="split">
        <Panel title="This week" subtitle={`Matchday ${matchday}`}>
          {thisWeek.length === 0 && <p className="empty">No fixtures listed for this matchday.</p>}
          <ul className="fixture-list">
            {thisWeek.map((id) => {
              const match = game.matches[id];
              if (!match) return null;
              return (
                <FixtureRow
                  key={id}
                  state={game}
                  match={match}
                  meta={formatDayMonth(match.date)}
                  homeClubId={match.homeClubId}
                  awayClubId={match.awayClubId}
                  result={
                    match.result ? (
                      <strong className="fixrow__score">
                        {match.result.homeGoals}–{match.result.awayGoals}
                      </strong>
                    ) : undefined
                  }
                  mine={match.homeClubId === clubRow.id || match.awayClubId === clubRow.id}
                >
                  {formatKickOff(match.kickOff)}
                </FixtureRow>
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
              return (
                <FixtureRow
                  key={id}
                  meta={`${match.result.attendance} att.`}
                  homeClubId={match.homeClubId}
                  awayClubId={match.awayClubId}
                  result={
                    <strong className="fixrow__score">
                      {match.result.homeGoals}–{match.result.awayGoals}
                    </strong>
                  }
                  mine={match.homeClubId === clubRow.id || match.awayClubId === clubRow.id}
                />
              );
            })}
          </ul>
        </Panel>

      <details className="more"><summary>Division statistics · scoring, ratings and discipline</summary><Statistics stats={stats} subtitle={`${competition.name} · matchday ${matchday}`} /></details>
      </div>
    </div>
  );
}
