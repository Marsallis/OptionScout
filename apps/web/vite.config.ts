import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@optionscout/shared': path.resolve(root, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Opt-in only. The API still refuses non-loopback changes. Default dev hosts stay strict.
    allowedHosts: process.env.OPTIONSCOUT_DEV_HOSTS === 'any' ? true : ['127.0.0.1', 'localhost'],
    proxy: {
      '/api': 'http://127.0.0.1:3180',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // A GitHub runner can spend 4–6s in one MUI interaction. Vitest's 5s default then fails the test before its assertion.
    testTimeout: 15_000,
  },
});
