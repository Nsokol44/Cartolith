"""
Usability backends: quick analysis (interpretations must be CORRECT, not
just present) and cartography presets (guardrails, approved palettes,
bins that cover the data).
"""
import numpy as np
import pandas as pd
import pytest

import carto_presets as cp
import main
import quick_analysis as qa


def gradient_df(n=6, seed=0):
    rng = np.random.default_rng(seed)
    rows = [(x, y, x + y + rng.normal(0, 0.3)) for y in range(n) for x in range(n)]
    df = pd.DataFrame(rows, columns=["lon", "lat", "value"])
    df["pop"] = 50 + 10 * df["value"] + rng.normal(0, 2, len(df))
    return df


def test_quick_analysis_clustered_interpretation_is_correct():
    out = qa.quick_analysis(gradient_df(), ["value", "pop"])
    m = out["results"]["morans_i"]
    assert m["p_value"] < 0.05 and m["I"] > 0.5
    assert "clustered" in m["interpretation"]
    assert "describe" in out["results"] and "correlation" in out["results"]
    assert "regression" in out["results"]
    assert out["n_rows_dropped_missing"] == 0


def test_quick_analysis_random_interpretation_says_no_pattern():
    rng = np.random.default_rng(11)
    df = gradient_df()
    df["value"] = rng.normal(0, 1, len(df))
    out = qa.quick_analysis(df, ["value"])
    m = out["results"]["morans_i"]
    assert m["p_value"] >= 0.05
    assert "no significant spatial pattern" in m["interpretation"]


def test_quick_analysis_reports_dropped_missing_rows():
    df = gradient_df()
    df.loc[0, "value"] = np.nan
    df.loc[1, "value"] = np.nan
    out = qa.quick_analysis(df, ["value"])
    assert out["n_rows_dropped_missing"] == 2
    assert "2 row(s) were dropped" in out["missing_data_note"]


def test_quick_analysis_unavailable_methods_explain_themselves():
    df = pd.DataFrame({"label": ["a", "b", "c"] * 5})
    out = qa.quick_analysis(df, ["label"])
    reasons = {u["method"]: u for u in out["unavailable"]}
    assert "morans_i" in reasons and reasons["morans_i"]["fix"]


def test_quick_analysis_endpoint():
    from fastapi.testclient import TestClient
    main.datasets["grad"] = gradient_df()
    client = TestClient(main.app)
    r = client.post("/api/quick-analysis",
                    json={"dataset_id": "grad", "columns": ["value", "pop"]})
    assert r.status_code == 200
    assert "clustered" in r.json()["results"]["morans_i"]["interpretation"]
    r = client.post("/api/quick-analysis",
                    json={"dataset_id": "nope", "columns": ["x"]})
    assert r.status_code == 404


# ── carto presets ───────────────────────────────────────────────────────────

def test_choropleth_bins_cover_range_and_palette_approved():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"v": rng.normal(100, 15, 200)})
    out = cp.choropleth(df, "v")
    assert out["ok"] and out["scheme"] == "NaturalBreaks"
    assert out["bins"][0] <= df["v"].min() and out["bins"][-1] >= df["v"].max() - 1e-6
    assert out["palette"] == cp.APPROVED_PALETTES[out["palette_name"]][:len(out["palette"])]
    assert len(out["legend_labels"]) == len(out["bins"]) - 1


def test_choropleth_skewed_data_gets_quantiles():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"v": rng.lognormal(0, 1.5, 300)})
    out = cp.choropleth(df, "v")
    assert out["ok"] and out["scheme"] == "Quantiles"


def test_choropleth_refuses_text_with_alternative():
    df = pd.DataFrame({"city": ["a", "b", "c"] * 10,
                       "kind": ["x", "y", "z"] * 10})
    out = cp.choropleth(df, "city")
    # 3 distinct labels -> sensible categorical map instead of a refusal
    assert out["ok"] and out["kind"] == "categorical"
    df2 = pd.DataFrame({"free": [f"word{i}" for i in range(30)]})
    out2 = cp.choropleth(df2, "free")
    assert not out2["ok"] and "suggestion" in out2


def test_categorical_palette_is_okabe_ito():
    df = pd.DataFrame({"k": ["a", "b", "c", "a"]})
    out = cp.categorical(df, "k")
    assert out["palette"] == cp.OKABE_ITO[:3]
    too_many = pd.DataFrame({"k": [str(i) for i in range(12)]})
    assert not cp.categorical(too_many, "k")["ok"]


def test_proportional_points_rules_and_refusals():
    df = pd.DataFrame({"pop": [100.0, 400.0, 900.0]})
    out = cp.proportional_points(df, "pop")
    assert out["ok"] and "sqrt" in out["size_rule"]
    neg = pd.DataFrame({"t": [-5.0, 3.0]})
    out2 = cp.proportional_points(neg, "t")
    assert not out2["ok"] and "negative" in out2["reason"]


def test_preset_auto_and_endpoint():
    from fastapi.testclient import TestClient
    df = gradient_df()
    df["_geom_type"] = "Point"
    main.datasets["pts2"] = df
    client = TestClient(main.app)
    r = client.post("/api/carto/preset",
                    json={"dataset_id": "pts2", "column": "value"})
    body = r.json()
    assert r.status_code == 200 and body["ok"] and body["kind"] == "proportional_points"
    r = client.post("/api/carto/preset",
                    json={"dataset_id": "pts2", "column": "missing"})
    assert r.json()["ok"] is False
