"""Anonymous access to public NOAA buckets over plain HTTPS (no boto3 needed)."""

from __future__ import annotations

import logging
import os
import shutil
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

log = logging.getLogger(__name__)

_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
USER_AGENT = "StormCentral-pro-server/1.0 (+https://github.com/)"


def _url(bucket: str, key: str = "") -> str:
    return f"https://{bucket}.s3.amazonaws.com/{urllib.parse.quote(key)}"


def _open(url: str, timeout: int, retries: int = 3):
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            return urllib.request.urlopen(req, timeout=timeout)
        except Exception as e:  # network hiccups: retry with backoff
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def list_keys(bucket: str, prefix: str, start_after: str | None = None, timeout: int = 60) -> list[tuple[str, int]]:
    """All (key, size) under ``prefix`` (lexicographic order), optionally only keys > start_after."""
    out: list[tuple[str, int]] = []
    token: str | None = None
    while True:
        q = {"list-type": "2", "prefix": prefix}
        if token:
            q["continuation-token"] = token
        elif start_after:
            q["start-after"] = start_after
        url = f"https://{bucket}.s3.amazonaws.com/?{urllib.parse.urlencode(q)}"
        with _open(url, timeout) as r:
            root = ET.fromstring(r.read())
        for c in root.findall("s3:Contents", _NS):
            out.append((c.findtext("s3:Key", namespaces=_NS), int(c.findtext("s3:Size", "0", namespaces=_NS))))
        if root.findtext("s3:IsTruncated", "false", namespaces=_NS) == "true":
            token = root.findtext("s3:NextContinuationToken", namespaces=_NS)
        else:
            return out


def get_bytes(bucket: str, key: str, timeout: int = 120) -> bytes:
    with _open(_url(bucket, key), timeout) as r:
        return r.read()


def download(bucket: str, key: str, dest: Path, timeout: int = 120, size: int | None = None,
             retries: int = 3) -> Path:
    """Stream an object to ``dest`` (temp name, size-checked, then renamed)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.name}.part")
    for attempt in range(retries):
        with _open(_url(bucket, key), timeout) as r, open(tmp, "wb") as f:
            expected = size if size is not None else int(r.headers.get("Content-Length") or -1)
            shutil.copyfileobj(r, f, length=1 << 20)
        got = tmp.stat().st_size
        if expected < 0 or got == expected:
            os.replace(tmp, dest)
            return dest
        log.warning("short download of %s (%d of %d bytes), retrying", key, got, expected)
        time.sleep(2 * (attempt + 1))
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"could not download {key} completely")
