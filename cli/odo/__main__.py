import argparse
import getpass
import json
import os
import sys
from datetime import date
from pathlib import Path

from odo import crypto as c
from odo import gitrepo, keychain, store, weekly


def config_path():
    return Path(os.environ.get("ODO_CONFIG", "~/.config/odometer/config.json")).expanduser()


def load_config():
    p = config_path()
    return json.loads(p.read_text()) if p.exists() else {}


def save_config(cfg):
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, indent=1) + "\n")


def repo_of(args):
    path = args.repo or load_config().get("repo")
    if not path:
        sys.exit("odo: no data repository yet. Run: odo init <path to your clone>")
    root = Path(path).expanduser()
    if not (root / "keyring.json").exists():
        sys.exit(f"odo: no keyring.json in {root}")
    return root


def unlock(root, use_phrase=False):
    keyring = store.read_keyring(root)
    if use_phrase:
        return c.unlock_with_recovery(keyring, getpass.getpass("Recovery phrase: "))
    if not any(w.get("type") == "mac-cli" for w in keyring.get("wraps", [])):
        sys.exit("odo: this keyring has no Mac key yet. Run: odo init <clone>  (or use --phrase)")
    return c.unlock_with_mac(keyring, keychain.read())


def write_keyring(root, keyring):
    (root / "keyring.json").write_text(json.dumps(keyring, indent=1) + "\n", encoding="utf-8")


def cmd_init(args):
    root = Path(args.repo).expanduser().resolve()
    if not (root / "keyring.json").exists():
        sys.exit(f"odo: {root} is not a clone of the data repository (no keyring.json)")
    gitrepo.check_identity(root)
    save_config({"repo": str(root)})
    print(f"Data repository: {root}")
    keychain.helper()
    gitrepo.pull(root)
    keyring = store.read_keyring(root)
    has_mac = any(w.get("type") == "mac-cli" for w in keyring["wraps"])
    if has_mac and not args.replace:
        print("This keyring already has a Mac key. Checking it with Touch ID…")
        c.unlock_with_mac(keyring, keychain.read())
        print("Mac key works. Nothing to do.")
        return
    mk = c.unlock_with_recovery(keyring, getpass.getpass("Recovery phrase (once, to add this Mac): "))
    secret = c.random_bytes(32)
    print("Approve Touch ID to save the Mac key in your Keychain…")
    keychain.store(secret, replace=True)
    keyring["wraps"] = [w for w in keyring["wraps"] if w.get("type") != "mac-cli"]
    keyring["wraps"].append(c.mac_wrap(mk, secret))
    if c.unlock_with_mac(keyring, secret) != mk:
        sys.exit("odo: the new Mac key did not verify; nothing was pushed")
    write_keyring(root, keyring)
    gitrepo.commit_push(root, ["keyring.json"], "keyring")
    print("Done. This Mac now unlocks Odometer with Touch ID.")


def cmd_pull(args):
    gitrepo.pull(repo_of(args))
    print("Up to date.")


def describe(p):
    head = p.get("date") or (p.get("when") or {}).get("value", "") or p.get("week", "")
    parts = [head, p.get("kind", "")]
    if p.get("mood"):
        parts.append(f"mood {p['mood']}")
    if p.get("tags"):
        parts.append(" ".join("#" + t for t in p["tags"]))
    return "  ".join(x for x in parts if x)


def cmd_read(args):
    root = repo_of(args)
    if not args.no_pull:
        gitrepo.pull(root)
    mk = unlock(root, args.phrase)
    payloads = store.load_payloads(root, mk)
    for p in payloads:
        print(f"── {describe(p)}")
        print(p.get("text", ""))
        print()
    print(f"{len(payloads)} item(s)")


def cmd_weekly(args):
    root = repo_of(args)
    start = weekly.parse_week(args.week) if args.week else weekly.default_week(date.today())
    mk = unlock(root, args.phrase)
    gitrepo.pull(root)
    payloads = store.load_payloads(root, mk)
    if weekly.existing_summary(payloads, start) and not args.force:
        sys.exit(f"odo: week of {start} already has a summary (use --force to write a newer one)")
    entries = weekly.select(payloads, start)
    print(f"Week of {start}: {len(entries)} entr{'y' if len(entries) == 1 else 'ies'} allowed for analysis.")
    if not entries:
        print("Nothing to summarize.")
        return
    if args.dry_run:
        print("Dry run: nothing sent to Claude.")
        return
    gitrepo.check_identity(root)
    print("Asking Claude…")
    reply = weekly.ask_claude(weekly.build_prompt(entries, start))
    payload = weekly.summary_payload(start, reply)
    path = c.new_object_path()
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(c.encrypt_object(c.object_key(mk), path, payload), encoding="utf-8")
    gitrepo.commit_push(root, [path], "entry")
    print("Summary saved and pushed. Open Weekly in Odometer.")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="odo", description="Odometer on the Mac")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", help="link a clone of the data repository and add a Touch ID key for this Mac")
    p.add_argument("repo", help="path to your local clone of the data repository")
    p.add_argument("--replace", action="store_true", help="replace this Mac's key")
    p.set_defaults(fn=cmd_init)

    p = sub.add_parser("pull", help="fast-forward the local clone")
    p.add_argument("--repo")
    p.set_defaults(fn=cmd_pull)

    p = sub.add_parser("read", help="decrypt and print everything")
    p.add_argument("repo", nargs="?")
    p.add_argument("--phrase", action="store_true", help="unlock with the recovery phrase instead of Touch ID")
    p.add_argument("--no-pull", action="store_true")
    p.set_defaults(fn=cmd_read)

    p = sub.add_parser("weekly", help="write this week's summary with Claude")
    p.add_argument("--repo")
    p.add_argument("--week", help="Sunday that starts the week, YYYY-MM-DD")
    p.add_argument("--phrase", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="count entries, send nothing")
    p.add_argument("--force", action="store_true", help="write a newer summary for a week that has one")
    p.set_defaults(fn=cmd_weekly)

    args = ap.parse_args(argv)
    try:
        args.fn(args)
    except (c.CryptoError, keychain.KeyHelperError, gitrepo.GitError, weekly.WeeklyError) as e:
        sys.exit(f"odo: {e}")


if __name__ == "__main__":
    main()
