import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

let gitBranch = process.env.GIT_BRANCH || '';
if (!gitBranch) {
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {}
}

export default defineConfig({
  build: {
    target: 'es2020',
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_ENV__: JSON.stringify(process.env.VITE_APP_ENV || 'production'),
    __GIT_BRANCH__: JSON.stringify(gitBranch),
  },
});
