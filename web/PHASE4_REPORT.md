# Phase 4 report

## Files
Created (web/src): demos.ts, flatmap.ts, legend.ts, coastlines.ts, Picker.tsx, Legend.tsx, Demos.tsx, HowToRead.tsx,
FlatMap.tsx, GlobeArea.tsx (WebGL test + error boundary), phase4.test.ts.
Changed: src/App.tsx, src/Globe.tsx, src/styles.css, index.html (favicon, title), package.json, package-lock.json
(added world-atlas, topojson-client, @types/topojson-client). public/data, pipeline, .github untouched.

## Results
npm test: 4 files, 62 tests passed. npm run build: tsc clean, vite build OK (chunk-size warning only).

## Verified
Flat mode (?flat=1) in the dev server: __setVariable, __runDemo(1) -> Manila cell 14.5N 121.25E, PRECTOTCORR,
+1.08 mm/day/decade, p 6.7e-8; subtitle, legend, title, white dot, panel all update.

## Deviations / untested
- window.__globe is now always exposed (previously only with ?debug=landmarks).
- Camera fly via a flyRef set in Globe onGlobeReady (pointOfView(v, 1500)).
- NOT verified (no WebGL here): globe texture swap, coastline drawing and antimeridian handling on the globe,
  onPathClick routing (implemented via onPathClick -> onPick with coords), camera fly, globe resize beside panel
  at >=1100px (CSS: .globe-wrap.has-panel .globe-area { right: 400px }), WebGL error boundary.
- Coastlines are the mesh of land-110m; segments along the +-180 seam / south pole are dropped (unit tested).
- Legend zero tick is "0"; other ticks carry +/- signs.
