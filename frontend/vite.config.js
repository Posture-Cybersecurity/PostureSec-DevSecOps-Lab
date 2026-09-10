import { defineConfig } from 'vite';
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
const PORT = Number(process.env.LAB_FRONTEND_PORT) || 3000;
const API_TARGET = process.env.LAB_API_TARGET || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: PORT,
    // Fail loudly instead of silently sliding to the next free port: a demo
    // that quietly moves to 3001 is a demo whose URL no longer matches the
    // one on the projector.
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: PORT,
    strictPort: true,
  },
});
