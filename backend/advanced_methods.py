"""
Cartolith — analysis capability rules and advanced methods.

Two jobs:

1. TYPE SAFETY. Every analysis declares what it needs (how many numeric
   variables, whether it needs coordinates, a categorical grouping, and so on).
   `check_eligibility` answers "can this run, and if not, why not, and what
   would fix it" — in language a student can act on. The point is that the UI
   can tell someone *before* they click that a regression on a text column
   will not work, instead of surfacing a statsmodels traceback afterwards.

2. ADVANCED METHODS. Decision trees, random forests and neural networks come
   from scikit-learn, which is already a dependency. The spatial statistics
   (Moran's I, Geary's C, LISA, GWR, spatial lag) are implemented directly on
   numpy/scipy rather than pulling in the PySAL stack — fewer moving parts to
   bundle, and the maths stays legible for teaching.

Every method here returns plain JSON-safe dicts and raises ValueError with a
readable message on bad input. Nothing raises a library-internal exception at
the caller.
"""
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

# ── optional deps ────────────────────────────────────────────────────────────
try:
    from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor, export_text
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.neural_network import MLPClassifier, MLPRegressor
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import (
        accuracy_score, confusion_matrix, r2_score,
        mean_absolute_error, mean_squared_error,
    )
    HAS_SKLEARN_ADV = True
except Exception as e:  # pragma: no cover
    HAS_SKLEARN_ADV = False
    print(f"[startup] advanced sklearn methods unavailable: {e!r}")

try:
    from scipy import stats as _scipy_stats
    HAS_SCIPY_ADV = True
except Exception:
    HAS_SCIPY_ADV = False


def _f(x):
    """JSON-safe float: NaN/inf become None rather than breaking serialisation."""
    try:
        v = float(x)
        return None if (np.isnan(v) or np.isinf(v)) else v
    except Exception:
        return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. CAPABILITY REGISTRY
# ═════════════════════════════════════════════════════════════════════════════
#
# min_numeric / max_numeric   how many numeric variables the method needs
# needs_categorical           requires at least one text/categorical variable
# needs_coords                requires the dataset to carry lat/lon
# min_rows                    smallest sample that gives a meaningful answer
# note                        one line on what the method actually answers

ANALYSIS_SPECS: Dict[str, Dict[str, Any]] = {
    "describe":        dict(label="Descriptive Stats",      min_numeric=1, note="Summary statistics for each selected variable."),
    "correlation":     dict(label="Correlation Matrix",     min_numeric=2, note="Pairwise linear association between numeric variables."),
    "regression":      dict(label="Linear Regression",      min_numeric=2, min_rows=10,
                            note="Models one numeric outcome as a linear function of the others."),
    "ttest":           dict(label="T-Test",                 min_numeric=1, max_numeric=2, min_rows=3,
                            note="Compares means — one sample against a value, or two samples against each other."),
    "anova":           dict(label="ANOVA",                  min_numeric=1, needs_categorical=True, min_rows=6,
                            note="Compares the mean of a numeric variable across categories."),
    "chi2":            dict(label="Chi-Square",             min_numeric=0, needs_categorical=True, min_categorical=2,
                            note="Tests whether two categorical variables are independent."),
    "normality":       dict(label="Normality Tests",        min_numeric=1, min_rows=8,
                            note="Checks whether a variable plausibly follows a normal distribution."),
    "pca":             dict(label="PCA",                    min_numeric=3, min_rows=10,
                            note="Reduces correlated numeric variables to a few components."),
    "cluster":         dict(label="K-Means Clustering",     min_numeric=2, min_rows=10,
                            note="Groups rows into clusters by numeric similarity."),
    "timeseries":      dict(label="Time Series Decomp.",    min_numeric=1, min_rows=24,
                            note="Splits a series into trend, seasonal and residual parts."),

    # ── advanced: machine learning ──
    "decision_tree":   dict(label="Decision Tree",          min_numeric=1, min_rows=20, advanced=True,
                            note="Predicts a target by learning a readable set of if/then splits."),
    "random_forest":   dict(label="Random Forest",          min_numeric=1, min_rows=30, advanced=True,
                            note="Many trees combined — stronger predictions plus variable importance."),
    "neural_network":  dict(label="Neural Network (MLP)",   min_numeric=1, min_rows=50, advanced=True,
                            note="A multi-layer perceptron for non-linear prediction. Needs more data than the others."),

    # ── advanced: spatial statistics ──
    "morans_i":        dict(label="Moran's I",              min_numeric=1, max_numeric=1, needs_coords=True, min_rows=10, advanced=True,
                            note="Tests whether high and low values cluster in space, or are scattered at random."),
    "gearys_c":        dict(label="Geary's C",              min_numeric=1, max_numeric=1, needs_coords=True, min_rows=10, advanced=True,
                            note="Like Moran's I but more sensitive to differences between close neighbours."),
    "local_morans":    dict(label="Local Moran's I (LISA)", min_numeric=1, max_numeric=1, needs_coords=True, min_rows=15, advanced=True,
                            note="Finds WHERE the clusters and spatial outliers actually are, per location."),
    "gwr":             dict(label="Geographically Weighted Regression", min_numeric=2, needs_coords=True, min_rows=30, advanced=True,
                            note="Fits a separate regression at every location — shows where relationships differ."),
    "spatial_lag":     dict(label="Spatial Lag Model",      min_numeric=2, needs_coords=True, min_rows=30, advanced=True,
                            note="Regression that accounts for outcomes spilling over between neighbours."),
}


def classify_columns(df: pd.DataFrame, cols: List[str]) -> Dict[str, str]:
    """Label each column numeric / categorical / datetime / empty."""
    out = {}
    for c in cols:
        if c not in df.columns:
            out[c] = "missing"; continue
        s = df[c]
        if pd.api.types.is_numeric_dtype(s):
            out[c] = "empty" if s.dropna().empty else "numeric"
        elif pd.api.types.is_datetime64_any_dtype(s):
            out[c] = "datetime"
        else:
            # Object dtype holding numbers (a common CSV artefact) is
            # genuinely numeric once coerced — say so rather than calling it text.
            coerced = pd.to_numeric(s, errors="coerce")
            frac = coerced.notna().mean() if len(s) else 0
            out[c] = "numeric" if frac >= 0.8 else "categorical"
    return out


def has_coordinates(df: pd.DataFrame) -> Tuple[bool, Optional[str], Optional[str]]:
    """Find lat/lon columns, tolerating the various names parsers produce."""
    lat_names = ["_centroid_lat", "_latitude", "latitude", "lat", "y"]
    lon_names = ["_centroid_lon", "_longitude", "longitude", "lon", "lng", "x"]
    low = {str(c).lower(): c for c in df.columns}
    lat = next((low[n] for n in lat_names if n in low), None)
    lon = next((low[n] for n in lon_names if n in low), None)
    return (lat is not None and lon is not None), lat, lon


def check_eligibility(analysis: str, df: pd.DataFrame, variables: List[str]) -> Dict[str, Any]:
    """
    Can this analysis run on this selection?

    Returns {ok, reason, fix, requirement} — `reason` says what is wrong in
    plain language and `fix` says what to do about it. Both are written for a
    student, not a developer.
    """
    spec = ANALYSIS_SPECS.get(analysis)
    if not spec:
        return {"ok": False, "reason": f"Unknown analysis '{analysis}'.", "fix": None}

    kinds = classify_columns(df, variables)
    numeric = [v for v, k in kinds.items() if k == "numeric"]
    categorical = [v for v, k in kinds.items() if k == "categorical"]
    n_rows = len(df)

    req_bits = []
    if spec.get("min_numeric"):      req_bits.append(f"{spec['min_numeric']}+ numeric variable(s)")
    if spec.get("needs_categorical"): req_bits.append(f"{spec.get('min_categorical', 1)}+ categorical variable(s)")
    if spec.get("needs_coords"):     req_bits.append("coordinates (lat/lon)")
    if spec.get("min_rows"):         req_bits.append(f"at least {spec['min_rows']} rows")
    requirement = ", ".join(req_bits) or "no special requirements"

    def fail(reason, fix=None):
        return {"ok": False, "reason": reason, "fix": fix, "requirement": requirement,
                "numeric_selected": numeric, "categorical_selected": categorical}

    need_n = spec.get("min_numeric", 0)
    if len(numeric) < need_n:
        non_num = [v for v in variables if kinds.get(v) != "numeric"]
        detail = f" ({', '.join(non_num[:4])} {'is' if len(non_num) == 1 else 'are'} not numeric)" if non_num else ""
        return fail(
            f"Needs {need_n} numeric variable(s); {len(numeric)} selected{detail}.",
            "Select numeric columns — the ones marked 123 in the variable list.",
        )

    if spec.get("max_numeric") and len(numeric) > spec["max_numeric"]:
        return fail(
            f"Takes at most {spec['max_numeric']} numeric variable(s); {len(numeric)} selected.",
            f"Deselect until only {spec['max_numeric']} numeric variable remains.",
        )

    if spec.get("needs_categorical") and len(categorical) < spec.get("min_categorical", 1):
        return fail(
            f"Needs {spec.get('min_categorical', 1)} categorical variable(s) to group by; none selected.",
            "Add a text column (marked Abc) to group the numbers by.",
        )

    if spec.get("needs_coords"):
        ok_coords, lat, lon = has_coordinates(df)
        if not ok_coords:
            return fail(
                "This dataset has no coordinates, so there is no geography to analyse.",
                "Use a dataset with lat/lon columns, or one loaded from a shapefile or GeoJSON.",
            )

    if spec.get("min_rows") and n_rows < spec["min_rows"]:
        return fail(
            f"Needs at least {spec['min_rows']} rows; this dataset has {n_rows}.",
            "Use a larger dataset — results from this few rows would not be trustworthy.",
        )

    if analysis in ("decision_tree", "random_forest", "neural_network") and len(variables) < 2:
        return fail(
            "Needs a target plus at least one predictor.",
            "Select two or more variables: the last one selected is treated as the target.",
        )

    return {"ok": True, "reason": None, "fix": None, "requirement": requirement,
            "numeric_selected": numeric, "categorical_selected": categorical}


def numeric_frame(df: pd.DataFrame, cols: List[str], min_rows: int = 3) -> pd.DataFrame:
    """
    Coerce the named columns to numeric and drop unusable rows.

    This is the guard that prevents "Pandas data cast to numpy dtype of
    object" ever reaching a user: anything that cannot be made numeric fails
    here, with a message naming the offending column.
    """
    out = {}
    for c in cols:
        if c not in df.columns:
            raise ValueError(f"Column '{c}' is not in this dataset.")
        s = pd.to_numeric(df[c], errors="coerce")
        if s.notna().sum() == 0:
            raise ValueError(
                f"Column '{c}' contains no usable numbers — it looks like text. "
                f"Pick a numeric column, or encode this one first."
            )
        out[c] = s
    frame = pd.DataFrame(out).replace([np.inf, -np.inf], np.nan).dropna()
    if len(frame) < min_rows:
        raise ValueError(
            f"Only {len(frame)} complete rows remain after removing missing values "
            f"(need at least {min_rows}). Check for empty cells in the selected columns."
        )
    return frame


# ═════════════════════════════════════════════════════════════════════════════
# 2. SPATIAL WEIGHTS
# ═════════════════════════════════════════════════════════════════════════════
def spatial_weights(coords: np.ndarray, k: int = 8, kind: str = "knn",
                    bandwidth: Optional[float] = None) -> np.ndarray:
    """
    Row-standardised spatial weights matrix W.

    W[i][j] > 0 means "j is a neighbour of i". Row-standardising (each row
    summing to 1) makes the spatial lag Wy an average of neighbours, which is
    what makes Moran's I interpretable as a correlation.

    kind='knn'      each location's k nearest neighbours, equally weighted.
    kind='distance' a Gaussian kernel over distance, using `bandwidth`.
    """
    n = len(coords)
    if n < 3:
        raise ValueError("Need at least 3 locations for a spatial analysis.")
    k = max(1, min(k, n - 1))

    d = np.sqrt(((coords[:, None, :] - coords[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(d, np.inf)

    W = np.zeros((n, n))
    if kind == "distance":
        bw = bandwidth or np.median(np.sort(d, axis=1)[:, min(k, n - 2)])
        bw = bw if bw and np.isfinite(bw) and bw > 0 else 1.0
        W = np.exp(-(d / bw) ** 2)
        np.fill_diagonal(W, 0)
    else:
        idx = np.argsort(d, axis=1)[:, :k]
        rows = np.repeat(np.arange(n), k)
        W[rows, idx.ravel()] = 1.0

    sums = W.sum(axis=1, keepdims=True)
    sums[sums == 0] = 1.0
    return W / sums


def _coords_of(df: pd.DataFrame) -> np.ndarray:
    ok, lat, lon = has_coordinates(df)
    if not ok:
        raise ValueError("This dataset has no latitude/longitude columns.")
    c = df[[lon, lat]].apply(pd.to_numeric, errors="coerce")
    if c.isna().any().any():
        raise ValueError("Some rows have missing or non-numeric coordinates.")
    return c.values.astype(float)


# ═════════════════════════════════════════════════════════════════════════════
# 3. SPATIAL STATISTICS
# ═════════════════════════════════════════════════════════════════════════════
def morans_i(values: np.ndarray, W: np.ndarray, permutations: int = 999) -> Dict[str, Any]:
    """
    Global Moran's I — is this variable clustered, dispersed, or random?

    I near +1 means similar values sit near each other; near -1 means high
    values neighbour low ones; near the expected value means no spatial
    pattern. Significance is assessed by permutation (reshuffling values
    across locations) which avoids assuming normality.
    """
    n = len(values)
    z = values - values.mean()
    denom = (z ** 2).sum()
    if denom == 0:
        raise ValueError("This variable is constant — there is no variation to find a pattern in.")

    S0 = W.sum()
    I = (n / S0) * float(z @ W @ z) / denom
    EI = -1.0 / (n - 1)

    # Permutation inference: how extreme is the observed I against the null
    # of "same values, random locations"?
    rng = np.random.default_rng(42)  # fixed so a student gets a stable answer
    sim = np.empty(permutations)
    for p in range(permutations):
        zp = rng.permutation(z)
        sim[p] = (n / S0) * float(zp @ W @ zp) / denom
    p_sim = (np.sum(np.abs(sim - EI) >= abs(I - EI)) + 1) / (permutations + 1)

    if p_sim < 0.05:
        pattern = "clustered" if I > EI else "dispersed"
        verdict = (f"Significantly {pattern} (p = {p_sim:.3f}). "
                   + ("Similar values tend to be near each other."
                      if I > EI else
                      "High values tend to sit next to low ones — a checkerboard pattern."))
    else:
        verdict = (f"No significant spatial pattern (p = {p_sim:.3f}). "
                   "The values are distributed about as randomly as chance would produce.")

    return {"type": "morans_i", "I": _f(I), "expected_I": _f(EI),
            "z_score": _f((I - EI) / (sim.std() or 1)), "p_value": _f(p_sim),
            "n": int(n), "permutations": permutations, "interpretation": verdict,
            "sim_min": _f(sim.min()), "sim_max": _f(sim.max())}


def gearys_c(values: np.ndarray, W: np.ndarray, permutations: int = 999) -> Dict[str, Any]:
    """Geary's C — like Moran's I, but driven by squared differences between
    neighbours, so it reacts more to local contrast. C < 1 is clustering."""
    n = len(values)
    z = values - values.mean()
    denom = (z ** 2).sum()
    if denom == 0:
        raise ValueError("This variable is constant — there is no variation to find a pattern in.")
    S0 = W.sum()

    def C_of(v):
        diff = (v[:, None] - v[None, :]) ** 2
        return ((n - 1) * (W * diff).sum()) / (2 * S0 * ((v - v.mean()) ** 2).sum())

    C = float(C_of(values))
    rng = np.random.default_rng(42)
    sim = np.array([C_of(rng.permutation(values)) for _ in range(permutations)])
    p_sim = (np.sum(np.abs(sim - 1.0) >= abs(C - 1.0)) + 1) / (permutations + 1)

    verdict = (f"C = {C:.3f}. " + (
        "Below 1 with p < 0.05 — neighbouring values are more similar than chance: clustering."
        if C < 1 and p_sim < 0.05 else
        "Above 1 with p < 0.05 — neighbours differ more than chance: dispersion."
        if C > 1 and p_sim < 0.05 else
        "Close enough to 1 that no spatial pattern is detectable."))

    return {"type": "gearys_c", "C": _f(C), "expected_C": 1.0, "p_value": _f(p_sim),
            "n": int(n), "permutations": permutations, "interpretation": verdict}


def local_morans(values: np.ndarray, W: np.ndarray, coords: np.ndarray,
                 permutations: int = 499) -> Dict[str, Any]:
    """
    Local Moran's I (LISA) — classifies every location into one of four
    relationships with its neighbours, plus 'not significant':

      High-High / Low-Low   clusters (this place resembles its neighbours)
      High-Low / Low-High   spatial outliers (this place differs from them)
    """
    n = len(values)
    z = values - values.mean()
    s2 = (z ** 2).sum() / n
    if s2 == 0:
        raise ValueError("This variable is constant — there is no variation to find a pattern in.")

    lag = W @ z
    Ii = (z / s2) * lag

    rng = np.random.default_rng(42)
    sim = np.empty((permutations, n))
    for p in range(permutations):
        zp = rng.permutation(z)
        sim[p] = (z / s2) * (W @ zp)
    p_vals = (np.sum(np.abs(sim) >= np.abs(Ii), axis=0) + 1) / (permutations + 1)

    quad = []
    for i in range(n):
        if p_vals[i] >= 0.05:
            quad.append("ns")
        elif z[i] > 0 and lag[i] > 0: quad.append("HH")
        elif z[i] < 0 and lag[i] < 0: quad.append("LL")
        elif z[i] > 0 and lag[i] < 0: quad.append("HL")
        else:                          quad.append("LH")

    counts = {q: int(quad.count(q)) for q in ("HH", "LL", "HL", "LH", "ns")}
    cap = 2000  # keep the payload sane for large datasets
    return {
        "type": "local_morans", "n": int(n), "counts": counts,
        "locations": [
            {"lon": _f(coords[i, 0]), "lat": _f(coords[i, 1]),
             "value": _f(values[i]), "local_I": _f(Ii[i]),
             "p_value": _f(p_vals[i]), "quadrant": quad[i]}
            for i in range(min(n, cap))
        ],
        "truncated": n > cap,
        "interpretation": (
            f"{counts['HH']} high-high and {counts['LL']} low-low clusters; "
            f"{counts['HL'] + counts['LH']} spatial outliers; "
            f"{counts['ns']} locations show no significant local pattern."
        ),
    }


def gwr(y: np.ndarray, X: np.ndarray, coords: np.ndarray, names: List[str],
        bandwidth: Optional[float] = None) -> Dict[str, Any]:
    """
    Geographically Weighted Regression.

    A global regression gives one coefficient per predictor for the whole
    study area, which assumes the relationship is the same everywhere. GWR
    fits a separate weighted regression at each location — nearby
    observations count for more — so you can see where a relationship is
    strong, weak, or reversed.

    Uses a Gaussian kernel. Bandwidth defaults to a rule of thumb; a smaller
    bandwidth means more local (and noisier) coefficients.
    """
    n, p = X.shape
    d = np.sqrt(((coords[:, None, :] - coords[None, :, :]) ** 2).sum(-1))
    if bandwidth is None:
        # Median distance to the ~20th nearest neighbour: local enough to vary,
        # wide enough that each local fit is still identified.
        kth = min(max(int(0.2 * n), p + 2), n - 1)
        bandwidth = float(np.median(np.sort(d, axis=1)[:, kth]))
    if not bandwidth or not np.isfinite(bandwidth) or bandwidth <= 0:
        bandwidth = float(np.median(d[d > 0])) or 1.0

    Xc = np.column_stack([np.ones(n), X])
    local_coefs, local_r2, fitted = [], [], np.zeros(n)

    for i in range(n):
        w = np.exp(-(d[i] / bandwidth) ** 2)
        Wi = np.diag(w)
        XtW = Xc.T @ Wi
        try:
            beta = np.linalg.solve(XtW @ Xc, XtW @ y)
        except np.linalg.LinAlgError:
            beta = np.linalg.pinv(XtW @ Xc) @ (XtW @ y)
        local_coefs.append(beta)
        fitted[i] = Xc[i] @ beta
        yhatw = Xc @ beta
        ybar_w = np.average(y, weights=w)
        ss_t = float((w * (y - ybar_w) ** 2).sum())
        ss_r = float((w * (y - yhatw) ** 2).sum())
        local_r2.append(1 - ss_r / ss_t if ss_t > 0 else np.nan)

    B = np.array(local_coefs)
    resid = y - fitted
    ss_res, ss_tot = float((resid ** 2).sum()), float(((y - y.mean()) ** 2).sum())

    labels = ["intercept"] + names
    summary = {
        labels[j]: {
            "min": _f(np.nanmin(B[:, j])), "max": _f(np.nanmax(B[:, j])),
            "mean": _f(np.nanmean(B[:, j])), "median": _f(np.nanmedian(B[:, j])),
            "std": _f(np.nanstd(B[:, j])),
            # A sign flip means the relationship genuinely reverses somewhere —
            # the headline finding GWR exists to reveal.
            "changes_sign": bool(np.nanmin(B[:, j]) < 0 < np.nanmax(B[:, j])),
        }
        for j in range(B.shape[1])
    }
    varying = [k for k, v in summary.items() if k != "intercept" and v["changes_sign"]]

    cap = 2000
    return {
        "type": "gwr", "n": int(n), "bandwidth": _f(bandwidth),
        "global_r_squared": _f(1 - ss_res / ss_tot if ss_tot else None),
        "coefficient_summary": summary,
        "local_r2_mean": _f(np.nanmean(local_r2)),
        "locations": [
            {"lon": _f(coords[i, 0]), "lat": _f(coords[i, 1]),
             "local_r2": _f(local_r2[i]),
             **{labels[j]: _f(B[i, j]) for j in range(B.shape[1])}}
            for i in range(min(n, cap))
        ],
        "truncated": n > cap,
        "interpretation": (
            (f"The effect of {', '.join(varying)} changes sign across the study area — "
             f"the relationship genuinely reverses in some places, which a single global "
             f"regression would hide.")
            if varying else
            "Coefficients keep the same sign throughout, so the relationship is stable "
            "across space even though its strength varies."
        ),
    }


def spatial_lag_model(y: np.ndarray, X: np.ndarray, W: np.ndarray, names: List[str]) -> Dict[str, Any]:
    """
    Spatial lag (spatial autoregressive) model: y = ρWy + Xβ + ε.

    Ordinary regression assumes observations are independent. When outcomes
    spill across neighbours — house prices, disease, pollution — that
    assumption fails and OLS misattributes the spillover to the predictors.

    Wy is endogenous (it contains y), so OLS on it is biased. This uses
    two-stage least squares with spatially lagged predictors WX as
    instruments, the standard S2SLS estimator.
    """
    n = len(y)
    Wy = W @ y
    Xc = np.column_stack([np.ones(n), X])

    # Stage 1: predict Wy from the instruments [1, X, WX, W²X].
    WX, WWX = W @ X, W @ (W @ X)
    Z = np.column_stack([np.ones(n), X, WX, WWX])
    try:
        Wy_hat = Z @ np.linalg.lstsq(Z, Wy, rcond=None)[0]
    except np.linalg.LinAlgError:
        raise ValueError("Could not estimate the spatial lag — predictors may be collinear.")

    # Stage 2: regress y on the fitted lag plus the original predictors.
    A = np.column_stack([Wy_hat, Xc])
    beta = np.linalg.lstsq(A, y, rcond=None)[0]
    rho, coefs = float(beta[0]), beta[1:]

    fitted = np.column_stack([Wy, Xc]) @ beta
    resid = y - fitted
    ss_res, ss_tot = float((resid ** 2).sum()), float(((y - y.mean()) ** 2).sum())
    k = A.shape[1]
    sigma2 = ss_res / max(n - k, 1)
    try:
        se = np.sqrt(np.diag(sigma2 * np.linalg.pinv(A.T @ A)))
    except Exception:
        se = np.full(k, np.nan)

    # OLS without the lag, for comparison — the whole point is the contrast.
    ols_beta = np.linalg.lstsq(Xc, y, rcond=None)[0]
    ols_res = float(((y - Xc @ ols_beta) ** 2).sum())

    labels = ["intercept"] + names
    tvals = [(_f(coefs[j] / se[j + 1]) if se[j + 1] else None) for j in range(len(coefs))]

    return {
        "type": "spatial_lag", "n": int(n),
        "rho": _f(rho), "rho_std_err": _f(se[0]),
        "rho_t_stat": _f(rho / se[0]) if se[0] else None,
        "pseudo_r_squared": _f(1 - ss_res / ss_tot if ss_tot else None),
        "ols_r_squared": _f(1 - ols_res / ss_tot if ss_tot else None),
        "coefficients": {
            labels[j]: {"coef": _f(coefs[j]), "std_err": _f(se[j + 1]), "t_stat": tvals[j]}
            for j in range(len(coefs))
        },
        "ols_coefficients": {labels[j]: _f(ols_beta[j]) for j in range(len(ols_beta))},
        "interpretation": (
            f"ρ = {rho:.3f}. " + (
                "Strong positive spatial dependence — a location's outcome is substantially "
                "shaped by its neighbours'. Ignoring this would overstate the predictors."
                if rho > 0.3 else
                "Negative spatial dependence — neighbouring outcomes push against each other."
                if rho < -0.3 else
                "Weak spatial dependence; ordinary regression would give similar answers here."
            )
        ),
    }


# ═════════════════════════════════════════════════════════════════════════════
# 4. MACHINE LEARNING
# ═════════════════════════════════════════════════════════════════════════════
def _split_target(frame: pd.DataFrame, variables: List[str], target: Optional[str]):
    tgt = target if target in frame.columns else variables[-1]
    feats = [v for v in frame.columns if v != tgt]
    if not feats:
        raise ValueError("Need at least one predictor besides the target variable.")
    return tgt, feats


def _is_classification(y: pd.Series) -> bool:
    """Treat few distinct integer-ish values as classes, otherwise regression."""
    u = y.nunique()
    return u <= 10 and (y.dropna() % 1 == 0).all()


def tree_model(df: pd.DataFrame, variables: List[str], params: Dict[str, Any],
               kind: str = "tree") -> Dict[str, Any]:
    """Decision tree or random forest, auto-detecting classification vs regression."""
    if not HAS_SKLEARN_ADV:
        raise ValueError("scikit-learn is not available in this environment.")

    frame = numeric_frame(df, variables, min_rows=20)
    target, feats = _split_target(frame, variables, params.get("dependent"))
    X, y = frame[feats].values, frame[target]
    clf = _is_classification(y)
    depth = int(params.get("max_depth") or 4)
    n_est = int(params.get("n_estimators") or 100)

    Xtr, Xte, ytr, yte = train_test_split(X, y.values, test_size=0.25, random_state=42)

    if kind == "forest":
        model = (RandomForestClassifier if clf else RandomForestRegressor)(
            n_estimators=n_est, max_depth=depth or None, random_state=42)
    else:
        model = (DecisionTreeClassifier if clf else DecisionTreeRegressor)(
            max_depth=depth, random_state=42)
    model.fit(Xtr, ytr)
    pred = model.predict(Xte)

    out: Dict[str, Any] = {
        "type": "random_forest" if kind == "forest" else "decision_tree",
        "task": "classification" if clf else "regression",
        "target": target, "features": feats, "n": int(len(frame)),
        "n_train": int(len(Xtr)), "n_test": int(len(Xte)), "max_depth": depth,
        "importances": {f: _f(v) for f, v in zip(feats, model.feature_importances_)},
    }
    if kind == "forest":
        out["n_estimators"] = n_est

    if clf:
        acc = accuracy_score(yte, pred)
        out["accuracy"] = _f(acc)
        out["baseline_accuracy"] = _f(pd.Series(yte).value_counts(normalize=True).max())
        out["confusion_matrix"] = confusion_matrix(yte, pred).tolist()
        out["classes"] = [str(c) for c in sorted(pd.Series(y).unique())]
        out["interpretation"] = (
            f"Classifies {acc:.1%} of held-out rows correctly "
            f"(always guessing the commonest class would score "
            f"{out['baseline_accuracy']:.1%}). "
            f"Most important predictor: {max(out['importances'], key=lambda k: out['importances'][k] or 0)}."
        )
    else:
        r2 = r2_score(yte, pred)
        out["r_squared"] = _f(r2)
        out["mae"] = _f(mean_absolute_error(yte, pred))
        out["rmse"] = _f(np.sqrt(mean_squared_error(yte, pred)))
        out["interpretation"] = (
            f"Explains {r2:.1%} of the variation in {target} on held-out data. "
            f"Most important predictor: {max(out['importances'], key=lambda k: out['importances'][k] or 0)}."
        )

    if kind == "tree":
        try:
            # The readable rules are the reason to prefer a single tree.
            out["rules"] = export_text(model, feature_names=list(feats), max_depth=min(depth, 3))
        except Exception:
            pass
    return out


def neural_network(df: pd.DataFrame, variables: List[str], params: Dict[str, Any]) -> Dict[str, Any]:
    """A small multi-layer perceptron. Inputs are standardised, which MLPs
    require to train sensibly."""
    if not HAS_SKLEARN_ADV:
        raise ValueError("scikit-learn is not available in this environment.")

    frame = numeric_frame(df, variables, min_rows=50)
    target, feats = _split_target(frame, variables, params.get("dependent"))
    X, y = frame[feats].values, frame[target]
    clf = _is_classification(y)

    hidden = params.get("hidden_layers") or [32, 16]
    if isinstance(hidden, (int, float)): hidden = [int(hidden)]
    hidden = tuple(int(h) for h in hidden)
    iters = int(params.get("max_iter") or 400)

    Xtr, Xte, ytr, yte = train_test_split(X, y.values, test_size=0.25, random_state=42)
    scaler = StandardScaler().fit(Xtr)
    Xtr_s, Xte_s = scaler.transform(Xtr), scaler.transform(Xte)

    model = (MLPClassifier if clf else MLPRegressor)(
        hidden_layer_sizes=hidden, max_iter=iters, random_state=42, early_stopping=True)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # convergence warnings are reported below instead
        model.fit(Xtr_s, ytr)
    pred = model.predict(Xte_s)

    out: Dict[str, Any] = {
        "type": "neural_network", "task": "classification" if clf else "regression",
        "target": target, "features": feats, "n": int(len(frame)),
        "n_train": int(len(Xtr)), "n_test": int(len(Xte)),
        "hidden_layers": list(hidden), "iterations_run": int(model.n_iter_),
        "converged": bool(model.n_iter_ < iters),
        "loss_curve": [_f(v) for v in list(getattr(model, "loss_curve_", []))[:200]],
    }
    if clf:
        acc = accuracy_score(yte, pred)
        out["accuracy"] = _f(acc)
        out["baseline_accuracy"] = _f(pd.Series(yte).value_counts(normalize=True).max())
        out["confusion_matrix"] = confusion_matrix(yte, pred).tolist()
        verdict = f"Classifies {acc:.1%} of held-out rows correctly."
    else:
        r2 = r2_score(yte, pred)
        out["r_squared"] = _f(r2)
        out["mae"] = _f(mean_absolute_error(yte, pred))
        out["rmse"] = _f(np.sqrt(mean_squared_error(yte, pred)))
        verdict = f"Explains {r2:.1%} of the variation in {target} on held-out data."

    if not out["converged"]:
        verdict += (f" Training stopped at the {iters}-iteration limit without converging — "
                    f"treat these numbers as provisional and try more iterations or more data.")
    verdict += (" Neural networks do not explain themselves: unlike a decision tree, there is "
                "no readable rule to inspect. Prefer a simpler model unless it clearly wins.")
    out["interpretation"] = verdict
    return out
