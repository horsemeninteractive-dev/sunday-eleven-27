import type { ViewId } from '@/state/gameStore';
import { navLeafFor, navSectionFor } from '../navigation';
import { Glyph } from '../components/icons';

/**
 * The way back.
 *
 * A management game is a maze of screens reached from each other — a name in a
 * news item opens a player, whose club opens the table, whose table opens
 * another club — and the further in you go, the harder it is to remember how
 * you got there. The trail is short, because the game is only ever two deep:
 * the club, the section, the screen. It sits in the footer so that it is in the
 * same place on every page, and every crumb above the current one is a door.
 *
 * The trail is read from the same model the sidebar is built from, so a screen
 * cannot appear in one and be missing from the other.
 */
export function Breadcrumbs({
  view,
  clubName,
  onNavigate,
}: {
  view: ViewId;
  clubName: string;
  onNavigate: (view: ViewId) => void;
}) {
  const section = navSectionFor(view);
  const leaf = navLeafFor(view);
  // Where the club's name goes: the front page of the career.
  const home: ViewId = 'dashboard';
  // Where a section goes: its first screen, which is what the section is for.
  const sectionLanding = section?.leaves[0]?.id ?? null;
  const showSection = Boolean(section && section.id !== 'home' && sectionLanding !== view);

  // The club is always the root of the trail, even from its own page, where the
  // crumb means "take me back to the top of it" — a manager two screens deep in
  // a fixture list wants the same door he would use from the squad list.
  const crumbs: Array<{ key: string; label: string; to: ViewId }> = [{ key: 'club', label: clubName, to: home }];
  if (showSection && section && sectionLanding) {
    // Keyed away from the club crumb: a screen whose section is the club would
    // otherwise put two children with the same key in the same list.
    crumbs.push({ key: `section:${section.id}`, label: section.label, to: sectionLanding });
  }

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs__trail">
        {crumbs.map((crumb) => (
          <li className="breadcrumbs__item" key={crumb.key}>
            <button type="button" className="breadcrumbs__crumb" onClick={() => onNavigate(crumb.to)}>
              {crumb.label}
            </button>
            <Glyph name="chevron" className="breadcrumbs__separator" />
          </li>
        ))}
        <li className="breadcrumbs__item">
          <span className="breadcrumbs__here" aria-current="page">
            {leaf?.label ?? 'Home'}
          </span>
        </li>
      </ol>
    </nav>
  );
}
