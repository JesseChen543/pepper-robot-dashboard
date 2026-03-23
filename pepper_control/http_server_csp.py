#!/usr/bin/env python2
# -*- coding: utf-8 -*-
"""
HTTP Server with Content-Security-Policy headers for YouTube embeds

This is a Python 2.7 compatible version that adds CSP headers to allow
YouTube iframes without requiring Flask.

Usage:
    python http_server_csp.py <port> <directory>
"""

import sys
import os
import SimpleHTTPServer
import BaseHTTPServer

VIDEO_CACHE_DIR = os.environ.get("PEPPER_VIDEO_CACHE", "/tmp/pepper_videos")


class CSPHTTPRequestHandler(SimpleHTTPServer.SimpleHTTPRequestHandler):
    """HTTP request handler with CSP headers for YouTube embeds"""

    serve_directory = None

    def translate_path(self, path):
        """Override to use stored directory instead of os.getcwd()"""
        if self.serve_directory:
            # Use the stored directory
            import posixpath
            import urllib
            raw_path = path
            path = path.split('?', 1)[0]
            path = path.split('#', 1)[0]
            path = posixpath.normpath(urllib.unquote(path))

            if path.startswith("/videos/"):
                rel_path = path[len("/videos/"):]
                rel_path = posixpath.normpath(rel_path).lstrip("/")
                if rel_path.startswith(".."):
                    return os.path.join(VIDEO_CACHE_DIR, "__invalid__")
                return os.path.join(VIDEO_CACHE_DIR, rel_path.replace("/", os.sep))

            words = path.split('/')
            words = filter(None, words)
            path = self.serve_directory
            for word in words:
                drive, word = os.path.splitdrive(word)
                head, word = os.path.split(word)
                if word in (os.curdir, os.pardir):
                    continue
                path = os.path.join(path, word)
            return path
        else:
            return SimpleHTTPServer.SimpleHTTPRequestHandler.translate_path(self, path)

    def end_headers(self):
        """Add CSP headers before ending headers"""
        self.send_csp_headers()
        SimpleHTTPServer.SimpleHTTPRequestHandler.end_headers(self)

    def send_csp_headers(self):
        """Send Content-Security-Policy headers to allow YouTube embeds"""
        # Content Security Policy - Allow YouTube iframes
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "font-src 'self' data:; "
            "connect-src 'self' ws: wss: http: https:; "
            "frame-src https://www.youtube.com https://www.youtube-nocookie.com; "
            "media-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;"
        )
        self.send_header('Content-Security-Policy', csp)

        # Other security headers
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-XSS-Protection', '1; mode=block')


def run_server(port, directory):
    """Run HTTP server with CSP headers"""
    # Store directory in handler class
    CSPHTTPRequestHandler.serve_directory = os.path.abspath(directory)

    server_address = ('', port)
    httpd = BaseHTTPServer.HTTPServer(server_address, CSPHTTPRequestHandler)

    print("[HTTP/CSP] Serving directory: {}".format(CSPHTTPRequestHandler.serve_directory))
    print("[HTTP/CSP] Server running on port {}".format(port))
    print("[HTTP/CSP] YouTube embeds enabled via Content-Security-Policy")
    print("[HTTP/CSP] Press Ctrl+C to stop")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[HTTP/CSP] Server stopped")
        return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: {} <port> <directory>".format(sys.argv[0]))
        sys.exit(1)

    try:
        port = int(sys.argv[1])
        directory = sys.argv[2]

        if not os.path.isdir(directory):
            print("Error: Directory does not exist: {}".format(directory))
            sys.exit(1)

        sys.exit(run_server(port, directory))
    except ValueError:
        print("Error: Port must be a number")
        sys.exit(1)
    except Exception as e:
        print("Error: {}".format(e))
        sys.exit(1)
