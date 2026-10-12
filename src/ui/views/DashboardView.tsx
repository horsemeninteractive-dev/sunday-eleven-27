import type { ReactNode } from 'react';
import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import { formatShortDate } from '@/simulation/calendar';
import {
  currentMatchday,
  leaguePosition,
  matchOpponent,
  recentMatches,
  squadOf,
  squadAvailability,
  standings,
} from '@/simulation/queries';
import { sessionForecast } from '@/simulation/training/plan';
import { sessionRecordedFor } from '@/simulation/training/store';
import { leagueMatchdayCount } from '@/simulation/timeline';
import { seasonOutlook } from '@/simulation/treasurer';
import { ordinal } from '@/simulation/news';
import { validateLineup } from '@/simulation/selection';
import { plannerDays } from '@/simulation/planner';
import { managingClubId } from '@/simulation/career';
import type { ClubMatter } from '../clubMatters';
import { homeBriefing, matterActionLabel, waitingLine } from '../homeBriefing';
import { labelForStory } from '../newsStory';
import { moneyShort } from '../format';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { openMatter } from '../commandActions';
import { Button, FormPips } from '../components/primitives';
import { ClubLink } from '../components/Links';
import { ClubBadge } from '../components/Badge';
import { Glyph } from '../components/icons';
import { Portrait } from '../components/Portrait';
import { FixtureCard } from '../components/FixtureCard';
import { openMatchReport } from '../reportActions';
import { AdaptivePanels } from '../components/AdaptivePanels';
import { WeekStrip } from '../components/WeekStrip';
import { ActionTile, MetricTile, NewsTile, Section, Tile, TileGrid } from '../components/hierarchy';

/**
 * Home: the manager's own desk.
 *
 * It is read in the order a manager arrives at it, and the three questions are
 * the layout:
 *
 *   1. **Where am I?** The week strip says how long there is, and the club band
 *      underneath says who this is — the crest, the ground, the town, the motto
 *      the club was founded with, and the man in charge of it — because a
 *      manager's first question is not a number, it is the place he is standing.
 *   2. **What is next?** The next fixture is the one thing on the screen that is
 *      printed rather than summarised: the same fixture sheet the Fixtures screen
 *      and the match report use, with the selection read off it so he knows
 *      whether it is ready, and the two doors that matter — pick the team, or
 *      look at the week.
 *   3. **What needs me?** One genuine decision in front, in its own band with a
 *      button that says what pressing it does; the rest of the model's list as
 *      ruled rows underneath. The mail that is not asking for anything is a line
 *      rather than a card, which is the whole difference between the two.
 *
 * The numbers are last and deliberately dull: one ruled strip of four facts, each
 * a door, under everything that is happening. Nothing on this screen decides what
 * matters — `clubMatters` does, and Home and the Club screen both read it, so the
 * two cannot disagree.
 *
 * Everything the screen says is read out of the save. There is no photograph of a
 * player, no invented fixture, no statistic the game has not produced, and no
 * urgency that the club's own systems have not expressed: a club with nothing on
 * its plate gets a band that says so rather than three filler cards.
 */

/** How many results the form strip shows. A run, not a season. */
const FORM = 5;

export function DashboardView() {
  const game = useGame();
  const next = useNextFixture();
  if (!game) return null;

  // The club he actually manages, asked the way `career.ts` says every
  // user-gated system should ask it: a save with no career store answers with
  // `userClubId`, and a manager between jobs answers with nothing — and a man out
  // of work must never be shown the dashboard of the club he left. The shell has
  // already drawn the job board instead of this screen (`App.tsx`); this is the
  // same rule read where the club is read.
  const clubId = managingClubId(game);
  if (!clubId) return null;
  const club = game.clubs[clubId]!;
  const position = leaguePosition(game, club.id);
  const table = standings(game);
  const row = table.find((entry) => entry.clubId === club.id);
  const breakdown = squadAvailability(game, club.id);
  const squad = squadOf(game, club.id);
  const matchdays = leagueMatchdayCount(game);
  const matchday = Math.min(currentMatchday(game), matchdays);
  const forecast = sessionForecast(game, club.id);
  const trainingDone = sessionRecordedFor(game, club.id, matchday);
  // The week and how many of them are left, read together: subs are a matchday
  // liability now, so the recurring income is the sponsor's agreement, and the
  // weeks are calendar weeks because the costs come round whether or not anybody
  // plays. Read through the treasurer's own outlook so the tile here and the
  // Finances screen can never disagree about where the money is going.
  const outlook = seasonOutlook(game, club.id);
  const net = outlook.weeklyNet;

  return (
    <div className="stack home">
      {/* The week before the fixture: a season is arranged around one game, but the
          seven days around it are what the manager actually plans. It is three
          lines tall, so it costs the fold almost nothing and saves opening the
          calendar to find out whether Thursday is already taken. */}
      <WeekStrip days={plannerDays(game)} today={game.date} />

      <ClubBand game={game} club={club} />

      <NextMatchHero game={game} next={next} />

      {/* The numbers, and only the ones a manager uses before a game: where the
          club is, who is fit, whether Thursday has been done, and what is in the
          bank. Each is a door rather than a read-out, so the strip is a way into
          the four screens it summarises rather than a wall of figures. */}
      <TileGrid min={190}>
        <MetricTile
          label="League"
          value={position ? ordinal(position) : '—'}
          note={row ? `${row.points} pts from ${row.played} played` : 'Not started'}
          tone="default"
          title="Open the league table"
          onClick={() => gameActions().setView('league')}
        >
          <FormPips form={row?.form ?? []} limit={FORM} />
        </MetricTile>
        <MetricTile
          label="Squad"
          value={`${breakdown.available.length} available`}
          note={`${breakdown.doubtful.length} doubtful · ${breakdown.unavailable.length} out of ${squad.length}`}
          tone={breakdown.unavailable.length > 3 ? 'warn' : 'default'}
          title="Open the squad"
          onClick={() => gameActions().setView('squad')}
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
          title="Open training"
          onClick={() => gameActions().setView('training')}
        />
        <MetricTile
          label="Finances"
          value={moneyShort(club.finances.balance)}
          note={`${net >= 0 ? '+' : ''}${moneyShort(net)} a week · heading for ${moneyShort(outlook.projected)}`}
          tone={club.finances.balance < 0 ? 'bad' : outlook.projected < 120 ? 'warn' : 'ok'}
          title="Open the books"
          onClick={() => gameActions().setView('finances')}
        />
      </TileGrid>

      <AdaptivePanels name="home" panels={[
        { id: 'decisions', label: 'What needs you', wide: true, content: <NeedsYou game={game} /> },
        { id: 'results', label: 'Recent results', content: <RecentForm game={game} /> },
        { id: 'news', label: 'Around the club', content: <AroundTheClub game={game} /> },
      ]} />
    </div>
  );
}

/**
 * Who this is.
 *
 * The screen had no club on it at all: it opened on a fixture between two names,
 * and the manager's own ground, nickname and motto lived on two other screens. A
 * band is not decoration — every line in it is a fact the save carries, and the
 * photograph behind it is the ground the club plays on rather than a ground. It
 * is deliberately not a page header: the week strip sits above it, which is the
 * compromise this screen already made so that the first look goes to the days, and
 * a band that names the club is not the same thing as a title block that repeats
 * the screen's name.
 *
 * What is on it is chosen for what a manager tells a stranger: who the club is,
 * what it is called by everybody, where it plays, what it says about itself, and
 * who is picking the team. The season and the man's tenure are the two facts that
 * date it.
 */
export function ClubBand({ game, club }: { game: GameState; club: Club }) {
  const manager = club.managerId ? game.people[club.managerId] : undefined;
  const town = game.world.towns[club.townId]?.name ?? null;
  const ground = game.world.grounds[club.groundId];
  // A club's history begins with the season its current manager took over, so the
  // record is the tenure; a career with no record at all is a club whose first
  // season has not been filed yet, and the season start is the honest fallback.
  const since = club.history.managers.find((entry) => entry.personId === club.managerId)?.from ?? game.season.startDate;
  const matchdays = leagueMatchdayCount(game);
  const matchday = Math.min(currentMatchday(game), matchdays);

  return (
    <section className="home-club" aria-labelledby="home-club-name">
      <span className="home-club__crest" aria-hidden="true">
        <ClubBadge club={club} size={64} />
      </span>

      <div className="home-club__text">
        <h2 id="home-club-name" className="home-club__name">
          {club.identity.name}
        </h2>
        <p className="home-club__line">
          {[club.identity.nickname, town, ground?.name].filter(Boolean).join(' · ')}
        </p>
        {club.identity.motto && <p className="home-club__motto">{club.identity.motto}</p>}
        <div className="home-club__doors">
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('club')}>
            The clubhouse
          </Button>
          <span className="small muted">
            {game.season.label} · matchday {matchday} of {matchdays}
          </span>
        </div>
      </div>

      <div className="home-club__manager">
        <span className="home-club__portrait" aria-hidden="true">
          {manager ? <Portrait person={manager} /> : <Glyph name="manager" />}
        </span>
        <span className="home-club__manager-text">
          <span className="home-club__manager-name">
            {manager ? `${manager.firstName} ${manager.surname}` : 'Nobody in the dugout'}
          </span>
          <span className="small muted">
            {manager ? `In charge since ${formatShortDate(since)}` : 'The post is vacant'}
          </span>
        </span>
      </div>
    </section>
  );
}

/**
 * The next fixture, printed rather than summarised.
 *
 * It is the shared fixture sheet — the same component the Fixtures screen and the
 * match report use, so a fixture looks like a fixture wherever the manager meets
 * it — with the state of it read off the club's own selection: whether the XI is
 * legal, and how many men he has. The two buttons are screens, never actions: the
 * command bar above owns advancing the calendar, and a second button here that
 * played the match or moved the week on would be a second place to press the same
 * thing.
 *
 * With no fixture there is nothing to print, and the honest screen says why rather
 * than showing an empty card: a season that has finished, a club between games, or
 * a calendar with nothing on it yet.
 */
export function NextMatchHero({ game, next }: { game: GameState; next: Match | null }) {
  const club = game.clubs[game.userClubId]!;
  const opponentId = next ? matchOpponent(next, club.id) : null;
  const opponent = opponentId ? game.clubs[opponentId] : null;
  const problems = next ? selectionErrors(game, next, club.id) : [];
  const available = squadAvailability(game, club.id).available.length;

  return (
    <section className="home-hero" aria-labelledby="home-next-heading">
      <h2 id="home-next-heading" className="home-hero__eyebrow">
        Next match
      </h2>
      {next && opponent ? (
        <FixtureCard
          state={game}
          match={next}
          actions={
            <>
              <span className={`small ${problems.length ? 'tone tone--warn' : 'muted'}`}>
                {problems.length
                  ? `${problems.length} selection problem${problems.length === 1 ? '' : 's'}`
                  : 'Selection ready'}{' '}
                · {available} available
              </span>
              <Button variant="primary" onClick={() => gameActions().setView('team')}>
                Pick the team
              </Button>
              <Button variant="ghost" onClick={() => gameActions().openPlanner()}>
                The week ahead
              </Button>
            </>
          }
        />
      ) : (
        <div className="home-hero__none">
          <p className="home-hero__none-title">
            {game.phase === 'complete' ? 'The season is over' : 'No fixture scheduled'}
          </p>
          <p className="small muted">
            {game.phase === 'complete'
              ? 'Promotion and relegation are settled. The new fixture list is drawn up when pre-season starts.'
              : 'Nothing is on the calendar. Every date the season has is on the fixture list.'}
          </p>
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('fixtures')}>
            The fixture list
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * What needs the manager, with one thing in front.
 *
 * `homeBriefing` decides the reading: the loudest genuine decision leads, the rest
 * of the model's list follows as rows, and the post that is not asking for
 * anything is a line at the foot. Splitting the list this way is the only reason
 * the section has a shape at all — five cards in a grid is a list of five things,
 * and a manager reads a list of five things by reading all five.
 */
export function NeedsYou({ game }: { game: GameState }) {
  const briefing = homeBriefing(game);

  return (
    <Section
      title="What needs you"
      action={
        briefing.beyond > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('club')}>
            {briefing.beyond} more at the club
          </Button>
        ) : undefined
      }
    >
      {!briefing.lead && <p className="empty">Nothing needs your attention right now.</p>}

      {briefing.lead && <LeadMatter matter={briefing.lead} />}

      {briefing.rest.length > 0 && (
        <div className="diary-decisions">
          {briefing.rest.map((matter) => (
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
        </div>
      )}

      {briefing.waiting && (
        <p className="home-waiting">
          <span className="small muted">{waitingLine(briefing.waiting)}</span>
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('inbox')}>
            Messages
          </Button>
        </p>
      )}
    </Section>
  );
}

/**
 * The one thing in front, at the size of a decision.
 *
 * It is not an `ActionTile`: a tile is a small box scanned among its peers, and
 * this is the opposite — one thing, with a button that names what pressing it
 * does. The label above it is the model's own word for how loud it is, so a
 * genuine emergency and a note from the secretary do not arrive looking alike.
 */
function LeadMatter({ matter }: { matter: ClubMatter }) {
  return (
    <div className={`home-lead home-lead--${matter.tone}`}>
      <div className="home-lead__text">
        <span className="home-lead__label">{matter.label}</span>
        <h3 className="home-lead__title">{matter.title}</h3>
        <p className="home-lead__detail">{matter.detail}</p>
      </div>
      {matter.destination && (
        <Button
          variant={matter.tone === 'info' ? 'default' : 'primary'}
          onClick={() => openMatter(matter.destination)}
        >
          {matterActionLabel(matter)}
        </Button>
      )}
    </div>
  );
}

/**
 * The last few afternoons, as a run.
 *
 * A result is a score and a mark, not a card with four labelled fields: the form
 * strip is what a manager reads in a glance and what a local paper prints, and
 * every one of them is the door into the report, so the detail is one press away
 * rather than on the page. Matches are counted from the club's own record —
 * competitive football only, played fixtures only — so a club three weeks into its
 * first season gets the honest line instead of an empty strip.
 */
export function RecentForm({ game }: { game: GameState }) {
  const club = game.clubs[game.userClubId]!;
  const results = recentMatches(game, club.id, FORM);

  return (
    <Section
      title="Recent results"
      action={
        <Button variant="ghost" size="sm" onClick={() => gameActions().setView('fixtures')}>
          All fixtures
        </Button>
      }
    >
      {results.length === 0 ? (
        <p className="empty">No competitive football played yet. The season starts with the next fixture on the list.</p>
      ) : (
        <ul className="home-results">
          {results.map((match) => {
            const outcome = outcomeFor(match, club.id);
            const opponentId = matchOpponent(match, club.id);
            const atHome = match.homeClubId === club.id;
            return (
              <li key={match.id} className={`home-result home-result--${outcome.toLowerCase()}`}>
                <span className={`pip pip--${outcome.toLowerCase()}`} aria-hidden="true">
                  {outcome}
                </span>
                <span className="home-result__score">{scoreFor(match, club.id)}</span>
                <span className="home-result__who">
                  <span className="small muted">{atHome ? 'H' : 'A'}</span>{' '}
                  <ClubLink clubId={opponentId}>{game.clubs[opponentId]?.identity.shortName}</ClubLink>
                </span>
                <span className="small muted home-result__when">
                  {match.competitionName} · {formatShortDate(match.date)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => openMatchReport(match.id)}>
                  Report
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * What is being said about the club.
 *
 * Three stories and a door, read through the same table the paper reads — the
 * label above a headline is the story's own kind rather than the column it was
 * filed in, because Home and the News screen must not call one story two things.
 * It is the quietest thing on the screen on purpose: news is what happened, and
 * Home is for what happens next.
 */
export function AroundTheClub({ game }: { game: GameState }) {
  return (
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
        <div className="diary-news">
          {game.news.slice(0, 3).map((item) => (
            <NewsTile
              key={item.id}
              /* The label the paper prints, not the column the story was filed
                 in: Home and the News screen read the same table, so the same
                 story cannot be "Squad" on one and "Signed" on the other. */
              category={labelForStory(item)}
              headline={item.headline}
              date={formatShortDate(item.date)}
              tone={item.category === 'Squad' ? 'accent' : item.importance === 3 ? 'warn' : 'default'}
              onClick={() => gameActions().setView('news')}
            />
          ))}
        </div>
      )}
    </Section>
  );
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
