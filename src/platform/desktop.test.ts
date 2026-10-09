import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDesktopShellForTests } from './desktop';
import { hostBridge, saveTextFile } from './files';

/**
 * The game's half of the desktop shell.
 *
 * Two things are worth testing here and nothing else is. The first is that a
 * career export really does reach the shell and really does come back with the
 * folder it landed in: the game's export flow is only as good as the seam it
 * goes through, and a seam that silently reports success is the exact defect the
 * Android shell was written to fix. The second is the closing handshake — that
 * the shell is told the last write has landed, *after* it has, and that a game
 * that is closed twice does not end up with two handlers.
 *
 * The store is mocked rather than driven: what is being tested is the ordering
 * of the handshake, and a real career would only make that slower.
 */
const flush = vi.fn<() => Promise<void>>();

vi.mock('@/state/gameStore', () => ({
  flushAutosaveAndWait: () => flush(),
}));

/** The shell the preload exposes, as the renderer sees it. */
interface StubShell {
  platform: unknown;
  saveCareerFile?: (name: string, text: string) => Promise<unknown>;
  onFlushRequested?: (handler: () => void) => () => void;
  flushDone?: () => void;
}

interface InstalledShell {
  /** Every write the shell was asked for. */
  written: Array<{ name: string; text: string }>;
  /** Ask the game to finish its save, the way the main process does. */
  requestFlush: () => void;
  /** How many times the game has answered. */
  answered: () => number;
  /** How many handlers the game has attached. */
  handlers: () => number;
}

function installShell(patch: Partial<StubShell> = {}): InstalledShell {
  const written: Array<{ name: string; text: string }> = [];
  let handler: (() => void) | null = null;
  let answers = 0;
  let attached = 0;

  const shell: StubShell = {
    platform: 'desktop',
    saveCareerFile: async (name: string, text: string) => {
      written.push({ name, text });
      return { written: true, location: 'C:\\Users\\alex\\Documents\\Sunday Eleven 27\\careers' };
    },
    onFlushRequested: (next: () => void) => {
      attached += 1;
      handler = next;
      return () => {
        handler = null;
      };
    },
    flushDone: () => {
      answers += 1;
    },
    ...patch,
  };

  (globalThis as Record<string, unknown>).se27Desktop = shell;
  return {
    written,
    requestFlush: () => handler?.(),
    answered: () => answers,
    handlers: () => attached,
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_BUILD_TARGET', 'desktop');
  flush.mockReset();
  flush.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).se27Desktop;
  delete (globalThis as Record<string, unknown>).se27Host;
  resetDesktopShellForTests();
});

describe('the desktop shell as the game sees it', () => {
  it('is recognised only when it is really there', async () => {
    const { desktopShell, hasDesktopShell } = await import('./desktop');
    expect(hasDesktopShell()).toBe(false);

    installShell();
    expect(hasDesktopShell()).toBe(true);

    // A shell that is half-built — a preload that threw halfway down, a future
    // build with a different shape — is a game with nowhere to put a career
    // file, which is a sentence the manager can read.
    installShell({ saveCareerFile: undefined });
    expect(hasDesktopShell()).toBe(false);
    installShell({ platform: 'mobile' });
    expect(hasDesktopShell()).toBe(false);
    installShell({ flushDone: undefined });
    expect(hasDesktopShell()).toBe(false);
    expect(desktopShell()).toBeNull();
  });

  it('writes a career through the shell, and reports the file and the folder', async () => {
    const shell = installShell();
    await import('./desktop').then((module) => {
      expect(module.installDesktopFileHost()).toBe(true);
    });

    // Through the game's own host bridge, which is the path an export takes.
    expect(hostBridge()).not.toBeNull();
    const outcome = await saveTextFile('career.json', '{"career":true}');

    expect(outcome).toEqual({
      status: 'saved',
      via: 'host',
      location: 'C:\\Users\\alex\\Documents\\Sunday Eleven 27\\careers',
    });
    expect(shell.written).toEqual([{ name: 'career.json', text: '{"career":true}' }]);
  });

  it('believes a shell that says it did not write, and one that says nothing useful', async () => {
    installShell({ saveCareerFile: async () => ({ written: false, reason: 'the disk is full' }) });
    await import('./desktop').then((module) => module.installDesktopFileHost());
    // No host wrote it, and a desktop build has no download behind it either, so
    // the export is refused rather than claimed.
    const refusedOutcome = await saveTextFile('career.json', '{}');
    expect(refusedOutcome.status).toBe('unsupported');

    installShell({ saveCareerFile: async () => 'ok' });
    await import('./desktop').then((module) => module.installDesktopFileHost());
    expect((await saveTextFile('career.json', '{}')).status).toBe('unsupported');
  });

  it('survives a shell whose writer throws', async () => {
    installShell({
      saveCareerFile: async () => {
        throw new Error('the shell is not having it');
      },
    });
    await import('./desktop').then((module) => module.installDesktopFileHost());

    const outcome = await saveTextFile('career.json', '{}');

    expect(outcome.status).toBe('unsupported');
    if (outcome.status !== 'unsupported') return;
    expect(outcome.error).toMatch(/nowhere to put the career/i);
  });
});

describe('closing the window', () => {
  it('tells the shell the save has landed, and only after it has', async () => {
    const shell = installShell();
    // Held in an object so that the test can let the write finish from outside
    // the promise executor — and so that the compiler does not narrow it away.
    const gate: { resolve: () => void } = { resolve: () => undefined };
    flush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          gate.resolve = resolve;
        }),
    );

    const stop = (await import('./desktop')).startDesktopShell();
    shell.requestFlush();

    // Asked, and not yet answered: the shell is holding the window open for
    // exactly as long as this takes.
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(shell.answered()).toBe(0);

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shell.answered()).toBe(1);
    stop();
  });

  it('answers even when the last write fails', async () => {
    // A game that never answered would make every close wait for the shell's
    // own timeout — five seconds of a window that will not go away.
    const shell = installShell();
    flush.mockRejectedValue(new Error('the database has gone'));

    (await import('./desktop')).startDesktopShell();
    shell.requestFlush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shell.answered()).toBe(1);
  });

  it('registers one handler however many times it is started', async () => {
    const shell = installShell();
    const module = await import('./desktop');

    const stop = module.startDesktopShell();
    module.startDesktopShell();
    module.startDesktopShell();
    expect(shell.handlers()).toBe(1);

    stop();
    module.startDesktopShell();
    expect(shell.handlers()).toBe(2);
  });

  it('does nothing at all in a build that is not the desktop one', async () => {
    vi.stubEnv('VITE_BUILD_TARGET', 'web');
    const shell = installShell();

    (await import('./desktop')).startDesktopShell();

    expect(shell.handlers()).toBe(0);
    expect(hostBridge()).toBeNull();
  });

  it('warns rather than pretending when a desktop build has no shell behind it', async () => {
    // The preload failed, or a build script forgot to run: the game still runs,
    // and its export says there is nowhere to put a career file.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const module = await import('./desktop');
    module.startDesktopShell();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no desktop shell behind it/));
    expect(hostBridge()).toBeNull();
    warn.mockRestore();
  });
});
