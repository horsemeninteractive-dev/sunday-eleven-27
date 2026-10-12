import type { ClubId, ISODate, PersonId, TownId } from './ids';

/**
 * The local press.
 *
 * Sunday league football is covered by people who are part of the same county:
 * a reporter on the free paper, a fanzine written by two lads in a back bedroom,
 * a hospital-radio slot nobody admits to listening to. They do not know
 * everything and they do not write about everything — which is the whole point
 * of modelling them rather than writing headlines from the simulation directly.
 *
 * Three things live here and nowhere else:
 *
 *   - **who exists** — a small, persistent set of publications and the people
 *     who write for them, generated once from the world and kept for the career;
 *   - **what they cover** — each reporter has a *beat*: the clubs nearest the
 *     paper they write for. Beats are geography, so they survive promotion and
 *     relegation and a reporter follows the same clubs for seasons at a time;
 *   - **what they only think they know** — a rumour, which is a claim with a
 *     source, a subject, some evidence and a date on which the world either
 *     bears it out or does not.
 *
 * The press never writes a fact it does not have an event for, and never reads
 * a hidden attribute: `simulation/press.ts` decides coverage from the same
 * structured events every other system reads, and `reliability` says how much a
 * reader should believe a claim rather than how true it is.
 */

export type PublicationKind =
  /** The free paper that comes through the door and prints every result. */
  | 'gazette'
  /** The paid weekly, older than most of the clubs it covers. */
  | 'herald'
  /** Written by supporters, printed in small numbers, honest to a fault. */
  | 'fanzine'
  /** A Sunday morning slot on community radio. */
  | 'radio'
  /** A website that posts at eleven on a Sunday night. */
  | 'site';

export const PUBLICATION_KIND_LABEL: Record<PublicationKind, string> = {
  gazette: 'Local paper',
  herald: 'Weekly paper',
  fanzine: 'Supporters’ fanzine',
  radio: 'Community radio',
  site: 'Local football website',
};

/**
 * A paper, a station or a fanzine.
 *
 * Held in the save rather than derived on demand, because the whole value of it
 * is that it is the *same* publication in March as it was in September, and the
 * same one again three seasons later. Its town is where it is based, which is
 * also what decides which clubs its reporters can reasonably get to.
 */
export interface Publication {
  id: string;
  name: string;
  kind: PublicationKind;
  townId: TownId;
  /** The year it was founded, for the masthead. */
  founded: number;
  /** One line of house style, shown wherever the paper is introduced. */
  strapline: string;
}

/** What a reporter is interested in, which decides what he bothers with. */
export type PressFocus =
  /** Scores, tables, promotion races. */
  | 'results'
  /** The books, the sponsors and the state of the ground. */
  | 'money'
  /** People: arrivals, departures, rows and comebacks. */
  | 'people'
  /** The town and the club around the football. */
  | 'community';

export const PRESS_FOCUS_LABEL: Record<PressFocus, string> = {
  results: 'Results and the table',
  money: 'The books and the ground',
  people: 'People and comings and goings',
  community: 'The town and the club',
};

/**
 * A reporter.
 *
 * Deliberately a *person*, not a byline string: he has a paper, a patch, a
 * particular thing he cares about, and a view of the manager that his coverage
 * reflects. His `beats` are the clubs he actually follows, so a story about a
 * club he does not cover is not a story he writes.
 */
export interface Journalist {
  id: PersonId;
  firstName: string;
  surname: string;
  publicationId: string;
  /** Where he is based — the publication's town, and the centre of his patch. */
  townId: TownId;
  focus: PressFocus;
  /** The clubs on his beat, nearest first. A partition of the county's clubs. */
  beats: ClubId[];
  /** The season he started covering this patch. */
  since: ISODate;
  /**
   * 0-100: how the manager has left things with him. 50 is civil, which is what
   * a reporter who has never been snubbed or favoured is. It colours how his
   * claims are read, never what he is allowed to know.
   */
  regard: number;
  /** How many stories he has filed. Flavour, and a bound on nothing. */
  filings: number;
  lastFiledOn: ISODate | null;
}

/**
 * The kind of thing being claimed.
 *
 * The subject decides both what the claim is and — more importantly — how the
 * world settles it later, because each subject names a fact the game already
 * keeps. A rumour with no fact under it cannot be confirmed or disproved and is
 * therefore not allowed to exist.
 */
export type RumourSubject =
  /** A manager's position: patience at the committee, an AGM, a bad month. */
  | 'manager'
  /** Numbers: somebody struggling to field a side. */
  | 'availability'
  /** The books: a club in the red, a sponsor walking away. */
  | 'money'
  /** A name: somebody said to be leaving, or being watched. */
  | 'transfer';

export const RUMOUR_SUBJECT_LABEL: Record<RumourSubject, string> = {
  manager: 'Manager under pressure',
  availability: 'Short of players',
  money: 'Money trouble',
  transfer: 'Player movement',
};

export type RumourStatus =
  /** Filed, and nothing has settled it either way yet. */
  | 'unverified'
  /** The world did what the claim said it would. */
  | 'confirmed'
  /** It did not. */
  | 'disproved'
  /** The question stopped mattering — the club folded, the season turned over. */
  | 'stale';

export const RUMOUR_STATUS_LABEL: Record<RumourStatus, string> = {
  unverified: 'Unconfirmed',
  confirmed: 'Confirmed',
  disproved: 'Wide of the mark',
  stale: 'Gone quiet',
};

/**
 * A claim, with a source.
 *
 * A rumour is a real record rather than a sentence in the news feed, because
 * three things have to be true of it and none of them can be held in prose:
 *
 *   - it has a **source** (the reporter who heard it) and a **subject** (the
 *     club, and sometimes the person, it is about);
 *   - it carries the **evidence** it was built from and the **reliability** the
 *     reader should accord it — which are two different numbers, and the whole
 *     point is that they are;
 *   - it is settled on a date, against what actually happened. Nothing in the
 *     simulation reads a rumour to decide anything: the claim follows the
 *     world, the world never follows the claim.
 */
export interface Rumour {
  id: string;
  /** Stable key, so the same whisper is never printed twice. */
  key: string;
  date: ISODate;
  subject: RumourSubject;
  status: RumourStatus;
  journalistId: PersonId;
  clubIds: ClubId[];
  personIds: PersonId[];
  /** The claim in the claimant's words, hedged the way a claimant hedges. */
  claim: string;
  /** 0-1: how solid the thing it was built from was. */
  evidence: number;
  /** 0-1: source and evidence together — what a reader is being asked to believe. */
  reliability: number;
  /** The day it is settled against the world. */
  resolvesOn: ISODate;
  /**
   * The fact the claim was built on, and what it read at the time.
   *
   * Kept so the settlement is a comparison rather than a re-guess: "the club's
   * manager was X" is checkable, and it is also what makes a rumour falsifiable
   * — without a pre-image there is nothing to disprove.
   */
  basis: { key: string; value: string };
  /** What was actually found, once it was settled. */
  outcome: string | null;
  settledOn: ISODate | null;
  /**
   * How many times a settlement has been put off.
   *
   * The one claim that is allowed to stay open is a question that the world
   * keeps refusing to answer — a manager still under pressure when the season
   * ends, say. It is deferred once and then answered, so no claim can hang
   * around for ever waiting for a convenient truth.
   */
  extensions?: number;
}

/** Something the manager said, and about what. */
export interface PressStatement {
  rumourId: string;
  journalistId: PersonId;
  date: ISODate;
  /** `declined` plays a claim down; `acknowledged` concedes a little of it. */
  kind: 'declined' | 'acknowledged';
}

/**
 * The press record.
 *
 * Kept small on purpose: a handful of publications, one reporter each, the
 * claims still in play, what the manager has said, and the keys of the stories
 * already printed — the last of which is what stops a day being processed twice
 * from printing its news twice.
 */
export interface PressState {
  publications: Publication[];
  journalists: Journalist[];
  /** The claims still live, newest first. Bounded. */
  rumours: Rumour[];
  /** Story keys already printed. A bounded ring, oldest first. */
  filed: string[];
  statements: PressStatement[];
  /** The season the beats were last drawn for, so they can be redrawn. */
  beatsDrawnFor: string | null;
}

export function emptyPressState(): PressState {
  return { publications: [], journalists: [], rumours: [], filed: [], statements: [], beatsDrawnFor: null };
}

/** How many claims the paper can have in the air at once. */
export const MAX_LIVE_RUMOURS = 6;

/** How many story keys are remembered before the oldest are forgotten. */
export const FILED_KEY_LIMIT = 500;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * How much a reader should believe a claim.
 *
 * Two inputs, deliberately kept apart in the arithmetic so that the two things
 * they mean cannot be confused: a reporter the manager is on good terms with is
 * heard out, and something with real evidence under it is worth more than a
 * hunch. A claim can be believed and false — which is exactly what the
 * settlement is for.
 */
export function reliabilityOf(evidence: number, regard: number): number {
  const source = 0.35 + (Math.max(0, Math.min(100, regard)) / 100) * 0.4;
  return Math.round(clamp01(source * 0.45 + clamp01(evidence) * 0.55) * 100) / 100;
}

/** How a live claim reads in a strapline: unconfirmed, or settled and how. */
export function confidenceOf(rumour: Pick<Rumour, 'status'>): 'unverified' | 'confirmed' | 'disproved' | 'stale' {
  return rumour.status;
}
