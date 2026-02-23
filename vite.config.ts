import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  build: {
    target: 'es2020',
  },
  define: {
    __TURN_WORKER_URL__: JSON.stringify(process.env.TURN_WORKER_URL || ''),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
