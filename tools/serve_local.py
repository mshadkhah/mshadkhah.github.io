#!/usr/bin/env python3
"""Serve the local preview, restricting connections to this machine."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[1])
class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm'}
    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://*.workers.dev; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'")
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
print('Offline tools preview: http://127.0.0.1:8001/?section=tools', flush=True)
ThreadingHTTPServer(('127.0.0.1',8001), Handler).serve_forever()
