import { afterEach, describe, expect, it, vi } from 'vitest';
import { canDownloadFiles, downloadWouldWork, hostBridge, saveTextFile } from './files';

/**
 * Getting a career file onto a disk.
 *
 * The rule this module exists to keep is that a manager who asked for a copy
 * gets one: a host that refuses, throws, or was never there must leave the
 * browser's own download as the answer rather than turning into a failure. What
 * is tested here is that fallback, and the fact that the download is a real
 * click on a real anchor rather than a URL that was quietly created and
 * forgotten.
 */

interface DownloadRecorder {
  /** Every anchor that was appended to the body, in order. */
  appended: Array<{ download: string; href: string }>;
  /** Every anchor click, as it was when it was clicked. */
  clicked: Array<{ download: string; href: string }>;
  /** Every blob URL the module asked for. */
  created: string[];
  /** Every blob URL that was revoked, in order. */
  revoked: string[];
  restore: () => void;
}

/** The bits of a browser a download needs, and no more. */
function installBrowser(): DownloadRecorder {
  const appended: DownloadRecorder['appended'] = [];
  const clicked: DownloadRecorder['clicked'] = [];
  const created: string[] = [];
  const revoked: string[] = [];

  // Annotated rather than inferred: the click records what the anchor looked
  // like when it was clicked, so it reads the anchor it belongs to.
  const anchor: { href: string; download: string; rel: string; click: () => void; remove: () => void } = {
    href: '',
    download: '',
    rel: '',
    click: () => clicked.push({ download: anchor.download, href: anchor.href }),
    remove: () => undefined,
  };
  globalThis.document = {
    body: {
      appendChild: (node: unknown) => appended.push(node as { download: string; href: string }),
    },
    createElement: () => anchor,
  } as unknown as typeof globalThis.document;

  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = ((_blob: Blob) => {
    const url = `blob:se27/${created.length + 1}`;
    created.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;

  return {
    appended,
    clicked,
    created,
    revoked,
    restore: () => {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    },
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { se27Host?: unknown }).se27Host;
  // The desktop case below stubs the build target, and a leaked one would decide
  // the answer for every test after it.
  vi.unstubAllEnvs();
});

/** Install the host a packaged build puts on the window before the game runs. */
function installHost(host: unknown): void {
  (globalThis as { se27Host?: unknown }).se27Host = host;
}

describe('saving text as a file', () => {
  it('gives the file to the host when there is one, and says so', async () => {
    const received: Array<{ name: string; text: string }> = [];
    installHost({
      saveTextFile: async (name: string, text: string) => {
        received.push({ name, text });
        return true;
      },
    });

    expect(hostBridge()).not.toBeNull();
    const outcome = await saveTextFile('se27-career.json', '{"career":true}');

    expect(outcome).toEqual({ status: 'saved', via: 'host' });
    expect(received).toEqual([{ name: 'se27-career.json', text: '{"career":true}' }]);
  });

  it('falls back to the browser download when the host refuses', async () => {
    const browser = installBrowser();
    installHost({ saveTextFile: async () => false });

    const outcome = await saveTextFile('se27-career.json', 'body');

    expect(outcome).toEqual({ status: 'saved', via: 'download' });
    expect(browser.clicked).toHaveLength(1);
    browser.restore();
  });

  it('falls back to the browser download when the host throws', async () => {
    // A wrapper around the game misbehaving is not a reason to lose the export,
    // so the thrown host is a step that did not work rather than the outcome.
    const browser = installBrowser();
    installHost({
      saveTextFile: async () => {
        throw new Error('the host is not having it');
      },
    });

    const outcome = await saveTextFile('se27-career.json', 'body');

    expect(outcome).toEqual({ status: 'saved', via: 'download' });
    expect(browser.clicked).toHaveLength(1);
    browser.restore();
  });

  it('ignores a host that cannot write files', async () => {
    const browser = installBrowser();

    // A host object with no writer on it: a packaged build that has not grown
    // this capability yet says nothing rather than nothing useful.
    installHost({});
    expect(hostBridge()).toEqual({});
    expect(await saveTextFile('se27-career.json', 'body')).toEqual({ status: 'saved', via: 'download' });

    // And something that is not a host at all.
    installHost('not a host');
    expect(hostBridge()).toBeNull();
    expect(await saveTextFile('se27-career.json', 'body')).toEqual({ status: 'saved', via: 'download' });

    expect(browser.clicked).toHaveLength(2);
    browser.restore();
  });

  it('clicks a real anchor, named for the manager, and then revokes the URL', async () => {
    const browser = installBrowser();

    const outcome = await saveTextFile('sunday-eleven-27-career-bramford-2026-10-09.json', 'body');
    expect(outcome).toEqual({ status: 'saved', via: 'download' });

    const [url] = browser.created;
    expect(url).toBe('blob:se27/1');
    // In the document before it was clicked: a detached anchor's click is
    // ignored by some engines, which would make this a download that silently
    // did nothing.
    expect(browser.appended).toHaveLength(1);
    expect(browser.clicked).toEqual([
      { download: 'sunday-eleven-27-career-bramford-2026-10-09.json', href: 'blob:se27/1' },
    ]);

    // Revoking waits a turn of the event loop, so that the download has been
    // handed over before the URL it points at goes away.
    expect(browser.revoked).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(browser.revoked).toEqual(['blob:se27/1']);

    browser.restore();
  });

  it('offers no download at all in a desktop build, where the shell writes the file', async () => {
    // Every piece a download is built from is here — a document, blob URLs, an
    // anchor — and it is still not offered, because a desktop window is
    // configured to refuse downloads and a career is written by the shell's own
    // writer instead. This is the same class of failure as the WebView's missing
    // `DownloadListener`: a download that is offered where nothing catches it is
    // a career the manager is told he has.
    const browser = installBrowser();
    vi.stubEnv('VITE_BUILD_TARGET', 'desktop');

    expect(downloadWouldWork()).toBe(false);
    const outcome = await saveTextFile('se27-career.json', 'body');

    expect(outcome.status).toBe('unsupported');
    if (outcome.status !== 'unsupported') return;
    expect(outcome.error).toMatch(/application could not write a career file/i);
    expect(browser.clicked).toHaveLength(0);
    browser.restore();
  });

  it('says there is nowhere to write when there is no browser and no host', async () => {
    // This environment has no document at all, which is the case a build script
    // or a test hits — and the outcome has to be a sentence rather than a throw.
    expect(canDownloadFiles()).toBe(false);

    const outcome = await saveTextFile('se27-career.json', 'body');

    if (outcome.status !== 'unsupported') throw new Error('expected the export to be unsupported');
    // A sentence rather than a code: this is shown to the manager, and it is the
    // only thing he gets to act on.
    expect(outcome.error).toMatch(/career/i);
    expect(outcome.error.length).toBeGreaterThan(20);
  });
});
