"""Tests of scripts/serve.py: Range parsing, proxy target parsing, static serving with Range, the /proxy/ relay."""
import http.client
import importlib.util
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("serve", ROOT / "scripts" / "serve.py")
serve = importlib.util.module_from_spec(spec)
sys.modules["serve"] = serve
spec.loader.exec_module(serve)

DATA = bytes(range(256)) * 4  # 1024 bytes


class RangeParsingTest(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(serve.parse_range("bytes=0-9", 100), (0, 9))
        self.assertEqual(serve.parse_range("bytes=10-", 100), (10, 99))
        self.assertEqual(serve.parse_range("bytes=-20", 100), (80, 99))
        self.assertEqual(serve.parse_range("bytes=90-500", 100), (90, 99))  # end clipped
        self.assertEqual(serve.parse_range("bytes=-500", 100), (0, 99))  # suffix longer than the file

    def test_absent_or_ignored(self):
        self.assertIsNone(serve.parse_range(None, 100))
        self.assertIsNone(serve.parse_range("items=0-1", 100))
        self.assertIsNone(serve.parse_range("bytes=0-1,5-6", 100))  # multi-range: served whole

    def test_unsatisfiable(self):
        self.assertEqual(serve.parse_range("bytes=100-", 100), "invalid")
        self.assertEqual(serve.parse_range("bytes=5-2", 100), "invalid")
        self.assertEqual(serve.parse_range("bytes=-0", 100), "invalid")
        self.assertEqual(serve.parse_range("bytes=x-y", 100), "invalid")


class ProxyTargetTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(serve.parse_proxy_target("/proxy/https://h.org/a/b.zarr/zarr.json"), "https://h.org/a/b.zarr/zarr.json")
        self.assertEqual(serve.parse_proxy_target("/proxy/https://h.org/a?x=1&y=2"), "https://h.org/a?x=1&y=2")
        # a layer that collapses // in paths must not break the target
        self.assertEqual(serve.parse_proxy_target("/proxy/https:/h.org/a"), "https://h.org/a")

    def test_rejected(self):
        for bad in ("/proxy/", "/proxy/ftp://h/x", "/proxy/http://h/x", "/proxy/file:///etc/passwd", "/proxy/h.org/x",
                    "/proxy/https://"):
            with self.assertRaises(ValueError, msg=bad):
                serve.parse_proxy_target(bad)

    def test_http_allowed_when_configured(self):
        self.assertEqual(serve.parse_proxy_target("/proxy/http://127.0.0.1:1/x", schemes=("http", "https")), "http://127.0.0.1:1/x")


def start(directory, **attrs):
    handler = type("H", (serve.Handler,), {"directory": str(directory), **attrs})
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def get(srv, path, headers=None, method="GET"):
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
    c.request(method, path, headers=headers or {})
    r = c.getresponse()
    body = r.read()
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, body)
    c.close()
    return out


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        d = Path(cls._tmp.name)
        (d / "index.html").write_text("<h1>hi</h1>")
        (d / "data.bin").write_bytes(DATA)
        (d / "sub").mkdir()
        (d / "sub" / "x.json").write_text('{"a": 1}')
        try:
            cls.srv = start(d)  # also the upstream of the proxy tests
            cls.proxy = start(d, allowed_schemes=("http", "https"), block_private=False)
        except OSError as e:  # sandbox without local sockets
            raise unittest.SkipTest(f"cannot bind a local port: {e}")

    @classmethod
    def tearDownClass(cls):
        for s in (cls.srv, cls.proxy):
            s.shutdown()
            s.server_close()
        cls._tmp.cleanup()

    def test_static_file_index_and_types(self):
        status, h, body = get(self.srv, "/")
        self.assertEqual((status, body), (200, b"<h1>hi</h1>"))
        self.assertIn("text/html", h["content-type"])
        self.assertEqual(h["access-control-allow-origin"], "*")
        status, h, body = get(self.srv, "/sub/x.json")
        self.assertEqual(status, 200)
        self.assertIn("json", h["content-type"])

    def test_static_missing_and_traversal(self):
        self.assertEqual(get(self.srv, "/nope.txt")[0], 404)
        self.assertEqual(get(self.srv, "/../../etc/passwd")[0], 404)
        self.assertEqual(get(self.srv, "/%2e%2e/%2e%2e/etc/passwd")[0], 404)

    def test_static_range(self):
        status, h, body = get(self.srv, "/data.bin", {"Range": "bytes=10-19"})
        self.assertEqual(status, 206)
        self.assertEqual(body, DATA[10:20])
        self.assertEqual(h["content-range"], "bytes 10-19/1024")
        self.assertEqual(h["content-length"], "10")
        status, h, body = get(self.srv, "/data.bin", {"Range": "bytes=-16"})  # suffix: a shard index
        self.assertEqual((status, body, h["content-range"]), (206, DATA[-16:], "bytes 1008-1023/1024"))
        status, _, body = get(self.srv, "/data.bin")
        self.assertEqual((status, len(body)), (200, 1024))

    def test_static_range_unsatisfiable(self):
        status, h, _ = get(self.srv, "/data.bin", {"Range": "bytes=5000-"})
        self.assertEqual(status, 416)
        self.assertEqual(h["content-range"], "bytes */1024")

    def test_head_and_post_refused(self):
        self.assertEqual(get(self.srv, "/", method="HEAD")[0], 405)
        self.assertEqual(get(self.srv, "/", method="POST")[0], 405)

    def test_options_preflight(self):
        status, h, _ = get(self.srv, "/data.bin", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(h["access-control-allow-origin"], "*")

    def test_proxy_forwards_range_and_status(self):
        up = f"http://127.0.0.1:{self.srv.server_address[1]}/data.bin"
        status, h, body = get(self.proxy, f"/proxy/{up}", {"Range": "bytes=100-199"})
        self.assertEqual(status, 206)
        self.assertEqual(body, DATA[100:200])
        self.assertEqual(h["content-range"], "bytes 100-199/1024")
        self.assertEqual(h["content-length"], "100")
        self.assertEqual(h["access-control-allow-origin"], "*")
        status, h, body = get(self.proxy, f"/proxy/{up}", {"Range": "bytes=-8"})
        self.assertEqual((status, body), (206, DATA[-8:]))
        status, h, body = get(self.proxy, f"/proxy/{up}")
        self.assertEqual((status, len(body)), (200, 1024))

    def test_proxy_passes_upstream_errors(self):
        up = f"http://127.0.0.1:{self.srv.server_address[1]}/missing.json"
        status, h, _ = get(self.proxy, f"/proxy/{up}")
        self.assertEqual(status, 404)
        self.assertEqual(h["access-control-allow-origin"], "*")

    def test_proxy_refuses_non_https_by_default_and_private_hosts(self):
        up = f"http://127.0.0.1:{self.srv.server_address[1]}/data.bin"
        self.assertEqual(get(self.srv, f"/proxy/{up}")[0], 400)  # default: https only
        self.assertEqual(get(self.srv, "/proxy/https://127.0.0.1/x")[0], 403)  # private address blocked
        self.assertEqual(get(self.srv, "/proxy/ftp://x/y")[0], 400)


if __name__ == "__main__":
    unittest.main()
