import { describe, expect, it } from 'vitest';
import changelogRaw from '../../CHANGELOG.md?raw';
import doc from '../../DISCORD.md?raw';
import {
  AUTOMOD,
  BOT_PERMISSIONS,
  BOT_SCOPES,
  inviteUrl,
  CATEGORIES,
  CATEGORY_TYPE,
  CHANNELS,
  CHANNEL_TYPES,
  EVERYONE,
  EVERYONE_PERMISSIONS,
  HANDBOOK,
  PERMISSIONS,
  PRESET_VALUES,
  ROLES,
  announcementFrom,
  hasPermissions,
  overwritesFor,
  permissions,
  planServer,
  type ExistingChannel,
  type ExistingRole,
} from './discord';

/**
 * The server's design is data, so most of what could go wrong with it is a
 * property of the data rather than of any run: a channel pointing at a category
 * that does not exist, two roles with one name, a `#playtesting` nobody can see,
 * a permission bit typed wrong. Those are what these tests hold down, along with
 * the two functions that turn the data into something Discord will accept — the
 * overwrites and the plan — and the one that reads a release out of the
 * changelog. Nothing here talks to Discord; that is `tools/discord.ts`, and it
 * has no logic of its own to test.
 */

/** A server with the roles already made, which is the state after a first run. */
function rolesFromSpec(): ExistingRole[] {
  return ROLES.map((role, index) => ({
    id: `role-${index}`,
    name: role.name,
    permissions: permissions(role.permissions),
    managed: false,
  }));
}

function idsFor(roles: ExistingRole[]): {
  everyone: string;
  botRoleId: string;
  roles: Map<string, string>;
} {
  return {
    everyone: 'guild-id',
    botRoleId: 'bot-role',
    roles: new Map(roles.map((role) => [role.name, role.id])),
  };
}

function channelNamed(name: string): (typeof CHANNELS)[number] {
  const spec = CHANNELS.find((channel) => channel.name === name);
  if (!spec) throw new Error(`no channel called ${name}`);
  return spec;
}

describe('the permission bits', () => {
  it("uses Discord's own numbers, checked against its documentation's hex", () => {
    // A typo in one of these grants the wrong power, and the wrong power is
    // invisible until somebody abuses it. The values are Discord's published
    // ones, written as hex here so the two have to agree.
    expect(PERMISSIONS.ADMINISTRATOR).toBe(0x8n);
    expect(PERMISSIONS.MANAGE_CHANNELS).toBe(0x10n);
    expect(PERMISSIONS.MANAGE_GUILD).toBe(0x20n);
    expect(PERMISSIONS.VIEW_CHANNEL).toBe(0x400n);
    expect(PERMISSIONS.SEND_MESSAGES).toBe(0x800n);
    expect(PERMISSIONS.MANAGE_MESSAGES).toBe(0x2000n);
    expect(PERMISSIONS.MENTION_EVERYONE).toBe(0x20000n);
    expect(PERMISSIONS.MANAGE_ROLES).toBe(0x10000000n);
    expect(PERMISSIONS.MODERATE_MEMBERS).toBe(0x10000000000n);
    expect(PERMISSIONS.PIN_MESSAGES).toBe(0x8000000000000n);
  });

  it('adds names into the decimal string the API serialises', () => {
    expect(permissions(['VIEW_CHANNEL', 'SEND_MESSAGES'])).toBe((0x400n | 0x800n).toString());
    expect(permissions([])).toBe('0');
  });

  it('reads a bitfield back, and only claims what is wholly there', () => {
    const bits = BigInt(permissions(['VIEW_CHANNEL', 'SEND_MESSAGES']));
    expect(hasPermissions(bits, ['VIEW_CHANNEL', 'SEND_MESSAGES'])).toBe(true);
    expect(hasPermissions(bits, ['VIEW_CHANNEL', 'MANAGE_MESSAGES'])).toBe(false);
    // The string form is what the API actually hands over.
    expect(hasPermissions(bits.toString(), ['SEND_MESSAGES'])).toBe(true);
  });

  it('gives @everyone the power to take part and not the power to ping', () => {
    expect(hasPermissions(EVERYONE_PERMISSIONS, ['VIEW_CHANNEL', 'SEND_MESSAGES'])).toBe(true);
    // No MENTION_EVERYONE: the @everyone ping in this server belongs to a person
    // and not to whoever joins. No ADMINISTRATOR either, and no moderation.
    expect(hasPermissions(EVERYONE_PERMISSIONS, ['MENTION_EVERYONE'])).toBe(false);
    expect(hasPermissions(EVERYONE_PERMISSIONS, ['ADMINISTRATOR'])).toBe(false);
    expect(hasPermissions(EVERYONE_PERMISSIONS, ['MANAGE_MESSAGES'])).toBe(false);
    expect(hasPermissions(EVERYONE_PERMISSIONS, ['BAN_MEMBERS'])).toBe(false);
    expect(EVERYONE).toContain('CREATE_INSTANT_INVITE');
  });
});

describe('the spec itself', () => {
  it('names no role, channel or category twice', () => {
    // Two roles called `Keeper` is a server where the permissions depend on
    // which one Discord picked, and the planner would update one of them forever.
    const names = (list: readonly { name: string }[]): string[] => list.map((entry) => entry.name);
    for (const list of [names(ROLES), names(CHANNELS), names(CATEGORIES), names(AUTOMOD)]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('puts every channel in a category that exists', () => {
    const known = new Set(CATEGORIES.map((category) => category.name));
    for (const channel of CHANNELS) expect(known).toContain(channel.category);
  });

  it('gives every category a place of its own, in the order they are read', () => {
    const positions = CATEGORIES.map((category) => category.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(CATEGORIES[0]!.name).toBe('WELCOME');
  });

  it('names, for every channel that shows itself to a role, a role that exists', () => {
    const known = new Set(ROLES.map((role) => role.name));
    for (const channel of CHANNELS) {
      for (const role of channel.visibleTo ?? []) expect(known).toContain(role);
      // A channel hidden from @everyone and shown to nobody but the staff is a
      // channel only the staff can read, which is not what `hidden` says.
      if (channel.hidden && (channel.visibleTo ?? []).length === 0) {
        expect(channel.category).toBe('STAFF');
      }
    }
  });

  it('uses Discord channel types that are what the kind claims to be', () => {
    expect(CATEGORY_TYPE).toBe(4);
    expect(CHANNEL_TYPES).toEqual({ text: 0, voice: 2, announcement: 5, forum: 15 });
    for (const channel of CHANNELS) {
      // Tags are a forum's, and slow mode is a text channel's; setting the wrong
      // one is a request Discord answers with a 400.
      if (channel.tags) expect(channel.kind).toBe('forum');
      if (channel.needsCommunity) expect(channel.kind).toBe('announcement');
      if (channel.slowmode !== undefined) expect(channel.kind).toBe('text');
      // A voice limit is a voice channel's, and a voice channel is the one kind
      // that carries nothing else: Discord answers a topic on one with a 400.
      if (channel.voiceLimit !== undefined) expect(channel.kind).toBe('voice');
    }
  });

  it('asks for Community exactly where Community is the only way to have it', () => {
    const needs = CHANNELS.filter((channel) => channel.needsCommunity === true).map((c) => c.name);
    expect(needs).toEqual(['announcements']);
  });

  it('has exactly one voice channel, and nothing else is written down in it', () => {
    const voice = CHANNELS.filter((channel) => channel.kind === 'voice');
    expect(voice.map((channel) => channel.name)).toEqual(['touchline']);
    for (const channel of voice) {
      expect(channel.readOnly).toBeUndefined();
      expect(channel.topic).toBeUndefined();
      expect(channel.post).toBeUndefined();
      expect(channel.voiceLimit).toBe(0);
    }
  });

  it('lets people ask in #ask-xiai, and pins the answer there', () => {
    // Read-only would be a channel nobody can ask a question in, which is the
    // one thing this channel is for — and its pinned post is how somebody knows
    // the command exists at all.
    const ask = channelNamed('ask-xiai');
    expect(ask.readOnly).toBeUndefined();
    expect(ask.hidden).toBeUndefined();
    expect(ask.post, '#ask-xiai has no pinned post explaining /ask').toBeDefined();
    expect(ask.post!.body).toMatch(/\/ask/);
  });

  it('keeps known issues read-only, so the list stays the project\u2019s', () => {
    const known = channelNamed('known-issues');
    expect(known.readOnly).toBe(true);
    expect(known.post, '#known-issues has no list to point at').toBeDefined();
    expect(known.post!.body).toMatch(/bug-reports/);
  });

  it('has one place for the moderation alert to land', () => {
    const targets = CHANNELS.filter((channel) => channel.alertTarget === true);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.name).toBe('mod-log');
    expect(targets[0]!.hidden).toBe(true);
  });

  it('explains every decision it makes', () => {
    // The `why` fields are the whole point of writing the server down: a spec
    // nobody can argue with is a spec nobody can correct.
    for (const entries of [ROLES, CHANNELS, CATEGORIES, AUTOMOD]) {
      for (const entry of entries) {
        const why = (entry as { why?: string }).why ?? '';
        expect(why.length).toBeGreaterThan(10);
      }
    }
  });

  it('keeps the rules about language off the filter list, and the ones nobody argues about on it', () => {
    const presets = AUTOMOD.flatMap((rule) => rule.presets ?? []);
    // No PROFANITY preset and no swear-word patterns: a Sunday league community
    // swears, and a filter that eats "for fuck's sake, the keeper" is the most
    // complained-about thing a server can install.
    expect(presets).toContain('SLURS');
    expect(presets).not.toContain('PROFANITY');
    expect(AUTOMOD.flatMap((rule) => rule.patterns ?? []).join(' ')).not.toMatch(/fuck|shit/i);
    for (const rule of AUTOMOD) {
      // Discord refuses a custom message longer than 150 characters.
      expect(rule.message.length).toBeLessThanOrEqual(150);
      expect(rule.mentionLimit ?? 0).toBeLessThan(20);
    }
    expect(PRESET_VALUES).toEqual({ PROFANITY: 1, SEXUAL_CONTENT: 2, SLURS: 3 });
  });

  it('holds the bot invite link in DISCORD.md to the permissions the tool needs', () => {
    // The invite is produced by hand, in a browser, and it is the one step of
    // setting this up that cannot be run or checked by anything here — so the
    // number in the document is read back and compared with the list of
    // permissions the code actually asks for. A bot invited with the wrong link
    // is a run that fails halfway through with a 403.
    const link = inviteUrl('123456789012345678');
    const parameters = new URL(link).searchParams;
    expect(parameters.get('permissions')).toBe(permissions(BOT_PERMISSIONS));
    expect(parameters.get('scope')).toBe(BOT_SCOPES.join(' '));
    expect(parameters.get('client_id')).toBe('123456789012345678');
    expect(hasPermissions(permissions(BOT_PERMISSIONS), ['MANAGE_ROLES', 'MANAGE_CHANNELS'])).toBe(true);
    // Not Administrator: the tool builds channels and roles, and there is no
    // reason for it to be able to do anything else.
    expect(hasPermissions(permissions(BOT_PERMISSIONS), ['ADMINISTRATOR'])).toBe(false);

    const documented = /https:\/\/discord\.com\/api\/oauth2\/authorize\?[^\s`]+/.exec(doc);
    expect(documented, 'DISCORD.md no longer shows the invite link').not.toBeNull();
    // The document's link is the code's link with a placeholder id, which is
    // what makes the two checkable against each other.
    const shape = documented![0].replace(/(client_id=)[^&]+/, '$1PLACEHOLDER');
    expect(shape).toBe(inviteUrl('PLACEHOLDER'));
  });

  it('writes down what a bot cannot do rather than discovering it', () => {
    // Community, the role hierarchy, the icon, onboarding and the store are all
    // Discord's to a person. A tool that silently skipped them would be a tool
    // that half-configured a server and reported success.
    expect(HANDBOOK.length).toBeGreaterThanOrEqual(4);
    expect(HANDBOOK.join('\n')).toMatch(/Enable Community/);
    expect(HANDBOOK.join('\n')).toMatch(/role above/);
  });
});

describe('the channel overwrites', () => {
  it('leaves a channel that nothing is special about alone', () => {
    // `#general` denies nothing and pins nothing, so it inherits @everyone's
    // permissions and there is no overwrite to write.
    expect(overwritesFor(channelNamed('general'), idsFor(rolesFromSpec()))).toEqual([]);
  });

  it('mutes a read-only channel for @everyone and gives the bot the words back', () => {
    const overwrites = overwritesFor(channelNamed('welcome'), idsFor(rolesFromSpec()));
    const everyone = overwrites.find((entry) => entry.id === 'guild-id')!;
    const bot = overwrites.find((entry) => entry.id === 'bot-role')!;
    expect(hasPermissions(everyone.deny, ['SEND_MESSAGES', 'PIN_MESSAGES'])).toBe(true);
    expect(hasPermissions(everyone.allow, ['SEND_MESSAGES'])).toBe(false);
    // A deny for @everyone denies the bot too, because the bot is in @everyone
    // and a channel overwrite beats a guild-level permission.
    expect(hasPermissions(bot.allow, ['VIEW_CHANNEL', 'SEND_MESSAGES'])).toBe(true);
    expect(bot.deny).toBe('0');
  });

  it('hides the playtesters’ channel and hands it to the playtesters and the staff', () => {
    const roles = rolesFromSpec();
    const overwrites = overwritesFor(channelNamed('playtesting'), idsFor(roles));
    const everyone = overwrites.find((entry) => entry.id === 'guild-id')!;
    expect(hasPermissions(everyone.deny, ['VIEW_CHANNEL'])).toBe(true);
    expect(hasPermissions(everyone.allow, ['VIEW_CHANNEL'])).toBe(false);
    const playtester = overwrites.find((entry) => entry.id === roles.find((r) => r.name === 'Playtester')!.id)!;
    expect(hasPermissions(playtester.allow, ['VIEW_CHANNEL', 'SEND_MESSAGES'])).toBe(true);
    const keeper = overwrites.find((entry) => entry.id === roles.find((r) => r.name === 'Keeper')!.id)!;
    expect(hasPermissions(keeper.allow, ['VIEW_CHANNEL', 'MANAGE_MESSAGES'])).toBe(true);
  });

  it('does not mention a role that does not exist yet', () => {
    // On the first run the roles are created before the channels, but a role
    // somebody renamed leaves nothing to point at, and an overwrite naming an id
    // Discord has never seen is a 400 for the whole channel.
    const overwrites = overwritesFor(channelNamed('playtesting'), {
      everyone: 'guild-id',
      roles: new Map(),
    });
    expect(overwrites.every((entry) => entry.id === 'guild-id')).toBe(true);
    // And with no bot role known, the deny still stands: the bot is silenced
    // rather than the channel being left open to everyone.
    const readOnly = overwritesFor(channelNamed('rules'), { everyone: 'guild-id', roles: new Map() });
    expect(readOnly).toHaveLength(1);
    expect(hasPermissions(readOnly[0]!.deny, ['SEND_MESSAGES'])).toBe(true);
  });
});

describe('the planner', () => {
  const nothing: ExistingChannel[] = [];

  it('creates everything on a server that has nothing', () => {
    const plan = planServer({ roles: [], channels: nothing, features: { community: false } });
    expect(plan.roles.create.map((role) => role.name)).toEqual(ROLES.map((role) => role.name));
    expect(plan.roles.update).toEqual([]);
    expect(plan.categories.create).toHaveLength(CATEGORIES.length);
    // Everything but the announcement channel, which Discord will not accept
    // until somebody enables Community.
    expect(plan.channels.create).toHaveLength(CHANNELS.length - 1);
    expect(plan.channels.blocked.map((channel) => channel.name)).toEqual(['announcements']);
    // Every pinned post is a post to make, and the alert target is where AutoMod
    // is told to log.
    expect(plan.posts.map((channel) => channel.name)).toEqual([
      'welcome',
      'rules',
      'ask-xiai',
      'bug-reports',
      'known-issues',
      'playtesting',
    ]);
  });

  it('asks for the announcement channel once Community is on', () => {
    const plan = planServer({ roles: [], channels: nothing, features: { community: true } });
    expect(plan.channels.blocked).toEqual([]);
    expect(plan.channels.create.map((channel) => channel.name)).toContain('announcements');
  });

  it('leaves the first handbook item out once Community is on, and keeps the rest', () => {
    const off = planServer({ roles: [], channels: nothing, features: { community: false } });
    const on = planServer({ roles: [], channels: nothing, features: { community: true } });
    expect(off.hand).toEqual([...HANDBOOK]);
    expect(on.hand).toEqual([...HANDBOOK.slice(1)]);
    // The role hierarchy is not about Community, so it survives either way.
    expect(on.hand.join('\n')).toMatch(/role above/);
  });

  it('keeps a channel that already says what the spec says', () => {
    const plan = planServer({
      roles: rolesFromSpec(),
      channels: [
        { id: 'c1', name: 'welcome', type: 0, topic: channelNamed('welcome').topic!, rate_limit_per_user: 0 },
        { id: 'c2', name: 'general', type: 0, topic: channelNamed('general').topic!, rate_limit_per_user: 5 },
      ],
      features: { community: true },
    });
    expect(plan.channels.keep.map((channel) => channel.name)).toEqual(['welcome', 'general']);
    expect(plan.channels.update).toEqual([]);
    expect(plan.channels.create.map((channel) => channel.name)).not.toContain('general');
  });

  it('updates a channel whose topic or slow mode has drifted, and says which', () => {
    const plan = planServer({
      roles: rolesFromSpec(),
      channels: [
        { id: 'c1', name: 'general', type: 0, topic: 'Anything', rate_limit_per_user: 0 },
        { id: 'c2', name: 'announcements', type: 0, topic: channelNamed('announcements').topic! },
      ],
      features: { community: true },
    });
    const general = plan.channels.update.find((entry) => entry.spec.name === 'general')!;
    expect(general.existing.id).toBe('c1');
    expect(general.because).toMatch(/topic/);
    expect(general.because).toMatch(/slow mode 0s → 5s/);
    // A channel that exists with the right topic but the wrong *type* is an
    // update, not a second channel: Discord has one channel of that name.
    const announcements = plan.channels.update.find((entry) => entry.spec.name === 'announcements')!;
    expect(announcements.because).toContain('type 0 → 5');
  });

  it('never proposes to delete or rename anything the spec does not mention', () => {
    const plan = planServer({
      roles: [...rolesFromSpec(), { id: 'extra', name: 'Old Moderators', permissions: '0', managed: false }],
      channels: [{ id: 'c9', name: 'off-topic', type: 0 }],
      features: { community: true },
    });
    expect(plan.roles.create).toEqual([]);
    expect(plan.channels.create.map((channel) => channel.name)).not.toContain('off-topic');
    // Nothing in the plan is a deletion, and nothing in it carries a name
    // change: `Plan` has no field for either.
    expect(Object.keys(plan)).toEqual(['roles', 'channels', 'categories', 'posts', 'automod', 'hand']);
  });

  it('updates a role whose permissions have drifted, and keeps one that matches', () => {
    const roles = rolesFromSpec();
    const drift: ExistingRole[] = [
      ...roles.slice(0, 1),
      { ...roles[1]!, permissions: '8' }, // Playtester, accidentally an administrator
      ...roles.slice(2),
    ];
    const plan = planServer({ roles: drift, channels: nothing, features: { community: true } });
    expect(plan.roles.keep.map((role) => role.name)).toEqual(['Keeper', 'Release Notes']);
    const updated = plan.roles.update[0]!;
    expect(updated.spec.name).toBe('Playtester');
    expect(updated.because).toContain('8 → 0');
    expect(permissions(updated.spec.permissions)).toBe('0');
  });

  it('reuses a category that is already there instead of making a second one', () => {
    const plan = planServer({
      roles: rolesFromSpec(),
      channels: [{ id: 'cat-1', name: 'THE GAME', type: CATEGORY_TYPE }],
      features: { community: true },
    });
    expect(plan.categories.create.map((category) => category.name)).not.toContain('THE GAME');
    expect(plan.categories.existing).toContainEqual({
      spec: CATEGORIES.find((category) => category.name === 'THE GAME')!,
      id: 'cat-1',
    });
  });

  it('plans the AutoMod rules it will create', () => {
    const plan = planServer({ roles: [], channels: nothing, features: { community: true } });
    expect(plan.automod.map((rule) => rule.name)).toEqual(AUTOMOD.map((rule) => rule.name));
    expect(plan.automod.every((rule) => rule.triggerType > 0)).toBe(true);
  });
});

describe('announcing a release', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- Work in progress.',
    '',
    '## [1.2.0] - 2026-03-04 — a name for the release',
    '',
    '### Added',
    '',
    '- **Something** worth telling people about.',
    '',
    '- Another entry, with a [link](https://example.com).',
    '',
    '## [1.1.0] - 2026-02-01 — an older one',
    '',
    '- An older change that must not travel with the new one.',
  ].join('\n');

  it('takes the release out of the changelog, and stops at the next version', () => {
    const found = announcementFrom(changelog, '1.2.0')!;
    expect(found.title).toBe('a name for the release');
    expect(found.body).toContain('Something');
    expect(found.body).toContain('https://example.com');
    // The heading of the *next* release, and its notes, are not part of this one.
    expect(found.body).not.toContain('1.1.0');
    expect(found.body).not.toContain('An older change');
    // And the Unreleased section above it is not folded in either.
    expect(found.body).not.toContain('Work in progress');
  });

  it('gives a nameless release no name rather than inventing one', () => {
    const found = announcementFrom('## [3.0.0] - 2026-05-01\n\n- Something happened.', '3.0.0')!;
    expect(found.version).toBe('3.0.0');
    expect(found.title).toBe('');
    expect(found.body).toBe('- Something happened.');
    // An Unreleased heading is the same shape: no name, and no date to read.
    expect(announcementFrom('## [Unreleased]\n\n- Work.', 'Unreleased')!.title).toBe('');
  });

  it('cannot announce a version the changelog does not have', () => {
    // Better to say nothing than to invent a release, so this is null rather
    // than an empty announcement.
    expect(announcementFrom(changelog, '9.9.9')).toBeNull();
  });

  it('reads the real changelog, for the version this build is', () => {
    const found = announcementFrom(changelogRaw, '0.10.2')!;
    expect(found).not.toBeNull();
    expect(found.title.length).toBeGreaterThan(0);
    // The version is in the message already, so the title is the release's own
    // name and not its date read out again.
    expect(found.title).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // The release as written: it opens with the first section of the entry,
    // and it stops before the release below it.
    expect(found.body).toMatch(/^### /);
    expect(found.body).not.toContain('## [0.10.1]');
    // This release's notes are several times longer than a Discord message, so
    // the real announcement is a trimmed one that says so.
    expect(found.body).toMatch(/the rest of the notes are in the changelog\.$/);
  });

  it('trims at a paragraph boundary, and says that it did', () => {
    const long = [
      '## [2.0.0] - 2026-04-01 — a very long release',
      '',
      ...Array.from({ length: 20 }, (_, index) => `Paragraph number ${index} with some words in it.`),
    ].join('\n\n');
    const found = announcementFrom(long, '2.0.0', 120)!;
    expect(found.body.length).toBeLessThanOrEqual(140);
    expect(found.body).toMatch(/the rest of the notes are in the changelog\.$/);
    // Cut between paragraphs rather than mid-sentence: whatever is in there is a
    // whole paragraph.
    for (const paragraph of found.body.split('\n\n').slice(0, -1)) {
      expect(paragraph).toMatch(/^\*\*.*\*\*$|^Paragraph number \d+ with some words in it\.$/);
    }
  });

  it('keeps a short release whole, with no note about trimming', () => {
    const found = announcementFrom(changelog, '1.2.0')!;
    expect(found.body).not.toMatch(/the rest of the notes/);
    expect(found.title).toBe('a name for the release');
  });

  it('reads the same release out of a CRLF changelog, which is what the file is', () => {
    // Git checks the changelog out with CRLF endings on Windows, and the file in
    // this repository has them: read line-end-blind, the paragraphs never split
    // and a release becomes one enormous block that is trimmed to nothing.
    const crlf = changelog.replace(/\n/g, '\r\n');
    expect(announcementFrom(crlf, '1.2.0')).toEqual(announcementFrom(changelog, '1.2.0'));
    const found = announcementFrom(crlf, '1.2.0')!;
    expect(found.body).toContain('### Added');
    expect(found.body).toContain('Another entry');
  });

  it('has no windows in a version it cannot find, either way round', () => {
    expect(announcementFrom(changelog.replace(/\n/g, '\r\n'), '9.9.9')).toBeNull();
  });
});
