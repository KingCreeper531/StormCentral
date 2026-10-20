"""Entry point: ``python -m pro_server [--once] [--serve PORT] [--products ids]``."""

from __future__ import annotations

import argparse
import logging
import shutil
import signal
import sys
import threading
import time

from . import __version__, goes, memory, mrms
from .config import Settings
from .output import Manifest
from .products import enabled_products

log = logging.getLogger("pro_server")
_stop = threading.Event()


def run_cycle(settings: Settings, manifest: Manifest, products, once: bool) -> int:
    added = 0
    for p in [p for p in products if p.source == "mrms"]:
        if _stop.is_set():
            break
        n = mrms.process(settings, manifest, p, once=once)
        if n:
            manifest.write()
        added += n
    if not _stop.is_set():
        added += goes.process(settings, manifest, [p for p in products if p.source == "goes"], once=once)
    manifest.write()  # refresh "generated" and prune
    return added


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pro_server", description=__doc__)
    ap.add_argument("--once", action="store_true", help="process the latest frame of each product, then exit")
    ap.add_argument("--serve", type=int, metavar="PORT", help="also serve OUTPUT_DIR over HTTP on PORT")
    ap.add_argument("--products", help="comma separated product ids (default: $PRODUCTS or all)")
    ap.add_argument("--output", help="output directory (default: $OUTPUT_DIR or ./output)")
    args = ap.parse_args(argv)

    settings = Settings()
    if args.output:
        from pathlib import Path

        settings.output_dir = Path(args.output).resolve()
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        datefmt="%Y-%m-%dT%H:%M:%S")
    products = enabled_products(settings, args.products)
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(settings.work_dir / "goes", ignore_errors=True)  # leftovers from a killed run
    log.info("pro-server %s: products=%s output=%s", __version__, ",".join(p.id for p in products), settings.output_dir)

    manifest = Manifest(settings, products)
    manifest.write()  # valid (possibly empty) index right away

    if args.serve:
        from . import serve

        serve.start(settings.output_dir, args.serve)

    if settings.lightning and not args.once:
        from . import glm

        threading.Thread(target=glm.run, args=(settings, _stop), name="lightning", daemon=True).start()

    def _term(signum, _frame):
        log.info("signal %s: stopping after the current item", signum)
        _stop.set()

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)

    if args.once:
        t0 = time.monotonic()
        n = run_cycle(settings, manifest, products, once=True)
        log.info("--once finished: %d frame(s) in %.1fs", n, time.monotonic() - t0)
        missing = [p.id for p in products if not manifest.frames[p.id]]
        if missing:
            log.warning("no frame for: %s", ", ".join(missing))
        return 0 if not missing else 1

    while not _stop.is_set():
        t0 = time.monotonic()
        try:
            n = run_cycle(settings, manifest, products, once=False)
            log.info("cycle done: %d new frame(s) in %.1fs, %.0f MB resident", n, time.monotonic() - t0, memory.rss_mb())
        except Exception:
            log.exception("cycle failed")
        # Restart fresh rather than creep: the index and frames on disk carry over, so nothing is lost.
        if memory.over_limit(settings.memory_limit_mb):
            _stop.set()
            return 75
        _stop.wait(max(5.0, settings.poll_seconds - (time.monotonic() - t0)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
