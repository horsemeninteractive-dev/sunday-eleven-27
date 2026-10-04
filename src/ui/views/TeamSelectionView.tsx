import { useState } from 'react';
import type { BenchSlot, LineupSlot, MatchLineup } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { FORMATION_IDS, getFormation, POSITIONS, type PositionCode } from '@/domain/positions';
import { autoPickLineup, positionScore, validateLineup } from '@/simulation/selection';
import { availabilityTone, playerName } from '../format';
import { gameActions, useGame, useNextFixture, useSquad } from '../hooks';
import { Button, Meter, PageHeader, Panel, Pill } from '../components/primitives';
import { PlayerLink } from '../components/Links';
import { MetricTile, Section, StatusTile, TileGrid } from '../components/hierarchy';
import {
  applyFormation,
  assignToBench,
  assignToStarting,
  clearSlot,
  removeFromBench,
  setCaptain,
  swapWithBench,
} from '../lineupEditing';

type PickerTarget = { kind: 'starting'; index: number } | { kind: 'bench' };

/**
 * Picking the side.
 *
 * Read top down: what state the selection is in, then the pitch, then the
 * decisions. The four tiles under the header answer the only questions worth
 * asking before starting work — is the XI legal, is there a bench, who wears
 * the armband, what is wrong — and the rest of the screen is the pitch and the
 * lists. Nothing here explains what a pitch or a substitute is.
 */
export function TeamSelectionView() {
  const game = useGame();
  const squad = useSquad();
  const fixture = useNextFixture();
  const [target, setTarget] = useState<PickerTarget | null>(null);

  if (!game) return null;
  if (!fixture) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Team" title="Team selection" />
        <Section title="Next match">
          <TileGrid min={215}>
            <MetricTile label="Fixture" value="None" note="Nothing to pick a team for" tone="muted" />
          </TileGrid>
        </Section>
      </div>
    );
  }

  const clubId = game.userClubId;
  const isHome = fixture.homeClubId === clubId;
  const lineup: MatchLineup = isHome ? fixture.lineups.home : fixture.lineups.away;
  const opponent = game.clubs[isHome ? fixture.awayClubId : fixture.homeClubId]!;
  const players = (id: string) => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  };
  const problems = validateLineup(lineup.starting, lineup.bench, players);
  const errors = problems.filter((problem) => problem.severity === 'error');
  const warnings = problems.filter((problem) => problem.severity !== 'error');
  const selectedIds = new Set([...lineup.starting.map((slot) => slot.playerId), ...lineup.bench.map((slot) => slot.playerId)]);
  const candidates = squad.filter((player) => !selectedIds.has(player.id));
  const formation = getFormation(lineup.tactics.formation);
  const captain = lineup.captainId ? players(lineup.captainId) : undefined;

  // The store clones the game, finds the player's own fixture and passes that
  // lineup into the updater, so edits are always applied to the right side.
  const withLineup = (updater: (current: MatchLineup) => MatchLineup) => gameActions().updateFixtureLineup(updater);

  const pickerSlotPosition: PositionCode | null =
    target?.kind === 'starting' ? lineup.starting[target.index]?.position ?? null : null;

  const sortForPosition = (position: PositionCode | null) =>
    [...candidates]
      .map((player) => ({
        player,
        score: position ? positionScore(player, position) : positionScore(player, player.preferredPosition),
      }))
      .sort((a, b) => {
        const availabilityWeight = (player: Player) => (player.availability.status === 'doubtful' ? -0.08 : 0);
        return b.score + availabilityWeight(b.player) - (a.score + availabilityWeight(a.player));
      });

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Team"
        title="Team selection"
        subtitle={`${isHome ? 'Home' : 'Away'} against ${opponent.identity.name} · ${lineup.formation} · ${
          errors.length > 0 ? `${errors.length} problem${errors.length === 1 ? '' : 's'}` : 'XI legal'
        }`}
        tone={errors.length > 0 ? 'danger' : 'default'}
        meta={
          <>
            <span className="small muted">
              {fixture.kickOff} · {game.world.grounds[fixture.groundId]?.name ?? 'ground to be confirmed'}
            </span>
            <span className="small muted">{game.season.label}</span>
          </>
        }
        actions={
          <div className="row row--wrap">
            <select
              className="input input--small"
              value={lineup.tactics.formation}
              aria-label="Formation"
              onChange={(event) => withLineup((current) => applyFormation(current, event.target.value as never, squad))}
            >
              {FORMATION_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              onClick={() => {
                const selection = autoPickLineup(squad, lineup.tactics.formation);
                withLineup((current) => ({
                  ...current,
                  starting: selection.starting,
                  bench: selection.bench,
                  captainId: current.captainId && selection.starting.some((slot) => slot.playerId === current.captainId)
                    ? current.captainId
                    : selection.starting[0]?.playerId ?? null,
                }));
              }}
            >
              Ask the assistant to pick
            </Button>
            <Button
              variant="primary"
              disabled={errors.length > 0}
              onClick={() => gameActions().startUserMatch()}
              title={errors.length > 0 ? 'Fix the selection problems first' : undefined}
            >
              Go to the match
            </Button>
          </div>
        }
      />

      <Section title="Selection">
        <TileGrid min={170}>
          <MetricTile
            label="Starting XI"
            value={`${lineup.starting.length}/11`}
            note={errors.length > 0 ? 'Not legal yet' : warnings.length > 0 ? `${warnings.length} to watch` : 'Ready'}
            tone={errors.length > 0 ? 'bad' : warnings.length > 0 ? 'warn' : 'ok'}
          />
          <MetricTile
            label="Bench"
            value={`${lineup.bench.length}/5`}
            note={lineup.bench.length === 0 ? 'No substitutes' : 'Substitutes'}
            tone={lineup.bench.length === 0 ? 'warn' : 'default'}
          />
          <StatusTile
            label="Captain"
            status={captain ? `${captain.firstName.charAt(0)}. ${captain.surname}` : 'Not set'}
            tone={captain ? 'accent' : 'warn'}
          />
          <MetricTile
            label="Problems"
            value={problems.length === 0 ? 'None' : `${problems.length}`}
            note={problems.length === 0 ? 'Nothing to fix' : `${errors.length} blocking · ${warnings.length} to watch`}
            tone={errors.length > 0 ? 'bad' : warnings.length > 0 ? 'warn' : 'ok'}
          />
        </TileGrid>
      </Section>

      <Section title="The XI">
        <Panel level="primary">
          <div className="lineup">
            <div className="lineup__pitch">
              <div className="pitch pitch--static">
                <span className="pitch__halfway" />
                <span className="pitch__circle" />
                {lineup.starting.map((slot, index) => {
                  const player = players(slot.playerId);
                  const formationSlot = formation.slots[index] ?? formation.slots[0]!;
                  // Position bases are written for a side attacking left to
                  // right; the away side's shape is turned right round, both
                  // axes, or its right back would be drawn as a left back.
                  const x = isHome ? formationSlot.x : 1 - formationSlot.x;
                  const y = isHome ? formationSlot.y : 1 - formationSlot.y;
                  return (
                    <button
                      key={`${slot.playerId}-${index}`}
                      type="button"
                      className={`pitch__player${target?.kind === 'starting' && target.index === index ? ' pitch__player--active' : ''}${
                        slot.outOfPosition ? ' pitch__player--oops' : ''
                      }`}
                      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                      onClick={() => setTarget({ kind: 'starting', index })}
                      title={
                        player
                          ? `${playerName(player)} — ${POSITIONS[slot.position].label}${
                              slot.outOfPosition ? ' · out of position' : ''
                            }`
                          : 'Empty'
                      }
                    >
                      <span className="pitch__shirt" style={{ background: game.clubs[clubId]!.identity.colours.primary }}>
                        {slot.position}
                      </span>
                      <span className="pitch__name">
                        {player ? player.surname : 'Empty'}
                        {slot.outOfPosition ? ' ⚠' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lineup__side">
              <h4 className="subhead">Substitutes ({lineup.bench.length}/5)</h4>
              <ul className="tight-list">
                {lineup.bench.map((slot: BenchSlot) => {
                  const player = players(slot.playerId);
                  return (
                    <li key={slot.playerId} className="rating-row">
                      <span>
                        <PlayerLink personId={slot.playerId}>
                          <strong>{player ? player.surname : 'Unknown'}</strong>
                        </PlayerLink>{' '}
                        <span className="muted small">{player?.preferredPosition}</span>
                      </span>
                      <button type="button" className="link" onClick={() => withLineup((current) => removeFromBench(current, slot.playerId))}>
                        remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button variant="ghost" onClick={() => setTarget({ kind: 'bench' })}>
                Add a substitute
              </Button>

              <h4 className="subhead">Captain</h4>
              <select
                className="input input--small"
                value={lineup.captainId ?? ''}
                aria-label="Captain"
                onChange={(event) => withLineup((current) => setCaptain(current, event.target.value || null))}
              >
                <option value="">No captain</option>
                {lineup.starting.map((slot: LineupSlot) => {
                  const player = players(slot.playerId);
                  return (
                    <option key={slot.playerId} value={slot.playerId}>
                      {player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'Unknown'}
                    </option>
                  );
                })}
              </select>

              <h4 className="subhead">Selection problems</h4>
              {problems.length === 0 && <p className="empty">None.</p>}
              <ul className="tight-list">
                {[...errors, ...warnings].map((problem, index) => (
                  <li key={`${problem.message}-${index}`}>
                    <Pill tone={problem.severity === 'error' ? 'bad' : 'warn'}>{problem.severity === 'error' ? 'Problem' : 'Watch'}</Pill>{' '}
                    {problem.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </Section>

      {target && (
        <Panel
          title={target.kind === 'starting' ? `Who plays ${pickerSlotPosition ?? ''}?` : 'Who is on the bench?'}
          actions={<Button variant="ghost" onClick={() => setTarget(null)}>Close</Button>}
        >
          {candidates.length === 0 && <p className="empty">Nobody else is free to select.</p>}
          <ul className="picker">
            {sortForPosition(pickerSlotPosition).map(({ player, score }) => (
              <li key={player.id} className="picker__row">
                <div>
                  <PlayerLink personId={player.id}>
                    <strong>{playerName(player)}</strong>
                  </PlayerLink>{' '}
                  {player.nickname ? <span className="muted small">“{player.nickname}”</span> : null}
                  <div className="muted small">
                    {player.preferredPosition} · {player.age} · {player.occupation} · form {Math.round(player.form)}
                  </div>
                </div>
                <Meter
                  value={player.availability.status === 'doubtful' ? score * 100 * 0.85 : score * 100}
                  tone={score > 0.7 ? 'ok' : score > 0.55 ? 'accent' : 'warn'}
                />
                <Pill tone={availabilityTone(player.availability.status)} title={player.availability.note ?? undefined}>
                  {player.availability.status}
                </Pill>
                <div className="row">
                  {target.kind === 'starting' ? (
                    <Button
                      onClick={() => {
                        withLineup((current) => assignToStarting(current, target.index, player.id, player));
                        setTarget(null);
                      }}
                    >
                      Pick
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        withLineup((current) => assignToBench(current, player.id, player));
                        setTarget(null);
                      }}
                    >
                      Bench
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {target.kind === 'starting' && lineup.bench.length > 0 && (
            <>
              <h4 className="subhead">Or swap with a substitute</h4>
              <ul className="tight-list">
                {lineup.bench.map((bench: BenchSlot) => {
                  const player = players(bench.playerId);
                  if (!player) return null;
                  return (
                    <li key={bench.playerId} className="rating-row">
                      <span>
                        <PlayerLink personId={bench.playerId}>{playerName(player)}</PlayerLink>
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          withLineup((current) => swapWithBench(current, target.index, player.id, player));
                          setTarget(null);
                        }}
                      >
                        Swap in
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {target.kind === 'starting' && (
            <Button variant="ghost" onClick={() => { withLineup((current) => clearSlot(current, target.index)); setTarget(null); }}>
              Leave it empty
            </Button>
          )}
        </Panel>
      )}
    </div>
  );
}
