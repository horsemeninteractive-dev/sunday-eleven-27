import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { simulateFixture } from '@/simulation/fastMatch';
import { nextFixtureFor } from '@/simulation/schedule';
import { homeBriefing } from '../homeBriefing';
import { MetricTile } from '../components/hierarchy';
import { ClubBand, NeedsYou, NextMatchHero, RecentForm } from './DashboardView';

/**
 * Home, as it is actually drawn.
 *
 * Four things about the screen can only be checked by printing it, and they are
 * the four the layout exists to do: that the club is *on* the screen at all —
 * crest, ground, nickname, motto and the man in charge, all read out of the save;
 * that the next fixture is printed as the shared fixture sheet with the way into
 * the team on it, and that a club with no fixture is told so instead of being
 * shown an empty one; that the loudest genuine decision is in front and the rest
 * of the same model's rows are behind it, with no row drawn twice; and that a run
 * of results is a run, each afternoon its own door into the report.
 *
 * Everything here comes from a real career — `createTestGame`, and for the form
 * strip a fixture actually played by `simulateFixture` — so the pieces are tested
 * against the state the game produces rather than against a hand-built state
 * somebody believed it produces. The pieces are rendered from the same props the
 * screen passes them, which is why they are exported: a layout that reads nothing
 * but what it is given can be checked without a browser.
 *
 * What a server render cannot prove is the store. Zustand hands React the store's
 * *initial* state on the server whatever has been written into it since, so every
 * control that reads the store — the kit on a portrait, the crest beside a club's
 * name — draws its no-career fallback here. That is why the assertions below are
 * about what each piece is *given*: the crest from its own prop, the manager's
 * drawn face from the club, the opponent's name from the fixture. The store-bound
 * halves are the store's own tests' business.
 */

/** A career to draw against. */
function career(seed: string): GameState {
  return createTestGame(seed).state;
}

const clubOf = (state: GameState) => state.clubs[state.userClubId]!;

const source = readFileSync('src/ui/views/DashboardView.tsx', 'utf8');

describe('the club band says where the manager is', () => {
  it('draws the club, its ground, the line it says about itself and the man in charge', () => {
    const state = career('dashboard-club-band');
    const club = clubOf(state);
    const town = state.world.towns[club.townId]!;
    const ground = state.world.grounds[club.groundId]!;
    const html = renderToStaticMarkup(createElement(ClubBand, { game: state, club }));

    expect(html).toContain('home-club');
    expect(html).toContain(club.identity.name);
    expect(html).toContain(club.identity.nickname);
    expect(html).toContain(town.name);
    expect(html).toContain(ground.name);
    expect(html).toContain(club.identity.motto);
    // The season, because it is what dates the band.
    expect(html).toContain(state.season.label);
    // The crest is drawn rather than named, at the size the clubhouse gives it,
    // and the manager is drawn as the person he is: this screen used to be a
    // fixture between two names with no picture of the club on it at all.
    expect(html).toContain('home-club__crest');
    expect(html).toContain('class="badge"');
    expect(html).toMatch(/width:\s*64px/);
    expect(club.managerId, 'the test career has no manager in the dugout').toBeTruthy();
    const manager = state.people[club.managerId!]!;
    expect(html).toContain(manager.firstName);
    expect(html).toContain(manager.surname);
    expect(html).toContain('portrait__art');
    expect(html).toContain('In charge since');
    // The one door off the band is a real screen.
    expect(html).toContain('The clubhouse');
    // And it is a band, not a page header: the shell focuses the screen's `h1`,
    // and Home deliberately has none — the week strip is what opens the screen.
    expect(html).not.toContain('<h1');
  });
});

describe('the next match is printed, or honestly absent', () => {
  it('prints the fixture as the club’s own sheet, with the way into the team', () => {
    const state = career('dashboard-hero');
    const match = nextFixtureFor(state, state.userClubId, state.date)!;
    expect(match, 'a career with no fixture to prepare for').toBeTruthy();
    const opponentId = match.homeClubId === state.userClubId ? match.awayClubId : match.homeClubId;
    const html = renderToStaticMarkup(createElement(NextMatchHero, { game: state, next: match }));

    // The shared sheet, not a second fixture layout invented for Home.
    expect(html).toContain('fixture-card');
    expect(html).toContain(state.clubs[opponentId]!.identity.name);
    expect(html).toContain(match.competitionName);
    // Both routes into preparing for it, and both of them screens: the command bar
    // above owns moving the calendar on.
    expect(html).toContain('Pick the team');
    expect(html).toContain('The week ahead');
    // The state of the selection, read off the club rather than asserted.
    expect(html).toMatch(/\d+ available/);
    expect(html).not.toContain('home-hero__none');
  });

  it('says there is no fixture rather than showing an empty one', () => {
    const state = career('dashboard-no-fixture');
    const html = renderToStaticMarkup(createElement(NextMatchHero, { game: state, next: null }));

    expect(html).toContain('home-hero__none');
    expect(html).toContain('No fixture scheduled');
    expect(html).not.toContain('fixture-card');
    // No invented fixture and no promise of one: the door goes to the fixture list.
    expect(html).toContain('The fixture list');
  });

  it('says the season is over when the career is', () => {
    const state = career('dashboard-season-over');
    const finished: GameState = { ...state, phase: 'complete' };
    const html = renderToStaticMarkup(createElement(NextMatchHero, { game: finished, next: null }));

    expect(html).toContain('The season is over');
    expect(html).toContain('pre-season');
    expect(html).not.toContain('No fixture scheduled');
  });
});

describe('what needs the manager is led by the loudest decision', () => {
  it('puts one decision in front, prints the model’s own words, and keeps the rest as rows', () => {
    const state = career('dashboard-needs-you');
    // A club in the red, which the money model calls a decision rather than a note.
    clubOf(state).finances.balance = -50;
    const briefing = homeBriefing(state);
    expect(briefing.lead, 'a club in the red has nothing to say').toBeTruthy();
    const html = renderToStaticMarkup(createElement(NeedsYou, { game: state }));

    // One lead and not two, carrying the model's own label, title and detail.
    expect((html.match(/class="home-lead /g) ?? [])).toHaveLength(1);
    expect(html).toContain(briefing.lead!.label);
    expect(html).toContain(briefing.lead!.title);
    expect(html).toContain(briefing.lead!.detail);
    expect(briefing.lead!.tone).not.toBe('info');
    // The button names what pressing it does — the lead is a view matter, so it
    // sorts it out rather than saying "open".
    expect(html).toContain('Sort it out');
    // And the rest of the model's rows are still there — exactly the model's
    // rows, no more and no fewer — drawn as the ruled rows the Club screen draws,
    // so a matter is the same object on both screens.
    expect((html.match(/class="tile tile--/g) ?? []).length).toBe(briefing.rest.length);
  });
});

describe('the form strip is a run of afternoons', () => {
  it('gives each played result its mark, its score and its own way into the report', () => {
    const state = career('dashboard-form');
    const fixture = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
    )!;
    prepareMatchday(state, fixture.matchday);
    const played = state.matches[fixture.id]!;
    simulateFixture(played, matchEnvironment(state, played), 'fast');
    expect(played.played, 'the fixture did not play').toBe(true);

    const html = renderToStaticMarkup(createElement(RecentForm, { game: state }));
    expect(html).toContain('home-result');
    // The score as the record has it, not as the layout guessed it.
    expect(html).toContain(`${played.result!.homeGoals}–${played.result!.awayGoals}`);
    expect(html).toMatch(/pip pip--[wdl]/);
    expect(html).toContain('Report');
    expect(html).toContain('All fixtures');
    expect(html).not.toContain('No competitive football played yet');
  });

  it('says so, plainly, when the club has not played yet', () => {
    const state = career('dashboard-no-form');
    const html = renderToStaticMarkup(createElement(RecentForm, { game: state }));

    expect(html).toContain('No competitive football played yet');
    expect(html).not.toContain('home-result');
    // No invented results and no empty grid: the section is a sentence and the
    // door to the fixtures the season has.
    expect(html).toContain('All fixtures');
  });
});

describe('a man between jobs is never shown the club he left', () => {
  it('asks the career which club he manages, and draws nothing when there is none', () => {
    // The screen itself is store-backed: on the server `useGame` hands the store
    // its initial state, so `DashboardView` cannot be rendered here at all — the
    // pieces above are exported for that reason. This one fact is therefore read
    // off the source, as the between-jobs screen's own test reads the routing it
    // depends on: the shell sends an out-of-work manager to the job board before
    // any screen is chosen (`App.tsx`), and Home asks the career the same
    // question, so a career with no club cannot be shown the one it left behind.
    expect(source).toContain('managingClubId(game)');
    expect(source).toContain('if (!clubId) return null;');
  });
});

describe('a number in the strip is a door, not a read-out', () => {
  it('draws a pressable tile when it has somewhere to send the manager', () => {
    const withDoor = renderToStaticMarkup(
      createElement(MetricTile, { label: 'League', value: '4th', note: '9 pts', onClick: () => {}, title: 'Open the league table' }),
    );
    expect(withDoor).toContain('<button');
    expect(withDoor).toContain('tile--pressable');
    expect(withDoor).toContain('Open the league table');

    // And a tile with nowhere to go does not pretend to be one: some of these
    // strips are a fact about the screen they are already on.
    const readOut = renderToStaticMarkup(createElement(MetricTile, { label: 'League', value: '4th' }));
    expect(readOut).not.toContain('<button');
    expect(readOut).not.toContain('tile--pressable');
  });
});
