import { useRef, useState } from 'react';
import { formatShortDate } from '@/simulation/calendar';
import { useGameStore } from '@/state/gameStore';
import { Button } from './primitives';
import { Dialog } from '../dialogs/Dialog';
import {
  cancelImport,
  confirmImport,
  exportCurrentCareer,
  exportNotice,
  stageCareerFile,
  useStagedCareer,
} from '../saveTransfer';

/**
 * A career leaving the game, and a career coming back into it.
 *
 * These two are the same idea from either end, so they live together and are
 * shaped the same way: one button that does the thing, and — for the way in —
 * the question that has to be answered before it happens. The screens that offer
 * them are the menu, where a manager restoring a backup onto a new device
 * arrives, and the save screen inside a career, where one making a copy of a
 * season he cares about arrives. Neither screen owns the flow; it lives in
 * `saveTransfer`.
 */

/**
 * Write the career being played out to a file.
 *
 * The button says what it is doing while it does it, because writing a whole
 * world out is not instant and a button that appears to have been ignored gets
 * pressed again.
 */
export function ExportCareerButton({ block = false }: { block?: boolean }) {
  const [busy, setBusy] = useState(false);
  const runExport = async () => {
    setBusy(true);
    try {
      const result = await exportCurrentCareer();
      if ('error' in result) useGameStore.setState({ error: result.error });
      else {
        // Where it went when the host can say — on a phone the file is put down
        // by the application itself, so "written" on its own is a file the
        // manager would then have to go and look for.
        useGameStore.setState({ notice: exportNotice(result) });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button block={block} disabled={busy} onClick={() => void runExport()}>
      {busy ? 'Writing the file…' : 'Export career to a file'}
    </Button>
  );
}

/**
 * Choose a career file to restore.
 *
 * The input is the browser's own file picker, hidden behind a button: it is the
 * only control that can reach a file the manager already has, and a manager who
 * changes his mind simply closes it — no file chosen is not an error, and there
 * is nothing to report.
 */
export function ImportCareerButton({
  label = 'Restore from a file…',
  variant = 'ghost',
  size = 'md',
  block = false,
}: {
  label?: string;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant={variant} size={size} block={block} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label={label}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same file twice in a row is still a change
          // — which is what makes "try that one again" possible after a file has
          // been turned down.
          event.target.value = '';
          void readChosenFile(file);
        }}
      />
    </>
  );
}

async function readChosenFile(file: File | undefined): Promise<void> {
  if (!file) return;
  try {
    stageCareerFile(file.name, await file.text());
  } catch (error) {
    console.warn('The career file could not be read from the device.', error);
    useGameStore.setState({ error: 'That file could not be read from your device. Nothing has been changed.' });
  }
}

/**
 * The file that has been read, put to the manager before it is opened.
 *
 * What it says first is what he would recognise — the club, the season, the day
 * the career had reached — and only then the bookkeeping. It says plainly what
 * will change and, just as importantly, what will not: his own slots are left
 * exactly as they are, so a career he is proud of is not lost by trying a file
 * he was sent.
 */
export function CareerImportConfirm() {
  const staged = useStagedCareer();
  if (!staged) return null;
  const { career, fileName, replaces } = staged;
  const from = career.seasonLabel ? `${career.clubName}, ${career.seasonLabel}` : career.clubName;
  return (
    <Dialog
      title="Open this career file?"
      subtitle={fileName}
      kind="confirm"
      narrow
      onClose={cancelImport}
      footer={
        <>
          <Button variant="ghost" onClick={cancelImport}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirmImport()}>
            Open it
          </Button>
        </>
      }
    >
      <p>
        <strong>{from}</strong> · in-game {formatShortDate(career.date)}
      </p>
      <p className="small muted">
        {career.saveName} · seed “{career.seed}” · written by Sunday Eleven {career.writtenBy}
        {career.savedAt ? ` on ${formatShortDate(career.savedAt.slice(0, 10))}` : ''} · save version{' '}
        {career.fromVersion}
      </p>
      {replaces ? (
        <p>
          It will take over from <strong>{replaces.clubName}</strong>
          {replaces.seasonLabel ? `, ${replaces.seasonLabel}` : ''} as the career being played, and the autosave
          will hold it instead. Careers in your own slots are left exactly as they are.
        </p>
      ) : (
        <p>
          It will become the career being played, and the autosave will hold it. Anything already saved in your
          own slots is left exactly as it is.
        </p>
      )}
      <p className="small muted">
        If you want to keep a copy of the career you are playing now, cancel this and export it first.
      </p>
    </Dialog>
  );
}
