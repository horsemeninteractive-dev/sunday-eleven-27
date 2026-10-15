import { useMemo, useState } from 'react';
import type { PyramidId } from '@/domain/ids';
import { districtGeography } from '@/geography/alderland';
import { CLUB_STRUCTURE_LABEL } from '@/domain/club';
import { isPlayer, type Player } from '@/domain/person';
import { moneyShort } from '../format';
import { gameActions } from '../hooks';
import { Button, Fact, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { ClubBadge } from '../components/Badge';
import { PersonLine } from '../components/PersonIdentity';
import { PyramidPicker } from '../components/PyramidPicker';
import { SceneBackdrop } from '../components/SceneBackdrop';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';
import { draftLadderOptions, ladderChoices } from '../worldNav';
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

/**
 * Choosing a club, from anywhere in the county.
 *
 * The world this screen is looking at was generated a moment ago and has held
 * six ladders since the county's districts were founded, so what a manager is
 * shown is the whole of it: the ladder first — by the region each draws its clubs
 * from — and then the divisions of that ladder, one at a time, with the clubs of
 * each. The old screen offered only the founding pyramid's divisions, which
 * quietly made every other district's clubs unplayable.
 *
 * Nothing here picks for him beyond a sensible opening: the ladder he is looking
 * at starts as the county's own, on its top division, on the strongest club in it,
 * which is the club the game has always put under his nose first. Moving the
 * ladder or the division does not drop the club he has chosen — a manager reading
 * the district's table has not changed his mind about the side he wants, and a
 * screen that unselected it for him would be deciding for him.
 */
export function ClubSelectView() {
  const draft = useGameStore((state) => state.draft);
  const geography = useGameStore((state) => state.setup?.geography);
  const district = geography ? districtGeography(geography.countyId, geography.districtId) : undefined;

  /** Every ladder the draft was generated with, the founding one first. */
  const ladders = useMemo(() => (draft ? draftLadderOptions(draft).filter(ladder => !geography || ladder.id === geography.pyramidId) : []), [draft, geography]);

  // The club the screen opens on: the strongest in the county's top division,
  // which is where a new manager's eye has always been put first.
  const [selected, setSelected] = useState<string | null>(() => ladders[0]?.divisions[0]?.clubIds[0] ?? null);
  const [ladderId, setLadderId] = useState<PyramidId | null>(null);
  // Which division the manager is looking at. Opens on the top of the ladder he
  // is looking at, because that is the one he is most likely to want, and the
  // tabstrip is how he gets to the other two.
  const [tier, setTier] = useState<number>(1);
  const [sort, setSort] = useState<SortState<SquadSortKey>>(UNSORTED);

  const ladder = ladders.find((entry) => entry.id === ladderId) ?? ladders[0];

  /**
   * Every division, not just the top one.
   *
   * A manager who wants to start at the bottom of the ladder has to be able to
   * see the bottom of the ladder, and a career spent climbing from Division
   * Three is a different one from a career spent defending in Division One. The
   * draft carries the whole ladder; showing only the top division quietly
   * reduced thirty-six clubs to twelve and made the two thirds of the county
   * unplayable.
   */
  const divisions = useMemo(() => {
    if (!draft || !ladder) return [];
    return ladder.divisions.map((division) => ({
      tier: division.tier,
      // The name the ladder gives the rung travels with the clubs: the tabstrip
      // and the chosen club's own panel both name it, and the season will name it
      // the same way.
      shortName: division.shortName,
      clubs: division.clubIds
        .map((id) => draft.clubs[id]!)
        .filter(Boolean)
        .slice()
        .sort((a, b) => b.reputation - a.reputation),
    }));
  }, [draft, ladder]);

  /** Where the chosen club is registered, wherever he has browsed to since. */
  const chosen = useMemo(() => {
    if (!selected) return null;
    for (const entry of ladders) {
      const division = entry.divisions.find((candidate) => candidate.clubIds.includes(selected));
      if (division) return { ladder: entry, division };
    }
    return null;
  }, [ladders, selected]);

  const clubCount = ladder?.clubCount ?? 0;
  const visible = divisions.find((division) => division.tier === tier) ?? divisions[0];

  if (!draft || !ladder) return null;

  const selectedClub = selected ? draft.clubs[selected] : null;
  // The ground the club plays on, read once: the row that describes it prints the
  // name, the surface and the capacity of one ground, and they have to come from
  // the same one — a missing ground is a dash, not a surface of "—" beside a
  // capacity of 0.
  const selectedGround = selectedClub ? draft.world.grounds[selectedClub.groundId] : undefined;
  const squad = selectedClub
    ? selectedClub.squadIds.map((id) => draft.people[id]).filter(isPlayer)
    : [];

  return (
    <div className="club-select">
      <SceneBackdrop />
      <PageHeader
        eyebrow="New career"
        title={district ? `Choose your club · ${district.name}` : 'Choose your club'}
        photo="/photos/club-select-pitches.webp"
        subtitle={`${ladder.name} · seed “${draft.seed}”. ${clubCount} local clubs in ${divisions.length} division${divisions.length === 1 ? '' : 's'}, each with its own squad, ground, committee and history.`}
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
              title={
                selectedClub && chosen
                  ? `Take charge of ${selectedClub.identity.name} in the ${chosen.ladder.name}`
                  : 'Pick a club first'
              }
            >
              {selectedClub ? `Take charge of ${selectedClub.identity.shortName}` : 'Take charge'}
            </Button>
          </>
        }
      />

      {/* Which ladder he is reading, when the county has more than one. The
          second ladder is a different region's football at a level below the
          county's own, and it is half the clubs in the world. */}
      <PyramidPicker
        label="Leagues"
        choices={ladderChoices(ladders, null)}
        selected={ladder.id}
        onSelect={(id) => {
          setLadderId(id);
          setTier(1);
        }}
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
              {/* The division's own name without its ladder's name in front of it:
                  inside one ladder every division carries those words, and the
                  tabstrip is where the rung is what differs. */}
              {division.shortName}
            </button>
          ))}
        </div>
      )}

      {/* A tab panel only when there are tabs: with one division in the draft no
          tabstrip is drawn, and a panel labelled by an id that is not on the
          screen is a reference to nothing. */}
      <div
        className="club-select__grid"
        id="selected-division"
        role={divisions.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={divisions.length > 1 ? `division-${visible?.tier}` : undefined}
      >
        <div className="stack">
          {visible && (
            <Panel
              key={`${ladder.id}-${visible.tier}`}
              title={visible.shortName}
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
                  {/* Which football he would be taking on, named in full: a
                      manager can browse the district's table without wanting to
                      manage in it, and the club he has actually chosen has to be
                      the one the decision is about. */}
                  {chosen && (
                    <>
                      <Fact label="League" value={chosen.ladder.name} />
                      <Fact
                        label="Division"
                        value={`${chosen.division.shortName} of ${chosen.ladder.divisions.length}`}
                      />
                    </>
                  )}
                  <Fact label="Town" value={draft.world.towns[selectedClub.townId]?.name ?? '—'} />
                  <Fact
                    label="Ground"
                    value={
                      selectedGround
                        ? `${selectedGround.name} (${selectedGround.surface}, capacity ${selectedGround.capacity})`
                        : '—'
                    }
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
                  {/* The club's own figures, with nothing standing in for them: these
                      three are part of every club's finances, so a fallback here
                      would print the game's own defaults as the terms of whichever
                      club the manager is looking at. */}
                  <Fact
                    label="Finances"
                    value={`${moneyShort(selectedClub.finances.balance)} · subs £${selectedClub.finances.starterSubAmount}/£${selectedClub.finances.substituteSubAmount} per game · sponsorship up to £${selectedClub.finances.sponsorIncomePerWeek}/week`}
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
