import { describe, expect, it } from 'vitest';
import {
  APP_ORIGIN,
  CAREER_FILE_MAX_BYTES,
  CONTENT_SECURITY_POLICY,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  assetRequestPath,
  careerFileName,
  contentTypeFor,
  isTrustedSenderUrl,
  parseWriteRequest,
  permissionAllowed,
  restoreBounds,
} from '../../desktop/rules';

/**
 * The desktop shell's rules, held to account where they live.
 *
 * Every one of these decides something the shell then does: what a career file
 * is called on a manager's disk, which request a page is allowed to turn into a
 * file read, whether a message that crossed the preload bridge is one we asked
 * for, where a remembered window opens. They are tested here — in the game's own
 * suite, with no Electron and no window — because that is the reason they are a
 * separate module rather than lambdas inside `main.ts`.
 */

describe('the name a career file is written under', () => {
  const GAME_NAME = 'sunday-eleven-27-career-bramford-rovers-2026-10-09.json';

  it('keeps the name the game itself sends', () => {
    // The sentence the manager is shown quotes this name back to him, and he
    // then goes looking for it: the ordinary case must not be rewritten.
    expect(careerFileName(GAME_NAME)).toBe(GAME_NAME);
  });

  it('never names a path', () => {
    // A separator in a name is a name that decides which folder it lands in.
    expect(careerFileName('../../etc/passwd')).toBe('passwd.json');
    expect(careerFileName('C:\\Users\\alex\\career')).toBe('career.json');
    expect(careerFileName('/home/alex/career.json')).toBe('career.json');
    expect(careerFileName('a/b/c.json')).not.toContain('/');
  });

  it('keeps out the characters a file system may refuse', () => {
    // Windows refuses these outright; the name arrives from a page, whose club
    // names contain apostrophes, colons and the odd quote.
    expect(careerFileName('a<b>c?d*e|f"g.json')).toBe('a-b-c-d-e-f-g.json');
    expect(careerFileName('bramford:rovers.json')).toContain('-');
  });

  it('drops control characters rather than truncating the name', () => {
    expect(careerFileName('a\u0000b.json')).toBe('ab.json');
    expect(careerFileName('a\r\nb.json')).toBe('ab.json');
  });

  it('hides nothing, and never produces an empty name', () => {
    // A leading dot is a hidden file, which is a backup nobody finds.
    expect(careerFileName('.career')).toBe('career.json');
    expect(careerFileName(' ..career')).toBe('career.json');
    expect(careerFileName('.json')).toBe('sunday-eleven-27-career.json');
    expect(careerFileName('')).toBe('sunday-eleven-27-career.json');
    expect(careerFileName('   ')).toBe('sunday-eleven-27-career.json');
  });

  it('always ends in the extension the game reads back', () => {
    expect(careerFileName('career')).toBe('career.json');
    expect(careerFileName('CAREER.JSON')).toBe('CAREER.json');
    expect(careerFileName('x'.repeat(400) + '.json').length).toBeLessThanOrEqual(120);
  });
});

describe('what the game may ask the shell to write', () => {
  const good = { name: 'career.json', text: '{"format":"se27.career"}' };

  it('accepts exactly the message the game sends', () => {
    const parsed = parseWriteRequest(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request).toEqual(good);
  });

  it('sanitises the name rather than trusting it', () => {
    const parsed = parseWriteRequest({ name: '../evil.json', text: '{}' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.name).toBe('evil.json');
  });

  it('refuses anything that is not that message', () => {
    // Shape as well as type: the bridge is a fixed contract with one caller, so
    // a message that does not look like it is either a bug worth hearing about
    // or something that is not the game at all.
    for (const payload of [null, undefined, 'text', 42, [], {}, { name: 'x.json' }, { text: '{}' }]) {
      expect(parseWriteRequest(payload).ok, `${JSON.stringify(payload)} was accepted`).toBe(false);
    }
    expect(parseWriteRequest({ name: 1, text: 2 }).ok).toBe(false);
  });

  it('refuses a payload with anything extra in it', () => {
    const parsed = parseWriteRequest({ ...good, path: 'C:\\Windows' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/unexpected fields/);
  });

  it('refuses an empty file and a file bigger than a career may be', () => {
    expect(parseWriteRequest({ name: 'a.json', text: '' }).ok).toBe(false);
    // The limit is a parameter so that the test does not have to build 64 MB of
    // string to prove the rule works.
    expect(parseWriteRequest({ name: 'a.json', text: 'x'.repeat(20) }, 16).ok).toBe(false);
    expect(parseWriteRequest({ name: 'a.json', text: 'x'.repeat(16) }, 16).ok).toBe(true);
    // Measured in bytes, not characters: four-byte characters cost four.
    expect(parseWriteRequest({ name: 'a.json', text: '😀😀😀' }, 8).ok).toBe(false);
  });

  it('is allowed a file the size of the careers this game actually writes', () => {
    // The career exported on the phone while the Android shell was being checked
    // was 5,360,556 bytes, so anything near this bound is an order of magnitude
    // above real life.
    expect(CAREER_FILE_MAX_BYTES).toBeGreaterThan(5_360_556 * 4);
  });
});

describe('what the shell will serve', () => {
  it('serves the build root, and a directory as the entry document', () => {
    expect(assetRequestPath(`${APP_ORIGIN}/index.html`)).toBe('index.html');
    expect(assetRequestPath(`${APP_ORIGIN}/`)).toBe('index.html');
    expect(assetRequestPath(APP_ORIGIN)).toBe('index.html');
    expect(assetRequestPath(`${APP_ORIGIN}/assets/index-abc123.js`)).toBe('assets/index-abc123.js');
  });

  it('refuses anything that could mean somewhere else', () => {
    // The encoded form is the one that matters: a *standard* scheme resolves a
    // plain `..` before this function ever sees it (see the test below), so the
    // traversal that reaches the disk is the one a URL does not normalise — an
    // encoded separator, a Windows drive letter, a backslash, a null byte.
    for (const url of [
      // An *encoded* separator is the one a URL does not normalise: the segment
      // looks like a file name until it is decoded, and then it is a climb.
      `${APP_ORIGIN}/%2e%2e%2f%2e%2e%2fsecrets.txt`,
      `${APP_ORIGIN}/%2e%2e%2fsecrets.txt`,
      `${APP_ORIGIN}/C:/Windows/System32/config/SAM`,
      `${APP_ORIGIN}/assets\\..\\..\\secrets.txt`,
      `${APP_ORIGIN}/index.html%00.png`,
    ]) {
      expect(assetRequestPath(url), url).toBeNull();
    }
  });

  it('keeps a plain `..` inside the build rather than letting it climb out', () => {
    // A standard scheme normalises a dot segment before this function is ever
    // handed the path — `../../secrets.txt` arrives as `/secrets.txt`, and
    // `%2e%2e/%2e%2e/` the same way — and what it names is therefore a file
    // *inside* the renderer build rather than one above it. What matters is the
    // property rather than the spelling: whatever comes back names a plain file
    // inside the build, and the main process checks that again in the terms the
    // file system itself uses.
    for (const url of [
      `${APP_ORIGIN}/../../secrets.txt`,
      `${APP_ORIGIN}/assets/../../secrets.txt`,
      `${APP_ORIGIN}/assets/%2e%2e/%2e%2e/secrets.txt`,
      `${APP_ORIGIN}/%2fetc%2fpasswd`,
    ]) {
      const path = assetRequestPath(url);
      expect(path, url).not.toBeNull();
      expect(path, url).not.toContain('..');
      expect(path?.startsWith('/'), url).toBe(false);
      expect(path, url).not.toContain(':');
    }
  });

  it('refuses another origin, another scheme and a broken URL', () => {
    expect(assetRequestPath('app://somewhere-else/index.html')).toBeNull();
    expect(assetRequestPath('file:///C:/Windows/win.ini')).toBeNull();
    expect(assetRequestPath('https://sundayeleven.pages.dev/')).toBeNull();
    expect(assetRequestPath('not a url')).toBeNull();
  });

  it('labels a file by what it is', () => {
    // A wrong content type on a module is a page that never starts.
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('assets/index-abc.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('assets/index-abc.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json; charset=utf-8');
    expect(contentTypeFor('icons/icon-512.png')).toBe('image/png');
    expect(contentTypeFor('scene-ground.webp')).toBe('image/webp');
    expect(contentTypeFor('sw.js.map')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('mystery')).toBe('application/octet-stream');
  });

  it('serves everything from the application and nowhere else', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    // A page that may be framed is a page that can be clicked through.
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    // And nothing may talk to a network: the game has no server.
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/connect-src[^;]*\*/);
  });
});

describe('whether a message came from the game', () => {
  it('says yes only for the game’s own origin', () => {
    expect(isTrustedSenderUrl(`${APP_ORIGIN}/index.html`)).toBe(true);
    expect(isTrustedSenderUrl(`${APP_ORIGIN}/`)).toBe(true);
    // The mobile shell's origin, the website, a data URL and nothing at all.
    expect(isTrustedSenderUrl('https://localhost/')).toBe(false);
    expect(isTrustedSenderUrl('https://sundayeleven.pages.dev/')).toBe(false);
    expect(isTrustedSenderUrl('app://evil/index.html')).toBe(false);
    expect(isTrustedSenderUrl('data:text/html,<h1>hi</h1>')).toBe(false);
    expect(isTrustedSenderUrl('about:blank')).toBe(false);
    expect(isTrustedSenderUrl(null)).toBe(false);
    expect(isTrustedSenderUrl(undefined)).toBe(false);
    expect(isTrustedSenderUrl('')).toBe(false);
  });
});

describe('what the game is allowed to have', () => {
  it('grants the two the game asks for, and nothing else', () => {
    // Full screen is the manager's own preference on the match screen.
    // Persistent storage is asked for the first time a career is written, and it
    // is granted because the alternative is the save screen telling the manager
    // his careers are kept on a best-effort basis — true of a website, untrue of
    // an application whose profile is its own directory. Everything else —
    // camera, microphone, location, clipboard, notifications — is refused, and
    // the game never asks.
    expect(permissionAllowed('fullscreen')).toBe(true);
    expect(permissionAllowed('persistent-storage')).toBe(true);
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'midi', 'openExternal']) {
      expect(permissionAllowed(permission), permission).toBe(false);
    }
  });
});

describe('where the window opens', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it('opens at the default size when nothing has been remembered', () => {
    const bounds = restoreBounds(null, display);
    expect(bounds.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
    expect(bounds.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT);
    expect(bounds.x).toBeUndefined();
    expect(bounds.y).toBeUndefined();
  });

  it('remembers where the manager put it', () => {
    expect(restoreBounds({ x: 200, y: 150, width: 1280, height: 800 }, display)).toEqual({
      x: 200,
      y: 150,
      width: 1280,
      height: 800,
    });
  });

  it('opens on a screen that is there rather than the one that has gone', () => {
    // A second monitor is unplugged; a remembered window on it must not open off
    // the edge of the world with its menu unreachable. The size survives, the
    // position does not, and Electron centres it.
    const bounds = restoreBounds({ x: 3400, y: 20, width: 1280, height: 800 }, display);
    expect(bounds).toEqual({ width: 1280, height: 800 });
  });

  it('never opens smaller than the game can be used at, or larger than the screen', () => {
    expect(restoreBounds({ width: 300, height: 200 }, display).width).toBe(MIN_WINDOW_WIDTH);
    expect(restoreBounds({ width: 300, height: 200 }, display).height).toBe(MIN_WINDOW_HEIGHT);
    // A window remembered on a 4K display, opened on a laptop: the work area is
    // what it may fill, not the screen.
    const laptop = { x: 0, y: 0, width: 1366, height: 728 };
    expect(restoreBounds({ width: 2560, height: 1440 }, laptop)).toEqual({ width: 1366, height: 728 });
  });

  it('pulls a half-off-screen window back into view', () => {
    // Moved mostly off the left edge: enough of it is still visible for its place
    // to be worth keeping, and it is pulled back so that a strip the manager can
    // grab is always there.
    const bounds = restoreBounds({ x: -600, y: -20, width: 1280, height: 800 }, display);
    expect(bounds.x).toBeGreaterThanOrEqual(-1280 + 96);
    expect(bounds.x).toBeLessThanOrEqual(display.width - 96);
    expect(bounds.y).toBeGreaterThanOrEqual(-800 + 96);
    expect(bounds.y).toBeLessThanOrEqual(display.height - 96);
  });

  it('gives up on a window that is barely on the screen at all', () => {
    // Two pixels of title bar is not a place worth remembering, and restoring it
    // is how a game opens with its menu unreachable.
    expect(restoreBounds({ x: -1278, y: 40, width: 1280, height: 800 }, display)).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it('ignores a remembered position that is not a pair of numbers', () => {
    const state = { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 1280, height: 800 } as never;
    expect(restoreBounds(state, display)).toEqual({ width: 1280, height: 800 });
  });
});
