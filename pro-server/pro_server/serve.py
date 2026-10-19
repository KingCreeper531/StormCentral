"""Tiny built-in static server with the same headers as the Caddyfile.

For local testing and for the desktop app (http://127.0.0.1:PORT). Use Caddy
(docker-compose) for anything public: the web app needs HTTPS.
"""

from __future__ import annotations

import functools
import logging
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

log = logging.getLogger(__name__)


class Handler(SimpleHTTPRequestHandler):
    _status = 200

    def send_response(self, code, message=None):
        self._status = code
        super().send_response(code, message)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        path = self.path.split("?", 1)[0]
        if self._status >= 400:
            self.send_header("Cache-Control", "no-store")
        elif path.endswith(".png"):
            self.send_header("Cache-Control", "public, max-age=86400, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def list_directory(self, path):  # no directory listings
        self.send_error(404)
        return None

    def send_head(self):  # hide in-progress ".name.tmp" files
        if any(part.startswith(".") for part in self.path.split("?", 1)[0].split("/") if part):
            self.send_error(404)
            return None
        return super().send_head()

    def log_message(self, fmt, *args):
        log.debug("http: " + fmt, *args)


def start(directory: Path, port: int, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    directory.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((host, port), functools.partial(Handler, directory=str(directory)))
    threading.Thread(target=httpd.serve_forever, daemon=True, name="http").start()
    log.info("serving %s on http://%s:%d/index.json", directory, host, port)
    return httpd
