"""
Cartolith — cartography presets: one call, a defensible map.

A novice asked to "make a choropleth" faces scheme, class count, palette,
and legend decisions they cannot yet judge. Presets make those decisions
the way an instructor would, and say why:

  * numeric, roughly symmetric  -> NaturalBreaks (Jenks), 5 classes
  * numeric, skewed             -> Quantiles (equal counts read honestly
                                   when a long tail would empty the
                                   middle Jenks classes)
  * few distinct values         -> categorical, Okabe-Ito palette
  * points + numeric            -> proportional symbols (sqrt scaling)
  * points, many              -> heatmap spec

Palettes are colourblind-safe only: ColorBrewer sequential schemes rated
colourblind-safe (Blues, YlGnBu, BuPu) and the Okabe-Ito categorical set.
A preset REFUSES unsuitable data with a reason and a suggested
alternative instead of producing a confident wrong map.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

SEQUENTIAL_PALETTES = {
    "blues": ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
    "ylgnbu": ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"],
    "bupu": ["#f1eef6", "#bdc9e1", "#74a9cf", "#2b8cbe", "#045a8d"],
}
OKABE_ITO = ["#E69F00", "#56B4E9", "#009E73", "#F0E442",
             "#0072B2", "#D55E00", "#CC79A7", "#000000"]
APPROVED_PALETTES = {**SEQUENTIAL_PALETTES,
                     "okabe-ito": OKABE_ITO}


def _labels(edges: List[float]) -> List[str]:
    def f(v):
        return f"{v:,.0f}" if abs(v) >= 100 else f"{v:.2f}"
    return [f"{f(edges[i])} – {f(edges[i + 1])}" for i in range(len(edges) - 1)]


def choropleth(df: pd.DataFrame, column: str, k: int = 5,
               palette: str = "blues") -> Dict[str, Any]:
    if column not in df.columns:
        return {"ok": False, "reason": f"There is no column called '{column}'.",
                "suggestion": "Pick one of the dataset's numeric columns."}
    s = pd.to_numeric(df[column], errors="coerce")
    if s.notna().mean() < 0.5:
        cats = df[column].dropna().astype(str)
        if cats.nunique() <= len(OKABE_ITO):
            return categorical(df, column)
        return {"ok": False,
                "reason": f"'{column}' is text, and a choropleth shades areas "
                          "by a number — text cannot be shaded by size.",
                "suggestion": "Use a categorical map if the column has a few "
                              "distinct labels, or count occurrences first "
                              "(SQL Lab: SELECT column, COUNT(*) ... GROUP BY)."}
    vals = s.dropna().values.astype(float)
    if len(np.unique(vals)) <= 8:
        return categorical(df, column)
    if palette not in SEQUENTIAL_PALETTES:
        palette = "blues"
    import mapclassify as mc
    skew = float(pd.Series(vals).skew())
    scheme = "Quantiles" if abs(skew) > 1.0 else "NaturalBreaks"
    try:
        clf = (mc.Quantiles(vals, k=k) if scheme == "Quantiles"
               else mc.NaturalBreaks(vals, k=k))
        edges = [float(vals.min())] + [float(b) for b in clf.bins]
    except Exception:
        clf = mc.Quantiles(vals, k=k)
        scheme = "Quantiles"
        edges = [float(vals.min())] + [float(b) for b in clf.bins]
    colors = SEQUENTIAL_PALETTES[palette]
    while len(colors) < len(edges) - 1:  # k>5: extend by repeating the ramp logic
        colors = colors + [colors[-1]]
    return {"ok": True, "kind": "choropleth", "column": column,
            "scheme": scheme, "bins": edges, "palette": colors[:len(edges) - 1],
            "palette_name": palette, "legend_labels": _labels(edges),
            "why": (f"{scheme} with {len(edges) - 1} classes: "
                    + ("the data are skewed, so equal-count classes keep every "
                       "class populated and honest." if scheme == "Quantiles"
                       else "the data are roughly symmetric, so natural breaks "
                            "follow the data's own clusters.")),
            "note": "Class breaks change the story a choropleth tells — try "
                    "another scheme in the Cartography tab and compare."}


def categorical(df: pd.DataFrame, column: str) -> Dict[str, Any]:
    cats = df[column].dropna().astype(str)
    values = sorted(cats.unique().tolist())
    if len(values) > len(OKABE_ITO):
        return {"ok": False,
                "reason": f"'{column}' has {len(values)} distinct values — too "
                          "many to tell apart by colour.",
                "suggestion": "Group rare values into 'Other' first, or use a "
                              "bar chart (Visualize tab) instead of a map."}
    return {"ok": True, "kind": "categorical", "column": column,
            "categories": values,
            "palette": OKABE_ITO[:len(values)], "palette_name": "okabe-ito",
            "legend_labels": values,
            "why": "Okabe-Ito colours stay distinguishable for the common "
                   "forms of colour-vision deficiency."}


def proportional_points(df: pd.DataFrame, column: str) -> Dict[str, Any]:
    if column not in df.columns:
        return {"ok": False, "reason": f"There is no column called '{column}'.",
                "suggestion": "Pick one of the dataset's numeric columns."}
    s = pd.to_numeric(df[column], errors="coerce")
    if s.notna().mean() < 0.5:
        return {"ok": False,
                "reason": f"'{column}' is not numeric — symbol SIZE needs a number.",
                "suggestion": "Use the categorical preset for labels, or a "
                              "choropleth for a numeric column."}
    vals = s.dropna().values.astype(float)
    if (vals < 0).any():
        return {"ok": False,
                "reason": f"'{column}' contains negative values, which cannot "
                          "be symbol sizes.",
                "suggestion": "Use a choropleth (diverging story) or shift the "
                              "variable so zero is meaningful."}
    vmax = float(vals.max()) or 1.0
    return {"ok": True, "kind": "proportional_points", "column": column,
            "size_rule": "radius_px = 3 + 17 * sqrt(value / max_value)",
            "max_value": vmax, "palette": [OKABE_ITO[4]],
            "palette_name": "okabe-ito",
            "legend_labels": [f"{vmax * f:,.0f}" for f in (0.25, 0.5, 1.0)],
            "why": "Symbol AREA must grow with value, so radius scales with "
                   "the square root — linear radius doubles the visual lie."}


def heatmap(df: pd.DataFrame) -> Dict[str, Any]:
    return {"ok": True, "kind": "heatmap",
            "spec": {"radius": 18, "blur": 14, "min_opacity": 0.25,
                     "gradient": {0.2: "#56B4E9", 0.5: "#F0E442", 1.0: "#D55E00"}},
            "palette_name": "okabe-ito-derived",
            "why": "Density surface for point patterns too dense to read "
                   "individually. A heatmap shows WHERE points concentrate — "
                   "it is not a choropleth and must not be read as values."}


def preset(df: pd.DataFrame, column: Optional[str] = None,
           geom_types: Optional[List[str]] = None,
           kind: str = "auto") -> Dict[str, Any]:
    """Auto-select: points+numeric -> proportional (or heatmap when dense);
    polygons/any + numeric -> choropleth; text -> categorical or refusal."""
    types = set(geom_types or [])
    if kind == "heatmap" or (kind == "auto" and "Point" in types
                             and column is None and len(df) >= 30):
        return heatmap(df)
    if column is None:
        return {"ok": False, "reason": "Tell me which column to map.",
                "suggestion": "Choose a numeric column for a choropleth or "
                              "proportional symbols."}
    if kind == "proportional_points" or (kind == "auto" and "Point" in types):
        out = proportional_points(df, column)
        if out.get("ok"):
            return out
        if "Point" in types:  # fall through to refusal/suggestion as-is
            return out
    return choropleth(df, column)
