import type { ReactNode } from 'react';
import type { GameState } from '@/domain/game';
import { isPlayer } from '@/domain/person';
import type { ViewId } from '@/state/gameStore';
import { formatDate, formatDayMonth, formatShortDate } from '@/simulation/calendar';
import { currentMatchday, formOf, leaguePosition, squadOf, squadAvailability } from '@/simulation/queries';
import { validateLineup } from '@/simulation/selection';
import { sessionForecast } from '@/simulation/training/plan';
import { sessionRecordedFor } from '@/simulation/training/store';
import { moneyShort } from '../format';
import { gameActions, useGame, useStandings, useSchedule, useToday } from '../hooks';
import { runCommand, useCommandState } from '../commandActions';
import { isScreenIntent, type CommandAction } from '../commandState';
import { Button, FormPips, PageHeader, Panel, Pill, Stat } from '../components/primitives';
import { ClubLink, CompetitionLink, PlayerLink } from '../components/Links';

/**
 * The overview.
 *
 * It answers four questions and then gets out of the way: where we are, what
 * matters now, what it means, and what just happened. It never advances the
 * game itself — moving time on, running the session and playing the match are
 * the command bar's job, and the calendar's. Everything here is a door to a
 * screen, so there is exactly one Continue button in the game.
 */
export function DashboardView() {
  const game = useGame();
  const standings = useStandings();
  const command = useCommandState();
  if (!game || !command) return null;

  const club = game.clubs[game.userClubId]!;
  const position = leaguePosition(game, club.id);
  const row = standings.find((entry) => entry.clubId === club.id);
  const breakdown = squadAvailability(game, club.id);
  const squad = squadOf(game, club.id);
  const matchday = Math.min(currentMatchday(game), Math.max(game.season.calendar.length, 1));
  const concerns = concernsFor(game, matchday);
  const recent = recentResult(game);
  const today = useToday();
  const schedule = useSchedule();

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Overview"
        subtitle={`${club.identity.nickname} · ${game.world.regionName}, ${game.world.countyName}`}
        meta={
          <>
            <span className="small muted">{formatDate(game.date)}</span>
            <span className="small muted">
              {game.season.label} · matchday {matchday} of {Math.max(game.season.calendar.length, 1)}
            </span>
            <span className="small muted">
              {availabilityLabel(breakdown.available.length, breakdown.doubtful.length, breakdown.unavailable.length, squad.length)}
            </span>
          </>
        }
      />

      <Panel level="primary">
        <div className="hero">
          <div>
            <p className="hero__eyebrow">{command.eyebrow}</p>
            <h2 className="hero__title">
              {command.titleClubId ? (
                <ClubLink clubId={command.titleClubId}>{command.title}</ClubLink>
              ) : (
                command.title
              )}
            </h2>
            <p className="hero__lines">{command.lines.filter(Boolean).join(' · ')}</p>
            {command.detail && <p className="hero__detail">{command.detail}</p>}
            {navigable(command.secondary).length > 0 && (
              <div className="hero__actions">
                {navigable(command.secondary).map((action) => (
                  <Button
                    key={action.label}
                    variant={action.variant === 'quiet' ? 'ghost' : 'default'}
                    size="md"
                    title={action.hint}
                    onClick={() => runCommand(action.intent)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="hero__facts">
            <HeroFact
              label="Available"
              value={`${breakdown.available.length}/${squad.length}`}
              note={`${breakdown.doubtful.length} doubtful · ${breakdown.unavailable.length} out`}
            />
            <HeroFact
              label="League"
              value={position ? `${position}${suffix(position)}` : '—'}
              note={`${row?.points ?? 0} points from ${row?.played ?? 0}`}
            />
            <HeroFact label="Form" value={<FormPips form={formOf(game, club.id)} />} note="Last five in the league" />
            <HeroFact
              label="In the bank"
              value={moneyShort(club.finances.balance)}
              note="Subs, sponsorship, pitches, referees"
            />
          </div>
        </div>
      </Panel>

      <Panel
        level="quiet"
        title={`Today · ${formatDate(game.date)}`}
        subtitle="The world moves one day at a time. This is what is on yours."
        actions={
          <Button variant="ghost" size="sm" onClick={() => runCommand({ kind: 'action', action: 'open-planner' })}>
            The calendar
          </Button>
        }
      >
        {today.length === 0 && schedule.length === 0 && (
          <p className="empty">Nothing on today, and nothing on the horizon. A rare thing in a Sunday league.</p>
        )}
        {today.length === 0 && schedule.length > 0 && (
          <p className="small muted">Nothing on today. Next up: {schedule[0]!.title} on {formatShortDate(schedule[0]!.date)}.</p>
        )}
        <ul className="tight-list">
          {today.map((entry) => (
            <li key={entry.id} className={`schedule-row schedule-row--${entry.priority}`}>
              <span className="schedule-row__time">{entry.time ?? '—'}</span>
              <span>
                <strong>{entry.title}</strong>
                <div className="muted small">{entry.detail}</div>
              </span>
              {entry.resolvedOn && <Pill tone="muted">Done</Pill>}
            </li>
          ))}
        </ul>
        {schedule.length > 1 && (
          <details className="more">
            <summary className="small muted">Coming up</summary>
            <ul className="tight-list">
              {schedule
                .filter((entry) => entry.date > game.date)
                .slice(0, 5)
                .map((entry) => (
                  <li key={entry.id} className={`schedule-row schedule-row--${entry.priority}`}>
                    <span className="schedule-row__time">{formatShortDate(entry.date)}</span>
                    <span>
                      <strong>{entry.title}</strong>
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </Panel>

      {concerns.length > 0 && (
        <Panel title="Worth dealing with" subtitle="Only what actually needs a decision this week">
          <ul className="concerns">
            {concerns.map((concern) => (
              <li key={concern.id} className={`concern concern--${concern.tone}`}>
                <div className="concern__body">
                  <strong className="concern__title">{concern.title}</strong>
                  <div className="small muted">{concern.detail}</div>
                </div>
                {concern.action && (
                  <div className="concern__action">
                    <Button
                      variant={concern.tone === 'bad' ? 'primary' : 'default'}
                      size="sm"
                      onClick={() => gameActions().setView(concern.action!.view)}
                    >
                      {concern.action.label}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flow">
        <div className="flow__col">
          {recent ? (
            <Panel
              level="default"
              title="Last time out"
              subtitle={
                <>
                  {formatShortDate(recent.match.date)} · {recent.isHome ? 'home' : 'away'} ·{' '}
                  <CompetitionLink>{recent.match.competitionName}</CompetitionLink>
                </>
              }
              actions={
                <Button variant="ghost" size="sm" onClick={() => gameActions().setView('fixtures')}>
                  Match report
                </Button>
              }
            >
              <p className="scoreline">
                <span className={recent.isHome ? 'scoreline--mine' : undefined}>
                  <ClubLink clubId={recent.match.homeClubId}>
                    {game.clubs[recent.match.homeClubId]!.identity.shortName}
                  </ClubLink>
                </span>{' '}
                <strong>
                  {recent.match.result!.homeGoals} — {recent.match.result!.awayGoals}
                </strong>{' '}
                <span className={recent.isHome ? undefined : 'scoreline--mine'}>
                  <ClubLink clubId={recent.match.awayClubId}>
                    {game.clubs[recent.match.awayClubId]!.identity.shortName}
                  </ClubLink>
                </span>
              </p>
              <p className="small muted">
                {recent.verdict} · {recent.match.result!.attendance} watching at{' '}
                {game.world.grounds[recent.match.groundId]?.name ?? 'the ground'}
              </p>
              <ul className="tight-list">
                {recent.match.events
                  .filter((event) => event.type === 'goal' || event.type === 'red-card')
                  .slice(0, 5)
                  .map((event) => (
                    <li key={event.id}>
                      <span className="muted small">{event.minute}&#39;</span> {event.text}
                    </li>
                  ))}
              </ul>
            </Panel>
          ) : (
            <Panel level="quiet" title="Last time out">
              <p className="empty">No matches played yet this season.</p>
            </Panel>
          )}

          <Panel
            level="default"
            title="Around the club"
            subtitle="What the local game is saying"
            actions={
              <Button variant="ghost" size="sm" onClick={() => gameActions().setView('news')}>
                All news
              </Button>
            }
          >
            {game.news.length === 0 && <p className="empty">Nothing to report yet.</p>}
            {/* Three, not five: the panel has to sit beside its neighbours in a
                packed column, and the other two would only lengthen the page. */}
            <ul className="news">
              {game.news.slice(0, 3).map((item) => (
                <li key={item.id} className={`news__item news__item--${item.importance}`}>
                  <div className="news__head">
                    <Pill tone={item.category === 'Squad' ? 'accent' : 'muted'}>{item.category}</Pill>
                    <span className="muted small">{formatDayMonth(item.date)}</span>
                  </div>
                  <strong>{item.headline}</strong>
                  <p className="small muted">{item.body}</p>
                  {(item.clubIds.length > 0 || item.personIds.length > 0) && (
                    <div className="row row--wrap">
                      {item.clubIds.slice(0, 2).map((clubId) => (
                        <ClubLink key={clubId} clubId={clubId} />
                      ))}
                      {item.personIds.slice(0, 2).map((personId) => (
                        <PlayerLink key={personId} personId={personId} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="flow__col">
          <Panel
            level="quiet"
            title="Where we are"
            actions={
              <Button variant="ghost" size="sm" onClick={() => gameActions().setView('league')}>
                Full table
              </Button>
            }
          >
            {row ? (
              <>
                <div className="stat-grid stat-grid--wide">
                  <Stat label="Position" value={position ? `${position}${suffix(position)}` : '—'} />
                  <Stat label="Played" value={row.played} />
                  <Stat label="Points" value={row.points} />
                  <Stat
                    label="Goal difference"
                    value={row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                  />
                </div>
                <ul className="tight-list">
                  {nearbyRows(standings, club.id).map(({ entry, index }) => (
                    <li
                      key={entry.clubId}
                      className={`rating-row${entry.clubId === club.id ? ' rating-row--mine' : ''}`}
                    >
                      <span>
                        <span className="muted small num">{index + 1}.</span>{' '}
                        <ClubLink clubId={entry.clubId}>{game.clubs[entry.clubId]?.identity.shortName}</ClubLink>
                      </span>
                      <span className="muted small num">{entry.played}</span>
                      <strong className="num">{entry.points}</strong>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty">The season has not started yet.</p>
            )}
          </Panel>

          <Panel
            level="quiet"
            title="The squad at a glance"
            actions={
              <Button variant="ghost" size="sm" onClick={() => gameActions().setView('squad')}>
                Squad
              </Button>
            }
          >
            <div className="stat-grid stat-grid--wide">
              <Stat label="Registered" value={squad.length} />
              <Stat label="In contention" value={breakdown.available.length} tone={breakdown.available.length < 14 ? 'warn' : undefined} />
              <Stat label="Doubtful" value={breakdown.doubtful.length} tone={breakdown.doubtful.length > 0 ? 'warn' : undefined} />
              <Stat label="Out" value={breakdown.unavailable.length} tone={breakdown.unavailable.length > 3 ? 'bad' : undefined} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * Only the doors. Anything that would move the game on — Continue, running the
 * session, playing the match — is left to the command bar, so the overview can
 * never be a second Continue button.
 */
function navigable(actions: CommandAction[]): CommandAction[] {
  return actions.filter((action) => isScreenIntent(action.intent));
}

function HeroFact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="hero__fact">
      <span className="hero__fact-label">{label}</span>
      <span className="hero__fact-value">{value}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

interface Concern {
  id: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  detail: string;
  action?: { label: string; view: ViewId };
}

/**
 * What is genuinely worth a decision. If nothing is wrong, the panel does not
 * appear: an empty "no concerns" card is worse than no card.
 */
function concernsFor(game: GameState, matchday: number): Concern[] {
  const club = game.clubs[game.userClubId]!;
  const concerns: Concern[] = [];
  const breakdown = squadAvailability(game, club.id);
  const squad = squadOf(game, club.id);

  if (breakdown.unavailable.length > 0) {
    const names = breakdown.unavailable.slice(0, 3).map((player) => player.surname).join(', ');
    concerns.push({
      id: 'unavailable',
      tone: breakdown.unavailable.length > 3 ? 'warn' : 'info',
      title:
        breakdown.unavailable.length === 1
          ? `${breakdown.unavailable[0]!.firstName} ${breakdown.unavailable[0]!.surname} is out`
          : `${breakdown.unavailable.length} players unavailable`,
      detail: `${names}${breakdown.unavailable.length > 3 ? ` and ${breakdown.unavailable.length - 3} more` : ''} — see who is left.`,
      action: { label: 'Squad', view: 'squad' },
    });
  }

  // Pre-season is when the new shirts turn up, so the kit is offered while
  // there is still a summer to wear them in — and it stops offering itself the
  // moment the league starts.
  const firstLeagueDate = game.season.calendar[0]?.date;
  if (firstLeagueDate && game.date <= firstLeagueDate) {
    concerns.push({
      id: 'kit',
      tone: 'info',
      title: 'The new kit has arrived',
      detail: 'Three designs were sent down this summer. Pick the one the club runs out in before the league starts.',
      action: { label: 'The kit', view: 'kit' },
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
    const errors = validateLineup(lineup.starting, lineup.bench, (id) => {
      const person = game.people[id];
      return isPlayer(person) ? person : undefined;
    }).filter((problem) => problem.severity === 'error');
    if (errors.length > 0) {
      concerns.push({
        id: 'selection',
        tone: 'bad',
        title: errors.length === 1 ? 'The team is not legal' : `${errors.length} problems with the selection`,
        detail: errors[0]!.message,
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
        detail: 'Work, kids and bad knees. The session will still happen — it will just be thin.',
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
      detail: `${moneyShort(club.finances.balance)} left. A pitch hire and a referee will eat most of that.`,
      action: { label: 'Finances', view: 'finances' },
    });
  }

  const unhappy = squad.filter((player) => player.morale < 35);
  if (unhappy.length > 0) {
    concerns.push({
      id: 'morale',
      tone: 'warn',
      title: unhappy.length === 1 ? `${unhappy[0]!.surname} is not happy` : `${unhappy.length} players are not happy`,
      detail: 'Morale affects who turns up to training and how they play.',
      action: { label: 'Squad', view: 'squad' },
    });
  }

  return concerns.slice(0, 4);
}

function recentResult(game: GameState) {
  const club = game.clubs[game.userClubId]!;
  const match = game.lastMatchId ? game.matches[game.lastMatchId] : undefined;
  if (!match || !match.played || !match.result) return null;
  if (match.homeClubId !== club.id && match.awayClubId !== club.id) return null;
  const isHome = match.homeClubId === club.id;
  const mine = isHome ? match.result.homeGoals : match.result.awayGoals;
  const theirs = isHome ? match.result.awayGoals : match.result.homeGoals;
  return {
    match,
    isHome,
    verdict: mine > theirs ? 'Won' : mine === theirs ? 'Drew' : 'Lost',
  };
}

function nearbyRows<T extends { clubId: string }>(standings: T[], clubId: string) {
  const ourIndex = standings.findIndex((entry) => entry.clubId === clubId);
  return standings.map((entry, index) => ({ entry, index })).filter(({ index }) => Math.abs(index - ourIndex) <= 2);
}

function availabilityLabel(available: number, doubtful: number, unavailable: number, total: number): string {
  return `${available} of ${total} available${doubtful > 0 ? ` · ${doubtful} doubtful` : ''}${
    unavailable > 0 ? ` · ${unavailable} out` : ''
  }`;
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
