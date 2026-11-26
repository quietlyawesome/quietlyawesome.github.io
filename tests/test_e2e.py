import json
import shutil
import subprocess
from pathlib import Path

import pytest

from odo import crypto as c
from odo import store
from odo.__main__ import main

E2E = Path(__file__).parent / "e2e.mjs"


@pytest.fixture
def clone(tmp_path):
    if not shutil.which("node"):
        pytest.fail("node is not installed")
    out = subprocess.run(["node", str(E2E), str(tmp_path)], capture_output=True, check=True)
    return tmp_path, json.loads(out.stdout)


def test_js_entries_decrypt_in_python_with_phrase_alone(clone):
    root, info = clone
    assert len(list(store.object_files(root))) == 3
    mk = c.unlock_with_recovery(store.read_keyring(root), info["phrase"])
    payloads = store.load_payloads(root, mk)
    assert [p["text"] for p in payloads] == info["texts"]
    assert [p["mood"] for p in payloads] == [4, 5, 6]


def test_cli_read(clone, monkeypatch, capsys):
    root, info = clone
    monkeypatch.setattr("getpass.getpass", lambda prompt: info["phrase"].lower().replace("-", " "))
    main(["read", str(root)])
    out = capsys.readouterr().out
    assert info["texts"][1] in out
    assert "3 item(s)" in out


def test_cli_wrong_phrase(clone, monkeypatch):
    root, _ = clone
    other = c.secret_to_phrase(bytes(32))
    monkeypatch.setattr("getpass.getpass", lambda prompt: other)
    with pytest.raises(SystemExit, match="does not match"):
        main(["read", str(root)])
