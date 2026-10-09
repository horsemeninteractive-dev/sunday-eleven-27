/**
 * The environment a build must run in, stated rather than inherited.
 *
 * Every tool in this directory is started with `vite-node`, and `vite-node` sets
 * `NODE_ENV=development` in its own process — which every child it spawns
 * inherits. So the build a *tool* ran was not the build a person gets by typing
 * the same command:
 *
 *     npm run build:native                    →  771,327 bytes, React production
 *     npm run android:bundle   (vite-node)    →  956,770 bytes, react-dom.development
 *
 * Two different applications from one source, and the larger, slower one — with
 * React's development build inside it, its warnings and its `NODE_ENV` branches
 * resolving the wrong way — was the one produced by the documented release
 * command. That is not a preference to be left to whoever invokes the tool: it is
 * what the artifact *is*, and what a store would ship.
 *
 * Vite reads `NODE_ENV` from the environment to decide the production build, so
 * it is set here, once, and handed to each child that builds something.
 */
export function productionBuildEnv(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...environment, NODE_ENV: 'production' };
}
