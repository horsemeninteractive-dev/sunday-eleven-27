import { useState } from 'react';
import type { ClubId } from '@/domain/ids';
import { personDisplayName, type AvailabilityStatus, type Player } from '@/domain/person';
import { POSITIONS, type PositionCode, type PositionGroup } from '@/domain/positions';
import { squadOf } from '@/simulation/queries';
import { socialGroupsFor } from '@/simulation/relationships';
import { availabilityText, availabilityTone } from '../format';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { Meter, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

const GROUP_ORDER: Array<PositionGroup | 'ALL'> = ['ALL', 'GK', 'DEF', 'MID', 'FWD'];
const AVAILABILITY_ORDER: AvailabilityStatus[] = ['available', 'doubtful', 'unavailable'];
const POSITION_CODES = Object.keys(POSITIONS) as PositionCode[];

type SquadSortKey =
  | 'player'
  | 'age'
  | 'pos'
  | 'condition'
  | 'form'
  | 'availability'
  | 'apps'
  | 'goals'
  | 'assists'
  | 'cards';

/** What each heading sorts by. Kept with the table it belongs to. */
const SQUAD_SORT: SortAccessors<Player, SquadSortKey> = {
  player: (player) => `${player.surname} ${player.firstName}`,
  age: (player) => player.age,
  // By line of the team first, then the position itself.
  pos: (player) => GROUP_ORDER.indexOf(player.positionGroup) * 100 + POSITION_CODES.indexOf(player.preferredPosition),
  condition: (player) => player.fitness,
  form: (player) => player.form,
  availability: (player) => AVAILABILITY_ORDER.indexOf(player.availability.status),
  apps: (player) => player.record.appearances,
  goals: (player) => player.record.goals,
  assists: (player) => player.record.assists,
  // A red is worth more than a yellow, so they are counted as what they cost.
  cards: (player) => player.record.yellowCards + player.record.redCards * 3,
};

/**
 * The squad list.
 *
 * A list of people, not a spreadsheet of attributes: who is fit, who is
 * available on Sunday, who is in form and whether the dressing room is behind
 * them. Clicking anybody opens their profile over the top — which is where the
 * numbers, the record and the things he can be asked to do live.
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
  const filtered = squad
    .filter((player) => (group === 'ALL' ? true : player.positionGroup === group))
    .filter((player) => (availableOnly ? player.availability.status !== 'unavailable' : true));
  const rows = applySort(filtered, sort, SQUAD_SORT);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Squad"
        subtitle="Click anybody for their profile — attributes, record, what they think of the way you play, and who they know."
        meta={
          <>
            <span className="small muted">{squad.length} registered</span>
            <span className="small muted">{filtered.length} shown</span>
          </>
        }
        actions={
          <div className="row row--wrap">
            <button
              type="button"
              className={`tab${availableOnly ? ' tab--active' : ''}`}
              onClick={() => setAvailableOnly((value) => !value)}
            >
              Only in contention
            </button>
            {GROUP_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                className={`tab${group === option ? ' tab--active' : ''}`}
                onClick={() => setGroup(option)}
              >
                {option === 'ALL' ? 'All' : option}
              </button>
            ))}
          </div>
        }
      />

      <div className="flow flow--two">
        <Panel title="Squad at a glance" level="default">
          <div className="facts">
            {GROUP_ORDER.filter((option): option is PositionGroup => option !== 'ALL').map((option) => {
              const inGroup = squad.filter((player) => player.positionGroup === option);
              const ready = inGroup.filter((player) => player.availability.status === 'available').length;
              return (
                <div className="facts__row" key={option}>
                  <dt>{option}</dt>
                  <dd>
                    {inGroup.length} registered
                    <span className="muted small"> · {ready} available</span>
                  </dd>
                </div>
              );
            })}
            <div className="facts__row">
              <dt>Average age</dt>
              <dd>
                {squad.length > 0
                  ? (squad.reduce((total, player) => total + player.age, 0) / squad.length).toFixed(1)
                  : '—'}
              </dd>
            </div>
            <div className="facts__row">
              <dt>Unhappy</dt>
              <dd>{squad.filter((player) => player.morale < 35).length}</dd>
            </div>
          </div>
        </Panel>
        <DressingRoom clubId={club.id} />
      </div>

      <Panel level="primary" title="Everyone registered" subtitle="Sunday's squad list, as the secretary would read it out">
          <div className="table-wrapper">
            <table className="table table--stack table--clickable">
              <thead>
                <tr>
                  <SortTh label="Player" sortKey="player" sort={sort} onSort={setSort} />
                  <SortTh label="Age" sortKey="age" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="Pos" sortKey="pos" sort={sort} onSort={setSort} />
                  <SortTh label="Condition" sortKey="condition" sort={sort} onSort={setSort} />
                  <SortTh label="Form" sortKey="form" sort={sort} onSort={setSort} />
                  <SortTh label="Availability" sortKey="availability" sort={sort} onSort={setSort} />
                  <SortTh label="Apps" sortKey="apps" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="Goals" sortKey="goals" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="Ass" sortKey="assists" sort={sort} onSort={setSort} className="col--opt" />
                  <SortTh label="Cards" sortKey="cards" sort={sort} onSort={setSort} className="col--opt" />
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
                      {player.nickname ? <span className="muted small"> “{player.nickname}”</span> : null}
                      {captainId === player.id && <Pill tone="accent">captain</Pill>}
                      {player.morale < 35 && <Pill tone="warn">unhappy</Pill>}
                      <div className="muted small">
                        {player.firstName} · {player.occupation}
                      </div>
                    </td>
                    <td className="col--opt" data-label="Age">
                      {player.age}
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
                      <Pill tone={availabilityTone(player.availability.status)} title={availabilityText(player.availability)}>
                        {player.availability.status}
                      </Pill>
                      {player.availability.note && <div className="muted small">{player.availability.note}</div>}
                    </td>
                    <td className="col--opt" data-label="Apps">
                      {player.record.appearances}
                    </td>
                    <td className="col--opt" data-label="Goals">
                      {player.record.goals}
                    </td>
                    <td className="muted small col--opt" data-label="Assists">
                      {player.record.assists}
                    </td>
                    <td className="muted small col--opt" data-label="Cards">
                      {player.record.yellowCards}
                      {player.record.redCards > 0 ? `/${player.record.redCards}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="empty">Nobody matches that filter.</p>}
        </Panel>

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
    <Panel title="Dressing room" subtitle="Groups that have formed on their own, worked out from who actually gets on with whom">
      <ul className="tight-list">
        {groups.map((group) => {
          const leader = group.leaderId ? game.people[group.leaderId] : undefined;
          const names = group.memberIds.map((id) => game.people[id]?.surname ?? id).join(', ');
          return (
            <li key={group.id}>
              <div className="row row--wrap">
                <strong>{group.label}</strong>
                <Pill tone={group.cohesion >= 58 ? 'ok' : 'muted'}>{group.memberIds.length} players</Pill>
                {leader && <span className="muted small">listens to {personDisplayName(leader)}</span>}
              </div>
              <div className="muted small">{names}</div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
