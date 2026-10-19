"""Value -> colour tables for the "value" (MRMS) products.

Contract with the app: every opaque pixel is either exactly a stop colour or
the linear interpolation (rounded to the nearest integer per channel) between
two consecutive stops, so the app can turn a pixel colour back into a value.

* value < first stop, NaN, missing  -> fully transparent (0, 0, 0, 0)
* value > last stop                 -> last stop colour (read back as ">= last")
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


@dataclass(frozen=True)
class Legend:
    unit: str
    decimals: int
    stops: tuple[tuple[float, str], ...]  # (value, "#rrggbb"), ascending

    def __post_init__(self):
        vals = [v for v, _ in self.stops]
        if len(vals) < 2 or any(b <= a for a, b in zip(vals, vals[1:])):
            raise ValueError("legend stops must be >= 2 and strictly ascending")

    @property
    def values(self) -> np.ndarray:
        return np.array([v for v, _ in self.stops], dtype=np.float64)

    @property
    def colors(self) -> np.ndarray:
        return np.array([_hex_to_rgb(c) for _, c in self.stops], dtype=np.float64)

    def to_json(self) -> dict:
        return {
            "unit": self.unit,
            "decimals": self.decimals,
            "stops": [{"value": v, "color": c.lower()} for v, c in self.stops],
        }

    def apply(self, data: np.ndarray) -> np.ndarray:
        """Map a 2-D float array (already in legend units) to an RGBA uint8 image."""
        sv, sc = self.values, self.colors
        data = np.asarray(data)
        out = np.zeros(data.shape + (4,), dtype=np.uint8)
        valid = np.isfinite(data) & (data >= sv[0])
        v = np.clip(data[valid].astype(np.float64), sv[0], sv[-1])
        i = np.clip(np.searchsorted(sv, v, side="right") - 1, 0, len(sv) - 2)
        t = (v - sv[i]) / (sv[i + 1] - sv[i])
        rgb = sc[i] + t[:, None] * (sc[i + 1] - sc[i])
        px = np.empty((v.size, 4), dtype=np.uint8)
        px[:, :3] = np.rint(rgb).astype(np.uint8)
        px[:, 3] = 255
        out[valid] = px
        return out

    def invert(self, rgba) -> np.ndarray:
        """Colour(s) -> value(s): project onto the nearest legend segment (NaN where alpha == 0).

        This is the reference implementation of what the app does to read values back.
        """
        rgba = np.asarray(rgba, dtype=np.float64)
        flat = rgba.reshape(-1, rgba.shape[-1])
        rgb = flat[:, :3]
        sv, sc = self.values, self.colors
        best_d = np.full(len(flat), np.inf)
        best_v = np.full(len(flat), np.nan)
        for k in range(len(sv) - 1):
            a, d = sc[k], sc[k + 1] - sc[k]
            t = np.clip(((rgb - a) @ d) / float(d @ d), 0.0, 1.0)
            dist = np.sum((rgb - (a + t[:, None] * d)) ** 2, axis=1)
            better = dist < best_d
            best_d[better] = dist[better]
            best_v[better] = sv[k] + t[better] * (sv[k + 1] - sv[k])
        if flat.shape[1] == 4:
            best_v[flat[:, 3] == 0] = np.nan
        return best_v.reshape(rgba.shape[:-1])
