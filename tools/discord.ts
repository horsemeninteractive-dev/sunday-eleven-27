/**
 * The Discord server, made to match the spec in one command.
 *
 * `src/platform/discord.ts` decides everything — which channels exist, who can
 * see what, what the pinned posts say — as functions of text, and this is the
 * small amount that has to touch the world: Discord's REST API, a bot token, and
 * the server it is pointed at. The split is deliberate and it is the same one
 * every other packaging step here uses, because it is the difference between a
 * tool whose decisions are testable on a machine with no token and one whose
 * decisions can only be checked by running it against a real server.
 *
 *     npm run discord:plan             what this would do, and nothing else
 *     npm run discord:apply            ...then do it
 *     npm run discord:announce         post the changelog entry for a version
 *
 * **The dry run is the default.** A tool that configures somebody's community is
 * a tool that should have to be asked twice, so the plan is printed, and only
 * `--apply` writes anything. Nothing at all is deleted: there is no DELETE in
 * this file, which is not an oversight but the whole safety model — a script can
 * leave a mess, but nothing it does can take away a channel somebody is using.
 *
 * **The token never lives in the repository.** It is read from `discord.env`,
 * which is ignored by git, or from the environment; if the file has ever been
 * tracked the tool refuses to run at all, because a bot token in git is a bot
 * token in every clone and in every fork for ever — and unlike a leaked keystore
 * there is no re-uploading anybody's application to recover from it. A token
 * that is merely written down is fine; one that is committed is not.
 *
 * Two facts about Discord's API that this leans on, both of which bite silently
 * if forgotten:
 *
 *   - **`@everyone`'s role id is the guild id.** It is not a role you can look
 *     up in the role list and find by name — it is the guild, and PATCHing it is
 *     how a server's own base permissions are set;
 *   - **a deny for `@everyone` denies the bot too**, since the bot is in
 *     `@everyone`. That is why the read-only channels get an allow for the bot's
 *     own role: without it the bot pins nothing, in the one place the pinned
 *     post is the point. `overwritesFor` in the spec does that, and this file
 *     only has to find the bot's role id.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentials, ROOT, type Credentials } from './discordEnv';
import {
  announcementFrom,
  AUTOMOD,
  CATEGORY_TYPE,
  CHANNELS,
  CHANNEL_TYPES,
  EVERYONE_PERMISSIONS,
  hasPermissions,
  inviteUrl,
  overwritesFor,
  permissions,
  planServer,
  PRESET_VALUES,
  type ChannelSpec,
  type ExistingChannel,
  type ExistingRole,
  type PermissionName,
} from '@/platform/discord';

const API = 'https://discord.com/api/v10';

// --- Output -----------------------------------------------------------------

/**
 * The same shape of report `tools/androidRelease.ts` prints, because the two are
 * read the same way: a mark, a thing, and — where it is useful — the sentence
 * that says what to do about it.
 */
type Mark = 'ok' | 'warn' | 'fail' | 'info';

const MARKS: Record<Mark, string> = { ok: '✓', warn: '!', fail: '✗', info: '·' };

interface Line {
  mark: Mark;
  text: string;
  detail?: string;
}

const buffered: Line[] = [];

function say(mark: Mark, text: string, detail?: string): void {
  buffered.push({ mark, text, detail });
}

function flush(): void {
  for (const line of buffered.splice(0)) {
    process.stdout.write(`   ${MARKS[line.mark]} ${line.text}\n`);
    if (line.detail) process.stdout.write(`     ${line.detail}\n`);
  }
}

function heading(text: string): void {
  flush();
  process.stdout.write(`\n── ${text} ${'─'.repeat(Math.max(0, 66 - text.length))}\n`);
}

// --- HTTP -------------------------------------------------------------------

/**
 * One request, with the two failures Discord actually produces handled here.
 *
 * Rate limits are not an error: Discord answers 429 with the number of seconds
 * to wait, and a tool that retries without reading it makes the limit worse. A
 * 5xx is retried a few times with a widening gap, because those are Discord's bad
 * minutes rather than this tool's bad request. Everything else is raised, with
 * the API's own message attached — a bare status code tells nobody anything.
 */
async function request<T>(
  credentials: Credentials,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${credentials.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SundayEleven27 (https://sundayeleven.pages.dev, 0.10.2)',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 429) {
    const limit = (await response.json().catch(() => ({}))) as { retry_after?: number };
    const wait = typeof limit.retry_after === 'number' ? limit.retry_after : 1;
    if (attempt >= 5) throw new Error(`${method} ${path} is still rate limited after 5 waits`);
    process.stdout.write(`   · rate limited by Discord; waiting ${wait.toFixed(1)}s\n`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 250));
    return request<T>(credentials, method, path, body, attempt + 1);
  }

  if (response.status >= 500 && attempt < 3) {
    const wait = 1000 * (attempt + 1);
    process.stdout.write(`   · Discord answered ${response.status}; retrying in ${wait / 1000}s\n`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return request<T>(credentials, method, path, body, attempt + 1);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    const hint =
      response.status === 403
        ? ' — the bot is missing a permission for this, or the role it is acting on sits above the bot\'s own role'
        : response.status === 404
          ? ' — the guild or channel id is wrong, or the bot cannot see it'
          : '';
    throw new Error(`${method} ${path} → ${response.status}${hint}\n     ${detail}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- What the API gives back ------------------------------------------------

interface ApiUser {
  id: string;
  username: string;
}

interface ApiGuild {
  id: string;
  name: string;
  features: string[];
  owner_id: string;
}

interface ApiRole {
  id: string;
  name: string;
  permissions: string;
  managed: boolean;
  position: number;
}

interface ApiChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  rate_limit_per_user?: number | null;
}

interface ApiMember {
  user: ApiUser;
  roles: string[];
}

interface ApiMessage {
  id: string;
  content: string;
}

interface ApiInvite {
  code: string;
}

interface ApiAutoModRule {
  id: string;
  name: string;
  trigger_type: number;
}

// --- Main -------------------------------------------------------------------

const USAGE = [
  '   usage: npm run discord:plan                say what would change, change nothing',
  '          npm run discord:apply               ...then do it',
  '          npm run discord:announce [version]  post a release from CHANGELOG.md',
  '',
  '   flags: --apply  --guild <id>  --icon <file.png>  --invite  --announce [version]',
].join('\n');

interface Options {
  apply: boolean;
  guild: string;
  icon: string | null;
  invite: boolean;
  announce: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { apply: false, guild: '', icon: null, invite: false, announce: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--invite') options.invite = true;
    else if (arg === '--guild') options.guild = argv[++i] ?? '';
    else if (arg === '--icon') options.icon = argv[++i] ?? null;
    else if (arg === '--announce') {
      // `--announce` with nothing after it means the version in package.json,
      // which is what you want the moment after cutting a release.
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        options.announce = next;
        i += 1;
      } else {
        options.announce = '';
      }
    } else if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return options;
}

/** The version the game is, which is the version an announcement is about. */
function currentVersion(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
  if (!manifest.version) throw new Error('package.json has no version');
  return manifest.version;
}

/**
 * The guild the bot is pointed at.
 *
 * `DISCORD_GUILD` where it is set, and otherwise the only server the bot is in —
 * which is the common case while a server is being set up, and an error the
 * moment it is not, because a tool that picks one of several at random is a tool
 * that configures the wrong community.
 */
async function resolveGuild(
  credentials: Credentials,
  chosen: string,
): Promise<{ guild: ApiGuild; everyoneRoleId: string }> {
  const wanted = chosen || credentials.guild;
  if (wanted === '') {
    const guilds = await request<ApiGuild[]>(credentials, 'GET', '/users/@me/guilds');
    if (guilds.length === 1) return { guild: await fetchGuild(credentials, guilds[0]!.id), everyoneRoleId: guilds[0]!.id };
    // The state a bot is in exactly once, on the first run: it exists, and it is
    // in no server, so there is nothing to configure and the one thing that helps
    // is the link that puts it there with the permissions the plan needs.
    if (guilds.length === 0) {
      const me = await request<ApiUser>(credentials, 'GET', '/users/@me').catch(() => null);
      say(
        'fail',
        'the bot is in no server yet',
        me
          ? `invite it, then run this again:\n     ${inviteUrl(me.id)}`
          : 'invite it from https://discord.com/developers/applications, then run this again',
      );
    } else {
      say(
        'fail',
        'no guild stated and the bot is in more than one',
        `set DISCORD_GUILD in discord.env to one of: ${guilds.map((g) => `${g.name} (${g.id})`).join(', ')}`,
      );
    }
    throw new Error('cannot tell which server to configure');
  }
  return { guild: await fetchGuild(credentials, wanted), everyoneRoleId: wanted };
}

async function fetchGuild(credentials: Credentials, id: string): Promise<ApiGuild> {
  return request<ApiGuild>(credentials, 'GET', `/guilds/${id}`);
}

/**
 * The bot's own permissions in the guild, from `@everyone` and the roles it has.
 *
 * `null` when its membership could not be read, and deliberately not "every
 * role's permissions": the guess that flatters the tool is the one that tells
 * somebody their bot is fine and then watches eight writes fail. A tool that says
 * it does not know is more useful than one that assumes the best case.
 */
function botPermissions(
  member: ApiMember | null,
  roles: readonly ApiRole[],
  everyone: ApiRole | undefined,
): bigint | null {
  if (!member) return null;
  let bits = everyone ? BigInt(everyone.permissions) : 0n;
  for (const role of roles) {
    if (!member.roles.includes(role.id)) continue;
    bits |= BigInt(role.permissions);
  }
  return bits;
}

/**
 * The bot's own role, which is the one Discord creates for it when it is invited.
 *
 * Found by `managed` rather than by name: it can be renamed, and it is the only
 * role in a server that the application does not own the membership of. It is
 * needed because a channel that denies `@everyone` the right to post denies it to
 * the bot as well, and the allow has to name a role.
 */
function botRoleId(member: ApiMember | null, roles: readonly ApiRole[]): string | undefined {
  const mine = roles.filter((role) => member?.roles.includes(role.id) ?? false);
  const managed = mine.find((role) => role.managed);
  return managed?.id ?? mine[mine.length - 1]?.id;
}

/** A PNG as the data URI the guild endpoint wants for an icon. */
function iconDataUri(path: string): string {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) throw new Error(`no icon at ${path}`);
  const bytes = readFileSync(absolute);
  if (bytes.length > 256 * 1024) {
    throw new Error(`${path} is ${(bytes.length / 1024).toFixed(0)} KB; Discord takes an icon of 256 KB or less`);
  }
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/* ------------------------------------------------------------------ *
 * The steps
 * ------------------------------------------------------------------ */

/**
 * One step of the plan, in the shape the report reads.
 *
 * A step that throws is recorded and the rest still run, because a server being
 * configured in one pass is worth more than the first error aborting eight
 * independent changes. Anything that is *necessary* for a later step — the
 * guild, the bot's role, the channels the posts go in — is resolved before the
 * writes start, so a failure there stops the run rather than cascading.
 */
async function step(what: string, work: () => Promise<string>, failures: string[]): Promise<void> {
  try {
    const detail = await work();
    say('ok', what, detail || undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${what}: ${message}`);
    say('fail', what, message);
  }
}

/* ------------------------------------------------------------------ *
 * Announcing a release
 * ------------------------------------------------------------------ */

/**
 * A release posted into `#announcements`, from the changelog rather than typed
 * again.
 *
 * Posted as an embed with the version in the title, crossposted when the channel
 * is an announcement channel so it can be followed into other servers. Only ever
 * a new message: a release announcement that edits itself later is a release
 * announcement nobody was notified about.
 */
async function announce(credentials: Credentials, version: string): Promise<void> {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const announcement = announcementFrom(changelog, version);
  if (!announcement) {
    const versions = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1]);
    throw new Error(
      `CHANGELOG.md has no section for ${version}` +
        (versions.length > 0 ? `\n     it has: ${versions.join(', ')}` : ''),
    );
  }

  const { guild } = await resolveGuild(credentials, '');
  const channels = await request<ApiChannel[]>(credentials, 'GET', `/guilds/${guild.id}/channels`);
  const roles = await request<ApiRole[]>(credentials, 'GET', `/guilds/${guild.id}/roles`);
  // Who asked to hear about this. The ping role is the whole reason
  // `@Release Notes` exists, and a release announcement that forgets to mention
  // it is a release nobody who wanted it was told about.
  const releaseNotes = roles.find((role) => role.name === 'Release Notes');
  const target = channels.find((channel) => channel.name === 'announcements');
  if (!target) {
    throw new Error(
      'there is no #announcements channel in this server — run `npm run discord:apply`, or enable Community if the channel was skipped',
    );
  }

  heading(`announcing ${version} in #${target.name}`);
  const headline = `**Sunday Eleven 27 ${version}**`;
  const content = [
    // A release the changelog gave no name to gets the version and nothing else:
    // an em dash followed by nothing reads as a mistake.
    announcement.title === '' ? headline : `${headline} — ${announcement.title}`,
    ...(releaseNotes ? ['', `<@&${releaseNotes.id}>`] : []),
  ].join('\n');
  const message = await request<ApiMessage>(credentials, 'POST', `/channels/${target.id}/messages`, {
    content,
    embed: {
      description: announcement.body.slice(0, 4096),
      color: 0x4caf7d,
      footer: { text: 'Sunday Eleven 27 · release notes' },
      url: 'https://sundayeleven.pages.dev/',
    },
    // Only the ping role resolves: a changelog that happens to mention somebody
    // by name must not turn into a notification for them.
    allowed_mentions: releaseNotes ? { roles: [releaseNotes.id] } : { parse: [] },
  });
  say('ok', `posted the notes for ${version}`, `${announcement.body.length} characters, from CHANGELOG.md`);
  say(
    releaseNotes ? 'info' : 'warn',
    releaseNotes ? `pinged @${releaseNotes.name}` : 'nobody was pinged',
    releaseNotes
      ? 'the role somebody opts into by asking for it — it exists so that this can happen without a general ping'
      : 'there is no @Release Notes role in this server: run `npm run discord:apply` first, or announce without a ping',
  );

  if (target.type === CHANNEL_TYPES.announcement) {
    await request(credentials, 'POST', `/channels/${target.id}/messages/${message.id}/crosspost`);
    say('ok', 'crossposted', 'followers of the channel get it in their own servers');
  } else {
    say('warn', 'not crossposted', 'that channel is not an announcement channel, so nobody can follow it');
  }
}

/* ------------------------------------------------------------------ *
 * Configuring the server
 * ------------------------------------------------------------------ */

async function configure(credentials: Credentials, options: Options): Promise<number> {
  const failures: string[] = [];

  // --- The server, and who the bot is in it ---------------------------------
  heading('the server');
  const { guild, everyoneRoleId } = await resolveGuild(credentials, options.guild);
  const community = guild.features.includes('COMMUNITY');
  say('ok', `${guild.name} (${guild.id})`, community
    ? 'Community is enabled, so announcement channels and the welcome screen can be set up'
    : 'Community is not enabled yet: the announcement channel will be skipped until a person enables it');

  const me = await request<ApiUser>(credentials, 'GET', '/users/@me');
  const everyoneRole = await request<ApiRole[]>(credentials, 'GET', `/guilds/${guild.id}/roles`);
  const existingRoles: ExistingRole[] = everyoneRole.map((role) => ({
    id: role.id,
    name: role.name,
    permissions: role.permissions,
    managed: role.managed,
  }));
  const everyoneRoleObject = everyoneRole.find((role) => role.id === everyoneRoleId);
  /*
   * `@everyone`'s role id is the guild id — it is not in the role list as a
   * separate entry with a name, it *is* the guild. The list above still holds it
   * (as a role object whose id equals the guild id), which is why the base
   * permissions are read from there and written back to the same id.
   */
  let member: ApiMember | null = null;
  try {
    member = await request<ApiMember>(credentials, 'GET', `/guilds/${guild.id}/members/${me.id}`);
  } catch {
    say('warn', 'could not read the bot\'s own membership', 'the moves that need its role will be reported as skipped');
  }
  say('ok', `the bot is ${me.username} (${me.id})`);
  const myRole = botRoleId(member, everyoneRole);
  if (myRole) {
    const role = everyoneRole.find((candidate) => candidate.id === myRole);
    say('info', `the bot posts as the role \"${role?.name ?? myRole}\"`, 'the read-only channels allow that role the right to pin, because a deny for @everyone denies the bot too');
  }

  const guildPermissions = botPermissions(member, everyoneRole, everyoneRoleObject);
  const wanted: PermissionName[] = ['MANAGE_CHANNELS', 'MANAGE_ROLES', 'MANAGE_GUILD'];
  if (guildPermissions === null) {
    say(
      'warn',
      'cannot tell what the bot is allowed to do here',
      'its membership could not be read, so the permission check is skipped: if a step below fails for a permission, give the bot Manage Channels, Manage Roles and Manage Server and run it again',
    );
  } else {
    const missing = wanted.filter((name) => !hasPermissions(guildPermissions, [name]));
    if (missing.length > 0) {
      say(
        'warn',
        `the bot is missing ${missing.join(', ')}`,
        'anything below that needs one of those will fail; give the bot the permission in Server Settings → Roles and run this again',
      );
    } else {
      say('ok', 'the bot holds Manage Channels, Manage Roles and Manage Server');
    }
  }

  const channels = await request<ApiChannel[]>(credentials, 'GET', `/guilds/${guild.id}/channels`);
  const existingChannels: ExistingChannel[] = channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parent_id: channel.parent_id ?? null,
    topic: channel.topic ?? null,
    rate_limit_per_user: channel.rate_limit_per_user ?? null,
  }));

  const plan = planServer({
    roles: existingRoles,
    channels: existingChannels,
    features: { community },
  });

  // --- What the plan says ---------------------------------------------------
  heading(options.apply ? 'applying' : 'the plan (nothing is done without --apply)');
  say('info', `roles: ${plan.roles.create.length} to create, ${plan.roles.update.length} to update, ${plan.roles.keep.length} already right`);
  say('info', `channels: ${plan.channels.create.length} to create, ${plan.channels.update.length} to update, ${plan.channels.keep.length} already right`);
  if (plan.channels.blocked.length > 0) {
    say('warn', `skipped: ${plan.channels.blocked.map((channel) => `#${channel.name}`).join(', ')}`, 'these need Community enabled');
  }
  for (const spec of plan.roles.create) say('info', `create role @${spec.name}`, spec.why);
  for (const { spec, because } of plan.roles.update) say('info', `update role @${spec.name}`, because);
  for (const spec of plan.channels.create) say('info', `create #${spec.name} (${spec.kind})`, spec.why);
  for (const { spec, because } of plan.channels.update) say('info', `update #${spec.name}`, because);
  const orphaned = existingChannels.filter(
    (channel) => channel.type !== CATEGORY_TYPE && !CHANNELS.some((spec) => spec.name === channel.name),
  );
  for (const channel of orphaned) {
    say('info', `left alone: #${channel.name}`, 'not in the spec, so it is somebody\'s decision rather than a mistake');
  }

  if (!options.apply) {
    flush();
    heading('what a person still has to do');
    for (const item of plan.hand) say('info', item);
    flush();
    process.stdout.write('\n   This was a plan. Nothing was changed. Run it again with `--apply`.\n\n');
    return 0;
  }

  // --- @everyone ------------------------------------------------------------
  await step(
    '@everyone\'s own permissions',
    async () => {
      if (everyoneRoleObject && BigInt(everyoneRoleObject.permissions) === BigInt(EVERYONE_PERMISSIONS)) {
        return 'already the ones the spec states';
      }
      await request(credentials, 'PATCH', `/guilds/${guild.id}/roles/${everyoneRoleId}`, {
        permissions: EVERYONE_PERMISSIONS,
      });
      return 'set: everything a member needs and no @everyone ping for strangers';
    },
    failures,
  );

  // --- Roles ----------------------------------------------------------------
  const roleIds = new Map<string, string>();
  for (const role of everyoneRole) roleIds.set(role.name, role.id);
  for (const spec of plan.roles.create) {
    await step(
      `create @${spec.name}`,
      async () => {
        const created = await request<ApiRole>(credentials, 'POST', `/guilds/${guild.id}/roles`, {
          name: spec.name,
          color: spec.colour ?? 0,
          hoist: spec.hoist ?? false,
          mentionable: spec.mentionable ?? false,
          permissions: permissions(spec.permissions),
        });
        roleIds.set(spec.name, created.id);
        return spec.why;
      },
      failures,
    );
  }
  for (const { spec, existing, because } of plan.roles.update) {
    await step(
      `update @${spec.name}`,
      async () => {
        await request(credentials, 'PATCH', `/guilds/${guild.id}/roles/${existing.id}`, {
          permissions: permissions(spec.permissions),
          color: spec.colour ?? 0,
          hoist: spec.hoist ?? false,
          mentionable: spec.mentionable ?? false,
        });
        return because;
      },
      failures,
    );
  }

  /*
   * Categories first, then the channels that name them.
   *
   * `position` is sent for a category and not for a channel: a category's place
   * in the sidebar is part of the design (who we are, then the game, then
   * feedback, then the staff), while a channel's is the order it was created in
   * and Discord appends new ones under their parent either way. Channels are
   * created in spec order for that reason.
   */
  const categoryIds = new Map<string, string>();
  for (const { spec, id } of plan.categories.existing) categoryIds.set(spec.name, id);
  for (const spec of plan.categories.create) {
    await step(
      `create the ${spec.name} category`,
      async () => {
        const created = await request<ApiChannel>(credentials, 'POST', `/guilds/${guild.id}/channels`, {
          name: spec.name,
          type: CATEGORY_TYPE,
          position: spec.position,
        });
        categoryIds.set(spec.name, created.id);
        return spec.why;
      },
      failures,
    );
  }

  const channelIds = new Map<string, string>(existingChannels.map((channel) => [channel.name, channel.id]));
  /*
   * The body of a channel, which includes its permission overwrites — and that
   * is the one place this tool replaces rather than adds. A channel in the spec
   * is a channel the spec owns, so an overwrite somebody added by hand to one of
   * them is replaced by the designed one on the next run.
   *
   * Worth saying out loud, because the rest of this file only ever creates: the
   * overwrites are the exception, and anybody who has hand-tuned `#general`
   * should hear it from the tool rather than discover it in the audit log. A
   * channel *not* in the spec is never touched at all.
   */
  const channelBody = (spec: ChannelSpec): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      name: spec.name,
      type: CHANNEL_TYPES[spec.kind],
      parent_id: categoryIds.get(spec.category) ?? null,
      permission_overwrites: overwritesFor(spec, {
        everyone: everyoneRoleId,
        botRoleId: myRole,
        roles: roleIds,
      }),
    };
    if (spec.topic !== undefined) body.topic = spec.topic;
    if (spec.slowmode !== undefined) body.rate_limit_per_user = spec.slowmode;
    if (spec.tags) body.available_tags = spec.tags.map((name) => ({ name }));
    // A voice channel's two settings are its own: `user_limit` is how many fit,
    // and the spec only states it where the channel wants something other than
    // Discord's opening answer. A voice channel has no topic and no slow mode,
    // which is why nothing above fires for one.
    if (spec.voiceLimit !== undefined) body.user_limit = spec.voiceLimit;
    return body;
  };

  for (const spec of plan.channels.create) {
    await step(
      `create #${spec.name}`,
      async () => {
        const created = await request<ApiChannel>(credentials, 'POST', `/guilds/${guild.id}/channels`, channelBody(spec));
        channelIds.set(spec.name, created.id);
        return spec.why;
      },
      failures,
    );
  }
  for (const { spec, existing, because } of plan.channels.update) {
    await step(
      `update #${spec.name}`,
      async () => {
        const body = channelBody(spec);
        delete body.type; // A channel's type cannot be changed; the rest can.
        await request(credentials, 'PATCH', `/channels/${existing.id}`, body);
        return because;
      },
      failures,
    );
  }

  // --- The pinned posts -----------------------------------------------------
  /*
   * Idempotent without a state file: the post is found by the first line of its
   * own text, which is the marker in the spec. A post that has been edited by
   * hand is corrected, a post that is missing is made and pinned, and a post that
   * already matches is left exactly where it is — so running this twice changes
   * nothing, and running it after an edit puts the edit back.
   */
  for (const spec of plan.posts) {
    const channel = channelIds.get(spec.name);
    if (!channel) {
      say('warn', `no pinned post in #${spec.name}`, 'the channel is not there yet');
      continue;
    }
    const post = spec.post!;
    await step(
      `the pinned post in #${spec.name}`,
      async () => {
        const pins = await request<ApiMessage[]>(credentials, 'GET', `/channels/${channel}/pins`);
        const existing = pins.find((message) => message.content.startsWith(post.marker));
        if (existing) {
          if (existing.content === post.body) return 'already right, and pinned';
          await request(credentials, 'PATCH', `/channels/${channel}/messages/${existing.id}`, {
            content: post.body,
            allowed_mentions: { parse: [] },
          });
          return 'corrected in place, so its pin and its reactions stay where they were';
        }
        const made = await request<ApiMessage>(credentials, 'POST', `/channels/${channel}/messages`, {
          content: post.body,
          allowed_mentions: { parse: [] },
        });
        await request(credentials, 'PUT', `/channels/${channel}/pins/${made.id}`);
        return 'written and pinned';
      },
      failures,
    );
  }

  // --- AutoMod --------------------------------------------------------------
  const automod = await request<ApiAutoModRule[]>(credentials, 'GET', `/guilds/${guild.id}/auto-moderation/rules`).catch(
    () => [] as ApiAutoModRule[],
  );
  const keeper = roleIds.get('Keeper');
  const alertChannel = CHANNELS.find((channel) => channel.alertTarget === true);
  const alertId = alertChannel ? channelIds.get(alertChannel.name) : undefined;

  for (const rule of AUTOMOD) {
    const triggerMetadata: Record<string, unknown> = {};
    if (rule.presets) triggerMetadata.presets = rule.presets.map((name) => PRESET_VALUES[name]);
    if (rule.patterns) triggerMetadata.keyword_filter = [...rule.patterns];
    if (rule.mentionLimit !== undefined) {
      triggerMetadata.mention_total_limit = rule.mentionLimit;
      triggerMetadata.mention_raid_protection_enabled = true;
    }
    const actions: Array<Record<string, unknown>> = [{ type: 1, metadata: { custom_message: rule.message } }];
    if (alertId) actions.push({ type: 2, metadata: { channel_id: alertId } });
    const body = {
      name: rule.name,
      event_type: 1,
      trigger_type: rule.triggerType,
      trigger_metadata: triggerMetadata,
      actions,
      enabled: true,
      exempt_roles: keeper ? [keeper] : [],
    };
    const existing = automod.find((candidate) => candidate.name === rule.name);
    await step(
      `automod: ${rule.name}`,
      async () => {
        if (existing) {
          await request(credentials, 'PATCH', `/guilds/${guild.id}/auto-moderation/rules/${existing.id}`, body);
          return `kept up to date — ${rule.why}`;
        }
        await request(credentials, 'POST', `/guilds/${guild.id}/auto-moderation/rules`, body);
        return `${rule.why}${alertId ? '; it logs to #' + alertChannel!.name : ''}`;
      },
      failures,
    );
  }

  // --- The icon, the invite, the welcome screen ------------------------------
  if (options.icon) {
    await step(
      'the server icon',
      async () => {
        await request(credentials, 'PATCH', `/guilds/${guild.id}`, { icon: iconDataUri(options.icon!) });
        return `${options.icon} — the same mark the desktop app and the phone show`;
      },
      failures,
    );
  }

  if (options.invite) {
    await step(
      'an invite',
      async () => {
        const welcome = channelIds.get('welcome');
        if (!welcome) throw new Error('there is no #welcome channel to invite people to');
        const invite = await request<ApiInvite>(credentials, 'POST', `/channels/${welcome}/invites`, {
          max_age: 0, // never expires: this is the link that goes on the website
          max_uses: 0,
          unique: false,
        });
        say('info', `https://discord.gg/${invite.code}`, 'permanent, unlimited uses — it belongs on the site and in the README');
        return 'created for #welcome';
      },
      failures,
    );
  }

  if (community) {
    await step(
      'the welcome screen',
      async () => {
        const wanted = [
          { name: 'welcome', description: 'What the game is, and where to get it' },
          { name: 'rules', description: 'The whole of them, in five lines' },
          { name: 'general', description: 'Say hello' },
        ];
        const welcomeChannels = wanted.flatMap((entry, index) => {
          const id = channelIds.get(entry.name);
          return id ? [{ channel_id: id, description: entry.description, emoji_name: ['👋', '📋', '💬'][index] ?? '💬' }] : [];
        });
        await request(credentials, 'PATCH', `/guilds/${guild.id}/welcome-screen`, {
          enabled: true,
          description: 'Grassroots Sunday League football management — the game, the saves people are playing, and somewhere to say what is wrong with it.',
          welcome_channels: welcomeChannels,
        });
        return `${welcomeChannels.length} channels, shown to everybody who joins`;
      },
      failures,
    );
  }

  // --- The report -----------------------------------------------------------
  flush();
  heading('what a person still has to do');
  for (const item of plan.hand) say('info', item);
  flush();

  if (failures.length > 0) {
    process.stdout.write(`\n   ${failures.length} step(s) did not go through:\n`);
    for (const failure of failures) process.stdout.write(`   ✗ ${failure}\n`);
    process.stdout.write('   Everything else was applied. Fix the above and run it again — nothing here deletes anything.\n\n');
    return 1;
  }

  process.stdout.write('\n   The server matches the spec in src/platform/discord.ts.\n\n');
  return 0;
}

// --- Entry ------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write('\nSunday Eleven 27 — the Discord server\n');
  const options = parseArgs(process.argv.slice(2));
  const credentials_ = credentials();

  if (options.announce !== null) {
    await announce(credentials_, options.announce || currentVersion());
    return;
  }

  process.exitCode = await configure(credentials_, options);
}

main().catch((error: unknown) => {
  flush();
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`\n   ✗ ${message}\n\n`);
  if (!/discord\.env|token/.test(message)) process.stdout.write(`${USAGE}\n\n`);
  process.exitCode = 1;
});

/*
 * `process.exitCode` rather than `process.exit`, which is not a style choice:
 * Node on Windows aborts inside libuv when `process.exit()` is called with a
 * `fetch` connection still in its keep-alive pool — the run dies with
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and an exit status of
 * 127, which is a *command not found* to everything watching. Setting the code
 * and letting the process end on its own reports the failure honestly, and is
 * what `tools/release.ts` already does.
 */
