import { useEffect, useState } from 'react';
import { useGameStore } from '@/state/gameStore';
import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { formatDayMonth, formatKickOff } from '@/simulation/calendar';
import { cupRoundName, cupRoundOf, isPostponed } from '@/simulation/cup';
import { clubMatches, clubTown, matchVenueLabel } from '@/simulation/queries';
import { NextFixturePanel } from '../components/FixtureInfo';
import { ClubBadge } from '../components/Badge';
import { MatchReportModal } from '../components/MatchReportModal';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { Button, PageHeader, Panel, Pill } from '../components/primitives';

/**
 * What a fixture is for.
 *
 * A club's season is no longer one list of Sundays. It is twenty-two league
 * games, eleven cup ties — each of which is a round of something — and
 * whatever friendlies somebody arranged in July. A schedule that only said
 * "MD 27" was asking the manager to work out all of that themselves, and the
 * matchday numbers are worse than useless on a cup tie because the two
 * competitions are numbered off different bases.
 *
 * Two things are said, in the two places each belongs: the chip is the *kind* of
 * afternoon — a rung of the ladder, a round of a cup, a friendly — and the line
 * under the opponent names the competition in full, because that is the line a
 * long name can wrap on. A cup is never offered as 'Cup' or 'Plate': with two
 * ladders in the county there are four cups, and the one a Saturday belongs to is
 * the whole point of saying so.
 *
 * Exported for the same reason the other screens' pieces are: what a fixture is
 * labelled is a rule about how competitions are named, and a rule that only a
 * rendered screen can show is a rule nothing can hold.
 */
export function fixtureKind(
  state: GameState,
  match: Match,
): { label: string; detail: string | null; tone: 'accent' | 'ok' | 'muted' } {
  const competition: Competition | undefined = state.competitions[match.competitionId];
  // A friendly is arranged between two clubs and belongs to no competition, so
  // it never touches a table, a record or a career appearance.
  if (!competition) {
    return { label: 'Friendly', detail: null, tone: 'muted' };
  }
  if (competition.kind === 'cup' && competition.cup) {
    const round = cupRoundOf(state, competition, match);
    return {
      // What kind of afternoon it is: the competition's own name for the round,
      // not "the 1st round" — the same eight clubs are the quarter-finals in one
      // round and the preliminary in another, and only the plan knows which.
      label: round > 0 ? cupRoundName(competition, round) : 'Cup tie',
      // And *which* cup, in full, on the line under the opponent. It used to be
      // squeezed into the chip in front of the round, shortened to the one word
      // that fitted — which in a county of six districts is thirteen cups arriving
      // as one word ('Alderford Sunday League Cup', 'Millwater Sunday League Plate'
      // and the rest all became 'Cup'). The chip is the kind of fixture; the name
      // belongs on the
      // line with the ground, where a long name wraps instead of taking the row.
      detail: competition.name,
      tone: 'accent',
    };
  }
  return {
    label: leagueRung(competition.name),
    // The league is named on the chip by the rung alone: the schedule is the
    // manager's own season, every league fixture on it is in his own division,
    // and the ladder's name in front of all of them would be the same few words
    // on every row of the page.
    detail: null,
    tone: 'ok',
  };
}

/**
 * The rung a league fixture is in: 'Alderford Sunday League Division One' →
 * 'Division One'.
 *
 * A competition named some other way — a county's or a district's cup, an
 * invitational — is left exactly as it is, because there is no ladder in front of
 * it to take off.
 */
function leagueRung(name: string): string {
  return name.replace(/^.*Sunday League /, '');
}

/**
 * The schedule.
 *
 * One list, in the order a fixture list is printed: a month at a time, the games
 * already settled and the games still to come in the same run, with the results
 * sitting in the list where the manager left them. Nothing is split into a
 * "results" panel — reading a season means reading it straight through.
 *
 * The list is one column. A fixture is a line of text and a score, and putting
 * two of them side by side on a page of dates makes the manager read across
 * rather than down, which is the wrong way round for a season diary.
 *
 * Opening a report is a detour rather than a destination, so it opens over the
 * top of the page and the list is exactly where it was when it closes.
 */
export function FixturesView() {
  const game = useGame();
  const nextFixture = useNextFixture();
  const [reportId, setReportId] = useState<string | null>(null);
  const focus = useGameStore((state) => state.focus);
  useEffect(() => {
    if (focus?.startsWith('report:')) { setReportId(focus.slice(7)); useGameStore.setState({ focus: null }); }
  }, [focus]);

  if (!game) return null;
  const club = game.clubs[game.userClubId]!;
  // By date, not by matchday. League matchdays are 1..22 and a cup round is
  // numbered above all of them, so a cup tie in September sorted on its
  // matchday lands in November's month and at the end of the list. The list is
  // a season diary: it runs in the order the days do.
  const matches = clubMatches(game, club.id).sort(
    (a, b) => a.date.localeCompare(b.date) || a.matchday - b.matchday,
  );
  const played = matches.filter((match) => match.played);
  const upcoming = matches.filter((match) => !match.played);
  const months = groupByMonth(matches);
  const monthInHand = monthLabel((nextFixture ?? matches[matches.length - 1])?.date ?? game.date);
  const report = reportId ? (game.matches[reportId] ?? null) : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Competition"
        title="Fixtures"
        photo="/photos/stadium-matchday.webp"
        subtitle={`${game.season.label} · ${matches.length} fixtures, ${played.length} played, ${upcoming.length} to come`}
        meta={
          nextFixture ? (
            <span className="small muted">
              Next: {matchVenueLabel(nextFixture, club.id)} against{' '}
              {game.clubs[nextFixture.homeClubId === club.id ? nextFixture.awayClubId : nextFixture.homeClubId]!.identity.name}{' '}
              · {formatDayMonth(nextFixture.date)}, {formatKickOff(nextFixture.kickOff)}
            </span>
          ) : (
            <span className="small muted">Nothing left this season.</span>
          )
        }
        actions={
          nextFixture ? (
            <Button variant="ghost" onClick={() => gameActions().setView('team')}>
              Team selection
            </Button>
          ) : undefined
        }
      />

      <div className="stack">
        {/* The next game first, at full width: it is the one fixture the manager
            came to this screen for, and it used to sit beside the list in a
            column that made the list itself read two-up. */}
        {nextFixture && <NextFixturePanel state={game} match={nextFixture} />}

        <nav className="fixture-months" aria-label="Season months">{months.map(({ label }) => <button type="button" className="tab" key={label} onClick={() => { const node = document.getElementById(`month-${label}`) as HTMLDetailsElement | null; if (node) { node.open = true; node.scrollIntoView({ block: 'start' }); } }}>{label.replace(/ \d{4}$/, '')}</button>)}</nav>
        {months.map(({ label, matches: monthMatches }) => {
          const monthPlayed = monthMatches.filter((match) => match.played).length;
          const monthToCome = monthMatches.length - monthPlayed;
          return (
            <details className="more fixture-month" id={`month-${label}`} key={label} open={label === monthInHand}>
              <summary>{label} · {monthPlayed} played · {monthToCome} to come</summary>
            <Panel
              key={label}
              level={label === monthInHand ? 'primary' : 'default'}

            >
              <ul className="fixture-list">
                {monthMatches.map((match) => (
                  <FixtureRow
                    key={match.id}
                    state={game}
                    match={match}
                    isCurrent={match.id === nextFixture?.id}
                    onOpenReport={match.played ? () => setReportId(match.id) : undefined}
                  />
                ))}
              </ul>
            </Panel>
            </details>
          );
        })}
      </div>

      {report && <MatchReportModal state={game} match={report} onClose={() => setReportId(null)} />}
    </div>
  );
}

/**
 * One fixture in the list.
 *
 * A game that has been played opens its report; a game that has not has nothing
 * to open, so it is not a button and does not pretend to be.
 */
function FixtureRow({
  state,
  match,
  isCurrent,
  onOpenReport,
}: {
  state: GameState;
  match: Match;
  isCurrent: boolean;
  onOpenReport?: () => void;
}) {
  const venue = matchVenueLabel(match, state.userClubId);
  const opponentId = match.homeClubId === state.userClubId ? match.awayClubId : match.homeClubId;
  const opponent = state.clubs[opponentId]!;
  const result = match.result;
  const ground = state.world.grounds[match.groundId];
  const kind = fixtureKind(state, match);
  const place = clubTown(state, opponentId);
  // A called-off fixture stays in the month it was due, marked P-P, with the
  // replay listed separately on its new date: both are true, and a manager
  // planning his month needs to see both.
  const calledOff = isPostponed(match);
  const replay = match.replacedByMatchId ? state.matches[match.replacedByMatchId] : undefined;

  const row = (
    <>
      <span className="fixture__when">
        <strong>{formatDayMonth(match.date)}</strong>
        <span className="muted small">{formatKickOff(match.kickOff)}</span>
      </span>
      <span className="fixture__teams">
        {/* The opponent and the place it plays in. The diary is his own season,
            where every name on it is somebody he has to travel to: the town under
            the name is the half of that a fixture list has always lacked. */}
        <span className="person-identity"><ClubBadge club={opponent} size={30} />
          <span className="fixture__opponent">
            <strong>
              {venue === 'Home' ? 'v ' : 'at '}
              {opponent.identity.name}
            </strong>
            {place && <span className="clubcell__town">{place.name}</span>}
          </span>
        </span>
        <span className="muted small">
          {venue} · {ground?.name}
          {/* Which competition, in full, where a long name wraps rather than
              taking the width a fixture row needs for its two clubs. */}
          {kind.detail ? ` · ${kind.detail}` : ''}
          {isCurrent ? ' · next up' : ''}
          {calledOff
            ? replay
              ? ` · postponed, replay ${formatDayMonth(replay.date)}`
              : ' · postponed with no replay left in the season'
            : ''}
        </span>
      </span>
      <span className="fixture__kind">
        <Pill tone={kind.tone}>{kind.label}</Pill>
      </span>
      <span className="fixture__score">
        {calledOff ? (
          <Pill tone="warn" title={match.postponementReason ?? undefined}>
            P-P
          </Pill>
        ) : result ? (
          <Pill tone={outcomeTone(state, match)}>
            {result.homeGoals}–{result.awayGoals}
          </Pill>
        ) : (
          <Pill tone={isCurrent ? 'accent' : 'time'}>{formatKickOff(match.kickOff)}</Pill>
        )}
      </span>
    </>
  );

  return (
    <li>
      {onOpenReport ? (
        <button
          type="button"
          className="fixture fixture--played"
          onClick={onOpenReport}
          aria-current={isCurrent ? 'true' : undefined}
          title="Open the match report"
        >
          {row}
        </button>
      ) : (
        <div className={`fixture fixture--static${isCurrent ? ' fixture--current' : ''}${calledOff ? ' fixture--postponed' : ''}`} aria-current={isCurrent ? 'true' : undefined}>
          {row}
        </div>
      )}
    </li>
  );
}

function outcomeTone(state: GameState, match: Match): 'ok' | 'bad' | 'warn' | 'muted' {
  if (!match.result) return 'muted';
  const isHome = match.homeClubId === state.userClubId;
  const own = isHome ? match.result.homeGoals : match.result.awayGoals;
  const other = isHome ? match.result.awayGoals : match.result.homeGoals;
  if (own > other) return 'ok';
  if (own === other) return 'warn';
  return 'bad';
}

function groupByMonth(matches: Match[]): Array<{ label: string; matches: Match[] }> {
  const groups: Array<{ label: string; matches: Match[] }> = [];
  for (const match of matches) {
    const label = monthLabel(match.date);
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.matches.push(match);
    else groups.push({ label, matches: [match] });
  }
  return groups;
}

function monthLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
