"""Keeping a long-running processor's memory flat.

Each GOES scan and MRMS file allocates hundreds of MB of arrays (the 0.005°
rotation grid alone decodes to 98 M values). Python frees them, but glibc keeps
the freed pages in its heap, so the resident size ratchets up over a day of
frames even though nothing is leaking. ``release()`` hands them back to the OS
after every frame, and ``over_limit()`` lets the main loop restart the process
cleanly (Docker brings it back in a second) if it still creeps past a limit.
"""

from __future__ import annotations

import ctypes
import gc
import logging
from pathlib import Path

log = logging.getLogger(__name__)

try:
    _libc = ctypes.CDLL("libc.so.6")
    _trim = _libc.malloc_trim
    _trim.argtypes = [ctypes.c_size_t]
    _trim.restype = ctypes.c_int
except (OSError, AttributeError):  # not glibc (macOS, musl): gc alone
    _trim = None


def release() -> None:
    """Collect, then give the freed heap back to the OS."""
    gc.collect()
    if _trim is not None:
        _trim(0)


def rss_mb() -> float:
    """Resident memory of this process, MB (0 where /proc isn't available)."""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024
    except OSError:
        pass
    return 0.0


def cgroup_limit_mb() -> float:
    """The container's memory limit, MB (0 when unlimited or unknown)."""
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            raw = Path(path).read_text().strip()
        except OSError:
            continue
        if raw.isdigit() and int(raw) < 1 << 60:
            return int(raw) / (1 << 20)
    return 0.0


def limit_mb(configured: float) -> float:
    """MEMORY_LIMIT_MB if set, else 85 % of the container's limit, else none (0)."""
    if configured > 0:
        return configured
    cg = cgroup_limit_mb()
    return cg * 0.85 if cg else 0.0


def over_limit(configured: float) -> bool:
    limit = limit_mb(configured)
    rss = rss_mb()
    if limit and rss > limit:
        log.warning("resident memory %.0f MB is over the %.0f MB limit: restarting to start fresh", rss, limit)
        return True
    return False
