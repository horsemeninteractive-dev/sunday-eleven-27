import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '@/domain/game';
import type { Match, MatchEvent, MatchEventType } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { prepareMatchday } from '@/simulation/matchday';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { currentScore } from '@/simulation/match/matchEngine';
import { matchKitColours, shirtLine } from '../kit';
import { Dialog } from '../dialogs/Dialog';
import { MatchScoreline } from './MatchScoreline';
import { MatchStatsPanel } from './MatchStats';

/**
 * The three moments the match stops for the manager.
 *
 * Half time, full time and the report are the only places the game puts a match
 * in front of him *as a result*, and all three of them used to spell the score
 * out in a sentence in a plain box — which is the one thing this game does not do
 * anywhere else. The header draws a match with two crests, the two names and the
 * two strips the sides actually turned out in; the three moments below are meant
 * to read the scoreline from that same drawing rather than from a second way of
 * saying it.
 *
 * So these pin two things that cannot be seen from one screen at a time: that
 * there is **one** definition of the drawing (three callers, one component, one
 * string for the shirt line), and that the figures half time and full time put
 * underneath it are painted in the two strips on the pitch rather than in the
 * manager's own colour.
 */

const source = (file: string) => readFileSync(`src/ui/${file}`, 'utf8');

/** Every declaration the sheet holds for a selector, with the comments stripped. */
function sheetBody(selector: string): string {
  const stripped = source('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  return [...stripped.matchAll(pattern)].map((match) => match[1]).join('\n');
}

/** Every file under a directory, so a boundary can be checked in both directions. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** The manager's own fixture on the next matchday, with lineups prepared. */
function preparedMatch(seed: string): { state: GameState; match: Match } {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return { state, match: cloneMatch(state.matches[fixture.id]!) };
}

let counter = 0;
function event(match: Match, type: MatchEventType, minute: number, extra: Partial<MatchEvent> = {}): MatchEvent {
  counter += 1;
  return {
    id: `e${counter}`,
    minute,
    type,
    clubId: match.homeClubId,
    playerId: null,
    secondaryPlayerId: null,
    text: `${type} at ${minute}`,
    x: 0.5,
    y: 0.5,
    scoreAfter: { home: 0, away: 0 },
    importance: 1,
    ...extra,
  };
}

describe('a stopped match is drawn in the match’s own marks', () => {
  it('draws both clubs, the score, and the two strips the sides turned out in', () => {
    const { state, match } = preparedMatch('scoreline-marks');
    const html = renderToStaticMarkup(createElement(MatchScoreline, { game: state, match }));
    const home = state.clubs[match.homeClubId]!;
    const away = state.clubs[match.awayClubId]!;
    const score = currentScore(match);
    const kits = matchKitColours(state, match.homeClubId, match.awayClubId);

    // The clubs, as the game draws a club everywhere else: a crest apiece.
    expect(html.match(/class="matchscore__crest"/g)).toHaveLength(2);
    expect(html.match(/class="badge"/g)).toHaveLength(2);
    expect(html).toContain(home.identity.name);
    expect(html).toContain(away.identity.name);
    // The score, in the header's own grammar: home, a hard en dash, away.
    expect(html).toContain(`<span>${score.home}</span>`);
    expect(html).toContain('–');
    expect(html).toContain(`<span>${score.away}</span>`);
    // And the line across the top is the shirts rather than the clubs: a side in a
    // white away strip is white, which is the answer the header already gives.
    expect(html).toContain(shirtLine(kits));
    // The names are real text and not pictures of words, so the reader is told the
    // result even though the crests beside it are decoration.
    expect(html).toContain(`<strong>${home.identity.name}</strong>`);
    expect(html).toContain(`<strong>${away.identity.name}</strong>`);
  });

  it('reads one match and nothing else, so the same drawing serves every caller', () => {
    // A drawing of one match takes its career and its match and reads nothing
    // else: no store, no career lookup of its own, no clock. That is what lets
    // the same component be a card over the pitch and the headline of a report.
    expect(source('match/MatchScoreline.tsx')).not.toContain('useGame');
    expect(source('match/MatchScoreline.tsx')).not.toContain('gameStore');
    expect(source('match/MatchScoreline.tsx')).toContain('matchKitColours(game');
    expect(source('match/MatchScoreline.tsx')).toContain('shirtLine(kits)');
  });

  it('hands that one scoreline to half time, full time and the report', () => {
    const phases = source('match/MatchPhases.tsx');
    expect(phases.match(/<MatchScoreline game=\{game\} match=\{match\} \/>/g)).toHaveLength(2);
    // The sentence the score used to be is gone, and so is the rule that styled it
    // as one.
    expect(phases).not.toContain('className="scoreline"');
    expect(source('styles.css')).not.toContain('.interval .scoreline');
    expect(sheetBody('.matchscore')).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(sheetBody('.matchscore__score')).toContain('font-size: var(--fs-2xl)');

    // The report is the same headline over the ruled column the `report` kind
    // already promised, and a fixture nobody has played is given no result.
    const report = source('components/MatchReportModal.tsx');
    expect(report).toContain('kind="report"');
    expect(report).toContain('subtitle={match.played ? <MatchScoreline game={state} match={match} /> : undefined}');

    // And the line itself is drawn in one place: the header reads the same
    // function, so "the two shirts as one hard line" cannot come out two ways.
    expect(source('match/MatchHeader.tsx')).toContain('shirtLine(kits)');
    expect(source('kit.ts')).toContain('export function shirtLine');
    expect(source('kit.ts')).toContain('50%, ${colours.away} 50%');
  });

  it('sits in the report’s own head without breaking the paragraph it lands in', () => {
    // The dialog's subtitle is a paragraph, so the headline has to be phrasing
    // content — a block element drawn inside it is the kind of fault that renders
    // fine and is wrong, and React says so out loud.
    const { state, match } = preparedMatch('scoreline-report-head');
    const html = renderToStaticMarkup(
      createElement(Dialog, {
        title: 'Match report',
        kind: 'report' as const,
        onClose: () => {},
        subtitle: createElement(MatchScoreline, { game: state, match }),
        children: createElement('p', null, 'The afternoon.'),
      }),
    );
    expect(html).toContain('data-modal="report"');
    expect(html).toContain('overlay__heading');
    expect(html).toContain('matchscore__crest');
    // The headline is above the body, in the head, where a document's headline is.
    expect(html.indexOf('matchscore__crest')).toBeLessThan(html.indexOf('The afternoon.'));
    // And the drawing is phrasing content to the last node, because the paragraph
    // in the head will not hold a block: one span, and no block in it anywhere.
    // `react-dom/server` says nothing about nesting, so this is a reading of the
    // markup rather than something React catches here; the live probe watches the
    // browser's console for the same fault, where React does catch it.
    const scoreline = source('match/MatchScoreline.tsx');
    expect(scoreline).toContain('<span className="matchscore">');
    expect(scoreline).not.toMatch(/<div|<p[ >]/);
  });

});

describe('the figures the two moments put in front of him', () => {
  it('are painted in the two strips actually on the pitch', () => {
    const { state, match } = preparedMatch('scoreline-figures');
    // One corner each: a figure that is not nothing, so the panel really draws.
    match.events = [
      event(match, 'corner', 12, { clubId: match.homeClubId, text: 'A corner.' }),
      event(match, 'corner', 30, { clubId: match.awayClubId, text: 'A corner at the other end.' }),
    ];
    const html = renderToStaticMarkup(createElement(MatchStatsPanel, { game: state, match }));
    const kits = matchKitColours(state, match.homeClubId, match.awayClubId);

    expect(html).toContain('Corners');
    // Two halves per row, one in each side's shirt — and never the manager's own
    // colour, which is what the home half was painted in whichever end he was
    // standing at, with the visitors left in a grey.
    expect(html.match(/class="stats__bar-half"/g)).toHaveLength(2);
    expect(html).toContain(`background:${kits.home}`);
    expect(html).toContain(`background:${kits.away}`);
    // The pressure bar above them is the same two shirts.
    expect(html.match(/class="pressure__side"/g)).toHaveLength(2);
    expect(html.match(/class="pressure__side"[^>]*background/g)).toHaveLength(2);
    // The panel can only say any of it because it is handed the career: the two
    // strips are read from the kits, not assumed from a club colour.
    expect(source('match/MatchStats.tsx')).toContain('matchKitColours(game');
  });

  it('left no club-coloured bar or grey half behind in the sheet', () => {
    // A fallback the panel no longer uses is a second answer waiting to be
    // picked up: the sheet has one fill per half and the fill comes from the man
    // being painted, handed in from the panel.
    expect(sheetBody('.stats__bar')).toContain('display: flex');
    expect(sheetBody('.stats__bar-half')).toContain('height: 100%');
    expect(sheetBody('.stats__bar-half')).not.toContain('background');
    expect(sheetBody('.pressure__side')).not.toContain('background');
    const stripped = source('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toContain('.stats__bar-home');
    expect(stripped).not.toContain('.pressure__side--home');
  });

  it('keeps the card’s club mark to its top edge only', () => {
    // The matchday cards already carry the club's hard edge along their top. A
    // tinted head as well would be the club's colour spent twice on one surface,
    // which is the fault the portrait was careful to avoid when the club moved
    // off the box and onto the man.
    expect(sheetBody('.interval__card')).toContain('var(--club)');
    expect(sheetBody('.interval__head')).not.toContain('--club');
  });
});

describe('the line between Touchline and what is drawn', () => {
  it('keeps every one of these names out of the simulation', () => {
    // Touchline decides what happens; this layer shows what happened. Not one of
    // these names — the drawing, the line, the panel — may have a home under
    // `src/simulation`, because the simulation could be replaced wholesale and
    // nothing about how a result is drawn would be missed.
    const named = filesUnder('src/simulation').filter((file) =>
      /MatchScoreline|matchscore|shirtLine/.test(readFileSync(file, 'utf8')),
    );
    expect(named).toEqual([]);
  });

  it('reads the match through the presentation layer rather than through Touchline', () => {
    // The scoreline and the figures are built from a `Match` and a `GameState`
    // like every other reader of the match, so the boundary test above has
    // nothing to catch: the simulation's own summary of a match is not asked for
    // a colour, and no football is decided here.
    for (const file of ['match/MatchScoreline.tsx', 'match/MatchStats.tsx']) {
      expect(source(file)).toContain("from '@/domain/match'");
      expect(source(file)).not.toContain('touchline');
    }
  });
});
