"""Spherical (Web) Mercator helpers, EPSG:3857.

An overlay PNG with ``bounds = [west, south, east, north]`` and size
``width x height`` maps pixels to the map like this (pixel edges, origin at
the top-left corner of the image):

    col = (x(lon) - x(west))  / (x(east)  - x(west))  * width
    row = (y(north) - y(lat)) / (y(north) - y(south)) * height

i.e. x is linear in longitude and y is linear in Mercator Y. That is exactly
how MapLibre interpolates an image source placed with its four corners.
"""

from __future__ import annotations

import math

import numpy as np

R = 6378137.0  # EPSG:3857 sphere radius (metres)
MAX_LAT = 85.0511287798066


def merc_x(lon):
    return R * np.radians(lon)


def merc_y(lat):
    lat = np.clip(lat, -MAX_LAT, MAX_LAT)
    return R * np.log(np.tan(np.pi / 4.0 + np.radians(lat) / 2.0))


def inv_merc_x(x):
    return np.degrees(np.asarray(x, dtype=float) / R)


def inv_merc_y(y):
    return np.degrees(2.0 * np.arctan(np.exp(np.asarray(y, dtype=float) / R)) - np.pi / 2.0)


def extent_m(bounds):
    """(xmin, ymin, xmax, ymax) in metres for [west, south, east, north] in degrees."""
    west, south, east, north = bounds
    return (float(merc_x(west)), float(merc_y(south)), float(merc_x(east)), float(merc_y(north)))


def height_for_width(bounds, width: int) -> int:
    """Image height that gives (as near as possible) square Mercator pixels."""
    x0, y0, x1, y1 = extent_m(bounds)
    return max(1, int(round(width * (y1 - y0) / (x1 - x0))))


def lonlat_to_pixel(lon, lat, bounds, width: int, height: int):
    """Fractional (col, row) in pixel-edge coordinates; pixel (i, j) spans [i, i+1) x [j, j+1)."""
    x0, y0, x1, y1 = extent_m(bounds)
    col = (merc_x(lon) - x0) / (x1 - x0) * width
    row = (y1 - merc_y(lat)) / (y1 - y0) * height
    return col, row


def pixel_to_lonlat(col, row, bounds, width: int, height: int):
    """Inverse of :func:`lonlat_to_pixel` (pass ``i + 0.5`` for a pixel centre)."""
    x0, y0, x1, y1 = extent_m(bounds)
    lon = inv_merc_x(x0 + np.asarray(col, dtype=float) / width * (x1 - x0))
    lat = inv_merc_y(y1 - np.asarray(row, dtype=float) / height * (y1 - y0))
    return lon, lat


def area_definition(bounds, width: int, height: int | None = None, area_id: str = "webmerc"):
    """pyresample AreaDefinition whose outer pixel edges are exactly ``bounds``."""
    from pyresample.geometry import AreaDefinition  # heavy import, keep lazy

    if height is None:
        height = height_for_width(bounds, width)
    return AreaDefinition(area_id, area_id, area_id, "EPSG:3857", int(width), int(height), extent_m(bounds))


def km_per_pixel(bounds, width: int, lat: float) -> float:
    """True ground size of one output pixel at ``lat`` (for docs/logging)."""
    x0, _, x1, _ = extent_m(bounds)
    return (x1 - x0) / width * math.cos(math.radians(lat)) / 1000.0
