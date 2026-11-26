import argparse
import getpass
import sys
from pathlib import Path

from odo import crypto as c
from odo import store


def describe(p):
    head = p.get("date") or (p.get("when") or {}).get("value", "")
    parts = [head, p.get("kind", "")]
    if p.get("mood"):
        parts.append(f"mood {p['mood']}")
    if p.get("tags"):
        parts.append(" ".join("#" + t for t in p["tags"]))
    return "  ".join(x for x in parts if x)


def cmd_read(args):
    root = Path(args.repo).expanduser()
    if not (root / "keyring.json").exists():
        sys.exit(f"odo: no keyring.json in {root}")
    mk = c.unlock_with_recovery(store.read_keyring(root), getpass.getpass("Recovery phrase: "))
    payloads = store.load_payloads(root, mk)
    for p in payloads:
        print(f"── {describe(p)}")
        print(p.get("text", ""))
        print()
    print(f"{len(payloads)} item(s)")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="odo", description="Odometer on the Mac")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("read", help="decrypt and print entries from a local clone of the data repo")
    r.add_argument("repo", help="path to your local clone of the data repository")
    r.set_defaults(fn=cmd_read)
    args = ap.parse_args(argv)
    try:
        args.fn(args)
    except c.CryptoError as e:
        sys.exit(f"odo: {e}")


if __name__ == "__main__":
    main()
