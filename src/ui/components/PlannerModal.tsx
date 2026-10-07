import { useState } from 'react';
import type { ISODate } from '@/domain/ids';
import { MONTH_NAMES, daysBetween, formatDate, formatKickOff, toDate } from '@/simulation/calendar';
import { dayEvents, plannerDays, plannerMonth } from '@/simulation/planner';
import { nextStop } from '@/simulation/schedule';
import { gameActions, useGame, useNextFixture } from '../hooks';
import { useCommandState } from '../commandActions';
import { Button, Callout, Panel, Pill } from '../components/primitives';
import { Dialog } from '../dialogs/Dialog';
import { ClubLink } from './Links';

/**
 * The calendar: the club's diary, and the control for time.
 *
 * Football Manager's advance control, made explicit. A month you can read, the
 * match week day by day, and what is next — then three ways to move: one day,
 * to the next thing worth stopping for, or to a date you choose. Nothing that
 * wants a decision is ever skipped, because the clock stops before it, not after.
 */
export function PlannerModal() {
  const game = useGame();
  const command = useCommandState();
  const fixture = useNextFixture();
  const [selected, setSelected] = useState<ISODate | null>(null);
  const [month, setMonth] = useState(() => {
    const date = toDate(game?.date ?? '2026-09-01');
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  });

  if (!game || !command) return null;

  const today = game.date;
  const day = selected ?? today;
  const events = dayEvents(game, day);
  const stop = nextStop(game, today);
  const cells = plannerMonth(game, month.year, month.month);
  const strip = plannerDays(game);
  const daysToStop = daysBetween(today, stop.date);
  const daysToSelection = daysBetween(today, day);

  const shiftMonth = (delta: number) => {
    setMonth((current) => {
      const next = current.month + delta;
      if (next < 0) return { year: current.year - 1, month: 11 };
      if (next > 11) return { year: current.year + 1, month: 0 };
      return { year: current.year, month: next };
    });
  };

  const close = () => gameActions().closePlanner();
  const continueOn = () => {
    gameActions().continueGame();
    close();
  };
  const advance = (days: number) => {
    gameActions().advanceDays(days);
    close();
  };
  const jump = (date: ISODate) => {
    if (date <= today) {
      setSelected(date);
      return;
    }
    gameActions().jumpToDate(date);
    close();
  };

  return (
    <Dialog title="The calendar" subtitle={`${game.season.label} · today is ${formatDate(today)}`} onClose={close}
      footer={<><Button variant="ghost" onClick={() => advance(1)}>Advance a day</Button><Button variant="primary" onClick={continueOn}>{command.action.label}</Button></>}>

          <div className="planner">
            <div className="stack">
              <div className="calendar">
                <div className="calendar__head">
                  <Button variant="ghost" size="sm" onClick={() => shiftMonth(-1)} ariaLabel="Previous month">
                    ‹
                  </Button>
                  <span className="calendar__month">
                    {MONTH_NAMES[month.month]} {month.year}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => shiftMonth(1)} ariaLabel="Next month">
                    ›
                  </Button>
                </div>
                <div className="calendar__grid">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
                    <div className="calendar__weekday" key={label}>
                      {label}
                    </div>
                  ))}
                  {cells.map((cell, index) => {
                    if (!cell) return <div className="calendar__cell calendar__cell--empty" key={`pad-${index}`} />;
                    const isSelected = cell.date === day;
                    const played = cell.events.find((event) => event.kind === 'league-match' && event.resolved);
                    const training = cell.events.find((event) => event.kind === 'training');
                    const calledOff = cell.events.find((event) => event.kind === 'postponed');
                    const match = cell.events.find((event) => event.kind === 'league-match' && !event.resolved);
                    return (
                      <button
                        type="button"
                        key={cell.date}
                        className={[
                          'calendar__cell',
                          cell.isPast ? 'calendar__cell--past' : '',
                          cell.isToday ? 'calendar__cell--today' : '',
                          isSelected ? 'calendar__cell--selected' : '',
                          cell.isMatchday ? 'calendar__cell--matchday' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setSelected(cell.date)}
                        aria-label={`${formatDate(cell.date)}${cell.isToday ? ', today' : ''}${cell.events.length ? `, ${cell.events.map((event) => event.label).join(', ')}` : ', no events'}`}
                        aria-pressed={isSelected}
                      >
                        <span className="calendar__daynum">{cell.dayLabel}</span>
                        {training && (
                          <span className="calendar__mark calendar__mark--training">
                            {training.resolved ? 'Trained' : 'Training'}
                          </span>
                        )}
                        {played && <span className="calendar__mark calendar__mark--played">Result</span>}
                        {match && <span className="calendar__mark calendar__mark--match">Match</span>}
                        {calledOff && <span className="calendar__mark calendar__mark--off">Off</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Panel title="The match week" subtitle="Monday to Sunday" level="default">
                <div className="planner__week">
                  {strip.map((entry) => (
                    <button
                      type="button"
                      key={entry.date}
                      className={[
                        'planner__weekday',
                        entry.isToday ? 'planner__weekday--today' : '',
                        entry.isPast ? 'planner__weekday--past' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={entry.date === day}
                      aria-label={`${formatDate(entry.date)}${entry.isTrainingDay ? ', training' : ''}${entry.isMatchday ? ', match' : ''}`}
                      onClick={() => setSelected(entry.date)}
                    >
                      <span className="planner__weekday-label">{entry.weekdayLabel}</span>
                      <span className="planner__weekday-date">{entry.dayLabel}</span>
                      {entry.isTrainingDay && <Pill tone="warn">Training</Pill>}
                      {entry.isMatchday && <Pill tone="accent">Match</Pill>}
                    </button>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="planner__side">
              <Panel
                title={formatDate(day)}
                subtitle={
                  daysToSelection === 0
                    ? 'Today'
                    : daysToSelection > 0
                      ? `${daysToSelection} day${daysToSelection === 1 ? '' : 's'} ahead`
                      : `${Math.abs(daysToSelection)} day${Math.abs(daysToSelection) === 1 ? '' : 's'} ago`
                }
                level="primary"
              >
                {events.length === 0 ? (
                  <p className="muted small">
                    Nothing on. Days like this are why football is played on Sundays — and they still get simulated.
                  </p>
                ) : (
                  <div className="tight-list">
                    {events.map((event, index) => (
                      <div className="planner__event" key={index}>
                        <span className="planner__event-time">{event.time || '—'}</span>
                        <span>
                          <strong>{event.label}</strong>
                          <div className="muted small">{event.detail}</div>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="row row--wrap" style={{ marginTop: '12px' }}>
                  {daysToSelection > 0 && (
                    <Button variant="ghost" onClick={() => jump(day)} title="Run the calendar forward to this day">
                      Go to this day
                    </Button>
                  )}
                </div>
              </Panel>

              <Panel title="Next up" level="default">
                <p className="small">
                  <strong>{stop.kind === 'none' ? 'Nothing on the calendar' : stop.headline}</strong>
                  {stop.kind === 'none' ? '' : ` — ${stop.detail}`}
                </p>
                <p className="muted small">
                  {stop.kind === 'none'
                    ? 'The season calendar has run out.'
                    : daysToStop <= 0
                      ? 'That is today. The clock will not pass it until you have dealt with it.'
                      : `${formatDate(stop.date)} · ${daysToStop} day${daysToStop === 1 ? '' : 's'} away.`}
                </p>

              </Panel>

              {fixture && (
                <Panel title="Next fixture" level="quiet">
                  <p className="small">
                    <ClubLink clubId={fixture.homeClubId === game.userClubId ? fixture.awayClubId : fixture.homeClubId} />
                  </p>
                  <p className="muted small">
                    {formatDate(fixture.date)} · {formatKickOff(fixture.kickOff)} ·{' '}
                    {game.world.grounds[fixture.groundId]?.name ?? 'ground to confirm'}
                  </p>
                </Panel>
              )}

              <details className="more"><summary>How time works</summary><Callout tone="info">
                Continue runs the quiet days and stops when you have a decision. Recovery, bills and the rest of the local game carry on each day.
              </Callout></details>
            </div>
          </div>
    </Dialog>
  );
}
