import type { CSSProperties } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { currentScore } from '@/simulation/match/matchEngine';
import { flatClubInk } from '../colour';
import { UIGlyph } from '../components/icons';
import { matchKitColours } from '../kit';
import { matchClock, matchStatus, type MatchPhase } from './MatchHeader';

/**
 * The two pieces of furniture the whole-screen pitch adds.
 *
 * The pitch can be given the whole window for as long as the manager wants it —
 * a button in the corner of the grass, a scorecard over it, and the same button
 * to put the afternoon back the way it was. Neither of these decides anything:
 * the card reads the score the engine is playing and the clock the header prints
 * (`matchStatus`, so the two can never disagree about the minute), and the toggle
 * is a press that changes one boolean in `MatchView`.
 *
 * The card sits top-left and the toggle bottom-right because those are the two
 * corners a television picture keeps clear. The middle of the pitch is where the
 * football is, and the middle is where the manager is looking.
 */

/**
 * Words that are not what a club is *called*, for the purpose of a code.
 *
 * A scorecard box is three characters wide, and "FC", "AFC", "SC" and a leading
 * "The" are the words that fit in no code anybody would read. Nothing else is
 * dropped: a code is allowed to be wrong about a club, but it is not allowed to
 * be about a different club.
 */
const CODE_NOISE = new Set(['THE', 'FC', 'AFC', 'SC', 'CF', 'AC', 'AND', 'OF']);

/**
 * A club's code, the way a scorecard gives one: three capitals.
 *
 * Not `shortName`, which is a *name* trimmed to fit a column — "The Old Three
 * Tuns" is what the club is called by everybody, and it is four times the width
 * of the box it has to fit in here. Broadcasters work from a register of official
 * three-letter codes and this game has no such register, so the code is derived
 * from the name by one rule, applied to every club:
 *
 *  - the club's noise words are set aside;
 *  - what is left is abbreviated by its **longest word**, three letters, because
 *    that is the word that tells one Oakbridge club from another: "Donhall Social
 *    Club" is `DON`, "The Old Three Tuns" is `THR`, "Hertstreet Athletic Fields"
 *    is `HER`;
 *  - a name with nothing long enough in it in falls back to the initials of its
 *    words and then to its own first letters, so a code always exists.
 *
 * Two clubs in a county can share a code. This is one scorecard on one afternoon,
 * so they are never side by side — and the full name is a `title` away.
 */
export function clubCode(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return '';

  const significant = words.filter((word) => !CODE_NOISE.has(word));
  const pool = significant.length > 0 ? significant : words;
  // The longest word, and the first of them if two are the same length, so the
  // rule is total and the same name always gives the same code.
  const longest = pool.reduce((best, word) => (word.length > best.length ? word : best), pool[0]!);

  const fromLongest = longest.slice(0, 3);
  if (fromLongest.length === 3) return fromLongest;
  const initials = pool.map((word) => word[0]!).join('').slice(0, 3);
  if (initials.length === 3) return initials;
  return words.join('').slice(0, 3);
}

/**
 * A match, as a broadcaster's scorecard.
 *
 * The real thing, at the size the real thing is: one bar, one row, no second
 * line and no crests — the station's own block at the head, then the two clubs
 * as three-letter codes in boxes wearing the strips they turned out in, the score
 * between them, and the clock at the end of the bar. It is read from across a room
 * in one glance, which is the whole job of the thing, and the whole of why it is
 * this small: everything it left out is on the match screen one press away.
 *
 * Nothing on it is a number the match has not produced: the score is
 * `currentScore`, the clock is `matchClock` — the minute alone while the football
 * is being played, and the header's own phrase for kick-off, half time and full
 * time — and the two colours are `matchKitColours`, so a side in a white away
 * shirt is white in the boxes and on the pitch below them. The ink in each box is
 * chosen for its colour by `flatClubInk`, the same contrast floor the pitch uses
 * for its men.
 *
 * It is one graphic with one sentence, so it is announced as one: `role="img"`
 * and a label carrying the competition, the two clubs, the score and the clock.
 * That label is the *full* clock (`matchStatus`, so a reader gets the period as
 * well as the minute) while the cell itself is the number — the sentence is a
 * description of the graphic, and the graphic is what fits in a box. The full
 * names are a hover away in the boxes' own titles.
 */
export function TvScoreboard({ game, match, phase }: { game: GameState; match: Match; phase: MatchPhase }) {
  const home = game.clubs[match.homeClubId]!;
  const away = game.clubs[match.awayClubId]!;
  const score = currentScore(match);
  const kits = matchKitColours(game, match.homeClubId, match.awayClubId);
  const status = matchStatus(match, phase);
  const clock = matchClock(match, phase);
  const line = `${match.competitionName} · ${home.identity.name} ${score.home}–${score.away} ${away.identity.name} · ${status}`;

  return (
    <div className="tvboard" role="img" aria-label={line} title={line}>
      <span className="tvboard__mark" title="Sunday Eleven TV">
        SETV
      </span>
      <span
        className="tvboard__team tvboard__team--home"
        title={home.identity.name}
        style={{ '--box': kits.home, '--box-ink': flatClubInk(kits.home) } as CSSProperties}
      >
        {clubCode(home.identity.name)}
      </span>
      <span className="tvboard__score">
        <span>{score.home}</span>
        <i>–</i>
        <span>{score.away}</span>
      </span>
      <span
        className="tvboard__team tvboard__team--away"
        title={away.identity.name}
        style={{ '--box': kits.away, '--box-ink': flatClubInk(kits.away) } as CSSProperties}
      >
        {clubCode(away.identity.name)}
      </span>
      <span className="tvboard__clock">{clock}</span>
    </div>
  );
}

/**
 * The press that gives the pitch the screen, and the press that gives it back.
 *
 * It is one button in one place, which is the whole of the interaction: the
 * corner of the grass in the match screen, the corner of the picture when the
 * pitch has the screen. Whether it is expanded is the caller's state, so the
 * picture and the button can never come apart.
 */
export function PitchViewToggle({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  const label = full ? 'Back to the match screen' : 'Give the pitch the whole screen';
  return (
    <button
      type="button"
      className={`pitchfull${full ? ' pitchfull--on' : ''}`}
      aria-pressed={full}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <UIGlyph name={full ? 'contract' : 'expand'} />
    </button>
  );
}
