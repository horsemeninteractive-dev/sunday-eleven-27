import { useState } from 'react';
import { versionLabel } from '@/version';
import { gameActions } from '../hooks';
import { Button } from '../components/primitives';
import { Glyph } from '../components/icons';
import { Dialog } from '../dialogs/Dialog';
import { SaveManager } from '../dialogs/SaveManager';

/** Club business stays in the shell; local career tools have one home. */
export function UtilityMenu({ compact = false, icon = false }: { compact?: boolean; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const [savesOpen, setSavesOpen] = useState(false);
  const openDialog = (dialog: 'preferences' | 'changelog' | 'credits' | 'profiles') => { setOpen(false); gameActions().openDialog(dialog); };
  return <>
    <button type="button" className={icon ? 'topbar__icon' : `utility__trigger${compact ? ' utility__trigger--compact' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label="Settings and saved careers" title="Settings and saved careers" onClick={() => setOpen(true)}><Glyph name="settings" />{!icon && <span>Settings</span>}</button>
    {open && <Dialog title="The game" subtitle={versionLabel()} narrow onClose={() => setOpen(false)}>
      <div className="stack"><Button variant="primary" onClick={() => { setOpen(false); setSavesOpen(true); }}>Save or load a career</Button><div className="row row--wrap"><Button variant="ghost" onClick={() => openDialog('preferences')}>Preferences</Button><Button variant="ghost" onClick={() => openDialog('profiles')}>Managers</Button><Button variant="ghost" onClick={() => openDialog('changelog')}>Changelog</Button><Button variant="ghost" onClick={() => openDialog('credits')}>Credits</Button></div><p className="small muted">Your career is saved as you play. Returning to the menu leaves your saved club waiting under Continue.</p><Button variant="ghost" onClick={() => { setOpen(false); void gameActions().quitToMenu(); }}><Glyph name="exit" /> Return to the main menu</Button></div>
    </Dialog>}
    {savesOpen && <SaveManager onClose={() => setSavesOpen(false)} />}
  </>;
}
