import type { ReactNode } from 'react';
import {
  FOCUS_LABEL,
  FOCUS_ORDER,
  LINE_LABEL,
  LINE_ORDER,
  MENTALITY_LABEL,
  MENTALITY_ORDER,
  PASSING_LABEL,
  PASSING_ORDER,
  PRESSING_LABEL,
  PRESSING_ORDER,
  TEMPO_LABEL,
  TEMPO_ORDER,
  describeTactics,
  type Tactics,
} from '@/domain/tactics';
import { FORMATION_IDS, getFormation } from '@/domain/positions';
import { isPlayer } from '@/domain/person';
import { gameActions, useGame, useNextFixture, useSquad } from '../hooks';
import { applyFormation } from '../lineupEditing';
import { Button, PageHeader, Panel, Pill } from '../components/primitives';

/**
 * The tactical model is deliberately small: every choice buys something and
 * pays for it elsewhere. There is no correct answer here — the squad, the
 * opposition and the conditions decide whether a setup works.
 *
 * The controls are grouped the way a manager would talk about them: shape
 * first, then what happens with the ball, then what happens without it.
 */
export function TacticsView() {
  const game = useGame();
  const squad = useSquad();
  const fixture = useNextFixture();
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const tactics: Tactics = club.tactics;
  const isHome = fixture ? fixture.homeClubId === club.id : true;

  const set = (patch: Partial<Tactics>) => {
    const next = { ...tactics, ...patch };
    if (patch.formation) {
      next.formation = patch.formation;
    }
    gameActions().updateClubTactics(next);
    if (fixture && patch.formation) {
      gameActions().updateFixtureLineup((current) => applyFormation(current, next.formation, squad));
    }
  };

  const positions = fixture ? (isHome ? fixture.lineups.home.starting : fixture.lineups.away.starting) : [];
  const outOfPosition = positions.filter((slot) => slot.outOfPosition).length;
  const averageFitness = positions.length
    ? positions.reduce((sum, slot) => {
        const person = game.people[slot.playerId];
        return sum + (isPlayer(person) ? person.fitness : 0);
      }, 0) / positions.length
    : 0;

  const suitWarnings = [
    tactics.pressing === 'high' && averageFitness < 75
      ? 'Pressing high with tired legs is asking for trouble late on'
      : null,
    tactics.passingStyle === 'short' ? 'Short passing suffers on heavy pitches' : null,
    tactics.tempo === 'high' ? 'High tempo costs stamina in the last 20 minutes' : null,
    outOfPosition > 2 ? `${outOfPosition} of the XI are out of their natural roles` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Tactics"
        subtitle={describeTactics(tactics)}
        meta={
          <span className="small muted">
            The shape, the instructions and the pitch all feed the match engine directly.
          </span>
        }
        actions={
          <Button
            variant="ghost"
            onClick={() => {
              const defaults: Tactics = {
                formation: '4-4-2',
                mentality: 'balanced',
                passingStyle: 'mixed',
                tempo: 'standard',
                pressing: 'medium',
                defensiveLine: 'standard',
                attackingFocus: 'balanced',
              };
              set(defaults);
            }}
          >
            Reset to a plain 4-4-2
          </Button>
        }
      />

      <Panel level="primary" title="How you want to play" subtitle="Every choice here costs you something somewhere else">
        <div className="tactics">
          <TacticsZone title="Shape" hint="Where the team stands before a ball is kicked.">
            <OptionGroup
              label="Formation"
              hint={getFormation(tactics.formation).description}
              options={FORMATION_IDS.map((id) => ({ value: id, label: id }))}
              value={tactics.formation}
              onChange={(value) => set({ formation: value })}
            />
            <OptionGroup
              label="Mentality"
              hint="How far you push everyone forward. Attacking commits bodies; defensive protects the lead and concedes the ball."
              options={MENTALITY_ORDER.map((value) => ({ value, label: MENTALITY_LABEL[value] }))}
              value={tactics.mentality}
              onChange={(value) => set({ mentality: value })}
            />
          </TacticsZone>

          <TacticsZone title="In possession" hint="What you do with the ball, and how quickly you do it.">
            <OptionGroup
              label="Passing approach"
              hint="Short passing needs a decent surface and composed players. Direct gets it forward and turns it into a scrap."
              options={PASSING_ORDER.map((value) => ({ value, label: PASSING_LABEL[value] }))}
              value={tactics.passingStyle}
              onChange={(value) => set({ passingStyle: value })}
            />
            <OptionGroup
              label="Tempo"
              hint="Higher tempo means more attempts and more mistakes, and empties legs by the hour mark."
              options={TEMPO_ORDER.map((value) => ({ value, label: TEMPO_LABEL[value] }))}
              value={tactics.tempo}
              onChange={(value) => set({ tempo: value })}
            />
          </TacticsZone>

          <TacticsZone title="Out of possession" hint="What happens when the other lot have it.">
            <OptionGroup
              label="Pressing"
              hint="Press high to win the ball up the pitch and invite trouble in behind. Sit off to stay compact."
              options={PRESSING_ORDER.map((value) => ({ value, label: PRESSING_LABEL[value] }))}
              value={tactics.pressing}
              onChange={(value) => set({ pressing: value })}
            />
            <OptionGroup
              label="Defensive line"
              hint="A high line squeezes the game but asks questions of slow centre halves."
              options={LINE_ORDER.map((value) => ({ value, label: LINE_LABEL[value] }))}
              value={tactics.defensiveLine}
              onChange={(value) => set({ defensiveLine: value })}
            />
          </TacticsZone>

          <TacticsZone title="Where the chances come from" hint="One instruction, and the one the players will notice most.">
            <OptionGroup
              label="Attacking focus"
              hint="Crosses if you have wingers and a centre forward who can head it, or through the middle if you do not."
              options={FOCUS_ORDER.map((value) => ({ value, label: FOCUS_LABEL[value] }))}
              value={tactics.attackingFocus}
              onChange={(value) => set({ attackingFocus: value })}
            />
          </TacticsZone>
        </div>

        <p className="muted small">
          Any tactical change made during a match takes effect from the next minute. Individual player instructions and
          set-piece routines are not in this build — the training ground covers set pieces as a squad, and the engine
          treats a corner as a corner.
        </p>
      </Panel>

      <Panel title="Does this suit the players you have?" subtitle="A quick read on your likely XI">
        <div className="row row--wrap">
          <Pill tone="accent">{positions.length} selected</Pill>
          <Pill tone={outOfPosition > 2 ? 'warn' : 'muted'}>{outOfPosition} out of their natural roles</Pill>
          <Pill tone={averageFitness < 70 ? 'warn' : 'ok'}>Average fitness {Math.round(averageFitness)}%</Pill>
          {!fixture && <Pill tone="muted">No fixture this week — these carry over</Pill>}
        </div>
        {suitWarnings.length > 0 && (
          <ul className="bullets">
            {suitWarnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {fixture && (
          <p className="muted small">
            This week: {game.clubs[isHome ? fixture.awayClubId : fixture.homeClubId]!.identity.name} at{' '}
            {game.world.grounds[fixture.groundId]?.name}, {fixture.conditions.pitch} pitch, {fixture.conditions.weather}
            .
          </p>
        )}
        {!fixture && <p className="empty">No fixture this week. These settings will apply to the next one.</p>}
      </Panel>
    </div>
  );
}

function TacticsZone({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="tactics-zone">
      <div className="tactics-zone__head">
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
      {children}
    </section>
  );
}

function OptionGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="option-group">
      <div className="option-group__head">
        <h4 className="subhead">{label}</h4>
        <p className="muted small">{hint}</p>
      </div>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`segmented__item${value === option.value ? ' segmented__item--active' : ''}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
