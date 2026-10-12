import type { GameState } from '@/domain/game';
import { HOME_MATTER_LIMIT, clubMatters, type ClubMatter } from './clubMatters';
import { inboxRows } from './inboxState';

/**
 * What Home says, and in what order.
 *
 * Home answers three questions in the order a manager asks them — *what is
 * happening at my club*, *what needs me*, and *what should I do next* — and the
 * screen is arranged around those three rather than around the four things the
 * simulation happens to know. The decisions that make that arrangement mean
 * anything are here, in plain functions over the game state, and not in the view:
 * which matter leads, what is left underneath it, and what the manager is only
 * being *told*.
 *
 * It is a separate module for the reason `commandState.ts` and `newsStory.ts` are:
 * the awkward parts of a screen should be testable without a browser, and a rule
 * that only exists inside a component is a rule nobody can check. There is no
 * JSX here and no store, so every rule below is two lines of plain data — see
 * `homeBriefing.test.ts`.
 *
 * Nothing here decides what matters. `clubMatters` is the one model for that, and
 * it is the same model the Club screen reads, so the two screens cannot disagree
 * about what a manager should be looking at. What this module decides is the
 * *reading* of that list: one thing in front, the rest behind it, and the post
 * that is not asking for anything kept out of the way.
 */

/** How many matters Home draws, on top of the lead already counted in them. */
export const HOME_VISIBLE_LIMIT = HOME_MATTER_LIMIT;

export interface HomeBriefing {
  /**
   * The one thing in front: the loudest genuine *decision* the club has.
   *
   * A matter written as information — "new kit for the season", "the club has no
   * sponsor" — is worth a line and is not worth the front of the screen, so a
   * decision leads even when an informational note outweighs it. Only when there
   * is nothing but information does one of those lead, because a note is still
   * more use than an empty band.
   */
  lead: ClubMatter | null;
  /** Everything else the model said, in its own order, loudest first. */
  rest: ClubMatter[];
  /**
   * Mail that has arrived and is not asking for anything: no question, no
   * priority, no answer wanted. `null` when there is none, so the line is not
   * drawn at all — an empty "0 unread" is a statistic about nothing.
   */
  waiting: { threads: number; messages: number } | null;
  /**
   * How many matters the limit kept off the screen entirely.
   *
   * Counted rather than guessed, so the door to the Club screen can say what is
   * behind it without a second pass over the model.
   */
  beyond: number;
}

export function homeBriefing(game: GameState, limit = HOME_VISIBLE_LIMIT): HomeBriefing {
  const shown = clubMatters(game, limit);
  const all = clubMatters(game, 0);
  const lead = leadMatter(shown);

  return {
    lead,
    rest: shown.filter((matter) => matter !== lead),
    waiting: waitingMail(game),
    beyond: Math.max(0, all.length - shown.length),
  };
}

/**
 * Which matter goes in front.
 *
 * Split out from the reading of the whole list because it is the one judgement
 * here that is worth arguing with, and an argument is easier to settle against
 * six rows somebody typed than against a generated career: a decision leads, a
 * note leads only when there is nothing else, and an empty list has no lead at
 * all. The rest of the order is the model's, unchanged.
 */
export function leadMatter(matters: readonly ClubMatter[]): ClubMatter | null {
  return matters.find((matter) => matter.tone !== 'info') ?? matters[0] ?? null;
}

/**
 * The messages that are waiting but not asking.
 *
 * `clubMatters` gives a card to the mail that demands attention — the treasurer
 * saying the account is empty, a player answering a question he was asked — and
 * that is the whole reason priorities exist. What is left is the ordinary post:
 * unread, unanswered, and not urgent, which is exactly the kind of thing Home
 * should *mention* rather than put a card in front of the manager for. Threads
 * and messages are counted separately because they are different facts — six
 * things to read is one job, six threads is six.
 */
function waitingMail(game: GameState): { threads: number; messages: number } | null {
  const rows = inboxRows(game).filter((row) => row.unread > 0 && !row.attention);
  if (rows.length === 0) return null;
  return {
    threads: rows.length,
    messages: rows.reduce((total, row) => total + row.unread, 0),
  };
}

/**
 * What the button on a matter says.
 *
 * The destination already knows what it is — a thread that is waiting, a person
 * to talk to, a screen the fact is dealt with on — so the verb is read from it
 * rather than invented per matter. A button that says the same thing on all
 * three would make the manager open the card to find out what pressing it does,
 * which is the one thing a door should never require.
 */
export function matterActionLabel(matter: Pick<ClubMatter, 'destination'>): string {
  switch (matter.destination?.kind) {
    case 'conversation':
      return 'Read the message';
    case 'person':
      return 'Have a word';
    default:
      return 'Sort it out';
  }
}

/**
 * The line beside the waiting mail, in the manager's words.
 *
 * "None of them urgent" is the claim the data actually supports: these are the
 * threads whose newest message is not marked urgent or important, which is the
 * same test `clubMatters` uses to decide which mail gets a card. It deliberately
 * does not promise that nothing in there wants an answer — an ordinary note can
 * still ask a question — because the screen should not say more than it knows.
 */
export function waitingLine(waiting: { threads: number; messages: number }): string {
  const threads = waiting.threads === 1 ? 'A thread is waiting' : `${waiting.threads} threads are waiting`;
  const messages = waiting.messages === 1 ? '1 unread message' : `${waiting.messages} unread messages`;
  return `${threads}: ${messages}, none of them urgent.`;
}
