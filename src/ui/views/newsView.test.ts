import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { GameEventType, NewsItem } from '@/domain/news';
import { RUMOUR_STATUS_LABEL } from '@/domain/press';
import { NEWS_PLATE_PATHS } from '../components/NewsPlate';
import { createTestGame } from '@/simulation/testSupport';
import { createEvent, publishEvents } from '@/simulation/news';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { simulateFixture } from '@/simulation/fastMatch';
import { BriefStory, FeatureStory, LeadStory } from './NewsView';

/**
 * The front page, as it is actually drawn.
 *
 * Three things about the paper can only be checked by printing it. That a story's
 * **head is the story's own marks** — the crests, the shirts and the score the
 * rest of the game already draws — rather than a sentence beside a generic
 * picture. That a tie nobody has played is printed with its **date and no score**,
 * because `MatchScoreline` draws the score a match is *currently* at and a drawn
 * tie handed to it as a result would put 0–0 on the front page of a paper about a
 * game no one has played. And that a story which is not football at all — a
 * training night, a signing — is drawn from the sheet instead.
 *
 * Every story here comes through the real pipeline: `createEvent` →
 * `publishEvents`, and the fixture it points at is played by `simulateFixture`.
 * A hand-built `NewsItem` would have tested the layout against the shape somebody
 * believed the simulation writes, which is exactly the belief this whole change
 * exists to make unnecessary — the event type has to survive publication, and the
 * only way to know it does is to publish one.
 */

/**
 * A career with one fixture played, and the news one event of a given kind.
 *
 * `importance` is an option because it is one of the things the *press* decides
 * on: a Thursday night matters to the club and to nobody else, and whether the
 * paper sent anybody is a question about the event rather than about the layout.
 */
function story(
  eventType: GameEventType,
  options: { matchId?: string; headline?: string; body?: string; importance?: 1 | 2 | 3 } = {},
): {
  state: GameState;
  item: NewsItem;
  playedMatchId: string;
} {
  const { state } = createTestGame(`news-${eventType}`);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = state.matches[fixture.id]!;
  simulateFixture(match, matchEnvironment(state, match), 'fast');

  const [item] = publishEvents(state, [
    createEvent(state, {
      type: eventType,
      importance: options.importance ?? 2,
      clubIds: [state.userClubId],
      matchId: options.matchId ?? null,
      data: {
        headline: options.headline ?? 'A headline the writer did not write',
        body: options.body ?? 'The first paragraph.',
      },
    }),
  ]);
  return { state, item: item!, playedMatchId: match.id };
}

describe('the lead story prints the football, not a sentence about it', () => {
  it('headlines a result with the two crests, the two shirts and the score', () => {
    const { state, item, playedMatchId } = story('match-result', { matchId: undefined });
    // The event points at the match it came out of, which is the real record.
    const withMatch: NewsItem = { ...item, matchId: playedMatchId };
    const match = state.matches[playedMatchId]!;
    const html = renderToStaticMarkup(createElement(LeadStory, { item: withMatch, game: state }));
    const home = state.clubs[match.homeClubId]!;
    const away = state.clubs[match.awayClubId]!;

    // The band across the top of the story, and the match's own drawing on it.
    expect(html).toContain('news-lead__front');
    expect(html.match(/class="matchscore__crest"/g)).toHaveLength(2);
    expect(html).toContain(home.identity.name);
    expect(html).toContain(away.identity.name);
    // The score the match actually finished: `simulateFixture` played it, so this
    // is the record's own number rather than anything the view decided.
    expect(html).toContain(`<span>${match.result!.homeGoals}</span>`);
    expect(html).toContain(`<span>${match.result!.awayGoals}</span>`);
    // The way into the report, which is the one thing the paper can offer that the
    // story cannot print.
    expect(html).toContain('Read the match report');
    // And no drawing: a result is headlined by the football.
    expect(html).not.toContain('class="news-plate');

    // The story's own kind and its own words, in the paper's order: the label,
    // then the headline.
    //
    // The headline is the writer's rather than anything this test typed, and that
    // is the point of asserting on the item rather than on a literal: a result's
    // headline is composed *from the match* — the score, who scored it — so the
    // words on the front page were already true before the layout saw them. It is
    // also why a result leads with the football rather than with a sentence: the
    // sentence a match-report writer produces is a scoreline written out.
    expect(html).toContain('news-kind');
    expect(item.headline.trim()).toBeTruthy();
    expect(html).toContain(item.headline.trim());
    expect(html.indexOf('news-kind')).toBeLessThan(html.indexOf(item.headline.trim()));
    // The competition it was played in, which the column cannot say.
    expect(html).toContain(match.competitionName);
  });

  it('prints a tie nobody has played with its date, and never with a score', () => {
    // The whole reason `resultForStory` and `fixtureForStory` are two readers.
    const { state, item } = story('cup-draw');
    const upcoming = Object.values(state.matches).find(
      (candidate) => !candidate.played && (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
    )!;
    const html = renderToStaticMarkup(
      createElement(LeadStory, { item: { ...item, matchId: upcoming.id }, game: state }),
    );

    expect(html).toContain('matchscore__score--when');
    // The en dash is the score cell's own mark, so its absence is the absence of a
    // result rather than merely the absence of two zeroes.
    expect(html).not.toContain('matchscore__dash');
    expect(html).not.toContain('<span>0</span>');
    // The clubs and the strips are still drawn: a draw is about two clubs.
    expect(html.match(/class="matchscore__crest"/g)).toHaveLength(2);
  });

  it('draws a story that is not football from the sheet, at the size the lead gets', () => {
    const { state, item } = story('training');
    const html = renderToStaticMarkup(createElement(LeadStory, { item, game: state }));
    expect(html).toContain('class="news-plate news-plate--lead"');
    expect((html.match(/<path/g) ?? []).length).toBe(NEWS_PLATE_PATHS.Training.length);
    expect(html).not.toContain('matchscore');
    // A story that is not a match prints the writer's own words, which is what
    // every kind of story but a result does.
    expect(html).toContain('A headline the writer did not write');
    expect(html).toContain('The first paragraph.');
    expect(html).toContain('class="news-kind">Training<');
  });

  it('sets a one-paragraph story as body copy and a two-paragraph one as a standfirst', () => {
    const single = story('training', { body: 'One paragraph, and that is all of it.' });
    const one = renderToStaticMarkup(createElement(LeadStory, { item: single.item, game: single.state }));
    expect(one).toContain('news-lead__body');
    expect(one).not.toContain('news-lead__standfirst');

    const two = story('training', { body: 'The opening line.\n\nThe rest of it, which is what it stands above.' });
    const pair = renderToStaticMarkup(createElement(LeadStory, { item: two.item, game: two.state }));
    expect(pair).toContain('news-lead__standfirst');
  });
});

describe('the paper says who wrote it, and how much of it is fact', () => {
  /**
   * A story as the press files it.
   *
   * The item comes through the real pipeline and is then given the one part of
   * itself only `publishEvents` can know — which paper carried it, and whether
   * anybody has settled it. Deciding *that* is the simulation's, and it is pinned
   * where the journalism is; what is pinned here is that the layout prints it,
   * and that it prints nothing at all for a story nobody filed.
   */
  function filed(eventType: GameEventType, press: Partial<NewsItem>) {
    const published = story(eventType);
    return { ...published, item: { ...published.item, ...press } };
  }

  it('prints the reporter and the paper under the headline, and the paper in the kicker', () => {
    const { state, item } = filed('press-rumour', {
      byline: 'Jean Marlow',
      outlet: 'The Granton Gazette',
      confidence: 'unverified',
    });

    // The lead, the column and the clipping alike: the whole value of a byline is
    // that a manager learns which reporter is telling him what, and a paper that
    // printed it only on its front page would teach him that about one story in
    // twenty.
    const printed = [
      renderToStaticMarkup(createElement(LeadStory, { item, game: state })),
      renderToStaticMarkup(createElement(FeatureStory, { item, game: state })),
      renderToStaticMarkup(createElement(BriefStory, { item, game: state })),
    ];

    for (const html of printed) {
      // The masthead sits in the band with the date, which is where a paper stamps
      // it, and the reporter's name is the line of its own under the headline.
      expect(html).toContain('news-byline');
      expect(html).toContain('By Jean Marlow, The Granton Gazette');
      expect(html).toContain('The Granton Gazette');
      // In that order: the kind, then the headline, then the name. A byline above
      // the headline would be the paper signing something before it said it. The
      // headline is located by its own class rather than by its words, because a
      // headline is the writer's sentence and this test is about where things sit.
      const headline = html.includes('news-lead__headline')
        ? html.indexOf('news-lead__headline')
        : html.indexOf('news-story__headline');
      expect(headline).toBeGreaterThanOrEqual(0);
      expect(html.indexOf('news-kind')).toBeLessThan(headline);
      expect(headline).toBeLessThan(html.indexOf('news-byline'));
      expect(item.headline.trim()).toBeTruthy();
    }
  });

  it('chips a claim as unconfirmed and a settled fact as settled', () => {
    const claim = filed('press-rumour', { byline: 'Jean Marlow', outlet: 'The Granton Gazette', confidence: 'unverified' });
    const unverified = renderToStaticMarkup(createElement(LeadStory, { item: claim.item, game: claim.state }));
    expect(unverified).toContain(RUMOUR_STATUS_LABEL.unverified);
    expect(unverified).toContain('tone--warn');

    const confirmed = filed('press-verdict', { byline: 'Jean Marlow', outlet: 'The Granton Gazette', confidence: 'confirmed' });
    const settled = renderToStaticMarkup(createElement(LeadStory, { item: confirmed.item, game: confirmed.state }));
    expect(settled).toContain(RUMOUR_STATUS_LABEL.confirmed);
    expect(settled).toContain('tone--ok');

    // A claim that turned out wrong is a correction rather than a scandal.
    const wrong = filed('press-verdict', { confidence: 'disproved' });
    const corrected = renderToStaticMarkup(createElement(LeadStory, { item: wrong.item, game: wrong.state }));
    expect(corrected).toContain(RUMOUR_STATUS_LABEL.disproved);
    expect(corrected).toContain('tone--muted');
  });

  it('prints no name and no chip for a story nobody filed', () => {
    // The absence is the reassurance: a story nobody wrote a line about carries no
    // byline, and no chip because there is nothing for a reader to be careful
    // about. A page that labelled every true thing as true would have taught
    // nobody anything by labelling the one that is not.
    //
    // A Thursday night is the honest example: it is the club's own knowledge —
    // who turned up, what they worked on — and no reporter in the county files it.
    // Which kinds of story a paper bothers with is the press service's rule and is
    // pinned there; here it only has to be drawn right.
    const { state, item } = story('training', { importance: 1 });
    const html = renderToStaticMarkup(createElement(LeadStory, { item, game: state }));
    expect(html).not.toContain('news-byline');
    expect(html).not.toContain(RUMOUR_STATUS_LABEL.unverified);
    expect(html).not.toContain(RUMOUR_STATUS_LABEL.confirmed);
    expect(html).not.toContain('tone--ok');
    // And it is still a story, printed with its kind and its headline: the layout
    // did not lose its head over a missing masthead.
    expect(html).toContain('news-lead__meta');
    expect(html).toContain('news-lead__headline');
    expect(item.headline.trim()).toBeTruthy();
  });
});

describe('a story given a column shows its opening line, a clipping does not', () => {
  it('gives the feature the story\'s own first paragraph and the bigger plate', () => {
    const { state, item } = story('player-signed', { body: 'He turned up on Thursday.\n\nHe signed on Sunday.' });
    const html = renderToStaticMarkup(createElement(FeatureStory, { item, game: state }));
    expect(html).toContain('news-story--feature');
    expect(html).toContain('news-plate--feature');
    expect(html).toContain('news-story__standfirst');
    expect(html).toContain('He turned up on Thursday.');
    // A signing is drawn as a player arriving rather than as the squad column.
    expect((html.match(/<path/g) ?? []).length).toBe(NEWS_PLATE_PATHS.Transfer.length);
    // Still a disclosure, like every other story on the board: the second tier is
    // a bigger piece of paper rather than an open one.
    expect(html).toContain('<details');
    expect(html).not.toContain(' open=""');
  });

  it('keeps the clipping a clipping, with the picture beside the headline it is of', () => {
    const { state, item } = story('development');
    const html = renderToStaticMarkup(createElement(BriefStory, { item, game: state }));
    const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'));
    expect(summary).toContain('class="news-plate"');
    expect((html.match(/<path/g) ?? []).length).toBe(NEWS_PLATE_PATHS.Milestone.length);
    // The whole story is in the body, which is what opening it is for.
    const body = html.slice(html.indexOf('news-story__body'));
    expect(body).toContain('The first paragraph.');
  });
});
