import base64
import os
import subprocess
from pathlib import Path

CLI = Path(__file__).resolve().parent.parent
SRC = CLI / "odo-key" / "main.swift"
BIN = CLI / "bin" / "odo-key"
IDENTIFIER = "io.github.quietlyawesome.odo-key"


class KeyHelperError(Exception):
    pass


def _run(args, **kw):
    p = subprocess.run(args, capture_output=True, **kw)
    if p.returncode:
        msg = p.stderr.decode(errors="replace").strip() or f"{args[0]} failed ({p.returncode})"
        raise KeyHelperError(msg)
    return p


def build():
    BIN.parent.mkdir(parents=True, exist_ok=True)
    _run(["xcrun", "swiftc", "-swift-version", "5", "-O", str(SRC), "-o", str(BIN)])
    _run(["codesign", "--force", "--sign", "-", "--identifier", IDENTIFIER, str(BIN)])


def helper():
    override = os.environ.get("ODO_KEY_BIN")
    if override:
        return override
    if not BIN.exists() or BIN.stat().st_mtime < SRC.stat().st_mtime:
        build()
    return str(BIN)


def status():
    return _run([helper(), "status"]).stdout.decode().strip()


def store(secret, replace=False):
    if len(secret) != 32:
        raise KeyHelperError("Mac key must be 32 bytes")
    args = [helper(), "store"] + (["--replace"] if replace else [])
    _run(args, input=base64.b64encode(secret) + b"\n")


def read():
    out = _run([helper(), "read"]).stdout.strip()
    secret = base64.b64decode(out, validate=True)
    if len(secret) != 32:
        raise KeyHelperError("odo-key returned a bad key")
    return secret
