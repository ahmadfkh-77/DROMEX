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
  },
});
