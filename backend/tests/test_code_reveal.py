"""Code reveal: every tool Cartolith runs must have an equivalent-Python
snippet, and the snippet must name the operation a Python user would
actually use — otherwise the 'transfer' promise is empty."""
import pytest

import code_reveal
import main


def _all_tool_ids():
    return (list(main.GEOPROCESS_TOOLS) + list(main.RASTER_TOOLS)
            + list(main.NETWORK_TOOLS))


def test_every_tool_has_a_snippet():
    missing = [t for t in _all_tool_ids() if not code_reveal.snippet_for(t, {})]
    assert missing == [], f"tools without code reveal: {missing}"


@pytest.mark.parametrize("tool,token", [
    ("buffer", ".buffer("),
    ("spatial_join", "sjoin"),
    ("clip", "gpd.clip"),
    ("intersection", "overlay"),
    ("dissolve", "dissolve"),
    ("ndvi", "(nir - red) / (nir + red)"),
    ("evi", "7.5 * blue"),
    ("zonal_stats", "mask"),
    ("regular_grid", "cos"),  # the latitude correction must be IN the snippet
])
def test_snippet_names_the_right_function(tool, token):
    s = code_reveal.snippet_for(tool, {"distance": 500, "red": 3, "nir": 4,
                                       "green": 2, "blue": 1, "cell_km": 5})
    assert s is not None and token in s


def test_snippet_interpolates_real_parameters():
    s = code_reveal.snippet_for("buffer", {"distance": 2500}, src="cities")
    assert "2500" in s and "cities" in s


def test_unknown_tool_returns_none():
    assert code_reveal.snippet_for("not_a_tool", {}) is None
