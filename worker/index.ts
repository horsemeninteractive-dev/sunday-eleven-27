/**
 * The Worker's entry point, and deliberately nothing else.
 *
 * A Worker's entry module may export only functions and handlers: workerd reads
 * the module's export map as its list of entrypoints, so a *value* exported from
 * here — a string of text, a fact, a table — is not a small mistake but a refusal
 * to start at all:
 *
 *     Uncaught TypeError: Incorrect type for map entry 'NO_WORDS':
 *     the provided value is not of type 'function or ExportedHandler'.
 *
 * Which is how this file came to exist. `worker/xiaiEndpoint.ts` holds the
 * endpoint and exports everything the tests need — the signature check, the
 * decision for an interaction, the text it says when it has nothing to answer —
 * and this re-exports exactly one thing, so the runtime is given a handler and
 * the tests are given everything else. The split is the one the rest of the
 * repository already uses: the interesting half in a file with tests, the thin
 * entry beside it.
 */

export { default } from './xiaiEndpoint';
