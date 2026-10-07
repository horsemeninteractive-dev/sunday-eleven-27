import { useEffect, useState } from 'react';
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
 *
 * At rest the nav is an icon rail: every screen gets the width the labels were
 * using, and the nav opens on hover or on keyboard focus. It reports that one
 * fact upwards — the shell owns the class that widens the frame's first
 * column — rather than deciding anything about layout itself.
 *
 * The two halves are kept separately because they end at different moments. A
 * click in the nav moves focus to the new screen's heading, which is *outside*
 * the nav: if pointer and focus were one flag, navigating with the mouse would
 * close the rail under the pointer that was still in it.
 *
 * Labels are clipped rather than removed when the rail is closed, because a
 * clipped label is still the button's accessible name and a removed one is
 * eleven anonymous buttons.
 */
export function SideNav({
  view,
  hasSession,
  onNavigate,
  onOpenChange,
}: {
  view: ViewId;
  hasSession: boolean;
  onNavigate: (view: ViewId) => void;
  /** Whether the manager is reading the navigation right now. */
  onOpenChange: (open: boolean) => void;
}) {
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const open = pointerInside || focusInside;

  useEffect(() => {
    onOpenChange(open);
  }, [open, onOpenChange]);

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
            <span className="sidenav__label">{section.label}</span>
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
          <span className="sidenav__label">{section.label}</span>
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
                    <span className="sidenav__label">{leaf.label}</span>
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
    <nav
      className="sidenav"
      aria-label="Sections"
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
      onFocusCapture={() => setFocusInside(true)}
      onBlurCapture={(event) => {
        // Only when focus has actually left the navigation: moving between two
        // of its own buttons is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false);
      }}
    >
      <div className="sidenav__scroll">
        {scrollingSections.map(renderSection)}

        {hasSession && (
          <button type="button" className="sidenav__live" onClick={() => onNavigate('match')}>
            <Glyph name="match" />
            <span className="sidenav__label">Match in progress</span>
          </button>
        )}
      </div>

      {pinnedSections.length > 0 && <div className="sidenav__foot">{pinnedSections.map(renderSection)}</div>}
    </nav>
  );
}
