import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@vto/core': resolve(import.meta.dirname, 'packages/core/src'),
      '@vto/render': resolve(import.meta.dirname, 'packages/render/src'),
      '@vto/engine': resolve(import.meta.dirname, 'packages/engine/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
  },
});
