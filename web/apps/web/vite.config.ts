import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Defaults to loopback. The container overrides this with --host 0.0.0.0
    // so Docker can reach it, while the compose file still publishes the port
    // only on 127.0.0.1.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin API calls in local development, so the session cookie and
    // the trusted Origin behave as they will behind the production proxy.
    // The Origin header is preserved, never rewritten.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
