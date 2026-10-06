import { useState } from 'react';
import type { ViewId } from '@/state/gameStore';
import { NAV_SECTIONS, navSectionFor, type NavSection } from '../navigation';
import { useUnreadMessages } from '../hooks';
import { Glyph } from '../components/icons';

/**
 * Desktop navigation.
 *
 * A handful of sections — Team, Recruitment, Competitions, Media, Club — each
 * opening onto its own screens. The section holding the current screen starts
 * open; the rest stay out of the way until they are wanted.
 *
 * The sections scroll when they outgrow the window; Messages does not. It is
 * drawn below the scroller rather than in the list, because it is the one
 * destination that can be waiting on the manager without his knowing — and a
 * message he never finds out about is the whole thing Messages exists to stop.
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
  const unread = useUnreadMessages();

  const isOpen = (section: NavSection) => {
    if (section.direct) return true;
    return collapsed[section.id] !== undefined ? !collapsed[section.id] : section.id === activeSection;
  };

  const renderSection = (section: NavSection) => {
    if (section.direct) {
      const leaf = section.leaves[0]!;
      const active = view === leaf.id;
      // Messages is the one destination that can be waiting on the manager
      // without his knowing, so it is the one that carries a count.
      const badge = leaf.id === 'inbox' && unread > 0 ? unread : null;
      return (
        <div className="sidenav__group" key={section.id}>
          <button
            type="button"
            className={`sidenav__item${active ? ' sidenav__item--active' : ''}`}
            aria-current={active ? 'page' : undefined}
            title={badge ? `${leaf.hint} — ${badge} unread` : leaf.hint}
            onClick={() => onNavigate(leaf.id)}
          >
            <Glyph name={section.icon} />
            <span>{section.label}</span>
            {badge && (
              <span className="sidenav__badge" aria-label={`${badge} unread`}>
                {badge}
              </span>
            )}
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
  };

  // The sections scroll; the pinned ones do not. Splitting on the flag rather
  // than on a hard-coded id keeps the decision where it is explained, in the
  // navigation model beside every other choice about what sits where.
  const scrollingSections = NAV_SECTIONS.filter((section) => !section.pinned);
  const pinnedSections = NAV_SECTIONS.filter((section) => section.pinned);

  return (
    <nav className="sidenav" aria-label="Sections">
      <div className="sidenav__scroll">
        {scrollingSections.map(renderSection)}

        {hasSession && (
          <button type="button" className="sidenav__live" onClick={() => onNavigate('match')}>
            <Glyph name="match" />
            <span>Match in progress</span>
          </button>
        )}
      </div>

      {pinnedSections.length > 0 && <div className="sidenav__foot">{pinnedSections.map(renderSection)}</div>}
    </nav>
  );
}
