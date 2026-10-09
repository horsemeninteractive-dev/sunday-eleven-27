/**
 * The facts a store submission is checked against.
 *
 * Everything here is about the *packaging* of the game rather than the game,
 * and all of it is a fact that exists in more than one place: an application id
 * is written in the Capacitor configuration, in the Gradle module and in the
 * Android resources; a version is in `package.json`, in a heading in the
 * changelog and — derived from it — in an integer the store compares; the
 * permission list is in a manifest that decides what a privacy form has to say.
 * A store is unforgiving about exactly these, and unforgiving in the worst way:
 * a mismatch is discovered after an upload, days into a review, by a stranger.
 *
 * So they are gathered here, as functions of *text* rather than of files, which
 * is what lets them be tested without a machine that has an Android SDK on it —
 * and the tool that runs them (`tools/androidRelease.ts`) is then only the part
 * that reads files, asks git questions and prints an answer.
 *
 * Nothing in the game imports this. It is the boundary between the repository
 * and the two stores, and it belongs to the same family as `tools/release.ts`:
 * typechecked with everything else so it cannot rot, and run by hand.
 */

/**
 * The integer Android compares to decide which build is newer.
 *
 * It is derived, not written down, and it must only ever go up: a store rejects
 * a bundle whose `versionCode` has already been used, and will not accept one
 * lower than the last. `major * 1000000 + minor * 1000 + patch` gives 0.10.1
 * → 10001 and 0.11.0 → 11000, which is monotonic for as long as the patch
 * number stays under a thousand — one release a day for two and a half years.
 *
 * The same formula is written in Groovy in `android/app/build.gradle`, because
 * Gradle is what actually builds the bundle and cannot ask this file. Two copies
 * of a rule is one copy too many, which is why `release.test.ts` reads the
 * Groovy and asserts the two agree rather than trusting them to.
 */
export function versionCodeFor(version: string): number {
  const parts = version.split('.').map((part) => {
    const match = /^(\d+)/.exec(part.trim());
    return match ? Number(match[1]) : 0;
  });
  return (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1_000 + (parts[2] ?? 0);
}

export interface ReleaseIdentity {
  /** The reverse-DNS identity: the Android package and the iOS bundle id. */
  appId: string;
  /** What a phone shows under the icon, and what a store lists. */
  appName: string;
  /** The same two facts as the build system and the resources state them. */
  gradleNamespace: string;
  gradleApplicationId: string;
  resourceAppName: string;
  resourcePackageName: string;
  resourceUrlScheme: string;
  /** Everything that disagrees, in the words of the files that hold it. */
  problems: string[];
}

/** The text of the three files that each state part of the identity. */
export interface IdentitySources {
  /** `capacitor.config.ts` */
  capacitorConfig: string;
  /** `android/app/build.gradle` */
  appGradle: string;
  /** `android/app/src/main/res/values/strings.xml` */
  strings: string;
}

function firstGroup(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? '';
}

/**
 * The identity, read out of the files that state it.
 *
 * The application id is the one thing about a published application that can
 * never be changed — a store treats a new one as a different application, with
 * no history and no installed base — so it is worth checking that the three
 * files agree *before* it is published rather than after. The name is checked
 * for the same reason at a smaller scale: two spellings of it is two products.
 */
export function identityFrom(sources: IdentitySources): ReleaseIdentity {
  const appId = firstGroup(sources.capacitorConfig, /appId:\s*'([^']+)'/);
  const appName = firstGroup(sources.capacitorConfig, /appName:\s*'([^']+)'/);
  const gradleNamespace = firstGroup(sources.appGradle, /namespace\s*=\s*"([^"]+)"/);
  const gradleApplicationId = firstGroup(sources.appGradle, /applicationId\s+"([^"]+)"/);
  const resourceAppName = firstGroup(
    sources.strings,
    /<string name="app_name">([^<]+)<\/string>/,
  );
  const resourcePackageName = firstGroup(
    sources.strings,
    /<string name="package_name">([^<]+)<\/string>/,
  );
  const resourceUrlScheme = firstGroup(
    sources.strings,
    /<string name="custom_url_scheme">([^<]+)<\/string>/,
  );

  const problems: string[] = [];
  const expect = (what: string, value: string, wanted: string): void => {
    if (value === '') problems.push(`${what} could not be read`);
    else if (value !== wanted) problems.push(`${what} is "${value}" but the application id is "${wanted}"`);
  };
  if (appId === '') problems.push('capacitor.config.ts states no appId');
  if (appName === '') problems.push('capacitor.config.ts states no appName');
  expect('the Gradle namespace', gradleNamespace, appId);
  expect('the Gradle applicationId', gradleApplicationId, appId);
  expect('the resource package name', resourcePackageName, appId);
  expect('the resource URL scheme', resourceUrlScheme, appId);
  if (resourceAppName !== '' && resourceAppName !== appName) {
    problems.push(`the resource app name is "${resourceAppName}" but the display name is "${appName}"`);
  }

  return {
    appId,
    appName,
    gradleNamespace,
    gradleApplicationId,
    resourceAppName,
    resourcePackageName,
    resourceUrlScheme,
    problems,
  };
}

export interface SdkLevels {
  min: number;
  compile: number;
  target: number;
}

/** The three API levels, out of `android/variables.gradle`. */
export function sdkLevelsFrom(variablesGradle: string): SdkLevels {
  const level = (name: string): number => {
    const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(variablesGradle);
    return match ? Number(match[1]) : 0;
  };
  return {
    min: level('minSdkVersion'),
    compile: level('compileSdkVersion'),
    target: level('targetSdkVersion'),
  };
}

/**
 * The build-tools revision the Android build compiles with.
 *
 * Named rather than left to the Android Gradle Plugin, which defaults to a
 * revision of its own — 35.0.0 for AGP 8.13 — that is not the one this project
 * documents, not the one its preflight checks for, and not the one an SDK set up
 * from `ANDROID.md` has. `android/app/build.gradle` states it for the
 * application module and the root `build.gradle` states it for every Android
 * module besides, because the Capacitor libraries are generated into
 * `node_modules` and cannot be edited; this reads it, so a check and a build
 * cannot disagree about which revision is meant.
 */
export function buildToolsVersionFrom(variablesGradle: string): string {
  const match = /buildToolsVersion\s*=\s*['"]([^'"]+)['"]/.exec(variablesGradle);
  return match?.[1]?.trim() ?? '';
}

/**
 * The range of JDKs the Android build can actually run on.
 *
 * Two limits, from two tools, and both are hard: the Android Gradle Plugin needs
 * Java 17 or newer, and the Gradle wrapper this project pins (8.14.3) stops at
 * Java 24 — its own build-script compiler is a Groovy that does not understand a
 * class file newer than 24, and it fails before it configures anything.
 *
 * That upper bound is not hypothetical. Android Studio installs its own JetBrains
 * Runtime, this machine's is Java 25, and `gradlew` under it dies with
 * `Unsupported class file major version 69` — a message that names neither the
 * JDK nor the real problem. A JDK that is *too new* is therefore reported here
 * as a failure rather than passed over, because "a JDK is installed" is not the
 * same question as "this build can use it".
 */
export const GRADLE_JAVA = { min: 17, max: 24, compiles: 21 } as const;

/** Why this JDK will not do, or null when it will. */
export function javaProblem(major: number): string | null {
  if (major < GRADLE_JAVA.min) {
    return `JDK ${major} is older than the ${GRADLE_JAVA.min} the Android Gradle Plugin requires`;
  }
  if (major > GRADLE_JAVA.max) {
    return `JDK ${major} is newer than the Gradle wrapper can run on — its own build-script compiler stops at class file ${GRADLE_JAVA.max}, and the build fails with "Unsupported class file major version" before it configures anything. Android Studio's bundled JBR is one of these; point JAVA_HOME at a JDK ${GRADLE_JAVA.compiles}`;
  }
  return null;
}

/**
 * The API level Google Play requires of a new submission, and where that is
 * stated.
 *
 * `targetSdk` is not a preference: from 31 August 2026 Play refuses a new
 * application or an update that targets less than Android 16 (API 36), and an
 * out-of-date application is hidden from new users on newer devices rather than
 * rejected. <https://developer.android.com/google/play/requirements/target-sdk>
 */
export const PLAY_REQUIRED_TARGET_SDK = 36;

/** Just the permissions, because the privacy form is answered from them. */
export function manifestPermissions(manifest: string): string[] {
  const found = manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g);
  return [...found].map((match) => match[1]!.replace('android.permission.', '')).sort();
}

/**
 * The four values `android/keystore.properties` holds, and which of them are
 * empty.
 *
 * The properties file is the only thing standing between an unsigned bundle and
 * a signed one, and it is the one file in this arrangement that a person fills
 * in by hand — which makes it the one where a value is blank, misspelled or
 * copied from a machine that no longer exists. Reading it is separated from the
 * checks that *use* the values so the checks can be tested without a keystore.
 */
export interface SigningProperties {
  /** Resolved relative to `android/app/`, as `android/app/build.gradle` does. */
  storeFile: string;
  storePassword: string;
  keyAlias: string;
  keyPassword: string;
}

/** The four keys, in the order `keystore.properties.example` names them. */
export const SIGNING_KEYS = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'] as const;

/** The escapes `java.util.Properties` spells out rather than passing through. */
const JAVA_ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };

/**
 * One value, read the way the *build* reads it.
 *
 * `android/keystore.properties` is loaded by `java.util.Properties.load`, and
 * that reader treats a backslash as an escape. So a path written the way Windows
 * hands it to you — `C:\Users\…\se27\upload-keystore.jks` — is not a path with
 * backslashes in it: `\k` and `\s` are unknown and lose their backslash, `\t`
 * becomes a tab, and `\upload` is a *malformed Unicode escape* that makes `load`
 * throw `Malformed \uxxxx encoding` before Gradle has configured anything.
 *
 * This function exists because the preflight read the text literally and the
 * build did not: a file naming the keystore that way was approved by every check
 * here and then killed the build with a message about `\u`, naming neither the
 * file nor the fix. It is a divergence that only appears on Windows, which is
 * also where this project is built.
 *
 * Every line of it was measured against `java.util.Properties` on JDK 21 rather
 * than taken from documentation: `a\b` → `ab`, `a\\b` → `a\b`, `a\tb` → a tab,
 * `a\u0041b` → `aAb`, `\u00G1` → malformed, forward slashes untouched.
 *
 * `malformed` is the one outcome that is not a value: Java's reader gives up on
 * the whole file, so the caller must refuse rather than use what is returned.
 */
export function readJavaPropertiesValue(raw: string): { value: string; malformed: boolean } {
  if (!raw.includes('\\')) return { value: raw, malformed: false };
  let value = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    // A trailing backslash is Java's own edge case (it reads past the end and
    // throws); kept literally here, because the alternative is a crash in a
    // check that exists to report rather than to fail the same way.
    if (char !== '\\' || index === raw.length - 1) {
      value += char;
      continue;
    }
    index += 1;
    const next = raw[index]!;
    if (next === 'u') {
      const hex = raw.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value: raw, malformed: true };
      value += String.fromCharCode(parseInt(hex, 16));
      index += 4;
      continue;
    }
    value += JAVA_ESCAPES[next] ?? next;
  }
  return { value, malformed: false };
}

/**
 * The values in a properties file, trimmed, or empty strings where absent.
 *
 * The whitespace around the `=` is matched as space and tab rather than as `\s`,
 * and that is not a detail: `\s` includes the newline, so a `storePassword=` with
 * nothing after it — which is what a half-filled `keystore.properties` looks
 * like — matched greedily *across the line ending* and read the next line's
 * `keyAlias=upload` as the password. The blank value then looked filled in, the
 * file passed the check that exists to catch it, and the failure moved to
 * Gradle. `release.test.ts` holds this shut with that exact file.
 *
 * The value is then decoded with the build's own escape rules, so what is checked
 * here is what Gradle and `apksigner` will see, and a value Gradle cannot read at
 * all comes back as `malformedPropertiesValues` rather than as a plausible path.
 */
export function signingPropertiesFrom(text: string): SigningProperties {
  const value = (key: string): string => {
    const raw = new RegExp(`^${key}[ \\t]*=[ \\t]*(.*)$`, 'm').exec(text)?.[1] ?? '';
    return readJavaPropertiesValue(raw).value.trim();
  };
  return {
    storeFile: value('storeFile'),
    storePassword: value('storePassword'),
    keyAlias: value('keyAlias'),
    keyPassword: value('keyPassword'),
  };
}

/** Which of the four values the file leaves empty, in the order the example lists them. */
export function blankSigningValues(properties: SigningProperties): string[] {
  return SIGNING_KEYS.filter((key) => properties[key] === '');
}

/**
 * The values `java.util.Properties` would refuse to load the file over.
 *
 * One escape does it: `\u` not followed by four hexadecimal digits. The way to
 * write that by accident is a Windows path through a name beginning with `u` —
 * and this project's own keystore filename does exactly that, in
 * `…\se27\upload-keystore.jks`. Named here so the preflight can say *which* line
 * is unreadable and what to do about it, instead of approving the file and
 * letting Gradle die later with `Malformed \uxxxx encoding`.
 */
export function malformedPropertiesValues(text: string): string[] {
  return SIGNING_KEYS.filter((key) => {
    const raw = new RegExp(`^${key}[ \\t]*=[ \\t]*(.*)$`, 'm').exec(text)?.[1] ?? '';
    return readJavaPropertiesValue(raw).malformed;
  });
}

/**
 * A message with every password taken out of it, before it is printed.
 *
 * This is the last gate before a line reaches a log, and it fails closed: it is
 * handed the passwords that were used, and a message that happens to contain one
 * is scrubbed whatever the reason. Keytool does not echo a password in any of the
 * failures this preflight reads — that was checked against real fixtures, not
 * assumed — so what this guards against is a *future* keytool, or a message built
 * from a value this file did not think of. The cost of being wrong is asymmetric:
 * a mangled diagnostic is an annoyance, and a password in a build log is a
 * password in every CI artefact, screenshot and bug report that log reaches.
 */
export function redactSecret(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret === '') continue;
    redacted = redacted.split(secret).join('••••');
  }
  return redacted;
}

/**
 * What `keytool -list` said about a keystore and the password used to open it.
 *
 * Every sentence here is written from the machine's own answers rather than from
 * documentation, because keytool reports the *same* class of failure in
 * different words depending on the keystore format: a wrong password is
 * `keystore password was incorrect` for PKCS12 and `Keystore was tampered with,
 * or password was incorrect` for the older JKS. Both mean one thing to a person
 * filling in `keystore.properties` — the value in the file is not the value that
 * opens the key — and this is where the two are made into the one sentence.
 *
 * `status` is keytool's exit code and `output` everything it wrote to either
 * stream: keytool prints some of these to stdout and some to stderr, and which
 * is which is not worth depending on.
 */
export interface KeystoreVerdict {
  state: 'ok' | 'wrong-password' | 'unreadable';
  /** `PKCS12` or `JKS`, when the store opened at all. */
  keystoreType: string;
  /** The signing certificate's SHA-256, which is public and belongs in a record. */
  fingerprint: string | null;
  /** One sentence naming the problem, or `''` when there is none. */
  problem: string;
}

/** The two spellings of "that password is not the password". */
const KEYSTORE_PASSWORD_WRONG = /(keystore password was incorrect|Keystore was tampered with, or password was incorrect)/i;
const NOT_A_KEYSTORE = /Unrecognized keystore format/i;
const KEYSTORE_EMPTY = /Keystore file exists, but is empty/i;

/** A certificate's SHA-256, in either of the two shapes keytool prints it. */
const SHA256 = /SHA-?256\)?:?\s*((?:[0-9A-F]{2}:){31}[0-9A-F]{2})/i;

/** The verdict on a `keytool -list` run. */
export function keystoreVerdict(status: number, output: string): KeystoreVerdict {
  const keystoreType = /Keystore type:\s*(\S+)/.exec(output)?.[1] ?? '';
  const fingerprint = SHA256.exec(output)?.[1]?.toUpperCase() ?? null;
  if (status === 0) return { state: 'ok', keystoreType, fingerprint, problem: '' };
  if (KEYSTORE_PASSWORD_WRONG.test(output)) {
    return {
      state: 'wrong-password',
      keystoreType: '',
      fingerprint: null,
      problem:
        'the store password in android/keystore.properties does not open the keystore — the file either holds a password that was changed, or names a keystore that was replaced',
    };
  }
  if (NOT_A_KEYSTORE.test(output)) {
    return {
      state: 'unreadable',
      keystoreType: '',
      fingerprint: null,
      problem: 'the storeFile is not a keystore: keytool recognises no keystore format in it',
    };
  }
  if (KEYSTORE_EMPTY.test(output)) {
    return {
      state: 'unreadable',
      keystoreType: '',
      fingerprint: null,
      problem: 'the storeFile is empty — zero bytes, or a directory the path happens to point at',
    };
  }
  return {
    state: 'unreadable',
    keystoreType: '',
    fingerprint: null,
    problem: 'keytool could not read the keystore, and said so in words this check does not know',
  };
}

/**
 * Whether the key password in the properties file opens the upload key.
 *
 * Keytool's `-list` opens the *store*, not the key inside it, so a keystore whose
 * key has a password of its own needs a command that actually uses the private
 * key to find out. `-certreq` is that command: it produces a certificate request
 * nobody keeps, and it cannot write anything back to the keystore, which is why
 * it is safe to aim at the owner's real key. `Cannot recover key` is keytool's
 * way of saying the password is wrong.
 *
 * A PKCS12 keystore never reaches this: the format has one password, keytool says
 * so out loud, and `passwordMismatchProblem` is the check for that case instead.
 */
export function keyPasswordProblem(status: number, output: string): string | null {
  if (status === 0) return null;
  if (/Cannot recover key/i.test(output)) {
    return 'the key password in android/keystore.properties does not open the upload key (keytool: "Cannot recover key")';
  }
  return 'keytool could not open the upload key with the key password in android/keystore.properties';
}

/**
 * The one credential mistake a PKCS12 keystore cannot be asked about.
 *
 * `keytool -genkeypair` writes PKCS12 by default in JDK 9 and later, and PKCS12
 * holds a *single* password: hand it a different `-keypass` and it warns, ignores
 * it and succeeds. So a properties file with two different passwords is a file
 * that keytool accepts and `apksigner` — which is what Gradle actually signs
 * with — refuses, with `Failed to obtain key with alias "…". Wrong password?`, a
 * message that names neither the keystore nor the reason. That is a failure worth
 * catching in the preflight, and it is checkable with nothing but the two
 * strings: same keystore, same passwords, or a bundle nobody can sign.
 */
export function passwordMismatchProblem(
  keystoreType: string,
  properties: SigningProperties,
): string | null {
  if (keystoreType.toUpperCase() !== 'PKCS12') return null;
  if (properties.storePassword === properties.keyPassword) return null;
  return 'this is a PKCS12 keystore, and PKCS12 holds one password: storePassword must equal keyPassword, or apksigner fails with "Failed to obtain key with alias … Wrong password?"';
}

/**
 * The aliases a plain `keytool -list` reports, so a missing one can be named.
 *
 * The only thing this is for is the sentence a person needs when the alias in
 * `keystore.properties` is not the alias in the keystore: *which one is there*.
 * Keytool lists an entry per line as `upload, 9 Oct 2026, PrivateKeyEntry,`, so
 * the first field of a line with three comma-separated parts and a date in the
 * second is an alias. A pattern this loose could pick up a line it should not,
 * which is why the caller prints the list as a hint and never trusts it as the
 * answer to anything.
 */
export function aliasesFrom(listOutput: string): string[] {
  const found: string[] = [];
  for (const line of listOutput.split(/\r?\n/)) {
    const match = /^(\S+),\s+\d{1,2}\s+\S{3}\s+\d{4},\s+(\S+),\s*$/.exec(line.trim());
    if (match) found.push(match[1]!);
  }
  return found;
}

/**
 * The signing material that must never be tracked, and the patterns that keep
 * it out.
 *
 * Checked rather than assumed: a keystore committed once is a keystore in every
 * clone and in every fork for ever, and deleting it afterwards does not undelete
 * it. The patterns are the ones in the root `.gitignore`; this function exists
 * so a test can hold the two together, and so the preflight can say *which* one
 * is missing rather than that something is.
 */
export const SIGNING_MATERIAL_PATTERNS = [
  '*.jks',
  '*.keystore',
  '*.p12',
  '*.p8',
  '*.mobileprovision',
  'keystore.properties',
  'play-service-account.json',
] as const;

/** Which of the patterns a `.gitignore` is missing. */
export function missingSigningPatterns(gitignore: string): string[] {
  const lines = gitignore.split(/\r?\n/).map((line) => line.trim());
  return SIGNING_MATERIAL_PATTERNS.filter((pattern) => !lines.includes(pattern));
}

/**
 * The files that make a directory *be* the SDK package it is named after.
 *
 * An interrupted download leaves the directory behind and nothing else: an SDK
 * whose `build-tools/36.0.0` holds only `.installer` reports as installed to
 * anything that reads a directory listing, and then the build dies minutes later
 * with `Failed to find Build Tools revision 36.0.0`. The platform has the same
 * trap — a `platforms/android-36` with no `android.jar` compiles nothing — so
 * both are held to the files that do the work: the archive the compiler reads
 * and the metadata that says which revision it is.
 */
export function platformIsInstalled(files: readonly string[]): boolean {
  return files.includes('android.jar') && files.includes('source.properties');
}

/** Whether a `build-tools/…` directory is a revision rather than a husk. */
export function buildToolsIsInstalled(files: readonly string[]): boolean {
  return (
    files.includes('source.properties') && (files.includes('aapt2') || files.includes('aapt2.exe'))
  );
}

/**
 * Whether a set of browser-only files has been left in a packaged build.
 *
 * The native bundle is the same game with the browser's plumbing taken out (see
 * `vite.config.ts`): the service worker, the edge headers and the link-preview
 * card. A store build that still carried them would try to register a worker
 * inside a WebView, and this is the check that says it did not.
 */
export function browserOnlyFilesPresent(files: readonly string[]): string[] {
  const browserOnly = new Set(['sw.js', '_headers', 'og.png']);
  return files.filter((name) => browserOnly.has(name)).sort();
}

/** Whether a Capacitor configuration points the shell at a remote URL. */
export function remoteServerUrl(config: string): string | null {
  const match = /server\s*:\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]/s.exec(config);
  return match?.[1] ?? null;
}
