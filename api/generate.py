import json
from http.server import BaseHTTPRequestHandler

from server import generator


class handler(BaseHTTPRequestHandler):
  def do_POST(self):
    try:
      length = int(self.headers.get("Content-Length", "0"))
      body = self.rfile.read(length).decode("utf-8") if length else "{}"
      payload = json.loads(body)
      content = generator.generate(payload)
      self._send_json({"content": content})
    except Exception as exc:
      self._send_json({"error": str(exc)}, status=500)

  def _send_json(self, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def log_message(self, format, *args):
    return
