#!/usr/bin/env python3
"""HTTP server with Byte Range request (206 Partial Content) support.
Enables instant, accurate video seeking in Safari and Chrome.
"""

import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

class RangeRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        if "Range" not in self.headers:
            self.range = None
            return super().send_head()

        range_header = self.headers["Range"]
        match = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
        if not match:
            self.range = None
            return super().send_head()

        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            self.range = None
            return super().send_head()

        file_size = os.path.getsize(path)
        start_str, end_str = match.groups()

        if start_str and end_str:
            start = int(start_str)
            end = int(end_str)
        elif start_str:
            start = int(start_str)
            end = file_size - 1
        elif end_str:
            start = file_size - int(end_str)
            end = file_size - 1
        else:
            start = 0
            end = file_size - 1

        if start >= file_size or end >= file_size or start > end:
            self.send_error(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return None

        self.range = (start, end)
        self.send_response(206)
        self.send_header("Content-type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()

        f = open(path, "rb")
        f.seek(start)
        return f

    def copyfile(self, source, outputfile):
        if not getattr(self, "range", None):
            return super().copyfile(source, outputfile)

        start, end = self.range
        remaining = end - start + 1
        buf_size = 64 * 1024
        while remaining > 0:
            chunk = source.read(min(remaining, buf_size))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

def run(port=8000):
    server_address = ("", port)
    httpd = HTTPServer(server_address, RangeRequestHandler)
    print(f"Serving HTTP on 0.0.0.0 port {port} (http://localhost:{port}/) with Range support...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run(port)
