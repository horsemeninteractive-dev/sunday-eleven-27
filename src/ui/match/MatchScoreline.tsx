import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { currentScore } from '@/simulation/match/matchEngine';
import { matchKitColours, shirtLine } from '../kit';
import { ClubBadge } from '../components/Badge';

/**
 * A stopped match, in the match's own marks.
 *
 * The header at the top of the afternoon has always shown a match the way this
 * game knows how to show one: a crest, a name, the score, and — over the whole
 * width of it — the two strips the sides actually turned out in. The moments the
 * match *stops* for the manager did not: half time and full time spelled the same
 * score out in a sentence, and the report opened with a line of type, so the
 * three places a match is put in front of him as a result were the only three
 * places in the game that forgot it draws clubs and shirts.
 *
 * They read it from here instead, which is one drawing with three callers rather
 * than the same scoreline written out three times: the crests, the two names, the
 * score between them, and the two shirts as one hard line across the top of the
 * block. It is the header's grammar, so the moment the whistle goes the manager
 * is looking at the same thing he has been looking at all afternoon.
 *
 * It takes its career and its match as props and reads nothing else, because it
 * is a drawing of one match: the same drawing is the head of a card over the
 * pitch and the headline of the report, and neither of them has to hand it
 * anything but the match they are about.
 */
export function MatchScoreline({ game, match }: { game: GameState; match: Match }) {
  const home = game.clubs[match.homeClubId]!;
  const away = game.clubs[match.awayClubId]!;
  // The shirts, not the two clubs' own colours, which is the same answer the
  // header gives: a side that has changed into a white away strip is white here,
  // because the manager is reading who is who rather than who is called what.
  const kits = matchKitColours(game, match.homeClubId, match.awayClubId);
  const score = currentScore(match);

  return (
    <span className="matchscore">
      <span className="matchscore__stripe" aria-hidden="true" style={{ background: shirtLine(kits) }} />
      <span className="matchscore__side">
        <span className="matchscore__crest">
          <ClubBadge club={home} />
        </span>
        <strong>{home.identity.name}</strong>
      </span>
      <span className="matchscore__score">
        <span>{score.home}</span>
        <span className="matchscore__dash">–</span>
        <span>{score.away}</span>
      </span>
      <span className="matchscore__side matchscore__side--away">
        <strong>{away.identity.name}</strong>
        <span className="matchscore__crest">
          <ClubBadge club={away} />
        </span>
      </span>
    </span>
  );
}
