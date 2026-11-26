import json
from pathlib import Path

from odo import crypto as c


def read_keyring(root):
    return json.loads((Path(root) / "keyring.json").read_text(encoding="utf-8"))


def object_files(root):
    root = Path(root)
    for f in sorted((root / "objects").glob("*/*.enc")):
        yield f.relative_to(root).as_posix(), f


def load_items(root, mk):
    key = c.object_key(mk)
    return [(path, c.decrypt_object(key, path, f.read_text(encoding="utf-8"))) for path, f in object_files(root)]


def load_payloads(root, mk):
    key = c.object_key(mk)
    items = []
    for path, f in object_files(root):
        items.append(c.decrypt_object(key, path, f.read_text(encoding="utf-8")))
    return sorted(items, key=lambda p: p.get("created") or p.get("date") or "")
