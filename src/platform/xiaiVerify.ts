/**
 * Checking an endpoint that is not on this machine.
 *
 * `worker/xiaiEndpoint.ts` is the bot in the cloud, `tools/xiai.ts` is how it is
 * reached, and **this file is the part of the check that is a decision**: given
 * what came back, is the deployed bot working, and what exactly is wrong when it
 * is not. It lives here rather than in the tool for the reason the whole
 * repository is split the way it is — this is the half worth testing, and it is
 * tested with no token, no network and no Cloudflare account.
 *
 * ## The one thing that cannot be checked from here
 *
 * An endpoint answers PONG to a request **Discord** signed, and Discord signs
 * with the private half of the application's key pair. Nobody else has it. So a
 * PONG cannot be *made to happen* by anything on this machine, and that is the
 * whole point of the signature rather than an obstacle to be worked around: an
 * endpoint that would answer a request it cannot prove Discord sent is a bot
 * anybody can be.
 *
 * What a check from here can do is everything short of it, and it is a lot: it
 * signs a PING of its own — the same bytes Discord signs, the same headers, a
 * real Ed25519 signature — and the answer separates the endpoint's properties.
 *
 *   - a **401** is the deployed bot *working*. The endpoint is up, it has a
 *     public key, and it refused a signature that was not made with the matching
 *     private half, which for the live application only Discord holds;
 *   - a **200 with `{"type": 1}`** is a real end-to-end proof — and it can only
 *     happen when the endpoint checks a key this machine knows the private half
 *     of, which is what a local `wrangler dev` run is: its key comes out of
 *     `worker/.dev.vars` rather than out of Discord;
 *   - a **200 with `{"type": 1}` from a key made up for the run** is the
 *     opposite, and the one result that is worse than a plain failure: the
 *     signature was never checked at all, and any stranger posting to that
 *     address is answering as this bot. It is stated that way rather than as a
 *     success;
 *   - a **503** is a deploy without a public key — the Worker is there and can
 *     verify nothing, and Discord will not even save the URL against it.
 *
 * The key this check signs with is a throwaway when there is nothing better to
 * use, which is enough for the first and the fourth of those and is what the
 * live endpoint should always answer. `worker/.verify-key` — written by
 * `--new-key`, ignored by git — is what makes the second one reachable, because a
 * signature that is *accepted* takes a private half that outlives the run.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as ed25519, type KeyObject } from 'node:crypto';

/*
 * **No `Buffer` anywhere in this file**, and it is not a style preference: the
 * project's `tsconfig.json` lists the type packages it trusts and `node` is not
 * one of them, so the Node globals are not in scope. Bytes are `Uint8Array` and
 * hex is converted by hand, which is what `worker/xiaiEndpoint.ts` does on the
 * other side of the same signature.
 */

/** Hex to bytes. The length is checked, so a truncated key is a `null` rather than half a key. */
function unhex(text: string): Uint8Array | null {
  if (text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Bytes to hex, lowercased — what an endpoint's `DISCORD_PUBLIC_KEY` is written in. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** How a line reads. The four the tools use: `✓ ! ✗ ·`. */
export type Mark = 'ok' | 'warn' | 'fail' | 'info';

export interface Verdict {
  mark: Mark;
  /** The line itself: what was found, in the words a person reads. */
  text: string;
  /** A second line under it: what it means, or what to do about it. */
  detail?: string;
}

/** What came back, or the fact that nothing did. */
export interface Answer {
  /** The status, or `null` when the request never completed. */
  status: number | null;
  /** The body as text; `''` when there was none. */
  body: string;
  /** The `Content-Type` header, lowercased; `''` when there was none. */
  contentType: string;
  /** The round trip in milliseconds; `null` when there was no round trip. */
  ms: number | null;
  /** Why there was no answer at all — a refused connection, a name that does not resolve. */
  failure?: string;
}

/**
 * Discord gives an interaction three seconds and treats a miss as a failure.
 *
 * Which makes it a real requirement on the deployed endpoint rather than a
 * detail: the signature check, the matcher and the reply all have to fit inside
 * it, and a Worker that has gone cold has to start and answer inside it too. The
 * check reports the round trip against this number because it is the one the
 * endpoint is actually held to.
 */
export const BUDGET_MS = 3000;

/** What a check signs: a PING, and nothing else. A PONG is the only thing it asks for. */
const PING_BODY = JSON.stringify({ type: 1 });

// --- Keys -------------------------------------------------------------------

export interface KeyPair {
  /** The public key: the sixty-four hex characters an endpoint's `DISCORD_PUBLIC_KEY` holds. */
  publicKey: string;
  /** The private half as a 32-byte seed in hex. It signs, and it can do nothing else. */
  seed: string;
}

/**
 * PKCS#8's fixed wrapper around a raw Ed25519 seed: `302e020100300506032b657004220420`.
 *
 * Sixteen bytes of DER header that are the same for every Ed25519 key there has
 * ever been, which is why the seed is what gets written down and this is what
 * turns it back into a key. Node will not take a bare seed, and hand-rolling the
 * header here is smaller than a format of our own would be.
 */
const PKCS8_HEADER = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/** A fresh Ed25519 key pair, as hex. */
export function newKeyPair(): KeyPair {
  const pair = generateKeyPairSync('ed25519');
  const der = new Uint8Array(pair.privateKey.export({ type: 'pkcs8', format: 'der' }));
  return {
    publicKey: rawPublicKey(pair.publicKey),
    // The last 32 bytes of a PKCS#8 Ed25519 key are the seed itself.
    seed: toHex(der.subarray(der.byteLength - 32)),
  };
}

/** The raw 32 bytes an endpoint is configured with, out of a key object. */
function rawPublicKey(key: KeyObject): string {
  // An Ed25519 subject-public-key blob is exactly 44 bytes: the header, then the
  // key. The endpoint is given the key on its own, which is the last 32.
  const der = new Uint8Array(key.export({ type: 'spki', format: 'der' }));
  return toHex(der.subarray(der.byteLength - 32));
}

/** A key that can sign a PING. */
export interface Signer {
  /** The public half, as an endpoint would hold it. */
  publicKey: string;
  /** The `X-Signature-Ed25519` value for a timestamp and a body, the way Discord makes one. */
  signature(timestamp: string, body: string): string;
}

/**
 * The signer for a seed that has been written down, or `null` when it is not a
 * seed at all.
 *
 * `null` rather than a throw, because a key file is a convenience: a check that
 * cannot read it can still sign with a key made up for the run, and the one thing
 * that must not happen is the whole command failing over the half it did not need.
 */
export function signerFromSeed(seed: string): Signer | null {
  const raw = unhex(seed);
  if (!raw || raw.byteLength !== 32) return null;
  // An `ArrayBuffer` and not the view, because that is what `createPrivateKey`
  // takes without an argument with the type system.
  const der = new ArrayBuffer(PKCS8_HEADER.byteLength + raw.byteLength);
  const view = new Uint8Array(der);
  view.set(PKCS8_HEADER, 0);
  view.set(raw, PKCS8_HEADER.byteLength);
  try {
    return signerFor(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
  } catch {
    return null;
  }
}

/** A signer nothing is configured to trust, which is what the live endpoint should refuse. */
export function signerForOneRun(): Signer {
  return signerFor(generateKeyPairSync('ed25519').privateKey);
}

function signerFor(key: KeyObject): Signer {
  const publicKey = rawPublicKey(createPublicKey(key));
  return {
    publicKey,
    // **Exactly what Discord signs**, and therefore exactly what the endpoint
    // checks: the timestamp, then the body, with nothing between them and no
    // separator. `worker/xiaiEndpoint.ts` joins the same two runs of bytes, and
    // getting this wrong would produce a 401 that reads like a healthy refusal —
    // which is why a test signs a PING here and verifies it with the endpoint's
    // own verifier rather than trusting this comment.
    signature: (timestamp, body) => toHex(new Uint8Array(ed25519(null, new TextEncoder().encode(timestamp + body), key))),
  };
}

/** A signed PING, as the request that carries it. */
export interface SignedPing {
  headers: Record<string, string>;
  body: string;
}

/** A PING signed the way Discord signs one: fresh, and with the key given. */
export function signedPing(signer: Signer, now: number = Date.now()): SignedPing {
  const timestamp = String(Math.floor(now / 1000));
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-Ed25519': signer.signature(timestamp, PING_BODY),
      'X-Signature-Timestamp': timestamp,
    },
    body: PING_BODY,
  };
}

// --- Reading the answers ----------------------------------------------------

/** What the check knew before it sent anything, which is what a 401 has to be read against. */
export interface Context {
  /** Whether the address is on this machine — a `wrangler dev` run rather than a deployment. */
  local: boolean;
  /** Whether this check signs with a key it holds, rather than one made up for the run. */
  held: boolean;
  /** The public key it signed with, so a mismatch can say which key to configure. */
  publicKey: string;
}

export interface Check {
  verdicts: Verdict[];
  /** Whether anything was found wrong. A `warn` counts: it is something a person has to read. */
  ok: boolean;
}

/** Nothing answered at all. A refused connection is a result, and this is how it reads. */
function unreachable(answer: Answer): Verdict {
  return {
    mark: 'fail',
    text: 'nothing answered at that address',
    detail: answer.failure ?? 'the request did not complete',
  };
}

/** The first line of a body, for a detail line that has to stay one line. */
function firstLine(body: string, limit = 200): string {
  return body.trim().split(/\r?\n/)[0]?.slice(0, limit) ?? '';
}

/**
 * Whether the address is the built endpoint at all.
 *
 * Asked with a `GET`, because that is the one request the Worker answers without
 * a signature — it is a 405 with a body of its own — and "nothing is deployed
 * here" and "something else is deployed here" are different problems with
 * different fixes. A `fetch` against a host with no Worker answers Cloudflare's
 * own 404, which is not ours to mistake for the bot.
 */
export function readFingerprint(answer: Answer): Verdict {
  if (answer.status === null) return unreachable(answer);

  if (answer.status === 405 && /XIAI is answered by Discord/i.test(answer.body)) {
    return {
      mark: 'ok',
      text: 'the address is this bot: the Worker answered a GET the way only it does',
      detail: '405 with Allow: POST — the endpoint parses nothing until the signature has been checked, and a GET has no signature to check',
    };
  }

  if (answer.status === 404) {
    return {
      mark: 'fail',
      text: 'nothing is deployed at that address (404)',
      detail: 'the URL `npm run xiai:deploy` printed is the one that has this Worker behind it',
    };
  }

  return {
    mark: 'warn',
    text: `something else answered there: ${answer.status}${answer.contentType ? ` ${answer.contentType}` : ''}`,
    detail: firstLine(answer.body) || 'no body',
  };
}

/** Whether a body is the PONG Discord is owed. */
function isPong(body: string): boolean {
  try {
    return (JSON.parse(body) as { type?: unknown }).type === 1;
  } catch {
    return false;
  }
}

/** How long it took, against what Discord allows. */
function timing(ms: number): Verdict {
  const took = Math.round(ms);
  return ms > BUDGET_MS
    ? {
        mark: 'warn',
        text: `the round trip took ${took} ms, over the ${BUDGET_MS} ms Discord gives an interaction`,
        detail: 'an interaction answered that slowly is one Discord treats as failed — a cold start is the usual cause',
      }
    : { mark: 'info', text: `round trip ${took} ms, within the ${BUDGET_MS} ms Discord gives an interaction` };
}

/**
 * What the answer to a signed PING means.
 *
 * The whole check turns on reading a refusal as success when it is the *right*
 * refusal, and on never reading a 200 as one. A 401 to a key made up for the run
 * is the deployed bot doing the only thing that keeps it from being
 * impersonated; the same 401 against an address on this machine is a key file
 * that does not match `worker/.dev.vars`, which is a real fault and is reported as
 * one.
 */
export function readPing(answer: Answer, context: Context): Check {
  if (answer.status === null) return { verdicts: [unreachable(answer)], ok: false };

  const verdicts: Verdict[] = [];
  const pong = isPong(answer.body);

  if (pong && context.held) {
    verdicts.push({
      mark: 'ok',
      text: 'PONG: a real Ed25519-signed PING was answered with {"type":1}',
      detail: `verified end to end, by an endpoint that holds ${context.publicKey} — the signature, the PING and the Worker runtime, all exercised`,
    });
  } else if (pong) {
    verdicts.push({
      mark: 'fail',
      text: 'the endpoint answered PONG to a key it has never been given',
      detail:
        'this check signed with a key it made up for the run, so the signature was not checked at all — anybody posting to that address can answer as this bot. Find out what is deployed there before trusting what it says.',
    });
  } else if (answer.status === 401) {
    if (context.local) {
      verdicts.push({
        mark: 'fail',
        text: 'the local endpoint refused the signature: its key is not the one this check signed with',
        detail: `a \`wrangler dev\` run reads DISCORD_PUBLIC_KEY from worker/.dev.vars — put ${context.publicKey} in it, or run \`--new-key\` and paste the key it prints`,
      });
    } else {
      verdicts.push({
        mark: 'ok',
        text: 'the endpoint refused a signed PING with 401, which is what a deployed bot should do',
        detail:
          'it is up, it holds a public key, and the signature is checked before anything at all is parsed. That key is the application\u2019s, and only Discord has the private half — so a PONG can only come from Discord itself, which is the round trip that happens when the Interactions Endpoint URL is saved (`npm run xiai:logs` prints the line when one arrives)',
      });
    }
  } else if (answer.status === 503) {
    verdicts.push({
      mark: 'fail',
      text: 'the endpoint is deployed but has no public key to check anything against (503)',
      detail:
        'npx wrangler secret put DISCORD_PUBLIC_KEY --config worker/wrangler.toml — with the Public Key from the Portal\u2019s General Information page. Discord will not even save an Interactions Endpoint URL against an endpoint that answers this',
    });
  } else if (answer.status === 500) {
    verdicts.push({
      mark: 'fail',
      text: 'the Worker threw (500)',
      detail: firstLine(answer.body) || 'no body',
    });
  } else {
    verdicts.push({
      mark: 'warn',
      text: `the endpoint answered ${answer.status} to a signed PING`,
      detail: firstLine(answer.body) || 'no body',
    });
  }

  // Only worth saying once the check is otherwise happy: how long a round trip
  // took is not the interesting line when the answer was a 503.
  const happy = verdicts.every((verdict) => verdict.mark === 'ok' || verdict.mark === 'info');
  if (happy && answer.ms !== null) verdicts.push(timing(answer.ms));

  // Read off every verdict including that one, so an endpoint that answers
  // correctly but slowly is not a pass: Discord gives an interaction three
  // seconds, and an answer that arrives after them is an answer that failed.
  const ok = verdicts.every((verdict) => verdict.mark === 'ok' || verdict.mark === 'info');
  return { verdicts, ok };
}

/**
 * Whether Discord is pointed at the address being checked.
 *
 * Read from the application rather than assumed, because the two ways this fails
 * are both silent: an endpoint deployed and working that Discord has never been
 * told about, and Discord pointed at an address that is not the one anybody is
 * looking at. `undefined` means the setting was not read at all — there is no
 * token, which is a supported way to run this — and is kept apart from `null`,
 * which is Discord saying there is no URL.
 */
export function readDiscordSetting(saved: string | null | undefined, url: string): Verdict {
  if (saved === undefined) {
    return {
      mark: 'info',
      text: 'Discord was not asked what it is pointed at',
      detail: 'a bot token is what reads that, and checking an address needs none — set DISCORD_TOKEN in discord.env to have it compared',
    };
  }

  const bare = (address: string): string => address.replace(/\/+$/, '');

  // `null` is the field being absent, which means the same thing as an empty
  // string here: Discord has no endpoint URL for this application.
  if (saved === null || saved === '') {
    return {
      mark: 'warn',
      text: 'Discord has no Interactions Endpoint URL: the server is answered by `npm run xiai` and nothing else',
      detail: 'paste the URL `npm run xiai:deploy` printed into the application\u2019s Portal page — step 3 in DISCORD.md',
    };
  }

  if (bare(saved) === bare(url)) {
    return { mark: 'ok', text: `Discord is pointed at this address (${saved})` };
  }

  return {
    mark: 'warn',
    text: `Discord is pointed somewhere else (${saved})`,
    detail: 'this check is about the address it was given, so what answers in the server is that one',
  };
}
