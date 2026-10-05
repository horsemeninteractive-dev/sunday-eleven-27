import { useState } from 'react';
import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { formatDayMonth, formatKickOff } from '@/simulation/calendar';
import {
  cupRoundName,
  cupRoundSummaries,
  isGiantKilling,
  isPostponed,
  tieScoreLine,
  type CupRoundSummary,
} from '@/simulation/cup';
import { cupCompetitions } from '@/simulation/pyramid';
import { userClub } from '@/simulation/queries';
import { gameActions, useGame } from '../hooks';
import { Button, PageHeader, Pill } from '../components/primitives';
import { FixtureRow } from '../components/FixtureRow';
import { Statistics } from '../components/Statistics';
import { competitionStats } from '@/simulation/tables';
import { MetricTile, Section, StatusTile, TileGrid } from '../components/hierarchy';

/**
 * The cups.
 *
 * A knockout competition is a bracket, and a bracket is read in reverse: the
 * final is two clubs and a date, and everything before it is how those two got
 * there. So the screen opens on four facts — which round, who is left, what
 * the manager's own side is doing, who has won it — then the round in hand at
 * full weight, and every earlier round behind a disclosure. The manager's own
 * ties are marked on every line, because a club that is not in this one is
 * still usually in the other.
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

  const rounds = cupRoundSummaries(game, shown);
  const cup = shown.cup;
  const inHand = rounds[rounds.length - 1];
  const archive = rounds.slice(0, -1);
  const survivors = clubsLeft(game, shown, rounds);
  const ownTie = ownTieIn(rounds, club.id);
  const ownOutcome = ownTie ? outcomeFor(game, ownTie, club.id) : null;
  const champion = cup?.winnerClubId ? game.clubs[cup.winnerClubId] : undefined;
  // Scoped to the clubs actually in this cup, so a player is only charted here
  // for the ties he played in it.
  const stats = competitionStats(game, shown.clubIds);

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

      <Section
        title="Competition"
        action={
          cups.length > 1 ? (
            <div className="segmented" role="tablist" aria-label="Cups">
              {cups.map((cupOption) => (
                <button
                  key={cupOption.id}
                  type="button"
                  role="tab"
                  aria-selected={cupOption.id === shown.id}
                  className={`segmented__item${cupOption.id === shown.id ? ' segmented__item--active' : ''}`}
                  onClick={() => setPicked(cupOption.id)}
                >
                  {cupOption.name.replace(/^.*Sunday League /, '')}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <TileGrid min={170}>
          <MetricTile
            label="Round"
            value={inHand ? inHand.name : '—'}
            note={inHand ? (inHand.complete ? 'Settled' : `${inHand.ties.length} ties`) : 'Not drawn'}
            tone="default"
          />
          <MetricTile
            label="Clubs left"
            value={survivors}
            note={`of ${shown.clubIds.length} in the draw`}
            tone={survivors <= 2 ? 'accent' : 'default'}
          />
          <StatusTile
            label="Your tie"
            status={ownTie && ownOutcome ? ownOutcome.status : ownTie ? tieVenueLine(game, ownTie, club.id) : 'Not in it'}
            note={
              ownTie && ownOutcome
                ? ownOutcome.note
                : ownTie
                  ? `${formatDayMonth(ownTie.date)} · ${formatKickOff(ownTie.kickOff)}`
                  : 'No tie in this competition'
            }
            tone={ownOutcome ? ownOutcome.tone : ownTie ? 'accent' : 'muted'}
          />
          <MetricTile
            label="Champion"
            value={champion ? champion.identity.shortName : '—'}
            note={
              champion && cup?.runnerUpClubId
                ? `beat ${game.clubs[cup.runnerUpClubId]?.identity.shortName ?? '—'}`
                : 'Not decided'
            }
            tone={champion?.id === club.id ? 'ok' : 'default'}
          />
        </TileGrid>
      </Section>

      {!inHand && (
        <Section title="Draw">
          <TileGrid min={215}>
            <MetricTile label="Status" value="Awaiting the draw" note="The first round has not been made yet" tone="muted" />
          </TileGrid>
        </Section>
      )}

      {/* The round in hand carries the screen; everything before it is the
          archive and waits behind a disclosure. */}
      {inHand && (
        <Section
          title={inHand.name}
          action={
            <span className="small muted">
              {inHand.date ? formatDayMonth(inHand.date) : ''} · {inHand.ties.length} tie
              {inHand.ties.length === 1 ? '' : 's'}
              {inHand.complete ? ' · settled' : ''}
              {replayDate(game, inHand) ? ` · waiting on a replay, moved to ${formatDayMonth(replayDate(game, inHand)!)}` : ''}
            </span>
          }
        >
          <TieList game={game} summary={inHand} />
        </Section>
      )}

      <Section title="Statistics" action={<span className="small muted">{shown.name}</span>}>
        <Statistics stats={stats} subtitle={shown.name} />
      </Section>

      {archive.length > 0 && (
        <details className="more">
          <summary className="small muted">Earlier rounds ({archive.length})</summary>
          <div className="stack">
            {[...archive].reverse().map((summary) => (
              <Section
                key={summary.round}
                title={summary.name}
                action={
                  <span className="small muted">
                    {summary.date ? formatDayMonth(summary.date) : ''} · {summary.ties.length} tie
                    {summary.ties.length === 1 ? '' : 's'}
                  </span>
                }
              >
                <TieList game={game} summary={summary} />
              </Section>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * The date a postponed tie in this round has been moved to.
 *
 * A round that is waiting on a replay says so, and says when: otherwise a round
 * stuck on "4 ties" looks like the simulation has simply forgotten the fourth
 * game rather than that it was moved to another night.
 */
function replayDate(game: GameState, summary: CupRoundSummary): ISODate | null {
  if (summary.complete) return null;
  const postponed = summary.ties.find((tie) => isPostponed(tie) && tie.replacedByMatchId);
  return postponed?.replacedByMatchId ? (game.matches[postponed.replacedByMatchId]?.date ?? null) : null;
}

/** The bracket: every tie in one round, the manager's own marked. */
function TieList({ game, summary }: { game: GameState; summary: CupRoundSummary }) {
  const club = userClub(game);

  if (summary.ties.length === 0) {
    return (
      <TileGrid min={215}>
        <MetricTile label="Draw" value="Nothing drawn" note="No ties in this round" tone="muted" />
      </TileGrid>
    );
  }

  return (
    <ul className="cup__ties">
      {summary.ties.map((tie) => (
        <FixtureRow
          key={tie.id}
          state={game}
          match={tie}
          homeClubId={tie.homeClubId}
          awayClubId={tie.awayClubId}
          mine={tie.homeClubId === club.id || tie.awayClubId === club.id}
          result={tie.played ? <Pill tone={tieTone(game, tie)}>{tieScoreLine(tie)}</Pill> : undefined}
          note={isGiantKilling(game, tie) ? <span className="muted small">giant killing</span> : undefined}
        >
          {tie.played ? null : <Pill tone="time">{formatKickOff(tie.kickOff)}</Pill>}
        </FixtureRow>
      ))}
    </ul>
  );
}

/** The competition in one line of fact, for the header. */
function subtitleFor(game: GameState, competition: Competition): string {
  const cup = competition.cup;
  if (cup?.winnerClubId) {
    const winner = game.clubs[cup.winnerClubId];
    return `${game.season.label} · won by ${winner?.identity.name ?? 'a club'}`;
  }
  if (cup?.complete) return `${game.season.label} · complete`;
  return `${game.season.label} · ${cupRoundName(competition, cup?.round ?? 1)}`;
}

/** Who is still in the competition: every entrant who has not lost a tie. */
function clubsLeft(game: GameState, competition: Competition, rounds: CupRoundSummary[]): number {
  const gone = new Set<ClubId>();
  for (const summary of rounds) {
    for (const tie of summary.ties) {
      const winner = winnerOf(tie);
      if (!winner) continue;
      gone.add(winner === tie.homeClubId ? tie.awayClubId : tie.homeClubId);
    }
  }
  void game;
  return competition.clubIds.filter((clubId) => !gone.has(clubId)).length;
}

/**
 * Who won a settled tie. A knockout has no draws: level after extra time goes
 * to penalties, and the shootout is the decider of record.
 */
function winnerOf(tie: Match): ClubId | null {
  const result = tie.result;
  if (!tie.played || !result) return null;
  if (result.homeGoals !== result.awayGoals) {
    return result.homeGoals > result.awayGoals ? tie.homeClubId : tie.awayClubId;
  }
  if (!result.penalties) return null;
  return result.penalties.home > result.penalties.away ? tie.homeClubId : tie.awayClubId;
}

/** The manager's most recent tie in this competition, newest round first. */
function ownTieIn(rounds: CupRoundSummary[], clubId: ClubId): Match | undefined {
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const tie = rounds[index]!.ties.find(
      (candidate) => candidate.homeClubId === clubId || candidate.awayClubId === clubId,
    );
    if (tie) return tie;
  }
  return undefined;
}

/** The status the manager reads first: through, out, or still to play. */
function outcomeFor(
  game: GameState,
  tie: Match,
  clubId: ClubId,
): { status: string; note: string; tone: 'ok' | 'bad' | 'warn' } | null {
  if (!tie.played) return null;
  const isHome = tie.homeClubId === clubId;
  const opponentId = isHome ? tie.awayClubId : tie.homeClubId;
  const opponent = game.clubs[opponentId]?.identity.name ?? '—';
  const venue = isHome ? 'v' : 'at';
  const won = winnerOf(tie) === clubId;
  return {
    status: won ? 'Through' : 'Out',
    note: `${venue} ${opponent}, ${tieScoreLine(tie)}`,
    tone: won ? 'ok' : 'bad',
  };
}

function tieVenueLine(game: GameState, tie: Match, clubId: ClubId): string {
  const isHome = tie.homeClubId === clubId;
  const opponentId = isHome ? tie.awayClubId : tie.homeClubId;
  const opponent = game.clubs[opponentId]?.identity.name ?? '—';
  return `${isHome ? 'v' : 'at'} ${opponent}`;
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
