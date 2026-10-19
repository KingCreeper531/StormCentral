"""GOES-19 ABI L2 CMIP (CONUS) -> satpy RGB composites -> Web Mercator PNG."""

from __future__ import annotations

import datetime as dt
import gc
import logging
import os
import re
import shutil
import time
import warnings
from pathlib import Path

from . import s3
from .config import Settings
from .mercator import area_definition, km_per_pixel
from .output import Manifest, save_png
from .products import Product

log = logging.getLogger(__name__)

PRODUCT_PREFIX = "ABI-L2-CMIPC"
SATPY_CONFIG_DIR = Path(__file__).resolve().parent / "satpy_config"
_KEY_RE = re.compile(r"OR_ABI-L2-CMIPC-M\d+(C\d\d)_G\d\d_s(\d{13})\d*_e")


def _setup_satpy_env(settings: Settings) -> None:
    """Must run before satpy is imported."""
    paths = [str(SATPY_CONFIG_DIR)]
    extra = os.environ.get("SATPY_CONFIG_PATH")
    if extra and str(SATPY_CONFIG_DIR) not in extra.split(os.pathsep):
        paths.append(extra)
    os.environ["SATPY_CONFIG_PATH"] = os.pathsep.join(paths) if extra else paths[0]
    os.environ.setdefault("SATPY_DATA_DIR", str(settings.work_dir / "satpy-data"))
    os.environ.setdefault("SATPY_CACHE_DIR", str(settings.work_dir / "satpy-cache"))
    # pyresample's gradient search tiles the *target* grid with this block size.
    # Its default (4096) makes the whole 3000 px image one tile and peaks at
    # ~1.5-2.5 GB; 512 px tiles keep the whole GOES step around 0.6-0.7 GB and
    # are also faster. Must be set before pyresample is imported.
    os.environ.setdefault("PYTROLL_CHUNK_SIZE", "512")
    for name in ("satpy", "pyresample", "pyorbital", "trollimage"):
        logging.getLogger(name).setLevel(logging.ERROR)


def scan_time(key: str) -> tuple[str, str, dt.datetime] | None:
    m = _KEY_RE.search(key)
    if not m:
        return None
    t = dt.datetime.strptime(m.group(2), "%Y%j%H%M%S").replace(tzinfo=dt.timezone.utc)
    return m.group(1), m.group(2), t


def list_scans(settings: Settings, since: dt.datetime,
               bands: set[str]) -> list[tuple[dt.datetime, dict[str, tuple[str, int]]]]:
    """Complete scans (all ``bands`` present) with start time > since, oldest first."""
    now = dt.datetime.now(dt.timezone.utc)
    hour = since.replace(minute=0, second=0, microsecond=0)
    scans: dict[str, tuple[dt.datetime, dict[str, tuple[str, int]]]] = {}
    while hour <= now:
        prefix = f"{PRODUCT_PREFIX}/{hour:%Y}/{hour:%j}/{hour:%H}/"
        for key, size in s3.list_keys(settings.goes_bucket, prefix, None, settings.http_timeout):
            parsed = scan_time(key)
            if not parsed:
                continue
            band, sid, t = parsed
            if band in bands and t > since:
                scans.setdefault(sid, (t, {}))[1][band] = (key, size)
        hour += dt.timedelta(hours=1)
    done = [(t, keys) for t, keys in scans.values() if bands.issubset(keys)]
    done.sort(key=lambda x: x[0])
    return done


def render_scan(settings: Settings, files: list[Path], products: list[Product]) -> dict:
    """Run the satpy pipeline for one scan; returns {product_id: PIL.Image (RGBA)}."""
    _setup_satpy_env(settings)
    import dask
    from satpy import Scene

    try:
        from satpy.enhancements.enhancer import get_enhanced_image
    except ImportError:  # older satpy
        from satpy.writers import get_enhanced_image
    from PIL import Image

    bands = sorted({b for p in products for b in p.bands})
    area = area_definition(settings.goes_bounds, settings.goes_width)
    out = {}
    with warnings.catch_warnings(), dask.config.set(scheduler="threads", num_workers=settings.dask_workers):
        warnings.simplefilter("ignore")
        scn = Scene(filenames=[str(f) for f in files], reader="abi_l2_nc")
        scn.load(bands)
        # 1) Block-average every band to one native grid (2 km, or 1 km when the
        #    output pixels are small enough to benefit). This avoids pushing the
        #    0.5 km C02 grid (6000x10000) through the composite/resample steps.
        target = scn.coarsest_area()
        if km_per_pixel(settings.goes_bounds, settings.goes_width, 40.0) < 1.5:
            fine = scn.finest_area()
            f = max(1, int(round(1000.0 / abs(fine.pixel_size_x))))
            target = fine.aggregate(x=f, y=f) if f > 1 else fine
        agg = scn.resample(target, resampler="native")
        for did in list(agg.keys()):
            agg[did] = agg[did].persist()  # read each file once, keep only the small grid
        del scn
        gc.collect()
        # 2) satpy's own composite recipes on the aggregated bands
        agg.load([p.composite for p in products])
        # 3) reproject to Web Mercator (EPSG:3857) and apply satpy's enhancements
        merc = agg.resample(area, resampler=settings.goes_resampler)
        del agg
        finals = [get_enhanced_image(merc[p.composite]).finalize(fill_value=None) for p in products]
        arrays = dask.compute(*[c.transpose("y", "x", "bands").data for c, _mode in finals])
        for p, (_c, mode), arr in zip(products, finals, arrays):
            if mode != "RGBA":
                raise RuntimeError(f"{p.id}: expected RGBA from satpy, got {mode}")
            arr = arr.copy()
            arr[arr[..., 3] == 0] = 0  # fully transparent pixels: zero RGB too
            out[p.id] = Image.fromarray(arr, "RGBA")
        del merc, finals, arrays
    gc.collect()
    return out


def process(settings: Settings, manifest: Manifest, products: list[Product], once: bool = False) -> int:
    """Find and render new GOES scans for the given products. Returns frames added."""
    if not products:
        return 0
    bands = {b for p in products for b in p.bands}
    now = dt.datetime.now(dt.timezone.utc)
    newest = [manifest.newest(p.id) for p in products]
    if once or any(n is None for n in newest):
        since = now - dt.timedelta(minutes=70)
    else:
        since = max(min(n for n in newest if n is not None), now - dt.timedelta(hours=3))
    try:
        scans = list_scans(settings, since, bands)
    except Exception as e:
        log.error("goes: listing failed: %s", e)
        return 0
    if once:
        scans = scans[-1:]
    elif any(n is None for n in newest):
        scans = scans[-max(1, settings.backfill_frames) :]
    else:
        scans = scans[-settings.keep_frames :]

    added = 0
    for t, keys in scans:
        todo = [p for p in products if not manifest.has(p.id, t)]
        if not todo:
            continue
        need = sorted({b for p in todo for b in p.bands})
        workdir = settings.work_dir / "goes" / t.strftime("%Y%m%dT%H%M%SZ")
        t0 = time.monotonic()
        try:
            files = [s3.download(settings.goes_bucket, keys[b][0], workdir / keys[b][0].rsplit("/", 1)[-1],
                                 settings.http_timeout, size=keys[b][1]) for b in need]
            t_dl = time.monotonic() - t0
            images = render_scan(settings, files, todo)
            for p in todo:
                path, url = manifest.frame_path(p.id, t)
                save_png(images[p.id], path, settings.png_compress_level)
                manifest.add(p.id, t, url)
                added += 1
                log.info("%s: scan %s -> %s (%d KB)", p.id, t.strftime("%H:%M:%SZ"), url, path.stat().st_size // 1024)
            log.info("goes: scan %s done in %.1fs (download %.1fs)", t.strftime("%Y-%m-%d %H:%M:%SZ"),
                     time.monotonic() - t0, t_dl)
        except Exception:
            log.exception("goes: scan %s failed", t)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
            gc.collect()
        manifest.write()
    return added
