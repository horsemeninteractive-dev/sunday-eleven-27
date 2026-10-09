/**
 * The whole of what the game is given, and the whole of what it may ask for.
 *
 * This file runs in Electron's *sandboxed* preload context: it has
 * `contextBridge` and `ipcRenderer` and nothing else — no `fs`, no `path`, no
 * `process`, and no `require` of a file of our own (Electron allows a sandboxed
 * preload `electron`, `events`, `timers` and `url` and refuses everything else,
 * which is why the channel names below are written out as literals instead of
 * being imported from `rules.ts`). `desktopPackaging.test.ts` reads both files
 * and fails if the two sets of names stop agreeing, because a bridge whose ends
 * name the same channel differently is a career file that is silently never
 * written.
 *
 * Three members are exposed, on `window.se27Desktop`, frozen:
 *
 *   - `platform`, so the game can tell it is running in a desktop shell without
 *     guessing from the user agent;
 *   - `saveCareerFile(name, text)`, which asks the main process to write one
 *     career file. It is the *only* way anything reaches a disk, and the main
 *     process validates the name and the contents again before it writes: this
 *     layer is a shape, not a security boundary, and it is written as though the
 *     page on the other side were hostile.
 *   - `onFlushRequested` / `flushDone`, the two halves of the closing handshake
 *     that lets the game finish its last save before the window goes.
 *
 * There is no fourth member. No file system, no shell, no arbitrary IPC, no
 * `require` — the complete list of what a compromised page can reach is those
 * three, and every one of them is validated on the far side.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopShellBridge, DesktopWriteReply } from './contract';

/** The three channel names, repeated here because a sandboxed preload cannot import them. */
const CHANNEL_SAVE_CAREER_FILE = 'se27:save-career-file';
const CHANNEL_FLUSH_REQUESTED = 'se27:flush-requested';
const CHANNEL_FLUSH_DONE = 'se27:flush-done';

const shell: DesktopShellBridge = Object.freeze({
  platform: 'desktop',

  async saveCareerFile(name: string, text: string): Promise<DesktopWriteReply> {
    // A last check in the *shape* of the call, before it is worth a round trip
    // to the main process. The real validation is on the other side; this only
    // stops a page that has lost its mind from sending a message that could
    // never be answered.
    if (typeof name !== 'string' || typeof text !== 'string') {
      return { written: false, reason: 'the file name and its contents must both be text' };
    }
    return (await ipcRenderer.invoke(CHANNEL_SAVE_CAREER_FILE, { name, text })) as DesktopWriteReply;
  },

  onFlushRequested(handler: () => void): () => void {
    // Wrapped rather than passed straight through: the listener the shell
    // registers must never be handed the Electron event object, which carries
    // the sender with it.
    const listener = (): void => handler();
    ipcRenderer.on(CHANNEL_FLUSH_REQUESTED, listener);
    return () => {
      ipcRenderer.removeListener(CHANNEL_FLUSH_REQUESTED, listener);
    };
  },

  flushDone(): void {
    ipcRenderer.send(CHANNEL_FLUSH_DONE);
  },
});

contextBridge.exposeInMainWorld('se27Desktop', shell);

/**
 * Exported for the packaging test only.
 *
 * The test imports this module as text and compares these three names with the
 * ones in `rules.ts`; the export is what makes that comparison readable rather
 * than a regex over the file.
 */
export const CHANNEL_NAMES = {
  saveCareerFile: CHANNEL_SAVE_CAREER_FILE,
  flushRequested: CHANNEL_FLUSH_REQUESTED,
  flushDone: CHANNEL_FLUSH_DONE,
} as const;
