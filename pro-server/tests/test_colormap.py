import numpy as np
import pytest

from pro_server.colormap import Legend
from pro_server.products import CATALOG

LEGENDS = {p.id: p.legend for p in CATALOG if p.kind == "value"}


def test_value_products_have_legends_and_rgb_do_not():
    for p in CATALOG:
        assert (p.legend is not None) == (p.kind == "value"), p.id


@pytest.mark.parametrize("pid", sorted(LEGENDS))
def test_stops_exact_and_edges(pid):
    lg: Legend = LEGENDS[pid]
    vals, cols = lg.values, lg.colors
    assert np.all(np.diff(vals) > 0)
    img = lg.apply(vals[None, :])
    np.testing.assert_array_equal(img[0, :, :3], cols.astype(np.uint8))
    assert np.all(img[0, :, 3] == 255)
    below = lg.apply(np.array([[vals[0] - 1e-6, np.nan, -3.0, 0.0 if vals[0] > 0 else -1e9]]))
    assert np.all(below == 0)  # transparent, rgb zeroed
    above = lg.apply(np.array([[vals[-1] * 10]]))
    np.testing.assert_array_equal(above[0, 0], list(cols[-1].astype(np.uint8)) + [255])


@pytest.mark.parametrize("pid", sorted(LEGENDS))
def test_pixels_are_stop_colours_or_linear_interpolations(pid):
    lg: Legend = LEGENDS[pid]
    vals, cols = lg.values, lg.colors
    v = np.linspace(vals[0], vals[-1], 20001)
    rgba = lg.apply(v[None, :])[0]
    for k in range(len(vals) - 1):
        sel = (v >= vals[k]) & (v <= vals[k + 1])
        t = (v[sel] - vals[k]) / (vals[k + 1] - vals[k])
        expected = np.rint(cols[k] + t[:, None] * (cols[k + 1] - cols[k]))
        # at a shared stop either neighbouring segment gives the same colour
        np.testing.assert_array_equal(rgba[sel, :3], expected.astype(np.uint8))


@pytest.mark.parametrize("pid", sorted(LEGENDS))
def test_colour_to_value_round_trip(pid):
    lg: Legend = LEGENDS[pid]
    vals, cols = lg.values, lg.colors
    v = np.linspace(vals[0], vals[-1], 50001)
    back = lg.invert(lg.apply(v[None, :]))[0]
    # "colour quantum": value change per unit of RGB distance along each segment
    q = (vals[1:] - vals[:-1]) / np.linalg.norm(cols[1:] - cols[:-1], axis=1)
    seg = np.clip(np.searchsorted(vals, v, side="right") - 1, 0, len(vals) - 2)
    q_local = np.maximum.reduce([q[seg], q[np.maximum(seg - 1, 0)], q[np.minimum(seg + 1, len(q) - 1)]])
    err = np.abs(back - v)
    # Integer rounding moves a colour <= sqrt(3)/2 RGB units; next to a stop the
    # nearest segment can be the neighbouring one, so allow a few quanta.
    assert np.all(err <= 4 * q_local), f"max err/q {np.max(err / q_local):.2f}"
    # and the read-back value is always within one displayed unit
    assert err.max() < 10.0 ** (-lg.decimals), err.max()
    assert np.all(np.isnan(lg.invert(np.zeros((3, 4)))))  # alpha 0 -> no value


def test_json_shape():
    j = LEGENDS["mrms-mesh"].to_json()
    assert j["unit"] == "in" and j["decimals"] == 2
    assert all(set(s) == {"value", "color"} and s["color"].startswith("#") and len(s["color"]) == 7
               for s in j["stops"])
    assert [s["value"] for s in j["stops"]] == sorted(s["value"] for s in j["stops"])
