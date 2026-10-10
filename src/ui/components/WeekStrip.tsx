import type { ISODate } from '@/domain/ids';
import type { PlannerDay } from '@/simulation/planner';
import { formatDate } from '@/simulation/calendar';
import { weekStripView } from '../weekStrip';

/**
 * The week, as a bar.
 *
 * Seven columns, Monday to Sunday, each carrying what is on that day and how
 * much it wants the manager — the shape a manager reads before anything else on
 * the screen, because it says how long there is until the game. The decisions
 * (which events are shown, how heavy each one is, what the week is called) are
 * all in `weekStrip.ts`; this file only draws them.
 *
 * It is a read-out, not a control: the calendar screen is where a day is acted
 * on, and a bar that jumped the clock on a click would be a bar nobody dares
 * touch to see what is on Thursday.
 */
export function WeekStrip({ days, today }: { days: readonly PlannerDay[]; today: ISODate }) {
  const week = weekStripView(days, today);
  if (week.days.length === 0) return null;

  return (
    <section className="weekstrip" aria-label={`The week of ${week.label}`}>
      <header className="weekstrip__head">
        <span className="letterpress weekstrip__eyebrow">The week</span>
        <span className="weekstrip__range">{week.label}</span>
        {week.remaining > 0 && (
          <span className="weekstrip__remaining">
            {week.remaining === 1 ? 'Last day' : `${week.remaining} days left`}
            {week.matchdays > 0 ? ` · ${week.matchdays === 1 ? 'a match' : `${week.matchdays} matches`}` : ''}
          </span>
        )}
      </header>

      <ol className="weekstrip__days">
        {week.days.map((day) => (
          <li
            key={day.date}
            className={[
              'weekstrip__day',
              day.isToday ? 'weekstrip__day--today' : '',
              day.isPast ? 'weekstrip__day--past' : '',
              day.isMatchday ? 'weekstrip__day--match' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={day.isToday ? 'date' : undefined}
            aria-label={`${formatDate(day.date)}${day.isToday ? ', today' : ''}${
              day.entries.length === 0 ? ', nothing on' : `, ${day.entries.map((entry) => entry.label).join(', ')}`
            }`}
          >
            {/* The column's own name: the day, then the date, then — only on the
                day he is standing on — a word rather than a tint saying so. The
                tint is what marks it at a glance across the bar; the word is what
                stops a manager counting columns to work out which one is now. */}
            <span className="weekstrip__dateline">
              <span className="weekstrip__dayname">{day.weekdayLabel}</span>
              <span className="weekstrip__daynum">{day.dayLabel}</span>
              {day.isToday && <span className="weekstrip__today">Today</span>}
            </span>

            {day.entries.length === 0 ? (
              <span className="weekstrip__empty">Nothing on</span>
            ) : (
              <ul className="weekstrip__entries">
                {day.entries.map((entry, index) => (
                  <li
                    className={`weekstrip__entry weekstrip__entry--${entry.tone}${
                      entry.resolved ? ' weekstrip__entry--done' : ''
                    }`}
                    key={`${day.date}-${index}`}
                  >
                    <span className="weekstrip__dot" aria-hidden="true" />
                    <span className="weekstrip__entry-text">
                      <span className="weekstrip__entry-label">{entry.label}</span>
                      {entry.time !== '' && <span className="weekstrip__entry-time">{entry.time}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {day.hidden > 0 && <span className="weekstrip__more">+{day.hidden} more</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
