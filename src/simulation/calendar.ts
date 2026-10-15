import type { ClubId, CompetitionId, ISODate } from '@/domain/ids';
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
 * One calendar, not two. A league Sunday and a cup tie are both
 * *matchdays* — they both prepare a matchday, both roll the week's
 * availability, and both are settled before the season can close — so they are
 * numbered in one sequence rather than running as two parallel timelines that
 * have to be kept in step. League matchdays take 1..N, and each cup round takes
 * the next number after them.
 *
 * A cup round sits on the Sunday of the week before a league matchday — the
 * free Sunday of the off-week, with the league playing fortnightly — so it
 * never lands on a Sunday a club is already playing.
 */
export interface CupRoundSlot {
  /** 1-based round number, used for the matchday number of its ties. */
  round: number;
  /** 1-based league matchday whose preceding Wednesday the round is played on. */
  beforeMatchday: number;
  /**
   * The competition this round belongs to, where the caller knows it.
   *
   * Read for one thing only: the rounds of one competition are played in order,
   * so a round laid out later in the season may never be given a Sunday an
   * earlier round of the same competition already has. Two competitions have no
   * such relationship — a Plate and the cup that feeds it are separate
   * tournaments that happen to be drawn by the same ladder.
   */
  competitionId?: CompetitionId;
  /**
   * The clubs that could be drawn into this round: its competition's field.
   *
   * Two rounds may share a Sunday only when no club could be in both, which is
   * the whole of the rule the county now needs — the two ladders' cups have
   * nothing in common and can play on the same afternoon, while a county cup
   * drawn from every club in the world overlaps each of them and must be given a
   * day of its own. Disjointness is asked of the *entry* field rather than of the
   * ties actually drawn, because this is decided when the season is built and the
   * draw has not happened yet: a club that could be in either round is a club that
   * must not be in both.
   *
   * Left out, a slot is treated as overlapping every other round, which is the
   * behaviour every caller had before lanes existed: one round to a Sunday. That
   * is what a world with a single ladder wants anyway, and what a legacy caller
   * still gets without changing a line.
   *
   * Set when empty, an entry field of no clubs overlaps nobody and may share with
   * anybody — the honest reading of "this round has no field", which is how a
   * competition whose entrants are not yet known is described.
   */
  clubs?: readonly ClubId[];
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
 * A cup round's slot, and what became of it.
 *
 * `date` is null when the round could not be given a day of its own, and
 * `reason` says why — because a round with no date is a round that can never be
 * drawn, and a competition that can never be drawn is one that never reaches a
 * winner.
 */
export interface PlacedCupSlot extends CupRoundSlot {
  /** The Sunday the round was given, or null when the calendar had none to give it. */
  date: ISODate | null;
  /** The matchday number the round took in the calendar, or null when it was not placed. */
  matchday: number | null;
  /**
   * The rounds this one shares its date with, in the order they were placed.
   *
   * Empty on a day of its own. Two entries means the two ladders' cups are on
   * the same afternoon, which is the arrangement the lanes exist to allow — and
   * naming them here is what lets the season builder report a *collision* between
   * two named competitions rather than a round that mysteriously had no Sunday.
   */
  shared: PlacedCupSlot[];
  /** Why the round could not be placed, when it could not. */
  reason: string | null;
}

/** The calendar a season's cup rounds were placed in, and the fate of each slot. */
export interface CupRoundPlacement {
  calendar: SeasonCalendarEntry[];
  /** One entry per requested slot, in the order they were requested. */
  slots: PlacedCupSlot[];
  /** The slots that could not be given a date. Empty for a healthy season. */
  unplaced: PlacedCupSlot[];
}

/**
 * Build the calendar for a season of leagues and cups, and report every slot in
 * it.
 *
 * `slots` names the league matchday each cup round precedes, and the clubs its
 * field could draw, which is how it is decided whether two rounds may have the
 * same Sunday. A slot that cannot be placed — pointing at a matchday the league
 * calendar does not have, or with every Sunday within reach of it already taken
 * by a round it overlaps or inside the Christmas break — is reported as unplaced
 * rather than quietly skipped. The calendar itself is unchanged by that
 * reporting; the difference is that the season builder can now tell the two cases
 * apart and refuse the season rather than running a cup that has no date on which
 * to be drawn.
 *
 * Rounds are laid out in the order they are asked for, and each takes the first
 * Sunday on or after its anchor that it can have. Laying them out in request
 * order is what keeps a season that already had names on its calendar exactly the
 * season it was: the founding ladder's rounds are asked for first, so they are
 * placed first, on the dates they have always had.
 */
export function placeCupRounds(
  startDate: ISODate,
  matchdays: number,
  slots: readonly CupRoundSlot[] = [],
): CupRoundPlacement {
  const league = buildSeasonCalendar(startDate, matchdays);
  const extra: SeasonCalendarEntry[] = [];
  const nextMatchday = league.length;
  const placements: PlacedCupSlot[] = [];
  /** The last Sunday given to each competition, so its rounds stay in order. */
  const lastRoundDate = new Map<CompetitionId, ISODate>();

  // Every Sunday already spoken for, and by whom. A league Sunday is spoken for
  // by the whole world — every club plays in one of its divisions — so it is held
  // with no field at all, which overlaps every round that could ask for it.
  const taken: Array<{ date: ISODate; clubs: ReadonlySet<ClubId> | null; entry: PlacedCupSlot | null }> =
    league.map((entry) => ({ date: entry.date, clubs: null, entry: null }));

  /**
   * What is already on a date that this slot's field would collide with.
   *
   * `league` is its own answer rather than an empty list of rounds because a
   * league Sunday speaks for the whole world: it blocks every round, including
   * one whose field would otherwise be free to share, and a report of "no round
   * is on this date" would quietly misread it as a date going spare.
   */
  const blocking = (
    slot: CupRoundSlot,
    date: ISODate,
  ): { blocked: boolean; league: boolean; rounds: PlacedCupSlot[] } => {
    let league = false;
    const rounds: PlacedCupSlot[] = [];
    for (const occupant of taken) {
      if (occupant.date !== date) continue;
      const overlaps =
        occupant.clubs === null ||
        slot.clubs === undefined ||
        slot.clubs.some((clubId) => occupant.clubs!.has(clubId));
      if (!overlaps) continue;
      if (occupant.clubs === null) league = true;
      if (occupant.entry) rounds.push(occupant.entry);
    }
    return { blocked: league || rounds.length > 0, league, rounds };
  };

  for (const slot of slots) {
    const leagueEntry = league[slot.beforeMatchday - 1];
    if (!leagueEntry) {
      placements.push({
        ...slot,
        date: null,
        matchday: null,
        shared: [],
        reason: `its anchor, league matchday ${slot.beforeMatchday}, is not in a ${matchdays}-matchday league calendar`,
      });
      continue;
    }
    const anchor = cupRoundDate(leagueEntry.date);
    // The eight Sundays within reach of the anchor, nearest first. A round takes
    // the first one it can have and steps over the ones it cannot rather than
    // being refused by them.
    //
    // A round whose slot falls in the Christmas fortnight moves on to the next
    // Sunday out of it rather than being dropped. Dropping it left the round with
    // no date at all: the competition could then never finish, because a
    // knockout tie that has never been drawn is a tie nobody is ever waiting for.
    //
    // The skip was easy to miss because the league calendar steps *over*
    // Christmas by a whole fortnight, so the Sunday a round inherits from a
    // matchday that had already jumped the break can land back inside it.
    //
    // And a Sunday has to be one no club in this round's field is already
    // playing on, not merely the next Sunday: stepping forward seven days from a
    // dead Christmas Sunday lands straight back on a league matchday, which put a
    // last-sixteen tie and a quarter-final on the same afternoon and had every
    // club in both playing twice. An overlapping *cup* round is the same danger
    // with a different name — a county cup tie and a ladder's own cup tie on one
    // afternoon is a club picked for both — while two ladders' rounds have no club
    // in common and share the day happily.
    // How far a round may be moved from the Sunday it was anchored to.
    //
    // To the end of the season, and the week after it. A round anchored to a
    // Sunday with no room near it used to have eight weeks to find one, which was
    // enough while a county had two ladders and their cups and plates between
    // them: eight rounds of the county's own cup could always find an afternoon
    // the ladders' football was not on, however crowded the spring became. It is
    // not enough for a county of six districts, whose two cups a level can no
    // longer carry — six League Cups, six Plates and a county cup drawn from every
    // club in the county is seventy-five rounds to date on twenty-two free
    // Sundays, and the last of them are anchored in the weeks the others need. The
    // season itself is the limit, which is the honest one: a round is moved as far
    // as it takes to be played inside the season that drew it, and the round is
    // refused rather than squeezed in if even that is not far enough.
    const lastSunday = addDays(league[league.length - 1]!.date, 7);
    // And no round of a competition may be played before one of its own that is
    // already dated: with a whole season to move a round into, a later round could
    // otherwise find room in an earlier week than the round it is supposed to
    // follow.
    const notBefore = slot.competitionId ? (lastRoundDate.get(slot.competitionId) ?? null) : null;
    let candidate: ISODate | null = null;
    let christmas = true;
    let clash: { league: boolean; rounds: PlacedCupSlot[] } | null = null;
    for (let sunday = anchor; sunday <= lastSunday; sunday = addDays(sunday, 7)) {
      if (isChristmasBreak(sunday)) continue;
      christmas = false;
      if (notBefore !== null && sunday <= notBefore) continue;
      const occupied = blocking(slot, sunday);
      if (!occupied.blocked) {
        candidate = sunday;
        break;
      }
      clash = occupied;
    }
    if (candidate === null) {
      placements.push({
        ...slot,
        date: null,
        matchday: null,
        shared: [],
        reason: christmas
          ? `every Sunday between ${anchor} and the end of the season falls in the Christmas break`
          : `every Sunday from ${anchor} to the end of the season is already taken${
              clash && !clash.league && clash.rounds.length > 0
                ? ' by another cup round whose field this one overlaps'
                : clash?.league
                  ? ' by a league matchday'
                  : ''
            }`,
      });
      continue;
    }
    const date = candidate;
    const entry: SeasonCalendarEntry = { matchday: nextMatchday + extra.length + 1, date };
    extra.push(entry);
    const placed: PlacedCupSlot = { ...slot, date: entry.date, matchday: entry.matchday, shared: [], reason: null };
    // Whoever else is already on this afternoon: the same date, a field it does
    // not overlap, and so a round that is played alongside this one rather than
    // instead of it.
    for (const occupant of taken) {
      if (occupant.date !== date || occupant.entry === null) continue;
      occupant.entry.shared.push(placed);
      placed.shared.push(occupant.entry);
    }
    taken.push({ date, clubs: slot.clubs === undefined ? null : new Set(slot.clubs), entry: placed });
    if (slot.competitionId) lastRoundDate.set(slot.competitionId, date);
    placements.push(placed);
  }

  // Numbered in one sequence, but the numbers are *not* in date order: a cup
  // round is numbered above the league's matchdays while being played on a
  // Wednesday well before the last of them. Sorting by matchday therefore used to
  // leave the calendar reading as though February came before September, and any
  // code that walked it in date order — as the fixture list does — met cup ties
  // dated in the past, which nothing ever plays. Sorted by date, the sequence is
  // the order things actually happen in.
  return {
    calendar: [...league, ...extra].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.matchday - b.matchday)),
    slots: placements,
    unplaced: placements.filter((placement) => placement.date === null),
  };
}

/**
 * The season's calendar, cups included.
 *
 * The calendar on its own, for a caller with nothing to say about the slots.
 * The season builder uses {@link placeCupRounds} instead, so it can refuse a
 * season whose cup rounds could not all be dated.
 */
export function buildSeasonCalendarWithCups(
  startDate: ISODate,
  matchdays: number,
  slots: readonly CupRoundSlot[] = [],
): SeasonCalendarEntry[] {
  return placeCupRounds(startDate, matchdays, slots).calendar;
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
