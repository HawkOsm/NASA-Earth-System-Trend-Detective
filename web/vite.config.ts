import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from a GitHub Pages sub-path, so all asset URLs must be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
});
