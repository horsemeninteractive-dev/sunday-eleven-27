import type { ReactNode } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { isPlayer } from '@/domain/person';
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
import { leagueMatchdayCount } from '@/simulation/timeline';
import { seasonOutlook } from '@/simulation/treasurer';
import { ordinal } from '@/simulation/news';
import { validateLineup } from '@/simulation/selection';
import { HOME_MATTER_LIMIT, clubMatters } from '../clubMatters';
import { moneyShort } from '../format';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { openMatter, runCommand, useCommandState } from '../commandActions';
import { isScreenIntent } from '../commandState';
import { Button, FormPips, PageHeader } from '../components/primitives';
import { ClubLink } from '../components/Links';
import { FixtureCard } from '../components/FixtureCard';
import { ClubBadge } from '../components/Badge';
import { openMatchReport } from '../reportActions';
import { AdaptivePanels } from '../components/AdaptivePanels';
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
  const matchdays = leagueMatchdayCount(game);
  const matchday = Math.min(currentMatchday(game), matchdays);
  // What needs the manager, worked out by the one model the Club screen uses as
  // well. Home shows the first few and offers the rest, so the two screens can
  // never disagree about what matters.
  const matters = clubMatters(game, HOME_MATTER_LIMIT);
  const moreMatters = clubMatters(game, 0).length > matters.length;
  const results = recentMatches(game, club.id, 4);
  const forecast = sessionForecast(game, club.id);
  const trainingDone = sessionRecordedFor(game, club.id, matchday);
  // The week and how many of them are left, read together: subs are a matchday
  // liability now, so the recurring income is the sponsor's agreement, and the
  // weeks are calendar weeks because the costs come round whether or not anybody
  // plays. Read through the treasurer's own outlook so the tile here and the
  // Finances screen can never disagree about where the money is going.
  const outlook = seasonOutlook(game, club.id);
  const net = outlook.weeklyNet;

  const opponentId = next ? matchOpponent(next, club.id) : null;
  const opponent = opponentId ? game.clubs[opponentId] : null;
  const selectionProblems = next ? selectionErrors(game, next, club.id) : [];

  return (
    <div className="stack">
      <PageHeader
        eyebrow={`${game.season.label} · ${command.eyebrow}`}
        title={<span className="person-identity"><ClubBadge club={club} size={40} />{club.identity.name}</span>}
        subtitle={command.title}
        meta={
          <>
            <span className="small muted">{formatDate(game.date)}</span>
            <span className="small muted">
              {game.season.label} · matchday {matchday} of {matchdays}
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
          <FixtureCard state={game} match={next} actions={<>
            <span className={`small ${selectionProblems.length ? 'tone tone--warn' : 'muted'}`}>{selectionProblems.length ? `${selectionProblems.length} selection problems` : 'Selection ready'}</span>
            <Button variant="primary" onClick={() => gameActions().setView('team')}>Pick the team</Button>
            <Button variant="ghost" onClick={() => gameActions().openPlanner()}>The week ahead</Button>
          </>} />
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
          value={position ? ordinal(position) : '—'}
          note={row ? `${row.points} pts from ${row.played} played` : 'Not started'}
          tone="default"
        />
        <MetricTile
          label="Finances"
          value={moneyShort(club.finances.balance)}
          note={`${net >= 0 ? '+' : ''}${moneyShort(net)} a week · heading for ${moneyShort(outlook.projected)}`}
          tone={club.finances.balance < 0 ? 'bad' : outlook.projected < 120 ? 'warn' : 'ok'}
        />
      </TileGrid>

      <AdaptivePanels name="home" panels={[
        { id: 'decisions', label: 'Club decisions', wide: true, content: <Section
          title="Worth dealing with"
          action={
            moreMatters ? (
              <Button variant="ghost" size="sm" onClick={() => gameActions().setView('club')}>
                More at the club
              </Button>
            ) : undefined
          }
        >
          {matters.length === 0 && <p className="empty">Nothing needs your attention right now.</p>}
          <TileGrid min={230} className="diary-decisions">
            {matters.map((matter) => (
              <ActionTile
                key={matter.id}
                label={matter.label}
                title={matter.title}
                meta={matter.detail}
                tone={matter.tone}
                onClick={matter.destination ? () => openMatter(matter.destination) : undefined}
                disabled={!matter.destination}
              />
            ))}
          </TileGrid>
        </Section> },
        { id: 'results', label: 'Recent results', content: <Section
        title="Recent results"
        action={
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('fixtures')}>
            All fixtures
          </Button>
        }
      >
        {results.length > 0 ? (
          <TileGrid min={200} className="diary-results">
            {results.map((match) => (
              <FixtureTile
                key={match.id}
                date={formatShortDate(match.date)}
                opponent={<ClubLink clubId={matchOpponent(match, club.id)}>{game.clubs[matchOpponent(match, club.id)]?.identity.shortName}</ClubLink>}
                venue={matchVenueLabel(match, club.id) === 'Home' ? 'H' : 'A'}
                outcome={outcomeFor(match, club.id)}
                score={scoreFor(match, club.id)}
                action="Report"
                onAction={() => openMatchReport(match.id)}
              />
            ))}
          </TileGrid>
        ) : (
          <Tile>
            <span className="tone tone--muted">No matches played yet this season.</span>
          </Tile>
        )}
      </Section> },
      { id: 'news', label: 'Club news', content: <Section
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
          <TileGrid min={260} className="diary-news">
            {game.news.slice(0, 3).map((item) => (
              <NewsTile
                key={item.id}
                category={item.category}
                headline={item.headline}

                date={formatShortDate(item.date)}
                tone={item.category === 'Squad' ? 'accent' : item.importance === 3 ? 'warn' : 'default'}
                onClick={() => gameActions().setView('news')}
              />
            ))}
          </TileGrid>
        )}
      </Section> },
      ]} />
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

