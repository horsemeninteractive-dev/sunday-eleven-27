import { useState } from 'react';
import type { ClubSeasonRecord } from '@/domain/club';
import { isPlayer } from '@/domain/person';
import { formatShortDate } from '@/simulation/calendar';
import { clubMatches, squadOf } from '@/simulation/queries';
import { gameActions, useGame } from '../hooks';
import { playerName } from '../format';
import { Button, PageHeader, Panel, Pill, SortTh, Stat } from '../components/primitives';
import { ClubLink, CompetitionLink, PlayerLink } from '../components/Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

type SeasonSortKey =
  | 'season'
  | 'competition'
  | 'played'
  | 'won'
  | 'drawn'
  | 'lost'
  | 'goalsFor'
  | 'goalsAgainst'
  | 'points'
  | 'finished';

const SEASON_SORT: SortAccessors<ClubSeasonRecord, SeasonSortKey> = {
  season: (season) => season.seasonLabel,
  competition: (season) => season.competitionName,
  played: (season) => season.played,
  won: (season) => season.won,
  drawn: (season) => season.drawn,
  lost: (season) => season.lost,
  goalsFor: (season) => season.goalsFor,
  goalsAgainst: (season) => season.goalsAgainst,
  points: (season) => season.points,
  // A season still being played has no finishing place, so it sorts to the end.
  finished: (season) => season.finalPosition,
};

/**
 * History.
 *
 * The beginning of the club's archive: honours, records, the moments that were
 * written down and the seasons behind them. It is a quiet screen by design —
 * reference material should not shout over the current week.
 */
export function HistoryView() {
  const game = useGame();
  const [sort, setSort] = useState<SortState<SeasonSortKey>>(UNSORTED);
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const history = club.history;
  const seasonAt = history.seasons[0];
  const squad = squadOf(game, club.id);
  const matches = clubMatches(game, club.id).filter((match) => match.played);
  const allPlayers = Object.values(game.people)
    .filter(isPlayer)
    .filter((player) => player.clubId === club.id);
  const topScorer = allPlayers.slice().sort((a, b) => b.record.goals - a.record.goals)[0];
  const mostAppearances = squad.slice().sort((a, b) => b.record.appearances - a.record.appearances)[0];
  const seasons = applySort(
    history.seasons.filter((season) => season.played > 0),
    sort,
    SEASON_SORT,
  );
  const biggest = biggestWin(club.id, matches);
  const recent = matches.slice().sort((a, b) => b.matchday - a.matchday).slice(0, 8);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club admin"
        title="History"
        subtitle={`Founded ${history.founded} · ${history.seasons.length} season${history.seasons.length === 1 ? '' : 's'} on record`}
        meta={
          <>
            <span className="small muted">{club.identity.nickname}</span>
            <span className="small muted">
              {history.honours.length > 0 ? `${history.honours.length} honour${history.honours.length === 1 ? '' : 's'}` : 'No honours yet'}
            </span>
          </>
        }
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('fixtures')}>
            Match archive
          </Button>
        }
      />

      <Panel level="primary" title={`${game.season.label} so far`} subtitle="This season, and the records that sit behind it">
        <div className="stat-grid stat-grid--wide">
          <Stat label="Played" value={seasonAt?.played ?? 0} />
          <Stat
            label="Record"
            value={`${seasonAt?.won ?? 0}W ${seasonAt?.drawn ?? 0}D ${seasonAt?.lost ?? 0}L`}
            hint="League matches only"
          />
          <Stat label="Goals for / against" value={`${seasonAt?.goalsFor ?? 0} / ${seasonAt?.goalsAgainst ?? 0}`} />
          <Stat label="Points" value={seasonAt?.points ?? 0} />
          <Stat
            label="Most appearances"
            value={mostAppearances ? `${mostAppearances.surname} (${mostAppearances.record.appearances})` : '—'}
            hint="Career totals for players still at the club"
          />
          <Stat
            label="Leading scorer"
            value={topScorer && topScorer.record.goals > 0 ? `${topScorer.surname} (${topScorer.record.goals})` : '—'}
          />
        </div>

        {history.honours.length > 0 ? (
          <ul className="tight-list">
            {history.honours.map((honour) => (
              <li key={honour}>
                <Pill tone="accent">Honour</Pill> {honour}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">
            Nothing in the cabinet yet. The county league gives out one promotion place a season, and everyone else
            remembers a good run in November.
          </p>
        )}

        {biggest && (
          <p className="small">
            <strong>Biggest win on record:</strong> {biggest.score} against{' '}
            {game.clubs[biggest.opponentId] ? (
              <ClubLink clubId={biggest.opponentId} />
            ) : (
              'somebody'
            )}{' '}
            on {formatShortDate(biggest.date)}.
          </p>
        )}
      </Panel>

      <Panel title="Notable events" subtitle="The world remembers">
        {history.notableEvents.length === 0 && <p className="empty">Nothing notable on record yet.</p>}
        <ul className="timeline">
          {history.notableEvents.map((event, index) => (
            <li key={`${event.date}-${index}`} className={`timeline__item timeline__item--${event.importance}`}>
              <span className="timeline__date">{formatShortDate(event.date)}</span>
              <span>{event.description}</span>
              <span className="muted small">{event.seasonLabel}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        level="quiet"
        title="Recent matches"
        subtitle="The last eight, newest first"
        actions={
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('fixtures')}>
            All of them
          </Button>
        }
      >
        {recent.length === 0 && <p className="empty">No matches played yet.</p>}
        <ul className="fixture-list">
          {recent.map((match) => {
            const home = game.clubs[match.homeClubId]!;
            const away = game.clubs[match.awayClubId]!;
            const isHome = match.homeClubId === club.id;
            const mine = isHome ? match.result!.homeGoals : match.result!.awayGoals;
            const theirs = isHome ? match.result!.awayGoals : match.result!.homeGoals;
            return (
              <li key={match.id} className="result-row">
                <span className="muted small">{formatShortDate(match.date)}</span>
                <span>
                  <ClubLink clubId={home.id}>{home.identity.shortName}</ClubLink>{' '}
                  {match.result!.homeGoals}–{match.result!.awayGoals}{' '}
                  <ClubLink clubId={away.id}>{away.identity.shortName}</ClubLink>
                </span>
                <span>
                  <Pill tone={mine > theirs ? 'ok' : mine === theirs ? 'warn' : 'bad'}>
                    {mine > theirs ? 'Won' : mine === theirs ? 'Drew' : 'Lost'}
                  </Pill>
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel level="quiet" title="Season by season" subtitle="League record only — cups are not in this build">
        {seasons.length === 0 && <p className="empty">No completed matches yet.</p>}
        {seasons.length > 0 && (
          <div className="table-wrapper">
            <table className="table table--stack">
              <thead>
                <tr>
                  <SortTh label="Season" sortKey="season" sort={sort} onSort={setSort} />
                  <SortTh label="Competition" sortKey="competition" sort={sort} onSort={setSort} />
                  <SortTh label="P" title="Sort by played" sortKey="played" sort={sort} onSort={setSort} />
                  <SortTh label="W" title="Sort by won" sortKey="won" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="D" title="Sort by drawn" sortKey="drawn" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="L" title="Sort by lost" sortKey="lost" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="GF" title="Sort by goals for" sortKey="goalsFor" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="GA" title="Sort by goals against" sortKey="goalsAgainst" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="Pts" title="Sort by points" sortKey="points" sort={sort} onSort={setSort} />
                  <SortTh label="Finished" sortKey="finished" sort={sort} onSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.seasonId}>
                    <td>{season.seasonLabel}</td>
                    <td className="muted small" data-label="Competition">
                      <CompetitionLink>{season.competitionName}</CompetitionLink>
                    </td>
                    <td data-label="Played">{season.played}</td>
                    <td className="col--opt" data-label="Won">
                      {season.won}
                    </td>
                    <td className="col--opt" data-label="Drawn">
                      {season.drawn}
                    </td>
                    <td className="col--opt" data-label="Lost">
                      {season.lost}
                    </td>
                    <td className="col--opt" data-label="Goals for">
                      {season.goalsFor}
                    </td>
                    <td className="col--opt" data-label="Goals against">
                      {season.goalsAgainst}
                    </td>
                    <td data-label="Points">
                      <strong>{season.points}</strong>
                    </td>
                    <td data-label="Finished">{season.finalPosition ?? 'in progress'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel level="quiet" title="Managers" subtitle="Past and present">
        <ul className="tight-list">
          {history.managers.map((manager) => (
            <li key={`${manager.personId}-${manager.from}`}>
              <strong>{manager.name}</strong>{' '}
              <span className="muted small">
                from {formatShortDate(manager.from)}
                {manager.to ? ` to ${formatShortDate(manager.to)}` : ' (current)'}
              </span>
            </li>
          ))}
        </ul>
        {mostAppearances && (
          <p className="muted small">
            Longest-serving player in the current squad:{' '}
            <PlayerLink personId={mostAppearances.id}>{playerName(mostAppearances)}</PlayerLink> since{' '}
            {formatShortDate(mostAppearances.joinedClubOn)}.
          </p>
        )}
      </Panel>
    </div>
  );
}

/** The heaviest win on record, or nothing if the club has never won by two. */
function biggestWin(clubId: string, matches: ReturnType<typeof clubMatches>) {
  let best: { score: string; opponentId: string; date: string; margin: number } | null = null;
  for (const match of matches) {
    const result = match.result;
    if (!result) continue;
    const isHome = match.homeClubId === clubId;
    const mine = isHome ? result.homeGoals : result.awayGoals;
    const theirs = isHome ? result.awayGoals : result.homeGoals;
    const margin = mine - theirs;
    if (margin <= 1) continue;
    if (best && best.margin >= margin) continue;
    best = {
      score: `${mine}–${theirs}`,
      opponentId: isHome ? match.awayClubId : match.homeClubId,
      date: match.date,
      margin,
    };
  }
  return best;
}
