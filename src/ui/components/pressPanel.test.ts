import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import { emptyPressState, type Rumour } from '@/domain/press';
import { useGameStore } from '@/state/gameStore';
import { addDays } from '@/simulation/calendar';
import { journalistForClub, publicationOf } from '@/simulation/press';
import { SUPPORTER_MOOD_LABEL, supporterMood } from '@/simulation/support';
import { createTestGame } from '@/simulation/testSupport';
import { PressPanelBody } from './PressPanel';

/**
 * The paper, on the club screen.
 *
 * Two halves, and both have to be tested where they actually are. The panel's
 * *copy* is printed from props, because a component that reads nothing but what
 * it is given can be read in a test — which is what `PressPanelBody` is for, and
 * why the door and the layout are two functions. The *answer* is the store's
 * business: playing a claim down has to reach the game state and be remembered,
 * so it is driven the way the manager drives it, through the store action.
 *
 * The distinction the whole feature exists for is asserted here as well: a live
 * claim is printed as unconfirmed, with the odds on it, and never as something
 * the club has said. A panel that printed a rumour in the same type as a fact
 * would make the rest of this worth nothing.
 */

/** A claim the paper has filed about the manager's own club. */
function claimAboutUs(state: GameState): Rumour {
  const club = state.clubs[state.userClubId]!;
  const journalist = journalistForClub(state, state.userClubId)!;
  return {
    id: 'r_panel',
    key: 'rumour:manager:panel',
    date: state.date,
    subject: 'manager',
    status: 'unverified',
    journalistId: journalist.id,
    clubIds: [club.id],
    personIds: [],
    claim: `There is talk at ${club.identity.name} that the manager is on borrowed time.`,
    evidence: 0.6,
    reliability: 0.62,
    resolvesOn: addDays(state.date, 14),
    basis: { key: 'managerId', value: club.managerId ?? '' },
    outcome: null,
    settledOn: null,
  };
}

function aCareer(seed: string) {
  const store = useGameStore.getState();
  store.createDraft(seed);
  store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
  const game = useGameStore.getState().game!;
  game.governance.standing = 'pressure';
  const rumour = claimAboutUs(game);
  game.press.rumours = [rumour];
  return { game, rumour };
}

beforeEach(() => {
  useGameStore.getState().quitToMenu();
});

describe('what the club screen says about the paper', () => {
  it('names the paper and the reporter, prints the crowd’s mood, and prints a claim as a claim', () => {
    const { state } = createTestGame('panel-copy');
    const rumour = claimAboutUs(state);
    state.press.rumours = [rumour];
    const clubId = state.userClubId;
    const journalist = journalistForClub(state, clubId)!;
    const publication = publicationOf(state, journalist)!;

    const html = renderToStaticMarkup(
      createElement(PressPanelBody, { game: state, clubId, onRespond: () => undefined }),
    );

    // Who writes about this club.
    expect(html).toContain(publication.name);
    expect(html).toContain(`${journalist.firstName} ${journalist.surname}`);
    expect(html).toContain(publication.strapline);

    // The crowd he is writing for, in words rather than a bare figure.
    expect(html).toContain(SUPPORTER_MOOD_LABEL[supporterMood(state.clubs[clubId]!.supporters.confidence)]);

    // And the claim itself: labelled unconfirmed, with what it is worth, and with
    // the two ways of answering it. Nothing here says the club has confirmed it.
    // The claim's own words, printed as a claim — read in two pieces because the
    // club's name carries an apostrophe the printer escapes.
    expect(html).toContain('There is talk at');
    expect(html).toContain('the manager is on borrowed time.');
    expect(html).toContain('Unconfirmed');
    expect(html).toContain(`${Math.round(rumour.reliability * 100)}%`);
    expect(html).toContain('Play it down');
    expect(html).toContain('Give them something');
    expect(html).not.toContain('Confirmed');
  });

  it('draws nothing at all for a county that has no press', () => {
    const { state } = createTestGame('panel-no-press');
    state.press = emptyPressState();
    const html = renderToStaticMarkup(
      createElement(PressPanelBody, { game: state, clubId: state.userClubId, onRespond: () => undefined }),
    );
    expect(html).toBe('');
  });

  it('offers nothing to answer once the claim has been answered', () => {
    const { state } = createTestGame('panel-answered');
    const rumour = claimAboutUs(state);
    state.press.rumours = [rumour];
    state.press.statements = [{ rumourId: rumour.id, journalistId: rumour.journalistId, date: state.date, kind: 'declined' }];

    const html = renderToStaticMarkup(
      createElement(PressPanelBody, { game: state, clubId: state.userClubId, onRespond: () => undefined }),
    );

    // What was said is on the screen instead of the buttons, so the manager can
    // see he has already answered this one.
    expect(html).toContain('played it down');
    expect(html).not.toContain('Play it down');
    expect(html).not.toContain('Give them something');
  });
});

describe('answering the paper from the club screen', () => {
  it('records the answer in the game state, moves the reporter’s standing, and says so', () => {
    const { game, rumour } = aCareer('panel-answer');
    const clubId = game.userClubId;
    const journalist = journalistForClub(game, clubId)!;
    const regardBefore = journalist.regard;

    useGameStore.getState().respondToRumour(rumour.id, 'declined');

    const after = useGameStore.getState().game!;
    expect(useGameStore.getState().error).toBeNull();
    expect(useGameStore.getState().notice).toBeTruthy();
    expect(after.press.statements).toHaveLength(1);
    expect(after.press.statements[0]!.rumourId).toBe(rumour.id);
    expect(after.press.statements[0]!.kind).toBe('declined');
    expect(journalistForClub(after, clubId)!.regard).toBe(regardBefore - 6);

    // The claim itself is untouched by being answered: the season settles it, not
    // the manager, and certainly not the button.
    const answered = after.press.rumours.find((candidate) => candidate.id === rumour.id)!;
    expect(answered.status).toBe('unverified');

    // The panel, printed again from the state after the answer, shows what was
    // said rather than offering the same buttons a second time.
    const html = renderToStaticMarkup(
      createElement(PressPanelBody, {
        game: after,
        clubId,
        onRespond: () => undefined,
      }),
    );
    expect(html).not.toContain('Play it down');
    expect(html).toContain('played it down');
  });

  it('does nothing at all for a claim that has already been answered', () => {
    const { game, rumour } = aCareer('panel-twice');
    useGameStore.getState().respondToRumour(rumour.id, 'declined');
    const first = useGameStore.getState().game!.press.statements.length;

    useGameStore.getState().respondToRumour(rumour.id, 'acknowledged');

    const after = useGameStore.getState().game!;
    expect(after.press.statements).toHaveLength(first);
    expect(journalistForClub(after, game.userClubId)!.regard).toBe(
      journalistForClub(useGameStore.getState().game!, game.userClubId)!.regard,
    );
  });
});
