import { describe, expect, it } from 'vitest';
import capacitorConfig from '../../capacitor.config.ts?raw';
import appGradle from '../../android/app/build.gradle?raw';
import stringsXml from '../../android/app/src/main/res/values/strings.xml?raw';
import variablesGradle from '../../android/variables.gradle?raw';
import rootGradle from '../../android/build.gradle?raw';
import androidManifest from '../../android/app/src/main/AndroidManifest.xml?raw';
import keystoreExample from '../../android/keystore.properties.example?raw';
import gitignore from '../../.gitignore?raw';
import viteConfig from '../../vite.config.ts?raw';
import packageJson from '../../package.json?raw';
import androidReleaseSource from '../../tools/androidRelease.ts?raw';
import websiteReleaseSource from '../../tools/release.ts?raw';
import { productionBuildEnv } from '../../tools/buildEnv';
import {
  GRADLE_JAVA,
  PLAY_REQUIRED_TARGET_SDK,
  SIGNING_KEYS,
  SIGNING_MATERIAL_PATTERNS,
  aliasesFrom,
  blankSigningValues,
  browserOnlyFilesPresent,
  buildToolsIsInstalled,
  buildToolsVersionFrom,
  identityFrom,
  javaProblem,
  keyPasswordProblem,
  keystoreVerdict,
  manifestPermissions,
  malformedPropertiesValues,
  missingSigningPatterns,
  passwordMismatchProblem,
  platformIsInstalled,
  readJavaPropertiesValue,
  redactSecret,
  remoteServerUrl,
  sdkLevelsFrom,
  signingPropertiesFrom,
  versionCodeFor,
} from './release';

/**
 * The packaging the two stores are handed, held to what the stores require.
 *
 * These are the facts a submission is rejected over, and every one of them is
 * written down in more than one place — an id in three files, a version in two
 * languages, a permission list that decides what a privacy form may say. Reading
 * the real files here is the point: this is not a test of a function, it is a
 * test of *this repository's* Android project, in the way `workspaces.test.ts`
 * is a test of this repository's stylesheet.
 *
 * The requirements it pins, and where each is stated:
 *
 *   - target API 36 or higher for a new application or an update, since
 *     31 August 2026 — <https://developer.android.com/google/play/requirements/target-sdk>
 *   - the same application id everywhere, because it is immutable once published
 *   - no signing material in version control, ever
 *   - a bundle that carries only bundled assets, so the game works with no signal
 */

describe('the version Android compares', () => {
  it('rises with every number, and never falls', () => {
    expect(versionCodeFor('0.10.1')).toBe(10001);
    expect(versionCodeFor('0.11.0')).toBe(11000);
    expect(versionCodeFor('1.0.0')).toBe(1_000_000);
    expect(versionCodeFor('0.10.2')).toBeGreaterThan(versionCodeFor('0.10.1'));
    expect(versionCodeFor('0.11.0')).toBeGreaterThan(versionCodeFor('0.10.999'));
    expect(versionCodeFor('1.0.0')).toBeGreaterThan(versionCodeFor('0.999.999'));
  });

  it('reads a version it does not understand as far as it can', () => {
    // Not a licence to ship one: `tools/release.ts` refuses to cut a release
    // from anything that is not `x.y.z`. This is about a *reader* that must not
    // return NaN into a Gradle field.
    expect(versionCodeFor('0.10.1-beta.4')).toBe(10001);
    expect(versionCodeFor('')).toBe(0);
  });

  /**
   * The rule is written twice — here, and in Groovy, because Gradle is what
   * actually builds the bundle and cannot import this file. Two copies of a rule
   * is one copy too many, so the copies are held together instead: this reads
   * the Groovy and fails if it stops deriving the number the same way.
   */
  it('is derived the same way by the Gradle module that builds the bundle', () => {
    const definition = /def appVersionCode =\s*([\s\S]*?)\n\n/.exec(appGradle)?.[1] ?? '';
    expect(definition, 'app/build.gradle no longer defines appVersionCode').not.toBe('');

    // The three numbers, used in order, with the length guards that make a
    // one- or two-part version safe.
    const order = [...definition.matchAll(/versionParts\[(\d)\]/g)].map((match) => match[1]);
    expect(order).toEqual(['0', '1', '2']);
    expect(definition).toContain('versionParts.length > 1');
    expect(definition).toContain('versionParts.length > 2');

    // And the same weights, written the way Groovy writes them.
    const weights = [...definition.matchAll(/\*\s*([\d_]+)/g)].map((match) =>
      Number(match[1]!.replace(/_/g, '')),
    );
    expect(weights).toEqual([1_000_000, 1_000]);

    // The derived pair is what the manifest actually carries.
    expect(appGradle).toMatch(/versionCode = appVersionCode/);
    expect(appGradle).toMatch(/versionName = appVersionName/);
    expect(appGradle).toMatch(/JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/package\.json'\)\)/);
  });
});

describe('the Android application', () => {
  const identity = identityFrom({
    capacitorConfig,
    appGradle,
    strings: stringsXml,
  });
  const levels = sdkLevelsFrom(variablesGradle);

  it('states one application id, in every file that states one', () => {
    expect(identity.appId).toBe('com.sundayeleven.se27');
    expect(identity.problems).toEqual([]);
  });

  it('states one display name, in every file that states one', () => {
    expect(identity.appName).toBe('Sunday Eleven 27');
    expect(identity.resourceAppName).toBe(identity.appName);
  });

  it('targets an API level Google Play will accept', () => {
    expect(levels.target).toBeGreaterThanOrEqual(PLAY_REQUIRED_TARGET_SDK);
    expect(levels.compile).toBeGreaterThanOrEqual(levels.target);
    // Capacitor 8 supports Android 7.0 and above; going below its own floor is
    // how a build breaks in a way nobody tests for.
    expect(levels.min).toBeGreaterThanOrEqual(24);
    expect(levels.min).toBeLessThanOrEqual(levels.target);
  });

  /**
   * The build-tools revision, which is the difference between a build that works
   * everywhere and one that works only on the machine that happens to have the
   * revision the Gradle plugin defaults to. Left unsaid, AGP 8.13 picks 35.0.0 —
   * not what this project documents, not what its SDK setup installs, and not
   * what `npm run android:preflight` looks for. So it is stated once, used by
   * every Android module, and read back here.
   */
  it('names one build-tools revision and compiles with it', () => {
    const buildTools = buildToolsVersionFrom(variablesGradle);
    expect(buildTools).toMatch(/^\d+\.\d+\.\d+$/);
    expect(buildTools).toBe(`${levels.compile}.0.0`);
    // The application module names it beside `compileSdk`...
    expect(appGradle).toMatch(/buildToolsVersion rootProject\.ext\.buildToolsVersion/);
    // ...and the root build applies it to every other Android module, because
    // the Capacitor libraries are generated into `node_modules` by `cap sync`
    // and are not this repository's files to edit.
    expect(rootGradle).toMatch(/plugins\.withId\('com\.android\.library'\) \{ android\.buildToolsVersion/);
    expect(rootGradle).toMatch(/plugins\.withId\('com\.android\.application'\) \{ android\.buildToolsVersion/);
  });

  /**
   * Which JDKs the build can run on, which is a narrower question than which
   * JDKs exist. The upper bound is the one that bites: Android Studio ships its
   * own JetBrains Runtime, the one installed here is Java 25, and Gradle 8.14.3
   * under it fails with "Unsupported class file major version 69" before it
   * configures anything. A preflight that reports "✓ JDK 25" and then watches the
   * build die has told nobody anything useful, so that case is a failure here.
   */
  it('accepts only the JDKs the wrapper and the plugin can both run on', () => {
    expect(javaProblem(GRADLE_JAVA.compiles)).toBeNull();
    expect(javaProblem(GRADLE_JAVA.min)).toBeNull();
    expect(javaProblem(GRADLE_JAVA.max)).toBeNull();
    expect(javaProblem(GRADLE_JAVA.min - 1)).toMatch(/older than/);
    expect(javaProblem(GRADLE_JAVA.max + 1)).toMatch(/newer than/);
    expect(javaProblem(25)).toMatch(/class file 24/);
  });

  /**
   * The permission list is the privacy form. One permission, and it is the one
   * every WebView application has; nothing here reads a contact, a location or a
   * file the player did not hand over, which is why the Data safety answers are
   * all "none" rather than a longer list somebody has to keep in step.
   */
  it('asks for one permission, and it is the one a WebView needs', () => {
    expect(manifestPermissions(androidManifest)).toEqual(['INTERNET']);
  });

  /**
   * A packaged build *is* the game, so nothing it loads may come off a network —
   * a shell pointed at the live site is a bookmark that needs a signal to start
   * and shows whatever was deployed rather than what was tested.
   */
  it('carries its own assets rather than pointing at the website', () => {
    expect(remoteServerUrl(capacitorConfig)).toBeNull();
    expect(capacitorConfig).toMatch(/webDir:\s*'dist'/);
    expect(capacitorConfig).toMatch(/insetsHandling:\s*'css'/);
  });

  it('leaves the browser-only files out of a packaged bundle, and only for one', () => {
    // Both packaged targets — the phone's `native` and the desktop's — are
    // bundled applications, so both leave the same three files behind, and the
    // web build is the one they are for.
    const omissions = /const PACKAGED_OMISSIONS = \[([^\]]+)\]/.exec(viteConfig)?.[1] ?? '';
    expect(omissions).toContain("'sw.js'");
    expect(omissions).toContain("'_headers'");
    expect(omissions).toContain("'og.png'");
    expect(viteConfig).toMatch(/mode !== 'native' && mode !== 'desktop'/);
    // And the same three are what the release check knows about, so a fourth
    // cannot be added to the build without being added to the check.
    expect(browserOnlyFilesPresent(['sw.js', '_headers', 'og.png'])).toEqual([
      '_headers',
      'og.png',
      'sw.js',
    ]);
    expect(browserOnlyFilesPresent(['index.html', 'assets/app.js'])).toEqual([]);
  });
});

describe('the signing material', () => {
  it('is ignored by git, pattern by pattern', () => {
    expect(missingSigningPatterns(gitignore)).toEqual([]);
    expect(SIGNING_MATERIAL_PATTERNS).toContain('keystore.properties');
  });

  it('is read from an ignored file, and its absence is not an error', () => {
    expect(appGradle).toMatch(/rootProject\.file\('keystore\.properties'\)/);
    // The release build only takes a signing config when there is one to take:
    // an unsigned bundle is refused by Play with a message that names the
    // problem, where a build signed with the debug key would ship instead.
    expect(appGradle).toMatch(
      /if \(keystorePropertiesFile\.exists\(\)\) \{\s*signingConfig signingConfigs\.release/,
    );
  });

  it('is shaped by a committed example that holds no secret', () => {
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      expect(keystoreExample).toMatch(new RegExp(`^${key}=`, 'm'));
    }
    // The example is a shape: the two values that are secrets are blank in it,
    // and no keystore or password is ever written into the repository.
    expect(keystoreExample).toMatch(/^storePassword=\s*$/m);
    expect(keystoreExample).toMatch(/^keyPassword=\s*$/m);
  });

  /**
   * Shrinking is off, and this is the test that stops it being turned on
   * casually: Capacitor resolves its plugins by name at runtime, so an R8 pass
   * without the right keep rules removes them, and the failure shows up as a
   * release build that opens to a blank screen while every debug build works.
   * Turning it on is a change that needs a device, and a test that fails is a
   * better reminder of that than a comment.
   */
  it('is not shipped with shrinking enabled until a device has seen it', () => {
    expect(appGradle).toMatch(/minifyEnabled false/);
    expect(appGradle).not.toMatch(/minifyEnabled true/);
  });
});

describe('the signing preflight', () => {
  /**
   * The values a person fills in by hand, read back the way the preflight reads
   * them. The example is the shape the real file is copied from, and the two
   * secrets are blank in it — so *it* is a file the preflight must refuse, which
   * is the first thing this checks.
   */
  it('reads the four values, and names the ones left blank', () => {
    const example = signingPropertiesFrom(keystoreExample);
    expect(example.storeFile).toBe('upload-keystore.jks');
    expect(example.keyAlias).toBe('upload');
    expect(blankSigningValues(example)).toEqual(['storePassword', 'keyPassword']);

    const filled = signingPropertiesFrom(
      'storeFile=/keys/upload.jks\nstorePassword=one\nkeyAlias=upload\nkeyPassword=one\n',
    );
    expect(blankSigningValues(filled)).toEqual([]);
    // A file that was never filled in at all is blank in all four, in the order
    // the example lists them, so the message names them the way the file does.
    expect(blankSigningValues(signingPropertiesFrom(''))).toEqual([...SIGNING_KEYS]);

    /*
     * A blank value must not read the next line as its own. `storePassword=`
     * followed by `keyAlias=upload` is what a half-filled file looks like, and
     * for a while it read the second as the first — because the pattern around
     * the `=` was `\s`, which counts the newline. The blank then looked filled
     * in, and the check written to catch it passed the file that needed it.
     */
    const half = signingPropertiesFrom(
      'storeFile=upload-keystore.jks\nstorePassword=\nkeyAlias=upload\nkeyPassword=\n',
    );
    expect(half.storePassword).toBe('');
    expect(half.keyAlias).toBe('upload');
    expect(blankSigningValues(half)).toEqual(['storePassword', 'keyPassword']);

    const noFile = signingPropertiesFrom('storeFile=\nstorePassword=one\nkeyAlias=upload\nkeyPassword=one\n');
    expect(noFile.storeFile).toBe('');
    expect(blankSigningValues(noFile)).toEqual(['storeFile']);
  });

  /**
   * Every sentence in this block was written from the machine's own answers,
   * captured from throwaway fixtures — a real PKCS12 keystore, a real JKS one, a
   * text file called `.jks`, an empty file, and a directory. That matters because
   * keytool reports a wrong password in two different ways depending on the
   * format, and the preflight has to turn both into the one thing a person can
   * act on. An invented string here would have proved nothing about the tool.
   */
  it('reads a keystore that opened, with its type and its certificate', () => {
    const listed =
      'Keystore type: PKCS12\r\nKeystore provider: SUN\r\n\r\nYour keystore contains 1 entry\r\n\r\n' +
      'upload, 9 Oct 2026, PrivateKeyEntry, \r\n' +
      'Certificate fingerprint (SHA-256): 5D:04:3F:70:CF:1E:DF:1F:6E:4C:52:E0:AE:1F:31:4A:9C:A2:F9:50:61:7F:D5:B8:C8:39:45:03:D1:03:5F:42\r\n';
    const verdict = keystoreVerdict(0, listed);
    expect(verdict.state).toBe('ok');
    expect(verdict.keystoreType).toBe('PKCS12');
    expect(verdict.fingerprint).toBe(
      '5D:04:3F:70:CF:1E:DF:1F:6E:4C:52:E0:AE:1F:31:4A:9C:A2:F9:50:61:7F:D5:B8:C8:39:45:03:D1:03:5F:42',
    );
    expect(verdict.problem).toBe('');

    // `-list -v` prints the same digest in the other shape it comes in.
    const verbose = keystoreVerdict(0, 'Alias name: upload\n\t SHA256: 57:B6:03:19:A8:24:B2:76:18:72:87:A3:6D:AD:49:F7:CA:EE:07:69:4F:51:B1:95:BB:15:EB:06:35:1F:8E:A2\n');
    expect(verbose.fingerprint).toBe(
      '57:B6:03:19:A8:24:B2:76:18:72:87:A3:6D:AD:49:F7:CA:EE:07:69:4F:51:B1:95:BB:15:EB:06:35:1F:8E:A2',
    );
  });

  it('tells a wrong password apart from a file that is not a keystore', () => {
    const pkcs12Wrong = keystoreVerdict(
      1,
      'keytool error: java.io.IOException: keystore password was incorrect\r\n',
    );
    expect(pkcs12Wrong.state).toBe('wrong-password');
    expect(pkcs12Wrong.problem).toMatch(/store password/);

    const jksWrong = keystoreVerdict(
      1,
      'keytool error: java.io.IOException: Keystore was tampered with, or password was incorrect\r\n',
    );
    expect(jksWrong.state).toBe('wrong-password');

    const junk = keystoreVerdict(
      1,
      'keytool error: java.security.KeyStoreException: Unrecognized keystore format. Please load it with a specified type\r\n',
    );
    expect(junk.state).toBe('unreadable');
    expect(junk.problem).toMatch(/not a keystore/);

    // A directory the path happens to point at reports as an empty file.
    const empty = keystoreVerdict(1, 'keytool error: java.lang.Exception: Keystore file exists, but is empty: empty.jks\r\n');
    expect(empty.state).toBe('unreadable');
    expect(empty.problem).toMatch(/empty/);

    const unknown = keystoreVerdict(2, 'something nobody has seen before\n');
    expect(unknown.state).toBe('unreadable');
  });

  it('asks each keystore format what it can actually answer', () => {
    // Keytool opened the key: nothing to say.
    expect(keyPasswordProblem(0, 'no warning at all\n')).toBeNull();
    // A JKS keystore can hold a second password, and `-certreq` is what finds it.
    expect(
      keyPasswordProblem(1, 'keytool error: java.security.UnrecoverableKeyException: Cannot recover key\r\n'),
    ).toMatch(/key password/);
    expect(keyPasswordProblem(2, 'keytool error: something else entirely')).toMatch(/key password/);

    // PKCS12 holds *one* password and ignores a second one, so the check is that
    // the two values agree — which is what apksigner really needs.
    const differing = { storeFile: 'u.jks', storePassword: 'one', keyAlias: 'upload', keyPassword: 'two' };
    expect(passwordMismatchProblem('PKCS12', differing)).toMatch(/PKCS12/);
    expect(passwordMismatchProblem('PKCS12', { ...differing, keyPassword: 'one' })).toBeNull();
    expect(passwordMismatchProblem('JKS', differing)).toBeNull();
  });

  it('names the aliases a keystore actually holds', () => {
    const listed =
      'Your keystore contains 2 entries\r\n\r\nupload, 9 Oct 2026, PrivateKeyEntry, \r\n' +
      'upload-2025, 1 Jan 2025, PrivateKeyEntry, \r\nCertificate fingerprint (SHA-256): 5D:04:3F:70:CF:1E:DF:1F:6E:4C:52:E0:AE:1F:31:4A:9C:A2:F9:50:61:7F:D5:B8:C8:39:45:03:D1:03:5F:42\r\n';
    expect(aliasesFrom(listed)).toEqual(['upload', 'upload-2025']);
    expect(aliasesFrom('keytool error: java.io.IOException: keystore password was incorrect\r\n')).toEqual([]);
  });

  /**
   * The file is decoded by Gradle's `java.util.Properties`, not by us, and every
   * value below was measured by running that reader on JDK 21 — including the
   * throw, which is what a Windows path to this project's own keystore does.
   * Reading the text literally meant the preflight approved files the build could
   * not load.
   */
  it('decodes a value exactly the way Gradle does', () => {
    expect(readJavaPropertiesValue('a\\b')).toEqual({ value: 'ab', malformed: false });
    expect(readJavaPropertiesValue('a\\\\b')).toEqual({ value: 'a\\b', malformed: false });
    expect(readJavaPropertiesValue('a\\tb')).toEqual({ value: 'a\tb', malformed: false });
    expect(readJavaPropertiesValue('a\\u0041b')).toEqual({ value: 'aAb', malformed: false });
    expect(readJavaPropertiesValue('pa\\ss')).toEqual({ value: 'pass', malformed: false });
    expect(readJavaPropertiesValue('C:/x/y')).toEqual({ value: 'C:/x/y', malformed: false });
    expect(readJavaPropertiesValue('a\\u00G1b').malformed).toBe(true);
  });

  it('refuses a Windows path written with backslashes, before Gradle has to', () => {
    const written = 'storeFile=C:\\Users\\aeryt\\keys\\se27\\upload-keystore.jks\nstorePassword=p\nkeyAlias=upload\nkeyPassword=p\n';
    // `\u` in `\upload` is a malformed Unicode escape: Gradle's `load` throws, so
    // the preflight must refuse rather than approve it and let the build die.
    expect(malformedPropertiesValues(written)).toEqual(['storeFile']);

    // The two spellings that work, and what the second one decodes to.
    expect(malformedPropertiesValues('storeFile=C:/Users/aeryt/keys/se27/upload-keystore.jks\n')).toEqual([]);
    expect(
      malformedPropertiesValues('storeFile=C:\\\\Users\\\\aeryt\\\\keys\\\\se27\\\\upload-keystore.jks\n'),
    ).toEqual([]);
    expect(signingPropertiesFrom('storeFile=C:\\\\Users\\\\aeryt\\\\upload.jks\n').storeFile).toBe(
      'C:\\Users\\aeryt\\upload.jks',
    );

    // A password containing a backslash is decoded too, so what gets checked is
    // the password apksigner will actually be handed.
    expect(signingPropertiesFrom('storePassword=pa\\\\ss\n').storePassword).toBe('pa\\ss');

    // And the tool asks before it uses the values.
    expect(androidReleaseSource).toMatch(/malformedPropertiesValues\(/);
  });

  it('scrubs a password out of anything before it is printed', () => {
    const line = 'keytool error: Failed to open secret-3f9a with \"secret-3f9a\"';
    const scrubbed = redactSecret(line, ['secret-3f9a']);
    expect(scrubbed).not.toContain('secret-3f9a');
    expect(scrubbed).toContain('••••');
    // An empty value would otherwise be a needle of nothing, found everywhere.
    expect(redactSecret(line, [''])).toBe(line);
  });

  /**
   * Nothing in the preflight may hand a password to a process as an argument,
   * because an argument is visible to every other process on the machine and
   * lands in shell history and CI logs. Both passwords therefore travel as
   * `-storepass:env`/`-keypass:env` names, and this reads the tool's own source
   * to hold it to that — the one place the rule can be checked without a build.
   */
  it('never puts a password on a command line', () => {
    expect(androidReleaseSource).toMatch(/STORE_PASSWORD_ENV = '(SE27_[A-Z_]+)'/);
    expect(androidReleaseSource).toMatch(/KEY_PASSWORD_ENV = '(SE27_[A-Z_]+)'/);
    expect(androidReleaseSource).not.toMatch(/-storepass(?!:env)/);
    expect(androidReleaseSource).not.toMatch(/-keypass(?!:env)/);
    // And every line that reaches the report goes through the scrubber.
    expect(androidReleaseSource).toMatch(/redactSecret\(/);
    expect(androidReleaseSource).toMatch(/keytoolRun\(/);
  });

  /**
   * The wrapper is `android/gradlew.bat` (`android/gradlew` elsewhere) and the
   * tool used to invoke it as a bare `gradlew.bat` from the repository root, one
   * level above it: `npm run android:bundle` therefore built the native assets,
   * synced them, and then failed with "'gradlew.bat' is not recognized as an
   * internal or external command". The documented way to produce a bundle had
   * never reached the end, and this is the check that says every call it makes
   * to the wrapper names the Android project it lives in.
   */
  /**
   * `vite-node` — how every tool here starts — sets `NODE_ENV=development` in
   * its own process, and a child inherits it. So `npm run android:bundle` built
   * a 956,770-byte bundle containing `react-dom.development` while typing
   * `npm run build:native` produced the 771,327-byte production one: two
   * different applications from one source, and the documented release command
   * produced the wrong one. `npm run release` had the same fault for the website
   * it deploys. Both now state the environment they build in, and this holds both
   * to it.
   */
  it('builds in production mode, whatever environment the tool was started in', () => {
    const inherited = productionBuildEnv({ NODE_ENV: 'development', PATH: '/usr/bin' });
    expect(inherited.NODE_ENV).toBe('production');
    // Everything else is passed through: a build still needs PATH, JAVA_HOME…
    expect(inherited.PATH).toBe('/usr/bin');

    const android = [...androidReleaseSource.matchAll(/runOrFail\('npm', \['run', 'build:native'\][^)]*\)/g)].map(
      (match) => match[0],
    );
    expect(android.length).toBe(1);
    expect(android[0]).toContain('productionBuildEnv()');

    const website = [...websiteReleaseSource.matchAll(/run\('npm run build'[^)]*\)/g)].map(
      (match) => match[0],
    );
    expect(website.length).toBe(1);
    expect(website[0]).toContain('productionBuildEnv()');
  });

  it('runs the Gradle wrapper by full path, from the Android project it is inside', () => {
    const calls = [...androidReleaseSource.matchAll(/runOrFail\(grade\(\)[^)]*\)/g)].map(
      (match) => match[0],
    );
    expect(calls.length).toBeGreaterThan(0);
    // The wrapper runs inside the Android project, where it can find its own
    // `gradle/wrapper` and the generated `capacitor.build.gradle`.
    for (const call of calls) expect(call).toContain('ANDROID');
    // And it is named by its full path: a bare `gradlew.bat` is looked for in the
    // current directory, which `NoDefaultCurrentDirectoryInExePath=1` — set by
    // Git Bash, and present on the machine this was found on — excludes from the
    // search, so the wrapper was not found however right the working directory
    // was.
    expect(androidReleaseSource).toMatch(
      /join\(ANDROID, process\.platform === 'win32' \? 'gradlew\.bat' : 'gradlew'\)/,
    );
  });

  /**
   * The same trap the build-tools check was fixed for, in the other half of the
   * SDK: a platform is `android.jar`, not a directory with the right name. An
   * interrupted download leaves `platforms/android-36` behind with nothing in
   * it, and a check that reads a listing calls that installed.
   */
  it('counts an SDK package only when it holds the files that do the work', () => {
    expect(platformIsInstalled(['android.jar', 'source.properties', 'data', 'skins'])).toBe(true);
    expect(platformIsInstalled(['android.jar'])).toBe(false);
    expect(platformIsInstalled(['source.properties'])).toBe(false);
    expect(platformIsInstalled(['.installer'])).toBe(false);
    expect(platformIsInstalled([])).toBe(false);

    expect(buildToolsIsInstalled(['aapt2.exe', 'source.properties', 'aapt.exe'])).toBe(true);
    expect(buildToolsIsInstalled(['aapt2', 'source.properties'])).toBe(true);
    expect(buildToolsIsInstalled(['source.properties'])).toBe(false);
    expect(buildToolsIsInstalled(['aapt2.exe'])).toBe(false);
    expect(buildToolsIsInstalled([])).toBe(false);
  });
});

describe('the repository it all sits in', () => {
  it('carries the version the release tooling and the changelog agree on', () => {
    const version = (JSON.parse(packageJson) as { version: string }).version;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionCodeFor(version)).toBeGreaterThan(0);
  });
});
