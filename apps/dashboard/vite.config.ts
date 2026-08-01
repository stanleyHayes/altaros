import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  // @altar-os/permissions is a source-only workspace package, so its React
  // imports are resolved in THIS app's graph. The workspace carries two React
  // versions (the root has 19.2.3, pinned by the mobile app; this app has
  // 19.2.8), and without deduping the bundle can end up with both — which
  // breaks every hook in the shared package.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
});
