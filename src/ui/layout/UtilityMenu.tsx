import { useEffect, useRef, useState } from 'react';
import { versionLabel } from '@/version';
import { gameActions } from '../hooks';
import { Button } from '../components/primitives';
import { Glyph } from '../components/icons';

const SLOTS = ['slot-1', 'slot-2', 'slot-3'];

/**
 * Settings.
 *
 * Saving, loading, how the game behaves and leaving it are all important and
 * none of them are football, so they live behind one control rather than
 * scattered through the header. The header is for the club.
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

  const openDialog = (dialog: 'preferences' | 'changelog') => {
    setOpen(false);
    gameActions().openDialog(dialog);
  };

  return (
    <div className="utility" ref={ref}>
      <button
        type="button"
        className={icon ? 'topbar__icon' : `utility__trigger${compact ? ' utility__trigger--compact' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((value) => !value)}
      >
        <Glyph name="settings" />
        {!icon && <span>Settings</span>}
      </button>

      {open && (
        <div className="utility__panel" role="menu" aria-label="Settings">
          <div className="utility__section">
            <p className="utility__heading">Save to a local slot</p>
            <div className="utility__row">
              {SLOTS.map((slot, index) => (
                <Button
                  key={slot}
                  size="sm"
                  onClick={() => {
                    gameActions().saveGame(slot);
                    setOpen(false);
                  }}
                >
                  Slot {index + 1}
                </Button>
              ))}
            </div>
          </div>

          <div className="utility__section">
            <p className="utility__heading">Load a saved game</p>
            <div className="utility__row">
              {SLOTS.map((slot, index) => (
                <Button
                  key={slot}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    gameActions().loadGame(slot);
                    setOpen(false);
                  }}
                >
                  Slot {index + 1}
                </Button>
              ))}
              {autosave && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    gameActions().loadGame(autosave.slot);
                    setOpen(false);
                  }}
                >
                  Last autosave
                </Button>
              )}
            </div>
          </div>

          <div className="utility__section">
            <p className="utility__heading">The game</p>
            <div className="utility__row">
              <Button variant="ghost" size="sm" onClick={() => openDialog('preferences')}>
                Preferences
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openDialog('changelog')}>
                Changelog
              </Button>
            </div>
          </div>

          <p className="utility__note">
            Slots live in this browser and hold the whole world, not just your club. Three slots, overwritten when you
            reuse one. The game also saves as you play, so a closed tab never costs you a season.
          </p>

          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              gameActions().quitToMenu();
              setOpen(false);
            }}
          >
            <Glyph name="exit" /> Return to the main menu
          </Button>

          <p className="utility__version">
            {versionLabel()} — leaving for the menu keeps your career: it is waiting under Continue.
          </p>
        </div>
      )}
    </div>
  );
}
