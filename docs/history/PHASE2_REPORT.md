# Phase 2 report — web scaffold + trend globe

Working directory: `REPO/web`. Installed: react 18.3.1, react-globe.gl 2.38.0, vite 5.4.21, typescript 5.9.3.

## `npm install` (last 15 lines)
```

11 packages are looking for funding
  run `npm fund` for details

2 vulnerabilities (1 moderate, 1 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   esbuild@0.21.5 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
exit 0
```

## `npx tsc --noEmit`
```
exit 0
```
(no output = no type errors)

## `npm run build`
```

> trend-detective-web@0.0.1 build
> tsc --noEmit && vite build

vite v5.4.21 building for production...
transforming...
✓ 161 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.40 kB │ gzip:   0.27 kB
dist/assets/index-BJG5B5ZA.css      0.84 kB │ gzip:   0.46 kB
dist/assets/index-C5eyEnmw.js   2,095.02 kB │ gzip: 596.16 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 5.80s
exit 0
```

## `ls -la dist dist/data`
```
dist:
total 20
drwxr-xr-x 4 osm osm 4096 Nov 14 10:43 .
drwxr-xr-x 6 osm osm 4096 Nov 14 10:43 ..
drwxr-xr-x 2 osm osm 4096 Nov 14 10:43 assets
drwxr-xr-x 2 osm osm 4096 Nov 14 10:43 data
-rw-r--r-- 1 osm osm  402 Nov 14 10:43 index.html

dist/data:
total 720
drwxr-xr-x 2 osm osm   4096 Nov 14 10:43 .
drwxr-xr-x 4 osm osm   4096 Nov 14 10:43 ..
-rw-r--r-- 1 osm osm 366415 Nov 14 10:43 T2M_landmarks.png
-rw-r--r-- 1 osm osm    653 Nov 14 10:43 T2M_meta.json
-rw-r--r-- 1 osm osm 353413 Nov 14 10:43 T2M_trend.png
```

## Files created (all under REPO/web/)
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `index.html`
- `.gitignore`
- `src/main.tsx`
- `src/App.tsx`
- `src/Globe.tsx`
- `src/data.ts`
- `src/landmarks.ts`
- `src/styles.css`
- `src/vite-env.d.ts`
- `PHASE2_REPORT.md`

Generated (not source): `node_modules/`, `dist/`. `public/data/` was not modified.

## Notes
- `exit N` lines were appended by the capture wrapper to record exit codes.
- npm warned that esbuild's postinstall was not run (allowScripts); the build still works via its platform binary package.
- The chunk-size warning is from three.js inside react-globe.gl; harmless for now.
- `window.__lastPick` is set on every click; `window.__globe` is set only in `?debug=landmarks` mode.
- Not checked in a browser (no dev server was started, as instructed).
