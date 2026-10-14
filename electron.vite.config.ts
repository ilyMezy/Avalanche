import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const shared = { '@shared': resolve('src/shared') }

// Production pages are loaded from file://, where response headers cannot carry a CSP,
// so the policy is injected into index.html at build time. In development the Vite dev
// server needs inline scripts and a websocket for HMR, so no meta tag is added there and
// the main process blocks non-local network requests instead (see main/app/security.ts).
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'offline-workspace-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`
      )
    }
  }
}

export default defineConfig({
  // Everything is minified: less to read from disk and less to parse at every launch.
  main: {
    resolve: { alias: shared },
    build: { minify: 'esbuild' }
  },
  preload: {
    resolve: { alias: shared },
    // A sandboxed preload can only require 'electron', so everything else is bundled in.
    build: { minify: 'esbuild', externalizeDeps: false, rollupOptions: { external: ['electron'] } }
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    build: { minify: 'esbuild' },
    plugins: [react(), tailwindcss(), cspPlugin()]
  }
})
