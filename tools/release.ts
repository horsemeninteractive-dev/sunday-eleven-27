/**
 * The release.
 *
 * Cutting a release by hand is six steps that only work in one order, and every
 * one of them has a way of being half-done: a version bumped in `package.json`
 * but not folded into the changelog, a build made before the bump so the screen
 * still says the old number, a deploy made before the build, a tag on a commit
 * that is not the one that shipped. None of those are caught by reading the
 * output, because the output looks fine.
 *
 * So this does all of it, in the order that works, and stops at the first thing
 * that does not check out — leaving the working tree exactly as it found it:
 *
 *   1. the version, bumped in `package.json` (the one place it is written down;
 *      `__APP_VERSION__` is substituted from it at build time)
 *   2. the changelog: `## [Unreleased]` becomes a dated heading for the release
 *   3. the guard: the changelog's first numbered version must be the version in
 *      `package.json`, which is what `src/ui/changelog.test.ts` enforces
 *   4. the build, to typecheck everything and to bake the number in
 *   5. the version read back out of the built bundle, so a stale build cannot
 *      be deployed under a new number
 *   6. the commit — before the deploy, so Cloudflare records the release commit
 *      as the source of what it is serving rather than the one before it
 *   7. the deploy to Cloudflare Pages
 *   8. the annotated tag, on the commit that was built and deployed
 *
 *   npm run release -- --minor --title="the people who run the club"
 *   npm run release -- --patch --title="…" --dry-run
 *   npm run release -- 0.8.0 --title="…" --body-file=tools/notes.md
 *   npm run release -- --minor --title="…" --push
 *
 * `--major`, `--minor` and `--patch` are what semantic versioning calls them,
 * with this project's own reading of the rule below 1.0.0: features arrive in
 * the minor number, fixes in the patch, and the major is the one that makes it
 * 1.0.0. An exact version may be given instead of any of them. The positional
 * spelling (`npm run release -- minor`) works as well, because that is how the
 * other tools here take an argument.
 *
 * `--push` is the only thing that touches the remote beyond the deploy, and it
 * is off unless asked for: `git push` of a branch and a tag is not something a
 * build script should decide on its own.
 *
 * What it deliberately does not do: write the notes. The Unreleased section is
 * the release's own prose, and a script that invented it would be a script that
 * publishes words nobody wrote. Write them first, then run this.
 *
 * It is a developer tool. Nothing in the game imports it, it is outside the test
 * suite, and it is typechecked with everything else so it cannot rot.
 */

import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseChangelog } from '@/ui/changelog';

/**
 * npm runs scripts from the project root, which every tool here relies on:
 * `tools/soak.ts` writes `soak-reports/` the same way.
 */
const ROOT = process.cwd();

// --- Arguments -------------------------------------------------------------

interface Options {
  /** `minor`, `patch`, `major`, or an explicit `x.y.z`, said positionally. */
  target: string | null;
  /** The same thing said as a flag: `--minor`, `--patch`, `--major`. */
  kind: string | null;
  title: string | null;
  body: string | null;
  bodyFile: string | null;
  project: string;
  deploy: boolean;
  push: boolean;
  dryRun: boolean;
  allowDirty: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    target: null,
    kind: null,
    title: null,
    body: null,
    bodyFile: null,
    project: 'sundayeleven',
    deploy: true,
    push: false,
    dryRun: false,
    allowDirty: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, ...inline] = arg.replace(/^--/, '').split('=');
    /**
     * The value of a flag: after the `=`, or the words that follow it.
     *
     * `--title="…"` is the spelling that survives `npm run` on every shell —
     * a quoted value passed through npm loses its quotes and arrives as three
     * arguments, which is how a release ends up titled "nothing to release"'s
     * first word. The bare form is read as everything up to the next flag, so
     * both spellings do the same thing.
     */
    const value = (): string => {
      if (inline.length > 0) return inline.join('=');
      const words: string[] = [];
      while (index + 1 < argv.length && !argv[index + 1]!.startsWith('--')) {
        words.push(argv[index + 1]!);
        index += 1;
      }
      return words.join(' ');
    };
    switch (name) {
      case 'title':
        options.title = value();
        break;
      case 'body':
        options.body = value();
        break;
      case 'body-file':
        options.bodyFile = value();
        break;
      case 'project':
        options.project = value() || 'sundayeleven';
        break;
      // Which number moves. The positional spelling reads better; the flag is
      // here because it is what people reach for, and it sits with the other
      // flags rather than before them.
      case 'major':
      case 'minor':
      case 'patch':
        options.kind = name;
        break;
      case 'no-deploy':
        options.deploy = false;
        break;
      case 'push':
        options.push = true;
        break;
      case 'dry-run':
        options.dryRun = true;
        break;
      case 'allow-dirty':
        options.allowDirty = true;
        break;
      default:
        break;
    }
  }

  options.target = positional[0] ?? null;
  return options;
}

// --- Shell -----------------------------------------------------------------

function run(command: string): void {
  process.stdout.write(`   $ ${command}\n`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit', cwd: ROOT });
  if (result.status !== 0) throw new Error(`\`${command}\` failed (exit ${result.status ?? 'signal'})`);
}

/** The same, for a command whose output is wanted rather than shown. */
function read(command: string): string {
  const result = spawnSync(command, { shell: true, encoding: 'utf8', cwd: ROOT });
  if (result.status !== 0) throw new Error(`\`${command}\` failed (exit ${result.status ?? 'signal'})`);
  return String(result.stdout ?? '').trim();
}

/** The same, for a command whose output is worth showing *and* reading. */
function runAndRead(command: string): string {
  process.stdout.write(`   $ ${command}\n`);
  const result = spawnSync(command, { shell: true, encoding: 'utf8', cwd: ROOT });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output.endsWith('\n') || output === '' ? output : `${output}\n`);
  if (result.status !== 0) throw new Error(`\`${command}\` failed (exit ${result.status ?? 'signal'})`);
  return output;
}

/**
 * Run a git command whose message is a file rather than an argument.
 *
 * `-m` cannot carry a commit body through a shell: no ordinary shell turns a
 * `\n` inside double quotes into a line break, so a message written that way
 * arrives as one long line with the escapes still in it, and the paragraphs of
 * a release note are lost exactly where they were worth having. A file in the
 * temp directory is also safe from being staged and safe to quote.
 */
function withMessageFile(name: string, message: string, command: (file: string) => void): void {
  const file = join(tmpdir(), `se27-release-${name}.txt`);
  writeFileSync(file, message.endsWith('\n') ? message : `${message}\n`, 'utf8');
  try {
    command(file);
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // A stale file in the temp directory is not worth failing a release over.
    }
  }
}

// --- Output ----------------------------------------------------------------

function heading(text: string): string {
  const room = Math.max(0, 74 - text.length);
  return `\n── ${text} ${'─'.repeat(room)}`;
}

function say(lines: readonly string[]): void {
  process.stdout.write(`${lines.map((line) => `   ${line}`).join('\n')}\n`);
}

// --- The version -----------------------------------------------------------

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * The version to release: an explicit one, or the next one of a kind.
 *
 * Below 1.0.0 the project's own rule is that features arrive in the minor
 * number and fixes in the patch, so `minor` and `patch` mean what the changelog
 * says they mean rather than what a generic bump would do.
 */
function resolveVersion(current: string, target: string | null): string {
  const now = VERSION_PATTERN.exec(current);
  if (!now) throw new Error(`package.json carries a version this does not understand: "${current}"`);
  const [, major, minor, patch] = now.map(Number) as [number, number, number, number];

  if (target === null) {
    throw new Error('say what to release: `minor`, `patch`, `major`, or an exact version such as 0.8.0');
  }
  if (target === 'major') return `${major + 1}.0.0`;
  if (target === 'minor') return `${major}.${minor + 1}.0`;
  if (target === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (!VERSION_PATTERN.test(target)) {
    throw new Error(`"${target}" is not a version, and not one of minor, patch or major`);
  }
  if (target === current) throw new Error(`the project is already on ${current}`);
  const next = VERSION_PATTERN.exec(target)!.slice(1).map(Number);
  const older = next[0]! < major || (next[0] === major && (next[1]! < minor || (next[1] === minor && next[2]! < patch)));
  if (older) throw new Error(`${target} is behind ${current} — versions only move forward`);
  return target;
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// --- Main ------------------------------------------------------------------

const USAGE = [
  '   usage: npm run release -- --minor --title="…" [options]',
  '          npm run release -- 0.8.0 --title="…"',
  '',
  '   which number moves, exactly one of:',
  '      --major            the next major — below 1.0.0 that is 1.0.0',
  '      --minor            a feature (below 1.0.0 features go in the minor number)',
  '      --patch            a fix',
  '      0.8.0              or an exact version, said instead of the flags',
  '',
  '      --title="…"        the release title, after the em dash in the heading',
  '      --body="…"         the commit message body (the changelog holds the notes)',
  '      --body-file=…      the same, read from a file',
  '      --project=…        the Cloudflare Pages project (default sundayeleven)',
  '      --no-deploy        build and commit, but do not deploy',
  '      --push             push the branch and the tag once everything is done',
  '      --dry-run          do everything up to the commit, then put it all back',
  '      --allow-dirty      release a tree that has other changes in it',
].join('\n');

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  const changelogPath = join(ROOT, 'CHANGELOG.md');
  const packagePath = join(ROOT, 'package.json');
  const original = {
    changelog: readFileSync(changelogPath, 'utf8'),
    package: readFileSync(packagePath, 'utf8'),
  };

  // A release that fails half way must not leave a bumped version and a folded
  // changelog behind for the next run to trip over.
  let edited = false;
  const restore = (): void => {
    if (!edited) return;
    writeFileSync(changelogPath, original.changelog, 'utf8');
    writeFileSync(packagePath, original.package, 'utf8');
    say(['put CHANGELOG.md and package.json back as they were']);
  };

  try {
    const manifest = JSON.parse(original.package) as { version: string };
    if (options.kind !== null && options.target !== null) {
      throw new Error(`say the kind of bump once: either \`${options.target}\` or \`--${options.kind}\``);
    }
    const version = resolveVersion(manifest.version, options.kind ?? options.target);
    const title = (options.title ?? '').trim();

    if (title === '') {
      throw new Error('a --title is required: the heading carries one, and the changelog guard rejects an empty one');
    }
    if (/[\r\n]/.test(title)) throw new Error('the title must be one line');
    if (/^[-—–\s]|[-—–\s]$/.test(title)) {
      throw new Error('the title must not begin or end with punctuation or space');
    }

    process.stdout.write(
      [
        '',
        `Sunday Eleven 27 — release ${version}`,
        `   ${manifest.version} → ${version} · "${title}"${options.dryRun ? ' · dry run' : ''}`,
      ].join('\n') + '\n',
    );

    // --- 1. The changelog ---------------------------------------------------
    process.stdout.write(heading('the changelog'));

    const unreleased = /^## \[?Unreleased\]?[ \t]*$/m.exec(original.changelog);
    if (!unreleased) {
      throw new Error('CHANGELOG.md has no "## [Unreleased]" section, so there is nothing to release');
    }
    if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(original.changelog)) {
      throw new Error(`CHANGELOG.md already has a section for ${version}`);
    }

    // Everything between the Unreleased heading and the next version heading.
    const after = original.changelog.slice(unreleased.index + unreleased[0].length);
    const next = /^## /m.exec(after.slice(1));
    const notes = next ? after.slice(0, next.index + 1) : after;
    if (!/^### /m.test(notes) || notes.replace(/[#\s]/g, '') === '') {
      throw new Error('the Unreleased section is empty — write the notes before releasing them');
    }

    const releaseHeading = `## [${version}] - ${today()} — ${title}`;
    const changelog = original.changelog.replace(unreleased[0], releaseHeading);
    const manifestNext = original.package.replace(
      /("version"\s*:\s*)"[^"]*"/,
      `$1"${version}"`,
    );
    if (manifestNext === original.package) throw new Error('could not find the version in package.json');

    say([
      `folded ${notes.match(/^### /gm)?.length ?? 0} section(s) of Unreleased notes into`,
      releaseHeading,
      `package.json ${manifest.version} → ${version}`,
    ]);

    // --- 2. The tree --------------------------------------------------------
    process.stdout.write(heading('the working tree'));

    const dirty = read('git status --porcelain').split('\n').filter(Boolean);
    const besides = dirty.filter((line) => !/ (CHANGELOG\.md|package\.json)$/.test(line));
    if (besides.length > 0 && !options.allowDirty) {
      throw new Error(
        [
          'the working tree has changes beyond CHANGELOG.md and package.json, and they would ship with the release:',
          ...besides.map((line) => `      ${line}`),
          '   commit or stash them, or pass --allow-dirty to release everything as it stands',
        ].join('\n'),
      );
    }
    if (dirty.length === 0) {
      say(['clean, apart from the two files this is about to write']);
    } else {
      say([`${dirty.length} change(s) will be committed with the release:`, ...dirty.map((line) => `   ${line}`)]);
    }

    const tagName = `v${version}`;
    if (read(`git tag -l ${tagName}`) !== '') throw new Error(`the tag ${tagName} already exists`);

    // --- 3. Write, and check the fold against the rule the tests enforce -----
    writeFileSync(changelogPath, changelog, 'utf8');
    writeFileSync(packagePath, manifestNext, 'utf8');
    edited = true;

    process.stdout.write(heading('the guard'));
    const parsed = parseChangelog(changelog);
    const first = parsed.find((block) => block.kind === 'version' && block.version !== 'Unreleased');
    if (first?.kind !== 'version' || first.version !== version) {
      throw new Error(`the changelog does not read back with ${version} at the top`);
    }
    say([`the changelog reads back with ${version} first, and its heading carries a title`]);

    run('npx vitest run src/ui/changelog.test.ts');
    run('npm run build');

    // --- 4. The build actually carries the number ---------------------------
    process.stdout.write(heading('the build'));
    const assets = join(ROOT, 'dist', 'assets');
    const baked = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .some((name) => readFileSync(join(assets, name), 'utf8').includes(version));
    if (!baked) {
      throw new Error(`no bundle in dist/assets carries ${version} — the build did not pick the bump up`);
    }
    say([`dist/ carries ${version} in its bundles`]);

    if (options.dryRun) {
      restore();
      edited = false;
      process.stdout.write(heading('dry run'));
      say([
        `would commit everything as "Release ${version} — ${title}"`,
        `would deploy dist/ to ${options.project}${options.push ? ', push the branch and tag it' : ''}`,
        `would tag ${tagName}`,
      ]);
      process.stdout.write('\n');
      return;
    }

    // --- 5. The commit, before the deploy -----------------------------------
    // Cloudflare records the commit a deployment came from, so committing first
    // is what makes "what is live" answerable from the deployment list.
    process.stdout.write(heading('the commit'));
    const body = options.bodyFile
      ? readFileSync(join(ROOT, options.bodyFile), 'utf8').trim()
      : (options.body ?? '').trim();
    const message = [
      `Release ${version} — ${title}`,
      '',
      body !== '' ? body : 'The notes for this release are in CHANGELOG.md.',
    ].join('\n');

    run('git add -A');
    say([`staged ${read('git diff --cached --name-only').split('\n').filter(Boolean).length} file(s)`]);
    withMessageFile('commit', message, (file) => run(`git commit -F "${file}"`));

    const commit = read('git rev-parse --short HEAD');
    say([`committed ${commit}`]);

    // --- 6. The deploy ------------------------------------------------------
    let deployed: string | null = null;
    if (options.deploy) {
      process.stdout.write(heading('the deploy'));
      const output = runAndRead(
        `npx wrangler pages deploy dist --project-name ${options.project} --commit-dirty=true`,
      );
      deployed = /(https:\/\/\S+\.pages\.dev)/.exec(output)?.[1] ?? null;
    } else {
      process.stdout.write(heading('the deploy'));
      say(['skipped (--no-deploy)']);
    }

    // --- 7. The tag ---------------------------------------------------------
    process.stdout.write(heading('the tag'));
    withMessageFile('tag', `Release ${version} — ${title}`, (file) =>
      run(`git tag -a ${tagName} -F "${file}"`),
    );
    say([`tagged ${tagName} on ${commit}`]);

    if (options.push) {
      process.stdout.write(heading('the push'));
      const branch = read('git rev-parse --abbrev-ref HEAD');
      run(`git push origin ${branch}`);
      run(`git push origin ${tagName}`);
    }

    process.stdout.write(heading(`released ${version}`));
    say([
      `commit ${commit} · tag ${tagName}`,
      deployed ? `live at ${deployed}` : 'not deployed',
      options.push ? 'branch and tag pushed' : 'not pushed — git push when you are ready',
    ]);
    process.stdout.write('\n');
  } catch (error) {
    restore();
    process.stdout.write(`\n   ✗ ${(error as Error).message}\n\n`);
    process.stdout.write(`${USAGE}\n\n`);
    process.exitCode = 1;
  }
}

main();
