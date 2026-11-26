import json
import shutil
import subprocess
from pathlib import Path

import pytest

from odo import crypto as c

CROSS = Path(__file__).parent / "cross.mjs"
PAYLOADS = [
    {"v": 1, "kind": "entry", "date": "2026-01-03", "mood": 9, "tags": ["a", "b"], "analyze": True, "text": "Short fake entry."},
    {"v": 1, "kind": "memory", "when": {"precision": "age", "value": "7"}, "chapter": "Test", "text": "café ☕ 東京 🚲 Ελληνικά"},
    {"v": 1, "kind": "summary", "text": "y" * 70000},
]


def node(op, data=None):
    if not shutil.which("node"):
        pytest.fail("node is not installed")
    out = subprocess.run(["node", str(CROSS), op], input=json.dumps(data or {}).encode(), capture_output=True, check=True)
    return json.loads(out.stdout)


@pytest.mark.parametrize("payload", PAYLOADS)
def test_python_to_js(payload):
    mk = c.new_master_key()
    path = c.new_object_path()
    file = c.encrypt_object(c.object_key(mk), path, payload)
    assert node("decrypt", {"mk": c.b64enc(mk), "path": path, "file": file})["payload"] == payload


@pytest.mark.parametrize("payload", PAYLOADS)
def test_js_to_python(payload):
    mk = c.new_master_key()
    path = c.new_object_path()
    file = node("encrypt", {"mk": c.b64enc(mk), "path": path, "payload": payload})["file"]
    assert c.decrypt_object(c.object_key(mk), path, file) == payload


def test_js_keyring_opens_in_python_with_phrase_alone():
    payload = PAYLOADS[0]
    s = node("setup", {"payload": payload})
    mk = c.unlock_with_recovery(s["keyring"], s["phrase"])
    assert c.decrypt_object(c.object_key(mk), s["path"], s["file"]) == payload


def test_python_keyring_opens_in_js_with_phrase_alone():
    payload = PAYLOADS[1]
    mk = c.new_master_key()
    rec = c.new_recovery()
    keyring = c.new_keyring()
    keyring["wraps"].append(c.recovery_wrap(mk, rec["secret"]))
    keyring["wraps"].append(c.mac_wrap(mk, c.random_bytes(32)))
    path = c.new_object_path()
    file = c.encrypt_object(c.object_key(mk), path, payload)
    out = node("open", {"keyring": keyring, "phrase": rec["phrase"], "path": path, "file": file})
    assert out["mk"] == c.b64enc(mk)
    assert out["payload"] == payload
