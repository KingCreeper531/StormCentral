"""Frame bookkeeping, atomic PNG/index writes and pruning."""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import tempfile
import time
from pathlib import Path

import numpy as np

from .config import Settings
from .products import Product, bounds_for

log = logging.getLogger(__name__)

# Frames that drop out of index.json stay on disk this long before deletion.
GRACE_SECONDS = 300


def iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> dt.datetime:
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def frame_name(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".png"


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def save_png(img, path: Path, compress_level: int = 6) -> None:
    """Save a PIL image or an (H, W, 4) uint8 array as PNG, atomically."""
    from PIL import Image

    if isinstance(img, np.ndarray):
        img = Image.fromarray(img, "RGBA")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        img.save(tmp, format="PNG", compress_level=compress_level)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


class Manifest:
    """In-memory view of index.json; frames are {"time": iso, "url": rel} sorted oldest -> newest."""

    def __init__(self, settings: Settings, products: list[Product]):
        self.settings = settings
        self.products = products
        self.root = settings.output_dir
        self.frames: dict[str, list[dict]] = {p.id: [] for p in products}
        self._dropped: dict[str, float] = {}  # url -> when it left the index
        self._load()

    @property
    def index_path(self) -> Path:
        return self.root / "index.json"

    def _load(self) -> None:
        try:
            data = json.loads(self.index_path.read_text())
        except FileNotFoundError:
            return
        except Exception as e:
            log.warning("ignoring unreadable %s: %s", self.index_path, e)
            return
        for pid, pdata in (data.get("products") or {}).items():
            if pid not in self.frames:
                continue
            ok = [f for f in pdata.get("frames", []) if (self.root / f["url"]).is_file()]
            self.frames[pid] = sorted(ok, key=lambda f: f["time"])

    def newest(self, pid: str) -> dt.datetime | None:
        fr = self.frames.get(pid) or []
        return parse_iso(fr[-1]["time"]) if fr else None

    def has(self, pid: str, t: dt.datetime) -> bool:
        s = iso(t)
        return any(f["time"] == s for f in self.frames.get(pid, []))

    def frame_path(self, pid: str, t: dt.datetime) -> tuple[Path, str]:
        url = f"{pid}/{frame_name(t)}"
        return self.root / url, url

    def add(self, pid: str, t: dt.datetime, url: str) -> None:
        s = iso(t)
        fr = [f for f in self.frames[pid] if f["time"] != s]
        fr.append({"time": s, "url": url})
        fr.sort(key=lambda f: f["time"])
        self.frames[pid] = fr[-self.settings.keep_frames :]

    def to_json(self) -> dict:
        products = {}
        for p in self.products:
            entry = {
                "label": p.label,
                "kind": p.kind,
                "bounds": [float(b) for b in bounds_for(p, self.settings)],
                "frames": self.frames[p.id],
            }
            if p.kind == "value" and p.legend is not None:
                entry["legend"] = p.legend.to_json()
            products[p.id] = entry
        return {"generated": iso(dt.datetime.now(dt.timezone.utc)), "products": products}

    def write(self) -> None:
        body = json.dumps(self.to_json(), indent=2, ensure_ascii=False).encode("utf-8")
        atomic_write_bytes(self.index_path, body)
        self._cleanup()

    def _cleanup(self) -> None:
        """Delete PNGs that have been out of the index for at least ``GRACE_SECONDS``.

        The grace period means a client that fetched index.json just before a
        rewrite can still load every frame that index lists.
        """
        now = time.time()
        current = {f["url"] for fr in self.frames.values() for f in fr}
        for url in list(self._dropped):
            if url in current:
                del self._dropped[url]
        for p in self.products:
            d = self.root / p.id
            if not d.is_dir():
                continue
            for f in d.iterdir():
                rel = f"{p.id}/{f.name}"
                try:
                    if f.name.startswith(".") and f.name.endswith(".tmp"):
                        if now - f.stat().st_mtime > 600:  # leftover from a killed write
                            f.unlink()
                    elif f.suffix == ".png" and rel not in current:
                        dropped = self._dropped.setdefault(rel, now)
                        if now - dropped >= GRACE_SECONDS:
                            f.unlink()
                            del self._dropped[rel]
                            log.debug("deleted %s", f)
                except FileNotFoundError:
                    self._dropped.pop(rel, None)
