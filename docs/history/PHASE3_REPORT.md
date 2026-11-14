# Phase 3 report

## sha1sum pipeline/tests/fixtures/stats_cases.json
```
before: 959ce55391a560aa6672213ff84a815f65b759b8
after : 959ce55391a560aa6672213ff84a815f65b759b8
```
## cd pipeline && .venv/bin/python make_fixtures.py (head)
```
wrote 23 cases to /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/tests/fixtures/stats_cases.json
cases with factor > 1: 4
  clean_linear_up                  n=45 slope/yr=+0.03000 s= +990 r1=+0.256 factor=1.000 p=3.862e-22
  clean_linear_down                n=45 slope/yr=-0.05000 s= -990 r1=+0.000 factor=1.000 p=3.862e-22
959ce55391a560aa6672213ff84a815f65b759b8  tests/fixtures/stats_cases.json
```
## cd pipeline && .venv/bin/python -m pytest -q
```
............                                                             [100%]
12 passed in 6.41s
```
## cd web && npm install (trimmed to 10 lines)
```

up to date, audited 152 packages in 1s

20 packages are looking for funding
  run `npm fund` for details

6 vulnerabilities (3 moderate, 1 high, 2 critical)

To address all issues (including breaking changes), run:
  npm audit fix --force
```
## cd web && npm test
```

> trend-detective-web@0.0.1 test
> vitest run


 RUN  v2.1.9 /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/web

 ✓ src/power.test.ts (8 tests) 12ms
 ✓ src/analysis.test.ts (3 tests) 35ms
 ✓ src/stats/trend.test.ts (43 tests) 483ms
   ✓ statistical behaviour > has a sane false-positive rate on white noise 402ms

 Test Files  3 passed (3)
      Tests  54 passed (54)
   Start at  10:56:00
   Duration  1.26s (transform 294ms, setup 0ms, collect 425ms, tests 530ms, environment 1ms, prepare 580ms)

```
## cd web && npm run build
```

> trend-detective-web@0.0.1 build
> tsc --noEmit && vite build

vite v5.4.21 building for production...
transforming...
✓ 169 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.40 kB │ gzip:   0.27 kB
dist/assets/index-BlFwRbch.css      4.68 kB │ gzip:   1.63 kB
dist/assets/index-MgxG7R4X.js   2,161.38 kB │ gzip: 624.84 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 8.17s
```
## Files
Created: web/src/stats/trend.ts, web/src/stats/trend.test.ts, web/src/power.ts, web/src/power.test.ts,
web/src/analysis.ts, web/src/analysis.test.ts, web/src/format.ts, web/src/Chart.tsx, web/src/Panel.tsx,
web/src/__fixtures__/power_istanbul_T2M.json, pipeline/tests/fixtures/verdict_cases.json, web/PHASE3_REPORT.md
Changed: web/src/App.tsx, web/src/Globe.tsx, web/src/styles.css, web/package.json, web/package-lock.json,
pipeline/make_fixtures.py, pipeline/tests/test_trendstats.py

## Deviations
- Istanbul CI-low per decade is 0.42499999999999982 (Python `.2f` also gives 0.42), so the displayed value is +0.42, not the +0.43 in the spec; the 3-decimal check (0.425) passes as specified.
- fetchPointSeries has an optional 5th parameter `yearRange` (default [1981, 2025]); App passes meta.years. Cache key uses cell lat/lng (unique per cell) plus the year range.
- Globe marker is a white point in pointsData; added onPointClick so clicking exactly on the marker/landmark still picks.
- erfc: Taylor series (x<1) + Lentz continued fraction (x>=1), not Cody coefficients; verified to 1e-14 relative vs scipy.
- formatLatLng moved from App.tsx to src/format.ts (App imports it).
- Annual points are plotted at x = integer year (the t used in the fit); monthly at mid-month.
