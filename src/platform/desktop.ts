/**
 * The game's half of the desktop shell.
 *
 * A packaged desktop build is the game plus a thin native shell, and this is
 * where the two meet. The shell hands the page three capabilities (see
 * `desktop/preload.ts`), and this module turns them into the two things the game
 * actually asks for:
 *
 *   - a **file host**, which is the same seam the Android shell plugs into: the
 *     game asks for a career file to be written and is told whether it landed and
 *     where. Nothing about the export flow changes — `platform/files.ts` tries the
 *     host first and the browser's own download after it, and a desktop build is
 *     simply a build where there is a host and no download behind it.
 *   - a **closing handshake**, which is the one thing a desktop window can do
 *     that a browser tab cannot: *wait*. The game writes the career it is playing
 *     on a debounce, and the shell holds the close until the game says the last
 *     write has landed, so "close the window" and "your career is on the disk"
 *     stop being the same hopeful moment.
 *
 * Everything is validated before it is used. `window.se27Desktop` is checked for
 * its shape rather than trusted, because the object on the other side of the
 * bridge is only as good as the preload script that made it — and because a
 * desktop build whose preload failed should behave like a game with nowhere to
 * put a career file, which is a sentence the manager can read, rather than like a
 * game that throws while it is closing.
 */
import { flushAutosaveAndWait } from '@/state/gameStore';
import type { DesktopShellBridge } from '../../desktop/contract';
import { installHostBridge, type HostWriteResult } from './files';
import { isDesktopBuild } from './target';

/** The global the preload exposes the shell on. */
const SHELL_GLOBAL = 'se27Desktop';

/**
 * The shell, if this build is running inside one and it looks like one.
 *
 * The check is deliberately structural: every member is asked for by type before
 * anything is called, so a half-built shell is a game that falls back to its own
 * answer rather than a game that fails halfway through a save.
 */
export function desktopShell(): DesktopShellBridge | null {
  const candidate = (globalThis as Record<string, unknown>)[SHELL_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;
  const shell = candidate as Partial<DesktopShellBridge>;
  if (shell.platform !== 'desktop') return null;
  if (typeof shell.saveCareerFile !== 'function') return null;
  if (typeof shell.onFlushRequested !== 'function') return null;
  if (typeof shell.flushDone !== 'function') return null;
  return shell as DesktopShellBridge;
}

/** True when the game is running in the desktop shell. */
export function hasDesktopShell(): boolean {
  return desktopShell() !== null;
}

/**
 * One write, through the shell, in the shape the game's own host bridge uses.
 *
 * The reply is narrowed rather than passed on: a shell that answered something
 * unexpected has told us nothing about whether a career file exists, and the one
 * thing this must never do is *infer* that it did. So anything other than an
 * explicit `written: true` — a refusal, a thrown error, a reply of the wrong
 * shape — is reported as "not written", which the game turns into a sentence
 * instead of a claim.
 */
async function writeThroughShell(
  shell: DesktopShellBridge,
  name: string,
  text: string,
): Promise<HostWriteResult> {
  try {
    const reply = await shell.saveCareerFile(name, text);
    if (!reply || typeof reply !== 'object' || reply.written !== true) {
      console.warn(`[se27] the desktop shell would not write ${name}:`, reply?.reason ?? 'no reason given');
      return { written: false };
    }
    return typeof reply.location === 'string' && reply.location !== ''
      ? { written: true, location: reply.location }
      : { written: true };
  } catch (error) {
    // A shell that threw has told us nothing about whether we can export, and
    // the game's answer to that is the same sentence as for a refusal.
    console.warn(`[se27] the desktop shell could not write ${name}.`, error);
    return { written: false };
  }
}

/**
 * Give the desktop build a way to write a file. Returns whether it took.
 *
 * Called once, as the shell starts, which is before any screen can offer an
 * export — so a manager who asks for one is always talking to a host that is
 * there.
 */
export function installDesktopFileHost(): boolean {
  const shell = desktopShell();
  if (!shell) return false;
  installHostBridge({ saveTextFile: (name, text) => writeThroughShell(shell, name, text) });
  return true;
}

let started: (() => void) | null = null;

/**
 * Start the desktop shell's game-side half: the file host and the close
 * handshake.
 *
 * Safe to call more than once, and safe to call in a build that has no shell at
 * all — which is every build except the desktop one, including every test. The
 * listener is registered once and the disposer takes it off again, because an
 * application that is restarted many times must not accumulate handlers.
 */
export function startDesktopShell(): () => void {
  if (started) return started;
  started = () => undefined;

  if (!isDesktopBuild()) return started;

  const shell = desktopShell();
  if (!shell) {
    // A desktop build with no shell behind it: the game still runs, and its
    // export says there is nowhere to put a career file rather than pretending
    // one was written. Worth saying out loud once, for whoever built it.
    console.warn('[se27] this is a desktop build with no desktop shell behind it.');
    return started;
  }

  installDesktopFileHost();

  const stop = shell.onFlushRequested(() => {
    void (async () => {
      try {
        // The one place in the game where an autosave is *awaited*: a browser
        // cannot wait (the page is on its way out), and a desktop window can.
        await flushAutosaveAndWait();
      } catch (error) {
        console.warn('[se27] the last save could not be confirmed before closing.', error);
      } finally {
        // Answered either way. The shell's own timeout is the backstop; this is
        // the ordinary path, and a game that never answered would make every
        // close wait five seconds for nothing.
        shell.flushDone();
      }
    })();
  });

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // Cleared before the listener goes, so that a shell started again after this
    // one stopped registers a fresh handshake rather than handing back a
    // disposer for a listener that is already gone.
    if (started === dispose) started = null;
    stop();
  };
  started = dispose;
  return dispose;
}

/** Only for tests: forget that the shell was started. */
export function resetDesktopShellForTests(): void {
  started = null;
}
