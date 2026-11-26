import json
import re
from pathlib import Path

import pytest

from odo import crypto as c
from make_vectors import run_bad

V = json.loads((Path(__file__).parent / "vectors.json").read_text(encoding="utf-8"))
d = c.b64dec
e = c.b64enc


def key_for(type_, ikm, salt):
    if type_ == "passkey":
        return c.passkey_wrap_key(ikm)
    if type_ == "recovery":
        return c.recovery_wrap_key(ikm, salt)
    return c.mac_wrap_key(ikm)


def test_hkdf():
    for v in V["hkdf"]:
        assert e(c.hkdf(d(v["ikm"]), v["info"], d(v["salt"]))) == v["okm"]


def test_padding():
    for v in V["pad"]:
        assert c.padded_size(v["len"]) == v["size"]
        data = bytes([7]) * v["len"]
        p = c.pad(data)
        assert len(p) == v["size"]
        assert c.unpad(p) == data


def test_recovery_phrase():
    for v in V["recovery"]:
        assert c.secret_to_phrase(d(v["secret"])) == v["phrase"]
        assert e(c.phrase_to_secret(v["phrase"])) == v["secret"]
    for v in V["phraseVariants"]:
        assert e(c.phrase_to_secret(v["phrase"])) == v["secret"]
    r = c.new_recovery()
    assert re.fullmatch(r"([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}", r["phrase"])
    assert c.phrase_to_secret(r["phrase"]) == r["secret"]


def test_wrap():
    for v in V["wrap"]:
        key = key_for(v["type"], d(v["ikm"]), d(v["salt"]))
        assert c.wrap_mk(d(v["mk"]), key, v["type"], d(v["iv"])) == {"iv": v["iv"], "ct": v["ct"]}
        assert e(c.unwrap_mk({"type": v["type"], "iv": v["iv"], "ct": v["ct"]}, key)) == v["mk"]


def test_objects_byte_for_byte():
    for v in V["object"]:
        key = c.object_key(d(v["mk"]))
        assert c.encrypt_bytes(key, v["path"], d(v["plaintext"]), d(v["iv"])) == v["file"]
        assert e(c.decrypt_bytes(key, v["path"], v["file"])) == v["plaintext"]


def test_keyring_and_recovery_alone():
    k = V["keyring"]
    i = k["inputs"]
    ivs = [d(w["iv"]) for w in k["keyring"]["wraps"]]
    kr = c.new_keyring()
    kr["wraps"].append(c.passkey_wrap(d(i["mk"]), d(i["prf"]), d(i["credId"]), d(i["prfSalt"]), ivs[0]))
    kr["wraps"].append(c.recovery_wrap(d(i["mk"]), d(i["recoverySecret"]), d(i["recoverySalt"]), ivs[1]))
    kr["wraps"].append(c.mac_wrap(d(i["mk"]), d(i["macSecret"]), ivs[2]))
    assert kr == k["keyring"]
    assert c.secret_to_phrase(d(i["recoverySecret"])) == k["phrase"]

    mk = c.unlock_with_recovery(k["keyring"], k["phrase"])
    assert e(mk) == i["mk"]
    assert e(c.unlock_with_passkey(k["keyring"], d(i["credId"]), d(i["prf"]))) == i["mk"]
    assert e(c.unlock_with_mac(k["keyring"], d(i["macSecret"]))) == i["mk"]

    o = k["object"]
    assert c.decrypt_object(c.object_key(mk), o["path"], o["file"]) == o["payload"]


@pytest.mark.parametrize("v", V["bad"], ids=[v["case"] for v in V["bad"]])
def test_bad_inputs(v):
    with pytest.raises(c.CryptoError) as err:
        run_bad(v)
    assert str(err.value) == v["error"]


def test_fresh_random_round_trip():
    key = c.object_key(c.new_master_key())
    payload = {"v": 1, "kind": "entry", "date": "2026-01-02", "mood": 3, "tags": [], "text": "x" * 5000}
    path = c.new_object_path()
    file = c.encrypt_object(key, path, payload)
    assert c.decrypt_object(key, path, file) == payload
    assert c.encrypt_object(key, path, payload) != file
    assert len(d(json.loads(file)["ct"])) == 16384 + 16
