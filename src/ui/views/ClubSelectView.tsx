import { useMemo, useState } from 'react';
import { CLUB_STRUCTURE_LABEL } from '@/domain/club';
import { isPlayer, type Player } from '@/domain/person';
import { ordinal } from '@/simulation/news';
import { moneyShort } from '../format';
import { gameActions } from '../hooks';
import { Button, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { ClubBadge } from '../components/Badge';
import { PersonLine } from '../components/PersonIdentity';
import { SceneBackdrop } from '../components/SceneBackdrop';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';
import { useGameStore } from '@/state/gameStore';
import { handleTabKeys } from '../components/Tabs';

type SquadSortKey = 'player' | 'age' | 'pos' | 'occupation' | 'personality';

const SQUAD_SORT: SortAccessors<Player, SquadSortKey> = {
  player: (player) => `${player.surname} ${player.firstName}`,
  age: (player) => player.age,
  pos: (player) => player.preferredPosition,
  occupation: (player) => player.occupation,
  personality: (player) => player.personality,
};

export function ClubSelectView() {
  const draft = useGameStore((state) => state.draft);
  const [selected, setSelected] = useState<string | null>(draft?.divisionClubIds[0] ?? null);
  // Which division the manager is looking at. Opens on the one holding the
  // club they would start in, because that is the one they are most likely to
  // want, and the tabstrip is how they get to the other thirty.
  const [tier, setTier] = useState<number>(1);
  const [sort, setSort] = useState<SortState<SquadSortKey>>(UNSORTED);

  /**
   * Every division, not just the top one.
   *
   * A manager who wants to start at the bottom of the pyramid has to be able to
   * see the bottom of the pyramid, and a career spent climbing from Division
   * Three is a different one from a career spent defending in Division One. The
   * draft carries the whole ladder; showing only `divisionClubIds` quietly
   * reduced thirty-six clubs to twelve and made the two thirds of the county
   * unplayable.
   */
  const divisions = useMemo(() => {
    if (!draft) return [];
    return draft.divisions.map((clubIds, index) => ({
      tier: index + 1,
      clubs: clubIds
        .map((id) => draft.clubs[id]!)
        .filter(Boolean)
        .slice()
        .sort((a, b) => b.reputation - a.reputation),
    }));
  }, [draft]);

  /** Which division a club starts in, for the detail panel. */
  const selectedTier = divisions.find((division) => division.clubs.some((club) => club.id === selected))?.tier;

  const clubCount = divisions.reduce((total, division) => total + division.clubs.length, 0);
  const visible = divisions.find((division) => division.tier === tier) ?? divisions[0];

  if (!draft) return null;

  const selectedClub = selected ? draft.clubs[selected] : null;
  const squad = selectedClub
    ? selectedClub.squadIds.map((id) => draft.people[id]).filter(isPlayer)
    : [];

  return (
    <div className="club-select">
      <SceneBackdrop />
      <PageHeader
        eyebrow="New career"
        title="Choose your club"
        photo="/photos/club-select-pitches.webp"
        subtitle={`${draft.leagueName} · seed “${draft.seed}”. ${clubCount} local clubs in ${divisions.length} division${divisions.length === 1 ? '' : 's'}, each with its own squad, ground, committee and history.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => gameActions().abandonDraft()}>
              Back
            </Button>
            {/* The decision this screen exists to make, next to the way out of
                it. It was at the bottom of the detail panel, which meant the
                manager had to scroll past a whole squad snapshot to reach the
                one button that starts a career. */}
            <Button
              variant="primary"
              disabled={!selectedClub}
              onClick={() => selectedClub && gameActions().chooseClub(selectedClub.id)}
              title={selectedClub ? `Take charge of ${selectedClub.identity.name}` : 'Pick a club first'}
            >
              {selectedClub ? `Take charge of ${selectedClub.identity.shortName}` : 'Take charge'}
            </Button>
          </>
        }
      />

      {/* The ladder, as a tabstrip, the same one the league table uses. Thirty-six
          clubs in one column is a list nobody reads and a scroll nobody
          finishes; twelve at a time is a decision. */}
      {divisions.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Divisions" onKeyDown={handleTabKeys}>
          {divisions.map((division) => (
            <button
              type="button"
              key={division.tier}
              role="tab"
              tabIndex={division.tier === visible?.tier ? 0 : -1}
              aria-controls="selected-division"
              id={`division-${division.tier}`}
              aria-selected={division.tier === visible?.tier}
              className={`segmented__item${division.tier === visible?.tier ? ' segmented__item--active' : ''}`}
              onClick={() => setTier(division.tier)}
            >
              Division {ordinal(division.tier)}
            </button>
          ))}
        </div>
      )}

      <div className="club-select__grid" id="selected-division" role="tabpanel" aria-labelledby={`division-${visible?.tier}`}>
        <div className="stack">
          {visible && (
            <Panel
              key={visible.tier}
              title={`Division ${ordinal(visible.tier)}`}
              subtitle={`${visible.clubs.length} clubs · ordered by standing`}
            >
              <ul className="club-list">
                {visible.clubs.map((club) => {
                  const town = draft.world.towns[club.townId];
                  const ground = draft.world.grounds[club.groundId];
                  const isSelected = club.id === selected;
                  return (
                    <li key={club.id}>
                      <button
                        type="button"
                        className={`club-card${isSelected ? ' club-card--selected' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelected(club.id)}
                      >
                        <span className="club-card__stripe" style={{ background: club.identity.colours.primary }} />
                        <span className="club-card__main">
                          <span className="club-card__title">
                            <ClubBadge club={club} size={26} />
                            <strong>{club.identity.name}</strong>
                          </span>
                          <span className="muted small">
                            {club.identity.nickname} · {town?.name ?? 'Unknown'} · {ground?.name ?? 'Unknown ground'}
                          </span>
                          <span className="muted small">
                            {CLUB_STRUCTURE_LABEL[club.structure]} · founded {club.identity.foundedYear} ·{' '}
                            {club.squadIds.length} players
                          </span>
                        </span>
                        <span className="club-card__meta">
                          <Pill tone="muted">{moneyShort(club.finances.balance)}</Pill>
                          <Pill tone={club.reputation > 55 ? 'accent' : 'muted'}>{Math.round(club.reputation)} standing</Pill>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>

        <div className="club-select__detail">
          {selectedClub && (
            <>
              <Panel title={selectedClub.identity.name} subtitle={selectedClub.identity.motto}>
                <dl className="facts">
                  <Fact label="Nickname" value={selectedClub.identity.nickname} />
                  {selectedTier && (
                    <Fact
                      label="Division"
                      value={`Division ${ordinal(selectedTier)} of ${divisions.length}`}
                    />
                  )}
                  <Fact label="Town" value={draft.world.towns[selectedClub.townId]?.name ?? '—'} />
                  <Fact
                    label="Ground"
                    value={`${draft.world.grounds[selectedClub.groundId]?.name ?? '—'} (${
                      draft.world.grounds[selectedClub.groundId]?.surface ?? '—'
                    }, capacity ${draft.world.grounds[selectedClub.groundId]?.capacity ?? 0})`}
                  />
                  <Fact label="Structure" value={CLUB_STRUCTURE_LABEL[selectedClub.structure]} />
                  <Fact label="Founded" value={String(selectedClub.identity.foundedYear)} />
                  <Fact label="Squad" value={`${selectedClub.squadIds.length} registered players`} />
                  <Fact
                    label="Manager"
                    value={
                      draft.people[selectedClub.managerId ?? '']?.kind === 'player'
                        ? `${draft.people[selectedClub.managerId ?? '']!.firstName} ${
                            draft.people[selectedClub.managerId ?? '']!.surname
                          } (player-manager)`
                        : `${draft.people[selectedClub.managerId ?? '']?.firstName ?? '—'} ${
                            draft.people[selectedClub.managerId ?? '']?.surname ?? ''
                          }`
                    }
                  />
                  <Fact
                    label="Chairman"
                    value={`${draft.people[selectedClub.chairmanId ?? '']?.firstName ?? '—'} ${
                      draft.people[selectedClub.chairmanId ?? '']?.surname ?? ''
                    }`}
                  />
                  <Fact
                    label="Finances"
                    value={`${moneyShort(selectedClub.finances.balance)} · subs £${selectedClub.finances.starterSubAmount ?? 5}/£${selectedClub.finances.substituteSubAmount ?? 3} per game · sponsorship up to £${selectedClub.finances.sponsorIncomePerWeek}/week`}
                  />
                  <Fact
                    label="Rivalries"
                    value={
                      Object.keys(selectedClub.rivalries).length === 0
                        ? 'None established'
                        : Object.entries(selectedClub.rivalries)
                            // The full name, not the short one: three clubs in this
                            // division share a nickname stem, so "The Old (91), The Old
                            // (64)" named nobody.
                            .map(([id, rivalry]) => `${draft.clubs[id]?.identity.name ?? id} (${Math.round(rivalry.intensity)})`)
                            .join(', ')
                    }
                  />
                </dl>
                <p className="muted small">
                  Taking charge here means this squad, this bank balance and this club's history. Availability,
                  finances and results all follow from it.
                </p>
              </Panel>

              <details className="more"><summary>Who you would inherit · squad snapshot</summary><Panel>
                <div className="table-wrapper">
                <table className="table table--compact table--stack">
                  <thead>
                    <tr>
                      <SortTh label="Player" sortKey="player" sort={sort} onSort={setSort} />
                      <SortTh label="Age" sortKey="age" sort={sort} onSort={setSort} />
                      <SortTh label="Pos" sortKey="pos" sort={sort} onSort={setSort} />
                      <SortTh label="Occupation" sortKey="occupation" sort={sort} onSort={setSort} />
                      <SortTh label="Personality" sortKey="personality" sort={sort} onSort={setSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {applySort(squad, sort, SQUAD_SORT).slice(0, 12).map((player) => (
                      <tr key={player.id}>
                        <td>
                          {/* The twelve men the manager would inherit, drawn: this
                              is the screen where he meets them, and a squad
                              snapshot of names is a list of strangers. */}
                          <PersonLine personId={player.id}>
                            {player.firstName} {player.surname}
                            {player.nickname ? <span className="muted small"> “{player.nickname}”</span> : null}
                          </PersonLine>
                        </td>
                        <td data-label="Age">{player.age}</td>
                        <td data-label="Position">{player.preferredPosition}</td>
                        <td className="muted" data-label="Day job">
                          {player.occupation}
                        </td>
                        <td className="muted" data-label="Personality">
                          {player.personality}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <p className="muted small">Showing 12 of {squad.length}. The full squad is on the Squad screen once you take over.</p>
              </Panel></details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="facts__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
