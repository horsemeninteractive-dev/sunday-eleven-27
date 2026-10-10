/**
 * The game's Discord server, written down.
 *
 * A server configured by clicking is a server nobody can check, rebuild or
 * review: the settings live in a web form and the reasoning lives in somebody's
 * head. This module is the other half — the whole of it as data — and
 * `tools/discord.ts` is the small amount of HTTP needed to make a real server
 * match. The split is the same one every other packaging step in this repository
 * uses (`src/platform/` decides, `tools/` talks), and it is what makes the
 * interesting half testable: which channels exist, who can see what, what the
 * pinned posts say and what an announcement of a release looks like are all
 * decided here, without a token.
 *
 * What is in it, and why:
 *
 *   - **three roles, not a hierarchy.** `Keeper` is a person who can moderate,
 *     `Playtester` is a person who can see the private channel, and
 *     `Release Notes` exists only to be mentioned — a ping role lets somebody
 *     ask to hear about releases without asking to be told everything.
 *   - **four categories**, in the order a new arrival needs them: who we are,
 *     the game, saying something about it, and the staff room.
 *   - **read-only where reading is the point.** `#welcome`, `#rules` and
 *     `#announcements` deny sending to `@everyone`, which (`see overwritesFor`)
 *     also denies it to the bot — so the bot is given the permission back by
 *     name, and nobody has to remember that a pinned post is the one thing a
 *     muted channel still needs.
 *   - **what a bot cannot do, listed rather than discovered.** `handbook`
 *     is the work that stays a person's: enabling Community, dragging the bot's
 *     role above the roles it manages, and the store-and-vanity things Discord
 *     keeps for people. A script that quietly omits those is a script that
 *     half-configures a server and says it succeeded.
 *
 * Nothing here deletes anything. The planner only ever proposes creating what is
 * missing and updating what differs; a channel somebody renamed or a role
 * somebody reworked is left alone and reported.
 */

/**
 * The permission bits this server uses, by the names Discord's own UI shows.
 *
 * Only the ones the design needs are here, which is the point of writing them
 * out: a spec that says `MANAGE_MESSAGES` can be read by somebody who has never
 * seen a bitfield, and `permissions()` turns it back into the integer Discord
 * wants. The values are Discord's, and a test holds a handful of them against
 * the documentation's own hex so a typo cannot quietly grant the wrong thing.
 */
export const PERMISSIONS = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_ROLES: 1n << 28n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
  PIN_MESSAGES: 1n << 51n,
} as const;

export type PermissionName = keyof typeof PERMISSIONS;

/** A set of permission names as the decimal string the API serialises. */
export function permissions(names: readonly PermissionName[]): string {
  return names.reduce((bits, name) => bits | PERMISSIONS[name], 0n).toString();
}

/** Whether a permission integer (as the API gives it) holds all of `names`. */
export function hasPermissions(bits: string | bigint, names: readonly PermissionName[]): boolean {
  const value = typeof bits === 'bigint' ? bits : BigInt(bits);
  return names.every((name) => (value & PERMISSIONS[name]) === PERMISSIONS[name]);
}

/* ------------------------------------------------------------------ *
 * The people
 * ------------------------------------------------------------------ */

export interface RoleSpec {
  name: string;
  /** The palette, as the accent green, the muted grey, or nothing at all. */
  colour: number | null;
  /** Whether the role sits on its own line in the member list. */
  hoist?: boolean;
  /** Whether somebody can type `@Playtester` and have it resolve. */
  mentionable?: boolean;
  permissions: readonly PermissionName[];
  why: string;
}

export const ROLES: readonly RoleSpec[] = [
  {
    name: 'Keeper',
    colour: 0x4caf7d,
    hoist: true,
    mentionable: true,
    permissions: [
      'VIEW_AUDIT_LOG',
      'MANAGE_MESSAGES',
      'KICK_MEMBERS',
      'BAN_MEMBERS',
      'MODERATE_MEMBERS',
      'MANAGE_THREADS',
      'PIN_MESSAGES',
      'MENTION_EVERYONE',
    ],
    why: 'the person who runs the place: moderation, nothing structural, and no administrator',
  },
  {
    name: 'Playtester',
    colour: 0x7c868f,
    hoist: false,
    mentionable: true,
    permissions: [],
    why: 'a key to one channel rather than a set of powers',
  },
  {
    name: 'Release Notes',
    colour: null,
    hoist: false,
    mentionable: true,
    permissions: [],
    why: 'opt in to being pinged when a version ships, and to nothing else',
  },
];

/**
 * What `@everyone` may do in a channel nobody is denied.
 *
 * Written out rather than left to Discord's default, because the default grants
 * almost everything and the interesting decisions are the ones it does not make:
 * `MENTION_EVERYONE` is *absent*, so the @everyone ping in this server is a
 * person's and not a stranger's.
 */
export const EVERYONE: readonly PermissionName[] = [
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'SEND_MESSAGES_IN_THREADS',
  'CREATE_PUBLIC_THREADS',
  'READ_MESSAGE_HISTORY',
  'ADD_REACTIONS',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'USE_EXTERNAL_EMOJIS',
  'USE_APPLICATION_COMMANDS',
  'CHANGE_NICKNAME',
  'CREATE_INSTANT_INVITE',
  'CONNECT',
  'SPEAK',
  'STREAM',
  'USE_VAD',
];

/* ------------------------------------------------------------------ *
 * What the bot posts
 * ------------------------------------------------------------------ */

const SITE = 'https://sundayeleven.pages.dev/';

export const WELCOME_TEXT = [
  '**Sunday Eleven 27** — Sunday League football management',
  '',
  'Pick a side from the local game, pick a team from the pub, and take them to the whistle. It runs offline, and every career stays on your own machine.',
  '',
  `The game: <${SITE}>`,
  '',
  '**Where to go**',
  '• `#announcements` — a ping when a version ships',
  '• `#ask-xiai` — ask about the game; the answers are public so the next person can find them',
  '• `#general` — anything, mostly the football',
  '• `#touchline` — the voice channel, for playing or watching an afternoon together',
  '• `#career-stories` — one post per save',
  '• `#known-issues` — worth a look before reporting anything; it may already be known',
  '• `#bug-reports` — something broke, with the template filled in',
  '• `#ideas` — something could be better',
  '• `#playtesting` — early builds, if you ask to be a playtester',
  '',
  'Read `#rules` and you are done. There is nothing else to agree to.',
].join('\n');

export const RULES_TEXT = [
  '**The rules**',
  '',
  '1. Be decent. Trash talk about somebody\'s back four is welcome; trash talk about them is not.',
  '2. Keep it to football and this game. Nobody is here for the rest of it.',
  '3. No spam, no invite links to other servers, no advertising.',
  '4. Bug reports and ideas have channels. A bug reported in `#general` is a bug nobody will find again.',
  '5. Nothing illegal, nothing hateful, and nothing that would make a Sunday league committee wince.',
  '',
  'That is all of them. Breaking them gets a warning, then a timeout, then the door — in that order, unless you arrived to do damage.',
].join('\n');

export const BUG_REPORT_TEXT = [
  '**Reporting a bug**',
  '',
  'Copy this into a new message and fill it in. Two minutes of writing saves an hour of guessing:',
  '',
  '```',
  'What I did:      the screen, and the buttons I pressed, in order',
  'What I expected: what should have happened',
  'What happened:   what actually happened, word for word if it is on screen',
  'How often:       always / sometimes / happened once',
  'Version:         the number on the menu screen, e.g. 0.10.2',
  'Save:            kept going from this save, or a fresh career',
  '```',
  '',
  'A screenshot helps; a save file exported from the game helps more, because it is the whole state of the world in one file. If a career will not load at all, say so first — that one gets looked at before anything else.',
].join('\n');

export const ASK_TEXT = [
  '**Asking XIAI**',
  '',
  'XIAI answers questions about the game from the project\'s own documentation — the season, the cups,',
  'promotion and relegation, where a career is saved, what runs on a phone, a desktop and in a browser, and',
  'what is not built yet.',
  '',
  'Use the command and type the question:',
  '',
  '`/ask question: how do promotion and relegation work`',
  '',
  '**Answers are public on purpose.** The next person with the same question should be able to find it, and',
  'a wrong answer should be correctable by a person in front of everybody. XIAI does not invent mechanics: when',
  'it does not know, it says so, and that is what `#general` is for.',
].join('\n');

export const KNOWN_ISSUES_TEXT = [
  '**Known issues**',
  '',
  'What is already broken and already being fixed. If it is on this list it has been seen — reporting it again',
  'does not make it faster, and a report that repeats one of these buries the ones that are new.',
  '',
  '*(The list is kept by hand, in this post. It is empty on the day the server was set up.)*',
  '',
  'Anything that is **not** here belongs in `#bug-reports`, with the template. A career that will not load',
  'goes to the front of the queue whatever else is on this list.',
].join('\n');

export const PLAYTEST_TEXT = [
  '**Testing a build**',
  '',
  'Builds land here before they are public. They are not finished, and the point of you having them early is to find what is wrong while it is still cheap to fix.',
  '',
  '**What to look for**',
  '• the game refusing to start, or starting with no sound, or with a window the wrong size',
  '• a screen that will not open, or opens with nothing on it',
  '• a save that will not load — the serious one, and worth reporting immediately',
  '• anything that used to work and does not',
  '',
  '**What to say**',
  'Version, what you did, what happened, and whether you can make it happen again. If it is a save, export it and attach it.',
  '',
  'Feel free to say that a build feels worse than the last one. That is a bug report about the football, and it is welcome here.',
].join('\n');

/* ------------------------------------------------------------------ *
 * The rooms
 * ------------------------------------------------------------------ */

export type ChannelKind = 'text' | 'voice' | 'forum' | 'announcement';

/** Discord's channel types, by the names the design uses. */
export const CHANNEL_TYPES: Record<ChannelKind, number> = {
  text: 0,
  voice: 2,
  announcement: 5,
  forum: 15,
};

export interface CategorySpec {
  name: string;
  /** Where it sits, in a member list read top to bottom. */
  position: number;
  why: string;
}

export const CATEGORIES: readonly CategorySpec[] = [
  {
    name: 'WELCOME',
    position: 0,
    why: 'the three things a new arrival reads before saying anything',
  },
  {
    name: 'THE GAME',
    position: 1,
    why: 'the football: what people are playing, and what it did to them',
  },
  {
    name: 'FEEDBACK',
    position: 2,
    why: 'saying something that changes the game, in a shape that can be acted on',
  },
  {
    name: 'STAFF',
    position: 3,
    why: 'the room with the moderation log in it, which nobody else can see',
  },
];

/** A pinned post: the marker identifies it on a later run, the body is the post. */
export interface PostSpec {
  /** The first line, which is how a run recognises a post it has already made. */
  marker: string;
  body: string;
}

export interface ChannelSpec {
  name: string;
  kind: ChannelKind;
  category: string;
  topic?: string;
  /** Seconds between messages, for the channels that get busy. */
  slowmode?: number;
  /**
   * Voice channels only: how many people fit in it, where 0 is Discord's own
   * "no limit". The field exists because a voice channel is the one kind whose
   * settings Discord will not guess usefully — it opens with no limit, which is
   * fine for ten people and wrong for a hundred.
   */
  voiceLimit?: number;
  /** Deny sending to `@everyone` (the bot gives itself the permission back). */
  readOnly?: boolean;
  /** Whether `@everyone` is denied even seeing it. */
  hidden?: boolean;
  /** The roles that may see a hidden channel, besides the staff. */
  visibleTo?: readonly string[];
  /** Tags for a forum channel. */
  tags?: readonly string[];
  post?: PostSpec;
  /** Announcement channels need the server to have Community enabled. */
  needsCommunity?: boolean;
  /** The staff-only alert channel AutoMod logs to. */
  alertTarget?: boolean;
  why: string;
}

export const CHANNELS: readonly ChannelSpec[] = [
  {
    name: 'welcome',
    kind: 'text',
    category: 'WELCOME',
    topic: 'What Sunday Eleven 27 is, and where to get it',
    readOnly: true,
    post: { marker: '**Sunday Eleven 27** — Sunday League football management', body: WELCOME_TEXT },
    why: 'the pinned post that saves every new member the same question',
  },
  {
    name: 'rules',
    kind: 'text',
    category: 'WELCOME',
    topic: 'Short, and mostly about being decent to each other',
    readOnly: true,
    post: { marker: '**The rules**', body: RULES_TEXT },
    why: 'read once and then never thought about, which is the point',
  },
  {
    name: 'announcements',
    kind: 'announcement',
    category: 'WELCOME',
    topic: 'Release notes, straight from the changelog — follow this channel to get them in your own server',
    readOnly: true,
    needsCommunity: true,
    why: 'a release written twice is a release that disagrees with itself, so these come from CHANGELOG.md',
  },
  {
    name: 'general',
    kind: 'text',
    category: 'THE GAME',
    topic: 'Anything, but mostly the football',
    slowmode: 5,
    why: 'the room the server is actually for; five seconds of slow mode is enough to stop a pile-on',
  },
  {
    name: 'career-stories',
    kind: 'forum',
    category: 'THE GAME',
    topic: 'One post per save: the club, the season, and what happened in it',
    tags: ['Promotion', 'Relegation', 'Cup run', 'Disaster', 'Screenshot'],
    why: 'a forum keeps one save to one thread, where a channel turns a season into a scroll',
  },
  {
    name: 'screenshots-and-clips',
    kind: 'text',
    category: 'THE GAME',
    topic: 'Goals, badges, absurd scorelines',
    why: 'the pictures people take anyway, in a place that leaves #general readable',
  },
  {
    name: 'ask-xiai',
    kind: 'text',
    category: 'THE GAME',
    topic: 'Ask XIAI about the game — everybody can read the answer, which is the point',
    post: { marker: '**Asking XIAI**', body: ASK_TEXT },
    why: 'a question and its answer are worth keeping where the next person can find them, rather than scrolling away in #general',
  },
  {
    name: 'touchline',
    kind: 'voice',
    category: 'THE GAME',
    voiceLimit: 0,
    why: 'nothing is written down in here: it is where people play together, or watch somebody else\'s afternoon',
  },
  {
    name: 'bug-reports',
    kind: 'text',
    category: 'FEEDBACK',
    slowmode: 10,
    topic: 'What you did, what you expected, what happened instead — the pinned template is the shape',
    post: { marker: '**Reporting a bug**', body: BUG_REPORT_TEXT },
    why: 'the one channel where a bad report costs the most, so it opens with how to write a good one',
  },
  {
    name: 'known-issues',
    kind: 'text',
    category: 'FEEDBACK',
    topic: 'What is already broken and already being fixed — read this before reporting it',
    readOnly: true,
    post: { marker: '**Known issues**', body: KNOWN_ISSUES_TEXT },
    why: 'the answer to the same three bugs arriving every month, written down once',
  },
  {
    name: 'ideas',
    kind: 'text',
    category: 'FEEDBACK',
    slowmode: 10,
    topic: 'What you would change, and why it would make the game better',
    why: 'kept apart from bugs, because "this is broken" and "this could be better" want different answers',
  },
  {
    name: 'playtesting',
    kind: 'text',
    category: 'FEEDBACK',
    topic: 'Builds before they are public, and what to look for in them',
    hidden: true,
    visibleTo: ['Playtester'],
    post: { marker: '**Testing a build**', body: PLAYTEST_TEXT },
    why: 'people testing early builds need somewhere to say so that is not a public channel',
  },
  {
    name: 'mod-log',
    kind: 'text',
    category: 'STAFF',
    hidden: true,
    topic: 'AutoMod and moderation: what was blocked, and by which rule',
    alertTarget: true,
    why: 'a filter nobody can audit is a filter nobody can trust',
  },
  {
    name: 'roadmap',
    kind: 'text',
    category: 'STAFF',
    topic: 'What is being worked on, and what is not',
    hidden: true,
    why: 'so the answer to "when is X" is a link rather than a promise nobody remembers making',
  },
];

/**
 * The `@everyone` base permissions, as the API serialises them.
 *
 * `@everyone`'s own permissions are not a `RoleSpec`: Discord keeps it apart, in
 * the guild object, and it cannot be renamed or deleted — which is exactly why it
 * is worth stating here rather than leaving as whatever the server was created
 * with.
 */
export const EVERYONE_PERMISSIONS = permissions(EVERYONE);

/**
 * What the *bot* is allowed to do, which is what its invite link carries.
 *
 * The invite is the one part of this design a person has to produce by hand, and
 * it is the part that is easy to get subtly wrong: a bot invited without Manage
 * Roles configures a server except for its roles, and the mistake arrives as a
 * 403 in the middle of a run. So the list is named here, `inviteUrl` turns it
 * into the link, and a test holds the link printed in `DISCORD.md` against this
 * list — the number in the document and the number in the code cannot drift.
 */
export const BOT_PERMISSIONS: readonly PermissionName[] = [
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'EMBED_LINKS',
  'READ_MESSAGE_HISTORY',
  'MANAGE_MESSAGES',
  'PIN_MESSAGES',
  'MANAGE_CHANNELS',
  'MANAGE_ROLES',
  'MANAGE_GUILD',
  'MODERATE_MEMBERS',
  'CREATE_INSTANT_INVITE',
];

/** The scopes the invite asks for: a bot, and the commands a bot can have. */
export const BOT_SCOPES: readonly string[] = ['bot', 'applications.commands'];

/**
 * The link that puts the bot in a server with exactly those permissions.
 *
 * The client id is the *application's* id, and a bot user's id is the same
 * number — which is why `tools/discord.ts` can print this from the identity it
 * authenticates as, without anybody having to look anything up in the portal.
 */
export function inviteUrl(clientId: string): string {
  const scopes = encodeURIComponent(BOT_SCOPES.join(' '));
  return (
    'https://discord.com/api/oauth2/authorize' +
    `?client_id=${encodeURIComponent(clientId)}&scope=${scopes}&permissions=${permissions(BOT_PERMISSIONS)}`
  );
}

/**
 * The overwrites for a channel, with the roles they name already resolved.
 *
 * Two things worth knowing about the shape:
 *
 *   - a **deny for `@everyone` also denies the bot**, because the bot is in
 *     `@everyone` and channel overwrites beat guild-level permissions. So every
 *     channel the bot has to write in gives it the permission back by *role*
 *     (`botRoleId`), which is the automod-created role Discord makes for it;
 *   - a **hidden channel** is a deny of `VIEW_CHANNEL` with no allow for the
 *     roles that should see it, plus one allow per role that should.
 */
export function overwritesFor(
  channel: ChannelSpec,
  ids: { everyone: string; botRoleId?: string; roles: Map<string, string> },
): Array<{ id: string; type: 0; allow: string; deny: string }> {
  const overwrites: Array<{ id: string; type: 0; allow: string; deny: string }> = [];
  const written = channel.readOnly || channel.post !== undefined || channel.alertTarget === true;

  const deny: PermissionName[] = [];
  if (channel.readOnly) {
    deny.push('SEND_MESSAGES', 'SEND_MESSAGES_IN_THREADS', 'CREATE_PUBLIC_THREADS', 'PIN_MESSAGES');
  }
  if (channel.hidden) deny.push('VIEW_CHANNEL');
  if (deny.length > 0) {
    overwrites.push({
      id: ids.everyone,
      type: 0,
      allow: '0',
      deny: permissions(deny),
    });
  }

  if (written && ids.botRoleId) {
    overwrites.push({
      id: ids.botRoleId,
      type: 0,
      allow: permissions(['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'READ_MESSAGE_HISTORY', 'MANAGE_MESSAGES']),
      deny: '0',
    });
  }

  const allowed: PermissionName[] = ['VIEW_CHANNEL'];
  if (channel.hidden) allowed.push('SEND_MESSAGES', 'SEND_MESSAGES_IN_THREADS', 'READ_MESSAGE_HISTORY', 'ATTACH_FILES');
  for (const role of channel.visibleTo ?? []) {
    const id = ids.roles.get(role);
    if (!id) continue;
    overwrites.push({ id, type: 0, allow: permissions(allowed), deny: '0' });
  }
  // The staff can see the staff room, and can moderate in the private one.
  if (channel.hidden) {
    const keeper = ids.roles.get('Keeper');
    if (keeper) {
      overwrites.push({
        id: keeper,
        type: 0,
        allow: permissions(['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'MANAGE_MESSAGES']),
        deny: '0',
      });
    }
  }
  return overwrites;
}

/* ------------------------------------------------------------------ *
 * AutoMod
 * ------------------------------------------------------------------ */

export type PresetName = 'PROFANITY' | 'SEXUAL_CONTENT' | 'SLURS';

export interface AutoModSpec {
  name: string;
  trigger: 'KEYWORD' | 'KEYWORD_PRESET' | 'MENTION_SPAM' | 'SPAM';
  /** Discord's numbers, from its trigger-type table. */
  triggerType: number;
  presets?: readonly PresetName[];
  patterns?: readonly string[];
  mentionLimit?: number;
  /** What the person who hit it is told. Discord allows 150 characters. */
  message: string;
  why: string;
}

export const PRESET_VALUES: Record<PresetName, number> = {
  PROFANITY: 1,
  SEXUAL_CONTENT: 2,
  SLURS: 3,
};

/**
 * Three rules, chosen to be ones a football community will not resent.
 *
 * There is deliberately no profanity filter: this is a Sunday league, the
 * language is part of it, and a filter that deletes "for fuck's sake, the
 * keeper" would be the most complained-about thing on the server. What is here
 * is the small set nobody argues about — hate speech, invite spam, and one
 * person mentioning forty people at once.
 */
export const AUTOMOD: readonly AutoModSpec[] = [
  {
    name: 'Slurs and hate speech',
    trigger: 'KEYWORD_PRESET',
    triggerType: 4,
    presets: ['SLURS'],
    message: 'That is not welcome here.',
    why: 'the one category of language a Sunday league community is not here for',
  },
  {
    name: 'Mention spam',
    trigger: 'MENTION_SPAM',
    triggerType: 5,
    mentionLimit: 6,
    message: 'That is too many people to mention at once.',
    why: 'mention raids start as one message, and the block is instant',
  },
  {
    name: 'Discord invites',
    trigger: 'KEYWORD',
    triggerType: 1,
    patterns: ['discord.gg/*', 'discord.com/invite/*', 'discordapp.com/invite/*'],
    message: 'Advertising another server is not what this channel is for.',
    why: 'the advertising that arrives on its own, blocked before a person has to see it',
  },
];

/* ------------------------------------------------------------------ *
 * What a person still has to do
 * ------------------------------------------------------------------ */

/**
 * The work a bot cannot do, said plainly instead of left to be discovered.
 *
 * Every item is something only the owner of the server can do: a script can hold
 * every permission Discord offers and still not enable Community, not reorder a
 * role above its own, and not own a store listing. Naming them is the difference
 * between a tool that configured a server and a tool that claims to have.
 */
export const HANDBOOK: readonly string[] = [
  'Enable Community: Server Settings → Enable Community. It is what turns on announcement channels, the welcome screen and onboarding, and Discord keeps it for a person. Re-run this afterwards and the announcement channel appears.',
  'Drag the bot\'s role above @Playtester, @Release Notes and @Keeper. Discord will not let a bot edit roles higher than its own, so until that is done the roles are created and left alone.',
  'Set the server icon with `--icon`, or upload `public/icons/icon-512.png` by hand in Server Settings → Overview.',
  'Onboarding (the questions a new member answers) is Server Settings → Onboarding. The channels are already there to be chosen; the wording is yours.',
  'Anything store-shaped — a vanity URL, Discovery, a partner programme — is Discord\'s to grant, and needs boosts or an application.',
  'If a moderation change is refused with a 403 mentioning two-factor authentication, this server requires 2FA for moderation actions (Server Settings → Safety Setup), and only the account that owns it can turn that on.',
];

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

export interface ExistingRole {
  id: string;
  name: string;
  permissions: string;
  managed: boolean;
}

export interface ExistingChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  rate_limit_per_user?: number | null;
}

export interface GuildFeatures {
  /** Whether the server has Community enabled. */
  community: boolean;
}

export interface RolePlan {
  create: RoleSpec[];
  update: Array<{ spec: RoleSpec; existing: ExistingRole; because: string }>;
  keep: ExistingRole[];
}

export interface ChannelPlan {
  create: ChannelSpec[];
  update: Array<{ spec: ChannelSpec; existing: ExistingChannel; because: string }>;
  keep: ExistingChannel[];
  /** Channels the spec wants that Discord will refuse until Community is on. */
  blocked: ChannelSpec[];
}

export interface Plan {
  roles: RolePlan;
  channels: ChannelPlan;
  categories: { create: CategorySpec[]; existing: Array<{ spec: CategorySpec; id: string }> };
  /** The channels whose pinned posts should be posted or corrected. */
  posts: ChannelSpec[];
  automod: AutoModSpec[];
  hand: string[];
}

/** The categories' own channel type (4), which is not a `ChannelKind`. */
export const CATEGORY_TYPE = 4;

/**
 * What to do to make a real server match this one.
 *
 * The three outcomes are deliberate: **create** what is missing, **update** what
 * differs in a field the spec owns, and **keep** everything else. Nothing is
 * deleted and nothing is renamed back: if a channel in the server is not in the
 * spec, that is somebody's decision and the tool is not the place to overrule it.
 *
 * Only the fields the spec actually states are compared. A topic somebody
 * improved by hand, a slow mode somebody raised — those are differences of the
 * kind a spec should not win.
 */
export function planServer(input: {
  roles: readonly ExistingRole[];
  channels: readonly ExistingChannel[];
  features: GuildFeatures;
}): Plan {
  const byName = new Map(input.roles.map((role) => [role.name, role]));
  const rolePlan: RolePlan = { create: [], update: [], keep: [] };
  for (const spec of ROLES) {
    const existing = byName.get(spec.name);
    if (!existing) {
      rolePlan.create.push(spec);
      continue;
    }
    const wanted = permissions(spec.permissions);
    if (BigInt(existing.permissions) !== BigInt(wanted)) {
      rolePlan.update.push({
        spec,
        existing,
        because: `permissions ${existing.permissions} → ${wanted}`,
      });
      continue;
    }
    rolePlan.keep.push(existing);
  }

  const categoriesByName = new Map(
    input.channels.filter((channel) => channel.type === CATEGORY_TYPE).map((c) => [c.name, c]),
  );
  const categories = {
    create: CATEGORIES.filter((spec) => !categoriesByName.has(spec.name)),
    existing: CATEGORIES.flatMap((spec) => {
      const found = categoriesByName.get(spec.name);
      return found ? [{ spec, id: found.id }] : [];
    }),
  };

  const channelByName = new Map(
    input.channels.filter((channel) => channel.type !== CATEGORY_TYPE).map((c) => [c.name, c]),
  );
  const channelPlan: ChannelPlan = { create: [], update: [], keep: [], blocked: [] };
  for (const spec of CHANNELS) {
    if (spec.needsCommunity && !input.features.community) {
      channelPlan.blocked.push(spec);
      continue;
    }
    const existing = channelByName.get(spec.name);
    if (!existing) {
      channelPlan.create.push(spec);
      continue;
    }
    const because: string[] = [];
    if (existing.type !== CHANNEL_TYPES[spec.kind]) {
      because.push(`type ${existing.type} → ${CHANNEL_TYPES[spec.kind]}`);
    }
    if (spec.topic !== undefined && (existing.topic ?? '') !== spec.topic) because.push('topic');
    if (spec.slowmode !== undefined && (existing.rate_limit_per_user ?? 0) !== spec.slowmode) {
      because.push(`slow mode ${existing.rate_limit_per_user ?? 0}s → ${spec.slowmode}s`);
    }
    if (because.length > 0) channelPlan.update.push({ spec, existing, because: because.join(', ') });
    else channelPlan.keep.push(existing);
  }

  return {
    roles: rolePlan,
    channels: channelPlan,
    categories,
    posts: CHANNELS.filter((channel) => channel.post !== undefined),
    automod: [...AUTOMOD],
    hand: [
      ...(input.features.community ? [] : [HANDBOOK[0]!]),
      ...HANDBOOK.slice(1),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Announcing a release
 * ------------------------------------------------------------------ */

export interface Announcement {
  version: string;
  /**
   * The release's own name, as the changelog heading gives it, or nothing at all
   * when the heading has none — an announcement then carries the version alone
   * rather than inventing a name for the release.
   */
  title: string;
  body: string;
}

/**
 * A release, read out of `CHANGELOG.md`.
 *
 * The announcement is not written here, because a release described twice is two
 * descriptions that will disagree: this extracts the section the release tool
 * already wrote, in the order it was written, and hands it to Discord as text.
 * The changelog has one entry per version — `## [0.10.2] - 2026-10-09 — a sign
 * for every pub` — and everything under it until the next version heading is the
 * release.
 *
 * Discord's own limit is 2000 characters in a message, so the body is trimmed at
 * a paragraph boundary rather than mid-sentence, and a note is added saying so.
 * A release that does not fit is a release worth reading in the browser anyway.
 */
export function announcementFrom(changelog: string, version: string, limit = 1900): Announcement | null {
  // Read as one line ending. The changelog is a CRLF file as it is written on
  // this machine, and everything below thinks in `\n`: a paragraph split that
  // never fires turns a whole release into a single paragraph, which then gets
  // trimmed down to nothing at all.
  const text = changelog.replace(/\r\n?/g, '\n');
  const escaped = version.replace(/\./g, '\\.');
  const heading = new RegExp(`^## \\[${escaped}\\]([^\\n]*)$`, 'm').exec(text);
  if (!heading) return null;
  const after = text.slice(heading.index + heading[0].length);
  const next = /^## /m.exec(after.slice(1));
  const section = (next ? after.slice(0, next.index + 1) : after).trim();

  // The heading is `- 2026-10-09 — a sign for every pub`, and only the last part
  // of that is the release's *name*: the version is already in the message, so a
  // title carrying the version number again reads as noise rather than as a name.
  const detail = heading[1]!.replace(/\[?Unreleased\]?/g, ' ').trim();
  const named = /^(?:[-—–]\s*)?(?:\d{4}-\d{2}-\d{2}\s*(?:[-—–]\s*)?)?(.*)$/.exec(detail);
  const title = (named?.[1] ?? detail).trim();

  const paragraphs = section
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const kept: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    if (length + paragraph.length + 2 > limit) {
      kept.push(`…the rest of the notes are in the changelog.`);
      break;
    }
    kept.push(paragraph);
    length += paragraph.length + 2;
  }
  return { version, title, body: kept.join('\n\n') };
}
