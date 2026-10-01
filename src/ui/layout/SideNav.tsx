import { useState } from 'react';
import type { ViewId } from '@/state/gameStore';
import { NAV_SECTIONS, navSectionFor, type NavSection } from '../navigation';
import { Glyph } from '../components/icons';

/**
 * Desktop navigation.
 *
 * A handful of sections — Team, Recruitment, Competitions, Media, Club — each
 * opening onto its own screens. The section holding the current screen starts
 * open; the rest stay out of the way until they are wanted.
 */
export function SideNav({
  view,
  hasSession,
  onNavigate,
}: {
  view: ViewId;
  hasSession: boolean;
  onNavigate: (view: ViewId) => void;
}) {
  const activeSection = navSectionFor(view)?.id;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isOpen = (section: NavSection) => {
    if (section.direct) return true;
    return collapsed[section.id] !== undefined ? !collapsed[section.id] : section.id === activeSection;
  };

  return (
    <nav className="sidenav" aria-label="Sections">
      {NAV_SECTIONS.map((section) => {
        if (section.direct) {
          const leaf = section.leaves[0]!;
          const active = view === leaf.id;
          return (
            <div className="sidenav__group" key={section.id}>
              <button
                type="button"
                className={`sidenav__item${active ? ' sidenav__item--active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={leaf.hint}
                onClick={() => onNavigate(leaf.id)}
              >
                <Glyph name={section.icon} />
                <span>{section.label}</span>
              </button>
            </div>
          );
        }

        const open = isOpen(section);
        const containsActive = section.id === activeSection;
        return (
          <div className="sidenav__group" key={section.id}>
            <button
              type="button"
              className={`sidenav__toggle${containsActive ? ' sidenav__toggle--has-active' : ''}`}
              aria-expanded={open}
              onClick={() => setCollapsed((current) => ({ ...current, [section.id]: open }))}
            >
              <Glyph name={section.icon} />
              <span>{section.label}</span>
              <Glyph name="chevron" className={`sidenav__chevron${open ? ' sidenav__chevron--open' : ''}`} />
            </button>
            {open && (
              <ul className="sidenav__list">
                {section.leaves.map((leaf) => {
                  const active = view === leaf.id;
                  return (
                    <li key={leaf.id}>
                      <button
                        type="button"
                        className={`sidenav__item${active ? ' sidenav__item--active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={leaf.hint}
                        onClick={() => onNavigate(leaf.id)}
                      >
                        <Glyph name={leaf.icon} />
                        <span>{leaf.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {hasSession && (
        <button type="button" className="sidenav__live" onClick={() => onNavigate('match')}>
          <Glyph name="match" />
          <span>Match in progress</span>
        </button>
      )}
    </nav>
  );
}
