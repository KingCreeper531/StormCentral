import numpy as np
import pytest

from pro_server.mercator import (R, area_definition, extent_m, height_for_width, lonlat_to_pixel, merc_x, merc_y,
                                 pixel_to_lonlat)
from pro_server.products import MRMS_BOUNDS

GOES_BOUNDS = (-140.0, 14.5, -53.0, 56.5)
HALF_WORLD = np.pi * R  # 20037508.34 m


def test_known_mercator_values():
    assert merc_x(0) == 0
    assert merc_y(0) == pytest.approx(0, abs=1e-6)
    assert merc_x(180) == pytest.approx(HALF_WORLD)
    assert merc_y(85.0511287798066) == pytest.approx(HALF_WORLD, rel=1e-9)
    assert merc_y(45) == pytest.approx(5621521.486, abs=1e-3)


@pytest.mark.parametrize("bounds,width", [(MRMS_BOUNDS, 3500), (GOES_BOUNDS, 3000), ((-10, -60, 170, 70), 777)])
def test_corners_and_roundtrip(bounds, width):
    height = height_for_width(bounds, width)
    w, s, e, n = bounds
    assert lonlat_to_pixel(w, n, bounds, width, height) == pytest.approx((0, 0), abs=1e-9)
    assert lonlat_to_pixel(e, s, bounds, width, height) == pytest.approx((width, height), abs=1e-6)
    rng = np.random.default_rng(1)
    lon = rng.uniform(w, e, 1000)
    lat = rng.uniform(s, n, 1000)
    c, r = lonlat_to_pixel(lon, lat, bounds, width, height)
    lon2, lat2 = pixel_to_lonlat(c, r, bounds, width, height)
    np.testing.assert_allclose(lon2, lon, atol=1e-9)
    np.testing.assert_allclose(lat2, lat, atol=1e-9)


def test_x_linear_in_lon_y_linear_in_mercator_not_lat():
    b, width = MRMS_BOUNDS, 3500
    height = height_for_width(b, width)
    c, _ = lonlat_to_pixel(-95.0, 30.0, b, width, height)
    assert c == pytest.approx(width / 2)  # -95 is halfway between -130 and -60
    y_mid = (merc_y(20.0) + merc_y(55.0)) / 2
    lat_mid = np.degrees(2 * np.arctan(np.exp(y_mid / R)) - np.pi / 2)
    _, r = lonlat_to_pixel(-95.0, lat_mid, b, width, height)
    assert r == pytest.approx(height / 2)
    _, r_deg_mid = lonlat_to_pixel(-95.0, 37.5, b, width, height)
    assert r_deg_mid > height / 2 + 50  # 37.5N is well below the image centre in Mercator


def test_square_pixels():
    for b, w in [(MRMS_BOUNDS, 3500), (GOES_BOUNDS, 3000)]:
        h = height_for_width(b, w)
        x0, y0, x1, y1 = extent_m(b)
        assert (x1 - x0) / w == pytest.approx((y1 - y0) / h, rel=1e-3)
    assert height_for_width(MRMS_BOUNDS, 3500) == 2286
    assert height_for_width(GOES_BOUNDS, 3000) == 1867


def test_pyresample_area_matches_contract():
    """The AreaDefinition the GOES path resamples onto must agree with lonlat_to_pixel."""
    pytest.importorskip("pyresample")
    width = 300
    area = area_definition(GOES_BOUNDS, width)
    height = area.height
    assert area.area_extent == pytest.approx(extent_m(GOES_BOUNDS))
    assert area.crs.to_epsg() == 3857
    for row, col in [(0, 0), (height - 1, width - 1), (123, 45), (height // 2, width // 3)]:
        lon, lat = area.get_lonlat(row, col)
        exp_lon, exp_lat = pixel_to_lonlat(col + 0.5, row + 0.5, GOES_BOUNDS, width, height)
        assert lon == pytest.approx(exp_lon, abs=1e-7)
        assert lat == pytest.approx(exp_lat, abs=1e-7)
