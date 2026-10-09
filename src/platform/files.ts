/**
 * Getting a career out of the game, and onto a disk the manager owns.
 *
 * A manager who has played a season has something no server knows about, and
 * "write it to a file he can keep" is the difference between a career that
 * survives a browser clearing its storage and one that does not. Two of the
 * ways to do that are the browser's own — a blob URL behind an `<a download>`,
 * and a file input for the way back — and the third is a packaged build handing
 * the bytes to its host: a Capacitor app writing to the device's files, or a
 * desktop build writing through the operating system.
 *
 * That third one is why this module exists rather than three lines in a dialog.
 * The host is feature-detected, never assumed: a build that has no host runs
 * the browser's own download, and a build whose host refuses falls back to it
 * as well, because a manager who asked to export his career should get a file
 * even when the shell around the game is not cooperating.
 *
 * The one case where that fallback must *not* be made is inside a Capacitor
 * WebView, and it is the case the whole packaging effort started from. A WebView
 * has no download manager: Capacitor's Android bridge implements
 * `onShowFileChooser` — which is why importing a career file works on a phone —
 * and registers no `DownloadListener` at all, so an `<a download>` click is
 * dropped on the floor. The click still *succeeds* as far as this file can see,
 * which is what made the packaged build tell the manager his career had been
 * exported while nothing was written anywhere. An application is not allowed to
 * lie about a backup, so the download is offered only when the platform behind
 * the page is a browser (see `downloadWouldWork`), and when it is not, the
 * answer is the plain sentence at the end of that path.
 *
 * Nothing here decides *what* is worth saving or what it means. It takes text
 * and a name and puts them somewhere the manager can find them.
 */
import { Capacitor } from '@capacitor/core';
import { isDesktopBuild } from './target';

/**
 * What a host did with a file: whether it was written, and where it went.
 *
 * `location` is in the manager's words — "Downloads", "the game's own folder
 * on this device" — because it is put straight into the sentence he is shown.
 * A host that does not know says nothing rather than guessing.
 */
export interface HostWriteResult {
  written: boolean;
  location?: string;
}

/**
 * The host application, if this build is running inside one.
 *
 * The shape is deliberately one function wide, and optional: `window.se27Host`
 * is set by a packaged build before the game's own script runs, and it is
 * checked for the capability rather than for the build, so a host that has not
 * implemented file writing yet simply does not get asked.
 *
 * The writer answers with `true`/`false` when that is all it knows, or with a
 * `HostWriteResult` when it can also say *where* the file went — which the
 * Android shell can, and which a manager looking for a backup he just made
 * needs to hear.
 */
export interface HostBridge {
  /** Write a file through the host. Resolves false if the host would not. */
  saveTextFile?: (name: string, text: string) => Promise<boolean | HostWriteResult>;
}

export function hostBridge(): HostBridge | null {
  const host = (globalThis as { se27Host?: unknown }).se27Host;
  if (!host || typeof host !== 'object') return null;
  return host as HostBridge;
}

/**
 * Hand this build's host capabilities to the game.
 *
 * Called by the native shell as it starts — before any screen can offer an
 * export — and deliberately *not* set by the web build: a browser has the
 * download below and needs no host to write a file.
 */
export function installHostBridge(bridge: HostBridge): void {
  (globalThis as { se27Host?: unknown }).se27Host = bridge;
}

/** One answer, from either shape a host may reply with. */
function readHostWrite(reply: boolean | HostWriteResult): HostWriteResult {
  return typeof reply === 'boolean' ? { written: reply } : reply;
}

/** How an export ended: written somewhere, or nowhere this build can reach. */
export type FileOutcome =
  | { status: 'saved'; via: 'download' | 'host'; location?: string }
  | { status: 'unsupported'; error: string };

/** True when this page has the pieces a download is built out of. */
export function canDownloadFiles(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.body !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    typeof Blob !== 'undefined'
  );
}

/**
 * Whether clicking a download link here would actually produce a file.
 *
 * Two questions, and both have to be yes. The pieces have to exist, and the
 * platform behind the page has to be one that catches them: in a Capacitor
 * WebView they exist and nothing catches them — no `DownloadListener` is
 * registered — so an anchor click is a file that was never written, reported as
 * a success. That is the failure this function exists to make impossible, and it
 * is why a packaged build asks its host and takes the host's word for it.
 *
 * The desktop shell is the same story for a different reason. An Electron
 * window *would* catch a download — but it has been configured not to (`desktop/main.ts`
 * refuses them, so that the only file the game can produce is one it has
 * promised), and a career must reach the disk through the host bridge, which
 * knows where the file went and can say so. So a desktop build is a build with
 * no download behind it, exactly like the phone, and the answer comes from what
 * the build *is* rather than from what the page happens to find at runtime: a
 * build whose preload failed must still not claim a career it did not write.
 */
export function downloadWouldWork(): boolean {
  return !isDesktopBuild() && !Capacitor.isNativePlatform() && canDownloadFiles();
}

/**
 * The sentence for a build with nowhere to put a career file.
 *
 * One sentence per kind of shell, because "the browser", "this device" and "the
 * application" are three different things to a manager trying to work out what
 * to do next — and the one thing all three have in common is that his career is
 * still exactly where it was.
 */
function nowhereToPutIt(): string {
  if (isDesktopBuild()) {
    return 'The application could not write a career file, so there is nowhere to put the career. Your career is untouched — nothing was changed.';
  }
  return Capacitor.isNativePlatform()
    ? 'The game could not write the file to this device, so there is nowhere to put the career. Your career is untouched — nothing was changed.'
    : 'This browser cannot write files to your device, so there is nowhere to put the career. Your career is untouched — nothing was changed.';
}

/**
 * Save some text as a file the manager can keep.
 *
 * Tried in the order the manager would want: the host first, because a packaged
 * build's own writer is where the file should go and the browser download
 * inside a webview is where it goes to die; the browser's download after that,
 * but only where a browser is actually behind the page.
 */
export async function saveTextFile(
  name: string,
  text: string,
  mimeType = 'application/json',
): Promise<FileOutcome> {
  const host = hostBridge();
  if (host?.saveTextFile) {
    try {
      const written = readHostWrite(await host.saveTextFile(name, text));
      if (written.written) {
        return written.location ? { status: 'saved', via: 'host', location: written.location } : { status: 'saved', via: 'host' };
      }
      // The host looked at it and said no. In a packaged build that is the end
      // of the road — there is no download to fall back to — so it is worth
      // saying out loud rather than quietly trying the next thing.
      console.warn('The host would not write the career file.', written);
    } catch (error) {
      // A host that threw has told us nothing about whether we can export, so
      // this is a warning rather than a failure: the download below may still
      // work, and the manager's career file is too important to give up on
      // because the wrapper around the game misbehaved.
      console.warn('The host could not write the career file; falling back to a download.', error);
    }
  }
  return downloadTextFile(name, text, mimeType);
}

function downloadTextFile(name: string, text: string, mimeType: string): FileOutcome {
  if (!downloadWouldWork()) {
    return { status: 'unsupported', error: nowhereToPutIt() };
  }

  let url: string | null = null;
  // Held rather than looked up when it is needed: the revocation happens on a
  // later turn of the event loop, and the function it calls must be the one that
  // belongs to the URL that was made, not whatever is in its place by then.
  const revoke = typeof URL.revokeObjectURL === 'function' ? URL.revokeObjectURL.bind(URL) : null;
  try {
    url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    // In the document rather than floated: a detached anchor's click is ignored
    // by some engines, and a download that silently does nothing is the worst
    // possible failure for a feature whose whole job is to be a copy.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { status: 'saved', via: 'download' };
  } catch (error) {
    console.warn('Writing the career file out as a download failed.', error);
    return {
      status: 'unsupported',
      error:
        'The browser would not write the career file. Your career is untouched — you can try again, or keep it by saving to a slot.',
    };
  } finally {
    // On a later turn of the event loop: the download has been handed to the
    // browser by the time the click returns, but revoking the URL in the same
    // task has raced that handover in enough engines to be worth the wait.
    if (url && revoke) {
      const created = url;
      setTimeout(() => revoke(created), 0);
    }
  }
}
