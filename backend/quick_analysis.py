"""
Cartolith — quick analysis: the ≤3-click path to a correct first answer.

Given a dataset and the columns a novice picked, this module:
  * asks advanced_methods.check_eligibility which methods are valid for
    that selection (the same guard the full Analyze tab uses),
  * runs the valid quick methods with sane defaults — permutation seed
    fixed, missing rows dropped and *counted in the result*,
  * returns numbers PLUS a plain-English interpretation whose wording is
    driven by the actual statistics (sign, size, significance), because
    for a beginner the interpretation is the result.

Covered: descriptive stats, correlation, Moran's I, ordinary regression.
Everything else stays in the full Analyze tab; quick analysis says so.
"""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd

import advanced_methods as adv

QUICK_METHODS = ("describe", "correlation", "morans_i", "regression")


def _describe(frame: pd.DataFrame, cols: List[str]) -> Dict[str, Any]:
    stats = {}
    for c in cols:
        s = frame[c]
        stats[c] = {"mean": adv._f(s.mean()), "median": adv._f(s.median()),
                    "std": adv._f(s.std()), "min": adv._f(s.min()),
                    "max": adv._f(s.max()),
                    "skew": adv._f(s.skew())}
    first = cols[0]
    sk = stats[first]["skew"] or 0.0
    shape = ("roughly symmetric" if abs(sk) < 0.5 else
             "skewed right (a long tail of high values)" if sk > 0 else
             "skewed left (a long tail of low values)")
    return {"type": "describe", "stats": stats,
            "interpretation": (f"{first} averages {stats[first]['mean']:.3g} "
                               f"(median {stats[first]['median']:.3g}) and is {shape}. "
                               "Mean and median far apart is the classic sign of skew — "
                               "report the median for skewed data.")}


def _correlation(frame: pd.DataFrame, cols: List[str]) -> Dict[str, Any]:
    corr = frame[cols].corr()
    pairs = []
    for i, a in enumerate(cols):
        for b in cols[i + 1:]:
            pairs.append((a, b, float(corr.loc[a, b])))
    pairs.sort(key=lambda t: abs(t[2]), reverse=True)
    a, b, r = pairs[0]
    strength = ("very strong" if abs(r) >= 0.8 else "strong" if abs(r) >= 0.6
                else "moderate" if abs(r) >= 0.4 else "weak")
    direction = "positive" if r > 0 else "negative"
    return {"type": "correlation",
            "matrix": {a_: {b_: adv._f(corr.loc[a_, b_]) for b_ in cols} for a_ in cols},
            "strongest": {"a": a, "b": b, "r": adv._f(r)},
            "interpretation": (f"The strongest relationship is {a} vs {b}: r = {r:.2f}, "
                               f"a {strength} {direction} association. Correlation is not "
                               "causation — a third variable may drive both.")}


def _morans(frame: pd.DataFrame, col: str, seed: int) -> Dict[str, Any]:
    coords = adv._coords_of(frame)
    k = int(min(8, len(frame) - 1))
    W = adv.spatial_weights(coords, k=k)
    out = adv.morans_i(frame[col].values.astype(float), W, seed=seed)
    I, EI, p = out["I"], out["expected_I"], out["p_value"]
    if p is not None and p < 0.05 and I > EI:
        interp = (f"Moran's I = {I:.2f} (p = {p:.3f}): {col} is significantly "
                  "clustered — similar values sit near each other more than "
                  "chance would produce. Averages over this area will hide "
                  "real hotspots and coldspots.")
    elif p is not None and p < 0.05 and I < EI:
        interp = (f"Moran's I = {I:.2f} (p = {p:.3f}): {col} is significantly "
                  "dispersed — high values tend to neighbour low ones "
                  "(a checkerboard-like pattern).")
    else:
        interp = (f"Moran's I = {I:.2f} (p = {p:.3f}): no significant spatial "
                  f"pattern — {col} is distributed about as randomly as chance "
                  "would produce, so a single overall average is a fair summary.")
    return {"type": "morans_i", "column": col, "k_neighbours": k, **out,
            "interpretation": interp}


def _regression(frame: pd.DataFrame, target: str, preds: List[str]) -> Dict[str, Any]:
    X = np.column_stack([np.ones(len(frame))] + [frame[p].values for p in preds])
    y = frame[target].values.astype(float)
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    ss_res, ss_tot = float((resid ** 2).sum()), float(((y - y.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
    coefs = {"intercept": adv._f(beta[0])}
    coefs.update({p: adv._f(b) for p, b in zip(preds, beta[1:])})
    main_pred = preds[int(np.argmax(np.abs(beta[1:])))] if preds else None
    mb = coefs[main_pred]
    interp = (f"The model explains {r2:.0%} of the variation in {target} (R² = {r2:.2f}). "
              f"The largest effect is {main_pred}: a one-unit increase is associated "
              f"with a {mb:+.3g} change in {target}, holding the other variables constant. "
              "Check Moran's I on the residuals before trusting this — spatial data "
              "often violates the independence assumption.")
    return {"type": "regression", "target": target, "coefficients": coefs,
            "r_squared": adv._f(r2), "interpretation": interp}


COORD_NAMES = {"_centroid_lat", "_centroid_lon", "_centroid_x", "_centroid_y",
               "_latitude", "_longitude", "latitude", "longitude", "lat", "lon",
               "lng", "long", "y", "x", "y_coord", "x_coord"}


def quick_analysis(df: pd.DataFrame, columns: List[str], seed: int = 42) -> Dict[str, Any]:
    """Run every quick method that is valid for this selection.

    Invalid methods are reported with the eligibility reason and fix —
    telling a novice *why not, and what to do instead* is half the feature.
    Coordinate columns are never treated as analysis variables: a beginner
    who selects [value, lon] means "analyse value", and Moran's I in
    particular takes exactly one variable.
    """
    available, unavailable, results = [], [], {}
    n_before = len(df)
    has_pair = adv.has_coordinates(df)
    # Resolve the variable list ONCE, from a neutral probe, before any
    # per-method check: per-method probes see the raw selection, where a
    # coordinate column counts as a "variable" and would wrongly block
    # Moran's I (max 1 variable) for the common [value, lon] selection.
    base = adv.check_eligibility("describe", df, columns)
    if base["ok"]:
        variables = [c for c in base["numeric_selected"]
                     if not (has_pair
                             and str(c).strip().lower() in COORD_NAMES)]
        if not variables:
            variables = list(base["numeric_selected"])
    else:
        variables = []
    frame = adv.numeric_frame(df, variables, min_rows=3) if variables else None
    for method in QUICK_METHODS:
        cols_for_method = variables[:1] if method == "morans_i" else variables
        check = (adv.check_eligibility(method, df, cols_for_method)
                 if cols_for_method else base)
        if not check["ok"]:
            unavailable.append({"method": method, "reason": check["reason"],
                                "fix": check["fix"]})
            continue
        numeric = check["numeric_selected"]
        available.append(method)
        if method == "describe":
            results[method] = _describe(frame, numeric)
        elif method == "correlation" and len(numeric) >= 2:
            results[method] = _correlation(frame, numeric)
        elif method == "morans_i":
            results[method] = _morans(
                df.loc[frame.index] if len(frame) < n_before else df,
                numeric[0], seed)
        elif method == "regression" and len(numeric) >= 2:
            results[method] = _regression(frame, numeric[-1], numeric[:-1])
    dropped = int(n_before - (len(frame) if frame is not None else n_before))
    return {"seed": seed, "n_rows": int(n_before),
            "n_rows_used": int(len(frame)) if frame is not None else 0,
            "n_rows_dropped_missing": dropped,
            "missing_data_note": (f"{dropped} row(s) were dropped because they "
                                  "had missing values in the selected columns."
                                  if dropped else
                                  "No rows had missing values in the selected columns."),
            "available": available, "unavailable": unavailable,
            "results": results}
