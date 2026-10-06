import type { Message } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import { communicationStore } from './store';

/**
 * Saying a thing once.
 *
 * Every announcement the club makes to the manager is caused by a fact that
 * already exists somewhere — a roll, a letter, a missed instalment, a knock. The
 * danger is not that the fact is wrong; it is that the same fact is *said* three
 * times: once when the day is processed, once when a save is reloaded on the same
 * day, and once for every route into the code. A Sunday League manager stops
 * reading an inbox that repeats itself.
 *
 * So every message that is prompted by a fact carries the fact's key on it, in
 * `context.deliveryKey`, and nothing is written until the key is checked. The key
 * is built from the facts that make the event unique — a person and a day, a deal
 * and a season, an admin letter's own id — so it is stable across a reload and
 * changes only when the underlying event genuinely changes.
 *
 * This is deliberately *not* a store of its own. The conversations are the
 * record: the keys are on the messages that were actually sent, so there is
 * nothing to keep in step and nothing to rebuild on load. A save that predates
 * the key simply has no key, and the next event is announced as though it were
 * new — which, from the manager's point of view, it is.
 */

/** The context field a message carries its fact's key in. */
const DELIVERY_KEY = 'deliveryKey';

/**
 * A stable key for one underlying fact.
 *
 * Parts are joined with a separator that cannot appear in the ids and dates the
 * keys are built from, so `['a', 'b:1']` and `['a:b', '1']` can never collide.
 */
export function deliveryKey(...parts: Array<string | number>): string {
  return parts.map((part) => String(part)).join(':');
}

/** The fact a message was about, or null if it was not prompted by one. */
export function messageKey(message: Message): string | null {
  const value = message.context?.[DELIVERY_KEY];
  return typeof value === 'string' ? value : null;
}

/**
 * Has this fact already been said, in any thread?
 *
 * Scans every conversation rather than a side index, for the same reason the
 * communication store has no index: a career holds a handful of conversations,
 * and an index is a second thing that can disagree with the record it indexes.
 */
export function hasDelivered(state: GameState, key: string): boolean {
  for (const conversation of Object.values(communicationStore(state).conversations)) {
    if (conversation.messages.some((message) => message.context?.[DELIVERY_KEY] === key)) return true;
  }
  return false;
}

/** The context a message carrying a fact should be written with. */
export function deliveryContext(
  key: string,
  extra: Record<string, string | number> = {},
): Record<string, string | number> {
  return { [DELIVERY_KEY]: key, ...extra };
}
