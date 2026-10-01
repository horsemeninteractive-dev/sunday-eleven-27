import { useEffect } from 'react';
import type { ViewId } from '@/state/gameStore';
import { MOBILE_MORE_SECTIONS, MOBILE_PRIMARY } from '../navigation';
import { gameActions } from '../hooks';
import { Glyph } from '../components/icons';
import { Button } from '../components/primitives';

const SLOTS = ['slot-1', 'slot-2', 'slot-3'];

/**
 * Mobile navigation: five destinations a thumb can reach, and everything else
 * one tap behind More. Deliberately not the desktop list wrapped onto a phone.
 */
export function MobileNav({
  view,
  hasSession,
  open,
  onOpenChange,
  onNavigate,
}: {
  view: ViewId;
  hasSession: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: ViewId) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const go = (destination: ViewId) => {
    onNavigate(destination);
    onOpenChange(false);
  };

  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {MOBILE_PRIMARY.map((destination) => {
          if (destination.id === 'more') {
            return (
              <button
                key="more"
                type="button"
                className={`tabbar__item${open ? ' tabbar__item--active' : ''}`}
                aria-expanded={open}
                onClick={() => onOpenChange(!open)}
              >
                <Glyph name="more" />
                <span>{destination.label}</span>
              </button>
            );
          }
          const active = view === destination.id;
          return (
            <button
              key={destination.id}
              type="button"
              className={`tabbar__item${active ? ' tabbar__item--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => go(destination.id as ViewId)}
            >
              <Glyph name={destination.icon} />
              <span>{destination.label}</span>
            </button>
          );
        })}
      </nav>

      {open && (
        <div className="sheet-layer">
          <button type="button" className="sheet__backdrop" aria-label="Close menu" onClick={() => onOpenChange(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="All screens">
            <div className="sheet__grab" aria-hidden="true" />
            {hasSession && (
              <button type="button" className="sheet__live" onClick={() => go('match')}>
                <Glyph name="match" />
                <span>Return to the match in progress</span>
              </button>
            )}
            {MOBILE_MORE_SECTIONS.map((group) => (
              <section className="sheet__group" key={group.id}>
                <h2 className="sheet__label">{group.label}</h2>
                <ul className="sheet__list">
                  {group.leaves.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`sheet__item${view === item.id ? ' sheet__item--active' : ''}`}
                        aria-current={view === item.id ? 'page' : undefined}
                        onClick={() => go(item.id)}
                      >
                        <Glyph name={item.icon} />
                        <span className="sheet__item-text">
                          <strong>{item.label}</strong>
                          <span className="muted small">{item.hint}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section className="sheet__group">
              <h2 className="sheet__label">The week</h2>
              <ul className="sheet__list">
                <li>
                  <button
                    type="button"
                    className="sheet__item"
                    onClick={() => {
                      gameActions().openPlanner();
                      onOpenChange(false);
                    }}
                  >
                    <Glyph name="calendar" />
                    <span className="sheet__item-text">
                      <strong>The calendar</strong>
                      <span className="muted small">Advance the day, and see what is coming</span>
                    </span>
                  </button>
                </li>
              </ul>
            </section>

            <section className="sheet__group">
              <h2 className="sheet__label">Save and load</h2>
              <div className="sheet__buttons">
                {SLOTS.map((slot, index) => (
                  <Button key={slot} size="sm" onClick={() => { gameActions().saveGame(slot); onOpenChange(false); }}>
                    Save {index + 1}
                  </Button>
                ))}
                {SLOTS.map((slot, index) => (
                  <Button key={slot} variant="ghost" size="sm" onClick={() => { gameActions().loadGame(slot); onOpenChange(false); }}>
                    Load {index + 1}
                  </Button>
                ))}
                <Button variant="danger" size="sm" onClick={() => { gameActions().quitToMenu(); onOpenChange(false); }}>
                  Quit to menu
                </Button>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
