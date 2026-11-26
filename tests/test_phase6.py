import json
import os
from pathlib import Path

import pytest

from odo import crypto as c
from odo import split, store
from odo.__main__ import main
from test_phase5 import fresh_clone, last_commit_message, script, sh, world  # noqa: F401

FAKE_CLAUDE = """#!/usr/bin/env python3
import json, os, sys
stdin = sys.stdin.read()
log = os.environ["FAKE_CLAUDE_LOG"]
calls = json.load(open(log)) if os.path.exists(log) else []
calls.append(stdin)
json.dump(calls, open(log, "w"))
if "<memory>" in stdin:
    reply = json.dumps({"memories": [
        {"when": {"precision": "year", "value": "2011"}, "chapter": "", "people": "Sam", "place": "", "text": "Part one of the ramble."},
        {"when": {"precision": "date", "value": "2099-01-01"}, "chapter": "College", "text": "Part two, with an impossible date."},
        {"when": None, "text": "   "},
    ]})
else:
    reply = "Fake answer about your diary."
print(json.dumps({"type": "result", "is_error": False, "result": reply}))
"""


def add(w, payloads):
    key = c.object_key(w["mk"])
    paths = []
    for p in payloads:
        path = c.new_object_path()
        (w["work"] / path).parent.mkdir(parents=True, exist_ok=True)
        (w["work"] / path).write_text(c.encrypt_object(key, path, p))
        paths.append(path)
    sh("git", "add", "-A", cwd=w["work"])
    sh("git", "commit", "--quiet", "-m", "more", cwd=w["work"])
    sh("git", "push", "--quiet", cwd=w["work"])
    return paths


def ramble(text, analyze=True):
    return {"v": 1, "kind": "memory", "when": {"precision": "year", "value": "2010"}, "chapter": "School", "people": "", "place": "",
            "split": True, "analyze": analyze, "text": text}


@pytest.fixture
def w6(world, monkeypatch):
    monkeypatch.setenv("ODO_CLAUDE_BIN", script(world["tmp"] / "claude6", FAKE_CLAUDE))
    main(["init", str(world["work"])])
    return world


def calls():
    p = Path(os.environ["FAKE_CLAUDE_LOG"])
    return json.loads(p.read_text()) if p.exists() else []


def test_split_creates_dated_memories_once_and_keeps_the_original(w6, capsys):
    [orig, private] = add(w6, [ramble("A LONG RAMBLE about school years."), ramble("PRIVATE RAMBLE", analyze=False)])
    main(["split", "--dry-run"])
    assert calls() == []
    main(["split"])
    sent = calls()
    assert len(sent) == 1 and "A LONG RAMBLE" in sent[0] and "PRIVATE RAMBLE" not in sent[0]

    other = fresh_clone(w6, "after-split")
    assert last_commit_message(other) == "entry"
    mk = c.unlock_with_recovery(store.read_keyring(other), w6["phrase"])
    items = store.load_items(other, mk)
    paths = {p for p, _ in items}
    assert orig in paths and private in paths
    parts = [p for _, p in items if p.get("from") == orig]
    assert len(parts) == 2
    one = next(p for p in parts if "one" in p["text"])
    two = next(p for p in parts if "two" in p["text"])
    assert one["when"] == {"precision": "year", "value": "2011"} and one["people"] == "Sam" and one["chapter"] == "School"
    assert two["when"] == {"precision": "year", "value": "2010"} and two["chapter"] == "College"
    assert all(p["split"] is False and p["analyze"] is True for p in parts)

    main(["split"])
    assert len(calls()) == 1
    assert "0 memory(ies) to split" in capsys.readouterr().out


def test_ask_prints_the_answer_and_sends_only_allowed_items(w6, capsys):
    main(["ask", "what", "happened?"])
    out = capsys.readouterr().out
    assert "Fake answer about your diary." in out
    sent = calls()[-1]
    assert "Question: what happened?" in sent
    assert "IN-WEEK sunday walk" in sent and "MEMORY-NOT-SENT" in sent
    assert "PRIVATE-NEVER-SEND" not in sent
    main(["ask", "--since", "2026-11-21", "anything?"])
    sent = calls()[-1]
    assert "OUT-OF-WEEK" not in sent and "IN-WEEK busy work day" in sent


def test_split_reply_validation():
    with pytest.raises(split.SplitError):
        split.parse('{"memories": []}', ramble("x"), "p")
    assert split.valid_when({"precision": "month", "value": "2013-13"}, 2026) is None
    assert split.valid_when({"precision": "age", "value": "7"}, 2026) == {"precision": "age", "value": "7"}
    assert split.valid_when({"precision": "date", "value": "2013-02-30"}, 2026) is None
