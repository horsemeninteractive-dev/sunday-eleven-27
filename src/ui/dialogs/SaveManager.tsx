import { useEffect, useState } from 'react';
import type { SaveSlotInfo } from '@/state/persistence';
import { formatShortDate } from '@/simulation/calendar';
import { useGameStore } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { loadCareer } from '../careerActions';
import { Button } from '../components/primitives';
import { Dialog } from './Dialog';

const SLOTS = ['slot-1', 'slot-2', 'slot-3'];
export function SaveManager({ onClose }: { onClose: () => void }) {
  const [saves, setSaves] = useState<SaveSlotInfo[] | null>(null);
  const [overwrite, setOverwrite] = useState<SaveSlotInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { let current = true; void gameActions().listSaves().then((listed) => { if (current) setSaves(listed); }).catch(() => { if (current) setFailure('The saved careers could not be listed. Close this window and try again.'); }); return () => { current = false; }; }, []);
  const save = async (slot: string) => {
    setBusy(true);
    useGameStore.setState({ error: null });
    try {
      await gameActions().saveGame(slot);
      if (!useGameStore.getState().error) { setSaves(await gameActions().listSaves()); setOverwrite(null); }
    } catch { setFailure('The browser could not save this career. Your current club is still open.'); }
    finally { setBusy(false); }
  };
  return <>
    <Dialog title="Saved careers" subtitle="Local to this browser · whole-world saves" narrow onClose={() => { if (!busy) onClose(); }}>
      {failure && <p className="tone tone--bad" role="alert">{failure}</p>}
      {saves === null ? <p role="status">Reading saved careers…</p> : <ul className="save-list">
        {SLOTS.map((slot, index) => { const stored = saves.find((entry) => entry.slot === slot); return <li key={slot} className="save-list__item">
          <div className="save-list__main"><strong>Slot {index + 1} · {stored?.clubName ?? 'Empty'}</strong><p className="small muted">{stored ? `${stored.seasonLabel} · ${formatShortDate(stored.date)}` : 'Ready for a snapshot of this career'}</p></div>
          <div className="row row--wrap"><Button disabled={busy} onClick={() => stored ? setOverwrite(stored) : void save(slot)}>{stored ? 'Replace' : 'Save here'}</Button><Button variant="ghost" disabled={busy || !stored} onClick={() => { onClose(); void loadCareer(slot); }}>Load</Button></div>
        </li>; })}
        {saves.filter((entry) => entry.auto).map((entry) => <li key={entry.slot} className="save-list__item"><div><strong>Autosave · {entry.clubName}</strong><p className="small muted">{entry.seasonLabel} · {formatShortDate(entry.date)}</p></div><Button variant="ghost" disabled={busy} onClick={() => { onClose(); void loadCareer(entry.slot); }}>Load autosave</Button></li>)}
      </ul>}
      <p className="small muted" role={busy ? 'status' : undefined}>{busy ? 'Saving the whole career…' : 'Autosave keeps the current career up to date. Manual slots stay as you left them.'}</p>
    </Dialog>
    {overwrite && <Dialog title="Replace this saved career?" narrow onClose={() => { if (!busy) setOverwrite(null); }} footer={<><Button variant="ghost" disabled={busy} onClick={() => setOverwrite(null)}>Keep existing save</Button><Button variant="danger" disabled={busy} onClick={() => void save(overwrite.slot)}>Replace save</Button></>}><p><strong>{overwrite.clubName}</strong>, {overwrite.seasonLabel}, {formatShortDate(overwrite.date)} will be replaced with your current career. This cannot be undone.</p></Dialog>}
  </>;
}
