import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import pkg from './package.json';

/**
 * Every file the build produces, written into the service worker.
 *
 * The worker is what makes the game playable with no signal, and that promise
 * is kept by caching everything the build emits rather than a hand-kept list of
 * it. A hand-written list was here once and was wrong within a day: it is a
 * thing that has to be updated by hand every time a file is added, and the only
 * time anyone notices it is stale is when a manager opens the game on a train
 * and a screen he has never opened fails to load. So the list is generated
 * instead, from what was actually written to disk.
 *
 * This is also what makes it safe to split the bundle. Lazy chunks and offline
 * play pull in opposite directions — a screen whose code has not been fetched
 * yet cannot run without a network — and precaching every chunk settles it: the
 * split decides *when* a screen's code is needed, not whether it is available.
 *
 * The worker is written as a plain file in public/ with a placeholder where the
 * list belongs, and this rewrites the built copy. The placeholder is not left to
 * fall back on, because a fallback here means silently shipping an offline game
 * that is not: if the placeholder is missing from the output, the build fails.
 */
function precacheManifest(): Plugin {
  const SENTINEL = 'self.__PRECACHE__';
  const REPLACEMENT = /self\.__PRECACHE__/;

  return {
    name: 'se27:precache-manifest',
    apply: 'build',
    // closeBundle rather than generateBundle: by this point every file is on
    // disk, including the ones Vite copied out of public/, which is what the
    // manifest has to be built from.
    closeBundle() {
      const outDir = join(process.cwd(), 'dist');
      const workerPath = join(outDir, 'sw.js');

      let worker: string;
      try {
        worker = readFileSync(workerPath, 'utf8');
      } catch {
        throw new Error('precache-manifest: dist/sw.js is missing. Is public/sw.js still there?');
      }

      if (!REPLACEMENT.test(worker)) {
        throw new Error(
          `precache-manifest: dist/sw.js has no ${SENTINEL} placeholder for the asset list to go in. ` +
            'The worker must keep that line, or it ships with nothing to precache.',
        );
      }

      // Everything the build wrote, except the worker itself (which is fetched
      // fresh on every visit by design) and _headers (which is configuration
      // for the edge, not something a browser ever asks for).
      //
      // og.png is excluded for the same kind of reason, and because it is the
      // only large file in the build that the game itself never requests: it
      // exists so that a chat app has something to show when somebody pastes
      // the link, and no browser running Sunday Eleven will ever ask for it.
      // Precaching it would put roughly half a megabyte into every player's
      // offline install for a picture they will never see — the same trade the
      // ground photograph was compressed to avoid.
      const skip = new Set(['sw.js', '_headers', '.DS_Store', 'og.png']);
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          if (skip.has(entry)) continue;
          const path = join(dir, entry);
          if (statSync(path).isDirectory()) walk(path);
          else files.push('/' + relative(outDir, path).split(sep).join('/'));
        }
      };
      walk(outDir);

      // The shell a cold install needs even before it has the manifest, and
      // '/' because a navigation to the site root is not always index.html.
      const manifest = Array.from(new Set(['/', '/index.html', ...files])).sort();

      writeFileSync(workerPath, worker.replace(REPLACEMENT, JSON.stringify(manifest)));

      console.log(
        `\n  precache-manifest: ${manifest.length} files, ` +
          `${(manifest.reduce((sum, f) => sum + f.length, 0) / 1024).toFixed(1)} KB of paths\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  // The version is written down once, in package.json, and reaches the game
  // from here — so the changelog, the menu and the package can never disagree
  // about which build this is.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
  },
  build: {
    rollupOptions: {
      output: {
        // React changes on a different schedule to this game: a release of the
        // game should not invalidate 130 KB of framework that has not moved.
        // Splitting it out means a deploy re-downloads the game's own code and
        // leaves the framework in the cache, which is the part of the bundle
        // most likely to still be sitting there.
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react';
          }
          if (id.includes('node_modules/zustand') || id.includes('node_modules/scheduler')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});