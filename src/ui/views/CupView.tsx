import { useState } from 'react';
import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { formatDayMonth, formatKickOff } from '@/simulation/calendar';
import { cupRoundName, isGiantKilling, isPostponed, tieScoreLine } from '@/simulation/cup';
import { userClub } from '@/simulation/queries';
import { gameActions, useGame } from '../hooks';
import { Button, PageHeader, Pill } from '../components/primitives';
import {
  cupBracket,
  drawNote,
  openStageOf,
  type BracketStage,
  type RoadStanding,
} from '../cupBracket';
import { cupGroups, cupOptions } from '../worldNav';
import { FixtureRow } from '../components/FixtureRow';
import { Statistics } from '../components/Statistics';
import { competitionStats } from '@/simulation/tables';
import { FixtureCard } from '../components/FixtureCard';
import { openMatchReport } from '../reportActions';
import { MetricTile, Section, StatusTile, TileGrid } from '../components/hierarchy';

/**
 * The cups.
 *
 * A knockout competition is a bracket, and a bracket is read as a road: the final
 * is two clubs and a date, and every round above it is what it takes to get
 * there, so the screen opens on four facts — which round, who is left, what the
 * manager's own side is doing, who has won it — and then draws the whole road,
 * round by round, from the opening preliminary to the final. Each round is a row:
 * its date, how many clubs it holds and how many of them play a tie in it, and
 * what it means for the manager's own club — the tie he played, the bye he sat
 * out, or the wait he is in. Opening a row shows that round's ties, and the round
 * about to be played opens on its own, so the screen still leads with the football
 * that is actually next.
 *
 * Reading the whole plan is the change that matters: a manager could previously
 * see the round in hand and everything behind it and nothing ahead of it, so a
 * preliminary winner could not see the round of thirty-two he had just entered,
 * nobody could see when the final was, and a Plate looked empty until the main cup
 * had filled it. What he can see now is the competition's own shape (`cupBracket`,
 * read from the plan the season was built with), and no round is inferred from a
 * date or a name.
 *
 * A county with two ladders has five cups in it: each ladder runs a League Cup
 * and the Plate its first-round losers drop into, and the county runs one cup
 * across both. Which competition each one is — whose football it is drawn from,
 * and whether it is the county's rather than a ladder's — is read off the field
 * the competition declares (`cupOptions`), so the competition a manager picks and
 * the draw he is then looking at cannot be two different ones. They are chosen
 * from one selector grouped by ladder (`cupGroups`), which is the county/district
 * choice and the cup inside it in a single control: five knockouts as five tabs
 * wrapped onto a second line, and two of them read "Cup". The name on each option
 * is the competition's own full name — 'Alderford Sunday League Cup',
 * 'Alderfordshire County Cup' — because half a name is what made two of them look
 * alike.
 */
export function CupView() {
  const game = useGame();
  // The competition the manager's own club is in, if it is in one at all.
  const [picked, setPicked] = useState<CompetitionId | null>(null);
  // Which round he has opened. This is the screen's own view state: a manager
  // reading the final has not changed a thing about the competition.
  const [opened, setOpened] = useState<number | null>(null);
  if (!game) return null;
  const cups = cupOptions(game);

  const club = userClub(game);
  const own = cups.filter((option) => option.mine);
  const shown = cups.find((option) => option.competition.id === picked) ?? own[0] ?? cups[0];
  if (!shown) return null;
  const shownCup = shown.competition;

  // The competition's whole road: every round of its plan, opening first and the
  // final last, with the ties drawn for each and what each one means for the
  // manager's own club.
  const bracket = cupBracket(game, shownCup, club.id);
  // The round he is reading. It opens on the round in hand and on the final once
  // the cup has been won, and a round he opened in another cup is ignored rather
  // than carried across: the fifth round of a Plate is not the fifth of a cup.
  const step = bracket.some((stage) => stage.round === opened) ? opened : openStageOf(bracket);
  const cup = shownCup.cup;
  // The round the tiles lead with: the one being played, or — once the cup is
  // won and there is none — the final that decided it.
  const inHand = bracket.find((stage) => stage.inHand);
  const shownRound = inHand ?? bracket[bracket.length - 1];
  const survivors = clubsLeft(shownCup, bracket);
  const ownTie = lastTieOf(bracket, club.id);
  const ownOutcome = ownTie ? outcomeFor(game, ownTie, club.id) : null;
  const champion = cup?.winnerClubId ? game.clubs[cup.winnerClubId] : undefined;
  // Scoped to the clubs actually in this cup, so a player is only charted here
  // for the ties he played in it.
  const stats = competitionStats(game, shownCup.clubIds);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Competition"
        title={shownCup.name}
        photo={shown.isPlate ? '/photos/plate-trophy.webp' : '/photos/cup-trophy.webp'}
        subtitle={subtitleFor(game, shownCup)}
        meta={
          <>
            {/* Whose competition it is, in one line, before any of the bracket:
                a ladder's own cup and the county's are read differently, and a
                manager should not have to infer which he has opened. */}
            <span className="small muted">{shown.owner}</span>
            <span className="small muted">{shown.note}</span>
          </>
        }
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
            /* One control for the lot: the ladder a competition belongs to is the
               option's own group, so the county/district choice and the cup within
               it are chosen the same time. */
            <label className="field competition-picker">
              <span className="field__label">Competition</span>
              <select className="input" value={shownCup.id} onChange={(event) => setPicked(event.target.value)}>
                {cupGroups(game).map((group) => (
                  <optgroup key={group.label} label={`${group.label}${group.mine ? ' — yours' : ''}`}>
                    {group.cups.map((option) => (
                      <option key={option.competition.id} value={option.competition.id}>
                        {option.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        <TileGrid min={170}>
          <MetricTile
            label="Round"
            value={shownRound ? shownRound.name : '—'}
            note={
              shownRound
                ? shownRound.undrawn
                  ? 'Not drawn yet'
                  : shownRound.complete
                    ? 'Settled'
                    : `${shownRound.ties.length} tie${shownRound.ties.length === 1 ? '' : 's'}`
                : 'Not drawn'
            }
            tone="default"
          />
          <MetricTile
            label="Clubs left"
            value={survivors}
            // The size of the competition, off its own plan: a competition that
            // has not been filled yet — a Plate at the start of a season — has an
            // empty entry list and still knows how big it is.
            note={`of ${bracket[0]?.field ?? shownCup.clubIds.length} in the draw`}
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

      {ownTie && <FixtureCard state={game} match={ownTie} actions={<Button variant={ownTie.played ? 'ghost' : 'primary'} onClick={() => ownTie.played ? openMatchReport(ownTie.id) : gameActions().setView('team')}>{ownTie.played ? 'Match report' : 'Prepare your team'}</Button>} />}

      {/* The competition's whole road, one round a row, opening on the round in
          hand: what a manager could read before this was the round he was in and
          the rounds behind it, and nothing of what was ahead of him. */}
      <Section
        title="The road to the final"
        action={
          bracket.length > 0 ? (
            <span className="small muted">
              {bracket.length} round{bracket.length === 1 ? '' : 's'}
            </span>
          ) : undefined
        }
      >
        <CupBracketRail
          game={game}
          competition={shownCup}
          stages={bracket}
          openRound={step}
          onOpen={setOpened}
        />
      </Section>

      <details className="more"><summary>Cup statistics · players and discipline</summary><Statistics stats={stats} subtitle={shownCup.name} /></details>
    </div>
  );
}

/** What each standing is called on a round's row. */
const ROAD_LABEL: Record<RoadStanding, string> = {
  through: 'Through',
  out: 'Out',
  toPlay: 'Next up',
  postponed: 'Postponed',
  sittingOut: 'Bye',
  inTheDraw: 'In the draw',
  ahead: 'Still in',
  notIn: '—',
};

/**
 * The bracket: one row per round, with that round's ties hanging under the row
 * that is open.
 *
 * A round is read left to right — its name, then when it is played and how many
 * ties are in it, then what it means for the manager's own club — and the whole
 * row is the control that opens the ties, because the thing a manager wants when
 * he looks at "Round of 32" is the ties, not a disclosure triangle in the corner.
 * The row he is on is a state rather than a colour alone: a pill saying Through,
 * Out, Bye or In the draw, so it is not read by hue.
 *
 * Exported for the same reason the other screens' pieces are: a layout that reads
 * nothing but its props can be printed and checked without a browser.
 */
export function CupBracketRail({
  game,
  competition,
  stages,
  openRound,
  onOpen,
}: {
  game: GameState;
  competition: Competition;
  stages: readonly BracketStage[];
  openRound: number | null;
  onOpen: (round: number | null) => void;
}) {
  const club = userClub(game);
  // A competition the world says is a cup and that carries neither a plan nor a
  // drawn round: there is a road to draw and nothing to draw it from. It says so
  // rather than printing an empty list under a heading.
  if (stages.length === 0) {
    return <p className="empty">This competition has no rounds to read yet.</p>;
  }
  return (
    <ol className="bracket">
      {stages.map((stage) => {
        const open = stage.round === openRound;
        const panelId = `bracket-round-${stage.round}`;
        const next = stages.find((candidate) => candidate.round === stage.round + 1);
        return (
          <li
            key={stage.round}
            className={`bracket__stage${open ? ' bracket__stage--open' : ''}${stage.final ? ' bracket__stage--final' : ''}`}
          >
            <button
              type="button"
              className="bracket__head"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => onOpen(open ? null : stage.round)}
            >
              {/* The state of the round, as a mark rather than an absence: a
                  settled round, the one being played, and one still to come. */}
              <span className="bracket__mark" aria-hidden="true">
                {stage.complete ? '✓' : stage.inHand ? '◉' : '○'}
              </span>
              <span className="bracket__title">
                <strong>{stage.name}</strong>
                <span className="muted small">{stageWhen(stage)}</span>
              </span>
              {stage.road && (
                <span className="bracket__road">
                  <Pill tone={stage.road.tone}>{ROAD_LABEL[stage.road.standing]}</Pill>
                  <span className="small">{stage.road.line}</span>
                  {stage.road.note ? <span className="muted small">{stage.road.note}</span> : null}
                </span>
              )}
            </button>
            {open && (
              <div className="bracket__panel" id={panelId}>
                {stage.undrawn ? (
                  <p className="empty">{drawNote(game, competition, stages, stage.round)}</p>
                ) : (
                  <ul className="cup__ties">
                    {stage.ties.map((tie) => (
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
                )}
                {/* The byes are the reason a round can be smaller than the field
                    it was drawn from, so they are stated rather than left to be
                    worked out from a tie count. */}
                {stage.byes > 0 && (
                  <p className="muted small">
                    {stage.byes} club{stage.byes === 1 ? '' : 's'} sit it out on a bye into the{' '}
                    {next?.name ?? 'next round'}.
                  </p>
                )}
                {replayDate(game, stage) && (
                  <p className="muted small">
                    Waiting on a replay, moved to {formatDayMonth(replayDate(game, stage)!)}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What one round's row says about the round itself: when it is played, and how
 * many ties are in it — or how many are still to be drawn, which is the whole of
 * what is known about a round a season away.
 */
function stageWhen(stage: BracketStage): string {
  const when = stage.date ? formatDayMonth(stage.date) : 'No date yet';
  const ties = stage.undrawn ? stage.entrants / 2 : stage.ties.length;
  return `${when} · ${ties} tie${ties === 1 ? '' : 's'}${stage.undrawn ? ' to be drawn' : ''}${stage.complete ? ' · settled' : ''}`;
}

/**
 * The date a postponed tie in this round has been moved to.
 *
 * A round that is waiting on a replay says so, and says when: otherwise a round
 * stuck on "4 ties" looks like the simulation has simply forgotten the fourth
 * game rather than that it was moved to another night.
 */
function replayDate(game: GameState, stage: BracketStage): ISODate | null {
  if (stage.complete || stage.undrawn) return null;
  const postponed = stage.ties.find((tie) => isPostponed(tie) && tie.replacedByMatchId);
  return postponed?.replacedByMatchId ? (game.matches[postponed.replacedByMatchId]?.date ?? null) : null;
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
function clubsLeft(competition: Competition, stages: readonly BracketStage[]): number {
  const gone = new Set<ClubId>();
  for (const stage of stages) {
    for (const tie of stage.ties) {
      const winner = winnerOf(tie);
      if (!winner) continue;
      gone.add(winner === tie.homeClubId ? tie.awayClubId : tie.homeClubId);
    }
  }
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
function lastTieOf(stages: readonly BracketStage[], clubId: ClubId): Match | undefined {
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const tie = stages[index]!.ties.find(
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
