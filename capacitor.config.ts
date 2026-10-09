import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The game as a native application.
 *
 * Capacitor wraps the *same* web build the website ships — `dist`, produced by
 * `vite build` — in a native shell that loads it from the device rather than
 * from the network. There is no `server.url` here and there never should be:
 * pointing the shell at the live site would make the installed application a
 * bookmark, so it would need a signal to start, would show whatever is deployed
 * rather than what was tested, and would have no answer at all on a touchline
 * with one bar of signal. `webDir` is the whole of how the game gets onto the
 * device.
 *
 * The native build is produced with `npm run build:native`, which is the same
 * Vite build with `VITE_BUILD_TARGET=mobile` (see `.env.native`). That flag is
 * what tells the game it is not in a browser — no service worker, no install
 * offer, no update bar — and it is the only difference between the two bundles.
 *
 * `npx cap sync android` copies `dist` into `android/app/src/main/assets/public`
 * and that copy is what the application runs.
 */
const config: CapacitorConfig = {
  /**
   * The application's one immutable identity.
   *
   * Reverse-DNS, from the project's own name, and the same name the website is
   * deployed under (`sundayeleven` on Cloudflare Pages). It is the Android
   * package name, the iOS bundle identifier, and — once the game has been
   * published — the one thing that can never be changed, because a store treats
   * a new identifier as a different application with no history and no
   * installed base.
   */
  appId: 'com.sundayeleven.se27',

  /** What the device calls the game: the name on the launcher, in the store. */
  appName: 'Sunday Eleven 27',

  /** The web build, exactly as the website ships it. */
  webDir: 'dist',

  /**
   * The colour behind the game while its bundle is being painted.
   *
   * The same near-black as the manifest's theme colour and the booting
   * placeholder in `index.html`, so opening the application is one continuous
   * surface rather than a white flash followed by a dark game.
   */
  backgroundColor: '#08090b',

  /**
   * How the Android system bars are handled.
   *
   * Android 16 — which is what this application targets — enforces edge-to-edge
   * and no longer lets an application opt out of it, so the old approach of
   * asking the status bar not to overlay the WebView is gone: the game is drawn
   * under the bars whether it likes it or not. `insetsHandling: 'css'` is the
   * supported answer, and it is what Capacitor does by default: the shell hands
   * the insets to the page as `--safe-area-inset-*` custom properties, the page
   * reserves the room itself, and the background it reserves is the game rather
   * than a bar of system colour. See the `--safe-*` block at the top of
   * `src/ui/styles.css` for the page's half of the arrangement.
   *
   * `initialViewportFitValueHint` says what the page's own viewport declaration
   * is going to be, so the shell can decide before the document has loaded
   * rather than after one frame of the game has been laid out in the wrong
   * place. It must agree with `index.html`, which is why it is named the same
   * word — `cover` — in both.
   *
   * On iOS the insets are the platform's own and arrive through
   * `env(safe-area-inset-*)`; nothing has to be configured for them, which is
   * why this block is about Android and the stylesheet reads both.
   */
  plugins: {
    SystemBars: {
      // Light icons on the game's near-black, whatever the device's theme is:
      // the game does not follow the system's light or dark setting.
      style: 'DARK',
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
 },
};

export default config;
