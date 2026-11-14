import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Short content hash of every file under public/data, keyed by its path inside data/. */
function dataVersions(): Record<string, string> {
  const root = join(__dirname, 'public', 'data');
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p).split('\\').join('/')] = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8);
    }
  };
  walk(root);
  return out;
}

// Served from a GitHub Pages sub-path, so all asset URLs must be relative.
// Data URLs carry ?v=<content hash> (see dataUrl) so the service worker can cache them as immutable.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __DATA_VERSIONS__: JSON.stringify(dataVersions()) },
});
