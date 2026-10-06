import type { ClubId, ISODate } from '@/domain/ids';
import type { GameState } from '@/domain/game';

/**
 * Which communications belong in the club's permanent record.
 *
 * Almost everything the club says to the manager is *conversation*: a knock, a
 * doubt, a letter filed, a payment chased. It belongs in the thread and nowhere
 * else, because a history that records everything records nothing — the manager
 * cannot find the day the club nearly went under among four hundred texts about
 * somebody's knee.
 *
 * A few things are different. A club going into the red, the committee losing
 * patience, a sponsor walking: these are the moments a real Sunday club still
 * talks about in ten years, and they belong on `club.history.notableEvents`
 * beside the promotions and the cup runs. This module is the single place that
 * decides which is which, so the rule is written down once rather than assumed at
 * each call site.
 *
 * The *facts* stay with the systems that own them, exactly as everywhere else in
 * communication: this writes a dated line into a record the club already keeps.
 * It moves no money, closes no letter and changes no standing.
 */

/** The kinds of communication that can earn a line in the club's history. */
export type CommunicationHistoryKind =
  /** The club went into the red, or a run of missed payments. */
  | 'financial-crisis'
  /** The committee raised a serious concern with the manager. */
  | 'governance-concern'
  /** A sponsor arrived, left, or refused to renew. */
  | 'sponsor-event'
  /** A row between people that actually mattered. */
  | 'dispute'
  /** Somebody important left the club. */
  | 'resignation';

/**
 * Whether a kind of communication is significant enough to keep.
 *
 * Kept as data rather than as prose at each call site: a `dispute` is history, a
 * `word about subs` is not, and the difference should be a decision made once.
 * Everything not listed here is conversation history only.
 */
const NOTABLE: Record<CommunicationHistoryKind, boolean> = {
  'financial-crisis': true,
  'governance-concern': true,
  'sponsor-event': true,
  dispute: true,
  resignation: true,
};

export function isNotableHistory(kind: CommunicationHistoryKind): boolean {
  return NOTABLE[kind];
}

export interface CommunicationHistoryEntry {
  kind: CommunicationHistoryKind;
  /**
   * The line the archive will keep, written as the club would say it.
   *
   * Anybody it involved is named here rather than held separately:
   * `ClubHistoryEvent` is a date, a season, a sentence and a weight, because a
   * club reads its own history as prose.
   */
  description: string;
  importance: 1 | 2 | 3;
  /** Whose club it is. Defaults to the manager's. */
  clubId?: ClubId;
  date?: ISODate;
  /**
   * A stable key for the underlying fact, so the same moment cannot be written
   * into the archive twice. Optional: a call site that has already deduplicated
   * its message can leave it out.
   */
  key?: string;
}

/** The same cap every other writer of `notableEvents` uses. */
const HISTORY_LIMIT = 40;
/** The keys already written this career, so a reload cannot double-record. */
const RECORDED = '__communicationHistoryKeys';

interface HistoryCarrier {
  [RECORDED]?: string[];
}

/**
 * Write a significant communication into the club's permanent history.
 *
 * Returns true when the line was kept and false when it was filtered out (not a
 * notable kind), already recorded, or there was no club to write to. Notably it
 * does *not* throw when the club is missing: a communication can outlive the club
 * it was about, and losing a message because the archive is gone would be worse
 * than losing the archive line.
 */
export function recordCommunicationHistory(
  state: GameState,
  entry: CommunicationHistoryEntry,
): boolean {
  if (!isNotableHistory(entry.kind)) return false;
  const clubId = entry.clubId ?? state.userClubId;
  const club = state.clubs[clubId];
  if (!club) return false;

  const key = entry.key ?? `${entry.kind}:${entry.date ?? state.date}:${entry.description}`;
  const carrier = state as GameState & HistoryCarrier;
  const recorded = carrier[RECORDED] ?? [];
  if (recorded.includes(key)) return false;

  club.history.notableEvents.unshift({
    date: entry.date ?? state.date,
    seasonLabel: state.season.label,
    description: entry.description,
    importance: entry.importance,
  });
  if (club.history.notableEvents.length > HISTORY_LIMIT) {
    club.history.notableEvents.length = HISTORY_LIMIT;
  }

  recorded.push(key);
  // Bounded for the same reason the archive is: a career is finite and the keys
  // are only ever consulted for the events that were notable enough to keep.
  if (recorded.length > 200) recorded.splice(0, recorded.length - 200);
  carrier[RECORDED] = recorded;
  return true;
}

/** The history keys already written, so a test can check a moment happened once. */
export function communicationHistoryKeys(state: GameState): string[] {
  return [...((state as GameState & HistoryCarrier)[RECORDED] ?? [])];
}
