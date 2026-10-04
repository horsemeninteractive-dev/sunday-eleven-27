import { useState } from 'react';
import { CLUB_STRUCTURE_LABEL, type Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import { isPlayer } from '@/domain/person';
import { leaguePosition, squadAverageAge } from '@/simulation/queries';
import { useGame } from '../hooks';
import { moneyShort } from '../format';
import { PageHeader, Panel, Pill, SortTh, Stat } from '../components/primitives';
import { MetricTile, Section, TileGrid } from '../components/hierarchy';
import { ClubLink, PlayerLink } from '../components/Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

type ClubSortKey =
  | 'club'
  | 'town'
  | 'ground'
  | 'structure'
  | 'founded'
  | 'squad'
  | 'averageAge'
  | 'position'
  | 'balance';

/** What each heading reads. Some of it only means anything with the world to hand. */
function clubSort(game: GameState): SortAccessors<Club, ClubSortKey> {
  return {
    club: (club) => club.identity.name,
    town: (club) => game.world.towns[club.townId]?.name ?? '',
    ground: (club) => game.world.grounds[club.groundId]?.name ?? '',
    structure: (club) => CLUB_STRUCTURE_LABEL[club.structure],
    founded: (club) => club.identity.foundedYear,
    squad: (club) => club.squadIds.length,
    averageAge: (club) => squadAverageAge(club.squadIds.map((id) => game.people[id]).filter(isPlayer)),
    // Clubs outside the division are not in a table and sort to the bottom.
    position: (club) => leaguePosition(game, club.id) ?? 99,
    balance: (club) => club.finances.balance,
  };
}

export function WorldView() {
  const game = useGame();
  const [clubId, setClubId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<ClubSortKey>>(UNSORTED);
  if (!game) return null;

  const towns = Object.values(game.world.towns);
  const clubs = Object.values(game.clubs);
  const grounds = Object.values(game.world.grounds);
  const businesses = Object.values(game.world.businesses);
  const selected = clubId ? game.clubs[clubId] : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="World"
        title="The local game"
        meta={
          <>
            <span className="small muted">{clubs.length} clubs</span>
            <span className="small muted">{grounds.length} grounds</span>
            <span className="small muted">{towns.length} towns and villages</span>
          </>
        }
      />

      <Section title={`${game.world.regionName}, ${game.world.countyName}`}>
        <TileGrid min={170}>
          <MetricTile label="Clubs" value={clubs.length} tone="accent" />
          <MetricTile label="Towns and villages" value={towns.length} />
          <MetricTile label="Grounds" value={grounds.length} />
          <MetricTile label="Pubs and businesses" value={businesses.length} />
          <MetricTile label="Population covered" value={towns.reduce((sum, town) => sum + town.population, 0).toLocaleString('en-GB')} />
        </TileGrid>
      </Section>

      <details className="more">
        <summary className="small muted">Towns and grounds</summary>
      <div className="split">
        <Panel title="Towns and villages">
          <ul className="tight-list">
            {towns
              .slice()
              .sort((a, b) => b.population - a.population)
              .map((town) => {
                const townClubs = clubs.filter((club) => club.townId === town.id);
                return (
                  <li key={town.id} className="town">
                    <div>
                      <strong>{town.name}</strong>{' '}
                      <Pill tone="muted">
                        {town.kind} · {town.population.toLocaleString('en-GB')}
                      </Pill>
                      <div className="muted small">{town.description}</div>
                      <div className="muted small">
                        {townClubs.length === 0
                          ? 'No clubs of its own — players travel out.'
                          : townClubs.map((club) => club.identity.shortName).join(', ')}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        </Panel>

        <Panel title="Grounds" subtitle="Surfaces, drainage and floodlights all matter on a Sunday morning">
          <ul className="tight-list">
            {grounds.map((ground) => {
              const tenant = ground.tenantClubId ? game.clubs[ground.tenantClubId] : null;
              return (
                <li key={ground.id}>
                  <strong>{ground.name}</strong>{' '}
                  <span className="muted small">
                    {game.world.towns[ground.townId]?.name} · {ground.surface} · quality {ground.quality}/20 · drainage{' '}
                    {ground.drainage}/20 · cap {ground.capacity}
                    {ground.hasFloodlights ? ' · floodlights' : ''}
                    {ground.hasChangingRooms ? ' · changing rooms' : ' · no changing rooms'}
                    {ground.sharedWith.length > 0 ? ` · shared by ${ground.sharedWith.length + 1} clubs` : ''}
                  </span>
                  {tenant && <div className="muted small">Home of {tenant.identity.name}</div>}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      </details>

      <Section title="Clubs in the local game">
      <Panel flush>
        <div className="table-wrapper">
        <table className="table table--stack">
          <thead>
            <tr>
              <SortTh label="Club" sortKey="club" sort={sort} onSort={setSort} />
                <SortTh label="Town" sortKey="town" sort={sort} onSort={setSort} />
                <SortTh label="Ground" sortKey="ground" sort={sort} onSort={setSort} />
                <SortTh label="Structure" sortKey="structure" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="Founded" sortKey="founded" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="Squad" sortKey="squad" sort={sort} onSort={setSort} />
                <SortTh label="Avg age" sortKey="averageAge" sort={sort} onSort={setSort} className="col--opt" />
                <SortTh label="Position" sortKey="position" sort={sort} onSort={setSort} />
                <SortTh label="Balance" sortKey="balance" sort={sort} onSort={setSort} className="col--opt" />
            </tr>
          </thead>
          <tbody>
            {applySort(clubs, sort, clubSort(game)).map((club) => {
              const squad = club.squadIds.map((id) => game.people[id]).filter(isPlayer);
              const position = leaguePosition(game, club.id);
              return (
                <tr
                  key={club.id}
                  className={`table__row--clickable${club.id === game.userClubId ? ' table__row--mine' : ''}`}
                  onClick={() => setClubId(club.id)}
                >
                  <td>
                    <span className="swatch" style={{ background: club.identity.colours.primary }} />
                    <ClubLink clubId={club.id}>{club.identity.name}</ClubLink>
                    {club.id === game.userClubId && <Pill tone="accent">yours</Pill>}
                    <div className="muted small">{club.identity.nickname}</div>
                  </td>
                  <td data-label="Town">{game.world.towns[club.townId]?.name}</td>
                  <td className="muted small" data-label="Ground">
                    {game.world.grounds[club.groundId]?.name}
                  </td>
                  <td className="muted small col--opt" data-label="Structure">
                    {CLUB_STRUCTURE_LABEL[club.structure]}
                  </td>
                  <td className="col--opt" data-label="Founded">
                    {club.identity.foundedYear}
                  </td>
                  <td data-label="Squad">{squad.length}</td>
                  <td className="col--opt" data-label="Average age">
                    {squadAverageAge(squad)}
                  </td>
                  <td data-label="Position">{position ?? '—'}</td>
                  <td className="muted small col--opt" data-label="Balance">
                    {moneyShort(club.finances.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Panel>
      </Section>

      {selected && (
        <Panel
          title={selected.identity.name}
          subtitle={`${selected.identity.nickname} · ${CLUB_STRUCTURE_LABEL[selected.structure]}`}
          actions={
            <button type="button" className="link" onClick={() => setClubId(null)}>
              close
            </button>
          }
        >
          <div className="stat-grid">
            <Stat label="Town" value={game.world.towns[selected.townId]?.name ?? '—'} />
            <Stat label="Ground" value={game.world.grounds[selected.groundId]?.name ?? '—'} />
            <Stat label="Standing" value={Math.round(selected.reputation)} hint="Local reputation out of 100" />
            <Stat label="Squad" value={selected.squadIds.length} />
            <Stat
              label="Manager"
              value={
                selected.managerId && game.people[selected.managerId] ? (
                  <PlayerLink personId={selected.managerId}>
                    {game.people[selected.managerId]!.firstName} {game.people[selected.managerId]!.surname}
                  </PlayerLink>
                ) : (
                  '—'
                )
              }
            />
            <Stat
              label="Chairman"
              value={
                selected.chairmanId && game.people[selected.chairmanId] ? (
                  <PlayerLink personId={selected.chairmanId}>
                    {game.people[selected.chairmanId]!.firstName} {game.people[selected.chairmanId]!.surname}
                  </PlayerLink>
                ) : (
                  '—'
                )
              }
            />
          </div>
          <p className="small">{selected.identity.motto}</p>
          <h4 className="subhead">Rivalries</h4>
          {Object.keys(selected.rivalries).length === 0 ? (
            <p className="empty">No established rivalries.</p>
          ) : (
            <ul className="tight-list">
              {Object.entries(selected.rivalries).map(([id, rivalry]) => (
                <li key={id}>
                  <ClubLink clubId={id} />{' '}
                  <Pill tone={rivalry.intensity > 60 ? 'bad' : 'warn'}>intensity {Math.round(rivalry.intensity)}</Pill>{' '}
                  <span className="muted small">{rivalry.note}</span>
                </li>
              ))}
            </ul>
          )}
          <h4 className="subhead">Recent seasons</h4>
          <ul className="tight-list">
            {selected.history.seasons.slice(0, 3).map((season) => (
              <li key={season.seasonId} className="muted small">
                {season.seasonLabel}: {season.played} played, {season.points} points
                {season.finalPosition ? `, finished ${season.finalPosition}` : ''}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <details className="more">
        <summary className="small muted">Pubs, businesses and sponsorship</summary>
      <Panel>
        <ul className="tight-list">
          {businesses.slice(0, 24).map((business) => (
            <li key={business.id}>
              <strong>{business.name}</strong>{' '}
              <span className="muted small">
                {business.kind} · {game.world.towns[business.townId]?.name} · wealth {business.wealth}/20
                {business.sponsoredClubIds.length > 0
                  ? ` · backs ${business.sponsoredClubIds.map((id) => game.clubs[id]?.identity.shortName).join(', ')}`
                  : ' · no club attached'}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      </details>

      <details className="more">
        <summary className="small muted">Technical</summary>
        <p className="muted small">World seed: {game.seed}. Club density follows population; travel follows the map.</p>
      </details>
    </div>
  );
}
