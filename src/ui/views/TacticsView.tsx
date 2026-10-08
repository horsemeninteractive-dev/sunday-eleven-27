import { useState, type ReactNode } from 'react';
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
import { PITCH_LABEL, WEATHER_LABEL } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import { formatDate, formatKickOff } from '@/simulation/calendar';
import { matchOpponent } from '@/simulation/queries';
import { clubStyle } from '@/simulation/ai/style';
import { gameActions, useGame, useNextFixture, useSquad } from '../hooks';
import { applyFormation } from '../lineupEditing';
import { Button, PageHeader, Panel, Pill } from '../components/primitives';
import { Section, TileGrid } from '../components/hierarchy';
import { FormationBoard } from '../components/FormationBoard';
import { Tabs } from '../components/Tabs';

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
  const [instructions, setInstructions] = useState<'shape' | 'ball' | 'defend'>('shape');
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const tactics: Tactics = club.tactics;
  const isHome = fixture ? fixture.homeClubId === club.id : true;
  const opponent = fixture ? game.clubs[matchOpponent(fixture, club.id)] : undefined;

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
        eyebrow="Team"
        title="Tactics"
        subtitle={describeTactics(tactics)}
        meta={<span className="small muted">Your club's standing instructions · changes apply to the next fixture</span>}
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

      <div className="tactics-workspace">
      <div className="tactics-workspace__pitch">
        {/* The same three choices as the instruction tabs, so choosing "without
            the ball" moves the picture and the controls together — one idea,
            one control, rather than a second tab strip inside the diagram. */}
        <FormationBoard game={game} formation={tactics.formation} slots={positions} tactics={tactics} phase={instructions === 'shape' ? 'shape' : instructions === 'ball' ? 'with-ball' : 'without-ball'} />
        {/* The board says how the side will play; this says who it is playing, where
            and in what. A deep line is a decision *for* a heavy pitch, so the two
            belong on one line under the picture rather than three scrolls apart. */}
        <div className="tactics-caption">
          <span className="letterpress">This week</span>
          {fixture ? (
            <>
              <span>
                <b>{opponent?.identity.name ?? 'Opponent to be confirmed'}</b> · {isHome ? 'at home' : 'away'}
              </span>
              <span>
                {formatDate(fixture.date)} · kick-off {formatKickOff(fixture.kickOff)}
              </span>
              <span>
                {PITCH_LABEL[fixture.conditions.pitch]} pitch · {WEATHER_LABEL[fixture.conditions.weather].toLowerCase()}, {fixture.conditions.temperatureC}°C
              </span>
              {/* One line on the opposition, and the same line every week: how
                  they play is derived from the club, so it is a fact about them
                  rather than a guess, and it is what tells a manager whether
                  this is a day to sit in or a day to have a go. */}
              {opponent && <span>Their game: {clubStyle(opponent).label.toLowerCase()}</span>}
            </>
          ) : (
            <span>Nothing in the diary yet — the next fixture will appear here.</span>
          )}
          <Button variant="ghost" onClick={() => gameActions().setView('team')}>Team selection</Button>
        </div>
      </div>
      <Panel level="primary" title="How you want to play" className="workspace-panel tactics-instructions">
        <Tabs label="Instructions" options={[{ value: 'shape', label: 'Shape' }, { value: 'ball', label: 'In possession' }, { value: 'defend', label: 'Out of possession' }]} value={instructions} onChange={setInstructions}>
        <div className="tactics">
          {instructions === 'shape' && <TacticsZone title="Shape" hint="Where the team stands before a ball is kicked.">
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
          </TacticsZone>}

          {instructions === 'ball' && <TacticsZone title="In possession" hint="What you do with the ball, and how quickly you do it.">
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
          </TacticsZone>}

          {instructions === 'defend' && <TacticsZone title="Out of possession" hint="What happens when the other lot have it.">
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
          </TacticsZone>}

          {instructions === 'ball' && <TacticsZone title="Where the chances come from" hint="One instruction, and the one the players will notice most.">
            <OptionGroup
              label="Attacking focus"
              hint="Crosses if you have wingers and a centre forward who can head it, or through the middle if you do not."
              options={FOCUS_ORDER.map((value) => ({ value, label: FOCUS_LABEL[value] }))}
              value={tactics.attackingFocus}
              onChange={(value) => set({ attackingFocus: value })}
            />
          </TacticsZone>}
        </div>
        </Tabs>
      </Panel>
      </div>

      <details className="more"><summary>What these instructions ask of the team</summary><Section title="Tactical effects">
        <TileGrid min={200}>
          {effectsFor(tactics).map((effect) => (
            <div className="tile" key={effect.label}>
              <span className={`metric__value tone tone--${effect.tone}`}>{effect.arrow} {effect.label}</span>
              <span className="metric__note">{effect.note}</span>
            </div>
          ))}
        </TileGrid>
      </Section></details>

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
    <section className="tactics-zone" title={hint}>
      <div className="tactics-zone__head">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * What the current setup actually buys and costs, straight from the tactics.
 * The simulation is what decides a match; this is the one-line consequence of
 * each choice, so the control does not need a paragraph beside it.
 */
function effectsFor(tactics: Tactics): Array<{ label: string; arrow: string; note: string; tone: 'ok' | 'warn' | 'bad' }> {
  const effects: Array<{ label: string; arrow: string; note: string; tone: 'ok' | 'warn' | 'bad' }> = [];
  const push = (sign: 1 | -1, label: string, note: string, bad = false) =>
    effects.push({ label, arrow: sign > 0 ? '↑' : '↓', note, tone: bad ? (sign > 0 ? 'warn' : 'bad') : 'ok' });

  if (tactics.pressing === 'high') {
    push(1, 'Pressure', 'Win it higher up the pitch', true);
    push(-1, 'Stamina', 'Tired legs by the hour', true);
  } else if (tactics.pressing === 'low') {
    push(-1, 'Pressure', 'Stay compact, concede the ball');
    push(1, 'Shape', 'Harder to play through');
  }
  if (tactics.mentality === 'attacking' || tactics.mentality === 'very-attacking') {
    push(1, 'Attacking', 'More bodies forward', true);
    push(-1, 'Cover', 'Space behind the midfield', true);
  } else if (tactics.mentality === 'defensive' || tactics.mentality === 'very-defensive') {
    push(1, 'Cover', 'Protect the lead');
    push(-1, 'Attacking', 'Fewer committed forward');
  }
  if (tactics.tempo === 'high') push(-1, 'Stamina', 'High tempo empties legs', true);
  else if (tactics.tempo === 'slow') push(-1, 'Tempo', 'Slower build-up, fewer chances');
  if (tactics.passingStyle === 'short') push(1, 'Control', 'Keeps the ball, needs a surface');
  else if (tactics.passingStyle === 'direct') push(-1, 'Control', 'Forward quickly, more turnovers', true);
  if (tactics.defensiveLine === 'high') push(-1, 'Space behind', 'A high line invites the ball in behind', true);
  else if (tactics.defensiveLine === 'deep') push(1, 'Cover', 'A deep line protects the box');
  if (tactics.attackingFocus === 'wide') push(1, 'Crosses', 'Width and deliveries');
  else if (tactics.attackingFocus === 'central') push(1, 'Through balls', 'Playing through the middle');
  return effects.slice(0, 6);
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
      </div>
      <div className="segmented" role="group" aria-label={label}>
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
      <p className="instruction-help">{hint}</p>
    </div>
  );
}
