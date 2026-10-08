"""HTTP regression checks against real Caddy in a disposable Docker container.

No production services, credentials, application volumes or public ports are used.
Set DOCKER or CADDY_TEST_IMAGE to override the Docker executable or Caddy image.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid


ROOT = Path(__file__).resolve().parent.parent
DOCKER = os.environ.get("DOCKER", "docker")
IMAGE = os.environ.get("CADDY_TEST_IMAGE", "caddy:2-alpine")
INDEX = b"<!doctype html><title>School test SPA</title>"


def docker(*args):
    result = subprocess.run([DOCKER, *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"Docker {args[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


class CaddyRoutingTests(unittest.TestCase):
    def test_public_routing_and_private_files(self):
        for configuration in ("deploy/Caddyfile", "frontend/Caddyfile"):
            with self.subTest(configuration=configuration), tempfile.TemporaryDirectory(prefix="school-caddy-test-") as temporary:
                directory = Path(temporary)
                static = directory / "static"
                static.mkdir()
                (static / "index.html").write_bytes(INDEX)
                (static / "assets").mkdir()
                (static / "assets" / "app.js").write_text("console.log('fixture');")
                # Deliberately place private fixtures in the served root. A 404
                # must come from the guard, not merely from absent input files.
                (static / ".env").write_text("PRIVATE_FIXTURE=never-public")
                (static / ".git").mkdir()
                (static / ".git" / "config").write_text("private-git-fixture")
                (static / ".well-known" / "acme-challenge").mkdir(parents=True)
                (static / ".well-known" / "acme-challenge" / "fixture").write_text("acme-fixture")
                source = (ROOT / configuration).read_text()
                source += '\nhttp://:8091 {\n respond "backend fixture" 209\n}\n'
                source += '\nhttp://:8092 {\n respond "ipfs fixture" 207\n}\n'
                config = directory / "Caddyfile"
                config.write_text(source)
                name = "school-caddy-test-" + uuid.uuid4().hex[:12]
                try:
                    docker("create", "--name", name,
                           "-p", "127.0.0.1::8090",
                           "-e", "PUBLIC_HOST=http://:8090", "-e", "PORT=8090",
                           "-e", "BACKEND_UPSTREAM=127.0.0.1:8091", "-e", "IPFS_UPSTREAM=127.0.0.1:8092", IMAGE)
                    # Copy fixtures instead of bind-mounting macOS temporary
                    # paths that may not be shared with the Docker VM.
                    docker("cp", str(config), f"{name}:/etc/caddy/Caddyfile")
                    docker("cp", f"{static}/.", f"{name}:/srv")
                    docker("start", name)
                    binding = json.loads(docker("inspect", "--format", '{{json .NetworkSettings.Ports}}', name))["8090/tcp"][0]
                    base = f"http://127.0.0.1:{binding['HostPort']}"

                    def request(path, method="GET"):
                        try:
                            with urlopen(Request(base + path, method=method), timeout=3) as response:
                                return response.status, response.read(), response.headers
                        except HTTPError as error:
                            return error.code, error.read(), error.headers

                    for attempt in range(50):
                        try:
                            if request("/health")[0] == 200:
                                break
                        except (URLError, ConnectionError, TimeoutError):
                            pass
                        time.sleep(0.1)
                    else:
                        self.fail("Caddy did not become ready: " + docker("logs", name))

                    checks = 0
                    for route in ("/", "/auth/login", "/students", "/students/edit/42", "/verify/0xabc123"):
                        status, body, _ = request(route)
                        self.assertEqual((status, body), (200, INDEX), route)
                        checks += 1
                    for route in ("/.env", "/.env.production", "/.git/config", "/%2eenv", "/%2egit/config",
                                  "/api/.env", "/backend-assets/.git/config", "/auth/.env",
                                  "/.well-known/acme-challenge/.env", "/.well-known/acme-challenge/../../../.env",
                                  "/@fs/etc/passwd", "/@vite/client", "/node_modules/vite/package.json"):
                        for method in ("GET", "HEAD", "POST"):
                            status, body, _ = request(route, method)
                            self.assertEqual(status, 404, (route, method))
                            self.assertNotIn(b"PRIVATE_FIXTURE", body)
                            self.assertNotIn(INDEX, body)
                            checks += 1
                    self.assertEqual(request("/assets/app.js")[:2], (200, b"console.log('fixture');"))
                    self.assertEqual(request("/assets/missing.js")[0], 404)
                    self.assertEqual(request("/api/example")[:2], (209, b"backend fixture"))
                    self.assertEqual(request("/backend-assets/icon.svg")[:2], (209, b"backend fixture"))
                    self.assertEqual(request("/ipfs/bafyfixture")[:2], (207, b"ipfs fixture"))
                    self.assertEqual(request("/ipfs/bafyfixture", "POST")[0], 405)
                    self.assertEqual(request("/.well-known/acme-challenge/fixture")[:2], (200, b"acme-fixture"))
                    self.assertEqual(request("/auth/login", "POST")[0], 405)
                    print(f"PASS {configuration}: {checks + 8} HTTP routing checks", flush=True)
                finally:
                    subprocess.run([DOCKER, "rm", "-fv", name], capture_output=True)


if __name__ == "__main__":
    unittest.main()
