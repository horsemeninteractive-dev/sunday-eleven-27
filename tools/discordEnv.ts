/**
 * The bot token, in one place, for the two tools that need it.
 *
 * `tools/discord.ts` configures the server and `tools/xiai.ts` answers questions
 * in it. They are the same bot, so they are the same credential — and a second
 * copy of the reading rules is a second copy that will disagree about what
 * "there is no token" means. This module is that one place.
 *
 * **The token never lives in the repository.** It is read from `discord.env`,
 * which is ignored by git, or from the environment; if the file has ever been
 * *tracked* the tool refuses to run at all, because a bot token in git is a bot
 * token in every clone and in every fork for ever — and unlike a leaked keystore
 * there is no re-uploading anybody's application to recover from it. A token that
 * is merely written down is fine; one that is committed is not.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const ROOT = process.cwd();
export const ENV_FILE = join(ROOT, 'discord.env');

export interface Credentials {
  token: string;
  guild: string;
}

/**
 * `KEY=value` lines from a file that is nobody else's business.
 *
 * Deliberately not a dotenv implementation: this reads the two names it wants,
 * ignores blank lines and `#` comments, and strips one layer of quotes. A file
 * with an `export` in front of the name is a file somebody pasted from a shell
 * transcript, and it is read anyway rather than rejected.
 */
function readEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return values;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const value = line
      .slice(at + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (value !== '') values[name] = value;
  }
  return values;
}

/**
 * The token, from the file or the environment, and never from anywhere else.
 *
 * A token that has been committed is refused outright rather than merely
 * ignored — the file being ignored now does not un-commit it, and the only safe
 * answer is to rotate the token and say so.
 */
export function credentials(): Credentials {
  if (existsSync(ENV_FILE)) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'discord.env'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false,
    });
    if (tracked.status === 0 && tracked.stdout.trim() !== '') {
      throw new Error(
        'discord.env is tracked by git, so the bot token is in the repository and in every clone of it. ' +
          'Rotate the token in the Discord Developer Portal first, then remove the file from the index ' +
          '(`git rm --cached discord.env`) — a token in git history stays there after the file is deleted.',
      );
    }
  }

  const file = readEnvFile(ENV_FILE);
  const token = file.DISCORD_TOKEN ?? process.env.DISCORD_TOKEN ?? '';
  const guild = file.DISCORD_GUILD ?? process.env.DISCORD_GUILD ?? '';

  if (token === '') {
    // The two states are different and worth telling apart, because they are one
    // step apart: an empty `DISCORD_TOKEN=` is somebody halfway through the setup
    // and being told to create a file they are already looking at.
    const where = existsSync(ENV_FILE)
      ? 'discord.env is there, but its DISCORD_TOKEN= line is empty'
      : 'there is no discord.env, and the environment has no DISCORD_TOKEN';
    throw new Error(
      [
        `no bot token: ${where}.`,
        '',
        '  1. https://discord.com/developers/applications → your application',
        '     (New Application first, if there is not one yet)',
        '  2. Bot → Reset Token → Copy',
        '  3. paste it into discord.env after DISCORD_TOKEN=, and save',
        '  4. if the bot is not in the server yet, open the invite link in',
        '     DISCORD.md and pick the server — that link carries exactly the',
        '     permissions this tool needs, and a test holds it to them',
        '',
        'discord.env is ignored by git. Never paste the token into a chat.',
      ].join('\n'),
    );
  }
  return { token, guild };
}
