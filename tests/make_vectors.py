import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "cli"))

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from odo import crypto as c


def fake(label, n=32):
    out = b""
    i = 0
    while len(out) < n:
        out += hashlib.sha256(f"fake:{label}:{i}".encode()).digest()
        i += 1
    return out[:n]


def b(x):
    return c.b64enc(x)


def hkdf_cases():
    cases = []
    for info in c.INFO.values():
        cases.append({"ikm": b(fake("ikm")), "salt": b(c.ZERO_SALT), "info": info, "okm": b(c.hkdf(fake("ikm"), info))})
    salt = fake("salt", 16)
    okm = c.hkdf(fake("ikm"), c.INFO["recovery"], salt)
    cases.append({"ikm": b(fake("ikm")), "salt": b(salt), "info": c.INFO["recovery"], "okm": b(okm)})
    return cases


def pad_cases():
    lens = [0, 1, 4092, 4093, 16380, 16381, 65532, 65533, 262140, 262141, 600000]
    return [{"len": n, "size": c.padded_size(n)} for n in lens]


def recovery_cases():
    secrets = [fake("rec-a"), bytes(32), b"\xff" * 32]
    return [{"secret": b(s), "phrase": c.secret_to_phrase(s)} for s in secrets]


def phrase_variants():
    s = fake("rec-a")
    p = c.secret_to_phrase(s)
    variants = [
        p.lower(),
        p.replace("-", " "),
        p.replace("-", ""),
        "  " + p.replace("0", "O").replace("1", "l") + "\n",
        p.replace("1", "I"),
    ]
    return [{"phrase": v, "secret": b(s)} for v in variants]


def wrap_cases():
    mk = fake("wrap-mk")
    ikm = fake("wrap-ikm")
    salt = fake("wrap-salt", 16)
    cases = []
    for type_, key in [
        ("passkey", c.passkey_wrap_key(ikm)),
        ("recovery", c.recovery_wrap_key(ikm, salt)),
        ("mac-cli", c.mac_wrap_key(ikm)),
    ]:
        iv = fake("wrap-iv-" + type_, 12)
        w = c.wrap_mk(mk, key, type_, iv)
        cases.append({"type": type_, "ikm": b(ikm), "salt": b(salt), "mk": b(mk), "iv": w["iv"], "ct": w["ct"]})
    return cases


def object_cases():
    mk = fake("obj-mk")
    key = c.object_key(mk)
    texts = [
        b"",
        c._dumps({"v": 1, "kind": "entry", "date": "2026-01-01", "mood": 7, "tags": ["test"], "text": "Fake entry for tests."}).encode(),
        c._dumps({"v": 1, "kind": "memory", "when": {"precision": "year", "value": "2001"}, "text": "café ☕ 東京 🚲 Ελληνικά — ünïcødé"}).encode(),
        ("Lorem ipsum dolor sit amet. " * 200).encode(),
    ]
    cases = []
    for i, t in enumerate(texts):
        path = c.new_object_path(fake(f"obj-name-{i}", 16))
        iv = fake(f"obj-iv-{i}", 12)
        cases.append({"mk": b(mk), "path": path, "iv": b(iv), "plaintext": b(t), "file": c.encrypt_bytes(key, path, t, iv)})
    return cases


def keyring_case():
    mk = fake("kr-mk")
    prf = fake("kr-prf")
    cred = fake("kr-cred", 16)
    prf_salt = fake("kr-prfsalt")
    rec = fake("kr-rec")
    rec_salt = fake("kr-recsalt", 16)
    mac = fake("kr-mac")
    keyring = c.new_keyring()
    keyring["wraps"].append(c.passkey_wrap(mk, prf, cred, prf_salt, fake("kr-iv-p", 12)))
    keyring["wraps"].append(c.recovery_wrap(mk, rec, rec_salt, fake("kr-iv-r", 12)))
    keyring["wraps"].append(c.mac_wrap(mk, mac, fake("kr-iv-m", 12)))
    payload = {
        "v": 1, "kind": "entry", "created": "2026-01-01T09:00:00-08:00", "date": "2026-01-01",
        "mood": 6, "tags": ["test", "fake"], "analyze": False, "text": "Fake keyring test entry. Nothing real here.",
    }
    path = c.new_object_path(fake("kr-name", 16))
    file = c.encrypt_object(c.object_key(mk), path, payload, fake("kr-iv-o", 12))
    return {
        "inputs": {
            "mk": b(mk), "prf": b(prf), "credId": b(cred), "prfSalt": b(prf_salt),
            "recoverySecret": b(rec), "recoverySalt": b(rec_salt), "macSecret": b(mac),
        },
        "keyring": keyring,
        "phrase": c.secret_to_phrase(rec),
        "object": {"path": path, "file": file, "payload": payload},
    }


def sealed_cases():
    prf = fake("seal-prf")
    obj = {"owner": "example-owner", "repo": "example-data", "token": "github_pat_FAKE0000000000"}
    iv = fake("seal-iv", 12)
    box = c.seal_json(c.token_key(prf), "device-secrets", obj, iv)
    return [{"prf": b(prf), "aad": "device-secrets", "obj": obj, "iv": b(iv), "box": box}]


def raw_object(mk, path, plaintext, iv, v=1):
    raw = AESGCM(c.hkdf(mk, c.INFO["object"])).encrypt(iv, plaintext, path.encode())
    return c._dumps({"v": v, "alg": "A256GCM", "iv": b(iv), "ct": b(raw)})


def flip(b64, i):
    data = bytearray(c.b64dec(b64))
    data[i] ^= 1
    return b(bytes(data))


def bad_cases(objs, wraps, kr, sealed):
    o = objs[1]
    other = c.new_object_path(fake("bad-other", 16))
    f = json.loads(o["file"])
    mk = c.b64dec(o["mk"])
    iv = fake("bad-iv", 12)
    junk = bytearray(c.pad(b"hello"))
    junk[-1] = 1
    loose = (10).to_bytes(4, "big") + b"0123456789" + bytes(16384 - 14)
    p = kr["phrase"]
    typo = p[:5] + ("A" if p[5] != "A" else "B") + p[6:]
    other_phrase = c.secret_to_phrase(fake("bad-rec"))
    passkey_wrap = dict(next(w for w in wraps if w["type"] == "passkey"))
    passkey_wrap["type"] = "mac-cli"
    return [
        {"case": "wrong path AAD", "op": "decrypt", "mk": o["mk"], "path": other, "file": o["file"]},
        {"case": "flipped ct bit", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "ct": flip(f["ct"], 5)})},
        {"case": "flipped tag bit", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "ct": flip(f["ct"], -1)})},
        {"case": "flipped iv bit", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "iv": flip(f["iv"], 0)})},
        {"case": "wrong key", "op": "decrypt", "mk": b(fake("bad-mk")), "path": o["path"], "file": o["file"]},
        {"case": "version 2", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "v": 2})},
        {"case": "version true", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "v": True})},
        {"case": "wrong alg", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "alg": "A128GCM"})},
        {"case": "not json", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": "nope"},
        {"case": "short iv", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "iv": b(bytes(8))})},
        {"case": "bad base64", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": c._dumps({**f, "ct": f["ct"][:-1] + "*"})},
        {"case": "bad path", "op": "decrypt", "mk": o["mk"], "path": "objects/zz/../keyring.json", "file": o["file"]},
        {"case": "path dir mismatch", "op": "decrypt", "mk": o["mk"], "path": "objects/00/" + o["path"][11:], "file": o["file"]},
        {"case": "nonzero padding", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": raw_object(mk, o["path"], bytes(junk), iv)},
        {"case": "padding not canonical", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": raw_object(mk, o["path"], loose, iv)},
        {"case": "length past end", "op": "decrypt", "mk": o["mk"], "path": o["path"], "file": raw_object(mk, o["path"], (5000).to_bytes(4, "big") + bytes(4092), iv)},
        {"case": "wrap moved to other slot", "op": "unwrap", "ikm": passkey_wrap["ikm"], "salt": passkey_wrap["salt"], "keyType": "passkey", "wrap": {k: passkey_wrap[k] for k in ("type", "iv", "ct")}},
        {"case": "phrase typo", "op": "phrase", "phrase": typo},
        {"case": "phrase too short", "op": "phrase", "phrase": p[:-1]},
        {"case": "phrase bad char", "op": "phrase", "phrase": "U" + p[1:]},
        {"case": "phrase from other secret", "op": "unlockRecovery", "keyring": kr["keyring"], "phrase": other_phrase},
        {"case": "wrong passkey prf", "op": "unlockPasskey", "keyring": kr["keyring"], "credId": kr["inputs"]["credId"], "prf": b(fake("bad-prf"))},
        {"case": "unknown passkey", "op": "unlockPasskey", "keyring": kr["keyring"], "credId": b(fake("bad-cred", 16)), "prf": kr["inputs"]["prf"]},
        {"case": "sealed box wrong aad", "op": "openSealed", "prf": sealed[0]["prf"], "aad": "other", "box": sealed[0]["box"]},
        {"case": "sealed box wrong prf", "op": "openSealed", "prf": b(fake("bad-prf")), "aad": sealed[0]["aad"], "box": sealed[0]["box"]},
        {"case": "keyring version 2", "op": "unlockRecovery", "keyring": {**kr["keyring"], "v": 2}, "phrase": p},
    ]


def run_bad(v):
    d = c.b64dec
    if v["op"] == "decrypt":
        return c.decrypt_bytes(c.object_key(d(v["mk"])), v["path"], v["file"])
    if v["op"] == "unwrap":
        keys = {"passkey": lambda: c.passkey_wrap_key(d(v["ikm"])), "recovery": lambda: c.recovery_wrap_key(d(v["ikm"]), d(v["salt"])), "mac-cli": lambda: c.mac_wrap_key(d(v["ikm"]))}
        return c.unwrap_mk(v["wrap"], keys[v["keyType"]]())
    if v["op"] == "phrase":
        return c.phrase_to_secret(v["phrase"])
    if v["op"] == "openSealed":
        return c.open_json(c.token_key(d(v["prf"])), v["aad"], v["box"])
    if v["op"] == "unlockRecovery":
        return c.unlock_with_recovery(v["keyring"], v["phrase"])
    if v["op"] == "unlockPasskey":
        return c.unlock_with_passkey(v["keyring"], d(v["credId"]), d(v["prf"]))
    raise ValueError(v["op"])


def with_errors(cases):
    for v in cases:
        try:
            run_bad(v)
        except c.CryptoError as err:
            v["error"] = str(err)
        else:
            raise SystemExit(f"bad case passed: {v['case']}")
    return cases


def main():
    objs = object_cases()
    wraps = wrap_cases()
    kr = keyring_case()
    sealed = sealed_cases()
    vectors = {
        "v": 1,
        "note": "Fake data only. Regenerate with: cli/.venv/bin/python tests/make_vectors.py",
        "hkdf": hkdf_cases(),
        "pad": pad_cases(),
        "recovery": recovery_cases(),
        "phraseVariants": phrase_variants(),
        "wrap": wraps,
        "object": objs,
        "keyring": kr,
        "sealed": sealed,
        "bad": with_errors(bad_cases(objs, wraps, kr, sealed)),
    }
    out = ROOT / "tests" / "vectors.json"
    out.write_text(json.dumps(vectors, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(vectors['bad'])} bad cases")


if __name__ == "__main__":
    main()
