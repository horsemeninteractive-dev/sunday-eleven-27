import type { ReactNode } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import type { ViewId } from '@/state/gameStore';
import { formatDate, formatShortDate } from '@/simulation/calendar';
import {
  currentMatchday,
  formOf,
  leaguePosition,
  matchOpponent,
  matchVenueLabel,
  squadOf,
  squadAvailability,
  standings,
  recentMatches,
} from '@/simulation/queries';
import { sessionForecast } from '@/simulation/training/plan';
import { sessionRecordedFor } from '@/simulation/training/store';
import { matchdaysPlayed } from '@/simulation/timeline';
import { kitDecisionOutstanding } from '../kit';
import { validateLineup } from '@/simulation/selection';
import { moneyShort } from '../format';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { runCommand, useCommandState } from '../commandActions';
import { isScreenIntent } from '../commandState';
import { Button, FormPips, PageHeader, Pill } from '../components/primitives';
import { ClubLink, CompetitionLink } from '../components/Links';
import { ActionTile, FixtureTile, MetricTile, NewsTile, Section, Tile, TileGrid } from '../components/hierarchy';

/**
 * Home: the command centre.
 *
 * Read in a glance, then act. The header says who we are and what the situation
 * is; the next match is the one thing on the screen the manager is here to deal
 * with; four tiles answer the obvious questions — squad, training, league,
 * money — and nothing else is allowed above the fold. Results and news are
 * below, and every deeper thing (the full table, the ledger, the roster) is a
 * door rather than a wall of numbers.
 */
export function DashboardView() {
  const game = useGame();
  const command = useCommandState();
  const next = useNextFixture();
  if (!game || !command) return null;

  const club = game.clubs[game.userClubId]!;
  const position = leaguePosition(game, club.id);
  const table = standings(game);
  const row = table.find((entry) => entry.clubId === club.id);
  const breakdown = squadAvailability(game, club.id);
  const squad = squadOf(game, club.id);
  const matchday = Math.min(currentMatchday(game), Math.max(game.season.calendar.length, 1));
  const concerns = concernsFor(game, matchday);
  const results = recentMatches(game, club.id, 4);
  const forecast = sessionForecast(game, club.id);
  const trainingDone = sessionRecordedFor(game, club.id, matchday);
  const weeklyIn = club.squadIds.length * club.finances.subscriptionPerPlayer + club.finances.sponsorIncomePerWeek;
  const weeklyOut = club.finances.weeklyGroundCost + club.finances.insurancePerWeek + club.finances.trainingCostPerWeek;
  const net = weeklyIn - weeklyOut;
  const weeksLeft = game.season.calendar.length - matchdaysPlayed(game);

  const opponentId = next ? matchOpponent(next, club.id) : null;
  const opponent = opponentId ? game.clubs[opponentId] : null;
  const venue = next ? matchVenueLabel(next, club.id) : null;
  const selectionProblems = next ? selectionErrors(game, next, club.id) : [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title={club.identity.name}
        subtitle={command.lines.filter(Boolean).join(' · ')}
        meta={
          <>
            <span className="small muted">{formatDate(game.date)}</span>
            <span className="small muted">
              {game.season.label} · matchday {matchday} of {Math.max(game.season.calendar.length, 1)}
            </span>
            <FormPips form={formOf(game, club.id)} />
          </>
        }
        actions={
          <div className="row row--wrap row--tight">
            {navigable(command).map((action) => (
              <Button
                key={action.label}
                variant={action.variant === 'quiet' ? 'ghost' : 'default'}
                size="sm"
                title={action.hint}
                onClick={() => runCommand(action.intent)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        }
      />

      <Section title="Next match">
        {next && opponent ? (
          <TileGrid min={215}>
            <Tile level="primary" label="Kick-off">
              <span className="next-match__club">
                {venue === 'Home' ? (
                  <>
                    <ClubLink clubId={club.id}>{club.identity.shortName}</ClubLink>
                    <span className="muted">v</span>
                    <ClubLink clubId={opponent.id}>{opponent.identity.name}</ClubLink>
                  </>
                ) : (
                  <>
                    <ClubLink clubId={opponent.id}>{opponent.identity.name}</ClubLink>
                    <span className="muted">v</span>
                    <ClubLink clubId={club.id}>{club.identity.shortName}</ClubLink>
                  </>
                )}
              </span>
              <span className="tile__meta">
                <Pill tone={venue === 'Home' ? 'accent' : 'muted'}>{venue === 'Home' ? 'HOME' : 'AWAY'}</Pill>
                <span className="muted small">
                  {formatShortDate(next.date)} · <CompetitionLink>{next.competitionName}</CompetitionLink>
                </span>
              </span>
            </Tile>

            <MetricTile
              label="Availability"
              value={`${breakdown.available.length} available`}
              note={`${breakdown.doubtful.length} doubtful · ${breakdown.unavailable.length} out`}
              tone={breakdown.available.length < 14 ? 'warn' : 'ok'}
            />

            <ActionTile
              label="Selection"
              title="Pick the team"
              meta={
                selectionProblems.length > 0
                  ? `${selectionProblems.length} problem${selectionProblems.length === 1 ? '' : 's'} to fix`
                  : `${breakdown.available.length} of ${squad.length} in contention`
              }
              tone={selectionProblems.length > 0 ? 'bad' : 'accent'}
              primary
              onClick={() => gameActions().setView('team')}
            />
          </TileGrid>
        ) : (
          <Tile label="Next match">
            <span className="tone tone--muted">No fixture scheduled.</span>
          </Tile>
        )}
      </Section>

      <TileGrid min={190}>
        <MetricTile
          label="Squad"
          value={`${breakdown.available.length} available`}
          note={`${breakdown.doubtful.length} doubtful · ${breakdown.unavailable.length} out of ${squad.length}`}
          tone={breakdown.unavailable.length > 3 ? 'warn' : 'default'}
        />
        <MetricTile
          label="Training"
          value={trainingDone ? 'Complete' : `${forecast.minutes} min`}
          note={
            trainingDone
              ? `${formatShortDate(forecast.date)} · session run`
              : `${formatShortDate(forecast.date)} · ${forecast.attendance.attending.length} attending`
          }
          tone={trainingDone ? 'ok' : forecast.attendance.attending.length < 11 ? 'warn' : 'default'}
        />
        <MetricTile
          label="League"
          value={position ? `${position}${suffix(position)}` : '—'}
          note={row ? `${row.points} pts from ${row.played} played` : 'Not started'}
          tone="default"
        />
        <MetricTile
          label="Finances"
          value={moneyShort(club.finances.balance)}
          note={`${net >= 0 ? '+' : ''}${moneyShort(net)} a week · ${weeksLeft} left`}
          tone={club.finances.balance < 0 ? 'bad' : club.finances.balance < 120 ? 'warn' : 'ok'}
        />
      </TileGrid>

      {concerns.length > 0 && (
        <Section title="Worth dealing with">
          <TileGrid min={230}>
            {concerns.map((concern) => (
              <ActionTile
                key={concern.id}
                label={concern.tone === 'bad' ? 'Action needed' : concern.tone === 'warn' ? 'Worth a look' : 'For information'}
                title={concern.title}
                meta={concern.detail}
                tone={concern.tone === 'info' ? 'default' : concern.tone}
                onClick={concern.action ? () => gameActions().setView(concern.action!.view) : undefined}
              />
            ))}
          </TileGrid>
        </Section>
      )}

      <Section
        title="Recent results"
        action={
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('fixtures')}>
            All fixtures
          </Button>
        }
      >
        {results.length > 0 ? (
          <TileGrid min={200}>
            {results.map((match) => (
              <FixtureTile
                key={match.id}
                date={formatShortDate(match.date)}
                opponent={<ClubLink clubId={matchOpponent(match, club.id)}>{game.clubs[matchOpponent(match, club.id)]?.identity.shortName}</ClubLink>}
                venue={matchVenueLabel(match, club.id) === 'Home' ? 'H' : 'A'}
                outcome={outcomeFor(match, club.id)}
                score={scoreFor(match, club.id)}
                action="Report"
                onAction={() => gameActions().setView('fixtures')}
              />
            ))}
          </TileGrid>
        ) : (
          <Tile>
            <span className="tone tone--muted">No matches played yet this season.</span>
          </Tile>
        )}
      </Section>

      <Section
        title="Around the club"
        action={
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('news')}>
            All news
          </Button>
        }
      >
        {game.news.length === 0 ? (
          <Tile>
            <span className="tone tone--muted">Nothing to report yet.</span>
          </Tile>
        ) : (
          <TileGrid min={260}>
            {game.news.slice(0, 3).map((item) => (
              <NewsTile
                key={item.id}
                category={item.category}
                headline={item.headline}
                summary={item.body}
                date={formatShortDate(item.date)}
                tone={item.category === 'Squad' ? 'accent' : item.importance === 3 ? 'warn' : 'default'}
                onClick={() => gameActions().setView('news')}
              />
            ))}
          </TileGrid>
        )}
      </Section>
    </div>
  );
}

/** Only the doors. Anything that moves the game on lives in the command bar. */
function navigable(command: ReturnType<typeof useCommandState>) {
  if (!command) return [];
  return command.secondary.filter((action) => isScreenIntent(action.intent));
}

function outcomeFor(match: Match, clubId: string): 'W' | 'D' | 'L' {
  const home = match.homeClubId === clubId;
  const mine = home ? match.result!.homeGoals : match.result!.awayGoals;
  const theirs = home ? match.result!.awayGoals : match.result!.homeGoals;
  return mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
}

function scoreFor(match: Match, clubId: string): ReactNode {
  const home = match.homeClubId === clubId;
  const mine = home ? match.result!.homeGoals : match.result!.awayGoals;
  const theirs = home ? match.result!.awayGoals : match.result!.homeGoals;
  return `${mine}–${theirs}`;
}

/** The illegal-lineup problems, so the selection tile can say so without opening it. */
function selectionErrors(game: GameState, match: Match, clubId: string): string[] {
  const lineup = match.homeClubId === clubId ? match.lineups.home : match.lineups.away;
  return validateLineup(lineup.starting, lineup.bench, (id) => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  })
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message);
}

interface Concern {
  id: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  detail: string;
  action?: { label: string; view: ViewId };
}

/**
 * What is genuinely worth a decision. If nothing is wrong, the section does not
 * appear: an empty "no concerns" card is worse than no card.
 */
function concernsFor(game: GameState, matchday: number): Concern[] {
  const club = game.clubs[game.userClubId]!;
  const concerns: Concern[] = [];
  const breakdown = squadAvailability(game, club.id);
  const squad = squadOf(game, club.id);

  // The shirts. A club picks its strip once, in pre-season, when the new ones
  // turn up, and then does not think about it again for a year — so the prompt
  // belongs here, in the weeks it matters, rather than as a permanent item in
  // the sidebar that a manager learns to ignore.
  if (kitDecisionOutstanding(game, club.id)) {
    concerns.push({
      id: 'kit',
      tone: 'info',
      title: 'New kit for the season',
      detail: 'This summer’s shirts have arrived. Pick the one the club runs out in before the league starts.',
      action: { label: 'Pick the kit', view: 'kit' },
    });
  }

  if (breakdown.unavailable.length > 0) {
    const names = breakdown.unavailable.slice(0, 3).map((player) => player.surname).join(', ');
    concerns.push({
      id: 'unavailable',
      tone: breakdown.unavailable.length > 3 ? 'warn' : 'info',
      title:
        breakdown.unavailable.length === 1
          ? `${breakdown.unavailable[0]!.firstName} ${breakdown.unavailable[0]!.surname} is out`
          : `${breakdown.unavailable.length} players unavailable`,
      detail: `${names}${breakdown.unavailable.length > 3 ? ` and ${breakdown.unavailable.length - 3} more` : ''}`,
      action: { label: 'Squad', view: 'squad' },
    });
  }

  const match = Object.values(game.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      !candidate.played &&
      (candidate.homeClubId === club.id || candidate.awayClubId === club.id),
  );
  if (match) {
    const lineup = match.homeClubId === club.id ? match.lineups.home : match.lineups.away;
    if (lineup.starting.some((slot) => !slot.playerId)) {
      concerns.push({
        id: 'selection',
        tone: 'bad',
        title: 'The team is not picked',
        detail: 'Pick the XI before the referee calls time.',
        action: { label: 'Pick the team', view: 'team' },
      });
    }
  }

  if (!sessionRecordedFor(game, club.id, matchday)) {
    const forecast = sessionForecast(game, club.id);
    if (forecast.attendance.attending.length < 11) {
      concerns.push({
        id: 'attendance',
        tone: 'warn',
        title: `Only ${forecast.attendance.attending.length} expected at training`,
        detail: 'Work, kids and bad knees. The session will be thin.',
        action: { label: 'Training', view: 'training' },
      });
    }
  }

  if (club.finances.balance < 0) {
    concerns.push({
      id: 'balance',
      tone: 'bad',
      title: 'The club is in the red',
      detail: `${moneyShort(club.finances.balance)} in the account. Referees still want paying.`,
      action: { label: 'Finances', view: 'finances' },
    });
  } else if (club.finances.balance < 120) {
    concerns.push({
      id: 'balance-low',
      tone: 'warn',
      title: 'Money is tight',
      detail: `${moneyShort(club.finances.balance)} left.`,
      action: { label: 'Finances', view: 'finances' },
    });
  }

  const unhappy = squad.filter((player) => player.morale < 35);
  if (unhappy.length > 0) {
    concerns.push({
      id: 'morale',
      tone: 'warn',
      title: unhappy.length === 1 ? `${unhappy[0]!.surname} is not happy` : `${unhappy.length} players are not happy`,
      detail: 'Morale decides who turns up and how they play.',
      action: { label: 'Squad', view: 'squad' },
    });
  }

  return concerns.slice(0, 4);
}

function suffix(position: number): string {
  const remainder = position % 100;
  if (remainder >= 11 && remainder <= 13) return 'th';
  switch (position % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
