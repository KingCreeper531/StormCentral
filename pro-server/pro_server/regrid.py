"""Max-pooling a regular lat/lon grid onto a Web Mercator image grid.

Each source cell is assigned to the output pixel that contains its centre and
every output pixel takes the maximum of its cells. Max (rather than nearest or
mean) keeps small hail cores / rotation maxima visible when the 0.01 deg or
0.005 deg MRMS grid is shrunk to a browser-friendly image. If an output pixel
contains no source centre (only when upsampling) it takes the next source cell.
"""

from __future__ import annotations

import numpy as np

from .mercator import extent_m, merc_x, merc_y


def _ranges(out_pos: np.ndarray, n_out: int):
    """out_pos: fractional output index per source cell (monotonic increasing).

    Returns (lo, hi, o0, o1, starts): source cells lo:hi fall inside the image,
    they cover output pixels o0:o1, and ``starts`` (relative to lo, one per
    output pixel in o0:o1) are the np.ufunc.reduceat indices.
    """
    idx = np.floor(out_pos).astype(np.int64)
    ok = np.nonzero((idx >= 0) & (idx < n_out))[0]
    if ok.size == 0:
        return None
    lo, hi = int(ok[0]), int(ok[-1]) + 1
    sub = idx[lo:hi]
    o0, o1 = int(sub[0]), int(sub[-1]) + 1
    starts = np.searchsorted(sub, np.arange(o0, o1), side="left")
    return lo, hi, o0, o1, starts


def pool_max(values: np.ndarray, lats: np.ndarray, lons: np.ndarray, bounds, width: int, height: int,
             band_rows: int = 512) -> np.ndarray:
    """values[r, c] at (lats[r], lons[c]) -> float32 (height, width) Mercator image (NaN outside the grid).

    Missing / no-coverage values should already be negative or NaN; NaN is ignored by the max.
    """
    lats = np.asarray(lats, dtype=np.float64)
    lons = np.asarray(lons, dtype=np.float64)
    if lats[0] < lats[-1]:  # make rows north -> south
        values, lats = values[::-1], lats[::-1]
    if lons[0] > lons[-1]:  # make columns west -> east
        values, lons = values[:, ::-1], lons[::-1]

    x0, y0, x1, y1 = extent_m(bounds)
    col_pos = (merc_x(lons) - x0) / (x1 - x0) * width
    row_pos = (y1 - merc_y(lats)) / (y1 - y0) * height
    out = np.full((height, width), np.nan, dtype=np.float32)
    cr, rr = _ranges(col_pos, width), _ranges(row_pos, height)
    if cr is None or rr is None:
        return out
    c_lo, c_hi, oc0, oc1, c_starts = cr
    r_lo, r_hi, or0, or1, r_starts = rr

    # 1) pool columns, a band of rows at a time (keeps float64 temporaries small)
    colpooled = np.empty((r_hi - r_lo, oc1 - oc0), dtype=np.float32)
    for b0 in range(r_lo, r_hi, band_rows):
        b1 = min(b0 + band_rows, r_hi)
        colpooled[b0 - r_lo : b1 - r_lo] = np.fmax.reduceat(values[b0:b1, c_lo:c_hi], c_starts, axis=1)
    # 2) pool rows
    out[or0:or1, oc0:oc1] = np.fmax.reduceat(colpooled, r_starts, axis=0)
    return out
