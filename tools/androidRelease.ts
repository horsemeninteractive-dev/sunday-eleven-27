/**
 * The Android release, checked before it is built and built when it is asked for.
 *
 * A store release is a sequence of things that each fail late if they fail at
 * all: a JDK in the wrong major version, an Android SDK without the platform the
 * project compiles against, a keystore that is missing or was never ignored by
 * git, a bundle built from an *old* `dist/` so the game inside it is a version
 * behind what the store is told, a signing key that is fine but not wired up.
 * Gradle reports all of these eventually, after several minutes and in its own
 * vocabulary, and the one that worries nobody until it is too late — the stale
 * assets — reports nothing at all: the bundle builds, signs, uploads and plays
 * last week's game.
 *
 * So this does the checking first, in the order that a person would, prints what
 * it found, and only then runs anything:
 *
 *     npm run android:preflight        what this machine can and cannot do
 *     npm run android:bundle           ...then build the signed .aab for Play
 *     npm run android:apk              ...then build the signed .apk to sideload
 *
 * The facts it checks live in `src/platform/release.ts`, as functions of text, so
 * that they can be tested on a machine with no SDK — which is exactly the machine
 * this was written on. Everything in this file that touches the world (the file
 * system, git, java) is the thin part; `release.test.ts` holds the rest.
 *
 * It never reads a password out loud. The keystore's values are reported as
 * present or absent, never printed, and a secret that has ever been tracked is
 * the one thing here that fails unconditionally — a keystore in git is a keystore
 * in every clone and every fork for ever, and deleting it afterwards does not
 * undelete it.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { productionBuildEnv } from './buildEnv';
import {
  aliasesFrom,
  blankSigningValues,
  malformedPropertiesValues,
  browserOnlyFilesPresent,
  buildToolsIsInstalled,
  buildToolsVersionFrom,
  GRADLE_JAVA,
  identityFrom,
  javaProblem,
  keyPasswordProblem,
  keystoreVerdict,
  manifestPermissions,
  passwordMismatchProblem,
  platformIsInstalled,
  PLAY_REQUIRED_TARGET_SDK,
  redactSecret,
  sdkLevelsFrom,
  signingPropertiesFrom,
  versionCodeFor,
} from '@/platform/release';

const ROOT = process.cwd();
const ANDROID = join(ROOT, 'android');
const APP = join(ANDROID, 'app');
const DIST = join(ROOT, 'dist');
const SYNCED = join(APP, 'src', 'main', 'assets', 'public');

// --- Output ----------------------------------------------------------------

type Mark = 'ok' | 'warn' | 'fail' | 'info';

const MARKS: Record<Mark, string> = { ok: '✓', warn: '!', fail: '✗', info: '·' };

interface Line {
  mark: Mark;
  text: string;
  detail?: string;
}

const report: Line[] = [];

function say(mark: Mark, text: string, detail?: string): void {
  report.push({ mark, text, detail });
}

/** Everything said since the last heading, in the order it was said. */
function flush(): void {
  for (const line of report.splice(0)) {
    process.stdout.write(`   ${MARKS[line.mark]} ${line.text}\n`);
    if (line.detail) process.stdout.write(`     ${line.detail}\n`);
  }
}

/**
 * A section of the report.
 *
 * The buffer is emptied first: the lines held in it belong to the section that
 * has just been checked, and a heading printed over them would attribute the
 * last section's findings to this one.
 */
function heading(text: string): void {
  flush();
  process.stdout.write(`\n── ${text} ${'─'.repeat(Math.max(0, 66 - text.length))}\n`);
}

// --- Reading ----------------------------------------------------------------

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function run(command: string, args: string[]): { status: number; output: string } {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

interface Toolchain {
  java: { found: boolean; major: number; where: string };
  sdk: {
    root: string | null;
    /** API levels that are really installed: they hold `android.jar`. */
    platforms: string[];
    /** Level-named directories with no `android.jar` in them. */
    platformHusks: string[];
    /** Revisions that are really installed: they hold the tools that do the work. */
    buildTools: string[];
    /** Revision-named directories left behind by an interrupted download. */
    buildToolsHusks: string[];
    platformTools: boolean;
  };
}

function javaVersion(): Toolchain['java'] {
  const candidates = process.env.JAVA_HOME ? [join(process.env.JAVA_HOME, 'bin', 'java')] : [];
  const tried = [...candidates, 'java'];
  for (const candidate of tried) {
    const { status, output } = run(candidate, ['-version']);
    if (status !== 0) continue;
    // `java -version` writes to stderr and spells itself "21.0.5" or "1.8.0_392".
    const match = /version "(\d+)(?:\.(\d+))?/.exec(output);
    if (!match) continue;
    const major = Number(match[1]) === 1 ? Number(match[2] ?? 0) : Number(match[1]);
    return { found: true, major, where: candidate };
  }
  return { found: false, major: 0, where: '' };
}

function androidSdk(): Toolchain['sdk'] {
  const fromEnv = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '';
  const fromLocal = /sdk\.dir\s*=\s*(.+)/.exec(read(join(ANDROID, 'local.properties')))?.[1]?.trim();
  /*
   * Where the command-line tools put an SDK when nobody says otherwise. Asked
   * second, after the environment and the project, and only so that a machine
   * that has an SDK at the standard place is *described* correctly rather than
   * declared to have none — the difference between "no Android SDK" and
   * "platforms;android-36 is missing" is the whole of this report's usefulness.
   */
  const conventional =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
      : process.platform === 'darwin'
        ? join(process.env.HOME ?? '', 'Library', 'Android', 'sdk')
        : join(process.env.HOME ?? '', 'Android', 'Sdk');
  const root = fromEnv || fromLocal || (existsSync(conventional) ? conventional : null);
  if (!root || !existsSync(root)) {
    return {
      root: null,
      platforms: [],
      platformHusks: [],
      buildTools: [],
      buildToolsHusks: [],
      platformTools: false,
    };
  }
  const list = (dir: string): string[] => {
    try {
      return readdirSync(join(root, dir)).sort();
    } catch {
      return [];
    }
  };
  const filesIn = (dir: string): string[] => {
    try {
      return readdirSync(join(root, dir));
    } catch {
      return [];
    }
  };

  /*
   * A build-tools *directory* is not a build-tools install.
   *
   * An interrupted download leaves the directory behind with nothing but an
   * `.installer` marker in it, and a check that only reads the name reports a
   * working SDK on a machine that cannot compile a single resource — which is
   * the report this was written from: `build-tools/36.0.0` existed and was
   * empty, this tool said "✓ build-tools 36.0.0", and the build failed minutes
   * later with "Failed to find Build Tools revision 36.0.0". So a revision
   * counts only when it holds the tool that does the work — AAPT2 — and the
   * package metadata that says where it came from. What is left over is named
   * as what it is rather than passed over.
   */
  const revisions = list('build-tools');
  const installedBuildTools = revisions.filter((name) =>
    buildToolsIsInstalled(filesIn(join('build-tools', name))),
  );
  const levels = list('platforms');
  const installedPlatforms = levels.filter((name) =>
    platformIsInstalled(filesIn(join('platforms', name))),
  );

  return {
    root,
    platforms: installedPlatforms,
    platformHusks: levels.filter((name) => !installedPlatforms.includes(name)),
    buildTools: installedBuildTools,
    buildToolsHusks: revisions.filter((name) => !installedBuildTools.includes(name)),
    platformTools: existsSync(join(root, 'platform-tools')) && existsSync(join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')),
  };
}

/** Every file under a directory, as `path:size`, so two trees can be compared. */
function tree(dir: string): Map<string, number> {
  const files = new Map<string, number>();
  if (!existsSync(dir)) return files;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path).split(sep).join('/'), statSync(path).size);
    }
  };
  walk(dir);
  return files;
}

// --- The checks -------------------------------------------------------------

interface Findings {
  /** How many of the things found would stop a release being built here. */
  blocking: number;
}

function noFindings(): Findings {
  return { blocking: 0 };
}

function checkIdentityAndVersion(): void {
  const identity = identityFrom({
    capacitorConfig: read(join(ROOT, 'capacitor.config.ts')),
    appGradle: read(join(APP, 'build.gradle')),
    strings: read(join(APP, 'src', 'main', 'res', 'values', 'strings.xml')),
  });
  const version = (JSON.parse(read(join(ROOT, 'package.json')) || '{}') as { version?: string }).version ?? '0.0.0';
  say('ok', `application id ${identity.appId}`, `"${identity.appName}" · versionName ${version} · versionCode ${versionCodeFor(version)}`);
  for (const problem of identity.problems) say('fail', problem);
  if (identity.problems.length === 0) say('ok', 'the id and the name are stated the same way in all three files');
}

function checkSdkLevels(): void {
  const levels = sdkLevelsFrom(read(join(ANDROID, 'variables.gradle')));
  const playOk = levels.target >= PLAY_REQUIRED_TARGET_SDK;
  say(
    playOk ? 'ok' : 'fail',
    `targetSdk ${levels.target}, compileSdk ${levels.compile}, minSdk ${levels.min}`,
    playOk
      ? `Google Play requires ${PLAY_REQUIRED_TARGET_SDK} or higher for a new application and for updates since 31 August 2026`
      : `Google Play requires ${PLAY_REQUIRED_TARGET_SDK} or higher since 31 August 2026`,
  );
  const permissions = manifestPermissions(read(join(APP, 'src', 'main', 'AndroidManifest.xml')));
  say('info', `permissions: ${permissions.join(', ') || 'none'}`, 'this list is the privacy form: INTERNET and nothing else is the answer "no data collected"');
}

function checkToolchain(): Findings {
  const findings = noFindings();

  const java = javaVersion();
  if (!java.found) {
    findings.blocking += 1;
    say('fail', 'no JDK on PATH and no JAVA_HOME', `Gradle cannot run at all without one; JDK ${GRADLE_JAVA.compiles} is what the module compiles against`);
  } else {
    const problem = javaProblem(java.major);
    if (problem) {
      findings.blocking += 1;
      say('fail', `JDK ${java.major} at ${java.where}`, problem);
    } else {
      say('ok', `JDK ${java.major} at ${java.where}`, `Gradle runs on ${GRADLE_JAVA.min}–${GRADLE_JAVA.max}; the module compiles with JavaVersion.VERSION_${GRADLE_JAVA.compiles}`);
    }
  }

  const variablesGradle = read(join(ANDROID, 'variables.gradle'));
  const sdk = androidSdk();
  const levels = sdkLevelsFrom(variablesGradle);
  const wantedBuildTools = buildToolsVersionFrom(variablesGradle);
  if (!sdk.root) {
    findings.blocking += 1;
    say('fail', 'no Android SDK', 'set ANDROID_HOME, or write `sdk.dir=…` into android/local.properties (it is ignored by git)');
  } else {
    const platform = `android-${levels.compile}`;
    const platformOk = sdk.platforms.includes(platform);
    const buildToolsOk = wantedBuildTools !== '' && sdk.buildTools.includes(wantedBuildTools);
    if (!platformOk) findings.blocking += 1;
    if (!buildToolsOk) findings.blocking += 1;
    if (!sdk.platformTools) findings.blocking += 1;
    say(platformOk ? 'ok' : 'fail', `SDK at ${sdk.root}`, platformOk ? `platforms: ${platform}` : `platforms: ${sdk.platforms.join(', ') || 'none'} — needs ${platform}`);
    say(
      buildToolsOk ? 'ok' : 'fail',
      buildToolsOk
        ? `build-tools ${wantedBuildTools} (the revision the build compiles with)`
        : `build-tools ${wantedBuildTools || '…'} is not installed`,
      `installed and usable: ${sdk.buildTools.join(', ') || 'none'}`,
    );
    say(
      sdk.platformTools ? 'ok' : 'fail',
      sdk.platformTools ? 'platform-tools present (adb)' : 'platform-tools missing: `adb install` needs it',
    );
    for (const husk of sdk.buildToolsHusks) {
      say(
        'warn',
        `build-tools/${husk} exists but holds no tools`,
        'an interrupted download leaves the directory behind; delete it, or let the SDK manager finish, because a directory named like a revision is not one',
      );
    }
    // The platform has the same trap as build-tools: `platforms/android-36` with
    // no `android.jar` in it is a directory a listing calls installed and a
    // compiler calls missing.
    for (const husk of sdk.platformHusks) {
      say(
        'warn',
        `platforms/${husk} exists but holds no android.jar`,
        'a platform is the archive the compiler reads; a directory named after a level is not one',
      );
    }

    /*
     * What to do about it, spelled out, because these packages come from
     * `dl.google.com` and that host is the one that goes missing — on the
     * machine this was written on, `maven.google.com` and `services.gradle.org`
     * both answered while the SDK repository hung, which looks from inside the
     * build like Gradle being broken rather than a network being filtered. A
     * complete SDK tree copied from another machine does just as well, and is
     * worth saying because it is the fastest way out of it.
     */
    const missing: string[] = [];
    if (!platformOk) missing.push(`platforms;android-${levels.compile}`);
    if (!buildToolsOk) missing.push(`build-tools;${wantedBuildTools}`);
    if (!sdk.platformTools) missing.push('platform-tools');
    if (missing.length > 0) {
      say(
        'info',
        `install with: sdkmanager ${missing.map((name) => `"${name}"`).join(' ')}`,
        'these packages come from dl.google.com; if that host does not answer, copy the same directories in from an SDK that has them',
      );
    }
  }

  return findings;
}

function checkAssets(): Findings {
  const findings = noFindings();

  const dist = tree(DIST);
  if (dist.size === 0) {
    findings.blocking += 1;
    say('fail', 'dist/ is empty', 'run `npm run build:native` first — a packaged build is the game itself');
    return findings;
  }
  const browserOnly = browserOnlyFilesPresent([...dist.keys()].map((name) => name.split('/').pop() ?? name));
  if (browserOnly.length > 0) {
    findings.blocking += 1;
    say('fail', `dist/ is a web build: it still has ${browserOnly.join(', ')}`, 'run `npm run build:native`, which leaves those three out');
  } else {
    say('ok', `dist/ is a packaged build (${dist.size} files, no service worker, no edge headers, no link card)`);
  }

  const synced = tree(SYNCED);
  const missing: string[] = [];
  const differing: string[] = [];
  for (const [name, size] of dist) {
    const have = synced.get(name);
    if (have === undefined) missing.push(name);
    else if (have !== size) differing.push(name);
  }
  // `cap sync` writes two files of its own into the copied assets — Cordova's
  // runtime shim, there for a Cordova plugin that this project does not have —
  // so they are expected rather than a difference. Anything else that is in the
  // project and not in `dist/` is a leftover from a previous build, which would
  // ship: the assets directory is copied into, never emptied first.
  const capcitorAdds = new Set(['cordova.js', 'cordova_plugins.js', 'native-bridge.js']);
  const extra = [...synced.keys()].filter((name) => !dist.has(name) && !capcitorAdds.has(name));
  if (missing.length || differing.length || extra.length) {
    findings.blocking += 1;
    say(
      'fail',
      'the Android project does not hold the bundle that dist/ holds',
      'run `npx cap sync android` — a bundle built from stale assets builds, signs and uploads last week\'s game without complaining',
    );
    for (const name of missing.slice(0, 5)) say('info', `missing from the project: ${name}`);
    for (const name of differing.slice(0, 5)) say('info', `differs in size: ${name}`);
    for (const name of extra.slice(0, 5)) say('info', `only in the project: ${name}`);
  } else {
    say(
      'ok',
      `android/app/src/main/assets/public matches dist/ (${dist.size} files, plus Capacitor's own ${[...capcitorAdds].filter((name) => synced.has(name)).join(' and ') || 'none'})`,
      'the bundle a store would receive is the bundle that was built',
    );
  }

  return findings;
}

function checkSigning(): Findings {
  const findings = noFindings();

  // The one check that fails whatever else is true.
  const tracked = run('git', [
    'ls-files',
    '--',
    '*.jks',
    '*.keystore',
    '*.p12',
    '*.p8',
    '*.mobileprovision',
    'keystore.properties',
    'play-service-account.json',
  ]);
  if (tracked.status === 0 && tracked.output.trim() !== '') {
    findings.blocking += 1;
    say('fail', 'signing material is tracked by git', `remove it from the index and rewrite the history: ${tracked.output.trim().split('\n').join(', ')}`);
  } else if (tracked.status !== 0) {
    say('warn', 'could not ask git what is tracked', 'run this inside the repository to check that no key has been committed');
  } else {
    say('ok', 'no signing material is tracked by git');
  }

  const propertiesPath = join(ANDROID, 'keystore.properties');
  if (!existsSync(propertiesPath)) {
    findings.blocking += 1;
    say(
      'fail',
      'android/keystore.properties is missing, so a release build would be unsigned',
      'copy android/keystore.properties.example to android/keystore.properties and fill it in (see `npm run android:bundle` in ANDROID.md)',
    );
    return findings;
  }

  /*
   * First, whether Gradle could read the file at all.
   *
   * `keystore.properties` is loaded by `java.util.Properties`, where a backslash
   * is an escape — so the path Windows hands you, `C:\\Users\\…\\se27\\upload-keystore.jks`,
   * contains a malformed Unicode escape in `\upload` and makes `load` throw
   * before Gradle configures anything. Every check below used to read the text
   * literally and pass such a file, which turned a two-second fix into a Gradle
   * stack trace about `\u` that names neither the file nor the reason.
   */
  const rawProperties = read(propertiesPath);
  const malformed = malformedPropertiesValues(rawProperties);
  if (malformed.length > 0) {
    findings.blocking += 1;
    say(
      'fail',
      `android/keystore.properties holds an escape Java cannot read: ${malformed.join(', ')}`,
      'a backslash in this file is an escape character and "\\u" starts a Unicode escape, so a Windows path like storeFile=C:\\Users\\you\\keys\\se27\\upload-keystore.jks makes Gradle throw "Malformed \\uxxxx encoding". Write the path with forward slashes (C:/Users/you/keys/se27/upload-keystore.jks) or double every backslash',
    );
    return findings;
  }

  const properties = signingPropertiesFrom(rawProperties);
  const storeFile = properties.storeFile;
  const keystorePath = storeFile.startsWith('/') || /^[A-Za-z]:/.test(storeFile) ? storeFile : join(APP, storeFile);
  if (storeFile === '') {
    findings.blocking += 1;
    say('fail', 'android/keystore.properties states no storeFile', 'storeFile is resolved relative to android/app/');
    return findings;
  }
  if (!existsSync(keystorePath)) {
    findings.blocking += 1;
    say('fail', `the keystore is not at ${storeFile}`, 'storeFile is resolved relative to android/app/');
    return findings;
  }
  const blanks = blankSigningValues(properties);
  if (blanks.length > 0) {
    findings.blocking += 1;
    say('fail', `android/keystore.properties is incomplete: ${blanks.join(', ')} empty`);
    return findings;
  }

  /*
   * From here the file is complete, and the question changes from "is anything
   * missing" to "does any of it work" — which the file cannot answer about
   * itself. Every value below is checked by handing it to the tool that will
   * really use it: keytool to open the store and the key, and nothing at all
   * that writes back to the keystore, because this runs against the owner's real
   * key. `-certreq` is the deepest that goes: it produces a certificate request
   * and cannot modify what it reads.
   *
   * The passwords travel in the environment of the one child process that needs
   * each of them (`-storepass:env`, `-keypass:env`), never in an argument list —
   * arguments are visible to every other process on the machine — and never
   * printed, whatever happens. The two secrets are also handed to `redactSecret`
   * before any line reaches this report, so a message cannot carry one out even
   * if a future keytool decided to echo it.
   */
  const secrets = [properties.storePassword, properties.keyPassword];
  const tool = keytoolPath();
  if (!tool) {
    say(
      'warn',
      'no keytool on PATH and none beside the JDK in JAVA_HOME',
      'a JDK is needed to build at all and brings keytool with it; without one the key itself cannot be checked, only the file that points at it',
    );
    return findings;
  }

  const store = keytoolRun(tool, ['-list', '-keystore', keystorePath, '-storepass:env', STORE_PASSWORD_ENV], {
    [STORE_PASSWORD_ENV]: properties.storePassword,
  });
  const verdict = keystoreVerdict(store.status, store.output);
  if (verdict.state !== 'ok') {
    findings.blocking += 1;
    const note = keytoolNote(store.output, secrets);
    say('fail', verdict.problem, note || 'no secret is ever printed here, and none was needed to find this');
    return findings;
  }

  const aliases = aliasesFrom(store.output);
  const aliasCheck = keytoolRun(
    tool,
    ['-list', '-keystore', keystorePath, '-alias', properties.keyAlias, '-storepass:env', STORE_PASSWORD_ENV],
    { [STORE_PASSWORD_ENV]: properties.storePassword },
  );
  if (aliasCheck.status !== 0) {
    findings.blocking += 1;
    say(
      'fail',
      `the keystore holds no alias "${properties.keyAlias}"`,
      aliases.length > 0
        ? `it holds: ${aliases.join(', ')} — keyAlias must be one of those`
        : 'the store opened with the password given, so what is wrong is the alias rather than the credentials',
    );
    return findings;
  }

  /*
   * PKCS12 first, because it is what `keytool -genkeypair` writes by default in
   * JDK 9 and later, and because the mistake it catches is invisible to keytool:
   * a second, different key password is *warned about and ignored*, so the file
   * looks fine and the build fails later in apksigner's own words. Where keytool
   * can be asked, it is asked.
   */
  const mismatch = passwordMismatchProblem(verdict.keystoreType, properties);
  if (mismatch) {
    findings.blocking += 1;
    say('fail', mismatch);
    return findings;
  }

  if (verdict.keystoreType.toUpperCase() !== 'PKCS12') {
    const request = join(tmpdir(), `se27-upload-key-check-${process.pid}.csr`);
    try {
      const keyCheck = keytoolRun(
        tool,
        ['-certreq', '-alias', properties.keyAlias, '-keystore', keystorePath, '-storepass:env', STORE_PASSWORD_ENV, '-keypass:env', KEY_PASSWORD_ENV, '-file', request],
        { [STORE_PASSWORD_ENV]: properties.storePassword, [KEY_PASSWORD_ENV]: properties.keyPassword },
      );
      const problem = keyPasswordProblem(keyCheck.status, keyCheck.output);
      if (problem) {
        findings.blocking += 1;
        const note = keytoolNote(keyCheck.output, secrets);
        say('fail', problem, note || 'the store password opened the keystore; this is the key password inside it');
        return findings;
      }
    } finally {
      // The request is a public artefact nobody asked for; it exists for the
      // length of one command and is removed whatever that command did.
      rmSync(request, { force: true });
    }
  }

  say(
    'ok',
    `an upload key is configured (alias ${properties.keyAlias}, ${verdict.keystoreType})`,
    `the store password opens it${verdict.keystoreType.toUpperCase() === 'PKCS12' ? ', and the key password is the same one, as PKCS12 requires' : ', and the key password opens the key'}; certificate SHA-256 ${verdict.fingerprint ?? 'unreadable'} — Play App Signing holds the key that signs what a phone installs, and this is the upload half. android/keystore.properties is ignored by git`,
  );

  return findings;
}

// --- The key itself ---------------------------------------------------------

/** The environment names the passwords travel in, in one child each. */
const STORE_PASSWORD_ENV = 'SE27_STORE_PASSWORD';
const KEY_PASSWORD_ENV = 'SE27_KEY_PASSWORD';

/** Where keytool is: beside the java the build will use, else on the PATH. */
function keytoolPath(): string | null {
  const candidates = process.env.JAVA_HOME
    ? [join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')]
    : [];
  for (const candidate of [...candidates, 'keytool']) {
    const result = spawnSync(candidate, ['-help'], { cwd: ROOT, encoding: 'utf8', shell: false });
    if (!result.error) return candidate;
  }
  return null;
}

/** One keytool run, with the passwords in its environment and nowhere else. */
function keytoolRun(
  tool: string,
  args: string[],
  secrets: Record<string, string>,
): { status: number; output: string } {
  const result = spawnSync(tool, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...secrets },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Keytool's own sentence about a failure, scrubbed, or nothing. */
function keytoolNote(output: string, secrets: readonly string[]): string {
  const line = /^.*keytool error:.*$/m.exec(output)?.[0]?.trim();
  return line ? redactSecret(line, secrets) : '';
}

// --- The build --------------------------------------------------------------

function requireClean(findings: Findings): void {
  if (findings.blocking === 0) return;
  process.stdout.write(
    `\n   ${findings.blocking} thing(s) would stop a release being built on this machine.\n` +
      '   Nothing has been built, and nothing was uploaded anywhere.\n\n',
  );
  process.exit(1);
}

function runOrFail(
  command: string,
  args: string[],
  cwd: string = ROOT,
  env: NodeJS.ProcessEnv = process.env,
): void {
  process.stdout.write(`\n   $ ${[command, ...args].join(' ')}\n`);
  // Through a shell, because these are `npm`, `npx` and `gradlew.bat` — a shell
  // script on one platform and a batch file on the other, and the wrapper is the
  // Gradle being tested rather than a system Gradle that happens to be installed.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true, env });
  if (result.status !== 0) {
    throw new Error(`${command} failed (exit ${result.status ?? 'signal'})`);
  }
}

function grade(): string {
  return join(ANDROID, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
}

function build(kind: 'bundle' | 'apk'): void {
  // `productionBuildEnv()` and not the inherited environment: this tool is
  // started with `vite-node`, which sets `NODE_ENV=development`, and a bundle
  // built with that is a *different* bundle — unminified, with React's
  // development build in it. See `tools/buildEnv.ts` for the measurement.
  runOrFail('npm', ['run', 'build:native'], ROOT, productionBuildEnv());
  runOrFail('npx', ['cap', 'sync', 'android']);

  const target = kind === 'bundle' ? 'bundleRelease' : 'assembleRelease';
  /*
   * From `android/`, because that is where the wrapper *is*.
   *
   * `npm run android:bundle` used to check everything, build the native assets,
   * run `cap sync`, and then die with
   *
   *     'gradlew.bat' is not recognized as an internal or external command
   *
   * — after having done all the expensive work, with a message about a command
   * rather than about a release. Two things were wrong at once and either was
   * enough on its own: the name was bare, and the working directory was the
   * repository root, one level above the wrapper. The working directory is now
   * the Android project, and `grade()` names the wrapper by its full path —
   * because a bare name is resolved by searching the *current* directory, and
   * `NoDefaultCurrentDirectoryInExePath=1` (which Git Bash sets, and which this
   * build host had) removes that directory from the search entirely, so the
   * wrapper would be missing however right the working directory was.
   * `shell: false` is not the way out of that: Node refuses to launch a `.bat`
   * without a shell. `release.test.ts` holds both halves.
   */
  runOrFail(grade(), [target], ANDROID);

  const artifact =
    kind === 'bundle'
      ? join(APP, 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
      : join(APP, 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(artifact)) throw new Error(`Gradle finished but there is no artifact at ${artifact}`);
  const megabytes = (statSync(artifact).size / (1024 * 1024)).toFixed(1);

  process.stdout.write(`\n── the artifact ${'─'.repeat(52)}\n`);
  process.stdout.write(`   ✓ ${relative(ROOT, artifact).split(sep).join('/')} — ${megabytes} MB\n`);
  process.stdout.write(
    kind === 'bundle'
      ? '     upload this to the Play Console: a bundle, signed with the upload key,\n' +
          '     which Play verifies before re-signing it with the app signing key.\n\n'
      : '     sideload this to a device (`adb install -r …`) to test the release build.\n\n',
  );
}

// --- Main -------------------------------------------------------------------

const USAGE = [
  '   usage: npm run android:preflight        check what a release needs, build nothing',
  '          npm run android:bundle           check, build the signed .aab for Play',
  '          npm run android:apk              check, build the signed .apk for a device',
].join('\n');

function main(): void {
  const mode = process.argv.slice(2).find((arg) => ['--bundle', '--apk'].includes(arg)) ?? '--check';

  process.stdout.write('\nSunday Eleven 27 — the Android release\n');

  heading('the identity and the version');
  checkIdentityAndVersion();
  checkSdkLevels();

  heading('this machine');
  const machine = checkToolchain();

  heading('the bundle that would ship');
  const assets = checkAssets();

  heading('the signing key');
  const signing = checkSigning();

  const findings: Findings = {
    blocking: machine.blocking + assets.blocking + signing.blocking,
  };
  flush();

  if (mode === '--check') {
    if (findings.blocking === 0) {
      process.stdout.write(
        '\n   Nothing in the way of a release build. `npm run android:bundle` would build it.\n\n',
      );
      process.exit(0);
    }
    requireClean(findings);
    return;
  }

  requireClean(findings);
  try {
    build(mode === '--apk' ? 'apk' : 'bundle');
  } catch (error) {
    process.stdout.write(`\n   ✗ ${(error as Error).message}\n\n`);
    process.stdout.write(`${USAGE}\n\n`);
    process.exit(1);
  }
}

main();
