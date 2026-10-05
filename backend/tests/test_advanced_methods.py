"""
Validation of backend/advanced_methods.py against INDEPENDENT references:
esda (PySAL) for Moran's I / Geary's C / LISA point estimates, and known
data-generating processes for GWR and the spatial lag model.

These tests are the proof the teaching tool teaches correct answers.
Run:  python -m pytest backend/tests/test_advanced_methods.py
"""
import numpy as np
import pytest

import advanced_methods as adv

pytest.importorskip("esda")
pytest.importorskip("libpysal")

from libpysal.weights import W as LpW  # noqa: E402
from esda.moran import Moran, Moran_Local  # noqa: E402
from esda.geary import Geary  # noqa: E402


def grid(n=6):
    coords = np.array([(x, y) for y in range(n) for x in range(n)], float)
    return coords


def esda_weights(W):
    nb = {i: np.where(W[i] > 0)[0].tolist() for i in range(len(W))}
    wts = {i: [W[i, j] for j in nb[i]] for i in range(len(W))}
    w = LpW(nb, wts)
    w.transform = "r"
    return w


@pytest.fixture()
def gradient():
    rng = np.random.default_rng(0)
    coords = grid()
    vals = np.array([x + y for (x, y) in coords], float) + rng.normal(0, 0.3, 36)
    W = adv.spatial_weights(coords, k=4)
    return vals, W, coords


# ── weights ─────────────────────────────────────────────────────────────────

def test_weights_row_standardised_no_self_neighbours():
    W = adv.spatial_weights(grid(), k=4)
    assert np.allclose(W.sum(axis=1), 1.0)
    assert np.all(np.diag(W) == 0)
    assert (W > 0).sum(axis=1).tolist() == [4] * 36  # exactly k neighbours


def test_weights_rejects_tiny_samples():
    with pytest.raises(ValueError):
        adv.spatial_weights(np.array([[0.0, 0.0], [1.0, 1.0]]), k=1)


# ── Moran's I & Geary's C: exact parity with esda ───────────────────────────

def test_morans_i_matches_esda(gradient):
    vals, W, _ = gradient
    ref = Moran(vals, esda_weights(W))
    out = adv.morans_i(vals, W, permutations=99)
    assert out["I"] == pytest.approx(ref.I, abs=1e-9)
    assert out["expected_I"] == pytest.approx(-1 / 35, abs=1e-12)
    assert 0 < out["p_value"] <= 0.05  # smooth gradient is strongly clustered


def test_morans_i_checkerboard_is_negative(gradient):
    _, W, coords = gradient
    cb = np.array([(x + y) % 2 for (x, y) in coords], float)
    out = adv.morans_i(cb, W, permutations=99)
    ref = Moran(cb, esda_weights(W))
    assert out["I"] == pytest.approx(ref.I, abs=1e-9)
    assert out["I"] < -0.5


def test_morans_i_constant_raises_readable_error(gradient):
    _, W, _ = gradient
    with pytest.raises(ValueError, match="constant"):
        adv.morans_i(np.ones(36), W)


def test_gearys_c_matches_esda(gradient):
    vals, W, _ = gradient
    ref = Geary(vals, esda_weights(W))
    out = adv.gearys_c(vals, W, permutations=99)
    assert out["C"] == pytest.approx(ref.C, abs=1e-9)
    assert out["C"] < 1  # clustered pattern


def test_permutation_seed_is_reproducible_and_configurable(gradient):
    vals, W, _ = gradient
    a = adv.morans_i(vals, W, permutations=199, seed=7)
    b = adv.morans_i(vals, W, permutations=199, seed=7)
    assert a["p_value"] == b["p_value"]  # same seed -> same answer, every run
    c = adv.morans_i(vals, W, permutations=199)  # default seed still works
    assert c["I"] == a["I"]


# ── LISA: point estimates exact; significance counts differ (documented) ────

def test_local_morans_values_match_esda(gradient):
    vals, W, coords = gradient
    ref = Moran_Local(vals, esda_weights(W))
    out = adv.local_morans(vals, W, coords, permutations=99)
    got = np.array([loc["local_I"] for loc in out["locations"]])
    # Local I values are proportional to esda's with the EXACT constant
    # n/(n-1): esda standardises with the sample (n-1) denominator where
    # Cartolith uses the population (n) denominator in m2. Quadrants —
    # the teaching payload — are unaffected; the constant is documented
    # in ENHANCEMENT_PLAN.md (finding F-6) rather than silently 'fixed',
    # because both conventions appear in the literature.
    ratio = got / ref.Is
    assert ratio == pytest.approx(np.full(36, 36 / 35), abs=1e-8)
    # On this unambiguous pattern the significant clusters must be found.
    assert out["counts"]["HH"] >= 3 and out["counts"]["LL"] >= 3


@pytest.mark.xfail(
    reason="Significance counts differ from esda by design of the permutation "
           "scheme: Cartolith permutes all values into the lag (W @ perm(z)) "
           "and counts two-sided exceedances, while esda uses conditional "
           "permutation (y_i held fixed, excluded from the pool). Point "
           "estimates are identical (see test above); aligning the inference "
           "exactly is tracked in ENHANCEMENT_PLAN.md (P0-4).",
    strict=False)
def test_local_morans_significance_matches_esda_exactly(gradient):
    vals, W, coords = gradient
    ref = Moran_Local(vals, esda_weights(W), permutations=499)
    out = adv.local_morans(vals, W, coords, permutations=499)
    ref_ns = int((ref.p_sim >= 0.05).sum())
    assert out["counts"]["ns"] == ref_ns


# ── GWR: recovery of known relationships + new diagnostics ──────────────────

def test_gwr_recovers_constant_relationship():
    rng = np.random.default_rng(3)
    coords = grid(8)
    x = rng.normal(0, 1, 64)
    y = 3 + 2 * x + rng.normal(0, 0.1, 64)
    out = adv.gwr(y, x.reshape(-1, 1), coords, ["x"])
    assert out["coefficient_summary"]["x"]["mean"] == pytest.approx(2.0, abs=0.15)
    assert out["coefficient_summary"]["intercept"]["mean"] == pytest.approx(3.0, abs=0.15)
    assert out["global_r_squared"] > 0.95


def test_gwr_detects_sign_flip_and_diagnostics_present():
    rng = np.random.default_rng(0)
    coords = grid(6)
    x = rng.normal(0, 1, 36)
    y = np.where(coords[:, 0] < 3, 1 + 2 * x, 1 - 2 * x) + rng.normal(0, 0.2, 36)
    out = adv.gwr(y, x.reshape(-1, 1), coords, ["x"])
    assert out["coefficient_summary"]["x"]["changes_sign"] is True
    # Diagnostics added on the enhance branch: effective parameters must sit
    # between the OLS parameter count and n, and GWR must beat OLS on AICc
    # when the relationship genuinely varies.
    assert 2 < out["effective_parameters"] < 36
    assert out["aicc"] < out["ols_aicc"]


# ── spatial lag: 2SLS recovers a known DGP ──────────────────────────────────

def test_spatial_lag_recovers_known_rho_and_beta():
    rng = np.random.default_rng(1)
    coords = grid(6)
    W = adv.spatial_weights(coords, k=4)
    X = rng.normal(0, 1, (36, 1))
    y = np.linalg.solve(np.eye(36) - 0.5 * W, X[:, 0] * 1.5 + rng.normal(0, 0.3, 36))
    out = adv.spatial_lag_model(y, X, W, ["x"])
    assert out["rho"] == pytest.approx(0.5, abs=0.15)
    assert out["coefficients"]["x"]["coef"] == pytest.approx(1.5, abs=0.2)
    assert out["pseudo_r_squared"] > out["ols_r_squared"] - 0.05


# ── eligibility guard (the teaching-facing type safety) ─────────────────────

def test_eligibility_blocks_spatial_stats_without_coords():
    import pandas as pd
    df = pd.DataFrame({"a": range(20), "b": range(20)})
    out = adv.check_eligibility("morans_i", df, ["a"])
    assert out["ok"] is False and "coordinates" in out["reason"]
