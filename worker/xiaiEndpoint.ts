/**
 * XIAI in the cloud: the same bot, reached over HTTP instead of a socket.
 *
 * The command-line bot in `tools/xiai.ts` holds a gateway connection open, which
 * is why it answers only while somebody's machine is on. This is the same bot
 * with Discord doing the dialling: with an **Interactions Endpoint URL** set on
 * the application, Discord POSTs every interaction here, and a Worker is only
 * ever asked when there is something to answer. Nothing is left running; nothing
 * has to be running.
 *
 * Three things make it work, and each of them is a Discord rule rather than a
 * preference:
 *
 *   - **the signature is verified first, and everything else comes after.** The
 *     request carries `X-Signature-Ed25519` and `X-Signature-Timestamp` headers,
 *     and the signature is over the timestamp concatenated with the **raw body** —
 *     so the body is read as bytes and parsed only once the signature has been
 *     checked against the application's public key. Anything that fails is a 401,
 *     which is also what Discord's own periodic bad-signature probe is looking
 *     for. A request Discord cannot prove it sent is never parsed, never logged
 *     and never answered;
 *   - **the timestamp is checked for freshness.** The signature covers it, so an
 *     old request is a valid signature for a request that has already been
 *     answered once, and a five-minute window is what stops one being replayed;
 *   - **the endpoint says PONG.** Discord sends a PING before it will save the
 *     URL, and refuses the URL if the answer is not `{"type": 1}`.
 *
 * **There is no bot token here, and that is the point.** Verifying a signature
 * needs the application's *public* key, which is not a secret, and answering an
 * interaction needs the one-use token Discord puts *in* the interaction. So the
 * always-on bot holds no credential at all: the bot token stays on the machine
 * that registers commands and configures the server, and this file could be
 * printed in a channel without anything being lost. `XIAI_FEEDBACK_WEBHOOK` is
 * the one optional secret, and the only thing it can do is post a line to one
 * channel.
 *
 * The half that decides *what* an answer is has not moved and has not been
 * copied: `src/platform/xiai.ts` is imported, its tests are the same tests, and
 * `npm run xiai -- --ask "…"` answers exactly what this will.
 */

import {
  ASK_COMMAND,
  MESSAGE_COMMAND,
  answerText,
  factById,
  parseVote,
  replyFor,
  voteCustomId,
  type Vote,
} from '../src/platform/xiai';

export interface Env {
  /**
   * The application's public key, from the Developer Portal's General
   * Information page. Sixty-four hex characters. **Not a secret**: it is the
   * verification half of the pair, and publishing it tells nobody anything.
   */
  DISCORD_PUBLIC_KEY?: string;
  /**
   * A channel webhook the votes land in — `#mod-log` is the intended home. Not
   * a bot token and not an incoming message: this is the one thing the deployed
   * bot can *say*, and without it a vote is still acknowledged but goes no
   * further. Unset is a supported state.
   */
  XIAI_FEEDBACK_WEBHOOK?: string;
}

/** Discord's own limit on an interaction payload. Nothing legitimate is near it. */
const MAX_BODY_BYTES = 64 * 1024;

/** How old a request may be before it is treated as a replay. */
const FRESHNESS_MS = 5 * 60 * 1000;

/** What the bot says when the thing it was pointed at has no words in it. */
export const NO_WORDS =
  'There is nothing in that message for me to answer from — point me at one with words in it, or ask me directly.';

// --- The signature ----------------------------------------------------------

/* * Hex to bytes, or `null` when it is not hex at all.
 *
 * An `ArrayBuffer` and not a `Uint8Array`, because that is what Web Crypto takes
 * without an argument with the type system: a view is a `BufferSource` only when
 * its backing store is an `ArrayBuffer` rather than a `SharedArrayBuffer`, and
 * nothing here is ever built over shared memory.
 */
function unhex(text: string): ArrayBuffer | null {
  if (text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(text.length / 2));
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

/** Two runs of bytes, one after the other, as the thing Web Crypto signs. */
function joined(parts: readonly Uint8Array[]): ArrayBuffer {
  const buffer = new ArrayBuffer(parts.reduce((total, part) => total + part.byteLength, 0));
  const view = new Uint8Array(buffer);
  let at = 0;
  for (const part of parts) {
    view.set(part, at);
    at += part.byteLength;
  }
  return buffer;
}

export type Verdict = 'ok' | 'stale' | 'bad';

/**
 * Whether Discord sent this, and sent it just now.
 *
 * `stale` and `bad` are both answered with a 401 — Discord is not owed an
 * explanation — but they are told apart in the log, because the two failures
 * mean different things to whoever is looking: a stale one is a replay or a
 * clock that has drifted, and a bad one is a wrong public key.
 */
export async function verifyRequest(
  headers: Headers,
  body: Uint8Array,
  publicKeyHex: string,
  now: number,
): Promise<Verdict> {
  const signatureHex = headers.get('X-Signature-Ed25519');
  const timestamp = headers.get('X-Signature-Timestamp');
  if (!signatureHex || !timestamp || !/^\d+$/.test(timestamp)) return 'bad';
  if (Math.abs(now - Number(timestamp) * 1000) > FRESHNESS_MS) return 'stale';

  const key = unhex(publicKeyHex);
  const signature = unhex(signatureHex);
  if (!key || key.byteLength !== 32 || !signature || signature.byteLength !== 64) return 'bad';

  try {
    const imported = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    // What Discord signs is the timestamp immediately followed by the body, with
    // nothing between them — which is why the body is read as bytes and not as
    // text: a re-encode is a different string and a different signature.
    const message = joined([new TextEncoder().encode(timestamp), body]);
    const genuine = await crypto.subtle.verify({ name: 'Ed25519' }, imported, signature, message);
    return genuine ? 'ok' : 'bad';
  } catch (error) {
    // A runtime that cannot do Ed25519 at all lands here rather than throwing
    // out of the handler: it is a 401 and a line in the log, not a crash loop.
    console.error('the signature could not be checked', error);
    return 'bad';
  }
}

// --- What Discord sends -----------------------------------------------------

interface InteractionOption {
  name: string;
  value?: unknown;
}

/**
 * An interaction, as much of one as this bot cares about.
 *
 * A component click carries the message it was clicked on and the person who
 * clicked it, which is how a vote can be reported without anything having been
 * stored anywhere.
 */
export interface Interaction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id: string; username: string } };
  user?: { id: string; username: string };
  data?: {
    name?: string;
    custom_id?: string;
    target_id?: string;
    options?: InteractionOption[];
    resolved?: { messages?: Record<string, { content?: string } | undefined> };
    message?: { id?: string };
  };
}

// --- The answer -------------------------------------------------------------

/** An answer, with the buttons that let somebody say whether it was right. */
function answerMessage(content: string, factId: string | null): Record<string, unknown> {
  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      content,
      // Nothing in an answer is allowed to ping anybody: a fact that happens to
      // name a person must not become a notification for that person.
      allowed_mentions: { parse: [] },
      components: factId ? voteRow(factId) : undefined,
    },
  };
}

/**
 * The two buttons under an answer, and why they are there.
 *
 * Public answers are the whole reason this bot can be trusted by anybody but its
 * owner: the next person with the same question finds the answer, and a wrong
 * one can be corrected in front of everyone. The buttons are what make "wrong"
 * something that can be counted rather than argued about — and the answer is
 * still public either way, so nothing depends on somebody pressing one.
 */
function voteRow(factId: string): unknown[] {
  return [
    {
      type: 1, // ACTION_ROW
      components: [
        { type: 2, style: 2, label: 'That answers it', emoji: { name: '👍' }, custom_id: voteCustomId('up', factId) },
        { type: 2, style: 2, label: 'That is wrong', emoji: { name: '👎' }, custom_id: voteCustomId('down', factId) },
      ],
    },
  ];
}

/**
 * What to send back, and what to write down.
 *
 * Everything decided here is decided synchronously — Discord gives an
 * interaction three seconds, and the matcher takes microseconds — and the two
 * side effects are handed back as values rather than performed, so a test can
 * assert on them without a network or a socket.
 */
export interface Outcome {
  /** The status Discord is given. */
  status: number;
  /** The body, already a plain object. */
  body: unknown;
  /** One line for `wrangler tail`. */
  line: string;
  /** A vote to put in the owner's channel, when there is a channel to put it in. */
  report?: string;
}

const REFUSED = (line: string): Outcome => ({ status: 400, body: { error: 'that is not an interaction I answer' }, line });

/**
 * One interaction, decided.
 *
 * The three kinds that can arrive are the ones this bot is registered for —
 * `/ask`, the entry in a message's right-click menu, and a click on a vote
 * button — and anything else is refused rather than guessed at. A refusal is a
 * log line here and nothing more: Discord shows nobody a 400.
 */
export function answerInteraction(interaction: Interaction): Outcome {
  if (interaction.type === 1) {
    return { status: 200, body: { type: 1 }, line: 'the endpoint was checked: PING answered with PONG' };
  }

  if (interaction.type === 2) {
    const name = interaction.data?.name ?? '';
    if (name === ASK_COMMAND) return answerAsk(interaction);
    if (name === MESSAGE_COMMAND) return answerMessageCommand(interaction);
    return REFUSED(`a command this bot does not know: ${name}`);
  }

  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id ?? '';
    const vote = parseVote(customId);
    if (!vote) return REFUSED(`a button this bot does not know: ${customId}`);
    return answerVote(interaction, vote.vote, vote.factId);
  }

  return REFUSED(`an interaction of type ${interaction.type}`);
}

/** `/ask`, with a question, a topic from the picker, or neither. */
function answerAsk(interaction: Interaction): Outcome {
  const options = interaction.data?.options ?? [];
  const topic = options.find((option) => option.name === 'topic')?.value;
  const asked = options.find((option) => option.name === 'question')?.value;

  // The picker wins when somebody used it: choosing from a list is a more
  // definite statement of what you want to know than a sentence is.
  if (typeof topic === 'string' && topic !== '') {
    const fact = factById(topic);
    if (fact) {
      return {
        status: 200,
        body: answerMessage(answerText(fact), fact.id),
        line: `answered from the picker: ${fact.id}`,
      };
    }
  }

  const question = typeof asked === 'string' ? asked : '';
  const reply = replyFor(question);
  return {
    status: 200,
    body: answerMessage(reply.content, reply.fact),
    line: reply.fact
      ? `answered "${question.slice(0, 90)}" from ${reply.fact}`
      : `did not know: "${question.slice(0, 90)}" — told them to ask in #general`,
  };
}

/**
 * The message somebody pointed the bot at.
 *
 * This is the one way to ask in a sentence without the bot ever being able to
 * read a channel: Discord hands over the *target* of a context-menu command and
 * nothing else, so the bot still asks for no intents and still cannot see what
 * anybody types. A picture or a sticker has no words in it, and says so.
 */
function answerMessageCommand(interaction: Interaction): Outcome {
  const target = interaction.data?.target_id ?? '';
  const content = (target !== '' ? interaction.data?.resolved?.messages?.[target]?.content : undefined) ?? '';
  if (content.trim() === '') {
    return { status: 200, body: answerMessage(NO_WORDS, null), line: 'pointed at a message with nothing to answer from' };
  }
  const reply = replyFor(content);
  return {
    status: 200,
    body: answerMessage(reply.content, reply.fact),
    line: reply.fact
      ? `answered a message "${content.slice(0, 70)}" from ${reply.fact}`
      : `did not know a message: "${content.slice(0, 70)}"`,
  };
}

/**
 * A vote on an answer.
 *
 * The acknowledgement is ephemeral (Discord's flag 64) because it is a remark to
 * the person who pressed the button, not a message to the channel; the answer it
 * is about stays public and unedited, which is what makes the vote worth
 * anything.
 */
function answerVote(interaction: Interaction, vote: Vote, factId: string): Outcome {
  const who = interaction.member?.user?.username ?? interaction.user?.username ?? 'somebody';
  const title = factById(factId)?.title ?? factId;
  const where =
    interaction.guild_id && interaction.channel_id && interaction.data?.message?.id
      ? ` — https://discord.com/channels/${interaction.guild_id}/${interaction.channel_id}/${interaction.data.message.id}`
      : '';
  return {
    status: 200,
    body: {
      type: 4,
      data: {
        content:
          vote === 'up'
            ? 'Noted — thank you.'
            : 'Thanks — that goes to a person. If the answer is wrong, saying so in `#ask-xiai` is worth more than the button: I can only be corrected by somebody who knows the game.',
        flags: 64, // EPHEMERAL: this one is between the bot and whoever pressed it
      },
    },
    line: `a ${vote === 'up' ? '👍' : '👎'} on ${factId} from ${who}`,
    report: `${vote === 'up' ? '👍' : '👎'} **${title}** — ${who}${where}`,
  };
}

/** A `.json` answer with the status Discord is owed. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface HandlerContext {
  /** The clock, so a test can age a request without waiting. */
  now?: number;
  /** Cloudflare's `ctx.waitUntil`, so the answer is not held up by the report. */
  waitUntil?: (work: Promise<unknown>) => void;
}

/**
 * The endpoint.
 *
 * The order is the contract: method, then configuration, then size, then
 * signature, then parse. Nothing parses a body it has not first proved came from
 * Discord, and nothing does any work at all for a request that has not.
 */
export async function handleRequest(request: Request, env: Env, context: HandlerContext = {}): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('XIAI is answered by Discord, over POST.\n', { status: 405, headers: { Allow: 'POST' } });
  }

  const publicKey = (env.DISCORD_PUBLIC_KEY ?? '').trim();
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
    // 503 rather than 401, and said loudly: the endpoint is misconfigured, not
    // under attack, and Discord should keep retrying until somebody fixes it.
    console.error('DISCORD_PUBLIC_KEY is missing or is not 64 hex characters — nothing can be verified without it');
    return new Response('this endpoint is not configured yet\n', { status: 503 });
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return new Response('that is too much to be an interaction\n', { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) return new Response('that is too much to be an interaction\n', { status: 413 });

  const verdict = await verifyRequest(request.headers, body, publicKey, context.now ?? Date.now());
  if (verdict !== 'ok') {
    console.warn(`refused an unsigned request: ${verdict}`);
    return new Response('that was not signed by Discord, or was signed a while ago\n', { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(new TextDecoder().decode(body)) as Interaction;
  } catch {
    return new Response('that is not JSON\n', { status: 400 });
  }

  const outcome = answerInteraction(interaction);
  console.log(outcome.line);

  const webhook = (env.XIAI_FEEDBACK_WEBHOOK ?? '').trim();
  if (outcome.report && webhook !== '') {
    const report = postReport(webhook, outcome.report).catch((error: unknown) => {
      // A vote that could not be reported is not a failed answer: the person who
      // pressed the button has already been told, and the next one may land.
      console.error('the vote did not reach the channel', error);
    });
    if (context.waitUntil) context.waitUntil(report);
    else await report;
  }

  return json(outcome.body, outcome.status);
}

/**
 * Put one line in a channel, through a webhook.
 *
 * A webhook URL is the only way this bot can speak on its own, and using it here
 * rather than the bot token keeps the deployed half credential-free.
 */
async function postReport(webhook: string, content: string): Promise<void> {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error(`the feedback webhook answered ${response.status}`);
}

export default {
  fetch(request: Request, env: Env, ctx: { waitUntil(work: Promise<unknown>): void }): Promise<Response> {
    return handleRequest(request, env, { waitUntil: (work) => ctx.waitUntil(work) });
  },
};
