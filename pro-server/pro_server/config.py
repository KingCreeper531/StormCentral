"""Runtime settings, all overridable with environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return default if v is None or v.strip() == "" else v.strip()


def _bounds(s: str) -> tuple[float, float, float, float]:
    parts = [float(p) for p in s.split(",")]
    if len(parts) != 4:
        raise ValueError(f"bounds need 4 numbers west,south,east,north: {s!r}")
    return tuple(parts)  # type: ignore[return-value]


@dataclass
class Settings:
    output_dir: Path = field(default_factory=lambda: Path(_env("OUTPUT_DIR", "output")).resolve())
    work_dir: Path = field(default_factory=lambda: Path(_env("WORK_DIR", "work")).resolve())
    poll_seconds: int = field(default_factory=lambda: int(_env("POLL_SECONDS", "120")))
    keep_frames: int = field(default_factory=lambda: int(_env("KEEP_FRAMES", "12")))
    # On a cold start (product has no frames yet) process this many recent source files.
    backfill_frames: int = field(default_factory=lambda: int(_env("BACKFILL_FRAMES", "3")))
    # Comma separated product ids, or "all".
    products: str = field(default_factory=lambda: _env("PRODUCTS", "all"))

    goes_bucket: str = field(default_factory=lambda: _env("GOES_BUCKET", "noaa-goes19"))
    goes_width: int = field(default_factory=lambda: int(_env("GOES_WIDTH", "3000")))
    goes_bounds: tuple = field(default_factory=lambda: _bounds(_env("GOES_BOUNDS", "-140,14.5,-53,56.5")))
    # pyresample resampler used for geostationary -> Web Mercator.
    goes_resampler: str = field(default_factory=lambda: _env("GOES_RESAMPLER", "gradient_search"))

    mrms_bucket: str = field(default_factory=lambda: _env("MRMS_BUCKET", "noaa-mrms-pds"))
    mrms_width: int = field(default_factory=lambda: int(_env("MRMS_WIDTH", "3500")))
    # Skip MRMS files closer than this to the previous kept frame (0 = keep every ~2-min file).
    mrms_min_spacing_minutes: float = field(default_factory=lambda: float(_env("MRMS_MIN_SPACING_MINUTES", "0")))

    # Lightning (GOES GLM flashes): GOES-East is goes_bucket; West covers the rest of the window.
    lightning: bool = field(default_factory=lambda: _env("LIGHTNING", "1") not in ("0", "false", "no"))
    lightning_west_bucket: str = field(default_factory=lambda: _env("LIGHTNING_WEST_BUCKET", "noaa-goes18"))
    lightning_minutes: float = field(default_factory=lambda: float(_env("LIGHTNING_MINUTES", "15")))
    lightning_poll_seconds: int = field(default_factory=lambda: int(_env("LIGHTNING_POLL_SECONDS", "30")))
    # West of this longitude GOES-West's view is used, east of it GOES-East's (about halfway between them).
    lightning_split_lon: float = field(default_factory=lambda: float(_env("LIGHTNING_SPLIT_LON", "-106")))
    lightning_bounds: tuple = field(default_factory=lambda: _bounds(_env("LIGHTNING_BOUNDS", "-170,5,-50,72")))

    # Restart (exit 75; Docker brings the processor back) when resident memory passes this.
    # 0: 85 % of the container's memory limit, if it has one.
    memory_limit_mb: float = field(default_factory=lambda: float(_env("MEMORY_LIMIT_MB", "0")))

    dask_workers: int = field(default_factory=lambda: int(_env("DASK_WORKERS", str(min(4, os.cpu_count() or 1)))))
    png_compress_level: int = field(default_factory=lambda: int(_env("PNG_COMPRESS_LEVEL", "6")))
    http_timeout: int = field(default_factory=lambda: int(_env("HTTP_TIMEOUT", "120")))
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))
