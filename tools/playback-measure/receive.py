"""Save what the page posts to http://127.0.0.1:8765/NAME as NAME_browser.json.

The browser tools cut off long results, so clicks.js posts its log here instead.
"""

import http.server
from pathlib import Path

PORT = 8765


class Handler(http.server.BaseHTTPRequestHandler):
    def cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        # The app's pages are cross-origin isolated, and only read responses that allow it.
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        name = Path(self.path.strip("/")).name or "run"
        Path(f"{name}_browser.json").write_bytes(body)
        self.send_response(200)
        self.cors()
        self.end_headers()
        self.wfile.write(b"ok")


http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
