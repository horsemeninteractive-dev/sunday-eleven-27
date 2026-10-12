import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { answerInteraction, handleRequest, NO_WORDS, type Env, type Interaction } from './xiaiEndpoint';
import { ASK_COMMAND, MESSAGE_COMMAND, UNKNOWN, voteCustomId } from '../src/platform/xiai';

/**
 * The endpoint in the cloud, tested the way it will actually be called: with a
 * real `Request`, a real Ed25519 key pair and a real signature.
 *
 * The reason this file is worth its length is that the *only* thing standing
 * between a stranger and Discord is the signature check. Everything else here
 * fails visibly — a wrong answer is a wrong answer in the channel — but a
 * verifier that says yes to the wrong key is a bot anybody can impersonate, and
 * it would look exactly like a bot that works. So the signature is tested with a
 * key that is *not* the application's as well as with the one that is, and the
 * order of the checks is tested too: a body that is not JSON, signed by the wrong
 * key, is a 401 and not a 400.
 */

const HEX = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const encoder = new TextEncoder();

/** The application's key pair, and a second one that is nobody's. */
let application: { hex: string; key: CryptoKey };
let impostor: { hex: string; key: CryptoKey };

async function keyPair(): Promise<{ hex: string; key: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { hex: HEX(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), key: pair.privateKey };
}

beforeAll(async () => {
  application = await keyPair();
  impostor = await keyPair();
});

const env = (extra: Partial<Env> = {}): Env => ({ DISCORD_PUBLIC_KEY: application.hex, ...extra });

/** The bytes Discord signs: the timestamp, then the body, with nothing between. */
async function signed(
  body: unknown,
  options: { key?: CryptoKey; timestamp?: string; signature?: string; method?: string } = {},
): Promise<Request> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const stamp = encoder.encode(timestamp);
  const bytes = encoder.encode(text);
  const message = new Uint8Array(stamp.byteLength + bytes.byteLength);
  message.set(stamp);
  message.set(bytes, stamp.byteLength);
  const signature =
    options.signature ??
    HEX(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, options.key ?? application.key, message)));
  return new Request('https://xiai.example/interactions', {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': signature,
      'X-Signature-Timestamp': timestamp,
    },
    body: options.method && options.method !== 'POST' ? undefined : text,
  });
}

const ping = { type: 1 };
const ask = (options: Array<{ name: string; value?: unknown }>): Interaction => ({
  type: 2,
  data: { name: ASK_COMMAND, options },
});

/** The body of a response, as the object Discord would be given. */
async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** The interaction-response data, which is where the message actually is. */
function data(interaction: unknown): { content: string; flags?: number; components?: unknown[] } {
  return (interaction as { data: { content: string } }).data;
}

describe('the signature', () => {
  it('answers a PING Discord can prove it sent, with the PONG it wants', async () => {
    const response = await handleRequest(await signed(ping), env());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await bodyOf(response)).toEqual({ type: 1 });
  });

  it('refuses a request signed with a key that is not the application\u2019s', async () => {
    const response = await handleRequest(await signed(ping, { key: impostor.key }), env());
    expect(response.status).toBe(401);
  });

  it('refuses a request with no signature at all', async () => {
    const request = new Request('https://xiai.example/interactions', { method: 'POST', body: JSON.stringify(ping) });
    expect((await handleRequest(request, env())).status).toBe(401);
  });

  it('refuses a body that has been changed since it was signed', async () => {
    const request = await signed(ping);
    const tampered = new Request(request.url, { method: 'POST', headers: request.headers, body: '{"type":1,"x":2}' });
    expect((await handleRequest(tampered, env())).status).toBe(401);
  });

  it('refuses an old request that is signed perfectly well', async () => {
    // Ten minutes old: a genuine signature over a request that has already been
    // answered once, which is exactly what a replay is.
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const response = await handleRequest(await signed(ping, { timestamp }), env());
    expect(response.status).toBe(401);
  });

  it('gives a 401, not a 400, to junk signed by the wrong key', async () => {
    // Nothing may be parsed before the signature has been checked, so the answer
    // to an unsigned body that is not even JSON is the same answer as an unsigned
    // body that is: a refusal.
    const response = await handleRequest(await signed('this is not json', { key: impostor.key }), env());
    expect(response.status).toBe(401);
  });

  it('says so when it has not been configured, rather than refusing everything', async () => {
    // A missing public key is a mistake to be fixed, not an attack: a 401 would
    // tell Discord to stop calling, and a 503 asks it to come back.
    const response = await handleRequest(await signed(ping), {});
    expect(response.status).toBe(503);
  });

  it('refuses anything that is not a POST', async () => {
    const response = await handleRequest(await signed('', { method: 'GET' }), env());
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('refuses a body far bigger than an interaction', async () => {
    const response = await handleRequest(await signed('x'.repeat(70_000)), env());
    expect(response.status).toBe(413);
  });

  it('gives a 400 to something signed that is still not JSON', async () => {
    const response = await handleRequest(await signed('not json'), env());
    expect(response.status).toBe(400);
  });
});

describe('/ask', () => {
  it('answers a question, and prints where the answer came from', async () => {
    const response = await handleRequest(await signed(ask([{ name: 'question', value: 'how long is a season' }])), env());
    expect(response.status).toBe(200);
    const { content, components } = data(await bodyOf(response));
    expect(content).toContain('How a season works');
    expect(content).toContain('README.md');
    expect(components?.length).toBe(1);
  });

  it('never lets an answer ping anybody', async () => {
    const response = await handleRequest(await signed(ask([{ name: 'question', value: 'what is the game' }])), env());
    const sent = data(await bodyOf(response)) as unknown as { allowed_mentions?: { parse?: unknown[] } };
    expect(sent.allowed_mentions).toEqual({ parse: [] });
  });

  it('uses the picker when somebody chose a topic from it', async () => {
    const response = await handleRequest(await signed(ask([{ name: 'topic', value: 'club-money' }])), env());
    const { content } = data(await bodyOf(response));
    expect(content).toContain('Where the money comes from and goes');
  });

  it('lets the picker beat a question, because choosing is more definite than asking', async () => {
    const response = await handleRequest(
      await signed(ask([{ name: 'question', value: 'can i play on my phone' }, { name: 'topic', value: 'cups' }])),
      env(),
    );
    expect(data(await bodyOf(response)).content).toContain('The cups');
  });

  it('falls back to what it can help with when nobody asked anything', async () => {
    const response = await handleRequest(await signed(ask([])), env());
    expect(data(await bodyOf(response)).content).toContain('What XIAI can answer');
  });

  it('refuses to guess, and offers no buttons for an answer it does not have', async () => {
    const response = await handleRequest(await signed(ask([{ name: 'question', value: 'what is the capital of peru' }])), env());
    const { content, components } = data(await bodyOf(response));
    expect(content).toBe(UNKNOWN);
    expect(components).toBeUndefined();
  });

  it('ignores a topic that is not one of its own', async () => {
    const response = await handleRequest(await signed(ask([{ name: 'topic', value: 'not-a-fact' }])), env());
    expect(data(await bodyOf(response)).content).toContain('What XIAI can answer');
  });
});

describe('pointing it at a message', () => {
  const pointed = (content?: string): Interaction => ({
    type: 2,
    data: {
      name: MESSAGE_COMMAND,
      target_id: 'm1',
      resolved: { messages: { m1: content === undefined ? undefined : { content } } },
    },
  });

  it('answers from the message somebody pointed it at', async () => {
    const response = await handleRequest(await signed(pointed('how do promotions work then')), env());
    expect(data(await bodyOf(response)).content).toContain('Promotion and relegation');
  });

  it('says so when the message has no words in it', async () => {
    // A picture or a sticker: the bot has nothing to match on, and inventing a
    // subject for somebody else's photograph is exactly what it must not do.
    const response = await handleRequest(await signed(pointed('   ')), env());
    expect(data(await bodyOf(response)).content).toBe(NO_WORDS);
  });

  it('handles a target the resolved map does not have', async () => {
    const response = await handleRequest(await signed(pointed(undefined)), env());
    expect(data(await bodyOf(response)).content).toBe(NO_WORDS);
  });
});

describe('the vote buttons', () => {
  const click = (customId: string): Interaction => ({
    type: 3,
    guild_id: 'g1',
    channel_id: 'c1',
    member: { user: { id: 'u1', username: 'aeryt' } },
    data: { custom_id: customId, message: { id: 'msg1' } },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acknowledges a thumbs up privately, and says nothing to anybody else', async () => {
    const response = await handleRequest(await signed(click(voteCustomId('up', 'cups'))), env());
    const sent = data(await bodyOf(response));
    expect(sent.flags).toBe(64);
    expect(sent.content).toContain('Noted');
  });

  it('reports a thumbs down to the channel, with a link to the answer', async () => {
    const sent: Array<{ content: string; allowed_mentions: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      expect(url).toBe('https://discord.com/api/webhooks/1/token');
      sent.push(JSON.parse(init.body) as { content: string; allowed_mentions: unknown });
      return new Response('', { status: 204 });
    });

    const response = await handleRequest(
      await signed(click(voteCustomId('down', 'club-money'))),
      env({ XIAI_FEEDBACK_WEBHOOK: 'https://discord.com/api/webhooks/1/token' }),
    );

    expect(response.status).toBe(200);
    expect(sent.length).toBe(1);
    expect(sent[0]!.content).toContain('👎');
    expect(sent[0]!.content).toContain('Where the money comes from and goes');
    expect(sent[0]!.content).toContain('https://discord.com/channels/g1/c1/msg1');
    expect(sent[0]!.content).toContain('aeryt');
    expect(sent[0]!.allowed_mentions).toEqual({ parse: [] });
  });

  it('still answers the person who pressed it when the report cannot be sent', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const response = await handleRequest(
      await signed(click(voteCustomId('down', 'cups'))),
      env({ XIAI_FEEDBACK_WEBHOOK: 'https://discord.com/api/webhooks/1/token' }),
    );
    expect(response.status).toBe(200);
  });

  it('does not report a vote when there is nowhere to report it', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('nothing should have been sent');
    });
    const response = await handleRequest(await signed(click(voteCustomId('down', 'cups'))), env());
    expect(response.status).toBe(200);
  });

  it('refuses a button that is not one of its own', async () => {
    const response = await handleRequest(await signed(click('someone:elses:button')), env());
    expect(response.status).toBe(400);
  });
});

describe('everything else', () => {
  it('refuses a command it does not know, rather than guessing', () => {
    expect(answerInteraction({ type: 2, data: { name: 'ban' } }).status).toBe(400);
  });

  it('refuses an interaction type it was never registered for', () => {
    expect(answerInteraction({ type: 5 }).status).toBe(400);
  });

  it('answers a PING without touching anything else', () => {
    const outcome = answerInteraction({ type: 1 });
    expect(outcome.body).toEqual({ type: 1 });
    expect(outcome.report).toBeUndefined();
  });
});
