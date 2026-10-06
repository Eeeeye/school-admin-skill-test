"""Exercise backup orchestration with a fake Docker CLI; never touches containers."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["DOCKER_TEST_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
if args[:2] == ["volume", "inspect"]:
    if os.environ.get("FAIL_VOLUME"):
        sys.exit(8)
elif args[0] == "compose":
    if "ps" in args:
        print(os.environ.get("RUNNING_SERVICES", "postgres\nblockchain\nipfs\nbackend\nfrontend"))
    elif "exec" in args:
        if os.environ.get("FAIL_DUMP"):
            sys.exit(9)
        print("database-dump-fixture")
elif args[0] == "run":
    sys.stdout.buffer.write(b"archive-fixture")
elif args[:2] == ["image", "inspect"]:
    print("fixture-image sha256:fixture")
'''
CHECKSUM = r'''#!/usr/bin/env python3
import hashlib, pathlib, sys
for name in sys.argv[1:]:
    print(hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest(), " " + name)
'''


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="school-backup-test-")
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.bin / "python3").symlink_to(sys.executable)
        for name, body in {"docker": DOCKER, "sha256sum": CHECKSUM, "flock": "#!/bin/sh\nexit 0\n"}.items():
            path = self.bin / name
            path.write_text(body)
            path.chmod(0o700)
        self.envfile = self.root / "fixture.env"
        self.envfile.write_text("PUBLIC_HOST=school.example\nSECRET=fixture-not-a-real-secret\n")
        self.log = self.root / "calls.jsonl"
        self.destination = self.root / "backups"
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "ENV_FILE": str(self.envfile), "DOCKER_TEST_LOG": str(self.log),
                    "COMPOSE_PROJECT_NAME": "school-demo"}

    def tearDown(self):
        self.temp.cleanup()

    def run_backup(self, **overrides):
        return subprocess.run(["bash", str(Path(__file__).with_name("backup.sh")), str(self.destination)],
                              env={**self.env, **overrides}, text=True, capture_output=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_complete_backup_is_private_and_restarts_only_previously_running_services(self):
        result = self.run_backup(RUNNING_SERVICES="postgres\nblockchain\nipfs\nbackend")
        self.assertEqual(result.returncode, 0, result.stderr)
        backup = next(self.destination.glob("school-demo-*"))
        self.assertFalse((backup / "INCOMPLETE").exists())
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((backup / "server.env").stat().st_mode), 0o600)
        self.assertEqual(len(list(backup.glob("*.tar.gz"))), 5)
        self.assertTrue((backup / "SHA256SUMS").exists())
        start = [call for call in self.calls() if "up" in call]
        self.assertEqual(len(start), 1)
        self.assertEqual(start[0][-8:], ["up", "-d", "--wait", "--no-deps", "--no-recreate", "blockchain", "ipfs", "backend"])
        self.assertNotIn("fixture-not-a-real-secret", result.stdout + result.stderr)

    def test_failed_dump_keeps_incomplete_marker_and_restores_services(self):
        result = self.run_backup(FAIL_DUMP="1")
        self.assertEqual(result.returncode, 9)
        backup = next(self.destination.glob("school-demo-*"))
        self.assertTrue((backup / "INCOMPLETE").exists())
        self.assertTrue(any("up" in call for call in self.calls()))

    def test_missing_volume_fails_before_stopping_any_service(self):
        result = self.run_backup(FAIL_VOLUME="1")
        self.assertEqual(result.returncode, 8)
        self.assertFalse(any("stop" in call for call in self.calls()))


if __name__ == "__main__":
    unittest.main()
