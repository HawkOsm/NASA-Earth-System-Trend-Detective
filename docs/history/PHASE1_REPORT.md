# Phase 1 report (T2M)

All commands were run from `pipeline/`, in this order. Raw stdout and stderr appear exactly as printed.

## 1. pytest (before fixtures existed: test_fixtures is expected to fail)

```
$ .venv/bin/python -m pytest -v -s tests
============================= test session starts ==============================
platform linux -- Python 3.12.13, pytest-9.2.0, pluggy-1.7.0 -- /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/.venv/bin/python
cachedir: .pytest_cache
rootdir: /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline
plugins: zarr-3.4.2
collecting ... collected 11 items

tests/test_trendstats.py::test_known_slope median slope 0.02995, CI coverage 0.955, p<0.05 rate 1.000
PASSED
tests/test_trendstats.py::test_white_noise_false_positive_rate white noise p<0.05 rate: 0.0410
PASSED
tests/test_trendstats.py::test_ar1_correction_reduces_false_positives AR(1) phi=0.6 p<0.05 rate: corrected 0.1680, uncorrected (var0) 0.2925
PASSED
tests/test_trendstats.py::test_grid_matches_1d PASSED
tests/test_trendstats.py::test_matches_pymannkendall compared 49 factor==1 series with pymannkendall
PASSED
tests/test_trendstats.py::test_matches_theilslopes PASSED
tests/test_trendstats.py::test_bh_adjust PASSED
tests/test_trendstats.py::test_verdict PASSED
tests/test_trendstats.py::test_fixtures FAILED
tests/test_trendstats.py::test_texture_orientation[41.01-28.97] (41.01,28.97) cell (41.0,28.75): centroid x=1336.00 y=313.50, expected x=1336.00 y=313.60
PASSED
tests/test_trendstats.py::test_texture_orientation[-33.87-151.21] (-33.87,151.21) cell (-34.0,151.25): centroid x=2120.00 y=793.50, expected x=2120.00 y=793.60
PASSED

=================================== FAILURES ===================================
________________________________ test_fixtures _________________________________

    def test_fixtures():
>       assert os.path.exists(FIXTURES)
E       AssertionError: assert False
E        +  where False = <function exists at 0x7faf8db6f6a0>('/home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/tests/fixtures/stats_cases.json')
E        +    where <function exists at 0x7faf8db6f6a0> = <module 'posixpath' (frozen)>.exists
E        +      where <module 'posixpath' (frozen)> = os.path

tests/test_trendstats.py:147: AssertionError
=========================== short test summary info ============================
FAILED tests/test_trendstats.py::test_fixtures - AssertionError: assert False
========================= 1 failed, 10 passed in 4.73s =========================
```

## 2. fetch

```
$ .venv/bin/python -m download.fetch T2M
variable: T2M
shape: (45, 361, 576)
min: -56.8300  max: 34.2500
NaN count: 0
lat: -90.0..90.0 (361)  lon: -180.0..179.375 (576)  years: 1981..2025 (45)
seconds: 21.8
wrote /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/cache/T2M_annual.npy
```

## 3. compute

```
$ .venv/bin/python -m maps.compute T2M
variable: T2M
seconds: 10.1
cells: 207936 finite of 207936
fraction p<0.05: 0.7167
fraction q<0.05: 0.6878
fraction factor>1: 0.2616
slope_decade min/median/max: -1.2526 / 0.1946 / 1.5098 C per decade
cos(lat)-weighted global mean slope_decade: 0.1718
wrote /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/cache/T2M_trend.npz
```

## 4. export

```
$ .venv/bin/python -m maps.export T2M
variable: T2M
vmax: 0.74 C per decade
frac_significant (q<0.05, cos-lat weighted): 0.6898
global_mean_slope_decade: 0.1718
landmark 0N 0E (0.0, 0.0) -> pixel (x=1152, y=576)
landmark Istanbul (41.01, 28.97) -> pixel (x=1337, y=313)
landmark Sydney (-33.87, 151.21) -> pixel (x=2119, y=792)
landmark New York (40.71, -74.01) -> pixel (x=678, y=315)
wrote /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/web/public/data/T2M_trend.png (2304x1152)
wrote /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/web/public/data/T2M_meta.json
wrote /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/web/public/data/T2M_landmarks.png
```

## 5. make_fixtures

```
$ .venv/bin/python -m core.make_fixtures
wrote 23 cases to /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/tests/fixtures/stats_cases.json
cases with factor > 1: 4
  clean_linear_up                  n=45 slope/yr=+0.03000 s= +990 r1=+0.256 factor=1.000 p=3.862e-22
  clean_linear_down                n=45 slope/yr=-0.05000 s= -990 r1=+0.000 factor=1.000 p=3.862e-22
  linear_noise_slope0.03_sd0.2     n=45 slope/yr=+0.03000 s= +751 r1=+0.080 factor=1.000 p=2.145e-13
  linear_noise_slope-0.02_sd0.2    n=45 slope/yr=-0.02087 s= -534 r1=+0.134 factor=1.000 p=1.814e-07
  linear_noise_slope0.01_sd0.3     n=45 slope/yr=+0.01000 s= +254 r1=-0.062 factor=1.000 p=0.0133
  linear_noise_slope-0.005_sd0.3   n=45 slope/yr=-0.00417 s= -122 r1=-0.094 factor=1.000 p=0.2364
  linear_noise_slope0.05_sd0.5     n=45 slope/yr=+0.04377 s= +599 r1=-0.144 factor=1.000 p=4.896e-09
  linear_noise_slope0.002_sd0.1    n=45 slope/yr=+0.00286 s= +232 r1=-0.076 factor=1.000 p=0.02357
  white_noise_0                    n=45 slope/yr=+0.00397 s=  +78 r1=-0.049 factor=1.000 p=0.4512
  white_noise_1                    n=45 slope/yr=+0.00240 s=  +72 r1=-0.217 factor=1.000 p=0.4871
  white_noise_2                    n=45 slope/yr=+0.00442 s=  +86 r1=+0.163 factor=1.000 p=0.4055
  ar1_phi0.6_0                     n=45 slope/yr=+0.01272 s= +254 r1=+0.603 factor=2.126 p=0.0894
  ar1_phi0.6_1                     n=45 slope/yr=-0.00318 s=  -58 r1=+0.664 factor=2.240 p=0.7094
  ar1_phi0.6_2                     n=45 slope/yr=+0.00000 s=  +10 r1=+0.520 factor=1.970 p=0.95
  ar1_phi0.6_3                     n=45 slope/yr=-0.00013 s=  -16 r1=+0.082 factor=1.000 p=0.8832
  ar1_phi0.6_with_trend            n=45 slope/yr=-0.00129 s=  -34 r1=+0.363 factor=1.677 p=0.8031
  tied_round0.1_up                 n=45 slope/yr=+0.00667 s= +417 r1=-0.223 factor=1.000 p=3.166e-05
  tied_round0.1_noise              n=45 slope/yr=+0.00000 s=   +9 r1=-0.035 factor=1.000 p=0.9364
  constant                         n=45 slope/yr=+0.00000 s=   +0 r1=+0.000 factor=1.000 p=1
  many_zeros_precip                n=45 slope/yr=+0.00000 s= +106 r1=-0.082 factor=1.000 p=0.1978
  many_zeros_precip_trend          n=45 slope/yr=+0.00000 s= +129 r1=+0.091 factor=1.000 p=0.192
  short_n10                        n=10 slope/yr=+0.04333 s=  +33 r1=-0.207 factor=1.000 p=0.004208
  medium_n30                       n=30 slope/yr=-0.02579 s= -281 r1=-0.054 factor=1.000 p=5.725e-07
```

## 6. pytest (final run)

```
$ .venv/bin/python -m pytest -v -s tests
============================= test session starts ==============================
platform linux -- Python 3.12.13, pytest-9.2.0, pluggy-1.7.0 -- /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline/.venv/bin/python
cachedir: .pytest_cache
rootdir: /home/osm/Projects/Heckathon/NASA-Earth-System-Trend-Detective/pipeline
plugins: zarr-3.4.2
collecting ... collected 11 items

tests/test_trendstats.py::test_known_slope median slope 0.02995, CI coverage 0.955, p<0.05 rate 1.000
PASSED
tests/test_trendstats.py::test_white_noise_false_positive_rate white noise p<0.05 rate: 0.0410
PASSED
tests/test_trendstats.py::test_ar1_correction_reduces_false_positives AR(1) phi=0.6 p<0.05 rate: corrected 0.1680, uncorrected (var0) 0.2925
PASSED
tests/test_trendstats.py::test_grid_matches_1d PASSED
tests/test_trendstats.py::test_matches_pymannkendall compared 49 factor==1 series with pymannkendall
PASSED
tests/test_trendstats.py::test_matches_theilslopes PASSED
tests/test_trendstats.py::test_bh_adjust PASSED
tests/test_trendstats.py::test_verdict PASSED
tests/test_trendstats.py::test_fixtures PASSED
tests/test_trendstats.py::test_texture_orientation[41.01-28.97] (41.01,28.97) cell (41.0,28.75): centroid x=1336.00 y=313.50, expected x=1336.00 y=313.60
PASSED
tests/test_trendstats.py::test_texture_orientation[-33.87-151.21] (-33.87,151.21) cell (-34.0,151.25): centroid x=2120.00 y=793.50, expected x=2120.00 y=793.60
PASSED

============================== 11 passed in 7.43s ==============================
```

