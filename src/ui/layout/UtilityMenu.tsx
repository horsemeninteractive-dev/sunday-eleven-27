import { useEffect, useRef, useState } from 'react';
import { gameActions } from '../hooks';
import { Button } from '../components/primitives';
import { Glyph } from '../components/icons';

const SLOTS = ['slot-1', 'slot-2', 'slot-3'];

/**
 * Saving, loading and quitting are important but they are not football.
 * They live here, behind one control, so the header can be about the club.
 */
export function UtilityMenu({ compact = false, icon = false }: { compact?: boolean; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // Read when the menu opens, like the start screen: the autosave moves on as
  // the manager plays, and the menu is not watching it.
  const autosave = open ? gameActions().listSaves().find((save) => save.auto) : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="utility" ref={ref}>
      <button
        type="button"
        className={icon ? 'topbar__icon' : `utility__trigger${compact ? ' utility__trigger--compact' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Save, load or quit"
        title="Save / load"
        onClick={() => setOpen((value) => !value)}
      >
        <Glyph name="save" />
        {!icon && <span>Save / load</span>}
      </button>

      {open && (
        <div className="utility__panel" role="menu" aria-label="Save and load">
          <div className="utility__section">
            <p className="utility__heading">Save to a local slot</p>
            <div className="utility__row">
              {SLOTS.map((slot, index) => (
                <Button key={slot} size="sm" onClick={() => { gameActions().saveGame(slot); setOpen(false); }}>
                  Slot {index + 1}
                </Button>
              ))}
            </div>
          </div>
          <div className="utility__section">
            <p className="utility__heading">Load a saved game</p>
            <div className="utility__row">
              {SLOTS.map((slot, index) => (
                <Button key={slot} variant="ghost" size="sm" onClick={() => { gameActions().loadGame(slot); setOpen(false); }}>
                  Slot {index + 1}
                </Button>
              ))}
              {autosave && (
                <Button variant="ghost" size="sm" onClick={() => { gameActions().loadGame(autosave.slot); setOpen(false); }}>
                  Last autosave
                </Button>
              )}
            </div>
          </div>
          <p className="utility__note">
            Slots live in this browser and hold the whole world, not just your club. Three slots, overwritten when you
            reuse one. The game also saves as you play, so a closed tab never costs you a season.
          </p>
          <Button variant="danger" size="sm" onClick={() => { gameActions().quitToMenu(); setOpen(false); }}>
            <Glyph name="exit" /> Quit to menu
          </Button>
        </div>
      )}
    </div>
  );
}
