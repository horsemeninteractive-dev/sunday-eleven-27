import { useState } from 'react';
import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { formatDayMonth } from '@/simulation/calendar';
import {
  cupRoundSummaries,
  isGiantKilling,
  tieScoreLine,
  type CupRoundSummary,
} from '@/simulation/cup';
import { cupCompetitions } from '@/simulation/pyramid';
import { userClub } from '@/simulation/queries';
import { ordinal } from '@/simulation/news';
import { gameActions, useGame } from '../hooks';
import { Button, PageHeader, Panel, Pill } from '../components/primitives';
import { ClubLink } from '../components/Links';

/**
 * The cups.
 *
 * A knockout competition is a bracket, and a bracket is read in reverse: the
 * final is two clubs and a date, and everything before it is how those two got
 * there. So the rounds run newest-first, the round in hand sits at the top with
 * its ties still to come, and the settled rounds are the archive below it.
 *
 * The manager's own ties are called out on every round, because a club that is
 * not in this one is still usually in the other, and a Saturday spent watching
 * a tie you are not in is a Saturday the manager wants accounted for.
 */
export function CupView() {
  const game = useGame();
  // The competition the manager's own club is in, if it is in one at all.
  const [picked, setPicked] = useState<CompetitionId | null>(null);
  if (!game) return null;
  const cups = cupCompetitions(game);

  const club = userClub(game);
  const own = cups.filter((cup) => cup.clubIds.includes(club.id));
  const shown = cups.find((cup) => cup.id === picked) ?? own[0] ?? cups[0];
  if (!shown) return null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Competition"
        title={shown.name}
        subtitle={subtitleFor(game, shown)}
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('fixtures')}>
            Your fixtures
          </Button>
        }
      />

      {cups.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Cups">
          {cups.map((cup) => (
            <button
              key={cup.id}
              type="button"
              role="tab"
              aria-selected={cup.id === shown.id}
              className={`segmented__item${cup.id === shown.id ? ' segmented__item--active' : ''}`}
              onClick={() => setPicked(cup.id)}
            >
              {cup.name.replace(/^.*Sunday League /, '')}
            </button>
          ))}
        </div>
      )}

      <CupPanel game={game} competition={shown} />
    </div>
  );
}

function subtitleFor(game: GameState, competition: Competition): string {
  const cup = competition.cup;
  if (cup?.winnerClubId) {
    const winner = game.clubs[cup.winnerClubId];
    return `${winner?.identity.name ?? 'A club'} have won it.`;
  }
  if (cup?.complete) return 'The competition is over.';
  const round = cup?.round ?? 1;
  const left = competition.clubIds.length;
  return left > 0
    ? `${ordinal(round)} round · ${left} club${left === 1 ? '' : 's'} still in`
    : `${ordinal(round)} round`;
}

/** One competition, its rounds and its ties. */
function CupPanel({ game, competition }: { game: GameState; competition: Competition }) {
  const rounds = cupRoundSummaries(game, competition);
  const cup = competition.cup;

  return (
    <>
      {cup?.winnerClubId && (
        <Panel level="primary" title="The winners" subtitle={`${competition.name}, ${game.season.label}`}>
          <div className="row">
            <ClubLink clubId={cup.winnerClubId} />
            {cup.runnerUpClubId && (
              <span className="muted small">beat {game.clubs[cup.runnerUpClubId]?.identity.name}</span>
            )}
          </div>
        </Panel>
      )}

      {!rounds.length && (
        <Panel title="The draw" subtitle="Nothing has been drawn yet">
          <p className="muted small">
            The first round is drawn from every club in the county, whoever their division.
          </p>
        </Panel>
      )}

      {/* Newest round first: the bracket is read from the final backwards. */}
      {[...rounds].reverse().map((summary) => (
        <CupRoundPanel key={summary.round} game={game} summary={summary} />
      ))}
    </>
  );
}

function CupRoundPanel({ game, summary }: { game: GameState; summary: CupRoundSummary }) {
  const club = userClub(game);
  const mine = summary.ties.filter(
    (tie) => tie.homeClubId === club.id || tie.awayClubId === club.id,
  );

  return (
    <Panel
      level={summary.complete ? 'default' : 'primary'}
      title={`${ordinal(summary.round)} round`}
      subtitle={
        summary.date
          ? `${formatDayMonth(summary.date)} · ${summary.ties.length} tie${summary.ties.length === 1 ? '' : 's'}${
              summary.complete ? '' : ' to come'
            }`
          : `${summary.ties.length} tie${summary.ties.length === 1 ? '' : 's'}`
      }
    >
      {mine.length > 0 && (
        <p className="small">
          <strong>Yours:</strong>{' '}
          {mine.map((tie) => (
            <span key={tie.id} className="cup__mine">
              {tieName(game, tie, club.id)}
            </span>
          ))}
        </p>
      )}
      <ul className="cup__ties">
        {summary.ties.map((tie) => (
          <li key={tie.id} className={`cup__tie${tie.homeClubId === club.id || tie.awayClubId === club.id ? ' cup__tie--mine' : ''}`}>
            <span className="cup__tie-teams">
              <ClubLink clubId={tie.homeClubId} />
              <span className="muted small">v</span>
              <ClubLink clubId={tie.awayClubId} />
            </span>
            <span className="cup__tie-result">
              {tie.played ? (
                <>
                  <Pill tone={tieTone(game, tie)}>{tieScoreLine(tie)}</Pill>
                  {isGiantKilling(game, tie) && <span className="muted small">giant killing</span>}
                </>
              ) : (
                <Pill tone="muted">{tie.kickOff}</Pill>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function tieName(game: GameState, tie: Match, clubId: ClubId): string {
  const opponentId = tie.homeClubId === clubId ? tie.awayClubId : tie.homeClubId;
  const venue = tie.homeClubId === clubId ? 'v' : 'at';
  return `${venue} ${game.clubs[opponentId]?.identity.name ?? '—'}${tie.played ? `, ${tieScoreLine(tie)}` : ''}. `;
}

function tieTone(game: GameState, tie: Match): 'ok' | 'bad' | 'warn' | 'muted' {
  if (!tie.played) return 'muted';
  const club = userClub(game);
  const isHome = tie.homeClubId === club.id;
  const own = isHome ? tie.result!.homeGoals : tie.result!.awayGoals;
  const other = isHome ? tie.result!.awayGoals : tie.result!.homeGoals;
  if (own > other) return 'ok';
  if (own === other) return 'warn';
  return 'bad';
}
