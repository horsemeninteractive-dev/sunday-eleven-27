/**
 * The desktop shell's rules, where they can be read and tested.
 *
 * Everything here is a *decision* rather than a side effect: what a career file
 * may be called, whether a message that crossed the preload bridge is one we
 * asked for, which directory a career goes in, whether a URL is the game's own,
 * what the window remembers about where it was. The Electron main process is the
 * only thing that acts on those answers, and the answers live here because that
 * is what makes them testable — on this machine, with no window and no Electron,
 * in the same `vitest` run as the rest of the game.
 *
 * Two rules about this file, and both are load-bearing:
 *
 *  - **it imports nothing from Electron, and touches no Node global.** No
 *    `process`, no `__dirname`, no `app.getPath`, no `fs`. Those belong in
 *    `main.ts`, which asks this module what to do and then does it. A single
 *    Node import here would take the whole file out of the game's test suite.
 *  - **nothing here trusts its input.** The preload bridge is the boundary
 *    between the shell and a page, and the page is the least trustworthy thing
 *    in the process: a string that arrives from it is either validated into a
 *    shape this module is willing to write, or refused with a reason.
 */
import type { DesktopWriteReply } from './contract';

/**
 * The game's own origin inside the application.
 *
 * Not `file://`, and that is a decision rather than a preference. Chromium
 * gives a `file://` document an opaque origin, which is the origin IndexedDB is
 * keyed by — so a career saved from one `file://` page is not necessarily
 * visible to the next one, and a `file://` application is a game that cannot
 * reliably find its own saves. `app://se27` is a *standard* and *secure* scheme
 * (see `registerSchemesAsPrivileged` in `main.ts`), which gives the game a real,
 * stable origin — the same trick a Capacitor build gets from `https://localhost`
 * — with a storage partition and a service-worker scope of its own. It is also
 * why the address the manager's saves live under never changes when the game
 * moves between versions.
 */
export const APP_SCHEME = 'app';
export const APP_HOST = 'se27';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * The three messages the shell and the game exchange, and nothing else.
 *
 * The preload repeats these strings as literals rather than importing them, and
 * that is deliberate: a *sandboxed* preload script is not allowed to require a
 * local file (Electron gives it `electron`, `events`, `timers` and `url` and
 * nothing more), so it cannot import this module. `desktopPackaging.test.ts`
 * reads both files and fails if the two lists stop agreeing, which is the part
 * that would go wrong silently — a bridge whose two halves name the same channel
 * differently is a career file that is never written.
 */
export const CHANNELS = {
  /** The game asking the shell to write a career file, and the shell answering. */
  saveCareerFile: 'se27:save-career-file',
  /** The shell telling the game it is about to close. */
  flushRequested: 'se27:flush-requested',
  /** The game telling the shell its last write has landed. */
  flushDone: 'se27:flush-done',
} as const;

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

/**
 * How small the window may be made.
 *
 * The game is a desktop-first layout with a command bar, a sidebar and a pitch,
 * and it is *usable* well below this — but this is the size below which the
 * football itself starts being hidden behind furniture, so it is the floor
 * rather than a preference. The same numbers are the defaults for a manager who
 * has never resized anything.
 */
export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 700;
export const DEFAULT_WINDOW_WIDTH = 1440;
export const DEFAULT_WINDOW_HEIGHT = 900;

/** How much of a remembered window must still be on a screen to keep its place. */
const MIN_VISIBLE = 96;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Where the window should open, given where it was last time.
 *
 * A remembered position is a fact about a desk, and a desk changes: a laptop is
 * unplugged, a second monitor is taken away, a resolution is lowered. Restoring
 * a window to a screen that is no longer there is how a game opens off the edge
 * of the world with its menu unreachable, so the remembered place is kept only
 * when enough of it is still on the screen in front of the manager — and the
 * *size* is kept regardless, clamped to the work area it is opening on.
 *
 * The work area rather than the screen, deliberately: a window sized to the full
 * screen puts its own title bar underneath a taskbar that is always on top.
 */
export function restoreBounds(
  saved: Partial<WindowBounds> | null | undefined,
  workArea: WorkArea,
): Partial<WindowBounds> {
  const width = clamp(
    Math.round(saved?.width ?? DEFAULT_WINDOW_WIDTH),
    MIN_WINDOW_WIDTH,
    Math.max(MIN_WINDOW_WIDTH, Math.round(workArea.width)),
  );
  const height = clamp(
    Math.round(saved?.height ?? DEFAULT_WINDOW_HEIGHT),
    MIN_WINDOW_HEIGHT,
    Math.max(MIN_WINDOW_HEIGHT, Math.round(workArea.height)),
  );

  const x = saved?.x;
  const y = saved?.y;
  const stillOnScreen =
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x + width > workArea.x + MIN_VISIBLE &&
    x < workArea.x + workArea.width - MIN_VISIBLE &&
    y + height > workArea.y + MIN_VISIBLE &&
    y < workArea.y + workArea.height - MIN_VISIBLE;

  // No usable position: the size is handed back and Electron centres the window,
  // which is the one answer that is always visible.
  if (!stillOnScreen) return { width, height };

  return {
    x: clamp(Math.round(x), workArea.x - width + MIN_VISIBLE, workArea.x + workArea.width - MIN_VISIBLE),
    y: clamp(Math.round(y), workArea.y - height + MIN_VISIBLE, workArea.y + workArea.height - MIN_VISIBLE),
    width,
    height,
  };
}

/* ------------------------------------------------------------------ *
 * What the renderer may ask for
 * ------------------------------------------------------------------ */

/**
 * The permissions this application is allowed, and there are two.
 *
 * Both were found by running the packaged application rather than by reasoning
 * about it, and both are the difference between the game behaving as it does
 * and behaving worse:
 *
 *   - **`fullscreen`**, which is the manager's own preference on the match
 *     screen. Chromium asks the session before it grants it, so a shell that
 *     denied everything would quietly take that preference away.
 *   - **`persistent-storage`**, which the game asks for the first time it writes
 *     a career. A browser refuses a great deal of the time, and the game is
 *     written for that: the save screen then says the careers in it are kept
 *     "on a best-effort basis" and may be cleared if space runs short. That
 *     sentence is true of a website and false of an installed application, whose
 *     profile is its own directory and is not evicted to make room for another
 *     site — so refusing it here would be a shell telling the manager something
 *     alarming and untrue about the career he just started.
 *
 * Everything else in Chromium's list — camera, microphone, location,
 * notifications, clipboard, MIDI — is refused, and the game never asks for any of
 * it, so the refusal is never felt. It is two strings, in a list, in a file with
 * tests, rather than a lambda buried in a handler where nobody would ever read
 * it.
 */
const ALLOWED_PERMISSIONS: readonly string[] = ['fullscreen', 'persistent-storage'];

/** Whether Chromium may grant `permission` to the game. */
export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.includes(permission);
}

/**
 * The largest career file the bridge will write.
 *
 * A career is a few megabytes of JSON — the one this repository exported while
 * the Android shell was being checked was 5,360,556 bytes — so this is an order
 * of magnitude above anything the game produces. It exists to bound a message
 * that crossed the bridge: without it, a single call could ask the shell to
 * hold an arbitrary amount of memory in a string and then write it to disk.
 */
export const CAREER_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** The name of a career file, and the text of it. Nothing else is accepted. */
export interface CareerWriteRequest {
  readonly name: string;
  readonly text: string;
}

export type WriteRequestParse =
  | { readonly ok: true; readonly request: CareerWriteRequest }
  | { readonly ok: false; readonly reason: string };

/** The extension the game names its career files with and reads them back by. */
const CAREER_SUFFIX = '.json';

/** Long enough for a club name and a day, short enough for any file system. */
const CAREER_NAME_LIMIT = 120;

/** Used only when the page sent nothing that could be written at all. */
const CAREER_NAME_FALLBACK = 'sunday-eleven-27-career';

/** Characters a file system may refuse once the file is copied off the machine. */
const RESERVED = '\\/:*?"<>|';

/**
 * A file name that is safe to hand to the file system.
 *
 * The name arrives from the page — the game builds it from the club and the day —
 * and it is not trusted, for two reasons that are worth keeping apart. The first
 * is that a name is a name: a string from a page that reaches a file system
 * unexamined can carry a separator with it and name somewhere other than the
 * folder it was meant for. The second is that the manager will read this name
 * back out of his own folders, on a machine whose file system may be a different
 * one to this, so what cannot be written is replaced and what can be is left
 * exactly as the page wrote it.
 *
 * This mirrors the Android shell's rules (`android/.../CareerFiles.java`) rule for
 * rule, deliberately: the same career exported on a phone and on a desktop should
 * end up with the same name.
 */
export function careerFileName(raw: string): string {
  let name = raw.trim();

  // Only the last segment: a name is not a path, and a page does not get to say
  // which folder a career is written into.
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSeparator >= 0) name = name.slice(lastSeparator + 1);

  let kept = '';
  for (const character of name) {
    // Control characters, including the null byte, have no place in a name at
    // all; the reserved ones become a dash so that a club called "Bramford
    // Rovers: Reserves" still reads as itself.
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    kept += RESERVED.includes(character) ? '-' : character;
  }

  // The stem, with the extension taken off if it already had one, so that
  // ".json" and "   " are the same thing to the rule below: a name with nothing
  // in it at all.
  let stem = kept.toLowerCase().endsWith(CAREER_SUFFIX)
    ? kept.slice(0, kept.length - CAREER_SUFFIX.length)
    : kept;

  // A name that begins with a dot is a hidden file, which is a backup nobody
  // finds. Done on the stem so that the dots come off whether or not an
  // extension was there — "..career" and ".json" are the same complaint.
  while (stem.startsWith('.')) stem = stem.slice(1);
  stem = stem.trim();

  if (stem === '') stem = CAREER_NAME_FALLBACK;
  if (stem.length > CAREER_NAME_LIMIT - CAREER_SUFFIX.length) {
    stem = stem.slice(0, CAREER_NAME_LIMIT - CAREER_SUFFIX.length);
  }
  return stem + CAREER_SUFFIX;
}

/**
 * What the game asked for, or why it is being refused.
 *
 * Strict on purpose, and strict about *shape* as well as types. An unexpected
 * field is a refusal rather than something to ignore: the bridge is a fixed
 * contract with one caller, so a message that does not look like that contract
 * is either a bug worth hearing about or something that is not the game at all,
 * and neither should be written to a disk quietly.
 */
export function parseWriteRequest(
  payload: unknown,
  maxBytes: number = CAREER_FILE_MAX_BYTES,
): WriteRequestParse {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: 'the request was not an object' };
  }

  const keys = Object.keys(payload as Record<string, unknown>).sort();
  if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'text') {
    return { ok: false, reason: `the request carried unexpected fields (${keys.join(', ') || 'none'})` };
  }

  const { name, text } = payload as { name?: unknown; text?: unknown };
  if (typeof name !== 'string' || typeof text !== 'string') {
    return { ok: false, reason: 'the file name and its contents must both be text' };
  }
  if (text === '') return { ok: false, reason: 'there was nothing to write' };

  // Measured in bytes rather than characters, because that is what the write
  // costs and what a disk runs out of. A whole career has to be encoded to be
  // measured honestly, which is a few milliseconds for a few megabytes — the
  // export is already serialising a world, so this is not the expensive part.
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes) {
    return { ok: false, reason: `the file was larger than a career file may be (${bytes} bytes)` };
  }

  return { ok: true, request: { name: careerFileName(name), text } };
}

/* ------------------------------------------------------------------ *
 * What the shell will serve
 * ------------------------------------------------------------------ */

/**
 * Whether a message came from the game's own page.
 *
 * The main process asks this before it does anything a renderer asked for, and
 * it is asked of the *frame* rather than of the process: `app://se27` is the
 * only origin the application ever loads, so anything else — a page that
 * navigated somewhere, a frame inside one — is a request the game did not make.
 */
export function isTrustedSenderUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === APP_HOST;
}

/**
 * The file inside the renderer build a request is asking for.
 *
 * Returns a path relative to the build's root, or null when the request is not
 * one this application serves. The mapping is deliberately blunt: a URL path
 * becomes a relative path made of plain segments, and any segment that could
 * mean *somewhere else* — `..`, an encoded `..`, a Windows drive letter, a
 * backslash — is refused rather than sanitised. The main process then joins the
 * answer to the build root and refuses anything that lands outside it, in the
 * terms the file system itself uses; two independent checks for one mistake,
 * because this is the only place a string from a page reaches the disk at all.
 */
export function assetRequestPath(requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    // A path that is not valid percent-encoding is not a file name either.
    return null;
  }
  if (pathname.includes('\0')) return null;

  // A backslash is a directory separator to Windows whatever it means to a URL,
  // so both kinds are treated the same here.
  const normalised = pathname.replace(/\\/g, '/');
  const segments = normalised.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..' || segment.includes(':'))) return null;

  // The root, and anything ending in a slash, is the entry document — which is
  // also what a manager typing the origin into DevTools should get.
  if (segments.length === 0 || normalised.endsWith('/')) {
    return [...segments, 'index.html'].join('/');
  }
  return segments.join('/');
}

/** What to label a file with, by extension. Hashed asset names change; these do not. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  switch (extension) {
    case 'html':
      return 'text/html; charset=utf-8';
    case 'js':
    case 'mjs':
      return 'text/javascript; charset=utf-8';
    case 'css':
      return 'text/css; charset=utf-8';
    case 'json':
    case 'map':
      return 'application/json; charset=utf-8';
    case 'webmanifest':
      return 'application/manifest+json; charset=utf-8';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'wasm':
      return 'application/wasm';
    default:
      // A wrong `Content-Type` on a module is a page that will not start, so the
      // fallback is the one that a browser will still try to use as a file.
      return 'application/octet-stream';
  }
}

/**
 * The policy every file the game loads is served under.
 *
 * The game is one bundle, one stylesheet, a handful of images and no network
 * access at all, so the policy says exactly that: nothing may be loaded from
 * anywhere but the application itself, and nothing may be *executed* that came
 * from a string. `style-src` is the one concession — React writes `style`
 * attributes for the pitch, the kit and the scoreline, and the entry document
 * carries the booting placeholder's own rules — and it is a concession about
 * styles only, which is the shape Electron's own guidance expects for a React
 * renderer. `object-src`, `base-uri` and `form-action` are `none` because this
 * application has no plugins, no relative-URL trickery and no forms to submit.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** The answer a bridge call gets when the shell would not write the file. */
export function refused(reason: string): DesktopWriteReply {
  return { written: false, reason };
}
