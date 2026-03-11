import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@tron/shared': '../shared/src/index.ts' } },
});
