import { describe, expect, it } from 'vitest';
import { installRouteFor, isUpdateReady } from './pwa';

/**
 * The two decisions that decide what a manager is shown, and when.
 *
 * They live apart from the browser plumbing around them precisely so they can
 * be tested in a plain Node process: everything here is about which of four
 * things to draw, and getting it wrong means either an install button that does
 * nothing or a new build that arrives silently in the middle of a match.
 */

describe('offering the install', () => {
  const shown = { promptReady: false, installed: false, ios: false };

  it('offers the browser\'s own prompt when it has handed one over', () => {
    expect(installRouteFor({ ...shown, promptReady: true })).toBe('ready');
  });

  it('says nothing at all to a manager who already has the game installed', () => {
    // Nothing to congratulate anyone for: the card is for getting the game onto
    // a home screen, and it is already there.
    expect(installRouteFor({ ...shown, promptReady: true, installed: true })).toBe('none');
    expect(installRouteFor({ ...shown, ios: true, installed: true })).toBe('none');
  });

  it('falls back to written instructions on iOS, which never offers the event', () => {
    // There is no button to give on iOS — the route in is Share, then Add to
    // Home Screen — so the card explains rather than offering a dead control.
    expect(installRouteFor({ ...shown, ios: true })).toBe('manual');
  });

  it('shows nothing to a browser with no way to install', () => {
    // Firefox on the desktop does not support installing a progressive web app.
    // Showing the card there would be a promise the browser has already refused,
    // and "not now" would be the only honest button available.
    expect(installRouteFor(shown)).toBe('none');
    // Nor while the offer is still on its way: before the browser has decided,
    // nobody knows yet, and guessing "manual" would flash the wrong card.
    expect(installRouteFor({ ...shown, promptReady: false, ios: false })).toBe('none');
  });
});

describe('announcing a new build', () => {
  it('treats a worker that installs with nobody in charge as a first install', () => {
    // The game arriving is not news, and announcing it would mean every first
    // visit opens with a bar about a version that is already the right one.
    expect(isUpdateReady({ controlled: false, workerState: 'installed' })).toBe(false);
  });

  it('announces a worker that installs while another is already in charge', () => {
    // This is the case that matters: a newer build is on disk and the page is
    // running the older one.
    expect(isUpdateReady({ controlled: true, workerState: 'installed' })).toBe(true);
  });

  it('says nothing while the new worker is still on its way', () => {
    // 'installing' and 'activating' are both ordinary progress, not news.
    for (const state of ['installing', 'activating', 'activated', 'redundant']) {
      expect(isUpdateReady({ controlled: true, workerState: state })).toBe(false);
    }
  });

  it('says nothing about a worker in an unknown state', () => {
    // A browser that never starts one at all leaves this undefined, and a
    // missing state is not evidence of an update.
    expect(isUpdateReady({ controlled: true, workerState: undefined })).toBe(false);
    expect(isUpdateReady({ controlled: true, workerState: null })).toBe(false);
  });
});