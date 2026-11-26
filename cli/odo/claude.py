import json
import os
import re
import shutil
import subprocess
import tempfile


class ClaudeError(Exception):
    pass


def command():
    return [os.environ.get("ODO_CLAUDE_BIN", "claude"), "-p", "--no-session-persistence", "--safe-mode", "--tools", "", "--output-format", "json"]


def run(prompt, timeout=600):
    workdir = tempfile.mkdtemp(prefix="odo-claude-")
    try:
        p = subprocess.run(command(), input=prompt, capture_output=True, text=True, cwd=workdir, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ClaudeError("claude took too long") from None
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    if p.returncode and not p.stdout.strip():
        raise ClaudeError(f"claude exited with {p.returncode}: {p.stderr.strip()[:300]}")
    try:
        outer = json.loads(p.stdout)
    except ValueError:
        raise ClaudeError("claude returned something that is not JSON") from None
    if outer.get("is_error"):
        raise ClaudeError(f"claude failed: {outer.get('result')}")
    return str(outer.get("result", "")).strip()


def json_object(text):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ClaudeError("claude did not return a JSON object")
    try:
        return json.loads(m.group(0))
    except ValueError:
        raise ClaudeError("claude returned malformed JSON") from None
