import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClubId, ISODate, MatchId, PlayerId } from '@/domain/ids';
import { dossierFreshness, type OppositionDossier } from '@/simulation/intelligence/opposition';
import { OppositionReport, evidenceLine, reportRows } from './OppositionReport';

/**
 * The opposition report on the tactics screen.
 *
 * What is pinned here is not how the report is laid out — that is a judgement,
 * and it is made by looking at the screen — but the three things a report about
 * another football team can be *wrong* about:
 *
 *  - that it prints a reading of their game when nobody has watched them, which
 *    is the whole thing the dossier exists to refuse;
 *  - that a fact and an inference from one look the same, so a manager cannot
 *    tell which of the two he is acting on;
 *  - that it hides how much of it there is, so a single afternoon reads like a
 *    season of scouting.
 *
 * The dossier itself is not built here: what `intelligence/opposition.ts` reads
 * out of the match records is its own file's business. This one is fed a dossier
 * and asked what the manager would see.
 */

const OPPONENT = 'club_opponent' as ClubId;
const SEEN = 'match_seen' as MatchId;
const UNSEEN = 'match_unseen' as MatchId;

function dossier(overrides: Partial<OppositionDossier> = {}): OppositionDossier {
  return {
    clubId: OPPONENT,
    clubName: 'Draywick Rovers',
    clubShortName: 'Draywick',
    plan: {
      label: 'Direct and physical',
      formation: '4-4-2',
      lines: [
        'They set out 4-4-2, direct and physical.',
        'Ordinary tempo, getting it forward early.',
      ],
    },
    results: [],
    observed: [],
    form: '1W 0D 1L in their last 2 — H 2–1, A 0–2',
    reads: [],
    keyPlayers: [],
    summary: [],
    evidence: {
      matches: 0,
      watchedByYou: 0,
      watchedByStaff: 0,
      staffName: null,
      earliest: null,
      latest: null,
    },
    empty: true,
    ...overrides,
  };
}

function watching(overrides: Partial<OppositionDossier['evidence']> = {}): OppositionDossier['evidence'] {
  return {
    matches: 2,
    watchedByYou: 1,
    watchedByStaff: 1,
    staffName: 'Andy Wells',
    earliest: '2026-09-06' as ISODate,
    latest: '2026-10-04' as ISODate,
    ...overrides,
  };
}

const seenMatch = {
  matchId: SEEN,
  date: '2026-10-04' as ISODate,
  matchday: 8,
  competition: 'Division Three',
  venue: 'H' as const,
  opponentName: 'Holmere Athletic',
  score: '2–1',
  outcome: 'W' as const,
  formation: '4-4-2' as const,
  goalsFor: 2,
  goalsAgainst: 1,
  possession: 48,
  shots: 11,
  corners: 6,
  fouls: 13,
  yellowCards: 2,
  sentOff: 0,
  scorers: [],
  concededMinutes: [81],
  startingIds: ['p1' as PlayerId],
  source: 'you' as const,
};

const unseenMatch = {
  ...seenMatch,
  matchId: UNSEEN,
  date: '2026-09-27' as ISODate,
  venue: 'A' as const,
  opponentName: 'Barrow Hill',
  score: '0–2',
  outcome: 'L' as const,
  source: 'the club' as const,
};

describe('the opposition report', () => {
  it('prints the honest answer — results, and nothing else — until somebody watches them', () => {
    const empty = dossier({ results: [
      { ...seenMatch, source: 'you' as const },
    ] });

    expect(reportRows(empty)).toEqual([]);
    expect(evidenceLine(empty)).toMatch(/nothing watched/i);
    expect(empty.empty).toBe(true);

    const html = renderToStaticMarkup(createElement(OppositionReport, { dossier: empty }));
    // It says so, up front, rather than dressing the results up as a reading.
    expect(html).toContain('Only the results so far');
    expect(html).toContain('4-4-2');
    // No read of their game is printed, and the results still are: they are
    // public, and a manager reads them whether anybody watched or not.
    expect(html).not.toContain('Their game, up close');
    expect(html).toContain('Holmere Athletic');
  });

  it('marks a fact and a reading as different things', () => {
    const read = dossier({
      empty: false,
      evidence: watching(),
      observed: [seenMatch, unseenMatch],
      reads: [
        {
          id: 'output',
          title: 'What they do with it',
          lines: ['1.5 goals a game in the 2 you have a record of.'],
          matches: 2,
          source: 'From the match you were at and 1 Andy Wells watched.',
          confidence: 'known',
          kind: 'fact',
        },
        {
          id: 'change',
          title: 'Anything new',
          lines: ['Nothing has changed: the same shape all season.'],
          matches: 2,
          source: 'Their recent matches, against what the club saw earlier.',
          confidence: 'reported',
          kind: 'interpretation',
        },
      ],
    });

    const rows = reportRows(read);
    expect(rows.map((row) => row.kindLabel)).toEqual(['Seen', 'Reading']);
    expect(rows.map((row) => row.confidenceLabel)).toEqual(['Known', 'Reported']);

    const html = renderToStaticMarkup(createElement(OppositionReport, { dossier: read }));
    // Both the kind of statement and how far it can be trusted are on the page,
    // in words: a tint is not something a manager can read.
    expect(html).toContain('Seen');
    expect(html).toContain('Reading');
    expect(html).toContain('Known');
    expect(html).toContain('From the match you were at and 1 Andy Wells watched.');
    // And each read carries how many afternoons it rests on.
    expect(html).toContain('2 matches');
  });

  it('says how much there is behind the report, and who watched it', () => {
    expect(evidenceLine(dossier({ evidence: watching() }))).toBe(
      `2 matches watched · 1 by you · 1 by Andy Wells. ${dossierFreshness(dossier({ evidence: watching() }))}.`,
    );
    // All of it by the manager himself, which is as good as it gets.
    expect(evidenceLine(dossier({ evidence: watching({ watchedByYou: 3, watchedByStaff: 0, matches: 3, staffName: null }) }))).toContain(
      '3 matches watched · all by you',
    );
    // Nobody in particular at the club: the report does not invent a scout.
    expect(
      evidenceLine(dossier({ evidence: watching({ watchedByYou: 0, watchedByStaff: 2, staffName: null }) })),
    ).toContain('2 matches watched · 2 by the club');
    // One afternoon, and it says so: it does not dress a hunch as a pattern.
    expect(evidenceLine(dossier({ evidence: watching({ matches: 1, watchedByYou: 1, watchedByStaff: 0 }) }))).toContain(
      '1 match watched',
    );
  });

  it('lists their side’s danger men out of the evidence', () => {
    const read = dossier({
      empty: false,
      evidence: watching(),
      observed: [seenMatch],
      keyPlayers: [
        {
          playerId: 'p9' as PlayerId,
          name: 'A. Pearce',
          position: 'ST',
          note: '2 goals in the 2 matches you have a record of.',
          matches: 2,
          goals: 2,
        },
      ],
    });
    const html = renderToStaticMarkup(createElement(OppositionReport, { dossier: read }));
    expect(html).toContain('Who to watch out for');
    expect(html).toContain('A. Pearce');
    expect(html).toContain('2 goals in the 2 matches you have a record of.');
  });

  it('keeps every result, and marks the ones that were actually watched', () => {
    const read = dossier({
      empty: false,
      evidence: watching(),
      observed: [seenMatch],
      results: [seenMatch, unseenMatch],
    });
    const html = renderToStaticMarkup(createElement(OppositionReport, { dossier: read }));
    expect(html).toContain('Barrow Hill');
    expect(html).toContain('you were there');
    // The unwatched result is printed as a result and nothing more: the report
    // never claims an afternoon nobody spent.
    expect(html.match(/watched by the club/g)?.length ?? 0).toBe(0);
  });
});
