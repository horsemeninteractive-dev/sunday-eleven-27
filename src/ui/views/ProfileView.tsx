import { useMemo, useState } from 'react';
import { ageOn, isManagerProfileComplete, MAX_MANAGER_AGE, MIN_MANAGER_AGE, type ManagerProfile } from '@/domain/manager';
import { firstSundayOfSeptember } from '@/simulation/gameSetup';
import { preSeasonStart } from '@/simulation/calendar';
import { weekStartOf } from '@/simulation/timeline';
import { useGameStore } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { Button, PageHeader, Panel } from '../components/primitives';
import { SceneBackdrop } from '../components/SceneBackdrop';

const SUGGESTED_SEEDS = ['wychavon-morning', 'bramley-ford-88', 'the-crown-railway', 'muddy-pitch-4'];
const START_YEAR = 2026;

/**
 * Who the manager is, before he is anybody's manager.
 *
 * The name, the birthday and the day job are his, and they are the same in
 * either mode: the only thing that differs afterwards is whether he picks a
 * club off the list or builds one of his own.
 */
export function ProfileView() {
  const setup = useGameStore((state) => state.setup);
  const profile = setup?.profile ?? null;
  const mode = setup?.mode ?? 'career';
  const [seed, setSeed] = useState(() => SUGGESTED_SEEDS[Math.floor(Math.random() * SUGGESTED_SEEDS.length)]!);
  const [error, setError] = useState<string | null>(null);

  const seasonStart = useMemo(
    () => weekStartOf(preSeasonStart(firstSundayOfSeptember(START_YEAR))),
    [],
  );

  if (!profile) return null;

  const update = (patch: Partial<ManagerProfile>) =>
    gameActions().setManagerProfile({ ...profile, ...patch });

  const age = /^\d{4}-\d{2}-\d{2}$/.test(profile.birthday) ? ageOn(profile.birthday, seasonStart) : null;

  const begin = () => {
    if (!isManagerProfileComplete(profile)) {
      setError('Give yourself a first name, a surname and a birthday.');
      return;
    }
    if (age === null || age < MIN_MANAGER_AGE || age > MAX_MANAGER_AGE) {
      setError(`A manager ought to be between ${MIN_MANAGER_AGE} and ${MAX_MANAGER_AGE}.`);
      return;
    }
    const trimmed = seed.trim();
    if (trimmed.length < 3) {
      setError('Give the world a seed of at least three characters.');
      return;
    }
    gameActions().createDraft(trimmed);
  };

  return (
    <div className="profile-setup">
      <SceneBackdrop />
      <PageHeader
        eyebrow={mode === 'create-club' ? 'Create a club' : 'New career'}
        title="Your profile"
        subtitle="Who you are, before you take charge of anybody."
        actions={
          <Button variant="ghost" onClick={() => gameActions().cancelSetup()}>
            Back to menu
          </Button>
        }
      />

      <div className="profile-setup__grid">
        <Panel title="Your details" subtitle="This is how the local game will know you">
          <div className="form-grid">
            <label className="field">
              <span className="field__label">First name</span>
              <input
                className="input"
                value={profile.firstName}
                onChange={(event) => update({ firstName: event.target.value })}
                placeholder="e.g. Dave"
              />
            </label>
            <label className="field">
              <span className="field__label">Surname</span>
              <input
                className="input"
                value={profile.surname}
                onChange={(event) => update({ surname: event.target.value })}
                placeholder="e.g. Fletcher"
              />
            </label>
            <label className="field">
              <span className="field__label">Nickname (optional)</span>
              <input
                className="input"
                value={profile.nickname}
                onChange={(event) => update({ nickname: event.target.value })}
                placeholder="what the lads call you"
              />
            </label>
            <label className="field">
              <span className="field__label">Date of birth</span>
              <input
                className="input"
                type="date"
                value={profile.birthday}
                onChange={(event) => update({ birthday: event.target.value })}
              />
              <span className="field__hint">{age !== null ? `Age ${age}` : 'Pick a date'}</span>
            </label>
            <label className="field">
              <span className="field__label">Day job</span>
              <input
                className="input"
                value={profile.occupation}
                onChange={(event) => update({ occupation: event.target.value })}
                placeholder="e.g. Scaffolder"
              />
            </label>
            <label className="field">
              <span className="field__label">Where you are from</span>
              <input
                className="input"
                value={profile.hometown}
                onChange={(event) => update({ hometown: event.target.value })}
                placeholder="a town, or leave it blank"
              />
            </label>
          </div>
        </Panel>

        <Panel
          title="The world"
          subtitle={
            mode === 'create-club'
              ? 'Generate the local game you are putting a club into.'
              : 'The same seed always makes the same towns, clubs and players.'
          }
        >
          <label className="field">
            <span className="field__label">World seed</span>
            <input
              className="input"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="any words or numbers"
            />
          </label>
          <div className="row row--wrap">
            {SUGGESTED_SEEDS.map((suggestion) => (
              <Button key={suggestion} variant="ghost" onClick={() => setSeed(suggestion)}>
                {suggestion}
              </Button>
            ))}
          </div>
          <div className="row">
            <Button variant="primary" onClick={begin}>
              {mode === 'create-club' ? 'Generate world and design your club' : 'Generate world'}
            </Button>
          </div>
          {error && <p className="tone tone--bad">{error}</p>}
        </Panel>
      </div>
    </div>
  );
}
