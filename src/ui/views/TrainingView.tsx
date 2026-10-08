import { useState } from 'react';
import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
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
import { FocalFact, MetricTile, Section, TileGrid } from '../components/hierarchy';
import { PersonLine } from '../components/PersonIdentity';
import { useRememberedSort } from '../rememberedSort';
import { applySort, type SortAccessors } from '../tableSort';

/**
 * Training.
 *
 * One evening a week, half the squad coming straight from work. The screen
 * answers five questions and stops: when, where, how long, who is coming, and
 * what are we working on. The plan is controls; the report is a short card;
 * the history is behind a summary line.
 */

const LENGTHS: TrainingLength[] = ['short', 'normal', 'long'];

type AttendanceSortKey = 'player' | 'standing' | 'why';

/** Coming first, then the maybes, then the ones who are not. */
const ATTENDANCE_ORDER: TrainingAttendanceStatus[] = ['attending', 'trialist', 'doubtful', 'absent'];

/**
 * What each heading reads, over a session the manager has not held yet.
 *
 * The world may be missing for the same reason it may be missing in
 * `WorldView`: the keys of this map are the columns this screen can remember,
 * and they are known before there is a career to remember them in. The values
 * are only ever read with a world in hand.
 */
function attendanceSort(game: GameState | null): SortAccessors<TrainingAttendanceEntry, AttendanceSortKey> {
  return {
    player: (entry) => {
      const person = game?.people[entry.personId];
      return person ? `${person.surname} ${person.firstName}` : '';
    },
    standing: (entry) => ATTENDANCE_ORDER.indexOf(entry.status),
    why: (entry) => entry.reason ?? '',
  };
}

export function TrainingView() {
  const game = useGame();
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useRememberedSort('training', game?.saveId ?? null, attendanceSort(game));
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
        eyebrow="Team"
        title="Training"
        subtitle={`Preparing for Sunday · ${forecast.venueName}, ${formatDayMonth(forecast.date)}`}
        actions={<Button variant="primary" onClick={() => gameActions().openPlanner()}>Plan the week</Button>}
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
            <span className="small muted">{alreadyRun ? 'this week’s session is run' : 'not run yet'}</span>
          </>
        }
      />

      {/* Attendance is the thing a manager actually worries about on a Thursday
          night in November — whether he has a team to train at all — so it is the
          screen's one fact, with the logistics (when, where, how long) as the
          smaller reading underneath it rather than four tiles of equal weight. */}
      <FocalFact
        label={alreadyRun ? 'Who came' : 'Who is coming'}
        value={`${forecast.attendance.attending.length} attending`}
        note={`${forecast.attendance.doubtful.length} doubtful · ${forecast.attendance.absent.length} out of ${squad.length}`}
        tone={thin ? 'warn' : 'ok'}
      />
      <TileGrid min={180}>
        <MetricTile label="When" value={formatShortDate(forecast.date)} note={`in ${forecast.daysAway} day${forecast.daysAway === 1 ? '' : 's'}`} />
        <MetricTile label="Where" value={forecast.venueName} note={forecast.indoorGround ? '3G — weatherproof' : forecast.hasFloodlights ? 'Floodlights' : 'No floodlights'} />
        <MetricTile label="How long" value={`${forecast.minutes} min`} note={TRAINING_LENGTH_LABEL[plan.length]} />
      </TileGrid>

      {alreadyRun ? (
        <Callout tone="ok" title="This week’s session is done">
          The plan carries over to next Thursday until you change it.
        </Callout>
      ) : null}

      <Section
        title="The session"
        action={
          <div className="row row--wrap row--tight">
            {LENGTHS.map((length) => (
              <Button
                key={length}
                variant={plan.length === length ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={plan.length === length}
                onClick={() => gameActions().setTrainingLength(length)}
                title={TRAINING_LENGTH_DETAIL[length]}
              >
                {TRAINING_LENGTH_LABEL[length]}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => gameActions().resetTrainingPlan()}>
              Reset
            </Button>
          </div>
        }
      >
        <Panel level="primary">
          <div className="row row--wrap row--tight">
            {TRAINING_BLOCK_ORDER.map((blockId) => {
              const block = TRAINING_BLOCKS[blockId];
              const selected = plan.blocks.includes(blockId);
              const atCapacity = !selected && plan.blocks.length >= capacity;
              return (
                <Button
                  key={blockId}
                  variant={selected ? 'primary' : 'ghost'}
                  size="sm"
                  disabled={atCapacity}
                  aria-pressed={selected}
                  title={block.purpose}
                  onClick={() => gameActions().toggleTrainingBlock(blockId)}
                >
                  {selected ? `✓ ${block.label}` : block.label}
                </Button>
              );
            })}
          </div>

          <ol className="session-plan">{plan.blocks.map((blockId, index) => <li key={blockId}><span className="session-plan__number">{index + 1}</span><div><strong>{TRAINING_BLOCKS[blockId].label}</strong><p className="small muted">{TRAINING_BLOCKS[blockId].purpose}</p></div></li>)}</ol>
          {plan.blocks.length === 0 && <p className="empty">Choose blocks above to give the evening a purpose.</p>}
          <details className="instruction-help"><summary>Session length and indoor fallback</summary><p>{TRAINING_LENGTH_DETAIL[plan.length]} Hall hire costs £20–£30 when used.</p></details>
          <div className="row row--wrap row--tight" style={{ marginTop: 'var(--s3)' }}>
            <Button
              variant={plan.fallbackVenue ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={plan.fallbackVenue}
              title="Costs £20–£30 when it is used, and beats standing about in the rain."
              onClick={() => gameActions().setTrainingFallbackVenue(!plan.fallbackVenue)}
            >
              {plan.fallbackVenue ? '✓ Hall booked' : 'Book the hall'}
            </Button>
            {errors.length === 0 && warnings.length === 0 && (
              <span className="muted small">{capacity - plan.blocks.length} blocks spare</span>
            )}
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="tight-list" style={{ marginTop: 'var(--s3)' }}>
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
      </Section>

      <Section
        title="Attendance"
        action={
          <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Only the notable ones' : `Whole squad (${squad.length})`}
          </Button>
        }
      >
        <Panel flush>
          {groupEntries(forecast.attendance.entries, showAll).length === 0 && <p className="empty">No attendance issues reported. Open Whole squad to see everyone coming.</p>}
          <div className="table-wrapper">
            <table className="table table--compact table--stack">
              <thead>
                <tr>
                  <SortTh label="Player" sortKey="player" sort={sort} onSort={setSort} />
                  <SortTh label="Standing" sortKey="standing" sort={sort} onSort={setSort} />
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
                        <PersonLine personId={entry.personId}>
                          {person ? `${person.firstName} ${person.surname}` : 'Unknown'}
                        </PersonLine>
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
        </Panel>
      </Section>

      {last && <SessionReport state={game} session={last} title="Last session" />}

      <details className="more"><summary>Preparation and player development</summary><Section title="What the work has built">
        <TileGrid min={230}>
          <MetricTile label="Cohesion" value={describeCohesion(forecast.cohesion)} note="How settled this group is" />
          <MetricTile label="The system" value={describeSystemFamiliarity(clubSystemFamiliarity(game, club.id))} note="Shape and instructions" />
          <MetricTile label="Set pieces" value={describeSetPieceWork(clubSetPieceFamiliarity(game, club.id))} note="Corners, free kicks, marking" />
          {forecast.advice.map((item) => (
            <MetricTile key={item.text} label="Worth knowing" value={item.text} tone="warn" />
          ))}
        </TileGrid>
        {workingOn.length > 0 && (
          <div className="tile" style={{ marginTop: 'var(--s2)' }}>
            <span className="tile__label">Coming on</span>
            <ul className="bullets">

              {workingOn.map((entry) => (
                /* A row rather than a block: the work a man is coming on for
                   belongs on the same line as the face, and wraps under it only
                   when the screen is too narrow to hold both. */
                <li key={entry.player.id} className="row row--wrap">
                  <PersonLine personId={entry.player.id}>
                    <strong>
                      {entry.player.firstName} {entry.player.surname}
                    </strong>
                  </PersonLine>
                  <span className="muted">— {entry.lines[0]!.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section></details>

      <Section title="Training history">
        <details className="more">
          <summary className="small muted">
            {history.length === 0 ? 'Nothing on record yet' : `${history.length} sessions · ${store.history.filter((session) => session.clubId === club.id).length} on file`}
          </summary>
          {history.length === 0 ? (
            <p className="empty">The first session of the season is coming up.</p>
          ) : (
            <ul className="timeline">
              {history.map((session) => {
                const quality = describeSessionQuality(session.quality);
                return (
                  <li key={session.id} className="timeline__item">
                    <span className="timeline__date">{formatShortDate(session.date)}</span>{' '}
                    <Pill tone={session.cancelled ? 'muted' : quality.tone}>{session.cancelled ? 'Cancelled' : quality.label}</Pill>{' '}
                    <span className="small">
                      {session.cancelled
                        ? session.summary
                        : `${session.attended} there · ${session.blocks.map((block) => TRAINING_BLOCKS[block].label.toLowerCase()).join(', ')}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      </Section>
    </div>
  );
}

/** The result card: what the evening came to, at a glance. */
function SessionReport({ state, session, title }: { state: GameState; session: TrainingSession; title: string }) {
  const quality = describeSessionQuality(session.quality);
  return (
    <Section title={title}>
      <Panel level="default" tone={session.cancelled ? 'default' : quality.tone === 'ok' ? 'accent' : 'default'}>
        <div className="row row--wrap row--tight">
          {session.cancelled ? (
            <Pill tone="muted">Cancelled</Pill>
          ) : (
            <>
              <Pill tone={quality.tone}>{quality.label}</Pill>
              <Pill tone="muted">{session.attended} there</Pill>
              <Pill tone="muted">{session.minutes} min</Pill>
              <Pill tone="muted">{session.pitch}</Pill>
              {session.indoor && <Pill tone="accent">Indoors</Pill>}
              <span className="muted small">{formatDayMonth(session.date)}</span>
            </>
          )}
        </div>
        <p className="small">{session.summary}</p>
        {session.observations.length > 0 && (
          <ul className="bullets">
            {session.observations.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        )}
        {session.trialistIds.length > 0 && (
          <p className="small muted">
            Trialists: {session.trialistIds.map((personId) => personLabel(state, personId)).join(', ')}
          </p>
        )}
        {session.injuredIds.length > 0 && (
          <p className="small tone tone--warn">
            ⚠ {session.injuredIds.map((personId) => personLabel(state, personId)).join(', ')} picked up a knock
          </p>
        )}
      </Panel>
    </Section>
  );
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
  if (player.fitness < 70) bits.push('short of fitness');
  return bits.join(' · ');
}

function personLabel(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  return person ? `${person.firstName} ${person.surname}` : 'Somebody';
}
