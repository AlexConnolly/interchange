import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // The tunnel serves this on a *.trycloudflare.com host, which Vite's
    // default host check rejects. Allowing the whole domain is fine for a
    // playtest link and nothing else is exposed.
    allowedHosts: ['.trycloudflare.com', '.cfargotunnel.com', 'localhost'],
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: ['.trycloudflare.com', '.cfargotunnel.com', 'localhost'],
  },
  build: {
    target: 'es2022',
    // Three and the sim are both large and change at different rates; keeping
    // them apart means a sim edit does not invalidate the renderer bundle.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  esbuild: { target: 'es2022' },
});
