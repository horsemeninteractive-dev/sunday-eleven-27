import { useState } from 'react';
import type { ClubId } from '@/domain/ids';
import { personDisplayName, type AvailabilityStatus, type Player } from '@/domain/person';
import { POSITIONS, type PositionCode, type PositionGroup } from '@/domain/positions';
import { squadOf, squadAvailability } from '@/simulation/queries';
import { socialGroupsFor } from '@/simulation/relationships';
import { availabilityTone } from '../format';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { Meter, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { MetricTile, Section, TileGrid } from '../components/hierarchy';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

const GROUP_ORDER: Array<PositionGroup | 'ALL'> = ['ALL', 'GK', 'DEF', 'MID', 'FWD'];
const GROUP_LABEL: Record<PositionGroup | 'ALL', string> = { ALL: 'All', GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'ATT' };
const AVAILABILITY_ORDER: AvailabilityStatus[] = ['available', 'doubtful', 'unavailable'];
const POSITION_CODES = Object.keys(POSITIONS) as PositionCode[];

type SquadSortKey = 'player' | 'pos' | 'condition' | 'form' | 'availability' | 'apps' | 'goals';

/** What each heading sorts by. Kept with the table it belongs to. */
const SQUAD_SORT: SortAccessors<Player, SquadSortKey> = {
  player: (player) => `${player.surname} ${player.firstName}`,
  // By line of the team first, then the position itself.
  pos: (player) => GROUP_ORDER.indexOf(player.positionGroup) * 100 + POSITION_CODES.indexOf(player.preferredPosition),
  condition: (player) => player.fitness,
  form: (player) => player.form,
  availability: (player) => AVAILABILITY_ORDER.indexOf(player.availability.status),
  apps: (player) => player.record.appearances,
  goals: (player) => player.record.goals,
};

/**
 * The squad list.
 *
 * Scanned, not studied: four numbers at the top say whether there is a team in
 * this, then a compact roster says who is fit, who is available and who is in
 * form. Everything else about a man — his attributes, his record, what he
 * thinks of you — is one click away in his profile.
 */
export function SquadView() {
  const game = useGame();
  const fixture = useNextFixture();
  const [group, setGroup] = useState<PositionGroup | 'ALL'>('ALL');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sort, setSort] = useState<SortState<SquadSortKey>>(UNSORTED);
  const captainId = fixture
    ? fixture.homeClubId === game?.userClubId
      ? fixture.lineups.home.captainId
      : fixture.lineups.away.captainId
    : null;

  if (!game) return null;
  const club = game.clubs[game.userClubId]!;
  const squad = squadOf(game, club.id);
  const breakdown = squadAvailability(game, club.id);
  const filtered = squad
    .filter((player) => (group === 'ALL' ? true : player.positionGroup === group))
    .filter((player) => (availableOnly ? player.availability.status !== 'unavailable' : true));
  const rows = applySort(filtered, sort, SQUAD_SORT);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Team"
        title="Squad"
        meta={
          <>
            <span className="small muted">{squad.length} registered</span>
            <span className="small muted">{filtered.length} shown</span>
            <span className="small muted">
              average age{' '}
              {squad.length > 0 ? (squad.reduce((total, player) => total + player.age, 0) / squad.length).toFixed(1) : '—'}
            </span>
          </>
        }
      />

      <TileGrid min={180}>
        <MetricTile label="Registered" value={squad.length} note="On the books" />
        <MetricTile
          label="Available"
          value={breakdown.available.length}
          note="In contention for Sunday"
          tone={breakdown.available.length < 14 ? 'warn' : 'ok'}
        />
        <MetricTile label="Doubtful" value={breakdown.doubtful.length} tone={breakdown.doubtful.length > 0 ? 'warn' : 'default'} />
        <MetricTile label="Out" value={breakdown.unavailable.length} tone={breakdown.unavailable.length > 0 ? 'bad' : 'default'} />
      </TileGrid>

      <Section
        title="Roster"
        action={
          <div className="row row--wrap row--tight">
            <button
              type="button"
              className={`tab${availableOnly ? ' tab--active' : ''}`}
              onClick={() => setAvailableOnly((value) => !value)}
            >
              In contention
            </button>
            {GROUP_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                className={`tab${group === option ? ' tab--active' : ''}`}
                onClick={() => setGroup(option)}
              >
                {GROUP_LABEL[option]}
              </button>
            ))}
          </div>
        }
      >
        <Panel level="default" flush>
          <div className="table-wrapper">
            <table className="table table--stack table--clickable">
              <thead>
                <tr>
                  <SortTh label="Player" sortKey="player" sort={sort} onSort={setSort} />
                  <SortTh label="Pos" sortKey="pos" sort={sort} onSort={setSort} />
                  <SortTh label="Condition" sortKey="condition" sort={sort} onSort={setSort} />
                  <SortTh label="Form" sortKey="form" sort={sort} onSort={setSort} />
                  <SortTh label="Availability" sortKey="availability" sort={sort} onSort={setSort} />
                  <SortTh label="Apps" sortKey="apps" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="Goals" sortKey="goals" sort={sort} onSort={setSort} className="col--opt" />
                </tr>
              </thead>
              <tbody>
                {rows.map((player) => (
                  <tr
                    key={player.id}
                    className="table__row--clickable"
                    onClick={() => gameActions().openProfile({ kind: 'player', id: player.id })}
                    title={`Open ${player.firstName} ${player.surname}`}
                  >
                    <td>
                      <strong>{player.surname}</strong>
                      {captainId === player.id && <Pill tone="accent">captain</Pill>}
                      {player.morale < 35 && <Pill tone="warn">unhappy</Pill>}
                      <div className="muted small">
                        {player.firstName} · {player.occupation}
                      </div>
                    </td>
                    <td data-label="Pos">
                      <Pill tone="muted" title={POSITIONS[player.preferredPosition].label}>
                        {player.preferredPosition}
                      </Pill>
                    </td>
                    <td data-label="Condition">
                      <Meter value={player.fitness} tone={player.fitness < 60 ? 'warn' : 'ok'} />
                      <span className="muted small">{Math.round(player.fitness)}%</span>
                    </td>
                    <td data-label="Form">
                      <Meter value={player.form} tone={player.form > 60 ? 'ok' : player.form < 40 ? 'warn' : 'accent'} />
                      <span className="muted small">{Math.round(player.form)}</span>
                    </td>
                    <td data-label="Availability">
                      <Pill tone={availabilityTone(player.availability.status)}>{player.availability.status}</Pill>
                      {player.availability.note && <div className="muted small">{player.availability.note}</div>}
                    </td>
                    <td className="col--opt" data-label="Apps">
                      {player.record.appearances}
                    </td>
                    <td className="col--opt" data-label="Goals">
                      {player.record.goals}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="empty">Nobody matches that filter.</p>}
        </Panel>
      </Section>

      <DressingRoom clubId={club.id} />
    </div>
  );
}

/**
 * The shape of the dressing room, derived from the relationship graph itself.
 * Groups are never assigned by the game — they fall out of who gets on.
 */
function DressingRoom({ clubId }: { clubId: ClubId }) {
  const game = useGame();
  if (!game) return null;
  const groups = socialGroupsFor(game, clubId);
  if (groups.length === 0) return null;

  return (
    <Section title="Dressing room">
      <TileGrid min={240}>
        {groups.map((group) => {
          const leader = group.leaderId ? game.people[group.leaderId] : undefined;
          const names = group.memberIds.map((id) => game.people[id]?.surname ?? id).join(', ');
          return (
            <div className="tile" key={group.id}>
              <span className="tile__body">
                <span className="row row--wrap row--tight">
                  <strong>{group.label}</strong>
                  <Pill tone={group.cohesion >= 58 ? 'ok' : 'muted'}>{group.memberIds.length} players</Pill>
                  {leader && <span className="muted small">listens to {personDisplayName(leader)}</span>}
                </span>
                <span className="muted small">{names}</span>
              </span>
            </div>
          );
        })}
      </TileGrid>
    </Section>
  );
}
