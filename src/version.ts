/**
 * What version of the game is running.
 *
 * The number comes from `package.json` at build time (the bundler replaces
 * `__APP_VERSION__` with it), so there is exactly one place a version is ever
 * written down and no chance of the screen and the package disagreeing.
 *
 * The game is a beta, and semantic versioning says so without anyone having to
 * remember: below 1.0.0 the minor number carries features and the patch carries
 * fixes, and 1.0.0 means it is finished. Until then it says beta, which is
 * honest about saves, balance and the fact that things still move.
 */

declare const __APP_VERSION__: string;

export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** Whether a version is still a beta, by the only rule that needs applying. */
export function isBeta(version: string): boolean {
  return version.split('.')[0] === '0';
}

/** How the version is written wherever the manager can see it. */
export function versionLabel(version: string = VERSION): string {
  return `v${version}${isBeta(version) ? ' beta' : ''}`;
}
