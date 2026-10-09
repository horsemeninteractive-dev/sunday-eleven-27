import { useSyncExternalStore } from 'react';
import type { GameState } from '@/domain/game';
import { useGameStore } from '@/state/gameStore';
import { careerFileName, exportCareer, parseCareerFile, type ImportedCareer } from '@/state/careerFile';
import { saveTextFile } from '@/platform/files';

/**
 * Reading a career out of a file, and handing it to the game.
 *
 * The manager is in the middle of this flow on purpose: a file is chosen, what
 * was found in it is put to him by name, and he says yes or no. Everything here
 * is about the two rules that make that safe to offer at all —
 *
 *  - **nothing is applied without being confirmed.** A file read from disk is
 *    *staged*: held beside the game, described, and discarded for nothing if he
 *    says no. Cancelling is not an undo because nothing was done.
 *  - **nothing is applied that could not be kept.** Opening it and storing it
 *    are one step in that order (see `importCareer` in the store), so a career
 *    shown on screen is a career that will still be there after a reload. A
 *    browser that refuses the write leaves the game exactly as it was.
 *
 * The staged file lives here rather than in the dialog that reads it because two
 * screens offer the way in — the menu, for a manager restoring a backup onto a
 * new device, and the save screen inside a career — and they must agree about
 * what is currently waiting for an answer.
 */
export interface StagedCareer {
  career: ImportedCareer;
  /** The name of the file it came from, which is what the manager recognises. */
  fileName: string;
  /** The career already on screen, which this one would take over from. */
  replaces: { clubName: string; seasonLabel: string } | null;
}

let staged: StagedCareer | null = null;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** The file waiting for the manager's answer, if any. */
export function stagedCareer(): StagedCareer | null {
  return staged;
}

/** The staged file, as a screen sees it. */
export function useStagedCareer(): StagedCareer | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stagedCareer,
    () => null,
  );
}

/** The career being played, as the confirmation names it. */
export function currentCareerSummary(): { clubName: string; seasonLabel: string } | null {
  const game = useGameStore.getState().game;
  if (!game) return null;
  return {
    clubName: game.clubs[game.userClubId]?.identity.name ?? 'Your club',
    seasonLabel: game.season?.label ?? '',
  };
}

/**
 * Read a file the manager chose, and hold it until he says what to do with it.
 *
 * A file that will not parse never reaches the career on screen: it is turned
 * down with the reason, and any file staged before it is dropped too, so what is
 * waiting for an answer is always the last thing he actually chose.
 */
export function stageCareerFile(fileName: string, text: string): { ok: boolean; error: string | null } {
  const { career, error } = parseCareerFile(text);
  if (!career) {
    staged = null;
    publish();
    useGameStore.setState({ error });
    return { ok: false, error };
  }
  staged = { career, fileName, replaces: currentCareerSummary() };
  publish();
  useGameStore.setState({ error: null });
  return { ok: true, error: null };
}

/** Forget the staged file. Nothing was written, so there is nothing to undo. */
export function cancelImport(): void {
  if (!staged) return;
  staged = null;
  publish();
}

/**
 * Open the staged career.
 *
 * The staged file is kept if opening it failed, so the manager can try again
 * after making room — or export the career he is playing before deciding to give
 * up on it.
 */
export async function confirmImport(): Promise<boolean> {
  const pending = staged;
  if (!pending) return false;
  const opened = await useGameStore.getState().importCareer(pending.career.state, pending.fileName);
  if (opened) {
    staged = null;
    publish();
  }
  return opened;
}

/** The career on screen, as a file the manager can keep. */
export function exportCareerText(state: GameState): { fileName: string; text: string } {
  return { fileName: careerFileName(state), text: exportCareer(state) };
}

/**
 * The sentence the manager reads after a career has been written out.
 *
 * It names the file *and*, when the host knows, the place it was put — which is
 * the whole difference on a phone, where the game writes the file itself rather
 * than letting the browser drop it wherever downloads go. "Written" with no
 * place is a manager hunting through a file manager; the place is the part he
 * can act on.
 */
export function exportNotice(written: { fileName: string; location?: string }): string {
  return written.location
    ? `Career written to ${written.fileName} in ${written.location}. Keep it somewhere you will find it again.`
    : `Career written to ${written.fileName}. Keep it somewhere you will find it again.`;
}

/**
 * Write the career being played out to a file.
 *
 * Returns the name it was written under — and where it went, when the host that
 * wrote it can say, which on a phone is the difference between a manager finding
 * his backup and hunting for it — or the sentence to show when there was nowhere
 * to write it. The career itself is untouched either way: exporting is a copy,
 * never a move.
 *
 * The failure arm is reached whenever the file was *not* written, including in a
 * packaged build whose shell refused it: there is no path here that reports an
 * export that did not happen.
 */
export async function exportCurrentCareer(): Promise<
  { fileName: string; location?: string } | { error: string }
> {
  const game = useGameStore.getState().game;
  if (!game) return { error: 'There is no career open to export. Load one first, then export it.' };
  const { fileName, text } = exportCareerText(game);
  const outcome = await saveTextFile(fileName, text);
  if (outcome.status === 'unsupported') return { error: outcome.error };
  return outcome.location ? { fileName, location: outcome.location } : { fileName };
}
