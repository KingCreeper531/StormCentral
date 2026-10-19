"""MRMS (noaa-mrms-pds) GRIB2 -> coloured Web Mercator PNG."""

from __future__ import annotations

import datetime as dt
import gc
import gzip
import logging
import re
import time

import numpy as np

from . import s3
from .config import Settings
from .mercator import height_for_width
from .output import Manifest, save_png
from .products import MRMS_BOUNDS, Product
from .regrid import pool_max

log = logging.getLogger(__name__)

_TIME_RE = re.compile(r"_(\d{8})-(\d{6})\.grib2\.gz$")


def key_time(key: str) -> dt.datetime | None:
    m = _TIME_RE.search(key)
    if not m:
        return None
    return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)


def list_recent(settings: Settings, product: Product, since: dt.datetime) -> list[tuple[dt.datetime, str]]:
    """Files of ``product`` with valid time > ``since`` (checks the UTC days of since..now)."""
    folder = product.mrms_folder
    now = dt.datetime.now(dt.timezone.utc)
    day = since.date()
    found: list[tuple[dt.datetime, str]] = []
    while day <= now.date():
        prefix = f"CONUS/{folder}/{day:%Y%m%d}/"
        start_after = None
        if day == since.date():
            start_after = f"{prefix}MRMS_{folder}_{since:%Y%m%d-%H%M%S}.grib2.gz"
        for key, _size in s3.list_keys(settings.mrms_bucket, prefix, start_after, settings.http_timeout):
            t = key_time(key)
            if t and t > since:
                found.append((t, key))
        day += dt.timedelta(days=1)
    found.sort()
    return found


def select_new(settings: Settings, manifest: Manifest, product: Product, once: bool) -> list[tuple[dt.datetime, str]]:
    newest = manifest.newest(product.id)
    now = dt.datetime.now(dt.timezone.utc)
    since = newest if (newest and not once) else now - dt.timedelta(hours=1)
    since = max(since, now - dt.timedelta(hours=3))  # after a long outage only the newest frames matter
    cands = list_recent(settings, product, since)
    if not cands:
        return []
    if once:
        return [cands[-1]]
    if newest is None:
        cands = cands[-max(1, settings.backfill_frames) :]
    else:
        cands = cands[-settings.keep_frames :]
    spacing = dt.timedelta(minutes=settings.mrms_min_spacing_minutes)
    if spacing.total_seconds() <= 0:
        return cands
    picked: list[tuple[dt.datetime, str]] = []
    last = newest
    for t, k in cands:
        if last is None or t - last >= spacing:
            picked.append((t, k))
            last = t
    return picked


def decode(raw_gz: bytes):
    """Return (values float64 (rows, cols), lats 1-D, lons 1-D) for one MRMS GRIB2 message."""
    import pygrib  # bundles ecCodes in its wheels (x86_64 and aarch64)

    msg = pygrib.fromstring(gzip.decompress(raw_gz))
    vals = msg.values
    if np.ma.isMaskedArray(vals):
        vals = vals.filled(np.nan)
    nj, ni = int(msg["Nj"]), int(msg["Ni"])
    lat1 = float(msg["latitudeOfFirstGridPointInDegrees"])
    lon1 = float(msg["longitudeOfFirstGridPointInDegrees"])
    dlat = float(msg["jDirectionIncrementInDegrees"])
    dlon = float(msg["iDirectionIncrementInDegrees"])
    if int(msg["jScansPositively"]) == 0:
        dlat = -dlat
    if int(msg["iScansNegatively"]) == 1:
        dlon = -dlon
    if lon1 > 180.0:
        lon1 -= 360.0
    lats = lat1 + dlat * np.arange(nj)
    lons = lon1 + dlon * np.arange(ni)
    if vals.shape != (nj, ni):
        raise ValueError(f"unexpected grid shape {vals.shape} vs {(nj, ni)}")
    return vals, lats, lons


def render(settings: Settings, product: Product, raw_gz: bytes) -> np.ndarray:
    """GRIB2.gz bytes -> RGBA uint8 image."""
    vals, lats, lons = decode(raw_gz)
    width = settings.mrms_width
    height = height_for_width(MRMS_BOUNDS, width)
    pooled = pool_max(vals, lats, lons, MRMS_BOUNDS, width, height)
    del vals
    gc.collect()
    # MRMS uses negative sentinels (-1 missing, -3 no coverage, -999/-99 in some
    # products); anything <= 0 means "nothing here".
    pooled[~(pooled > 0)] = np.nan
    pooled *= np.float32(product.scale)
    return product.legend.apply(pooled)


def process(settings: Settings, manifest: Manifest, product: Product, once: bool = False) -> int:
    """Fetch and render new files for one MRMS product. Returns the number of frames added."""
    try:
        todo = select_new(settings, manifest, product, once)
    except Exception as e:
        log.error("%s: listing failed: %s", product.id, e)
        return 0
    added = 0
    for t, key in todo:
        if manifest.has(product.id, t):
            continue
        t0 = time.monotonic()
        try:
            raw = s3.get_bytes(settings.mrms_bucket, key, settings.http_timeout)
            rgba = render(settings, product, raw)
            path, url = manifest.frame_path(product.id, t)
            save_png(rgba, path, settings.png_compress_level)
        except Exception:
            log.exception("%s: failed on %s", product.id, key)
            continue
        finally:
            gc.collect()
        manifest.add(product.id, t, url)
        added += 1
        log.info("%s: %s -> %s (%.1fs, %d KB)", product.id, key.rsplit("/", 1)[-1], url,
                 time.monotonic() - t0, path.stat().st_size // 1024)
    return added
