import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { VERSION } from '@/version';
import {
  CAREER_FILE_FORMAT,
  CAREER_FILE_VERSION,
  careerFileName,
  clubSlug,
  exportCareer,
  parseCareerFile,
  type CareerFile,
} from './careerFile';

/**
 * The career file, from both ends.
 *
 * One world is built here and reused by every test: generating a pyramid of
 * clubs with squads is the expensive part of this file's work, and none of these
 * tests is about generating one. Everything else is text in, answer out — this
 * module never touches a database, so the suite is a pure read of what a file
 * means.
 *
 * The rejections get as much attention as the round trip, and deliberately. The
 * happy path is one case a manager will hit; the unhappy ones are what decide
 * whether a wrong file costs him a career or a sentence, and every one of them
 * has to say something different, because a message that only says "no" leaves
 * him choosing between trying again and giving up.
 */
const SEED = 'career-file';
const draft = generateDraft({ seed: SEED, startYear: 2026 });
const state: GameState = startGameFromDraft(draft, {
  seed: SEED,
  startYear: 2026,
  clubId: draft.divisionClubIds[0]!,
  saveName: 'Test — career file',
});

const WRITTEN_AT = new Date('2026-10-09T12:00:00.000Z');

/** An envelope around the real career, with anything the caller wants changed. */
function envelope(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: CAREER_FILE_FORMAT,
    formatVersion: CAREER_FILE_VERSION,
    app: VERSION,
    version: GAME_STATE_VERSION,
    savedAt: WRITTEN_AT.toISOString(),
    state,
    ...patch,
  } satisfies Record<string, unknown>);
}

/** A copy of the career, damaged however the test needs it damaged. */
function damaged(mutate: (copy: GameState) => void): GameState {
  const copy = structuredClone(state);
  mutate(copy);
  return copy;
}

/** Read a file that is meant to be refused, and hand back the sentence. */
function rejection(raw: string): string {
  const { career, error } = parseCareerFile(raw);
  expect(career).toBeNull();
  expect(error).toBeTruthy();
  return error!;
}

describe('writing a career out', () => {
  it('writes a file that says what it is, who wrote it and what is inside it', () => {
    const file = JSON.parse(
      exportCareer(state, WRITTEN_AT),
    ) as CareerFile;

    expect(file.format).toBe(CAREER_FILE_FORMAT);
    expect(file.formatVersion).toBe(CAREER_FILE_VERSION);
    expect(file.app).toBe(VERSION);
    expect(file.version).toBe(GAME_STATE_VERSION);
    expect(file.savedAt).toBe('2026-10-09T12:00:00.000Z');
    // The career itself, not a summary of it: the same world the database holds.
    expect(file.state.date).toBe(state.date);
    expect(file.state.seed).toBe(state.seed);
    expect(file.state.userClubId).toBe(state.userClubId);
  });

  it('reads back everything a career needs, through the migrations the database uses', () => {
    const { career, error } = parseCareerFile(exportCareer(state));

    expect(error).toBeNull();
    expect(career).not.toBeNull();
    expect(career!.date).toBe(state.date);
    expect(career!.seed).toBe(state.seed);
    expect(career!.saveName).toBe(state.saveName);
    expect(career!.clubName).toBe(state.clubs[state.userClubId]!.identity.name);
    expect(career!.seasonLabel).toBe(state.season.label);
    expect(career!.writtenBy).toBe(VERSION);
    expect(career!.fromVersion).toBe(GAME_STATE_VERSION);
    // A career is stored whole or not at all: no part of the world is left behind.
    expect(Object.keys(career!.state.people)).toHaveLength(Object.keys(state.people).length);
    expect(Object.keys(career!.state.clubs)).toHaveLength(Object.keys(state.clubs).length);
    expect(Object.keys(career!.state.matches)).toHaveLength(Object.keys(state.matches).length);
    expect(career!.state.version).toBe(GAME_STATE_VERSION);
  });

  it('brings an older save forward on the way in, rather than refusing it', () => {
    // A file written before the manager's own shapes existed. What is being
    // proved is not that one migration works but that importing goes through the
    // same reader a stored career does, so an old backup is as good as a new one.
    const older = damaged((copy) => {
      delete (copy as { customFormations?: unknown }).customFormations;
    });
    const read = parseCareerFile(envelope({ version: 15, state: older }));

    expect(read.error).toBeNull();
    expect(read.career!.state.customFormations).toEqual([]);
    expect(read.career!.state.version).toBe(GAME_STATE_VERSION);
    expect(read.career!.fromVersion).toBe(15);
  });

  it('names the file after the game, the club and the in-game date', () => {
    const name = careerFileName(state);
    expect(name).toMatch(/^sunday-eleven-27-career-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/);
    expect(name).toContain(clubSlug(state));
    expect(name).toContain(state.date);
  });

  it('reduces a club name to something every filesystem will take', () => {
    const awkward = damaged((copy) => {
      copy.clubs[copy.userClubId]!.identity.name = "St. Mary's & Sons F.C.";
    });
    expect(clubSlug(awkward)).toBe('st-mary-s-sons-f-c');

    // A name with nothing usable in it still has to produce a file name: 'career'
    // is a dull answer, but an empty one is not a file anybody can find again.
    const unusable = damaged((copy) => {
      copy.clubs[copy.userClubId]!.identity.name = '###';
    });
    expect(clubSlug(unusable)).toBe('career');

    // Whatever the name is, the slug is safe to put in a path.
    const long = damaged((copy) => {
      copy.clubs[copy.userClubId]!.identity.name = `  ${'Bramford United '.repeat(6)}  `;
    });
    const slug = clubSlug(long);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(48);
  });
});

describe('a file that is not a career', () => {
  it('turns down something that is not JSON at all', () => {
    expect(rejection('not json')).toMatch(/could not be read/i);
    expect(rejection('{"format":"se27.career",')).toMatch(/could not be read/i);
  });

  it('turns down JSON that is not an object', () => {
    for (const raw of ['[]', 'null', '42', '"a career"']) {
      expect(rejection(raw)).toMatch(/not a career file/i);
    }
  });

  it('names the other application when the file belongs to one', () => {
    expect(rejection(JSON.stringify({ format: 'fm24.sav', version: 16, state }))).toMatch(
      /another application/i,
    );
  });

  it('turns down a newer file version, naming both versions', () => {
    const error = rejection(envelope({ formatVersion: CAREER_FILE_VERSION + 1 }));
    expect(error).toMatch(/newer version of the game/i);
    expect(error).toMatch(/file v2/);
    expect(error).toMatch(/reads v1/);
  });

  it('turns down a career written by a newer game', () => {
    const error = rejection(envelope({ version: GAME_STATE_VERSION + 1 }));
    expect(error).toMatch(/newer version of the game/i);
    expect(error).toContain(`save v${GAME_STATE_VERSION + 1}`);
  });

  it('turns down an envelope with no career in it', () => {
    // A file that was cut short while it was being written looks exactly like
    // this, which is why the sentence says so rather than blaming the manager.
    const noVersion = JSON.parse(envelope()) as Record<string, unknown>;
    delete noVersion.version;
    expect(rejection(JSON.stringify(noVersion))).toMatch(/no career in it/i);

    const noState = JSON.parse(envelope()) as Record<string, unknown>;
    delete noState.state;
    expect(rejection(JSON.stringify(noState))).toMatch(/no career in it/i);
  });

  it('turns down a career whose club is not in it', () => {
    const stranger = damaged((copy) => {
      copy.userClubId = 'club_that_never_was';
    });
    expect(rejection(envelope({ state: stranger }))).toMatch(/missing the club/i);
  });

  it('reports a career that will not migrate as corrupted, rather than throwing', () => {
    const broken = damaged((copy) => {
      (copy as { people: unknown }).people = null;
    });
    expect(rejection(envelope({ state: broken }))).toMatch(/corrupted/i);
  });

  it('gives every refusal its own sentence', () => {
    // One message for everything would be easier to write and useless to read:
    // the manager has to know whether to pick another file, update the game, or
    // go looking for a backup.
    const messages = [
      rejection('not json'),
      rejection('[]'),
      rejection(JSON.stringify({ format: 'fm24.sav', version: 16, state })),
      rejection(envelope({ formatVersion: CAREER_FILE_VERSION + 1 })),
      rejection(envelope({ version: GAME_STATE_VERSION + 1 })),
      rejection(envelope({ state: damaged((copy) => { copy.userClubId = 'nobody'; }) })),
      rejection(envelope({ state: damaged((copy) => { (copy as { people: unknown }).people = null; }) })),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});
