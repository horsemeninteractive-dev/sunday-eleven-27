import { useMemo, useState } from 'react';
import { ageOn, isManagerProfileComplete, MAX_MANAGER_AGE, MIN_MANAGER_AGE, type ManagerProfile } from '@/domain/manager';
import { firstSundayOfSeptember } from '@/simulation/gameSetup';
import { preSeasonStart } from '@/simulation/calendar';
import { weekStartOf } from '@/simulation/timeline';
import { MIN_SEED_LENGTH, pickSuggestedSeeds, rollSeed, seedIsUsable } from '@/simulation/generation/seeds';
import { useGameStore } from '@/state/gameStore';
import { listProfiles } from '@/state/managerProfiles';
import { gameActions } from '../hooks';
import { Button, PageHeader, Panel } from '../components/primitives';
import { SceneBackdrop } from '../components/SceneBackdrop';

/**
 * How many of the offered worlds the panel shows.
 *
 * The seed list is long enough that showing all of it would be a wall of
 * buttons over the form, so the panel offers a handful and a press that invents
 * the next one. Between the two, four worlds are never the whole offer.
 */
const SUGGESTIONS_SHOWN = 9;
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
  // The world the manager is about to walk into, and a handful of others to
  // choose from: a rolled one cannot be a repeat of the list he was just shown.
  const [seed, setSeed] = useState(() => rollSeed());
  // Fresh on every visit, so the panel is never the same nine worlds twice.
  const suggestions = useMemo(() => pickSuggestedSeeds(SUGGESTIONS_SHOWN), []);
  const [error, setError] = useState<string | null>(null);
  // Read once when the screen opens: it is a shortcut into the form, not
  // something that has to keep up with what is typed.
  const [saved] = useState(() => listProfiles());

  const seasonStart = useMemo(
    () => weekStartOf(preSeasonStart(firstSundayOfSeptember(START_YEAR))),
    [],
  );

  if (!profile) return null;

  const update = (patch: Partial<ManagerProfile>) =>
    gameActions().setManagerProfile({ ...profile, ...patch });

  const age = /^\d{4}-\d{2}-\d{2}$/.test(profile.birthday) ? ageOn(profile.birthday, seasonStart) : null;

  /**
   * Whether the header button should be live.
   *
   * The same three conditions `begin` checks, read up front so the button can be
   * disabled rather than clicked into an error. Both use one source of truth on
   * purpose: a button that is wrong about being enabled is worse than no
   * pre-check at all.
   */
  const ready =
    isManagerProfileComplete(profile) &&
    age !== null &&
    age >= MIN_MANAGER_AGE &&
    age <= MAX_MANAGER_AGE &&
    seedIsUsable(seed);

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
        subtitle="Step 1 of 2 · Introduce yourself, then choose or build your club."
        actions={
          <>
            <Button variant="ghost" onClick={() => gameActions().cancelSetup()}>
              Back to menu
            </Button>
            {/* The one button that starts a career, beside the one that gives
                up. It was at the bottom of the form, under a panel about world
                seeds, which put the last step of the setup below the fold on a
                laptop. */}
            <Button variant="primary" onClick={begin} disabled={!ready}>
              {mode === 'create-club' ? 'Generate world and design your club' : 'Generate world'}
            </Button>
          </>
        }
      />

      <div className="profile-setup__grid">
        <Panel title="Your details">
          {/* A manager who has been here before should not have to type his own
              birthday in again: the profiles he has used are one click away. */}
          {saved.length > 0 && (
            <div className="savedmanagers">
              <p className="small muted">Saved profiles</p>
              <div className="row row--wrap">
                {saved.map((entry) => (
                  <Button
                    key={entry.id}
                    variant="ghost"
                    size="sm"
                    title={entry.profile.occupation ? `${entry.profile.occupation}` : undefined}
                    onClick={() => gameActions().setManagerProfile(entry.profile)}
                  >
                    {entry.profile.firstName} {entry.profile.surname}
                    {entry.profile.nickname.trim() ? ` “${entry.profile.nickname.trim()}”` : ''}
                    {entry.careers > 1 ? ` · ${entry.careers} careers` : ''}
                  </Button>
                ))}
              </div>
            </div>
          )}
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
              <span className={`field__hint${age !== null && (age < MIN_MANAGER_AGE || age > MAX_MANAGER_AGE) ? ' tone tone--bad' : ''}`}>{age !== null ? `Age ${age}${age < MIN_MANAGER_AGE || age > MAX_MANAGER_AGE ? ` · choose an age from ${MIN_MANAGER_AGE} to ${MAX_MANAGER_AGE}` : ''}` : 'Pick a date'}</span>
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

        <Panel title="The world">
          <label className="field">
            <span
              className="field__label"
              title="The same seed always makes the same towns, clubs and players."
            >
              World seed
            </span>
            <input
              className="input"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="any words or numbers"
            />
          </label>
          <div className="row row--wrap">
            {suggestions.map((suggestion) => (
              <Button key={suggestion} variant="ghost" onClick={() => setSeed(suggestion)}>
                {suggestion}
              </Button>
            ))}
            <Button
              variant="ghost"
              onClick={() => setSeed(rollSeed())}
              title="Invent another world and put it in the box above"
            >
              Another one
            </Button>
          </div>
          <p className="muted small">
            {ready
              ? 'The world is built from the seed above — the same words always make the same towns, clubs and players.'
              : 'Fill in your name and your date of birth to carry on.'}
          </p>
          {!seedIsUsable(seed) && (
            <p className="small tone tone--bad">The world seed needs at least {MIN_SEED_LENGTH} characters.</p>
          )}
          {error && <p className="tone tone--bad" role="alert">{error}</p>}
        </Panel>
      </div>
    </div>
  );
}
