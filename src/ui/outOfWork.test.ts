import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The game a manager between jobs is shown.
 *
 * Being sacked is not just a new screen: it changes which screens *exist*. The
 * squad, the tactics sheet, the books and the fixtures all belonged to a club
 * that is no longer his, so the shell hands him the ones that are nobody's —
 * his own page, his messages, the local paper and the world he is looking for
 * work in — and the job board on Home for everything else.
 *
 * The three pieces are pinned here because they are three files that have to
 * agree: the model says which views survive unemployment, the router asks it,
 * and both navigations are drawn from the same answer. A sidebar offering a
 * screen the router refuses is the bug this is here to catch, and so is a
 * sidebar missing a screen he can actually open.
 */

const source = (path: string) => readFileSync(`src/ui/${path}`, 'utf8');

describe('the game a manager between jobs is shown', () => {
  it('routes the screens that are not about a club, and the job board for the rest', () => {
    const app = source('App.tsx');
    // The view he is handed is the *resolved* one, so the heading, the
    // breadcrumb and the navigation all agree with the screen he is on.
    expect(app).toContain("const available = isAvailableOutOfWork(view) ? view : 'dashboard'");
    expect(app).toContain('<AppShell game={game} view={available} outOfWork>');
    expect(app).toContain("available === 'dashboard' ? <BetweenJobsView /> : <ViewRouter view={available} />");
    expect(app).toContain("import { isAvailableOutOfWork } from './navigation'");
  });

  it('narrows both navigations to the screens that still exist', () => {
    expect(source('layout/AppShell.tsx')).toContain('outOfWork={outOfWork}');
    const side = source('layout/SideNav.tsx');
    expect(side).toContain('navSectionsFor(outOfWork)');
    expect(side).not.toContain('NAV_SECTIONS');
    const mobile = source('layout/MobileNav.tsx');
    expect(mobile).toContain('mobilePrimaryFor(outOfWork)');
    expect(mobile).toContain('mobileMoreSectionsFor(outOfWork)');
    expect(mobile).not.toContain('MOBILE_MORE_SECTIONS');
  });

  it('does not name a club as his while he has not got one', () => {
    // `userClubId` survives unemployment on purpose — the archive and the club
    // pages point at the club he last managed — so every screen that says "yours"
    // has to ask the career rather than the id.
    const manager = source('views/ManagerView.tsx');
    expect(manager).toContain('managingClubId(game)');
    expect(manager).not.toContain('userClub(game)');
    expect(manager).toContain('between jobs');
    expect(source('views/WorldView.tsx')).toContain('const myClubId = managingClubId(game)');
    expect(source('components/ProfileOverlay.tsx')).toContain('const myClubId = managingClubId(game)');
  });

  it('says why the club screens have gone, rather than leaving a shorter game unexplained', () => {
    expect(source('views/BetweenJobsView.tsx')).toContain('come back the day a committee takes you on');
  });
});
