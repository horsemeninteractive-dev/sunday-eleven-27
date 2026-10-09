import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import preload from '../../desktop/preload.ts?raw';
import rules from '../../desktop/rules.ts?raw';
import main from '../../desktop/main.ts?raw';
import desktopPackage from '../../desktop/package.json';
import builderConfig from '../../electron-builder.yml?raw';
import desktopTsconfig from '../../tsconfig.desktop.json';
import desktopEnv from '../../.env.desktop?raw';
import gitignore from '../../.gitignore?raw';
import packageJson from '../../package.json?raw';
import viteConfig from '../../vite.config.ts?raw';
import { CHANNELS, CONTENT_SECURITY_POLICY } from '../../desktop/rules';

/**
 * The desktop package, held to what it claims.
 *
 * These are facts about *this repository's* Electron project, read out of the
 * files that state them, in the same way `release.test.ts` reads the Android
 * project and `workspaces.test.ts` reads the stylesheet. A packaging
 * configuration is the one kind of code that cannot be checked by running it:
 * every mistake in it is invisible until an installer is built, installed on a
 * machine with no development tools, and opened — and then it is a blank window
 * or a missing save rather than an exception.
 *
 * So the things pinned here are the things that would fail *there*: the entry
 * point the package actually declares, the identity and version it ships as, the
 * four webPreferences that decide what a page in it can reach, the renderer
 * build going somewhere other than the web deployment's `dist`, and the two
 * halves of the bridge naming the same channels.
 */

const parsed = JSON.parse(packageJson) as {
  name: string;
  version: string;
  main?: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('the package that is built', () => {
  it('declares the shell as its entry point, where the build puts it', () => {
    expect(parsed.main).toBe('desktop/build/main.js');
    expect(main).toMatch(/const RENDERER_ROOT = join\(__dirname, '\.\.', 'renderer'\)/);
    expect(desktopTsconfig.compilerOptions.outDir).toBe('desktop/build');
  });

  it('keeps the shell CommonJS, which is what a sandboxed preload must be', () => {
    // Electron refuses ESM in a sandboxed preload script, and Node decides a
    // `.js` file's module system from the nearest package.json — so this marker
    // file is what makes `desktop/build/preload.js` loadable at all. Both halves
    // are asserted because either one alone is a packaged application that opens
    // to a blank window.
    expect(desktopTsconfig.compilerOptions.module).toBe('CommonJS');
    expect(desktopPackage.type).toBe('commonjs');
  });

  it('states one identity and no version of its own', () => {
    expect(builderConfig).toMatch(/^appId: com\.sundayeleven\.se27$/m);
    expect(builderConfig).toMatch(/^productName: Sunday Eleven 27$/m);
    // The version is deliberately absent from the packaging configuration: it
    // comes from package.json, where the game writes it once, so an installer
    // can never be numbered differently to the build inside it.
    expect(builderConfig).not.toMatch(/^\s*version:/m);
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/);
    // And the same application id as the Android package: one game, two stores.
    expect(parsed.name).toBe('sunday-eleven-27');
  });

  it('ships the shell and the game, and nothing else', () => {
    expect(builderConfig).toMatch(/desktop\/build\/\*\*/);
    expect(builderConfig).toMatch(/desktop\/renderer\/\*\*/);
    // No node_modules: the shell requires Electron and Node's own modules, and
    // the game ships pre-built.
    expect(builderConfig).toMatch(/'!node_modules\/\*\*'/);
    // And nothing else: every entry in the list is one of the five things the
    // application is made of, so there is no room for a file to be bundled
    // quietly — no .env, no keystore, no certificate, nothing anybody's secret
    // could be in.
    const lines = builderConfig.split('\n');
    const start = lines.findIndex((line) => line.trim() === 'files:');
    const end = lines.findIndex((line) => line.trim() === 'asar: true');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const entries = lines
      .slice(start + 1, end)
      // The `!` in an exclusion is a YAML tag indicator, so that one entry is
      // quoted in the file; the quotes are punctuation here, not part of it.
      .map((line) => line.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, ''))
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(entries.sort()).toEqual(
      ['!node_modules/**', 'desktop/build/**', 'desktop/package.json', 'desktop/renderer/**', 'package.json'].sort(),
    );
  });

  it('leaves the manager’s own data outside the installation, and does not delete it', () => {
    expect(builderConfig).toMatch(/deleteAppDataOnUninstall: false/);
    expect(builderConfig).toMatch(/output: desktop-release/);
    expect(builderConfig).toMatch(/^publish: null$/m);
  });

  it('points its icon at the artwork the icon tool generates', () => {
    const icon = /^\s*icon: (.+)$/m.exec(builderConfig)?.[1]?.trim();
    expect(icon).toBe('store/apple-icon-1024.png');
    expect(existsSync(icon as string)).toBe(true);
  });
});

describe('the commands that build it', () => {
  it('builds the shell, the renderer and the installer as separate steps', () => {
    expect(parsed.scripts['desktop:shell']).toBe('tsc -p tsconfig.desktop.json');
    expect(parsed.scripts['desktop:renderer']).toBe('vite build --mode desktop --outDir desktop/renderer');
    expect(parsed.scripts['desktop:build']).toContain('npm run typecheck');
    expect(parsed.scripts['desktop:build']).toContain('npm run desktop:shell');
    expect(parsed.scripts['desktop:build']).toContain('npm run desktop:renderer');
    expect(parsed.scripts['desktop:pack']).toContain('electron-builder --win');
    expect(parsed.scripts['desktop:start']).toBe('electron .');
  });

  it('never writes the desktop build into the web deployment’s output', () => {
    // `dist/` is what Cloudflare Pages deploys. The desktop renderer goes
    // somewhere else, and the web build keeps writing exactly where it did.
    expect(parsed.scripts['build']).toBe('tsc --noEmit && vite build');
    expect(parsed.scripts['build:native']).toBe('tsc --noEmit && vite build --mode native');
    expect(parsed.scripts['build']).not.toContain('outDir');
    expect(parsed.scripts['desktop:renderer']).not.toContain('--outDir dist');
    // And the build output is ignored by git, all three directories of it.
    for (const ignored of ['desktop/build/', 'desktop/renderer/', 'desktop-release/']) {
      expect(gitignore, ignored).toContain(ignored);
    }
    expect(gitignore).toContain('dist/');
  });

  it('declares the desktop target in the build’s environment, and no other', () => {
    expect(desktopEnv).toMatch(/VITE_BUILD_TARGET=desktop/);
    // The packaged targets are the two that leave the website's three files
    // behind, and they are named in one place in the build config.
    expect(viteConfig).toContain("const PACKAGED_OMISSIONS = ['sw.js', '_headers', 'og.png']");
    expect(viteConfig).toMatch(/mode !== 'native' && mode !== 'desktop'/);
    // The precache manifest writes into the directory Vite was actually given,
    // rather than into a hard-coded `dist`, or the desktop build would put the
    // website's service worker list into a build that has no service worker.
    expect(viteConfig).toMatch(/outDir = resolve\(process\.cwd\(\), config\.build\.outDir\)/);
  });

  it('pins the Electron version it is built and tested against', () => {
    expect(parsed.devDependencies.electron).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.devDependencies['electron-builder']).toMatch(/^\d+\.\d+\.\d+$/);
    // Electron is a build tool here, never a runtime dependency of the game's
    // own bundle: the renderer is the same game the website ships.
    expect(packageJson).toMatch(/"dependencies": \{/);
    expect(main).toMatch(/from 'electron'/);
  });
});

describe('what the renderer is allowed to be', () => {
  it('is a sandbox, and not a Node process', () => {
    expect(main).toMatch(/contextIsolation: true/);
    expect(main).toMatch(/nodeIntegration: false/);
    expect(main).toMatch(/sandbox: true/);
    expect(main).toMatch(/webSecurity: true/);
    expect(main).toMatch(/allowRunningInsecureContent: false/);
    expect(main).not.toMatch(/nodeIntegration: true/);
    expect(main).not.toMatch(/contextIsolation: false/);
    expect(main).not.toMatch(/sandbox: false/);
    expect(main).not.toMatch(/webSecurity: false/);
    expect(main).not.toMatch(/enableRemoteModule/);
  });

  it('loads the game’s own bundled build, and cannot load the website', () => {
    expect(main).toMatch(/loadURL\(`\$\{APP_ORIGIN\}\/index\.html`\)/);
    // The one absolute URL in the file is the shell's own origin. A `server.url`
    // or a hosted address here would make the installed application a bookmark
    // that needs a signal to start and shows whatever was deployed rather than
    // what was tested.
    expect(main).not.toMatch(/loadURL\('https?:/);
    expect(main).not.toMatch(/server\.url/);
    expect(main).not.toMatch(/pages\.dev/);
    expect(main).not.toMatch(/registerSchemesAsPrivileged\(\[\s*\]/);
    expect(main).toMatch(/standard: true/);
    expect(main).toMatch(/secure: true/);
  });

  it('shuts the doors the game never opens, and says so when something knocks', () => {
    expect(main).toMatch(/setWindowOpenHandler/);
    expect(main).toMatch(/action: 'deny'/);
    expect(main).toMatch(/will-navigate/);
    expect(main).toMatch(/will-attach-webview/);
    // No shell access at all: the game has no links to open and no reason to
    // reach the operating system's own handlers.
    expect(main).not.toMatch(/openExternal/);
    expect(main).not.toMatch(/from 'electron'[^;]*\bshell\b/);
  });

  it('denies every permission except the two the game actually asks for', () => {
    expect(main).toMatch(/setPermissionRequestHandler/);
    expect(main).toMatch(/setPermissionCheckHandler/);
    // Full screen for the match screen's preference, and persistent storage for
    // the career the game has just written: a browser may refuse the second and
    // the game has a sentence for that, but the sentence is about websites.
    // Found by running the packaged application; see `permissionAllowed`.
    expect(rules).toMatch(/const ALLOWED_PERMISSIONS: readonly string\[\] = \['fullscreen', 'persistent-storage'\]/);
  });

  it('refuses a download, because a career goes through the bridge instead', () => {
    // The desktop build is one where the game's own export must reach the disk
    // through the host bridge, which knows where the file went. A download that
    // appeared anyway would be a file the game never promised.
    expect(main).toMatch(/will-download/);
    expect(main).toMatch(/item\.cancel\(\)/);
  });

  it('serves every file under the policy in rules.ts', () => {
    expect(main).toMatch(/'Content-Security-Policy': CONTENT_SECURITY_POLICY/);
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  });

  it('validates what crosses the bridge before it writes anything', () => {
    expect(main).toMatch(/if \(!trusted\(event\)\)/);
    expect(main).toMatch(/parseWriteRequest\(payload\)/);
    expect(main).toMatch(/frame !== event\.sender\.mainFrame/);
    // The renderer has no file system of its own, and the preload does not
    // import one.
    expect(preload).not.toMatch(/from 'node:fs'/);
    expect(preload).not.toMatch(/from 'fs'/);
    expect(preload).not.toMatch(/\brequire\(/);
  });

  it('exposes one object, with three members, and nothing else', () => {
    expect(preload).toMatch(/contextBridge\.exposeInMainWorld\('se27Desktop', shell\)/);
    expect(preload).toMatch(/Object\.freeze\(/);
    expect(preload).not.toMatch(/exposeInMainWorld\('se27Host'/);
    expect(preload).not.toMatch(/exposeInMainWorld\('require'/);
    // The preload is a sandboxed script, so it may not require a file of our
    // own: it names the channels as literals, and this is the test that stops
    // the two ends drifting apart.
    const literals = [...preload.matchAll(/const CHANNEL_[A-Z_]+ = '([^']+)'/g)].map((match) => match[1]);
    expect(literals.sort()).toEqual([CHANNELS.saveCareerFile, CHANNELS.flushRequested, CHANNELS.flushDone].sort());
  });
});

describe('the closing handshake', () => {
  it('holds the window open until the game confirms its last save', () => {
    expect(main).toMatch(/event\.preventDefault\(\)/);
    expect(main).toMatch(/win\.webContents\.send\(CHANNELS\.flushRequested\)/);
    expect(main).toMatch(/ipcMain\.on\(CHANNELS\.flushDone/);
    // And gives up rather than hanging for ever: a game that cannot answer must
    // not be an application that cannot be closed.
    expect(main).toMatch(/FLUSH_TIMEOUT_MS/);
    expect(main).toMatch(/setTimeout\(/);
  });
});
