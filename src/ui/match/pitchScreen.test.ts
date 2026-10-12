import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { simulateFixture } from '@/simulation/fastMatch';
import { currentScore, displayMinute } from '@/simulation/match/matchEngine';
import { buildEngineRenderState } from '@/presentation/matchEnginePresentation';
import { buildMatchRenderState } from '@/presentation/matchPresentation';
import { createMatchEngine } from '@/simulation/touchline';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { flatClubInk } from '../colour';
import { matchKitColours } from '../kit';
import { MatchHeader, matchClock, matchStatus, type MatchPhase } from './MatchHeader';
import { MatchPitch } from './MatchPitch';
import { PitchViewToggle, TvScoreboard, clubCode } from './PitchScreen';

/**
 * The pitch on the whole screen, and the two things it adds.
 *
 * The button in the corner of the grass and the board it puts over the picture
 * are checked where they can be checked without a browser: the board against a
 * real afternoon — `createTestGame`, a prepared matchday and a fixture actually
 * played by `simulateFixture` — and the wiring of the view off its own source,
 * which is the only way a store-backed screen can be read at all.
 *
 * Three things are pinned. That the bar is **the same account of the match as
 * the header it replaces**: it wears the header's clock (`matchStatus`) and the
 * strips its own pitch is drawn from, so a bar reading `72'` while the header
 * said something else is not a state this code can be in. That the bar is what a
 * broadcaster's is — one row, the station, two three-letter codes in the two
 * shirts, the score between them and the clock at the end, with the full names a
 * hover away and the whole thing one sentence to a screen reader. And that the
 * view **stands the frame aside** — header, both sheets, the rail and the totals
 * all gated on it — while the control strip stays, because the football has not
 * stopped, and that the way out is the way in: the same button, plus Escape, the
 * back gesture and the browser's own fullscreen.
 *
 * What a server render cannot do is press anything: the toggle's markup is
 * checked, and that the one state drives both the button and the board is read
 * off the source. The press itself is a browser's business, as it is for every
 * other control in this game.
 */

const source = readFileSync('src/ui/views/MatchView.tsx', 'utf8');
const pitchSource = readFileSync('src/ui/match/MatchPitch.tsx', 'utf8');
const sheet = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every declaration the sheet holds for a selector, with the comments stripped.
 *
 * The selector is escaped rather than trusted as a pattern: `.` matches anything
 * and `[data-shape='portrait']` is a character class to a regular expression, so
 * a selector pasted in as itself quietly matches rules it was never about.
 */
function sheetBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return [...sheet.matchAll(pattern)].map((match) => match[1]).join('\n');
}

/**
 * Markup back into characters.
 *
 * React escapes the apostrophe in `90+9'` and anything else a club's name might
 * carry, so a sentence is compared as the reader would see it rather than as the
 * markup spells it.
 */
function decode(text: string): string {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** The text of a drawing: the tags off it, and the entities back into characters. */
function words(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * The opening tag of the element carrying a marker, as the renderer wrote it.
 *
 * The markup is read as text rather than parsed, like everything else here: a
 * server render gives no DOM to query, and the question being asked — where was
 * this drawn — is answered by the one tag the renderer wrote.
 */
function tagOf(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `nothing was drawn carrying ${marker}`).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<span', at), html.indexOf('>', at));
}

/** One written coordinate out of a tag, as the percentage of the surface it is. */
function coordinate(tag: string, axis: 'left' | 'top'): number {
  const found = new RegExp(`${axis}:\\s*(-?[\\d.]+)%`).exec(tag);
  expect(found, `no ${axis} was written in ${tag}`).not.toBeNull();
  return Number(found![1]);
}

const PHASES: MatchPhase[] = ['pre-match', 'in-progress', 'half-time', 'full-time'];

/** A real afternoon: the manager's own fixture, prepared and played out. */
function playedMatch(seed: string): { state: GameState; match: Match } {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = state.matches[fixture.id]!;
  simulateFixture(match, matchEnvironment(state, match), 'fast');
  expect(match.played, 'the fixture did not play').toBe(true);
  return { state, match };
}

describe('the club code on the scorecard', () => {
  it('is three capitals taken from the name, the same way for every club', () => {
    // The longest word, which is the one that tells two clubs of one town apart.
    expect(clubCode('Donhall Social Club')).toBe('DON');
    expect(clubCode('The Old Three Tuns')).toBe('THR');
    expect(clubCode('Hertstreet Athletic Fields')).toBe('HER');
    // The club's noise words are set aside rather than counted: the code is of
    // what the club is called, and "FC" is not what it is called.
    expect(clubCode('The Lion FC')).toBe('LIO');
    expect(clubCode('FC Middle Ashworth')).toBe('ASH');
  });

  it('exists for every club the game can generate, and never changes', () => {
    const { state } = createTestGame('pitch-screen-code-world');
    const clubs = Object.values(state.clubs);
    expect(clubs.length).toBeGreaterThan(30);
    for (const club of clubs) {
      const code = clubCode(club.identity.name);
      expect(code, club.identity.name).toMatch(/^[A-Z0-9]{1,3}$/);
      // The rule is total and the same name always gives the same code.
      expect(clubCode(club.identity.name), club.identity.name).toBe(code);
    }
  });
});

describe('the scorecard over the pitch', () => {
  it('prints the score the engine is playing and the clock the header prints', () => {
    const { state, match } = playedMatch('pitch-screen-board');
    const score = currentScore(match);

    for (const phase of PHASES) {
      const board = renderToStaticMarkup(createElement(TvScoreboard, { game: state, match, phase }));
      const header = renderToStaticMarkup(
        createElement(MatchHeader, { game: state, match, side: 'home', phase }),
      );

      // One clock, two places: the card has none of its own. If the two ever
      // disagreed, this is where it would show — the header prints the sentence
      // it has the room for, and the bar prints the clock a box has the room for
      // (`matchClock`), both of them the same minute.
      expect(words(header), phase).toContain(matchStatus(match, phase));
      expect(words(board), phase).toContain(matchClock(match, phase));

      // And the score the match actually has, not a scoreline the layout guessed.
      expect(words(board), phase).toMatch(new RegExp(`\\b${score.home}\\s*–\\s*${score.away}\\b`));
    }
  });

  it('is a broadcaster’s bar: the station, two codes, the score between them, the clock at the end', () => {
    const { state, match } = playedMatch('pitch-screen-codes');
    const home = state.clubs[match.homeClubId]!;
    const away = state.clubs[match.awayClubId]!;
    const html = renderToStaticMarkup(createElement(TvScoreboard, { game: state, match, phase: 'in-progress' }));
    const text = words(html);

    // One bar, read left to right: the mark, our box, the score, their box, the
    // clock. The order is the layout, so it is pinned as one.
    const order = ['tvboard__mark', 'tvboard__team--home', 'tvboard__score', 'tvboard__team--away', 'tvboard__clock'];
    const at = order.map((part) => html.indexOf(part));
    expect(at.every((index) => index >= 0), 'a part of the bar is missing').toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    expect(text).toContain('SETV');
    const homeCode = clubCode(home.identity.name);
    const awayCode = clubCode(away.identity.name);
    expect(homeCode).toMatch(/^[A-Z0-9]{3}$/);
    expect(awayCode).toMatch(/^[A-Z0-9]{3}$/);
    expect(text).toContain(homeCode);
    expect(text).toContain(awayCode);

    // What a broadcast bar does not carry: no crests, and no names — a bar that
    // has to print "Donhall Social Club" is a bar four times the width.
    expect(html).not.toContain('class="badge"');
    expect(text).not.toContain(home.identity.name);
    expect(text).not.toContain(away.identity.name);

    // The names are a hover away, and the whole bar is one sentence to a screen
    // reader rather than six fragments in a row.
    expect(html).toContain(`title="${home.identity.name}"`);
    expect(html).toContain(`title="${away.identity.name}"`);
    const label = decode(/aria-label="([^"]*)"/.exec(html)?.[1] ?? '');
    expect(html).toContain('role="img"');
    expect(label).toContain(match.competitionName);
    expect(label).toContain(home.identity.name);
    expect(label).toContain(away.identity.name);
    expect(label).toContain(matchStatus(match, 'in-progress'));
  });

  it('reads the minute alone while the football is being played', () => {
    const { state, match } = playedMatch('pitch-screen-clock');
    const clock = matchClock(match, 'in-progress');

    // The number, and nothing around it: the period is on the pitch, in the
    // shape of the two sides and where the ball is, and the box is a number wide.
    expect(clock).toBe(`${displayMinute(match)}'`);
    expect(clock).not.toContain('·');
    expect(clock).not.toContain(' ');

    const html = renderToStaticMarkup(createElement(TvScoreboard, { game: state, match, phase: 'in-progress' }));
    expect(words(html)).toContain(clock);
    expect(words(html)).not.toContain(matchStatus(match, 'in-progress'));

    // The sentence it is announced with still carries the period, because a
    // sentence has the room for it and a reader is owed the context.
    const label = decode(/aria-label="([^"]*)"/.exec(html)?.[1] ?? '');
    expect(label).toContain(matchStatus(match, 'in-progress'));
  });

  it('reads the whole phrase at the three moments there is no minute to give', () => {
    const { state, match } = playedMatch('pitch-screen-clock-idle');

    for (const phase of ['pre-match', 'half-time', 'full-time'] as MatchPhase[]) {
      expect(matchClock(match, phase), phase).toBe(matchStatus(match, phase));
      const html = renderToStaticMarkup(createElement(TvScoreboard, { game: state, match, phase }));
      expect(words(html), phase).toContain(matchClock(match, phase));
    }
    // Kick-off is a time rather than a minute, and the bar says which one.
    expect(matchClock(match, 'pre-match')).toContain('Kick-off');
  });

  it('wears the shirts the two sides turned out in, each box in ink that reads on it', () => {
    const { state, match } = playedMatch('pitch-screen-boxes');
    const kits = matchKitColours(state, match.homeClubId, match.awayClubId);
    const html = renderToStaticMarkup(createElement(TvScoreboard, { game: state, match, phase: 'in-progress' }));

    const homeTag = /<span class="tvboard__team tvboard__team--home"[^>]*>/.exec(html)?.[0] ?? '';
    const awayTag = /<span class="tvboard__team tvboard__team--away"[^>]*>/.exec(html)?.[0] ?? '';
    // The strip each side is actually in — the same `matchKitColours` the pitch
    // below the bar is drawn from — with the ink `flatClubInk` chooses for it,
    // which is the same contrast floor the men on the grass are held to.
    expect(homeTag).toContain(kits.home);
    expect(homeTag).toContain(flatClubInk(kits.home));
    expect(awayTag).toContain(kits.away);
    expect(awayTag).toContain(flatClubInk(kits.away));
  });

  it('is one row tall, flat paint over the picture, in the top-left corner', () => {
    const block = sheetBody('.tvboard');
    expect(block).toMatch(/top: var\(--s2\)/);
    expect(block).toMatch(/left: var\(--s2\)/);
    expect(block).toContain('position: absolute');
    // One row: a bar that stacks is a bar that covers the football. Its height is
    // a token because one other rule — where the direction marker goes in a
    // portrait frame — is about clearing the bar rather than about 30.
    expect(block).toContain('display: flex');
    expect(block).toContain('height: var(--tvboard-h, 30px)');
    expect(sheet).toContain('--tvboard-h: 30px');
    expect(sheet).toContain("calc(var(--s2) + var(--tvboard-h) + 8px)");
    // Nothing on the bar is a control, so it must not swallow a press meant for
    // the picture underneath it.
    expect(block).toContain('pointer-events: none');
    // And the stacked card is gone, not merely unused.
    expect(sheet).not.toMatch(/\.tvboard__(stripe|comp|row|crest|name)\b/);

    const { state, match } = playedMatch('pitch-screen-flat');
    const html = renderToStaticMarkup(createElement(TvScoreboard, { game: state, match, phase: 'in-progress' }));
    expect(html).not.toContain('<button');
    expect(html).not.toContain('tabindex');
  });
});

describe('the one button in the corner', () => {
  it('offers the whole screen, and says which way it will go', () => {
    const closed = renderToStaticMarkup(createElement(PitchViewToggle, { full: false, onToggle: () => {} }));
    expect(closed).toContain('aria-pressed="false"');
    expect(closed).toContain('Give the pitch the whole screen');
    expect(closed).toContain('glyph');

    const open = renderToStaticMarkup(createElement(PitchViewToggle, { full: true, onToggle: () => {} }));
    expect(open).toContain('aria-pressed="true"');
    expect(open).toContain('Back to the match screen');
    expect(open).toContain('pitchfull--on');
    // The two states are two drawings, not one drawing with a label on it.
    expect(closed).not.toBe(open);
  });

  it('sits in the bottom-right corner of the grass, big enough for a thumb', () => {
    const block = sheetBody('.pitchfull');
    expect(block).toContain('position: absolute');
    expect(block).toMatch(/right: var\(--s2\)/);
    expect(block).toMatch(/bottom: var\(--s2\)/);
    expect(block).toMatch(/width: 44px/);
    expect(block).toMatch(/height: 44px/);
  });

  it('stops animating for a manager who asked for stillness', () => {
    expect(sheet).toContain("html[data-motion='reduced'] .tvboard");
    expect(sheet).toMatch(/prefers-reduced-motion[\s\S]*?\.tvboard/);
  });
});

describe('the view the button switches to', () => {
  it('is one state: it draws the board and the button in the corners of the pitch itself', () => {
    // Both live in the renderer's box rather than beside it, so the button is in
    // the same place whether or not the pitch has the screen.
    expect(source).toMatch(
      /className="matchday__renderer"[\s\S]*<PitchViewToggle full=\{pitchOnly\} onToggle=\{togglePitchOnly\} \/>/,
    );
    expect(source).toContain('{pitchOnly && <TvScoreboard game={game} match={match} phase={phase} />}');
    expect(source).toContain("className={`matchday${pitchOnly ? ' matchday--pitchonly' : ''}`}");
  });

  it('stands the frame aside while the grass has the screen, and leaves the controls alone', () => {
    expect(source).toContain('{!pitchOnly && <MatchHeader');
    expect(source).toMatch(/!pitchOnly && \(\s*<TeamSheet\s+side="home"/);
    expect(source).toMatch(/!pitchOnly && \(\s*<TeamSheet\s+side="away"/);
    expect(source).toContain("{!pitchOnly && phase !== 'pre-match' && (");
    expect(source).toContain("{!pitchOnly && phase !== 'pre-match' && marks.length > 0 && (");
    // The match has not stopped, so the strip that pauses it, changes it and
    // reads it stays exactly where it is.
    expect(source).toMatch(/\n {6}<MatchControls/);
  });

  it('gives the afternoon back by the button, by Escape, by the back gesture and by the browser', () => {
    expect(source).toContain('useDismissable(pitchOnly, leavePitchOnly)');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('watchFullscreen((full) => {');
    // The browser's own fullscreen is only given up when *this* view asked for
    // it, so a screen the manager had already put in fullscreen keeps it.
    expect(source).toMatch(/if \(!askedFullscreen\.current\) return;/);
    expect(source).toContain('askedFullscreen.current = true;');
  });

  it('cannot outlive the picture it was opened for', () => {
    expect(source).toContain("const commentaryOnly = session?.viewingMode === 'commentary';");
    expect(source).toMatch(/if \(commentaryOnly\) leavePitchOnly\(\);/);
  });

  it('gives the picture the whole frame, with the corners still inside the safe area', () => {
    expect(sheetBody('.matchday--pitchonly .matchday__main')).toContain('padding: 0');
    expect(sheetBody('.matchday--pitchonly .matchday__stage')).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    );
  });
});

/**
 * The ground around the pitch.
 *
 * A football pitch has goals on it, and a goal is the one thing about a pitch
 * that is not on it: the mouth is on the goal line and the net hangs behind, over
 * ground the playing surface does not cover. That is only drawable if the picture
 * has somewhere to put it — the surface is inset inside the renderer's box rather
 * than filling it, everything placed by coordinates is placed in the surface's own
 * space, and nothing clips it, so a point a little behind a goal line is drawn on
 * the ground rather than cut off at the line.
 *
 * Two halves of one arrangement, checked together: the markup the renderer emits
 * for a real afternoon, and the geometry the stylesheet gives that markup.
 */
describe('the ground around the pitch', () => {
  /** A played afternoon, and the picture the match screen hands the renderer. */
  function drawnMatch(seed: string) {
    const { state, match } = playedMatch(seed);
    return {
      render: buildMatchRenderState(match, state),
      playerById: (id: string): Player | undefined => {
        const person = state.people[id];
        return isPlayer(person) ? person : undefined;
      },
    };
  }

  it('stands the two goals on it, behind the goal lines they belong to', () => {
    const { render, playerById } = drawnMatch('pitch-screen-goals');
    const html = renderToStaticMarkup(createElement(MatchPitch, { state: render, side: 'home', playerById }));

    // The surface is drawn, and both goals hang off it: a mouth on each goal line
    // with a net behind. One at the home end and one at the away end, whichever
    // way round the box is drawn.
    expect(html).toContain('class="pitch__surface"');
    expect(html.match(/class="pitch__goal pitch__goal--(left|right)"/g)).toHaveLength(2);
    expect(html.indexOf('pitch__surface')).toBeLessThan(html.indexOf('pitch__goal'));

    // The football is placed inside the surface, because the surface is where the
    // coordinates mean the pitch: the ground is for the goals, not for the men.
    expect(html.indexOf('pitch__surface')).toBeLessThan(html.indexOf('pitch__halfway'));
    expect(html.indexOf('pitch__surface')).toBeLessThan(html.indexOf('pitch__dot-ball'));
    expect(html.indexOf('pitch__surface')).toBeLessThan(html.indexOf('pitch__ball'));

    // And every coordinate written into the picture is a point on the pitch. A
    // man or a ball on the ground beyond it would be the frame going wrong rather
    // than a goal being celebrated — a point out there has to be deliberate.
    const written = [...html.matchAll(/(?:left|top):\s*(-?[\d.]+)%/g)].map(([, value]) => Number(value));
    expect(written.length).toBeGreaterThan(40);
    for (const value of written) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  /**
   * A real afternoon being played, caught at the moment a throw-in is taken.
   *
   * Waiting for one to come round in a live match would make the test a wager on
   * a seed's luck — the engine plays a handful of throw-ins in an afternoon, and
   * which minute the first arrives in is the football's business. So the ball is
   * put over the touchline and the engine's own resolution awards the throw-in:
   * the dead ball, its spot, the man to take it and the ground he stands on to
   * take it are all the simulation's answer, and the picture is only ever handed
   * the result.
   */
  function thrownIn(seed: string) {
    const { state } = createTestGame(seed);
    const fixture = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
    )!;
    prepareMatchday(state, fixture.matchday);
    // A copy, so the afternoon being read cannot touch the career it came from.
    const match = cloneMatch(state.matches[fixture.id]!);
    const engine = createMatchEngine(match, matchEnvironment(state, match));
    const es = engine.getState();

    // Read through the engine rather than the state object held here: the two are
    // the same object, and reading it this way is what keeps the dead ball below
    // visible to the compiler rather than narrowed away by the line that clears
    // it.
    const piece = () => engine.getState().setPiece;

    // Out of the opening kick-off, and into open play, which is the only state a
    // boundary is judged in: the engine's own restart suite steps aside the
    // arranged dead ball the same way, because a dead ball is never resolved
    // against the touchline (`resolveInteractions` answers it directly).
    es.setPiece = null;
    es.phase = 'open-play';

    es.ball.x = 0.32;
    es.ball.y = 1.002;
    es.ball.status = 'loose';
    for (let step = 0; step < 30; step += 1) {
      engine.advance(1 / 30, 1 / 30, false);
      if (piece()?.kind === 'throw-in') break;
    }
    expect(piece()?.kind, 'the ball over the touchline was not a throw-in').toBe('throw-in');

    // Then let him walk out to the line, up to the moment the throw is actually
    // taken — the moment worth drawing, and the moment the thrower is off the
    // pitch with the ball in his hands and the spot on the grass in front of him.
    // The engine will not take it before he is there: the restart waits for him.
    for (let step = 0; step < 400; step += 1) {
      const piece = engine.getState().setPiece;
      if (!piece || piece.phase === 'delivery') break;
      engine.advance(1 / 30, 1 / 30, false);
    }
    expect(engine.getState().setPiece?.phase, 'the throw-in was never taken').toBe('delivery');

    const render = buildEngineRenderState(engine, match, state);
    expect(render.restart()?.kind, 'the ball over the touchline was not a throw-in').toBe('throw-in');
    expect(render.ball.status).toBe('out-of-play');
    return {
      render,
      restart: render.restart()!,
      playerById: (id: string): Player | undefined => {
        const person = state.people[id];
        return isPlayer(person) ? person : undefined;
      },
    };
  }

  it('draws the ball out of play and the man over it, at the line it left', () => {
    const { render, restart, playerById } = thrownIn('pitch-screen-throw-in');
    const html = renderToStaticMarkup(createElement(MatchPitch, { state: render, side: 'home', playerById }));

    // The ball is out of play — the engine's own state, drawn as itself — and
    // nobody is playing it. A throw-in is the one dead ball that is *carried*: the
    // ball is in the thrower's hands, off the pitch, while the spot it is played
    // from is chalked on the grass he is standing just beyond.
    expect(html).toMatch(/class="pitch__ball" data-status="out-of-play"/);

    // And the man taking it is picked out and named, alone among the twenty-two:
    // the ball is nobody's while it is dead, so the picture has to be told who is
    // over it, and the contract is where it is told.
    expect(html.match(/pitch__dot--taker/g) ?? []).toHaveLength(1);
    const tag = tagOf(html, 'pitch__dot--taker');
    expect(tag).toContain('pitch__dot--taker');
    expect(tag).toContain('pitch__dot--named');
    // And it marks the man the engine named, not the one nearest the ball.
    const taker = playerById(restart.takerId!);
    expect(taker).toBeTruthy();
    expect(tag).toContain(taker!.surname);

    // The thrower stands *off* the pitch, holding the ball, and the ball comes
    // back in over the line: this is what the ground around the surface is for.
    const ballTag = tagOf(html, 'class="pitch__ball"');
    const spotTag = tagOf(html, 'class="pitch__spot"');
    // The ball left over the far touchline in this fixture, so the thrower and the
    // ball in his hands are drawn past the bottom edge of the surface — a written
    // coordinate outside the grass, which is only drawable because the surface
    // clips nothing and there is ground under it.
    expect(restart.spot.y, 'the fixture did not put the ball over the far line').toBeGreaterThan(0.5);
    expect(coordinate(tag, 'top')).toBeGreaterThan(100);
    expect(coordinate(ballTag, 'top')).toBeGreaterThan(100);
    // In his hands, so drawn at his feet: within a half of one per cent of the
    // surface, which is nearer than the dot he is drawn as is wide.
    expect(Math.abs(coordinate(ballTag, 'top') - coordinate(tag, 'top'))).toBeLessThan(0.5);
    expect(Math.abs(coordinate(ballTag, 'left') - coordinate(tag, 'left'))).toBeLessThan(0.5);

    // And the spot it is played from is on the grass, at the engine's own spot:
    // the picture is not guessing where the throw comes in from, and it is not
    // drawing the mark under the ball, which is off the pitch.
    expect(spotTag).toContain('data-kind="throw-in"');
    expect(spotTag).not.toContain('hidden');
    expect(coordinate(spotTag, 'top')).toBeCloseTo(restart.spot.y * 100, 6);
    expect(coordinate(spotTag, 'left')).toBeCloseTo(restart.spot.x * 100, 6);
    expect(coordinate(spotTag, 'top')).toBeLessThan(100);
    // And he stands over it: the walk ends within a stride of the mark — the law
    // lets him take the throw from there — so the two are drawn on the same line
    // along the touchline rather than a stride apart along it.
    expect(Math.abs(coordinate(spotTag, 'left') - coordinate(tag, 'left'))).toBeLessThan(2.5);
  });

  it('paints the surface the ground is actually in, from the ground’s own reading of it', () => {
    const { state, match } = playedMatch('pitch-screen-surface');
    const ground = state.world.grounds[match.groundId]!;
    const playerById = (id: string): Player | undefined => {
      const person = state.people[id];
      return isPlayer(person) ? person : undefined;
    };
    const drawn = () =>
      renderToStaticMarkup(
        createElement(MatchPitch, { state: buildMatchRenderState(match, state), side: 'home', playerById }),
      );

    // A pitch with grass on it in good weather: the surface is named for the
    // stylesheet, and nothing is drawn across the grass, because nothing has
    // happened to it. A green field with no marks on it is a ground with nothing
    // wrong with it, which is what makes the marks information.
    ground.surface = 'grass';
    ground.quality = 18;
    match.conditions = { ...match.conditions, pitch: 'excellent' };
    const good = drawn();
    expect(good).toContain('data-surface="lush"');
    expect(good).not.toContain('pitch__patch');

    // And a surface that is not grass is drawn as what it is, whatever the day
    // says: an artificial pitch reads excellent on a wet Sunday because it holds
    // no water, and the picture has to agree with the ground rather than draw a
    // field of grass the club has never had.
    ground.surface = '3G';
    const artificial = drawn();
    expect(artificial).toContain('data-surface="artificial"');
    expect(artificial).toContain('--mow-ink:0');
    expect(artificial).not.toContain('pitch__patch');

    // A February league game on a pudding with a winter of football behind it:
    // mud in the goalmouths, the mow flattened out of the grass, and the wear of
    // the games since anybody last looked at it.
    ground.surface = 'grass';
    ground.quality = 6;
    ground.fixturesSinceAttention = 3;
    match.conditions = { ...match.conditions, pitch: 'muddy' };
    const heavy = drawn();
    expect(heavy).toContain('data-surface="heavy"');
    expect(heavy).toMatch(/class="pitch__patch pitch__patch--mud"/);
    // The mown bands are painted at the strength the surface has left, so a wet
    // pitch has them flattened out of it and an artificial one has none.
    expect(heavy).toMatch(/--mow-ink:0?\.\d+/);

    // Every mark is on the grass, and under the paint: a mud patch is a state of
    // the pitch rather than a thing standing on it, so the markings, the men and
    // the ball are all drawn over it.
    const marks = [...heavy.matchAll(/(?:left|top):\s*(-?[\d.]+)%/g)].map(([, value]) => Number(value));
    expect(marks.length).toBeGreaterThan(40);
    for (const value of marks) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(heavy.indexOf('pitch__patch')).toBeLessThan(heavy.indexOf('pitch__halfway'));
    expect(heavy.indexOf('pitch__patch')).toBeLessThan(heavy.indexOf('pitch__dot-ball'));
  });

  it('plants the four corner flags on it, with the arcs struck from them', () => {
    const { render, playerById } = thrownIn('pitch-screen-flags');
    const html = renderToStaticMarkup(createElement(MatchPitch, { state: render, side: 'home', playerById }));
    // All four, all match: a corner is taken from the flag, and the flag is the
    // one piece of a football ground that stands off the pitch at all four of its
    // corners — which is what the ground around the playing surface is for.
    expect(html.match(/class="pitch__flag pitch__flag--(tl|tr|bl|br)"/g)).toHaveLength(4);
  });

  it('insets the grass inside the box and gives the goals and the thrower the ground beyond it', () => {
    // How much ground there is, as the two margins the surface and the goals are
    // both placed by. It is the same width all the way round: the ends hold a
    // goal, and the sides hold a thrower standing off the touchline with the ball
    // in his hands, so neither side of the picture can be given a hairline of it.
    const live = sheetBody('.pitch--live');
    expect(live).toContain('--pitch-margin-x: 5%');
    expect(live).toContain('--pitch-margin-y: 5%');
    // And it is the same whichever way round the picture is drawn. It used to
    // change: a hairline at the sides and a wide strip at the ends, swapped when
    // the pitch stood up so a net was not clipped off the top of the box. The
    // thrower is drawn *in* the strip now, so there is no narrow side left to
    // swap to — no rule anywhere in the sheet gives a margin of 2%.
    expect(sheet).not.toContain('--pitch-margin-x: 2%');
    expect(sheet).not.toContain('--pitch-margin-y: 2%');

    const surface = sheetBody('.pitch__surface');
    expect(surface).toContain('position: absolute');
    expect(surface).toContain('inset: var(--pitch-margin-y, 0) var(--pitch-margin-x, 0)');
    // Nothing clips the surface, which is what makes a net drawable at all.
    expect(surface).not.toContain('overflow');

    // The net hangs off the goal line: its near edge is the line itself, so the
    // mouth is over the grass and the mesh is over the ground.
    const goal = sheetBody('.pitch__goal');
    expect(goal).toContain('width: 4.5%');
    expect(goal).toContain('height: 11%');
    expect(goal).toContain('pointer-events: none');
    expect(sheetBody('.pitch__goal--left')).toContain('left: -4.5%');
    expect(sheetBody('.pitch__goal--right')).toContain('right: -4.5%');

    // And they come round with the picture: down the box the two goals stand at
    // the top and the bottom, and the net hangs behind the goal line along the
    // screen rather than beside it.
    const portrait = sheetBody(".pitch[data-shape='portrait'] .pitch__goal");
    expect(portrait).toContain('width: 11%');
    expect(portrait).toContain('height: 4.5%');
    expect(sheetBody(".pitch[data-shape='portrait'] .pitch__goal--left")).toContain('bottom: -4.5%');
    expect(sheetBody(".pitch[data-shape='portrait'] .pitch__goal--right")).toContain('top: -4.5%');

    // The wash of a goal falls on the grass rather than on the ground around it:
    // the celebration belongs to the pitch, and the ground is not part of it.
    expect(sheetBody(".matchpitch[data-celebrating='true']::after")).toContain(
      'inset: var(--pitch-margin-y, 0) var(--pitch-margin-x, 0)',
    );
  });

  it('strikes the corner arcs from the corners and plants the flags on them', () => {
    // Four rings, each centred exactly on a corner of the surface, so only the
    // quarter lying on the grass is ever painted and no arc has to be turned with
    // the picture — which nothing else in a pitch this shape can say.
    const arcs = sheetBody('.pitch__surface::after');
    expect(arcs).toContain('circle at 0 0');
    expect(arcs).toContain('circle at 100% 0');
    expect(arcs).toContain('circle at 0 100%');
    expect(arcs).toContain('circle at 100% 100%');
    expect(arcs).toContain('background-position: 0 0, 100% 0, 0 100%, 100% 100%');
    expect(arcs).toContain('pointer-events: none');

    // The flags sit half on the grass and half on the ground, named by the corner
    // of the picture: the surface is inset by the same margins either way round,
    // so those four points are the four corners of the pitch however it is drawn.
    const flag = sheetBody('.pitch__flag');
    expect(flag).toContain('position: absolute');
    expect(flag).toContain('transform: rotate(45deg)');
    expect(flag).toContain('pointer-events: none');
    expect(sheetBody('.pitch__flag--tl')).toContain('left: -5px');
    expect(sheetBody('.pitch__flag--tr')).toContain('right: -5px');
    expect(sheetBody('.pitch__flag--bl')).toContain('bottom: -5px');
    expect(sheetBody('.pitch__flag--br')).toContain('bottom: -5px');
  });

  it('dresses the dead ball, the spot it is played from and the man over it', () => {
    // The ball out of play is the one state in which nobody is playing it, so it
    // is dimmer than a loose ball and nothing else about it changes: it is drawn
    // wherever the simulation has it, which for a throw-in is off the pitch.
    const dead = sheetBody(".pitch__ball[data-status='out-of-play']");
    expect(dead).toContain('opacity: 0.62');
    expect(dead).toContain('box-shadow: none');

    // The spot it is played from is a mark of its own rather than a ring around
    // the ball — the ball and the spot are two different places for a throw-in,
    // so the mark cannot be the ball's shadow any more — and it is drawn at the
    // engine's spot for as long as the restart lasts.
    const spot = sheetBody('.pitch__spot');
    expect(spot).toContain('position: absolute');
    expect(spot).toContain('border: 1px solid rgba(255, 255, 255, 0.55)');
    expect(spot).toContain('border-radius: 50%');
    expect(spot).toContain('pointer-events: none');
    // A throw-in's mark is chalked rather than ringed: it is the one restart taken
    // from outside the field, so the mark reads as the place the ball is put back
    // into play from.
    expect(sheetBody(".pitch__spot[data-kind='throw-in']")).toContain('border-style: dashed');
    expect(sheet).not.toContain(".pitch__ball[data-status='out-of-play']::after");

    // And the man over it wears the one ring nobody else wears — the ball is
    // nobody's while it is dead, so this is the only thing saying who is taking it.
    const taker = sheetBody('.pitch__dot--taker .pitch__dot-ball');
    expect(taker).toContain('box-shadow');
    expect(taker).toContain('rgba(255, 255, 255, 0.6)');

    // He is also the one man the picture draws off the bottom of itself, so his
    // name goes above his head rather than under his feet — otherwise the name is
    // the part of him that leaves the box. Lifted over the ball by the ball's own
    // height and the name's, as a transform, so the ball itself stays on his mark
    // exactly where every other dot's ball is: a menu of twenty-two surnames with
    // one of them cut off would be worse than no name at all.
    expect(sheetBody(".pitch__dot[data-label='up'] .pitch__dot-name")).toContain(
      'translateY(calc(-100% - 20px))',
    );
    // And the renderer is what decides, from the point he is drawn at.
    expect(pitchSource).toMatch(/dataset\.label = [^;]*'up'/);
  });
});
