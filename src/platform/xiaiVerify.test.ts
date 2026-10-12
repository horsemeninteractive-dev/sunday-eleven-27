import { describe, expect, it } from 'vitest';
import { verifyRequest } from '../../worker/xiaiEndpoint';
import {
  BUDGET_MS,
  newKeyPair,
  readDiscordSetting,
  readFingerprint,
  readPing,
  signedPing,
  signerForOneRun,
  signerFromSeed,
  type Answer,
} from './xiaiVerify';

/**
 * The check of a deployed endpoint, tested on the half that decides what an
 * answer *means*.
 *
 * One test here is worth more than the rest put together, and it is the first:
 * a PING signed by this file is handed to the endpoint's own `verifyRequest`. A
 * signature over the wrong bytes — the JSON re-encoded, a separator between the
 * timestamp and the body, a timestamp in milliseconds — would be refused by the
 * endpoint, and a 401 is also what a *healthy* deployed endpoint answers. A
 * wrong signature would therefore be indistinguishable from a working bot, which
 * is exactly the mistake this command must not be capable of making.
 */

const encoder = new TextEncoder();

/** An answer as `probe()` would report it, with the parts a test does not care about defaulted. */
const answer = (partial: Partial<Answer>): Answer => ({
  status: 200,
  body: '',
  contentType: 'application/json',
  ms: 12,
  ...partial,
});

const PONG = JSON.stringify({ type: 1 });
const deployed = { local: false, held: false, publicKey: 'a'.repeat(64) };
const localish = { local: true, held: true, publicKey: 'b'.repeat(64) };

describe('the signature this check sends', () => {
  it('is one the endpoint accepts, over a timestamp it considers fresh', async () => {
    const signer = signerForOneRun();
    const now = Date.now();
    const ping = signedPing(signer, now);

    expect(ping.body).toBe('{"type":1}');
    expect(ping.headers['Content-Type']).toBe('application/json');

    // The endpoint's own verifier, which is the thing Discord's requests are held
    // to: the timestamp, then the raw body, checked against the public half.
    const verdict = await verifyRequest(
      new Headers(ping.headers),
      encoder.encode(ping.body),
      signer.publicKey,
      now,
    );
    expect(verdict).toBe('ok');
  });

  it('is refused when the endpoint holds a different key', async () => {
    const ping = signedPing(signerForOneRun());
    const other = newKeyPair();
    expect(await verifyRequest(new Headers(ping.headers), encoder.encode(ping.body), other.publicKey, Date.now())).toBe(
      'bad',
    );
  });

  it('is refused as a replay once the timestamp is old', async () => {
    const signer = signerForOneRun();
    const ping = signedPing(signer);
    // Ten minutes later: a genuine signature over something that has already been
    // answered once, which is what the endpoint's freshness window is for.
    const later = Date.now() + 10 * 60 * 1000;
    expect(await verifyRequest(new Headers(ping.headers), encoder.encode(ping.body), signer.publicKey, later)).toBe(
      'stale',
    );
  });

  it('carries the timestamp in seconds, as Discord does', () => {
    const now = Date.now();
    const ping = signedPing(signerForOneRun(), now);
    expect(Number(ping.headers['X-Signature-Timestamp'])).toBe(Math.floor(now / 1000));
  });
});

describe('the key written down', () => {
  it('comes back as the same key, so a PONG can be earned on a later run', () => {
    const pair = newKeyPair();
    const signer = signerFromSeed(pair.seed);

    expect(pair.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(signer?.publicKey).toBe(pair.publicKey);
  });

  it('signs for that key and no other', async () => {
    const pair = newKeyPair();
    const signer = signerFromSeed(pair.seed);
    expect(signer).not.toBeNull();
    if (!signer) return;
    const now = Date.now();
    const ping = signedPing(signer, now);
    expect(await verifyRequest(new Headers(ping.headers), encoder.encode(ping.body), pair.publicKey, now)).toBe('ok');
    expect(await verifyRequest(new Headers(ping.headers), encoder.encode(ping.body), newKeyPair().publicKey, now)).toBe(
      'bad',
    );
  });

  it('is refused rather than half-read when it is not a seed', () => {
    expect(signerFromSeed('')).toBeNull();
    expect(signerFromSeed('nonsense')).toBeNull();
    // Sixty-four characters, but not hex, and not thirty-two bytes: both are
    // files somebody has edited by hand, and neither may sign anything.
    expect(signerFromSeed('z'.repeat(64))).toBeNull();
    expect(signerFromSeed('ab'.repeat(16))).toBeNull();
  });
});

describe('the address', () => {
  it('is this bot when a GET is answered the way only it answers one', () => {
    const verdict = readFingerprint(
      answer({ status: 405, body: 'XIAI is answered by Discord, over POST.\n', contentType: 'text/plain' }),
    );
    expect(verdict.mark).toBe('ok');
  });

  it('is nothing at all behind a 404, which is a different problem from a wrong key', () => {
    expect(readFingerprint(answer({ status: 404, body: 'Not Found' })).mark).toBe('fail');
  });

  it('is something else when a stranger answers, and says what it answered', () => {
    const verdict = readFingerprint(answer({ status: 200, body: '<!doctype html>', contentType: 'text/html' }));
    expect(verdict.mark).toBe('warn');
    expect(verdict.detail).toContain('<!doctype html>');
  });

  it('is unreachable, which is a result and not a crash', () => {
    const verdict = readFingerprint(answer({ status: null, ms: null, failure: 'getaddrinfo ENOTFOUND' }));
    expect(verdict.mark).toBe('fail');
    expect(verdict.detail).toContain('ENOTFOUND');
  });
});

describe('the answer to a signed PING', () => {
  it('is a real proof when a PONG comes back to a key this machine holds', () => {
    const check = readPing(answer({ body: PONG, ms: 8 }), { ...localish });
    expect(check.ok).toBe(true);
    expect(check.verdicts[0]?.text).toContain('PONG');
    expect(check.verdicts[0]?.detail).toContain(localish.publicKey);
  });

  it('is the worst result there is when a PONG comes back to a key it has never been given', () => {
    // The endpoint was not told this key, so a PONG means the signature was not
    // checked at all — a bot anybody can be, and never a pass.
    const check = readPing(answer({ body: PONG }), { ...deployed });
    expect(check.ok).toBe(false);
    expect(check.verdicts[0]?.mark).toBe('fail');
    expect(check.verdicts[0]?.text).toContain('never been given');
  });

  it('is the deployed bot working when a signed PING is refused with a 401', () => {
    const check = readPing(answer({ status: 401, body: 'that was not signed by Discord\n' }), { ...deployed });
    expect(check.ok).toBe(true);
    expect(check.verdicts[0]?.detail).toContain('Discord');
    // And the round trip is reported, because three seconds is what Discord gives it.
    expect(check.verdicts.some((verdict) => verdict.text.includes(`${BUDGET_MS} ms`))).toBe(true);
  });

  it('is a key file that does not match when a local endpoint refuses it', () => {
    const check = readPing(answer({ status: 401 }), { ...localish });
    expect(check.ok).toBe(false);
    expect(check.verdicts[0]?.detail).toContain('worker/.dev.vars');
    expect(check.verdicts[0]?.detail).toContain(localish.publicKey);
  });

  it('is a deploy with nothing to verify against when it answers 503', () => {
    const check = readPing(answer({ status: 503, body: 'this endpoint is not configured yet\n' }), { ...deployed });
    expect(check.ok).toBe(false);
    expect(check.verdicts[0]?.detail).toContain('wrangler secret put DISCORD_PUBLIC_KEY');
  });

  it('is a bug when the Worker throws', () => {
    const check = readPing(answer({ status: 500, body: 'Internal Server Error' }), { ...deployed });
    expect(check.ok).toBe(false);
    expect(check.verdicts[0]?.mark).toBe('fail');
  });

  it('is unread, rather than guessed at, when the status is one it does not know', () => {
    const check = readPing(answer({ status: 418, body: 'I am a teapot' }), { ...deployed });
    expect(check.ok).toBe(false);
    expect(check.verdicts[0]?.mark).toBe('warn');
    expect(check.verdicts[0]?.detail).toBe('I am a teapot');
  });

  it('is too slow, and says so, when a PONG takes longer than Discord allows', () => {
    const check = readPing(answer({ body: PONG, ms: BUDGET_MS + 1 }), { ...localish });
    expect(check.ok).toBe(false);
    expect(check.verdicts.at(-1)?.mark).toBe('warn');
  });
});

describe("Discord's own setting", () => {
  it('is unknown, and said to be unknown, when there was no token to read it with', () => {
    const verdict = readDiscordSetting(undefined, 'https://xiai.example');
    expect(verdict.mark).toBe('info');
    expect(verdict.text).toContain('not asked');
  });

  it('is the warning this whole command exists for when Discord has no URL at all', () => {
    const verdict = readDiscordSetting('', 'https://xiai.example');
    expect(verdict.mark).toBe('warn');
    expect(verdict.text).toContain('no Interactions Endpoint URL');
  });

  it('matches the address being checked, with or without the trailing slash a paste brings', () => {
    expect(readDiscordSetting('https://xiai.example', 'https://xiai.example').mark).toBe('ok');
    expect(readDiscordSetting('https://xiai.example/', 'https://xiai.example').mark).toBe('ok');
  });

  it('is somewhere else, which is worth knowing before reading a green check', () => {
    const verdict = readDiscordSetting('https://other.example', 'https://xiai.example');
    expect(verdict.mark).toBe('warn');
    expect(verdict.detail).toContain('that one');
  });
});
