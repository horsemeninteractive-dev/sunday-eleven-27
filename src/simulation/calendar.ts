import type { ISODate } from '@/domain/ids';
import type { SeasonCalendarEntry } from '@/domain/world';

/**
 * Game time is day-granular and stored as `YYYY-MM-DD`. All helpers here work
 * on UTC to avoid timezone drift between sessions and machines.
 */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function toDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toISO(date: Date): ISODate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86400000);
}

/** 0 = Sunday. */
export function dayOfWeek(iso: ISODate): number {
  return toDate(iso).getUTCDay();
}

export function isSunday(iso: ISODate): boolean {
  return dayOfWeek(iso) === 0;
}

export function nextWeekday(iso: ISODate, weekday: number): ISODate {
  let cursor = addDays(iso, 1);
  while (dayOfWeek(cursor) !== weekday) cursor = addDays(cursor, 1);
  return cursor;
}

export function formatDate(iso: ISODate): string {
  const date = toDate(iso);
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatShortDate(iso: ISODate): string {
  const date = toDate(iso);
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]!.slice(0, 3)} ${date.getUTCFullYear()}`;
}

export function formatDayMonth(iso: ISODate): string {
  const date = toDate(iso);
  return `${DAY_NAMES[date.getUTCDay()]!.slice(0, 3)} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]!.slice(0, 3)}`;
}

/**
 * A kick-off time as the game writes it: `10:30am`, `7:45pm`.
 *
 * Kick-off times are stored as plain strings and are never parsed back into a
 * date or a number, so they are written in the shape a manager reads them in.
 * Cup and replay times used to be written in 24-hour form (`19:45`) while the
 * league wrote `10:30am`, which put two spellings of the same thing on screen
 * in the same fixture list. This is the one place that decides which it is, so
 * that both read the same: a 24-hour string is rewritten on the way out, which
 * also rescues the ties already sitting in a save.
 *
 * Anything that is not a 24-hour time is returned untouched — the league has
 * always written `10:30am`, and that needs no help.
 */
export function formatKickOff(time: string): string {
  const parsed = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!parsed) return time;
  const hour = Number(parsed[1]);
  const minute = parsed[2];
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute}${suffix}`;
}

export function monthOf(iso: ISODate): number {
  return toDate(iso).getUTCMonth();
}

export function yearOf(iso: ISODate): number {
  return toDate(iso).getUTCFullYear();
}

export function seasonLabelFor(iso: ISODate): string {
  const year = yearOf(iso);
  const startYear = monthOf(iso) >= 6 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Sundays over the Christmas period are traditionally free in grassroots
 * football, so the calendar skips them.
 */
export function isChristmasBreak(iso: ISODate): boolean {
  const date = toDate(iso);
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return (month === 11 && day >= 20) || (month === 0 && day <= 4);
}

/**
 * How long the manager gets between taking the job and the first league game.
 *
 * Pre-season is not an off switch: the squad trains, the phone rings, players
 * are signed and friendlies are arranged — none of which there is any time for
 * if a career lands on the morning of the first fixture.
 */
export const PRE_SEASON_WEEKS = 6;

/** The Sunday the manager takes charge, `PRE_SEASON_WEEKS` before the opener. */
export function preSeasonStart(firstLeagueDate: ISODate): ISODate {
  return addDays(firstLeagueDate, -7 * PRE_SEASON_WEEKS);
}

/**
 * Weekdays on which no game in this league is ever played.
 *
 * Thursday is out because it is training night: a midweek match would take the
 * squad out of the one session they get to prepare for the weekend. Saturday is
 * out because there is other football on — this is a Sunday league, and a club
 * whose players are turned out on a Saturday afternoon has not turned anybody
 * out.
 *
 * Neither is negotiable, so it is stated once here rather than decided
 * separately in each place that has to pick a date. Every search for a date to
 * play on — a rearranged fixture, a cup round that has to move — is bounded by
 * this rather than by whatever days that particular search happened to think of.
 *
 * Saturday was previously offered as the last resort for a fixture that could
 * find nowhere else, which is precisely the sort of quiet exception that becomes
 * the normal case.
 */
export const NO_GAME_WEEKDAYS: ReadonlySet<number> = new Set([
  4, // Thursday — training
  6, // Saturday — other football
]);

/** Whether a game may be played on a date with this `getUTCDay()` weekday. */
export function canPlayOnWeekday(weekday: number): boolean {
  return !NO_GAME_WEEKDAYS.has(weekday);
}

/**
 * How many Sundays separate one league matchday from the next.
 *
 * The league plays fortnightly, and the weeks in between are for the cups. A
 * weekly calendar crammed a whole double round robin into September to February
 * and then left March to May with nothing in it at all — the back half of the
 * season, when the title is actually being won, was empty. Spreading the same
 * fixtures over the weeks that a Sunday league really has also thins out the
 * autumn, when the rain is worst and the postponements come from.
 *
 * The alternative was to keep playing weekly and simply stop in February, which
 * left a third of the season unwritten.
 */
export const MATCHDAY_INTERVAL_DAYS = 14;

/**
 * Build the season's matchday calendar.
 *
 * Every `MATCHDAY_INTERVAL_DAYS` from `startDate`, stepping over the Christmas
 * fortnight. The dates between two matchdays are not returned: they are the cup
 * weeks, and `buildSeasonCalendarWithCups` fills them.
 */
export function buildSeasonCalendar(startDate: ISODate, matchdays: number): SeasonCalendarEntry[] {
  const entries: SeasonCalendarEntry[] = [];
  let cursor = startDate;
  while (entries.length < matchdays) {
    entries.push({ matchday: entries.length + 1, date: cursor });
    cursor = addDays(cursor, MATCHDAY_INTERVAL_DAYS);
    while (isChristmasBreak(cursor)) cursor = addDays(cursor, MATCHDAY_INTERVAL_DAYS);
  }
  return entries;
}

/**
 * The season's calendar with cup rounds in it.
 *
 * One calendar, not two. A league Sunday and a midweek cup tie are both
 * *matchdays* — they both prepare a matchday, both roll the week's
 * availability, and both are settled before the season can close — so they are
 * numbered in one sequence rather than running as two parallel timelines that
 * have to be kept in step. League matchdays take 1..N, and each cup round takes
 * the next number after them.
 *
 * A cup round sits on the Wednesday of the week before a league matchday, which
 * is where a county league actually plays them: midweek evening under the
 * lights, and never on a Sunday a club is already playing.
 */
export interface CupRoundSlot {
  /** 1-based round number, used for the matchday number of its ties. */
  round: number;
  /** 1-based league matchday whose preceding Wednesday the round is played on. */
  beforeMatchday: number;
}

// Written the way the rest of the game writes a kick-off time, so a cup tie in
// a fixture list reads the same as the league game above it.
export const CUP_KICKOFF = '7:45pm';

export function cupRoundDate(leagueDate: ISODate): ISODate {
  // The Sunday of the week *before* the league matchday. With the league playing
  // fortnightly this is the free Sunday in the off-week, so a cup tie no longer
  // lands on a Wednesday night in the middle of a working week.
  return addDays(leagueDate, -7);
}

/**
 * Build the calendar for a season of leagues and cups.
 *
 * `slots` names the league matchday each cup round precedes. A slot pointing at
 * a matchday that does not exist is ignored rather than throwing, so a pyramid
 * configured with more cup rounds than the league has weeks still builds.
 */
export function buildSeasonCalendarWithCups(
  startDate: ISODate,
  matchdays: number,
  slots: readonly CupRoundSlot[] = [],
): SeasonCalendarEntry[] {
  const league = buildSeasonCalendar(startDate, matchdays);
  const extra: SeasonCalendarEntry[] = [];
  const nextMatchday = league.length;

  // Every Sunday already spoken for: the league's own, and the rounds placed
  // ahead of this one. A cup round needs a day to itself, because the whole
  // field plays on the same one.
  const taken = new Set(league.map((entry) => entry.date));

  for (const slot of slots) {
    const leagueEntry = league[slot.beforeMatchday - 1];
    if (!leagueEntry) continue;
    let date = cupRoundDate(leagueEntry.date);
    // A round whose slot falls in the Christmas fortnight moves on to the next
    // Sunday out of it rather than being dropped. Dropping it left the round with
    // no date at all: the competition could then never finish, because a
    // knockout tie that has never been drawn is a tie nobody is ever waiting for.
    //
    // The skip was easy to miss because the league calendar steps *over*
    // Christmas by a whole fortnight, so the Sunday a round inherits from a
    // matchday that had already jumped the break can land back inside it.
    //
    // It has to be a Sunday nobody is already playing on, and not merely the
    // next one: stepping forward seven days from a dead Christmas Sunday lands
    // straight back on a league matchday, which put a last-sixteen tie and a
    // quarter-final on the same afternoon and had every club in both playing
    // twice.
    for (let week = 0; week < 8; week += 1) {
      if (!isChristmasBreak(date) && !taken.has(date)) break;
      date = addDays(date, 7);
    }
    if (isChristmasBreak(date) || taken.has(date)) continue;
    taken.add(date);
    extra.push({ matchday: nextMatchday + extra.length + 1, date });
  }

  // Numbered in one sequence, but the numbers are *not* in date order: a cup
  // round is numbered above the league's matchdays while being played on a
  // Wednesday well before the last of them. Sorting by matchday therefore used to
  // leave the calendar reading as though February came before September, and any
  // code that walked it in date order — as the fixture list does — met cup ties
  // dated in the past, which nothing ever plays. Sorted by date, the sequence is
  // the order things actually happen in.
  return [...league, ...extra].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.matchday - b.matchday));
}

/**
 * Matchday number of a cup round.
 *
 * Cup rounds are numbered above the league's own matchdays, so a tie's fixture
 * list is separate from the league table's. `offset` separates two cups from
 * each other: the consolation cup starts where the main cup's rounds run out.
 */
export function cupMatchdayFor(round: number, leagueMatchdays: number, offset = 0): number {
  return leagueMatchdays + offset + round;
}

export function kickOffTimeFor(iso: ISODate): string {
  const date = toDate(iso);
  // Sunday mornings dominate, with occasional earlier or later kick-offs.
  const minute = date.getUTCDate() % 3 === 0 ? '00' : date.getUTCDate() % 3 === 1 ? '30' : '15';
  const hour = date.getUTCDate() % 4 === 0 ? 10 : 10;
  return `${hour}:${minute}am`;
}
