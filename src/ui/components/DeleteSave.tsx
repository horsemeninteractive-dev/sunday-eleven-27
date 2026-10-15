import { useState } from 'react';
import { useGameStore } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { Button } from './primitives';
import { Dialog } from '../dialogs/Dialog';

/**
 * Removing a saved career from this browser.
 *
 * Saving and loading were the only two things a manager could do to a save for
 * as long as there have been saves, so a career he had finished with sat in its
 * slot forever — and the only way to be rid of it was to clear the browser's
 * storage, which takes every other career with it. This is the missing third
 * thing, and it is deliberately one control rather than two: the menu, where
 * nothing is being played and the whole list can be cleared, and the save screen
 * inside a career, where a manager tidies up his own slots. Both ask the same
 * question in the same words, because it is the same destructive act.
 *
 * It asks first, and that is the whole of its design. A saved career is a
 * season, and there is no undo and no trash: the question says what is going,
 * says that it cannot be brought back, and points at the way to keep a copy
 * instead — exporting a file, which is the one copy this browser's storage
 * cannot take away.
 *
 * The answer to the deletion is what decides what the screen says, not the
 * error banner. A browser that refuses the write leaves the slot exactly as it
 * was, and the manager is told so rather than being shown an empty row he would
 * then act on. The same rule the save screen already follows for a write.
 */
export function DeleteSaveButton({
  slot,
  label,
  onDeleted,
  size = 'sm',
  block = false,
  disabled = false,
}: {
  /** The slot to empty, as the store and the database name it. */
  slot: string;
  /**
   * What the manager would recognise the career by — the club and the season,
   * and the day it had reached if the screen knows it. It is what the question
   * names and what the confirmation afterwards repeats.
   */
  label: string;
  /** Called once the slot is empty, so the screen can read its list again. */
  onDeleted: () => void;
  size?: 'sm' | 'md';
  block?: boolean;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      if (await gameActions().deleteSave(slot)) {
        // The sentence is for the shell, which is where a notice is drawn — and
        // it is set only when there is a shell to draw it in. On the menu the
        // row going is the answer, and a notice raised there would be neither
        // read nor cleared: it would still be sitting in the store the next time
        // a career opened, saying something about a screen the manager has left.
        if (useGameStore.getState().game) useGameStore.setState({ notice: `Deleted ${label} from this browser.` });
        onDeleted();
      }
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        block={block}
        disabled={disabled}
        ariaLabel={`Delete ${label}`}
        onClick={() => setAsking(true)}
      >
        Delete
      </Button>
      {asking && (
        <Dialog
          title="Delete this saved career?"
          kind="confirm"
          narrow
          onClose={() => {
            if (!busy) setAsking(false);
          }}
          footer={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
                Keep it
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Deleting…' : 'Delete it'}
              </Button>
            </>
          }
        >
          <p>
            <strong>{label}</strong> will be removed from this browser, and there is no undo. If it is a career you
            might want back, export it to a file first — a file is the one copy clearing this browser's storage
            cannot take.
          </p>
        </Dialog>
      )}
    </>
  );
}
