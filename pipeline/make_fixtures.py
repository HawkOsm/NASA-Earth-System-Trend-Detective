"""Write tests/fixtures/stats_cases.json: reference cases computed with trend_1d."""
import json
import os

import numpy as np

from trendstats import KEYS, trend_1d

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "fixtures", "stats_cases.json")


def ar1(rng, n, phi, sd):
    e = np.empty(n)
    e[0] = rng.normal(0, sd / np.sqrt(1 - phi ** 2))
    for k in range(1, n):
        e[k] = phi * e[k - 1] + rng.normal(0, sd)
    return e


def years(n):
    return np.arange(1981, 1981 + n, dtype=np.float64)


def build_cases():
    rng = np.random.default_rng(20240601)
    t = years(45)
    x = t - t.mean()
    cases = []

    def add(name, tt, y):
        cases.append((name, tt, np.round(np.asarray(y, dtype=np.float64), 2)))

    add("clean_linear_up", t, 14.0 + 0.03 * x)
    add("clean_linear_down", t, 5.0 - 0.05 * x)
    for slope, sd in [(0.03, 0.2), (-0.02, 0.2), (0.01, 0.3), (-0.005, 0.3), (0.05, 0.5), (0.002, 0.1)]:
        add(f"linear_noise_slope{slope}_sd{sd}", t, 10.0 + slope * x + rng.normal(0, sd, 45))
    for k in range(3):
        add(f"white_noise_{k}", t, 20.0 + rng.normal(0, 0.4, 45))
    for k in range(4):
        add(f"ar1_phi0.6_{k}", t, 15.0 + ar1(rng, 45, 0.6, 0.3))
    add("ar1_phi0.6_with_trend", t, 15.0 + 0.01 * x + ar1(rng, 45, 0.6, 0.3))
    add("tied_round0.1_up", t, np.round(3.0 + 0.01 * x + rng.normal(0, 0.15, 45), 1))
    add("tied_round0.1_noise", t, np.round(3.0 + rng.normal(0, 0.15, 45), 1))
    add("constant", t, np.full(45, 7.25))
    rain = np.where(rng.random(45) < 0.6, 0.0, rng.gamma(0.8, 0.5, 45))
    add("many_zeros_precip", t, rain)
    rain2 = np.where(rng.random(45) < 0.4, 0.0, rng.gamma(1.0, 0.3, 45) + 0.004 * (t - t[0]))
    add("many_zeros_precip_trend", t, rain2)
    t10 = years(10)
    add("short_n10", t10, 1.0 + 0.04 * (t10 - t10.mean()) + rng.normal(0, 0.1, 10))
    t30 = years(30)
    add("medium_n30", t30, 1.0 - 0.02 * (t30 - t30.mean()) + rng.normal(0, 0.2, 30))
    return cases


def main():
    out = []
    for name, t, y in build_cases():
        r = trend_1d(y, t)
        out.append({"name": name, "t": [float(v) for v in t], "y": [float(v) for v in y],
                    "expected": {k: float(r[k]) for k in KEYS}})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    nf = sum(c["expected"]["factor"] > 1 for c in out)
    print(f"wrote {len(out)} cases to {OUT}")
    print(f"cases with factor > 1: {nf}")
    for c in out:
        e = c["expected"]
        print(f"  {c['name']:<32} n={len(c['y']):2d} slope/yr={e['slope']:+.5f} s={e['s']:+5.0f} "
              f"r1={e['r1']:+.3f} factor={e['factor']:.3f} p={e['p']:.4g}")


if __name__ == "__main__":
    main()
