import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dev-server port and the API it proxies to are configurable, and the
// DEFAULTS ARE UNCHANGED: 3000 and http://localhost:5000. A learner following
// the README sets nothing and sees exactly what the README describes.
//
// They exist for one situation: an instructor workstation already running the
// main POSTURE platform, which owns 3000, 8001, 5432, 6379, 8080 and 2000.
// Before this, the proxy target was hardcoded, so moving the lab API off 5000
// meant editing a tracked file on the teaching branch — and leaving it on 5000
// meant `listen EADDRINUSE :::5000` the moment both stacks ran together.
//
//   LAB_FRONTEND_PORT   host port for the Vite dev server   (default 3000)
//   LAB_API_TARGET      where /api is proxied               (default localhost:5000)
//
// See docker-compose.demo.yml for the instructor port band (3900/5900/55900).
//
// WHY loadEnv, AND NOT process.env
// ---------------------------------
// Vite does NOT copy .env files into process.env. It parses them itself and
// exposes only `VITE_`-prefixed keys to CLIENT code via import.meta.env; this
// config module is evaluated by Node, which sees nothing but what the shell
// exported. So reading process.env here meant a frontend/.env holding
// LAB_FRONTEND_PORT=3900 was silently ignored and the 3000 default won — the
// values were right, the delivery mechanism was not, and the only way to make
// it work was to export the variables on every command.
//
// `loadEnv(mode, dir, '')` is Vite's supported mechanism. The empty prefix is
// required: the default is `VITE_`, which would not match these names. It does
// NOT expose them to the browser — client exposure is governed separately by
// `envPrefix` (still the default `VITE_`), and nothing here is placed in
// `define`. These are dev-server settings, not application configuration.
//
// Precedence is Vite's own and is deliberate: a value exported on the command
// line still beats frontend/.env, so
// `LAB_FRONTEND_PORT=3900 npm run dev` keeps working as documented.

/** Learner defaults. A clean machine needs no configuration at all. */
export const LEARNER_DEFAULTS = Object.freeze({
  port: 3000,
  apiTarget: 'http://localhost:5000',
});

/**
 * Resolve the dev-server settings from an already-loaded environment.
 *
 * Pure and separated from the config so it can be asserted directly: the bug
 * this replaces was invisible precisely because the resolution was tangled up
 * with where the values came from.
 */
export function resolveLabServer(env = {}) {
  // Number('') and Number(undefined) are 0 and NaN, both falsy, so a blank or
  // absent value falls through to the default rather than binding port 0.
  const port = Number(env.LAB_FRONTEND_PORT) || LEARNER_DEFAULTS.port;
  const apiTarget = env.LAB_API_TARGET || LEARNER_DEFAULTS.apiTarget;
  return { port, apiTarget };
}

// The config's own directory, so frontend/.env is found regardless of the
// directory vite was invoked from.
const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, CONFIG_DIR, '');
  const { port, apiTarget } = resolveLabServer(env);

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port,
      // Fail loudly instead of silently sliding to the next free port: a demo
      // that quietly moves to 3001 is a demo whose URL no longer matches the
      // one on the projector.
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port,
      strictPort: true,
    },
  };
});
