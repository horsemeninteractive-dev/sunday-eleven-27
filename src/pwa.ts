import { useSyncExternalStore } from 'react';
import { VERSION } from './version';
import { hasWebShell } from './platform/target';

/**
 * The game as an installed thing, and the moment a new one arrives.
 *
 * Two features that look like UI and are mostly not. Installing the game is
 * something the browser offers once and only once, on a day of its choosing, and
 * an offer that is not caught when it fires is not on offer at all. Telling the
 * manager a new version exists is something the service worker does quietly in
 * the background, and it is silent by design — see the note on `message` in
 * sw.js, where a new build deliberately sits and waits rather than swapping
 * itself in under a running match.
 *
 * So this module owns the lifecycle. It registers the worker, catches the
 * install offer before React has mounted, watches for a worker that has finished
 * installing, and hands the UI two small pieces of state. The decisions about
 * *what* to show are pure functions at the top, separated from this plumbing so
 * they can be tested without a browser.
 *
 * All of it is browser-only, and all of it asks `hasWebShell()` before it does
 * anything. A packaged build (Android, iOS, a future desktop application) is
 * already installed, already has its assets on the device, and is updated by its
 * store — so there is nothing to register, nothing to offer and nothing to swap
 * in. Nothing here is deleted for those builds; it simply never runs, and the
 * two entry points below are the only places that have to know it.
 */

/* ------------------------------------------------------------------ *
 * Decisions
 * ------------------------------------------------------------------ */

/**
 * How a manager can get this game onto a home screen.
 *
 * `ready`  — the browser has offered the install prompt and it is ours to call.
 * `manual` — iOS, which never fires the event and is installed by hand instead.
 * `none`   — already installed, or a browser with no way to do it.
 */
export type InstallRoute = 'ready' | 'manual' | 'none';

/**
 * What to offer, given what the browser has told us.
 *
 * The one rule worth stating is the last one: a browser that has not offered a
 * prompt and is not iOS gets nothing. Firefox on the desktop cannot install a
 * progressive web app the way Chrome can, and a card saying "add this to your
 * home screen" would be a promise the browser has already refused to make.
 */
export function installRouteFor(input: {
  /** The deferred `beforeinstallprompt` event has arrived. */
  promptReady: boolean;
  /** The game is already running from a home screen. */
  installed: boolean;
  /** iPhone, iPad or iPod. */
  ios: boolean;
}): InstallRoute {
  if (input.installed) return 'none';
  if (input.promptReady) return 'ready';
  if (input.ios) return 'manual';
  return 'none';
}

/**
 * Whether a worker that has just installed is an *update* rather than a first
 * install.
 *
 * The distinction is the whole point: a first install is the game arriving and
 * needs no announcement, whereas a worker that installs while another one is
 * already in charge means there is a newer build sitting on disk, and the page
 * is running the older one. That is worth a word.
 */
export function isUpdateReady(input: {
  /** A worker is already in charge of this page. */
  controlled: boolean;
  /** The state the new worker has reached. */
  workerState: string | undefined | null;
}): boolean {
  return input.controlled && input.workerState === 'installed';
}

/* ------------------------------------------------------------------ *
 * Browser plumbing
 * ------------------------------------------------------------------ */

/**
 * The part of `BeforeInstallPromptEvent` this game uses.
 *
 * Declared here rather than taken from lib.dom because the event is still a
 * draft there, and depending on a draft type is worse than writing down the
 * three members that are actually stable.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

const installListeners = new Set<Listener>();
const updateListeners = new Set<Listener>();

interface InstallSnapshot {
  promptReady: boolean;
  installed: boolean;
}

interface UpdateSnapshot {
  ready: boolean;
  /** The build the page is running, so the prompt can name what is waiting. */
  running: string | null;
}

let deferredPrompt: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let installedSnapshot: InstallSnapshot = { promptReady: false, installed: false };
let updateSnapshot: UpdateSnapshot = { ready: false, running: null };

const hasWindow = typeof window !== 'undefined';
const hasNavigator = typeof navigator !== 'undefined';

/** True once the page has taken over the screen, on a phone or a desktop. */
function runningStandalone(): boolean {
  if (!hasWindow) return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true;
  } catch {
    // matchMedia with an unknown query throws in some older engines, and the
    // answer being sought here is never worth taking the menu down for.
  }
  // iOS does not report display-mode at all; it sets this on the navigator
  // instead, and only when the game was actually launched from the home screen.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone, iPad or iPod — including an iPad, which asks to be a Mac. */
function isIos(): boolean {
  if (!hasNavigator) return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  const platform = (navigator as Navigator & { platform?: string }).platform;
  return platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function publishInstall(patch: Partial<InstallSnapshot>): void {
  const next = { ...installedSnapshot, ...patch };
  if (next.promptReady === installedSnapshot.promptReady && next.installed === installedSnapshot.installed) return;
  installedSnapshot = next;
  for (const listener of installListeners) listener();
}

function publishUpdate(patch: Partial<UpdateSnapshot>): void {
  const next = { ...updateSnapshot, ...patch };
  if (next.ready === updateSnapshot.ready && next.running === updateSnapshot.running) return;
  updateSnapshot = next;
  for (const listener of updateListeners) listener();
}

function subscribeInstall(listener: Listener): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

function subscribeUpdate(listener: Listener): () => void {
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

/**
 * Catch the browser's one-time offer to install.
 *
 * This has to run before the menu is on screen. The event fires once, whenever
 * the browser decides the game qualifies — which is not something this code can
 * predict — and calling `preventDefault` on it is the only way to stop Chrome
 * putting its own little install bar along the bottom of the window and taking
 * the offer off the table. With it caught, the menu can offer the install in the
 * game's own words, at a moment the manager chooses.
 */
export function captureInstallPrompt(): void {
  if (!hasWebShell() || !hasWindow) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    publishInstall({ promptReady: true });
  });
  // Fired by the browser once the game really is installed, which is the only
  // reliable confirmation: the promise below resolving says the prompt was
  // *shown*, not that the manager accepted it.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    publishInstall({ promptReady: false, installed: true });
  });
  // The game can also be running as an app already, with nothing ever offered.
  if (runningStandalone()) publishInstall({ installed: true });
}

/**
 * Put the offer to the manager.
 *
 * Returns whether it was taken. The event is single-use by specification, so it
 * is spent either way: a manager who dismisses the offer has answered the
 * question, and asking again would be the behaviour of an advert.
 */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  // Spent, whether it is accepted or not — but not yet "installed".
  publishInstall({ promptReady: false });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') publishInstall({ installed: true });
    return choice.outcome === 'accepted';
  } catch {
    // The prompt can only be called in direct response to a gesture, and a
    // browser may still refuse. It is a bonus either way.
    return false;
  }
}

/**
 * Watch a worker as it arrives, and decide whether it is an update worth
 * mentioning. A worker that installs with nobody in charge is the first one, and
 * a worker that reaches `activated` has already taken over on its own — neither
 * is anything to tell the manager about.
 */
function watchWorker(worker: ServiceWorker | null): void {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    const ready = isUpdateReady({
      controlled: Boolean(navigator.serviceWorker?.controller),
      workerState: worker.state,
    });
    if (ready) publishUpdate({ ready: true, running: runningVersion() });
  });
}

/** The build the page is running, for the words on the update prompt. */
function runningVersion(): string | null {
  // The version of the bundle in front of the manager, which is exactly what a
  // pending update would be replacing.
  return VERSION;
}

/**
 * Hand the page over to the waiting worker and reload into it.
 *
 * Reloading on `controllerchange` rather than straight away is what makes this
 * correct: the moment the new worker takes charge is the moment the page is
 * being run by the build that was just installed. The timeout is only a seat
 * belt, for a browser that takes over without saying so.
 */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (hasNavigator) {
    navigator.serviceWorker?.addEventListener('controllerchange', () => location.reload(), { once: true });
  }
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Belt and braces: if nothing takes charge, reload anyway so the manager is
    // not left staring at a prompt that does nothing.
    setTimeout(() => location.reload(), 2000);
    return;
  }
  location.reload();
}

/** The manager has read it and would rather not be told again this session. */
export function dismissUpdate(): void {
  publishUpdate({ ready: false });
}

/**
 * Register the worker, and start watching for the next build.
 *
 * Only ever called from a production build. A worker in front of the dev server
 * would serve one session's cached index.html to the next, which is a mystifying
 * way to lose an afternoon.
 */
export function startServiceWorker(): void {
  if (!hasWebShell()) return;
  if (!import.meta.env.PROD || !hasNavigator || !('serviceWorker' in navigator)) return;

  // The registration is deliberately not awaited. The game must not wait on it,
  // and it must not care whether it succeeded: offline play is a bonus, not a
  // promise, and a browser that refuses costs the manager only the feature.
  void navigator.serviceWorker.register('/sw.js').then(
    (reg) => {
      registration = reg;
      watchWorker(reg.installing);
      reg.addEventListener('updatefound', () => watchWorker(reg.installing));

      // Note what is *not* here: a check for a worker that is already waiting.
      //
      // It looks like a sensible thing to do on load and is actively wrong. At
      // the moment a page starts, a waiting worker usually means the *previous*
      // build is still finishing taking over — the old page has gone, but the
      // replacement has not finished activating, so the registration briefly
      // reports a worker that is installed and waiting. That worker activates
      // on its own in a moment and there is no update at all; announcing it
      // greets the manager with "a new version is ready" for the version they
      // are already running.
      //
      // A real pending update looks different and is caught above: it is
      // installed *after* this page took control, which is what `updatefound`
      // and the state watch report. That also covers a deploy that lands while
      // the page is loading, because the fetch of sw.js below happens after
      // this registration was created.

      // Check for a new build while the page is open. A manager who leaves a
      // match open over lunch should still be told about the deploy rather than
      // finding it half-applied on Saturday. On becoming visible first, because
      // that is the moment a manager has most likely just been away somewhere
      // else, and then hourly, which is cheap: one conditional request for a
      // few kilobytes of worker.
      const check = (): void => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      };
      document.addEventListener('visibilitychange', check);
      setInterval(check, 60 * 60 * 1000);
    },
    (error: unknown) => {
      // Private browsing, an unsupported origin: worth saying once, and worth
      // nothing more, because nothing about it is the manager's problem.
      console.warn('Service worker registration failed; running online-only.', error);
    },
  );
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

const INSTALL_SNAPSHOT = (): InstallSnapshot => installedSnapshot;
const UPDATE_SNAPSHOT = (): UpdateSnapshot => updateSnapshot;

/** Whether, and how, to offer the install — and the button that offers it. */
export function useInstall(): { route: InstallRoute; installed: boolean; promptInstall: () => Promise<boolean> } {
  const snapshot = useSyncExternalStore(subscribeInstall, INSTALL_SNAPSHOT, INSTALL_SNAPSHOT);
  const route = installRouteFor({
    promptReady: snapshot.promptReady,
    installed: snapshot.installed,
    ios: isIos(),
  });
  return { route, installed: snapshot.installed, promptInstall };
}

/** Whether a newer build is installed and waiting for this page to move to it. */
export function useUpdate(): { ready: boolean; running: string | null; applyUpdate: () => void; dismiss: () => void } {
  const snapshot = useSyncExternalStore(subscribeUpdate, UPDATE_SNAPSHOT, UPDATE_SNAPSHOT);
  return { ready: snapshot.ready, running: snapshot.running, applyUpdate, dismiss: dismissUpdate };
}