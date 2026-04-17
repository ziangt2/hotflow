import json
import urllib.parse
from http.server import BaseHTTPRequestHandler

from server import repository


class handler(BaseHTTPRequestHandler):
  def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    query = urllib.parse.parse_qs(parsed.query)
    platform = query.get("platform", ["全部"])[0]
    category = query.get("category", ["全部"])[0]
    items, statuses = repository.list_trends(platform=platform, category=category)
    self._send_json(
      {
        "items": items,
        "sources": statuses
      }
    )

  def _send_json(self, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def log_message(self, format, *args):
    return
