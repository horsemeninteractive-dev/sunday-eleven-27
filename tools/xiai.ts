/**
 * XIAI, answering questions in the community server.
 *
 * `!` The other half of `tools/discord.ts`, and the same bot. That one configures
 * the server; this one sits in it and answers when somebody asks. What an answer
 * *is* belongs entirely to `src/platform/xiai.ts` — this file is the effects: a
 * gateway connection, a slash command, and one POST per question.
 *
 *     npm run xiai                      run the bot and answer /ask
 *     npm run xiai -- --register        register or refresh the command, then exit
 *     npm run xiai -- --check           connect, say who it is, disconnect
 *     npm run xiai -- --verify [url]    check a deployed endpoint, and say what is wrong with it
 *     npm run xiai -- --ask "how long is a season"
 *
 * **Slash commands, on purpose.** Reading ordinary message content needs
 * Discord's privileged *Message Content* intent — an application, a review, and
 * a permission to read every word in every channel the bot can see. A command
 * needs none of that: this bot identifies with `intents: 0`, so it genuinely
 * cannot read what anybody types outside a question addressed to it. That is a
 * property, not a limitation.
 *
 * **The same answers, from two places.** Everything about what an answer *is*
 * belongs to `src/platform/xiai.ts`, and everything about how an interaction is
 * turned into one belongs to `worker/xiaiEndpoint.ts` — which this file imports, so the
 * bot in the community server and the bot on a laptop cannot answer differently.
 * The Worker is the one that matters in the long run: with the application's
 * Interactions Endpoint URL set, Discord delivers interactions there and this
 * process stops being asked anything at all. It stays useful for the two things
 * that need the bot token — registering the commands, and configuring the server
 * — and as a way to see the bot work before anything is deployed.
 *
 * **No new dependency.** Node's own `WebSocket` is the gateway client and Node's
 * own `fetch` is the REST client, which is why this file is a few hundred lines
 * rather than a package.json change. See `STEAM.md` for what this project thinks
 * of dependencies it does not need.
 *
 * **`--ask` needs no token at all**, so the knowledge base can be tried, and
 * reviewed, without a bot running and without anything reaching Discord.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASK_COMMAND, HELP, MESSAGE_COMMAND, replyFor, TOPICS } from '@/platform/xiai';
import {
  newKeyPair,
  readDiscordSetting,
  readFingerprint,
  readPing,
  signedPing,
  signerForOneRun,
  signerFromSeed,
  type Answer,
  type Mark,
  type SignedPing,
  type Signer,
} from '@/platform/xiaiVerify';
import { answerInteraction, type Interaction } from '../worker/xiaiEndpoint';
import { credentials, ROOT, type Credentials } from './discordEnv';

const API = 'https://discord.com/api/v10';

// --- Output -----------------------------------------------------------------

// `Mark` is `src/platform/xiaiVerify.ts`'s, because the check of the deployed
// endpoint decides how its own lines read; this is only the glyphs.
const MARKS: Record<Mark, string> = { ok: '✓', warn: '!', fail: '✗', info: '·' };

function say(mark: Mark, text: string, detail?: string): void {
  process.stdout.write(`   ${MARKS[mark]} ${text}\n`);
  if (detail) process.stdout.write(`     ${detail}\n`);
}

// --- HTTP -------------------------------------------------------------------

/**
 * One request, with the two failures Discord actually produces handled here.
 *
 * The same shapes `tools/discord.ts` handles, kept local because that file runs
 * its own main() on import and cannot be borrowed from: 429 is not an error but
 * an instruction (there is a number of seconds in the body), and a 5xx is
 * Discord's bad minute rather than this tool's bad request.
 *
 * `authorized: false` is for the one call that must not carry the bot token —
 * replying to an interaction, where the token in the URL is the whole of the
 * authorisation and Discord's documentation says not to send the bot's own.
 */
async function request<T>(
  creds: Credentials,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  authorized = true,
  attempt = 0,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'SundayEleven27 (https://sundayeleven.pages.dev, 0.10.2)',
  };
  if (authorized) headers.Authorization = `Bot ${creds.token}`;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 429) {
    const limit = (await response.json().catch(() => ({}))) as { retry_after?: number };
    const wait = typeof limit.retry_after === 'number' ? limit.retry_after : 1;
    if (attempt >= 5) throw new Error(`${method} ${path} is still rate limited after 5 waits`);
    process.stdout.write(`   · rate limited by Discord; waiting ${wait.toFixed(1)}s\n`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 250));
    return request<T>(creds, method, path, body, authorized, attempt + 1);
  }

  if (response.status >= 500 && attempt < 3) {
    const wait = 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return request<T>(creds, method, path, body, authorized, attempt + 1);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`${method} ${path} → ${response.status}\n     ${detail}`);
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
}

interface ApiCommand {
  id: string;
  name: string;
}

/** The one field of the application this tool reads: where Discord delivers interactions. */
interface ApiApplication {
  interactions_endpoint_url?: string | null;
}

/**
 * An interaction, as much of one as this bot cares about.
 *
 * `token` is not the bot's token: it is a one-use ticket for this one answer,
 * which is what makes a reply possible without the bot having any other way to
 * post in a channel it has not been asked in. Everything else — what was asked
 * and what to answer — is `worker/xiaiEndpoint.ts`'s, because that is where the
 * deployed bot decides it.
 */
interface Question extends Interaction {
  id: string;
  token: string;
}

// --- Who the bot is, and where it answers -----------------------------------

/**
 * The bot's identity and the one server it answers in.
 *
 * A bot user's id **is** its application id — the same number in the Portal —
 * which is why nothing here has to ask anybody for it. The guild comes from
 * `DISCORD_GUILD` when it is set, and otherwise from the list only when there is
 * exactly one, because a bot that picks a server out of several is a bot that
 * answers in the wrong community.
 */
async function identity(creds: Credentials): Promise<{ user: ApiUser; guild: ApiGuild }> {
  const user = await request<ApiUser>(creds, 'GET', '/users/@me');
  if (creds.guild !== '') {
    return { user, guild: await request<ApiGuild>(creds, 'GET', `/guilds/${creds.guild}`) };
  }
  const guilds = await request<ApiGuild[]>(creds, 'GET', '/users/@me/guilds');
  const only = guilds[0];
  if (guilds.length !== 1 || !only) {
    throw new Error(
      `XIAI answers in one server, and it is in ${guilds.length}. Set DISCORD_GUILD in discord.env to one of: ` +
        (guilds.map((guild) => `${guild.name} (${guild.id})`).join(', ') || 'nothing — invite the bot to a server first'),
    );
  }
  return { user, guild: only };
}

/**
 * The `/ask` command.
 *
 * Discord caps a command description at 100 characters, and `HELP` is written for
 * a person rather than for the API — sliced here so that lengthening the help
 * text can never make the command unregisterable, which is a failure that would
 * otherwise only show up as a 400 at registration time.
 *
 * Neither option is required, which is what lets `/ask` on its own be a sensible
 * thing to type: with no question and no topic it answers with what it can help
 * with, which is also how somebody finds out what to ask. The topic list is
 * `TOPICS` — the knowledge base's own titles, capped by Discord at 25 choices and
 * held to it by a test.
 */
function askCommand(): Record<string, unknown> {
  return {
    name: ASK_COMMAND,
    description: HELP.slice(0, 100),
    options: [
      {
        type: 3, // STRING
        name: 'question',
        description: 'What do you want to know about the game?',
        required: false,
        max_length: 400,
      },
      {
        type: 3, // STRING
        name: 'topic',
        description: 'Or pick one of the things I know about',
        required: false,
        choices: TOPICS.map((topic) => ({ name: topic.name, value: topic.factId })),
      },
    ],
  };
}

/**
 * The entry in a message's right-click menu.
 *
 * A context-menu command may be mixed case with spaces in it, and it is the only
 * wording a person sees before clicking — so it says what it does. What it does
 * *not* need is any vocabulary of its own: a message command receives the text
 * of the message it was pointed at, which is the one and only way this bot is
 * ever given words it did not ask for, and it still needs no intent to read them.
 * A command of this type carries a name and a type and nothing else.
 */
function messageCommand(): Record<string, unknown> {
  return { name: MESSAGE_COMMAND, type: 3 }; // 3 = MESSAGE
}

/**
 * Register the bot's commands in the guild.
 *
 * A **guild** command rather than a global one: guild commands appear in the
 * server the moment they are registered, where a global command can take an hour
 * to show up — and this bot lives in one server anyway. `PUT` to the collection
 * replaces the application's commands for that guild, which is exactly the
 * idempotent behaviour wanted and needs no DELETE anywhere — and is also why both
 * commands are sent together: a list of one would quietly unregister the other.
 */
async function registerCommands(creds: Credentials, applicationId: string, guildId: string): Promise<string> {
  const commands = await request<ApiCommand[]>(
    creds,
    'PUT',
    `/applications/${applicationId}/guilds/${guildId}/commands`,
    [askCommand(), messageCommand()],
  );
  return commands.map((command) => (command.name === ASK_COMMAND ? `/${command.name}` : command.name)).join(', ') || 'nothing';
}

// --- The answer -------------------------------------------------------------
//
// There is no answer-building code here, and there deliberately is not: what a
// question is about, what an answer says and how an interaction is turned into
// one all live where the tests are — `src/platform/xiai.ts` for the knowledge,
// `worker/xiaiEndpoint.ts` for the interaction. This file used to hold a copy of the
// reply text, which is exactly how the same question ends up answered two
// different ways in two places.

// --- The gateway ------------------------------------------------------------

interface Frame {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

/**
 * A gateway connection, with the small amount of life-support Discord's
 * protocol asks for.
 *
 * Three things are load-bearing and each of them is a way a naive client
 * quietly stops working:
 *
 *   - **heartbeats.** `op: 1` every `heartbeat_interval` with the last sequence
 *     number, acknowledged by `op: 11`. The first one is delayed by a random
 *     fraction of the interval, which is what Discord asks for so that every
 *     client does not beat in unison;
 *   - **a heartbeat that is not acknowledged means the connection is already
 *     gone** — a socket can stay open and deliver nothing, so the client closes
 *     it and starts again rather than waiting to find out;
 *   - **reconnect with a widening delay**, except for the close codes that mean
 *     "this will never work": 4004 is a refused token and the 4010s are a bad
 *     shard or intent, and looping on those is a log nobody can read.
 */
class Xiai {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence: number | null = null;
  private acknowledged = true;
  private delay = 1000;
  private stopped = false;
  private ready: ((user: ApiUser) => void) | null = null;
  private fatal: ((message: string) => void) | null = null;

  constructor(private readonly creds: Credentials) {}

  /** Opens the socket and resolves with the bot's own user once Discord says READY. */
  start(): Promise<ApiUser> {
    return new Promise<ApiUser>((resolve, reject) => {
      this.ready = resolve;
      this.fatal = reject;
      void this.open();
    });
  }

  /**
   * Close tidily. The heartbeat timers are what keep the process alive, so
   * clearing them and closing the socket is all that has to happen for the run
   * to end on its own — there is deliberately no `process.exit()` here or
   * anywhere below, because on Windows it aborts inside libuv when a `fetch`
   * connection is still pooled, and reports 127.
   */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, 'shutting down');
  }

  private async open(): Promise<void> {
    // `/gateway/bot` rather than the public URL: it is the endpoint Discord's
    // own documentation gives a client, and it is how a shard count would arrive
    // if this ever needed more than one.
    const info = await request<{ url: string }>(this.creds, 'GET', '/gateway/bot');
    const socket = new WebSocket(`${info.url}/?v=10&encoding=json`);
    this.socket = socket;
    socket.addEventListener('message', (event) => this.frame(String(event.data)));
    socket.addEventListener('close', (event) => this.closed(event.code, event.reason));
    socket.addEventListener('error', () => say('warn', 'the gateway socket reported an error'));
  }

  private frame(raw: string): void {
    // A frame this client cannot read is not a reason for the bot to die: it is
    // one discord frame lost, and Discord will send plenty more. A long-running
    // process that throws out of an event listener stops being long-running.
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      say('warn', 'a gateway frame could not be read', raw.slice(0, 120));
      return;
    }
    if (typeof frame.s === 'number') this.sequence = frame.s;
    switch (frame.op) {
      case 10:
        this.hello(frame.d as { heartbeat_interval: number });
        return;
      case 11:
        this.acknowledged = true;
        return;
      case 1:
        this.send({ op: 1, d: this.sequence });
        return;
      case 7:
        this.restart('Discord asked for a reconnect');
        return;
      case 9:
        this.restart('the session was invalidated');
        return;
      case 0:
        this.dispatch(frame);
        return;
      default:
        return;
    }
  }

  private hello(info: { heartbeat_interval: number }): void {
    this.identify();
    const interval = info.heartbeat_interval;
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null;
      this.heartbeat = setInterval(() => this.pulse(), interval);
      this.pulse();
    }, Math.floor(interval * Math.random()));
  }

  private pulse(): void {
    if (!this.acknowledged) {
      this.restart('a heartbeat went unanswered');
      return;
    }
    this.acknowledged = false;
    this.send({ op: 1, d: this.sequence });
  }

  private identify(): void {
    this.send({
      op: 2,
      d: {
        token: this.creds.token,
        // **Zero intents, deliberately.** Answering an interaction needs no
        // gateway intents at all, so this bot never requests the privileged
        // Message Content intent and cannot read what anybody types outside a
        // command addressed to it. Nothing here needs changing to keep that
        // true; adding an intent would be the change.
        intents: 0,
        properties: { os: 'linux', browser: 'se27', device: 'se27' },
      },
    });
  }

  private dispatch(frame: Frame): void {
    if (frame.t === 'READY') {
      const user = (frame.d as { user: ApiUser }).user;
      this.delay = 1000;
      say('ok', `XIAI is listening as ${user.username} (${user.id})`);
      this.ready?.(user);
      this.ready = null;
      return;
    }
    if (frame.t === 'INTERACTION_CREATE') {
      void this.interaction(frame.d as Question);
      return;
    }
  }

  /**
   * One question, one POST.
   *
   * Discord gives an interaction three seconds, so nothing slow may happen
   * between the event arriving and the callback: the matcher is synchronous and
   * the answer is assembled before the request is even opened. A failure to
   * answer is logged and swallowed — one lost answer must not end the run, since
   * the alternative is a bot that stops listening because somebody asked it
   * something at a bad moment.
   *
   * What to answer is not decided here. `answerInteraction` is the deployed
   * bot's own decision, imported rather than re-implemented, so this process and
   * the endpoint in the cloud answer a question identically — including the vote
   * buttons and the right-click menu, which this path never sees because they are
   * new.
   */
  private async interaction(interaction: Question): Promise<void> {
    const outcome = answerInteraction(interaction);
    if (outcome.status !== 200) {
      say('warn', outcome.line, 'nothing is sent: this bot does not answer that');
      return;
    }
    // "did not know" is an outcome and not a failure, and it reads as a warning
    // because that is the line worth noticing in a scroll of answers.
    say(outcome.line.startsWith('did not know') ? 'warn' : 'ok', outcome.line);
    try {
      await request(
        this.creds,
        'POST',
        `/interactions/${interaction.id}/${interaction.token}/callback`,
        outcome.body,
        false,
      );
    } catch (error) {
      say('fail', 'the answer did not reach Discord', error instanceof Error ? error.message : String(error));
    }
  }

  private closed(code: number, reason: string): void {
    this.clearTimers();
    if (this.stopped) return;
    if (code === 4004 || (code >= 4010 && code <= 4014)) {
      const message =
        `Discord closed the connection (${code}${reason ? ` ${reason}` : ''}). ` +
        (code === 4004
          ? 'That code means the token was refused: reset it in the Developer Portal and paste the new one into discord.env.'
          : 'That code means the shard or the intents were refused, which this client does not ask for — check the application in the Portal.');
      this.fatal?.(message);
      this.fatal = null;
      // The close codes that end the run are a failure even when nobody is
      // waiting on `start()` any more — a process that gives up and exits 0 is a
      // process a script believes.
      process.exitCode = 1;
      return;
    }
    this.restart(`the connection closed (${code}${reason ? ` ${reason}` : ''})`);
  }

  private restart(because: string): void {
    if (this.stopped) return;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.sequence = null;
    this.acknowledged = true;
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(4000, 'reconnecting');
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, 60_000);
    say('warn', because, `reconnecting in ${(delay / 1000).toFixed(1)}s`);
    this.delayTimer = setTimeout(() => void this.open(), delay);
  }

  private send(frame: { op: number; d: unknown }): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.delayTimer) clearTimeout(this.delayTimer);
    this.heartbeat = null;
    this.delayTimer = null;
  }
}

// --- Checking a deployed endpoint -------------------------------------------
//
// What an answer from the deployed bot *means* belongs entirely to
// `src/platform/xiaiVerify.ts`, and this is the effects: two requests, a key, and
// a report. The split is worth more here than anywhere else in this file, because
// the part that can be wrong quietly is reading a refusal as success when the
// refusal is the right one — and that half is tested with no network.

/** Where the key this check signs with is written down: beside the Worker's local values, and ignored by git. */
const KEY_FILE = join(ROOT, 'worker', '.verify-key');

/**
 * How long a single request to the endpoint may take before it is a result.
 *
 * `fetch` will wait for ever: an address that accepts a connection and then says
 * nothing — a Worker being redeployed, a proxy holding the socket — is a hang
 * rather than an error, and a check that hangs is not a check. Generous against
 * Discord's own three seconds, because this is measuring the endpoint and not
 * being held to it.
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * The token, or `null`.
 *
 * The check works with a URL alone, so a missing token is not a failure here. A
 * *reason* is still a reason, though: `discordEnv.ts` refuses outright when the
 * token has ever been committed, and that refusal must not arrive as "no token".
 */
function tryCredentials(): Credentials | null {
  try {
    return credentials();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say('warn', 'the bot token was not used', message.split('\n')[0]);
    return null;
  }
}

/** The key to sign with: the one written down, or a pair made up for this run. */
function checkKey(): { signer: Signer; held: boolean } {
  const written = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8') : '';
  let seed = '';
  if (written !== '') {
    try {
      seed = String((JSON.parse(written) as { seed?: unknown }).seed ?? '');
    } catch {
      say(
        'warn',
        'worker/.verify-key could not be read',
        'run `npm run xiai -- --new-key` to write a new one — this run signs with a key made up for it',
      );
    }
  }
  const held = signerFromSeed(seed);
  return held ? { signer: held, held: true } : { signer: signerForOneRun(), held: false };
}

/**
 * One request to an address that is not Discord's, read the way the check needs
 * it: the status, the body and the time it took — or the fact that nothing came
 * back, which is a result too.
 *
 * Deliberately not `request()` above: that one is Discord's REST API, with the
 * base URL, the auth and the rate-limit handling that belong to it. This is a
 * fetch against a Worker, and its failures are the check's own subject rather
 * than an exception to be thrown.
 */
async function probe(url: string, signed?: SignedPing): Promise<Answer> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: signed ? 'POST' : 'GET',
      headers: signed?.headers,
      body: signed?.body,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      status: response.status,
      body: await response.text(),
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      ms: performance.now() - started,
    };
  } catch (error) {
    return {
      status: null,
      body: '',
      contentType: '',
      ms: null,
      failure: why(error),
    };
  }
}

/**
 * Why a request did not happen, in words somebody can act on.
 *
 * `fetch` reports every transport failure as the same `TypeError: fetch failed`
 * and puts the real reason — a name that does not resolve, a port with nothing on
 * it, a certificate that is not valid — on `cause`. Printing the wrapper alone
 * would make the most common result of a mistyped address the least useful line
 * in the report.
 */
function why(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === 'TimeoutError') return `nothing came back within ${PROBE_TIMEOUT_MS / 1000} s`;
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : '';
  return detail !== '' && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message;
}

/**
 * `--verify`: the deployed endpoint, checked from here, and what is wrong with it.
 *
 * The address is the argument when there is one and otherwise the application's
 * own Interactions Endpoint URL, read from Discord — which is the one worth being
 * able to check without remembering it, and is also the check for the mistake
 * this has been waiting to catch: an endpoint deployed and answering that Discord
 * has never been told about, in which case the bot in the server is still the
 * process on somebody's laptop.
 */
async function verifyEndpoint(given: string | undefined): Promise<void> {
  const creds = tryCredentials();
  const saved: string | undefined = creds
    ? ((await request<ApiApplication>(creds, 'GET', '/applications/@me')).interactions_endpoint_url ?? '')
    : undefined;

  const url = given ?? saved ?? '';
  if (url === '') {
    throw new Error(
      'nothing to check: no address was given and the application has no Interactions Endpoint URL either. ' +
        'Pass one (`npm run xiai -- --verify https://…`) or set it in the Portal — step 3 in DISCORD.md.',
    );
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`that is not an http(s) address: ${url}`);

  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(url);
  say('info', `checking ${url}`, local ? 'an endpoint on this machine' : 'a deployed endpoint');

  // A GET first, because it is the one request the endpoint answers without a
  // signature — and "nothing is deployed here" and "something else is deployed
  // here" are different problems with different fixes. Nothing is signed against
  // an address that is not the bot at all.
  const fingerprint = readFingerprint(await probe(url));
  say(fingerprint.mark, fingerprint.text, fingerprint.detail);

  let ok = fingerprint.mark !== 'fail';
  if (ok) {
    const { signer, held } = checkKey();
    const check = readPing(await probe(url, signedPing(signer)), { local, held, publicKey: signer.publicKey });
    for (const verdict of check.verdicts) say(verdict.mark, verdict.text, verdict.detail);
    ok = check.ok;
    if (!held) {
      say(
        'info',
        'this run signed with a key made up for it',
        'which is all a deployed endpoint needs: it should refuse it. `npm run xiai -- --new-key` writes down a key a local endpoint can be configured to accept, and then a PONG is a real one',
      );
    }
  }

  const setting = readDiscordSetting(saved, url);
  say(setting.mark, setting.text, setting.detail);

  if (!ok) process.exitCode = 1;
}

/** `--new-key`: the key this check signs with, written down so that a signature of its can be accepted. */
function newKey(): void {
  const existed = existsSync(KEY_FILE);
  const pair = newKeyPair();
  writeFileSync(
    KEY_FILE,
    `${JSON.stringify(
      {
        why:
          'The key `npm run xiai -- --verify` signs with, so that an endpoint can answer it with a PONG. ' +
          'For a local run: DISCORD_PUBLIC_KEY=<publicKey> in worker/.dev.vars, then `npm run xiai:dev`. ' +
          'Never the live Worker’s secret — that one is Discord’s public key, and replacing it would stop the bot answering anything.',
        publicKey: pair.publicKey,
        seed: pair.seed,
      },
      null,
      2,
    )}\n`,
  );
  say('ok', `${existed ? 'replaced' : 'wrote'} the check key in worker/.verify-key`, 'it is ignored by git');
  say('info', `its public half is ${pair.publicKey}`);
  say(
    'info',
    'for a local endpoint, this is the only place it belongs:',
    'worker/.dev.vars → DISCORD_PUBLIC_KEY=<that key> — then `npm run xiai:dev`',
  );
  say(
    'warn',
    'that key is for this machine, not for the deployment',
    'the live Worker verifies Discord’s signatures against Discord’s public key: replacing it with this one would stop the bot answering anything at all',
  );
  say('info', 'and then check it:', 'npm run xiai -- --verify http://127.0.0.1:8787   (the port `xiai:dev` prints)');
}

// --- The commands -----------------------------------------------------------

const USAGE = [
  '   usage: npm run xiai                       run the bot: it answers /ask while it is running',
  '          npm run xiai:deploy               deploy the always-on endpoint (worker/wrangler.toml)',
  '          npm run xiai:dev                  run that endpoint locally',
  '          npm run xiai:logs                 watch what the live endpoint answers',
  '          npm run xiai:verify               check the deployed endpoint from here',
  '          npm run xiai -- --register         register or refresh /ask, then exit',
  '          npm run xiai -- --check            connect to Discord, say who it is, disconnect',
  '          npm run xiai -- --verify [url]     check an endpoint: the one given, or the one Discord is pointed at',
  '          npm run xiai -- --new-key          write the key `--verify` signs with, for local runs',
  '          npm run xiai -- --ask "question"   answer one question here, with no bot and no token',
].join('\n');

/** `--ask`, which touches nothing: no token, no network, no Discord. */
function answerHere(question: string): void {
  const reply = replyFor(question);
  process.stdout.write(`\n   Q  ${question}\n\n`);
  for (const line of reply.content.split('\n')) process.stdout.write(`   ${line}\n`);
  process.stdout.write('\n');
  say(
    reply.fact ? 'info' : 'warn',
    reply.fact ? `answered from ${reply.fact}` : 'no answer: this is exactly what the bot says in Discord',
  );
  process.stdout.write('\n');
}

/** `--register`: the commands on their own, for when the bot is already running elsewhere. */
async function registerOnly(): Promise<void> {
  const creds = credentials();
  const { user, guild } = await identity(creds);
  say('ok', `${user.username} (${user.id}) in ${guild.name} (${guild.id})`);
  const command = await registerCommands(creds, user.id, guild.id);
  say('ok', `registered ${command} in that server`, 'guild commands appear at once, which is why it is not global');
}

/**
 * `--check`: the whole connection, proved and then closed.
 *
 * This is the mode that answers the only question worth asking before trusting a
 * bot: does the token work, and does Discord accept this client on the gateway?
 * It waits for READY, which is the point at which every handshake has succeeded,
 * and then closes — no keyboard, no timers left behind.
 */
async function check(): Promise<void> {
  const creds = credentials();
  const { user, guild } = await identity(creds);
  say('ok', `${user.username} (${user.id}) in ${guild.name} (${guild.id})`);
  const commands = await request<ApiCommand[]>(creds, 'GET', `/applications/${user.id}/guilds/${guild.id}/commands`);
  say(
    'info',
    `registered commands: ${commands.map((command) => `/${command.name}`).join(', ') || 'none'}`,
    commands.length === 0 ? 'run `npm run xiai -- --register` to add /ask' : 'answer them by running `npm run xiai`',
  );
  const bot = new Xiai(creds);
  await bot.start();
  say('ok', 'the gateway accepted the bot and said READY');
  bot.stop();
}

/** The ordinary run: register if needed, connect, and stay up answering. */
async function run(): Promise<void> {
  const creds = credentials();
  const { user, guild } = await identity(creds);
  say('ok', `${user.username} (${user.id}) in ${guild.name} (${guild.id})`);
  const command = await registerCommands(creds, user.id, guild.id);
  say('ok', `registered ${command} in that server`, 'guild commands appear at once, which is why it is not global');

  const bot = new Xiai(creds);
  await bot.start();
  say('info', 'listening for /ask', 'Ctrl-C to stop — nothing else the bot can see, because it asks for no intents');

  const stop = (): void => {
    say('info', 'stopping');
    bot.stop();
    process.exitCode = 0;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// --- Entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`\n${USAGE}\n\n`);
    return;
  }

  const askAt = argv.indexOf('--ask');
  if (askAt >= 0) {
    const question = argv[askAt + 1];
    if (!question || question.startsWith('--')) {
      process.stdout.write(`\n   --ask needs a question.\n\n${USAGE}\n\n`);
      process.exitCode = 1;
      return;
    }
    answerHere(question);
    return;
  }

  if (argv.includes('--new-key')) return newKey();

  const verifyAt = argv.indexOf('--verify');
  if (verifyAt >= 0) {
    const next = argv[verifyAt + 1];
    return verifyEndpoint(next && !next.startsWith('--') ? next : undefined);
  }

  if (argv.includes('--check')) return check();
  if (argv.includes('--register')) return registerOnly();
  const unknown = argv.find((argument) => argument.startsWith('--'));
  if (unknown) throw new Error(`unexpected argument: ${unknown}`);
  return run();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`\n   ✗ ${message}\n\n`);
  if (/discord\.env|token/i.test(message)) process.stdout.write('   The setup steps are in DISCORD.md.\n\n');
  else process.stdout.write(`${USAGE}\n\n`);
  // `process.exitCode` and not `process.exit()`: see the note on `stop()`.
  process.exitCode = 1;
});
