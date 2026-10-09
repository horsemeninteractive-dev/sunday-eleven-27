/**
 * The desktop shell's main process: one window, one origin, three messages.
 *
 * This is the whole of the Electron side of Sunday Eleven 27. It has one job —
 * put the game's own bundled build in front of a manager without the internet,
 * and give it exactly two native capabilities a browser cannot provide safely —
 * and everything a main process can do that is *not* one of those jobs is
 * switched off on purpose: see `hardenSession` and `guardContents` below.
 *
 * The shape of it, and why each part is where it is:
 *
 *  - **the game is loaded from a bundled, local `app://` origin**, never from
 *    the deployed website and never from a dev server. The production renderer
 *    is a directory of files inside the application (`desktop/renderer`, built
 *    by `npm run desktop:build`), and it is the *same* game the website and the
 *    two mobile shells run — one renderer, one simulation, three packages.
 *  - **`app://` rather than `file://`,** because the game's careers live in
 *    IndexedDB and Chromium keys that by origin: a `file://` document has an
 *    opaque origin, which is a game that cannot reliably find the careers it
 *    saved yesterday. A standard, secure custom scheme gives it a stable origin
 *    of its own, exactly as `https://localhost` does in the mobile shell.
 *  - **the renderer is a sandbox with no Node in it** (`nodeIntegration: false`,
 *    `contextIsolation: true`, `sandbox: true`), and the only thing it can reach
 *    outside itself is the preload's three-member bridge.
 *  - **everything crossing that bridge is validated here**, in the terms
 *    `rules.ts` sets: a payload that is not exactly what the game sends is
 *    refused, a path that is not inside the renderer build is refused, and a
 *    write that does not come from the game's own frame is refused. A refusal is
 *    always an answer rather than an exception, because the game turns answers
 *    into sentences for the manager and turns thrown plugin errors into nothing
 *    at all.
 *
 * Nothing in here knows anything about football, and nothing in the game knows
 * anything about Electron.
 */
import { promises as fs } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  protocol,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import type { DesktopWriteReply } from './contract';
import {
  APP_ORIGIN,
  APP_SCHEME,
  CHANNELS,
  CONTENT_SECURITY_POLICY,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  assetRequestPath,
  contentTypeFor,
  isTrustedSenderUrl,
  parseWriteRequest,
  permissionAllowed,
  refused,
  restoreBounds,
  type WindowBounds,
} from './rules';
import { startSteam, type SteamAdapter } from './steam';

/**
 * The renderer build, as the packaged application sees it.
 *
 * `__dirname` is `desktop/build` — this file is compiled there from
 * `desktop/main.ts` by `tsc -p tsconfig.desktop.json` — and the game is built
 * into its sibling `desktop/renderer`. The same two paths hold inside
 * `app.asar`, which is why nothing here depends on the working directory.
 */
const RENDERER_ROOT = join(__dirname, '..', 'renderer');

/** How long the shell waits for the game to finish writing before it closes anyway. */
const FLUSH_TIMEOUT_MS = 5000;

const isPackaged = app.isPackaged;

/** A line of the shell's own logging. Never shown to the manager. */
function note(message: string): void {
  console.log(`[se27] ${message}`);
}

function complain(message: string, error?: unknown): void {
  if (error === undefined) console.error(`[se27] ${message}`);
  else console.error(`[se27] ${message}`, error);
}

/* ------------------------------------------------------------------ *
 * The game's origin
 * ------------------------------------------------------------------ */

/*
 * Declared before the application is ready, because that is the only moment a
 * scheme's privileges can be set. `standard` is what makes `app://se27/foo` a
 * URL with a host and a path rather than one opaque string; `secure` is what
 * gives it the storage, service-worker and API access a browser reserves for
 * HTTPS — IndexedDB will not open without it. `codeCache` is a startup cost
 * rather than a security question: a packaged build's JavaScript never changes,
 * so letting Chromium keep compiled code is what stops every launch paying for
 * the parse.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

/**
 * Serve one request for the game out of the bundled build.
 *
 * Every answer carries the game's content security policy, and the only body
 * this can ever produce is a file that lives inside the renderer build: the
 * request is turned into a relative path by `rules.ts`, joined to the build
 * root, and refused if the result is not inside it. Both halves of that check
 * matter — the first refuses a path that *looks* like a traversal, the second
 * refuses anything that resolved somewhere else — and neither of them can be
 * bypassed by the page, because the page never names a directory, only a URL.
 */
async function serveAppRequest(request: Request): Promise<Response> {
  const notFound = new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

  const relative = assetRequestPath(request.url);
  if (relative === null) {
    complain(`refused a request for ${request.url}`);
    return notFound;
  }

  const target = resolve(RENDERER_ROOT, relative);
  if (target !== RENDERER_ROOT && !target.startsWith(RENDERER_ROOT + sep)) {
    complain(`refused a request for ${relative}, which resolves outside the renderer build`);
    return notFound;
  }

  try {
    const body = await fs.readFile(target);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(target),
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        // The build is on the disk in front of the manager rather than on a
        // server, so there is nothing to revalidate and nothing to go stale:
        // Chromium may keep it for as long as it likes, and a new build is a
        // new file name because every asset is content-hashed.
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    // A missing file is the ordinary case for a favicon a browser asks for
    // unprompted, so it is a 404 rather than something to shout about.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      complain(`could not read ${target}`, error);
    }
    return notFound;
  }
}

/* ------------------------------------------------------------------ *
 * Careers
 * ------------------------------------------------------------------ */

/** The folder the manager's exported career files are written into. */
function careerFolder(): string {
  return join(app.getPath('documents'), 'Sunday Eleven 27', 'careers');
}

/**
 * Write one career file, or say why not.
 *
 * Two things here are about the manager rather than about the code. The first is
 * that the file is written under a temporary name and moved into place, so a
 * manager who copies his careers folder — or a backup tool that runs while the
 * game is open — cannot catch half of a career. The second is that the answer
 * names the folder: the game's sentence is "career written to <file> in
 * <location>", and on a desktop the honest location is the real path, which the
 * manager can paste into Explorer.
 *
 * It never throws. A full disk, a permissions problem and a documents folder
 * that has been redirected somewhere unwritable are all the same thing to the
 * manager — no copy exists — and the game has a sentence for that.
 */
async function writeCareerFile(request: { name: string; text: string }): Promise<DesktopWriteReply> {
  const folder = careerFolder();
  try {
    await fs.mkdir(folder, { recursive: true });
    const target = join(folder, request.name);
    const temporary = `${target}.part`;
    await fs.writeFile(temporary, request.text, 'utf8');
    await fs.rename(temporary, target);
    note(`wrote ${target}`);
    return { written: true, location: folder };
  } catch (error) {
    complain(`could not write ${request.name}`, error);
    return refused('the file could not be written');
  }
}

/* ------------------------------------------------------------------ *
 * The bridge
 * ------------------------------------------------------------------ */

/** Minimal shape of both kinds of IPC event, so one check serves both. */
type BridgeEvent = Pick<IpcMainInvokeEvent, 'senderFrame' | 'sender'> | Pick<IpcMainEvent, 'senderFrame' | 'sender'>;

/**
 * Whether a message crossing the bridge came from the game itself.
 *
 * Three questions, and all three have to be yes. There has to be a frame (a
 * message from a frame that has gone is not from the game), it has to be the
 * *main* frame rather than one inside it, and its URL has to be the game's own
 * origin. `app://se27` is the only thing this application ever loads, so
 * anything else is a request the game did not make.
 */
function trusted(event: BridgeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  if (frame !== event.sender.mainFrame) return false;
  return isTrustedSenderUrl(frame.url);
}

/**
 * Tell the game the window is closing, and wait for its last write.
 *
 * The game writes the career it is playing on a debounce, and a debounce that is
 * still running when the window closes is a month of a season that never reached
 * the disk. A browser has no way to wait for that — which is why the mobile
 * shell hands the write over and hopes — but a desktop window does: the close is
 * held, the game is asked to finish, and the shell waits for the answer or for a
 * timeout before it closes. Nothing about the football changes; what changes is
 * that the last write is *awaited* rather than merely started.
 */
function bindCloseHandshake(win: BrowserWindow): void {
  let asked = false;
  let answered = false;
  let finish: (() => void) | null = null;

  win.on('close', (event) => {
    if (answered) return;
    event.preventDefault();
    if (asked) return;
    asked = true;

    if (win.webContents.isDestroyed()) {
      answered = true;
      win.close();
      return;
    }

    const timer = setTimeout(() => {
      complain(`the game did not confirm its last save within ${FLUSH_TIMEOUT_MS}ms; closing anyway`);
      finish?.();
    }, FLUSH_TIMEOUT_MS);

    finish = () => {
      clearTimeout(timer);
      answered = true;
      win.close();
    };

    note('closing: asking the game to finish its last save');
    win.webContents.send(CHANNELS.flushRequested);
  });

  ipcMain.on(CHANNELS.flushDone, (event) => {
    if (!trusted(event)) return;
    note('closing: the game confirmed its last save');
    finish?.();
  });
}

/**
 * The three messages, and how little each of them is allowed to do.
 *
 * `saveCareerFile` is the only one that touches the disk, and it does nothing
 * before the request has been through `parseWriteRequest`: a payload of the
 * wrong shape, a name that tries to name a path, a file bigger than a career is
 * refused with a reason rather than written. The reply is always the same shape,
 * so the game never has to catch anything from here.
 */
function bindBridge(): void {
  ipcMain.handle(CHANNELS.saveCareerFile, async (event: IpcMainInvokeEvent, payload: unknown): Promise<DesktopWriteReply> => {
    if (!trusted(event)) {
      complain('refused a career write from a frame that is not the game');
      return refused('the request did not come from the game window');
    }
    const parsed = parseWriteRequest(payload);
    if (!parsed.ok) {
      complain(`refused a career write: ${parsed.reason}`);
      return refused(parsed.reason);
    }
    return writeCareerFile(parsed.request);
  });
}

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

interface WindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function windowStatePath(): string {
  // `userData` is `%APPDATA%\Sunday Eleven 27` on Windows, and it is the one
  // directory the application is guaranteed to be able to write. It is *not*
  // where careers live: those are in IndexedDB inside this same folder, and the
  // exported copies are in Documents. See DESKTOP.md.
  return join(app.getPath('userData'), 'window-state.json');
}

function readWindowState(): WindowState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(windowStatePath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const state = parsed as WindowState;
    const numbers = [state.x, state.y, state.width, state.height];
    if (!numbers.every((value) => value === undefined || typeof value === 'number')) return null;
    return state;
  } catch {
    // No state, an unreadable state or a state written by a future build: the
    // window opens at its default size, which is the answer that is never wrong.
    return null;
  }
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    const bounds = win.getBounds();
    writeFileSync(windowStatePath(), JSON.stringify(bounds satisfies WindowBounds, null, 2));
  } catch (error) {
    // A window that cannot remember where it was is a small disappointment, not
    // a reason to interrupt anything.
    complain('could not remember the window position', error);
  }
}

/** The menu, which exists mostly so that the keyboard keeps working. */
function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      // Deliberately not a second place to save a career. The game has a Save
      // screen, the manager already knows where it is, and a menu item that
      // opened a file dialog of the shell's own would be a second, quietly
      // different way for a career to reach the disk.
      label: 'File',
      submenu: [{ role: 'close' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      // Not decoration: on Windows and Linux these roles are what give the window
      // Ctrl+C, Ctrl+V, Ctrl+A and the rest. A menu-less Electron window is a
      // window where a manager cannot paste his own name into a text field.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
    {
      label: 'Help',
      submenu: [{ label: `Sunday Eleven 27 ${app.getVersion()}`, enabled: false }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = restoreBounds(readWindowState(), workArea);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#08090b',
    title: 'Sunday Eleven 27',
    // Card colour of the game, so the frame does not flash white before the
    // first paint — the same treatment the mobile shell gives its window.
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      /*
       * The four settings that decide what the page can reach.
       *
       * `contextIsolation` puts the preload in its own world, so the page cannot
       * reach the objects the bridge is built from; `nodeIntegration: false`
       * means there is no `require` in the renderer at all; `sandbox: true` puts
       * the renderer in Chromium's own sandbox, which is what stops a bug in the
       * game's own code becoming a bug in the operating system; and `webSecurity`
       * stays on so that the origin rules the game relies on for its storage are
       * real. A page that is compromised therefore has exactly the capabilities
       * of the game's UI, plus three validated messages.
       */
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Chromium's spellchecker downloads dictionaries on some platforms. This
      // game has two text fields and needs no network, so it is off.
      spellcheck: false,
      devTools: true,
    },
  });

  buildMenu();

  let stateTimer: ReturnType<typeof setTimeout> | null = null;
  const rememberSoon = (): void => {
    if (stateTimer !== null) clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      stateTimer = null;
      saveWindowState(win);
    }, 500);
  };
  win.on('resize', rememberSoon);
  win.on('move', rememberSoon);

  bindCloseHandshake(win);

  win.once('ready-to-show', () => {
    note(`window shown at ${JSON.stringify(win.getBounds())} (work area ${JSON.stringify(workArea)})`);
    win.show();
  });

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    complain(`the game's own build could not be loaded (${code} ${description}) from ${url}`);
    // A window that is a blank rectangle tells nobody anything. The one page
    // this fallback may load is a data URL this file wrote itself — it is a
    // string literal, and it is only ever reached when the build is broken.
    void win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="background:#08090b;color:#e8eaed;font:16px system-ui;padding:48px">' +
            '<h1 style="font-size:20px">Sunday Eleven 27 could not start</h1>' +
            '<p>Its own files could not be read, so the game is not there to open. ' +
            'Reinstalling the application will put them back, and no career has been touched.</p>' +
            '</body>',
        ),
    );
  });

  void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

/* ------------------------------------------------------------------ *
 * Nothing else
 * ------------------------------------------------------------------ */

/**
 * Take away everything the game does not use.
 *
 * An Electron main process can open any window it is asked to, navigate
 * anywhere, and hand a page the operating system's shell. This game asks for
 * none of it, so every one of those doors is shut and *said out loud* in the
 * log when something knocks: a manager who is told why nothing happened is in a
 * better position than one looking at a window that did nothing.
 */
function guardContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    complain(`refused to open a window for ${url}`);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isTrustedSenderUrl(url)) return;
    event.preventDefault();
    complain(`refused to navigate to ${url}`);
  });

  // A webview is a second, differently-configured browser inside the game.
  // There are none, and there will be none.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    complain('refused a webview');
  });
}

/**
 * The session: one permission, and nothing to download.
 *
 * The game asks for no camera, microphone, location, notification or clipboard
 * access. What it does ask for is full screen, a manager's own preference on the
 * match screen, and persistent storage, which it asks for the first time it
 * writes a career — and both have to keep working, the second because refusing it
 * makes the save screen tell the manager his careers are kept on a best-effort
 * basis, which is what a website does and not what an installed application
 * does. So the list of what is granted is two strings long and lives in
 * `rules.ts` (`permissionAllowed`), where it is a decision that can be read and
 * tested rather than a lambda buried in a handler. Downloads are refused for a different reason, and it is worth
 * stating: a career export goes *through the bridge*, which writes the file
 * itself and can say where it went, so a download appearing here would be a file
 * the game never promised. Refusing it keeps the game's word honest rather than
 * leaving a second, silent way for a file to reach the disk.
 */
function hardenSession(): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = permissionAllowed(permission);
    if (!allowed) complain(`refused permission: ${permission}`);
    callback(allowed);
  });
  defaultSession.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));

  defaultSession.on('will-download', (event, item) => {
    event.preventDefault();
    complain(`refused a download of ${item.getFilename()}`);
    item.cancel();
  });
}

/* ------------------------------------------------------------------ *
 * The application
 * ------------------------------------------------------------------ */

// One application, one window: a second launch focuses the one already open
// rather than starting a second copy that would fight the first over the
// storage its careers live in.
if (!app.requestSingleInstanceLock()) {
  note('another copy is already running; this one is closing');
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  /**
   * Steam, if this is a Steam launch, started once and then left alone.
   *
   * Called here — before the application is ready and before any window exists
   * — because the overlay is a library loaded into this process, and it attaches
   * to a window it has to be loaded ahead of. It is *synchronous and total*: it
   * returns a status object on every path, never throws and never waits, so a
   * machine with no Steam client, no `steam_appid.txt` and no addon starts the
   * game exactly as it does today and only sees a line in the log. The app id
   * comes from the client that launched the game, and a `steam_appid.txt` beside
   * the executable is the dev-build fallback (see `steamRules.ts`) — this file
   * does not carry one, because an id invented here would be worse than none.
   */
  const steam: SteamAdapter = startSteam({
    appIdFile: join(dirname(process.execPath), 'steam_appid.txt'),
    log: note,
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => guardContents(contents));

  void app.whenReady().then(() => {
    // The identity Windows uses for the taskbar, the Start menu and the
    // notification area. The same string as the Android application id, because
    // it is one game: `com.sundayeleven.se27`.
    app.setAppUserModelId('com.sundayeleven.se27');

    protocol.handle(APP_SCHEME, serveAppRequest);
    hardenSession();
    bindBridge();

    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    note(`Sunday Eleven 27 ${app.getVersion()} · renderer ${RENDERER_ROOT} · packaged ${isPackaged}`);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Windows and Linux: closing the game closes the application. There is no
    // background process and no tray icon, because a football manager that keeps
    // running after its window is gone is a surprise, not a feature.
    if (process.platform !== 'darwin') app.quit();
  });

  // The last thing asked of Steam, and the only thing that must happen before the
  // process goes: handing it back on the way out is what lets the client settle
  // its own state. Guarded, like everything else — a game that would not close
  // because Steam would not is the worst possible version of this feature.
  app.on('will-quit', () => steam.shutdown());
}
