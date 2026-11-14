"""R3 experiments: can MERRA-2's trend estimate be made to agree better with the independent records?

Run from pipeline/:   .venv/bin/python experiments/trend_experiments.py
Reads only pipeline/cache/reference_{T2M,PRECTOTCORR}.npz. Writes nothing (stdout only; tee it if wanted).
The yardstick is the independent record (GISTEMP on land, GPCP); every experiment reports the same numbers.
"""
import math
import os
import sys
import time

import numpy as np
from scipy.stats import mannwhitneyu

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import config  # noqa: E402
import quality  # noqa: E402
import reference as ref  # noqa: E402
from trendstats import trend_1d  # noqa: E402

T0 = time.time()
VARS = ("T2M", "PRECTOTCORR")
YEARS = np.array(config.YEARS, dtype=np.float64)


# ------------------------------------------------------------------ data
def load(var):
    z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    lat0, dlat, nlat, lon0, dlon, nlon = ref.reference_grid(var)
    blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
    el = ref.eligible_mask(var, z["used"], z["land"]) == 1
    return dict(var=var, M=z["M"], R=z["R"], used=z["used"], land=z["land"].astype(bool), el=el, blat=blat,
                w=np.cos(np.radians(blat)), nlat=nlat, nlon=nlon, z=z)


def tr(y, t, minn=10):
    """(slope, lo, hi, p, r1) per DECADE for the valid years of y (trendstats.trend_1d)."""
    ok = np.isfinite(y)
    if ok.sum() < minn:
        return (np.nan,) * 5
    r = trend_1d(y[ok], t[ok])
    return r["slope"] * 10, r["ci_low"] * 10, r["ci_high"] * 10, r["p"], r["r1"]


def trends(mat, idx, years=YEARS, mask=None, minn=10):
    """mat [45][nb]; for boxes idx -> dict of arrays (nb) slope/lo/hi/p/r1; mask = bool over years to use."""
    out = np.full((5, mat.shape[1]), np.nan)
    for b in idx:
        y = mat[:, b] if mask is None else np.where(mask, mat[:, b], np.nan)
        out[:, b] = tr(y, years, minn)
    return dict(zip(("s", "lo", "hi", "p", "r1"), out))


# ------------------------------------------------------------------ yardstick
def yard(w, m, r, sel):
    """m, r: dict s/lo/hi/p; sel bool. Returns the five numbers (+ counts and significant shares)."""
    sel = sel & np.isfinite(m["s"]) & np.isfinite(r["s"])
    ww = w[sel]
    d = m["s"][sel] - r["s"][sel]
    same = np.sign(m["s"][sel]) == np.sign(r["s"][sel])
    agree = (m["lo"][sel] <= r["hi"][sel]) & (r["lo"][sel] <= m["hi"][sel])
    msig, rsig = m["p"][sel] < 0.05, r["p"][sel] < 0.05
    both = msig & rsig & same
    sh = lambda a, b: float(a / b) if b > 0 else float("nan")  # noqa: E731
    return dict(n=int(sel.sum()), rmse=math.sqrt(float((ww * d * d).sum() / ww.sum())),
                same=sh(ww[same].sum(), ww.sum()), agree=sh(ww[agree].sum(), ww.sum()),
                prec=sh(ww[both].sum(), ww[msig].sum()), rec=sh(ww[both].sum(), ww[rsig].sum()),
                msig=sh(ww[msig].sum(), ww.sum()), rsig=sh(ww[rsig].sum(), ww.sum()))


HDR = f"{'variant':44s} {'boxes':>6s} {'RMSE':>7s} {'sameSgn':>8s} {'AGREE':>7s} {'PREC':>7s} {'RECALL':>7s} {'M sig':>7s} {'R sig':>7s}"


def line(label, y):
    return (f"{label:44s} {y['n']:6d} {y['rmse']:7.3f} {y['same']:8.3f} {y['agree']:7.3f} {y['prec']:7.3f} "
            f"{y['rec']:7.3f} {y['msig']:7.3f} {y['rsig']:7.3f}")


def sections(D):
    """[(title, selection bool)] for a data dict with keys el, land."""
    if D["var"] == "T2M":
        return [("T2M, land boxes (eligible)", D["el"])]
    return [("PRECTOTCORR, all eligible boxes (|lat|<60)", D["el"]),
            ("PRECTOTCORR, land", D["el"] & D["land"]), ("PRECTOTCORR, ocean", D["el"] & ~D["land"])]


def report_rows(D, rows):
    """rows: [(label, m, r)] -> prints one table per section, with all rows."""
    for title, sel in sections(D):
        print(f"\n  [{title}]  (RMSE in {'C' if D['var'] == 'T2M' else 'mm/day'} per decade; shares are cos-lat area shares; "
              f"PREC/RECALL as defined in the task)")
        print("  " + HDR)
        for label, m, r in rows:
            print("  " + line(label, yard(D["w"], m, r, sel)))


# ------------------------------------------------------------------ baseline
def baseline(D):
    z = D["z"]
    m = dict(s=z["merraSlope"], lo=z["merraLo"], hi=z["merraHi"], p=z["merraP"])
    r = dict(s=z["refSlope"], lo=z["refLo"], hi=z["refHi"], p=z["refP"])
    return m, r


def full_trends(D, idx):
    """MERRA-2 and reference trends recomputed here over each series' own valid years (for r1 and checking)."""
    return trends(D["M"], idx), trends(D["R"], idx)


def qualities(D, idx):
    out = {}
    for b in idx:
        y = D["M"][:, b]
        ok = np.isfinite(y)
        out[b] = quality.quality_1d(y[ok], YEARS[ok])
    return out


def confirmed(m, r):
    sig = m["p"] < 0.05
    c = sig & (r["p"] < 0.05) & (np.sign(r["s"]) == np.sign(m["s"]))
    return sig, c


# ------------------------------------------------------------------ E1
def e1(D, m, r, Q):
    print("\n" + "=" * 110 + f"\nE1 [{D['var']}]: do the pattern grades predict confirmation?\n" + "=" * 110)
    idx = np.flatnonzero(D["el"])
    sig, conf = confirmed(m, r)
    groups = [("land", D["land"]), ("ocean", ~D["land"])] if D["var"] != "T2M" else [("land", D["land"])]
    for gname, gsel in [("all eligible", np.ones(len(sig), bool))] + groups:
        S = sig & D["el"] & gsel
        if S.sum() == 0:
            continue
        wS = D["w"][S].sum()
        print(f"\n  [{D['var']}, {gname}] among boxes where MERRA-2 is significant: {int(S.sum())} boxes, "
              f"confirmed share of area (all) = {D['w'][S & conf].sum() / wS:.3f}")
        print(f"  {'group':34s} {'boxes':>6s} {'area%':>7s} {'confirmed%':>11s} {'contradicted%':>14s}")
        sl = np.array([Q[b]["grade"] if b in Q else "?" for b in range(len(sig))])
        items = [(f"grade {g}", sl == g) for g in ("robust", "caution", "doubtful")]
        for fl, nm in (("step", "STEP"), ("oneYear", "ONE_YEAR"), ("reversal", "REVERSAL"), ("endSensitive", "END_SENSITIVE")):
            fv = np.array([Q[b]["flags"][fl] if b in Q else False for b in range(len(sig))])
            items += [(f"{nm} set", fv), (f"{nm} not set", ~fv)]
        for lab, g in items:
            s2 = S & g
            if s2.sum() == 0:
                print(f"  {lab:34s} {0:6d}")
                continue
            contra = s2 & (r["p"] < 0.05) & (np.sign(r["s"]) != np.sign(m["s"]))
            print(f"  {lab:34s} {int(s2.sum()):6d} {100 * D['w'][s2].sum() / wS:7.1f} "
                  f"{100 * D['w'][s2 & conf].sum() / D['w'][s2].sum():11.1f} {100 * D['w'][contra].sum() / D['w'][s2].sum():14.1f}")


# ------------------------------------------------------------------ E2
def pet_p(K, n):
    return min(1.0, 2.0 * math.exp(-6.0 * K * K / (n ** 3 + n ** 2)))


def step_adjust(y, t, q, variant):
    """Returns (adjusted y, adjusted?)."""
    n = len(y)
    if variant == "a":
        if not q["flags"]["step"]:
            return y, False
        k, size = q["kStar"], q["stepSize"]
    elif variant == "b":
        k = q["kStar"]
        if not (q["pPettitt"] < 0.05 and quality.MIN_PART - 1 <= k <= n - quality.MIN_PART - 1):
            return y, False
        size = float(np.median(y[k + 1:]) - np.median(y[:k + 1]))
    else:  # c / c2: fixed candidate first-years-after
        best = None
        for cy in (1998, 1999, 2004, 2005, 2006):
            k = int(np.searchsorted(t, cy)) - 1          # index of the last year of the first part
            if not (quality.MIN_PART - 1 <= k <= n - quality.MIN_PART - 1) or t[k + 1] != cy:
                continue
            sz = float(np.median(y[k + 1:]) - np.median(y[:k + 1]))
            if best is None or abs(sz) > abs(best[1]):
                best = (k, sz)
        if best is None:
            return y, False
        k, size = best
        a, b = y[:k + 1], y[k + 1:]
        if variant == "c":   # Pettitt-style statistic at the fixed split (conservative: no max over splits)
            U = float(np.sum(np.sign(b[None, :] - a[:, None])))
            p = pet_p(abs(U), n)
        else:                # c2: ordinary Mann-Whitney at the fixed split
            p = float(mannwhitneyu(b, a, alternative="two-sided", method="asymptotic").pvalue)
        if p >= 0.05:
            return y, False
    out = y.copy()
    out[k + 1:] -= size
    return out, True


def e2(D, m, r, Q):
    print("\n" + "=" * 110 + f"\nE2 [{D['var']}]: jump-adjusted MERRA-2 trend (reference unchanged)\n" + "=" * 110)
    idx = np.flatnonzero(D["el"])
    rows = [("baseline (MERRA-2 as is)", m, r)]
    names = {"a": "a: STEP flag set -> remove step", "b": "b: Pettitt p<.05 alone -> remove step",
             "c": "c: obs-system years, Pettitt-style p<.05", "c2": "c2 (extra): obs-system years, Mann-Whitney p<.05"}
    counts = {}
    for v in ("a", "b", "c", "c2"):
        res = {k: np.full(len(D["el"]), np.nan) for k in ("s", "lo", "hi", "p")}
        na = 0
        for b in idx:
            y = D["M"][:, b]
            ok = np.isfinite(y)
            ya, adj = step_adjust(y[ok], YEARS[ok], Q[b], v)
            na += adj
            if adj:
                t_ = trend_1d(ya, YEARS[ok])
                vals = (t_["slope"] * 10, t_["ci_low"] * 10, t_["ci_high"] * 10, t_["p"])
            else:
                vals = (m["s"][b], m["lo"][b], m["hi"][b], m["p"][b])
            for k, vv in zip(("s", "lo", "hi", "p"), vals):
                res[k][b] = vv
        counts[v] = na
        rows.append((names[v], res, r))
    report_rows(D, rows)
    msig = D["el"] & (m["p"] < 0.05)
    print(f"\n  boxes adjusted (of {len(idx)} eligible; of those MERRA-2-significant at baseline: {int(msig.sum())}): "
          + ", ".join(f"{v}: {counts[v]}" for v in counts))


# ------------------------------------------------------------------ E3
def e3(D):
    print("\n" + "=" * 110 + f"\nE3 [{D['var']}]: later start year (both records recomputed on the same, common years)\n" + "=" * 110)
    idx = np.flatnonzero(D["el"])
    rows = []
    for y0 in (1981, 1990, 2000, 2005):
        mask = YEARS >= y0
        both = np.isfinite(D["M"]) & np.isfinite(D["R"])
        Mx = np.where(both, D["M"], np.nan)
        Rx = np.where(both, D["R"], np.nan)
        m = trends(Mx, idx, mask=mask, minn=15)
        r = trends(Rx, idx, mask=mask, minn=15)
        rows.append((f"{y0}-2025 ({int(mask.sum())} yr)", m, r))
    report_rows(D, rows)


# ------------------------------------------------------------------ E4
def siegel(y, t):
    n = len(y)
    s = (y[None, :] - y[:, None]) / (t[None, :] - t[:, None] + np.eye(n))
    np.fill_diagonal(s, np.nan)
    return float(np.median(np.nanmedian(s, axis=1)))


def ols(y, t):
    return float(np.polyfit(t, y, 1)[0])


def e4(D, m, r):
    print("\n" + "=" * 110 + f"\nE4 [{D['var']}]: slope estimator (significance test = current Mann-Kendall p, unchanged)\n" + "=" * 110)
    idx = np.flatnonzero(D["el"])
    rows = []
    for name, fn in (("Theil-Sen (current)", None), ("Ordinary least squares", ols), ("Siegel repeated medians", siegel)):
        res = []
        for mat, base in ((D["M"], m), (D["R"], r)):
            o = {k: base[k].copy() for k in ("s", "lo", "hi", "p")}
            if fn is not None:
                for b in idx:
                    y = mat[:, b]
                    ok = np.isfinite(y)
                    s = fn(y[ok], YEARS[ok]) * 10
                    # CI = Sen CI shifted so its offsets around the estimate are the same as around the Sen slope
                    o["lo"][b] = s + (base["lo"][b] - base["s"][b])
                    o["hi"][b] = s + (base["hi"][b] - base["s"][b])
                    o["s"][b] = s
            res.append(o)
        rows.append((name, res[0], res[1]))
    report_rows(D, rows)
    print("  (AGREE for OLS / Siegel: the Sen interval shifted to centre on the estimator's slope; PREC/RECALL use the "
          "unchanged Mann-Kendall p, so they are identical across rows and only the sign term can differ)")


# ------------------------------------------------------------------ E5
def blocks(D, k):
    """Average the eligible boxes into k x k blocks identically for both records. Returns a data dict for the blocks."""
    nlat, nlon = D["nlat"], D["nlon"]
    ids = np.arange(nlat * nlon).reshape(nlat, nlon)
    Ms, Rs, ws, lats, lands = [], [], [], [], []
    allw = D["w"].reshape(nlat, nlon)
    for i0 in range(0, nlat, k):
        for j0 in range(0, nlon, k):
            bi = ids[i0:i0 + k, j0:j0 + k].ravel()
            tot = D["w"][bi].sum()
            es = bi[D["el"][bi]]
            if len(es) == 0 or D["w"][es].sum() < 0.5 * tot:
                continue
            w = D["w"][es]
            okyr = np.isfinite(D["M"][:, es]).all(axis=1) & np.isfinite(D["R"][:, es]).all(axis=1)
            if okyr.sum() < ref.MIN_VALID:
                continue
            Ms.append(np.where(okyr, (D["M"][:, es] * w).sum(axis=1) / w.sum(), np.nan))
            Rs.append(np.where(okyr, (D["R"][:, es] * w).sum(axis=1) / w.sum(), np.nan))
            ws.append(tot)
            lats.append(float((D["blat"][bi] * D["w"][bi]).sum() / tot))
            lands.append(D["w"][es][D["land"][es]].sum() >= 0.5 * w.sum())
    nb = len(ws)
    B = dict(var=D["var"], M=np.array(Ms).T, R=np.array(Rs).T, w=np.array(ws), el=np.ones(nb, bool),
             land=np.array(lands), blat=np.array(lats))
    return B


def e5(D, m, r):
    print("\n" + "=" * 110 + f"\nE5 [{D['var']}]: scale (boxes averaged into blocks, both records identically, eligible boxes only)\n" + "=" * 110)
    for k, km in ((1, "250 km"), (2, "500 km"), (4, "1000 km")):
        if k == 1:
            B = D
            mm, rr = m, r
        else:
            B = blocks(D, k)
            idx = range(B["M"].shape[1])
            mm, rr = trends(B["M"], idx, minn=ref.MIN_VALID), trends(B["R"], idx, minn=ref.MIN_VALID)
        print(f"\n  ---- {k}x{k} boxes (~{km}): {len(B['w'])} units ----")
        report_rows(B, [(f"{k}x{k} blocks", mm, rr)])


# ------------------------------------------------------------------ E6
def conditions(F, w):
    """Candidate single conditions (bool arrays over the significant boxes), chosen without using the label."""
    C = {}
    for nm in ("step", "oneYear", "reversal", "endSensitive"):
        C[f"{nm} set"] = F[nm]
        C[f"{nm} not set"] = ~F[nm]
    C["grade robust"] = F["grade"] == "robust"
    C["grade not robust"] = F["grade"] != "robust"
    C["grade doubtful"] = F["grade"] == "doubtful"
    for nm, key in (("|slope|/CIwidth", "ratio"), ("lag-1 autocorr", "r1")):
        for q in (10, 25, 50, 75, 90):
            thr = float(np.percentile(F[key], q))
            C[f"{nm} > {thr:.2f} (p{q})"] = F[key] > thr
            C[f"{nm} <= {thr:.2f} (p{q})"] = F[key] <= thr
    for lim in (15, 30, 45):
        C[f"|lat| < {lim}"] = F["abslat"] < lim
        C[f"|lat| >= {lim}"] = F["abslat"] >= lim
    C["land"] = F["land"]
    C["ocean"] = ~F["land"]
    return C


def e6(D, m, r, Q):
    print("\n" + "=" * 110 + f"\nE6 [{D['var']}]: best <=2-condition rule from pattern information only (no reference)\n" + "=" * 110)
    S = np.flatnonzero(D["el"] & (m["p"] < 0.05))
    _, conf = confirmed(m, r)
    y = conf[S]
    w = D["w"][S]
    F = dict(grade=np.array([Q[b]["grade"] for b in S]), abslat=np.abs(D["blat"][S]), land=D["land"][S],
             ratio=np.abs(m["s"][S]) / (m["hi"][S] - m["lo"][S]),
             r1=np.array([trend_1d(D["M"][np.isfinite(D["M"][:, b]), b], YEARS[np.isfinite(D["M"][:, b])])["r1"] for b in S]))
    for nm, key in (("step", "step"), ("oneYear", "oneYear"), ("reversal", "reversal"), ("endSensitive", "endSensitive")):
        F[nm] = np.array([Q[b]["flags"][key] for b in S])
    C = conditions(F, w)
    names = list(C)
    X = np.array([C[k] for k in names])          # [nc][n]
    rules = [((names[i],), X[i], "") for i in range(len(names))]
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            rules.append(((names[i], names[j]), X[i] & X[j], "AND"))
            rules.append(((names[i], names[j]), X[i] | X[j], "OR"))
    RM = np.array([x[1] for x in rules])         # [nr][n]

    def score(idx_set):
        ww, yy = w[idx_set], y[idx_set]
        P, N = ww[yy].sum(), ww[~yy].sum()
        tp = (RM[:, idx_set] * (ww * yy)).sum(axis=1)
        fp = (RM[:, idx_set] * (ww * ~yy)).sum(axis=1)
        return tp / P - fp / N, tp, fp, P, N

    def heldout(rule_i, te):
        ww, yy, pp = w[te], y[te], RM[rule_i][te]
        tp, fp = ww[pp & yy].sum(), ww[pp & ~yy].sum()
        P = ww[yy].sum()
        return (tp / (tp + fp) if tp + fp > 0 else float("nan")), tp / P, float(ww[pp].sum() / ww.sum()), float(ww[yy].sum() / ww.sum())

    def one_split(seed):
        rng = np.random.default_rng(seed)
        perm = rng.permutation(len(S))
        tr_, te = np.sort(perm[:len(S) // 2]), np.sort(perm[len(S) // 2:])
        J, *_ = score(tr_)
        best = int(np.argmax(J))      # ties -> first = single conditions before pairs
        return best, tr_, te, J[best]

    best, tr_, te, jtr = one_split(0)
    prec, rec, pos, base = heldout(best, te)
    desc = (f" {rules[best][2]} ".join(rules[best][0]))
    print(f"\n  significant MERRA-2 boxes: {len(S)}; confirmed share of area (whole set): {w[y].sum() / w.sum():.3f}; "
          f"candidate conditions {len(names)}, rules tried {len(rules)}")
    print(f"  seed 0: rule chosen on training half (maximises TPR-FPR, area weighted): '{desc}'  (train TPR-FPR = {jtr:.3f})")
    print(f"  held-out half ({len(te)} boxes): rule says 'confirmed' on {pos * 100:.1f}% of area; "
          f"PRECISION {prec:.3f}  RECALL {rec:.3f}   vs  'call everything confirmed': PRECISION {base:.3f}  RECALL 1.000")
    # reference rule: grade robust
    gi = names.index("grade robust")
    ri = [i for i, x in enumerate(rules) if x[0] == ("grade robust",)][0]
    p2, r2, pos2, _ = heldout(ri, te)
    print(f"  for comparison, the plain rule 'grade robust' on the same held-out half: says confirmed on {pos2 * 100:.1f}% "
          f"of area, PRECISION {p2:.3f} RECALL {r2:.3f}")
    # stability across 20 splits
    ps, rs_, bs, gains, chosen = [], [], [], [], []
    for seed in range(20):
        b, trn, tst, _ = one_split(seed)
        p_, r_, pos_, base_ = heldout(b, tst)
        ps.append(p_)
        rs_.append(r_)
        bs.append(base_)
        chosen.append(" ".join(f"{x}" for x in ((f" {rules[b][2]} ").join(rules[b][0]),)))
    print(f"  stability over 20 random splits (seeds 0-19): held-out PRECISION mean {np.nanmean(ps):.3f} "
          f"(min {np.nanmin(ps):.3f}, max {np.nanmax(ps):.3f}); RECALL mean {np.mean(rs_):.3f}; "
          f"call-everything PRECISION mean {np.mean(bs):.3f}")
    from collections import Counter
    for rule, c in Counter(chosen).most_common(5):
        print(f"      chosen in {c:2d}/20 splits: {rule}")
    # in-sample best on all boxes (an optimistic ceiling)
    Jall, *_ = score(np.arange(len(S)))
    ba = int(np.argmax(Jall))
    wa = w
    pa = RM[ba]
    tp = wa[pa & y].sum()
    print(f"  (optimistic, all boxes used for choosing and scoring) best rule '{(' ' + rules[ba][2] + ' ').join(rules[ba][0])}': "
          f"PRECISION {tp / wa[pa].sum():.3f} RECALL {tp / wa[y].sum():.3f} TPR-FPR {Jall[ba]:.3f}")
    # direct warning view: precision of the 'NOT confirmed' call by grade
    print("  warning view (share of area NOT confirmed): " + "; ".join(
        f"{g}: {100 * (1 - w[(F['grade'] == g) & y].sum() / w[F['grade'] == g].sum()):.1f}%"
        for g in ("robust", "caution", "doubtful") if (F['grade'] == g).any()))


# ------------------------------------------------------------------ main
def main():
    for var in VARS:
        D = load(var)
        idx = np.flatnonzero(D["el"])
        m, r = baseline(D)
        print("\n" + "#" * 110 + f"\n# {var}: eligible boxes {len(idx)}\n" + "#" * 110)
        # baseline check: recomputation equals the stored baseline
        m2, r2 = full_trends(D, idx)
        dm = np.nanmax(np.abs(m2["s"][idx] - m["s"][idx]))
        dr = np.nanmax(np.abs(r2["s"][idx] - r["s"][idx]))
        print(f"\nBASELINE (stored cache values, method as it is); recomputation check max |slope diff| MERRA-2 {dm:.2e}, reference {dr:.2e}")
        report_rows(D, [("baseline", m, r)])
        zero = {k: np.zeros_like(m["s"]) for k in ("s", "lo", "hi")}
        zero["p"] = np.ones_like(m["s"])
        print("  CONTROL (not a method): replace every MERRA-2 slope by exactly 0 and compare with the reference; a low RMSE here "
              "means 'flatter trends' alone lowers RMSE")
        for title, sel in sections(D):
            yz = yard(D["w"], zero, r, sel)
            print(f"    {title}: RMSE with all MERRA-2 slopes = 0: {yz['rmse']:.3f}")
        Q = qualities(D, idx)
        print(f"  [{time.time() - T0:.0f} s] quality_1d done for {len(Q)} boxes")
        e1(D, m, r, Q)
        e2(D, m, r, Q)
        e3(D)
        e4(D, m, r)
        e5(D, m, r)
        if var == "PRECTOTCORR":
            e6(D, m, r, Q)
        print(f"\n  [{time.time() - T0:.0f} s elapsed after {var}]")
    print(f"\nTOTAL RUNTIME {time.time() - T0:.0f} s")


if __name__ == "__main__":
    main()
