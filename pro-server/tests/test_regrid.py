import numpy as np
import pytest

from pro_server.mercator import height_for_width, lonlat_to_pixel
from pro_server.products import MRMS_BOUNDS
from pro_server.regrid import pool_max


def _grid(bounds, step):
    w, s, e, n = bounds
    lats = np.arange(n - step / 2, s, -step)  # north -> south cell centres, like MRMS
    lons = np.arange(w + step / 2, e, step)
    return lats, lons


@pytest.mark.parametrize("step,width", [(0.01, 3500), (0.005, 3500), (0.01, 900)])
def test_hot_cells_land_on_the_right_pixel(step, width):
    b = MRMS_BOUNDS
    lats, lons = _grid(b, step)
    vals = np.full((lats.size, lons.size), -3.0, dtype=np.float64)  # "no coverage"
    height = height_for_width(b, width)
    spots = [(35.2215, -97.4395, 50.0), (25.7617, -80.1918, 20.0), (47.6062, -122.3321, 70.0), (54.99, -60.01, 5.0)]
    for lat, lon, v in spots:
        r = int(np.argmin(np.abs(lats - lat)))
        c = int(np.argmin(np.abs(lons - lon)))
        vals[r, c] = v
    out = pool_max(vals, lats, lons, b, width, height)
    assert out.shape == (height, width)
    for lat, lon, v in spots:
        r = int(np.argmin(np.abs(lats - lat)))
        c = int(np.argmin(np.abs(lons - lon)))
        col, row = lonlat_to_pixel(lons[c], lats[r], b, width, height)
        assert out[int(row), int(col)] == v
    assert np.sum(out > 0) == len(spots)  # max pooling: nothing lost, nothing smeared
    assert np.nanmin(out) == -3.0


def test_orientation_independent():
    b = (-100.0, 30.0, -90.0, 40.0)
    lats, lons = _grid(b, 0.01)
    rng = np.random.default_rng(0)
    vals = rng.random((lats.size, lons.size))
    a = pool_max(vals, lats, lons, b, 400, height_for_width(b, 400))
    flipped = pool_max(vals[::-1, ::-1], lats[::-1], lons[::-1], b, 400, height_for_width(b, 400))
    np.testing.assert_array_equal(a, flipped)
    assert np.nanmax(a) == pytest.approx(vals.max())


def test_outside_source_is_nan():
    src = (-100.0, 30.0, -90.0, 40.0)
    lats, lons = _grid(src, 0.01)
    vals = np.ones((lats.size, lons.size))
    big = (-110.0, 25.0, -80.0, 45.0)
    out = pool_max(vals, lats, lons, big, 600, height_for_width(big, 600))
    col, row = lonlat_to_pixel(-105.0, 42.0, big, 600, out.shape[0])
    assert np.isnan(out[int(row), int(col)])
    col, row = lonlat_to_pixel(-95.0, 35.0, big, 600, out.shape[0])
    assert out[int(row), int(col)] == 1.0
