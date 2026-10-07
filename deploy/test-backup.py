"""Exercise backup orchestration with a fake Docker CLI; never touches containers."""
import json
import os
from pathlib import Path
import stat
import shutil
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
        if "-aq" in args:
            if not os.environ.get("MISSING_CONTAINER"):
                print("container-" + args[-1])
        else:
            print(os.environ.get("RUNNING_SERVICES", "postgres\nblockchain\nipfs\nbackend\nfrontend"))
    elif "exec" in args:
        if os.environ.get("FAIL_DUMP"):
            sys.exit(9)
        print("database-dump-fixture")
    elif "up" in args and os.environ.get("FAIL_RESTART"):
        sys.exit(10)
elif args[0] == "run":
    sys.stdout.buffer.write(b"archive-fixture")
elif args[:2] == ["image", "inspect"]:
    print("sha256:" + "b" * 64)
elif args[:2] == ["container", "inspect"]:
    print("sha256:" + "a" * 64)
'''
CHECKSUM = r'''#!/usr/bin/env python3
import hashlib, pathlib, sys
for name in sys.argv[1:]:
    print(hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest(), " " + name)
'''
FLOCK = r'''#!/usr/bin/env python3
import fcntl, json, os, sys
fd = int(sys.argv[-1])
info = os.fstat(fd)
with open(os.environ["DOCKER_TEST_LOG"], "a") as log:
    log.write(json.dumps(["backup-lock", info.st_dev, info.st_ino]) + "\n")
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(1)
'''


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="school-backup-test-")
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.bin / "python3").symlink_to(sys.executable)
        for name, body in {"docker": DOCKER, "sha256sum": CHECKSUM, "flock": FLOCK}.items():
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
        self.deployment = self.root / "deployment"
        (self.deployment / "deploy").mkdir(parents=True)
        source = Path(__file__).resolve().parent
        for name in ("backup.sh", "Caddyfile"):
            shutil.copyfile(source / name, self.deployment / "deploy" / name)
        shutil.copyfile(source.parent / "docker-compose.server.yml", self.deployment / "docker-compose.server.yml")

    def tearDown(self):
        self.temp.cleanup()

    def run_backup(self, destination=None, **overrides):
        return subprocess.run(["bash", str(self.deployment / "deploy/backup.sh"), str(destination or self.destination)],
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
        self.assertIn("Backup complete:", result.stdout)
        self.assertEqual((backup / "manifest.txt").read_text().count("image=sha256:" + "a" * 64), 5)
        self.assertFalse(any(call[:2] == ["image", "inspect"] for call in self.calls()))
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

    def test_restart_failure_never_reports_a_successful_backup(self):
        result = self.run_backup(FAIL_RESTART="1")
        self.assertEqual(result.returncode, 1)
        backup = next(self.destination.glob("school-demo-*"))
        self.assertTrue((backup / "INCOMPLETE").exists())
        self.assertNotIn("Backup complete:", result.stdout)
        self.assertIn("Service restart needs attention", result.stderr)

    def test_missing_container_fails_before_stopping_services(self):
        result = self.run_backup(MISSING_CONTAINER="1")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(any("stop" in call for call in self.calls()))
        backup = next(self.destination.glob("school-demo-*"))
        self.assertTrue((backup / "INCOMPLETE").exists())

    def test_different_destinations_share_the_same_private_project_lock(self):
        for destination in (self.destination, self.root / "other-backups"):
            result = self.run_backup(destination=destination)
            self.assertEqual(result.returncode, 0, result.stderr)
        locks = [call for call in self.calls() if call[0] == "backup-lock"]
        self.assertEqual(len(locks), 2)
        self.assertEqual(locks[0][1:], locks[1][1:])
        lock_directory = self.deployment / ".server-deploy"
        self.assertEqual(stat.S_IMODE(lock_directory.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((lock_directory / "school-demo.backup.lock").stat().st_mode), 0o600)

    def test_a_second_destination_cannot_backup_while_the_project_lock_is_held(self):
        import fcntl
        lock_directory = self.deployment / ".server-deploy"
        lock_directory.mkdir(mode=0o700)
        with (lock_directory / "school-demo.backup.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_backup(destination=self.root / "other-backups")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Another backup is already running", result.stderr)
        self.assertFalse(any("stop" in call for call in self.calls()))


if __name__ == "__main__":
    unittest.main()
