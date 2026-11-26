import json
import os
import stat
import subprocess
import tempfile
from datetime import date
from pathlib import Path

import pytest

from odo import crypto as c
from odo import store, weekly
from odo.__main__ import main

FAKE_KEY = """#!/usr/bin/env python3
import os, sys
f = os.environ["FAKE_KEY_FILE"]
cmd = sys.argv[1]
if cmd == "status":
    print("present" if os.path.exists(f) else "absent")
elif cmd == "store":
    open(f, "w").write(sys.stdin.read().strip())
elif cmd == "read":
    if not os.path.exists(f):
        sys.stderr.write("odo-key: no key on this Mac\\n"); sys.exit(4)
    print(open(f).read())
"""

FAKE_CLAUDE = """#!/usr/bin/env python3
import json, os, sys
open(os.environ["FAKE_CLAUDE_LOG"], "w").write(json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd(), "stdin": sys.stdin.read()}))
reply = {"text": "Fake summary of a fake week.", "themes": [{"name": "Work", "count": 2}, {"name": "gym", "count": "1"}], "question": "Fake question?"}
print(json.dumps({"type": "result", "is_error": False, "result": "```json\\n" + json.dumps(reply) + "\\n```"}))
"""


def sh(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


def script(path, body):
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


def entry(day, text, analyze=True, mood=6, tags=None):
    return {"v": 1, "kind": "entry", "created": f"{day}T21:00:00-08:00", "date": day, "mood": mood, "tags": tags or [], "analyze": analyze, "text": text}


@pytest.fixture
def world(tmp_path, monkeypatch):
    remote = tmp_path / "remote.git"
    work = tmp_path / "work"
    sh("git", "init", "--quiet", "--bare", "-b", "main", str(remote))
    sh("git", "clone", "--quiet", str(remote), str(work))
    sh("git", "config", "user.name", "test", cwd=work)
    sh("git", "config", "user.email", "1+test@users.noreply.github.com", cwd=work)

    mk = c.new_master_key()
    rec = c.new_recovery()
    keyring = c.new_keyring()
    keyring["wraps"].append(c.recovery_wrap(mk, rec["secret"]))
    (work / "keyring.json").write_text(json.dumps(keyring, indent=1) + "\n")
    key = c.object_key(mk)
    items = [
        entry("2026-11-22", "IN-WEEK sunday walk", tags=["gym"]),
        entry("2026-11-25", "IN-WEEK busy work day", mood=4, tags=["work"]),
        entry("2026-11-26", "PRIVATE-NEVER-SEND", analyze=False),
        entry("2026-11-20", "OUT-OF-WEEK friday"),
        {"v": 1, "kind": "memory", "when": {"precision": "year", "value": "2010"}, "chapter": "School", "analyze": True, "text": "MEMORY-NOT-SENT"},
    ]
    for p in items:
        path = c.new_object_path()
        (work / path).parent.mkdir(parents=True, exist_ok=True)
        (work / path).write_text(c.encrypt_object(key, path, p))
    sh("git", "add", "-A", cwd=work)
    sh("git", "commit", "--quiet", "-m", "seed", cwd=work)
    sh("git", "push", "--quiet", "-u", "origin", "main", cwd=work)

    monkeypatch.setenv("ODO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("FAKE_KEY_FILE", str(tmp_path / "keychain.txt"))
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "claude.json"))
    monkeypatch.setenv("ODO_KEY_BIN", script(tmp_path / "odo-key", FAKE_KEY))
    monkeypatch.setenv("ODO_CLAUDE_BIN", script(tmp_path / "claude", FAKE_CLAUDE))
    monkeypatch.setattr("getpass.getpass", lambda prompt: rec["phrase"])
    return {"tmp": tmp_path, "remote": remote, "work": work, "mk": mk, "phrase": rec["phrase"]}


def fresh_clone(w, name):
    dest = w["tmp"] / name
    sh("git", "clone", "--quiet", str(w["remote"]), str(dest))
    return dest


def last_commit_message(repo):
    return subprocess.run(["git", "-C", str(repo), "log", "-1", "--format=%s"], capture_output=True, text=True, check=True).stdout.strip()


def test_init_adds_a_mac_key_that_opens_the_vault(world, capsys):
    main(["init", str(world["work"])])
    other = fresh_clone(world, "check")
    keyring = store.read_keyring(other)
    assert [w["type"] for w in keyring["wraps"]] == ["recovery", "mac-cli"]
    assert last_commit_message(other) == "keyring"
    secret = c.b64dec(Path(os.environ["FAKE_KEY_FILE"]).read_text())
    assert c.unlock_with_mac(keyring, secret) == world["mk"]
    assert c.unlock_with_recovery(keyring, world["phrase"]) == world["mk"]

    main(["init", str(world["work"])])
    assert "Nothing to do" in capsys.readouterr().out
    assert [w["type"] for w in store.read_keyring(world["work"])["wraps"]] == ["recovery", "mac-cli"]


def test_weekly_sends_only_allowed_entries_and_pushes_a_summary(world, capsys):
    main(["init", str(world["work"])])
    before = set(os.listdir(tempfile.gettempdir()))
    main(["weekly", "--week", "2026-11-22"])
    assert set(os.listdir(tempfile.gettempdir())) - before == set()

    sent = json.loads(Path(os.environ["FAKE_CLAUDE_LOG"]).read_text())
    assert "IN-WEEK sunday walk" in sent["stdin"]
    assert "IN-WEEK busy work day" in sent["stdin"]
    for secret in ("PRIVATE-NEVER-SEND", "OUT-OF-WEEK", "MEMORY-NOT-SENT"):
        assert secret not in sent["stdin"]
    assert {"--no-session-persistence", "--safe-mode", "--tools"} <= set(sent["argv"])
    assert sent["argv"][sent["argv"].index("--tools") + 1] == ""
    assert not Path(sent["cwd"]).exists()

    other = fresh_clone(world, "phone")
    assert last_commit_message(other) == "entry"
    mk = c.unlock_with_recovery(store.read_keyring(other), world["phrase"])
    summaries = [p for p in store.load_payloads(other, mk) if p["kind"] == "summary"]
    assert len(summaries) == 1
    s = summaries[0]
    assert s["week"] == "2026-11-22"
    assert s["analyze"] is False
    assert s["text"] == "Fake summary of a fake week."
    assert s["themes"] == [{"name": "work", "count": 2}, {"name": "gym", "count": 1}]
    assert s["question"] == "Fake question?"

    with pytest.raises(SystemExit, match="already has a summary"):
        main(["weekly", "--week", "2026-11-22"])
    main(["weekly", "--week", "2026-11-22", "--force"])


def test_weekly_dry_run_and_empty_week_send_nothing(world, capsys):
    main(["init", str(world["work"])])
    main(["weekly", "--week", "2026-11-22", "--dry-run"])
    main(["weekly", "--week", "2026-11-01"])
    assert not Path(os.environ["FAKE_CLAUDE_LOG"]).exists()
    out = capsys.readouterr().out
    assert "Dry run" in out and "Nothing to summarize" in out


def test_weekly_without_mac_key_says_what_to_do(world):
    main(["init", str(world["work"])])
    Path(os.environ["FAKE_KEY_FILE"]).unlink()
    with pytest.raises(SystemExit, match="no key on this Mac"):
        main(["weekly", "--week", "2026-11-22"])


def test_rewritten_remote_history_fails_loudly(world):
    main(["init", str(world["work"])])
    other = fresh_clone(world, "rewriter")
    sh("git", "config", "user.name", "x", cwd=other)
    sh("git", "config", "user.email", "x@example.invalid", cwd=other)
    sh("git", "commit", "--quiet", "--amend", "-m", "rewritten", cwd=other)
    sh("git", "push", "--quiet", "--force", "origin", "main", cwd=other)
    with pytest.raises(SystemExit, match="not a simple fast-forward"):
        main(["pull", "--repo", str(world["work"])])


def test_private_email_is_caught_before_anything_changes(world):
    sh("git", "config", "user.email", "real.person@example.com", cwd=world["work"])
    with pytest.raises(SystemExit, match="no-reply"):
        main(["init", str(world["work"])])
    assert not Path(os.environ["FAKE_KEY_FILE"]).exists()
    assert [w["type"] for w in store.read_keyring(world["work"])["wraps"]] == ["recovery"]


def test_week_choice_and_reply_parsing():
    assert weekly.default_week(date(2026, 11, 26)) == date(2026, 11, 22)
    assert weekly.default_week(date(2026, 11, 29)) == date(2026, 11, 22)
    assert weekly.default_week(date(2026, 11, 23)) == date(2026, 11, 22)
    with pytest.raises(weekly.WeeklyError, match="not a Sunday"):
        weekly.parse_week("2026-11-26")
    with pytest.raises(weekly.WeeklyError, match="claude failed"):
        weekly.parse_reply(json.dumps({"is_error": True, "result": "Not logged in"}))
    with pytest.raises(weekly.WeeklyError):
        weekly.parse_reply(json.dumps({"result": "no json here"}))
