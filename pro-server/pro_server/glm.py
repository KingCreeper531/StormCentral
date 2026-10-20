"""GOES Geostationary Lightning Mapper flashes -> ``lightning.json``.

GLM L2 LCFA files land on AWS every 20 seconds from GOES-East and -West, each
holding the flashes seen in those 20 seconds (centroid, time, energy). This
keeps the last ``LIGHTNING_MINUTES`` of them, from both satellites, and
rewrites ``lightning.json`` after each poll, so the apps can draw a bolt per
flash, aged by colour.

The files are read in a child process: netCDF/HDF5 isn't thread-safe, and the
GOES step reads netCDF on dask threads in this one (together they corrupt the
heap and crash the processor).

Each satellite's view is used on its own side of ``LIGHTNING_SPLIT_LON``, so
a flash in the overlap (which both see) is counted once. The rolling window is
plain numpy arrays, pruned on every poll, and only the keys still inside it are
remembered: memory stays flat however long the server runs.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import multiprocessing
import re
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass, field

import numpy as np

from . import s3
from .config import Settings
from .output import atomic_write_bytes, iso

log = logging.getLogger(__name__)

PREFIX = "GLM-L2-LCFA"
_KEY_RE = re.compile(r"_s(\d{13})\d*_e")
FILENAME = "lightning.json"


def key_time(key: str) -> dt.datetime | None:
    """Scan start from ``OR_GLM-L2-LCFA_G19_s20262931843200_e…``."""
    m = _KEY_RE.search(key)
    return dt.datetime.strptime(m.group(1), "%Y%j%H%M%S").replace(tzinfo=dt.timezone.utc) if m else None


def read_flashes(data: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(lon, lat, epoch seconds, energy in fJ) of the good-quality flashes in one LCFA file."""
    import netCDF4

    with netCDF4.Dataset("glm.nc", memory=data) as ds:
        v = ds.variables
        if "flash_lat" not in v or v["flash_lat"].size == 0:
            empty = np.empty(0)
            return empty, empty, empty, empty
        lat = np.ma.filled(v["flash_lat"][:].astype(float), np.nan)
        lon = np.ma.filled(v["flash_lon"][:].astype(float), np.nan)
        # Offsets in seconds from the file's reference time ("seconds since 2026-10-20 18:43:20.000").
        tv = v["flash_time_offset_of_first_event"]
        if not tv.units.startswith("seconds since"):
            raise ValueError(f"unexpected time units {tv.units!r}")
        base = netCDF4.num2date(0, tv.units, only_use_cftime_datetimes=False, only_use_python_datetimes=True)
        epoch = base.replace(tzinfo=dt.timezone.utc).timestamp() + np.ma.filled(tv[:].astype(float), np.nan)
        # Joules; a flash is a few femtojoules.
        energy = np.ma.filled(v["flash_energy"][:].astype(float), 0.0) * 1e15 if "flash_energy" in v else np.zeros_like(lat)
        good = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(epoch)
        if "flash_quality_flag" in v:
            good &= np.ma.filled(v["flash_quality_flag"][:], 1) == 0
    return lon[good], lat[good], epoch[good], energy[good]


class IsolatedReader:
    """``read_flashes`` in a child process of its own, restarted if it dies or hangs."""

    def __init__(self, timeout: float = 60.0):
        self.timeout = timeout
        self._pool: ProcessPoolExecutor | None = None

    def __call__(self, data: bytes):
        for attempt in range(2):
            if self._pool is None:
                self._pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
            try:
                return self._pool.submit(read_flashes, data).result(timeout=self.timeout)
            except BrokenProcessPool:
                # The child died (out of memory, a crash in the HDF5 library): once more with a fresh one.
                self._pool = None
                if attempt:
                    raise
            except TimeoutError:
                self.close()
                raise
        raise RuntimeError("unreachable")

    def close(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._pool = None


@dataclass
class Window:
    """The flashes of the last ``minutes``, oldest first."""

    minutes: float
    lon: np.ndarray = field(default_factory=lambda: np.empty(0))
    lat: np.ndarray = field(default_factory=lambda: np.empty(0))
    t: np.ndarray = field(default_factory=lambda: np.empty(0))
    energy: np.ndarray = field(default_factory=lambda: np.empty(0))

    def add(self, lon, lat, t, energy) -> None:
        self.lon = np.concatenate([self.lon, lon])
        self.lat = np.concatenate([self.lat, lat])
        self.t = np.concatenate([self.t, t])
        self.energy = np.concatenate([self.energy, energy])

    def prune(self, now: float) -> None:
        keep = self.t >= now - self.minutes * 60
        order = np.argsort(self.t[keep], kind="stable")
        self.lon, self.lat, self.t, self.energy = (a[keep][order] for a in (self.lon, self.lat, self.t, self.energy))

    def to_json(self, now: float) -> dict:
        return {
            "generated": iso(dt.datetime.fromtimestamp(now, dt.timezone.utc)),
            "minutes": self.minutes,
            "source": "GOES GLM (NOAA)",
            # [lon, lat, seconds before "generated", energy fJ], oldest first.
            "flashes": [[round(float(x), 3), round(float(y), 3), int(round(now - s)), int(round(e))]
                        for x, y, s, e in zip(self.lon, self.lat, self.t, self.energy)],
        }


@dataclass
class Satellite:
    bucket: str
    #: This satellite's flashes are used west (True) or east (False) of the split longitude.
    west: bool
    seen: dict[str, float] = field(default_factory=dict)


class Lightning:
    """Polls both satellites and keeps ``lightning.json`` current."""

    def __init__(self, settings: Settings, reader=read_flashes):
        self.settings = settings
        self.read = reader
        self.window = Window(settings.lightning_minutes)
        self.sats = [Satellite(settings.goes_bucket, west=False), Satellite(settings.lightning_west_bucket, west=True)]

    def _area(self, sat: Satellite, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        w, s, e, n = self.settings.lightning_bounds
        side = lon < self.settings.lightning_split_lon if sat.west else lon >= self.settings.lightning_split_lon
        return side & (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)

    def _keys(self, sat: Satellite, now: dt.datetime) -> list[str]:
        since = now - dt.timedelta(minutes=self.settings.lightning_minutes)
        out: list[str] = []
        hour = since.replace(minute=0, second=0, microsecond=0)
        while hour <= now:
            prefix = f"{PREFIX}/{hour:%Y}/{hour:%j}/{hour:%H}/"
            for key, _size in s3.list_keys(sat.bucket, prefix, None, self.settings.http_timeout):
                t = key_time(key)
                if t and t >= since and key not in sat.seen:
                    out.append(key)
            hour += dt.timedelta(hours=1)
        return sorted(out)

    def poll(self) -> int:
        """Fetch the files not seen yet; returns the number of flashes added."""
        now = dt.datetime.now(dt.timezone.utc)
        added = 0
        for sat in self.sats:
            try:
                keys = self._keys(sat, now)
            except Exception as e:
                log.warning("GLM listing failed for %s: %s", sat.bucket, e)
                continue
            for key in keys:
                try:
                    lon, lat, t, energy = self.read(s3.get_bytes(sat.bucket, key, self.settings.http_timeout))
                except Exception as e:
                    # A damaged or half-written file: try it again next poll (it's only remembered once read).
                    log.warning("skipping GLM file %s: %s", key, e)
                    continue
                keep = self._area(sat, lon, lat)
                self.window.add(lon[keep], lat[keep], t[keep], energy[keep])
                sat.seen[key] = now.timestamp()
                added += int(keep.sum())
        cutoff = now.timestamp() - self.settings.lightning_minutes * 60 - 120
        for sat in self.sats:
            sat.seen = {k: v for k, v in sat.seen.items() if v >= cutoff}
        self.window.prune(now.timestamp())
        self.write(now.timestamp())
        return added

    def write(self, now: float) -> None:
        body = json.dumps(self.window.to_json(now), separators=(",", ":")).encode("utf-8")
        atomic_write_bytes(self.settings.output_dir / FILENAME, body)


def run(settings: Settings, stop: threading.Event) -> None:
    """Poll until ``stop`` is set (its own thread: flashes are wanted far more often than imagery)."""
    reader = IsolatedReader()
    lightning = Lightning(settings, reader)
    try:
        _loop(settings, lightning, stop)
    finally:
        reader.close()


def _loop(settings: Settings, lightning: Lightning, stop: threading.Event) -> None:
    while not stop.is_set():
        t0 = dt.datetime.now().timestamp()
        try:
            n = lightning.poll()
            log.info("lightning: %d new flash(es), %d in the last %g min", n, lightning.window.t.size, settings.lightning_minutes)
        except Exception:
            log.exception("lightning poll failed")
        stop.wait(max(5.0, settings.lightning_poll_seconds - (dt.datetime.now().timestamp() - t0)))
