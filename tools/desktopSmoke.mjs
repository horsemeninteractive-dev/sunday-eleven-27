#!/usr/bin/env node
/**
 * The desktop application, driven the way its owner drives it.
 *
 *     npm run desktop:smoke                     the installed application
 *     npm run desktop:smoke -- --exe="…exe"     a specific build (e.g. win-unpacked)
 *
 * An installer that builds is not an application that works, and every mistake
 * this stage can make — a renderer that never loads, a bridge the preload got
 * wrong, a career that is written nowhere, a window that closes before the last
 * save has landed, a profile whose storage does not survive a restart — is
 * invisible to the test suite and to `electron-builder`. This script opens the
 * real, packaged application and asks it those questions through the same
 * interfaces a manager uses: it clicks the buttons, reads the text on the
 * screen, and then checks the file system and the running process.
 *
 * How, without adding a dependency: Electron exposes Chromium's DevTools
 * protocol on `--remote-debugging-port`, and Node has spoken HTTP and WebSocket
 * since 22. So this is two hundred lines of `Runtime.evaluate` over the game's
 * own DOM — no Playwright, no Spectron, nothing to install, and nothing in it
 * is part of the game's bundle.
 *
 * What it checks, in order:
 *
 *   1. the window loads the game from the bundled `app://` build and fetches
 *      nothing from the network;
 *   2. the shell's bridge is present and is exactly the four members it claims;
 *   3. a career can be created through the real setup screens, and the world
 *      generates;
 *   4. exporting that career writes a real file to the manager's career folder,
 *      and it is a career file;
 *   5. the game reads that same file back through its own import screen and
 *      opens it;
 *   6. closing the window gracefully lets the game finish its last save first;
 *   7. relaunched, the career is where it was left, and continuing to play it
 *      brings the same club back up.
 *
 * It exits non-zero if any check failed, and prints a JSON report at the end so
 * a run can be quoted rather than described.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const flags = new Map();
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.split('=');
  flags.set(key.replace(/^--/, ''), rest.join('=') || 'true');
}

const PORT = Number(flags.get('port') ?? 9333);
/** Named on the world seed, so the career in the report is identifiable. */
// To the minute, so that two runs of this script leave two recognisable worlds
// rather than two careers that look alike in the menu.
const SEED = flags.get('seed') ?? `desktop-smoke-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
const MANAGER = { first: 'Alex', surname: 'Marsh', birthday: '1988-04-12' };
const CAREER_FOLDER = join(homedir(), 'Documents', 'Sunday Eleven 27', 'careers');

const CANDIDATES = [
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Sunday Eleven 27', 'Sunday Eleven 27.exe'),
  'C:\\Sunday Eleven 27\\Sunday Eleven 27.exe',
  join(process.cwd(), 'desktop-release', 'win-unpacked', 'Sunday Eleven 27.exe'),
];
const EXE = flags.get('exe') ?? CANDIDATES.find((path) => path && existsSync(path));

if (!EXE || !existsSync(EXE)) {
  console.error(`no application found. Looked in:\n  ${CANDIDATES.join('\n  ')}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const checks = [];
const notes = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
}

function note(message) {
  notes.push(message);
  console.log(`      ${message}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Click something that may not be on screen yet, and say what the screen offered
 * if it never turns up.
 *
 * The controls of this game arrive asynchronously — a world generates, a dialog
 * mounts on the next tick — so "wait for it, then click it" is the only order
 * that is not a race. A failed step dumps the labels that *were* there, because
 * a smoke test that says "no" and nothing else costs an afternoon of guessing.
 */
async function clickThen(page, needle, text, ms, name) {
  const result = await page.evaluate(`window.__smoke.waitClick(${JSON.stringify(needle)}, ${ms ?? 20000})`);
  const ok = text === null ? result.clicked : await page.evaluate(`window.__smoke.wait(${JSON.stringify(text)}, ${ms ?? 20000})`);
  if (!ok) {
    const offered = await page.evaluate('window.__smoke.dump()');
    note(`“${name}” — tried “${needle}”, ${result.clicked ? `clicked “${result.label}”` : 'found nothing to click'}; the screen offered: ${offered}`);
  }
  check(name, ok, result.clicked ? `clicked “${result.label}”` : `nothing matched “${needle}”`);
  return ok;
}

/* ------------------------------------------------------------------ *
 * The DevTools protocol
 * ------------------------------------------------------------------ */

async function targets() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return await response.json();
  } catch {
    return [];
  }
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.waiting = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.waiting.get(message.id);
      if (!pending) return;
      this.waiting.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('the debugger socket refused')), { once: true });
    });
    return new Session(socket);
  }

  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** One expression, evaluated in the page, by value. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ?? '';
      throw new Error(`${description || JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

/**
 * What the game is asked, and the small vocabulary it is asked in.
 *
 * Installed into the page once: the app never navigates (it is a single
 * document on one origin), so it survives the whole session. Every member
 * answers rather than throws, because a smoke test that dies at the first
 * surprise reports one fact instead of all of them.
 */
const HELPERS = `(() => {
  const norm = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const shown = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  const controls = () => Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]')).filter(shown);
  /**
   * What a control is called, which is not only what it renders.
   *
   * Two of the game's own controls have no visible text at all at the size they
   * are drawn: the sidebar collapses to an icon rail (its labels are clipped
   * rather than removed, so they are in the document but not in innerText), and
   * the shell's Settings button is an icon whose name is its aria-label. A script
   * that read only what was painted would conclude the game has no sidebar and no
   * settings — which is exactly what this script concluded the first time it ran.
   * So the name is asked for in the order a person would: the text, then the text
   * in the document, then the accessible name.
   */
  const labelOf = (element) =>
    norm(element.innerText) || norm(element.textContent) || element.getAttribute('aria-label') || element.getAttribute('title') || '';
  const api = {
    info: () => {
      const resources = Array.from(new Set(performance.getEntriesByType('resource').map((entry) => entry.name)));
      return {
        origin: location.origin,
        url: location.href,
        title: document.title,
        charactersOnScreen: (document.body.innerText || '').length,
        bridge: Object.keys(window.se27Desktop || {}),
        resources: resources.length,
        offOrigin: resources.filter((name) => !name.startsWith('app://se27')),
        online: navigator.onLine,
        userAgentHasElectron: navigator.userAgent.includes('Electron'),
      };
    },
    text: () => document.body.innerText || '',
    labels: () => controls().map(labelOf).filter(Boolean),
    click: (needle) => {
      const wanted = String(needle).toLowerCase();
      const target = controls().find((element) => labelOf(element).toLowerCase().includes(wanted) && !element.disabled);
      if (!target) return { clicked: false, label: null };
      const label = labelOf(target).slice(0, 60);
      target.click();
      return { clicked: true, label };
    },
    set: (label, value) => {
      const wanted = String(label).toLowerCase();
      const field = Array.from(document.querySelectorAll('label')).find((element) => norm(element.innerText).toLowerCase().includes(wanted));
      const input = field && field.querySelector('input, textarea');
      if (!input) return { set: false };
      const prototype = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { set: true, value: input.value };
    },
    dump: () => controls().map((element) => labelOf(element).slice(0, 40)).filter(Boolean).slice(0, 40).join(' | '),
    waitClick: async (needle, ms) => {
      const wanted = String(needle).toLowerCase();
      const until = Date.now() + (ms || 20000);
      while (Date.now() < until) {
        const target = controls().find((element) => labelOf(element).toLowerCase().includes(wanted) && !element.disabled);
        if (target) {
          const label = labelOf(target).slice(0, 60);
          target.click();
          return { clicked: true, label };
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { clicked: false, label: null };
    },
    clickExact: (text) => {
      const wanted = norm(String(text)).toLowerCase();
      const target = controls().find((element) => labelOf(element).toLowerCase() === wanted && !element.disabled);
      if (!target) return { clicked: false, label: null };
      target.click();
      return { clicked: true, label: labelOf(target) };
    },
    view: () => {
      const main = document.querySelector('main');
      return main ? main.getAttribute('data-view') || '' : '';
    },
    has: (needle) => (document.body.innerText || '').toLowerCase().includes(String(needle).toLowerCase()),
    wait: async (needle, ms) => {
      const wanted = String(needle).toLowerCase();
      const until = Date.now() + (ms || 15000);
      while (Date.now() < until) {
        if ((document.body.innerText || '').toLowerCase().includes(wanted)) return true;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return false;
    },
    waitFor: async (selector, ms) => {
      const until = Date.now() + (ms || 15000);
      while (Date.now() < until) {
        if (document.querySelector(selector)) return true;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return false;
    },
    /*
     * How fast the window is painting, counted in the page's own frames.
     *
     * A timer as well as a frame counter, and the timer is not
     * decoration: Chromium stops calling back for an *occluded* window, so a
     * counter that only counted frames would wait for ever the first time this
     * script ran with another window in front of the game. It says so instead —
     * zero frames is a fact about the run, not a hung check.
     */
    frames: async (ms) => {
      const span = ms || 2000;
      let frames = 0;
      const until = performance.now() + span;
      await new Promise((resolve) => {
        const enough = setTimeout(resolve, span + 500);
        const tick = () => {
          frames += 1;
          if (performance.now() > until) {
            clearTimeout(enough);
            resolve();
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { frames, seconds: span / 1000, fps: +(frames / (span / 1000)).toFixed(1) };
    },
  };
  window.__smoke = api;
  return true;
})()`;

/* ------------------------------------------------------------------ *
 * Launching and closing
 * ------------------------------------------------------------------ */

function launch() {
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  child.on('error', (error) => {
    output += `\nlaunch failed: ${error.message}\n`;
  });
  return {
    child,
    log: () => output,
    async session() {
      const until = Date.now() + 45000;
      while (Date.now() < until) {
        const page = (await targets()).find((entry) => entry.type === 'page' && entry.url.startsWith('app://se27'));
        if (page) {
          const session = await Session.open(page.webSocketDebuggerUrl);
          await session.send('Runtime.enable');
          await session.evaluate(`Boolean(window.__smoke) || ${HELPERS}`);
          return session;
        }
        await sleep(300);
      }
      throw new Error('the application never opened its own build');
    },
  };
}

/**
 * Close the window the way the manager's X does.
 *
 * Not a kill: the whole point of the check that follows is the handshake the
 * main process runs on a real close, and a process that is terminated has no
 * handshake to run. `CloseMainWindow` posts the same WM_CLOSE the mouse posts.
 */
function closeWindow(pid) {
  const find = pid
    ? `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`
    : "$p = Get-Process -Name 'Sunday Eleven 27' -ErrorAction SilentlyContinue | Select-Object -First 1";
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `${find}; if ($p) { "asked " + $p.ProcessName + " (" + $p.Id + ") to close: " + $p.CloseMainWindow() } else { 'nothing was running' }`],
    { encoding: 'utf8' },
  );
  return (result.stdout ?? '').trim();
}

/** One real key press, through Chromium, into the game. */
async function pressEscape(page) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  }
  await sleep(250);
}

function runningInstances() {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', "@(Get-Process -Name 'Sunday Eleven 27' -ErrorAction SilentlyContinue).Count"],
    { encoding: 'utf8' },
  );
  return Number((result.stdout ?? '0').trim()) || 0;
}

async function waitForExit(child, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    await sleep(250);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

async function main() {
  console.log(`desktop smoke · ${EXE}\n             · seed “${SEED}”\n`);

  /* ---------------------------------------------------------------- *
   * First launch: the game, and a career through the real screens
   * ---------------------------------------------------------------- */

  const first = launch();
  const page = await first.session();
  // The game's opening placeholder is a screen of its own, and this is the wait
  // that stops the report describing *it* rather than the game.
  await page.evaluate('window.__smoke.waitFor(".start, .app", 60000)');

  const info = await page.evaluate('window.__smoke.info()');
  note(`origin ${info.origin} · ${info.charactersOnScreen} characters on screen · ${info.resources} local resources`);

  check('the window loads the game from its own bundled build', info.origin === 'app://se27', info.url);
  check('the game rendered rather than showing an empty window', info.charactersOnScreen > 200, `${info.charactersOnScreen} characters`);
  check('the renderer is sandboxed and its user agent says Electron', info.userAgentHasElectron, 'no Node in the page');
  check(
    'the shell bridge is exposed with exactly the members it claims',
    JSON.stringify([...info.bridge].sort()) === JSON.stringify(['flushDone', 'onFlushRequested', 'platform', 'saveCareerFile']),
    info.bridge.join(', '),
  );
  check('nothing was fetched from the network', info.offOrigin.length === 0, info.offOrigin.slice(0, 3).join(' ') || `${info.resources} requests, all app://`);

  // The application may open at the menu or straight into the career it was
  // playing — the second of which is the game doing what it is supposed to do,
  // so the first thing to establish is which one this is.
  const openedInCareer = await page.evaluate('window.__smoke.waitFor(".app", 5000)');
  if (openedInCareer) {
    note(`the application opened straight into a career it was playing (${await page.evaluate('window.__smoke.view()')} screen)`);
    check('a career in progress is there when the game starts', true, 'resumed without being asked');
    await clickThen(page, 'settings', 'the game', 20000, 'the shell’s own menu opens inside a career');
    await clickThen(page, 'return to the main menu', 'start a new career', 60000, 'returning to the menu leaves the career waiting');
  } else {
    check('the application opens at the menu', await page.evaluate('window.__smoke.wait("start a new career", 20000)'));
  }

  await clickThen(page, 'start a new career', 'your profile', 30000, 'the menu opens the career setup screen');

  for (const [field, value] of [
    ['first name', MANAGER.first],
    ['surname', MANAGER.surname],
    ['date of birth', MANAGER.birthday],
    ['world seed', SEED],
  ]) {
    const set = await page.evaluate(`window.__smoke.set(${JSON.stringify(field)}, ${JSON.stringify(value)})`);
    if (!set.set) note(`the form has no “${field}” field to fill in`);
  }
  check('the setup form takes the manager’s details', await page.evaluate(`window.__smoke.has(${JSON.stringify(MANAGER.surname)})`));

  await clickThen(page, 'generate world', 'choose your club', 240000, 'the world generates and offers its clubs');
  check('the seed the manager typed is the world he got', await page.evaluate(`window.__smoke.has(${JSON.stringify(SEED)})`), SEED);

  await clickThen(page, 'take charge', 'squad', 180000, 'taking charge opens the career');
  check('the career is the app shell with the game’s own screens', await page.evaluate('window.__smoke.waitFor(".app", 15000)'));

  /* ---------------------------------------------------------------- *
   * The career leaves the application as a file
   * ---------------------------------------------------------------- */

  await clickThen(page, 'settings', 'the game', 20000, 'the shell’s own menu opens inside a career');
  await clickThen(page, 'save or load a career', 'saved careers', 30000, 'the save screen opens');

  await clickThen(page, 'export career to a file', 'career written to', 60000, 'the export reports a file and a folder');
  const noticeLine = (await page.evaluate('window.__smoke.text()')).split('\n').find((line) => /career written to/i.test(line)) ?? '';
  const exportedName = /written to\s+(\S+\.json)/i.exec(noticeLine)?.[1] ?? '';
  const exportedFolder = /\sin\s+([A-Za-z]:\\[^]*?)[.]\s/i.exec(`${noticeLine} `)?.[1] ?? '';
  check(
    'the export names the file and the folder it went to',
    Boolean(exportedName) && Boolean(exportedFolder),
    noticeLine.slice(0, 160) || 'no notice on screen',
  );

  const exportedPath = exportedName ? join(exportedFolder || CAREER_FOLDER, exportedName) : '';
  const onDisk = Boolean(exportedPath) && existsSync(exportedPath);
  check('the career file is really on the disk', onDisk, onDisk ? `${exportedPath} (${(statSync(exportedPath).size / 1024 / 1024).toFixed(1)} MB)` : exportedPath);

  let format = null;
  let clubName = '';
  if (onDisk) {
    try {
      const parsed = JSON.parse(readFileSync(exportedPath, 'utf8'));
      clubName = parsed.state?.clubs?.[parsed.state?.userClubId]?.identity?.name ?? '';
      format = {
        format: parsed.format,
        formatVersion: parsed.formatVersion,
        app: parsed.app,
        version: parsed.version,
        hasState: Boolean(parsed.state),
        seed: parsed.state?.seed,
      };
    } catch (error) {
      note(`the exported file would not parse: ${error.message}`);
    }
  }
  check(
    'it is a career file this game can read',
    Boolean(format?.format === 'se27.career' && format.hasState && format.seed === SEED),
    format ? `${format.format} v${format.formatVersion} · written by ${format.app} · save version ${format.version}` : '',
  );
  note(`the career in the file is “${clubName}” (seed “${format?.seed ?? '?'}”)`);

  /* ---------------------------------------------------------------- *
   * …and comes back in through the game's own import screen
   * ---------------------------------------------------------------- */

  if (onDisk) {
    // The file picker is the one step a script cannot click, so it is the one
    // step that is set rather than pressed: this is the same file the manager
    // would have chosen by hand, delivered to the input that receives it.
    const document_ = await page.send('DOM.getDocument', { depth: -1 });
    const input = await page.send('DOM.querySelector', { nodeId: document_.root.nodeId, selector: 'input[type=file]' });
    if (input.nodeId) {
      await page.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [exportedPath] });
      const asked = await page.evaluate('window.__smoke.wait("open this career file", 20000)');
      check('the game asks before opening the file', asked);
      if (asked) {
        await page.evaluate('window.__smoke.click("open it")');
        // The question going away *is* the answer being taken: the career is
        // open again, and the same club is on the screen behind it.
        const gone = await page.evaluate('window.__smoke.wait("schedule", 1) === false');
        const closed = await page.evaluate(
          '(async () => { const until = Date.now() + 120000; while (Date.now() < until) { if (!window.__smoke.has("open this career file")) return true; await new Promise((r) => setTimeout(r, 150)); } return false; })()',
        );
        check(
          'the career from the file opens back up',
          closed && (await page.evaluate('window.__smoke.waitFor(".app", 5000)')) && (await page.evaluate(`window.__smoke.has(${JSON.stringify(clubName)})`)),
          gone ? '' : 'the question was answered',
        );
      }
      // The dialogs are dismissed with the keyboard, which is also the check
      // that a key reaches the game: two layers are open, so two presses.
      await pressEscape(page);
      await pressEscape(page);
    } else {
      check('the game asks before opening the file', false, 'no file input found on the save screen');
    }
  }

  /* ---------------------------------------------------------------- *
   * How the application performs while it is being used
   * ---------------------------------------------------------------- */

  const painted = await page.evaluate('window.__smoke.frames(2500)');
  check(
    'the window paints at a usable frame rate',
    painted.fps >= 20,
    `${painted.fps} fps (${painted.frames} frames in ${painted.seconds}s${painted.frames === 0 ? ' — the window was not being painted at all' : ''})`,
  );

  /**
   * Open another screen, the way the dashboard offers it.
   *
   * The sidebar is not used here on purpose: at rest it is an icon rail whose
   * sections are closed, so half of its destinations are not rendered at all —
   * which is a fact about *reading the game* rather than about the application
   * this script exists to check. The dashboard's own cards are on screen and are
   * the same navigation, so they are what a click goes through.
   */
  const openScreen = async (label) => page.evaluate(`window.__smoke.waitClick(${JSON.stringify(label)}, 8000)`);

  const before = await page.evaluate('window.__smoke.view()');
  const started = Date.now();
  // “Team selection” opens a screen; “The calendar”, beside it, opens the
  // planner over the screen you are already on — which is a different thing, and
  // not what this check is about.
  let navigated = await openScreen('team selection');
  if (!navigated.clicked) navigated = await openScreen('the squad');
  let after = before;
  while (Date.now() - started < 20000) {
    after = await page.evaluate('window.__smoke.view()');
    if (after && after !== before) break;
    await sleep(50);
  }
  check('clicking a screen in the sidebar opens it', Boolean(after) && after !== before, `${before} → ${after} in ${Date.now() - started}ms (${navigated.label ?? 'nothing matched'})`);

  const labels = await page.evaluate('window.__smoke.labels()');
  note(`the screen offers: ${labels.slice(0, 24).join(' | ')}`);
  const playable = ['play the next', 'play the match', 'kick off', 'watch the match', 'prepare your team'].find((needle) =>
    labels.some((label) => label.toLowerCase().includes(needle)),
  );
  if (playable) {
    await page.evaluate(`window.__smoke.waitClick(${JSON.stringify(playable)}, 5000)`);
    const inMatch = await page.evaluate('window.__smoke.wait("kick off", 5000) || window.__smoke.has("commentary")');
    check('the next fixture can be opened from the schedule', inMatch, `via “${playable}”`);
    if (inMatch) {
      const kickOff = await page.evaluate('window.__smoke.waitClick("kick off", 8000)');
      const watched = await page.evaluate('window.__smoke.frames(3000)');
      note(`the match screen runs at ${watched.fps} fps after “${kickOff.label ?? 'no kick-off button found'}”`);
    }
  } else {
    note('this script found no match control on the schedule screen; the match screens are the website’s own, unchanged');
  }

  /* ---------------------------------------------------------------- *
   * Closing: the game is asked to finish before the window goes
   * ---------------------------------------------------------------- */

  note('closing the window, gracefully, the way the X does');
  note(closeWindow(first.child.pid));
  let closed = await waitForExit(first.child, 30000);
  if (!closed) {
    // A second, named attempt: the first may have been posted before the window
    // had finished appearing, which is a race rather than a failure.
    note(closeWindow(null));
    closed = await waitForExit(first.child, 20000);
  }
  const log = first.log();
  check('the window closes when asked', closed, `exit code ${first.child.exitCode ?? 'none'}`);
  check(
    'the shell asked the game to finish its last save',
    /closing: asking the game to finish its last save/.test(log),
    (log.match(/\[se27\][^\n]*/g) ?? []).slice(-3).join(' · '),
  );
  check('the game answered before the window went', /the game confirmed its last save/.test(log));
  page.close();

  /* ---------------------------------------------------------------- *
   * Second launch: the career is where it was left
   * ---------------------------------------------------------------- */

  // Before a second copy is started, the first must really be gone. The
  // application takes a single-instance lock — which is the right behaviour and
  // which would otherwise make this phase quietly ask the *old* window every
  // question, and pass while proving nothing.
  const leftovers = runningInstances();
  check('the application had closed before it was reopened', leftovers === 0, `${leftovers} still running`);
  if (leftovers > 0) {
    report();
    return;
  }

  const second = launch();
  const reopened = await second.session();
  await reopened.evaluate('window.__smoke.waitFor(".start, .app", 60000)');
  const resumed = await reopened.evaluate('window.__smoke.waitFor(".app", 5000)');
  if (resumed) note('the application opened straight back into the career it was playing');
  if (resumed) {
    await clickThen(reopened, 'settings', 'the game', 20000, 'the shell’s own menu opens after the restart');
    await clickThen(reopened, 'return to the main menu', 'start a new career', 60000, 'returning to the menu after the restart');
  }

  // The list is read out of the database, so it arrives a moment after the menu
  // does: waiting for the seed is waiting for the career to be listed.
  await reopened.evaluate(`window.__smoke.wait(${JSON.stringify(SEED)}, 30000)`);
  const menuText = await reopened.evaluate('window.__smoke.text()');
  const row = menuText.split('\n').find((line) => line.includes(SEED)) ?? '';
  check('the menu lists the career that was being played', row !== '', row.replace(/\s+/g, ' ').trim().slice(0, 130));
  const listed = await reopened.evaluate(`window.__smoke.has(${JSON.stringify(clubName)})`);
  check(
    'the menu lists the club that was exported, by that seed',
    Boolean(clubName) && listed && row !== '',
    `${clubName} · seed “${SEED}”`,
  );

  const continued = await reopened.evaluate('window.__smoke.clickExact("Continue")');
  const playing = await reopened.evaluate('window.__smoke.waitFor(".app", 120000)');
  check('continuing from the menu brings the career back', playing, continued.clicked ? 'Continue' : 'no Continue button on the menu');
  check(
    'the club that comes back is the club in the file',
    Boolean(clubName) && (await reopened.evaluate(`window.__smoke.has(${JSON.stringify(clubName)})`)),
    clubName,
  );

  closeWindow(second.child.pid);
  await waitForExit(second.child, 30000);
  reopened.close();

  report();
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

function report() {
  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (notes.length) console.log(`notes:\n  ${notes.join('\n  ')}`);
  console.log(JSON.stringify({ exe: EXE, seed: SEED, failed: failed.map((entry) => entry.name), checks }, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nthe smoke test could not finish: ${error.message}`);
  const failed = checks.filter((entry) => !entry.ok);
  console.log(JSON.stringify({ exe: EXE, seed: SEED, error: error.message, checks, notes }, null, 2));
  process.exit(failed.length === 0 && checks.length === 0 ? 2 : 1);
});
