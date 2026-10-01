import { useState } from 'react';
import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import { ATTRIBUTE_DESCRIPTORS } from '@/domain/attributes';
import { isPlayer, type Player } from '@/domain/person';
import {
  TRAINING_BLOCKS,
  TRAINING_BLOCK_ORDER,
  TRAINING_LENGTH_DETAIL,
  TRAINING_LENGTH_LABEL,
  blockCapacity,
  describeCohesion,
  describeSessionQuality,
  describeSetPieceWork,
  describeSystemFamiliarity,
  type TrainingAttendanceEntry,
  type TrainingAttendanceStatus,
  type TrainingLength,
  type TrainingSession,
} from '@/domain/training';
import { formatDayMonth, formatShortDate } from '@/simulation/calendar';
import { currentPlan, sessionForecast } from '@/simulation/training/plan';
import { clubSetPieceFamiliarity, clubSystemFamiliarity } from '@/simulation/training/cohesion';
import { developmentSummary } from '@/simulation/training/development';
import { lastSessionFor, sessionsFor, trainingStore, weeksSince } from '@/simulation/training/store';
import { gameActions, useGame } from '../hooks';
import { Button, Callout, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { PlayerLink } from '../components/Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

/**
 * Training.
 *
 * One evening a week, half the squad coming straight from work. The manager
 * says what the session is for — a handful of broad blocks, not a programme —
 * and then finds out who turned up and what it did to them.
 *
 * The screen is ordered the way the evening is: what is happening, who is
 * coming, what happened last time, and what the work has built.
 */

const LENGTHS: TrainingLength[] = ['short', 'normal', 'long'];

type AttendanceSortKey = 'player' | 'standing' | 'why';

/** Coming first, then the maybes, then the ones who are not. */
const ATTENDANCE_ORDER: TrainingAttendanceStatus[] = ['attending', 'trialist', 'doubtful', 'absent'];

function attendanceSort(game: GameState): SortAccessors<TrainingAttendanceEntry, AttendanceSortKey> {
  return {
    player: (entry) => {
      const person = game.people[entry.personId];
      return person ? `${person.surname} ${person.firstName}` : '';
    },
    standing: (entry) => ATTENDANCE_ORDER.indexOf(entry.status),
    why: (entry) => entry.reason ?? '',
  };
}

export function TrainingView() {
  const game = useGame();
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<SortState<AttendanceSortKey>>(UNSORTED);
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const plan = currentPlan(game, club.id);
  const forecast = sessionForecast(game, club.id);
  const capacity = blockCapacity(plan.length);
  const last = lastSessionFor(game, club.id);
  const history = sessionsFor(game, club.id);
  const squad = club.squadIds.map((id) => game.people[id]).filter(isPlayer);
  const store = trainingStore(game);
  const workingOn = squad
    .map((player) => ({ player, lines: developmentSummary(game, player) }))
    .filter((entry) => entry.lines.length > 0)
    .slice(0, 5);
  const errors = forecast.problems.filter((problem) => problem.severity === 'error');
  const warnings = forecast.problems.filter((problem) => problem.severity === 'warning');
  const alreadyRun = history.some((session) => session.matchday === forecast.matchday);
  const thin = forecast.attendance.attending.length < 11;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Training"
        subtitle={`${formatDayMonth(forecast.date)} at ${forecast.venueName}${forecast.indoorGround ? ' (3G)' : ''} · ${forecast.minutes} minutes · run by ${forecast.coachName}`}
        tone={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warn' : 'default'}
        meta={
          <>
            <span className={`small ${thin ? 'tone tone--warn' : 'muted'}`}>
              {forecast.attendance.attending.length} expected · {forecast.attendance.doubtful.length} doubtful ·{' '}
              {forecast.attendance.absent.length} out
            </span>
            <span className="small muted">
              {plan.blocks.length} of {capacity} blocks planned
            </span>
          </>
        }
        actions={
          <span className="small muted">
            {alreadyRun ? 'This week’s session has been run' : 'Take the session with the Continue button above'}
          </span>
        }
      />

      {alreadyRun ? (
        <Callout tone="ok" title="This week's session is done">
          The squad trains again next Thursday. The plan below carries over until you change it.
        </Callout>
      ) : (
        <Callout tone="info" title="Plan it here, run it from the Continue button">
          Set the blocks and the length below. The session itself is run when you take it — the Continue
          button at the top of the screen offers it on the night.
        </Callout>
      )}

      <Panel
        level="primary"
        title="The plan for this Thursday"
        subtitle="A handful of broad blocks, not a programme. Longer sessions fit more of them."
      >
        <div className="row row--wrap">
          {LENGTHS.map((length) => (
            <Button
              key={length}
              variant={plan.length === length ? 'primary' : 'ghost'}
              onClick={() => gameActions().setTrainingLength(length)}
              title={TRAINING_LENGTH_DETAIL[length]}
            >
              {TRAINING_LENGTH_LABEL[length]}
              {plan.length === length ? ` · ${forecast.minutes} min` : ''}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => gameActions().resetTrainingPlan()}>
            Back to the usual
          </Button>
        </div>

        <p className="muted small">
          A {TRAINING_LENGTH_LABEL[plan.length].toLowerCase()} session fits {capacity} blocks ({plan.blocks.length} of{' '}
          {capacity} chosen). Run it when you are ready and the report is in front of you before you pick the team — or
          leave it, and it happens by itself before Sunday&apos;s game.
        </p>

        <h4 className="subhead">What the session works on</h4>
        <ul className="tight-list">
          {TRAINING_BLOCK_ORDER.map((blockId) => {
            const block = TRAINING_BLOCKS[blockId];
            const selected = plan.blocks.includes(blockId);
            const atCapacity = !selected && plan.blocks.length >= capacity;
            return (
              <li key={blockId}>
                <div className="row row--wrap">
                  <Button
                    variant={selected ? 'primary' : 'ghost'}
                    disabled={atCapacity}
                    aria-pressed={selected}
                    onClick={() => gameActions().toggleTrainingBlock(blockId)}
                  >
                    {selected ? `✓ ${block.label}` : block.label}
                  </Button>
                  <span className="small">{block.purpose}</span>
                  {block.develops.length > 0 && <span className="muted small">Works on {developsList(block.develops)}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="row row--wrap">
          <Button
            variant={plan.fallbackVenue ? 'primary' : 'ghost'}
            aria-pressed={plan.fallbackVenue}
            onClick={() => gameActions().setTrainingFallbackVenue(!plan.fallbackVenue)}
          >
            {plan.fallbackVenue ? '✓ Hall booked if the pitch is unfit' : 'Book the hall if the pitch is unfit'}
          </Button>
          <span className="muted small">Costs £20–£30 when it is used, and beats standing about in the rain.</span>
        </div>

        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="tight-list">
            {[...errors, ...warnings].map((problem) => (
              <li key={problem.message}>
                <Pill tone={problem.severity === 'error' ? 'bad' : 'warn'}>
                  {problem.severity === 'error' ? 'Sort this' : 'Watch'}
                </Pill>{' '}
                {problem.message}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Who is coming"
        subtitle={`${forecast.attendance.attending.length} expected, ${forecast.attendance.doubtful.length} doubtful, ${forecast.attendance.absent.length} out`}
        tone={thin ? 'warn' : 'default'}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show only the notable ones' : `Show the whole squad (${squad.length})`}
          </Button>
        }
      >
        <div className="table-wrapper">
          <table className="table table--compact table--stack">
            <thead>
              <tr>
                <SortTh label="Player" sortKey="player" sort={sort} onSort={setSort} />
                <SortTh label="Where he stands" sortKey="standing" sort={sort} onSort={setSort} />
                <SortTh label="Why" sortKey="why" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {applySort(groupEntries(forecast.attendance.entries, showAll), sort, attendanceSort(game)).map((entry) => {
                const person = game.people[entry.personId];
                const player = isPlayer(person) ? person : undefined;
                return (
                  <tr key={entry.personId}>
                    <td>
                      <PlayerLink personId={entry.personId}>
                        {person ? `${person.firstName} ${person.surname}` : 'Unknown'}
                      </PlayerLink>
                    </td>
                    <td data-label="Standing">
                      <Pill
                        tone={
                          entry.status === 'attending'
                            ? 'ok'
                            : entry.status === 'doubtful'
                              ? 'warn'
                              : entry.status === 'trialist'
                                ? 'accent'
                                : 'muted'
                        }
                      >
                        {entry.status === 'attending'
                          ? 'Coming'
                          : entry.status === 'doubtful'
                            ? 'Doubtful'
                            : entry.status === 'trialist'
                              ? 'Trialist'
                              : 'Not coming'}
                      </Pill>
                    </td>
                    <td className="muted small" data-label="Why">
                      {entry.reason ?? detailFor(player, game)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Availability this week decides who can train; work, kids and a car that will not start decide the rest on the
          night.
        </p>
      </Panel>

      {last && <SessionReport state={game} session={last} title="What happened last Thursday" />}

      <div className="flow">
        <Panel level="quiet" title="What the work has built" subtitle="Derived from the squad, not from a meter">
          <ul className="tight-list">
            <li>
              <strong>{describeCohesion(forecast.cohesion)}</strong>
              <div className="muted small">How settled this group is with each other.</div>
            </li>
            <li>
              <strong>{describeSystemFamiliarity(clubSystemFamiliarity(game, club.id))}</strong>
              <div className="muted small">How well they know the shape and the instructions.</div>
            </li>
            <li>
              <strong>{describeSetPieceWork(clubSetPieceFamiliarity(game, club.id))}</strong>
              <div className="muted small">Corners, free kicks and who picks up who.</div>
            </li>
          </ul>
          {workingOn.length > 0 && (
            <>
              <h4 className="subhead">Coming on</h4>
              <ul className="bullets">
                {workingOn.map((entry) => (
                  <li key={entry.player.id}>
                    <PlayerLink personId={entry.player.id}>
                      <strong>
                        {entry.player.firstName} {entry.player.surname}
                      </strong>
                    </PlayerLink>{' '}
                    — {entry.lines[0]!.toLowerCase()}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <div className="flow__col">
          <Panel level="quiet" title="The evening itself">
            <p className="small">
              {weatherPhrase(forecast.weather)} at {forecast.temperatureC}°C, pitch {forecast.pitch}.{' '}
              {forecast.indoorGround
                ? 'The 3G takes whatever the weather does.'
                : forecast.hasFloodlights
                  ? 'Floodlights, so we can go as long as we like.'
                  : 'No floodlights — light will be the limit in midwinter.'}
            </p>
            {forecast.advice.length > 0 && (
              <>
                <h4 className="subhead">Worth knowing</h4>
                <ul className="bullets">
                  {forecast.advice.map((item) => (
                    <li key={item.text}>{item.text}</li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            level="quiet"
            title="Recent Thursdays"
            subtitle={`${store.history.filter((session) => session.clubId === club.id).length} on record`}
          >
            {history.length === 0 && <p className="empty">Nothing on record yet — the first session of the season is coming up.</p>}
            <ul className="timeline">
              {history.map((session) => {
                const quality = describeSessionQuality(session.quality);
                return (
                  <li key={session.id} className="timeline__item">
                    <span className="timeline__date">{formatShortDate(session.date)}</span>{' '}
                    <Pill tone={session.cancelled ? 'muted' : quality.tone}>
                      {session.cancelled ? 'Cancelled' : quality.label}
                    </Pill>{' '}
                    <span className="small">
                      {session.cancelled
                        ? session.summary
                        : `${session.attended} there · ${session.blocks.map((block) => TRAINING_BLOCKS[block].label.toLowerCase()).join(', ')}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SessionReport({ state, session, title }: { state: GameState; session: TrainingSession; title: string }) {
  const quality = describeSessionQuality(session.quality);
  const club = state.clubs[session.clubId];
  return (
    <Panel
      title={title}
      subtitle={`${formatDayMonth(session.date)} · ${session.venueName} · ${session.coachName} (${session.coachRole})`}
    >
      <div className="row row--wrap">
        {session.cancelled ? (
          <Pill tone="muted">Cancelled</Pill>
        ) : (
          <>
            <Pill tone={quality.tone}>{quality.label}</Pill>
            <Pill tone="muted">
              {session.attended} there
              {session.expectedAttending > 0 ? ` of ${session.expectedAttending} expected` : ''}
            </Pill>
            <Pill tone="muted">{session.minutes} minutes</Pill>
            <Pill tone="muted">{session.pitch}</Pill>
            {session.indoor && <Pill tone="accent">Indoors</Pill>}
          </>
        )}
      </div>
      <p>{session.summary}</p>

      {session.observations.length > 0 && (
        <>
          <h4 className="subhead">What you noticed</h4>
          <ul className="bullets">
            {session.observations.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        </>
      )}

      {session.trialistIds.length > 0 && (
        <>
          <h4 className="subhead">Trialists</h4>
          <ul className="bullets">
            {session.trialistIds.map((personId) => (
              <li key={personId}>{personLabel(state, personId)} came down for a look.</li>
            ))}
          </ul>
        </>
      )}

      {session.injuredIds.length > 0 && (
        <>
          <h4 className="subhead">Took a knock</h4>
          <ul className="bullets">
            {session.injuredIds.map((personId) => {
              const person = state.people[personId];
              const player = isPlayer(person) ? person : undefined;
              return (
                <li key={personId}>
                  {personLabel(state, personId)} — {player?.injury ? player.injury.description : 'a knock'}, out for about{' '}
                  {player?.injury ? `${player.injury.daysOut} days` : 'a while'}.
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="muted small">
        {club ? `${club.identity.name}'s` : 'The'} training pitch hire and floodlights are paid every week out of the
        club account.
      </p>
    </Panel>
  );
}

function developsList(keys: readonly string[]): string {
  return keys
    .map((key) => ATTRIBUTE_DESCRIPTORS.find((descriptor) => `${descriptor.group}.${descriptor.key}` === key)?.label ?? key)
    .join(', ');
}

function groupEntries(
  entries: TrainingSession['attendance'],
  showAll: boolean,
): TrainingSession['attendance'] {
  const order: Record<string, number> = { trialist: 0, absent: 1, doubtful: 2, attending: 3 };
  const notable = entries.filter(
    (entry) => entry.status !== 'attending' || (showAll ? true : entry.reason !== null),
  );
  const chosen = showAll ? entries : notable;
  return [...chosen].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.personId.localeCompare(b.personId));
}

function detailFor(player: Player | undefined, state: GameState): string {
  if (!player) return '';
  const weeks = weeksSince(player.joinedClubOn, state.date);
  const bits = [`${player.age}`, player.occupation.toLowerCase()];
  if (weeks <= 4) bits.push('new to the club');
  const fitness = player.fitness < 70 ? 'short of fitness' : null;
  if (fitness) bits.push(fitness);
  return bits.join(' · ');
}

function personLabel(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  return person ? `${person.firstName} ${person.surname}` : 'Somebody';
}

function weatherPhrase(weather: string): string {
  const map: Record<string, string> = {
    clear: 'Dry and clear',
    overcast: 'Grey and still',
    windy: 'Blowing a gale',
    'light-rain': 'Light rain',
    'heavy-rain': 'Pouring',
    cold: 'Cold',
    frozen: 'Frosty',
  };
  return map[weather] ?? 'Mild';
}
