import { useState } from 'react';
import { ageOn } from '@/domain/manager';
import { describeProfile, forgetProfile, listProfiles, type SavedProfile } from '@/state/managerProfiles';
import { gameActions } from '../hooks';
import { Button } from '../components/primitives';
import { Dialog } from './Dialog';

/**
 * The managers this browser already knows.
 *
 * A career starts by asking who you are, and it is nearly always the same
 * answer as last time — so the answer is kept the moment a career begins, and
 * offered back on the profile screen. This is where one is struck off, which is
 * the only housekeeping that list needs.
 */
export function ProfilesDialog() {
  const [profiles, setProfiles] = useState<SavedProfile[]>(() => listProfiles());
  const today = new Date().toISOString().slice(0, 10);

  const forget = (id: string) => {
    forgetProfile(id);
    setProfiles(listProfiles());
  };

  return (
    <Dialog
      title="Managers"
      subtitle={profiles.length === 1 ? '1 saved' : `${profiles.length} saved`}
      narrow
      onClose={() => gameActions().closeDialog()}
    >
      {profiles.length === 0 ? (
        <p className="empty">
          Nothing saved yet. Start a career and the manager you write — his name, his birthday, his day job — is kept
          here, so the next one is a click rather than a form.
        </p>
      ) : (
        <ul className="save-list">
          {profiles.map((entry) => (
            <li className="save-list__item" key={entry.id}>
              <div className="save-list__main">
                <strong>{describeProfile(entry.profile, ageOn(entry.profile.birthday, today))}</strong>
                <div className="muted small">
                  {entry.profile.hometown.trim() || 'No hometown given'} ·{' '}
                  {entry.careers === 1 ? 'one career' : `${entry.careers} careers`} · last used{' '}
                  {entry.savedAt.slice(0, 10)}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => forget(entry.id)}>
                Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Managers are kept in this browser, separate from your saves. Forgetting one never touches a career — it only
        means typing the details again next time.
      </p>
    </Dialog>
  );
}
